import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { session_id } = await request.json()

  const { error } = await supabase
    .from('sessions')
    .update({
      is_complete: true,
      ended_at: new Date().toISOString(),
      paused_at: null,
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
