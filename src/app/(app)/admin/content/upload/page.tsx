'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { UploadIcon, CheckIcon, CloseIcon, BookIcon } from '@/components/ui/Icon'
import { createClient } from '@/lib/supabase/client'
import type { Topic } from '@/types/database'

/**
 * Upload page — chunk-first architecture.
 *
 * Step 1: Upload file(s). The server extracts text and saves to source_materials.
 *         No questions are generated here.
 *
 * Step 2: Extract Knowledge Chunks. Admin clicks "Extract Chunks →" per file.
 *         Streams SSE from /api/admin/chunks/extract. Extraction mode:
 *           - 'notes'     → revision notes (.docx) — extracts legal rules section by section
 *           - 'questions' → sample MCQ paper (.pdf) — extracts rules being tested by each question
 *
 * Step 3: Review chunks in the Knowledge Graph, then generate questions from there.
 */

type FileType = 'notes' | 'questions'

interface UploadedFile {
  file: File
  status: 'uploading' | 'done' | 'error'
  source_material_id: string | null
  chars_extracted: number
  error: string | null
}

interface ChunkExtractionState {
  status: 'idle' | 'running' | 'done' | 'error'
  message: string
  sectionsTotal?: number
  sectionsDone?: number
  chunksFound?: number
  /** Section paths found by the parser — shown so admin can verify all topics were detected */
  sectionsFound?: string[]
  /** Heading styles the parser auto-detected in this document and the level assigned to each —
   *  shown so a misread hierarchy (wrong style ranked as the wrong level) is visible before
   *  extraction runs, since the parser discovers formatting conventions per-document rather
   *  than assuming a fixed colour scheme. */
  headingStyles?: Array<{ level: number; kind: string; sample: string; count: number; source: string }>
}

