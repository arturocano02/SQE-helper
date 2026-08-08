import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { Session, Topic } from '@/types/database'
import SessionCelebration from '@/components/study/SessionCelebration'

type Tier = 'excellent' | 'good' | 'building' | 'needsWork'

const MESSAGES: Record<Tier, { emoji: string; headlines: string[]; subtext: string[] }> = {
  excellent: {
    emoji: '🎉',
    headlines: ['Outstanding!', "You're on fire!", 'Incredible work!', 'Nailed it!', 'Phenomenal session!'],
    subtext: [
      "This is exactly the kind of performance that gets you through SQE1. Keep this momentum going!",
      "You clearly know this material cold. Maybe it's time to tackle a tougher topic?",
      "That's SQE1-ready form right there. Brilliant stuff.",
      "You're making this look easy. Keep stacking sessions like this one.",
    ],
  },
  good: {
    emoji: '⭐',
    headlines: ['Great session!', 'Nice work!', 'Solid performance!', "You're getting there!", 'Well played!'],
    subtext: [
      "You're well on your way — a bit more practice and this'll be second nature.",
      "Strong showing. Keep chipping away at the ones you missed and you'll be unstoppable.",
      "You're clearly building real understanding here. Keep it up.",
      "Really solid. A couple more rounds on this topic and you'll be in excellent tier.",
    ],
  },
  building: {
    emoji: '💪',
    headlines: ['Good effort!', 'Keep going!', "You're building it!", 'Progress, not perfection!'],
    subtext: [
      "Every session like this is moving you closer to mastery. Don't stop now.",
      "This is exactly how mastery gets built — one session at a time.",
      "You're doing the work that pays off later. Keep showing up, it adds up fast.",
      "Solid foundation forming here. A few more drills and this'll click into place.",
    ],
  },
  needsWork: {
    emoji: '🌱',
    headlines: ['You showed up — that\'s what counts!', 'Every rep counts!', 'This is how you improve!', 'Keep pushing!'],
    subtext: [
      "Tough topics feel hard right up until they don't. Drill this again and watch it click.",
      "Nobody masters SQE1 without sessions like this one. Onward!",
      "This is the least fun part of studying and the most important part. Proud of you for doing it.",
      "Every expert was once a beginner at exactly this. Keep going — you've got this.",
    ],
  },
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

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

  const tier: Tier = pct >= 90 ? 'excellent' : pct >= 70 ? 'good' : pct >= 50 ? 'building' : 'needsWork'
  const grade =
    tier === 'excellent' ? { label: 'Excellent', color: 'var(--status-correct)', bg: 'rgba(76,175,130,0.08)', borderColor: 'rgba(76,175,130,0.25)' } :
    tier === 'good'      ? { label: 'Good', color: 'var(--status-warning)', bg: 'rgba(200,146,42,0.08)', borderColor: 'rgba(200,146,42,0.25)' } :
    tier === 'building'  ? { label: 'Building', color: 'var(--amber-text)', bg: 'var(--amber-soft)', borderColor: 'rgba(200,146,42,0.35)' } :
                            { label: 'Needs work', color: 'var(--status-wrong)', bg: 'rgba(224,90,90,0.08)', borderColor: 'rgba(224,90,90,0.25)' }

  const { emoji, headlines, subtext } = MESSAGES[tier]
  const headline = pick(headlines)
  const encouragement = pick(subtext)

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-5 py-12"
      style={{ background: 'var(--surface-base)' }}
    >
      <SessionCelebration pct={pct} />
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
            animation: 'summary-pop-in 480ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
          className="card-glow"
        >
          <p
            className="font-sans text-[10px] uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Session complete
          </p>

          {/* Emoji + headline */}
          <div
            style={{
              fontSize: 36,
              lineHeight: 1,
              marginBottom: 6,
              animation: 'summary-bounce 900ms ease-in-out 480ms both',
            }}
          >
            {emoji}
          </div>
          <p
            className="font-serif text-2xl font-semibold mb-4"
            style={{ color: grade.color }}
          >
            {headline}
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

        {/* Encouragement — always present, always positive, tone scales with tier */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 10,
            padding: '16px 18px',
            animation: 'summary-fade-in 400ms ease-out 300ms both',
          }}
        >
          <p
            className="font-sans text-sm leading-relaxed text-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            {encouragement}
          </p>
        </div>

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
      </div>

      <style>{`
        @keyframes summary-pop-in {
          0% { opacity: 0; transform: translateY(12px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes summary-bounce {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.15); opacity: 1; }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        @keyframes summary-fade-in {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  )
}
