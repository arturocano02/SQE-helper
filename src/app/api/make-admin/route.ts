import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'arturocanobusi@gmail.com'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Not signed in', detail: userError?.message }, { status: 401 })
  }

  if (user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: `Wrong email. Got: ${user.email}, expected: ${ADMIN_EMAIL}` }, { status: 403 })
  }

  const admin = createAdminClient()

  // Check current profile state
  const { data: existing } = await admin.from('profiles').select('*').eq('id', user.id).single()

  // Upsert — works whether profile exists or not
  const { error: upsertError } = await admin.from('profiles').upsert({
    id: user.id,
    is_admin: true,
    name: existing?.name ?? user.user_metadata?.full_name ?? null,
    avatar_url: existing?.avatar_url ?? user.user_metadata?.avatar_url ?? null,
    onboarding_complete: existing?.onboarding_complete ?? false,
  })

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  // Verify it took
  const { data: updated } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()

  return NextResponse.json({
    ok: true,
    email: user.email,
    profile_existed: !!existing,
    is_admin_before: existing?.is_admin ?? null,
    is_admin_after: updated?.is_admin,
    next: 'Sign out, sign back in with Google, then go to /admin',
  })
}
