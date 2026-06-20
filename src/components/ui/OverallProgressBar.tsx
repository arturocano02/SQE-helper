/**
 * Overall expertise milestone bar — shown at the top of the Progress page.
 * Maps the user's average mastery score onto the same five tiers used everywhere
 * else in the app (masteryLabel in lib/mastery.ts), so "where am I" reads as one
 * consistent journey rather than a raw percentage.
 */

const TIERS = [
  { label: 'Needs work', from: 0,  to: 30 },
  { label: 'Building',   from: 30, to: 55 },
  { label: 'Developing', from: 55, to: 75 },
  { label: 'Strong',     from: 75, to: 90 },
  { label: 'Mastered',   from: 90, to: 100 },
] as const

function tierColor(score: number): string {
  if (score < 30) return 'var(--status-wrong)'
  if (score < 55) return 'var(--status-warning)'
  if (score < 75) return 'var(--amber-text)'
  if (score < 90) return 'var(--status-correct)'
  return 'var(--status-correct)'
}

export default function OverallProgressBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const color = tierColor(pct)

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 14,
        padding: '20px 22px 18px',
      }}
      className="card-glow"
    >
      <div className="flex items-baseline justify-between mb-4">
        <p className="font-sans text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Overall expertise
        </p>
        <p className="font-serif text-2xl tabular-nums" style={{ color }}>
          {pct}<span className="text-sm" style={{ color: 'var(--text-muted)' }}>/100</span>
        </p>
      </div>

      {/* Track with tier segments */}
      <div style={{ position: 'relative', height: 10, marginBottom: 10 }}>
        <div
          className="flex w-full h-full overflow-hidden"
          style={{ borderRadius: 6, background: 'var(--surface-3)' }}
        >
          {TIERS.map(t => (
            <div
              key={t.label}
              style={{
                width: `${t.to - t.from}%`,
                borderRight: t.to < 100 ? '2px solid var(--surface-base)' : 'none',
                background: pct >= t.from ? color : 'transparent',
                opacity: pct >= t.from ? Math.min(1, 0.45 + (Math.min(pct, t.to) - t.from) / (t.to - t.from) * 0.55) : 0,
                transition: 'all 400ms ease',
              }}
            />
          ))}
        </div>
        {/* Position marker */}
        <div
          style={{
            position: 'absolute',
            top: -3,
            left: `calc(${pct}% - 8px)`,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: color,
            border: '2px solid var(--surface-base)',
            boxShadow: '0 0 0 2px rgba(255,255,255,0.08)',
            transition: 'left 400ms ease',
          }}
        />
      </div>

      {/* Tier labels */}
      <div className="flex w-full">
        {TIERS.map(t => {
          const active = pct >= t.from && pct < t.to || (t.label === 'Mastered' && pct >= 90)
          return (
            <div
              key={t.label}
              style={{ width: `${t.to - t.from}%` }}
              className="text-center"
            >
              <span
                className="font-sans text-[10px]"
                style={{
                  color: active ? color : 'var(--text-muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
