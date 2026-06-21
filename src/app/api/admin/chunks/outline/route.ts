/**
 * POST   /api/admin/chunks/outline — Phase 1 of notes-mode extraction.
 *        Parses the document's Contents/TOC page into a heading + page-number outline and
 *        persists it, WITHOUT running any chunk extraction (no Claude calls at all — this is
 *        a single cheap parse). The admin reviews this outline before any real extraction
 *        happens, so what the rest of the document gets tagged against is verified up front
 *        rather than discovered after the fact.
 *
 * PATCH  /api/admin/chunks/outline — confirms the outline that was just read, unlocking
 *        Phase 2 (POST /api/admin/chunks/extract, which now requires this to be true for
 *        notes-mode .docx files before it will run).
 *
 * Body (both): { source_material_id: string }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseDocxToSections, flattenOutlineForTransport } from '@/lib/chunk-extractor'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { error: null }
}

export async function POST(request: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  const { source_material_id } = await request.json() as { source_material_id?: string }
  if (!source_material_id) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: material, error: matErr } = await admin
    .from('source_materials')
    .select('id, file_name, file_type')
    .eq('id', source_material_id)
    .single()

  if (matErr || !material) {
    return NextResponse.json({ error: 'Source material not found' }, { status: 404 })
  }

  if (material.file_type !== 'docx') {
    return NextResponse.json(
      { error: 'Contents-page reading only applies to .docx notes — this file type goes straight to extraction.' },
      { status: 400 }
    )
  }

  const { data: fileData } = await admin.storage.from('source_materials').download(material.file_name)
  if (!fileData) {
    return NextResponse.json({ error: 'Original .docx file not found in storage. Please re-upload the file.' }, { status: 404 })
  }
  const buffer = Buffer.from(await fileData.arrayBuffer())

  let outline: ReturnType<typeof flattenOutlineForTransport>
  let frontMatterPageEnd: number
  try {
    const parsed = await parseDocxToSections(buffer)
    outline = flattenOutlineForTransport(parsed.outline)
    frontMatterPageEnd = parsed.frontMatterPageEnd
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to parse document'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Reset confirmation on every fresh read — if the admin re-reads after a re-upload, the old
  // confirmation shouldn't silently carry over to a different document's outline.
  await admin.from('source_materials').update({
    chunk_outline: { entries: outline, frontMatterPageEnd },
    chunk_outline_confirmed: false,
  }).eq('id', source_material_id)

  return NextResponse.json({ outline, frontMatterPageEnd })
}

export async function PATCH(request: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  const { source_material_id, confirmed } = await request.json() as { source_material_id?: string; confirmed?: boolean }
  if (!source_material_id) {
    return NextResponse.json({ error: 'source_material_id required' }, { status: 400 })
  }

  const admin = createAdminClient()
  await admin.from('source_materials').update({
    chunk_outline_confirmed: confirmed !== false,
  }).eq('id', source_material_id)

  return NextResponse.json({ ok: true })
}
