/**
 * POST /api/admin/chunks/apply-fix
 *
 * Applies an admin-reviewed correction (usually drafted by /api/admin/chunks/suggest-fix,
 * but the admin may have hand-edited it first) to a knowledge chunk, and closes the loop
 * on the feedback that prompted it: marks the feedback actioned, and archives the specific
 * question/flashcard that was flagged so it stops being served immediately — new questions
 * can be generated from the corrected chunk via the existing "generate more" flow whenever
 * the admin is ready, rather than this route trying to regenerate them itself.
 *
 * Body: {
 *   chunk_id: string
 *   rule_text: string
 *   context_text?: string | null
 *   feedback_id?: string
 *   admin_note?: string
 *   archive_question_id?: string
 * }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as {
    chunk_id?: string
    rule_text?: string
    context_text?: string | null
    feedback_id?: string
    admin_note?: string
    archive_question_id?: string
  }

  const { chunk_id, rule_text, context_text, feedback_id, admin_note, archive_question_id } = body

  if (!chunk_id || !rule_text?.trim()) {
    return NextResponse.json({ error: 'chunk_id and rule_text are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: chunk, error: chunkError } = await admin
    .from('knowledge_chunks')
    .update({
      rule_text: rule_text.trim(),
      context_text: context_text?.trim() || null,
      needs_review: false,
    })
    .eq('id', chunk_id)
    .select('*')
    .single()

  if (chunkError) return NextResponse.json({ error: chunkError.message }, { status: 500 })

  if (feedback_id) {
    await admin.from('feedback').update({
      status: 'actioned',
      ...(admin_note !== undefined ? { admin_note } : {}),
    }).eq('id', feedback_id)
  }

  if (archive_question_id) {
    await admin.from('questions').update({ status: 'archived' }).eq('id', archive_question_id)
  }

  return NextResponse.json({ ok: true, chunk })
}
