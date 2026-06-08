import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { SourceMaterial, Topic } from '@/types/database'
import SourceMaterialRow from '@/components/admin/SourceMaterialRow'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/home')

  const admin = await createAdminClient()

  // Fetch analytics data in parallel
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

  // Questions per topic
  const { data: qPerTopic } = await admin
    .from('questions')
    .select('topic_id, status')
    .eq('status', 'approved')

  const topicQMap = new Map<string, number>()
  ;(qPerTopic ?? []).forEach((q: { topic_id: string | null }) => {
    if (q.topic_id) topicQMap.set(q.topic_id, (topicQMap.get(q.topic_id) ?? 0) + 1)
  })

  // Correct rate from recent activity
  const recent = (recentActivity ?? []) as Array<{ was_correct: boolean }>
  const recentCorrect = recent.filter(r => r.was_correct).length
  const recentRate = recent.length > 0 ? Math.round((recentCorrect / recent.length) * 100) : null

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-primary">Admin Dashboard</h1>
            <p className="text-secondary text-sm">Content management &amp; analytics</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/content/upload" className="bg-accent text-bg font-medium px-4 py-2 rounded text-sm hover:opacity-90 transition">
              Upload Source Material
            </Link>
            <Link href="/admin/content/questions" className="border border-border text-secondary px-4 py-2 rounded text-sm hover:bg-surface2 transition">
              Question Bank
            </Link>
            <Link href="/home" className="text-secondary text-sm hover:text-primary transition">← Home</Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">

        {/* ── Analytics ── */}
        <section>
          <h2 className="font-serif text-2xl text-primary mb-5">Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Users" value={totalUsers ?? 0} />
            <StatCard label="Sessions Completed" value={totalSessions ?? 0} />
            <StatCard label="Answers Given" value={totalAnswers ?? 0} />
            <StatCard
              label="Recent Correct Rate"
              value={recentRate !== null ? `${recentRate}%` : '—'}
              sub={`last ${recent.length} answers`}
            />
          </div>
        </section>

        {/* Question bank stats */}
        <section>
          <h2 className="font-serif text-2xl text-primary mb-5">Question Bank</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard label="Total Questions" value={totalQuestions ?? 0} />
            <StatCard label="Approved" value={approvedQuestions ?? 0} accent />
            <StatCard label="Awaiting Review" value={draftQuestions ?? 0} warning={!!draftQuestions} />
          </div>

          {/* Questions per topic */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-secondary text-sm">Approved questions by topic</p>
            </div>
            <div className="divide-y divide-border/50">
              {((topics ?? []) as Array<{ id: string; name: string; paper: string }>).map(t => {
                const count = topicQMap.get(t.id) ?? 0
                const maxCount = Math.max(...Array.from(topicQMap.values()), 1)
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={t.id} className="px-4 py-3 flex items-center gap-4">
                    <span className={`text-xs border rounded px-1.5 py-0.5 shrink-0 ${
                      t.paper === 'FLK1' ? 'border-accent/50 text-accent' : 'border-secondary/50 text-secondary'
                    }`}>{t.paper}</span>
                    <span className="text-sm text-primary w-52 shrink-0 truncate">{t.name}</span>
                    <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${count > 0 ? 'bg-accent' : 'bg-muted'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-sm tabular-nums text-secondary w-8 text-right">{count}</span>
                    <Link
                      href={`/admin/content/questions`}
                      className="text-xs text-muted hover:text-secondary transition"
                    >
                      view →
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>

          {(draftQuestions ?? 0) > 0 && (
            <div className="mt-4 flex items-center justify-between p-4 bg-warning/5 border border-warning/20 rounded-lg">
              <p className="text-warning text-sm">
                <strong>{draftQuestions}</strong> question{draftQuestions !== 1 ? 's' : ''} pending review
              </p>
              <Link
                href="/admin/content/questions"
                className="bg-warning/20 text-warning px-3 py-1.5 rounded text-xs hover:bg-warning/30 transition"
              >
                Review now →
              </Link>
            </div>
          )}
        </section>

        {/* ── Source Materials ── */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-serif text-2xl text-primary">Source Materials</h2>
              <p className="text-secondary text-sm mt-0.5">
                {(sourceMaterials ?? []).length} file{sourceMaterials?.length !== 1 ? 's' : ''} uploaded —
                questions are generated once and shared across all users
              </p>
            </div>
            <Link
              href="/admin/content/upload"
              className="bg-accent text-bg font-medium px-4 py-2 rounded text-sm hover:opacity-90 transition"
            >
              + Upload New
            </Link>
          </div>

          {sourceMaterials && sourceMaterials.length > 0 ? (
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-4 text-left text-secondary font-normal">File</th>
                    <th className="p-4 text-left text-secondary font-normal">Type</th>
                    <th className="p-4 text-left text-secondary font-normal">Status</th>
                    <th className="p-4 text-left text-secondary font-normal">Progress</th>
                    <th className="p-4 text-left text-secondary font-normal">Questions</th>
                    <th className="p-4 text-left text-secondary font-normal">Uploaded</th>
                    <th className="p-4 text-left text-secondary font-normal w-10"></th>
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
            <div className="bg-surface border border-border border-dashed rounded-lg p-12 text-center">
              <p className="text-secondary mb-2">No source material uploaded yet</p>
              <p className="text-muted text-sm mb-6">
                Upload your FLK1 and FLK2 notes to generate the question bank
              </p>
              <Link
                href="/admin/content/upload"
                className="bg-accent text-bg font-medium px-5 py-2.5 rounded hover:opacity-90 transition"
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
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <p className="text-secondary text-xs mb-1 uppercase tracking-wide">{label}</p>
      <p className={`font-serif text-3xl ${accent ? 'text-accent' : warning ? 'text-warning' : 'text-primary'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-muted text-xs mt-1">{sub}</p>}
    </div>
  )
}
