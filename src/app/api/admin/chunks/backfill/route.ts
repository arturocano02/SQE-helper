/**
 * POST /api/admin/chunks/backfill
 *
 * Recovery route for a real bug (not the original "extraction incomplete" assumption): topic
 * detection (detectTopicSlug / outlineTopicMap in chunk-extractor.ts) only recognised the 12
 * literal SQE1 paper/topic names. Revision-note documents very often organise their own chapter
 * headings around narrower categories instead (e.g. "TRADITIONAL PARTNERSHIPS", "Sole trader"),
 * which never matched. Because a single multi-topic document can't have one topic preselected
 * for the whole file, every chunk under an unmatched chapter heading was silently dropped in
 * flushChunks — with chunk_sections_done/chunk_status still advancing normally, since that
 * checkpoint only tracks "was this leaf section visited", not "did its chunks actually get
 * inserted". A document can therefore read as 100% "extracted" while large parts of it have
 * zero chunks. classifyTopicSlugWithAI (added alongside this route) fixes topic resolution for
 * all NEW extraction going forward; this route recovers documents that already finished under
 * the old, lossier logic.
 *
 * Body: { source_material_id: string, topic_id?: string, topic_name?: string, batch_size?: number }
 *
 * Each call re-derives "which leaf sections currently have zero chunks" fresh from the DB —
 * there's no separate checkpoint to get out of sync, since a leaf that gets filled in one call
 * simply stops showing up as missing on the next. This also means it's safe to call repeatedly
 * (e.g. from a client-side loop, the same pattern the main extract route uses) until
 * remaining_missing hits 0.
 *
 * Response: { done: boolean, total_missing_before: number, processed_this_batch: number,
 *             chunks_inserted_this_batch: number, remaining_missing: number }
 */

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseDocxToSections, flattenToLeaves, extractChunksFromSection, breadcrumbFor } from '@/lib/chunk-extractor'

export const maxDuration = 280

const DEFAULT_BATCH_SIZE = 4

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { source_material_id, topic_id, topic_name, batch_size } = body as {
    source_material_id?: string
    topic_id?: string
    topic_name?: string
    batch_size?: number
  }

  if (!source_material_id) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: material, error: matErr } = await admin
    .from('source_materials')
    .select('id, file_name, file_type, chunks_extracted')
    .eq('id', source_material_id)
    .single()

  if (matErr || !material) {
    return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  }

  if (material.file_type !== 'docx') {
    return NextResponse.json(
      { error: 'Backfill only supports notes-mode .docx files — the topic-detection bug this recovers from only affects that path.' },
      { status: 400 },
    )
  }

  const { data: fileData } = await admin.storage.from('source_materials').download(material.file_name)
  if (!fileData) {
    return NextResponse.json({ error: 'Original .docx file not found in storage. Please re-upload.' }, { status: 404 })
  }
  const docxBuffer = Buffer.from(await fileData.arrayBuffer())

  const { sections, outlineTopicMap, frontMatterPageEnd } = await parseDocxToSections(docxBuffer)
  const leaves = flattenToLeaves(sections, frontMatterPageEnd)

  // What already exists — a leaf counts as "covered" if even one chunk was saved under its
  // exact breadcrumb. Paginate the read since a long document can have well over 1000 chunks.
  const existingBreadcrumbs = new Set<string>()
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('source_section')
      .eq('source_material_id', source_material_id)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of data ?? []) existingBreadcrumbs.add(row.source_section)
    if (!data || data.length < PAGE_SIZE) break
  }

  const missingLeaves = leaves.filter(l => l.content.trim() && !existingBreadcrumbs.has(breadcrumbFor(l)))

  if (missingLeaves.length === 0) {
    return NextResponse.json({
      done: true,
      total_missing_before: 0,
      processed_this_batch: 0,
      chunks_inserted_this_batch: 0,
      remaining_missing: 0,
    })
  }

  const batchSize = batch_size && batch_size > 0 ? batch_size : DEFAULT_BATCH_SIZE
  const batch = missingLeaves.slice(0, batchSize)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { data: allTopics } = await admin.from('topics').select('id, slug')
  const slugToTopicId = new Map((allTopics ?? []).map((t: { id: string; slug: string }) => [t.slug, t.id]))
  const subtopicMap = new Map<string, string>()
  const topicSlugCache = new Map<string, string | null>()

  async function ensureSubtopic(resolvedTopicId: string, subtopicName: string): Promise<string | null> {
    const mapKey = `${resolvedTopicId}:${subtopicName}`
    if (subtopicMap.has(mapKey)) return subtopicMap.get(mapKey)!
    const slug = subtopicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data: existing } = await admin.from('subtopics').select('id').eq('topic_id', resolvedTopicId).eq('slug', slug).maybeSingle()
    if (existing) { subtopicMap.set(mapKey, existing.id); return existing.id }
    const { data: created } = await admin.from('subtopics').insert({ topic_id: resolvedTopicId, name: subtopicName, slug }).select('id').single()
    if (created) { subtopicMap.set(mapKey, created.id); return created.id }
    return null
  }

  let sortIndex = material.chunks_extracted ?? 0
  let insertedThisBatch = 0
  let droppedThisBatch = 0

  for (const leaf of batch) {
    const chunks = await extractChunksFromSection(client, leaf, topic_name ?? 'SQE1', outlineTopicMap, topicSlugCache)
    const rows = await Promise.all(
      chunks.map(async c => {
        const resolvedTopicId = (c.topic_slug ? slugToTopicId.get(c.topic_slug) : null) ?? topic_id ?? null
        if (!resolvedTopicId) { droppedThisBatch++; return null }
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
      }),
    )
    const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null)
    if (validRows.length > 0) {
      await admin.from('knowledge_chunks').insert(validRows)
      insertedThisBatch += validRows.length
    }
  }

  if (insertedThisBatch > 0) {
    await admin.from('source_materials').update({ chunks_extracted: sortIndex }).eq('id', source_material_id)
  }

  if (droppedThisBatch > 0) {
    console.error(`[backfill ${material.file_name}] ${droppedThisBatch} chunks still couldn't resolve a topic even with the AI fallback`)
  }

  return NextResponse.json({
    done: missingLeaves.length <= batch.length,
    total_missing_before: missingLeaves.length,
    processed_this_batch: batch.length,
    chunks_inserted_this_batch: insertedThisBatch,
    remaining_missing: missingLeaves.length - batch.length,
    dropped_this_batch: droppedThisBatch,
  })
}
