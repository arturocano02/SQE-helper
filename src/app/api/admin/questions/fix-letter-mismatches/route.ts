/**
 * GET  /api/admin/questions/fix-letter-mismatches
 *   Scans ALL mcq questions (any correct_answer, not just legacy 'A' rows) for
 *   explanations that reference an option by letter. Returns a preview list —
 *   no writes.
 *
 * POST /api/admin/questions/fix-letter-mismatches
 *   For each flagged question, asks Claude to rewrite the explanation so it
 *   describes options by their content instead of by letter — this is the
 *   direct fix for the "clicked the correct answer but the explanation names a
 *   different letter as correct" bug, since letters can no longer drift out of
 *   sync with a reshuffled correct_answer.
 *
 * Root cause this cleans up after: earlier versions of the generation prompts
 * (in /api/admin/generate and /api/questions/generate-more) let Claude write
 * "Option B is correct" style explanations, then a post-generation shuffle step
 * reassigned which letter each option sits at — desyncing any letter mentioned
 * in the explanation from the actual correct_answer. Both prompts now forbid
 * letter references going forward; this endpoint repairs rows created before
 * that fix.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/anthropic'
import { explanationReferencesLetter } from '@/lib/letterReference'
import type { MCQOption } from '@/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

interface FlaggedRow {
  id: string
  prompt: string
  options: MCQOption[]
  correct_answer: string
  explanation: string
}

async function findFlaggedRows(): Promise<{ rows: FlaggedRow[]; error: string | null }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('questions')
    .select('id, prompt, options, correct_answer, explanation')
    .eq('type', 'mcq')
    .not('explanation', 'is', null)

  if (error) return { rows: [], error: error.message }

  const flagged = (data ?? []).filter(
    (row): row is FlaggedRow =>
      !!row.correct_answer &&
      !!row.options &&
      explanationReferencesLetter(row.explanation)
  ) as FlaggedRow[]

  return { rows: flagged, error: null }
}

const REWRITE_SYSTEM = `You fix SQE1 MCQ explanations that incorrectly reference options by letter (A/B/C/D/E).

You will be given the question, the 5 options, which letter is currently correct, and the existing explanation. The explanation may reference the WRONG letter as correct (a known bug from before option letters were finalised) — trust the given "correct_answer" letter and the option TEXT, not any letter mentioned inside the old explanation.

Rewrite the explanation so that:
- It never mentions a letter (no "Option A", "B is correct", "(C)", etc.)
- It refers to options by their content instead, e.g. "The answer stating that notice must be given in writing is correct because..."
- It explains why the option matching the given correct_answer's text is right, and specifically why each of the other four is wrong
- All legal substance from the original explanation is preserved where it was accurate
- Keep it roughly the same length as the original

Return ONLY the rewritten explanation text. No JSON, no markdown, no preamble.`

async function rewriteExplanation(row: FlaggedRow): Promise<string | null> {
  const correctOption = row.options.find(o => o.label === row.correct_answer)
  if (!correctOption) return null

  const optionsBlock = row.options.map(o => `${o.label}. ${o.text}`).join('\n')

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `Question:\n${row.prompt}\n\nOptions:\n${optionsBlock}\n\nCorrect answer (trust this, not the old explanation): ${row.correct_answer} — "${correctOption.text}"\n\nExisting explanation (may reference the wrong letter):\n${row.explanation}`,
      }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    return text || null
  } catch {
    return null
  }
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { rows, error } = await findFlaggedRows()
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({
    affected: rows.length,
    preview: rows.slice(0, 10).map(r => ({
      id: r.id,
      prompt: r.prompt.slice(0, 100),
      correct_answer: r.correct_answer,
      explanation_snippet: r.explanation.slice(0, 150),
    })),
  })
}

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { rows, error } = await findFlaggedRows()
  if (error) return NextResponse.json({ error }, { status: 500 })
  if (rows.length === 0) return NextResponse.json({ fixed: 0, failed: 0, total: 0 })

  const admin = createAdminClient()
  let fixed = 0
  let failed = 0

  for (const row of rows) {
    const newExplanation = await rewriteExplanation(row)
    if (!newExplanation) { failed++; continue }

    const { error: updErr } = await admin
      .from('questions')
      .update({ explanation: newExplanation })
      .eq('id', row.id)

    if (updErr) failed++
    else fixed++
  }

  return NextResponse.json({ fixed, failed, total: rows.length })
}
