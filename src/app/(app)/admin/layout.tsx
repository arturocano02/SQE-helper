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
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <span className="font-serif text-lg text-primary">SQE1</span>
              <span className="flex items-center gap-1 text-xs border border-accent/40 text-accent px-1.5 py-0.5 rounded">
                <AdminIcon size={11} />
                Admin
              </span>
            </div>
            <nav className="flex items-center gap-1">
              <AdminNavLink href="/admin" icon={<AdminIcon size={15} />} label="Dashboard" />
              <AdminNavLink href="/admin/content/upload" icon={<UploadIcon size={15} />} label="Upload" />
              <AdminNavLink href="/admin/content/questions" icon={<QuestionIcon size={15} />} label="Questions" />
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted hidden sm:block">{profile.name ?? user.email}</span>
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
      className="flex items-center gap-1.5 text-secondary hover:text-primary px-3 py-1.5 rounded hover:bg-surface2 transition text-sm"
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
