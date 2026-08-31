/**
 * Solapi 알림톡/SMS 발송 — HMAC 인증
 * https://docs.solapi.com/api-reference/overview
 *
 * 사용 흐름:
 *   1. 카카오 심사 통과 후 .env.local의 SOLAPI_TEMPLATE_* 에 templateId 채움
 *   2. sendAlimtalk({ to, templateId, variables }) 호출
 *   3. 실패 시 자동 SMS fallback (옵션) — fallbackText 인자 제공 시
 */
import { createHmac, randomBytes } from 'crypto'
import { ACADEMY_NAME } from '@/lib/branding'

const BASE_URL = 'https://api.solapi.com'

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} 환경변수가 설정되지 않았습니다`)
  return v
}

/** HMAC-SHA256 인증 헤더 (Solapi 규격) */
function authHeader(): string {
  const apiKey = getEnv('SOLAPI_API_KEY')
  const apiSecret = getEnv('SOLAPI_API_SECRET')
  const date = new Date().toISOString()
  const salt = randomBytes(32).toString('hex')
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex')
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

interface AlimtalkMessage {
  /** 수신자 휴대폰 번호 ('-' 없이 또는 있어도 됨) */
  to: string
  /** 카카오 심사 통과한 템플릿 ID */
  templateId: string
  /** 템플릿 변수 #{학생명} → { '학생명': '홍길동' } */
  variables?: Record<string, string>
  /** 알림톡 실패 시 대체 SMS 본문 (없으면 폴백 안 함) */
  fallbackText?: string
}

interface SolapiResponse {
  groupId: string
  messageId?: string
  statusCode?: string
  statusMessage?: string
  [k: string]: unknown
}

/** 단건 알림톡 발송 (실패 시 SMS 폴백 옵션) */
export async function sendAlimtalk(msg: AlimtalkMessage): Promise<SolapiResponse> {
  const from = getEnv('SOLAPI_FROM').replace(/-/g, '')
  const pfId = getEnv('SOLAPI_PFID')
  const to = msg.to.replace(/-/g, '')

  const body: Record<string, unknown> = {
    message: {
      to,
      from,
      kakaoOptions: {
        pfId,
        templateId: msg.templateId,
        ...(msg.variables ? { variables: Object.fromEntries(Object.entries(msg.variables).map(([k, v]) => [`#{${k}}`, v])) } : {}),
      },
      ...(msg.fallbackText ? { type: 'ATA' } : {}), // ATA = 알림톡, 실패 시 SMS는 별도 처리
    },
  }

  const res = await fetch(`${BASE_URL}/messages/v4/send`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Solapi ${res.status}: ${JSON.stringify(data)}`)
  }
  return data as SolapiResponse
}

interface BulkRecipient {
  to: string
  variables?: Record<string, string>
}

/** 일괄 알림톡 발송 (Solapi /messages/v4/send-many) — 최대 100건/요청
 *  ⚠️ 미배선 (2026-08-13 라인리뷰): sendBulkAlimtalk·getBalance·listTemplates는 저장소 내 참조 0건 —
 *  카카오 템플릿 심사 완료 후 배선 예정으로 보류. 배선 없이 지우지 않는 이유는 심사 통과 시 즉시 필요해서. */
export async function sendBulkAlimtalk(
  templateId: string,
  recipients: BulkRecipient[],
): Promise<{ groupId: string; count: number; failed: number }> {
  const from = getEnv('SOLAPI_FROM').replace(/-/g, '')
  const pfId = getEnv('SOLAPI_PFID')
  if (recipients.length === 0) return { groupId: '', count: 0, failed: 0 }
  if (recipients.length > 100) throw new Error('한 번에 최대 100건까지만 발송 가능')

  const messages = recipients.map(r => ({
    to: r.to.replace(/-/g, ''),
    from,
    kakaoOptions: {
      pfId,
      templateId,
      ...(r.variables ? { variables: Object.fromEntries(Object.entries(r.variables).map(([k, v]) => [`#{${k}}`, v])) } : {}),
    },
  }))

  const res = await fetch(`${BASE_URL}/messages/v4/send-many`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Solapi bulk ${res.status}: ${JSON.stringify(data)}`)
  return {
    groupId: data.groupId ?? '',
    count: data.count?.total ?? messages.length,
    failed: data.count?.registeredFailed ?? 0,
  }
}

/** SMS 단건 발송 (알림톡 폴백 또는 단독) */
export async function sendSms(to: string, text: string): Promise<SolapiResponse> {
  const from = getEnv('SOLAPI_FROM').replace(/-/g, '')
  const body = {
    message: {
      to: to.replace(/-/g, ''),
      from,
      text,
    },
  }
  const res = await fetch(`${BASE_URL}/messages/v4/send`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Solapi SMS ${res.status}: ${JSON.stringify(data)}`)
  return data as SolapiResponse
}

