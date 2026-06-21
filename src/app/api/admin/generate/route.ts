/**
 * POST /api/admin/generate
 *
 * Admin-only: generate MCQ questions from approved knowledge chunks.
 * Streams Server-Sent Events showing progress per topic.
 *
 * Body: {
 *   topic_ids: string[]          // which topics to generate for
 *   difficulty: 'easy'|'medium'|'hard'|'mixed'
 *   count_per_topic: number      // how many questions per topic (1–100)
 *   status?: 'draft'|'approved'  // default: 'draft'
 *   include_sample_questions?: boolean  // default: true. MCQ only — feeds style guide + sample-question
 *                                        // style examples into generation. Set false to generate purely
 *                                        // from the knowledge chunk text.
 * }
 *
 * SSE events:
 *   { stage: 'starting', topics_total: N }
 *   { stage: 'topic', topic_name: string, topic_index: N, topics_total: N, generated_so_far: N }
 *   { stage: 'progress', topic_name: string, chunk_index: N, chunks_total: N, generated_so_far: N }
 *   { stage: 'done', total_generated: N, total_attempted: N }
 *   { stage: 'error', message: string }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Difficulty } from '@/types/database'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOPIC_GUIDE = `
Topic slug mapping:
business-law, dispute-resolution, contract, tort, legal-system, legal-services,
property-practice, land-law, trusts, wills, solicitors-accounts, criminal-law`

const GENERATE_SYSTEM_PROMPT = `You are a senior SQE1 exam question writer for England and Wales.

You are given a knowledge chunk — a single precise legal rule. Generate ONE MCQ question that tests this rule.

REQUIREMENTS:
- Exactly 5 options labelled A, B, C, D, E
- Exactly one correct answer
- Four plausible distractors that test genuine understanding (not obviously wrong)
- The question prompt must be self-contained — include enough scenario or context
- Explanation: why the correct answer is right AND specifically why each wrong option is wrong
- Vary which letter (A–E) holds the correct answer from question to question — do not default to A. Across many questions the correct letter should be evenly spread across A, B, C, D and E.

DIFFICULTY:
- easy: pure rule recall — "What is the test for X?" or "Under s.X, what applies when Y?"
- medium: single-issue application to a realistic fact pattern
- hard: multi-step reasoning, competing rules, or traps where the obvious answer is wrong

ACCURACY — the most important rule. Students trust this app completely; a single wrong fact destroys that trust:
- Only state statute sections, case names, time limits, monetary thresholds, percentages, and other figures that appear in the supplied knowledge chunk/context, or that you are highly confident are well-established, unambiguous SQE1 law.
- Never invent or guess a specific number, date, section number, or case name. If the knowledge chunk doesn't give you a precise figure you need, write the question so it doesn't depend on one, rather than fabricating it.
- Double-check any arithmetic in the question or explanation (e.g. tax calculations, limitation periods, cost awards) by working it through step by step before writing the final figure.
- If you are not fully certain a stated rule is current and correct, do not include it as a distractor's "reason it's wrong" — only assert what you can verify from the chunk.

${TOPIC_GUIDE}

You may also be given STYLE REFERENCE examples drawn from real sample questions for this topic. Use them only to match tone, structure, the type of legal knowledge tested, and how explanations are phrased. Never reuse their exact wording, facts, names, or scenarios — the new question must be entirely original.

Return ONLY valid JSON, no markdown fences:
{"topic_slug":"string","difficulty":"easy"|"medium"|"hard","prompt":"string","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],"correct_answer":"A"|"B"|"C"|"D"|"E","explanation":"string"}`

const FLASHCARD_SYSTEM_PROMPT = `You are writing flashcards for SQE1 law students (England and Wales) revising on the go, often on mobile between other things.

You are given a knowledge chunk — a single precise legal rule. Write ONE flashcard testing it.

TONE — short and snappy. This is not an essay:
- Front (the "prompt"): one short question or prompt, ideally under 15 words. No scenario, no scene-setting — just the rule being asked for.
- Back (the "explanation"): the answer, stated as tightly as possible. One or two sentences, max ~40 words. State the rule plainly — no "why this matters" padding, no restating the question.
- If a list is genuinely needed (e.g. elements of a test), use short comma-separated items, not a long paragraph.

ACCURACY:
- Only state statute sections, case names, time limits, and figures that appear in the supplied knowledge chunk/context, or that you are highly confident are well-established, unambiguous SQE1 law.
- Never invent or guess a specific number, date, section number, or case name.

${TOPIC_GUIDE}

Return ONLY valid JSON, no markdown fences:
{"topic_slug":"string","prompt":"string","explanation":"string"}`

interface GeneratedFlashcard {
  topic_slug: string
  prompt: string
  explanation: string
}

async function generateFlashcard(
  ruleText: string,
  contextText: string | null,
  topicName: string,
): Promise<GeneratedFlashcard | null> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: FLASHCARD_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Topic: ${topicName}\n\nKnowledge chunk:\n${ruleText}${contextText ? `\n\nContext:\n${contextText}` : ''}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as GeneratedFlashcard

    if (!parsed.prompt || !parsed.explanation || !VALID_SLUGS.has(parsed.topic_slug)) return null
    return parsed
  } catch {
    return null
  }
}

const VALID_SLUGS = new Set([
  'business-law','dispute-resolution','contract','tort','legal-system',
  'legal-services','property-practice','land-law','trusts','wills',
  'solicitors-accounts','criminal-law',
])

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

function pickDifficulty(difficulty: string, index: number): Difficulty {
  if (difficulty === 'mixed') {
    return DIFFICULTIES[index % 3]
  }
  return difficulty as Difficulty
}

interface GeneratedQ {
  topic_slug: string
  difficulty: Difficulty
  prompt: string
  options: Array<{ label: string; text: string }>
  correct_answer: string
  explanation: string
}

// Shuffles a generated MCQ's options so the correct answer isn't biased toward any one letter.
function shuffleCorrectAnswer(q: GeneratedQ): GeneratedQ {
  if (!q.options || q.options.length !== 5 || !q.correct_answer) return q
  const correctOption = q.options.find(o => o.label === q.correct_answer)
  if (!correctOption) return q

  const labels = ['A', 'B', 'C', 'D', 'E']
  const texts = q.options.map(o => o.text)
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[texts[i], texts[j]] = [texts[j], texts[i]]
  }
  const newOptions = labels.map((label, i) => ({ label, text: texts[i] }))
  const newCorrectLabel = newOptions.find(o => o.text === correctOption.text)?.label ?? q.correct_answer

  return { ...q, options: newOptions, correct_answer: newCorrectLabel }
}

async function generateQuestion(
  ruleText: string,
  contextText: string | null,
  topicName: string,
  difficulty: Difficulty,
  styleExamples: string[],
  styleGuide: string | null,
): Promise<GeneratedQ | null> {
  const guideBlock = styleGuide
    ? `\n\nQUESTION STYLE GUIDE for this topic (synthesised from real sample questions — follow this for tone, structure, and difficulty calibration):\n${styleGuide}`
    : ''
  const styleBlock = styleExamples.length > 0
    ? `\n\nSTYLE REFERENCE (inspiration only — never copy verbatim):\n${styleExamples.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : ''

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: GENERATE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Topic: ${topicName}\nDifficulty: ${difficulty}\n\nKnowledge chunk:\n${ruleText}${contextText ? `\n\nContext:\n${contextText}` : ''}${guideBlock}${styleBlock}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as GeneratedQ

    if (!parsed.prompt || !parsed.correct_answer || !VALID_SLUGS.has(parsed.topic_slug)) return null
    if (!Array.isArray(parsed.options) || parsed.options.length !== 5) return null

    return shuffleCorrectAnswer({ ...parsed, difficulty })
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    topic_ids,
    difficulty = 'mixed',
    count_per_topic = 10,
    status: targetStatus = 'draft',
    content_type = 'mcq',
    include_sample_questions: includeSampleQuestions = true,
  } = body as {
    topic_ids: string[]
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
    count_per_topic: number
    status?: 'draft' | 'approved'
    content_type?: 'mcq' | 'flashcard'
    include_sample_questions?: boolean
  }

  if (!topic_ids || topic_ids.length === 0) {
    return NextResponse.json({ error: 'topic_ids required' }, { status: 400 })
  }

  const clampedCount = Math.min(Math.max(1, count_per_topic), 100)
  const admin = createAdminClient()

  // Resolve topic metadata
  const { data: topicsData } = await admin
    .from('topics')
    .select('id, name, slug, question_style_guide')
    .in('id', topic_ids)

  if (!topicsData || topicsData.length === 0) {
    return NextResponse.json({ error: 'No topics found' }, { status: 404 })
  }

  type TopicRow = { id: string; name: string; slug: string; question_style_guide: string | null }
  const topicMap = new Map(topicsData.map((t: TopicRow) => [t.id, t]))
  const slugToId = new Map(topicsData.map((t: TopicRow) => [t.slug, t.id]))

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let totalGenerated = 0
      let totalAttempted = 0

      send({ stage: 'starting', topics_total: topicsData.length, count_per_topic: clampedCount, difficulty })

      try {
        for (let topicIndex = 0; topicIndex < topicsData.length; topicIndex++) {
          const topic = topicsData[topicIndex] as TopicRow

          send({
            stage: 'topic',
            topic_name: topic.name,
            topic_index: topicIndex + 1,
            topics_total: topicsData.length,
            generated_so_far: totalGenerated,
          })

          // Fetch ALL approved chunks for this topic so we can select fairly across the
          // whole knowledge graph rather than just the most recently added chunks.
          const { data: chunks } = await admin
            .from('knowledge_chunks')
            .select('id, rule_text, context_text')
            .eq('topic_id', topic.id)
            .eq('is_approved', true)
            .order('created_at')

          if (!chunks || chunks.length === 0) {
            send({
              stage: 'topic_skip',
              topic_name: topic.name,
              reason: 'No approved knowledge chunks — extract and approve chunks first',
            })
            continue
          }

          // Prefer chunks with the fewest existing linked questions, so generation spreads
          // evenly across the knowledge graph instead of favouring a subset of chunks.
          const chunkIds = chunks.map(c => c.id)
          const usageCounts = new Map<string, number>(chunkIds.map(id => [id, 0]))
          if (chunkIds.length > 0) {
            const { data: usageRows } = await admin
              .from('questions')
              .select('knowledge_chunk_id')
              .in('knowledge_chunk_id', chunkIds)
            for (const row of usageRows ?? []) {
              const id = (row as { knowledge_chunk_id: string | null }).knowledge_chunk_id
              if (id) usageCounts.set(id, (usageCounts.get(id) ?? 0) + 1)
            }
          }

          const shuffled = [...chunks]
            .map(c => ({ c, jitter: Math.random() }))
            .sort((a, b) => {
              const diff = (usageCounts.get(a.c.id) ?? 0) - (usageCounts.get(b.c.id) ?? 0)
              return diff !== 0 ? diff : a.jitter - b.jitter
            })
            .map(x => x.c)
            .slice(0, clampedCount * 2)

          // Per-topic sample-question style references — used as tone/structure inspiration only.
          // Skipped entirely if the admin has unticked "Use sample questions as style reference".
          let styleExamples: string[] = []
          if (includeSampleQuestions && content_type === 'mcq') {
            const { data: styleRows } = await admin
              .from('knowledge_chunks')
              .select('exact_source_quote')
              .eq('topic_id', topic.id)
              .not('exact_source_quote', 'is', null)
              .limit(5)
            styleExamples = (styleRows ?? [])
              .map(r => (r as { exact_source_quote: string | null }).exact_source_quote)
              .filter((s): s is string => !!s)
          }
          const effectiveStyleGuide = includeSampleQuestions ? topic.question_style_guide : null

          const topicRows: Array<Record<string, unknown>> = []
          let chunkIndex = 0

          for (const chunk of shuffled) {
            if (topicRows.length >= clampedCount) break

            chunkIndex++
            totalAttempted++
            const diff = pickDifficulty(difficulty, totalAttempted - 1)

            send({
              stage: 'progress',
              topic_name: topic.name,
              topic_index: topicIndex + 1,
              topics_total: topicsData.length,
              chunk_index: chunkIndex,
              chunks_total: Math.min(shuffled.length, clampedCount),
              generated_so_far: totalGenerated,
            })

            if (content_type === 'flashcard') {
              const card = await generateFlashcard(chunk.rule_text, chunk.context_text, topic.name)
              if (!card) continue
              const resolvedTopicId = slugToId.get(card.topic_slug) ?? topic.id
              topicRows.push({
                topic_id: resolvedTopicId,
                knowledge_chunk_id: chunk.id,
                type: 'flashcard',
                difficulty: diff,
                prompt: card.prompt,
                options: null,
                correct_answer: null,
                explanation: card.explanation,
                status: targetStatus,
                source_file: 'admin-generated',
              })
              continue
            }

            const q = await generateQuestion(chunk.rule_text, chunk.context_text, topic.name, diff, styleExamples, effectiveStyleGuide)
            if (!q) continue

            const resolvedTopicId = slugToId.get(q.topic_slug) ?? topic.id

            topicRows.push({
              topic_id: resolvedTopicId,
              knowledge_chunk_id: chunk.id,
              type: 'mcq',
              difficulty: q.difficulty,
              prompt: q.prompt,
              options: q.options,
              correct_answer: q.correct_answer,
              explanation: q.explanation,
              status: targetStatus,
              source_file: 'admin-generated',
            })
          }

          // Batch insert for this topic
          if (topicRows.length > 0) {
            await admin.from('questions').insert(topicRows)
            totalGenerated += topicRows.length
          }

          send({
            stage: 'topic_done',
            topic_name: topic.name,
            topic_index: topicIndex + 1,
            topics_total: topicsData.length,
            topic_generated: topicRows.length,
            generated_so_far: totalGenerated,
          })
        }

        send({ stage: 'done', total_generated: totalGenerated, total_attempted: totalAttempted })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed'
        send({ stage: 'error', message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
