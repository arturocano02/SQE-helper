'use client'

interface OptionButtonProps {
  label: string
  text: string
  state: 'idle' | 'selected' | 'correct' | 'incorrect' | 'reveal-correct'
  onClick: () => void
  disabled?: boolean
}

type StateStyle = {
  border: string
  bg: string
  labelBg: string
  labelText: string
  textColor: string
  icon?: string
}

const stateStyles: Record<OptionButtonProps['state'], StateStyle> = {
  idle: {
    border: '1px solid var(--surface-border)',
    bg: 'var(--surface-1)',
    labelBg: 'var(--surface-3)',
    labelText: 'var(--text-secondary)',
    textColor: 'var(--text-primary)',
  },
  selected: {
    border: '1px solid rgba(200,146,42,0.5)',
    bg: 'var(--amber-soft)',
    labelBg: 'var(--amber)',
    labelText: '#0A0A08',
    textColor: 'var(--amber-text)',
  },
  correct: {
    border: '1px solid var(--status-correct)',
    bg: 'rgba(76,175,130,0.10)',
    labelBg: 'var(--status-correct)',
    labelText: '#0A0A08',
    textColor: '#6ECFA3',
    icon: '✓',
  },
  incorrect: {
    border: '1px solid var(--status-wrong)',
    bg: 'rgba(224,90,90,0.10)',
    labelBg: 'var(--status-wrong)',
    labelText: '#0A0A08',
    textColor: '#E87878',
    icon: '✗',
  },
  'reveal-correct': {
    border: '1px solid rgba(76,175,130,0.4)',
    bg: 'rgba(76,175,130,0.06)',
    labelBg: 'rgba(76,175,130,0.25)',
    labelText: 'var(--status-correct)',
    textColor: '#6ECFA3',
    icon: '✓',
  },
}

export default function OptionButton({ label, text, state, onClick, disabled }: OptionButtonProps) {
  const s = stateStyles[state]
  const isAnswered = state !== 'idle' && state !== 'selected'
  const isIdle = state === 'idle'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: s.border,
        background: s.bg,
        borderRadius: 10,
        transition: 'all 150ms ease',
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
        textAlign: 'left',
        minHeight: 52,
        cursor: disabled ? 'default' : 'pointer',
      }}
      className={[
        'group',
        'focus:outline-none',
        isIdle && !disabled ? 'hover:border-[rgba(200,146,42,0.3)] hover:bg-[var(--surface-2)]' : '',
      ].join(' ')}
    >
      {/* Letter badge */}
      <div
        style={{
          flexShrink: 0,
          width: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '10px 0 0 10px',
          background: s.labelBg,
          color: s.labelText,
          fontFamily: 'var(--font-dm-mono)',
          fontSize: 13,
          fontWeight: 600,
          transition: 'all 150ms ease',
        }}
      >
        {isAnswered && s.icon ? s.icon : label}
      </div>

      {/* Text */}
      <div
        style={{
          flex: 1,
          padding: '14px 16px',
          fontSize: 14,
          lineHeight: 1.6,
          color: s.textColor,
          fontFamily: 'var(--font-dm-sans)',
          transition: 'color 150ms ease',
        }}
      >
        {text}
      </div>
    </button>
  )
}
