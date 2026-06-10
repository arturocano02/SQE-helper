'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Question, Topic, Session } from '@/types/database'
import SessionHeader from '@/components/study/SessionHeader'
import QuestionCard from '@/components/study/QuestionCard'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

interface SessionData {
  session: Session
  questions: Question[]
  topics: Map<string, Topic>
}

export default function SimulateSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [data, setData] = useState<SessionData | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showExitPrompt, setShowExitPrompt] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: session } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (!session || !session.question_ids?.length) {
        router.push('/study/simulate')
        return
      }

      const { data: questions } = await supabase
        .from('questions')
        .select('*')
        .in('id', session.question_ids as string[])

      const { data: topicsData } = await supabase
        .from('topics')
        .select('*')
        .in('id', (questions ?? []).map((q: Question) => q.topic_id).filter(Boolean) as string[])

      const topicMap = new Map(((topicsData ?? []) as Topic[]).map(t => [t.id, t]))
      const questionMap = new Map((questions ?? []).map((q: Question) => [q.id, q]))
      const orderedQs = (session.question_ids as string[])
        .map(id => questionMap.get(id))
        .filter(Boolean) as Question[]

      setData({ session: session as Session, questions: orderedQs, topics: topicMap })
      setCurrentIndex(session.current_question_index ?? 0)
      setLoading(false)
    }
    load()
  }, [sessionId, router])

  // Elapsed timer
  useEffect(() => {
    if (!data) return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [data])

  const handleAnswer = useCallback(async (selectedAnswer: string) => {
    const question = data?.questions[currentIndex]
    if (!question) return { was_correct: false, explanation: '' }
    const res = await fetch('/api/sessions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, question_id: question.id, selected_answer: selectedAnswer }),
    })
    return res.json()
  }, [data, currentIndex, sessionId])

  const handleNext = useCallback(async () => {
    if (!data) return
    const nextIndex = currentIndex + 1
    if (nextIndex >= data.questions.length) {
      await fetch('/api/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      router.push(`/session/${sessionId}/summary`)
    } else {
      setCurrentIndex(nextIndex)
    }
  }, [data, currentIndex, sessionId, router])

  const handleExit = useCallback(async () => {
    await fetch('/api/sessions/complete', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, current_question_index: currentIndex }),
    })
    router.push('/home')
  }, [sessionId, currentIndex, router])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowExitPrompt(p => !p)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-base)' }}>
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const question = data.questions[currentIndex]
  const topic = question.topic_id ? data.topics.get(question.topic_id) : undefined

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedLabel = mins > 0
    ? `${mins}m ${secs.toString().padStart(2, '0')}s`
    : `${secs}s`

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <SessionHeader
        current={currentIndex}
        total={data.questions.length}
        onExit={() => setShowExitPrompt(true)}
        label="Simulation"
        rightExtra={
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            {elapsedLabel}
          </span>
        }
      />

      <div className="max-w-2xl mx-auto px-5 pt-24 pb-20">
        {question && (
          <QuestionCard
            key={question.id}
            question={question}
            questionNumber={currentIndex + 1}
            total={data.questions.length}
            topicName={topic?.name}
            topicPaper={topic?.paper}
            onAnswer={handleAnswer}
            onNext={handleNext}
            isLast={currentIndex === data.questions.length - 1}
          />
        )}
      </div>

      {showExitPrompt && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(10,10,8,0.85)', backdropFilter: 'blur(4px)' }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: '28px 28px 24px',
              maxWidth: 360,
              width: '100%',
            }}
            className="card-glow"
          >
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
              End simulation?
            </h3>
            <p className="font-sans text-sm mb-7" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {currentIndex} of {data.questions.length} questions answered. Progress will be saved.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExit}
                style={{
                  flex: 1,
                  background: 'var(--amber)',
                  color: '#0A0A08',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 500,
                  fontSize: 14,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
                className="hover:brightness-110 active:scale-[0.98]"
              >
                Save &amp; Exit
              </button>
              <button
                onClick={() => setShowExitPrompt(false)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 14,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: '1px solid var(--surface-border)',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
                className="hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
