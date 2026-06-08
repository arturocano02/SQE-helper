import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, Topic, UserTopicMastery } from '@/types/database'
import SignOutButton from './SignOutButton'
import Link from 'next/link'
import MasteryBar from '@/components/ui/MasteryBar'

export const dynamic = 'force-dynamic'

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
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/home" className="text-secondary text-sm hover:text-primary transition">← Dashboard</Link>
          <h1 className="font-serif text-xl text-primary">Profile</h1>
          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

        {/* Identity */}
        <div className="bg-surface border border-border rounded-xl p-6 flex items-center gap-5">
          {p?.avatar_url ? (
            <img src={p.avatar_url} alt="Avatar" className="w-14 h-14 rounded-full" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-accent-dim border border-accent/30 flex items-center justify-center">
              <span className="font-serif text-xl text-accent">
                {(p?.name ?? user.email ?? '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-primary font-medium truncate">{p?.name ?? 'No name set'}</p>
            <p className="text-secondary text-sm truncate">{user.email}</p>
            <p className="text-muted text-xs mt-1">Joined {joinedDate}</p>
          </div>
          {p?.is_admin && (
            <span className="text-xs border border-accent/40 text-accent px-2 py-1 rounded">Admin</span>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="font-serif text-3xl text-primary">{totalSessions}</p>
            <p className="text-secondary text-xs mt-1">Sessions</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="font-serif text-3xl text-primary">{totalAnswers}</p>
            <p className="text-secondary text-xs mt-1">Questions answered</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="font-serif text-3xl text-primary">{avgScore !== null ? `${avgScore}%` : '—'}</p>
            <p className="text-secondary text-xs mt-1">Avg score</p>
          </div>
        </div>

        {/* Overall mastery */}
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-secondary text-sm">Overall mastery</p>
            <p className="font-serif text-2xl text-primary">{overallMastery}</p>
          </div>
          <MasteryBar score={overallMastery} />
          <p className="text-xs text-muted mt-2">Average across all 12 topics</p>
        </div>

        {/* Exam date */}
        {p?.exam_date && (
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-secondary text-sm mb-1">Exam date</p>
            <p className="text-primary">
              {new Date(p.exam_date).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
            {(() => {
              const days = Math.ceil((new Date(p.exam_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              if (days < 0) return <p className="text-muted text-xs mt-1">Exam has passed</p>
              return <p className="text-accent text-xs mt-1">{days} days to go</p>
            })()}
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/progress" className="bg-surface border border-border rounded-xl p-4 hover:bg-surface2 transition">
            <p className="text-primary text-sm font-medium">View Progress</p>
            <p className="text-secondary text-xs mt-0.5">Mastery by topic</p>
          </Link>
          {p?.is_admin && (
            <Link href="/admin" className="bg-surface border border-border rounded-xl p-4 hover:bg-surface2 transition">
              <p className="text-primary text-sm font-medium">Admin Dashboard</p>
              <p className="text-secondary text-xs mt-0.5">Content &amp; analytics</p>
            </Link>
          )}
        </div>

        {/* Sign out */}
        <div className="pt-4 border-t border-border">
          <SignOutButton />
        </div>

      </div>
    </main>
  )
}
