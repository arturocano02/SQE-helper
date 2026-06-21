/**
 * POST /api/admin/questions/rebalance
 *
 * One-off remediation for legacy MCQ rows generated before `shuffleCorrectAnswer()`
 * existed in /api/admin/generate — those rows are stuck with correct_answer === 'A'
 * for every question, which makes the real correct option trivially guessable. This
 * reshuffles each affected row's option order (keeping the same 5 option texts) and
 * updates correct_answer to wherever the originally-correct text lands. Idempotent to
 * run more than once — it only ever touches rows still sitting on 'A'.
 *
 * GET  → preview count of affected rows, no writes
 * POST → perform the reshuffle, returns how many rows were updated
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { MCQOption } from '@/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

function reshuffle(options: MCQOption[]): { options: MCQOption[]; correct_answer: string } | null {
  if (!options || options.length !== 5) return null
  const correctOption = options.find(o => o.label === 'A')
  if (!correctOption) return null

  const labels = ['A', 'B', 'C', 'D', 'E'] as const
  const texts = options.map(o => o.text)

  // Fisher-Yates, but reject the no-op permutation (correct text landing back on A) so every
  // affected row visibly changes — otherwise a run of bad luck could leave some rows untouched
  // and look like the fix silently failed on them.
  let newOptions: MCQOption[]
  let attempts = 0
  do {
    const shuffled = [...texts]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    newOptions = labels.map((label, i) => ({ label, text: shuffled[i] }))
    attempts++
  } while (newOptions[0].text === correctOption.text && attempts < 10)

  const newCorrectLabel = newOptions.find(o => o.text === correctOption.text)?.label ?? 'A'
  return { options: newOptions, correct_answer: newCorrectLabel }
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { count } = await admin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'mcq')
    .eq('correct_answer', 'A')

  return NextResponse.json({ affected: count ?? 0 })
}

export async function POST() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('questions')
    .select('id, options, correct_answer')
    .eq('type', 'mcq')
    .eq('correct_answer', 'A')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ updated: 0, skipped: 0 })

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const result = reshuffle((row.options ?? []) as MCQOption[])
    if (!result) { skipped++; continue }
    const { error: updErr } = await admin
      .from('questions')
      .update({ options: result.options, correct_answer: result.correct_answer })
      .eq('id', row.id)
    if (updErr) skipped++
    else updated++
  }

  return NextResponse.json({ updated, skipped, total: rows.length })
}
