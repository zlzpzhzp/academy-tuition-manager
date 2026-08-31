import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import * as XLSX from 'xlsx'
import { PAYMENT_METHOD_LABELS } from '@/types'
import type { PaymentMethod } from '@/types'
import { formatClassName } from '@/lib/format'

export async function GET(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const billingMonth = searchParams.get('billing_month')

  if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billing_month is required (YYYY-MM)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tuition_payments')
    .select('*, student:tuition_students(name, class:tuition_classes(name, subject))')
    .eq('billing_month', billingMonth)
    .is('deleted_at', null)
    .order('payment_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build rows for Excel
  const rows = (data ?? []).map((p: Record<string, unknown>) => {
    const student = p.student as { name?: string; class?: { name?: string; subject?: string | null } } | null
    return {
      '학생이름': student?.name ?? '',
      '반': formatClassName(student?.class), // '수학H' — 반 이름 단독은 과목 간 구분 불가
      '납부금액': p.amount as number,
      '결제방법': PAYMENT_METHOD_LABELS[(p.method as PaymentMethod)] ?? p.method,
      '결제일': p.payment_date as string,
      '청구월': p.billing_month as string,
      '비고': (p.memo as string) ?? '',
    }
  })

  // Create workbook
  const ws = XLSX.utils.json_to_sheet(rows)

  // Set column widths
  ws['!cols'] = [
    { wch: 12 }, // 학생이름
    { wch: 15 }, // 반
    { wch: 12 }, // 납부금액
    { wch: 12 }, // 결제방법
    { wch: 12 }, // 결제일
    { wch: 10 }, // 청구월
    { wch: 20 }, // 비고
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '납부내역')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const [y, m] = billingMonth.split('-')
  const filename = `납부내역_${y}년${parseInt(m)}월.xlsx`

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
