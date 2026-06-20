import React from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery, Session } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import { DrillIcon, RecallIcon, ProgressIcon, ProfileIcon } from '@/components/ui/Icon'

function computeStreak(sessions: { ended_at: string | null }[]): number {
  const dates = new Set(
    sessions
      .filter(s => s.ended_at)
      .map(s => new Date(s.ended_at!).toISOString().split('T')[0])
  )

  let streak = 0
  const check = new Date()
  check.setHours(0, 0, 0, 0)

  // Allow today or yesterday as the streak anchor (so studying earlier today still counts)
  const todayStr = check.toISOString().split('T')[0]
  if (!dates.has(todayStr)) {
    check.setDate(check.getDate() - 1)
  }

  while (dates.has(check.toISOString().split('T')[0])) {
    streak++
    check.setDate(check.getDate() - 1)
  }

  return streak
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profileCheck } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (profileCheck?.is_admin) redirect('/admin')

  const [
    { data: profile },
    { data: topicsData },
    { data: masteryData },
    { data: incompleteSession },
    { data: completedSessions },
    { data: dueSrsEntries },
    { data: approvedQuestions },
    { data: answeredHistory },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('topics').select('*').order('sort_order'),
    supabase.from('user_topic_mastery').select('*').eq('user_id', user.id),
    supabase
      .from('sessions')
      .select('id, mode, current_question_index, total_questions, topic_ids')
      .eq('user_id', user.id)
      .eq('is_complete', false)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sessions')
      .select('ended_at')
      .eq('user_id', user.id)
      .eq('is_complete', true)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(120),
    supabase
      .from('user_question_srs')
      .select('question_id')
      .eq('user_id', user.id)
      .lte('next_review_at', new Date().toISOString()),
    supabase.from('questions').select('id, topic_id').eq('status', 'approved'),
    supabase.from('question_history').select('question_id').eq('user_id', user.id),
  ])

  const topics = (topicsData ?? []) as Topic[]
  const mastery = (masteryData ?? []) as UserTopicMastery[]
  const masteryMap = new Map(mastery.map(m => [m.topic_id, m]))

  // Streak
  const streak = computeStreak(completedSessions ?? [])

  // SRS due count per topic
  const dueTopicMap = new Map<string, number>()
  if (dueSrsEntries && dueSrsEntries.length > 0) {
    const dueQIds = dueSrsEntries.map(e => e.question_id)
    const { data: dueQs } = await supabase
      .from('questions')
      .select('id, topic_id')
      .in('id', dueQIds)
    for (const q of dueQs ?? []) {
      if (q.topic_id) {
        dueTopicMap.set(q.topic_id, (dueTopicMap.get(q.topic_id) ?? 0) + 1)
      }
    }
  }

  // Per-topic question counts + per-user answered counts
  const questionCountByTopic = new Map<string, number>()
  const topicByQuestionId = new Map<string, string>()
  for (const q of approvedQuestions ?? []) {
    if (!q.topic_id) continue
    questionCountByTopic.set(q.topic_id, (questionCountByTopic.get(q.topic_id) ?? 0) + 1)
    topicByQuestionId.set(q.id, q.topic_id)
  }
  const answeredQuestionIdsByTopic = new Map<string, Set<string>>()
  for (const h of answeredHistory ?? []) {
    if (!h.question_id) continue
    const topicId = topicByQuestionId.get(h.question_id)
    if (!topicId) continue
    const set = answeredQuestionIdsByTopic.get(topicId) ?? new Set<string>()
    set.add(h.question_id)
    answeredQuestionIdsByTopic.set(topicId, set)
  }

  const topicsWithMastery = topics
    .map(t => ({
      ...t,
      mastery: masteryMap.get(t.id),
      dueCount: dueTopicMap.get(t.id) ?? 0,
      questionCount: questionCountByTopic.get(t.id) ?? 0,
      answeredCount: answeredQuestionIdsByTopic.get(t.id)?.size ?? 0,
    }))
    .sort((a, b) => (a.mastery?.mastery_score ?? 0) - (b.mastery?.mastery_score ?? 0))

  const suggested = topicsWithMastery.slice(0, 2)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const neglected = topicsWithMastery.filter(t => {
    const last = t.mastery?.last_visited_at
    return last && new Date(last) < sevenDaysAgo
  }).slice(0, 4)

  // Topics with due SRS questions — surface the top 4
  const topicsWithDue = topicsWithMastery
    .filter(t => t.dueCount > 0)
    .sort((a, b) => b.dueCount - a.dueCount)
    .slice(0, 4)

  const totalDue = Array.from(dueTopicMap.values()).reduce((s, n) => s + n, 0)

  const firstName = profile?.name?.split(' ')[0] ?? 'there'

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      {/* Sticky header */}
      <header
        className="sticky top-0 z-10 backdrop-blur-sm"
        style={{
          background: 'rgba(10,10,8,0.90)',
          borderBottom: '1px solid var(--surface-border)',
        }}
      >
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/home" className="flex items-center gap-2">
            <span className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>SQE1</span>
            <span
              className="text-[10px] font-sans uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              Study
            </span>
          </Link>
          <nav className="flex items-center gap-0.5">
            <NavLink href="/study/drill" icon={<DrillIcon size={15} />} label="Drill" />
            <NavLink href="/study/recall" icon={<RecallIcon size={15} />} label="Recall" />
            <NavLink href="/study/simulate" label="Simulate" icon={
              <span style={{ fontSize: 13 }}>⚡</span>
            } />
            <NavLink href="/progress" icon={<ProgressIcon size={15} />} label="Progress" />
            <Link
              href="/profile"
              className="ml-1 flex items-center justify-center w-8 h-8 rounded transition"
              style={{ color: 'var(--text-secondary)' }}
              title="Profile"
            >
              <ProfileIcon size={16} />
            </Link>
          </nav>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-10">
        {/* Greeting */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              className="font-serif mb-1"
              style={{ fontSize: '2rem', color: 'var(--text-primary)', lineHeight: 1.2 }}
            >
              Good to see you, {firstName}
            </h2>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              What are you working on today?
            </p>
          </div>
          {streak >= 2 && (
            <div
              style={{
                background: 'var(--amber-soft)',
                border: '1px solid rgba(200,146,42,0.3)',
                borderRadius: 10,
                padding: '8px 14px',
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              <p className="font-mono text-xl leading-none mb-0.5">🔥</p>
              <p
                className="font-mono text-sm font-semibold tabular-nums"
                style={{ color: 'var(--amber-text)' }}
              >
                {streak}
              </p>
              <p className="font-sans text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                day streak
              </p>
            </div>
          )}
        </div>

        {/* Resume banner */}
        {incompleteSession && (
          <section>
            <div
              style={{
                background: 'var(--amber-soft)',
                border: '1px solid rgba(200,146,42,0.35)',
                borderLeft: '3px solid var(--amber)',
                borderRadius: 12,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div>
                <p
                  className="font-sans font-medium text-sm mb-0.5"
                  style={{ color: 'var(--amber-text)' }}
                >
                  Continue where you left off
                </p>
                <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-mono">
                    {incompleteSession.current_question_index}&thinsp;/&thinsp;{incompleteSession.total_questions ?? '?'}
                  </span>
                  {' '}answered · {incompleteSession.mode} mode
                </p>
              </div>
              <Link
                href={`/study/${(incompleteSession as Session).mode}/${incompleteSession.id}`}
                style={{
                  background: 'var(--amber)',
                  color: '#0A0A08',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 500,
                  fontSize: 13,
                  padding: '8px 18px',
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                  transition: 'all 150ms ease',
                }}
                className="hover:brightness-110 active:scale-[0.98] shrink-0"
              >
                Resume →
              </Link>
            </div>
          </section>
        )}

        {/* Due for review */}
        {topicsWithDue.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3
                className="font-serif"
                style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}
              >
                Due for review
              </h3>
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: 'var(--amber-text)' }}
              >
                {totalDue} card{totalDue !== 1 ? 's' : ''} due
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topicsWithDue.map(topic => (
                <div
                  key={topic.id}
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--surface-border)',
                    borderLeft: '3px solid var(--amber)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                  className="card-glow"
                >
                  <div>
                    <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {topic.name}
                    </p>
                    <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--amber-text)' }}>
                      {topic.dueCount} question{topic.dueCount !== 1 ? 's' : ''} due
                    </p>
                  </div>
                  <Link
                    href={`/study/drill?topics=${topic.id}`}
                    style={{
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 500,
                      fontSize: 12,
                      padding: '6px 14px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                      transition: 'all 150ms ease',
                    }}
                    className="hover:brightness-110 active:scale-[0.98] shrink-0"
                  >
                    Drill →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Suggested for today */}
        {suggested.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3
                className="font-serif"
                style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}
              >
                Suggested for today
              </h3>
              <span
                className="text-[11px] font-sans"
                style={{ color: 'var(--text-muted)' }}
              >
                Weakest topics first
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggested.map(topic => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  mastery={topic.mastery}
                  questionCount={topic.questionCount}
                  answeredCount={topic.answeredCount}
                  actions={
                    <>
                      <QuickLaunchButton href={`/study/drill?topics=${topic.id}`} label="Drill" />
                      <QuickLaunchButton href={`/study/recall?topics=${topic.id}`} label="Recall" />
                      {topic.dueCount > 0 && (
                        <span
                          className="font-mono text-[10px] px-2 py-0.5 rounded tabular-nums"
                          style={{
                            background: 'var(--amber-soft)',
                            color: 'var(--amber-text)',
                            border: '1px solid rgba(200,146,42,0.3)',
                            marginLeft: 'auto',
                          }}
                        >
                          {topic.dueCount} due
                        </span>
                      )}
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
            <h3
              className="font-serif mb-4"
              style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}
            >
              Not visited in a while
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {neglected.map(topic => {
                const days = topic.mastery?.last_visited_at
                  ? Math.floor((Date.now() - new Date(topic.mastery.last_visited_at).getTime()) / (1000 * 60 * 60 * 24))
                  : null
                return (
                  <div
                    key={topic.id}
                    style={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 10,
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      transition: 'all 150ms ease',
                    }}
                    className="card-glow"
                  >
                    <div>
                      <p
                        className="font-sans text-sm font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {topic.name}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {days !== null && (
                          <p
                            className="font-mono text-[11px] flex items-center gap-1"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            🕐 {days} days since last visit
                          </p>
                        )}
                        {topic.dueCount > 0 && (
                          <p className="font-mono text-[11px]" style={{ color: 'var(--amber-text)' }}>
                            {topic.dueCount} due
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/study/drill?topics=${topic.id}`}
                      style={{
                        fontSize: 12,
                        border: '1px solid var(--surface-border)',
                        color: 'var(--text-secondary)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        whiteSpace: 'nowrap',
                        transition: 'all 150ms ease',
                        fontFamily: 'var(--font-dm-sans)',
                      }}
                      className="hover:border-[rgba(200,146,42,0.35)] hover:text-[var(--amber-text)] shrink-0"
                    >
                      Quick drill
                    </Link>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Simulate promo — shown if no due items */}
        {topicsWithDue.length === 0 && (
          <section>
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 12,
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
              className="card-glow"
            >
              <div>
                <p className="font-sans text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Ready for a full exam simulation?
                </p>
                <p className="font-sans text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Cross-topic questions from all 12 FLK1 &amp; FLK2 subjects.
                </p>
              </div>
              <Link
                href="/study/simulate"
                style={{
                  background: 'transparent',
                  color: 'var(--amber-text)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 500,
                  fontSize: 13,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid rgba(200,146,42,0.35)',
                  whiteSpace: 'nowrap',
                  transition: 'all 150ms ease',
                }}
                className="hover:bg-[var(--amber-soft)] shrink-0"
              >
                Simulate →
              </Link>
            </div>
          </section>
        )}

        {/* All topics */}
        <section>
          <h3
            className="font-serif mb-4"
            style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}
          >
            All Topics
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topicsWithMastery.map(topic => (
              <div key={topic.id} className="relative">
                <Link href={`/topics/${topic.slug}`}>
                  <TopicCard
                    topic={topic}
                    mastery={topic.mastery}
                    questionCount={topic.questionCount}
                    answeredCount={topic.answeredCount}
                  />
                </Link>
                {topic.dueCount > 0 && (
                  <span
                    className="absolute top-3 right-3 font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded pointer-events-none"
                    style={{
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontWeight: 600,
                    }}
                  >
                    {topic.dueCount}
                  </span>
                )}
              </div>
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
      style={{
        fontSize: 12,
        border: '1px solid rgba(200,146,42,0.25)',
        color: 'var(--text-secondary)',
        padding: '5px 12px',
        borderRadius: 6,
        fontFamily: 'var(--font-dm-sans)',
        transition: 'all 150ms ease',
      }}
      className="hover:border-[rgba(200,146,42,0.5)] hover:text-[var(--amber-text)] hover:bg-[var(--amber-glow)]"
    >
      {label}
    </Link>
  )
}

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded transition text-sm font-sans"
      style={{ color: 'var(--text-secondary)', transition: 'all 150ms ease' }}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
