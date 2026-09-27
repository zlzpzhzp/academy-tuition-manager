// 납부 헤더/필터 전후 대조 전용. 모든 이름·연락처·ID는 합성 데이터다.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- 기존 CJS 합성 대역을 Node/기준 사본/Vitest에서 같이 사용한다.
const paper = require('./paper-fixtures.cjs')
function scenario() {
  const students = paper.students.map((s, i) => ({ ...structuredClone(s), id: `header-${i + 1}`, name: `검수학생${i + 1}`, electives: [], payment_due_day: [5,5,3,5,7,8,9,12,4,2,31,25][i], enrollment_date: '2026-09-01', memo: '' }))
  for (const i of [1,2,3]) { students[i].electives = ['확통']; students[i].electives_payment_due_day = {1:10,2:11,3:20}[i] }
  students[7].withdrawal_date = '2026-09-30'
  students[8].batch_exclude_month = '2026-09'
  students[9].enrollment_date = '2026-10-01'
  const grades = structuredClone(paper.grades)
  grades[0].name = '아주 긴 검수 학년명'
  grades[0].classes[0].students = students
  const bills = [1,3].map(i => ({ id: `hb-${i}`, bill_id: `hb-${i}`, student_id: students[i].id, billing_month: '2026-09', amount: 300000, status: 'sent', sent_at: '2026-09-01T00:00:00Z', is_regular_tuition: true, bill_type: 'regular' }))
  const queue = [{id:'hq',student_id:students[4].id,billing_month:'2026-09',send_type:'single',scheduled_at:'2026-09-14T02:00:00Z',is_regular_tuition:true,bill_type:'regular',created_at:'2026-09-01T00:00:00Z'}]
  const snapshots = students.map((s,i) => ({ student_id:s.id,month:'2026-09',fee:i === 5 ? 0 : 300000 }))
  const payments = [{ id:'hp',student_id:students[6].id,amount:0,method:'cash',payment_date:'2026-09-01',billing_month:'2026-09' }]
  return { students, grades, bills, queue, snapshots, payments }
}
function fixture(data, url) {
  const u = new URL(url)
  if(u.pathname === '/api/grades') return data.grades
  if(u.pathname === '/api/payments') return u.searchParams.get('billing_month') === '2026-09' ? data.payments : []
  if(u.pathname === '/api/billing') return u.searchParams.get('month') === '2026-09' ? data.bills : []
  if(u.pathname === '/api/billing/queue') return u.searchParams.get('month') === '2026-09' ? data.queue : []
  if(u.pathname === '/api/fee-snapshots') return data.snapshots
  return paper.fixture(url)
}
module.exports = {scenario, fixture}
