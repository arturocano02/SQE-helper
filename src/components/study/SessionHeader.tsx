'use client'

import ProgressBar from '@/components/ui/ProgressBar'
import { CloseIcon } from '@/components/ui/Icon'

interface SessionHeaderProps {
  current: number
  total: number
  onExit: () => void
}

export default function SessionHeader({ current, total, onExit }: SessionHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-10 bg-bg/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-secondary hover:text-error transition p-1.5 rounded hover:bg-surface2"
          title="Exit session (Esc)"
        >
          <CloseIcon size={16} />
        </button>
        <ProgressBar current={current} total={total} className="flex-1" />
        <span className="text-xs text-muted tabular-nums whitespace-nowrap">{current} / {total}</span>
      </div>
    </header>
  )
}
