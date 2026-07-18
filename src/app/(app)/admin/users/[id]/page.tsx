'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import ActivityChart from '@/components/ui/ActivityChart'
import type { Topic, UserTopicMastery, SessionMode } from '@/types/database'

interface Detail {
  profile: {
    id: string
    name: string | null
    email: string | null
    avatar_url: string | null
    is_admin: boolean
    created_at: string
    exam_date: string | null
    onboarding_complete: boolean
  }
  stats: {
    sessions_completed: number
    questions_answered: number
    correct_answered: number
    accuracy: number | null
  }
  topic_breakdown: { topic: Topic; mastery: UserTopicMastery | null }[]
  recent_sessions: {
    id: string
    mode: SessionMode
    correct_count: number
    total_questions: number | null
    started_at: string
    is_complete: boolean
  }[]
  daily_activity: { day: string; answers: number; correct: number }[]
}

function masteryColor(score: number): string {
  if (score >= 70) return 'var(--status-correct)'
  if (score >= 40) return 'var(--status-warning)'
  return 'var(--status-wrong)'
}

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/admin/users/${id}`)
      if (res.status === 404) { setNotFound(true); setLoading(false); return }
      const json = await res.json()
      setData(json)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-base)' }}>
        <p className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </main>
    )
  }

  if (notFound || !data) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: 'var(--surface-base)' }}>
        <p className="font-serif text-xl" style={{ color: 'var(--text-muted)' }}>User not found</p>
        <Link href="/admin/users" className="font-sans text-sm" style={{ color: 'var(--amber-text)' }}>← Back to users</Link>
      </main>
    )
  }

  const { profile, stats, topic_breakdown, recent_sessions, daily_activity } = data

  const chartPoints = daily_activity.slice(-30).map(d => ({
    label: new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    value: d.answers,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-4xl mx-auto px-6 py-6">

        <Link href="/admin/users" className="font-sans text-sm inline-block mb-4" style={{ color: 'var(--text-secondary)' }}>
          ← All users
        </Link>

        {/* Identity header */}
        <div
          className="flex items-center gap-4 mb-6 p-5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 14 }}
        >
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" width={56} height={56} style={{ borderRadius: '50%' }} />
          ) : (
            <div
              className="flex items-center justify-center font-serif text-2xl"
              style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--amber-soft)', color: 'var(--amber-text)' }}
            >
              {(profile.name ?? profile.email ?? '?')[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
                {profile.name ?? 'No name set'}
              </h1>
              {profile.is_admin && (
                <span className="font-sans text-[11px] px-2 py-0.5 rounded" style={{ border: '1px solid rgba(200,146,42,0.4)', color: 'var(--amber-text)' }}>
                  Admin
                </span>
              )}
            </div>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{profile.email ?? '—'}</p>
            <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Joined {new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              {profile.exam_date && ` · Exam date ${new Date(profile.exam_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Sessions" value={stats.sessions_completed} />
          <StatCard label="Questions answered" value={stats.questions_answered} />
          <StatCard label="Correct" value={stats.correct_answered} />
          <StatCard
            label="Accuracy"
            value={stats.accuracy !== null ? `${stats.accuracy}%` : '—'}
            color={stats.accuracy === null ? undefined : masteryColor(stats.accuracy)}
          />
        </div>

        {/* Activity chart */}
        <div
          className="mb-6 p-5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12 }}
        >
          <p className="font-sans text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            Questions answered per day — last 30 days
          </p>
          <ActivityChart points={chartPoints} emptyLabel="No activity in the last 90 days." />
        </div>

        {/* Topic mastery breakdown */}
        <div className="mb-6">
          <h2 className="font-serif text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Topic mastery</h2>
          <div
            style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12, overflow: 'hidden' }}
            className="card-glow"
          >
            {topic_breakdown.map(({ topic, mastery }) => {
              const score = mastery?.mastery_score ?? 0
              const color = masteryColor(score)
              return (
                <div
                  key={topic.id}
                  className="px-4 py-3 flex items-center gap-4"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span
                    className="text-[10px] font-sans rounded px-1.5 py-0.5 shrink-0"
                    style={{
                      border: topic.paper === 'FLK1' ? '1px solid rgba(200,146,42,0.4)' : '1px solid rgba(154,149,144,0.4)',
                      color: topic.paper === 'FLK1' ? 'var(--amber-text)' : 'var(--text-secondary)',
                    }}
                  >
                    {topic.paper}
                  </span>
                  <span className="font-sans text-sm shrink-0 truncate" style={{ width: 200, color: 'var(--text-primary)' }}>
                    {topic.name}
                  </span>
                  <div className="flex-1" style={{ height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3 }} />
                  </div>
                  <span className="font-mono text-sm tabular-nums shrink-0" style={{ width: 40, textAlign: 'right', color }}>
                    {score}%
                  </span>
                  {mastery && (
                    <span className="font-sans text-[11px] shrink-0" style={{ width: 90, textAlign: 'right', color: 'var(--text-muted)' }}>
                      {mastery.easy_correct + mastery.medium_correct + mastery.hard_correct}/
                      {mastery.easy_total + mastery.medium_total + mastery.hard_total} correct
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent sessions */}
        <div className="mb-10">
          <h2 className="font-serif text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Recent sessions</h2>
          {recent_sessions.length === 0 ? (
            <p className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>No sessions yet.</p>
          ) : (
            <div
              style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12, overflow: 'hidden' }}
              className="card-glow"
            >
              {recent_sessions.map(s => {
                const pct = s.total_questions ? Math.round((s.correct_count / s.total_questions) * 100) : null
                return (
                  <div
                    key={s.id}
                    className="px-4 py-3 flex items-center gap-4"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span className="font-sans text-xs capitalize shrink-0" style={{ width: 80, color: 'var(--text-secondary)' }}>
                      {s.mode}
                    </span>
                    <span className="font-sans text-xs shrink-0" style={{ width: 100, color: 'var(--text-muted)' }}>
                      {new Date(s.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    <span
                      className="font-sans text-[11px] px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        background: s.is_complete ? 'rgba(76,175,130,0.10)' : 'rgba(200,146,42,0.10)',
                        color: s.is_complete ? 'var(--status-correct)' : 'var(--amber-text)',
                      }}
                    >
                      {s.is_complete ? 'Complete' : 'In progress'}
                    </span>
                    <span className="font-mono text-sm ml-auto" style={{ color: pct !== null ? masteryColor(pct) : 'var(--text-muted)' }}>
                      {pct !== null ? `${s.correct_count}/${s.total_questions} (${pct}%)` : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12, padding: '16px 18px' }}
      className="card-glow"
    >
      <p className="font-sans text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="font-serif text-3xl tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}
