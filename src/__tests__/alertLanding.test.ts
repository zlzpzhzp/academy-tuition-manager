import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 트립와이어: **사람에게 무언가를 보내는 경로가 새로 생기면 착지점을 의식적으로 정하게 한다.**
 *
 * 이 검사는 파일 **이름**이나 **위치**로 발송처를 세지 않는다 — 그렇게 세면 반드시 놓친다.
 * (실제로 그랬다: 이름으로 세면 래퍼 스크립트가 진짜 발신자를 가리고, 위치로 세면
 *  `scripts/` 밖의 발신자가 통째로 빠진다.) 그래서 **호출하는 엔드포인트**로 센다.
 * 목록에 없는 발송처가 생기면 여기서 깨진다 — 그때 **착지점이 누구인지 정하고** 아래에 등록해라.
 *
 * 🔴 등록할 때 반드시 같이 판단할 것: **착지점이 학부모면 실경로 고장주입 금지**다.
 *    가짜 알림이 실제 학부모에게 간다(등원 알림톡은 학생 수만큼 매일 나가는 경로다).
 *    검증이 불가능하면 "미검증(실경로 미주입)"으로 남기는 게 정상이다 —
 *    억지로 검증해 오탐을 보내는 것보다 낫다.
 *
 * 🔴 **가장 무거운 착지점은 알림이 아니다.** 이 앱에서는 **청구서 발송·취소·파기**다 —
 *    돈이 움직이고 학부모가 실제로 결제할 수 있다. 알림 채널로만 세면 그게 통째로 빠진다.
 *    채널이 아니라 **"되돌릴 수 있나"** 로 센다.
 */
const CHANNELS: Record<string, RegExp> = {
  청구_결제: /erp-api\.payssam|sendBill|destroyBill|cancelBill|resendBill/,
  텔레그램: /api\.telegram\.org/,
  문자_알림톡: /api\.solapi\.com|sendAlimtalk|sendSms/,
  웹푸시: /web-push|VAPID|pushSubscription/,
  메일: /nodemailer|sendgrid|mailgun/,
  슬랙_디스코드: /hooks\.slack\.com|discord\.com\/api\/webhooks/,
}

/** 알려진 발송처 — 값은 **착지점**(누구에게 닿고 되돌릴 수 있나) */
/** 알려진 발송처 — 값은 **착지점**(누구에게 닿고 되돌릴 수 있나) */
const KNOWN: Record<string, '학부모' | '운영자' | '학부모(돈)'> = {
  // 🔴🔴 학부모 + 돈 — 되돌릴 수 없다. 실호출 절대 금지(가짜 청구서가 실제로 발송된다)
  'src/lib/payssam.ts': '학부모(돈)',
  'src/lib/deferredDestroy.ts': '학부모(돈)',
  'src/app/api/payssam/send/route.ts': '학부모(돈)',
  'src/app/api/payssam/resend/route.ts': '학부모(돈)',
  'src/app/api/payssam/reissue/route.ts': '학부모(돈)',
  'src/app/api/payssam/split-send/route.ts': '학부모(돈)',
  'src/app/api/payssam/cancel/route.ts': '학부모(돈)',
  'src/app/api/payssam/destroy/route.ts': '학부모(돈)',
  'src/app/api/payssam/resettle/route.ts': '학부모(돈)',
  'src/app/api/cron/send-queued/route.ts': '학부모(돈)',
  'src/app/api/cron/resend/route.ts': '학부모(돈)',
  // 🔴 학부모 — 실경로 주입 절대 금지
  'src/lib/solapi.ts': '학부모',
  'src/app/api/attendance/check-in/route.ts': '학부모',
  'src/app/api/sms/send-overdue/route.ts': '학부모',
  'src/app/api/payssam/callback/route.ts': '학부모',
  'src/app/api/notice/send/route.ts': '학부모',
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.next-')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js|py|sh)$/.test(name)) out.push(full)
  }
  return out
}

function findSenders(): Map<string, string[]> {
  const root = process.cwd()
  const hits = new Map<string, string[]>()
  for (const file of walk(join(root, 'src'))) {
    const body = readFileSync(file, 'utf-8')
    const channels = Object.entries(CHANNELS)
      .filter(([, re]) => re.test(body))
      .map(([name]) => name)
    if (channels.length) hits.set(file.slice(root.length + 1), channels)
  }
  return hits
}

describe('알림 착지점', () => {
  it('검사가 도는지 먼저 — 알려진 발송처를 실제로 찾아낸다', () => {
    // 0건이면 스캔이 깨진 것이지 "발송처 없음"이 아니다(2026-08-03: 0의 이유를 대라)
    expect(findSenders().size).toBeGreaterThan(0)
  })

  it('등록되지 않은 발송처가 없다 — 새로 생기면 착지점을 정해서 등록해라', () => {
    const unknown = [...findSenders().entries()]
      .filter(([f]) => !(f in KNOWN))
      .map(([f, ch]) => `${f} [${ch.join(',')}]`)
    expect(
      unknown,
      `등록되지 않은 알림 발송처:\n  ${unknown.join('\n  ')}\n` +
        `→ 이 테스트의 KNOWN 에 **착지점**(학부모/운영자)과 함께 등록해라.\n` +
        `  🔴 착지점이 학부모면 실경로 고장주입 금지 — 가짜 알림이 실제로 간다.`,
    ).toEqual([])
  })
})
