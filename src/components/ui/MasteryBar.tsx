'use client'

import { useEffect, useState } from 'react'

interface MasteryBarProps {
  score: number // 0–100
  className?: string
  showLabel?: boolean
}

export default function MasteryBar({ score, className = '', showLabel = false }: MasteryBarProps) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setWidth(score), 50)
    return () => clearTimeout(timer)
  }, [score])

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex justify-end mb-1">
          <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{score}%</span>
        </div>
      )}
      <div
        className="rounded-full overflow-hidden"
        style={{ height: 6, background: 'var(--surface-3)' }}
      >
        <div
          className="h-full rounded-full progress-fill transition-all duration-700 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
