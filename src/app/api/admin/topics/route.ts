/**
 * GET /api/admin/topics
 * Returns all topics with approved chunk counts.
 * Admin only.
 */

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()

  const [{ data: topics }, { data: chunkCounts }] = await Promise.all([
    admin.from('topics').select('id, name, slug, paper').order('sort_order'),
    admin
      .from('knowledge_chunks')
      .select('topic_id')
      .eq('is_approved', true),
  ])

  const countMap = new Map<string, number>()
  ;(chunkCounts ?? []).forEach((c: { topic_id: string }) => {
    countMap.set(c.topic_id, (countMap.get(c.topic_id) ?? 0) + 1)
  })

  const result = (topics ?? []).map((t: { id: string; name: string; slug: string; paper: string }) => ({
    ...t,
    approved_chunks: countMap.get(t.id) ?? 0,
  }))

  return NextResponse.json({ topics: result })
}
