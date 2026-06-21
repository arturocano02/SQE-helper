import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import QuestionTable from '@/components/admin/QuestionTable'
import RebalanceButton from '@/components/admin/RebalanceButton'
import type { Question, Topic } from '@/types/database'
import Link from 'next/link'

export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/home')

  const [{ data: questions }, { data: topics }] = await Promise.all([
    supabase.from('questions').select('*').order('created_at', { ascending: false }),
    supabase.from('topics').select('*').order('sort_order'),
  ])

  const totalQ = (questions ?? []).length
  const approvedQ = (questions ?? []).filter(q => q.status === 'approved').length
  const draftQ = (questions ?? []).filter(q => q.status === 'draft').length

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Question Bank</h1>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {totalQ} total · {approvedQ} approved · {draftQ} awaiting review
            </p>
          </div>
          <Link href="/admin" className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            ← Dashboard
          </Link>
        </div>

        {/* Content pipeline */}
        <div
          className="flex items-stretch gap-0 mb-8 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--surface-border)' }}
        >
          {[
            {
              step: '1',
              label: 'Upload',
              description: 'Add source notes or sample papers',
              href: '/admin/content/upload',
              active: false,
            },
            {
              step: '2',
              label: 'Extract chunks',
              description: 'Pull legal rules from the source',
              href: '/admin/content/chunks',
              active: false,
            },
            {
              step: '3',
              label: 'Generate content',
              description: 'Turn approved chunks into MCQs or flashcards',
              href: '/admin/content/generate',
              active: false,
            },
            {
              step: '4',
              label: 'Review & approve',
              description: 'You are here — review drafts',
              href: '/admin/content/questions',
              active: true,
            },
          ].map((s, i, arr) => (
            <Link
              key={s.step}
              href={s.href}
              className="flex-1 flex items-start gap-3 px-4 py-3 transition"
              style={{
                background: s.active ? 'rgba(200,146,42,0.08)' : 'var(--surface-1)',
                borderRight: i < arr.length - 1 ? '1px solid var(--surface-border)' : 'none',
                textDecoration: 'none',
              }}
            >
              <span
                className="font-serif text-lg shrink-0 mt-0.5"
                style={{ color: s.active ? 'var(--amber-text)' : 'var(--text-muted)' }}
              >
                {s.step}
              </span>
              <div>
                <p
                  className="font-sans text-sm font-medium"
                  style={{ color: s.active ? 'var(--amber-text)' : 'var(--text-primary)' }}
                >
                  {s.label}
                </p>
                <p className="font-sans text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {s.description}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {draftQ > 0 && (
          <div
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl mb-6"
            style={{
              background: 'rgba(200,146,42,0.06)',
              border: '1px solid rgba(200,146,42,0.20)',
            }}
          >
            <p className="font-sans text-sm" style={{ color: 'var(--amber-text)' }}>
              {draftQ} draft item{draftQ !== 1 ? 's' : ''} (questions or flashcards) waiting for your review — approve or archive them below.
            </p>
            <Link
              href="/admin/content/generate"
              className="font-sans text-xs shrink-0 transition"
              style={{ color: 'var(--text-secondary)' }}
            >
              Generate more →
            </Link>
          </div>
        )}

        {totalQ === 0 && (
          <div
            className="flex flex-col items-center justify-center py-16 rounded-xl mb-6"
            style={{
              background: 'var(--surface-1)',
              border: '1px dashed rgba(255,255,255,0.08)',
            }}
          >
            <p className="font-serif text-xl mb-1" style={{ color: 'var(--text-muted)' }}>
              No questions yet
            </p>
            <p className="font-sans text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Upload source material, extract knowledge chunks, then generate questions from them.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="/admin/content/upload"
                style={{
                  background: 'var(--amber)',
                  color: '#0A0A08',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 600,
                  fontSize: 13,
                  padding: '8px 18px',
                  borderRadius: 8,
                }}
              >
                Upload source material →
              </Link>
              <Link
                href="/admin/content/generate"
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 13,
                  padding: '8px 18px',
                  borderRadius: 8,
                  border: '1px solid var(--surface-border)',
                }}
              >
                Generate from chunks →
              </Link>
            </div>
          </div>
        )}

        <RebalanceButton />

        <QuestionTable
          questions={(questions ?? []) as Question[]}
          topics={(topics ?? []) as Topic[]}
        />
      </div>
    </main>
  )
}
