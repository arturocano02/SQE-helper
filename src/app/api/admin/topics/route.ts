/**
 * GET /api/admin/topics
 * Returns all topics with approved chunk counts.
 * Admin only.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const [{ data: topics }, { data: chunkCounts }] = await Promise.all([
    admin.from('topics').select('id, name, slug, paper').order('sort_order'),
    admin
      .from('knowledge_chunks')
      .select('topic_id')
      .eq('is_approved', true),
  ])

  const countMap = new Map<string, number>()
  ;(chunkCounts ?? []).forEach((c: { topic_id: string }) => {
    countMap.set(c.topic_id, (countMap.get(c.topic_id) ?? 0) + 1)
  })

  const result = (topics ?? []).map((t: { id: string; name: string; slug: string; paper: string }) => ({
    ...t,
    approved_chunks: countMap.get(t.id) ?? 0,
  }))

  return NextResponse.json({ topics: result })
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

/**
 * PUT /api/admin/topics
 * Body: { id, name } — renames a topic. Slug is left untouched (questions/chunks/mastery rows
 * reference topic_id, not slug or name, so a rename is always safe and never needs a migration).
 */
export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { id, name } = body as { id?: string; name?: string }
  if (!id || !name?.trim()) {
    return NextResponse.json({ error: 'id and non-empty name required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('topics')
    .update({ name: name.trim() })
    .eq('id', id)
    .select('id, name, slug, paper')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ topic: data })
}

/**
 * POST /api/admin/topics  body: { from_topic_id, into_topic_id }
 * Merges one topic into another: every knowledge_chunk and question under from_topic_id is
 * re-pointed to into_topic_id (subtopic_id cleared, same reasoning as a single chunk retag —
 * the old topic's subtopic taxonomy doesn't apply under the new topic), then from_topic_id's
 * now-empty subtopics/mastery/coverage rows and the topic itself are deleted. Use this instead
 * of rename + DELETE when the topic being removed might still have real content (DELETE alone
 * refuses to touch a topic with chunks/questions on it).
 */
export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { from_topic_id, into_topic_id } = body as { from_topic_id?: string; into_topic_id?: string }
  if (!from_topic_id || !into_topic_id) {
    return NextResponse.json({ error: 'from_topic_id and into_topic_id required' }, { status: 400 })
  }
  if (from_topic_id === into_topic_id) {
    return NextResponse.json({ error: 'from_topic_id and into_topic_id must differ' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { error: chunkErr } = await admin
    .from('knowledge_chunks')
    .update({ topic_id: into_topic_id, subtopic_id: null })
    .eq('topic_id', from_topic_id)
  if (chunkErr) return NextResponse.json({ error: chunkErr.message }, { status: 500 })

  const { error: questionErr } = await admin
    .from('questions')
    .update({ topic_id: into_topic_id })
    .eq('topic_id', from_topic_id)
  if (questionErr) return NextResponse.json({ error: questionErr.message }, { status: 500 })

  await admin.from('subtopics').delete().eq('topic_id', from_topic_id)
  await admin.from('user_topic_mastery').delete().eq('topic_id', from_topic_id)
  await admin.from('user_topic_coverage').delete().eq('topic_id', from_topic_id)

  const { error: deleteErr } = await admin.from('topics').delete().eq('id', from_topic_id)
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/admin/topics?id=...
 * Refuses unless the topic has zero chunks and zero questions — this is for cleaning up a topic
 * that never had real content (e.g. nothing in the source notes maps to it), not for merging
 * topics that already have data. Any user_topic_mastery/user_topic_coverage rows for it are
 * deleted too (they're empty/meaningless without chunks anyway).
 */
export async function DELETE(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()

  const [{ count: chunkCount }, { count: questionCount }] = await Promise.all([
    admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }).eq('topic_id', id),
    admin.from('questions').select('id', { count: 'exact', head: true }).eq('topic_id', id),
  ])

  if ((chunkCount ?? 0) > 0 || (questionCount ?? 0) > 0) {
    return NextResponse.json({
      error: `Topic still has ${chunkCount ?? 0} chunk(s) and ${questionCount ?? 0} question(s) — move or delete those first.`,
    }, { status: 400 })
  }

  await admin.from('subtopics').delete().eq('topic_id', id)
  await admin.from('user_topic_mastery').delete().eq('topic_id', id)
  await admin.from('user_topic_coverage').delete().eq('topic_id', id)

  const { error } = await admin.from('topics').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
