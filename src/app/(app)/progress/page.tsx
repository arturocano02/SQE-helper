import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery } from '@/types/database'
import MasteryBar from '@/components/ui/MasteryBar'
import Badge from '@/components/ui/Badge'
import { masteryLabel, masteryGateMessage } from '@/lib/mastery'
import OverallProgressBar from '@/components/ui/OverallProgressBar'
import ScoreTrendChart from '@/components/ui/ScoreTrendChart'

function getMasteryColor(score: number): string {
  if (score >= 70) return 'var(--status-correct)'
  if (score >= 40) return 'var(--status-warning)'
  return 'var(--status-wrong)'
}

function getMasteryBg(score: number): string {
  if (score >= 70) return 'rgba(76,175,130,0.08)'
  if (score >= 40) return 'rgba(200,146,42,0.08)'
  return 'rgba(224,90,90,0.08)'
}

export default async function ProgressPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: topics }, { data: mastery }, { data: sessions }, { data: trendSessions }] = await Promise.all([
    supabase.from('topics').select('*').order('sort_order'),
    supabase.from('user_topic_mastery').select('*').eq('user_id', user.id),
    supabase
      .from('sessions')
      .select('id, mode, correct_count, total_questions, started_at, is_complete')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .order('started_at', { ascending: false })
      .limit(10),
    // Separate ascending fetch — oldest first — so the trend chart reads left-to-right
    // as "earlier" to "now", which is what makes an upward line feel motivating.
    supabase
      .from('sessions')
      .select('correct_count, total_questions, started_at, is_complete')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .order('started_at', { ascending: true })
      .limit(30),
  ])

  const masteryMap = new Map(((mastery ?? []) as UserTopicMastery[]).map(m => [m.topic_id, m]))
  const topicsWithMastery = ((topics ?? []) as Topic[])
    .map(t => ({ ...t, mastery: masteryMap.get(t.id) }))
    .sort((a, b) => (a.mastery?.mastery_score ?? 0) - (b.mastery?.mastery_score ?? 0))

  const totalSessions = sessions?.length ?? 0
  const avgScore = sessions?.length
    ? Math.round(
        sessions.reduce((sum, s) => {
          const pct = s.total_questions > 0 ? (s.correct_count / s.total_questions) * 100 : 0
          return sum + pct
        }, 0) / sessions.length
      )
    : 0

  const topicsAt70 = topicsWithMastery.filter(t => (t.mastery?.mastery_score ?? 0) >= 70).length

  // Overall expertise = average mastery across topics the user has actually engaged with.
  // Falls back to the average session score if no topic has a mastery row yet (brand new user).
  const engagedTopics = topicsWithMastery.filter(t => t.mastery)
  const overallScore = engagedTopics.length
    ? Math.round(engagedTopics.reduce((sum, t) => sum + (t.mastery?.mastery_score ?? 0), 0) / engagedTopics.length)
    : avgScore

  const trendPoints = (trendSessions ?? []).map(s => ({
    date: new Date(s.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    pct: s.total_questions > 0 ? Math.round((s.correct_count / s.total_questions) * 100) : 0,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div
          className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between"
        >
          <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
            Your Progress
          </h1>
          <Link
            href="/home"
            className="font-sans text-sm transition"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-10">
        {/* Overall expertise milestone bar */}
        <OverallProgressBar score={overallScore} />

        {/* Summary stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Sessions" value={totalSessions} />
          <StatCard label="Avg score" value={`${avgScore}%`} accent />
          <StatCard label="Topics ≥70%" value={topicsAt70} />
        </div>

        {/* Score trend */}
        {trendPoints.length > 0 && (
          <section>
            <h2
              className="font-serif mb-5"
              style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}
            >
              Score Trend
            </h2>
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 12,
                padding: '20px 16px 12px',
              }}
              className="card-glow"
            >
              <ScoreTrendChart points={trendPoints} />
            </div>
          </section>
        )}

        {/* Mastery by topic */}
        <section>
          <h2
            className="font-serif mb-5"
            style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}
          >
            Mastery by Topic
          </h2>
          <div className="space-y-3">
            {topicsWithMastery.map(topic => {
              const score = topic.mastery?.mastery_score ?? 0
              const hasMastery = !!topic.mastery
              const gate = topic.mastery ? masteryGateMessage(topic.mastery) : null
              const easyTotal = topic.mastery?.easy_total ?? 0
              const medTotal = topic.mastery?.medium_total ?? 0
              const hardTotal = topic.mastery?.hard_total ?? 0
              return (
                <Link
                  key={topic.id}
                  href={`/topics/${topic.slug}`}
                  className="card-glow card-glow-hover flex flex-col gap-3"
                  style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    background: hasMastery ? getMasteryBg(score) : 'var(--surface-1)',
                    borderLeft: `3px solid ${hasMastery ? getMasteryColor(score) : 'var(--status-neutral)'}`,
                    borderTop: '1px solid var(--surface-border)',
                    borderRight: '1px solid var(--surface-border)',
                    borderBottom: '1px solid var(--surface-border)',
                    transition: 'all 150ms ease',
                  }}
                >
                  {/* Top row: name + badge + score */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className="text-sm font-sans truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {topic.name}
                      </p>
                      <Badge variant={topic.paper} className="mt-1">{topic.paper}</Badge>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-serif text-lg tabular-nums leading-none"
                        style={{ color: hasMastery ? getMasteryColor(score) : 'var(--text-muted)' }}
                      >
                        {score}
                      </p>
                      <p
                        className="text-[10px] font-sans mt-0.5"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {masteryLabel(score)}
                      </p>
                    </div>
                  </div>

                  {/* Mastery bar — full width */}
                  <MasteryBar score={score} className="w-full" />

                  {/* Per-difficulty attempt counts */}
                  {hasMastery && (easyTotal + medTotal + hardTotal > 0) && (
                    <div
                      className="flex items-center gap-3 font-sans text-[11px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span>E {topic.mastery?.easy_correct ?? 0}/{easyTotal}</span>
                      <span>M {topic.mastery?.medium_correct ?? 0}/{medTotal}</span>
                      <span>H {topic.mastery?.hard_correct ?? 0}/{hardTotal}</span>
                    </div>
                  )}

                  {/* Gate hint — what's blocking the next tier */}
                  {gate && (
                    <p
                      className="font-sans text-[11px] italic"
                      style={{ color: 'var(--amber-text)' }}
                    >
                      {gate}
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
        </section>

        {/* Recent sessions */}
        {sessions && sessions.length > 0 && (
          <section>
            <h2
              className="font-serif mb-5"
              style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}
            >
              Recent Sessions
            </h2>
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
              className="card-glow"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                    <th
                      className="p-3 text-left font-normal font-sans text-xs uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Mode
                    </th>
                    <th
                      className="p-3 text-left font-normal font-sans text-xs uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Score
                    </th>
                    <th
                      className="p-3 text-left font-normal font-sans text-xs uppercase tracking-wider"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const pct = s.total_questions > 0
                      ? Math.round((s.correct_count / s.total_questions) * 100)
                      : 0
                    const scoreColor =
                      pct >= 70 ? 'var(--status-correct)' :
                      pct >= 50 ? 'var(--status-warning)' :
                      'var(--status-wrong)'
                    return (
                      <tr
                        key={s.id}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      >
                        <td
                          className="p-3 capitalize font-sans"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {s.mode}
                        </td>
                        <td className="p-3">
                          <span
                            className="font-mono font-medium tabular-nums"
                            style={{ color: scoreColor }}
                          >
                            {pct}%
                          </span>
                          <span
                            className="font-mono text-[11px] ml-2"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {s.correct_count}/{s.total_questions}
                          </span>
                        </td>
                        <td
                          className="p-3 font-mono text-xs"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {new Date(s.started_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short',
                          })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Empty state */}
        {(!sessions || sessions.length === 0) && topicsWithMastery.every(t => !t.mastery) && (
          <div className="text-center py-16">
            <p
              className="font-serif text-3xl mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              No sessions yet
            </p>
            <p
              className="font-sans text-sm mb-6"
              style={{ color: 'var(--text-secondary)' }}
            >
              Complete a drill or recall session to start tracking your progress.
            </p>
            <Link
              href="/study/drill"
              style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 14,
                padding: '11px 24px',
                borderRadius: 8,
                display: 'inline-block',
              }}
            >
              Start a Drill →
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 12,
        padding: '20px 20px 16px',
      }}
      className="card-glow text-center"
    >
      <p
        className="font-serif tabular-nums"
        style={{
          fontSize: '2.25rem',
          color: accent ? 'var(--amber-text)' : 'var(--text-primary)',
          lineHeight: 1.1,
        }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p
        className="font-sans text-xs mt-1.5"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </p>
    </div>
  )
}
