'use client'

import React from 'react'

type Variant = 'primary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-bg font-medium hover:opacity-90 focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
  ghost:   'border border-border text-secondary hover:bg-surface2 hover:text-primary focus:ring-2 focus:ring-border focus:ring-offset-2 focus:ring-offset-bg',
  danger:  'bg-error/15 text-error border border-error/40 hover:bg-error/25 focus:ring-2 focus:ring-error focus:ring-offset-2 focus:ring-offset-bg',
  success: 'bg-success/15 text-success border border-success/40 hover:bg-success/25 focus:ring-2 focus:ring-success focus:ring-offset-2 focus:ring-offset-bg',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2 rounded-lg',
  lg: 'px-6 py-3 text-base rounded-xl',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 transition outline-none cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}
