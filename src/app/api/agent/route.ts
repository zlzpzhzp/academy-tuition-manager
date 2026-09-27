import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth'
import { GoogleGenerativeAI, SchemaType, Content, Part, type Tool } from '@google/generative-ai'
import { withGeminiModel } from '@/lib/geminiModel'
import { toolDefinitions, executeTool } from '@/lib/agentTools'
import { getTodayString } from '@/lib/date'

// ── Convert to Gemini SDK format ──

function getGeminiTools(): Tool[] {
  return [{
    functionDeclarations: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: SchemaType.OBJECT as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, val]) => [
            key,
            { type: SchemaType.STRING as const, description: val.description },
          ])
        ),
        required: t.parameters.required || [],
      },
    })),
  }]
}

// ── System prompt ──

const SYSTEM_PROMPT = `당신은 학원 원비관리 시스템의 AI 어시스턴트입니다.
사용자의 질문에 데이터를 조회해서 정확하게 답변하는 것이 당신의 역할입니다.

**⚠️ 최우선 규칙: 조회 전용 - 데이터 변경 절대 금지**
당신은 데이터를 조회하고 질문에 답변하는 것만 할 수 있습니다.
납부 입력, 수정, 삭제 등 데이터를 변경하는 작업은 절대 할 수 없습니다.
사용자가 납부 입력/등록/기록을 요청하면 "납부 입력은 납부 메뉴에서 직접 해주세요."라고 안내하세요.

규칙:
- 오늘 날짜: {current_date}
- 이번달: {current_month}
- 사용자가 "이번달"이라고 하면 {current_month}을 사용
- 반 이름 구조: 과목(수학/영어) > 학년(중1/중2/고1…) > 반(H/A/S/N/K/기하/기하(원장)/기하(류)/확통/미적분/미적·확통)
- 반 이름 매칭: "H반"→class name:"H" (subject 별도 확인), "중1H"→grade:"중1", class:"H"
- 사용자가 과목을 명시하지 않으면 수학을 기본으로 가정
- 질문에 답하기 전에 먼저 list_grades_and_classes로 데이터를 확인해서 정확한 이름을 파악하세요
- 결과를 한국어로 간결하게 요약해서 답변하세요`

// ── Main handler ──

interface ChatMessage {
  role: 'user' | 'model'
  content: string
}

const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 4000

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object') return null
  const messages = (body as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'model') return null
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_MESSAGE_LENGTH) return null
  }
  return messages as ChatMessage[]
}

export async function POST(req: Request) {
  const unauthorized = requireAdminSession(req)
  if (unauthorized) return unauthorized
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    const messages = parseMessages(body)
    if (!messages) {
      return NextResponse.json({ error: '잘못된 요청 형식입니다. 대화가 너무 길어졌다면 새로고침 후 다시 시도해주세요.' }, { status: 400 })
    }

    const currentDate = getTodayString()
    const currentMonth = currentDate.slice(0, 7)

    const genAI = new GoogleGenerativeAI(apiKey)
    const geminiTools = getGeminiTools()
    const buildModel = (modelName: string) => genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT
        .replace(/{current_date}/g, currentDate)
        .replace(/{current_month}/g, currentMonth),
      tools: geminiTools,
    }, {
      // 서버 US IP 지역차단 대응 — 로컬 Vertex 프록시 경유 (2026-07-10).
      // .env.local에만 설정(GEMINI_BASE_URL=http://127.0.0.1:<프록시 포트>), Vercel(icn1)은 미설정=직행.
      ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
    })

    // 모델 폴백(2026-09-12 2.5 종료 대응) — 툴 루프 전체를 한 번에 감싼다.
    // 모델 사용 불가는 첫 호출에서 나므로 재시도는 처음부터 깨끗하게 다시 돈다.
    // 에이전트 툴은 **조회 전용**(agentTools 에 쓰기 없음 + 시스템 프롬프트가 변경 금지)이라 재실행이 안전하다.
    return await withGeminiModel(async (modelName) => {
    const model = buildModel(modelName)

    // Convert to Gemini Content format
    const contents: Content[] = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }))

    // Tool calling loop (max 8 iterations)
    const toolResults: { tool: string; input: Record<string, string>; result: unknown }[] = []
    let iterations = 0

    while (iterations < 8) {
      iterations++

      const result = await model.generateContent({ contents })
      const response = result.response
      const parts = response.candidates?.[0]?.content?.parts || []

      const functionCalls = parts.filter((p: Part) => p.functionCall)

      if (functionCalls.length === 0) {
        // Final text response
        const text = parts.map((p: Part) => p.text || '').join('')
        return NextResponse.json({
          reply: text,
          actions: toolResults,
        })
      }

      // Add model's response to history
      contents.push({ role: 'model', parts })

      // Execute each function call
      const functionResponses: Part[] = []
      for (const part of functionCalls) {
        const fc = part.functionCall!
        const toolResult = await executeTool(fc.name, fc.args as Record<string, string>)
        toolResults.push({ tool: fc.name, input: fc.args as Record<string, string>, result: toolResult })
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { result: toolResult },
          },
        })
      }

      // Add function responses to history
      contents.push({ role: 'user', parts: functionResponses })
    }

    // 툴 루프 소진 — 정상 답변으로 위장하지 않고 error로 표면화 + 로그 (2026-08-13 라인리뷰)
    console.error('[agent] 툴 루프 8회 소진, 답변 미완성:', JSON.stringify(toolResults.map(t => t.tool)))
    return NextResponse.json({
      error: '조회가 8회를 초과해 답변을 완성하지 못했습니다. 질문을 더 좁혀서 다시 시도해주세요.',
      actions: toolResults,
    })
    })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('Agent error:', errMsg)
    return NextResponse.json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
}
