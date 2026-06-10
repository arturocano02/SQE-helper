import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { session_id } = await request.json()

  // Recompute correct_count and total from question_history to avoid
  // any race condition with the fire-and-forget updates in answer/route.ts
  const { data: history } = await supabase
    .from('question_history')
    .select('was_correct')
    .eq('session_id', session_id)
    .eq('user_id', user.id)

  const total = (history ?? []).length
  const correct = (history ?? []).filter((h: { was_correct: boolean }) => h.was_correct).length

  const { error } = await supabase
    .from('sessions')
    .update({
      is_complete: true,
      ended_at: new Date().toISOString(),
      paused_at: null,
      correct_count: correct,
      total_questions: total,
    })
    .eq('id', session_id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  // Pause session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { session_id, current_question_index } = await request.json()

  const { error } = await supabase
    .from('sessions')
    .update({
      paused_at: new Date().toISOString(),
      current_question_index,
    })
    .eq('id', session_id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
