/**
 * POST /api/admin/chunks/cleanup-orphans
 *
 * knowledge_chunks.source_material_id is ON DELETE SET NULL against source_materials (see
 * 20260610_knowledge_chunks.sql). That means deleting a source_materials row directly (e.g. from
 * the Supabase table editor, rather than through the app's own "Reset & re-extract" flow) does
 * NOT delete its chunks — it just detaches them, leaving them sitting in the Knowledge Graph
 * with no source file to trace back to, and still eligible to be approved or to back a live
 * question. This route finds every chunk with source_material_id IS NULL, deletes any questions
 * generated from them (questions.knowledge_chunk_id would otherwise point at a chunk that's
 * about to disappear), then deletes the chunks themselves.
 *
 * Response: { deleted_chunks: number, deleted_questions: number }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const chunkIds: string[] = []
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('id')
      .is('source_material_id', null)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    chunkIds.push(...(data ?? []).map(r => r.id))
    if (!data || data.length < PAGE_SIZE) break
  }

  if (chunkIds.length === 0) {
    return NextResponse.json({ deleted_chunks: 0, deleted_questions: 0 })
  }

  const { data: deletedQ, error: qErr } = await admin
    .from('questions')
    .delete()
    .in('knowledge_chunk_id', chunkIds)
    .select('id')
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  const { error: cErr } = await admin
    .from('knowledge_chunks')
    .delete()
    .is('source_material_id', null)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  console.log(`[cleanup-orphans] deleted ${chunkIds.length} orphaned chunks, ${deletedQ?.length ?? 0} dependent questions`)

  return NextResponse.json({ deleted_chunks: chunkIds.length, deleted_questions: deletedQ?.length ?? 0 })
}
