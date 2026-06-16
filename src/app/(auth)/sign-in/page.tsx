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
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-3)',
    border: '1px solid var(--surface-border)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-dm-sans)',
    fontSize: 14,
    outline: 'none',
    transition: 'all 150ms ease',
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--amber-soft)',
                border: '1px solid rgba(200,146,42,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                className="font-serif text-sm font-semibold"
                style={{ color: 'var(--amber)' }}
              >
                S
              </span>
            </div>
            <h1
              className="font-serif text-3xl"
              style={{ color: 'var(--text-primary)' }}
            >
              SQE1
            </h1>
          </div>
          <p
            className="font-sans text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Adaptive study for the Solicitors Qualifying Examination
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 14,
            padding: '32px 28px',
          }}
          className="card-glow"
        >
          <h2
            className="font-serif text-2xl mb-7"
            style={{ color: 'var(--text-primary)' }}
          >
            {mode === 'signin' ? 'Welcome back' : 'Create account'}
          </h2>

          {/* Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'var(--surface-3)',
              border: '1px solid var(--surface-border)',
              borderRadius: 8,
              padding: '11px 16px',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 150ms ease',
              marginBottom: 20,
              opacity: googleLoading || loading ? 0.5 : 1,
            }}
            className="hover:bg-[var(--surface-2)] hover:border-[rgba(255,255,255,0.12)]"
          >
            {googleLoading ? <LoadingSpinner size="sm" /> : <GoogleIcon />}
            <span>Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div style={{ flex: 1, height: 1, background: 'var(--surface-border)' }} />
            <span
              className="font-sans text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              or
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--surface-border)' }} />
          </div>

          {/* Email form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label
                className="block font-sans text-xs mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputStyle}
                onFocus={e => {
                  (e.target as HTMLInputElement).style.borderColor = 'rgba(200,146,42,0.5)'
                  ;(e.target as HTMLInputElement).style.boxShadow = '0 0 0 3px var(--amber-glow)'
                }}
                onBlur={e => {
                  (e.target as HTMLInputElement).style.borderColor = 'var(--surface-border)'
                  ;(e.target as HTMLInputElement).style.boxShadow = 'none'
                }}
              />
            </div>
            <div>
              <label
                className="block font-sans text-xs mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                required
                minLength={6}
                style={inputStyle}
                onFocus={e => {
                  (e.target as HTMLInputElement).style.borderColor = 'rgba(200,146,42,0.5)'
                  ;(e.target as HTMLInputElement).style.boxShadow = '0 0 0 3px var(--amber-glow)'
                }}
                onBlur={e => {
                  (e.target as HTMLInputElement).style.borderColor = 'var(--surface-border)'
                  ;(e.target as HTMLInputElement).style.boxShadow = 'none'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              style={{
                width: '100%',
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 14,
                padding: '11px 24px',
                borderRadius: 8,
                border: 'none',
                cursor: loading || googleLoading ? 'not-allowed' : 'pointer',
                opacity: loading || googleLoading ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 150ms ease',
              }}
              className="hover:brightness-110 active:scale-[0.98]"
            >
              {loading && <LoadingSpinner size="sm" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {error && (
            <p
              className="mt-4 font-sans text-sm text-center"
              style={{ color: 'var(--status-wrong)' }}
            >
              {error}
            </p>
          )}
          {message && (
            <p
              className="mt-4 font-sans text-sm text-center"
              style={{ color: 'var(--status-correct)' }}
            >
              {message}
            </p>
          )}

          {/* Mode toggle */}
          <p
            className="mt-6 font-sans text-xs text-center"
            style={{ color: 'var(--text-muted)' }}
          >
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => {
                setMode(m => m === 'signin' ? 'signup' : 'signin')
                setError(null)
                setMessage(null)
              }}
              style={{
                color: 'var(--text-secondary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 12,
                transition: 'color 150ms ease',
              }}
              className="hover:text-[var(--text-primary)]"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <p
          className="mt-5 font-sans text-xs text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          By continuing, you agree to our Terms and Privacy Policy.
        </p>
        <p
          className="mt-2 font-sans text-xs text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          Questions and explanations are AI-generated and can contain mistakes — always double-check anything that matters.
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
