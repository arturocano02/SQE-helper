/**
 * POST /api/feedback  — submit feedback (user-facing)
 * GET  /api/feedback  — list all feedback (admin only)
 * PATCH /api/feedback — update feedback status (admin only)
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { FeedbackType } from '@/types/database'

const VALID_TYPES: FeedbackType[] = [
  'wrong_answer', 'poor_explanation', 'outdated_law', 'misleading_question',
  'chunk_dispute', 'flashcard_dispute', 'bug', 'feature_request', 'content_request', 'other',
]

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const body = await request.json()
  const { feedback_type, description, question_id, knowledge_chunk_id } = body as {
    feedback_type: FeedbackType
    description: string
    question_id?: string | null
    knowledge_chunk_id?: string | null
  }

  if (!VALID_TYPES.includes(feedback_type)) {
    return NextResponse.json({ error: 'Invalid feedback type' }, { status: 400 })
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: 'Description required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('feedback').insert({
    user_id: user?.id ?? null,
    question_id: question_id ?? null,
    knowledge_chunk_id: knowledge_chunk_id ?? null,
    feedback_type,
    description: description.trim(),
    status: 'pending',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Disputing a chunk flags it for admin review in the Knowledge Graph page.
  if (feedback_type === 'chunk_dispute' && knowledge_chunk_id) {
    await admin.from('knowledge_chunks').update({ needs_review: true }).eq('id', knowledge_chunk_id)
  }

  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const hasQuestion = searchParams.get('has_question')

  const admin = createAdminClient()
  let query = admin
    .from('feedback')
    .select('*, questions(prompt, topic_id, topics(name))')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (hasQuestion === 'true') query = query.not('question_id', 'is', null)
  if (hasQuestion === 'false') query = query.is('question_id', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feedback: data ?? [] })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, status, admin_note } = body as { id: string; status?: string; admin_note?: string }

  const admin = createAdminClient()
  const { error } = await admin.from('feedback').update({
    ...(status ? { status } : {}),
    ...(admin_note !== undefined ? { admin_note } : {}),
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
