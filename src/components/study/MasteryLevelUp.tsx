'use client'

import { useEffect, useState } from 'react'
import Celebration from './Celebration'

const TIER_ORDER = ['Needs work', 'Building', 'Developing', 'Strong', 'Mastered']

/**
 * Detects when a topic's mastery label has moved up a tier since the user
 * last viewed this page, and shows a small celebratory toast + confetti.
 * Purely additive — reads/writes its own localStorage key, doesn't touch
 * any existing mastery logic or layout.
 */
export default function MasteryLevelUp({ topicId, label }: { topicId: string; label: string }) {
  const [leveledUp, setLeveledUp] = useState(false)
  const storageKey = `sqe_mastery_tier_${topicId}`

  useEffect(() => {
    try {
      const prev = window.localStorage.getItem(storageKey)
      const prevIndex = prev ? TIER_ORDER.indexOf(prev) : -1
      const curIndex = TIER_ORDER.indexOf(label)
      if (prev && curIndex > prevIndex) {
        setLeveledUp(true)
        const t = setTimeout(() => setLeveledUp(false), 4200)
        window.localStorage.setItem(storageKey, label)
        return () => clearTimeout(t)
      }
      window.localStorage.setItem(storageKey, label)
    } catch {
      // ignore storage errors
    }
  }, [storageKey, label])

  if (!leveledUp) return null

  return (
    <>
      <Celebration show pieces={50} />
      <div
        style={{
          position: 'fixed',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 70,
          background: 'var(--surface-1)',
          border: '1px solid rgba(200,146,42,0.4)',
          borderRadius: 12,
          padding: '12px 22px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          textAlign: 'center',
        }}
      >
        <p className="font-serif text-base" style={{ color: 'var(--amber-text)' }}>
          Level up — now {label}
        </p>
      </div>
    </>
  )
}
