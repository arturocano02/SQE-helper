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
  /** Total approved questions available in this topic. */
  questionCount?: number
  /** How many distinct questions in this topic the user has answered at least once. */
  answeredCount?: number
}

function formatLastVisited(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never studied'
  const date = new Date(dateStr)
  const now = new Date()
  const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function getMasteryBorderColor(score: number, hasMastery: boolean): string {
  if (!hasMastery) return 'var(--status-neutral)'
  if (score >= 70) return 'var(--status-correct)'
  if (score >= 40) return 'var(--status-warning)'
  return 'var(--status-wrong)'
}

function getMasteryPillClass(score: number, hasMastery: boolean): string {
  if (!hasMastery) return 'pill-none'
  if (score >= 70) return 'pill-correct'
  if (score >= 40) return 'pill-warn'
  return 'pill-wrong'
}

export default function TopicCard({ topic, mastery, selected, onClick, actions, className = '', questionCount, answeredCount }: TopicCardProps) {
  const score = mastery?.mastery_score ?? 0
  const hasMastery = !!mastery
  const borderColor = getMasteryBorderColor(score, hasMastery)
  const isInteractive = !!onClick

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? 'var(--amber-soft)' : 'var(--surface-1)',
        borderLeft: `3px solid ${selected ? 'var(--amber)' : borderColor}`,
        borderTop: `1px solid ${selected ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
        borderRight: `1px solid ${selected ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
        borderBottom: `1px solid ${selected ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
        borderRadius: 12,
        padding: '16px 20px',
        transition: 'all 150ms ease',
      }}
      className={[
        'card-glow',
        isInteractive ? 'cursor-pointer card-glow-hover' : '',
        className,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p
            className="font-serif text-lg leading-tight mb-1.5"
            style={{ color: selected ? 'var(--amber-text)' : 'var(--text-primary)' }}
          >
            {topic.name}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={topic.paper}>{topic.paper}</Badge>
            <span
              className="text-[11px] font-mono"
              style={{ color: 'var(--text-muted)' }}
            >
              {formatLastVisited(mastery?.last_visited_at)}
            </span>
          </div>
        </div>

        {/* Mastery pill */}
        <span
          className={`${getMasteryPillClass(score, hasMastery)} text-[11px] font-sans font-medium px-2.5 py-0.5 rounded-full shrink-0 font-mono tabular-nums`}
        >
          {score}
        </span>
      </div>

      <MasteryBar score={score} className="mb-1.5" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-sans" style={{ color: 'var(--text-secondary)' }}>
          {masteryLabel(score)}
        </p>
        {typeof questionCount === 'number' && (
          <p className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
            {answeredCount ?? 0}/{questionCount} answered
          </p>
        )}
      </div>

      {actions && (
        <div
          className="mt-3 pt-3 flex gap-2"
          style={{ borderTop: '1px solid var(--surface-border)' }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
