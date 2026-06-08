'use client'

import type { Topic, UserTopicMastery } from '@/types/database'
import Badge from './Badge'
import MasteryBar from './MasteryBar'
import { masteryLabel } from '@/lib/mastery'

interface TopicCardProps {
  topic: Topic
  mastery?: UserTopicMastery
  selected?: boolean
  onClick?: () => void
  actions?: React.ReactNode
  className?: string
}

function formatLastVisited(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never studied'
  const date = new Date(dateStr)
  const now = new Date()
  const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default function TopicCard({ topic, mastery, selected, onClick, actions, className = '' }: TopicCardProps) {
  const score = mastery?.mastery_score ?? 0

  return (
    <div
      onClick={onClick}
      className={[
        'bg-surface border rounded-lg p-4 transition',
        onClick ? 'cursor-pointer' : '',
        selected
          ? 'bg-accent-dim border-accent'
          : 'border-border hover:bg-surface2',
        className,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className={`font-serif text-lg leading-tight mb-1 ${selected ? 'text-accent' : 'text-primary'}`}>
            {topic.name}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={topic.paper}>{topic.paper}</Badge>
            <span className="text-xs text-muted">{formatLastVisited(mastery?.last_visited_at)}</span>
          </div>
        </div>
        <span className={`text-2xl font-serif font-semibold tabular-nums ${selected ? 'text-accent' : 'text-primary'}`}>
          {score}
        </span>
      </div>

      <MasteryBar score={score} className="mb-1" />
      <p className="text-xs text-secondary">{masteryLabel(score)}</p>

      {actions && (
        <div className="mt-3 pt-3 border-t border-border/50 flex gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
