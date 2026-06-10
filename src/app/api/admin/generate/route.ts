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

DIFFICULTY:
- easy: pure rule recall — "What is the test for X?" or "Under s.X, what applies when Y?"
- medium: single-issue application to a realistic fact pattern
- hard: multi-step reasoning, competing rules, or traps where the obvious answer is wrong

${TOPIC_GUIDE}

Return ONLY valid JSON, no markdown fences:
{"topic_slug":"string","difficulty":"easy"|"medium"|"hard","prompt":"string","options":[{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],"correct_answer":"A"|"B"|"C"|"D"|"E","explanation":"string"}`

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

async function generateQuestion(
  ruleText: string,
  contextText: string | null,
  topicName: string,
  difficulty: Difficulty,
): Promise<GeneratedQ | null> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: GENERATE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Topic: ${topicName}\nDifficulty: ${difficulty}\n\nKnowledge chunk:\n${ruleText}${contextText ? `\n\nContext:\n${contextText}` : ''}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as GeneratedQ

    if (!parsed.prompt || !parsed.correct_answer || !VALID_SLUGS.has(parsed.topic_slug)) return null
    if (!Array.isArray(parsed.options) || parsed.options.length !== 5) return null

    return { ...parsed, difficulty }
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
  } = body as {
    topic_ids: string[]
    difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
    count_per_topic: number
    status?: 'draft' | 'approved'
  }

  if (!topic_ids || topic_ids.length === 0) {
    return NextResponse.json({ error: 'topic_ids required' }, { status: 400 })
  }

  const clampedCount = Math.min(Math.max(1, count_per_topic), 100)
  const admin = createAdminClient()

  // Resolve topic metadata
  const { data: topicsData } = await admin
    .from('topics')
    .select('id, name, slug')
    .in('id', topic_ids)

  if (!topicsData || topicsData.length === 0) {
    return NextResponse.json({ error: 'No topics found' }, { status: 404 })
  }

  const topicMap = new Map(topicsData.map((t: { id: string; name: string; slug: string }) => [t.id, t]))
  const slugToId = new Map(topicsData.map((t: { id: string; slug: string }) => [t.slug, t.id]))

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
          const topic = topicsData[topicIndex] as { id: string; name: string; slug: string }

          send({
            stage: 'topic',
            topic_name: topic.name,
            topic_index: topicIndex + 1,
            topics_total: topicsData.length,
            generated_so_far: totalGenerated,
          })

          // Fetch approved chunks for this topic — fetch extra to handle failures
          const fetchLimit = clampedCount * 4
          const { data: chunks } = await admin
            .from('knowledge_chunks')
            .select('id, rule_text, context_text')
            .eq('topic_id', topic.id)
            .eq('is_approved', true)
            .order('created_at')
            .limit(fetchLimit)

          if (!chunks || chunks.length === 0) {
            send({
              stage: 'topic_skip',
              topic_name: topic.name,
              reason: 'No approved knowledge chunks — extract and approve chunks first',
            })
            continue
          }

          // Shuffle chunks so repeated runs cover different material
          const shuffled = [...chunks].sort(() => Math.random() - 0.5).slice(0, clampedCount * 2)

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

            const q = await generateQuestion(chunk.rule_text, chunk.context_text, topic.name, diff)
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
