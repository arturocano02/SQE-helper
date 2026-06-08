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
        className="text-xs text-muted hover:text-error transition disabled:opacity-50"
      >
        {loading ? 'Signing out…' : 'Sign out'}
      </button>
    )
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="w-full border border-border text-secondary py-3 rounded hover:bg-surface2 hover:text-error hover:border-error/40 transition disabled:opacity-50 text-sm"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
