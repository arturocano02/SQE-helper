'use client'

import { useState, useEffect } from 'react'
import type { Question, Topic, MCQOption, QuestionStatus } from '@/types/database'
import Button from '@/components/ui/Button'

interface QuestionEditPanelProps {
  question: Question
  topics: Topic[]
  onSave: (updated: Question) => void
  onClose: () => void
}

export default function QuestionEditPanel({ question, topics, onSave, onClose }: QuestionEditPanelProps) {
  const [form, setForm] = useState<Question>(question)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)

  useEffect(() => {
    setForm(question)
  }, [question.id])

  // Keyboard: A = approve
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        handleApprove()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [form])

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/admin/questions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const updated = await res.json()
    setSaving(false)
    onSave(updated)
  }

  async function handleApprove() {
    setApproving(true)
    const updated = { ...form, status: 'approved' as QuestionStatus, version: (form.version ?? 1) + 1 }
    const res = await fetch('/api/admin/questions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    const saved = await res.json()
    setApproving(false)
    onSave(saved)
  }

  async function handleArchive() {
    const updated = { ...form, status: 'archived' as QuestionStatus }
    const res = await fetch('/api/admin/questions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
    const saved = await res.json()
    onSave(saved)
  }

  function updateOption(idx: number, text: string) {
    const opts = [...(form.options ?? [])] as MCQOption[]
    opts[idx] = { ...opts[idx], text }
    setForm(f => ({ ...f, options: opts }))
  }

  const options = (form.options ?? []) as MCQOption[]

  const selectStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-2)',
    border: '1px solid var(--surface-border)',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'var(--font-dm-sans)',
    outline: 'none',
  }

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface-2)',
    border: '1px solid var(--surface-border)',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'var(--font-dm-sans)',
    outline: 'none',
    resize: 'none' as const,
    lineHeight: 1.6,
  }

  const statusTextColor: Record<QuestionStatus, string> = {
    draft: 'var(--status-warning)',
    approved: 'var(--status-correct)',
    archived: 'var(--text-muted)',
  }

  return (
    <div
      style={{
        width: 384,
        flexShrink: 0,
        background: 'var(--surface-1)',
        border: '1px solid var(--surface-border)',
        borderRadius: 14,
        padding: 20,
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
      }}
      className="card-glow"
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>Edit Question</h3>
        <button
          onClick={onClose}
          className="font-sans text-sm transition"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        {/* Topic */}
        <div>
          <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            Topic
          </label>
          <select
            value={form.topic_id ?? ''}
            onChange={e => setForm(f => ({ ...f, topic_id: e.target.value || null }))}
            style={selectStyle}
          >
            <option value="">— Select topic —</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Type + Difficulty */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as Question['type'] }))}
              style={selectStyle}
            >
              <option value="mcq">MCQ</option>
              <option value="flashcard">Flashcard</option>
            </select>
          </div>
          <div>
            <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Difficulty</label>
            <select
              value={form.difficulty ?? ''}
              onChange={e => setForm(f => ({ ...f, difficulty: (e.target.value || null) as Question['difficulty'] }))}
              style={selectStyle}
            >
              <option value="">— Select —</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Prompt</label>
          <textarea
            value={form.prompt}
            onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
            rows={4}
            style={textareaStyle}
          />
        </div>

        {/* Options (MCQ only) */}
        {form.type === 'mcq' && options.length > 0 && (
          <div>
            <label className="block font-sans text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Options</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={opt.label} className="flex items-start gap-2">
                  <span
                    className="font-mono text-xs mt-2 shrink-0"
                    style={{ width: 16, color: 'var(--text-secondary)' }}
                  >
                    {opt.label}
                  </span>
                  <input
                    value={opt.text}
                    onChange={e => updateOption(i, e.target.value)}
                    className="flex-1"
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--surface-border)',
                      color: 'var(--text-primary)',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: 'var(--font-dm-sans)',
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-3">
              <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Correct Answer
              </label>
              <select
                value={form.correct_answer ?? ''}
                onChange={e => setForm(f => ({ ...f, correct_answer: e.target.value || null }))}
                style={{ ...selectStyle, width: 'auto' }}
              >
                <option value="">— Select —</option>
                {['A', 'B', 'C', 'D', 'E'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Explanation */}
        <div>
          <label className="block font-sans text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Explanation</label>
          <textarea
            value={form.explanation ?? ''}
            onChange={e => setForm(f => ({ ...f, explanation: e.target.value }))}
            rows={6}
            style={textareaStyle}
          />
        </div>

        {/* Status display */}
        <div className="flex items-center gap-2">
          <span className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>Status:</span>
          <span
            className="font-sans text-xs capitalize"
            style={{ color: statusTextColor[form.status] }}
          >
            {form.status}
          </span>
        </div>

        {/* Actions */}
        <div
          className="flex flex-col gap-2 pt-3"
          style={{ borderTop: '1px solid var(--surface-border)' }}
        >
          {form.status !== 'approved' && (
            <Button onClick={handleApprove} loading={approving} className="w-full justify-center">
              Approve{' '}
              <span style={{ opacity: 0.5, fontSize: 11 }}>(A)</span>
            </Button>
          )}
          <Button variant="ghost" onClick={handleSave} loading={saving} className="w-full justify-center">
            Save Draft
          </Button>
          {form.status !== 'archived' && (
            <Button variant="danger" onClick={handleArchive} className="w-full justify-center" size="sm">
              Archive
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
