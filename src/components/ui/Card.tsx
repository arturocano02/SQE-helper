import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  interactive?: boolean
  variant?: 'default' | 'elevated' | 'amber'
}

export default function Card({
  children,
  className = '',
  interactive = false,
  variant = 'default',
  style,
  ...props
}: CardProps) {
  const bg =
    variant === 'elevated' ? 'var(--surface-2)' :
    variant === 'amber'    ? 'var(--amber-soft)' :
    'var(--surface-1)'

  const borderColor =
    variant === 'amber' ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: '20px 24px',
        transition: 'all 150ms ease',
        ...style,
      }}
      className={[
        'card-glow',
        interactive ? 'cursor-pointer card-glow-hover' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}
