'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Question, MCQOption } from '@/types/database'
import Badge from '@/components/ui/Badge'
import OptionButton from './OptionButton'
import ExplanationPanel from './ExplanationPanel'

interface AnswerResult {
  was_correct: boolean
  correct_answer: string | null
  explanation: string
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

export default function QuestionCard({
  question, questionNumber, total, topicName, topicPaper, onAnswer, onNext, isLast,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [loading, setLoading] = useState(false)

  const options = (question.options ?? []) as MCQOption[]

  const handleSelect = useCallback(async (label: string) => {
    if (selected || loading) return
    setSelected(label)
    setLoading(true)
    try {
      const res = await onAnswer(label)
      setResult(res)
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
    <div>
      {/* Meta row */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          {topicPaper && <Badge variant={topicPaper}>{topicPaper}</Badge>}
          {topicName && <span className="text-secondary text-xs">{topicName}</span>}
          {question.difficulty && <Badge variant={question.difficulty}>{question.difficulty}</Badge>}
        </div>
        <span className="text-xs text-muted tabular-nums shrink-0">
          {questionNumber} / {total}
        </span>
      </div>

      {/* Question text */}
      <div className="mb-7">
        <p className="font-serif text-[1.3rem] leading-[1.75] text-primary">
          {question.prompt}
        </p>
      </div>

      {/* Options */}
      <div className="space-y-2.5">
        {options.map(opt => (
          <OptionButton
            key={opt.label}
            label={opt.label}
            text={opt.text}
            state={getOptionState(opt.label)}
            onClick={() => handleSelect(opt.label)}
            disabled={!!result || loading}
          />
        ))}
      </div>

      {/* Keyboard hint — before answering */}
      {!result && !selected && (
        <p className="text-center text-xs text-muted mt-4">
          Press <kbd className="px-1.5 py-0.5 bg-surface2 border border-border rounded text-[11px]">A</kbd>–<kbd className="px-1.5 py-0.5 bg-surface2 border border-border rounded text-[11px]">E</kbd> to select
        </p>
      )}

      {/* Explanation */}
      {result && (
        <ExplanationPanel
          wasCorrect={result.was_correct}
          correctAnswer={result.correct_answer}
          explanation={result.explanation}
          onNext={onNext}
          isLast={isLast}
        />
      )}
    </div>
  )
}
