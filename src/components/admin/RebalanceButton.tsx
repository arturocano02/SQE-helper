'use client'

import { useState, useEffect } from 'react'

/**
 * One-off remediation control for legacy MCQ rows generated before correct answers were
 * shuffled — those are all stuck on correct_answer === 'A', making them trivially guessable.
 * Shows nothing if there's nothing to fix. Safe to run more than once.
 */
export default function RebalanceButton() {
  const [affected, setAffected] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<{ updated: number; skipped: number } | null>(null)

  useEffect(() => {
    fetch('/api/admin/questions/rebalance')
      .then(res => res.json())
      .then(json => setAffected(typeof json.affected === 'number' ? json.affected : 0))
      .catch(() => setAffected(0))
  }, [])

  async function run() {
    setRunning(true)
    const res = await fetch('/api/admin/questions/rebalance', { method: 'POST' })
    const json = await res.json()
    setDone({ updated: json.updated ?? 0, skipped: json.skipped ?? 0 })
    setAffected(0)
    setRunning(false)
  }

  if (affected === null || (affected === 0 && !done)) return null

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl mb-6"
      style={{ background: 'rgba(224,90,90,0.06)', border: '1px solid rgba(224,90,90,0.2)' }}
    >
      {done ? (
        <p className="font-sans text-sm" style={{ color: '#E87878' }}>
          Reshuffled {done.updated} question{done.updated !== 1 ? 's' : ''} that were stuck on answer A
          {done.skipped > 0 ? ` (${done.skipped} skipped — malformed options)` : ''}.
        </p>
      ) : (
        <p className="font-sans text-sm" style={{ color: '#E87878' }}>
          {affected} legacy MCQ{affected !== 1 ? 's' : ''} have correct_answer always set to &apos;A&apos; — predates answer shuffling.
        </p>
      )}
      {!done && (
        <button
          onClick={run}
          disabled={running}
          className="font-sans text-xs shrink-0 px-3 py-1.5 rounded-lg transition"
          style={{
            background: '#E87878',
            color: '#0A0A08',
            border: 'none',
            cursor: running ? 'wait' : 'pointer',
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? 'Reshuffling…' : 'Fix now →'}
        </button>
      )}
    </div>
  )
}
