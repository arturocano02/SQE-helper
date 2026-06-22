/**
 * GET /api/admin/chunks/export?source_material_id=...
 *
 * Dumps every knowledge chunk extracted so far from one source material as plain
 * markdown, grouped under its own source_section breadcrumb in extraction order
 * (sort_order — which is document order, since chunks are flushed section by
 * section as extraction proceeds). No Claude calls, no re-parsing of the docx —
 * just a read of what's already in the DB — so this is free to call as often as
 * needed while checking progress against the original document.
 *
 * Intended use: open this alongside the original .docx/.pdf and skim both side by
 * side to spot anything that looks thin or missing, without re-reading the whole
 * Knowledge Graph admin UI section by section.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const sourceMaterialId = searchParams.get('source_material_id')
  if (!sourceMaterialId) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: material } = await admin
    .from('source_materials')
    .select('file_name, chunk_sections_done, chunk_sections_total, chunks_extracted')
    .eq('id', sourceMaterialId)
    .single()

  if (!material) {
    return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  }

  // Paginated fetch — a long document can have well over 500 chunks (the per-request cap
  // used elsewhere in the admin chunk APIs), and this export needs every single one.
  const PAGE_SIZE = 500
  const rows: Array<{ rule_text: string; rule_type: string; source_section: string; is_approved: boolean; sort_order: number }> = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('rule_text, rule_type, source_section, is_approved, sort_order')
      .eq('source_material_id', sourceMaterialId)
      .order('sort_order')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }

  // Group consecutive chunks under the same breadcrumb into one section — chunks are
  // already in document order (sort_order), so a breadcrumb change marks a new section
  // heading without needing to re-sort or re-parse anything.
  const lines: string[] = []
  lines.push(`# ${material.file_name} — extracted chunks`)
  lines.push('')
  lines.push(
    `Progress: ${material.chunk_sections_done ?? 0} / ${material.chunk_sections_total ?? '?'} sections processed` +
    ` — ${material.chunks_extracted ?? rows.length} chunks total` +
    (material.chunk_sections_total && (material.chunk_sections_done ?? 0) < material.chunk_sections_total
      ? ' (extraction not yet finished — this is a partial export)'
      : '')
  )
  lines.push('')

  let lastSection: string | null = null
  for (const row of rows) {
    if (row.source_section !== lastSection) {
      lines.push('')
      lines.push(`## ${row.source_section}`)
      lastSection = row.source_section
    }
    const approvedMark = row.is_approved ? '✓' : ' '
    lines.push(`- [${approvedMark}] (${row.rule_type}) ${row.rule_text}`)
  }

  const body = lines.join('\n')
  const downloadName = material.file_name.replace(/\.[^.]+$/, '') + '-chunks.md'

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    },
  })
}
