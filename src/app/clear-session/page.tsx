'use client'

import { useEffect, useState } from 'react'

/**
 * /clear-session
 *
 * This page is intentionally cookie-free on the server.
 * It runs entirely client-side so it's never blocked by a 431.
 * It deletes all sb-* cookies via document.cookie, then redirects to /sign-in.
 */
export default function ClearSessionPage() {
  const [log, setLog] = useState<string[]>(['Clearing session cookies…'])

  useEffect(() => {
    const cleared: string[] = []

    // Find and delete every sb-* cookie
    document.cookie.split(';').forEach(part => {
      const name = part.trim().split('=')[0]
      if (name.startsWith('sb-') || name.includes('supabase')) {
        // Delete for current path and root path
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`
        cleared.push(name)
      }
    })

    const msgs = cleared.length > 0
      ? [`Cleared ${cleared.length} cookie(s): ${cleared.join(', ')}`, 'Redirecting to sign-in…']
      : ['No auth cookies found.', 'Redirecting to sign-in…']

    setLog(msgs)

    // Also clear localStorage auth keys Supabase may have set
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') || key.includes('supabase')) {
        localStorage.removeItem(key)
      }
    })

    setTimeout(() => {
      window.location.replace('/sign-in')
    }, 1200)
  }, [])

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="bg-surface border border-border rounded-xl p-8 max-w-sm w-full text-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <h1 className="font-serif text-xl text-primary mb-4">Clearing session</h1>
        <div className="space-y-1">
          {log.map((line, i) => (
            <p key={i} className="text-secondary text-sm">{line}</p>
          ))}
        </div>
      </div>
    </main>
  )
}
