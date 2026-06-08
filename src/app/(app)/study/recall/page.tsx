'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, UserTopicMastery } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

export default function RecallLauncherPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <RecallLauncherInner />
    </Suspense>
  )
}

function RecallLauncherInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedId = searchParams.get('topics')

  const [topics, setTopics] = useState<Topic[]>([])
  const [mastery, setMastery] = useState<Map<string, UserTopicMastery>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      const [{ data: topicsData }, { data: userData }] = await Promise.all([
        supabase.from('topics').select('*').order('sort_order'),
        supabase.auth.getUser(),
      ])
      let masteryData: UserTopicMastery[] = []
      if (userData.user) {
        const { data: m } = await supabase
          .from('user_topic_mastery')
          .select('*')
          .eq('user_id', userData.user.id)
        masteryData = (m ?? []) as UserTopicMastery[]
      }
      setTopics((topicsData ?? []) as Topic[])
      setMastery(new Map(masteryData.map(m => [m.topic_id, m])))
      if (preselectedId) setSelected(new Set([preselectedId]))
    }
    load()
  }, [preselectedId])

  function toggleTopic(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleStart() {
    if (selected.size === 0) return
    setLaunching(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'recall', topic_ids: Array.from(selected), count: 20 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start')
      router.push(`/study/recall/${data.session_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLaunching(false)
    }
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-primary">Active Recall</h1>
            <p className="text-secondary text-sm">Quick rule-recall flashcards</p>
          </div>
          <Button onClick={handleStart} disabled={selected.size === 0} loading={launching}>
            Start Recall →
          </Button>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded text-error text-sm">{error}</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {topics.map(topic => (
            <TopicCard
              key={topic.id}
              topic={topic}
              mastery={mastery.get(topic.id)}
              selected={selected.has(topic.id)}
              onClick={() => toggleTopic(topic.id)}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
