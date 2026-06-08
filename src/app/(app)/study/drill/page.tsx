'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, UserTopicMastery, Difficulty } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

const COUNTS = [10, 25, 50]

export default function DrillLauncherPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center"><LoadingSpinner size="lg" /></div>}>
      <DrillLauncherInner />
    </Suspense>
  )
}

function DrillLauncherInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedId = searchParams.get('topics')

  const [topics, setTopics] = useState<Topic[]>([])
  const [mastery, setMastery] = useState<Map<string, UserTopicMastery>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paper, setPaper] = useState<'all' | 'FLK1' | 'FLK2'>('all')
  const [difficulty, setDifficulty] = useState<Difficulty | 'any'>('any')
  const [count, setCount] = useState(25)
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
        body: JSON.stringify({
          mode: 'drill',
          topic_ids: Array.from(selected),
          difficulty: difficulty === 'any' ? undefined : difficulty,
          count,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start session')
      router.push(`/study/drill/${data.session_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLaunching(false)
    }
  }

  const filteredTopics = topics.filter(t => paper === 'all' || t.paper === paper)

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-primary">Topic Drill</h1>
            <p className="text-secondary text-sm">Select topics and start practising</p>
          </div>
          <Button
            onClick={handleStart}
            disabled={selected.size === 0}
            loading={launching}
          >
            Start Drill →
          </Button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-8 p-4 bg-surface border border-border rounded-lg">
          {/* Paper filter */}
          <div className="flex items-center gap-1">
            {(['all', 'FLK1', 'FLK2'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPaper(p)}
                className={[
                  'px-3 py-1.5 rounded text-xs transition',
                  paper === p
                    ? 'bg-accent text-bg font-medium'
                    : 'text-secondary hover:bg-surface2 border border-border',
                ].join(' ')}
              >
                {p === 'all' ? 'All Papers' : p}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Difficulty filter */}
          <div className="flex items-center gap-1">
            {(['any', 'easy', 'medium', 'hard'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={[
                  'px-3 py-1.5 rounded text-xs transition capitalize',
                  difficulty === d
                    ? 'bg-accent text-bg font-medium'
                    : 'text-secondary hover:bg-surface2 border border-border',
                ].join(' ')}
              >
                {d === 'any' ? 'Any difficulty' : d}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Count */}
          <div className="flex items-center gap-1">
            {COUNTS.map(c => (
              <button
                key={c}
                onClick={() => setCount(c)}
                className={[
                  'px-3 py-1.5 rounded text-xs transition',
                  count === c
                    ? 'bg-accent text-bg font-medium'
                    : 'text-secondary hover:bg-surface2 border border-border',
                ].join(' ')}
              >
                {c} Qs
              </button>
            ))}
          </div>

          {selected.size > 0 && (
            <span className="ml-auto text-xs text-secondary">
              {selected.size} topic{selected.size !== 1 ? 's' : ''} selected
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded text-error text-sm">
            {error}
          </div>
        )}

        {/* Topic grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTopics.map(topic => (
            <TopicCard
              key={topic.id}
              topic={topic}
              mastery={mastery.get(topic.id)}
              selected={selected.has(topic.id)}
              onClick={() => toggleTopic(topic.id)}
            />
          ))}
        </div>

        {filteredTopics.length === 0 && (
          <p className="text-secondary text-center py-12">No topics match your filters.</p>
        )}
      </div>
    </main>
  )
}
