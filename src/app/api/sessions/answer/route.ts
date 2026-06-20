import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { updateSrs, defaultSrsState } from '@/lib/srs'
import { calculateMasteryScore } from '@/lib/mastery'

interface AnswerBody {
  session_id: string
  question_id: string
  selected_answer: string
  self_assessment?: 'got_it' | 'nearly' | 'missed_it'
}

const SELF_ASSESSMENT_QUALITY: Record<string, number> = {
  got_it: 5,
  nearly: 3,
  missed_it: 1,
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: AnswerBody = await request.json()
  const { session_id, question_id, selected_answer, self_assessment } = body

  const admin = createAdminClient()
  const { data: question } = await admin
    .from('questions')
    .select('correct_answer, explanation, difficulty, topic_id, type, knowledge_chunk_id')
    .eq('id', question_id)
    .single()

  if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 })

  // Determine correctness:
  // - MCQ: compare selected_answer to correct_answer
  // - Flashcard: use self_assessment (got_it/nearly = correct, missed_it = incorrect)
  const isFlashcard = question.type === 'flashcard' || !question.correct_answer
  const was_correct = isFlashcard
    ? (self_assessment === 'got_it' || self_assessment === 'nearly')
    : question.correct_answer === selected_answer

  // SRS quality score
  const quality = self_assessment
    ? (SELF_ASSESSMENT_QUALITY[self_assessment] ?? (was_correct ? 4 : 1))
    : (was_correct ? 4 : 1)

  // Record answer
  await supabase.from('question_history').insert({
    user_id: user.id,
    question_id,
    session_id,
    was_correct,
    selected_answer,
    self_assessment: self_assessment ?? null,
    answered_at: new Date().toISOString(),
  })

  // Update session progress (fire and forget — don't let this block the response)
  supabase
    .from('sessions')
    .select('current_question_index, correct_count')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()
    .then(({ data: session }) => {
      if (session) {
        supabase.from('sessions').update({
          current_question_index: (session.current_question_index ?? 0) + 1,
          correct_count: (session.correct_count ?? 0) + (was_correct ? 1 : 0),
        }).eq('id', session_id)
      }
    })

  // Update SRS
  const { data: existingSrs } = await supabase
    .from('user_question_srs')
    .select('*')
    .eq('user_id', user.id)
    .eq('question_id', question_id)
    .single()

  const newSrs = updateSrs(existingSrs ?? defaultSrsState(), quality)

  await supabase.from('user_question_srs').upsert({
    user_id: user.id,
    question_id,
    next_review_at: newSrs.next_review_at.toISOString(),
    ease_factor: newSrs.ease_factor,
    interval_days: newSrs.interval_days,
    repetitions: newSrs.repetitions,
  })

  // Update mastery
  if (question.topic_id) {
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

    // Only update difficulty counters for MCQs with a known difficulty
    const diff = question.difficulty as 'easy' | 'medium' | 'hard' | null
    const updates = diff ? {
      ...m,
      [`${diff}_total`]: (m[`${diff}_total` as keyof typeof m] as number) + 1,
      [`${diff}_correct`]: (m[`${diff}_correct` as keyof typeof m] as number) + (was_correct ? 1 : 0),
      last_visited_at: new Date().toISOString(),
    } : {
      ...m,
      last_visited_at: new Date().toISOString(),
    }

    if (diff) {
      updates.mastery_score = calculateMasteryScore(updates)
    }

    await supabase.from('user_topic_mastery').upsert(updates)
  }

  // Update user_chunk_mastery if question is linked to a knowledge chunk
  let chunkCitation: {
    id: string
    rule_text: string
    source_section: string
    key_terms: string[]
    source_page_start: number | null
    source_page_end: number | null
  } | null = null

  if (question.knowledge_chunk_id) {
    const chunkId = question.knowledge_chunk_id as string

    // Fetch chunk data for citation in the explanation panel
    const { data: chunk } = await admin
      .from('knowledge_chunks')
      .select('id, rule_text, source_section, key_terms, source_page_start, source_page_end')
      .eq('id', chunkId)
      .single()

    if (chunk) {
      chunkCitation = {
        id: chunk.id,
        rule_text: chunk.rule_text,
        source_section: chunk.source_section,
        key_terms: Array.isArray(chunk.key_terms) ? chunk.key_terms : [],
        source_page_start: chunk.source_page_start ?? null,
        source_page_end: chunk.source_page_end ?? null,
      }
    }

    // Update mastery record
    const { data: existing } = await supabase
      .from('user_chunk_mastery')
      .select('*')
      .eq('user_id', user.id)
      .eq('chunk_id', chunkId)
      .maybeSingle()

    const correctCount = (existing?.correct_count ?? 0) + (was_correct ? 1 : 0)
    const attemptCount = (existing?.attempt_count ?? 0) + 1
    const rate = correctCount / attemptCount

    let confidence: 'shaky' | 'okay' | 'solid'
    if (rate >= 0.8 && attemptCount >= 3) confidence = 'solid'
    else if (rate >= 0.5) confidence = 'okay'
    else confidence = 'shaky'

    await supabase.from('user_chunk_mastery').upsert({
      user_id: user.id,
      chunk_id: chunkId,
      confidence_level: confidence,
      correct_count: correctCount,
      attempt_count: attemptCount,
      last_tested_at: new Date().toISOString(),
    }, { onConflict: 'user_id,chunk_id' })
  }

  return NextResponse.json({
    was_correct,
    correct_answer: question.correct_answer,
    explanation: question.explanation ?? '',
    chunk: chunkCitation,
  })
}
