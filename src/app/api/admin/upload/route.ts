/**
 * POST /api/admin/upload
 *
 * Saves one or more files to Supabase Storage and creates a source_materials
 * record for each. Text is extracted immediately (mammoth / pdf-parse) and
 * stored in raw_text so the chunk-extraction step can use it later.
 *
 * This route does NOT generate questions. Question generation happens separately
 * from approved knowledge chunks via /api/admin/chunks/generate.
 *
 * Body: multipart/form-data
 *   files  — one or more files (.docx, .pdf, .txt)
 *
 * Response: { results: FileResult[] }
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'

interface FileResult {
  file: string
  source_material_id: string | null
  chars_extracted: number
  error: string | null
  reused_existing: boolean
}

function hashFile(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// PDF text extraction with embedded page markers.
// We replicate pdf-parse's default render_page() line-joining logic exactly
// (Y-coordinate based) so extraction quality is unchanged — the only addition
// is a `[[PAGE:N]]` marker prepended before each page's text, which the
// chunk extractor scans for and strips before sending anything to Claude.
// This is what makes page-range tracking possible in "sample papers" mode,
// where no page info existed before.
function renderPageWithMarker(pageData: {
  pageNumber: number
  getTextContent: (options?: unknown) => Promise<{ items: Array<{ str: string; transform: number[] }> }>
}): Promise<string> {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  }
  return pageData.getTextContent(renderOptions as never).then(textContent => {
    let lastY: number | null = null
    let text = ''
    for (const item of textContent.items) {
      if (lastY === null || lastY === item.transform[5]) {
        text += item.str
      } else {
        text += `\n${item.str}`
      }
      lastY = item.transform[5]
    }
    return `[[PAGE:${pageData.pageNumber}]]\n${text}`
  })
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === 'txt') return buffer.toString('utf-8')
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer })).value
  }
  if (ext === 'pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (
      buf: Buffer,
      opts: { pagerender: typeof renderPageWithMarker }
    ) => Promise<{ text: string }>
    return (await pdfParse(buffer, { pagerender: renderPageWithMarker })).text
  }
  throw new Error(`Unsupported file type: .${ext}`)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData()
  const files = formData.getAll('files') as File[]
  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const admin = createAdminClient()
  const results: FileResult[] = []

  for (const file of files) {
    const fileName = file.name
    const ext = fileName.toLowerCase().split('.').pop() ?? ''
    const fileBytes = Buffer.from(await file.arrayBuffer())
    const fileHash = hashFile(fileBytes)

    // Dedup: if the exact same file content was already uploaded and
    // extracted successfully, reuse that row instead of creating a duplicate.
    // This is what lets a 190-page document be re-uploaded safely — extraction
    // resume picks up from where it left off on the SAME source_material_id
    // rather than starting over (or worse, duplicating chunks).
    const { data: existing } = await admin
      .from('source_materials')
      .select('id, status, raw_text')
      .eq('file_hash', fileHash)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      results.push({
        file: fileName,
        source_material_id: existing.id,
        chars_extracted: existing.raw_text?.length ?? 0,
        error: null,
        reused_existing: true,
      })
      continue
    }

    // Upload file to storage (upsert — overwrite if re-uploading)
    await admin.storage
      .from('source_materials')
      .upload(fileName, fileBytes, {
        upsert: true,
        contentType: file.type || 'application/octet-stream',
      })

    // Extract text
    let rawText = ''
    let extractError: string | null = null
    try {
      rawText = await extractText(fileBytes, ext)
    } catch (err) {
      extractError = err instanceof Error ? err.message : 'Text extraction failed'
    }

    // Create source_materials record
    const { data: sm, error: dbErr } = await admin
      .from('source_materials')
      .insert({
        file_name: fileName,
        file_type: ext,
        file_hash: fileHash,
        raw_text: rawText || null,
        status: extractError ? 'failed' : 'done',
        error_message: extractError,
        uploaded_by: user.id,
      })
      .select('id')
      .single()

    results.push({
      file: fileName,
      source_material_id: sm?.id ?? null,
      chars_extracted: rawText.length,
      error: extractError ?? (dbErr ? dbErr.message : null),
      reused_existing: false,
    })
  }

  return NextResponse.json({ results })
}
