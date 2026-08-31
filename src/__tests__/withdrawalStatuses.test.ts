/**
 * 퇴원 처리상태 상수 단일 정본 (2026-08-16 라인리뷰)
 *
 * attendance 페이지가 서버(api/withdrawal-status)의 TERMINAL_STATUSES 사본을 들고 있어,
 * 서버에 상태가 추가되면 화면만 옛 기준으로 갈라졌다. 값·의미 변화 0으로 모듈 추출.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TERMINAL_STATUSES, IN_PROGRESS_STATUSES } from '@/lib/withdrawalStatuses'

describe('퇴원 처리상태 상수', () => {
  it('종결/진행중 값이 추출 전과 동일하다', () => {
    expect([...TERMINAL_STATUSES]).toEqual(['resettled_paid', 'refund_done', 'settle'])
    expect([...IN_PROGRESS_STATUSES]).toEqual(['resettle_pending', 'resettle_scheduled'])
  })

  it('두 집합은 겹치지 않는다', () => {
    const overlap = TERMINAL_STATUSES.filter(s => (IN_PROGRESS_STATUSES as readonly string[]).includes(s))
    expect(overlap).toEqual([])
  })

  it('라우트와 화면이 사본을 다시 만들지 않고 이 모듈을 import 한다', () => {
    for (const f of ['src/app/api/withdrawal-status/route.ts', 'src/app/attendance/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain("@/lib/withdrawalStatuses")
      expect(src).not.toContain("'resettled_paid'") // 하드코딩 사본 부활 방지
    }
  })

  it('payments 페이지도 종결 판정은 이 모듈로 한다 (상태별 아이콘·문구 매핑 리터럴은 허용)', () => {
    // 2026-08-23 라인리뷰: isProcessCompleted 가 종결 3종을 하드코딩해, 상수에 상태가 추가되면
    // 이월 미납 분류만 옛 기준으로 갈라졌다(위 검사 대상에서 빠져 있어 거짓 green).
    // 개별 상태의 아이콘/타이틀 매핑(ws === 'refund_done' ? ...)은 집합 사본이 아니라 남겨둔다 —
    // 금지 대상은 '종결 집합 멤버십'을 리터럴 나열로 다시 만드는 것.
    const src = readFileSync('src/app/payments/page.tsx', 'utf8')
    expect(src).toContain("@/lib/withdrawalStatuses")
    expect(src).toContain('TERMINAL_STATUSES')
    expect(src).not.toMatch(/ws === '\w+'\s*\|\|\s*ws === '\w+'\s*\|\|\s*ws === '\w+'/) // 종결 집합 리터럴 나열 부활 방지
  })
})
