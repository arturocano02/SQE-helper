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

  // Step 1
  const [examDate, setExamDate] = useState('')
  const [prepLevel, setPrepLevel] = useState<PrepLevel | null>(null)

  // Step 2
  const [coverage, setCoverage] = useState<Map<string, TopicCoverage>>(new Map())

  // Step 3
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
    supabase.from('topics').select('*').order('sort_order').then(({ data }) => {
      if (data) setTopics(data as Topic[])
    })
  }, [])

  // Step 1 → save to profiles
  async function handleStep1() {
    if (!userId) return
    setLoading(true)
    const supabase = createClient()
    await supabase.from('profiles').update({
      exam_date: examDate || null,
    }).eq('id', userId)
    setLoading(false)
    setStep(2)
  }

  // Toggle topic coverage
  function toggleTopic(topicId: string) {
    setCoverage(prev => {
      const next = new Map(prev)
      const current = next.get(topicId)
      if (current?.covered) {
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

  // Step 2 → save coverage + mastery
  async function handleStep2() {
    if (!userId) return
    setLoading(true)
    const supabase = createClient()

    const coverageRows = Array.from(coverage.values())
      .filter(c => c.covered && c.confidence)
      .map(c => ({
        user_id: userId,
        topic_id: c.topicId,
        confidence: c.confidence!,
      }))

    if (coverageRows.length > 0) {
      await supabase.from('user_topic_coverage').upsert(coverageRows)

      const masteryRows = coverageRows.map(c => ({
        user_id: userId,
        topic_id: c.topic_id,
        mastery_score: masteryFromConfidence(c.confidence as Confidence),
      }))
      await supabase.from('user_topic_mastery').upsert(masteryRows)
    }

    // Mark onboarding reached step 3
    await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId)

    setLoading(false)
    setStep(3)
  }

  // Step 3 → import file
  async function handleImport() {
    if (!file) return
    setImporting(true)
    const form = new FormData()
    form.append('file', file)
    await fetch('/api/import', { method: 'POST', body: form })
    setImporting(false)
    setImportDone(true)
  }

  function finish() {
    router.push('/home')
  }

  const flk1Topics = topics.filter(t => t.paper === 'FLK1')
  const flk2Topics = topics.filter(t => t.paper === 'FLK2')

  return (
    <main className="min-h-screen bg-bg px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-10">
          {[1, 2, 3].map(n => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                n === step ? 'w-8 bg-accent' : n < step ? 'w-4 bg-accent/40' : 'w-4 bg-surface2'
              }`}
            />
          ))}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div>
            <h1 className="font-serif text-4xl text-primary mb-2">Let's get you set up</h1>
            <p className="text-secondary mb-8">A few quick questions so we can personalise your study plan.</p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm text-secondary mb-2">When is your SQE1 exam? (optional)</label>
                <input
                  type="date"
                  value={examDate}
                  onChange={e => setExamDate(e.target.value)}
                  className="bg-surface2 border border-border text-primary px-3 py-2 rounded-lg focus:border-accent focus:outline-none w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-secondary mb-3">How far into your SQE1 prep are you?</label>
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
                      className={[
                        'px-4 py-3 rounded-lg border text-sm text-left transition',
                        prepLevel === opt.value
                          ? 'bg-accent-dim border-accent text-accent'
                          : 'bg-surface2 border-border text-secondary hover:bg-surface',
                      ].join(' ')}
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
            <h1 className="font-serif text-4xl text-primary mb-2">Which topics have you covered?</h1>
            <p className="text-secondary mb-8">Select the topics you've studied, then rate your confidence.</p>

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
                          className={[
                            'w-full text-left px-4 py-3 rounded-lg border transition',
                            isCovered
                              ? 'bg-accent-dim border-accent text-accent'
                              : 'bg-surface2 border-border text-secondary hover:bg-surface',
                          ].join(' ')}
                        >
                          {topic.name}
                        </button>
                        {isCovered && (
                          <div className="flex gap-2 mt-2 ml-1">
                            <span className="text-xs text-muted self-center">Confidence:</span>
                            {(['shaky', 'okay', 'solid'] as Confidence[]).map(conf => (
                              <button
                                key={conf}
                                onClick={e => { e.stopPropagation(); setConfidence(topic.id, conf) }}
                                className={[
                                  'px-4 py-1.5 rounded-lg text-xs font-medium border transition capitalize',
                                  cov?.confidence === conf
                                    ? conf === 'shaky' ? 'bg-error/20 border-error text-error'
                                      : conf === 'okay' ? 'bg-warning/20 border-warning text-warning'
                                      : 'bg-success/20 border-success text-success'
                                    : 'bg-surface2 border-border text-secondary hover:bg-surface hover:text-primary',
                                ].join(' ')}
                              >
                                {conf}
                              </button>
                            ))}
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
            <h1 className="font-serif text-4xl text-primary mb-2">Personalise your starting point</h1>
            <p className="text-secondary mb-3">
              The platform already has a full question bank — you can start studying right now.
            </p>
            <p className="text-secondary mb-8">
              <strong className="text-primary">Optionally</strong>, upload your own revision notes or wrong-answer logs. We'll read them to understand where you've been struggling, and weight your early sessions towards those areas.
            </p>

            {/* What gets uploaded clarification */}
            <div className="bg-surface2 border border-border rounded-xl p-4 mb-6 text-sm text-secondary space-y-1">
              <p>✓ Your notes are <strong className="text-primary">private to you</strong> — they are never added to the shared question bank</p>
              <p>✓ We extract weak areas and seed your mastery scores — nothing more</p>
              <p>✓ You can also upload more notes later from your profile</p>
            </div>

            {!importDone ? (
              <div className="bg-surface border border-border rounded-xl p-6">
                <label className="block text-sm text-secondary mb-3">
                  Upload a PDF, Word (.docx), or text file
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border file:border-border file:bg-surface2 file:text-primary hover:file:bg-surface file:cursor-pointer"
                />
                {file && (
                  <p className="mt-2 text-xs text-muted">Selected: {file.name}</p>
                )}

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
              <div className="bg-surface border border-border rounded-xl p-6 text-center">
                <div className="text-success text-4xl mb-3">✓</div>
                <p className="text-primary mb-1">Notes imported</p>
                <p className="text-secondary text-sm mb-6">Your weak areas have been identified. Sessions will start there.</p>
                <Button onClick={finish}>Go to Dashboard →</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
