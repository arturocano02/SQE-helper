'use client'

/**
 * Dependency-free SVG line+area chart for arbitrary (non-percentage) values — daily
 * active users, answers per day, etc. Same hand-built approach as ScoreTrendChart,
 * but auto-scales the y-axis to the data's own max instead of assuming a 0-100 range.
 */
export default function ActivityChart({
  points,
  color = 'var(--amber)',
  emptyLabel = 'No activity yet.',
}: {
  points: { label: string; value: number }[]
  color?: string
  emptyLabel?: string
}) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height: 140, color: 'var(--text-muted)' }}>
        <p className="font-sans text-xs">{emptyLabel}</p>
      </div>
    )
  }

  const width = 600
  const height = 140
  const padX = 8
  const padTop = 12
  const padBottom = 22

  const n = points.length
  const maxVal = Math.max(1, ...points.map(p => p.value))
  const xStep = (width - padX * 2) / (n - 1)
  const yFor = (v: number) => padTop + (1 - v / maxVal) * (height - padTop - padBottom)
  const xFor = (i: number) => padX + i * xStep

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.value)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(n - 1)} ${height - padBottom} L ${xFor(0)} ${height - padBottom} Z`

  const gradId = `activity-fill-${color.replace(/[^a-zA-Z0-9]/g, '')}`
  const labelEvery = Math.max(1, Math.ceil(n / 6))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      {[0, 0.5, 1].map(g => (
        <line
          key={g}
          x1={padX} x2={width - padX}
          y1={padTop + g * (height - padTop - padBottom)}
          y2={padTop + g * (height - padTop - padBottom)}
          stroke="var(--surface-border)" strokeWidth={1}
        />
      ))}

      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.20} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, i) => (
        <circle key={i} cx={xFor(i)} cy={yFor(p.value)} r={2.5} fill={color} />
      ))}

      {points.map((p, i) => (
        (i % labelEvery === 0 || i === n - 1) ? (
          <text
            key={`label-${i}`}
            x={xFor(i)} y={height - 6}
            textAnchor="middle" fontSize="9"
            fill="var(--text-muted)" fontFamily="var(--font-dm-sans)"
          >
            {p.label}
          </text>
        ) : null
      ))}
    </svg>
  )
}
