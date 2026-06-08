import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/', '/sign-in', '/auth/callback', '/clear-session']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some(
    p => pathname === p || pathname.startsWith('/auth/')
  )

  // ── Cookie overflow guard ───────────────────────────────────────────────
  // Measure total cookie header size. If it's too large, clear all sb-* cookies
  // immediately — before Supabase even tries to read them — and redirect to
  // /clear-session so the user can re-authenticate cleanly.
  const cookieHeader = request.headers.get('cookie') ?? ''
  if (cookieHeader.length > 6000) {
    console.warn(
      `[proxy] Cookie header too large (${cookieHeader.length} bytes) — clearing Supabase cookies`
    )
    const clearResponse = NextResponse.redirect(new URL('/clear-session', request.url))
    // Delete every sb-* cookie
    cookieHeader.split(';').forEach(part => {
      const name = part.trim().split('=')[0]
      if (name.startsWith('sb-')) {
        clearResponse.cookies.set(name, '', { maxAge: 0, path: '/' })
      }
    })
    return clearResponse
  }

  // ── Session refresh ─────────────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: {
          maxAge: 60 * 60 * 24 * 7,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        },
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error) {
      console.error('[proxy] getUser error:', error.message)
    }

    if (!user && !isPublic) {
      const url = request.nextUrl.clone()
      url.pathname = '/sign-in'
      return NextResponse.redirect(url)
    }
  } catch (err) {
    console.error('[proxy] Unexpected error — redirecting to sign-in:', err)
    if (!isPublic) {
      const url = request.nextUrl.clone()
      url.pathname = '/sign-in'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
