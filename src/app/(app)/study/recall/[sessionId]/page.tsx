'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Question, Topic, AiVerdict } from '@/types/database'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ProgressBar from '@/components/ui/ProgressBar'
import Badge from '@/components/ui/Badge'

type Phase = 'answering' | 'grading' | 'graded'

export default function RecallSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const router = useRouter()
  const [questions, setQuestions] = useState<Question[]>([])
  const [topics, setTopics] = useState<Map<string, Topic>>(new Map())
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  const [phase, setPhase] = useState<Phase>('answering')
  const [userAnswer, setUserAnswer] = useState('')
  const [verdict, setVerdict] = useState<AiVerdict | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [modelAnswer, setModelAnswer] = useState('')
  const [disputeState, setDisputeState] = useState<'idle' | 'sending' | 'sent'>('idle')
  // Which exact knowledge chunk (and page in the original source notes) this flashcard's rule
  // came from — /api/sessions/answer already resolves this for every question type that has a
  // knowledge_chunk_id, MCQ or flashcard alike, so this just needs to be captured and shown here.
  const [chunkCitation, setChunkCitation] = useState<{
    rule_text: string
    source_section: string
    source_page_start: number | null
    source_page_end: number | null
  } | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
      if (!session?.question_ids?.length) { router.push('/study/recall'); return }

      const { data: qs } = await supabase
        .from('questions').select('*').in('id', session.question_ids as string[])
      const { data: topicsData } = await supabase
        .from('topics').select('*')
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

  const submitAnswer = useCallback(async () => {
    const question = questions[currentIndex]
    if (!question || !userAnswer.trim() || phase !== 'answering') return

    setPhase('grading')
    const res = await fetch('/api/sessions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        answer_text: userAnswer.trim(),
      }),
    })
    const data = await res.json()
    setVerdict(data.ai_verdict ?? null)
    setScore(typeof data.ai_score === 'number' ? data.ai_score : null)
    setModelAnswer(data.explanation ?? question.explanation ?? '')
    setChunkCitation(data.chunk ?? null)
    setPhase('graded')
  }, [questions, currentIndex, sessionId, userAnswer, phase])

  const goNext = useCallback(async () => {
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
      setPhase('answering')
      setUserAnswer('')
      setVerdict(null)
      setScore(null)
      setModelAnswer('')
      setChunkCitation(null)
      setDisputeState('idle')
    }
  }, [questions.length, currentIndex, sessionId, router])

  const submitDispute = useCallback(async () => {
    const question = questions[currentIndex]
    if (!question) return
    setDisputeState('sending')
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback_type: 'flashcard_dispute',
        question_id: question.id,
        description: `Student's answer: "${userAnswer.trim()}"\n\nAI verdict: ${verdict} (score ${score ?? '—'})\n\nModel answer: ${modelAnswer}`,
      }),
    })
    setDisputeState('sent')
  }, [questions, currentIndex, userAnswer, verdict, score, modelAnswer])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === 'answering' && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault(); submitAnswer()
      } else if (phase === 'graded' && (e.key === 'Enter' || e.key === ' ')) {
        const active = document.activeElement
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'BUTTON')) return
        e.preventDefault(); goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, submitAnswer, goNext])

  if (loading || questions.length === 0) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--surface-base)' }}
      >
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const question = questions[currentIndex]
  const topic = question.topic_id ? topics.get(question.topic_id) : undefined

  const verdictStyle: Record<AiVerdict, { bg: string; border: string; text: string; label: string }> = {
    correct: { bg: 'rgba(76,175,130,0.10)', border: 'rgba(76,175,130,0.35)', text: '#6ECFA3', label: 'Correct' },
    partial: { bg: 'rgba(200,146,42,0.10)', border: 'rgba(200,146,42,0.35)', text: 'var(--amber-text)', label: 'Partially correct' },
    incorrect: { bg: 'rgba(224,90,90,0.10)', border: 'rgba(224,90,90,0.35)', text: '#E87878', label: 'Incorrect' },
  }

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid var(--surface-border)',
          background: 'rgba(10,10,8,0.90)',
          backdropFilter: 'blur(8px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center gap-4">
          <button
            onClick={() => router.push('/home')}
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: 13,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              transition: 'color 150ms ease',
            }}
            className="hover:text-[var(--text-primary)] shrink-0"
          >
            ✕
          </button>
          <ProgressBar current={currentIndex} total={questions.length} className="flex-1" hideCount />
          <span
            className="font-mono text-[12px] tabular-nums shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {currentIndex + 1}&thinsp;/&thinsp;{questions.length}
          </span>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          {topic && (
            <div className="flex items-center gap-2 mb-5 justify-center">
              <Badge variant={topic.paper}>{topic.paper}</Badge>
              <span className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                {topic.name}
              </span>
            </div>
          )}

          {/* Prompt card */}
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 16,
              padding: '28px 24px',
              marginBottom: 16,
            }}
            className="card-glow"
          >
            <p
              className="font-sans text-[10px] uppercase tracking-widest mb-4"
              style={{ color: 'var(--text-muted)' }}
            >
              Recall this rule
            </p>
            <p
              className="font-serif leading-relaxed"
              style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}
            >
              {question.prompt}
            </p>
          </div>

          {phase === 'answering' && (
            <>
              <textarea
                value={userAnswer}
                onChange={e => setUserAnswer(e.target.value)}
                placeholder="Type the rule from memory, in your own words…"
                rows={5}
                autoFocus
                style={{
                  width: '100%',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 12,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 14,
                  padding: '14px 16px',
                  resize: 'vertical',
                  outline: 'none',
                  marginBottom: 12,
                }}
              />
              <button
                onClick={submitAnswer}
                disabled={!userAnswer.trim()}
                style={{
                  width: '100%',
                  background: 'var(--amber)',
                  color: '#0A0A08',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  padding: '14px',
                  borderRadius: 12,
                  border: 'none',
                  cursor: userAnswer.trim() ? 'pointer' : 'not-allowed',
                  opacity: userAnswer.trim() ? 1 : 0.5,
                  transition: 'all 150ms ease',
                }}
                className="active:scale-[0.99]"
              >
                Submit answer
                <span className="ml-2 font-mono text-xs" style={{ opacity: 0.6 }}>
                  (⌘+Enter)
                </span>
              </button>
            </>
          )}

          {phase === 'grading' && (
            <div className="flex flex-col items-center py-10 gap-3">
              <LoadingSpinner size="md" />
              <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                Grading your answer…
              </p>
            </div>
          )}

          {phase === 'graded' && verdict && (
            <>
              {/* Verdict badge */}
              <div
                className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl"
                style={{
                  background: verdictStyle[verdict].bg,
                  border: `1px solid ${verdictStyle[verdict].border}`,
                }}
              >
                <span style={{ color: verdictStyle[verdict].text, fontSize: 16 }}>
                  {verdict === 'correct' ? '✓' : verdict === 'partial' ? '≈' : '✗'}
                </span>
                <span
                  className="font-sans text-sm font-medium"
                  style={{ color: verdictStyle[verdict].text }}
                >
                  {verdictStyle[verdict].label}
                </span>
                {score !== null && (
                  <span
                    className="font-mono text-xs ml-auto"
                    style={{ color: verdictStyle[verdict].text, opacity: 0.7 }}
                  >
                    {score}/100
                  </span>
                )}
              </div>

              {/* Your answer */}
              <div
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 14,
                  padding: '16px 18px',
                  marginBottom: 12,
                }}
              >
                <p
                  className="font-sans text-[10px] uppercase tracking-widest mb-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Your answer
                </p>
                <p
                  className="font-sans text-sm leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {userAnswer}
                </p>
              </div>

              {/* Model answer */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 14,
                  padding: '16px 18px',
                  marginBottom: 16,
                }}
              >
                <p
                  className="font-sans text-[10px] uppercase tracking-widest mb-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Full answer
                </p>
                <p
                  className="font-sans text-sm leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {modelAnswer || 'No answer available.'}
                </p>
              </div>

              {chunkCitation && (
                <p
                  className="font-sans text-[11px] mb-4"
                  style={{ color: 'var(--text-muted)' }}
                >
                  📍 {chunkCitation.source_section}
                  {chunkCitation.source_page_start && (
                    <>
                      {' '}· p.{chunkCitation.source_page_start}
                      {chunkCitation.source_page_end && chunkCitation.source_page_end !== chunkCitation.source_page_start
                        ? `–${chunkCitation.source_page_end}`
                        : ''}
                      {' '}in your source notes
                    </>
                  )}
                </p>
              )}

              {verdict !== 'correct' && (
                <div className="flex items-center justify-center mb-4">
                  {disputeState === 'sent' ? (
                    <p className="font-sans text-xs" style={{ color: 'var(--text-muted)' }}>
                      Sent to admin for review — thanks for flagging it.
                    </p>
                  ) : (
                    <button
                      onClick={submitDispute}
                      disabled={disputeState === 'sending'}
                      className="font-sans text-xs underline"
                      style={{
                        color: 'var(--text-muted)',
                        background: 'transparent',
                        border: 'none',
                        cursor: disputeState === 'sending' ? 'wait' : 'pointer',
                      }}
                    >
                      {disputeState === 'sending' ? 'Sending…' : 'I believe my answer was actually correct →'}
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={goNext}
                style={{
                  width: '100%',
                  background: 'var(--amber)',
                  color: '#0A0A08',
                  fontFamily: 'var(--font-dm-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  padding: '14px',
                  borderRadius: 12,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 150ms ease',
                }}
                className="active:scale-[0.99]"
              >
                Continue
                <span className="ml-2 font-mono text-xs" style={{ opacity: 0.6 }}>
                  (Enter)
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
