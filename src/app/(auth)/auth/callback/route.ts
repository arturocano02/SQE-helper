import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/home'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Check if profile already exists
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, onboarding_complete, is_admin')
        .eq('id', data.user.id)
        .single()

      if (!profile) {
        const ADMIN_EMAIL = 'arturocanobusi@gmail.com'
        const isAdmin = data.user.email === ADMIN_EMAIL
        // New user — create profile
        await supabase.from('profiles').insert({
          id: data.user.id,
          name: data.user.user_metadata?.full_name ?? null,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
          onboarding_complete: false,
          is_admin: isAdmin,
        })
        // Admins skip onboarding and go straight to the dashboard
        return NextResponse.redirect(`${origin}${isAdmin ? '/admin' : '/onboarding'}`)
      }

      // Ensure admin flag is always correct (self-healing for existing accounts)
      const ADMIN_EMAIL = 'arturocanobusi@gmail.com'
      if (data.user.email === ADMIN_EMAIL && !profile.is_admin) {
        await supabase.from('profiles').update({ is_admin: true }).eq('id', data.user.id)
      }

      if (!profile.onboarding_complete && data.user.email !== ADMIN_EMAIL) {
        return NextResponse.redirect(`${origin}/onboarding`)
      }

      // Admins always land on the admin dashboard
      if (data.user.email === ADMIN_EMAIL) {
        return NextResponse.redirect(`${origin}/admin`)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`)
}
