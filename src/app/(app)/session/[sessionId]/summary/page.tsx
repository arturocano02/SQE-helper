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
    pct >= 90 ? { label: 'Excellent', color: 'text-success', ring: 'ring-success/30', bg: 'bg-success/5' } :
    pct >= 70 ? { label: 'Good', color: 'text-warning', ring: 'ring-warning/30', bg: 'bg-warning/5' } :
    pct >= 50 ? { label: 'Building', color: 'text-accent', ring: 'ring-accent/30', bg: 'bg-accent-dim' } :
               { label: 'Needs work', color: 'text-error', ring: 'ring-error/30', bg: 'bg-error/5' }

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full space-y-4">

        {/* Score */}
        <div className={`${grade.bg} border ${grade.ring.replace('ring','border')} rounded-2xl p-8 text-center`}>
          <p className="text-secondary text-xs uppercase tracking-widest mb-4">Session complete</p>
          <div className={`font-serif text-8xl font-semibold mb-2 ${grade.color}`}>{pct}%</div>
          <p className={`text-xl font-medium mb-4 ${grade.color}`}>{grade.label}</p>

          {/* Stats row */}
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border/50">
            <div className="text-center">
              <p className="text-success font-serif text-2xl">{correct}</p>
              <p className="text-muted text-xs mt-0.5">Correct</p>
            </div>
            <div className="w-px h-8 bg-border/50" />
            <div className="text-center">
              <p className="text-error font-serif text-2xl">{wrong}</p>
              <p className="text-muted text-xs mt-0.5">Wrong</p>
            </div>
            <div className="w-px h-8 bg-border/50" />
            <div className="text-center">
              <p className="text-primary font-serif text-2xl">{total}</p>
              <p className="text-muted text-xs mt-0.5">Total</p>
            </div>
          </div>
        </div>

        {topicNames && (
          <p className="text-muted text-xs text-center px-2">{topicNames}</p>
        )}

        {/* Actions */}
        <div className="space-y-2.5">
          <Link href="/study/drill"
            className="block w-full bg-accent text-bg font-medium py-3.5 rounded-xl hover:opacity-90 transition text-center">
            Start another session
          </Link>
          <Link href="/home"
            className="block w-full border border-border text-secondary py-3.5 rounded-xl hover:bg-surface2 transition text-center">
            Back to dashboard
          </Link>
        </div>

        {/* Encouragement */}
        {pct < 70 && (
          <div className="bg-surface border border-border rounded-xl p-4 text-center">
            <p className="text-secondary text-sm">
              {pct < 50
                ? "These topics need more work. Try drilling them again — repetition is how SQE1 knowledge sticks."
                : "Getting there. Focus on the questions you got wrong and revisit this topic in a day or two."}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
