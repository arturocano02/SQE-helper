'use client'

import React from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-amber text-base font-medium hover:brightness-110 active:scale-[0.98] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-base',
  secondary:
    'bg-transparent border border-border-active text-amber-text hover:bg-amber-soft active:scale-[0.98] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-base',
  ghost:
    'bg-transparent text-secondary hover:text-primary active:scale-[0.98] ' +
    'focus-visible:outline-none',
  danger:
    'bg-transparent border text-wrong hover:bg-wrong/10 active:scale-[0.98] ' +
    'focus-visible:outline-none',
}

// danger border needs to be set inline because Tailwind can't interpolate CSS vars for border-color in all cases
const variantStyle: Record<Variant, React.CSSProperties> = {
  primary: {},
  secondary: {},
  ghost: {},
  danger: { borderColor: 'rgba(224,90,90,0.3)' },
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[13px] rounded-lg',
  md: 'px-5 py-[11px] text-[14px] rounded-lg',
  lg: 'px-6 py-3.5 text-[15px] rounded-xl',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  style,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      style={{ ...variantStyle[variant], ...style }}
      className={[
        'inline-flex items-center justify-center gap-2 font-sans transition-all duration-150 cursor-pointer',
        'disabled:opacity-35 disabled:cursor-not-allowed disabled:pointer-events-none',
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
