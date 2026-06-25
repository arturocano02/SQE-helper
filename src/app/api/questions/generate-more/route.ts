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
- Vary which letter (A–E) holds the correct answer from question to question — do not default to A. Place the correct answer at a position you choose deliberately so that across many questions the correct letter is evenly spread across A, B, C, D and E.

Difficulty calibration:
- easy: pure rule recall — "What is the test for X?" or "Under which section does Y apply?"
- medium: single-issue application to a fact pattern — "On these facts, what is the outcome?"
- hard: multi-step reasoning, competing rules, or traps where the obvious answer is wrong

ACCURACY — this is the most important rule. Students trust this app completely; a single wrong fact destroys that trust:
- Only state statute sections, case names, time limits, monetary thresholds, percentages, and other figures that appear in the supplied knowledge chunk/context, or that you are highly confident are well-established, unambiguous SQE1 law.
- Never invent or guess a specific number, date, section number, or case name. If the knowledge chunk doesn't give you a precise figure you need, write the question so it doesn't depend on one, rather than fabricating it.
- Double-check any arithmetic in the question or explanation (e.g. tax calculations, limitation periods, cost awards) by working it through step by step before writing the final figure.
- If you are not fully certain a stated rule is current and correct, do not include it as a distractor's "reason it's wrong" — only assert what you can verify from the chunk.

${TOPIC_GUIDE}

You may also be given STYLE REFERENCE examples drawn from real sample questions for this topic. Use them only to match tone, structure, the type of legal knowledge tested, and how explanations are phrased. Never reuse their exact wording, facts, names, or scenarios — the new question must be entirely original.

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

// Shuffles a generated MCQ's options so the correct answer isn't biased toward any one letter.
// Tracks the *position* (index) being moved rather than matching on option text afterwards —
// matching by text would silently mis-tag the correct answer if two options ever happened to
// share identical wording. Fisher-Yates on the indices gives a uniform 1-in-5 chance of landing
// on any letter A-E, so across many questions the correct answer isn't predictably "always A".
function shuffleCorrectAnswer(q: GeneratedQuestion): GeneratedQuestion {
  if (!q.options || q.options.length !== 5 || !q.correct_answer) return q
  const correctIndex = q.options.findIndex(o => o.label === q.correct_answer)
  if (correctIndex === -1) return q

  const options = q.options
  const labels = ['A', 'B', 'C', 'D', 'E']
  const order = [0, 1, 2, 3, 4]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const newOptions = labels.map((label, i) => ({ label, text: options[order[i]].text }))
  const newCorrectLabel = labels[order.indexOf(correctIndex)]

  return { ...q, options: newOptions, correct_answer: newCorrectLabel }
}

async function generateFromChunk(
  ruleText: string,
  contextText: string | null,
  topicName: string,
  difficulty: Difficulty,
  styleExamples: string[],
): Promise<GeneratedQuestion | null> {
  const styleBlock = styleExamples.length > 0
    ? `\n\nSTYLE REFERENCE (inspiration only — never copy verbatim):\n${styleExamples.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''

  const userMessage = `Topic: ${topicName}
Difficulty: ${difficulty}

Knowledge chunk (legal rule to test):
${ruleText}
${contextText ? `\nContext:\n${contextText}` : ''}${styleBlock}`

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
    return shuffleCorrectAnswer({ ...parsed, difficulty })
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

  // Fetch ALL approved chunks for these topics (not just the most recent) so generation
  // can be spread fairly across the whole knowledge graph, not just newly-added chunks.
  const { data: chunks } = await admin
    .from('knowledge_chunks')
    .select('id, topic_id, rule_text, context_text, topics(name)')
    .in('topic_id', topic_ids)
    .eq('is_approved', true)
    .order('created_at')

  if (!chunks || chunks.length === 0) {
    return NextResponse.json({
      generated: 0,
      message: 'No approved knowledge chunks found for these topics. Extract and approve chunks first.',
    })
  }

  // Count how many questions already exist per chunk, so we can prefer least-used chunks
  // and avoid generation favouring a subset of the knowledge graph.
  const chunkIdsAll = chunks.map(c => c.id)
  const usageCounts = new Map<string, number>(chunkIdsAll.map(id => [id, 0]))
  if (chunkIdsAll.length > 0) {
    const { data: usageRows } = await admin
      .from('questions')
      .select('knowledge_chunk_id')
      .in('knowledge_chunk_id', chunkIdsAll)
    for (const row of usageRows ?? []) {
      const id = (row as { knowledge_chunk_id: string | null }).knowledge_chunk_id
      if (id) usageCounts.set(id, (usageCounts.get(id) ?? 0) + 1)
    }
  }

  // Sort least-used-first (random tiebreak among equally-used chunks). Every never-used chunk
  // sorts ahead of every chunk used once, which sorts ahead of chunks used twice, etc., so the
  // generation loop below exhausts each "usage tier" before it can repeat a chunk. Not sliced
  // here — the loop below stops once it has cappedCount successes, but keeps walking further
  // down this list on failures instead of being capped to a narrow pool that would force early
  // repeats.
  const shuffled = [...chunks]
    .map(c => ({ c, jitter: Math.random() }))
    .sort((a, b) => {
      const diff = (usageCounts.get(a.c.id) ?? 0) - (usageCounts.get(b.c.id) ?? 0)
      return diff !== 0 ? diff : a.jitter - b.jitter
    })
    .map(x => x.c)

  // Pull per-topic sample-question style references (verbatim quotes extracted from
  // uploaded sample papers) to inspire tone/structure — never copied verbatim into output.
  const { data: styleChunks } = await admin
    .from('knowledge_chunks')
    .select('topic_id, exact_source_quote')
    .in('topic_id', topic_ids)
    .not('exact_source_quote', 'is', null)
    .limit(200)

  const styleByTopic = new Map<string, string[]>()
  for (const row of styleChunks ?? []) {
    const r = row as { topic_id: string; exact_source_quote: string | null }
    if (!r.exact_source_quote) continue
    const list = styleByTopic.get(r.topic_id) ?? []
    if (list.length < 5) list.push(r.exact_source_quote)
    styleByTopic.set(r.topic_id, list)
  }

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
    const examples = styleByTopic.get(chunk.topic_id) ?? []
    const q = await generateFromChunk(chunk.rule_text, chunk.context_text, topicName, useDifficulty, examples)
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
