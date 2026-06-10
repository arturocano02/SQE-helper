/**
 * POST /api/questions/generate-more
 *
 * User-triggered question generation from approved knowledge chunks.
 * Generates new questions for a topic and adds them as approved immediately
 * (quality is controlled at the chunk level — only approved chunks are used).
 *
 * Body: { topic_ids: string[], difficulty?: 'easy'|'medium'|'hard', count?: number }
 *
 * Rate limit: max 25 questions per call. Only generates if the topic has fewer
 * than 80 existing approved questions at that difficulty (prevents pointless duplication).
 *
 * Returns: { generated: number, message: string }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Difficulty } from '@/types/database'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOPIC_GUIDE = `
Topic slug mapping:
business-law, dispute-resolution, contract, tort, legal-system, legal-services,
property-practice, land-law, trusts, wills, solicitors-accounts, criminal-law`

const GENERATE_FROM_CHUNK_SYSTEM = `You are a senior SQE1 exam question writer for England and Wales.

You are given a knowledge chunk — a single precise legal rule extracted from official revision notes.
Generate ONE MCQ question that tests this rule at the requested difficulty level.

MCQ rules:
- Exactly 5 options labelled A, B, C, D, E
- Exactly one correct answer
- Four plausible distractors that test genuine understanding (not obviously wrong)
- The question should be self-contained — include enough scenario/context in the prompt
- Explanation: why the correct answer is right AND specifically why each wrong option fails

Difficulty calibration:
- easy: pure rule recall — "What is the test for X?" or "Under which section does Y apply?"
- medium: single-issue application to a fact pattern — "On these facts, what is the outcome?"
- hard: multi-step reasoning, competing rules, or traps where the obvious answer is wrong

${TOPIC_GUIDE}

Return ONLY valid JSON, no markdown:
{"topic_slug":"string","type":"mcq","difficulty":"easy"|"medium"|"hard","prompt":"string","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],"correct_answer":"A"|"B"|"C"|"D"|"E","explanation":"string"}`

interface GeneratedQuestion {
  topic_slug: string
  type: 'mcq' | 'flashcard'
  difficulty: Difficulty
  prompt: string
  options: Array<{ label: string; text: string }> | null
  correct_answer: string | null
  explanation: string
}

const VALID_SLUGS = new Set([
  'business-law','dispute-resolution','contract','tort','legal-system',
  'legal-services','property-practice','land-law','trusts','wills',
  'solicitors-accounts','criminal-law',
])

async function generateFromChunk(
  ruleText: string,
  contextText: string | null,
  topicName: string,
  difficulty: Difficulty,
): Promise<GeneratedQuestion | null> {
  const userMessage = `Topic: ${topicName}
Difficulty: ${difficulty}

Knowledge chunk (legal rule to test):
${ruleText}
${contextText ? `\nContext:\n${contextText}` : ''}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: GENERATE_FROM_CHUNK_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as GeneratedQuestion

    if (!parsed.prompt || !parsed.correct_answer || !VALID_SLUGS.has(parsed.topic_slug)) return null
    return { ...parsed, difficulty }
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    topic_ids,
    difficulty,
    count = 10,
  } = body as { topic_ids: string[]; difficulty?: Difficulty; count?: number }

  if (!topic_ids || topic_ids.length === 0) {
    return NextResponse.json({ error: 'topic_ids required' }, { status: 400 })
  }

  const cappedCount = Math.min(count, 25)
  const admin = createAdminClient()

  // Check how many approved questions already exist at this difficulty for these topics
  let existingQuery = admin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .in('topic_id', topic_ids)
    .eq('status', 'approved')
    .eq('type', 'mcq')

  if (difficulty) existingQuery = existingQuery.eq('difficulty', difficulty)
  const { count: existingCount } = await existingQuery

  if ((existingCount ?? 0) >= 150) {
    return NextResponse.json({
      generated: 0,
      message: `Already ${existingCount} questions at this difficulty for these topics — plenty available.`,
    })
  }

  // Fetch approved chunks for these topics — prefer chunks with fewer linked questions
  const { data: chunks } = await admin
    .from('knowledge_chunks')
    .select('id, topic_id, rule_text, context_text, topics(name)')
    .in('topic_id', topic_ids)
    .eq('is_approved', true)
    .order('created_at')
    .limit(cappedCount * 3) // fetch extra so we can pick the least-covered ones

  if (!chunks || chunks.length === 0) {
    return NextResponse.json({
      generated: 0,
      message: 'No approved knowledge chunks found for these topics. Extract and approve chunks first.',
    })
  }

  // Shuffle and take cappedCount chunks to generate from
  const shuffled = [...chunks].sort(() => Math.random() - 0.5).slice(0, cappedCount)

  // Resolve topic_id → topic name map
  const topicNameMap = new Map<string, string>()
  for (const chunk of shuffled) {
    const topicData = chunk.topics as unknown as { name: string } | null
    if (topicData && chunk.topic_id) {
      topicNameMap.set(chunk.topic_id, topicData.name)
    }
  }

  // Get topic slugs
  const { data: topicsData } = await admin
    .from('topics')
    .select('id, slug')
    .in('id', Array.from(topicNameMap.keys()))

  const topicSlugMap = new Map((topicsData ?? []).map((t: { id: string; slug: string }) => [t.id, t.slug]))
  const slugToId = new Map((topicsData ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]))

  const useDifficulty: Difficulty = difficulty ?? (['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)] as Difficulty)

  // Generate questions
  const generated: GeneratedQuestion[] = []
  const chunkIds: string[] = []

  for (const chunk of shuffled) {
    if (generated.length >= cappedCount) break
    const topicName = topicNameMap.get(chunk.topic_id) ?? 'UK Law'
    const q = await generateFromChunk(chunk.rule_text, chunk.context_text, topicName, useDifficulty)
    if (q) {
      generated.push(q)
      chunkIds.push(chunk.id)
    }
  }

  if (generated.length === 0) {
    return NextResponse.json({ generated: 0, message: 'Generation failed — please try again.' })
  }

  // Insert as approved questions (source is admin-approved chunks)
  const rows = generated
    .filter(q => slugToId.has(q.topic_slug))
    .map((q, i) => ({
      topic_id: slugToId.get(q.topic_slug)!,
      knowledge_chunk_id: chunkIds[i] ?? null,
      type: q.type ?? 'mcq',
      difficulty: q.difficulty,
      prompt: q.prompt,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      status: 'approved' as const,
      source_file: 'user-generated',
    }))

  if (rows.length > 0) {
    await admin.from('questions').insert(rows)
  }

  return NextResponse.json({
    generated: rows.length,
    message: `${rows.length} new ${useDifficulty} question${rows.length !== 1 ? 's' : ''} added to the bank.`,
  })
}
