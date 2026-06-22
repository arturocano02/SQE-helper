/**
 * POST /api/admin/chunks/reset
 *
 * Full wipe-and-restart for a source material whose chunk extraction is too damaged for
 * backfill to be worth it (e.g. the topic-resolution bug dropped most of the document, not
 * just a handful of sections — see /api/admin/chunks/backfill's header comment for the bug
 * itself). Deletes every knowledge_chunk for this file (and any questions generated from
 * them, since questions.knowledge_chunk_id is required — an orphaned FK would break those
 * rows anyway), then resets the source_materials row to a clean 'pending' state so the normal
 * extraction flow (now fixed) can run again from the same already-uploaded file. No re-upload
 * needed — the original .docx is still in storage and untouched by this route.
 *
 * Body: { source_material_id: string }
 * Response: { deleted_chunks: number, deleted_questions: number }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { source_material_id } = body as { source_material_id?: string }
  if (!source_material_id) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: material } = await admin
    .from('source_materials')
    .select('id, file_name')
    .eq('id', source_material_id)
    .single()
  if (!material) return NextResponse.json({ error: 'Source material not found' }, { status: 404 })

  // Collect chunk ids first (paginated — same reasoning as the export/backfill routes: a
  // document can have well over 1000 chunks) so we can delete dependent questions before the
  // chunks themselves, avoiding any FK violation on questions.knowledge_chunk_id.
  const chunkIds: string[] = []
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id')
      .eq('source_material_id', source_material_id)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    chunkIds.push(...(data ?? []).map(r => r.id))
    if (!data || data.length < PAGE_SIZE) break
  }

  let deletedQuestions = 0
  if (chunkIds.length > 0) {
    const { data: deletedQ, error: qErr } = await admin
      .from('questions')
      .delete()
      .in('knowledge_chunk_id', chunkIds)
      .select('id')
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })
    deletedQuestions = deletedQ?.length ?? 0

    const { error: cErr } = await admin
      .from('knowledge_chunks')
      .delete()
      .eq('source_material_id', source_material_id)
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  }

  await admin.from('source_materials').update({
    chunk_status: 'pending',
    chunks_extracted: 0,
    chunk_sections_done: 0,
    chunk_error: null,
    chunk_match_unmatched: 0,
  }).eq('id', source_material_id)

  console.log(`[reset ${material.file_name}] deleted ${chunkIds.length} chunks, ${deletedQuestions} dependent questions — ready for clean re-extraction`)

  return NextResponse.json({ deleted_chunks: chunkIds.length, deleted_questions: deletedQuestions })
}
