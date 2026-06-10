'use client'

import { useState, useCallback, useEffect } from 'react'
import type { Question, Topic, QuestionStatus, Difficulty, QuestionType } from '@/types/database'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import QuestionEditPanel from './QuestionEditPanel'

interface QuestionTableProps {
  questions: Question[]
  topics: Topic[]
}

export default function QuestionTable({ questions: initialQuestions, topics }: QuestionTableProps) {
  const [questions, setQuestions] = useState(initialQuestions)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<QuestionType | 'all'>('all')
  const [diffFilter, setDiffFilter] = useState<Difficulty | 'all'>('all')
  const [topicFilter, setTopicFilter] = useState<string>('all')
  const [bulkLoading, setBulkLoading] = useState(false)

  const topicMap = new Map(topics.map(t => [t.id, t]))

  const filtered = questions.filter(q => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false
    if (typeFilter !== 'all' && q.type !== typeFilter) return false
    if (diffFilter !== 'all' && q.difficulty !== diffFilter) return false
    if (topicFilter !== 'all' && q.topic_id !== topicFilter) return false
    return true
  })

  const editingQuestion = editingId ? questions.find(q => q.id === editingId) ?? null : null

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(q => q.id)))
    }
  }

  async function bulkApprove() {
    if (selected.size === 0) return
    setBulkLoading(true)
    await fetch('/api/admin/questions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected), status: 'approved' }),
    })
    setQuestions(qs =>
      qs.map(q => selected.has(q.id) ? { ...q, status: 'approved' as QuestionStatus } : q)
    )
    setSelected(new Set())
    setBulkLoading(false)
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Permanently delete ${selected.size} question${selected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkLoading(true)
    await fetch('/api/admin/questions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected) }),
    })
    setQuestions(qs => qs.filter(q => !selected.has(q.id)))
    setSelected(new Set())
    setBulkLoading(false)
  }

  function handleSave(updated: Question) {
    setQuestions(qs => qs.map(q => q.id === updated.id ? updated : q))
    setEditingId(null)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingId(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingQuestion])

  const filterChipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'var(--font-dm-sans)',
    border: active ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
    background: active ? 'var(--amber-soft)' : 'transparent',
    color: active ? 'var(--amber-text)' : 'var(--text-secondary)',
    cursor: 'pointer',
    textTransform: 'capitalize' as const,
    transition: 'all 150ms ease',
  })

  const statusTextColor: Record<QuestionStatus, string> = {
    draft: 'var(--status-warning)',
    approved: 'var(--status-correct)',
    archived: 'var(--text-muted)',
  }

  return (
    <div className="flex gap-6">
      {/* Table */}
      <div className="flex-1 min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', 'draft', 'approved', 'archived'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={filterChipStyle(statusFilter === s)}>
              {s}
            </button>
          ))}
          <div style={{ width: 1, background: 'var(--surface-border)', margin: '0 4px' }} />
          {(['all', 'mcq', 'flashcard'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} style={filterChipStyle(typeFilter === t)}>
              {t === 'all' ? 'All types' : t}
            </button>
          ))}
          <div style={{ width: 1, background: 'var(--surface-border)', margin: '0 4px' }} />
          {(['all', 'easy', 'medium', 'hard'] as const).map(d => (
            <button key={d} onClick={() => setDiffFilter(d)} style={filterChipStyle(diffFilter === d)}>
              {d === 'all' ? 'Any difficulty' : d}
            </button>
          ))}
        </div>

        {/* Topic filter */}
        <select
          value={topicFilter}
          onChange={e => setTopicFilter(e.target.value)}
          className="mb-4 text-sm focus:outline-none"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--surface-border)',
            color: 'var(--text-primary)',
            padding: '6px 12px',
            borderRadius: 8,
            fontFamily: 'var(--font-dm-sans)',
          }}
        >
          <option value="all">All topics</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div
            className="flex items-center gap-3 mb-3 p-3 rounded-xl"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
            }}
          >
            <span className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" onClick={bulkApprove} loading={bulkLoading}>
                Approve selected
              </Button>
              <Button size="sm" variant="danger" onClick={bulkDelete} loading={bulkLoading}>
                Delete selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
          className="card-glow"
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                <th className="p-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    style={{ accentColor: 'var(--amber)' }}
                  />
                </th>
                {['Topic', 'Type', 'Difficulty', 'Prompt', 'Status'].map(h => (
                  <th
                    key={h}
                    className="p-3 text-left font-normal font-sans text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => {
                const topic = q.topic_id ? topicMap.get(q.topic_id) : null
                const isEditing = editingId === q.id
                return (
                  <tr
                    key={q.id}
                    onClick={() => setEditingId(q.id)}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: isEditing ? 'var(--surface-2)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 120ms ease',
                    }}
                    className="hover:bg-[var(--surface-2)]"
                  >
                    <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(q.id) }}>
                      <input
                        type="checkbox"
                        checked={selected.has(q.id)}
                        onChange={() => toggleSelect(q.id)}
                        style={{ accentColor: 'var(--amber)' }}
                      />
                    </td>
                    <td className="p-3 font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {topic?.name ?? '—'}
                    </td>
                    <td className="p-3"><Badge>{q.type}</Badge></td>
                    <td className="p-3">
                      {q.difficulty ? <Badge variant={q.difficulty}>{q.difficulty}</Badge> : '—'}
                    </td>
                    <td
                      className="p-3 font-sans max-w-xs truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {q.prompt.slice(0, 60)}…
                    </td>
                    <td
                      className="p-3 font-sans capitalize text-xs"
                      style={{ color: statusTextColor[q.status] }}
                    >
                      {q.status}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p
              className="font-sans text-sm text-center py-12"
              style={{ color: 'var(--text-secondary)' }}
            >
              No questions match your filters.
            </p>
          )}
        </div>
      </div>

      {/* Edit panel */}
      {editingQuestion && (
        <QuestionEditPanel
          question={editingQuestion}
          topics={topics}
          onSave={handleSave}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}
