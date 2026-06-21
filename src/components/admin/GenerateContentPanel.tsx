'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'

interface Topic {
  id: string
  name: string
  slug: string
  paper: string
  approved_chunks: number
}

interface ProgressEvent {
  stage: 'starting' | 'topic' | 'topic_skip' | 'topic_done' | 'progress' | 'done' | 'error'
  topic_name?: string
  topic_index?: number
  topics_total?: number
  chunk_index?: number
  chunks_total?: number
  topic_generated?: number
  generated_so_far?: number
  total_generated?: number
  total_attempted?: number
  count_per_topic?: number
  difficulty?: string
  reason?: string
  message?: string
}

const DIFFICULTIES = [
  { value: 'mixed', label: 'Mixed', description: 'Balanced across easy / medium / hard' },
  { value: 'easy', label: 'Easy', description: 'Rule recall — "What is the test for X?"' },
  { value: 'medium', label: 'Medium', description: 'Single-issue application to a fact pattern' },
  { value: 'hard', label: 'Hard', description: 'Multi-step reasoning, competing rules, traps' },
] as const

const QUESTION_STATUSES = [
  { value: 'draft', label: 'Draft (review before going live)', description: 'Content goes to your review queue' },
  { value: 'approved', label: 'Approved (go live immediately)', description: 'Content is immediately visible to users' },
] as const

interface GenerateContentPanelProps {
  contentType: 'mcq' | 'flashcard'
}

