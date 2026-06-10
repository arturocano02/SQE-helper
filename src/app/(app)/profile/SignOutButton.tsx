'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSignOut() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  if (compact) {
    return (
      <button
        onClick={handleSignOut}
        disabled={loading}
        className="font-sans text-xs transition"
        style={{
          background: 'none',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          color: 'var(--text-muted)',
          opacity: loading ? 0.5 : 1,
          padding: 0,
        }}
      >
        {loading ? 'Signing out…' : 'Sign out'}
      </button>
    )
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="w-full font-sans text-sm transition"
      style={{
        background: 'none',
        border: '1px solid var(--surface-border)',
        color: 'var(--text-secondary)',
        padding: '12px 0',
        borderRadius: 8,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all 150ms ease',
      }}
      onMouseEnter={e => {
        if (!loading) {
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--status-wrong)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(224,90,90,0.35)'
        }
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--surface-border)'
      }}
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
