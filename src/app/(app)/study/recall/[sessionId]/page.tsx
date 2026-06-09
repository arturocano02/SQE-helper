'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Question, Topic } from '@/types/database'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ProgressBar from '@/components/ui/ProgressBar'
import Badge from '@/components/ui/Badge'

type SelfAssessment = 'got_it' | 'nearly' | 'missed_it'

export default function RecallSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [questions, setQuestions] = useState<Question[]>([])
  const [topics, setTopics] = useState<Map<string, Topic>>(new Map())
  const [currentIndex, setCurrentIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
      if (!session?.question_ids?.length) { router.push('/study/recall'); return }

      const { data: qs } = await supabase.from('questions').select('*').in('id', session.question_ids as string[])
      const { data: topicsData } = await supabase.from('topics').select('*')
        .in('id', (qs ?? []).map((q: Question) => q.topic_id).filter(Boolean) as string[])

      const topicMap = new Map(((topicsData ?? []) as Topic[]).map(t => [t.id, t]))
      const qMap = new Map((qs ?? []).map((q: Question) => [q.id, q]))
      const ordered = (session.question_ids as string[]).map(id => qMap.get(id)).filter(Boolean) as Question[]

      setQuestions(ordered)
      setTopics(topicMap)
      setCurrentIndex(session.current_question_index ?? 0)
      setLoading(false)
    }
    load()
  }, [sessionId, router])

  const handleAssessment = useCallback(async (assessment: SelfAssessment) => {
    const question = questions[currentIndex]
    if (!question) return

    await fetch('/api/sessions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        selected_answer: assessment,
        self_assessment: assessment,
      }),
    })

    const nextIndex = currentIndex + 1
    if (nextIndex >= questions.length) {
      await fetch('/api/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      router.push(`/session/${sessionId}/summary`)
    } else {
      setCurrentIndex(nextIndex)
      setRevealed(false)
    }
  }, [questions, currentIndex, sessionId, router])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!revealed) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRevealed(true) }
        return
      }
      if (e.key === '1') handleAssessment('missed_it')
      if (e.key === '2') handleAssessment('nearly')
      if (e.key === '3') handleAssessment('got_it')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [revealed, handleAssessment])

  if (loading || questions.length === 0) {
    return <div className="min-h-screen bg-bg flex items-center justify-center"><LoadingSpinner size="lg" /></div>
  }

  const question = questions[currentIndex]
  const topic = question.topic_id ? topics.get(question.topic_id) : undefined

  return (
    <main className="min-h-screen bg-bg flex flex-col">
      <header className="border-b border-border bg-surface/60 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center gap-4">
          <button onClick={() => router.push('/home')}
            className="text-secondary hover:text-primary transition text-sm p-1">✕</button>
          <ProgressBar current={currentIndex} total={questions.length} className="flex-1" />
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          {topic && (
            <div className="flex items-center gap-2 mb-5 justify-center">
              <Badge variant={topic.paper}>{topic.paper}</Badge>
              <span className="text-secondary text-sm">{topic.name}</span>
            </div>
          )}

          <div className="bg-surface border border-border rounded-2xl p-7 mb-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
            <p className="text-muted text-xs uppercase tracking-wider mb-3">Recall this rule</p>
            <p className="font-serif text-[1.2rem] leading-relaxed text-primary">{question.prompt}</p>
          </div>

          {!revealed ? (
            <button onClick={() => setRevealed(true)}
              className="w-full border-2 border-dashed border-border text-secondary py-4 rounded-xl hover:border-accent/50 hover:text-primary transition text-sm">
              Reveal answer
              <span className="ml-2 text-muted text-xs">(Space)</span>
            </button>
          ) : (
            <>
              <div className="bg-surface2 border border-border rounded-2xl p-5 mb-5">
                <p className="text-muted text-xs uppercase tracking-wider mb-2">Answer</p>
                <p className="text-primary leading-relaxed text-sm whitespace-pre-line">
                  {question.explanation ?? 'No answer available.'}
                </p>
              </div>

              <p className="text-center text-xs text-muted mb-3">How did you do?</p>
              <div className="grid grid-cols-3 gap-2.5">
                <AssessButton onClick={() => handleAssessment('missed_it')} color="error" icon="✗" label="Missed it" hint="1" />
                <AssessButton onClick={() => handleAssessment('nearly')} color="warning" icon="≈" label="Nearly" hint="2" />
                <AssessButton onClick={() => handleAssessment('got_it')} color="success" icon="✓" label="Got it" hint="3" />
              </div>
            </>
          )}

          <p className="text-center text-xs text-muted mt-6">
            {currentIndex + 1} of {questions.length} cards
          </p>
        </div>
      </div>
    </main>
  )
}

function AssessButton({ onClick, color, icon, label, hint }: {
  onClick: () => void; color: 'error' | 'warning' | 'success'; icon: string; label: string; hint: string
}) {
  const styles = {
    error:   'border-error/40 bg-error/5 text-error hover:bg-error/15',
    warning: 'border-warning/40 bg-warning/5 text-warning hover:bg-warning/15',
    success: 'border-success/40 bg-success/5 text-success hover:bg-success/15',
  }
  return (
    <button onClick={onClick}
      className={`flex flex-col items-center gap-1 py-3.5 rounded-xl border-2 transition-all active:scale-95 ${styles[color]}`}>
      <span className="text-xl">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[10px] opacity-40">{hint}</span>
    </button>
  )
}
