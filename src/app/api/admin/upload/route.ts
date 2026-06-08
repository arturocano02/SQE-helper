import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic'
import { chunkText } from '@/lib/chunker'

const QUESTION_GEN_SYSTEM = `You are an SQE1 exam question writer for England and Wales. Your source material uses a specific compressed outline format: module headers in ALL CAPS, legal rules as telegraphic bullet points, conditional logic patterns like "If X... then Y...", and dense statutory terminology.

Given a section of SQE1 study notes, extract every distinct legal rule or principle. For each one, generate:
- One MCQ question at Easy difficulty
- One MCQ question at Medium difficulty
- One MCQ question at Hard difficulty
- One flashcard (a concise rule-recall prompt with a precise answer)

Each MCQ must have exactly 5 options (A, B, C, D, E). Exactly one must be correct. The other four should be plausible wrong answers that test genuine understanding, not obvious distractors.

Always include a full explanation covering: why the correct answer is right, and why each wrong option is wrong.

Map each question to one of these exact topic slugs: business-law, dispute-resolution, contract, tort, legal-system, legal-services, property-practice, land-law, trusts, wills, solicitors-accounts, criminal-law.

Return ONLY valid JSON. No preamble. No markdown code fences. Schema:
{
  "questions": [
    {
      "topic_slug": "string",
      "type": "mcq" | "flashcard",
      "difficulty": "easy" | "medium" | "hard",
      "prompt": "string",
      "options": [{"label":"A","text":"..."},{"label":"B","text":"..."},{"label":"C","text":"..."},{"label":"D","text":"..."},{"label":"E","text":"..."}],
      "correct_answer": "A" | "B" | "C" | "D" | "E",
      "explanation": "string"
    }
  ]
}
For flashcards: options and correct_answer are null. The "explanation" field contains the full rule answer.`

interface GeneratedQuestion {
  topic_slug: string
  type: 'mcq' | 'flashcard'
  difficulty?: 'easy' | 'medium' | 'hard'
  prompt: string
  options?: Array<{ label: string; text: string }> | null
  correct_answer?: string | null
  explanation?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const admin = await createAdminClient()
  const fileName = file.name
  const fileExt = fileName.toLowerCase().split('.').pop() ?? ''

  // Create source_materials record immediately (status: processing)
  const { data: sourceMaterial, error: smError } = await admin
    .from('source_materials')
    .insert({
      file_name: fileName,
      file_type: fileExt,
      status: 'processing',
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (smError || !sourceMaterial) {
    return NextResponse.json({ error: 'Failed to create source material record' }, { status: 500 })
  }

  const materialId = sourceMaterial.id

  // Extract text
  let text = ''
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    if (fileExt === 'txt') {
      text = buffer.toString('utf-8')
    } else if (fileExt === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      text = result.value
    } else if (fileExt === 'pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const result = await pdfParse(buffer)
      text = result.text
    } else {
      await admin.from('source_materials').update({ status: 'failed', error_message: 'Unsupported file type' }).eq('id', materialId)
      return NextResponse.json({ error: 'Unsupported file type. Use .txt, .docx, or .pdf' }, { status: 400 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Text extraction failed'
    await admin.from('source_materials').update({ status: 'failed', error_message: msg }).eq('id', materialId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (!text.trim()) {
    await admin.from('source_materials').update({ status: 'failed', error_message: 'No text extracted' }).eq('id', materialId)
    return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 })
  }

  // Save raw text
  await admin.from('source_materials').update({ raw_text: text }).eq('id', materialId)

  // Chunk
  const chunks = chunkText(text)
  const chunksToProcess = chunks.slice(0, 20) // Cap at 20 chunks per upload

  await admin.from('source_materials').update({ total_chunks: chunksToProcess.length }).eq('id', materialId)

  // Get topic slug → id map
  const { data: topics } = await admin.from('topics').select('id, slug')
  const slugToId = new Map((topics ?? []).map((t: { slug: string; id: string }) => [t.slug, t.id]))

  // Process chunks through Claude
  const allQuestions: GeneratedQuestion[] = []
  let chunksProcessed = 0

  for (const chunk of chunksToProcess) {
    try {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: QUESTION_GEN_SYSTEM,
        messages: [{ role: 'user', content: chunk }],
      })

      const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

      // Strip markdown fences if Claude adds them despite instructions
      const cleaned = responseText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      if (Array.isArray(parsed.questions)) {
        allQuestions.push(...parsed.questions)
      }
    } catch {
      // Skip bad chunks — continue processing
    }
    chunksProcessed++
    // Update progress periodically
    if (chunksProcessed % 3 === 0) {
      await admin.from('source_materials').update({ chunks_processed: chunksProcessed }).eq('id', materialId)
    }
  }

  // Insert questions
  const rows = allQuestions
    .filter(q => slugToId.has(q.topic_slug))
    .map(q => ({
      topic_id: slugToId.get(q.topic_slug)!,
      type: q.type,
      difficulty: q.difficulty ?? null,
      prompt: q.prompt,
      options: q.options ?? null,
      correct_answer: q.correct_answer ?? null,
      explanation: q.explanation ?? null,
      status: 'draft' as const,
      source_file: fileName,
    }))

  if (rows.length > 0) {
    await admin.from('questions').insert(rows)
  }

  // Mark done
  await admin.from('source_materials').update({
    status: 'done',
    questions_generated: rows.length,
    chunks_processed: chunksProcessed,
  }).eq('id', materialId)

  return NextResponse.json({
    count: rows.length,
    source_material_id: materialId,
    chunks_processed: chunksProcessed,
  })
}
