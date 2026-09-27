import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { withGeminiModel } from '@/lib/geminiModel'
import { getTodayString } from '@/lib/date'

const SYSTEM_PROMPT = `당신은 학원 원비관리 시스템의 필터 엔진입니다.
학생 데이터 목록과 사용자의 한국어 필터 요청을 받아서, 조건에 맞는 학생만 골라냅니다.

반드시 아래 JSON 형식만 반환하세요 (다른 텍스트 없이):
{
  "student_ids": ["id1", "id2"],
  "description": "짧은 필터 설명"
}

학생 데이터 필드 설명 (공통):
- id: 고유 ID
- name: 이름
- grade: 학년 (예: "중1", "중2")
- class_name: 반 이름 (예: "H", "A", "기하", "미적/확통") — ⚠️ 같은 반 이름이 수학/영어 양쪽에 존재할 수 있음. "수학H"처럼 과목이 붙은 요청은 class_name+subject 둘 다로 판단
- subject: 과목 ("수학" 또는 "영어")
- fee: 월 원비 (원 단위)
- due_day: 결제일 (매월 몇일)

납부 페이지 전용 필드:
- paid: 이번달 납부 금액
- status: "paid"(납부완료) | "partial"(부분납부) | "unpaid"(미납)
- payment_method: "payssam"(결제선생) | "card"(카드) | "transfer"(이체) | "cash"(현금) | "other"(기타) | null
- payment_date: 이번달 실제 납부일 (YYYY-MM-DD) 또는 null
- current_memo: 이번달 특이사항/비고 (문자열 또는 null)
- prev_memo: 지난달 특이사항/비고 (문자열 또는 null)
- prev_payment_method: 지난달 결제 수단 (payment_method와 동일 enum) 또는 null
- prev_payment_date: 지난달 실제 납부일 (YYYY-MM-DD) 또는 null
- prev_days_late: 지난달 due_day 대비 납부 지연일수 (음수면 조기결제, 양수면 지연, null이면 미납 또는 due_day 없음)
- is_amount_modified: 학생별 수강료가 반 기본 원비와 달라 수정된 경우 true, 기본값이면 false
- electives: 선택과목 배열 (예: ["기하", "확통"]). 비어있으면 [] — 선택과목 미수강
- phone_available: 연락처(학부모 또는 본인) 등록 여부 (true/false)

결제선생(청구서) 페이지 전용 필드:
- status: "paid"(결제완료) | "sent"(발송됨/미결제) | "cancelled"(취소/파기) | "unsent"(미발송)
- bill_amount: 청구 금액
- paid_amount: 실제 결제 금액
- sent_at: 청구서 발송 ISO 타임스탬프 또는 null
- paid_at: 결제 완료 ISO 타임스탬프 또는 null
- days_since_sent: 발송 후 경과일 (숫자 또는 null)
- phone_available: 연락처 등록 여부 (true/false)

규칙:
- 조건에 맞는 모든 학생 ID를 포함
- "결제일"은 due_day 필드
- "미납" = status="unpaid" (납부페이지) 또는 status="sent"(발송됐는데 아직 결제 안 됨, 결제선생)
- "미발송" = status="unsent" (결제선생)
- "결제완료/납부완료" = status="paid"
- "연락처 없음/폰없음" = phone_available=false (결제선생)
- "N일 이상 미결제" = status="sent" AND days_since_sent>=N (결제선생)
- "특이사항/비고 작성" = current_memo 또는 prev_memo가 null이 아님 (납부페이지)
- "금액 수정 학생" = is_amount_modified=true (납부페이지)
- "지난달 결제 N일이상 늦은 학생" = prev_days_late>=N (납부페이지)
- "지난달 카드결제 학생" = prev_payment_method="card" (납부페이지)
- "선택과목 듣는 학생" = electives 배열이 비어있지 않음 (납부페이지)
- "기하 듣는 학생" = electives에 "기하" 포함 (납부페이지)
- "연락처 없는 학생/폰 없는 학생" = phone_available=false
- description은 한국어로 15자 이내
- 오늘 날짜: {current_date}
- 조회 중인 월: {billing_month}`

export async function POST(req: Request) {
  const unauthorized = requireAdminSession(req)
  if (unauthorized) return unauthorized
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
    }

    const { query, context } = await req.json()

    // Input validation
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: '필터 요청을 입력해주세요.' }, { status: 400 })
    }
    if (query.length > 200) {
      return NextResponse.json({ error: '필터 요청은 200자 이내여야 합니다.' }, { status: 400 })
    }

    const currentDate = getTodayString()

    const genAI = new GoogleGenerativeAI(apiKey)
    const buildModel = (modelName: string) => genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT
        .replace(/{current_date}/g, currentDate)
        .replace(/{billing_month}/g, context.billing_month || currentDate.slice(0, 7)),
    }, {
      // 서버 US IP 지역차단 대응 — 로컬 Vertex 프록시 경유 (2026-07-10). agent/route.ts와 동일.
      ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
    })

    const prompt = `학생 데이터:\n${JSON.stringify(context.students, null, 2)}\n\n필터 요청: ${query}`

    // 조회 전용이라 모델 폴백 재시도가 안전하다 (2026-09-12 2.5 종료 대응)
    const result = await withGeminiModel(m => buildModel(m).generateContent(prompt))
    const text = result.response.text()

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        console.error('Filter JSON parse error:', jsonMatch[0])
        return NextResponse.json({ student_ids: [], description: 'AI 응답 파싱 실패' })
      }

      // Validate returned IDs exist in input context
      const validIds = new Set((context.students || []).map((s: { id: string }) => s.id))
      const filteredIds = ((parsed.student_ids as string[]) || []).filter((id: string) => validIds.has(id))

      return NextResponse.json({
        student_ids: filteredIds,
        description: typeof parsed.description === 'string' ? parsed.description.slice(0, 30) : '필터 적용',
      })
    }

    return NextResponse.json({ student_ids: [], description: '필터 결과 없음' })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('Filter error:', errMsg)
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
