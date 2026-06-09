'use client'

interface OptionButtonProps {
  label: string
  text: string
  state: 'idle' | 'selected' | 'correct' | 'incorrect' | 'reveal-correct'
  onClick: () => void
  disabled?: boolean
}

const stateConfig: Record<OptionButtonProps['state'], {
  border: string; bg: string; labelBg: string; labelText: string; textColor: string; icon?: string
}> = {
  idle: {
    border: 'border-border hover:border-secondary/60',
    bg: 'bg-surface hover:bg-surface2',
    labelBg: 'bg-surface2 group-hover:bg-border',
    labelText: 'text-secondary',
    textColor: 'text-primary',
  },
  selected: {
    border: 'border-accent',
    bg: 'bg-accent-dim',
    labelBg: 'bg-accent',
    labelText: 'text-bg',
    textColor: 'text-accent',
  },
  correct: {
    border: 'border-success',
    bg: 'bg-success/10',
    labelBg: 'bg-success',
    labelText: 'text-bg',
    textColor: 'text-success',
    icon: '✓',
  },
  incorrect: {
    border: 'border-error',
    bg: 'bg-error/10',
    labelBg: 'bg-error',
    labelText: 'text-bg',
    textColor: 'text-error',
    icon: '✗',
  },
  'reveal-correct': {
    border: 'border-success/50',
    bg: 'bg-success/5',
    labelBg: 'bg-success/30',
    labelText: 'text-success',
    textColor: 'text-success/80',
    icon: '✓',
  },
}

export default function OptionButton({ label, text, state, onClick, disabled }: OptionButtonProps) {
  const cfg = stateConfig[state]
  const isAnswered = state !== 'idle' && state !== 'selected'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'group w-full text-left flex items-start gap-0 rounded-xl border-2 transition-all duration-150',
        'disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-bg',
        cfg.border, cfg.bg,
        !disabled && state === 'idle' ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      {/* Letter label */}
      <div className={[
        'flex-shrink-0 w-11 self-stretch flex items-center justify-center rounded-l-xl transition-all duration-150 text-sm font-semibold',
        cfg.labelBg, cfg.labelText,
      ].join(' ')}>
        {isAnswered && cfg.icon ? cfg.icon : label}
      </div>

      {/* Text */}
      <div className={`flex-1 px-4 py-3.5 text-sm leading-relaxed ${cfg.textColor}`}>
        {text}
      </div>
    </button>
  )
}
