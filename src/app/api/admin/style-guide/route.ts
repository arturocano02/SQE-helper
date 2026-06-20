/**
 * /api/admin/style-guide
 *
 * Admin-only. Manages a per-topic "question style guide" — a synthesized summary of how
 * real SQE1 sample questions for a topic are written (structure, tone, what makes a
 * question easy/medium/hard), built from knowledge_chunks extracted in "questions" mode.
 * Used as a reference when generating new questions (see /api/admin/generate).
 *
 * GET   ?topic_id=...           — fetch the current guide for a topic
 * POST  { topic_id }            — (re)synthesize the guide from sample-question chunks via Claude
 * PUT   { topic_id, question_style_guide } — manually save an admin-edited guide
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const STYLE_GUIDE_SYSTEM_PROMPT = `You are analysing a set of real SQE1 (Solicitors Qualifying Examination) sample MCQ questions for a single law topic, England and Wales.

You are given, for each sample question: the legal rule it tested, its difficulty (easy/medium/hard) as judged by a prior analysis, and why it was judged that difficulty.

Write a concise STYLE GUIDE for this topic that a question-writer can follow to write new questions that feel like genuine SQE1 questions. Cover, in short prose paragraphs (not exhaustive bullet lists):
1. Typical structure/length of the scenario or fact pattern used.
2. The tone and register (formal, exam-register English).
3. What tends to make a question EASY vs MEDIUM vs HARD for this specific topic — be concrete, drawing on the patterns you see (e.g. "easy questions ask for a single named test directly; hard questions combine two rules or include a fact that looks relevant but isn't").
4. Any recurring traps, distractor patterns, or phrasing conventions you notice.

Keep it under 300 words. Write plain prose, no markdown headers, no bullet points — a short paragraph per point is fine. Do not invent specific legal rules; only describe patterns of question-writing style and difficulty calibration.`

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function GET(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const topicId = searchParams.get('topic_id')
  if (!topicId) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('topics')
    .select('question_style_guide, style_guide_updated_at')
    .eq('id', topicId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { topic_id, question_style_guide } = body as { topic_id?: string; question_style_guide?: string }
  if (!topic_id) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('topics')
    .update({ question_style_guide: question_style_guide?.trim() || null, style_guide_updated_at: new Date().toISOString() })
    .eq('id', topic_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { topic_id } = body as { topic_id?: string }
  if (!topic_id) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: topic } = await admin.from('topics').select('id, name').eq('id', topic_id).single()
  if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 404 })

  // Sample-question-derived chunks for this topic: those with an exact_source_quote
  // (i.e. extracted in "questions" mode from a real sample paper) and a difficulty judgement.
  const { data: chunks } = await admin
    .from('knowledge_chunks')
    .select('rule_text, inferred_difficulty, difficulty_reason')
    .eq('topic_id', topic_id)
    .not('exact_source_quote', 'is', null)
    .not('inferred_difficulty', 'is', null)
    .limit(60)

  if (!chunks || chunks.length === 0) {
    return NextResponse.json(
      { error: 'No sample-question chunks with difficulty data found for this topic yet. Extract chunks from a sample-questions source file first.' },
      { status: 400 },
    )
  }

  const examplesText = chunks
    .map((c, i) => `${i + 1}. Rule tested: ${c.rule_text}\n   Difficulty: ${c.inferred_difficulty}${c.difficulty_reason ? ` — ${c.difficulty_reason}` : ''}`)
    .join('\n')

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: STYLE_GUIDE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Topic: ${topic.name}\n\nSample questions analysed (${chunks.length} total):\n${examplesText}`,
      }],
    })

    const guide = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    if (!guide) return NextResponse.json({ error: 'Claude returned no content' }, { status: 500 })

    const updatedAt = new Date().toISOString()
    const { error } = await admin
      .from('topics')
      .update({ question_style_guide: guide, style_guide_updated_at: updatedAt })
      .eq('id', topic_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ question_style_guide: guide, style_guide_updated_at: updatedAt, chunks_used: chunks.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
