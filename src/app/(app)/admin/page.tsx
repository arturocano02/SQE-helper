import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import type { SourceMaterial, Topic } from '@/types/database'
import SourceMaterialRow from '@/components/admin/SourceMaterialRow'
import BulkApproveButton from '@/components/admin/BulkApproveButton'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const admin = createAdminClient()

  const [
    { count: totalUsers },
    { count: totalQuestions },
    { count: approvedQuestions },
    { count: draftQuestions },
    { count: totalSessions },
    { count: totalAnswers },
    { data: sourceMaterials },
    { data: topics },
    { data: recentActivity },
  ] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }),
    admin.from('questions').select('*', { count: 'exact', head: true }),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    admin.from('sessions').select('*', { count: 'exact', head: true }).eq('is_complete', true),
    admin.from('question_history').select('*', { count: 'exact', head: true }),
    admin.from('source_materials').select('*').order('created_at', { ascending: false }),
    admin.from('topics').select('id, name, paper').order('sort_order'),
    admin.from('question_history')
      .select('answered_at, was_correct')
      .order('answered_at', { ascending: false })
      .limit(100),
  ])

  const [
    { count: totalChunks },
    { count: approvedChunks },
    { count: pendingFeedback },
    { count: pendingContentRequests },
    { count: totalMcq },
    { count: approvedMcq },
    { count: totalFlashcards },
    { count: approvedFlashcards },
  ] = await Promise.all([
    admin.from('knowledge_chunks').select('*', { count: 'exact', head: true }),
    admin.from('knowledge_chunks').select('*', { count: 'exact', head: true }).eq('is_approved', true),
    admin.from('feedback').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('content_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('type', 'mcq'),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('type', 'mcq').eq('status', 'approved'),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('type', 'flashcard'),
    admin.from('questions').select('*', { count: 'exact', head: true }).eq('type', 'flashcard').eq('status', 'approved'),
  ])

  const { data: qPerTopic } = await admin
    .from('questions')
    .select('topic_id, status, type')
    .eq('status', 'approved')

  const topicMcqMap = new Map<string, number>()
  const topicFlashcardMap = new Map<string, number>()
  ;(qPerTopic ?? []).forEach((q: { topic_id: string | null; type: 'mcq' | 'flashcard' }) => {
    if (!q.topic_id) return
    if (q.type === 'mcq') topicMcqMap.set(q.topic_id, (topicMcqMap.get(q.topic_id) ?? 0) + 1)
    else topicFlashcardMap.set(q.topic_id, (topicFlashcardMap.get(q.topic_id) ?? 0) + 1)
  })

  // Aggregate (all-users) answered count per topic — how much of the bank has actually been used.
  const { data: answersWithTopic } = await admin
    .from('question_history')
    .select('questions!inner(topic_id)')
    .limit(20000)
  const topicAnsweredMap = new Map<string, number>()
  ;(answersWithTopic ?? []).forEach((row: { questions: { topic_id: string | null } | { topic_id: string | null }[] }) => {
    const q = Array.isArray(row.questions) ? row.questions[0] : row.questions
    const topicId = q?.topic_id
    if (topicId) topicAnsweredMap.set(topicId, (topicAnsweredMap.get(topicId) ?? 0) + 1)
  })

  const recent = (recentActivity ?? []) as Array<{ was_correct: boolean }>
  const recentCorrect = recent.filter(r => r.was_correct).length
  const recentRate = recent.length > 0 ? Math.round((recentCorrect / recent.length) * 100) : null

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
          <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            Content management &amp; analytics
          </p>
        </div>
        <Link
          href="/admin/content/upload"
          style={{
            background: 'var(--amber)',
            color: '#0A0A08',
            fontFamily: 'var(--font-dm-sans)',
            fontWeight: 500,
            fontSize: 13,
            padding: '8px 16px',
            borderRadius: 8,
            transition: 'all 150ms ease',
          }}
          className="hover:brightness-110 active:scale-[0.98]"
        >
          + Upload Source Material
        </Link>
        <div className="flex items-center gap-3">
          {(pendingFeedback ?? 0) > 0 && (
            <Link
              href="/admin/feedback"
              style={{
                background: 'rgba(248,113,113,0.12)',
                color: 'var(--status-error)',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(248,113,113,0.30)',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              className="hover:brightness-110"
            >
              <span style={{
                background: 'var(--status-error)',
                color: '#0A0A08',
                borderRadius: '50%',
                width: 18,
                height: 18,
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>{pendingFeedback}</span>
              Feedback
            </Link>
          )}
          {(pendingContentRequests ?? 0) > 0 && (
            <Link
              href="/admin/content-requests"
              style={{
                background: 'rgba(200,146,42,0.12)',
                color: 'var(--amber-text)',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid rgba(200,146,42,0.30)',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              className="hover:brightness-110"
            >
              <span style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                borderRadius: '50%',
                width: 18,
                height: 18,
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>{pendingContentRequests}</span>
              Content Requests
            </Link>
          )}
          <Link
            href="/admin/content/chunks"
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-dm-sans)',
              fontWeight: 500,
              fontSize: 13,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--surface-border)',
              transition: 'all 150ms ease',
            }}
            className="hover:brightness-110"
          >
            Knowledge Graph →
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-16 space-y-12">

        {/* Overview stats */}
        <section>
          <h2 className="font-serif text-xl mb-4" style={{ color: 'var(--text-primary)' }}>Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Users" value={totalUsers ?? 0} />
            <StatCard label="Sessions Completed" value={totalSessions ?? 0} />
            <StatCard label="Answers Given" value={totalAnswers ?? 0} />
            <StatCard
              label="Recent Correct Rate"
              value={recentRate !== null ? `${recentRate}%` : '—'}
              sub={`last ${recent.length} answers`}
              accent
            />
          </div>
        </section>

        {/* Knowledge graph */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Knowledge Graph</h2>
            <Link
              href="/admin/content/chunks"
              className="font-sans text-sm"
              style={{ color: 'var(--amber-text)' }}
            >
              View all chunks →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatCard label="Knowledge Chunks" value={totalChunks ?? 0} />
            <StatCard label="Approved Chunks" value={approvedChunks ?? 0} accent />
          </div>
          {(approvedChunks ?? 0) > 0 && (
            <Link
              href="/admin/content/generate"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(200,146,42,0.08)',
                color: 'var(--amber-text)',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '9px 16px',
                borderRadius: 8,
                border: '1px solid rgba(200,146,42,0.25)',
              }}
              className="hover:brightness-110 transition"
            >
              ✦ Generate questions or flashcards from chunks →
            </Link>
          )}
        </section>

        {/* Question bank */}
        <section>
          <h2 className="font-serif text-xl mb-4" style={{ color: 'var(--text-primary)' }}>Question Bank</h2>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <StatCard label="Total Questions" value={totalQuestions ?? 0} />
            <StatCard label="Approved" value={approvedQuestions ?? 0} accent />
            <StatCard label="Awaiting Review" value={draftQuestions ?? 0} warning={!!draftQuestions} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <StatCard label="MCQs" value={totalMcq ?? 0} sub={`${approvedMcq ?? 0} approved`} />
            <StatCard label="Flashcards" value={totalFlashcards ?? 0} sub={`${approvedFlashcards ?? 0} approved`} accent />
          </div>

          {/* Per-topic bars */}
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
            className="card-glow"
          >
            <div
              className="p-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--surface-border)' }}
            >
              <p
                className="font-sans text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                Approved content by topic
              </p>
              <div className="flex items-center gap-4">
                <span className="font-sans text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-primary)' }}>●</span> MCQ
                </span>
                <span className="font-sans text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--amber-text)' }}>●</span> Flashcard
                </span>
              </div>
            </div>
            <div>
              {((topics ?? []) as Array<{ id: string; name: string; paper: string }>).map(t => {
                const mcqCount = topicMcqMap.get(t.id) ?? 0
                const flashcardCount = topicFlashcardMap.get(t.id) ?? 0
                const answered = topicAnsweredMap.get(t.id) ?? 0
                return (
                  <div
                    key={t.id}
                    className="px-4 py-3 flex items-center gap-4"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span
                      className="text-[10px] font-sans rounded px-1.5 py-0.5 shrink-0"
                      style={{
                        border: t.paper === 'FLK1'
                          ? '1px solid rgba(200,146,42,0.4)'
                          : '1px solid rgba(154,149,144,0.4)',
                        color: t.paper === 'FLK1' ? 'var(--amber-text)' : 'var(--text-secondary)',
                      }}
                    >
                      {t.paper}
                    </span>
                    <span
                      className="font-sans text-sm shrink-0 truncate"
                      style={{ width: 180, color: 'var(--text-primary)' }}
                    >
                      {t.name}
                    </span>
                    <span
                      className="font-mono text-sm tabular-nums shrink-0"
                      style={{ color: 'var(--text-primary)', width: 60, textAlign: 'right' }}
                      title="Approved MCQs"
                    >
                      {mcqCount} mcq
                    </span>
                    <span
                      className="font-mono text-sm tabular-nums shrink-0"
                      style={{ color: 'var(--amber-text)', width: 90, textAlign: 'right' }}
                      title="Approved flashcards"
                    >
                      {flashcardCount} flash
                    </span>
                    <span
                      className="font-mono text-[11px] tabular-nums shrink-0 ml-auto"
                      style={{ color: 'var(--text-muted)', width: 90, textAlign: 'right' }}
                      title="Total answers given by all users for this topic"
                    >
                      {answered} answered
                    </span>
                    <Link
                      href="/admin/content/questions"
                      className="font-sans text-xs transition"
                      style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                    >
                      view →
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>

          {(draftQuestions ?? 0) > 0 && (
            <div
              className="mt-4 p-4"
              style={{
                background: 'rgba(200,146,42,0.06)',
                border: '1px solid rgba(200,146,42,0.20)',
                borderRadius: 12,
              }}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p
                  className="font-sans text-sm font-medium"
                  style={{ color: 'var(--amber-text)' }}
                >
                  {draftQuestions} draft question{draftQuestions !== 1 ? 's' : ''} awaiting review
                </p>
                <div className="flex items-center gap-2">
                  <BulkApproveButton count={draftQuestions ?? 0} />
                  <Link
                    href="/admin/content/questions"
                    className="font-sans text-xs transition"
                    style={{
                      border: '1px solid var(--surface-border)',
                      color: 'var(--text-secondary)',
                      padding: '6px 12px',
                      borderRadius: 6,
                    }}
                  >
                    Review individually →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Source materials */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
                Source Materials
              </h2>
              <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {(sourceMaterials ?? []).length} file{sourceMaterials?.length !== 1 ? 's' : ''} uploaded —
                questions are generated once and shared across all users
              </p>
            </div>
            <Link
              href="/admin/content/upload"
              style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 13,
                padding: '8px 16px',
                borderRadius: 8,
                transition: 'all 150ms ease',
              }}
              className="hover:brightness-110 active:scale-[0.98]"
            >
              + Upload New
            </Link>
          </div>

          {sourceMaterials && sourceMaterials.length > 0 ? (
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
                    {['File', 'Type', 'Status', 'Progress', 'Chunks', 'Uploaded', ''].map(h => (
                      <th
                        key={h}
                        className="p-4 text-left font-normal font-sans text-xs uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sourceMaterials as SourceMaterial[]).map(m => (
                    <SourceMaterialRow key={m.id} material={m} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--surface-1)',
                border: '1px dashed rgba(255,255,255,0.10)',
                borderRadius: 14,
                padding: '56px 24px',
                textAlign: 'center',
              }}
            >
              <p className="font-serif text-2xl mb-2" style={{ color: 'var(--text-muted)' }}>
                No source materials yet
              </p>
              <p className="font-sans text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                Upload your FLK1 and FLK2 notes to generate the question bank
              </p>
              <Link
                href="/admin/content/upload"
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
                Upload First File →
              </Link>
            </div>
          )}
        </section>

      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  sub,
  accent,
  warning,
}: {
  label: string
  value: number | string
  sub?: string
  accent?: boolean
  warning?: boolean
}) {
  const valueColor = accent
    ? 'var(--amber-text)'
    : warning
    ? 'var(--status-warning)'
    : 'var(--text-primary)'

  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 12,
        padding: '18px 20px',
      }}
      className="card-glow"
    >
      <p
        className="font-sans text-[10px] uppercase tracking-wider mb-1.5"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </p>
      <p
        className="font-serif text-3xl tabular-nums"
        style={{ color: valueColor }}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && (
        <p
          className="font-sans text-xs mt-1"
          style={{ color: 'var(--text-muted)' }}
        >
          {sub}
        </p>
      )}
    </div>
  )
}
