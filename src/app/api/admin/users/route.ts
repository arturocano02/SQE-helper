/**
 * GET /api/admin/users
 *
 * List every user with aggregate study stats for the admin dashboard's user table.
 * Aggregation (sessions/questions/correct/last-active) happens in Postgres via the
 * admin_user_stats() RPC — see supabase/migrations/20260625_admin_analytics_rpc.sql —
 * so this stays cheap regardless of how large question_history grows. Email comes from
 * auth.users (not mirrored onto profiles), fetched via the admin auth API and merged in.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const [{ data: profiles, error: profilesError }, { data: stats, error: statsError }] = await Promise.all([
    admin.from('profiles').select('id, name, avatar_url, is_admin, created_at, exam_date').order('created_at', { ascending: false }),
    admin.rpc('admin_user_stats'),
  ])

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 })
  if (statsError) return NextResponse.json({ error: statsError.message }, { status: 500 })

  // auth.admin.listUsers is paginated (max 1000/page) — loop until exhausted. Fine for an
  // early-stage user base; revisit with a dedicated email column on profiles if this ever
  // needs to scale past a few thousand users.
  const emailById = new Map<string, string>()
  let page = 1
  while (true) {
    const { data: page_data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) break
    for (const u of page_data.users) {
      if (u.email) emailById.set(u.id, u.email)
    }
    if (page_data.users.length < 1000) break
    page++
  }

  interface StatRow {
    user_id: string
    sessions_completed: number
    questions_answered: number
    correct_answered: number
    last_active: string | null
  }
  const statsById = new Map<string, StatRow>(
    ((stats ?? []) as StatRow[]).map(s => [s.user_id, s])
  )

  const rows = (profiles ?? []).map(p => {
    const s = statsById.get(p.id)
    const questionsAnswered = s?.questions_answered ?? 0
    const correctAnswered = s?.correct_answered ?? 0
    return {
      id: p.id,
      name: p.name,
      email: emailById.get(p.id) ?? null,
      avatar_url: p.avatar_url,
      is_admin: p.is_admin,
      created_at: p.created_at,
      exam_date: p.exam_date,
      sessions_completed: s?.sessions_completed ?? 0,
      questions_answered: questionsAnswered,
      correct_answered: correctAnswered,
      accuracy: questionsAnswered > 0 ? Math.round((correctAnswered / questionsAnswered) * 100) : null,
      last_active: s?.last_active ?? null,
    }
  })

  return NextResponse.json({ users: rows })
}