export default function GenerateContentPanel({ contentType }: GenerateContentPanelProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loadingTopics, setLoadingTopics] = useState(true)
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set())
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed')
  const [countPerTopic, setCountPerTopic] = useState(10)
  const [targetStatus, setTargetStatus] = useState<'draft' | 'approved'>('draft')
  const [includeSampleQuestions, setIncludeSampleQuestions] = useState(true)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<ProgressEvent[]>([])
  const [done, setDone] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  const [guideText, setGuideText] = useState('')
  const [guideUpdatedAt, setGuideUpdatedAt] = useState<string | null>(null)
  const [loadingGuide, setLoadingGuide] = useState(false)
  const [savingGuide, setSavingGuide] = useState(false)
  const [regeneratingGuide, setRegeneratingGuide] = useState(false)
  const [guideError, setGuideError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/topics')
      .then(r => r.json())
      .then(data => setTopics(data.topics ?? []))
      .finally(() => setLoadingTopics(false))
  }, [])

  const soleSelectedTopicId = selectedTopicIds.size === 1 ? Array.from(selectedTopicIds)[0] : null

  useEffect(() => {
    setGuideError(null)
    if (!soleSelectedTopicId) {
      setGuideText('')
      setGuideUpdatedAt(null)
      return
    }
    setLoadingGuide(true)
    fetch(`/api/admin/style-guide?topic_id=${soleSelectedTopicId}`)
      .then(r => r.json())
      .then(data => {
        setGuideText(data.question_style_guide ?? '')
        setGuideUpdatedAt(data.style_guide_updated_at ?? null)
      })
      .finally(() => setLoadingGuide(false))
  }, [soleSelectedTopicId])

  async function saveGuide() {
    if (!soleSelectedTopicId) return
    setSavingGuide(true)
    setGuideError(null)
    try {
      await fetch('/api/admin/style-guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: soleSelectedTopicId, question_style_guide: guideText }),
      })
    } finally {
      setSavingGuide(false)
    }
  }

  async function regenerateGuide() {
    if (!soleSelectedTopicId) return
    setRegeneratingGuide(true)
    setGuideError(null)
    try {
      const res = await fetch('/api/admin/style-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: soleSelectedTopicId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setGuideError(data.error ?? 'Failed to generate style guide')
      } else {
        setGuideText(data.question_style_guide ?? '')
        setGuideUpdatedAt(data.style_guide_updated_at ?? null)
      }
    } finally {
      setRegeneratingGuide(false)
    }
  }

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  function toggleTopic(id: string) {
    setSelectedTopicIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedTopicIds(new Set(topics.map(t => t.id)))
  }

  function deselectAll() {
    setSelectedTopicIds(new Set())
  }

  async function generate() {
    if (selectedTopicIds.size === 0 || running) return
    setRunning(true)
    setDone(false)
    setLog([])

    try {
      const res = await fetch('/api/admin/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_ids: Array.from(selectedTopicIds),
          difficulty,
          count_per_topic: countPerTopic,
          status: targetStatus,
          content_type: contentType,
          include_sample_questions: contentType === 'mcq' ? includeSampleQuestions : false,
        }),
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as ProgressEvent
            setLog(prev => [...prev, event])
            if (event.stage === 'done' || event.stage === 'error') setDone(true)
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setLog(prev => [...prev, { stage: 'error', message: err instanceof Error ? err.message : 'Unknown error' }])
      setDone(true)
    } finally {
      setRunning(false)
    }
  }

  const totalSelected = selectedTopicIds.size
  const totalEstimated = totalSelected * countPerTopic
  const lastEvent = log[log.length - 1]
  const generatedSoFar = lastEvent?.generated_so_far ?? lastEvent?.total_generated ?? 0
  const itemNoun = contentType === 'flashcard' ? 'flashcards' : 'questions'

  // Group topics by paper
  const flk1 = topics.filter(t => t.paper === 'FLK1')
  const flk2 = topics.filter(t => t.paper === 'FLK2')

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
              {contentType === 'flashcard' ? 'Generate Flashcards' : 'Generate Questions'}
            </h1>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {contentType === 'flashcard'
                ? 'Generate flashcards from approved knowledge chunks'
                : 'Generate MCQ questions from approved knowledge chunks'}
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

        <div className="space-y-6">

          {/* Topic selector */}
          <section
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                Topics
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  className="font-sans text-xs px-3 py-1.5 rounded transition"
                  style={{
                    background: 'var(--amber)',
                    color: '#0A0A08',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Select all
                </button>
                {totalSelected > 0 && (
                  <button
                    onClick={deselectAll}
                    className="font-sans text-xs px-3 py-1.5 rounded transition"
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--surface-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Deselect
                  </button>
                )}
                {totalSelected > 0 && (
                  <span className="font-sans text-xs" style={{ color: 'var(--text-muted)' }}>
                    {totalSelected} selected
                  </span>
                )}
              </div>
            </div>

            {loadingTopics ? (
              <p className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading topics…</p>
            ) : (
              <div className="space-y-4">
                {[{ paper: 'FLK1', list: flk1 }, { paper: 'FLK2', list: flk2 }].map(({ paper, list }) => (
                  <div key={paper}>
                    <p
                      className="font-sans text-[10px] uppercase tracking-wider mb-2"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {paper}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {list.map(topic => {
                        const selected = selectedTopicIds.has(topic.id)
                        return (
                          <label
                            key={topic.id}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition"
                            style={{
                              background: selected ? 'var(--accent-dim)' : 'var(--surface-2)',
                              border: `1px solid ${selected ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleTopic(topic.id)}
                              style={{ accentColor: 'var(--amber)', width: 14, height: 14, flexShrink: 0 }}
                            />
                            <div className="flex-1 min-w-0">
                              <p
                                className="font-sans text-sm truncate"
                                style={{ color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                              >
                                {topic.name}
                              </p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Question style guide — per topic, only when exactly one topic is selected and we're generating MCQs */}
          {soleSelectedTopicId && contentType === 'mcq' && (
            <section
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 14,
                padding: 24,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                  Question Style Guide
                </h2>
                <button
                  onClick={regenerateGuide}
                  disabled={regeneratingGuide}
                  className="font-sans text-xs px-3 py-1.5 rounded transition"
                  style={{
                    background: 'var(--accent-dim)',
                    color: 'var(--amber-text)',
                    border: '1px solid rgba(200,146,42,0.35)',
                    cursor: regeneratingGuide ? 'not-allowed' : 'pointer',
                    opacity: regeneratingGuide ? 0.6 : 1,
                  }}
                >
                  {regeneratingGuide ? 'Synthesising…' : 'Regenerate from sample questions →'}
                </button>
              </div>
              <p className="font-sans text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Synthesised from sample-question chunks with inferred difficulty for this topic. Used as a reference
                when generating new questions below. Editable — your edits are saved as-is until regenerated.
                {guideUpdatedAt && (
                  <> Last updated {new Date(guideUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</>
                )}
              </p>

              {guideError && (
                <p className="font-sans text-xs mb-3" style={{ color: 'var(--status-wrong)' }}>
                  {guideError}
                </p>
              )}

              {loadingGuide ? (
                <p className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              ) : (
                <>
                  <textarea
                    value={guideText}
                    onChange={e => setGuideText(e.target.value)}
                    placeholder="No style guide yet — click “Regenerate from sample questions” to synthesise one from this topic's sample-question chunks, or write one manually."
                    rows={8}
                    style={{
                      width: '100%',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '10px 12px',
                      resize: 'vertical',
                      outline: 'none',
                      lineHeight: 1.5,
                    }}
                  />
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={saveGuide}
                      disabled={savingGuide}
                      className="font-sans text-xs px-4 py-1.5 rounded transition"
                      style={{
                        background: 'var(--amber)',
                        color: '#0A0A08',
                        border: 'none',
                        fontWeight: 600,
                        cursor: savingGuide ? 'not-allowed' : 'pointer',
                        opacity: savingGuide ? 0.6 : 1,
                      }}
                    >
                      {savingGuide ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Config */}
          <section
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 24,
            }}
          >
            <h2 className="font-serif text-lg mb-5" style={{ color: 'var(--text-primary)' }}>
              Settings
            </h2>

            {/* Count per topic */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {contentType === 'flashcard' ? 'Flashcards per topic' : 'Questions per topic'}
                </label>
                <span
                  className="font-serif text-2xl"
                  style={{ color: 'var(--amber-text)', minWidth: 36, textAlign: 'right' }}
                >
                  {countPerTopic}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={countPerTopic}
                onChange={e => setCountPerTopic(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--amber)' }}
              />
              <div className="flex justify-between mt-1">
                <span className="font-sans text-[10px]" style={{ color: 'var(--text-muted)' }}>1</span>
                <span className="font-sans text-[10px]" style={{ color: 'var(--text-muted)' }}>50</span>
              </div>
            </div>

            {/* Difficulty — MCQs only, flashcards aren't difficulty-tiered */}
            {contentType === 'mcq' && (
              <div className="mb-6">
                <label className="font-sans text-sm block mb-2.5" style={{ color: 'var(--text-secondary)' }}>
                  Difficulty
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DIFFICULTIES.map(d => {
                    const active = difficulty === d.value
                    return (
                      <button
                        key={d.value}
                        onClick={() => setDifficulty(d.value)}
                        className="text-left rounded-lg px-3 py-2.5 transition"
                        style={{
                          background: active ? 'var(--accent-dim)' : 'var(--surface-2)',
                          border: `1px solid ${active ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <p
                          className="font-sans text-sm font-medium"
                          style={{ color: active ? 'var(--amber-text)' : 'var(--text-primary)' }}
                        >
                          {d.label}
                        </p>
                        <p className="font-sans text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>
                          {d.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Sample questions toggle — MCQs only, since style examples only feed MCQ generation */}
            {contentType === 'mcq' && (
              <div className="mb-6">
                <label
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition"
                  style={{
                    background: includeSampleQuestions ? 'var(--accent-dim)' : 'var(--surface-2)',
                    border: `1px solid ${includeSampleQuestions ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeSampleQuestions}
                    onChange={e => setIncludeSampleQuestions(e.target.checked)}
                    style={{ accentColor: 'var(--amber)', width: 14, height: 14, flexShrink: 0 }}
                  />
                  <div>
                    <p
                      className="font-sans text-sm font-medium"
                      style={{ color: includeSampleQuestions ? 'var(--amber-text)' : 'var(--text-primary)' }}
                    >
                      Use sample questions as style reference
                    </p>
                    <p className="font-sans text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>
                      Lets the generator see a few real sample questions and the style guide for tone and difficulty calibration — never copied verbatim. Turn off to generate purely from the knowledge chunk text.
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Status */}
            <div>
              <label className="font-sans text-sm block mb-2.5" style={{ color: 'var(--text-secondary)' }}>
                After generation
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {QUESTION_STATUSES.map(s => {
                  const active = targetStatus === s.value
                  return (
                    <button
                      key={s.value}
                      onClick={() => setTargetStatus(s.value)}
                      className="text-left rounded-lg px-3 py-2.5 transition"
                      style={{
                        background: active ? 'var(--accent-dim)' : 'var(--surface-2)',
                        border: `1px solid ${active ? 'rgba(200,146,42,0.35)' : 'var(--surface-border)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <p
                        className="font-sans text-sm font-medium"
                        style={{ color: active ? 'var(--amber-text)' : 'var(--text-primary)' }}
                      >
                        {s.label}
                      </p>
                      <p className="font-sans text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {s.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Summary + Generate button */}
          <div
            className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl"
            style={{
              background: totalSelected > 0 ? 'rgba(200,146,42,0.06)' : 'var(--surface-1)',
              border: `1px solid ${totalSelected > 0 ? 'rgba(200,146,42,0.20)' : 'var(--surface-border)'}`,
            }}
          >
            <div>
              {totalSelected > 0 ? (
                <>
                  <p className="font-sans text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Generate up to{' '}
                    <span style={{ color: 'var(--amber-text)' }}>
                      {totalEstimated} {itemNoun}
                    </span>
                    {' '}across{' '}
                    <span style={{ color: 'var(--amber-text)' }}>{totalSelected} topic{totalSelected !== 1 ? 's' : ''}</span>
                  </p>
                  <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {countPerTopic} per topic{contentType === 'mcq' ? ` · ${difficulty} difficulty` : ''} · goes to {targetStatus}
                  </p>
                </>
              ) : (
                <p className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>
                  Select at least one topic to continue
                </p>
              )}
            </div>
            <button
              onClick={generate}
              disabled={totalSelected === 0 || running}
              style={{
                background: totalSelected === 0 || running ? 'var(--surface-3)' : 'var(--amber)',
                color: totalSelected === 0 || running ? 'var(--text-muted)' : '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 600,
                fontSize: 14,
                padding: '10px 24px',
                borderRadius: 8,
                border: 'none',
                cursor: totalSelected === 0 || running ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {running ? 'Generating…' : 'Generate →'}
            </button>
          </div>

          {/* Progress log */}
          {log.length > 0 && (
            <section
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--surface-border)',
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                  Progress
                </h2>
                {running && (
                  <span className="font-sans text-xs" style={{ color: 'var(--amber-text)' }}>
                    {generatedSoFar} generated…
                  </span>
                )}
                {done && (
                  <span className="font-sans text-xs" style={{ color: 'var(--status-correct)' }}>
                    Complete — {generatedSoFar} {itemNoun} generated
                  </span>
                )}
              </div>

              <div
                className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {log.map((event, i) => (
                  <LogLine key={i} event={event} itemNoun={itemNoun} />
                ))}
                <div ref={logEndRef} />
              </div>

              {done && generatedSoFar > 0 && (
                <div className="mt-4 flex gap-3">
                  <Link
                    href="/admin/content/questions"
                    style={{
                      background: 'var(--amber)',
                      color: '#0A0A08',
                      fontFamily: 'var(--font-dm-sans)',
                      fontWeight: 600,
                      fontSize: 13,
                      padding: '8px 18px',
                      borderRadius: 8,
                      display: 'inline-block',
                    }}
                  >
                    Review {itemNoun} →
                  </Link>
                  <button
                    onClick={() => { setLog([]); setDone(false) }}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: '1px solid var(--surface-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Generate more
                  </button>
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </main>
  )
}

function LogLine({ event, itemNoun }: { event: ProgressEvent; itemNoun: string }) {
  const { stage } = event

  if (stage === 'starting') {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        Starting — {event.topics_total} topic{event.topics_total !== 1 ? 's' : ''}, {event.count_per_topic} per topic ({event.difficulty})
      </p>
    )
  }
  if (stage === 'topic') {
    return (
      <p style={{ color: 'var(--amber-text)', marginTop: 6 }}>
        [{event.topic_index}/{event.topics_total}] {event.topic_name}
      </p>
    )
  }
  if (stage === 'topic_skip') {
    return (
      <p style={{ color: 'var(--status-wrong)' }}>
        &nbsp;&nbsp;⚠ Skipped — {event.reason}
      </p>
    )
  }
  if (stage === 'progress') {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        &nbsp;&nbsp;{event.chunk_index}/{event.chunks_total} chunks processed ({event.generated_so_far} total)
      </p>
    )
  }
  if (stage === 'topic_done') {
    return (
      <p style={{ color: 'var(--status-correct)' }}>
        &nbsp;&nbsp;✓ {event.topic_generated} {itemNoun.slice(0, -1)}{event.topic_generated !== 1 ? 's' : ''} added
      </p>
    )
  }
  if (stage === 'done') {
    return (
      <p style={{ color: 'var(--status-correct)', marginTop: 8, fontWeight: 600 }}>
        Done — {event.total_generated} {itemNoun} generated ({event.total_attempted} chunks processed)
      </p>
    )
  }
  if (stage === 'error') {
    return (
      <p style={{ color: 'var(--status-wrong)' }}>
        Error: {event.message}
      </p>
    )
  }
  return null
}
