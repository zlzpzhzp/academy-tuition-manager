/**
 * 학원 공지 일괄 발송 — SMS (LMS 자동 전환)
 * - admin 세션 필수
 * - 본문 prefix: `[학원이름] ` 자동 부착 (NEXT_PUBLIC_ACADEMY_NAME 기준)
 * - isAd=true 시 `(광고)` prefix + 야간(21~08시 KST) 발송 차단. 광고는 사전 수신동의자만 보내야 함 (운영자 책임).
 * - 100건 단위 분할 발송. 같은 학부모폰 중복 제거.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { sendBulkSms, uploadMmsImage } from '@/lib/solapi'
import { writeAuditLog } from '@/lib/auditLog'
import { parentPhone } from '@/lib/student-codes'
import { MESSAGE_PREFIX } from '@/lib/branding'

interface NoticeSendBody {
  studentIds: string[]
  content: string
  isAd?: boolean
  toParent?: boolean
  toStudent?: boolean
  /** MMS 첨부 이미지 — data URL prefix 없는 순수 base64 JPG (클라이언트에서 200KB 이하로 변환·압축) */
  image?: string
}

const MMS_IMAGE_MAX_BYTES = 200 * 1024

const STUDIO_PREFIX = MESSAGE_PREFIX
const AD_PREFIX = '(광고)'

function buildBody(content: string, isAd: boolean): string {
  const ad = isAd ? AD_PREFIX : ''
  return `${ad}${STUDIO_PREFIX}${content}`
}

/** KST 야간(21:00 ~ 익일 08:00) 광고 발송 차단. 정보통신망법 50조 8항 */
function isNightHourKst(): boolean {
  const now = new Date()
  const kstHour = (now.getUTCHours() + 9) % 24
  return kstHour >= 21 || kstHour < 8
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  let body: NoticeSendBody
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const validationError = validateInput([
    rules.requiredString('content', body.content),
  ])
  if (validationError) return validationError
  if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
    return NextResponse.json({ error: '발송 대상 학생을 선택해주세요' }, { status: 400 })
  }
  const content = String(body.content).trim()
  if (content.length > 1500) {
    return NextResponse.json({ error: '본문은 1500자 이내' }, { status: 400 })
  }
  const isAd = body.isAd === true
  if (isAd && isNightHourKst()) {
    return NextResponse.json({ error: '광고성 문자는 21시~익일 08시 사이 발송이 금지됩니다 (정보통신망법)' }, { status: 400 })
  }

  // MMS 이미지 검증 — JPG 매직바이트 + 200KB 제한 (솔라피 규격)
  let imageBase64: string | null = null
  if (typeof body.image === 'string' && body.image.length > 0) {
    let buf: Buffer
    try { buf = Buffer.from(body.image, 'base64') } catch {
      return NextResponse.json({ error: '이미지 데이터가 올바르지 않습니다' }, { status: 400 })
    }
    if (buf.length > MMS_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: `이미지는 200KB 이하만 가능합니다 (현재 ${Math.round(buf.length / 1024)}KB)` }, { status: 400 })
    }
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      return NextResponse.json({ error: '이미지는 JPG 형식만 가능합니다' }, { status: 400 })
    }
    imageBase64 = body.image
  }

  // 수신자: 학부모/학생 (둘 다 미지정이면 학부모 기본 — 하위호환)
  const toStudent = body.toStudent === true
  const toParent = body.toParent === true || (body.toParent === undefined && body.toStudent === undefined)
  if (!toParent && !toStudent) {
    return NextResponse.json({ error: '수신자(학부모/학생)를 하나 이상 선택해주세요' }, { status: 400 })
  }

  // 활성 학생의 phone 조회 (학부모 + 학생 본인)
  const { data: students, error: studentError } = await supabase
    .from('tuition_students')
    .select('id, name, parent_phone, parent_father_phone, payssam_recipient, phone, withdrawal_date')
    .in('id', body.studentIds)
    .is('withdrawal_date', null)
  if (studentError) return NextResponse.json({ error: studentError.message }, { status: 500 })

  // 선택된 수신자 phone 수집, 중복 제거(가족 학부모폰 1회)
  const seen = new Set<string>()
  const text = buildBody(content, isAd)
  const recipients: { to: string; text: string }[] = []
  const skipped: { name: string; reason: string }[] = []
  const recipientList: { name: string; ch: string }[] = []  // 발송 내역 명단(이름 + 학부모/학생)
  for (const s of (students ?? [])) {
    const targets: string[] = []
    const chans: string[] = []
    if (toParent) {
      // 어머니 번호만 보면 아버님이 수신자인 학생이 학부모 채널에서 통째로 빠진다 (2026-08-11)
      const pp = parentPhone(s).replace(/-/g, '').trim()
      if (pp) { targets.push(pp); chans.push('학부모') }
    }
    if (toStudent) {
      const sp = ((s as { phone?: string }).phone || '').replace(/-/g, '').trim()
      if (sp) { targets.push(sp); chans.push('학생') }
    }
    if (targets.length === 0) {
      skipped.push({ name: s.name, reason: toStudent && !toParent ? '학생 폰 미등록' : toParent && !toStudent ? '학부모 폰 미등록' : '연락처 미등록' })
      continue
    }
    recipientList.push({ name: s.name, ch: chans.join('·') })
    for (const t of targets) {
      if (seen.has(t)) continue
      seen.add(t)
      recipients.push({ to: t, text })
    }
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: '발송 가능한 학생이 없습니다', skipped }, { status: 400 })
  }

  // MMS 이미지 업로드 — 발송 전 1회, 실패 시 발송 자체를 중단 (이미지 없는 채로 나가는 사고 방지)
  let imageId: string | undefined
  if (imageBase64) {
    try {
      imageId = await uploadMmsImage(imageBase64)
    } catch (e) {
      return NextResponse.json({
        error: `이미지 업로드 실패 — 발송하지 않았습니다: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 502 })
    }
  }

  // 100건 단위 분할 발송
  const results: { groupId: string; count: number; failed: number }[] = []
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100)
    try {
      const r = await sendBulkSms(chunk, imageId ? { imageId } : undefined)
      results.push(r)
    } catch (e) {
      return NextResponse.json({
        error: `일괄 발송 중 오류: ${e instanceof Error ? e.message : String(e)}`,
        partial: results,
        skipped,
      }, { status: 500 })
    }
  }

  const total = results.reduce((s, r) => s + r.count, 0)
  const totalFailed = results.reduce((s, r) => s + r.failed, 0)

  await writeAuditLog(
    'notice',
    results[0]?.groupId ?? null,
    'create',
    `공지 발송 — ${total}건${totalFailed ? ` (실패 ${totalFailed})` : ''}${isAd ? ' [광고]' : ''}${imageId ? ' [이미지]' : ''}`,
    {
      type: 'notice_send',
      isAd,
      toParent,
      toStudent,
      hasImage: Boolean(imageId),
      content,
      sent: total,
      failed: totalFailed,
      recipients_count: recipients.length,
      skipped_count: skipped.length,
      recipients: recipientList,
    },
  )

  return NextResponse.json({
    ok: true,
    sent: total,
    failed: totalFailed,
    skipped,
    groups: results.map(r => r.groupId),
  })
}
