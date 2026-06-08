import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import QuestionTable from '@/components/admin/QuestionTable'
import type { Question, Topic } from '@/types/database'
import Link from 'next/link'

export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/home')

  const [{ data: questions }, { data: topics }] = await Promise.all([
    supabase.from('questions').select('*').order('created_at', { ascending: false }),
    supabase.from('topics').select('*').order('sort_order'),
  ])

  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-primary">Question Bank</h1>
            <p className="text-secondary text-sm">
              {(questions ?? []).length} total questions
            </p>
          </div>
          <Link href="/admin/content/upload" className="text-sm text-secondary hover:text-primary transition">
            ← Upload Content
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <QuestionTable
          questions={(questions ?? []) as Question[]}
          topics={(topics ?? []) as Topic[]}
        />
      </div>
    </main>
  )
}
