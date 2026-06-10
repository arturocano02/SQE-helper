import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 1: coverage mapping
// Given the user's notes + a compact list of knowledge chunks, estimate which
// chunks the user has covered and at what depth.
// ─────────────────────────────────────────────────────────────────────────────

function buildCoveragePrompt(chunks: Array<{ id: string; rule_text: string }>) {
  const chunkList = chunks
    .map((c, i) => `[${i}] ${c.rule_text}`)
    .join('\n')

  return `You are analysing a law student's revision notes to estimate their knowledge of specific legal rules.

You will be given:
1. The student's personal revision notes
2. A numbered list of legal knowledge chunks (official legal rules)

For each knowledge chunk, assess whether the student's notes indicate they have covered it:
- "solid": clearly explained with correct detail
- "okay": mentioned with reasonable detail
- "shaky": briefly mentioned or partially correct
- "unseen": not covered at all

Return ONLY valid JSON, no markdown:
{
  "coverage": [
    { "index": 0, "confidence": "solid"|"okay"|"shaky"|"unseen" }
  ]
}

Include ALL ${chunks.length} chunks in the output.

Knowledge chunks:
${chunkList}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt 2: legacy topic-level import (fallback when no chunks exist)
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_IMPORT_SYSTEM = `You are parsing a UK law student's personal SQE1 revision notes.

For each distinct legal rule or concept you find, extract:
- topic_slug: which SQE1 topic (business-law, dispute-resolution, contract, tort, legal-system, legal-services, property-practice, land-law, trusts, wills, solicitors-accounts, criminal-law)
- prompt: the question or concept the note relates to
- correct_rule: the correct rule as stated in the notes
- confidence: "shaky" (default for imported notes — they haven't been tested yet)

Return ONLY valid JSON:
{ "items": [{ "topic_slug": "string", "prompt": "string", "correct_rule": "string", "confidence": "shaky" }] }
No preamble. No markdown.`

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const notesContext = (formData.get('notes_context') as string | null) ?? ''
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Extract text
  let text = ''
  const fileName = file.name.toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())

  if (fileName.endsWith('.txt')) {
    text = buffer.toString('utf-8')
  } else if (fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    text = result.value
  } else if (fileName.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const result = await pdfParse(buffer)
    text = result.text
  } else {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 })
  }

  // Prepend user's context hint if provided
  const notesWithContext = notesContext
    ? `[Student's note about their notes structure: ${notesContext}]\n\n${text}`
    : text

  const admin = createAdminClient()

  // Fetch approved knowledge chunks — if they exist, do chunk-level coverage mapping
  const { data: allChunks } = await admin
    .from('knowledge_chunks')
    .select('id, topic_id, rule_text')
    .eq('is_approved', true)
    .order('sort_order')

  const hasChunks = allChunks && allChunks.length > 0

  if (hasChunks) {
    // ── Chunk-level coverage mapping ────────────────────────────────────────
    // Process in batches of 50 chunks to keep context windows manageable
    const BATCH = 50
    const coverage: Array<{ chunk_id: string; confidence: 'unseen' | 'shaky' | 'okay' | 'solid' }> = []

    const textForCoverage = notesWithContext.slice(0, 15000)

    for (let i = 0; i < allChunks.length; i += BATCH) {
      const batch = allChunks.slice(i, i + BATCH)
      const systemPrompt = buildCoveragePrompt(batch.map(c => ({ id: c.id, rule_text: c.rule_text })))

      try {
        const message = await client.messages.create({
          model: 'claude-haiku-4-5-20251001', // Haiku is fine for coverage classification
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Student's notes:\n${textForCoverage}` }],
        })

        const raw = message.content[0].type === 'text' ? message.content[0].text : ''
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
        const parsed = JSON.parse(cleaned) as { coverage: Array<{ index: number; confidence: string }> }

        for (const item of parsed.coverage ?? []) {
          const chunk = batch[item.index]
          if (!chunk) continue
          const conf = (['unseen', 'shaky', 'okay', 'solid'].includes(item.confidence)
            ? item.confidence
            : 'unseen') as 'unseen' | 'shaky' | 'okay' | 'solid'
          coverage.push({ chunk_id: chunk.id, confidence: conf })
        }
      } catch {
        // On parse failure, mark all chunks in this batch as unseen
        for (const chunk of batch) {
          coverage.push({ chunk_id: chunk.id, confidence: 'unseen' })
        }
      }
    }

    // Return coverage for user review (don't save yet — user must confirm)
    const topicCoverage: Record<string, { solid: number; okay: number; shaky: number; unseen: number }> = {}
    for (const item of coverage) {
      const chunk = allChunks.find(c => c.id === item.chunk_id)
      if (!chunk) continue
      if (!topicCoverage[chunk.topic_id]) {
        topicCoverage[chunk.topic_id] = { solid: 0, okay: 0, shaky: 0, unseen: 0 }
      }
      topicCoverage[chunk.topic_id][item.confidence]++
    }

    return NextResponse.json({
      mode: 'chunk_coverage',
      coverage,
      topic_coverage: topicCoverage,
      total_chunks: allChunks.length,
      total_covered: coverage.filter(c => c.confidence !== 'unseen').length,
    })
  }

  // ── Fallback: legacy topic-level import ──────────────────────────────────
  let items: Array<{ topic_slug: string; prompt: string; correct_rule: string; confidence: string }> = []

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: LEGACY_IMPORT_SYSTEM,
      messages: [{ role: 'user', content: notesWithContext.slice(0, 20000) }],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed.items)) items = parsed.items
  } catch {
    return NextResponse.json({ error: 'Failed to parse notes with AI' }, { status: 500 })
  }

  const { data: topics } = await supabase.from('topics').select('id, slug')
  const slugToId = new Map((topics ?? []).map(t => [t.slug, t.id]))
  const affectedSlugs = [...new Set(items.map(i => i.topic_slug).filter(s => slugToId.has(s)))]

  return NextResponse.json({
    mode: 'legacy',
    items,
    topics_affected: affectedSlugs.length,
    total_items: items.length,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/import — confirm and save coverage (called after user reviews)
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { coverage, mode } = body as {
    coverage: Array<{ chunk_id?: string; topic_slug?: string; confidence: string }>
    mode: 'chunk_coverage' | 'legacy'
    items?: Array<{ topic_slug: string }>
  }

  const admin = createAdminClient()

  if (mode === 'chunk_coverage' && coverage) {
    // Upsert user_chunk_mastery for each chunk
    const rows = coverage
      .filter(c => c.chunk_id && c.confidence !== 'unseen')
      .map(c => ({
        user_id: user.id,
        chunk_id: c.chunk_id!,
        confidence_level: c.confidence as 'shaky' | 'okay' | 'solid',
        last_tested_at: null,
        correct_count: 0,
        attempt_count: 0,
      }))

    if (rows.length > 0) {
      await admin.from('user_chunk_mastery').upsert(rows, { onConflict: 'user_id,chunk_id' })
    }

    // Also seed user_topic_mastery for covered topics
    const { data: chunks } = await admin
      .from('knowledge_chunks')
      .select('id, topic_id')
      .in('id', rows.map(r => r.chunk_id))

    const topicIds = [...new Set((chunks ?? []).map(c => c.topic_id))]
    for (const topicId of topicIds) {
      const topicChunks = (chunks ?? []).filter(c => c.topic_id === topicId)
      const topicCoverage = coverage.filter(c => topicChunks.some(tc => tc.id === c.chunk_id))
      const scoreMap: Record<string, number> = { solid: 80, okay: 55, shaky: 25, unseen: 0 }
      const avgScore = topicCoverage.reduce((s, c) => s + (scoreMap[c.confidence] ?? 0), 0) / Math.max(topicCoverage.length, 1)

      await admin.from('user_topic_mastery').upsert({
        user_id: user.id,
        topic_id: topicId,
        mastery_score: Math.round(avgScore),
      }, { onConflict: 'user_id,topic_id' })
    }

    return NextResponse.json({ saved: rows.length })
  }

  // Legacy: same as before
  const { data: topics } = await supabase.from('topics').select('id, slug')
  const slugToId = new Map((topics ?? []).map(t => [t.slug, t.id]))
  const affectedSlugs = [...new Set(coverage.map(c => c.topic_slug).filter(s => s && slugToId.has(s!)))] as string[]

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const historyRows = coverage
    .filter(c => c.topic_slug && slugToId.has(c.topic_slug!))
    .map(() => ({ user_id: user.id, question_id: null, session_id: null, was_correct: false, selected_answer: null, answered_at: thirtyDaysAgo, is_imported: true }))

  if (historyRows.length > 0) await supabase.from('question_history').insert(historyRows)

  for (const slug of affectedSlugs) {
    const topicId = slugToId.get(slug)!
    await admin.from('user_topic_mastery').upsert({ user_id: user.id, topic_id: topicId, mastery_score: 15 }, { onConflict: 'user_id,topic_id' })
  }

  return NextResponse.json({ saved: historyRows.length })
}
