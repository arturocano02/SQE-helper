interface ProgressBarProps {
  current: number
  total: number
  className?: string
}

export default function ProgressBar({ current, total, className = '' }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-secondary tabular-nums whitespace-nowrap">
        {current} / {total}
      </span>
    </div>
  )
}
