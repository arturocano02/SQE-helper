/**
 * GET /api/admin/users/[id]
 *
 * Full profile for one user: identity, aggregate stats, per-topic mastery breakdown,
 * recent completed sessions, and a 30-day daily activity series for the chart on
 * /admin/users/[id]. Scoped to a single user so it's fine to aggregate the activity
 * series in JS here rather than via the admin_daily_activity() RPC (that one is for
 * the whole-platform dashboard chart, where the row count is much larger).
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Topic, UserTopicMastery } from '@/types/database'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminUser = await requireAdmin()
  if (!adminUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()

  const [
    { data: profile, error: profileError },
    { data: authUser },
    { data: topics },
    { data: mastery },
    { data: sessions },
    { data: history },
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', id).single(),
    admin.auth.admin.getUserById(id),
    admin.from('topics').select('*').order('sort_order'),
    admin.from('user_topic_mastery').select('*').eq('user_id', id),
    admin
      .from('sessions')
      .select('id, mode, correct_count, total_questions, started_at, is_complete, topic_ids')
      .eq('user_id', id)
      .order('started_at', { ascending: false })
      .limit(20),
    // 90 days is enough for a meaningful daily chart without pulling a user's entire history.
    admin
      .from('question_history')
      .select('answered_at, was_correct')
      .eq('user_id', id)
      .gte('answered_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  if (profileError || !profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const masteryMap = new Map(((mastery ?? []) as UserTopicMastery[]).map(m => [m.topic_id, m]))
  const topicBreakdown = ((topics ?? []) as Topic[])
    .map(t => ({ topic: t, mastery: masteryMap.get(t.id) ?? null }))
    .sort((a, b) => (b.mastery?.mastery_score ?? -1) - (a.mastery?.mastery_score ?? -1))

  const completedSessions = (sessions ?? []).filter(s => s.is_complete)
  const totalAnswered = (history ?? []).length
  const totalCorrect = (history ?? []).filter(h => h.was_correct).length

  // Daily activity — group answered_at by calendar day (last 30 days shown, 90 fetched
  // so "this week / this month" style comparisons on the client have headroom).
  const dayMap = new Map<string, { answers: number; correct: number }>()
  for (const h of history ?? []) {
    const day = h.answered_at.slice(0, 10)
    const entry = dayMap.get(day) ?? { answers: 0, correct: 0 }
    entry.answers++
    if (h.was_correct) entry.correct++
    dayMap.set(day, entry)
  }
  const dailyActivity = Array.from(dayMap.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return NextResponse.json({
    profile: {
      ...profile,
      email: authUser?.user?.email ?? null,
    },
    stats: {
      sessions_completed: completedSessions.length,
      questions_answered: totalAnswered,
      correct_answered: totalCorrect,
      accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : null,
    },
    topic_breakdown: topicBreakdown,
    recent_sessions: sessions ?? [],
    daily_activity: dailyActivity,
  })
}
