'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Question, MCQOption, FeedbackType } from '@/types/database'
import Badge from '@/components/ui/Badge'
import OptionButton from './OptionButton'

const QUESTION_FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string }> = [
  { value: 'wrong_answer', label: 'The stated correct answer is wrong' },
  { value: 'poor_explanation', label: 'The explanation is unclear or incomplete' },
  { value: 'outdated_law', label: 'The law referenced is outdated or incorrect' },
  { value: 'misleading_question', label: 'The question wording is misleading' },
  { value: 'other', label: 'Other issue' },
]

interface AnswerResult {
  was_correct: boolean
  correct_answer: string | null
  explanation: string
  chunk?: {
    id: string
    rule_text: string
    source_section: string
    key_terms: string[]
    source_page_start: number | null
    source_page_end: number | null
  } | null
}

interface QuestionCardProps {
  question: Question
  questionNumber: number
  total: number
  topicName?: string
  topicPaper?: 'FLK1' | 'FLK2'
  onAnswer: (selectedAnswer: string) => Promise<AnswerResult>
  onNext: () => void
  isLast: boolean
}

/**
 * Split a long prompt into readable paragraphs.
 * Strategy:
 *  1. If the text already has \n\n, honour those.
 *  2. Otherwise, if >250 chars, split after the 2nd/3rd sentence to form
 *     a short "scenario" paragraph + a "question" paragraph.
 */
function splitPrompt(text: string): string[] {
  // Honour explicit line breaks first
  if (text.includes('\n\n')) {
    return text.split('\n\n').map(p => p.trim()).filter(Boolean)
  }
  if (text.includes('\n')) {
    return text.split('\n').map(p => p.trim()).filter(Boolean)
  }

  // Auto-split long prompts: find sentence boundaries
  if (text.length <= 250) return [text]

  // Split on sentence endings followed by a space + capital letter
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) ?? [text]
  if (sentences.length <= 2) return [text]

  // Put first ~half of sentences in paragraph 1, rest in paragraph 2
  const splitAt = Math.ceil(sentences.length / 2)
  const p1 = sentences.slice(0, splitAt).join('').trim()
  const p2 = sentences.slice(splitAt).join('').trim()
  return p2 ? [p1, p2] : [p1]
}

