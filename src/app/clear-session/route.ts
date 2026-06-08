import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /clear-session
 * Clears all Supabase auth cookies then redirects to sign-in.
 * Use this to fix HTTP 431 "Request Header Fields Too Large" errors
 * caused by oversized or stale auth cookies.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)
  const supabase = await createClient()

  // Sign out server-side (clears the session on Supabase + deletes cookies)
  await supabase.auth.signOut()

  const response = NextResponse.redirect(`${origin}/sign-in`)

  // Belt-and-suspenders: manually clear any lingering sb-* cookies
  const allCookies = request.headers.get('cookie') ?? ''
  const cookieNames = allCookies
    .split(';')
    .map(c => c.trim().split('=')[0])
    .filter(name => name.startsWith('sb-'))

  cookieNames.forEach(name => {
    response.cookies.set(name, '', {
      maxAge: 0,
      path: '/',
    })
  })

  return response
}
