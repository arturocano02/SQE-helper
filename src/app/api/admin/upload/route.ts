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

interface FileResult {
  file: string
  source_material_id: string | null
  chars_extracted: number
  error: string | null
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === 'txt') return buffer.toString('utf-8')
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer })).value
  }
  if (ext === 'pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    return (await pdfParse(buffer)).text
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
    })
  }

  return NextResponse.json({ results })
}
