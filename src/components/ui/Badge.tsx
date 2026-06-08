import React from 'react'
import type { Paper, Difficulty } from '@/types/database'

type BadgeVariant = Paper | Difficulty | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  FLK1:   'border border-accent/50 text-accent text-xs',
  FLK2:   'border border-secondary/50 text-secondary text-xs',
  easy:   'border border-success/40 text-success text-xs',
  medium: 'border border-warning/40 text-warning text-xs',
  hard:   'border border-error/40 text-error text-xs',
  default:'border border-border text-secondary text-xs',
}

export default function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded font-sans ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
