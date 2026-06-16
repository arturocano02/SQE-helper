'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Topic, Confidence } from '@/types/database'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
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

  // Single click: tapping a confidence pill both marks the topic covered and sets confidence.
  // Tapping the already-active pill again clears it.
  function setConfidence(topicId: string, confidence: Confidence) {
    setCoverage(prev => {
      const next = new Map(prev)
      if (next.get(topicId)?.confidence === confidence) {
        next.delete(topicId)
      } else {
        next.set(topicId, { topicId, covered: true, confidence })
      }
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

  const confColors: Record<Confidence, { bg: string; border: string; color: string }> = {
    shaky: { bg: 'rgba(224,90,90,0.15)', border: 'rgba(224,90,90,0.5)', color: '#E87878' },
    okay:  { bg: 'rgba(200,146,42,0.15)', border: 'rgba(200,146,42,0.5)', color: 'var(--amber-text)' },
    solid: { bg: 'rgba(76,175,130,0.15)', border: 'rgba(76,175,130,0.5)', color: '#6ECFA3' },
  }

  return (
    <main
      className="min-h-screen px-5 py-12"
      style={{ background: 'var(--surface-base)' }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2].map(n => (
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

            <p className="font-sans text-xs text-center mt-8" style={{ color: 'var(--text-muted)' }}>
              This app uses AI to generate questions and explanations. It can make mistakes —
              please double-check anything that really matters for your exam.
            </p>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div>
            <h1 className="font-serif mb-2" style={{ fontSize: '2.25rem', color: 'var(--text-primary)' }}>
              How confident are you, topic by topic?
            </h1>
            <p className="font-sans text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
              Tap a confidence level for any topic you&apos;ve covered. Skip the rest — one tap each.
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
                    return (
                      <div
                        key={topic.id}
                        className="flex items-center justify-between gap-3 flex-wrap"
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: cov?.covered ? '1px solid rgba(200,146,42,0.35)' : '1px solid var(--surface-border)',
                          background: cov?.covered ? 'var(--amber-soft)' : 'var(--surface-2)',
                        }}
                      >
                        <span
                          className="font-sans text-sm"
                          style={{ color: cov?.covered ? 'var(--amber-text)' : 'var(--text-secondary)' }}
                        >
                          {topic.name}
                        </span>
                        <div className="flex gap-1.5">
                          {(['shaky', 'okay', 'solid'] as Confidence[]).map(conf => {
                            const isActive = cov?.confidence === conf
                            const c = confColors[conf]
                            return (
                              <button
                                key={conf}
                                onClick={() => setConfidence(topic.id, conf)}
                                style={{
                                  padding: '4px 12px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontFamily: 'var(--font-dm-sans)',
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  transition: 'all 150ms ease',
                                  border: isActive ? `1px solid ${c.border}` : '1px solid var(--surface-border)',
                                  background: isActive ? c.bg : 'var(--surface-3)',
                                  color: isActive ? c.color : 'var(--text-secondary)',
                                  textTransform: 'capitalize',
                                }}
                              >
                                {conf}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="flex gap-3 mt-8">
              <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={handleStep2} loading={loading}>
                Finish — go to dashboard →
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
