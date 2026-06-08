import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'arturocanobusi@gmail.com'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/home'

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', error?.message)
    return NextResponse.redirect(`${origin}/sign-in?error=auth_failed`)
  }

  const userEmail = data.user.email
  const isAdmin = userEmail === ADMIN_EMAIL

  // Check for existing profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_complete, is_admin')
    .eq('id', data.user.id)
    .single()

  if (!profile) {
    // First sign-in — create profile
    await supabase.from('profiles').insert({
      id: data.user.id,
      name: data.user.user_metadata?.full_name ?? null,
      avatar_url: data.user.user_metadata?.avatar_url ?? null,
      onboarding_complete: false,
      is_admin: isAdmin,
    })
    return NextResponse.redirect(`${origin}${isAdmin ? '/admin' : '/onboarding'}`)
  }

  // Self-heal: ensure admin flag is always correct
  if (isAdmin && !profile.is_admin) {
    await supabase.from('profiles').update({ is_admin: true }).eq('id', data.user.id)
  }

  if (isAdmin) return NextResponse.redirect(`${origin}/admin`)
  if (!profile.onboarding_complete) return NextResponse.redirect(`${origin}/onboarding`)
  return NextResponse.redirect(`${origin}${next}`)
}
