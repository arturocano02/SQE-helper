import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Session, Topic } from '@/types/database'

export default async function SessionSummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: session } = await supabase
    .from('sessions').select('*').eq('id', sessionId).eq('user_id', user.id).single()
  if (!session) redirect('/home')

  const s = session as Session
  const total = s.total_questions ?? 0
  const correct = s.correct_count ?? 0
  const wrong = total - correct
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0

  const { data: topicsData } = await supabase
    .from('topics').select('id, name').in('id', s.topic_ids ?? [])
  const topicNames = (topicsData ?? []).map((t: Pick<Topic, 'id' | 'name'>) => t.name).join(' · ')

  const grade =
    pct >= 90 ? { label: 'Excellent', color: 'var(--status-correct)',  bg: 'rgba(76,175,130,0.08)',  borderColor: 'rgba(76,175,130,0.25)' } :
    pct >= 70 ? { label: 'Good',      color: 'var(--status-warning)',  bg: 'rgba(200,146,42,0.08)',  borderColor: 'rgba(200,146,42,0.25)' } :
    pct >= 50 ? { label: 'Building',  color: 'var(--amber-text)',      bg: 'var(--amber-soft)',       borderColor: 'rgba(200,146,42,0.35)' } :
                { label: 'Needs work', color: 'var(--status-wrong)',   bg: 'rgba(224,90,90,0.08)',   borderColor: 'rgba(224,90,90,0.25)' }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-5 py-12"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="max-w-sm w-full space-y-4">

        {/* Score card */}
        <div
          style={{
            background: grade.bg,
            border: `1px solid ${grade.borderColor}`,
            borderTop: `3px solid ${grade.color}`,
            borderRadius: 16,
            padding: '36px 32px 28px',
            textAlign: 'center',
          }}
          className="card-glow"
        >
          <p
            className="font-sans text-[10px] uppercase tracking-widest mb-5"
            style={{ color: 'var(--text-muted)' }}
          >
            Session complete
          </p>

          {/* Big score */}
          <div
            className="font-serif tabular-nums mb-1"
            style={{ fontSize: '5rem', lineHeight: 1, color: grade.color, fontWeight: 600 }}
          >
            {pct}%
          </div>
          <p
            className="font-sans text-lg font-medium mb-6"
            style={{ color: grade.color }}
          >
            {grade.label}
          </p>

          {/* Stats row */}
          <div
            className="flex items-center justify-center gap-6 pt-5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="text-center">
              <p
                className="font-serif text-2xl tabular-nums"
                style={{ color: 'var(--status-correct)' }}
              >
                {correct}
              </p>
              <p
                className="font-sans text-[11px] mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Correct
              </p>
            </div>
            <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.07)' }} />
            <div className="text-center">
              <p
                className="font-serif text-2xl tabular-nums"
                style={{ color: 'var(--status-wrong)' }}
              >
                {wrong}
              </p>
              <p
                className="font-sans text-[11px] mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Wrong
              </p>
            </div>
            <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.07)' }} />
            <div className="text-center">
              <p
                className="font-serif text-2xl tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {total}
              </p>
              <p
                className="font-sans text-[11px] mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                Total
              </p>
            </div>
          </div>
        </div>

        {topicNames && (
          <p
            className="font-sans text-xs text-center px-2"
            style={{ color: 'var(--text-muted)' }}
          >
            {topicNames}
          </p>
        )}

        {/* Actions — primary then secondary, stacked */}
        <div className="space-y-2.5">
          <Link
            href="/study/drill"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'center',
              background: 'var(--amber)',
              color: '#0A0A08',
              fontFamily: 'var(--font-dm-sans)',
              fontWeight: 500,
              fontSize: 14,
              padding: '14px 24px',
              borderRadius: 8,
              transition: 'all 150ms ease',
            }}
            className="hover:brightness-110 active:scale-[0.98]"
          >
            Start another session
          </Link>
          <Link
            href="/home"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'center',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: 14,
              padding: '14px 24px',
              borderRadius: 8,
              border: '1px solid rgba(200,146,42,0.25)',
              transition: 'all 150ms ease',
            }}
            className="hover:border-[rgba(200,146,42,0.4)] hover:text-[var(--amber-text)] hover:bg-[var(--amber-glow)]"
          >
            Back to dashboard
          </Link>
        </div>

        {/* Low score encouragement */}
        {pct < 70 && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 10,
              padding: '16px 18px',
            }}
          >
            <p
              className="font-sans text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {pct < 50
                ? 'These topics need more work. Try drilling them again — repetition is how SQE1 knowledge sticks.'
                : 'Getting there. Focus on the questions you got wrong and revisit this topic in a day or two.'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
