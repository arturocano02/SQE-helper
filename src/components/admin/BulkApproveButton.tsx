'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BulkApproveButtonProps {
  count: number
}

export default function BulkApproveButton({ count }: BulkApproveButtonProps) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()

  async function handleApproveAll() {
    if (!confirm(`Approve all ${count} draft questions? They will become visible to students immediately.`)) return
    setLoading(true)

    const res = await fetch('/api/admin/questions/bulk-approve', { method: 'POST' })
    const data = await res.json()

    setLoading(false)
    if (res.ok) {
      setDone(true)
      router.refresh()
    } else {
      alert(data.error ?? 'Failed to approve')
    }
  }

  if (done) {
    return (
      <span className="font-sans font-medium text-xs" style={{ color: 'var(--status-correct)' }}>
        ✓ All approved
      </span>
    )
  }

  return (
    <button
      onClick={handleApproveAll}
      disabled={loading}
      style={{
        background: 'var(--amber)',
        color: '#0A0A08',
        fontFamily: 'var(--font-dm-sans)',
        fontWeight: 500,
        fontSize: 12,
        padding: '6px 12px',
        borderRadius: 6,
        border: 'none',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all 150ms ease',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      className="hover:brightness-110"
    >
      {loading ? (
        <>
          <span
            className="w-3 h-3 rounded-full animate-spin"
            style={{ border: '2px solid rgba(10,10,8,0.4)', borderTopColor: '#0A0A08' }}
          />
          Approving…
        </>
      ) : (
        `Approve all ${count} →`
      )}
    </button>
  )
}
