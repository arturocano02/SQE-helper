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
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single()

  if (!session) redirect('/home')

  const s = session as Session
  const total = s.total_questions ?? 0
  const correct = s.correct_count ?? 0
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0

  // Get topic names
  const { data: topicsData } = await supabase
    .from('topics')
    .select('id, name')
    .in('id', s.topic_ids ?? [])

  const topicNames = (topicsData ?? []).map((t: Pick<Topic, 'id' | 'name'>) => t.name).join(', ')

  const grade =
    pct >= 90 ? { label: 'Excellent', color: 'text-success' } :
    pct >= 70 ? { label: 'Good', color: 'text-warning' } :
    pct >= 50 ? { label: 'Building', color: 'text-accent' } :
               { label: 'Needs work', color: 'text-error' }

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="bg-surface border border-border rounded-lg p-8 mb-6">
          <p className="text-secondary text-sm mb-2 uppercase tracking-widest font-sans">Session Complete</p>
          <div className={`font-serif text-7xl font-semibold mb-1 ${grade.color}`}>{pct}%</div>
          <p className={`text-lg mb-1 ${grade.color}`}>{grade.label}</p>
          <p className="text-secondary text-sm">{correct} of {total} correct</p>

          {topicNames && (
            <p className="text-muted text-xs mt-3">{topicNames}</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/study/drill"
            className="bg-accent text-bg font-medium py-3 rounded hover:opacity-90 transition text-center"
          >
            Start Another Session
          </Link>
          <Link
            href="/home"
            className="border border-border text-secondary py-3 rounded hover:bg-surface2 transition text-center"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
