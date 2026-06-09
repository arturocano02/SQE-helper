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

    // Fetch all draft IDs, then bulk-approve
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
    return <span className="text-xs text-success font-medium">✓ All approved</span>
  }

  return (
    <button
      onClick={handleApproveAll}
      disabled={loading}
      className="bg-accent text-bg font-medium px-3 py-1.5 rounded-lg text-xs hover:opacity-90 transition disabled:opacity-50"
    >
      {loading ? (
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
          Approving…
        </span>
      ) : (
        `Approve all ${count} →`
      )}
    </button>
  )
}
