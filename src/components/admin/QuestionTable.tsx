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

  function handleSave(updated: Question) {
    setQuestions(qs => qs.map(q => q.id === updated.id ? updated : q))
    setEditingId(null)
  }

  // Keyboard shortcut — A to approve, Escape to close edit panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingQuestion && e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        // Approve from panel
      }
      if (e.key === 'Escape') setEditingId(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingQuestion])

  const statusColors: Record<QuestionStatus, string> = {
    draft:    'text-warning',
    approved: 'text-success',
    archived: 'text-muted',
  }

  return (
    <div className="flex gap-6">
      {/* Table */}
      <div className="flex-1 min-w-0">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Status */}
          {(['all', 'draft', 'approved', 'archived'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded text-xs border transition capitalize ${statusFilter === s ? 'bg-accent text-bg border-accent' : 'border-border text-secondary hover:bg-surface2'}`}>
              {s}
            </button>
          ))}
          <div className="w-px bg-border" />
          {(['all', 'mcq', 'flashcard'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded text-xs border transition capitalize ${typeFilter === t ? 'bg-accent text-bg border-accent' : 'border-border text-secondary hover:bg-surface2'}`}>
              {t === 'all' ? 'All types' : t}
            </button>
          ))}
          <div className="w-px bg-border" />
          {(['all', 'easy', 'medium', 'hard'] as const).map(d => (
            <button key={d} onClick={() => setDiffFilter(d)}
              className={`px-3 py-1 rounded text-xs border transition capitalize ${diffFilter === d ? 'bg-accent text-bg border-accent' : 'border-border text-secondary hover:bg-surface2'}`}>
              {d === 'all' ? 'Any difficulty' : d}
            </button>
          ))}
        </div>

        {/* Topic filter */}
        <select
          value={topicFilter}
          onChange={e => setTopicFilter(e.target.value)}
          className="mb-4 bg-surface2 border border-border text-primary px-3 py-1.5 rounded text-sm focus:border-accent focus:outline-none"
        >
          <option value="all">All topics</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 mb-3 p-3 bg-accent-dim border border-accent/30 rounded">
            <span className="text-sm text-accent">{selected.size} selected</span>
            <Button size="sm" onClick={bulkApprove} loading={bulkLoading}>
              Approve selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="accent-accent"
                  />
                </th>
                <th className="p-3 text-left text-secondary font-normal">Topic</th>
                <th className="p-3 text-left text-secondary font-normal">Type</th>
                <th className="p-3 text-left text-secondary font-normal">Difficulty</th>
                <th className="p-3 text-left text-secondary font-normal">Prompt</th>
                <th className="p-3 text-left text-secondary font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => {
                const topic = q.topic_id ? topicMap.get(q.topic_id) : null
                return (
                  <tr
                    key={q.id}
                    onClick={() => setEditingId(q.id)}
                    className={`border-b border-border/50 cursor-pointer hover:bg-surface2 transition ${editingId === q.id ? 'bg-surface2' : ''}`}
                  >
                    <td className="p-3" onClick={e => { e.stopPropagation(); toggleSelect(q.id) }}>
                      <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleSelect(q.id)} className="accent-accent" />
                    </td>
                    <td className="p-3 text-secondary text-xs">{topic?.name ?? '—'}</td>
                    <td className="p-3"><Badge>{q.type}</Badge></td>
                    <td className="p-3">{q.difficulty ? <Badge variant={q.difficulty}>{q.difficulty}</Badge> : '—'}</td>
                    <td className="p-3 text-primary max-w-xs truncate">{q.prompt.slice(0, 60)}…</td>
                    <td className={`p-3 capitalize text-xs ${statusColors[q.status]}`}>{q.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-secondary text-sm text-center py-12">No questions match your filters.</p>
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
