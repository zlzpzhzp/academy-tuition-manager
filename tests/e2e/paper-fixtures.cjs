// 종이 테마 전후 검수 전용 합성 데이터. 실명·실번호·운영 토큰을 사용하지 않는다.
const stamp = '2026-09-01T00:00:00.000Z'
const teachers = [{ id: 'paper-teacher', name: '검수강사', subject: '수학', pay_ratio: 50, order_index: 1, created_at: stamp }]
const students = Array.from({ length: 12 }, (_, i) => ({
  id: `paper-${i + 1}`, class_id: 'paper-class', name: `합성학생${String(i + 1).padStart(2, '0')}`,
  parent_phone: '01000000000', phone: '01000000000', enrollment_date: i === 11 ? '2026-09-01' : '2026-03-01',
  withdrawal_date: null, custom_fee: null, payment_due_day: i === 4 ? 25 : 5,
  electives: [], memo: i === 3 ? '합성 검수 메모' : '', memo_color: i === 3 ? 'yellow' : null,
  order_index: i, created_at: stamp,
}))
const cls = { id: 'paper-class', grade_id: 'paper-grade', name: 'A', monthly_fee: 300000, subject: '수학', teacher_id: teachers[0].id, teacher: teachers[0], class_days: '1,3,5', order_index: 1, created_at: stamp }
const grades = [{ id: 'paper-grade', name: '중1', order_index: 1, created_at: stamp, classes: [{ ...cls, students }] }]
const payments = [0, 1, 2].map((i) => ({ id: `payment-${i}`, student_id: students[i].id, amount: i === 2 ? 100000 : 300000, method: 'cash', cash_receipt: 'pending', payment_date: '2026-09-03', billing_month: '2026-09', created_at: stamp }))
const bills = [0, 1, 2, 3].map(i => ({ id: `bill-${i}`, bill_id: `fixture-bill-${i}`, student_id: students[i].id, student: students[i], billing_month: '2026-09', amount: 300000, status: i < 2 ? 'paid' : 'sent', sent_at: stamp, is_regular_tuition: true, bill_type: 'regular', short_url: null }))
function fixture(url, empty = false) {
  const u = new URL(url), p = u.pathname
  if (p === '/api/billing/test-mode') return { testMode: true }
  if (p === '/api/kiosk-version') return { version: 'synthetic' }
  if (p === '/api/monthly-memo') return { memo: '', content: '', updated_at: stamp }
  if (p === '/api/grades') return empty ? [] : grades
  if (p === '/api/teachers') return empty ? [] : teachers
  if (p.startsWith('/api/teachers/')) return teachers[0]
  if (p === '/api/students') return empty ? [] : students.map(s => ({ ...s, class: cls }))
  if (/\/api\/students\/[^/]+$/.test(p)) return { ...students[0], class: { ...cls, grade: grades[0] } }
  if (p === '/api/payments') {
    if (empty || (u.searchParams.get('billing_month') && u.searchParams.get('billing_month') !== '2026-09')) return []
    return u.searchParams.has('student_id') ? payments.filter(x => x.student_id === u.searchParams.get('student_id')) : payments
  }
  if (p === '/api/fee-snapshots') return empty ? [] : ['2026-08', '2026-09'].flatMap(month => students.map(s => ({ student_id: s.id, month, fee: 300000 })))
  if (p === '/api/billing') return empty || u.searchParams.get('month') === '2026-08' ? [] : bills
  if (p === '/api/special') return { special: empty ? [] : [{ class_id: cls.id, label: '여름방학 특강', fee: 100000, hours_note: '합성 특강', teacher_note: '검수강사', period_start: '2026-07-23', period_end: '2026-08-13', due_date: '2026-07-23' }], bills: [], payments: [], groups: [], groupBills: [], groupPayments: [] }
  if (p === '/api/notice/history') return { history: [] }
  if (p === '/api/notice/covers') return { covers: [] }
  if (p === '/api/stats/monthly') {
    const months = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].map((month, i) => ({ month, fee: empty ? 0 : 3600000, paid: empty ? 0 : 1200000 + 500000 * i, special: empty ? 0 : i > 2 ? 300000 : 0, studentCount: empty ? 0 : 12, paidCount: empty ? 0 : 4 + i, byMethod: empty ? {} : { cash: 600000, card: 600000 + i * 500000 }, byTeacher: empty ? [] : [{ teacher_id: teachers[0].id, name: teachers[0].name, fee: 3600000, paid: 1200000 + i * 500000, studentCount: 12 }], bySubject: empty ? [] : [{ subject: '수학', fee: 3600000, paid: 1200000 + i * 500000 }] }))
    return { from: '2026-04', to: '2026-09', currentMonth: '2026-09', months }
  }
  if (['/api/attendance','/api/withdrawal-status','/api/billing/queue','/api/audit-logs','/api/expenses','/api/teacher-bonuses'].includes(p)) return []
  throw new Error(`대역 미정의: ${p}`)
}
module.exports = { fixture, students, teachers, grades, payments }
