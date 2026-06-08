import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery, Session } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import Button from '@/components/ui/Button'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: profile }, { data: topicsData }, { data: masteryData }, { data: incompleteSession }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('topics').select('*').order('sort_order'),
      supabase.from('user_topic_mastery').select('*').eq('user_id', user.id),
      supabase
        .from('sessions')
        .select('*, topics:topic_ids')
        .eq('user_id', user.id)
        .eq('is_complete', false)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const topics = (topicsData ?? []) as Topic[]
  const mastery = (masteryData ?? []) as UserTopicMastery[]
  const masteryMap = new Map(mastery.map(m => [m.topic_id, m]))

  // Sort by mastery score ascending (weakest first)
  const topicsWithMastery = topics
    .map(t => ({ ...t, mastery: masteryMap.get(t.id) }))
    .sort((a, b) => (a.mastery?.mastery_score ?? 0) - (b.mastery?.mastery_score ?? 0))

  // Suggested: 2 weakest that have been visited or seeded
  const suggested = topicsWithMastery.slice(0, 2)

  // Not visited in 7+ days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const neglected = topicsWithMastery.filter(t => {
    const last = t.mastery?.last_visited_at
    return last && new Date(last) < sevenDaysAgo
  }).slice(0, 4)

  const firstName = profile?.name?.split(' ')[0] ?? 'there'

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="font-serif text-2xl text-primary">SQE1</h1>
          <nav className="flex items-center gap-6">
            <Link href="/study/drill" className="text-sm text-secondary hover:text-primary transition">Drill</Link>
            <Link href="/study/recall" className="text-sm text-secondary hover:text-primary transition">Recall</Link>
            <Link href="/progress" className="text-sm text-secondary hover:text-primary transition">Progress</Link>
          </nav>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 space-y-12">
        {/* Greeting */}
        <div>
          <h2 className="font-serif text-3xl text-primary mb-1">Good to see you, {firstName}</h2>
          <p className="text-secondary text-sm">What are you working on today?</p>
        </div>

        {/* Resume incomplete session */}
        {incompleteSession && (
          <section>
            <div className="bg-accent-dim border border-accent/30 rounded-lg p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-accent font-medium mb-0.5">Continue where you left off</p>
                <p className="text-secondary text-sm">
                  {incompleteSession.current_question_index} of {incompleteSession.total_questions ?? '?'} answered
                  · {incompleteSession.mode} mode
                </p>
              </div>
              <Link
                href={`/study/${(incompleteSession as Session).mode}/${incompleteSession.id}`}
                className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 transition whitespace-nowrap text-sm"
              >
                Resume →
              </Link>
            </div>
          </section>
        )}

        {/* Suggested for today */}
        {suggested.length > 0 && (
          <section>
            <h3 className="font-serif text-xl text-primary mb-4">Suggested for today</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggested.map(topic => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  mastery={topic.mastery}
                  actions={
                    <>
                      <QuickLaunchButton href={`/study/drill?topics=${topic.id}`} label="Drill" />
                      <QuickLaunchButton href={`/study/recall?topics=${topic.id}`} label="Recall" />
                    </>
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Not visited in a while */}
        {neglected.length > 0 && (
          <section>
            <h3 className="font-serif text-xl text-primary mb-4">Not visited in a while</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {neglected.map(topic => {
                const days = topic.mastery?.last_visited_at
                  ? Math.floor((Date.now() - new Date(topic.mastery.last_visited_at).getTime()) / (1000 * 60 * 60 * 24))
                  : null
                return (
                  <div key={topic.id} className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-primary text-sm font-medium">{topic.name}</p>
                      {days !== null && (
                        <p className="text-muted text-xs mt-0.5">{days} days since last visit</p>
                      )}
                    </div>
                    <Link
                      href={`/study/drill?topics=${topic.id}`}
                      className="text-xs border border-border text-secondary px-3 py-1.5 rounded hover:bg-surface2 transition whitespace-nowrap"
                    >
                      Quick drill
                    </Link>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* All topics */}
        <section>
          <h3 className="font-serif text-xl text-primary mb-4">All Topics</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topicsWithMastery.map(topic => (
              <Link key={topic.id} href={`/topics/${topic.slug}`}>
                <TopicCard topic={topic} mastery={topic.mastery} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function QuickLaunchButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-xs border border-border text-secondary px-3 py-1.5 rounded hover:bg-surface transition"
    >
      {label}
    </Link>
  )
}