export default function AdminUploadPage() {
  const [fileType, setFileType] = useState<FileType>('notes')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [chunkTopicId, setChunkTopicId] = useState<string>('')
  const [chunkExtraction, setChunkExtraction] = useState<Record<string, ChunkExtractionState>>({})
  const [topics, setTopics] = useState<Topic[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    createClient().from('topics').select('*').order('sort_order').then(({ data }) => {
      setTopics((data ?? []) as Topic[])
    })
  }, [])

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter(f => /\.(pdf|docx|txt)$/i.test(f.name))
    setPendingFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !existing.has(f.name))]
    })
  }

  async function handleUpload() {
    if (!pendingFiles.length) return
    setUploading(true)

    const form = new FormData()
    pendingFiles.forEach(f => form.append('files', f))

    // Initialise all as uploading
    const uploading_entries: UploadedFile[] = pendingFiles.map(f => ({
      file: f,
      status: 'uploading',
      source_material_id: null,
      chars_extracted: 0,
      error: null,
    }))
    setUploadedFiles(prev => [...prev, ...uploading_entries])
    setPendingFiles([])

    try {
      const res = await fetch('/api/admin/upload', { method: 'POST', body: form })
      const json = await res.json() as { results: Array<{ file: string; source_material_id: string | null; chars_extracted: number; error: string | null }> }

      setUploadedFiles(prev => prev.map(entry => {
        const result = json.results.find(r => r.file === entry.file.name)
        if (!result) return entry
        return {
          ...entry,
          status: result.error ? 'error' : 'done',
          source_material_id: result.source_material_id,
          chars_extracted: result.chars_extracted,
          error: result.error,
        }
      }))
    } catch {
      setUploadedFiles(prev => prev.map(e =>
        e.status === 'uploading' ? { ...e, status: 'error', error: 'Upload failed' } : e
      ))
    } finally {
      setUploading(false)
    }
  }

  async function extractChunks(fileName: string, sourceMaterialId: string) {
    const topic = topics.find(t => t.id === chunkTopicId)
    setChunkExtraction(prev => ({ ...prev, [fileName]: { status: 'running', message: 'Starting…' } }))

    const res = await fetch('/api/admin/chunks/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_material_id: sourceMaterialId,
        extraction_mode: fileType,
        ...(topic ? { topic_id: topic.id, topic_name: topic.name } : {}),
      }),
    })

    if (!res.ok || !res.body) {
      setChunkExtraction(prev => ({ ...prev, [fileName]: { status: 'error', message: 'Request failed' } }))
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const ev = JSON.parse(line.slice(6))
          setChunkExtraction(prev => {
            const existing = prev[fileName] ?? {}
            return {
              ...prev,
              [fileName]: {
                ...existing,
                status: ev.stage === 'done' ? 'done' : ev.stage === 'error' ? 'error' : 'running',
                message: ev.message ?? '',
                sectionsTotal: ev.sections_total ?? existing.sectionsTotal,
                sectionsDone: ev.sections_done ?? existing.sectionsDone,
                chunksFound: ev.chunks_found ?? existing.chunksFound,
                // Latch the section list once we receive it — don't overwrite with undefined later
                sectionsFound: ev.sections_found ?? existing.sectionsFound,
                headingStyles: ev.heading_styles ?? existing.headingStyles,
              },
            }
          })
        } catch { /* skip */ }
      }
    }
  }

  const readyToExtract = uploadedFiles.filter(f => f.status === 'done' && f.source_material_id)

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="font-serif text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>Upload Content</h1>
          <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            Files are saved, then you extract knowledge chunks. Questions are generated later from the{' '}
            <Link href="/admin/content/chunks" style={{ color: 'var(--amber-text)' }} className="hover:underline">
              Knowledge Graph
            </Link>.
          </p>
        </div>

        {/* File type selector */}
        <div className="grid grid-cols-2 gap-3">
          <TypeCard
            selected={fileType === 'notes'}
            onClick={() => setFileType('notes')}
            icon={<UploadIcon size={20} />}
            title="Revision Notes"
            desc="Your FLK notes or topic summaries (.docx). Claude reads each section and extracts every distinct legal rule."
            badge=".docx recommended"
            badgeColor="accent"
          />
          <TypeCard
            selected={fileType === 'questions'}
            onClick={() => setFileType('questions')}
            icon={<BookIcon size={20} />}
            title="Sample Questions"
            desc="Official SRA sample question papers (.pdf). Claude reads each MCQ and extracts the legal rule being tested."
            badge=".pdf"
            badgeColor="secondary"
          />
        </div>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          style={{
            border: '2px dashed var(--surface-border)',
            borderRadius: 14,
            padding: '36px 24px',
            textAlign: 'center',
            cursor: 'pointer',
          }}
          className="hover:border-[rgba(200,146,42,0.4)] hover:bg-[rgba(200,146,42,0.03)] transition-all duration-200"
        >
          <span style={{ color: 'var(--text-secondary)', display: 'block', width: 'fit-content', margin: '0 auto 10px' }}>
            <UploadIcon size={26} />
          </span>
          <p className="font-sans font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
            Drop files here or click to browse
          </p>
          <p className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
            PDF, Word (.docx), or plain text — multiple files supported
          </p>
          <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" multiple className="hidden"
            onChange={e => addFiles(e.target.files)} />
        </div>

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="space-y-2">
            {pendingFiles.map(f => (
              <div
                key={f.name}
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}><UploadIcon size={14} /></span>
                <span className="font-sans text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  onClick={() => setPendingFiles(prev => prev.filter(p => p.name !== f.name))}
                  className="font-sans text-xs"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload button */}
        {pendingFiles.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleUpload}
              disabled={uploading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 500,
                fontSize: 14,
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.5 : 1,
              }}
              className="hover:brightness-110 active:scale-[0.98] transition-all duration-150"
            >
              {uploading ? (
                <>
                  <span className="w-4 h-4 border-2 border-[rgba(10,10,8,0.4)] border-t-[#0A0A08] rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <UploadIcon size={16} />
                  Upload {pendingFiles.length > 1 ? `${pendingFiles.length} files` : pendingFiles[0]?.name}
                </>
              )}
            </button>
            {!uploading && (
              <button
                onClick={() => setPendingFiles([])}
                className="font-sans text-sm"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Uploaded files + extract controls */}
        {uploadedFiles.length > 0 && (
          <div
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--surface-border)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {/* Uploaded files list */}
            <div className="divide-y" style={{ borderColor: 'var(--surface-border)' }}>
              {uploadedFiles.map(entry => (
                <div key={entry.file.name} style={{ padding: '14px 18px' }}>
                  <div className="flex items-center gap-3">
                    <span style={{ color: entry.status === 'done' ? 'var(--status-correct)' : entry.status === 'error' ? 'var(--status-wrong)' : 'var(--amber)' }}>
                      {entry.status === 'done' && <CheckIcon size={15} />}
                      {entry.status === 'error' && <CloseIcon size={15} />}
                      {entry.status === 'uploading' && (
                        <span className="w-3.5 h-3.5 rounded-full animate-spin block"
                          style={{ border: '2px solid var(--amber)', borderTopColor: 'transparent' }} />
                      )}
                    </span>
                    <span className="font-sans text-sm font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                      {entry.file.name}
                    </span>
                    {entry.status === 'done' && (
                      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {(entry.chars_extracted / 1000).toFixed(0)}k chars extracted
                      </span>
                    )}
                    {entry.status === 'error' && (
                      <span className="font-sans text-xs" style={{ color: 'var(--status-wrong)' }}>
                        {entry.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Extract chunks panel — shown once any file is done */}
            {readyToExtract.length > 0 && (
              <div
                style={{
                  borderTop: '1px solid var(--surface-border)',
                  borderLeft: '3px solid var(--amber)',
                  background: 'rgba(200,146,42,0.03)',
                  padding: 20,
                }}
              >
                <p className="font-sans font-medium text-sm mb-1" style={{ color: 'var(--amber-text)' }}>
                  Step 2 — Extract Knowledge Chunks
                </p>
                <p className="font-sans text-xs mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {fileType === 'notes'
                    ? 'Claude reads each section of your notes and extracts every distinct legal rule as an atomic chunk. These become the verified source of truth for generating questions.'
                    : 'Claude reads each MCQ and extracts the underlying legal rule being tested — not the question itself, but the rule a student must know. These seed the knowledge graph.'
                  }
                </p>

                <label className="block mb-5">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Topic override{' '}
                    <span style={{ color: 'var(--text-muted)' }}>
                      — leave blank to auto-detect from section headers
                    </span>
                  </span>
                  <select
                    value={chunkTopicId}
                    onChange={e => setChunkTopicId(e.target.value)}
                    style={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: 8,
                      color: chunkTopicId ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontFamily: 'var(--font-dm-sans)',
                      fontSize: 13,
                      padding: '8px 12px',
                      width: '100%',
                    }}
                  >
                    <option value="">Auto-detect (recommended)</option>
                    {topics.map(t => <option key={t.id} value={t.id}>{t.name} ({t.paper})</option>)}
                  </select>
                </label>

                <div className="space-y-4">
                  {readyToExtract.map(f => {
                    const state = chunkExtraction[f.file.name]
                    const isRunning = state?.status === 'running'
                    const isDone = state?.status === 'done'
                    const isError = state?.status === 'error'
                    const notStarted = !state

                    return (
                      <div key={f.file.name}>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="font-sans text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {f.file.name}
                          </p>
                          {notStarted && (
                            <button
                              onClick={() => extractChunks(f.file.name, f.source_material_id!)}
                              style={{
                                background: 'var(--amber)',
                                color: '#0A0A08',
                                fontFamily: 'var(--font-dm-sans)',
                                fontWeight: 500,
                                fontSize: 12,
                                padding: '6px 14px',
                                borderRadius: 6,
                                border: 'none',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                              className="hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                            >
                              Extract chunks →
                            </button>
                          )}
                          {isDone && (
                            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--status-correct)' }}>
                              ✓ {state.chunksFound} chunks saved
                            </span>
                          )}
                          {isError && (
                            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--status-wrong)' }}>
                              Failed — {state.message}
                            </span>
                          )}
                          {isRunning && (
                            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--amber-text)' }}>
                              {state.chunksFound ?? 0} found
                            </span>
                          )}
                        </div>

                        {(isRunning || isDone) && state.sectionsFound && (
                          <details
                            className="mt-2 mb-1"
                            open={isRunning}
                          >
                            <summary
                              className="font-sans text-[11px] cursor-pointer select-none"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {state.sectionsFound.length} sections found — click to verify all topics detected
                            </summary>
                            <div
                              className="mt-1 rounded-lg overflow-y-auto"
                              style={{
                                maxHeight: 180,
                                background: 'var(--surface-2)',
                                border: '1px solid var(--surface-border)',
                                padding: '8px 10px',
                              }}
                            >
                              {state.sectionsFound.map((s, i) => (
                                <p key={i} className="font-mono text-[10px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                                  {s}
                                </p>
                              ))}
                            </div>
                          </details>
                        )}

                        {(isRunning || isDone) && state.headingStyles && state.headingStyles.length > 0 && (
                          <details className="mt-2 mb-1">
                            <summary
                              className="font-sans text-[11px] cursor-pointer select-none"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {state.headingStyles.length} heading styles detected — click to check the hierarchy was read correctly
                            </summary>
                            <div
                              className="mt-1 rounded-lg overflow-y-auto"
                              style={{
                                maxHeight: 220,
                                background: 'var(--surface-2)',
                                border: '1px solid var(--surface-border)',
                                padding: '8px 10px',
                              }}
                            >
                              {state.headingStyles.map((h, i) => (
                                <p key={i} className="font-mono text-[10px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                                  L{h.level} {h.kind} ({h.source === 'word-style' ? 'Word style' : 'visual'}, ×{h.count}) — &quot;{h.sample}&quot;
                                </p>
                              ))}
                            </div>
                          </details>
                        )}

                        {isRunning && (
                          <div>
                            <p className="font-sans text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {state.message}
                            </p>
                            {state.sectionsTotal !== undefined && state.sectionsTotal > 0 && (
                              <div>
                                <div
                                  className="rounded-full overflow-hidden mb-1"
                                  style={{ height: 3, background: 'var(--surface-3)' }}
                                >
                                  <div
                                    className="h-full rounded-full progress-fill transition-all duration-500"
                                    style={{
                                      width: `${Math.round(((state.sectionsDone ?? 0) / state.sectionsTotal) * 100)}%`,
                                    }}
                                  />
                                </div>
                                <div className="flex justify-between">
                                  <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    {state.sectionsDone ?? 0} / {state.sectionsTotal}
                                  </span>
                                  <span className="font-mono text-[11px]" style={{ color: 'var(--amber-text)' }}>
                                    {state.chunksFound ?? 0} chunks
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {isDone && (
                          <div className="flex gap-3 mt-2">
                            <Link
                              href="/admin/content/chunks"
                              style={{
                                fontSize: 12,
                                color: 'var(--amber-text)',
                                fontFamily: 'var(--font-dm-sans)',
                                border: '1px solid rgba(200,146,42,0.35)',
                                padding: '5px 12px',
                                borderRadius: 6,
                              }}
                              className="hover:bg-[rgba(200,146,42,0.06)] transition-colors duration-150"
                            >
                              Review in Knowledge Graph →
                            </Link>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--surface-border)',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <p className="font-sans text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            How it works — 3 steps
          </p>
          <div className="space-y-2">
            <Step n={1} text="Upload — file is saved and text is extracted. No AI calls yet." />
            <Step n={2} text={
              fileType === 'notes'
                ? 'Extract Chunks — Claude reads each section and extracts every distinct legal rule as an atomic chunk.'
                : 'Extract Chunks — Claude reads each MCQ and extracts the legal rule being tested (not the question itself).'
            } />
            <Step n={3} text="Generate Questions — from the Knowledge Graph, approve chunks and generate questions. Every question is cited to its source chunk." />
          </div>
        </div>

      </div>
    </main>
  )
}

function TypeCard({ selected, onClick, icon, title, desc, badge, badgeColor }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode
  title: string; desc: string; badge: string; badgeColor: 'accent' | 'secondary'
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: 16,
        borderRadius: 12,
        border: selected ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
        background: selected ? 'var(--amber-soft)' : 'var(--surface-1)',
        cursor: 'pointer',
        transition: 'all 150ms ease',
        width: '100%',
      }}
    >
      <div style={{ marginBottom: 8, color: selected ? 'var(--amber)' : 'var(--text-secondary)' }}>{icon}</div>
      <p className="font-sans font-medium text-sm mb-1"
        style={{ color: selected ? 'var(--amber-text)' : 'var(--text-primary)' }}>
        {title}
      </p>
      <p className="font-sans text-xs leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>
        {desc}
      </p>
      <span
        className="font-sans text-xs px-2 py-0.5 rounded-full"
        style={{
          border: badgeColor === 'accent' ? '1px solid rgba(200,146,42,0.4)' : '1px solid var(--surface-border)',
          color: badgeColor === 'accent' ? 'var(--amber-text)' : 'var(--text-muted)',
        }}
      >
        {badge}
      </span>
    </button>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-2">
      <span
        className="font-sans flex items-center justify-center text-[10px] shrink-0 mt-0.5 rounded-full"
        style={{
          width: 18, height: 18,
          border: '1px solid var(--surface-border)',
          color: 'var(--text-muted)',
          background: 'var(--surface-2)',
        }}
      >
        {n}
      </span>
      <span className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>{text}</span>
    </div>
  )
}
