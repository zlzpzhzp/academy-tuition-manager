import { createHmac } from 'node:crypto'
import fixtures from '../paper-fixtures.cjs'
const clone = value => structuredClone(value)
function fixture(url) {
  const p = new URL(url).pathname
  if (p === '/api/special/pay/polish-special-payment/receipt' || p === '/api/payments/payment-0/receipt') return { signed: [{ stored: 'polish-receipt', url: '/__polish/receipt.svg' }] }
  if (p === '/api/audit-logs') return Array.from({ length: 45 }, (_, i) => ({ id: `polish-log-${i}`, action: 'update', summary: `합성 검수 변경 ${i}`, created_at: '2026-09-01T00:00:00Z' }))
  const data = clone(fixtures.fixture(url))
  if (p === '/api/grades') {
    const cls = data[0].classes[0]
    cls.students = Array.from({ length: 72 }, (_, i) => ({ ...clone(fixtures.students[i % 12]), id: `paper-${i + 1}`, name: `합성학생${String(i + 1).padStart(2,'0')}`, memo: i === 3 ? '9월 합성 긴 메모 '.repeat(40) : '', withdrawal_date: i === 71 ? '2026-09-10' : null }))
  }
  if (p === '/api/special') data.payments = [{ id: 'polish-special-payment', student_id: 'paper-1', amount: 100000, method: 'card', paid_at: '2026-09-01T00:00:00Z', receipt_images: ['polish-receipt'] }]
  if (p === '/api/payments') for (const payment of data) if (payment.id === 'payment-0') payment.receipt_images = ['polish-receipt']
  return data
}
function token(who) {
  const body = `${who}|${Math.floor(Date.now()/1000) + 3600}`
  return `${Buffer.from(body).toString('base64url')}.${createHmac('sha256','polish-synthetic-session-only').update(body).digest('base64url')}`
}
const button = (page, name) => page.getByRole('button', { name, exact: true }).first()
const row = (page, id = 'paper-5') => page.locator(`[data-student-row="${id}"]`).first()
async function expandRow(page) { await row(page).locator('[data-swipe-row] > div').first().click({ position:{x:4,y:4} }); await page.waitForTimeout(350) }
async function openCase(page, id) {
  if (id === 'student-edit') return page.getByRole('button', { name:/학생 추가/ }).first().click()
  if (id === 'student-detail') return row(page,'paper-1').getByRole('button').filter({ hasText:'합성학생01' }).first().click()
  if (id === 'payment') return button(page,'납부 기록').click()
  if (id === 'bill-send') return row(page).getByRole('button', { name:/카톡 청구서 발송/ }).first().click()
  if (id === 'bill-action') return row(page,'paper-4').getByRole('button', { name:/발송됨.*탭하여 파기/ }).click()
  if (id === 'bulk-send') {
    await page.getByRole('button', { name:'결제일 선택', exact:true }).first().click()
    await page.getByRole('button', { name:/청구지연 \d+명/ }).click(); await button(page,'적용').click()
    return page.locator('button[title*="조건의 미발송"]').click()
  }
  if (id === 'bulk-resend') return page.locator('button[title*="카톡 알림 재발송"]').click()
  if (id === 'quick' || id.startsWith('quick-')) {
    await page.getByRole('button', { name:/^청구서 발송(하기)?$/ }).first().click()
    if (id === 'quick') return
    await button(page,'과목').click()
    if (id === 'quick-subject') return
    await button(page,'수학').click(); await button(page,'학년').click()
    if (id === 'quick-grade') return
    await button(page,'중1').click(); return button(page,'반').click()
  }
  if (id === 'payment-days') return page.getByRole('button', { name:'결제일 선택', exact:true }).first().click()
  if (id === 'day-of-month') { await openCase(page,'student-detail'); return button(page,'정규 결제일 선택').click() }
  if (id === 'date' || id === 'method-pills') { await expandRow(page); return row(page).getByRole('button', { name:id === 'date' ? '결제일 선택' : '결제수단 선택', exact:true }).click() }
  if (id === 'withdrawal') return row(page,'paper-72').getByRole('button').filter({ hasText:'합성학생72' }).first().click()
  if (id === 'settings-transfer') {
    const control = page.getByRole('button', { name:'학생 반이동', exact:true }).first()
    if (!await control.isVisible()) await page.getByRole('button').filter({ hasText:'중1' }).first().click()
    return control.click()
  }
  if (id === 'settings-logs') return button(page,'변경 로그').click()
  if (id === 'student360-withdraw') return button(page,'퇴원 처리').click()
  if (id === 'special-receipt' || id === 'special-zoom') {
    await page.locator('button[title*="장 보기"]').first().click()
    if (id === 'special-zoom') return page.getByRole('img', { name:'영수증', exact:true }).first().click()
    return
  }
  if (id === 'install') return page.evaluate(() => { const event = new Event('beforeinstallprompt'); event.prompt = async () => {}; event.userChoice = Promise.resolve({ outcome:'dismissed' }); dispatchEvent(event) })
  if (id === 'notice-covers') {
    const covers = button(page,'교재 표지')
    if (!await covers.isVisible()) await page.getByRole('button').filter({ hasText:/이미지/ }).first().click()
    return covers.click()
  }
  // 아래 상태는 인계서의 수동 CDP 절차로만 채운다. 미실행을 PASS로 승격하지 않는다.
  throw new Error(`수동 상태 경로 필요: ${id}`)
}
export { fixture, token, openCase }
