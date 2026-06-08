'use client'

import { useEffect, useState } from 'react'

interface ExplanationPanelProps {
  wasCorrect: boolean
  explanation: string
  onNext: () => void
  isLast: boolean
}

export default function ExplanationPanel({ wasCorrect, explanation, onNext, isLast }: ExplanationPanelProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={[
        'transition-all duration-300 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
      ].join(' ')}
    >
      <div className="mt-6 p-5 rounded-lg border bg-surface border-border">
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`text-sm font-medium px-2.5 py-0.5 rounded ${
              wasCorrect
                ? 'bg-success/15 text-success'
                : 'bg-error/15 text-error'
            }`}
          >
            {wasCorrect ? '✓ Correct' : '✗ Incorrect'}
          </span>
        </div>
        <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">{explanation}</p>
      </div>

      <button
        onClick={onNext}
        className="mt-4 w-full bg-accent text-bg font-medium py-3 rounded hover:opacity-90 transition focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
      >
        {isLast ? 'See Results →' : 'Next Question →'}
      </button>
    </div>
  )
}
