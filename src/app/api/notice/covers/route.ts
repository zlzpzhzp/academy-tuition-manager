/**
 * 교재 표지 목록/파일 서빙 — 공지 MMS 첨부용
 * - 원본: /opt/dm-bank/_자원/표지/*.png (문뱅 공유, 읽기전용)
 * - ?file= 없으면 목록(JSON), 있으면 PNG 바이트 반환 (클라이언트 canvas에서 JPG 변환·압축)
 * - admin 세션 필수, 파일명은 목록에 실존하는 basename만 허용 (경로 탈출 차단)
 */
import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { requireAdminSession } from '@/lib/auth'

const COVERS_DIR = '/opt/dm-bank/_자원/표지'

export async function GET(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized

  let files: string[]
  try {
    files = (await readdir(COVERS_DIR)).filter(f => f.toLowerCase().endsWith('.png')).sort()
  } catch {
    return NextResponse.json({ error: '표지 폴더에 접근할 수 없습니다' }, { status: 503 })
  }

  const file = request.nextUrl.searchParams.get('file')
  if (!file) {
    return NextResponse.json({ covers: files.map(f => ({ name: f, title: f.replace(/\.png$/i, '').replace(/_/g, ' ') })) })
  }

  // basename 정규화 후 실존 목록과 대조 — ../ 등 경로 탈출 원천 차단
  const base = path.basename(file)
  if (!files.includes(base)) {
    return NextResponse.json({ error: '없는 표지 파일입니다' }, { status: 404 })
  }
  try {
    const buf = await readFile(path.join(COVERS_DIR, base))
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: '표지 파일 읽기 실패' }, { status: 500 })
  }
}
