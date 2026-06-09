'use client'

import { useEffect, useState } from 'react'

interface ExplanationPanelProps {
  wasCorrect: boolean
  correctAnswer: string | null
  explanation: string
  onNext: () => void
  isLast: boolean
}

export default function ExplanationPanel({
  wasCorrect, correctAnswer, explanation, onNext, isLast
}: ExplanationPanelProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={[
      'transition-all duration-300 ease-out mt-6',
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
    ].join(' ')}>

      {/* Verdict banner */}
      <div className={[
        'flex items-center gap-3 px-4 py-3 rounded-xl mb-4',
        wasCorrect ? 'bg-success/10 border border-success/25' : 'bg-error/10 border border-error/25',
      ].join(' ')}>
        <span className={[
          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold',
          wasCorrect ? 'bg-success text-bg' : 'bg-error text-bg',
        ].join(' ')}>
          {wasCorrect ? '✓' : '✗'}
        </span>
        <div className="flex-1">
          <p className={`font-medium text-sm ${wasCorrect ? 'text-success' : 'text-error'}`}>
            {wasCorrect ? 'Correct' : 'Incorrect'}
          </p>
          {!wasCorrect && correctAnswer && (
            <p className="text-secondary text-xs mt-0.5">
              The correct answer was <strong className="text-primary">{correctAnswer}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-4">
          <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-3">Explanation</p>
          <p className="text-sm text-primary leading-relaxed whitespace-pre-line">{explanation}</p>
        </div>
      )}

      {/* Next button */}
      <button
        onClick={onNext}
        className="w-full flex items-center justify-center gap-2 bg-accent text-bg font-medium py-3.5 rounded-xl hover:opacity-90 active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
      >
        {isLast ? 'See Results' : 'Next Question'}
        <span className="text-bg/70 text-xs">→</span>
      </button>

      <p className="text-center text-xs text-muted mt-2">
        Press <kbd className="px-1.5 py-0.5 bg-surface2 border border-border rounded text-xs">Space</kbd> or <kbd className="px-1.5 py-0.5 bg-surface2 border border-border rounded text-xs">→</kbd> to continue
      </p>
    </div>
  )
}
