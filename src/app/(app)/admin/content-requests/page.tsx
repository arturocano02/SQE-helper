'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { ContentRequestStatus } from '@/types/database'

interface ContentRequestRow {
  id: string
  user_id: string | null
  topic_id: string | null
  content_type: 'mcq' | 'flashcard'
  note: string | null
  status: ContentRequestStatus
  created_at: string
  topics?: { name: string; slug: string; paper: string } | null
}

const STATUS_OPTIONS: ContentRequestStatus[] = ['pending', 'done', 'dismissed']

const STATUS_STYLES: Record<ContentRequestStatus, { bg: string; color: string }> = {
  pending: { bg: 'rgba(251,191,36,0.12)', color: 'var(--status-warning)' },
  done: { bg: 'rgba(74,222,128,0.12)', color: 'var(--status-correct)' },
  dismissed: { bg: 'rgba(74,68,64,0.4)', color: 'var(--text-muted)' },
}

export default function AdminContentRequestsPage() {
  const [items, setItems] = useState<ContentRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    const res = await fetch(`/api/content-requests?${params}`)
    const json = await res.json()
    setItems(json.requests ?? [])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function updateItem(id: string, status: ContentRequestStatus) {
    setSaving(s => ({ ...s, [id]: true }))
    await fetch('/api/content-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
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
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Content Requests</h1>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Topics where users asked for more questions or flashcards
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

        {/* Status filter */}
        <div className="flex items-center gap-1 mb-6">
          {(['pending', 'done', 'dismissed', 'all'] as const).map(s => (
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
          <span className="ml-auto font-sans text-xs" style={{ color: 'var(--text-muted)' }}>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          </div>
        ) : items.length === 0 ? (
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
              No content requests match the current filter
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => {
              const st = STATUS_STYLES[item.status]
              return (
                <div
                  key={item.id}
                  className="px-5 py-4 flex items-start gap-4"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--surface-border)',
                    borderRadius: 12,
                  }}
                >
                  {/* Badges */}
                  <div className="flex flex-col gap-1 shrink-0" style={{ width: 140 }}>
                    <span
                      className="font-sans text-[11px] px-2 py-0.5 rounded-full inline-block"
                      style={{
                        background: 'rgba(200,146,42,0.12)',
                        color: 'var(--amber-text)',
                        border: '1px solid rgba(200,146,42,0.25)',
                        width: 'fit-content',
                      }}
                    >
                      {item.content_type === 'mcq' ? 'MCQs' : 'Flashcards'}
                    </span>
                    <span
                      className="font-sans text-[11px] px-2 py-0.5 rounded-full inline-block"
                      style={{ background: st.bg, color: st.color, width: 'fit-content' }}
                    >
                      {item.status}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {item.topics?.name ?? 'Unknown topic'}
                      {item.topics?.paper && (
                        <span className="font-sans text-xs" style={{ color: 'var(--text-muted)' }}> · {item.topics.paper}</span>
                      )}
                    </p>
                    {item.note && (
                      <p className="font-sans text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {item.note}
                      </p>
                    )}
                    <p className="font-sans text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                      {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <Link
                      href="/admin/content/generate"
                      className="font-sans text-xs px-3 py-1.5 rounded transition"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', border: '1px solid var(--surface-border)' }}
                    >
                      Generate →
                    </Link>
                    {STATUS_OPTIONS.filter(s => s !== item.status).map(s => (
                      <button
                        key={s}
                        onClick={() => updateItem(item.id, s)}
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
                        Mark {s}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
