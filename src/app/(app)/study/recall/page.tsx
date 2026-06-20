'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, UserTopicMastery, Difficulty } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ModeExplainerModal from '@/components/study/ModeExplainerModal'

export default function RecallLauncherPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-base)' }}>
          <LoadingSpinner size="lg" />
        </div>
      }
    >
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
  const [difficulty, setDifficulty] = useState<Difficulty | 'any'>('any')
  const [count, setCount] = useState(20)
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
          .from('user_topic_mastery').select('*').eq('user_id', userData.user.id)
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
          mode: 'recall',
          topic_ids: Array.from(selected),
          difficulty: difficulty === 'any' ? undefined : difficulty,
          count,
        }),
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
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <ModeExplainerModal mode="recall" />
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <Link
              href="/home"
              className="font-sans text-sm transition inline-block mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              ← Dashboard
            </Link>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Active Recall</h1>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Quick rule-recall flashcards
            </p>
          </div>
          <Button onClick={handleStart} disabled={selected.size === 0} loading={launching} size="lg">
            {selected.size === 0 ? 'Select a topic' : `Start Recall (${selected.size})`}
          </Button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* Filter bar */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 10,
            padding: '14px 16px',
            marginBottom: 28,
            display: 'flex',
            flexWrap: 'wrap' as const,
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Difficulty */}
          <div className="flex items-center gap-1">
            {(['any', 'easy', 'medium', 'hard'] as const).map(d => (
              <FilterChip
                key={d}
                label={d === 'any' ? 'Mixed' : d}
                active={difficulty === d}
                onClick={() => setDifficulty(d)}
              />
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--surface-border)', flexShrink: 0 }} />

          {/* Count slider */}
          <div className="flex items-center gap-3 flex-1 min-w-[160px]">
            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {count} cards
            </span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: 'var(--amber)', cursor: 'pointer', height: 4 }}
            />
            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>100</span>
          </div>

          {selected.size > 0 && (
            <span className="ml-auto font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
              {selected.size} topic{selected.size !== 1 ? 's' : ''} selected
            </span>
          )}
        </div>

        {error && (
          <div
            className="mb-5 p-3 font-sans text-sm rounded-lg"
            style={{
              background: 'rgba(224,90,90,0.10)',
              border: '1px solid rgba(224,90,90,0.30)',
              color: 'var(--status-wrong)',
            }}
          >
            {error}
          </div>
        )}

        {topics.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
        ) : (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        )}
      </div>
    </main>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontFamily: 'var(--font-dm-sans)',
        border: active ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
        background: active ? 'var(--amber-soft)' : 'transparent',
        color: active ? 'var(--amber-text)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        textTransform: 'capitalize' as const,
      }}
    >
      {label}
    </button>
  )
}
