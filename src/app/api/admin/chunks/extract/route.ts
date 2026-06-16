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
import { extractChunksFromDocx, extractChunksFromQuestions } from '@/lib/chunk-extractor'
import type { ExtractionProgress } from '@/lib/chunk-extractor'

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
    .select('id, file_name, file_type, raw_text, chunk_status')
    .eq('id', source_material_id)
    .single()

  if (matErr || !material) {
    return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  }

  if (material.chunk_status === 'extracting') {
    return NextResponse.json({ error: 'Extraction already in progress' }, { status: 409 })
  }

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

  // Mark as extracting
  await admin.from('source_materials').update({ chunk_status: 'extracting', chunk_error: null }).eq('id', source_material_id)

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

      let totalInserted = 0
      let sortIndex = 0

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
              key_terms: c.key_terms,
              rule_type: c.rule_type,
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

      try {
        if (useQuestionsMode) {
          // Questions mode: flush after each batch of ~5 questions
          await extractChunksFromQuestions(material.raw_text!, topic_name ?? 'SQE1', send, onChunks)
        } else {
          // Notes mode: flush after each section — large docs with many sections are fully safe
          await extractChunksFromDocx(docxBuffer!, topic_name ?? 'SQE1', send, onChunks)
        }

        if (totalInserted === 0) {
          await admin.from('source_materials').update({
            chunk_status: 'failed',
            chunk_error: 'No chunks extracted — check document structure',
          }).eq('id', source_material_id)
          send({ stage: 'error', message: 'No chunks found', error: 'No chunks extracted' })
          controller.close()
          return
        }

        await admin.from('source_materials').update({
          chunk_status: 'extracted',
          chunks_extracted: totalInserted,
        }).eq('id', source_material_id)

        send({
          stage: 'done',
          message: `Done — ${totalInserted} knowledge chunks saved`,
          chunks_found: totalInserted,
          sections_done: totalInserted,
        })
      } catch (err) {
        // Even if we error out, preserve whatever was inserted before the failure
        const msg = err instanceof Error ? err.message : 'Extraction failed'
        await admin.from('source_materials').update({
          chunk_status: totalInserted > 0 ? 'extracted' : 'failed',
          chunk_error: totalInserted > 0 ? `Partial extraction — stopped after ${totalInserted} chunks: ${msg}` : msg,
          chunks_extracted: totalInserted,
        }).eq('id', source_material_id)
        send({
          stage: 'error',
          message: totalInserted > 0
            ? `Stopped after ${totalInserted} chunks — ${msg}. Partial results saved and available in the Knowledge Graph.`
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
