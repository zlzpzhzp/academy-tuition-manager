import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const students = [
  { id: 'before', enrollment_date: '2026-07-22', withdrawal_date: null },
  { id: 'after', enrollment_date: '2026-08-06', withdrawal_date: null },
  { id: 'undated', enrollment_date: null, withdrawal_date: null },
]
const group = { id: 'group', name: '합성그룹', bill_note: '합성특강', period_start: '2026-07-23' }
const rows: Record<string, Record<string, unknown>[]> = {
  tuition_special_class: [], tuition_bill_history: [], tuition_special_payment: [],
  tuition_special_group: [group],
  tuition_special_group_member: students.map((student, order_index) => ({ group_id: 'group', order_index, student })),
}

// SELECT가 실제 요청한 학생 필드만 돌려준다. 등록일을 요청하지 않아도 fixture가
// 무조건 내려주는 대역이면 화면 시험만 통과하고 운영 그룹에서는 필터가 작동하지 않는다.
function query(table: string) {
  let columns = ''
  const builder = {
    select(value: string) { columns = value; return builder },
    eq() { return builder }, in() { return builder }, is() { return builder }, order() { return builder },
    then(resolve: (result: { data: unknown; error: null }) => void) {
      let data = rows[table]
      if (table === 'tuition_special_group_member') {
        const fields = columns.match(/student:tuition_students\(([^)]+)\)/)![1].split(',').map(field => field.trim())
        data = data.map(row => ({ ...row, student: Object.fromEntries(
          Object.entries(row.student as Record<string, unknown>).filter(([field]) => fields.includes(field)),
        ) }))
      }
      resolve({ data, error: null })
    },
  }
  return builder // 쓰기 메서드 없음: GET에서 DB 쓰기를 시도하면 시험 실패.
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => query(table) } }))
vi.mock('@/lib/auth', () => ({ requireAdminSession: () => null }))
import { GET } from '@/app/api/special/route'

describe('특강 조회의 그룹 명단 계약', () => {
  it('필터에 필요한 등록일과 그룹 시작일을 전달하고 후등록 멤버도 원본 응답에 보존한다', async () => {
    const before = structuredClone(rows)
    const response = await GET({} as NextRequest)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.groups).toEqual([{ ...group, students }])
    expect(rows).toEqual(before)
  })
})
