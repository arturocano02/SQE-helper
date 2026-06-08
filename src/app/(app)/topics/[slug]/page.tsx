import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery } from '@/types/database'
import MasteryBar from '@/components/ui/MasteryBar'
import Badge from '@/components/ui/Badge'
import { masteryLabel } from '@/lib/mastery'

export default async function TopicDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: topic } = await supabase.from('topics').select('*').eq('slug', slug).single()
  if (!topic) notFound()

  const t = topic as Topic

  const [{ data: masteryData }, { data: questionCounts }] = await Promise.all([
    supabase.from('user_topic_mastery').select('*').eq('user_id', user.id).eq('topic_id', t.id).single(),
    supabase.from('questions').select('difficulty').eq('topic_id', t.id).eq('status', 'approved'),
  ])

  const mastery = masteryData as UserTopicMastery | null
  const counts = { easy: 0, medium: 0, hard: 0, flashcard: 0 }

  ;(questionCounts ?? []).forEach((q: { difficulty: string | null }) => {
    if (q.difficulty === 'easy') counts.easy++
    else if (q.difficulty === 'medium') counts.medium++
    else if (q.difficulty === 'hard') counts.hard++
  })

  const score = mastery?.mastery_score ?? 0

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link href="/home" className="text-secondary text-sm hover:text-primary transition">← Dashboard</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Topic header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Badge variant={t.paper}>{t.paper}</Badge>
          </div>
          <h1 className="font-serif text-4xl text-primary mb-4">{t.name}</h1>
          <div className="flex items-center gap-4 mb-3">
            <MasteryBar score={score} className="flex-1 max-w-xs" />
            <span className="text-2xl font-serif text-primary tabular-nums">{score}</span>
          </div>
          <p className="text-secondary text-sm">{masteryLabel(score)}</p>
        </div>

        {/* Mastery breakdown */}
        {mastery && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-8">
            <h2 className="font-serif text-lg text-primary mb-4">Your Progress</h2>
            <div className="grid grid-cols-3 gap-4">
              {(['easy', 'medium', 'hard'] as const).map(d => {
                const correct = mastery[`${d}_correct`]
                const total = mastery[`${d}_total`]
                const pct = total > 0 ? Math.round((correct / total) * 100) : 0
                return (
                  <div key={d} className="text-center">
                    <Badge variant={d} className="mb-2">{d}</Badge>
                    <p className="font-serif text-2xl text-primary">{pct}%</p>
                    <p className="text-xs text-muted">{correct}/{total}</p>
                  </div>
                )
              })}
            </div>
            {mastery.last_visited_at && (
              <p className="text-xs text-muted mt-4 text-center">
                Last visited: {new Date(mastery.last_visited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
        )}

        {/* Quick launch */}
        <div className="grid grid-cols-2 gap-4">
          <Link
            href={`/study/drill?topics=${t.id}`}
            className="bg-surface border border-border rounded-lg p-5 hover:bg-surface2 transition group"
          >
            <h3 className="font-serif text-xl text-primary mb-1 group-hover:text-accent transition">Topic Drill</h3>
            <p className="text-secondary text-sm">Practice MCQs on {t.name}</p>
            <p className="text-xs text-muted mt-2">
              {counts.easy + counts.medium + counts.hard} questions available
            </p>
          </Link>

          <Link
            href={`/study/recall?topics=${t.id}`}
            className="bg-surface border border-border rounded-lg p-5 hover:bg-surface2 transition group"
          >
            <h3 className="font-serif text-xl text-primary mb-1 group-hover:text-accent transition">Active Recall</h3>
            <p className="text-secondary text-sm">Flashcard rule review</p>
            <p className="text-xs text-muted mt-2">Quick rule memorisation</p>
          </Link>
        </div>
      </div>
    </main>
  )
}
