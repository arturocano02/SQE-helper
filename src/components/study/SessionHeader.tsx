'use client'

import ProgressBar from '@/components/ui/ProgressBar'

interface SessionHeaderProps {
  current: number
  total: number
  onExit: () => void
  label?: string
  rightExtra?: React.ReactNode
}

export default function SessionHeader({ current, total, onExit, label, rightExtra }: SessionHeaderProps) {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-10 backdrop-blur-sm"
      style={{
        background: 'rgba(10,10,8,0.92)',
        borderBottom: '1px solid var(--surface-border)',
      }}
    >
      <div className="max-w-2xl mx-auto px-5 py-3 flex items-center gap-4">
        {/* Exit button */}
        <button
          onClick={onExit}
          title="Exit session (Esc)"
          style={{
            color: 'var(--text-muted)',
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid transparent',
            background: 'transparent',
            transition: 'all 150ms ease',
            lineHeight: 1,
            fontSize: 13,
            fontFamily: 'var(--font-dm-sans)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
          className="hover:text-error hover:border-error/30 hover:bg-error/8 shrink-0"
        >
          ✕{label ? ` ${label}` : ' Exit'}
        </button>

        <ProgressBar current={current} total={total} className="flex-1" hideCount />

        {/* Right side: timer or counter */}
        <div className="flex items-center gap-3 shrink-0">
          {rightExtra}
          <span
            className="font-mono text-[12px] tabular-nums whitespace-nowrap"
            style={{ color: 'var(--text-muted)' }}
          >
            Q{current + 1}&thinsp;of&thinsp;{total}
          </span>
        </div>
      </div>
    </header>
  )
}
