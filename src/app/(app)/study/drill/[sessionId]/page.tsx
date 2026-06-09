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

export default function DrillSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [data, setData] = useState<SessionData | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showExitPrompt, setShowExitPrompt] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: session } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (!session || !session.question_ids?.length) {
        router.push('/study/drill')
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

      // Reorder questions to match session order
      const questionMap = new Map((questions ?? []).map((q: Question) => [q.id, q]))
      const orderedQs = (session.question_ids as string[]).map(id => questionMap.get(id)).filter(Boolean) as Question[]

      setData({ session: session as Session, questions: orderedQs, topics: topicMap })
      setCurrentIndex(session.current_question_index ?? 0)
      setLoading(false)
    }
    load()
  }, [sessionId, router])

  const handleAnswer = useCallback(async (selectedAnswer: string) => {
    const question = data?.questions[currentIndex]
    if (!question) return { was_correct: false, explanation: '' }

    const res = await fetch('/api/sessions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        selected_answer: selectedAnswer,
      }),
    })
    return res.json()
  }, [data, currentIndex, sessionId])

  const handleNext = useCallback(async () => {
    if (!data) return
    const nextIndex = currentIndex + 1
    if (nextIndex >= data.questions.length) {
      // Complete session
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

  // Escape to exit prompt
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowExitPrompt(p => !p)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const question = data.questions[currentIndex]
  const topic = question.topic_id ? data.topics.get(question.topic_id) : undefined

  return (
    <main className="min-h-screen bg-bg">
      <SessionHeader
        current={currentIndex}
        total={data.questions.length}
        onExit={() => setShowExitPrompt(true)}
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

      {/* Exit prompt */}
      {showExitPrompt && (
        <div className="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-lg p-6 max-w-sm w-full">
            <h3 className="font-serif text-xl text-primary mb-2">Save and exit?</h3>
            <p className="text-secondary text-sm mb-6">
              Your progress will be saved. You can resume this session from the home screen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExit}
                className="flex-1 bg-accent text-bg font-medium py-2 rounded-lg hover:opacity-90 transition"
              >
                Save & Exit
              </button>
              <button
                onClick={() => setShowExitPrompt(false)}
                className="flex-1 border border-border text-secondary py-2 rounded-lg hover:bg-surface2 transition"
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
