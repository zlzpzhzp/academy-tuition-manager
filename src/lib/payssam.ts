import { createHash } from 'crypto'
import { ACADEMY_LEGAL_NAME, BILL_ID_PREFIX } from './branding'

// 테스트 모드. true 면 실제 발송 없이 성공 코드('0000')만 돌려준다 —
// 결제 대행사 계약 전이나 스테이징 리허설에서 켜 둔다. 운영 배포 전에 반드시 false 확인.
const TEST_MODE = false

/**
 * 필수 환경변수 조회 — 없으면 즉시 throw.
 *
 * 🔴 여기 기본값(폴백)을 넣지 마라. 과거 이 파일엔 API URL 이 없으면 조용히 스테이징 도메인으로
 *    가는 폴백이 있었고, 그 도메인이 죽은 뒤에도 "발송 성공"처럼 보였다. 돈이 걸린 경로에서는
 *    **조용히 틀리는 것보다 시끄럽게 실패하는 편이 항상 낫다.**
 *
 * 모듈 로드 시점에 던지면 빌드가 깨지므로(정적 분석이 이 모듈을 import 만 해도 터진다)
 * 반드시 **호출 시점에** lazy 평가한다.
 */
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} 환경변수 미설정 — .env.example 을 참고해 값을 채워라 (폴백 없음: 의도된 설계)`)
  return v
}

const BASE_URL = () => required('PAYSSAM_API_URL')
const API_KEY = () => process.env.PAYSSAM_API_KEY || ''
const MEMBER = () => required('PAYSSAM_MEMBER')
const MERCHANT = () => required('PAYSSAM_MERCHANT')
// 콜백 URL 미설정 시 결제 결과가 우리 DB에 반영되지 않는다(청구서는 나가는데 '결제완료'가 안 뜬다).
// 조용히 틀리느니 발송 시점에 실패시킨다.
const CALLBACK_URL = () => required('PAYSSAM_CALLBACK_URL')

function generateHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join(',')).digest('hex')
}

function generateBillId(): string {
  // Date.now() 단독은 동일 ms 2건 발송 시 ID 충돌(두 학생 청구가 같은 bill_id로 동시갱신) — 난수 4자리 suffix
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return `${BILL_ID_PREFIX}-${ts}${rand}`.slice(0, 20)
}

interface SendBillParams {
  studentName: string
  phone: string
  amount: number
  productName: string
  message?: string
  billIssuer?: string
  expireDate?: string
}

interface PaySsamResponse {
  code: string
  msg: string
  [key: string]: unknown
}

async function callApi(uri: string, body: Record<string, unknown>): Promise<PaySsamResponse> {
  const res = await fetch(`${BASE_URL()}${uri}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', charset: 'UTF-8' },
    body: JSON.stringify(body),
  })
  // 게이트웨이 에러(HTML 502 등)를 res.json() 파싱 실패로 죽이지 않고 코드/본문을 남긴다 (2026-07-10 전수점검 L1)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PaySsam API HTTP ${res.status} ${uri}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// 테스트 모드 확인용
export function isTestMode(): boolean {
  return TEST_MODE
}

// 2.1 청구서 발송
export async function sendBill(params: SendBillParams) {
  if (TEST_MODE) {
    console.log('[PaySsam] 🔒 테스트 모드 — 실제 발송 차단됨:', params.studentName, params.amount)
    return { code: 'TEST', msg: '테스트 모드: 실제 발송되지 않았습니다', bill_id: `TEST-${Date.now().toString(36)}` }
  }

  const billId = generateBillId()
  const hash = generateHash(billId, params.phone, String(params.amount))

  const body = {
    apikey: API_KEY(),
    member: MEMBER(),
    merchant: MERCHANT(),
    bill: {
      bill_issuer: params.billIssuer || ACADEMY_LEGAL_NAME,
      bill_id: billId,
      product_nm: params.productName,
      message: params.message || `${params.studentName} ${params.productName}`,
      member_nm: params.studentName,
      phone: params.phone.replace(/-/g, ''),
      price: String(params.amount),
      hash,
      expire_dt: params.expireDate || getExpireDate(),
      callbackURL: CALLBACK_URL(),
    },
  }

  const result = await callApi('/if/bill/send', body)
  return { ...result, bill_id: billId }
}

