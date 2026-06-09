import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  interactive?: boolean
}

export default function Card({ children, className = '', interactive = false, ...props }: CardProps) {
  return (
    <div
      style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)' }}
      className={[
        'rounded-xl p-5 shadow-card transition-all duration-150',
        interactive
          ? 'cursor-pointer hover:-translate-y-px'
          : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}
