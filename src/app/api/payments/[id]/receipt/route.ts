import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { writeAuditLog } from '@/lib/auditLog'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const BUCKET = 'tuition-receipts'
const SIGNED_URL_TTL = 3600 // 1시간 (5분은 모달을 열어둔 채 넘기면 죽어서 "이미지 로드 실패"가 됐다 — 2026-07-26)

// 저장된 문자열(과거분=전체 public URL, 신규분도 동일 형식)에서 Storage 객체 경로만 뽑는다.
// 2026-07-26 감사: 버킷을 private으로 닫아도 기존 74건을 그대로 읽으려면 이 변환이 필요하다
// (DB 마이그레이션 없이 읽기 시점에 서명 URL을 발급하는 방식).
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`
export function objectPathFromStored(stored: string): string | null {
  const idx = stored.indexOf(PUBLIC_MARKER)
  if (idx >= 0) return stored.slice(idx + PUBLIC_MARKER.length)
  // 이미 경로만 저장된 경우(향후 형식) 그대로 사용
  if (!stored.startsWith('http')) return stored
  return null
}

// 영수증 사진 조회 — 저장된 경로에 대해 단기 서명 URL을 발급해서 돌려준다.
// 버킷이 public이든 private이든 화면은 이 서명 URL만 쓰므로, 버킷을 닫아도 화면이 깨지지 않는다.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing, error } = await supabase
    .from('tuition_payments')
    .select('receipt_images')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stored = (existing?.receipt_images as string[] | null) ?? []
  const signed = await Promise.all(stored.map(async (s) => {
    const path = objectPathFromStored(s)
    if (!path) return { stored: s, url: s } // 형식 불명 — 원본 그대로(하위호환)
    const { data, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)
    if (signErr || !data?.signedUrl) {
      console.error('[receipt-sign] 서명 URL 발급 실패:', { id, path, err: signErr })
      return { stored: s, url: s } // 발급 실패 시 기존 URL로 폴백(버킷이 아직 public인 동안 동작)
    }
    return { stored: s, url: data.signedUrl }
  }))

  return NextResponse.json({ receipt_images: stored, signed })
}

// 영수증 사진 업로드 → tuition-receipts 버킷에 저장 → receipt_images 배열 append
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: '5MB 이하만 가능' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'JPG/PNG/WebP만 가능' }, { status: 400 })

  const ext = (file.name.split('.').pop()?.toLowerCase() || 'jpg').replace(/[^a-z0-9]/g, '')
  const fileName = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
  if (uploadErr) {
    console.error('[receipt-upload] storage 실패:', { id, fileName, size: file.size, type: file.type, err: uploadErr })
    return NextResponse.json({ error: `업로드 실패: ${uploadErr.message}` }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  const url = urlData.publicUrl

  const { data: existing, error: selectErr } = await supabase
    .from('tuition_payments')
    .select('receipt_images')
    .eq('id', id)
    .single()
  if (selectErr) {
    console.error('[receipt-upload] select 실패:', { id, err: selectErr })
    return NextResponse.json({ error: `DB 조회 실패: ${selectErr.message}` }, { status: 500 })
  }
  const next = [...((existing?.receipt_images as string[] | null) ?? []), url]

  const { error: updateErr } = await supabase
    .from('tuition_payments')
    .update({ receipt_images: next })
    .eq('id', id)
  if (updateErr) {
    console.error('[receipt-upload] update 실패:', { id, err: updateErr })
    return NextResponse.json({ error: `DB 업데이트 실패: ${updateErr.message}` }, { status: 500 })
  }

  await writeAuditLog('payment', id, 'update', `영수증 사진 추가 (${next.length}장)`, { added: url })
  return NextResponse.json({ url, receipt_images: next })
}

// 영수증 사진 삭제 — body.url 기준으로 receipt_images에서 제거 + Storage 객체도 제거
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const url = body?.url as string | undefined
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('tuition_payments')
    .select('receipt_images')
    .eq('id', id)
    .single()
  const current = (existing?.receipt_images as string[] | null) ?? []
  // 2026-07-26 감사: 아래 Storage 삭제가 클라이언트가 준 url에서 객체 경로를 파생하므로,
  // 이 납부건이 실제로 갖고 있는 url인지 먼저 확인하지 않으면 남의 결제건 영수증까지 지울 수 있다.
  if (!current.includes(url)) {
    return NextResponse.json({ error: '이 납부 건의 영수증이 아닙니다' }, { status: 400 })
  }
  const next = current.filter(u => u !== url)

  const { error: updateErr } = await supabase
    .from('tuition_payments')
    .update({ receipt_images: next })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const marker = `/storage/v1/object/public/${BUCKET}/`
  const markerIdx = url.indexOf(marker)
  if (markerIdx >= 0) {
    const objectPath = url.slice(markerIdx + marker.length)
    await supabase.storage.from(BUCKET).remove([objectPath]).catch(() => null)
  }

  await writeAuditLog('payment', id, 'update', `영수증 사진 삭제 (남은 ${next.length}장)`, { removed: url })
  return NextResponse.json({ receipt_images: next })
}
