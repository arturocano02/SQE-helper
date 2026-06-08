'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Question, Topic, Session } from '@/types/database'
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
      const { data: session } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (!session?.question_ids?.length) { router.push('/study/recall'); return }

      const { data: qs } = await supabase
        .from('questions')
        .select('*')
        .in('id', session.question_ids as string[])

      const { data: topicsData } = await supabase
        .from('topics')
        .select('*')
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

    // Map assessment to quality score for SRS
    const qualityMap: Record<SelfAssessment, number> = { got_it: 5, nearly: 3, missed_it: 1 }

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

  if (loading || questions.length === 0) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const question = questions[currentIndex]
  const topic = question.topic_id ? topics.get(question.topic_id) : undefined

  return (
    <main className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.push('/home')}
              className="text-secondary hover:text-primary transition text-sm"
            >
              ✕
            </button>
            <ProgressBar current={currentIndex} total={questions.length} className="flex-1" />
          </div>
        </div>
      </header>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg">
          {/* Topic info */}
          {topic && (
            <div className="flex items-center gap-2 mb-6 justify-center">
              <Badge variant={topic.paper}>{topic.paper}</Badge>
              <span className="text-secondary text-sm">{topic.name}</span>
            </div>
          )}

          {/* Prompt */}
          <div className="bg-surface border border-border rounded-lg p-8 text-center mb-4">
            <p className="font-serif text-2xl text-primary leading-relaxed">{question.prompt}</p>
          </div>

          {/* Reveal / Answer */}
          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full border border-border text-secondary py-3 rounded-lg hover:bg-surface2 transition"
            >
              Reveal Answer
            </button>
          ) : (
            <>
              <div className="bg-surface2 border border-border rounded-lg p-6 mb-4">
                <p className="text-primary leading-relaxed whitespace-pre-line text-sm">
                  {question.explanation ?? 'No answer available.'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleAssessment('missed_it')}
                  className="py-3 rounded-lg border border-error/40 text-error bg-error/5 hover:bg-error/10 transition text-sm"
                >
                  ✗ Missed it
                </button>
                <button
                  onClick={() => handleAssessment('nearly')}
                  className="py-3 rounded-lg border border-warning/40 text-warning bg-warning/5 hover:bg-warning/10 transition text-sm"
                >
                  ≈ Nearly
                </button>
                <button
                  onClick={() => handleAssessment('got_it')}
                  className="py-3 rounded-lg border border-success/40 text-success bg-success/5 hover:bg-success/10 transition text-sm"
                >
                  ✓ Got it
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
