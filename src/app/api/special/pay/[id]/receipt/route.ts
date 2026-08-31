import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'

// 특강 직접납부(tuition_special_payment) 영수증 사진 — 납부탭 receipt와 동일 방식, 테이블만 다름 (2026-07-09)
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const BUCKET = 'tuition-receipts'
const SIGNED_URL_TTL = 3600 // 1시간 (5분은 모달을 열어둔 채 넘기면 죽어서 "이미지 로드 실패"가 됐다 — 2026-07-26)

// 저장된 문자열(전체 public URL)에서 Storage 객체 경로만 뽑는다.
// 2026-07-26 감사: 버킷을 private으로 닫았으므로 화면은 서명 URL로만 이미지를 읽는다.
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`
function objectPathFromStored(stored: string): string | null {
  const idx = stored.indexOf(PUBLIC_MARKER)
  if (idx >= 0) return stored.slice(idx + PUBLIC_MARKER.length)
  if (!stored.startsWith('http')) return stored
  return null
}

// 특강 영수증 조회 — 단기 서명 URL 발급. (2026-07-26: 특강탭엔 '보기'가 아예 없어서
// 이미 올린 사진을 누르면 업로드 창만 뜨던 것 — 운영자님 신고 — 을 고치며 함께 신설)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params

  const { data: existing, error } = await supabase
    .from('tuition_special_payment')
    .select('receipt_images')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stored = (existing?.receipt_images as string[] | null) ?? []
  const signed = await Promise.all(stored.map(async (s) => {
    const path = objectPathFromStored(s)
    if (!path) return { stored: s, url: s }
    const { data, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)
    if (signErr || !data?.signedUrl) {
      console.error('[special-receipt-sign] 서명 URL 발급 실패:', { id, path, err: signErr })
      return { stored: s, url: s }
    }
    return { stored: s, url: data.signedUrl }
  }))

  return NextResponse.json({ receipt_images: stored, signed })
}

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
  const fileName = `special/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
  if (uploadErr) {
    console.error('[special-receipt] storage 실패:', { id, err: uploadErr })
    return NextResponse.json({ error: `업로드 실패: ${uploadErr.message}` }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  const url = urlData.publicUrl

  const { data: existing, error: selectErr } = await supabase
    .from('tuition_special_payment')
    .select('receipt_images')
    .eq('id', id)
    .single()
  if (selectErr) {
    return NextResponse.json({ error: `DB 조회 실패: ${selectErr.message}` }, { status: 500 })
  }
  const next = [...((existing?.receipt_images as string[] | null) ?? []), url]

  const { error: updateErr } = await supabase
    .from('tuition_special_payment')
    .update({ receipt_images: next })
    .eq('id', id)
  if (updateErr) {
    return NextResponse.json({ error: `DB 업데이트 실패: ${updateErr.message}` }, { status: 500 })
  }
  return NextResponse.json({ url, receipt_images: next })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const url = body?.url as string | undefined
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const { data: existing } = await supabase
    .from('tuition_special_payment')
    .select('receipt_images')
    .eq('id', id)
    .single()
  const current = (existing?.receipt_images as string[] | null) ?? []
  // 2026-07-26 감사: 아래 Storage 삭제가 클라이언트가 준 url에서 경로를 파생하므로,
  // 이 납부건 소유 url인지 먼저 확인하지 않으면 다른 건의 영수증까지 지울 수 있다. (납부탭과 동일 가드)
  if (!current.includes(url)) {
    return NextResponse.json({ error: '이 납부 건의 영수증이 아닙니다' }, { status: 400 })
  }
  const next = current.filter(u => u !== url)

  const { error: updateErr } = await supabase
    .from('tuition_special_payment')
    .update({ receipt_images: next })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const marker = `/storage/v1/object/public/${BUCKET}/`
  const markerIdx = url.indexOf(marker)
  if (markerIdx >= 0) {
    await supabase.storage.from(BUCKET).remove([url.slice(markerIdx + marker.length)]).catch(() => null)
  }
  return NextResponse.json({ receipt_images: next })
}
