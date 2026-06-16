'use client'

import { useEffect, useState } from 'react'

interface ModeExplainerModalProps {
  mode: 'drill' | 'recall'
}

const COPY: Record<'drill' | 'recall', { title: string; body: string; tip: string }> = {
  drill: {
    title: 'Topic Drill',
    body: 'Full MCQ practice — five options (A–E), just like the real SQE1. Pick topics, a difficulty mix, and how many questions you want. After each answer you get a full breakdown of why every option is right or wrong, plus the source rule it was tested from.',
    tip: 'Best for: building and testing knowledge under exam-style conditions.',
  },
  recall: {
    title: 'Active Recall',
    body: 'Quick flashcards — a rule appears, you try to recall it, then reveal the answer and rate yourself (Got it / Nearly / Missed it). That self-rating drives spaced repetition, so the rules you struggle with come back sooner.',
    tip: 'Best for: fast rule memorisation, especially on mobile.',
  },
}

export default function ModeExplainerModal({ mode }: ModeExplainerModalProps) {
  const [visible, setVisible] = useState(false)
  const storageKey = `sqe_mode_explainer_seen_${mode}`

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(storageKey)
      if (!seen) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [storageKey])

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // ignore storage errors
    }
    setVisible(false)
  }

  if (!visible) return null
  const copy = COPY[mode]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 14,
          padding: '28px 26px 22px',
          maxWidth: 420,
          width: '100%',
        }}
        className="card-glow"
      >
        <h2 className="font-serif text-2xl mb-3" style={{ color: 'var(--text-primary)' }}>
          {copy.title}
        </h2>
        <p className="font-sans text-sm mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {copy.body}
        </p>
        <p
          className="font-sans text-xs mb-5"
          style={{ color: 'var(--amber-text)', lineHeight: 1.5 }}
        >
          {copy.tip}
        </p>
        <button
          onClick={dismiss}
          style={{
            background: 'var(--amber)',
            color: '#0A0A08',
            fontFamily: 'var(--font-dm-sans)',
            fontWeight: 500,
            fontSize: 14,
            padding: '10px 22px',
            borderRadius: 8,
            width: '100%',
          }}
        >
          Got it — let&apos;s go
        </button>
      </div>
    </div>
  )
}
