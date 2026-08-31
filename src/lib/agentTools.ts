import { queryGradesTree, mapGradesTree, queryPaidMap, querySnapshotFeeMap } from '@/lib/queries'
import { getActiveStudents, getStudentFee, type Student, type Class } from '@/types'
import { formatClassName } from '@/lib/format'

// ── AI 에이전트 도구 정의 + 실행 (route.ts에서 분리 — 요금·재적 판정을 테스트 가능하게) ──

export interface ToolDef {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required?: string[]
  }
}

export const toolDefinitions: ToolDef[] = [
  {
    name: 'list_grades_and_classes',
    description: '학년/반/학생 전체 목록을 조회합니다. 학생 이름, 소속 반, 원비(선택과목비 포함) 등을 확인할 수 있습니다.',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'get_unpaid_students',
    description: '특정 월의 미납 학생 목록을 조회합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        billing_month: { type: 'STRING', description: '조회할 월 (YYYY-MM)' },
      },
      required: ['billing_month'],
    },
  },
  {
    name: 'get_payment_status',
    description: '특정 월의 납부 현황을 반별로 조회합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        billing_month: { type: 'STRING', description: '조회할 월 (YYYY-MM)' },
      },
      required: ['billing_month'],
    },
  },
]

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * 학생의 그 달 요금 정본.
 * 스냅샷(그 달 1일 크론 + 당월 변경 즉시 갱신)이 있으면 그것이 정본 — 과거 월을 현재
 * 요금으로 재계산하면 월중 요금 변동·선택과목 이력과 어긋난다(teachers/[id]·finance와 동일 축).
 * 스냅샷이 없으면(스냅샷 도입 전 과거 월·미래 월) 현재 요금으로 계산하되, 그 계산은
 * 반드시 getStudentFee(기본 + 선택과목비 합산) — custom_fee ?? monthly_fee 만 보면
 * 선택과목비가 통째로 빠져 선택과목 미납자가 완납으로 집계된다 (2026-08-13 라인리뷰 P1).
 */
function feeFor(student: Student, cls: Class, feeMap: Record<string, number>): number {
  return feeMap[student.id] ?? getStudentFee(student, cls)
}

