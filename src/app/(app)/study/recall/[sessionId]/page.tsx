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

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              style={{
                width: '100%',
                border: '2px dashed var(--surface-border)',
                borderRadius: 12,
                padding: '18px',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 14,
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
              className="hover:border-[rgba(200,146,42,0.4)] hover:text-[var(--text-primary)]"
            >
              Reveal answer
              <span
                className="ml-2 font-mono text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                (Space)
              </span>
            </button>
          ) : (
            <>
              {/* Answer card */}
              <div
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 14,
                  padding: '20px 22px',
                  marginBottom: 20,
                }}
              >
                <p
                  className="font-sans text-[10px] uppercase tracking-widest mb-3"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Answer
                </p>
                <p
                  className="font-sans text-sm leading-relaxed whitespace-pre-line"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {question.explanation ?? 'No answer available.'}
                </p>
              </div>

              <p
                className="text-center font-sans text-xs mb-3"
                style={{ color: 'var(--text-muted)' }}
              >
                How did you do?
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <AssessButton
                  onClick={() => handleAssessment('missed_it')}
                  color="wrong"
                  icon="✗"
                  label="Missed it"
                  hint="1"
                />
                <AssessButton
                  onClick={() => handleAssessment('nearly')}
                  color="warn"
                  icon="≈"
                  label="Nearly"
                  hint="2"
                />
                <AssessButton
                  onClick={() => handleAssessment('got_it')}
                  color="correct"
                  icon="✓"
                  label="Got it"
                  hint="3"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function AssessButton({
  onClick,
  color,
  icon,
  label,
  hint,
}: {
  onClick: () => void
  color: 'wrong' | 'warn' | 'correct'
  icon: string
  label: string
  hint: string
}) {
  const colorMap = {
    wrong:   { border: 'rgba(224,90,90,0.35)',  bg: 'rgba(224,90,90,0.07)',  text: '#E87878',            hover: 'rgba(224,90,90,0.14)' },
    warn:    { border: 'rgba(200,146,42,0.35)',  bg: 'rgba(200,146,42,0.07)', text: 'var(--amber-text)',  hover: 'rgba(200,146,42,0.14)' },
    correct: { border: 'rgba(76,175,130,0.35)',  bg: 'rgba(76,175,130,0.07)', text: '#6ECFA3',            hover: 'rgba(76,175,130,0.14)' },
  }
  const c = colorMap[color]

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        gap: 4,
        padding: '14px 8px',
        borderRadius: 12,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.text,
        cursor: 'pointer',
        transition: 'all 150ms ease',
        fontFamily: 'var(--font-dm-sans)',
      }}
      className="active:scale-95"
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = c.hover }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = c.bg }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      <span
        style={{ fontSize: 10, opacity: 0.4, fontFamily: 'var(--font-dm-mono)' }}
      >
        {hint}
      </span>
    </button>
  )
}
