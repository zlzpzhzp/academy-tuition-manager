import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth'
import { readBill, getRemainPoints } from '@/lib/payssam'

export async function POST(request: NextRequest) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  try {
    const { billId, action } = await request.json()

    if (action === 'points') {
      const result = await getRemainPoints()
      return NextResponse.json(result)
    }

    if (!billId) {
      return NextResponse.json({ error: 'billId가 필요합니다' }, { status: 400 })
    }

    const result = await readBill(billId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[PaySsam] 조회 실패:', error)
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다' }, { status: 500 })
  }
}
