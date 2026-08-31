import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireAdminSession } from '@/lib/auth'
import { validateInput, rules } from '@/lib/validate'

export async function GET(request: Request) {
  // 2026-07-07 안전점검: in-route 인증 가드 (defense-in-depth — 미들웨어 우회/버그 대비, 재무 데이터)
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const { searchParams } = new URL(request.url)
  const billingMonth = searchParams.get('billing_month')

  // 해당 월이 처음 열리면 이전 월 고정비를 복사해 승계.
  // 마커(PK billing_month) insert를 '먼저' 성공시킨 쪽만 복사한다 — 조회→복사→마커 순서는
  // 동시 요청 두 개가 같은 미개시 월을 보고 고정비를 2배로 복사했다 (2026-08-13 라인리뷰 P2).
  if (billingMonth) {
    // 형식 무검증이면 임의 문자열이 마커 테이블 insert와 .lt() 비교에 그대로 들어간다 (2026-08-16 라인리뷰)
    const invalidMonth = validateInput([rules.billingMonth('billing_month', billingMonth)])
    if (invalidMonth) return invalidMonth

    const { error: markerErr } = await supabase
      .from('academy_finance_months')
      .insert({ billing_month: billingMonth })

    if (markerErr && markerErr.code !== '23505') {
      // 마커 실패(중복 아님)면 복사 없이 조회만 — 다음 요청이 재시도
      console.error('[expenses] 월 개시 마커 실패:', markerErr.message)
    }
    if (!markerErr) {
      // 마커는 이미 박혔는데 복사(또는 그 앞의 조회)가 실패하면 그 달 고정비 승계가 영영 안 된다 —
      // 다음 요청부터 23505로 이 블록을 통째로 건너뛰기 때문. 어느 단계가 실패하든 마커를 롤백한다.
      // (조회 error를 버리던 탓에 prev·toCopy 실패는 롤백 없이 조용히 빠져나갔다 — 2026-08-16 라인리뷰)
      const rollbackMarker = async (what: string, msg: string) => {
        console.error(`[expenses] ${what} — 마커 롤백:`, msg)
        await supabase.from('academy_finance_months').delete().eq('billing_month', billingMonth)
      }

      const { data: prev, error: prevErr } = await supabase
        .from('academy_expenses')
        .select('billing_month')
        .eq('category', 'fixed')
        .lt('billing_month', billingMonth)
        .order('billing_month', { ascending: false })
        .limit(1)

      if (prevErr) {
        await rollbackMarker('이전 월 조회 실패', prevErr.message)
      } else if (prev?.[0]?.billing_month) {
        const { data: toCopy, error: toCopyErr } = await supabase
          .from('academy_expenses')
          .select('category, name, amount, memo')
          .eq('billing_month', prev[0].billing_month)
          .eq('category', 'fixed')

        if (toCopyErr) {
          await rollbackMarker('고정비 복사대상 조회 실패', toCopyErr.message)
        } else if (toCopy?.length) {
          const { error: copyErr } = await supabase.from('academy_expenses').insert(
            toCopy.map(e => ({ ...e, billing_month: billingMonth }))
          )
          if (copyErr) await rollbackMarker('고정비 승계 복사 실패', copyErr.message)
        }
      }
    }
  }

  let query = supabase.from('academy_expenses').select('*').order('category').order('created_at')
  if (billingMonth) query = query.eq('billing_month', billingMonth)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const unauthorized = requireAdminSession(request)
  if (unauthorized) return unauthorized
  const body = await request.json()
  if (!body.billing_month || !body.category || !body.name) {
    return NextResponse.json({ error: 'billing_month, category, name required' }, { status: 400 })
  }
  // 금액 무검증이면 음수/문자열/NaN이 그대로 저장돼 재무 합계를 왜곡한다 (2026-08-13 라인리뷰)
  const invalid = validateInput([rules.nonNegativeNumber('amount', body.amount)])
  if (invalid) return invalid

  const { data, error } = await supabase
    .from('academy_expenses')
    .insert({
      billing_month: body.billing_month,
      category: body.category,
      name: body.name,
      amount: body.amount ?? 0,
      memo: body.memo || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
