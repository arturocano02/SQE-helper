import React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export default function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-6 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
