'use client'

interface OptionButtonProps {
  label: string
  text: string
  state: 'idle' | 'selected' | 'correct' | 'incorrect' | 'reveal-correct'
  onClick: () => void
  disabled?: boolean
}

const stateClasses: Record<OptionButtonProps['state'], string> = {
  idle:           'border-border bg-surface2 text-primary hover:bg-surface hover:border-secondary',
  selected:       'border-accent bg-accent-dim text-accent',
  correct:        'border-success bg-success/10 text-success',
  incorrect:      'border-error bg-error/10 text-error',
  'reveal-correct':'border-success/50 bg-success/5 text-success/80',
}

export default function OptionButton({ label, text, state, onClick, disabled }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'w-full text-left flex items-start gap-3 px-4 py-3 rounded border transition',
        'disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
        stateClasses[state],
      ].join(' ')}
    >
      <span className="font-serif font-semibold text-base w-5 shrink-0">{label}</span>
      <span className="text-sm leading-relaxed">{text}</span>
    </button>
  )
}
