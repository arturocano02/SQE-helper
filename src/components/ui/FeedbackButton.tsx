'use client'

import { useState } from 'react'
import type { FeedbackType } from '@/types/database'

const APP_FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string }> = [
  { value: 'bug', label: 'Something is broken / not working' },
  { value: 'feature_request', label: 'Feature suggestion or improvement' },
  { value: 'content_request', label: 'Missing content or topic' },
  { value: 'other', label: 'Other' },
]

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>('bug')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!description.trim()) return
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_type: type, description }),
      })
      setDone(true)
      setTimeout(() => {
        setOpen(false)
        setDone(false)
        setDescription('')
        setType('bug')
      }, 1800)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 40,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--surface-2)',
          border: '1px solid var(--surface-border)',
          color: 'var(--text-secondary)',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          transition: 'all 150ms ease',
        }}
        className="hover:border-[rgba(200,146,42,0.4)] hover:text-[var(--amber-text)]"
      >
        ?
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.80)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
              width: '100%',
              maxWidth: 440,
            }}
          >
            {done ? (
              <div className="text-center py-4">
                <p className="font-serif text-xl mb-1" style={{ color: 'var(--status-correct)' }}>
                  Thanks for the feedback
                </p>
                <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                  We&apos;ll look into it.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
                    Send feedback
                  </h2>
                  <button
                    onClick={() => setOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>

                <label className="block mb-4">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Type
                  </span>
                  <select
                    value={type}
                    onChange={e => setType(e.target.value as FeedbackType)}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '9px 12px',
                    }}
                  >
                    {APP_FEEDBACK_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block mb-5">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Tell us what happened or what you'd like to see…"
                    rows={4}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '9px 12px',
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                </label>

                <div className="flex gap-3">
                  <button
                    onClick={submit}
                    disabled={submitting || !description.trim()}
                    style={{
                      flex: 1,
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 14,
                      padding: '10px 0',
                      borderRadius: 8,
                      border: 'none',
                      cursor: submitting || !description.trim() ? 'not-allowed' : 'pointer',
                      opacity: submitting || !description.trim() ? 0.5 : 1,
                    }}
                  >
                    {submitting ? 'Sending…' : 'Send feedback'}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 14,
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--surface-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
