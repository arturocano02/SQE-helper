/**
 * /api/admin/chunks
 *
 * GET  ?topic_id=&subtopic_id=&is_approved=&page=&limit=
 *      → paginated list of knowledge chunks
 *
 * PUT  body: { id, ...fields }
 *      → update a chunk (rule_text, is_approved, rule_type, key_terms, subtopic_id)
 *
 * DELETE ?id=
 *      → delete a chunk
 *
 * POST body: { topic_id, rule_text, ... }
 *      → create a manual chunk
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

export async function GET(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const topic_id = searchParams.get('topic_id')
  const subtopic_id = searchParams.get('subtopic_id')
  const is_approved = searchParams.get('is_approved')
  const needs_review = searchParams.get('needs_review')
  const source_material_id = searchParams.get('source_material_id')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500)
  const offset = (page - 1) * limit

  const admin = createAdminClient()
  let query = admin
    .from('knowledge_chunks')
    .select('*, subtopics(name)', { count: 'exact' })
    .order('sort_order')
    .order('created_at')
    .range(offset, offset + limit - 1)

  if (topic_id) query = query.eq('topic_id', topic_id)
  if (subtopic_id) query = query.eq('subtopic_id', subtopic_id)
  if (source_material_id) query = query.eq('source_material_id', source_material_id)
  if (is_approved === 'true') query = query.eq('is_approved', true)
  if (is_approved === 'false') query = query.eq('is_approved', false)
  if (needs_review === 'true') query = query.eq('needs_review', true)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ chunks: data ?? [], total: count ?? 0, page, limit })
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { topic_id, subtopic_id, rule_text, context_text, source_section, key_terms, rule_type } = body

  if (!topic_id || !rule_text) {
    return NextResponse.json({ error: 'topic_id and rule_text are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('knowledge_chunks')
    .insert({
      topic_id,
      subtopic_id: subtopic_id ?? null,
      rule_text: rule_text.trim(),
      context_text: context_text ?? null,
      source_section: source_section ?? null,
      key_terms: key_terms ?? [],
      rule_type: rule_type ?? 'general_principle',
      is_approved: false,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ chunk: data })
}

export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, ...fields } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Whitelist updatable fields
  const allowed: Record<string, unknown> = {}
  for (const key of ['rule_text', 'context_text', 'source_section', 'key_terms', 'rule_type', 'is_approved', 'subtopic_id', 'sort_order', 'needs_review', 'inferred_difficulty', 'difficulty_reason']) {
    if (key in fields) allowed[key] = fields[key]
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('knowledge_chunks')
    .update(allowed)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ chunk: data })
}

/**
 * PATCH /api/admin/chunks
 * Bulk update is_approved on a set of chunk IDs in a single DB query.
 * Body: { ids: string[], is_approved: boolean }
 */
export async function PATCH(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { ids, is_approved } = body as { ids: string[]; is_approved: boolean }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }
  if (typeof is_approved !== 'boolean') {
    return NextResponse.json({ error: 'is_approved boolean required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('knowledge_chunks')
    .update({ is_approved })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: ids.length })
}

export async function DELETE(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  // Bulk delete: body contains { ids: string[] }
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json()
      const { ids } = body as { ids?: string[] }
      if (Array.isArray(ids) && ids.length > 0) {
        const { error } = await admin.from('knowledge_chunks').delete().in('id', ids)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, deleted: ids.length })
      }
    } catch { /* fall through to single-id path */ }
  }

  // Single delete via query param
  if (!id) return NextResponse.json({ error: 'id or ids required' }, { status: 400 })
  const { error } = await admin.from('knowledge_chunks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
