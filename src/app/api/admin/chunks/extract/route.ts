/**
 * POST /api/admin/chunks/extract
 *
 * Streams Server-Sent Events (SSE) while extracting knowledge chunks
 * from a previously uploaded source material (.docx).
 *
 * Body: { source_material_id: string, topic_id: string, topic_name: string }
 *
 * SSE events:
 *   data: { stage, message, sections_total?, sections_done?, chunks_found? }
 *   data: { stage: "done", chunks_found: N }
 *   data: { stage: "error", error: string }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { extractChunksFromDocx, matchQuestionsToChunks } from '@/lib/chunk-extractor'
import type { ExtractionProgress, ChunkCandidate, ChunkMatch } from '@/lib/chunk-extractor'

// Each request only processes one small batch of sections/question-batches, so it always
// finishes well within Vercel's function timeout. The client calls this endpoint repeatedly
// (see admin upload page) until it reports stage: "done".
//
// Was 60s — too tight for dense sections (a section with many atomic rules triggers several
// sequential Haiku classify calls before it's done). On large documents this caused the SAME
// batch to hit the platform's hard timeout deterministically on every retry, never making
// progress past that checkpoint — looked like "glitching" between paused/running because the
// client kept auto-retrying the one batch that could never finish in time. Fluid Compute (see
// CLAUDE.md) supports well beyond 60s, so raised to give real headroom.
export const maxDuration = 280

// Batch sizes are deliberately small — a handful of Claude calls per request — so a single
// dropped connection can only ever cost re-running one small batch, never the whole document.
// NOTES_BATCH_SIZE halved (8 → 4): fewer sections per request lowers the worst-case request
// duration even if one of them is unusually dense, and tighter checkpoints (chunk_sections_done
// advances more often) mean less progress lost per retry.
const NOTES_BATCH_SIZE = 4
const QUESTIONS_BATCH_SIZE = 3

// If a record has been stuck on "extracting" for longer than this, we assume the previous
// request was force-killed (e.g. Vercel timeout) rather than still genuinely running, and we
// let a new request take over from the last persisted checkpoint instead of hard-blocking it.
const STALE_EXTRACTING_MS = 90_000

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { source_material_id, topic_id, topic_name, extraction_mode } = body as {
    source_material_id: string
    topic_id?: string           // optional — auto-detected per chunk if omitted
    topic_name?: string
    extraction_mode?: 'notes' | 'questions'  // 'notes' = revision notes, 'questions' = sample MCQ paper
  }

  if (!source_material_id) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch the source material (include raw_text for questions mode)
  const { data: material, error: matErr } = await admin
    .from('source_materials')
    .select('id, file_name, file_type, raw_text, chunk_status, chunks_extracted, chunk_sections_done, chunk_status_updated_at, chunk_match_unmatched')
    .eq('id', source_material_id)
    .single()

  if (matErr || !material) {
    return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  }

  // Tagged so concurrent requests for different files (or the same file from different tabs)
  // are easy to tell apart in the Vercel function logs.
  const logTag = `[chunks/extract ${material.file_name}]`
  console.log(`${logTag} request received — chunk_status=${material.chunk_status}, chunk_sections_done=${material.chunk_sections_done ?? 0}`)

  if (material.chunk_status === 'extracting') {
    const updatedAt = material.chunk_status_updated_at ? new Date(material.chunk_status_updated_at).getTime() : 0
    const staleMs = Date.now() - updatedAt
    if (staleMs < STALE_EXTRACTING_MS) {
      console.warn(`${logTag} 409 — already extracting, last update ${staleMs}ms ago (stale threshold ${STALE_EXTRACTING_MS}ms)`)
      return NextResponse.json({ error: 'Extraction already in progress' }, { status: 409 })
    }
    // Stale — the previous request almost certainly died mid-batch. Fall through and resume
    // from the last persisted checkpoint (chunk_sections_done) rather than blocking forever.
    console.warn(`${logTag} chunk_status was "extracting" but stale (${staleMs}ms > ${STALE_EXTRACTING_MS}ms) — taking over from checkpoint.`)
  }

  // Resume point from a previous batch, if any.
  const resumeOffset = material.chunk_sections_done ?? 0
  const seedInserted = material.chunks_extracted ?? 0
  const seedUnmatched = material.chunk_match_unmatched ?? 0

  // Determine extraction strategy:
  // - 'questions' mode OR non-docx file → use raw_text (already extracted during upload)
  // - 'notes' mode (default) + docx → download original file buffer for mammoth HTML parsing
  const useQuestionsMode = extraction_mode === 'questions' || material.file_type !== 'docx'

  let docxBuffer: Buffer | null = null

  if (!useQuestionsMode) {
    // Notes mode with a .docx — we need the original bytes for mammoth
    const { data: fileData } = await admin.storage
      .from('source_materials')
      .download(material.file_name)

    if (fileData) {
      const arrayBuffer = await fileData.arrayBuffer()
      docxBuffer = Buffer.from(arrayBuffer)
    }

    if (!docxBuffer) {
      return NextResponse.json(
        { error: 'Original .docx file not found in storage. Please re-upload the file.' },
        { status: 404 }
      )
    }
  } else {
    // Questions mode (or PDF/txt) — use raw_text
    if (!material.raw_text) {
      return NextResponse.json(
        { error: 'No extracted text found for this file. Please re-upload.' },
        { status: 404 }
      )
    }
  }

  // Questions mode never creates chunks — it only matches sample MCQs against chunks that
  // already exist from notes. That requires a specific topic (to scope the candidate list)
  // and at least one chunk already in the knowledge graph for it.
  let candidates: ChunkCandidate[] = []
  if (useQuestionsMode) {
    if (!topic_id) {
      return NextResponse.json(
        { error: 'Select a topic before uploading sample questions — needed to match against that topic\'s existing knowledge chunks.' },
        { status: 400 }
      )
    }
    const { data: existingChunks } = await admin
      .from('knowledge_chunks')
      .select('id, rule_text, source_section')
      .eq('topic_id', topic_id)
    candidates = (existingChunks ?? []) as ChunkCandidate[]

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'No knowledge chunks exist for this topic yet. Upload and extract revision notes for this topic first — sample questions only match against chunks that already exist, they never create new ones.' },
        { status: 400 }
      )
    }
  }

  // Mark as extracting — chunk_status_updated_at lets the staleness check above detect a
  // force-killed run on the next request, instead of staying stuck on "extracting" forever.
  await admin.from('source_materials').update({
    chunk_status: 'extracting',
    chunk_error: null,
    chunk_status_updated_at: new Date().toISOString(),
  }).eq('id', source_material_id)

  // Set up SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: ExtractionProgress) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Fetch all topics once upfront — needed for slug → topic_id resolution
      const { data: allTopics } = await admin.from('topics').select('id, slug')
      const slugToTopicId = new Map((allTopics ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]))
      const fallbackTopicId = topic_id ?? null
      const subtopicMap = new Map<string, string>()

      // Seed from what's already in the DB from earlier batches/requests, so the running
      // total shown to the admin never regresses on resume.
      let totalInserted = seedInserted
      let sortIndex = seedInserted
      let totalUnmatched = seedUnmatched

      /**
       * Ensure subtopic exists and return its id. Cached in subtopicMap.
       */
      async function ensureSubtopic(resolvedTopicId: string, subtopicName: string): Promise<string | null> {
        const mapKey = `${resolvedTopicId}:${subtopicName}`
        if (subtopicMap.has(mapKey)) return subtopicMap.get(mapKey)!

        const slug = subtopicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const { data: existing } = await admin
          .from('subtopics').select('id')
          .eq('topic_id', resolvedTopicId).eq('slug', slug)
          .maybeSingle()
        if (existing) { subtopicMap.set(mapKey, existing.id); return existing.id }

        const { data: created } = await admin
          .from('subtopics')
          .insert({ topic_id: resolvedTopicId, name: subtopicName, slug })
          .select('id').single()
        if (created) { subtopicMap.set(mapKey, created.id); return created.id }
        return null
      }

      /**
       * Flush a batch of ExtractedChunks to the DB immediately.
       * Called after each section completes so partial progress is preserved
       * if the connection drops later.
       */
      async function flushChunks(chunks: import('@/lib/chunk-extractor').ExtractedChunk[]): Promise<number> {
        const rows = await Promise.all(
          chunks.map(async (c) => {
            const resolvedTopicId = (c.topic_slug ? slugToTopicId.get(c.topic_slug) : null) ?? fallbackTopicId
            if (!resolvedTopicId) return null
            const subtopicId = await ensureSubtopic(resolvedTopicId, c.subtopic_name)
            return {
              topic_id: resolvedTopicId,
              subtopic_id: subtopicId,
              source_material_id,
              rule_text: c.rule_text,
              exact_source_quote: c.exact_source_quote ?? null,
              context_text: c.context_text ?? null,
              source_section: c.source_section,
              source_page_start: c.source_page_start ?? null,
              source_page_end: c.source_page_end ?? null,
              key_terms: c.key_terms,
              rule_type: c.rule_type,
              inferred_difficulty: c.inferred_difficulty ?? null,
              difficulty_reason: c.difficulty_reason ?? null,
              is_approved: false,
              sort_order: sortIndex++,
            }
          })
        )
        const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null)
        if (validRows.length === 0) return 0

        let flushed = 0
        for (let i = 0; i < validRows.length; i += 100) {
          await admin.from('knowledge_chunks').insert(validRows.slice(i, i + 100))
          flushed += Math.min(100, validRows.length - i)
        }
        return flushed
      }

      // Shared per-section/per-batch flush — called by the extractor after each unit completes.
      // Chunks are inserted to DB immediately, so if the SSE connection drops mid-extraction
      // everything flushed so far is already persisted and visible in the Knowledge Graph.
      async function onChunks(chunks: import('@/lib/chunk-extractor').ExtractedChunk[]) {
        const flushed = await flushChunks(chunks)
        totalInserted += flushed
        // Keep source_materials.chunks_extracted current so the admin page reflects live progress
        // even if the browser tab is closed and they come back later.
        await admin
          .from('source_materials')
          .update({ chunks_extracted: totalInserted })
          .eq('id', source_material_id)
      }

      // Questions mode equivalent of flushChunks — UPDATES the matched chunk's existing
      // row(s) with style/difficulty signal, AND inserts the question itself into the shared
      // `questions` table as a draft (origin: 'sample_paper'). It never creates a new
      // knowledge_chunks row — that would break the "chunks only ever come from notes" rule —
      // but the question content is real exam-style material worth keeping, gated behind the
      // same draft → admin-approves → visible-to-users workflow as AI-generated questions.
      // Flushed immediately per batch (same as flushChunks) so a dropped connection only ever
      // costs the one in-flight batch, never previously-saved work.
      async function flushMatches(matches: ChunkMatch[]): Promise<number> {
        let matchedQuestions = 0
        const rows: Array<Record<string, unknown>> = []

        for (const m of matches) {
          if (m.chunk_ids.length > 0) {
            await Promise.all(m.chunk_ids.map(id =>
              admin.from('knowledge_chunks').update({
                exact_source_quote: m.exact_source_quote,
                context_text: m.context_text,
                inferred_difficulty: m.inferred_difficulty,
                difficulty_reason: m.difficulty_reason,
              }).eq('id', id)
            ))
            matchedQuestions++
          }

          if (m.prompt && m.options && m.correct_answer) {
            rows.push({
              topic_id: topic_id ?? null,
              knowledge_chunk_id: m.chunk_ids[0] ?? null,
              additional_chunk_ids: m.chunk_ids.slice(1),
              type: 'mcq',
              difficulty: m.inferred_difficulty,
              prompt: m.prompt,
              options: m.options,
              correct_answer: m.correct_answer,
              explanation: m.exact_source_quote ?? m.context_text ?? null,
              status: 'draft',
              origin: 'sample_paper',
              source_material_id,
              needs_review: m.chunk_ids.length === 0,
            })
          }
        }

        if (rows.length > 0) {
          await admin.from('questions').insert(rows)
        }

        return matchedQuestions
      }

      async function onMatches(matches: ChunkMatch[]) {
        const flushed = await flushMatches(matches)
        const unmatchedInBatch = matches.filter(m => m.chunk_ids.length === 0).length
        totalInserted += flushed
        totalUnmatched += unmatchedInBatch
        await admin
          .from('source_materials')
          .update({ chunks_extracted: totalInserted, chunk_match_unmatched: totalUnmatched })
          .eq('id', source_material_id)
      }

      // Persist the exact resume point after every individual section / question-batch — not
      // just at the end of this request's batch. This is the core of the resumability: even if
      // this request dies mid-batch, the next request only ever has to redo the one unit that
      // was in flight, never the whole document.
      async function onUnitDone(absoluteIndex: number) {
        await admin.from('source_materials').update({
          chunk_sections_done: absoluteIndex,
          chunk_status_updated_at: new Date().toISOString(),
        }).eq('id', source_material_id)
      }

      const batchSize = useQuestionsMode ? QUESTIONS_BATCH_SIZE : NOTES_BATCH_SIZE
      const range = { offset: resumeOffset, limit: batchSize }
      const resultNoun = useQuestionsMode ? 'questions matched' : 'knowledge chunks saved'

      try {
        const result = useQuestionsMode
          ? await matchQuestionsToChunks(material.raw_text!, topic_name ?? 'SQE1', candidates, send, onMatches, range, onUnitDone)
          : await extractChunksFromDocx(docxBuffer!, topic_name ?? 'SQE1', send, onChunks, range, onUnitDone)

        if (!result.done) {
          // More units remain — leave chunk_status as "extracting" (now with a fresh
          // chunk_status_updated_at from onUnitDone) so the client's next call resumes cleanly,
          // and a genuinely abandoned run is still recoverable via the staleness check.
          await admin.from('source_materials').update({
            chunks_extracted: totalInserted,
            chunk_sections_total: result.totalUnits,
          }).eq('id', source_material_id)

          console.log(`${logTag} batch_done — ${result.unitsDone}/${result.totalUnits} sections, ${totalInserted} ${resultNoun}`)
          send({
            stage: 'batch_done',
            message: useQuestionsMode && totalUnmatched > 0
              ? `Batch complete — ${result.unitsDone} / ${result.totalUnits} processed, ${totalInserted} ${resultNoun}, ${totalUnmatched} unmatched (flagged) so far`
              : `Batch complete — ${result.unitsDone} / ${result.totalUnits} processed, ${totalInserted} ${resultNoun} so far`,
            sections_total: result.totalUnits,
            sections_done: result.unitsDone,
            chunks_found: totalInserted,
            unmatched_found: useQuestionsMode ? totalUnmatched : undefined,
          })
          controller.close()
          return
        }

        if (totalInserted === 0) {
          console.error(`${logTag} failed — 0 ${resultNoun} after processing all ${result.totalUnits} units`)
          await admin.from('source_materials').update({
            chunk_status: 'failed',
            chunk_error: useQuestionsMode
              ? `No questions could be matched to existing chunks (${totalUnmatched} flagged as unmatched) — check the topic and document structure`
              : 'No chunks extracted — check document structure',
            chunk_match_unmatched: totalUnmatched,
          }).eq('id', source_material_id)
          send({
            stage: 'error',
            message: useQuestionsMode ? `No matches found — all ${totalUnmatched} questions were flagged as unmatched` : 'No chunks found',
            error: useQuestionsMode ? 'No matches' : 'No chunks extracted',
            unmatched_found: useQuestionsMode ? totalUnmatched : undefined,
          })
          controller.close()
          return
        }

        console.log(`${logTag} done — ${totalInserted} ${resultNoun} total, ${totalUnmatched} unmatched`)
        await admin.from('source_materials').update({
          chunk_status: 'extracted',
          chunks_extracted: totalInserted,
          chunk_sections_total: result.totalUnits,
          chunk_match_unmatched: totalUnmatched,
        }).eq('id', source_material_id)

        send({
          stage: 'done',
          message: useQuestionsMode && totalUnmatched > 0
            ? `Done — ${totalInserted} ${resultNoun}, ${totalUnmatched} questions flagged as unmatched (no existing chunk fit — review manually)`
            : `Done — ${totalInserted} ${resultNoun}`,
          chunks_found: totalInserted,
          sections_done: totalInserted,
          unmatched_found: useQuestionsMode ? totalUnmatched : undefined,
        })
      } catch (err) {
        // Even if we error out, preserve whatever was inserted before the failure. Status goes
        // to "pending" (not "extracted") whenever the document isn't fully done, so the admin
        // upload page knows to offer Resume rather than treating this as finished.
        const msg = err instanceof Error ? err.message : 'Extraction failed'
        console.error(`${logTag} batch threw after ${totalInserted} ${resultNoun} (resumeOffset=${resumeOffset}):`, err)
        await admin.from('source_materials').update({
          chunk_status: totalInserted > 0 ? 'pending' : 'failed',
          chunk_error: totalInserted > 0 ? `Paused after ${totalInserted} chunks: ${msg}` : msg,
          chunks_extracted: totalInserted,
        }).eq('id', source_material_id)
        send({
          stage: 'error',
          message: totalInserted > 0
            ? `Paused after ${totalInserted} chunks — ${msg}. Partial results saved — click Extract again to resume.`
            : msg,
          error: msg,
          chunks_found: totalInserted,
        })
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
