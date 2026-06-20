/**
 * /api/content-requests
 *
 * POST   — user submits a request for more content on a topic (mcq/flashcard + optional note)
 * GET    — admin only: list requests (optionally filtered by status), default pending first
 * PATCH  — admin only: update a request's status (done/dismissed)
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { QuestionType, ContentRequestStatus } from '@/types/database'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { topic_id, content_type, note } = body as {
    topic_id?: string
    content_type?: QuestionType
    note?: string
  }

  if (!topic_id) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })
  if (content_type !== 'mcq' && content_type !== 'flashcard') {
    return NextResponse.json({ error: 'content_type must be mcq or flashcard' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('content_requests').insert({
    user_id: user.id,
    topic_id,
    content_type,
    note: note?.trim() || null,
    status: 'pending',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function GET(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  const admin = createAdminClient()
  let query = admin
    .from('content_requests')
    .select('*, topics(name, slug, paper)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function PATCH(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, status } = body as { id: string; status: ContentRequestStatus }

  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from('content_requests').update({ status }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
