'use client'

import { useEffect, useState } from 'react'

interface MasteryBarProps {
  score: number // 0–100
  className?: string
}

export default function MasteryBar({ score, className = '' }: MasteryBarProps) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setWidth(score), 50)
    return () => clearTimeout(timer)
  }, [score])

  return (
    <div className={`h-1 bg-surface2 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