export default function QuestionCard({
  question, questionNumber, total, topicName, topicPaper, onAnswer, onNext, isLast,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [explanationVisible, setExplanationVisible] = useState(false)
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealType, setAppealType] = useState<FeedbackType>('wrong_answer')
  const [appealText, setAppealText] = useState('')
  const [appealSubmitting, setAppealSubmitting] = useState(false)
  const [appealDone, setAppealDone] = useState(false)
  const [chunkModalOpen, setChunkModalOpen] = useState(false)
  const [disputeText, setDisputeText] = useState('')
  const [disputeSubmitting, setDisputeSubmitting] = useState(false)
  const [disputeDone, setDisputeDone] = useState(false)

  const options = (question.options ?? []) as MCQOption[]
  const promptParagraphs = splitPrompt(question.prompt)

  async function submitDispute(chunkId: string) {
    if (!disputeText.trim()) return
    setDisputeSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_type: 'chunk_dispute',
          description: disputeText.trim(),
          knowledge_chunk_id: chunkId,
        }),
      })
      setDisputeDone(true)
      setTimeout(() => {
        setChunkModalOpen(false)
        setDisputeDone(false)
        setDisputeText('')
      }, 1800)
    } finally {
      setDisputeSubmitting(false)
    }
  }

  async function submitAppeal() {
    if (!appealText.trim()) return
    setAppealSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_type: appealType,
          description: appealText.trim(),
          question_id: question.id,
        }),
      })
      setAppealDone(true)
      setTimeout(() => {
        setAppealOpen(false)
        setAppealDone(false)
        setAppealText('')
        setAppealType('wrong_answer')
      }, 1800)
    } finally {
      setAppealSubmitting(false)
    }
  }

  const handleSelect = useCallback(async (label: string) => {
    if (selected || loading) return
    setSelected(label)
    setLoading(true)
    try {
      const res = await onAnswer(label)
      setResult(res)
      // Small delay so option state settles before explanation slides in
      setTimeout(() => setExplanationVisible(true), 120)
    } finally {
      setLoading(false)
    }
  }, [selected, loading, onAnswer])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (result) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault()
          onNext()
        }
        return
      }
      const map: Record<string, string> = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }
      const label = map[e.key.toLowerCase()]
      if (label) handleSelect(label)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [result, handleSelect, onNext])

  type OptionState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'reveal-correct'
  const getOptionState = (label: string): OptionState => {
    if (!result) return selected === label ? 'selected' : 'idle'
    if (label === result.correct_answer) return 'correct'
    if (label === selected && !result.was_correct) return 'incorrect'
    return 'idle'
  }

  return (
    <>
      {/* Main card — question + options */}
      <div
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--surface-border)',
          borderRadius: 12,
          padding: '24px 24px 20px',
        }}
        className="card-glow"
      >
        {/* Meta row */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2 flex-wrap">
            {topicPaper && <Badge variant={topicPaper}>{topicPaper}</Badge>}
            {topicName && (
              <span className="text-xs font-sans" style={{ color: 'var(--text-secondary)' }}>
                {topicName}
              </span>
            )}
            {question.difficulty && <Badge variant={question.difficulty}>{question.difficulty}</Badge>}
          </div>
          <span
            className="font-mono text-[12px] tabular-nums shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {questionNumber}&thinsp;/&thinsp;{total}
          </span>
        </div>

        {/* Question text — DM Sans, split into paragraphs */}
        <div className="mb-6 space-y-3">
          {promptParagraphs.map((para, i) => (
            <p
              key={i}
              className="font-sans leading-relaxed"
              style={{
                fontSize: '1rem',
                color: 'var(--text-primary)',
                lineHeight: 1.7,
              }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Options — after answering, collapse idle ones so explanation fits on screen */}
        <div className="space-y-2.5">
          {options.map(opt => {
            const state = getOptionState(opt.label)
            // Once answered: hide options that are just 'idle' (not selected, not correct)
            const isHidden = result && state === 'idle'
            return (
              <div
                key={opt.label}
                style={{
                  maxHeight: isHidden ? 0 : 'none',
                  overflow: isHidden ? 'hidden' : 'visible',
                  opacity: isHidden ? 0 : 1,
                  marginBottom: isHidden ? 0 : undefined,
                  transition: 'max-height 250ms ease, opacity 200ms ease, margin 250ms ease',
                }}
              >
                <OptionButton
                  label={opt.label}
                  text={opt.text}
                  state={state}
                  onClick={() => handleSelect(opt.label)}
                  disabled={!!result || loading}
                />
              </div>
            )
          })}
        </div>

        {/* Keyboard hint — only before answering */}
        {!result && !selected && (
          <p
            className="text-center text-[11px] mt-4 font-sans"
            style={{ color: 'var(--text-muted)' }}
          >
            Press{' '}
            <kbd
              style={{
                padding: '2px 5px',
                background: 'var(--surface-3)',
                border: '1px solid var(--surface-border)',
                borderRadius: 4,
                fontFamily: 'var(--font-dm-mono)',
                fontSize: 11,
              }}
            >
              A
            </kbd>
            –
            <kbd
              style={{
                padding: '2px 5px',
                background: 'var(--surface-3)',
                border: '1px solid var(--surface-border)',
                borderRadius: 4,
                fontFamily: 'var(--font-dm-mono)',
                fontSize: 11,
              }}
            >
              E
            </kbd>
            {' '}to select
          </p>
        )}
      </div>

      {/* Explanation — separate card below, fades in */}
      {result && (
        <div
          className={[
            'mt-4 transition-all duration-300 ease-out',
            explanationVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
          ].join(' ')}
        >
          {/* Verdict banner */}
          <div
            style={{
              background: result.was_correct ? 'rgba(76,175,130,0.10)' : 'rgba(224,90,90,0.10)',
              border: `1px solid ${result.was_correct ? 'rgba(76,175,130,0.30)' : 'rgba(224,90,90,0.30)'}`,
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: result.was_correct ? 'var(--status-correct)' : 'var(--status-wrong)',
                color: '#0A0A08',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {result.was_correct ? '✓' : '✗'}
            </span>
            <div className="flex-1">
              <p
                className="font-sans font-medium text-sm"
                style={{ color: result.was_correct ? 'var(--status-correct)' : 'var(--status-wrong)' }}
              >
                {result.was_correct ? 'Correct' : 'Incorrect'}
              </p>
              {!result.was_correct && result.correct_answer && (
                <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Correct answer:{' '}
                  <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-dm-mono)' }}>
                    {result.correct_answer}
                  </strong>
                </p>
              )}
            </div>
          </div>

          {/* Explanation text */}
          {result.explanation && (
            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                borderRadius: 10,
                padding: '18px 20px',
                marginBottom: result.chunk ? 12 : 0,
                // Extra bottom padding so sticky button doesn't overlap when no chunk follows
                paddingBottom: result.chunk ? 20 : 80,
              }}
            >
              <p
                className="font-sans text-[10px] font-medium uppercase tracking-widest mb-3"
                style={{ color: 'var(--text-muted)' }}
              >
                Explanation
              </p>
              <p
                className="font-sans text-sm leading-relaxed whitespace-pre-line"
                style={{ color: 'var(--text-primary)', lineHeight: 1.75 }}
              >
                {result.explanation}
              </p>
            </div>
          )}

          {/* Source pills — what knowledge chunk this came from, and where to find it
              in the source notes. Click either to open the full chunk + dispute it. */}
          {result.chunk && (
            <div
              className="flex flex-wrap items-center gap-2"
              style={{ marginBottom: 12, paddingBottom: 68 }}
            >
              <button
                onClick={() => setChunkModalOpen(true)}
                className="font-sans text-[12px] px-3 py-1.5 rounded-full transition hover:brightness-110"
                style={{
                  background: 'rgba(200,146,42,0.08)',
                  border: '1px solid rgba(200,146,42,0.25)',
                  color: 'var(--amber-text)',
                  cursor: 'pointer',
                  maxWidth: 280,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title="View the knowledge chunk this question was generated from"
              >
                <span style={{ flexShrink: 0 }}>📖</span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {result.chunk.rule_text.slice(0, 44)}{result.chunk.rule_text.length > 44 ? '…' : ''}
                </span>
              </button>
              {result.chunk.source_page_start && (
                <button
                  onClick={() => setChunkModalOpen(true)}
                  className="font-sans text-[12px] px-3 py-1.5 rounded-full transition hover:brightness-110"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--surface-border)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                  title="The page in your source notes this rule came from — verify it yourself"
                >
                  📍 p.{result.chunk.source_page_start}
                  {result.chunk.source_page_end && result.chunk.source_page_end !== result.chunk.source_page_start
                    ? `–${result.chunk.source_page_end}`
                    : ''}
                </button>
              )}
            </div>
          )}

          {/* Flag this question */}
          {result && (
            <div className="flex justify-end mt-2 mb-1">
              <button
                onClick={() => setAppealOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 6px',
                  borderRadius: 6,
                  transition: 'color 150ms ease',
                }}
                className="hover:text-[var(--status-wrong)]"
                title="Flag an issue with this question"
              >
                ⚑ Flag issue
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky Next button — fixed at bottom, only when answered */}
      {result && (
        <div
          className={[
            'fixed bottom-0 left-0 right-0 z-30 transition-all duration-300 ease-out',
            explanationVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
          ].join(' ')}
          style={{
            background: 'linear-gradient(to top, var(--surface-base) 70%, transparent)',
            padding: '16px 20px 24px',
          }}
        >
          <div className="max-w-2xl mx-auto">
            <button
              onClick={onNext}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 600,
                fontSize: 15,
                padding: '14px 24px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                boxShadow: '0 4px 20px rgba(200,146,42,0.25)',
              }}
              className="hover:brightness-110 active:scale-[0.98]"
            >
              {isLast ? 'See Results' : 'Next Question'}
              <span style={{ opacity: 0.7, fontSize: 18 }}>→</span>
            </button>
            <p
              className="text-center font-sans text-[11px] mt-2"
              style={{ color: 'var(--text-muted)' }}
            >
              Press{' '}
              <kbd
                style={{
                  padding: '1px 5px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 4,
                  fontFamily: 'var(--font-dm-mono)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                Space
              </kbd>
              {' '}or{' '}
              <kbd
                style={{
                  padding: '1px 5px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 4,
                  fontFamily: 'var(--font-dm-mono)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                →
              </kbd>
              {' '}to continue
            </p>
          </div>
        </div>
      )}

      {/* Appeal modal */}
      {appealOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.85)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setAppealOpen(false) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
              width: '100%',
              maxWidth: 420,
            }}
          >
            {appealDone ? (
              <div className="text-center py-4">
                <p className="font-serif text-xl mb-1" style={{ color: 'var(--status-correct)' }}>Flagged</p>
                <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                  We&apos;ll review this question.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
                    Flag this question
                  </h2>
                  <button
                    onClick={() => setAppealOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20 }}
                  >
                    ×
                  </button>
                </div>

                <p className="font-sans text-xs mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Use this if you believe the answer, explanation, or law stated is incorrect.
                  If the problem is with the underlying rule rather than this question, open the
                  source pill below the explanation and dispute it from there instead.
                </p>

                <label className="block mb-4">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    What&apos;s wrong?
                  </span>
                  <select
                    value={appealType}
                    onChange={e => setAppealType(e.target.value as FeedbackType)}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '9px 12px',
                    }}
                  >
                    {QUESTION_FEEDBACK_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block mb-5">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Explain the issue
                  </span>
                  <textarea
                    value={appealText}
                    onChange={e => setAppealText(e.target.value)}
                    placeholder="What do you think is wrong and why?"
                    rows={3}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '9px 12px',
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                </label>

                <div className="flex gap-3">
                  <button
                    onClick={submitAppeal}
                    disabled={appealSubmitting || !appealText.trim()}
                    style={{
                      flex: 1,
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 14,
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: appealSubmitting || !appealText.trim() ? 'not-allowed' : 'pointer',
                      opacity: appealSubmitting || !appealText.trim() ? 0.5 : 1,
                    }}
                  >
                    {appealSubmitting ? 'Submitting…' : 'Submit flag'}
                  </button>
                  <button
                    onClick={() => setAppealOpen(false)}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 14,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--surface-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Knowledge chunk modal — opened from either pill */}
      {chunkModalOpen && result?.chunk && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.85)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setChunkModalOpen(false) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
              width: '100%',
              maxWidth: 480,
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
                Source knowledge chunk
              </h2>
              <button
                onClick={() => setChunkModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20 }}
              >
                ×
              </button>
            </div>

            <p
              className="font-sans text-sm leading-relaxed mb-3"
              style={{ color: 'var(--text-primary)', lineHeight: 1.7 }}
            >
              {result.chunk.rule_text}
            </p>

            {result.chunk.key_terms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {result.chunk.key_terms.slice(0, 8).map(term => (
                  <span
                    key={term}
                    className="font-sans text-[11px] px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(200,146,42,0.08)',
                      border: '1px solid rgba(200,146,42,0.2)',
                      color: 'var(--amber-text)',
                    }}
                  >
                    {term}
                  </span>
                ))}
              </div>
            )}

            <p className="font-sans text-[11px] mb-5" style={{ color: 'var(--text-muted)' }}>
              📍 {result.chunk.source_section}
              {result.chunk.source_page_start && (
                <>
                  {' '}· p.{result.chunk.source_page_start}
                  {result.chunk.source_page_end && result.chunk.source_page_end !== result.chunk.source_page_start
                    ? `–${result.chunk.source_page_end}`
                    : ''}
                  {' '}in your source notes — worth double-checking against the original.
                </>
              )}
            </p>

            {disputeDone ? (
              <div className="text-center py-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
                <p className="font-serif text-lg mb-1" style={{ color: 'var(--status-correct)' }}>Flagged for review</p>
                <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                  The admin will check this knowledge chunk.
                </p>
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: 16 }}>
                <label className="block mb-3">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Think this rule is wrong, outdated, or doesn&apos;t match your notes? Say why and we&apos;ll review it.
                  </span>
                  <textarea
                    value={disputeText}
                    onChange={e => setDisputeText(e.target.value)}
                    placeholder="What's wrong with this rule?"
                    rows={3}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '9px 12px',
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => submitDispute(result.chunk!.id)}
                    disabled={disputeSubmitting || !disputeText.trim()}
                    style={{
                      flex: 1,
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 14,
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: disputeSubmitting || !disputeText.trim() ? 'not-allowed' : 'pointer',
                      opacity: disputeSubmitting || !disputeText.trim() ? 0.5 : 1,
                    }}
                  >
                    {disputeSubmitting ? 'Submitting…' : 'Dispute this chunk'}
                  </button>
                  <button
                    onClick={() => setChunkModalOpen(false)}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 14,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--surface-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
