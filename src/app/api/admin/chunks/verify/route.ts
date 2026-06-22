/**
 * POST /api/admin/chunks/verify
 *
 * Read-only coverage check for a notes-mode .docx after extraction. This is the same
 * comparison (re-parse the real docx fresh, flatten to leaf sections, diff against
 * knowledge_chunks.source_section) that a throwaway diagnostic script did by hand to prove the
 * topic-resolution bug — made permanent and pushed into the app itself, so "did this actually
 * read the whole thing" is a button the admin can press after every extraction instead of
 * something that needs a one-off script and live DB access to answer.
 *
 * No Claude calls — pure parsing + a DB read, so this is fast and free to run as often as needed.
 *
 * What it checks:
 *   - section coverage: how many leaf sections (that have real content) have at least one chunk
 *   - character coverage: total characters across leaf sections vs total characters captured in
 *     chunk rule_text + context_text — a thin-but-nonzero section (one short chunk pulled from a
 *     long subsection) shows up here even though it would pass the section-coverage check
 *   - per-chapter breakdown, so a single badly-organised heading doesn't get lost in the average
 *
 * Response: {
 *   sections_total, sections_covered, sections_missing, missing_sections: string[],
 *   thin_sections: Array<{ section, leaf_chars, chunk_chars }>,   // covered but <60% captured
 *   chars_total, chars_captured, char_coverage_pct,
 *   by_chapter: Array<{ chapter, sections_total, sections_covered }>,
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
  const { source_material_id } = body as { source_material_id?: string }
  if (!source_material_id) return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: material, error: matErr } = await admin
    .from('source_materials')
    .select('id, file_name, file_type')
    .eq('id', source_material_id)
    .single()
  if (matErr || !material) return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  if (material.file_type !== 'docx') {
    return NextResponse.json({ error: 'Verify only supports notes-mode .docx files.' }, { status: 400 })
  }

  const { data: fileData } = await admin.storage.from('source_materials').download(material.file_name)
  if (!fileData) return NextResponse.json({ error: 'Original .docx file not found in storage. Please re-upload.' }, { status: 404 })
  const docxBuffer = Buffer.from(await fileData.arrayBuffer())

  const { sections, frontMatterPageEnd } = await parseDocxToSections(docxBuffer)
  const leaves = flattenToLeaves(sections, frontMatterPageEnd).filter(l => l.content.trim().length > 0)

  type ChunkRow = { source_section: string; rule_text: string; context_text: string | null }
  const chunksBySection = new Map<string, ChunkRow[]>()
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('knowledge_chunks')
      .select('source_section, rule_text, context_text')
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

  const missingSections: string[] = []
  const thinSections: Array<{ section: string; leaf_chars: number; chunk_chars: number }> = []
  let charsTotal = 0
  let charsCaptured = 0
  const byChapter = new Map<string, { total: number; covered: number }>()

  for (const leaf of leaves) {
    const breadcrumb = breadcrumbFor(leaf)
    const leafChars = leaf.content.length
    charsTotal += leafChars

    const chapter = leaf.path[0] ?? '(unknown)'
    const chapterStats = byChapter.get(chapter) ?? { total: 0, covered: 0 }
    chapterStats.total++

    const chunks = chunksBySection.get(breadcrumb) ?? []
    if (chunks.length === 0) {
      missingSections.push(breadcrumb)
    } else {
      chapterStats.covered++
      const chunkChars = chunks.reduce((sum, c) => sum + c.rule_text.length + (c.context_text?.length ?? 0), 0)
      charsCaptured += chunkChars
      // rule_text is the VERBATIM source unit (splitContentIntoUnits just splits on blank
      // lines / list items — it never rewrites or summarises), so a fully-captured section
      // should land close to 100% of leafChars, not some fraction of it. The only legitimate
      // shrinkage is: blank-line whitespace collapsed between blocks, and fragments under the
      // 5/10-char noise floor in splitContentIntoUnits being dropped on purpose. 60% is the
      // floor below which that's no longer a plausible explanation and real content loss is.
      if (leafChars > 200 && chunkChars < leafChars * 0.6) {
        thinSections.push({ section: breadcrumb, leaf_chars: leafChars, chunk_chars: chunkChars })
      }
    }
    byChapter.set(chapter, chapterStats)
  }

  const sectionsTotal = leaves.length
  const sectionsMissing = missingSections.length
  const sectionsCovered = sectionsTotal - sectionsMissing
  const charCoveragePct = charsTotal > 0 ? Math.round((charsCaptured / charsTotal) * 100) : 0

  console.log(
    `[verify ${material.file_name}] ${sectionsCovered}/${sectionsTotal} sections covered, ` +
    `${charCoveragePct}% of characters captured in chunks, ${thinSections.length} thin sections flagged` +
    (sectionsMissing > 0 ? ` — MISSING: ${missingSections.slice(0, 10).join(' | ')}${sectionsMissing > 10 ? ` (+${sectionsMissing - 10} more)` : ''}` : '')
  )

  return NextResponse.json({
    sections_total: sectionsTotal,
    sections_covered: sectionsCovered,
    sections_missing: sectionsMissing,
    missing_sections: missingSections.slice(0, 200),
    thin_sections: thinSections.slice(0, 200),
    chars_total: charsTotal,
    chars_captured: charsCaptured,
    char_coverage_pct: charCoveragePct,
    by_chapter: Array.from(byChapter.entries()).map(([chapter, stats]) => ({
      chapter,
      sections_total: stats.total,
      sections_covered: stats.covered,
    })),
  })
}
