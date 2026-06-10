interface ProgressBarProps {
  current: number
  total: number
  className?: string
  hideCount?: boolean
}

export default function ProgressBar({ current, total, className = '', hideCount = false }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 6, background: 'var(--surface-3)' }}
      >
        <div
          className="h-full rounded-full progress-fill transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {!hideCount && (
        <span
          className="font-mono text-[12px] tabular-nums whitespace-nowrap shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          {current}&thinsp;/&thinsp;{total}
        </span>
      )}
    </div>
  )
}
