/**
 * POST /api/admin/content/full-reset
 *
 * "Wipe everything & start fresh" — for when the admin wants the upload page and Knowledge
 * Graph to look exactly like day one, instead of picking through a pile of duplicate/half-
 * finished source_materials rows accumulated while troubleshooting extraction.
 *
 * Deletes, in FK-safe order:
 *   1. question_history / user_question_srs rows that point at a question (both have a plain
 *      `question_id` FK with no ON DELETE clause — i.e. RESTRICT — so deleting questions first
 *      would fail with a foreign-key violation otherwise).
 *   2. questions (knowledge_chunk_id is ON DELETE SET NULL so this could be skipped, but
 *      deleting explicitly avoids relying on cascade order across two separate deletes).
 *   3. knowledge_chunks (user_chunk_mastery has ON DELETE CASCADE on chunk_id, so those rows
 *      clean up automatically; feedback.knowledge_chunk_id is ON DELETE SET NULL).
 *   4. source_materials rows.
 *   5. the underlying files in the `source_materials` storage bucket.
 *
 * This does NOT touch topics, profiles, sessions, or feedback rows themselves — only the
 * content pipeline (source files → chunks → questions) and the per-user signals that exist
 * solely because of now-deleted questions.
 *
 * Response: { deleted_source_materials, deleted_chunks, deleted_questions,
 *             deleted_question_history, deleted_srs, deleted_storage_files }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Deletes every row in `table`, in small batches rather than one `.in(column, allIds)` call.
 * PostgREST turns `.in()` into a literal `id=in.(uuid1,uuid2,...)` query string on the underlying
 * REST request — with thousands of chunks, that one URL grows past Cloudflare's request-URI
 * length limit and the whole reset fails with a 414, even though the delete itself would have
 * been fine. Deleting ~150 rows at a time keeps every individual request small while still
 * working through the entire table — same end result ("everything gone"), just in parts.
 */
async function deleteAllIds(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  column = 'id',
): Promise<number> {
  const BATCH_SIZE = 150
  let total = 0
  while (true) {
    const { data, error } = await admin.from(table).select(column).limit(BATCH_SIZE)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as unknown as Array<Record<string, string>>
    if (rows.length === 0) break
    const ids = rows.map(r => r[column])
    const { error: delErr } = await admin.from(table).delete().in(column, ids)
    if (delErr) throw new Error(`${table} delete: ${delErr.message}`)
    total += ids.length
    if (rows.length < BATCH_SIZE) break
  }
  return total
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  try {
    // Grab file names before wiping source_materials so the storage objects can go too.
    const { data: materials } = await admin.from('source_materials').select('file_name')
    const fileNames = (materials ?? []).map(m => m.file_name).filter(Boolean)

    const deletedQuestionHistory = await deleteAllIds(admin, 'question_history')

    // user_question_srs has a composite primary key (user_id, question_id) — no single `id`
    // column to page through, so delete it directly instead of via deleteAllIds. question_id
    // is always set on every row, so "not null" matches everything.
    const { data: srsRows, error: srsSelectErr } = await admin.from('user_question_srs').select('question_id')
    if (srsSelectErr) throw new Error(`user_question_srs: ${srsSelectErr.message}`)
    const deletedSrs = srsRows?.length ?? 0
    if (deletedSrs > 0) {
      const { error: srsDeleteErr } = await admin.from('user_question_srs').delete().not('question_id', 'is', null)
      if (srsDeleteErr) throw new Error(`user_question_srs delete: ${srsDeleteErr.message}`)
    }

    const deletedQuestions = await deleteAllIds(admin, 'questions')
    const deletedChunks = await deleteAllIds(admin, 'knowledge_chunks')
    const deletedSourceMaterials = await deleteAllIds(admin, 'source_materials')

    let deletedStorageFiles = 0
    if (fileNames.length > 0) {
      const { data: removed, error: storageErr } = await admin.storage.from('source_materials').remove(fileNames)
      if (!storageErr) deletedStorageFiles = removed?.length ?? 0
    }

    console.log(
      `[full-reset] wiped ${deletedSourceMaterials} source materials, ${deletedChunks} chunks, ` +
      `${deletedQuestions} questions, ${deletedQuestionHistory} history rows, ${deletedSrs} SRS rows, ` +
      `${deletedStorageFiles} storage files`
    )

    return NextResponse.json({
      deleted_source_materials: deletedSourceMaterials,
      deleted_chunks: deletedChunks,
      deleted_questions: deletedQuestions,
      deleted_question_history: deletedQuestionHistory,
      deleted_srs: deletedSrs,
      deleted_storage_files: deletedStorageFiles,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Full reset failed' }, { status: 500 })
  }
}
