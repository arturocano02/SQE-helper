/**
 * GET /api/admin/chunks/export?source_material_id=...&format=markdown|csv
 *
 * Dumps every knowledge chunk extracted so far from one source material, grouped/ordered by
 * document position (sort_order — which is document order, since chunks are flushed section by
 * section as extraction proceeds). No Claude calls, no re-parsing of the docx — just a read of
 * what's already in the DB — so this is free to call as often as needed while checking progress
 * against the original document.
 *
 * format=markdown (default): one running document, grouped under each source_section breadcrumb —
 *   good for a quick skim alongside the original .docx/.pdf.
 * format=csv: one row per chunk with topic/subtopic/page/rule-type columns — opens directly in
 *   Excel/Sheets, good for sorting/filtering or pasting into a chat to cross-check against the
 *   original document's table of contents and spot what's missing or mis-tagged.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/** Quotes a CSV field only when needed, doubling any embedded quotes — standard Excel/Sheets
 *  escaping, so rule_text/context_text with commas, quotes, or newlines round-trip cleanly
 *  instead of shifting columns. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const sourceMaterialId = searchParams.get('source_material_id')
  const format = searchParams.get('format') === 'csv' ? 'csv' : 'markdown'
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

  type Row = {
    rule_text: string
    rule_type: string
    context_text: string | null
    source_section: string
    source_page_start: number | null
    source_page_end: number | null
    is_approved: boolean
    needs_review: boolean | null
    sort_order: number
    id: string
    topics: { name: string } | null
    subtopics: { name: string } | null
  }

  // Paginated fetch — a long document can have well over 500 chunks (the per-request cap
  // used elsewhere in the admin chunk APIs), and this export needs every single one.
  const PAGE_SIZE = 500
  const rows: Row[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select(`
        id, rule_text, rule_type, context_text, source_section, source_page_start, source_page_end,
        is_approved, needs_review, sort_order,
        topics ( name ),
        subtopics ( name )
      `)
      .eq('source_material_id', sourceMaterialId)
      .order('sort_order')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  if (format === 'csv') {
    const header = [
      'Topic', 'Subtopic', 'Source Section', 'Page Start', 'Page End',
      'Rule Type', 'Rule Text', 'Context', 'Approved', 'Needs Review', 'Chunk ID',
    ]
    const lines = [header.map(csvField).join(',')]
    for (const r of rows) {
      lines.push([
        r.topics?.name ?? '',
        r.subtopics?.name ?? '',
        r.source_section ?? '',
        r.source_page_start ?? '',
        r.source_page_end ?? '',
        r.rule_type ?? '',
        r.rule_text,
        r.context_text ?? '',
        r.is_approved ? 'yes' : 'no',
        r.needs_review ? 'yes' : 'no',
        r.id,
      ].map(csvField).join(','))
    }
    // Leading BOM so Excel (Windows especially) detects UTF-8 instead of mangling accented
    // characters/statute names as Latin-1.
    const csv = '﻿' + lines.join('\r\n')
    const downloadName = material.file_name.replace(/\.[^.]+$/, '') + '-chunks.csv'
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
      },
    })
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
