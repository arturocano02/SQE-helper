/**
 * POST /api/admin/upload/delete
 *
 * Deletes ONE uploaded source material entirely — the file in storage, its source_materials
 * row, every knowledge_chunk extracted from it, every question generated/matched from it
 * (whether linked via knowledge_chunk_id or, for sample-paper questions with no match,
 * directly via questions.source_material_id), and any per-user history/SRS rows that exist
 * solely because of those now-deleted questions.
 *
 * This is the per-file version of /api/admin/content/full-reset — for when one upload is
 * stuck, wrong, or duplicated, and the fix is "delete it and upload the right file", not
 * wiping the whole content pipeline.
 *
 * Body: { source_material_id: string }
 * Response: { deleted_chunks, deleted_questions, deleted_question_history, deleted_srs }
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

  try {
    // Chunk ids for this file (paginated — a single doc can have well over 1000 chunks).
    const chunkIds: string[] = []
    const PAGE_SIZE = 1000
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from('knowledge_chunks')
        .select('id')
        .eq('source_material_id', source_material_id)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw new Error(`knowledge_chunks: ${error.message}`)
      chunkIds.push(...(data ?? []).map(r => r.id))
      if (!data || data.length < PAGE_SIZE) break
    }

    // Questions tied to this file — either via a matched chunk, or directly via
    // source_material_id (sample-paper questions that came back unmatched still get a
    // source_material_id but no knowledge_chunk_id).
    const questionIds = new Set<string>()
    if (chunkIds.length > 0) {
      const { data, error } = await admin.from('questions').select('id').in('knowledge_chunk_id', chunkIds)
      if (error) throw new Error(`questions (by chunk): ${error.message}`)
      for (const r of data ?? []) questionIds.add(r.id)
    }
    {
      const { data, error } = await admin.from('questions').select('id').eq('source_material_id', source_material_id)
      if (error) throw new Error(`questions (by source material): ${error.message}`)
      for (const r of data ?? []) questionIds.add(r.id)
    }
    const allQuestionIds = [...questionIds]

    // FK-safe order: history/SRS rows have a plain (no ON DELETE) FK to questions, so they
    // have to go before the questions themselves — same ordering as full-reset.
    let deletedQuestionHistory = 0
    let deletedSrs = 0
    if (allQuestionIds.length > 0) {
      const { data: delHist, error: histErr } = await admin
        .from('question_history').delete().in('question_id', allQuestionIds).select('id')
      if (histErr) throw new Error(`question_history: ${histErr.message}`)
      deletedQuestionHistory = delHist?.length ?? 0

      const { data: delSrs, error: srsErr } = await admin
        .from('user_question_srs').delete().in('question_id', allQuestionIds).select('user_id')
      if (srsErr) throw new Error(`user_question_srs: ${srsErr.message}`)
      deletedSrs = delSrs?.length ?? 0

      const { error: qErr } = await admin.from('questions').delete().in('id', allQuestionIds)
      if (qErr) throw new Error(`questions: ${qErr.message}`)
    }

    if (chunkIds.length > 0) {
      const { error: cErr } = await admin
        .from('knowledge_chunks').delete().eq('source_material_id', source_material_id)
      if (cErr) throw new Error(`knowledge_chunks: ${cErr.message}`)
    }

    const { error: smErr } = await admin.from('source_materials').delete().eq('id', source_material_id)
    if (smErr) throw new Error(`source_materials: ${smErr.message}`)

    await admin.storage.from('source_materials').remove([material.file_name])

    console.log(
      `[upload/delete ${material.file_name}] deleted ${chunkIds.length} chunks, ${allQuestionIds.length} questions, ` +
      `${deletedQuestionHistory} history rows, ${deletedSrs} SRS rows, and the source file.`
    )

    return NextResponse.json({
      deleted_chunks: chunkIds.length,
      deleted_questions: allQuestionIds.length,
      deleted_question_history: deletedQuestionHistory,
      deleted_srs: deletedSrs,
    })
  } catch (err) {
    console.error(`[upload/delete ${material.file_name}] failed:`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Delete failed' }, { status: 500 })
  }
}
