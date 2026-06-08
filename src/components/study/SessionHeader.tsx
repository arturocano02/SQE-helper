'use client'

import ProgressBar from '@/components/ui/ProgressBar'
import Button from '@/components/ui/Button'

interface SessionHeaderProps {
  current: number
  total: number
  onExit: () => void
}

export default function SessionHeader({ current, total, onExit }: SessionHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-10 bg-bg/90 backdrop-blur-sm border-b border-border">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onExit}>
          ✕ Exit
        </Button>
        <ProgressBar current={current} total={total} className="flex-1" />
      </div>
    </header>
  )
}
