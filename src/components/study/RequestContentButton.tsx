'use client'

import { useState } from 'react'
import type { QuestionType } from '@/types/database'

export default function RequestContentButton({ topicId, topicName }: { topicId: string; topicName: string }) {
  const [open, setOpen] = useState(false)
  const [contentType, setContentType] = useState<QuestionType>('mcq')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    setSubmitting(true)
    const res = await fetch('/api/content-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId, content_type: contentType, note: note.trim() || null }),
    })
    setSubmitting(false)
    if (res.ok) setDone(true)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="font-sans text-xs"
        style={{
          color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px solid var(--surface-border)',
          borderRadius: 8,
          padding: '6px 12px',
          cursor: 'pointer',
        }}
      >
        Need more questions? Ask for more →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.88)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
              maxWidth: 420,
              width: '100%',
            }}
          >
            {done ? (
              <>
                <h3 className="font-serif text-lg mb-2" style={{ color: 'var(--text-primary)' }}>
                  Request sent
                </h3>
                <p className="font-sans text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                  We&apos;ll let the admin know you&apos;d like more {contentType === 'mcq' ? 'questions' : 'flashcards'} for {topicName}.
                </p>
                <button onClick={() => { setOpen(false); setDone(false); setNote('') }} style={primaryBtn}>
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="font-serif text-lg mb-1" style={{ color: 'var(--text-primary)' }}>
                  Request more content
                </h3>
                <p className="font-sans text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
                  for {topicName}
                </p>

                <label className="block mb-4">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    What kind of content?
                  </span>
                  <div className="flex gap-2">
                    {(['mcq', 'flashcard'] as const).map(ct => (
                      <button
                        key={ct}
                        onClick={() => setContentType(ct)}
                        style={{
                          flex: 1,
                          padding: '8px 0',
                          borderRadius: 8,
                          fontFamily: 'var(--font-dm-sans)',
                          fontSize: 13,
                          border: contentType === ct ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                          background: contentType === ct ? 'var(--amber-soft)' : 'transparent',
                          color: contentType === ct ? 'var(--amber-text)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        {ct === 'mcq' ? 'MCQs' : 'Flashcards'}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="block mb-5">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Anything specific? (optional)
                  </span>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="e.g. more on directors' duties, harder questions…"
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
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
                </label>

                <div className="flex gap-3">
                  <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? 'Sending…' : 'Send request'}
                  </button>
                  <button onClick={() => setOpen(false)} style={secondaryBtn}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  background: 'var(--amber)',
  color: '#0A0A08',
  fontFamily: 'var(--font-dm-sans)',
  fontWeight: 600,
  fontSize: 14,
  padding: '10px 0',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-dm-sans)',
  fontSize: 14,
  padding: '10px 0',
  borderRadius: 8,
  border: '1px solid var(--surface-border)',
  cursor: 'pointer',
}
