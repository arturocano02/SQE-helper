'use client'

import { useState, useEffect } from 'react'
import type { Question, Topic, MCQOption, QuestionStatus } from '@/types/database'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'

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

  return (
    <div className="w-96 shrink-0 bg-surface border border-border rounded-xl p-5 max-h-[calc(100vh-120px)] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-lg text-primary">Edit Question</h3>
        <button onClick={onClose} className="text-secondary hover:text-primary transition text-sm">✕</button>
      </div>

      <div className="space-y-4">
        {/* Topic */}
        <div>
          <label className="block text-xs text-secondary mb-1">Topic</label>
          <select
            value={form.topic_id ?? ''}
            onChange={e => setForm(f => ({ ...f, topic_id: e.target.value || null }))}
            className="w-full bg-surface2 border border-border text-primary px-3 py-2 rounded-lg text-sm focus:border-accent focus:outline-none"
          >
            <option value="">— Select topic —</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Type + Difficulty */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-secondary mb-1">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as Question['type'] }))}
              className="w-full bg-surface2 border border-border text-primary px-3 py-2 rounded-lg text-sm focus:border-accent focus:outline-none"
            >
              <option value="mcq">MCQ</option>
              <option value="flashcard">Flashcard</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Difficulty</label>
            <select
              value={form.difficulty ?? ''}
              onChange={e => setForm(f => ({ ...f, difficulty: (e.target.value || null) as Question['difficulty'] }))}
              className="w-full bg-surface2 border border-border text-primary px-3 py-2 rounded-lg text-sm focus:border-accent focus:outline-none"
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
          <label className="block text-xs text-secondary mb-1">Prompt</label>
          <textarea
            value={form.prompt}
            onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
            rows={4}
            className="w-full bg-surface2 border border-border text-primary px-3 py-2 rounded-lg text-sm focus:border-accent focus:outline-none resize-none"
          />
        </div>

        {/* Options (MCQ only) */}
        {form.type === 'mcq' && options.length > 0 && (
          <div>
            <label className="block text-xs text-secondary mb-2">Options</label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={opt.label} className="flex items-start gap-2">
                  <span className="text-xs text-secondary mt-2 w-4 shrink-0">{opt.label}</span>
                  <input
                    value={opt.text}
                    onChange={e => updateOption(i, e.target.value)}
                    className="flex-1 bg-surface2 border border-border text-primary px-2 py-1.5 rounded-lg text-xs focus:border-accent focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <div className="mt-3">
              <label className="block text-xs text-secondary mb-1">Correct Answer</label>
              <select
                value={form.correct_answer ?? ''}
                onChange={e => setForm(f => ({ ...f, correct_answer: e.target.value || null }))}
                className="bg-surface2 border border-border text-primary px-3 py-1.5 rounded-lg text-sm focus:border-accent focus:outline-none"
              >
                <option value="">— Select —</option>
                {['A', 'B', 'C', 'D', 'E'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Explanation */}
        <div>
          <label className="block text-xs text-secondary mb-1">Explanation</label>
          <textarea
            value={form.explanation ?? ''}
            onChange={e => setForm(f => ({ ...f, explanation: e.target.value }))}
            rows={6}
            className="w-full bg-surface2 border border-border text-primary px-3 py-2 rounded-lg text-sm focus:border-accent focus:outline-none resize-none"
          />
        </div>

        {/* Status display */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-secondary">Status:</span>
          <span className="text-xs capitalize text-primary">{form.status}</span>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          {form.status !== 'approved' && (
            <Button onClick={handleApprove} loading={approving} className="w-full justify-center">
              Approve <span className="text-bg/60 text-xs ml-1">(A)</span>
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
