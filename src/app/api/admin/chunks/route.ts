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

/** Shared shape for "apply to everything matching this filter" — used by both PATCH and
 *  DELETE below so a true "select all" (thousands of rows, not just the ~200 the client has
 *  loaded into memory) never needs the client to know every individual id. Mirrors the same
 *  filters the GET handler above accepts, so "select all matching the current screen" is
 *  always exactly the rows the admin is actually looking at. */
interface ChunkFilter {
  topic_id?: string
  subtopic_id?: string
  source_material_id?: string
  is_approved?: boolean
  needs_review?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyChunkFilter(query: any, filter: ChunkFilter) {
  let q = query
  if (filter.topic_id) q = q.eq('topic_id', filter.topic_id)
  if (filter.subtopic_id) q = q.eq('subtopic_id', filter.subtopic_id)
  if (filter.source_material_id) q = q.eq('source_material_id', filter.source_material_id)
  if (typeof filter.is_approved === 'boolean') q = q.eq('is_approved', filter.is_approved)
  if (typeof filter.needs_review === 'boolean') q = q.eq('needs_review', filter.needs_review)
  return q
}

/** True if the filter has at least one real constraint — without this, an empty `filter: {}`
 *  from a buggy client would silently match (and bulk-update/delete) every chunk in the table. */
function filterHasConstraint(filter: ChunkFilter): boolean {
  return !!(filter.topic_id || filter.subtopic_id || filter.source_material_id
    || typeof filter.is_approved === 'boolean' || typeof filter.needs_review === 'boolean')
}

/**
 * PATCH /api/admin/chunks
 * Bulk update is_approved either on an explicit set of chunk IDs, OR on every row matching a
 * filter — the second form is what "Select all N matching this filter" on the Knowledge Graph
 * page actually sends, since the client only ever has ~200 rows loaded in memory at once.
 * Body: { ids: string[], is_approved: boolean }
 *     or { filter: ChunkFilter, is_approved: boolean }  (filter must have ≥1 real constraint)
 */
export async function PATCH(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { ids, filter, is_approved } = body as { ids?: string[]; filter?: ChunkFilter; is_approved: boolean }

  if (typeof is_approved !== 'boolean') {
    return NextResponse.json({ error: 'is_approved boolean required' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (filter) {
    if (!filterHasConstraint(filter)) {
      return NextResponse.json({ error: 'filter must include at least one constraint — refusing to update every chunk in the table' }, { status: 400 })
    }
    const countQuery = applyChunkFilter(admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }), filter)
    const { count } = await countQuery
    const updateQuery = applyChunkFilter(admin.from('knowledge_chunks').update({ is_approved }), filter)
    const { error } = await updateQuery
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, updated: count ?? 0 })
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array (or filter) required' }, { status: 400 })
  }

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

  // Bulk delete: body contains { ids: string[] } or { filter: ChunkFilter } (the latter is what
  // "Select all N matching this filter" sends — see PATCH above for why ids alone don't scale
  // past the ~200 rows the client actually has loaded).
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = await request.json()
      const { ids, filter } = body as { ids?: string[]; filter?: ChunkFilter }

      if (filter) {
        if (!filterHasConstraint(filter)) {
          return NextResponse.json({ error: 'filter must include at least one constraint — refusing to delete every chunk in the table' }, { status: 400 })
        }
        const countQuery = applyChunkFilter(admin.from('knowledge_chunks').select('id', { count: 'exact', head: true }), filter)
        const { count } = await countQuery
        const deleteQuery = applyChunkFilter(admin.from('knowledge_chunks').delete(), filter)
        const { error } = await deleteQuery
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, deleted: count ?? 0 })
      }

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
