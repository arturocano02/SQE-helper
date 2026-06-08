'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { UploadIcon, CheckIcon, CloseIcon, BookIcon } from '@/components/ui/Icon'

type UploadMode = 'generate' | 'import'

interface FileEntry {
  file: File
  status: 'pending' | 'processing' | 'done' | 'error'
  step?: string
  chunksDone?: number
  chunksTotal?: number
  pct?: number
  questionsFound?: number
  questions?: number
  error?: string
}

export default function AdminUploadPage() {
  const [mode, setMode] = useState<UploadMode>('import')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [grandTotal, setGrandTotal] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const valid = Array.from(incoming).filter(f => /\.(pdf|docx|txt)$/i.test(f.name))
    setFiles(prev => {
      const existing = new Set(prev.map(e => e.file.name))
      return [...prev, ...valid.filter(f => !existing.has(f.name)).map(f => ({ file: f, status: 'pending' as const }))]
    })
  }

  function removeFile(name: string) {
    setFiles(prev => prev.filter(e => e.file.name !== name))
  }

  function updateFile(name: string, patch: Partial<FileEntry>) {
    setFiles(prev => prev.map(e => e.file.name === name ? { ...e, ...patch } : e))
  }

  async function handleUpload() {
    if (!files.length) return
    setUploading(true)
    setAllDone(false)
    setGrandTotal(0)
    setFiles(prev => prev.map(e => ({ ...e, status: 'processing', step: 'Starting…', pct: 0 })))

    const form = new FormData()
    files.forEach(e => form.append('files', e.file))
    form.append('mode', mode)

    const res = await fetch('/api/admin/upload', { method: 'POST', body: form })
    if (!res.ok || !res.body) {
      setFiles(prev => prev.map(e => ({ ...e, status: 'error', error: 'Upload failed' })))
      setUploading(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      let event = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) {
          try { handleEvent(event, JSON.parse(line.slice(6))) } catch { /* skip */ }
        }
      }
    }
    setUploading(false)
  }

  function handleEvent(event: string, data: Record<string, unknown>) {
    const file = data.file as string | undefined
    switch (event) {
      case 'file_start':
        if (file) updateFile(file, { status: 'processing', step: 'Starting…', pct: 0 })
        break
      case 'step':
        if (file) updateFile(file, { step: data.message as string })
        break
      case 'chunk_progress':
        if (file) updateFile(file, {
          step: data.message as string,
          chunksDone: data.done as number,
          chunksTotal: data.total as number,
          pct: data.pct as number,
          questionsFound: data.questionsFound as number | undefined,
        })
        break
      case 'file_done':
        if (file) updateFile(file, { status: 'done', pct: 100, questions: data.questions as number, step: `Done — ${data.questions} questions` })
        break
      case 'file_error':
        if (file) updateFile(file, { status: 'error', error: data.error as string })
        break
      case 'all_done':
        setGrandTotal(data.total_questions as number)
        setAllDone(true)
        break
    }
  }

  const pendingCount = files.filter(f => f.status === 'pending').length

  return (
    <main className="min-h-screen bg-bg">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        <div>
          <h1 className="font-serif text-3xl text-primary mb-1">Upload Content</h1>
          <p className="text-secondary text-sm">
            Questions land as drafts — review them in the{' '}
            <Link href="/admin/content/questions" className="text-accent hover:underline">Question Bank</Link> before students see them.
          </p>
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            selected={mode === 'import'}
            onClick={() => setMode('import')}
            icon={<BookIcon size={20} />}
            title="Import existing questions"
            desc="PDF or Word file that already contains MCQ questions (e.g. official SQE1 sample papers). Claude extracts them as-is."
            badge="For sample question PDFs"
            badgeColor="accent"
          />
          <ModeCard
            selected={mode === 'generate'}
            onClick={() => setMode('generate')}
            icon={<UploadIcon size={20} />}
            title="Generate from notes"
            desc="Raw revision notes or topic summaries. Claude reads each rule and writes new MCQs and flashcards from scratch."
            badge="For FLK notes / summaries"
            badgeColor="secondary"
          />
        </div>

        {/* Drop zone */}
        {!uploading && !allDone && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-accent/50 hover:bg-surface/40 transition"
          >
            <UploadIcon size={28} className="mx-auto text-secondary mb-3" />
            <p className="text-primary font-medium mb-1">Drop files here or click to browse</p>
            <p className="text-secondary text-sm">PDF, Word (.docx), or plain text — multiple files supported</p>
            <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" multiple className="hidden"
              onChange={e => addFiles(e.target.files)} />
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map(entry => (
              <FileProgressCard key={entry.file.name} entry={entry}
                onRemove={() => removeFile(entry.file.name)}
                canRemove={!uploading && entry.status === 'pending'} />
            ))}
          </div>
        )}

        {/* Large file timing warning */}
        {!uploading && !allDone && files.some(f => f.file.size > 800_000) && (
          <div className="flex gap-2 p-3 bg-warning/5 border border-warning/20 rounded-xl text-xs text-warning">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>
              Large file ({(files.reduce((s,f)=>s+f.file.size,0)/1024).toFixed(0)} KB total) — no section cap, full file will be processed.
              Estimated time: {Math.round(files.reduce((s,f)=>s+f.file.size,0) / 6000 * 1.5 / 60)} min.
              Keep this tab open until complete.
            </span>
          </div>
        )}

        {/* Upload button */}
        {!allDone && (
          <div className="flex items-center gap-3">
            <button onClick={handleUpload} disabled={uploading || pendingCount === 0}
              className="flex items-center gap-2 bg-accent text-bg font-medium px-5 py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed">
              {uploading ? (
                <><span className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />Processing…</>
              ) : (
                <><UploadIcon size={16} />Upload &amp; {mode === 'import' ? 'Import' : 'Generate'}{pendingCount > 0 ? ` (${pendingCount})` : ''}</>
              )}
            </button>
            {files.length > 0 && !uploading && (
              <button onClick={() => { setFiles([]); setAllDone(false) }}
                className="text-sm text-secondary hover:text-primary transition">Clear all</button>
            )}
          </div>
        )}

        {/* Success */}
        {allDone && (
          <div className="p-5 bg-success/5 border border-success/20 rounded-xl">
            <p className="text-success font-medium text-lg mb-1">✓ Done — {grandTotal} draft questions generated</p>
            <p className="text-secondary text-sm mb-4">Review and approve them before students see them.</p>
            <div className="flex gap-3">
              <Link href="/admin/content/questions"
                className="bg-accent text-bg font-medium px-4 py-2 rounded-lg text-sm hover:opacity-90 transition">
                Review Question Bank →
              </Link>
              <button onClick={() => { setFiles([]); setAllDone(false) }}
                className="border border-border text-secondary px-4 py-2 rounded-lg text-sm hover:bg-surface2 transition">
                Upload more
              </button>
            </div>
          </div>
        )}

        {/* How it works */}
        {!uploading && (
          <div className="p-5 bg-surface border border-border rounded-xl">
            <p className="text-primary text-sm font-medium mb-3">
              {mode === 'import' ? 'Import mode — how it works' : 'Generate mode — how it works'}
            </p>
            {mode === 'import' ? (
              <div className="space-y-2 text-xs text-secondary">
                <Step n={1} text="PDF is extracted to text" />
                <Step n={2} text="Claude reads the questions exactly as written and maps each to a topic slug" />
                <Step n={3} text="Each question is saved as a draft with correct A–E options and explanation intact" />
                <Step n={4} text="You approve them in the Question Bank — then they're live for all users" />
              </div>
            ) : (
              <div className="space-y-2 text-xs text-secondary">
                <Step n={1} text="File is split at ALL CAPS section headers (matching FLK notes structure)" />
                <Step n={2} text="Each section sent to Claude Haiku — generates 3 MCQs (easy/medium/hard) + 1 flashcard per rule" />
                <Step n={3} text="Questions land as drafts — approve before students see them" />
                <Step n={4} text="Claude is called once per source file, not per user — cost paid once" />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function ModeCard({ selected, onClick, icon, title, desc, badge, badgeColor }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode
  title: string; desc: string; badge: string; badgeColor: 'accent' | 'secondary'
}) {
  return (
    <button onClick={onClick} className={[
      'text-left p-4 rounded-xl border transition',
      selected ? 'border-accent bg-accent-dim' : 'border-border bg-surface hover:bg-surface2',
    ].join(' ')}>
      <div className={`mb-2 ${selected ? 'text-accent' : 'text-secondary'}`}>{icon}</div>
      <p className={`font-medium text-sm mb-1 ${selected ? 'text-accent' : 'text-primary'}`}>{title}</p>
      <p className="text-xs text-secondary leading-relaxed mb-2">{desc}</p>
      <span className={`text-xs border rounded-full px-2 py-0.5 ${
        badgeColor === 'accent' ? 'border-accent/40 text-accent' : 'border-border text-muted'
      }`}>{badge}</span>
    </button>
  )
}

function FileProgressCard({ entry, onRemove, canRemove }: {
  entry: FileEntry; onRemove: () => void; canRemove: boolean
}) {
  const { file, status, step, pct, chunksDone, chunksTotal, questionsFound, questions, error } = entry
  const borderBg =
    status === 'done' ? 'border-success/30 bg-success/5' :
    status === 'error' ? 'border-error/30 bg-error/5' :
    status === 'processing' ? 'border-accent/20 bg-surface' : 'border-border bg-surface'

  return (
    <div className={`border rounded-xl p-4 ${borderBg}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {status === 'done' && <CheckIcon size={16} className="text-success" />}
          {status === 'error' && <CloseIcon size={16} className="text-error" />}
          {status === 'processing' && <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin block" />}
          {status === 'pending' && <UploadIcon size={16} className="text-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-primary text-sm font-medium truncate">{file.name}</p>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</span>
              {canRemove && <button onClick={onRemove} className="text-xs text-muted hover:text-error transition">Remove</button>}
              {status === 'done' && <span className="text-xs font-medium text-success">{questions} questions</span>}
            </div>
          </div>
          {step && <p className={`text-xs mb-2 ${status === 'done' ? 'text-success' : status === 'error' ? 'text-error' : 'text-secondary'}`}>{step}</p>}
          {error && !step && <p className="text-xs text-error mb-2">{error}</p>}

          {status === 'processing' && chunksTotal !== undefined && (
            <div>
              <div className="h-1.5 bg-surface2 rounded-full overflow-hidden mb-1">
                <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${pct ?? 0}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>{chunksDone !== undefined ? `Section ${chunksDone} of ${chunksTotal}` : 'Processing…'}</span>
                <span className="flex gap-3">
                  {!!questionsFound && <span className="text-accent">{questionsFound} found</span>}
                  <span>{pct ?? 0}%</span>
                </span>
              </div>
            </div>
          )}
          {status === 'done' && <div className="h-1.5 bg-success/20 rounded-full"><div className="h-full bg-success rounded-full w-full" /></div>}
        </div>
      </div>
    </div>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-4 h-4 rounded-full bg-surface2 border border-border text-muted flex items-center justify-center text-[10px] shrink-0 mt-0.5">{n}</span>
      <span>{text}</span>
    </div>
  )
}
