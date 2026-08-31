/**
 * 학원 브랜딩 설정 — 이 앱을 자기 학원에 맞게 쓰기 위한 단일 진입점.
 *
 * 원래 이 값들은 코드 곳곳에 하드코딩돼 있었다. OSS 공개판에서는 전부 환경변수로 뺐다.
 * 값을 바꾸려면 `.env.local`(또는 배포 플랫폼 환경변수)만 고치면 된다 — 코드는 안 건드린다.
 *
 * ⚠️ `NEXT_PUBLIC_` 접두사가 붙은 것들은 **브라우저 번들에 그대로 실린다.**
 *    학원 이름·대표번호·홈페이지처럼 어차피 학부모에게 보이는 값만 여기 둔다.
 *    비밀값(API 키·시크릿)은 절대 `NEXT_PUBLIC_` 으로 만들지 마라.
 */

/** 화면·문자·청구서에 표시되는 학원 이름. 예: "우리학원" */
export const ACADEMY_NAME = process.env.NEXT_PUBLIC_ACADEMY_NAME || '우리학원'

/** 짧은 표기(키오스크 헤더·PWA short_name 등). 미설정 시 ACADEMY_NAME 을 그대로 쓴다. */
export const ACADEMY_SHORT_NAME = process.env.NEXT_PUBLIC_ACADEMY_SHORT_NAME || ACADEMY_NAME

/** 키오스크 하단 한 줄 슬로건. 비워두면 그 줄이 통째로 빠진다. */
export const ACADEMY_TAGLINE = process.env.NEXT_PUBLIC_ACADEMY_TAGLINE || ''

/** 청구서 발행 주체(사업자명). 결제 대행사 청구서에 표기된다. */
export const ACADEMY_LEGAL_NAME = process.env.ACADEMY_LEGAL_NAME || ACADEMY_NAME

/** 학부모 문의용 대표번호. 청구 메시지 하단에 들어간다. */
export const ACADEMY_PHONE = process.env.NEXT_PUBLIC_ACADEMY_PHONE || ''

/** 학원 홈페이지 URL. 청구 메시지 하단에 들어간다. */
export const ACADEMY_HOMEPAGE = process.env.NEXT_PUBLIC_ACADEMY_HOMEPAGE || ''

/**
 * 문자 발신번호(표시용).
 * 실제 발신은 문자 대행사에 등록된 번호로 나간다 — 여기 값은 UI 안내 문구에만 쓴다.
 */
export const SMS_SENDER_NUMBER = process.env.NEXT_PUBLIC_SMS_SENDER_NUMBER || ''

/**
 * 문자·알림톡 본문 앞에 자동으로 붙는 발신처 표기.
 * 광고성이 아닌 정보성 문자라도 발신처를 밝히는 편이 학부모 혼선을 줄인다.
 */
export const MESSAGE_PREFIX = `[${ACADEMY_NAME}] `

/**
 * 결제 대행사 청구서 ID 접두사(영문 대문자 2~4자 권장).
 * 결제 대행사 콘솔에서 우리 청구서를 눈으로 구분하는 용도 — 학원마다 다르게 두는 게 좋다.
 */
export const BILL_ID_PREFIX = (process.env.PAYSSAM_BILL_PREFIX || 'TM').toUpperCase()