// 2.3 결제 취소
export async function cancelBill(billId: string, amount: number) {
  if (TEST_MODE) {
    console.log('[PaySsam] 🔒 테스트 모드 — 결제 취소 차단됨:', billId, amount)
    return { code: '0000', msg: '테스트 모드: 실제 취소되지 않았습니다' }
  }
  const hash = generateHash(billId, String(amount))
  return callApi('/if/bill/cancel', {
    apikey: API_KEY(),
    member: MEMBER(),
    merchant: MERCHANT(),
    bill_id: billId,
    price: String(amount),
    hash,
  })
}

// 2.4 청구서 파기
export async function destroyBill(billId: string, amount: number) {
  if (TEST_MODE) {
    console.log('[PaySsam] 🔒 테스트 모드 — 청구서 파기 차단됨:', billId, amount)
    return { code: '0000', msg: '테스트 모드: 실제 파기되지 않았습니다' }
  }
  const hash = generateHash(billId, String(amount))
  return callApi('/if/bill/destroy', {
    apikey: API_KEY(),
    member: MEMBER(),
    merchant: MERCHANT(),
    bill_id: billId,
    price: String(amount),
    hash,
  })
}

// 2.5 결제 상태 조회
export async function readBill(billId: string) {
  if (TEST_MODE) {
    console.log('[PaySsam] 🔒 테스트 모드 — 상태 조회 차단됨:', billId)
    return { code: 'TEST', msg: '테스트 모드' }
  }
  return callApi('/if/bill/read', {
    apikey: API_KEY(),
    member: MEMBER(),
    merchant: MERCHANT(),
    bill_id: billId,
  })
}

// 2.9 재발송
export async function resendBill(billId: string) {
  if (TEST_MODE) {
    console.log('[PaySsam] 🔒 테스트 모드 — 재발송 차단됨:', billId)
    return { code: 'TEST', msg: '테스트 모드: 실제 재발송되지 않았습니다' }
  }
  return callApi('/if/bill/resend', {
    apikey: API_KEY(),
    member: MEMBER(),
    merchant: MERCHANT(),
    bill_id: billId,
  })
}

// 2.5b PaySsam 실제 청구서 상태 → 우리 DB status 매핑 (drift 동기화용)
//   appr_state 'D' = 파기, 'F'(결제완료) 또는 appr_dt(승인일시) 있으면 결제완료, 그 외는 발송/대기
//   조회 실패/테스트모드는 'unknown' (호출부에서 동기화 스킵)
//   ⚠️ paid 판정을 콜백/크론(appr_state==='F')과 통일 — appr_dt만 보면 상태 F인데 일시 미기재인
//   응답에서 'sent'로 오판 → reissue가 결제완료 청구서를 파기+재발송(이중청구) 위험 (2026-07-10 전수점검 M2)
export async function fetchPaySsamStatus(billId: string): Promise<'destroyed' | 'paid' | 'sent' | 'unknown'> {
  if (TEST_MODE) return 'unknown'
  try {
    const r = (await readBill(billId)) as Record<string, unknown>
    if (!r || typeof r !== 'object') return 'unknown'
    if (r.appr_state === 'D') return 'destroyed'
    const apprDt = typeof r.appr_dt === 'string' ? r.appr_dt.trim() : ''
    if (r.appr_state === 'F' || apprDt) return 'paid'
    return 'sent'
  } catch {
    return 'unknown'
  }
}

// 2.7 쌤포인트 잔액 조회
export async function getRemainPoints() {
  return callApi('/if/read/remain_count', {
    apikey: API_KEY(),
  })
}

function getExpireDate(): string {
  // KST 고정 — 서버 로컬TZ(getFullYear 등)로 만들면 UTC 서버에선 KST보다 하루 이르게 만료 (2026-08-13 라인리뷰)
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() + 30)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
