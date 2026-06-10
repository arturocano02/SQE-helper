'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, UserTopicMastery, Difficulty } from '@/types/database'
import TopicCard from '@/components/ui/TopicCard'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

export default function DrillLauncherPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: 'var(--surface-base)' }}
        >
          <LoadingSpinner size="lg" />
        </div>
      }
    >
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
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

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

  async function handleGenerateMore() {
    if (selected.size === 0) return
    setGenerating(true)
    setGenerateResult(null)
    try {
      const res = await fetch('/api/questions/generate-more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_ids: Array.from(selected),
          difficulty: difficulty === 'any' ? undefined : difficulty,
          count: 10,
        }),
      })
      const data = await res.json()
      setGenerateResult(data.message ?? `${data.generated} questions added.`)
    } catch {
      setGenerateResult('Generation failed — please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const filteredTopics = topics.filter(t => paper === 'all' || t.paper === paper)

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
              Topic Drill
            </h1>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Select topics and start practising
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGenerateModal(true)}
              disabled={selected.size === 0}
              style={{
                background: 'transparent',
                border: '1px solid var(--surface-border)',
                color: selected.size > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 13,
                padding: '8px 14px',
                borderRadius: 8,
                cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 150ms ease',
              }}
              title="Generate more questions for selected topics"
            >
              ✦ Generate more
            </button>
            <Button
              onClick={handleStart}
              disabled={selected.size === 0}
              loading={launching}
              size="lg"
            >
              {selected.size === 0
                ? 'Select a topic'
                : `Start Drill (${selected.size}) →`}
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-8">
        {/* Filters */}
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
          {/* Paper */}
          <div className="flex items-center gap-1">
            {(['all', 'FLK1', 'FLK2'] as const).map(p => (
              <FilterChip
                key={p}
                label={p === 'all' ? 'All Papers' : p}
                active={paper === p}
                onClick={() => setPaper(p)}
              />
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--surface-border)', flexShrink: 0 }} />

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
              {count} Qs
            </span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="flex-1 accent-amber-500"
              style={{ accentColor: 'var(--amber)', cursor: 'pointer', height: 4 }}
            />
            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>100</span>
          </div>

          {selected.size > 0 && (
            <span
              className="ml-auto font-sans text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
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

        {/* Generate more modal */}
        {showGenerateModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(10,10,8,0.85)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) { setShowGenerateModal(false); setGenerateResult(null) } }}
          >
            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                borderRadius: 14,
                padding: 28,
                maxWidth: 400,
                width: '100%',
              }}
              className="card-glow"
            >
              <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
                Generate more questions
              </h3>
              <p className="font-sans text-sm mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Claude generates 10 new questions from the knowledge bank for your selected topics.
                They&apos;re available to everyone once added.
              </p>

              <div className="mb-5">
                <p className="font-sans text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Difficulty for new questions
                </p>
                <div className="flex gap-2">
                  {(['any', 'easy', 'medium', 'hard'] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      style={{
                        flex: 1,
                        padding: '7px 0',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'var(--font-dm-sans)',
                        border: difficulty === d ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                        background: difficulty === d ? 'var(--amber-soft)' : 'var(--surface-1)',
                        color: difficulty === d ? 'var(--amber-text)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {d === 'any' ? 'Mixed' : d}
                    </button>
                  ))}
                </div>
              </div>

              {generateResult && (
                <p
                  className="font-sans text-sm mb-4 p-3 rounded-lg"
                  style={{
                    background: generateResult.includes('failed') || generateResult.includes('plenty')
                      ? 'rgba(251,191,36,0.08)'
                      : 'rgba(74,222,128,0.06)',
                    color: generateResult.includes('failed') || generateResult.includes('plenty')
                      ? 'var(--status-warning)'
                      : 'var(--status-correct)',
                    border: '1px solid currentColor',
                    borderColor: 'rgba(74,222,128,0.2)',
                  }}
                >
                  {generateResult}
                </p>
              )}

              <div className="flex gap-3">
                {!generateResult ? (
                  <button
                    onClick={handleGenerateMore}
                    disabled={generating}
                    style={{
                      flex: 1,
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 14,
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: generating ? 'not-allowed' : 'pointer',
                      opacity: generating ? 0.7 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    {generating && (
                      <span
                        className="w-4 h-4 rounded-full animate-spin block"
                        style={{ border: '2px solid rgba(10,10,8,0.4)', borderTopColor: '#0A0A08' }}
                      />
                    )}
                    {generating ? 'Generating…' : 'Generate 10 questions'}
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowGenerateModal(false); setGenerateResult(null) }}
                    style={{
                      flex: 1,
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 14,
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                )}
                <button
                  onClick={() => { setShowGenerateModal(false); setGenerateResult(null) }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-dm-sans)',
                    fontSize: 14,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: '1px solid var(--surface-border)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Topic grid */}
        {filteredTopics.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
        ) : (
          <div className="text-center py-16">
            <p className="font-serif text-2xl mb-2" style={{ color: 'var(--text-muted)' }}>
              No topics match
            </p>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Try changing your filter settings.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
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