interface BulkSmsRecipient {
  to: string
  text: string
}

/**
 * MMS 이미지 업로드 (Solapi /storage/v1/files) → fileId 반환.
 * 솔라피 제약: JPG만, 200KB 이하, 최대 1500×1440. 변환·압축은 호출부(클라이언트 canvas) 책임.
 * @param base64Jpg data URL prefix 없는 순수 base64
 */
export async function uploadMmsImage(base64Jpg: string, name = 'notice.jpg'): Promise<string> {
  const res = await fetch(`${BASE_URL}/storage/v1/files`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: base64Jpg, name, type: 'MMS' }),
  })
  const data = await res.json()
  if (!res.ok || !data.fileId) throw new Error(`Solapi 이미지 업로드 ${res.status}: ${JSON.stringify(data)}`)
  return data.fileId as string
}

/** 일괄 SMS/LMS/MMS 발송 (Solapi /messages/v4/send-many) — imageId 지정 시 MMS, 아니면 본문 길이로 자동 판정. 최대 100건/요청 */
export async function sendBulkSms(
  recipients: BulkSmsRecipient[],
  options?: { imageId?: string; subject?: string },
): Promise<{ groupId: string; count: number; failed: number }> {
  const from = getEnv('SOLAPI_FROM').replace(/-/g, '')
  if (recipients.length === 0) return { groupId: '', count: 0, failed: 0 }
  if (recipients.length > 100) throw new Error('한 번에 최대 100건까지만 발송 가능')

  const messages = recipients.map(r => ({
    to: r.to.replace(/-/g, ''),
    from,
    text: r.text,
    ...(options?.imageId ? { type: 'MMS' as const, imageId: options.imageId, subject: options.subject || ACADEMY_NAME } : {}),
  }))

  const res = await fetch(`${BASE_URL}/messages/v4/send-many`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Solapi bulk SMS ${res.status}: ${JSON.stringify(data)}`)
  return {
    groupId: data.groupId ?? '',
    count: data.count?.total ?? messages.length,
    failed: data.count?.registeredFailed ?? 0,
  }
}

/** 잔여 포인트 조회 — 충전 잔액 확인용 */
export async function getBalance(): Promise<{ balance: number; point: number }> {
  const res = await fetch(`${BASE_URL}/cash/v1/balance`, {
    headers: { Authorization: authHeader() },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Solapi balance ${res.status}: ${JSON.stringify(data)}`)
  return data as { balance: number; point: number }
}

/** 등록된 알림톡 템플릿 목록 (심사 상태 확인용) */
export async function listTemplates(): Promise<unknown> {
  const pfId = getEnv('SOLAPI_PFID')
  const res = await fetch(`${BASE_URL}/kakao/v2/templates?pfId=${pfId}`, {
    headers: { Authorization: authHeader() },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Solapi templates ${res.status}: ${JSON.stringify(data)}`)
  return data
}