export async function listGradesAndClasses() {
  try {
    const { data, error } = await queryGradesTree()
    if (error) return { error: error.message }

    const mapped = mapGradesTree(data ?? [])
    return mapped.map(g => ({
      grade: g.name,
      classes: g.classes.map(c => ({
        name: c.name,
        subject: c.subject,
        monthly_fee: c.monthly_fee,
        students: ((c.students ?? []) as unknown as Student[])
          .filter(s => !s.withdrawal_date)
          .map(s => ({
            name: s.name,
            id: s.id,
            // fee = 이 학생의 실제 월 요금 (custom_fee/반비 + 선택과목비)
            fee: getStudentFee(s, c as unknown as Class),
            electives: s.electives ?? [],
          })),
      })),
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('listGradesAndClasses error:', msg)
    return { error: `학년/반 조회 실패: ${msg}` }
  }
}

export async function getUnpaidStudents(args: Record<string, string>) {
  try {
    const month = args.billing_month
    if (!MONTH_RE.test(month ?? '')) {
      return { error: `billing_month는 YYYY-MM 형식이어야 합니다 (받은 값: ${month ?? '없음'})` }
    }

    const { data, error } = await queryGradesTree()
    if (error || !data) return { error: error?.message ?? '데이터 조회 실패' }

    const mapped = mapGradesTree(data)
    // 2026-07-31 조용한실패 점검: queryPaidMap은 오류 시 빈 paidMap + error를 준다. error를 버리면
    // '아무도 안 냈다'와 구별되지 않아 전교생이 미납으로 집계되고, LLM이 그 숫자를 사실처럼 말한다.
    const { paidMap, error: paidError } = await queryPaidMap(month)
    if (paidError) {
      return { error: `납부 기록 조회에 실패해 미납 명단을 만들 수 없습니다 (${paidError.message}). 미납자 수를 추측하지 말고 조회 실패를 그대로 알려주세요.` }
    }
    const { feeMap, error: feeError } = await querySnapshotFeeMap(month)
    if (feeError) {
      return { error: `요금 스냅샷 조회에 실패해 미납 명단을 만들 수 없습니다 (${feeError.message}). 미납자 수를 추측하지 말고 조회 실패를 그대로 알려주세요.` }
    }

    const unpaid: { grade: string; class_name: string; name: string; fee: number; paid: number }[] = []
    for (const g of mapped) {
      for (const c of g.classes) {
        // 재적 판정은 월 기준(납부 페이지와 동일) — !withdrawal_date 로 거르면
        // 그 달을 다니고 월중 퇴원한 학생의 미납이 명단에서 사라진다.
        for (const s of getActiveStudents((c.students ?? []) as unknown as Student[], month)) {
          const fee = feeFor(s, c as unknown as Class, feeMap)
          const paid = paidMap[s.id] ?? 0
          // class_name은 과목 병기('수학H') — 반 이름 단독은 수학/영어 간 구분 불가 (중3H가 양쪽에 존재)
          if (paid < fee) unpaid.push({ grade: g.name, class_name: formatClassName(c), name: s.name, fee, paid })
        }
      }
    }

    return { billing_month: month, total_unpaid: unpaid.length, students: unpaid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('getUnpaidStudents error:', msg)
    return { error: `미납 학생 조회 실패: ${msg}` }
  }
}

export async function getPaymentStatusByMonth(args: Record<string, string>) {
  try {
    const month = args.billing_month
    if (!MONTH_RE.test(month ?? '')) {
      return { error: `billing_month는 YYYY-MM 형식이어야 합니다 (받은 값: ${month ?? '없음'})` }
    }

    const { data, error } = await queryGradesTree()
    if (error || !data) return { error: error?.message ?? '데이터 조회 실패' }

    const mapped = mapGradesTree(data)
    // 2026-07-31 조용한실패 점검: 위와 동일 — error를 버리면 납부 0원으로 집계돼 '전원 미납' 현황이 나온다.
    const { paidMap, error: paidError } = await queryPaidMap(month)
    if (paidError) {
      return { error: `납부 기록 조회에 실패해 납부 현황을 만들 수 없습니다 (${paidError.message}). 납부/미납 숫자를 추측하지 말고 조회 실패를 그대로 알려주세요.` }
    }
    const { feeMap, error: feeError } = await querySnapshotFeeMap(month)
    if (feeError) {
      return { error: `요금 스냅샷 조회에 실패해 납부 현황을 만들 수 없습니다 (${feeError.message}). 납부/미납 숫자를 추측하지 말고 조회 실패를 그대로 알려주세요.` }
    }

    const result = []
    for (const g of mapped) {
      for (const c of g.classes) {
        const activeStudents = getActiveStudents((c.students ?? []) as unknown as Student[], month)
        let paidCount = 0, totalFee = 0, totalPaid = 0

        for (const s of activeStudents) {
          const fee = feeFor(s, c as unknown as Class, feeMap)
          const paid = paidMap[s.id] ?? 0
          totalFee += fee
          totalPaid += paid
          if (paid >= fee) paidCount++
        }

        if (activeStudents.length > 0) {
          result.push({
            grade: g.name, class_name: formatClassName(c),
            total_students: activeStudents.length, paid_count: paidCount,
            unpaid_count: activeStudents.length - paidCount,
            total_fee: totalFee, total_paid: totalPaid,
          })
        }
      }
    }

    return { billing_month: month, classes: result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('getPaymentStatusByMonth error:', msg)
    return { error: `납부 현황 조회 실패: ${msg}` }
  }
}

export async function executeTool(name: string, args: Record<string, string>): Promise<unknown> {
  switch (name) {
    case 'list_grades_and_classes': return listGradesAndClasses()
    case 'get_unpaid_students': return getUnpaidStudents(args)
    case 'get_payment_status': return getPaymentStatusByMonth(args)
    default: return { error: `알 수 없는 도구: ${name}` }
  }
}
