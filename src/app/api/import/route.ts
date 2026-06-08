import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic'

const IMPORT_SYSTEM = `You are parsing a UK law student's personal SQE1 revision notes. The text is a mix of questions they got wrong, the correct rule they noted, and general rule summaries. The style is compressed and telegraphic.

For each distinct item, extract:
- The legal rule or question they recorded
- The correct answer or rule
- Which SQE1 topic it belongs to (map to one of: business-law, dispute-resolution, contract, tort, legal-system, legal-services, property-practice, land-law, trusts, wills, solicitors-accounts, criminal-law)
- Confidence: default to "shaky" for all imported items

Return ONLY valid JSON:
{
  "items": [
    {
      "topic_slug": "string",
      "prompt": "string",
      "correct_rule": "string",
      "confidence": "shaky"
    }
  ]
}
No preamble. No markdown.`

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Extract text
  let text = ''
  const fileName = file.name.toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())

  if (fileName.endsWith('.txt')) {
    text = buffer.toString('utf-8')
  } else if (fileName.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    text = result.value
  } else if (fileName.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const result = await pdfParse(buffer)
    text = result.text
  } else {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 })
  }

  // Call Claude to parse the notes
  let items: Array<{ topic_slug: string; prompt: string; correct_rule: string; confidence: string }> = []

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: IMPORT_SYSTEM,
      messages: [{ role: 'user', content: text.slice(0, 20000) }], // Trim to safe size
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    const parsed = JSON.parse(responseText)
    if (Array.isArray(parsed.items)) {
      items = parsed.items
    }
  } catch {
    return NextResponse.json({ error: 'Failed to parse notes with AI' }, { status: 500 })
  }

  // Get topic slug → id map
  const { data: topics } = await supabase.from('topics').select('id, slug')
  const slugToId = new Map((topics ?? []).map(t => [t.slug, t.id]))

  // Create synthetic question_history entries
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const historyRows = items
    .filter(item => slugToId.has(item.topic_slug))
    .map(item => ({
      user_id: user.id,
      question_id: null, // No linked question — imported note
      session_id: null,
      was_correct: false,
      selected_answer: null,
      answered_at: thirtyDaysAgo,
      is_imported: true,
    }))

  if (historyRows.length > 0) {
    await supabase.from('question_history').insert(historyRows)
  }

  // Update topic mastery — bump shaky score for covered topics
  const affectedSlugs = [...new Set(items.map(i => i.topic_slug).filter(s => slugToId.has(s)))]
  for (const slug of affectedSlugs) {
    const topicId = slugToId.get(slug)!
    const { data: existing } = await supabase
      .from('user_topic_mastery')
      .select('*')
      .eq('user_id', user.id)
      .eq('topic_id', topicId)
      .single()

    if (!existing) {
      await supabase.from('user_topic_mastery').insert({
        user_id: user.id,
        topic_id: topicId,
        mastery_score: 15, // Imported wrong answers → low mastery
      })
    }
  }

  return NextResponse.json({ imported: historyRows.length, topics_affected: affectedSlugs.length })
}
