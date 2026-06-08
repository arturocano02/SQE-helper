'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

type Mode = 'signin' | 'signup'

export default function SignInPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleGoogleSignIn() {
    setGoogleLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: false,
      },
    })
    if (data?.url) {
      window.location.href = data.url
      return
    }
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)
    setMessage(null)

    const supabase = createClient()

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) {
        setError(error.message)
      } else {
        setMessage('Check your email for a confirmation link.')
      }
    } else {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        // Session is already set — check if admin and redirect accordingly
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, onboarding_complete')
          .eq('id', signInData.user.id)
          .single()

        if (profile?.is_admin) {
          window.location.href = '/admin'
        } else if (!profile?.onboarding_complete) {
          window.location.href = '/onboarding'
        } else {
          window.location.href = '/home'
        }
      }
    }

    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">

        {/* Brand */}
        <div className="mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
              <span className="font-serif text-accent text-sm font-semibold">S</span>
            </span>
            <h1 className="font-serif text-3xl text-primary">SQE1</h1>
          </div>
          <p className="text-secondary text-sm">Adaptive study for the Solicitors Qualifying Examination</p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-8">
          <h2 className="font-serif text-2xl text-primary mb-6">
            {mode === 'signin' ? 'Welcome back' : 'Create account'}
          </h2>

          {/* Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-3 bg-surface2 border border-border text-primary px-4 py-3 rounded-lg hover:bg-border transition disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {googleLoading ? <LoadingSpinner size="sm" /> : <GoogleIcon />}
            <span className="text-sm">Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Email / password form */}
          <form onSubmit={handleEmailAuth} className="space-y-3 text-left">
            <div>
              <label className="block text-xs text-secondary mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-surface2 border border-border text-primary px-3 py-2.5 rounded-lg text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                required
                minLength={6}
                className="w-full bg-surface2 border border-border text-primary px-3 py-2.5 rounded-lg text-sm focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-accent text-bg font-medium py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
            >
              {loading && <LoadingSpinner size="sm" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {error && (
            <p className="mt-4 text-sm text-error text-center">{error}</p>
          )}
          {message && (
            <p className="mt-4 text-sm text-success text-center">{message}</p>
          )}

          {/* Toggle mode */}
          <p className="mt-5 text-xs text-muted text-center">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null); setMessage(null) }}
              className="text-secondary hover:text-primary transition underline underline-offset-2"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <p className="mt-6 text-xs text-muted text-center">
          By continuing, you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
