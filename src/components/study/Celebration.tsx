'use client'

import { useEffect, useState } from 'react'

/**
 * Lightweight, dependency-free confetti burst. Pure CSS animation — a fixed
 * number of coloured pieces fall from the top of the viewport, then unmount.
 * Purely decorative: it never blocks clicks (pointer-events: none) and never
 * affects layout (position: fixed).
 */
const COLORS = ['var(--amber)', 'var(--status-correct)', 'var(--status-warning)', '#EEE9DF']

export default function Celebration({ show, pieces = 60 }: { show: boolean; pieces?: number }) {
  const [active, setActive] = useState(show)

  useEffect(() => {
    if (!show) return
    setActive(true)
    const t = setTimeout(() => setActive(false), 2600)
    return () => clearTimeout(t)
  }, [show])

  if (!active) return null

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 60,
      }}
    >
      {Array.from({ length: pieces }).map((_, i) => {
        const left = Math.random() * 100
        const delay = Math.random() * 0.4
        const duration = 1.8 + Math.random() * 1.2
        const size = 6 + Math.random() * 6
        const color = COLORS[i % COLORS.length]
        const rotateStart = Math.random() * 360
        const drift = (Math.random() - 0.5) * 80

        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              top: -20,
              left: `${left}%`,
              width: size,
              height: size * 0.4,
              background: color,
              opacity: 0.9,
              borderRadius: 2,
              transform: `rotate(${rotateStart}deg)`,
              animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
              '--drift': `${drift}px`,
            } as React.CSSProperties}
          />
        )
      })}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(105vh) translateX(var(--drift)) rotate(540deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
