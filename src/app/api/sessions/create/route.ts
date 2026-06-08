import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { SessionMode, Difficulty } from '@/types/database'

interface CreateSessionBody {
  mode: SessionMode
  topic_ids: string[]
  difficulty?: Difficulty
  count?: number
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: CreateSessionBody = await request.json()
  const { mode, topic_ids, difficulty, count = 25 } = body

  if (!topic_ids || topic_ids.length === 0) {
    return NextResponse.json({ error: 'No topics selected' }, { status: 400 })
  }

  const admin = await createAdminClient()

  // Build question query
  let query = admin
    .from('questions')
    .select('id, topic_id')
    .in('topic_id', topic_ids)
    .eq('status', 'approved')
    .eq('type', mode === 'recall' ? 'flashcard' : 'mcq')

  if (difficulty) {
    query = query.eq('difficulty', difficulty)
  }

  const { data: allQuestions } = await query

  if (!allQuestions || allQuestions.length === 0) {
    return NextResponse.json({ error: 'No approved questions found for these topics' }, { status: 404 })
  }

  // SRS ordering: due questions first, then unseen, then seen-but-not-due
  const { data: srsData } = await supabase
    .from('user_question_srs')
    .select('question_id, next_review_at')
    .eq('user_id', user.id)
    .in('question_id', allQuestions.map(q => q.id))

  const srsMap = new Map((srsData ?? []).map(s => [s.question_id, new Date(s.next_review_at)]))
  const now = new Date()

  const due = allQuestions.filter(q => {
    const t = srsMap.get(q.id)
    return t && t <= now
  })
  const unseen = allQuestions.filter(q => !srsMap.has(q.id))
  const notDue = allQuestions.filter(q => {
    const t = srsMap.get(q.id)
    return t && t > now
  })

  // Shuffle each bucket
  function shuffle<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5)
  }

  const ordered = [...shuffle(due), ...shuffle(unseen), ...shuffle(notDue)]
  const selected = ordered.slice(0, count)

  // Create session
  const { data: session, error } = await supabase
    .from('sessions')
    .insert({
      user_id: user.id,
      mode,
      topic_ids,
      question_ids: selected.map(q => q.id),
      total_questions: selected.length,
      current_question_index: 0,
      correct_count: 0,
      is_complete: false,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ session_id: session.id })
}
