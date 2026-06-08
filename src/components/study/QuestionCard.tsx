'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Question, MCQOption } from '@/types/database'
import Badge from '@/components/ui/Badge'
import OptionButton from './OptionButton'
import ExplanationPanel from './ExplanationPanel'

interface AnswerResult {
  was_correct: boolean
  explanation: string
}

interface QuestionCardProps {
  question: Question
  questionNumber: number
  topicName?: string
  topicPaper?: 'FLK1' | 'FLK2'
  onAnswer: (selectedAnswer: string) => Promise<AnswerResult>
  onNext: () => void
  isLast: boolean
}

export default function QuestionCard({
  question,
  questionNumber,
  topicName,
  topicPaper,
  onAnswer,
  onNext,
  isLast,
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (result) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault()
          onNext()
        }
        return
      }
      const keyMap: Record<string, string> = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }
      const label = keyMap[e.key.toLowerCase()]
      if (label) handleSelect(label)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [result, handleSelect, onNext])

  type OptionState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'reveal-correct'
  const getOptionState = (label: string): OptionState => {
    if (!result) {
      return selected === label ? 'selected' : 'idle'
    }
    if (label === question.correct_answer) return 'correct'
    if (label === selected && !result.was_correct) return 'incorrect'
    return 'idle'
  }

  return (
    <div>
      {/* Topic badge */}
      {topicName && (
        <div className="flex items-center gap-2 mb-4">
          {topicPaper && <Badge variant={topicPaper}>{topicPaper}</Badge>}
          <span className="text-sm text-secondary">{topicName}</span>
          {question.difficulty && <Badge variant={question.difficulty}>{question.difficulty}</Badge>}
        </div>
      )}

      {/* Question */}
      <h2 className="font-serif text-2xl leading-relaxed text-primary mb-6">
        {questionNumber}. {question.prompt}
      </h2>

      {/* Options */}
      <div className="space-y-2">
        {options.map((opt) => (
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

      {/* Explanation */}
      {result && (
        <ExplanationPanel
          wasCorrect={result.was_correct}
          explanation={result.explanation ?? ''}
          onNext={onNext}
          isLast={isLast}
        />
      )}
    </div>
  )
}

