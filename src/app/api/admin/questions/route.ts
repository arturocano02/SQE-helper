import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { QuestionStatus } from '@/types/database'

// GET — list all questions
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin.from('questions').select('*').order('created_at', { ascending: false })
  return NextResponse.json(data ?? [])
}

// PUT — update single question
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('questions')
    .update({
      topic_id: body.topic_id,
      type: body.type,
      difficulty: body.difficulty,
      prompt: body.prompt,
      options: body.options,
      correct_answer: body.correct_answer,
      explanation: body.explanation,
      status: body.status,
      version: body.version,
    })
    .eq('id', body.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH — bulk update status
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { ids, status }: { ids: string[]; status: QuestionStatus } = await request.json()
  const admin = createAdminClient()

  const { error } = await admin
    .from('questions')
    .update({ status })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: ids.length })
}

// DELETE — permanently delete selected questions where safe; archive the rest.
//
// question_history (every answer ever given) and user_question_srs (per-user SRS state)
// both have a foreign key to questions(id) with no ON DELETE clause, so Postgres blocks a
// hard delete the moment a real student has answered that question — deleting it would
// either corrupt their history or silently destroy the record of how they did. Rather than
// surfacing that as a raw FK error, any question with answer history attached is archived
// instead (status: 'archived' — already hidden from users, same as the existing approve/
// archive workflow) and only truly unanswered questions are hard-deleted.
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { ids }: { ids: string[] } = await request.json()
  if (!ids?.length) return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })

  const admin = createAdminClient()

  const { data: historyRows, error: historyErr } = await admin
    .from('question_history')
    .select('question_id')
    .in('question_id', ids)

  if (historyErr) return NextResponse.json({ error: historyErr.message }, { status: 500 })

  const answeredIds = new Set((historyRows ?? []).map(r => (r as { question_id: string }).question_id))
  const deletableIds = ids.filter(id => !answeredIds.has(id))
  const archiveIds = ids.filter(id => answeredIds.has(id))

  if (archiveIds.length > 0) {
    const { error: archiveErr } = await admin
      .from('questions')
      .update({ status: 'archived' })
      .in('id', archiveIds)
    if (archiveErr) return NextResponse.json({ error: archiveErr.message }, { status: 500 })
  }

  if (deletableIds.length > 0) {
    const { error: deleteErr } = await admin.from('questions').delete().in('id', deletableIds)
    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })
  }

  return NextResponse.json({
    deleted: deletableIds.length,
    archived: archiveIds.length,
    archived_ids: archiveIds,
  })
}
