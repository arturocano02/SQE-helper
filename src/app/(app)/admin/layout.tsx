export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import SignOutButton from '../profile/SignOutButton'
import { AdminIcon, UploadIcon, QuestionIcon } from '@/components/ui/Icon'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, name')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/home')

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--surface-border)',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <span
                className="font-serif text-lg"
                style={{ color: 'var(--text-primary)' }}
              >
                SQE1
              </span>
              <span
                className="flex items-center gap-1 text-[10px] font-sans px-1.5 py-0.5 rounded"
                style={{
                  border: '1px solid rgba(200,146,42,0.4)',
                  color: 'var(--amber-text)',
                }}
              >
                <AdminIcon size={10} />
                Admin
              </span>
            </div>
            <nav className="flex items-center gap-0.5">
              <AdminNavLink href="/admin" icon={<AdminIcon size={14} />} label="Dashboard" />
              <AdminNavLink href="/admin/content/upload" icon={<UploadIcon size={14} />} label="Upload" />
              <AdminNavLink href="/admin/content/questions" icon={<QuestionIcon size={14} />} label="Questions" />
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span
              className="font-sans text-xs hidden sm:block"
              style={{ color: 'var(--text-muted)' }}
            >
              {profile.name ?? user.email}
            </span>
            <SignOutButton compact />
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}

function AdminNavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded transition text-sm font-sans"
      style={{ color: 'var(--text-secondary)', transition: 'all 150ms ease' }}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
