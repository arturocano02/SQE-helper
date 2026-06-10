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
    <div
      className={[
        'transition-all duration-300 ease-out mt-6',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3',
      ].join(' ')}
    >
      {/* Verdict banner */}
      <div
        style={{
          background: wasCorrect ? 'rgba(76,175,130,0.10)' : 'rgba(224,90,90,0.10)',
          border: `1px solid ${wasCorrect ? 'rgba(76,175,130,0.30)' : 'rgba(224,90,90,0.30)'}`,
          borderRadius: 10,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: wasCorrect ? 'var(--status-correct)' : 'var(--status-wrong)',
            color: '#0A0A08',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {wasCorrect ? '✓' : '✗'}
        </span>
        <div className="flex-1">
          <p
            className="font-sans font-medium text-sm"
            style={{ color: wasCorrect ? 'var(--status-correct)' : 'var(--status-wrong)' }}
          >
            {wasCorrect ? 'Correct' : 'Incorrect'}
          </p>
          {!wasCorrect && correctAnswer && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Correct answer:{' '}
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-dm-mono)' }}>
                {correctAnswer}
              </strong>
            </p>
          )}
        </div>
      </div>

      {/* Explanation */}
      {explanation && (
        <div
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-border)',
            borderRadius: 10,
            padding: '18px 20px',
            marginBottom: 16,
          }}
        >
          <p
            className="text-[10px] font-sans font-medium uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Explanation
          </p>
          <p
            className="text-sm leading-relaxed whitespace-pre-line"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-dm-sans)' }}
          >
            {explanation}
          </p>
        </div>
      )}

      {/* Next button */}
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
          fontWeight: 500,
          fontSize: 14,
          padding: '14px 24px',
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          transition: 'all 150ms ease',
        }}
        className="hover:brightness-110 active:scale-[0.98]"
      >
        {isLast ? 'See Results' : 'Next Question'}
        <span style={{ opacity: 0.6, fontSize: 16 }}>→</span>
      </button>

      <p
        className="text-center text-[11px] mt-2"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-dm-sans)' }}
      >
        Press{' '}
        <kbd
          style={{
            padding: '2px 6px',
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
            padding: '2px 6px',
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
  )
}
