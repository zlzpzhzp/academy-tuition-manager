/**
 * 미납 알림 문자 단건 발송 (자유 본문)
 * - admin 세션 필수
 * - 학생 1명의 학부모 phone으로 본문 그대로 SMS 발송 ([학원이름] prefix 자동 부착 X — 본문에 직접 포함)
 * - studentId로 학부모 폰 조회 → solapi sendBulkSms ([1]) 호출
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'
import { sendBulkSms } from '@/lib/solapi'
import { writeAuditLog } from '@/lib/auditLog'
import { parentPhone } from '@/lib/student-codes'

interface Body {
  studentId: string
  text: string
  billId?: string
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  let body: Body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const validationError = validateInput([
    rules.requiredString('studentId', body.studentId),
    rules.requiredString('text', body.text),
  ])
  if (validationError) return validationError

  const text = String(body.text).trim()
  if (text.length === 0) {
    return NextResponse.json({ error: '본문이 비어있습니다' }, { status: 400 })
  }
  if (text.length > 1500) {
    return NextResponse.json({ error: '본문은 1500자 이내' }, { status: 400 })
  }

  const { data: student, error: studentError } = await supabase
    .from('tuition_students')
    .select('id, name, phone, parent_phone, parent_father_phone, payssam_recipient, withdrawal_date')
    .eq('id', body.studentId)
    .single()
  if (studentError || !student) {
    return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })
  }
  if (student.withdrawal_date) {
    return NextResponse.json({ error: '퇴원생에게는 발송할 수 없습니다' }, { status: 400 })
  }
  // parent_phone 만 보면 '아버님이 수신자'인 학생을 놓친다 — 어머니 번호가 비어 있으면 안내가
  // 아예 안 나가고(백종원 2026-08-11 실측), 둘 다 있으면 원장이 고른 수신자를 무시한다.
  // parentPhone 이 payssam_recipient 를 존중하는 단일 판정 (학생 본인 번호로는 새지 않는다).
  const phone = parentPhone(student).replace(/-/g, '').trim()
  if (!phone) {
    return NextResponse.json({ error: '학부모 폰이 등록되어 있지 않습니다' }, { status: 400 })
  }

  try {
    const result = await sendBulkSms([{ to: phone, text }])

    // 2026-07-31 조용한실패 점검: sendBulkSms는 HTTP 200이어도 접수 실패건을 failed(registeredFailed)로
    // 돌려준다. 이걸 안 보면 등록 실패인데도 ok:true + 발송배지 증가 + "발송 완료" 감사로그가 남아
    // 미납 안내가 안 갔는데 갔다고 기록된다. 공지 일괄발송(/api/notice/send)과 동일하게 failed를
    // 응답·감사로그에 표면화한다. 다만 여기는 수신자 1명뿐이라 failed>0 = 전건 실패 →
    // 배지 증가는 건너뛰고 실패로 응답한다(보낸 척 금지).
    if (result.failed > 0) {
      await writeAuditLog(
        'attendance',
        result.groupId || null,
        'upsert',
        `⚠️ 미납 안내 문자 발송 실패 — ${student.name} (실패 ${result.failed}) — 수동 확인 필요`,
        { type: 'overdue_sms', student_id: student.id, bill_id: body.billId, sent: 0, failed: result.failed, content_preview: text.slice(0, 120) },
      )
      return NextResponse.json({
        ok: false,
        error: '문자 접수에 실패했습니다 (통신사 접수 거부). 번호를 확인하고 다시 시도하세요.',
        sent: 0,
        failed: result.failed,
        groupId: result.groupId,
      }, { status: 502 })
    }

    // bill_id가 있으면 해당 청구서의 overdue_sms_count 증가 + 시각 갱신 (UI 배지용)
    if (body.billId) {
      const { data: existing } = await supabase
        .from('tuition_bill_history')
        .select('overdue_sms_count')
        .eq('bill_id', body.billId)
        .single()
      const prevCount = (existing?.overdue_sms_count as number | null | undefined) ?? 0
      await supabase
        .from('tuition_bill_history')
        .update({ overdue_sms_count: prevCount + 1, last_overdue_sms_at: new Date().toISOString() })
        .eq('bill_id', body.billId)
    }

    await writeAuditLog(
      'attendance',
      result.groupId || null,
      'upsert',
      `미납 안내 문자 발송 — ${student.name}`,
      { type: 'overdue_sms', student_id: student.id, bill_id: body.billId, sent: result.count, failed: 0, content_preview: text.slice(0, 120) },
    )
    // sent/failed 추가는 필드 추가라 기존 소비처(BillActionModal: res.ok + data.ok만 확인)에 무해. (2026-07-31)
    return NextResponse.json({ ok: true, sent: result.count, failed: 0, groupId: result.groupId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `발송 실패: ${msg}` }, { status: 500 })
  }
}
