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
        .select('id, onboarding_complete')
        .eq('id', data.user.id)
        .single()

      if (!profile) {
        // New user — create profile
        await supabase.from('profiles').insert({
          id: data.user.id,
          name: data.user.user_metadata?.full_name ?? null,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
          onboarding_complete: false,
        })
        return NextResponse.redirect(`${origin}/onboarding`)
      }

      if (!profile.onboarding_complete) {
        return NextResponse.redirect(`${origin}/onboarding`)
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth_callback_failed`)
}
