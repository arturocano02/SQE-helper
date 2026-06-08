import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { updateSrs, defaultSrsState } from '@/lib/srs'
import { calculateMasteryScore } from '@/lib/mastery'

interface AnswerBody {
  session_id: string
  question_id: string
  selected_answer: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: AnswerBody = await request.json()
  const { session_id, question_id, selected_answer } = body

  // Get question (use admin to bypass RLS on draft check edge cases)
  const admin = await createAdminClient()
  const { data: question } = await admin
    .from('questions')
    .select('correct_answer, explanation, difficulty, topic_id')
    .eq('id', question_id)
    .single()

  if (!question) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const was_correct = question.correct_answer === selected_answer

  // Record answer history
  await supabase.from('question_history').insert({
    user_id: user.id,
    question_id,
    session_id,
    was_correct,
    selected_answer,
    answered_at: new Date().toISOString(),
  })

  // Update session progress
  const { data: session } = await supabase
    .from('sessions')
    .select('current_question_index, correct_count, question_ids')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()

  if (session) {
    await supabase.from('sessions').update({
      current_question_index: (session.current_question_index ?? 0) + 1,
      correct_count: (session.correct_count ?? 0) + (was_correct ? 1 : 0),
    }).eq('id', session_id)
  }

  // Update SRS
  const { data: existingSrs } = await supabase
    .from('user_question_srs')
    .select('*')
    .eq('user_id', user.id)
    .eq('question_id', question_id)
    .single()

  const quality = was_correct ? 4 : 1
  const currentState = existingSrs ?? defaultSrsState()
  const newSrs = updateSrs(currentState, quality)

  await supabase.from('user_question_srs').upsert({
    user_id: user.id,
    question_id,
    next_review_at: newSrs.next_review_at.toISOString(),
    ease_factor: newSrs.ease_factor,
    interval_days: newSrs.interval_days,
    repetitions: newSrs.repetitions,
  })

  // Update mastery for topic
  if (question.topic_id && question.difficulty) {
    const { data: currentMastery } = await supabase
      .from('user_topic_mastery')
      .select('*')
      .eq('user_id', user.id)
      .eq('topic_id', question.topic_id)
      .single()

    const m = currentMastery ?? {
      user_id: user.id,
      topic_id: question.topic_id,
      mastery_score: 0,
      easy_correct: 0, easy_total: 0,
      medium_correct: 0, medium_total: 0,
      hard_correct: 0, hard_total: 0,
    }

    const diff = question.difficulty as 'easy' | 'medium' | 'hard'
    const updates = {
      ...m,
      [`${diff}_total`]: (m[`${diff}_total` as keyof typeof m] as number) + 1,
      [`${diff}_correct`]: (m[`${diff}_correct` as keyof typeof m] as number) + (was_correct ? 1 : 0),
      last_visited_at: new Date().toISOString(),
    }
    updates.mastery_score = calculateMasteryScore(updates)

    await supabase.from('user_topic_mastery').upsert(updates)
  }

  return NextResponse.json({
    was_correct,
    correct_answer: question.correct_answer,
    explanation: question.explanation ?? '',
  })
}
