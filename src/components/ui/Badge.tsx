import React from 'react'
import type { Paper, Difficulty } from '@/types/database'

type BadgeVariant = Paper | Difficulty | 'default' | 'admin'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

// Each badge is a subtle pill with a tinted left-border treatment
const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  FLK1:    { background: 'rgba(200,146,42,0.12)', borderLeft: '3px solid var(--amber)', color: 'var(--amber-text)' },
  FLK2:    { background: 'rgba(154,149,144,0.10)', borderLeft: '3px solid var(--text-secondary)', color: 'var(--text-secondary)' },
  easy:    { background: 'rgba(76,175,130,0.12)', borderLeft: '3px solid var(--status-correct)', color: '#6ECFA3' },
  medium:  { background: 'rgba(200,146,42,0.12)', borderLeft: '3px solid var(--amber)', color: 'var(--amber-text)' },
  hard:    { background: 'rgba(224,90,90,0.12)', borderLeft: '3px solid var(--status-wrong)', color: '#E87878' },
  default: { background: 'var(--surface-3)', borderLeft: '3px solid var(--status-neutral)', color: 'var(--text-muted)' },
  admin:   { background: 'rgba(200,146,42,0.15)', borderLeft: '3px solid var(--amber)', color: 'var(--amber-text)' },
}

export default function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      style={variantStyles[variant]}
      className={`inline-flex items-center px-2 py-0.5 rounded-full font-sans text-[11px] font-medium tracking-wide ${className}`}
    >
      {children}
    </span>
  )
}
