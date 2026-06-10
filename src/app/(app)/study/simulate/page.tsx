'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

const COUNTS = [10, 25, 50] as const
const DIFFICULTIES = [
  { value: '', label: 'Mixed', desc: 'Easy, medium and hard — mirrors real SQE1 format' },
  { value: 'easy', label: 'Foundation', desc: 'Core rules only — good for a first pass' },
  { value: 'medium', label: 'Standard', desc: 'The typical SQE1 difficulty level' },
  { value: 'hard', label: 'Stretch', desc: 'Harder questions to sharpen your edge' },
] as const

export default function SimulatePage() {
  const router = useRouter()
  const [count, setCount] = useState<number>(25)
  const [difficulty, setDifficulty] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startSession() {
    setLoading(true)
    setError(null)

    const res = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'simulate',
        topic_ids: [], // signal: all topics
        difficulty: difficulty || undefined,
        count,
      }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Failed to start session')
      return
    }
    router.push(`/study/simulate/${data.session_id}`)
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center justify-between">
          <Link href="/home" className="font-sans text-sm transition" style={{ color: 'var(--text-secondary)' }}>
            ← Dashboard
          </Link>
          <span
            className="font-sans text-xs px-2 py-0.5 rounded"
            style={{
              border: '1px solid rgba(200,146,42,0.35)',
              color: 'var(--amber-text)',
            }}
          >
            Phase 2
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-5 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-serif mb-2" style={{ fontSize: '2.25rem', color: 'var(--text-primary)' }}>
            Exam Simulation
          </h1>
          <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Cross-topic questions drawn from all 12 FLK1 &amp; FLK2 subjects.
            SRS ordering surfaces your weakest areas first — just like the real exam will test them.
          </p>
        </div>

        <div className="space-y-6">
          {/* Question count */}
          <div>
            <p className="font-sans text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              Number of questions
            </p>
            <div className="flex gap-2">
              {COUNTS.map(c => (
                <button
                  key={c}
                  onClick={() => setCount(c)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: count === c ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                    background: count === c ? 'var(--amber-soft)' : 'var(--surface-1)',
                    color: count === c ? 'var(--amber-text)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-dm-sans)',
                    fontWeight: count === c ? 600 : 400,
                    fontSize: 14,
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    minWidth: 64,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            {count === 50 && (
              <p className="font-sans text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                ~50 min — closest to the real SQE1 experience (180 questions, 3 hrs)
              </p>
            )}
          </div>

          {/* Difficulty */}
          <div>
            <p className="font-sans text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              Difficulty
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.value}
                  onClick={() => setDifficulty(d.value)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: difficulty === d.value ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                    background: difficulty === d.value ? 'var(--amber-soft)' : 'var(--surface-1)',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  <p
                    className="font-sans text-sm font-medium mb-0.5"
                    style={{ color: difficulty === d.value ? 'var(--amber-text)' : 'var(--text-primary)' }}
                  >
                    {d.label}
                  </p>
                  <p className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {d.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* What to expect */}
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              padding: '16px 20px',
            }}
          >
            <p className="font-sans text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              How it works
            </p>
            <div className="space-y-2">
              {[
                'Questions drawn from all 12 topics — no topic filter',
                'SRS ordering: overdue cards surface first, then unseen',
                'Same MCQ format as the real SQE1 (A–E options)',
                'Results feed into your per-topic mastery scores',
              ].map((line, i) => (
                <p key={i} className="font-sans text-xs flex gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--amber-text)', flexShrink: 0 }}>→</span>
                  {line}
                </p>
              ))}
            </div>
          </div>

          {error && (
            <p className="font-sans text-sm" style={{ color: 'var(--status-wrong)' }}>{error}</p>
          )}

          <button
            onClick={startSession}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'var(--amber)',
              color: '#0A0A08',
              fontFamily: 'var(--font-dm-sans)',
              fontWeight: 600,
              fontSize: 15,
              padding: '14px 24px',
              borderRadius: 10,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'all 150ms ease',
              boxShadow: '0 4px 20px rgba(200,146,42,0.2)',
            }}
            className="hover:brightness-110 active:scale-[0.98]"
          >
            {loading ? <LoadingSpinner size="sm" /> : null}
            {loading ? 'Building session…' : `Start ${count}-question simulation →`}
          </button>
        </div>
      </div>
    </main>
  )
}
