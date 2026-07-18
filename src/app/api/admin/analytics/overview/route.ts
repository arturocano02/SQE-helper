/**
 * GET /api/admin/analytics/overview
 *
 * Platform-wide activity widgets for the admin dashboard: how many users are active
 * right now / today / this week / this month, plus a 30-day daily-active-users series
 * for the chart. "Active" = answered at least one question in the window — the app has
 * no separate heartbeat/presence signal, so question_history.answered_at is the most
 * direct proxy for "a user was actually doing something" already being recorded.
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

async function distinctActiveUsers(admin: ReturnType<typeof createAdminClient>, since: Date): Promise<number> {
  const { data } = await admin
    .from('question_history')
    .select('user_id')
    .gte('answered_at', since.toISOString())
    .limit(50000)
  return new Set((data ?? []).map(r => r.user_id)).size
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const now = Date.now()

  const [activeNow, activeToday, activeWeek, activeMonth, { data: daily, error: dailyError }] = await Promise.all([
    distinctActiveUsers(admin, new Date(now - 15 * 60 * 1000)),
    distinctActiveUsers(admin, new Date(now - 24 * 60 * 60 * 1000)),
    distinctActiveUsers(admin, new Date(now - 7 * 24 * 60 * 60 * 1000)),
    distinctActiveUsers(admin, new Date(now - 30 * 24 * 60 * 60 * 1000)),
    admin.rpc('admin_daily_activity', { days_back: 30 }),
  ])

  if (dailyError) return NextResponse.json({ error: dailyError.message }, { status: 500 })

  return NextResponse.json({
    active_now: activeNow,
    active_today: activeToday,
    active_week: activeWeek,
    active_month: activeMonth,
    daily_activity: daily ?? [],
  })
}
