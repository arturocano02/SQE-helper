import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL_BULK } from '@/lib/anthropic'
import { chunkForImport } from '@/lib/chunker'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  // Extract text
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
  const buffer = Buffer.from(await file.arrayBuffer())
  const { text } = await pdfParse(buffer)

  const chunks = chunkForImport(text)
  const firstChunk = chunks[0] ?? ''
  const lastChunk = chunks[chunks.length - 1] ?? ''

  // Try one Claude call on the first chunk to see raw output
  const message = await anthropic.messages.create({
    model: MODEL_BULK,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Here is a section of text from an SQE1 sample questions PDF. Can you identify:
1. How many questions are visible?
2. What format are the questions in (e.g. "1. [question text]\\nA. [option]...")?
3. Is there an answer key visible?
4. What are the first 2 question numbers you can see?

Just describe what you see — no JSON needed.

TEXT:
${firstChunk.slice(0, 3000)}`
    }]
  })

  const claudeAnalysis = message.content[0].type === 'text' ? message.content[0].text : ''

  return NextResponse.json({
    total_chars: text.length,
    total_chunks: chunks.length,
    first_500_chars: text.slice(0, 500),
    last_500_chars: text.slice(-500),
    first_chunk_preview: firstChunk.slice(0, 800),
    last_chunk_preview: lastChunk.slice(0, 800),
    claude_analysis: claudeAnalysis,
  })
}
