import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export default function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl p-6 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
