import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, Topic, UserTopicMastery } from '@/types/database'
import SignOutButton from './SignOutButton'
import Link from 'next/link'
import MasteryBar from '@/components/ui/MasteryBar'

export const dynamic = 'force-dynamic'

function getMasteryColor(score: number): string {
  if (score >= 70) return 'var(--status-correct)'
  if (score >= 40) return 'var(--status-warning)'
  return 'var(--status-wrong)'
}

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: profile }, { data: topics }, { data: mastery }, { data: sessionStats }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('topics').select('*').order('sort_order'),
      supabase.from('user_topic_mastery').select('*').eq('user_id', user.id),
      supabase
        .from('sessions')
        .select('id, correct_count, total_questions')
        .eq('user_id', user.id)
        .eq('is_complete', true),
    ])

  const p = profile as Profile
  const masteryMap = new Map(((mastery ?? []) as UserTopicMastery[]).map(m => [m.topic_id, m]))
  const topicList = (topics ?? []) as Topic[]

  const totalSessions = sessionStats?.length ?? 0
  const totalAnswers = (sessionStats ?? []).reduce((sum, s) => sum + (s.total_questions ?? 0), 0)
  const totalCorrect = (sessionStats ?? []).reduce((sum, s) => sum + (s.correct_count ?? 0), 0)
  const avgScore = totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : null

  const overallMastery = topicList.length > 0
    ? Math.round(topicList.reduce((sum, t) => sum + (masteryMap.get(t.id)?.mastery_score ?? 0), 0) / topicList.length)
    : 0

  const joinedDate = new Date(p?.created_at ?? user.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/home"
            className="font-sans text-sm transition"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← Dashboard
          </Link>
          <h1 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Profile</h1>
          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* Identity */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 14,
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
          className="card-glow"
        >
          {p?.avatar_url ? (
            <img src={p.avatar_url} alt="Avatar" className="w-14 h-14 rounded-full shrink-0" />
          ) : (
            <div
              className="shrink-0 flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--amber-soft)',
                border: '1px solid rgba(200,146,42,0.35)',
              }}
            >
              <span className="font-serif text-xl" style={{ color: 'var(--amber)' }}>
                {(p?.name ?? user.email ?? '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-sans font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {p?.name ?? 'No name set'}
            </p>
            <p className="font-sans text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
              {user.email}
            </p>
            <p className="font-mono text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Joined {joinedDate}
            </p>
          </div>
          {p?.is_admin && (
            <span
              className="font-sans text-xs px-2 py-1 rounded shrink-0"
              style={{
                border: '1px solid rgba(200,146,42,0.4)',
                color: 'var(--amber-text)',
              }}
            >
              Admin
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: totalSessions, label: 'Sessions' },
            { value: totalAnswers, label: 'Questions answered' },
            { value: avgScore !== null ? `${avgScore}%` : '—', label: 'Avg score' },
          ].map(({ value, label }) => (
            <div
              key={label}
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 12,
                padding: '16px',
                textAlign: 'center',
              }}
              className="card-glow"
            >
              <p className="font-serif text-3xl tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {value}
              </p>
              <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Overall mastery */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 12,
            padding: '20px 24px',
          }}
          className="card-glow"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>Overall mastery</p>
            <p
              className="font-serif text-2xl tabular-nums"
              style={{ color: getMasteryColor(overallMastery) }}
            >
              {overallMastery}
            </p>
          </div>
          <MasteryBar score={overallMastery} />
          <p className="font-sans text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Average across all 12 topics
          </p>
        </div>

        {/* Exam date */}
        {p?.exam_date && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '20px 24px',
            }}
            className="card-glow"
          >
            <p className="font-sans text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Exam date</p>
            <p className="font-sans" style={{ color: 'var(--text-primary)' }}>
              {new Date(p.exam_date).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
            {(() => {
              const days = Math.ceil((new Date(p.exam_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              if (days < 0) {
                return (
                  <p className="font-mono text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Exam has passed
                  </p>
                )
              }
              return (
                <p className="font-mono text-xs mt-1" style={{ color: 'var(--amber-text)' }}>
                  {days} days to go
                </p>
              )
            })()}
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/progress"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '16px',
              display: 'block',
              transition: 'all 150ms ease',
            }}
            className="card-glow card-glow-hover"
          >
            <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              View Progress
            </p>
            <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Mastery by topic
            </p>
          </Link>
          {p?.is_admin && (
            <Link
              href="/admin"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 12,
                padding: '16px',
                display: 'block',
                transition: 'all 150ms ease',
              }}
              className="card-glow card-glow-hover"
            >
              <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Admin Dashboard
              </p>
              <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Content &amp; analytics
              </p>
            </Link>
          )}
        </div>

        {/* Sign out */}
        <div className="pt-4" style={{ borderTop: '1px solid var(--surface-border)' }}>
          <SignOutButton />
        </div>

      </div>
    </main>
  )
}
