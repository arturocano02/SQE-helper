import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery } from '@/types/database'
import MasteryBar from '@/components/ui/MasteryBar'
import Badge from '@/components/ui/Badge'
import { masteryLabel } from '@/lib/mastery'

export default async function ProgressPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: topics }, { data: mastery }, { data: sessions }] = await Promise.all([
    supabase.from('topics').select('*').order('sort_order'),
    supabase.from('user_topic_mastery').select('*').eq('user_id', user.id),
    supabase
      .from('sessions')
      .select('id, mode, correct_count, total_questions, started_at, is_complete')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .order('started_at', { ascending: false })
      .limit(10),
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

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="font-serif text-2xl text-primary">Your Progress</h1>
          <Link href="/home" className="text-secondary text-sm hover:text-primary transition">← Dashboard</Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-xl p-5 text-center">
            <p className="font-serif text-4xl text-primary">{totalSessions}</p>
            <p className="text-secondary text-sm mt-1">Sessions completed</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 text-center">
            <p className="font-serif text-4xl text-primary">{avgScore}%</p>
            <p className="text-secondary text-sm mt-1">Average score</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 text-center">
            <p className="font-serif text-4xl text-primary">
              {topicsWithMastery.filter(t => (t.mastery?.mastery_score ?? 0) >= 70).length}
            </p>
            <p className="text-secondary text-sm mt-1">Topics at 70%+</p>
          </div>
        </div>

        {/* Mastery by topic */}
        <section>
          <h2 className="font-serif text-2xl text-primary mb-5">Mastery by Topic</h2>
          <div className="space-y-3">
            {topicsWithMastery.map(topic => {
              const score = topic.mastery?.mastery_score ?? 0
              return (
                <Link
                  key={topic.id}
                  href={`/topics/${topic.slug}`}
                  className="flex items-center gap-4 p-4 bg-surface border border-border rounded-lg hover:bg-surface2 transition"
                >
                  <div className="w-32 shrink-0">
                    <p className="text-xs text-secondary truncate">{topic.name}</p>
                    <Badge variant={topic.paper} className="mt-0.5">{topic.paper}</Badge>
                  </div>
                  <MasteryBar score={score} className="flex-1" />
                  <div className="text-right w-20 shrink-0">
                    <p className="font-serif text-lg text-primary tabular-nums">{score}</p>
                    <p className="text-xs text-muted">{masteryLabel(score)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>

        {/* Recent sessions */}
        {sessions && sessions.length > 0 && (
          <section>
            <h2 className="font-serif text-2xl text-primary mb-5">Recent Sessions</h2>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-secondary font-normal">Mode</th>
                    <th className="p-3 text-left text-secondary font-normal">Score</th>
                    <th className="p-3 text-left text-secondary font-normal">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const pct = s.total_questions > 0 ? Math.round((s.correct_count / s.total_questions) * 100) : 0
                    return (
                      <tr key={s.id} className="border-b border-border/50">
                        <td className="p-3 capitalize text-primary">{s.mode}</td>
                        <td className="p-3">
                          <span className={pct >= 70 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-error'}>
                            {pct}%
                          </span>
                          <span className="text-muted text-xs ml-2">{s.correct_count}/{s.total_questions}</span>
                        </td>
                        <td className="p-3 text-secondary">
                          {new Date(s.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
