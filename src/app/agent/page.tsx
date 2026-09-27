'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Loader2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'

interface ActionResult {
  tool: string
  input: Record<string, unknown>
  result: unknown
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: ActionResult[]
  error?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  list_grades_and_classes: '📋 학년/반 조회',
  get_unpaid_students: '🔍 미납 조회',
  get_payment_status: '📊 납부 현황',
}

const EXAMPLES = [
  '이번달 미납 학생 알려줘',
  '고1 납부현황 보여줘',
  '중1 H반 학생 누구야?',
  '3월 전체 납부율 어때?',
]

// ⚠️ 이 페이지는 Navbar에서 의도적으로 제거됨(Students와 함께) — 진입은 URL 직접 입력(/agent)뿐.
// 링크 0은 dead code가 아니라 의도다. 되살리지 말 것 (CLAUDE.md 프로젝트 규칙, 2026-08-13 주석 명시).
export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedActions, setExpandedActions] = useState<Set<number>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const toggleAction = (idx: number) => {
    setExpandedActions(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const sendMessage = async (text?: string) => {
    const msg = text ?? input.trim()
    if (!msg || loading) return

    const userMessage: Message = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      // Build conversation history for Gemini (role: 'user' | 'model')
      const history = [...messages, userMessage].map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        content: m.content,
      }))

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })

      const data = await res.json()

      if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.error,
          error: true,
        }])
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.reply,
          actions: data.actions,
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '네트워크 오류가 발생했습니다. 다시 시도해주세요.',
        error: true,
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      <h1 className="text-xl font-bold mb-4">AI 어시스턴트</h1>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="w-12 h-12 text-[var(--text-4)] mx-auto mb-3" />
            <p className="text-[var(--text-3)] text-sm mb-6">자연어로 원비관리 작업을 처리할 수 있어요</p>
            <div className="space-y-2 max-w-sm mx-auto">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(ex)}
                  className="w-full text-left px-4 py-2.5 bg-[var(--bg-card)] rounded-xl border text-sm text-[var(--text-2)] hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-[var(--blue)] flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-[var(--on-action)]" />
              </div>
            )}
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-first' : ''}`}>
              <div data-paper-card=""
                className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[var(--blue)] text-[var(--on-action)] rounded-br-md'
                    : msg.error
                    ? 'bg-[var(--unpaid-bg)] text-[var(--unpaid-text)] border border-[var(--red-dim)] rounded-bl-md'
                    : 'bg-[var(--bg-card)] border border-[var(--border)] rounded-bl-md'
                }`}
              >
                {msg.error && <AlertCircle className="w-4 h-4 inline mr-1" />}
                {msg.content}
              </div>

              {/* Action details */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {msg.actions.map((action, j) => (
                    <div key={j} className="bg-[var(--bg-card-hover)] rounded-lg border text-xs overflow-hidden">
                      <button
                        onClick={() => toggleAction(i * 100 + j)}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-[var(--bg-elevated)] text-[var(--text-3)]"
                      >
                        {expandedActions.has(i * 100 + j)
                          ? <ChevronDown className="w-3 h-3" />
                          : <ChevronRight className="w-3 h-3" />
                        }
                        <span>{TOOL_LABELS[action.tool] ?? action.tool}</span>
                      </button>
                      {expandedActions.has(i * 100 + j) && (
                        <div className="px-3 py-2 border-t bg-[var(--bg-card)] text-[var(--text-2)] max-h-48 overflow-y-auto">
                          <pre className="whitespace-pre-wrap break-all">
                            {JSON.stringify(action.result, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0 mt-1">
                <User className="w-4 h-4 text-[var(--text-2)]" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--blue)] flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-[var(--on-action)]" />
            </div>
            <div data-paper-card="" className="px-4 py-2.5 bg-[var(--bg-card)] border rounded-2xl rounded-bl-md">
              <Loader2 className="w-4 h-4 text-[var(--text-3)] animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && sendMessage()}
          placeholder="명령을 입력하세요..."
          disabled={loading}
          className="flex-1 min-w-0 px-4 py-3 bg-[var(--bg-card)] border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)] disabled:opacity-50"
          autoFocus
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-4 py-3 bg-[var(--blue)] text-[var(--on-action)] rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
