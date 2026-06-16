'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const LINES = [
  "It's Barbri, but it actually remembers what you got wrong.",
  'A question bank that studies you back.',
  'Spaced repetition for people who keep forgetting spaced repetition.',
  'Like flashcards, except they get harder exactly when you get smarter.',
]

function WelcomeContent() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/home'
  const [line] = useState(() => LINES[Math.floor(Math.random() * LINES.length)])
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 80)
    const go = setTimeout(() => router.replace(next), 1900)
    return () => { clearTimeout(show); clearTimeout(go) }
  }, [router, next])

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 cursor-pointer"
      style={{ background: 'var(--surface-base)' }}
      onClick={() => router.replace(next)}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--amber-soft)',
          border: '1px solid rgba(200,146,42,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.85)',
          transition: 'all 400ms ease',
        }}
      >
        <span className="font-serif text-lg font-semibold" style={{ color: 'var(--amber)' }}>S</span>
      </div>
      <p
        className="font-serif text-center max-w-md"
        style={{
          fontSize: '1.5rem',
          color: 'var(--text-primary)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          transition: 'all 500ms ease 100ms',
        }}
      >
        {line}
      </p>
      <p
        className="font-sans text-xs mt-6"
        style={{ color: 'var(--text-muted)', opacity: visible ? 1 : 0, transition: 'opacity 500ms ease 400ms' }}
      >
        Taking you in…
      </p>
    </main>
  )
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeContent />
    </Suspense>
  )
}
