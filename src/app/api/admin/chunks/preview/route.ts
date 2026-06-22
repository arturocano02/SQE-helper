/**
 * POST /api/admin/chunks/preview
 *
 * Manual eyeball check, requested directly: "give me the first 5 pages of content that it
 * creates into knowledge chunks so I can verify". The /verify route already proves coverage
 * with numbers (sections covered, % of characters captured) — this route exists for the
 * different, more direct question underneath that: "show me the actual text, original next to
 * what got saved, so I can read it myself and judge whether it's right", not just whether the
 * character counts roughly line up.
 *
 * Re-parses the real .docx fresh (same parseDocxToSections/flattenToLeaves used everywhere
 * else), takes every leaf section whose firstPage falls within the first N pages of the
 * document (or, if the document has no page numbers at all, the first N leaf sections in
 * document order), and pairs each one with the chunks actually saved for it — in the *original
 * unit order* (sort_order), so an admin can read straight down "original text" and "what we
 * saved" and see at a glance whether anything was dropped, merged wrongly, or reworded.
 *
 * No Claude calls — pure parsing + a DB read.
 *
 * Body: { source_material_id: string, page_limit?: number }  (page_limit defaults to 5)
 *
 * Response: {
 *   file_name, page_limit,
 *   sections: Array<{
 *     section: string,        // breadcrumb, e.g. "Contract > Formation > Offer (p. 3)"
 *     page: number | null,
 *     original_content: string,
 *     original_chars: number,
 *     chunks: Array<{ rule_text: string; rule_type: string }>,
 *     chunk_chars: number,
 *   }>,
 * }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseDocxToSections, flattenToLeaves, breadcrumbFor } from '@/lib/chunk-extractor'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { source_material_id, page_limit } = body as { source_material_id?: string; page_limit?: number }
  if (!source_material_id) return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  const pageLimit = page_limit && page_limit > 0 ? page_limit : 5

  const admin = createAdminClient()
  const { data: material, error: matErr } = await admin
    .from('source_materials')
    .select('id, file_name, file_type')
    .eq('id', source_material_id)
    .single()
  if (matErr || !material) return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  if (material.file_type !== 'docx') {
    return NextResponse.json({ error: 'Preview only supports notes-mode .docx files.' }, { status: 400 })
  }

  const { data: fileData } = await admin.storage.from('source_materials').download(material.file_name)
  if (!fileData) return NextResponse.json({ error: 'Original .docx file not found in storage. Please re-upload.' }, { status: 404 })
  const docxBuffer = Buffer.from(await fileData.arrayBuffer())

  const { sections, frontMatterPageEnd } = await parseDocxToSections(docxBuffer)
  const allLeaves = flattenToLeaves(sections, frontMatterPageEnd).filter(l => l.content.trim().length > 0)

  // Pick the leaves to show: everything whose firstPage is within the first `pageLimit` pages.
  // If the document has no detected page numbers at all (firstPage is null throughout — happens
  // for some plain .docx exports), fall back to the first `pageLimit * 3` leaves in document
  // order instead, since "page" has no meaning to filter on.
  const pagedLeaves = allLeaves.filter(l => l.firstPage !== null && l.firstPage <= pageLimit)
  const targetLeaves = pagedLeaves.length > 0 ? pagedLeaves : allLeaves.slice(0, pageLimit * 3)

  type ChunkRow = { source_section: string; rule_text: string; rule_type: string; sort_order: number }
  const chunksBySection = new Map<string, ChunkRow[]>()
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('source_section, rule_text, rule_type, sort_order')
      .eq('source_material_id', source_material_id)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const row of (data ?? []) as ChunkRow[]) {
      const list = chunksBySection.get(row.source_section) ?? []
      list.push(row)
      chunksBySection.set(row.source_section, list)
    }
    if (!data || data.length < PAGE_SIZE) break
  }

  const result = targetLeaves.map(leaf => {
    const breadcrumb = breadcrumbFor(leaf)
    const chunks = (chunksBySection.get(breadcrumb) ?? []).sort((a, b) => a.sort_order - b.sort_order)
    const chunkChars = chunks.reduce((sum, c) => sum + c.rule_text.length, 0)
    return {
      section: breadcrumb,
      page: leaf.firstPage,
      original_content: leaf.content,
      original_chars: leaf.content.length,
      chunks: chunks.map(c => ({ rule_text: c.rule_text, rule_type: c.rule_type })),
      chunk_chars: chunkChars,
    }
  })

  console.log(
    `[preview ${material.file_name}] showing ${result.length} sections ` +
    `(${pagedLeaves.length > 0 ? `pages 1-${pageLimit}` : `first ${targetLeaves.length} sections, no page numbers detected`})`
  )

  return NextResponse.json({
    file_name: material.file_name,
    page_limit: pageLimit,
    used_page_numbers: pagedLeaves.length > 0,
    sections: result,
  })
}
