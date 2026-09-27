'use client'

import { useSyncExternalStore } from 'react'
import { TButton } from '@/components/motion'
import { installPaperScheme, normalizePaperPreference, PAPER_COLORS, type PaperPreference } from '@/lib/paperScheme'

const controller = () => installPaperScheme(PAPER_COLORS, normalizePaperPreference)
const subscribe = (listener: () => void) => controller().subscribe(listener)
const snapshot = () => controller().preference
const schemeSnapshot = () => controller().scheme
export function usePaperScheme() {
  return useSyncExternalStore(subscribe, schemeSnapshot, () => 'light' as const)
}
const serverSnapshot = (): PaperPreference => 'auto'

export default function PaperSchemeControl() {
  const preference = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return (
    <div className="card p-4 mb-6" role="group" aria-label="화면 톤">
      <p className="text-sm font-semibold mb-2">화면 톤</p>
      <div className="flex gap-1">
        {([['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']] as const).map(([value, label]) => (
          <TButton key={value} type="button" aria-pressed={preference === value}
            onClick={() => controller().set(value)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold ${preference === value ? 'bg-[var(--blue)] text-[var(--on-action)]' : 'bg-[var(--bg-elevated)] text-[var(--text-3)]'}`}>
            {label}
          </TButton>
        ))}
      </div>
    </div>
  )
}
