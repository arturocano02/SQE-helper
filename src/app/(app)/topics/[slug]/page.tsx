import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery, Confidence } from '@/types/database'
import MasteryBar from '@/components/ui/MasteryBar'
import Badge from '@/components/ui/Badge'
import { masteryLabel, masteryFromConfidence } from '@/lib/mastery'
import MasteryLevelUp from '@/components/study/MasteryLevelUp'
import RequestContentButton from '@/components/study/RequestContentButton'

function getMasteryColor(score: number): string {
  if (score >= 70) return 'var(--status-correct)'
  if (score >= 40) return 'var(--status-warning)'
  return 'var(--status-wrong)'
}

interface QuestionPerf {
  question_id: string
  prompt: string
  difficulty: string | null
  attempts: number
  correct: number
  rate: number
}

export default async function TopicDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: topic } = await supabase.from('topics').select('*').eq('slug', slug).single()
  if (!topic) notFound()

  const t = topic as Topic

  const [
    { data: masteryData },
    { data: topicQuestions },
    { data: srsData },
    { data: recentHistory },
    { data: topicChunks },
  ] = await Promise.all([
    supabase.from('user_topic_mastery').select('*').eq('user_id', user.id).eq('topic_id', t.id).single(),
    // All approved questions for this topic
    supabase.from('questions').select('id, difficulty, prompt').eq('topic_id', t.id).eq('status', 'approved'),
    // SRS state for questions in this topic (to count due)
    supabase.from('user_question_srs').select('question_id, next_review_at').eq('user_id', user.id),
    // Last 50 answers for questions in this topic
    supabase
      .from('question_history')
      .select('question_id, was_correct, answered_at')
      .eq('user_id', user.id)
      .eq('is_imported', false)
      .order('answered_at', { ascending: false })
      .limit(200),
    // Approved knowledge chunks for this topic, to show subtopic coverage
    supabase
      .from('knowledge_chunks')
      .select('id, source_section')
      .eq('topic_id', t.id)
      .eq('is_approved', true),
  ])

  const { data: coverageData } = await supabase
    .from('user_topic_coverage')
    .select('confidence')
    .eq('user_id', user.id)
    .eq('topic_id', t.id)
    .maybeSingle()
  const declaredConfidence = (coverageData as { confidence: Confidence } | null)?.confidence ?? null

  const mastery = masteryData as UserTopicMastery | null
  const questions = topicQuestions ?? []
  const topicQuestionIds = new Set(questions.map((q: { id: string }) => q.id))

  // --- Counts ---
  const counts = { easy: 0, medium: 0, hard: 0 }
  questions.forEach((q: { difficulty: string | null }) => {
    if (q.difficulty === 'easy') counts.easy++
    else if (q.difficulty === 'medium') counts.medium++
    else if (q.difficulty === 'hard') counts.hard++
  })
  const totalAvailable = counts.easy + counts.medium + counts.hard

  // --- SRS due ---
  const now = new Date()
  const dueSrsIds = new Set(
    (srsData ?? [])
      .filter((s: { question_id: string; next_review_at: string }) =>
        topicQuestionIds.has(s.question_id) && new Date(s.next_review_at) <= now
      )
      .map((s: { question_id: string }) => s.question_id)
  )
  const dueCount = dueSrsIds.size

  // --- Per-question performance from history ---
  const topicHistory = (recentHistory ?? []).filter(
    (h: { question_id: string | null }) => h.question_id && topicQuestionIds.has(h.question_id)
  )

  // Build performance map per question
  const perfMap = new Map<string, { attempts: number; correct: number }>()
  topicHistory.forEach((h: { question_id: string | null; was_correct: boolean }) => {
    if (!h.question_id) return
    const cur = perfMap.get(h.question_id) ?? { attempts: 0, correct: 0 }
    perfMap.set(h.question_id, {
      attempts: cur.attempts + 1,
      correct: cur.correct + (h.was_correct ? 1 : 0),
    })
  })

  // Build full perf list for questions with history
  const questionMap = new Map(
    questions.map((q: { id: string; difficulty: string | null; prompt: string }) => [q.id, q])
  )
  const perfList: QuestionPerf[] = []
  perfMap.forEach((perf, qid) => {
    const q = questionMap.get(qid)
    if (!q || perf.attempts === 0) return
    perfList.push({
      question_id: qid,
      prompt: q.prompt,
      difficulty: q.difficulty,
      attempts: perf.attempts,
      correct: perf.correct,
      rate: perf.correct / perf.attempts,
    })
  })

  // Sort for weaknesses (lowest rate, min 2 attempts) and strengths (highest rate, min 2 attempts)
  const practised = perfList.filter(p => p.attempts >= 2)
  const weaknesses = [...practised]
    .filter(p => p.rate < 0.6)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
  const weaknessIds = new Set(weaknesses.map(p => p.question_id))
  const strengths = [...practised]
    .filter(p => p.rate >= 0.6 && !weaknessIds.has(p.question_id))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3)

  // Recent trend — last 10 vs prior 10
  const recentTen = topicHistory.slice(0, 10)
  const priorTen = topicHistory.slice(10, 20)
  const recentRate = recentTen.length
    ? Math.round(recentTen.filter((h: { was_correct: boolean }) => h.was_correct).length / recentTen.length * 100)
    : null
  const priorRate = priorTen.length
    ? Math.round(priorTen.filter((h: { was_correct: boolean }) => h.was_correct).length / priorTen.length * 100)
    : null
  const trendDelta = recentRate !== null && priorRate !== null ? recentRate - priorRate : null

  const questionsAttempted = perfMap.size

  const score = mastery?.mastery_score ?? 0
  const hasMastery = !!mastery

  // --- Knowledge chunk / subtopic coverage ---
  const chunks = (topicChunks ?? []) as Array<{ id: string; source_section: string | null }>
  const chunkIds = chunks.map(c => c.id)
  let chunkMastery: Array<{ chunk_id: string; attempt_count: number | null }> = []
  if (chunkIds.length > 0) {
    const { data: cm } = await supabase
      .from('user_chunk_mastery')
      .select('chunk_id, attempt_count')
      .eq('user_id', user.id)
      .in('chunk_id', chunkIds)
    chunkMastery = (cm ?? []) as Array<{ chunk_id: string; attempt_count: number | null }>
  }
  const attemptsByChunk = new Map(chunkMastery.map(c => [c.chunk_id, c.attempt_count ?? 0]))

  const sectionGroups = new Map<string, { totalChunks: number; attemptedChunks: number; totalAttempts: number }>()
  chunks.forEach(c => {
    const section = c.source_section || 'Uncategorised'
    const attempts = attemptsByChunk.get(c.id) ?? 0
    const g = sectionGroups.get(section) ?? { totalChunks: 0, attemptedChunks: 0, totalAttempts: 0 }
    g.totalChunks += 1
    if (attempts > 0) g.attemptedChunks += 1
    g.totalAttempts += attempts
    sectionGroups.set(section, g)
  })
  const maxAttempts = Math.max(1, ...Array.from(sectionGroups.values()).map(g => g.totalAttempts))
  const coverageRows = Array.from(sectionGroups.entries())
    .map(([section, g]) => ({
      section,
      ...g,
      coverage: g.totalChunks > 0 ? g.attemptedChunks / g.totalChunks : 0,
      intensity: g.totalAttempts / maxAttempts,
    }))
    .sort((a, b) => a.coverage - b.coverage)

  // --- Declared confidence vs measured mastery ---
  const declaredScore = declaredConfidence ? masteryFromConfidence(declaredConfidence) : null
  const enoughData = hasMastery && questionsAttempted >= 5
  let calibration: { agrees: boolean; message: string; ctaDifficulty: 'hard' | 'medium' | 'any' } | null = null
  if (declaredScore !== null && enoughData) {
    const gap = score - declaredScore
    if (Math.abs(gap) <= 12) {
      calibration = {
        agrees: true,
        message: `Your declared confidence (${declaredConfidence}) lines up with how you're actually performing here.`,
        ctaDifficulty: 'hard',
      }
    } else if (gap < -12) {
      calibration = {
        agrees: false,
        message: `You said you felt "${declaredConfidence}" on this topic, but your measured mastery (${score}) is running behind that. Worth a closer look.`,
        ctaDifficulty: 'medium',
      }
    } else {
      calibration = {
        agrees: false,
        message: `You're outperforming your declared "${declaredConfidence}" confidence — measured mastery is ${score}. You may be more ready here than you think.`,
        ctaDifficulty: 'hard',
      }
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      {hasMastery && <MasteryLevelUp topicId={t.id} label={masteryLabel(score)} />}
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/home" className="font-sans text-sm transition" style={{ color: 'var(--text-secondary)' }}>
            ← Dashboard
          </Link>
          {dueCount > 0 && (
            <span
              className="font-sans text-xs px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(200,146,42,0.12)',
                border: '1px solid rgba(200,146,42,0.35)',
                color: 'var(--amber-text)',
              }}
            >
              {dueCount} due for review
            </span>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-6">

        {/* Topic header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Badge variant={t.paper}>{t.paper}</Badge>
          </div>
          <h1 className="font-serif mb-4" style={{ fontSize: '2.25rem', color: 'var(--text-primary)', lineHeight: 1.1 }}>
            {t.name}
          </h1>
          <div className="flex items-center gap-4 mb-2">
            <MasteryBar score={score} className="flex-1 max-w-xs" />
            <span
              className="font-serif text-2xl tabular-nums"
              style={{ color: hasMastery ? getMasteryColor(score) : 'var(--text-muted)' }}
            >
              {score}
            </span>
          </div>
          <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            {masteryLabel(score)}
          </p>
        </div>

        {/* Confidence calibration */}
        {calibration && (
          <div
            style={{
              background: calibration.agrees ? 'rgba(76,175,130,0.06)' : 'rgba(200,146,42,0.06)',
              border: `1px solid ${calibration.agrees ? 'rgba(76,175,130,0.25)' : 'rgba(200,146,42,0.3)'}`,
              borderRadius: 12,
              padding: '16px 18px',
            }}
            className="flex items-center justify-between gap-4 flex-wrap"
          >
            <p className="font-sans text-sm flex-1 min-w-[200px]" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {calibration.agrees ? '✓ ' : '⚡ '}{calibration.message}
            </p>
            <Link
              href={`/study/drill?topics=${t.id}${calibration.ctaDifficulty !== 'any' ? `&difficulty=${calibration.ctaDifficulty}` : ''}`}
              style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '9px 18px',
                borderRadius: 8,
                whiteSpace: 'nowrap',
              }}
            >
              Let&apos;s test that
            </Link>
          </div>
        )}

        {/* Quick launch */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/study/drill?topics=${t.id}`}
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '18px 20px 14px',
              display: 'block',
              transition: 'all 150ms ease',
            }}
            className="card-glow card-glow-hover"
          >
            <h3 className="font-serif text-xl mb-1" style={{ color: 'var(--text-primary)' }}>
              Topic Drill
            </h3>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Practice MCQs on {t.name}
            </p>
            <p className="font-mono text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              {totalAvailable} questions available
            </p>
          </Link>
          <Link
            href={`/study/recall?topics=${t.id}`}
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '18px 20px 14px',
              display: 'block',
              transition: 'all 150ms ease',
            }}
            className="card-glow card-glow-hover"
          >
            <h3 className="font-serif text-xl mb-1" style={{ color: 'var(--text-primary)' }}>
              Active Recall
            </h3>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Flashcard rule review
            </p>
            <p className="font-mono text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              Quick rule memorisation
            </p>
          </Link>
        </div>

        <div className="flex justify-end">
          <RequestContentButton topicId={t.id} topicName={t.name} />
        </div>

        {/* Difficulty breakdown */}
        {mastery && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '20px 24px',
            }}
            className="card-glow"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                Performance by Difficulty
              </h2>
              {trendDelta !== null && (
                <span
                  className="font-sans text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: trendDelta >= 0 ? 'rgba(76,175,130,0.12)' : 'rgba(224,90,90,0.12)',
                    color: trendDelta >= 0 ? 'var(--status-correct)' : 'var(--status-wrong)',
                    border: `1px solid ${trendDelta >= 0 ? 'rgba(76,175,130,0.30)' : 'rgba(224,90,90,0.30)'}`,
                  }}
                >
                  {trendDelta >= 0 ? '↑' : '↓'} {Math.abs(trendDelta)}% recent trend
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              {(['easy', 'medium', 'hard'] as const).map(d => {
                const correct = mastery[`${d}_correct`]
                const total = mastery[`${d}_total`]
                const pct = total > 0 ? Math.round((correct / total) * 100) : 0
                const barColor = pct >= 70 ? 'var(--status-correct)' : pct >= 40 ? 'var(--status-warning)' : 'var(--status-wrong)'
                return (
                  <div key={d}>
                    <div className="flex items-center justify-between mb-1.5">
                      <Badge variant={d}>{d}</Badge>
                      <span
                        className="font-mono text-xs tabular-nums"
                        style={{ color: total > 0 ? barColor : 'var(--text-muted)' }}
                      >
                        {total > 0 ? `${pct}%` : '—'}
                      </span>
                    </div>
                    <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface-3)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: barColor }}
                      />
                    </div>
                    <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      {correct}/{total} correct
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Stats row */}
            <div
              className="flex items-center gap-6 pt-4 flex-wrap"
              style={{ borderTop: '1px solid var(--surface-border)' }}
            >
              <StatPill label="Attempted" value={`${questionsAttempted}/${totalAvailable}`} />
              {recentRate !== null && <StatPill label="Last 10 answers" value={`${recentRate}%`} highlight />}
              {mastery.last_visited_at && (
                <StatPill
                  label="Last visited"
                  value={new Date(mastery.last_visited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                />
              )}
              {dueCount > 0 && (
                <StatPill label="Due for review" value={`${dueCount}`} amber />
              )}
            </div>
          </div>
        )}

        {/* Knowledge coverage by subtopic */}
        {coverageRows.length > 0 && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '20px 24px',
            }}
            className="card-glow"
          >
            <h2 className="font-serif text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
              Knowledge Coverage
            </h2>
            <p className="font-sans text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
              How much you&apos;ve practised each part of this topic — fainter rows mean less coverage
            </p>
            <div className="space-y-2.5">
              {coverageRows.map(row => (
                <div
                  key={row.section}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
                  style={{
                    background: 'var(--surface-2)',
                    opacity: 0.35 + row.coverage * 0.65,
                  }}
                >
                  <p
                    className="font-sans text-sm truncate"
                    style={{ color: 'var(--text-primary)' }}
                    title={row.section}
                  >
                    {row.section}
                  </p>
                  <span
                    className="font-mono text-[11px] shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {row.attemptedChunks}/{row.totalChunks} rules practised
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weaknesses */}
        {weaknesses.length > 0 && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
            className="card-glow"
          >
            <div className="p-5 pb-3 flex items-center gap-2">
              <span style={{ fontSize: 16 }}>⚠</span>
              <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                Weaknesses
              </h2>
              <span className="font-sans text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
                Questions you keep getting wrong
              </span>
            </div>
            <div>
              {weaknesses.map((p, i) => (
                <QuestionPerfRow key={p.question_id} perf={p} index={i} type="weakness" />
              ))}
            </div>
          </div>
        )}

        {/* Strengths */}
        {strengths.length > 0 && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
            className="card-glow"
          >
            <div className="p-5 pb-3 flex items-center gap-2">
              <span style={{ fontSize: 16 }}>✓</span>
              <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                Strengths
              </h2>
              <span className="font-sans text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
                Questions you consistently nail
              </span>
            </div>
            <div>
              {strengths.map((p, i) => (
                <QuestionPerfRow key={p.question_id} perf={p} index={i} type="strength" />
              ))}
            </div>
          </div>
        )}

        {/* No history yet */}
        {!mastery && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px dashed rgba(255,255,255,0.10)',
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
            }}
          >
            <p className="font-serif text-xl mb-2" style={{ color: 'var(--text-muted)' }}>
              No attempts yet
            </p>
            <p className="font-sans text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Complete a drill session to start tracking your performance on this topic.
            </p>
            <Link
              href={`/study/drill?topics=${t.id}`}
              style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '9px 20px',
                borderRadius: 8,
                display: 'inline-block',
              }}
            >
              Start drilling →
            </Link>
          </div>
        )}

      </div>
    </main>
  )
}

function StatPill({ label, value, highlight, amber }: {
  label: string
  value: string
  highlight?: boolean
  amber?: boolean
}) {
  return (
    <div className="text-center">
      <p
        className="font-mono text-sm tabular-nums font-medium"
        style={{
          color: amber ? 'var(--amber-text)' : highlight ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {value}
      </p>
      <p className="font-sans text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
    </div>
  )
}

function QuestionPerfRow({ perf, index, type }: {
  perf: QuestionPerf
  index: number
  type: 'weakness' | 'strength'
}) {
  const pct = Math.round(perf.rate * 100)
  const isWeakness = type === 'weakness'

  const barColor = isWeakness
    ? (pct < 40 ? 'var(--status-wrong)' : 'var(--status-warning)')
    : 'var(--status-correct)'

  return (
    <div
      className="px-5 py-3.5 flex items-center gap-4"
      style={{
        borderTop: index > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {/* Rank */}
      <span
        className="font-mono text-xs shrink-0"
        style={{ width: 16, color: 'var(--text-muted)', textAlign: 'center' }}
      >
        {index + 1}
      </span>

      {/* Prompt truncated */}
      <div className="flex-1 min-w-0">
        <p
          className="font-sans text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
          title={perf.prompt}
        >
          {perf.prompt.length > 80 ? perf.prompt.slice(0, 80) + '…' : perf.prompt}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {perf.difficulty && <Badge variant={perf.difficulty as 'easy' | 'medium' | 'hard'}>{perf.difficulty}</Badge>}
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {perf.correct}/{perf.attempts} correct
          </span>
        </div>
      </div>

      {/* Bar + pct */}
      <div className="shrink-0 text-right" style={{ width: 64 }}>
        <p className="font-mono text-sm tabular-nums font-medium" style={{ color: barColor }}>
          {pct}%
        </p>
        <div className="rounded-full overflow-hidden mt-1" style={{ height: 3, background: 'var(--surface-3)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
        </div>
      </div>
    </div>
  )
}
