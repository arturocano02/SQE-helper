/**
 * POST /api/admin/chunks/suggest-fix
 *
 * The other half of the feedback → knowledge chunk loop: given a piece of feedback
 * left on a question or flashcard, resolve the knowledge chunk it was generated from,
 * and ask Claude to draft a corrected rule_text/context_text based on the feedback
 * description (plus any admin note added on top). Returns the suggestion for the admin
 * to review/edit — never writes to the chunk itself (see apply-fix for that).
 *
 * Body: { feedback_id: string }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic'
import type { MCQOption } from '@/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

const REWRITE_SYSTEM = `You are correcting a knowledge chunk in an SQE1 (England and Wales) study platform's knowledge base. Questions and flashcards are generated FROM this chunk's rule_text, so an error here propagates to every question built on it.

You will be given:
- The chunk's current rule_text (the atomic legal rule) and context_text (surrounding context, if any)
- Feedback from a student or admin describing what's wrong
- Optionally, the specific question/flashcard that was flagged, for context on how the error surfaced
- Optionally, an admin note giving additional direction

Your job: rewrite rule_text (and context_text if it also needs correcting) so the rule is accurate. Rules for the rewrite:
- Preserve the original rule's scope and phrasing style as much as possible — only change what's actually wrong
- If the feedback describes an outdated or incorrect fact (wrong figure, wrong section, wrong test), correct it based on well-established, current SQE1 law — do not invent a specific number/section/case you're not confident about; if you can't verify a precise figure, phrase the rule so it doesn't depend on one
- If context_text doesn't need changes, return it unchanged
- Briefly explain what you changed and why in "reasoning" (2-3 sentences, for the admin reviewing this)

Return ONLY valid JSON, no markdown fences:
{"rule_text": "string", "context_text": "string or null", "reasoning": "string"}`

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { feedback_id } = await request.json() as { feedback_id?: string }
  if (!feedback_id) return NextResponse.json({ error: 'feedback_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: feedback, error: fbError } = await admin
    .from('feedback')
    .select('id, question_id, knowledge_chunk_id, feedback_type, description, admin_note')
    .eq('id', feedback_id)
    .single()

  if (fbError || !feedback) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })

  // Resolve the chunk: either directly on the feedback row (chunk_dispute type), or via
  // the question it was left on.
  let chunkId = feedback.knowledge_chunk_id as string | null
  let question: { id: string; prompt: string; type: string; options: MCQOption[] | null; correct_answer: string | null; explanation: string | null } | null = null

  if (feedback.question_id) {
    const { data: q } = await admin
      .from('questions')
      .select('id, prompt, type, options, correct_answer, explanation, knowledge_chunk_id')
      .eq('id', feedback.question_id)
      .single()
    if (q) {
      question = q
      chunkId = chunkId ?? q.knowledge_chunk_id
    }
  }

  if (!chunkId) {
    return NextResponse.json({
      error: 'No source knowledge chunk could be resolved for this feedback — the question may predate the knowledge-chunk pipeline, or this feedback isn\'t linked to a question.',
    }, { status: 422 })
  }

  const { data: chunk, error: chunkError } = await admin
    .from('knowledge_chunks')
    .select('id, rule_text, context_text, topic_id, topics(name)')
    .eq('id', chunkId)
    .single()

  if (chunkError || !chunk) return NextResponse.json({ error: 'Knowledge chunk not found' }, { status: 404 })

  const questionBlock = question
    ? `\n\nFlagged ${question.type === 'flashcard' ? 'flashcard' : 'question'}:\nPrompt: ${question.prompt}${
        question.options ? `\nOptions:\n${question.options.map(o => `${o.label}. ${o.text}`).join('\n')}\nMarked correct: ${question.correct_answer}` : ''
      }${question.explanation ? `\nExplanation: ${question.explanation}` : ''}`
    : ''

  const adminNoteBlock = feedback.admin_note ? `\n\nAdmin note: ${feedback.admin_note}` : ''

  const userMessage = `Current chunk rule_text:\n${chunk.rule_text}\n\nCurrent chunk context_text:\n${chunk.context_text ?? '(none)'}\n\nFeedback type: ${feedback.feedback_type}\nFeedback description: ${feedback.description}${adminNoteBlock}${questionBlock}`

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    })
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { rule_text: string; context_text: string | null; reasoning: string }

    const topicRel = chunk.topics as unknown as { name: string } | { name: string }[] | null
    const topicName = Array.isArray(topicRel) ? topicRel[0]?.name : topicRel?.name

    return NextResponse.json({
      chunk_id: chunk.id,
      topic_name: topicName ?? null,
      current: { rule_text: chunk.rule_text, context_text: chunk.context_text },
      suggested: { rule_text: parsed.rule_text, context_text: parsed.context_text },
      reasoning: parsed.reasoning,
      flagged_question_id: question?.id ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Claude request failed' }, { status: 500 })
  }
}
