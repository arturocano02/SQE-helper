'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { FeedbackType, FeedbackStatus } from '@/types/database'

interface FeedbackRow {
  id: string
  user_id: string | null
  question_id: string | null
  knowledge_chunk_id: string | null
  feedback_type: FeedbackType
  description: string
  status: FeedbackStatus
  admin_note: string | null
  created_at: string
  questions?: {
    prompt: string
    topic_id: string | null
    knowledge_chunk_id: string | null
    topics?: { name: string } | null
  } | null
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  wrong_answer: 'Wrong answer',
  poor_explanation: 'Poor explanation',
  outdated_law: 'Outdated law',
  misleading_question: 'Misleading question',
  chunk_dispute: 'Knowledge chunk dispute',
  flashcard_dispute: 'Flashcard grading dispute',
  bug: 'Bug report',
  feature_request: 'Feature request',
  content_request: 'Content request',
  other: 'Other',
}

const STATUS_OPTIONS: FeedbackStatus[] = ['pending', 'reviewed', 'actioned', 'dismissed']

const STATUS_STYLES: Record<FeedbackStatus, { bg: string; color: string }> = {
  pending: { bg: 'rgba(251,191,36,0.12)', color: 'var(--status-warning)' },
  reviewed: { bg: 'rgba(200,146,42,0.12)', color: 'var(--amber-text)' },
  actioned: { bg: 'rgba(74,222,128,0.12)', color: 'var(--status-correct)' },
  dismissed: { bg: 'rgba(74,68,64,0.4)', color: 'var(--text-muted)' },
}

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editNote, setEditNote] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (scopeFilter === 'question') params.set('has_question', 'true')
    if (scopeFilter === 'general') params.set('has_question', 'false')
    const res = await fetch(`/api/feedback?${params}`)
    const json = await res.json()
    setItems(json.feedback ?? [])
    setLoading(false)
  }, [statusFilter, scopeFilter])

  useEffect(() => { load() }, [load])

  const filtered = typeFilter === 'all'
    ? items
    : items.filter(i => i.feedback_type === typeFilter)

  async function updateItem(id: string, patch: { status?: FeedbackStatus; admin_note?: string }) {
    setSaving(s => ({ ...s, [id]: true }))
    await fetch('/api/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    setSaving(s => ({ ...s, [id]: false }))
    await load()
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Feedback</h1>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Review flags and feedback from users
            </p>
          </div>
          <Link
            href="/admin"
            className="font-sans text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            ← Dashboard
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Status filter */}
          <div className="flex items-center gap-1">
            {(['pending', 'reviewed', 'actioned', 'dismissed', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="font-sans text-xs capitalize px-3 py-1.5 rounded-full transition"
                style={{
                  background: statusFilter === s ? 'var(--amber)' : 'var(--surface-2)',
                  color: statusFilter === s ? '#0A0A08' : 'var(--text-secondary)',
                  border: '1px solid',
                  borderColor: statusFilter === s ? 'var(--amber)' : 'var(--surface-border)',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--surface-border)' }} />

          {/* Scope filter */}
          <div className="flex items-center gap-1">
            {[['all', 'All'], ['question', 'Question flags'], ['general', 'General']] .map(([val, label]) => (
              <button
                key={val}
                onClick={() => setScopeFilter(val)}
                className="font-sans text-xs px-3 py-1.5 rounded-full transition"
                style={{
                  background: scopeFilter === val ? 'var(--surface-3)' : 'var(--surface-2)',
                  color: scopeFilter === val ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: '1px solid var(--surface-border)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--surface-border)' }} />

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="font-sans text-xs px-3 py-1.5 rounded-full"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            <option value="all">All types</option>
            {Object.entries(TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>

          <span className="ml-auto font-sans text-xs" style={{ color: 'var(--text-muted)' }}>
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-24"
            style={{
              background: 'var(--surface-1)',
              border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: 14,
            }}
          >
            <p className="font-serif text-xl mb-1" style={{ color: 'var(--text-muted)' }}>
              Nothing here
            </p>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              No feedback matches the current filters
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => {
              const isExpanded = expanded === item.id
              const st = STATUS_STYLES[item.status]
              const isQuestion = !!item.question_id
              const noteVal = editNote[item.id] ?? item.admin_note ?? ''

              return (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--surface-border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {/* Row header */}
                  <div
                    className="px-5 py-4 cursor-pointer flex items-start gap-4"
                    onClick={() => setExpanded(isExpanded ? null : item.id)}
                  >
                    {/* Type + scope badge */}
                    <div className="flex flex-col gap-1 shrink-0" style={{ width: 140 }}>
                      <span
                        className="font-sans text-[11px] px-2 py-0.5 rounded-full inline-block"
                        style={{
                          background: isQuestion ? 'rgba(200,146,42,0.12)' : 'rgba(140,135,111,0.12)',
                          color: isQuestion ? 'var(--amber-text)' : 'var(--text-secondary)',
                          border: '1px solid',
                          borderColor: isQuestion ? 'rgba(200,146,42,0.25)' : 'rgba(140,135,111,0.25)',
                          width: 'fit-content',
                        }}
                      >
                        {isQuestion ? 'Question flag' : 'General'}
                      </span>
                      <span
                        className="font-sans text-[11px] px-2 py-0.5 rounded-full inline-block"
                        style={{
                          background: st.bg,
                          color: st.color,
                          border: '1px solid transparent',
                          width: 'fit-content',
                        }}
                      >
                        {item.status}
                      </span>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-sans text-xs mb-1 font-medium"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {TYPE_LABELS[item.feedback_type]}
                        {item.questions?.topics?.name && (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' '}· {item.questions.topics.name}
                          </span>
                        )}
                      </p>
                      <p
                        className="font-sans text-sm"
                        style={{
                          color: 'var(--text-primary)',
                          display: '-webkit-box',
                          WebkitLineClamp: isExpanded ? undefined : 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: isExpanded ? 'visible' : 'hidden',
                        }}
                      >
                        {item.description}
                      </p>
                    </div>

                    {/* Date */}
                    <span
                      className="font-sans text-xs shrink-0"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {new Date(item.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>

                    <span
                      className="font-sans text-sm shrink-0"
                      style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '150ms' }}
                    >
                      ⌄
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div
                      className="px-5 pb-5 space-y-4"
                      style={{ borderTop: '1px solid var(--surface-border)', paddingTop: 16 }}
                    >
                      {/* Question preview if applicable */}
                      {item.questions?.prompt && (
                        <div
                          className="p-3 rounded-lg"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--surface-border)' }}
                        >
                          <p className="font-sans text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                            Question
                          </p>
                          <p className="font-sans text-sm" style={{ color: 'var(--text-primary)' }}>
                            {item.questions.prompt}
                          </p>
                        </div>
                      )}

                      {/* Admin note */}
                      <div>
                        <label className="font-sans text-xs block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                          Admin note (internal)
                        </label>
                        <textarea
                          value={noteVal}
                          onChange={e => setEditNote(n => ({ ...n, [item.id]: e.target.value }))}
                          placeholder="Add a note for yourself…"
                          rows={2}
                          style={{
                            width: '100%',
                            background: 'var(--surface-2)',
                            border: '1px solid var(--surface-border)',
                            borderRadius: 8,
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-dm-sans)',
                            fontSize: 13,
                            padding: '8px 12px',
                            resize: 'vertical',
                            outline: 'none',
                          }}
                        />
                      </div>

                      {/* Fix source knowledge chunk */}
                      {(item.knowledge_chunk_id || item.questions?.knowledge_chunk_id) && (
                        <ChunkFixPanel
                          feedbackId={item.id}
                          questionId={item.question_id}
                          currentAdminNote={noteVal}
                          onApplied={load}
                        />
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {STATUS_OPTIONS.filter(s => s !== item.status).map(s => (
                          <button
                            key={s}
                            onClick={() => updateItem(item.id, {
                              status: s,
                              admin_note: noteVal || undefined,
                            })}
                            disabled={saving[item.id]}
                            className="font-sans text-xs capitalize px-3 py-1.5 rounded transition"
                            style={{
                              background: STATUS_STYLES[s].bg,
                              color: STATUS_STYLES[s].color,
                              border: '1px solid transparent',
                              cursor: saving[item.id] ? 'not-allowed' : 'pointer',
                              opacity: saving[item.id] ? 0.5 : 1,
                            }}
                          >
                            Mark as {s}
                          </button>
                        ))}

                        {noteVal !== (item.admin_note ?? '') && (
                          <button
                            onClick={() => updateItem(item.id, { admin_note: noteVal })}
                            disabled={saving[item.id]}
                            className="font-sans text-xs px-3 py-1.5 rounded transition ml-auto"
                            style={{
                              background: 'var(--surface-3)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--surface-border)',
                              cursor: saving[item.id] ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Save note
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

interface Suggestion {
  chunk_id: string
  topic_name: string | null
  current: { rule_text: string; context_text: string | null }
  suggested: { rule_text: string; context_text: string | null }
  reasoning: string
  flagged_question_id: string | null
}

/**
 * Closes the feedback → knowledge chunk loop inline in the feedback list: draft a
 * correction with Claude (grounded in the feedback + this admin's own note), let the
 * admin edit it, then apply it to the chunk and archive the flagged question in one action.
 */
function ChunkFixPanel({
  feedbackId,
  questionId,
  currentAdminNote,
  onApplied,
}: {
  feedbackId: string
  questionId: string | null
  currentAdminNote: string
  onApplied: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [ruleText, setRuleText] = useState('')
  const [contextText, setContextText] = useState('')
  const [archiveQuestion, setArchiveQuestion] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  async function requestSuggestion() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/chunks/suggest-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_id: feedbackId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to draft a fix')
      setSuggestion(json)
      setRuleText(json.suggested.rule_text)
      setContextText(json.suggested.context_text ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to draft a fix')
    } finally {
      setLoading(false)
    }
  }

  async function apply() {
    if (!suggestion) return
    setApplying(true)
    try {
      await fetch('/api/admin/chunks/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunk_id: suggestion.chunk_id,
          rule_text: ruleText,
          context_text: contextText || null,
          feedback_id: feedbackId,
          admin_note: currentAdminNote,
          archive_question_id: archiveQuestion ? (suggestion.flagged_question_id ?? questionId ?? undefined) : undefined,
        }),
      })
      setApplied(true)
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  if (applied) {
    return (
      <div className="p-3 rounded-lg" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
        <p className="font-sans text-sm" style={{ color: 'var(--status-correct)' }}>
          ✓ Chunk updated and feedback marked actioned.
        </p>
      </div>
    )
  }

  return (
    <div
      className="p-4 rounded-lg space-y-3"
      style={{ background: 'rgba(200,146,42,0.05)', border: '1px solid rgba(200,146,42,0.20)' }}
    >
      <div className="flex items-center justify-between">
        <p className="font-sans text-xs font-medium" style={{ color: 'var(--amber-text)' }}>
          Fix source knowledge chunk
        </p>
        {!suggestion && (
          <button
            onClick={requestSuggestion}
            disabled={loading}
            className="font-sans text-xs px-3 py-1.5 rounded transition"
            style={{
              background: 'var(--amber)',
              color: '#0A0A08',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Drafting fix…' : 'Suggest fix from feedback'}
          </button>
        )}
      </div>

      {error && (
        <p className="font-sans text-xs" style={{ color: 'var(--status-wrong)' }}>{error}</p>
      )}

      {suggestion && (
        <>
          {suggestion.topic_name && (
            <p className="font-sans text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Topic: {suggestion.topic_name}
            </p>
          )}

          <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {suggestion.reasoning}
          </p>

          <div>
            <label className="font-sans text-[11px] block mb-1" style={{ color: 'var(--text-muted)' }}>
              rule_text (was: &quot;{suggestion.current.rule_text.slice(0, 80)}
              {suggestion.current.rule_text.length > 80 ? '…' : ''}&quot;)
            </label>
            <textarea
              value={ruleText}
              onChange={e => setRuleText(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 13,
                padding: '8px 12px',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label className="font-sans text-[11px] block mb-1" style={{ color: 'var(--text-muted)' }}>
              context_text (optional)
            </label>
            <textarea
              value={contextText}
              onChange={e => setContextText(e.target.value)}
              rows={2}
              placeholder="(none)"
              style={{
                width: '100%',
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 13,
                padding: '8px 12px',
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          {(suggestion.flagged_question_id ?? questionId) && (
            <label className="flex items-center gap-2 font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={archiveQuestion} onChange={e => setArchiveQuestion(e.target.checked)} />
              Archive the flagged question — it stops appearing to students immediately. Generate a replacement later from the corrected chunk.
            </label>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={apply}
              disabled={applying || !ruleText.trim()}
              className="font-sans text-xs px-3 py-1.5 rounded transition"
              style={{
                background: 'var(--status-correct)',
                color: '#0A0A08',
                cursor: applying ? 'not-allowed' : 'pointer',
                opacity: applying || !ruleText.trim() ? 0.6 : 1,
              }}
            >
              {applying ? 'Applying…' : 'Apply fix to chunk'}
            </button>
            <button
              onClick={() => setSuggestion(null)}
              className="font-sans text-xs px-3 py-1.5 rounded transition"
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  )
}
