import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabase } from '@/lib/supabase'
import { getTodayString } from '@/lib/date'
import { writeAuditLog } from '@/lib/auditLog'
import { clearPaymentForBill } from '@/lib/paymentCancel'
import { cancelBill } from '@/lib/payssam'
import { sendSms } from '@/lib/solapi'
import { MESSAGE_PREFIX } from '@/lib/branding'

function verifyApiKey(received: unknown): boolean {
  const expected = process.env.PAYSSAM_API_KEY
  if (!expected) {
    console.error('[PaySsam Callback] PAYSSAM_API_KEY 환경변수 미설정')
    return false
  }
  if (typeof received !== 'string' || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// 2.2 승인동기화 — 페이민트 → 우리 서버
// 결제 완료 시 페이민트가 이 URL로 결과를 전달
export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { apikey, bill_id, appr_state, appr_price, appr_pay_type, appr_dt, appr_num } = data

    if (!verifyApiKey(apikey)) {
      console.warn('[PaySsam Callback] apikey 검증 실패', { bill_id })
      return NextResponse.json({ code: '9999', msg: '인증 실패' }, { status: 401 })
    }

    console.log('[PaySsam Callback]', JSON.stringify({ bill_id, appr_state, appr_price, appr_pay_type }))

    // bill_history 업데이트
    const statusMap: Record<string, string> = {
      F: 'paid',    // 결제완료
      W: 'pending', // 미결제
      C: 'cancelled', // 취소
      D: 'destroyed', // 파기
    }

    const updateData: Record<string, unknown> = {
      status: statusMap[appr_state] || appr_state,
      appr_num: appr_num || null,
      appr_price: appr_price ? parseInt(appr_price) : null,
      appr_pay_type: appr_pay_type || null,
      appr_dt: appr_dt || null,
      updated_at: new Date().toISOString(),
    }

    // 상태 갱신 실패를 무검사로 넘기고 '0000'을 주면, 청구서가 sent에 머물러 재발송 크론·중복발송
    // 가드가 미결제로 오판한다(결제선생은 성공으로 알고 재전송도 안 함). 아래 납부기록 블록과 동일하게
    // error를 직접 검사하고, 재전송을 유도하기 위해 비-0000으로 응답한다. (2026-07-26 감사)
    const { error: histError } = await supabase
      .from('tuition_bill_history')
      .update(updateData)
      .eq('bill_id', bill_id)
    if (histError) {
      console.error('[PaySsam Callback] bill_history 상태 갱신 실패:', bill_id, histError.message)
      await writeAuditLog('payment', null, 'update',
        `⚠️ 콜백 청구서 상태 갱신 실패: bill ${bill_id} (appr_state=${appr_state}) — 상태가 갱신 안 되면 재발송·중복발송 가드가 오판. 결제선생 재전송 유도를 위해 실패 응답, 수동 확인 필요`,
        { bill_id, appr_state, appr_price, error: histError.message })
      return NextResponse.json({ code: '9999', msg: '상태 갱신 실패' }, { status: 500 })
    }

    // 결제 완료(F) + 정규 원비인 경우에만 → 자동으로 납부 기록 생성
    // 비정규 결제(테스트, 보강, 특강 등)는 bill_history에만 기록되고 납부 탭에 반영되지 않음
    // 정규/선택과목 분리발송 시 한 학생에 청구서 2개가 있을 수 있으므로, bill_id 태그로 멱등성 보장
    if (appr_state === 'F' && bill_id) {
      const { data: billData, error: billDataError } = await supabase
        .from('tuition_bill_history')
        .select('student_id, amount, billing_month, is_regular_tuition, bill_note, supersedes_bill_id')
        .eq('bill_id', bill_id)
        .single()

      // 2026-07-31 조용한실패 점검: billData가 없으면(조회 오류 또는 우리 DB에 없는 bill_id) 아래 블록이
      // 전부 스킵되는데도 '0000'을 돌려주고 있었다 — 결제는 완료됐는데 납부기록·정산환불이 아무것도
      // 안 일어나고 결제선생은 성공으로 알아 재전송도 안 한다("냈는데 미납"). 위 상태갱신 실패 분기와
      // 동일하게 감사로그 + 비-0000으로 응답해 결제선생 재전송을 유도한다.
      if (!billData) {
        console.error('[PaySsam Callback] 결제완료 청구서 조회 실패/없음:', bill_id, billDataError?.message ?? 'no row')
        await writeAuditLog('payment', null, 'create',
          `⚠️ 콜백 결제완료(F) 처리 불가 — 청구서 조회 실패/없음: bill ${bill_id} ${appr_price ? `${Number(appr_price).toLocaleString()}원` : ''} — 납부기록·정산환불 미처리. 결제선생 재전송 유도를 위해 실패 응답, 수동 확인 필요`,
          { bill_id, appr_state, appr_price, error: billDataError?.message ?? 'no row' })
        return NextResponse.json({ code: '9999', msg: '청구서 조회 실패' }, { status: 500 })
      }

      // 중도퇴원 정산 재청구분이 결제완료 → 자동으로 '취소후 재청구 결제완료'로 마킹 (처리완료 섹션 이동)
      if (billData && billData.bill_note === '중도퇴원 정산') {
        await supabase
          .from('tuition_withdrawal_status')
          .upsert(
            { student_id: billData.student_id, billing_month: billData.billing_month, status: 'resettled_paid', updated_at: new Date().toISOString() },
            { onConflict: 'student_id,billing_month' },
          )
      }

      // 이 청구서가 기존 청구서를 대체(supersedes)하는 정산분이고 방금 결제완료됨 → 이제 기존 완납분을 취소(환불).
      // (원장 지시 2026-07-15: 퇴원 정산은 '취소 먼저'가 아니라 '정산분 결제완료 시점에' 기존 결제를 환불.
      //  → 정산분 결제 안 되면 기존 결제 그대로 유지되어 손실 없음.)
      // 정산분(supersedes 보유)의 기존분 환불이 실패하면, 아래 납부기록 블록이 살아있는 기존 row를
      // '분할결제 2차'로 오인해 금액을 누적한다(40만+15만=55만). 실패 시 납부기록을 건너뛰기 위한 플래그. (검수 P1)
      let resettleRefundFailed = false
      if (billData?.supersedes_bill_id) {
        const oldId = billData.supersedes_bill_id
        const { data: oldBill, error: oldBillError } = await supabase
          .from('tuition_bill_history')
          .select('status, amount, student_id, billing_month, short_url, phone')
          .eq('bill_id', oldId)
          .single()
        // 2026-08-01 ('보고만' 회수): 이 조회가 실패하거나 row 가 없으면 아래 환불 블록을 통째로
        // 건너뛰면서 **아무 흔적도 남지 않았다**. 정산분은 결제됐는데 기존 완납분은 그대로 남아
        // 학부모가 두 번 낸 상태가 된다 — 조용히 지나가면 아무도 모른다.
        if (!oldBill) {
          await writeAuditLog('payment', billData.student_id, 'update',
            `⚠️ 정산분(${bill_id}) 결제완료했으나 기존 완납분(${oldId}) 조회 실패/없음 — 자동 환불(취소) 미처리, 이중납부 여부 수동 확인 필요`,
            { newBillId: bill_id, oldBillId: oldId, error: oldBillError?.message ?? 'no row' })
          resettleRefundFailed = true
        }
        if (oldBill && oldBill.status === 'paid') {
          try {
            const cancelResult = await cancelBill(oldId, oldBill.amount)
            if (cancelResult.code === '0000') {
              await supabase
                .from('tuition_bill_history')
                .update({ status: 'cancelled', bill_note: '정산분 결제완료로 자동 환불(취소)', updated_at: new Date().toISOString() })
                .eq('bill_id', oldId)
              await clearPaymentForBill(oldBill.student_id, oldBill.billing_month, oldId, oldBill.amount)
              await writeAuditLog('payment', oldBill.student_id, 'update',
                `정산분(${bill_id}) 결제완료 → 기존 완납분(${oldId}, ${Number(oldBill.amount).toLocaleString()}원) 자동 환불(취소) 완료`,
                { newBillId: bill_id, refundedBillId: oldId, amount: oldBill.amount })
              // 취소영수증 문자 자동 발송 (2026-07-16 원장 지시: 정산 환불 완료 시 학부모에게 취소영수증 링크 전송)
              // 취소된 청구서의 결제선생 페이지(short_url)가 취소영수증 역할. SMS 실패는 환불 처리에 영향 없게 감사로그만.
              const smsTo = oldBill.phone
              if (smsTo && oldBill.short_url) {
                try {
                  const { data: stu } = await supabase
                    .from('tuition_students').select('name').eq('id', oldBill.student_id).single()
                  await sendSms(smsTo,
                    `${MESSAGE_PREFIX}${stu?.name ?? ''} 학생 기존 수업료 결제(${Number(oldBill.amount).toLocaleString()}원)가 취소(환불) 처리되었습니다.\n취소영수증: ${oldBill.short_url}`)
                  await writeAuditLog('payment', oldBill.student_id, 'update',
                    `취소영수증 문자 발송 완료: ${smsTo} (${oldId})`, { billId: oldId, to: smsTo })
                } catch (smsErr) {
                  await writeAuditLog('payment', oldBill.student_id, 'update',
                    `⚠️ 취소영수증 문자 발송 실패: ${smsTo} (${oldId}) — 수동 발송 필요`,
                    { billId: oldId, to: smsTo, error: (smsErr as Error).message })
                }
              }
            } else {
              resettleRefundFailed = true
              await writeAuditLog('payment', oldBill.student_id, 'update',
                `⚠️ 정산분 결제완료했으나 기존 결제 환불(취소) 실패: 기존 bill ${oldId} 수동 환불 필요 (정산분 ${bill_id}는 결제완료). 납부기록은 왜곡 방지를 위해 미기록 — 수동 정리 필요.`,
                { newBillId: bill_id, refundBillId: oldId, detail: cancelResult })
              await supabase.from('tuition_withdrawal_status').upsert(
                { student_id: oldBill.student_id, billing_month: oldBill.billing_month, status: 'resettle_refund_failed', updated_at: new Date().toISOString() },
                { onConflict: 'student_id,billing_month' },
              )
            }
          } catch (e) {
            resettleRefundFailed = true
            await writeAuditLog('payment', oldBill.student_id, 'update',
              `⚠️ 정산분 결제완료, 기존 결제 환불 중 오류: 기존 bill ${oldId} 수동 확인 필요. 납부기록은 왜곡 방지를 위해 미기록.`,
              { newBillId: bill_id, refundBillId: oldId, error: (e as Error).message })
            await supabase.from('tuition_withdrawal_status').upsert(
              { student_id: oldBill.student_id, billing_month: oldBill.billing_month, status: 'resettle_refund_failed', updated_at: new Date().toISOString() },
              { onConflict: 'student_id,billing_month' },
            )
          }
        }
      }

      if (billData && billData.is_regular_tuition !== false && !resettleRefundFailed) {
        const billTag = `[bill:${bill_id}]`
        const paidAmount = parseInt(appr_price) || billData.amount
        // 같은 학생+월의 기존 payssam row 조회 — 분할결제 누적 처리용.
        // maybeSingle()은 row 2건+에서 error→data=null fail-open으로 멱등검사가 우회돼
        // 콜백 재시도마다 중복 insert되던 버그 → 배열 조회 + billTag 우선매칭 (2026-07-12 감사 #2)
        const { data: monthRows } = await supabase
          .from('tuition_payments')
          .select('id, amount, memo')
          .eq('student_id', billData.student_id)
          .eq('billing_month', billData.billing_month)
          .eq('method', 'payssam')
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(10)

        // 이미 같은 bill_id 태그를 가진 row가 있으면 멱등 — 재처리 방지
        const taggedRow = (monthRows || []).find(r => (r.memo || '').includes(billTag))
        const existingMonth = taggedRow || (monthRows && monthRows[0]) || null

        if (existingMonth) {
          const alreadyHas = Boolean(taggedRow)
          if (!alreadyHas) {
            // 분할결제 두번째+ 콜백: 기존 row amount 누적 + memo 태그 추가
            const { error: accError } = await supabase.from('tuition_payments')
              .update({
                amount: existingMonth.amount + paidAmount,
                memo: `${existingMonth.memo || ''}${billTag}`,
              })
              .eq('id', existingMonth.id)
            if (accError) {
              // 2026-07-02: 콜백 기록 실패가 조용히 삼켜져 "냈는데 미납"이 생기던 사고 — 실패는 반드시 감사로그에 남긴다
              console.error('[PaySsam Callback] payments 누적 실패:', bill_id, accError.message)
              await writeAuditLog('payment', existingMonth.id, 'update',
                `⚠️ 콜백 납부 누적 실패: bill ${bill_id} ${paidAmount.toLocaleString()}원 — 수동 확인 필요`,
                { bill_id, paidAmount, error: accError.message })
            }
          }
        } else {
          const { error: insError } = await supabase.from('tuition_payments').insert({
            student_id: billData.student_id,
            amount: paidAmount,
            method: 'payssam',
            payment_date: getTodayString(),
            billing_month: billData.billing_month,
            memo: billTag,
          })
          if (insError) {
            console.error('[PaySsam Callback] payments 기록 실패:', bill_id, insError.message)
            await writeAuditLog('payment', null, 'create',
              `⚠️ 콜백 납부 기록 실패: bill ${bill_id} ${paidAmount.toLocaleString()}원 — 결제완료인데 납부 미기록, 수동 확인 필요`,
              { bill_id, student_id: billData.student_id, billing_month: billData.billing_month, paidAmount, error: insError.message })
          }
        }
      }
    }

    // 취소(C) 콜백 — 결제선생 앱에서 직접 취소한 경우에도 자동수납된 납부 기록을 정리
    // (우리 앱 /cancel 경유 시엔 이미 반영 해제돼 있어 아래 매칭이 0건 = 멱등)
    if (appr_state === 'C' && bill_id) {
      const { data: cancelledBill, error: cancelledBillError } = await supabase
        .from('tuition_bill_history')
        .select('student_id, billing_month, is_regular_tuition, amount, appr_price')
        .eq('bill_id', bill_id)
        .single()
      // 2026-07-31 조용한실패 점검: 조회 실패/없음이면 clearPaymentForBill이 조용히 스킵돼
      // 취소된 결제가 납부 기록에 그대로 남는다(취소했는데 '납부됨'). 위 상태갱신은 이미 성공했으므로
      // 재전송을 유도할 이유는 없고, 대신 감사로그로 반드시 표면화한다.
      if (!cancelledBill) {
        console.error('[PaySsam Callback] 취소 청구서 조회 실패/없음:', bill_id, cancelledBillError?.message ?? 'no row')
        await writeAuditLog('payment', null, 'update',
          `⚠️ 콜백 취소(C) 처리 불가 — 청구서 조회 실패/없음: bill ${bill_id} — 납부기록 해제(clearPaymentForBill) 미실행, 취소인데 납부됨으로 남아있을 수 있음. 수동 확인 필요`,
          { bill_id, appr_state, appr_price, error: cancelledBillError?.message ?? 'no row' })
      }
      if (cancelledBill && cancelledBill.is_regular_tuition !== false) {
        const cancelAmount = parseInt(appr_price) || cancelledBill.appr_price || cancelledBill.amount
        await clearPaymentForBill(cancelledBill.student_id, cancelledBill.billing_month, bill_id, cancelAmount)
      }
    }

    // 페이민트가 "0000" 응답을 받으면 검수 완료
    return NextResponse.json({ code: '0000', msg: '성공하였습니다.' })
  } catch (error) {
    console.error('[PaySsam Callback] 처리 실패:', error)
    return NextResponse.json({ code: '9999', msg: '처리 실패' }, { status: 500 })
  }
}
