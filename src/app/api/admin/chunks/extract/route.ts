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

      try {
        const chunks = useQuestionsMode
          ? await extractChunksFromQuestions(material.raw_text!, topic_name ?? 'SQE1', send)
          : await extractChunksFromDocx(docxBuffer!, topic_name ?? 'SQE1', send)

        if (chunks.length === 0) {
          await admin.from('source_materials').update({
            chunk_status: 'failed',
            chunk_error: 'No chunks extracted — check document structure',
          }).eq('id', source_material_id)
          send({ stage: 'error', message: 'No chunks found', error: 'No chunks extracted' })
          controller.close()
          return
        }

        // Fetch all topics so we can resolve slug → topic_id per chunk
        const { data: allTopics } = await admin.from('topics').select('id, slug')
        const slugToTopicId = new Map((allTopics ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]))
        const fallbackTopicId = topic_id ?? null

        // Get or create subtopics — keyed by "topic_id:subtopic_name"
        const subtopicMap = new Map<string, string>()

        for (const chunk of chunks) {
          const resolvedTopicId = (chunk.topic_slug ? slugToTopicId.get(chunk.topic_slug) : null) ?? fallbackTopicId
          if (!resolvedTopicId) continue

          const sname = chunk.subtopic_name
          const mapKey = `${resolvedTopicId}:${sname}`
          if (subtopicMap.has(mapKey)) continue

          const slug = sname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          const { data: existing } = await admin
            .from('subtopics')
            .select('id')
            .eq('topic_id', resolvedTopicId)
            .eq('slug', slug)
            .maybeSingle()

          if (existing) {
            subtopicMap.set(mapKey, existing.id)
          } else {
            const { data: created } = await admin
              .from('subtopics')
              .insert({ topic_id: resolvedTopicId, name: sname, slug })
              .select('id')
              .single()
            if (created) subtopicMap.set(mapKey, created.id)
          }
        }

        // Batch insert chunks (100 at a time to avoid payload limits)
        const rows = chunks
          .map((c, i) => {
            const resolvedTopicId = (c.topic_slug ? slugToTopicId.get(c.topic_slug) : null) ?? fallbackTopicId
            if (!resolvedTopicId) return null
            const mapKey = `${resolvedTopicId}:${c.subtopic_name}`
            return {
              topic_id: resolvedTopicId,
              subtopic_id: subtopicMap.get(mapKey) ?? null,
              source_material_id,
              rule_text: c.rule_text,
              exact_source_quote: c.exact_source_quote ?? null,
              context_text: c.context_text ?? null,
              source_section: c.source_section,
              key_terms: c.key_terms,
              rule_type: c.rule_type,
              is_approved: false,
              sort_order: i,
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)

        let inserted = 0
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100)
          await admin.from('knowledge_chunks').insert(batch)
          inserted += batch.length
        }

        // Update source material status
        await admin.from('source_materials').update({
          chunk_status: 'extracted',
          chunks_extracted: inserted,
        }).eq('id', source_material_id)

        send({
          stage: 'done',
          message: `Done — ${inserted} knowledge chunks saved`,
          chunks_found: inserted,
          sections_done: inserted,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Extraction failed'
        await admin.from('source_materials').update({
          chunk_status: 'failed',
          chunk_error: msg,
        }).eq('id', source_material_id)
        send({ stage: 'error', message: msg, error: msg })
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
