'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, Confidence } from '@/types/database'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { masteryFromConfidence } from '@/lib/mastery'

type PrepLevel = 'just_starting' | 'few_weeks' | 'few_months' | 'final_stretch'

interface TopicCoverage {
  topicId: string
  covered: boolean
  confidence: Confidence | null
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [topics, setTopics] = useState<Topic[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [examDate, setExamDate] = useState('')
  const [prepLevel, setPrepLevel] = useState<PrepLevel | null>(null)
  const [coverage, setCoverage] = useState<Map<string, TopicCoverage>>(new Map())
  const [file, setFile] = useState<File | null>(null)
  const [notesContext, setNotesContext] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importResult, setImportResult] = useState<{ total_covered: number; total_chunks: number } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
    supabase.from('topics').select('*').order('sort_order').then(({ data }) => {
      if (data) setTopics(data as Topic[])
    })
  }, [])

  async function handleStep1() {
    if (!userId) return
    setLoading(true)
    const supabase = createClient()
    await supabase.from('profiles').update({ exam_date: examDate || null }).eq('id', userId)
    setLoading(false)
    setStep(2)
  }

  function toggleTopic(topicId: string) {
    setCoverage(prev => {
      const next = new Map(prev)
      if (next.get(topicId)?.covered) {
        next.delete(topicId)
      } else {
        next.set(topicId, { topicId, covered: true, confidence: null })
      }
      return next
    })
  }

  function setConfidence(topicId: string, confidence: Confidence) {
    setCoverage(prev => {
      const next = new Map(prev)
      next.set(topicId, { topicId, covered: true, confidence })
      return next
    })
  }

  async function handleStep2() {
    if (!userId) return
    setLoading(true)
    const supabase = createClient()

    const coverageRows = Array.from(coverage.values())
      .filter(c => c.covered && c.confidence)
      .map(c => ({ user_id: userId, topic_id: c.topicId, confidence: c.confidence! }))

    if (coverageRows.length > 0) {
      await supabase.from('user_topic_coverage').upsert(coverageRows)
      const masteryRows = coverageRows.map(c => ({
        user_id: userId,
        topic_id: c.topic_id,
        mastery_score: masteryFromConfidence(c.confidence as Confidence),
      }))
      await supabase.from('user_topic_mastery').upsert(masteryRows)
    }

    await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId)
    setLoading(false)
    setStep(3)
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    const form = new FormData()
    form.append('file', file)
    if (notesContext.trim()) form.append('notes_context', notesContext.trim())
    try {
      const res = await fetch('/api/import', { method: 'POST', body: form })
      const data = await res.json()
      if (data.mode === 'chunk_coverage' && data.coverage) {
        // Auto-confirm coverage (user can adjust later from profile)
        await fetch('/api/import', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coverage: data.coverage, mode: 'chunk_coverage' }),
        })
        setImportResult({ total_covered: data.total_covered, total_chunks: data.total_chunks })
      }
    } catch { /* non-fatal */ }
    setImporting(false)
    setImportDone(true)
  }

  function finish() {
    router.push('/home')
  }

  const flk1Topics = topics.filter(t => t.paper === 'FLK1')
  const flk2Topics = topics.filter(t => t.paper === 'FLK2')

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface-3)',
    border: '1px solid var(--surface-border)',
    borderRadius: 8,
    padding: '10px 14px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-dm-sans)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    transition: 'all 150ms ease',
  }

  return (
    <main
      className="min-h-screen px-5 py-12"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              style={{
                height: 5,
                borderRadius: 9999,
                background: n === step ? 'var(--amber)' : n < step ? 'rgba(200,146,42,0.35)' : 'var(--surface-3)',
                width: n === step ? 28 : 14,
                transition: 'all 300ms ease',
              }}
            />
          ))}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div>
            <h1 className="font-serif mb-2" style={{ fontSize: '2.25rem', color: 'var(--text-primary)' }}>
              Let&apos;s get you set up
            </h1>
            <p className="font-sans text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
              A few quick questions to personalise your study plan.
            </p>

            <div className="space-y-6">
              <div>
                <label
                  className="block font-sans text-sm mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  When is your SQE1 exam? <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <input
                  type="date"
                  value={examDate}
                  onChange={e => setExamDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label
                  className="block font-sans text-sm mb-3"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  How far into your SQE1 prep are you?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'just_starting', label: 'Just starting' },
                      { value: 'few_weeks', label: 'A few weeks in' },
                      { value: 'few_months', label: 'A few months in' },
                      { value: 'final_stretch', label: 'Final stretch' },
                    ] as const
                  ).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setPrepLevel(opt.value)}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 8,
                        border: prepLevel === opt.value
                          ? '1px solid rgba(200,146,42,0.5)'
                          : '1px solid var(--surface-border)',
                        background: prepLevel === opt.value ? 'var(--amber-soft)' : 'var(--surface-2)',
                        color: prepLevel === opt.value ? 'var(--amber-text)' : 'var(--text-secondary)',
                        fontFamily: 'var(--font-dm-sans)',
                        fontSize: 14,
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-10">
              <Button onClick={handleStep1} loading={loading} disabled={!prepLevel}>
                Continue →
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div>
            <h1 className="font-serif mb-2" style={{ fontSize: '2.25rem', color: 'var(--text-primary)' }}>
              Which topics have you covered?
            </h1>
            <p className="font-sans text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
              Select topics you&apos;ve studied, then rate your confidence.
            </p>

            {[
              { paper: 'FLK1', list: flk1Topics },
              { paper: 'FLK2', list: flk2Topics },
            ].map(({ paper, list }) => (
              <div key={paper} className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant={paper as 'FLK1' | 'FLK2'}>{paper}</Badge>
                </div>
                <div className="space-y-2">
                  {list.map(topic => {
                    const cov = coverage.get(topic.id)
                    const isCovered = cov?.covered ?? false
                    return (
                      <div key={topic.id}>
                        <button
                          onClick={() => toggleTopic(topic.id)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '12px 16px',
                            borderRadius: 8,
                            border: isCovered
                              ? '1px solid rgba(200,146,42,0.5)'
                              : '1px solid var(--surface-border)',
                            background: isCovered ? 'var(--amber-soft)' : 'var(--surface-2)',
                            color: isCovered ? 'var(--amber-text)' : 'var(--text-secondary)',
                            fontFamily: 'var(--font-dm-sans)',
                            fontSize: 14,
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                        >
                          {topic.name}
                        </button>
                        {isCovered && (
                          <div className="flex gap-2 mt-2 ml-1">
                            <span
                              className="font-sans text-xs self-center"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Confidence:
                            </span>
                            {(['shaky', 'okay', 'solid'] as Confidence[]).map(conf => {
                              const isActive = cov?.confidence === conf
                              const confColors = {
                                shaky: { active: { bg: 'rgba(224,90,90,0.15)', border: 'rgba(224,90,90,0.5)', color: '#E87878' } },
                                okay:  { active: { bg: 'rgba(200,146,42,0.15)', border: 'rgba(200,146,42,0.5)', color: 'var(--amber-text)' } },
                                solid: { active: { bg: 'rgba(76,175,130,0.15)', border: 'rgba(76,175,130,0.5)', color: '#6ECFA3' } },
                              }
                              const c = confColors[conf]
                              return (
                                <button
                                  key={conf}
                                  onClick={e => { e.stopPropagation(); setConfidence(topic.id, conf) }}
                                  style={{
                                    padding: '4px 12px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    fontFamily: 'var(--font-dm-sans)',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'all 150ms ease',
                                    border: isActive ? `1px solid ${c.active.border}` : '1px solid var(--surface-border)',
                                    background: isActive ? c.active.bg : 'var(--surface-2)',
                                    color: isActive ? c.active.color : 'var(--text-secondary)',
                                    textTransform: 'capitalize',
                                  }}
                                >
                                  {conf}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="flex gap-3 mt-8">
              <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={handleStep2} loading={loading}>
                Continue →
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div>
            <h1 className="font-serif mb-2" style={{ fontSize: '2.25rem', color: 'var(--text-primary)' }}>
              Personalise your starting point
            </h1>
            <p className="font-sans text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              The platform already has a full question bank — you can start studying right now.
            </p>
            <p className="font-sans text-sm mb-7" style={{ color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Optionally</strong>, upload your own revision notes or wrong-answer logs. We&apos;ll read them to understand where you&apos;ve been struggling, and weight your early sessions towards those areas.
            </p>

            {/* Privacy notice */}
            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                borderRadius: 10,
                padding: '16px 18px',
                marginBottom: 24,
              }}
            >
              {[
                'Your notes are private to you — never added to the shared question bank',
                'We extract weak areas and seed your mastery scores — nothing more',
                'You can also upload more notes later from your profile',
              ].map((line, i) => (
                <p key={i} className="font-sans text-sm flex gap-2 mb-1.5 last:mb-0" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--status-correct)', flexShrink: 0 }}>✓</span>
                  {line}
                </p>
              ))}
            </div>

            {!importDone ? (
              <div
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 12,
                  padding: '24px',
                }}
                className="card-glow"
              >
                <label
                  className="block font-sans text-sm mb-3"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Upload a PDF, Word (.docx), or text file
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border file:cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                />
                {file && (
                  <p className="mt-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    Selected: {file.name}
                  </p>
                )}

                <div className="mt-5">
                  <label
                    className="block font-sans text-sm mb-1.5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    How are your notes structured? <span style={{ color: 'var(--text-muted)' }}>(optional — helps Claude read them better)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. bullet points per topic, handwritten scans OCR'd, condensed rules only…"
                    value={notesContext}
                    onChange={e => setNotesContext(e.target.value)}
                    style={{
                      ...inputStyle,
                      fontSize: 13,
                    }}
                  />
                </div>

                <div className="flex gap-3 mt-6">
                  <Button onClick={handleImport} loading={importing} disabled={!file}>
                    Import My Notes
                  </Button>
                  <Button variant="ghost" onClick={finish}>
                    Skip — start fresh
                  </Button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(76,175,130,0.08)',
                  border: '1px solid rgba(76,175,130,0.25)',
                  borderRadius: 12,
                  padding: '28px 24px',
                  textAlign: 'center',
                }}
              >
                <div
                  className="font-serif text-5xl mb-3"
                  style={{ color: 'var(--status-correct)' }}
                >
                  ✓
                </div>
                <p className="font-sans font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Notes imported
                </p>
                {importResult && (
                  <p className="font-mono text-sm mb-1" style={{ color: 'var(--amber-text)' }}>
                    {importResult.total_covered} / {importResult.total_chunks} knowledge rules mapped
                  </p>
                )}
                <p
                  className="font-sans text-sm mb-6"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Your weak areas have been identified. Sessions will start there.
                </p>
                <Button onClick={finish}>Go to Dashboard →</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
