'use client'

/**
 * Dependency-free SVG line chart of session scores over time. Seeing the line trend
 * upward session over session is the motivating bit — no charting library needed for
 * a single line with a handful of points, so this stays consistent with the project's
 * "no component library, hand-build small UI pieces" approach.
 */
export default function ScoreTrendChart({
  points,
}: {
  points: { date: string; pct: number }[]
}) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: 160, color: 'var(--text-muted)' }}
      >
        <p className="font-sans text-xs">Complete a few more sessions to see your trend.</p>
      </div>
    )
  }

  const width = 600
  const height = 160
  const padX = 8
  const padTop = 14
  const padBottom = 26

  const n = points.length
  const xStep = (width - padX * 2) / (n - 1)
  const yFor = (pct: number) => padTop + (1 - pct / 100) * (height - padTop - padBottom)
  const xFor = (i: number) => padX + i * xStep

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.pct)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(n - 1)} ${height - padBottom} L ${xFor(0)} ${height - padBottom} Z`

  const first = points[0].pct
  const last = points[n - 1].pct
  const trendUp = last >= first
  const lineColor = trendUp ? 'var(--status-correct)' : 'var(--status-warning)'

  // Show a sparse set of date labels so they don't overlap on mobile.
  const labelEvery = Math.max(1, Math.ceil(n / 5))

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {/* Gridlines at 0/50/100 */}
        {[0, 50, 100].map(g => (
          <line
            key={g}
            x1={padX}
            x2={width - padX}
            y1={yFor(g)}
            y2={yFor(g)}
            stroke="var(--surface-border)"
            strokeWidth={1}
          />
        ))}

        {/* Area fill under the line */}
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trend-fill)" stroke="none" />

        {/* Line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Points */}
        {points.map((p, i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(p.pct)} r={3} fill={lineColor} />
        ))}

        {/* Date labels */}
        {points.map((p, i) => (
          (i % labelEvery === 0 || i === n - 1) ? (
            <text
              key={`label-${i}`}
              x={xFor(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize="9"
              fill="var(--text-muted)"
              fontFamily="var(--font-dm-sans)"
            >
              {p.date}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  )
}
