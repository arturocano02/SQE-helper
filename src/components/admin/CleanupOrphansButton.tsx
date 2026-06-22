'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface CleanupOrphansButtonProps {
  count: number
}

export default function CleanupOrphansButton({ count }: CleanupOrphansButtonProps) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const router = useRouter()

  async function handleCleanup() {
    if (!confirm(
      `Delete ${count} orphaned chunk${count !== 1 ? 's' : ''} (left behind when a source file was deleted directly instead of through "Reset & re-extract") and any questions generated from them?`
    )) return
    setLoading(true)

    const res = await fetch('/api/admin/chunks/cleanup-orphans', { method: 'POST' })
    const data = await res.json()

    setLoading(false)
    if (res.ok) {
      setDone(`✓ Deleted ${data.deleted_chunks} orphaned chunks, ${data.deleted_questions} dependent questions`)
      router.refresh()
    } else {
      alert(data.error ?? 'Cleanup failed')
    }
  }

  if (done) {
    return (
      <span className="font-sans text-xs" style={{ color: 'var(--status-correct)' }}>{done}</span>
    )
  }

  return (
    <button
      onClick={handleCleanup}
      disabled={loading}
      style={{
        background: 'rgba(248,113,113,0.10)',
        color: 'var(--status-wrong)',
        fontFamily: 'var(--font-dm-sans)',
        fontWeight: 500,
        fontSize: 12,
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid rgba(248,113,113,0.3)',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all 150ms ease',
      }}
      className="hover:brightness-110"
    >
      {loading ? 'Cleaning up…' : `Clean up ${count} orphaned chunk${count !== 1 ? 's' : ''} →`}
    </button>
  )
}
