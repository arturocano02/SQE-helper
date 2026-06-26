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
  // 'paused' = a batch stopped (network drop, or server reported a recoverable partial
  // failure) but chunks saved so far are safe in the DB — clicking Resume just continues
  // from the last checkpoint instead of restarting the whole document.
  status: 'idle' | 'running' | 'done' | 'error' | 'paused'
  message: string
  sectionsTotal?: number
  sectionsDone?: number
  chunksFound?: number
  /** Questions mode only — how many sample questions couldn't be matched to any existing
   *  chunk. Shown to the admin instead of those questions silently disappearing. */
  unmatchedFound?: number
  /** Section paths found by the parser — shown so admin can verify all topics were detected */
  sectionsFound?: string[]
  /** Heading styles the parser auto-detected in this document and the level assigned to each —
   *  shown so a misread hierarchy (wrong style ranked as the wrong level) is visible before
   *  extraction runs, since the parser discovers formatting conventions per-document rather
   *  than assuming a fixed colour scheme. */
  headingStyles?: Array<{ level: number; kind: string; sample: string; count: number; source: string }>
  /** The document's Contents/TOC page, parsed into headings + page numbers instead of being
   *  extracted as garbage chunks — shown so the admin can confirm the parser read the
   *  document's intended topic/subtopic structure before extraction tags content against it. */
  outline?: Array<{ title: string; page: number | null; level: number }>
  /** Auto-run once extraction finishes (notes-mode .docx only) — re-parses the real file and
   *  diffs it against the chunks just saved, so "did this actually read the whole thing" has an
   *  answer with numbers attached instead of just trusting that every section was visited. */
  verify?: { status: 'running' | 'done' | 'error'; sectionsTotal?: number; sectionsCovered?: number; charCoveragePct?: number; missingCount?: number; thinCount?: number; message?: string }
}

/** One section's original text next to what actually got saved as chunks — the raw material
 *  for the "first 5 pages" manual read-through, requested directly so gaps/rewording can be
 *  caught by eye instead of only trusting coverage percentages. */
interface PreviewSection {
  section: string
  page: number | null
  original_content: string
  original_chars: number
  chunks: Array<{ rule_text: string; rule_type: string }>
  chunk_chars: number
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; sections: PreviewSection[]; usedPageNumbers: boolean }
  | { status: 'error'; message: string }

/**
 * Phase 1 state for notes-mode .docx files — read-and-confirm the Contents page BEFORE any
 * real chunk extraction is allowed to run, so TOC bullet lines never reach a Claude extraction
 * call in the first place (the previous approach kept filtering them back out after the fact,
 * which never quite caught every shape of TOC noise).
 */
interface OutlinePhaseState {
  status: 'idle' | 'loading' | 'ready' | 'confirming' | 'confirmed' | 'error'
  entries?: Array<{ title: string; page: number | null; level: number }>
  frontMatterPageEnd?: number
  message?: string
}

export default function AdminUploadPage() {
  const [fileType, setFileType] = useState<FileType>('notes')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [chunkTopicId, setChunkTopicId] = useState<string>('')
  const [paperFilter, setPaperFilter] = useState<'all' | 'FLK1' | 'FLK2'>('all')
  const [chunkExtraction, setChunkExtraction] = useState<Record<string, ChunkExtractionState>>({})
  const [outlinePhase, setOutlinePhase] = useState<Record<string, OutlinePhaseState>>({})
  const [preview, setPreview] = useState<Record<string, PreviewState>>({})
  const [topics, setTopics] = useState<Topic[]>([])
  const [wiping, setWiping] = useState(false)
  // null = not checked yet, 0 = checked and genuinely empty, >0 = has chunks.
  // Sample questions only ever match against chunks that already exist — checking this
  // up front means the admin sees "this won't work yet" before they upload anything,
  // not just after the extraction API call fails.
  const [topicChunkCount, setTopicChunkCount] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards against overlapping extraction loops for the same file. Without this, clicking
  // Resume while an earlier loop is still alive (e.g. it's mid-backoff-sleep after a transient
  // error, not actually dead) stacks a second concurrent extractChunks() run on top of the
  // first. Both then hammer the same source_material_id — the server's "extracting" lock
  // (chunk_status) rejects whichever one loses the race with a 409, that loop's retry/backoff
  // kicks in, and now there are two (or more) zombie loops fighting forever, which looks exactly
  // like "pausing and resuming on its own" even though the admin isn't clicking anything.
  const activeExtractions = useRef<Set<string>>(new Set())
  // Files whose chunks are already extracted and have been tucked out of the way of the active
  // upload flow. Previously-uploaded files (loaded from the DB on mount) start archived
  // automatically — only files finished in THIS browser session stay visible until the admin
  // explicitly archives them, so they get to see the "done" state once before it's hidden.
  const [archivedFiles, setArchivedFiles] = useState<Set<string>>(new Set())
  // Set by the manual Pause button. Checked once per batch boundary (the only safe place to
  // stop — mid-batch the server has already committed whatever it committed) rather than
  // aborting the in-flight fetch, so nothing partially-written is left in a weird state.
  const pauseRequested = useRef<Set<string>>(new Set())

  useEffect(() => {
    createClient().from('topics').select('*').order('sort_order').then(({ data }) => {
      setTopics((data ?? []) as Topic[])
    })
  }, [])

  // Load previously-uploaded source_materials on mount. Without this, navigating away mid-
  // extraction (or just refreshing the page) loses all visibility into a file's progress —
  // the only state that existed was populated by handleUpload() during the current browser
  // session, so a paused/in-progress document looked like it had vanished even though every
  // chunk extracted so far was safely persisted in the DB. This re-hydrates uploadedFiles,
  // chunkExtraction, and outlinePhase from the real DB state so Resume works without re-
  // uploading anything. A ?resume=<source_material_id> query param (used by the Resume link
  // on the /admin dashboard) just makes sure that file's extraction starts automatically once
  // loaded, and switches fileType to match it if it's a sample-questions file.
  useEffect(() => {
    const resumeId = new URLSearchParams(window.location.search).get('resume')

    createClient()
      .from('source_materials')
      .select('id, file_name, file_type, chunk_status, chunks_extracted, chunk_error, chunk_sections_done, chunk_sections_total, chunk_outline, chunk_outline_confirmed, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data: rawData, error }) => {
        if (error || !rawData || rawData.length === 0) return

        // Repeated re-uploads of the same file (e.g. while troubleshooting an extraction issue,
        // before realising Resume/Backfill/Reset exist) leave several source_materials rows with
        // the same file_name. Every list below is keyed by file_name, so without deduping here,
        // each repeat upload rendered as its own row sharing that key — React only ever showed
        // one of them, and which one (sometimes an old, near-empty attempt instead of the real,
        // fully-extracted one) was undefined. That's almost certainly what looked like "my
        // extracted document disappears". Since rawData is already ordered newest-first, keeping
        // only the first occurrence per file_name keeps the most recent attempt and discards the
        // stale duplicates from view (their chunks/questions are untouched in the DB either way).
        const seenNames = new Set<string>()
        const data = rawData.filter(m => {
          if (seenNames.has(m.file_name)) return false
          seenNames.add(m.file_name)
          return true
        })

        setUploadedFiles(prev => {
          const known = new Set(prev.map(p => p.source_material_id))
          const knownNames = new Set(prev.map(p => p.file.name))
          const loaded: UploadedFile[] = data
            .filter(m => !known.has(m.id) && !knownNames.has(m.file_name))
            .map(m => ({
              // No real File object exists for a row loaded from the DB — this stand-in only
              // needs `.name`, the one property every render path in this file actually reads.
              file: { name: m.file_name } as File,
              status: 'done',
              source_material_id: m.id,
              chars_extracted: 0,
              error: null,
            }))
          return [...loaded, ...prev]
        })

        setChunkExtraction(prev => {
          const next = { ...prev }
          for (const m of data) {
            if (next[m.file_name]) continue // don't clobber state from an upload in this same session
            if (m.chunk_status === 'extracted') {
              next[m.file_name] = { status: 'done', message: '', chunksFound: m.chunks_extracted }
            } else if (m.chunk_status === 'failed' && !m.chunks_extracted) {
              next[m.file_name] = { status: 'error', message: m.chunk_error ?? 'Extraction failed' }
            } else if (m.chunk_status === 'pending' || m.chunk_status === 'extracting' || m.chunk_status === 'failed') {
              // 'extracting' rows are included here too — if that run actually died, the
              // server's stale-lock takeover (90s) will reclaim it on the next batch; if it's
              // still alive, the 409 conflict-wait logic in extractChunks handles that safely.
              if ((m.chunks_extracted ?? 0) > 0 || (m.chunk_sections_done ?? 0) > 0) {
                next[m.file_name] = {
                  status: 'paused',
                  message: '',
                  chunksFound: m.chunks_extracted,
                  sectionsDone: m.chunk_sections_done ?? undefined,
                  sectionsTotal: m.chunk_sections_total ?? undefined,
                }
              }
              // else: leave unset — shows the normal "Extract chunks →" / outline-read flow
            }
          }
          return next
        })

        setArchivedFiles(prev => {
          const next = new Set(prev)
          for (const m of data) {
            if (m.chunk_status === 'extracted' && (m.chunks_extracted ?? 0) > 0) next.add(m.file_name)
          }
          return next
        })

        setOutlinePhase(prev => {
          const next = { ...prev }
          for (const m of data) {
            if (next[m.file_name]) continue
            if (m.chunk_outline_confirmed && m.chunk_outline) {
              next[m.file_name] = {
                status: 'confirmed',
                entries: m.chunk_outline.entries,
                frontMatterPageEnd: m.chunk_outline.frontMatterPageEnd,
              }
            } else if (m.chunk_outline) {
              next[m.file_name] = {
                status: 'ready',
                entries: m.chunk_outline.entries,
                frontMatterPageEnd: m.chunk_outline.frontMatterPageEnd,
              }
            }
          }
          return next
        })

        if (resumeId) {
          const resumeMaterial = data.find(m => m.id === resumeId)
          if (resumeMaterial) {
            if (resumeMaterial.file_type === 'questions') setFileType('questions')
            // Give state updates above a tick to land before kicking off the loop.
            setTimeout(() => extractChunks(resumeMaterial.file_name, resumeMaterial.id), 300)
          }
        }
      })
    // Intentionally run once on mount only — re-running on every chunkExtraction/outlinePhase
    // change would re-fetch and could stomp in-progress local state with stale DB reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sample questions no longer need one topic picked for the whole file — the admin only picks
  // the paper (FLK1/FLK2) and each question's topic is auto-detected. So the up-front "will this
  // even work" check has to look across every topic in that paper, not one chunkTopicId.
  useEffect(() => {
    if (fileType !== 'questions' || paperFilter === 'all' || topics.length === 0) {
      setTopicChunkCount(null)
      return
    }
    let cancelled = false
    setTopicChunkCount(null)
    const topicIds = topics.filter(t => t.paper === paperFilter).map(t => t.id)
    if (topicIds.length === 0) { setTopicChunkCount(0); return }
    createClient()
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .in('topic_id', topicIds)
      .then(({ count }) => { if (!cancelled) setTopicChunkCount(count ?? 0) })
    return () => { cancelled = true }
  }, [fileType, paperFilter, topics])

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

  /**
   * Runs ONE small batch (a handful of sections / question-groups) against
   * /api/admin/chunks/extract and reports back what stage it ended on.
   * The server persists progress after every individual unit inside the batch, so even if
   * the fetch itself throws (dropped wifi, closed laptop lid) nothing already saved is lost —
   * the caller just needs to call this again to resume from the checkpoint.
   */
  /**
   * Phase 1 — parse-only read of the Contents page. No Claude calls, just OOXML parsing, so
   * this is fast (a couple of seconds even for a long document). Persists the outline server
   * side so the confirm step (and a page refresh) doesn't lose it.
   */
  async function readOutline(fileName: string, sourceMaterialId: string) {
    setOutlinePhase(prev => ({ ...prev, [fileName]: { status: 'loading' } }))
    try {
      const res = await fetch('/api/admin/chunks/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_material_id: sourceMaterialId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setOutlinePhase(prev => ({ ...prev, [fileName]: { status: 'error', message: body?.error ?? 'Failed to read Contents page' } }))
        return
      }
      setOutlinePhase(prev => ({
        ...prev,
        [fileName]: { status: 'ready', entries: body.outline ?? [], frontMatterPageEnd: body.frontMatterPageEnd ?? 0 },
      }))
    } catch (err) {
      setOutlinePhase(prev => ({ ...prev, [fileName]: { status: 'error', message: err instanceof Error ? err.message : 'Failed to read Contents page' } }))
    }
  }

  /** Phase 1 confirmation — unlocks Phase 2 (the real extraction batches) for this file. */
  async function confirmOutline(fileName: string, sourceMaterialId: string) {
    setOutlinePhase(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: 'confirming' } }))
    try {
      const res = await fetch('/api/admin/chunks/outline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_material_id: sourceMaterialId, confirmed: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setOutlinePhase(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: 'error', message: body?.error ?? 'Failed to confirm' } }))
        return
      }
      setOutlinePhase(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: 'confirmed' } }))
    } catch (err) {
      setOutlinePhase(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: 'error', message: err instanceof Error ? err.message : 'Failed to confirm' } }))
    }
  }

  async function runOneBatch(fileName: string, sourceMaterialId: string): Promise<'done' | 'batch_done' | 'error' | 'conflict'> {
    const topic = topics.find(t => t.id === chunkTopicId)
    console.log(`[extract] → POST batch for "${fileName}" (source_material_id=${sourceMaterialId})`)

    let res: Response
    try {
      res = await fetch('/api/admin/chunks/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_material_id: sourceMaterialId,
          extraction_mode: fileType,
          // Sample questions: no topic select anymore — just the paper, so the server
          // auto-detects each question's topic and matches it against that topic's chunks.
          // Notes mode keeps the optional manual override (blank = auto-detect from headers).
          ...(fileType === 'questions'
            ? (paperFilter !== 'all' ? { paper: paperFilter } : {})
            : (topic ? { topic_id: topic.id, topic_name: topic.name } : {})),
        }),
      })
    } catch (err) {
      console.error(`[extract] fetch threw for "${fileName}":`, err)
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: { ...prev[fileName], status: 'paused', message: 'Connection lost — click Resume to continue from where it left off.' },
      }))
      return 'error'
    }

    // 409 = the server already has a batch in flight for this source material — almost always
    // because a previous loop for this same file is still alive (e.g. mid-backoff-sleep, not
    // actually dead) and a second one got started on top of it, typically by clicking
    // Resume/Extract again before the first run had actually stopped. Auto-retrying a 409 just
    // makes two loops collide forever — instead, back off and let the OTHER loop own this file.
    if (res.status === 409) {
      const body = await res.json().catch(() => null)
      console.warn(`[extract] 409 for "${fileName}" — another run already owns this file:`, body)
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: { ...prev[fileName], status: 'running', message: 'Already running in another tab/loop — waiting for it to finish…' },
      }))
      return 'conflict'
    }

    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null)
      console.error(`[extract] request failed for "${fileName}" (status ${res.status}):`, body)
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: { ...prev[fileName], status: 'paused', message: `Request failed${body?.error ? ` — ${body.error}` : ''} — click Resume to continue from where it left off.` },
      }))
      return 'error'
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let finalStage: 'done' | 'batch_done' | 'error' = 'error'

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
          if (ev.stage === 'done' || ev.stage === 'batch_done' || ev.stage === 'error') {
            finalStage = ev.stage
            console.log(`[extract] "${fileName}" → ${ev.stage}: ${ev.message ?? ''}`)
          }
          setChunkExtraction(prev => {
            const existing = prev[fileName] ?? {}
            // Treat batch_done the same as running in the UI — there's another batch coming
            // right behind it, so the progress bar should read as continuous, not stop-start.
            const chunksFoundSoFar = ev.chunks_found ?? existing.chunksFound
            const partial = ev.stage === 'error' && (chunksFoundSoFar ?? 0) > 0
            return {
              ...prev,
              [fileName]: {
                ...existing,
                status: ev.stage === 'done' ? 'done'
                  : ev.stage === 'error' ? (partial ? 'paused' : 'error')
                  : 'running',
                message: ev.message ?? '',
                sectionsTotal: ev.sections_total ?? existing.sectionsTotal,
                sectionsDone: ev.sections_done ?? existing.sectionsDone,
                chunksFound: chunksFoundSoFar,
                unmatchedFound: ev.unmatched_found ?? existing.unmatchedFound,
                // Latch the section list once we receive it — don't overwrite with undefined later
                sectionsFound: ev.sections_found ?? existing.sectionsFound,
                headingStyles: ev.heading_styles ?? existing.headingStyles,
                outline: ev.outline ?? existing.outline,
              },
            }
          })
        } catch { /* skip */ }
      }
    }

    return finalStage
  }

  /**
   * Kicks off extraction, then keeps calling runOneBatch automatically as long as the
   * server reports "batch_done" (more work left, just resumed by the next request).
   *
   * Long documents (e.g. an 85-page sample paper) take many batches, and any one of them
   * can hit a transient blip (a dropped connection, a momentary 5xx). Rather than stopping
   * the whole run and making the admin manually click Resume after every blip, a transient
   * error is retried automatically (with backoff) up to MAX_AUTO_RETRIES times. Each batch
   * that did succeed has already persisted its chunks/matches to the DB, so a retry only
   * ever re-does the one batch that failed — nothing already saved is at risk. Only after
   * exhausting the retries does this surface a "paused" state for the admin to resume by hand.
   */
  async function extractChunks(fileName: string, sourceMaterialId: string) {
    // Refuse to start a second loop for a file that already has one running. This is the fix
    // for the "pauses and resumes by itself" symptom: without this guard, a click on Resume
    // while a previous loop was still alive (e.g. asleep mid-backoff after a transient error,
    // not actually finished) would start a second concurrent loop, and the two would fight
    // over the same source_material_id forever, each bouncing the UI between running/paused.
    if (activeExtractions.current.has(fileName)) {
      console.warn(`[extract] "${fileName}" already has an active extraction loop — ignoring duplicate start.`)
      return
    }
    activeExtractions.current.add(fileName)
    console.log(`[extract] "${fileName}" — starting extraction loop`)

    try {
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: { ...(prev[fileName] ?? {}), status: 'running', message: 'Starting…' },
      }))

      const MAX_AUTO_RETRIES = 8
      const MAX_CONFLICT_WAITS = 15
      let consecutiveErrors = 0
      let consecutiveConflicts = 0
      let stage: 'done' | 'batch_done' | 'error' | 'conflict' = 'batch_done'

      while (
        stage === 'batch_done' ||
        (stage === 'error' && consecutiveErrors <= MAX_AUTO_RETRIES) ||
        (stage === 'conflict' && consecutiveConflicts <= MAX_CONFLICT_WAITS)
      ) {
        if (stage === 'error') {
          consecutiveErrors++
          await new Promise(r => setTimeout(r, Math.min(2000 * 2 ** (consecutiveErrors - 1), 20000)))
          setChunkExtraction(prev => ({
            ...prev,
            [fileName]: { ...prev[fileName], status: 'running', message: `Retrying after a dropped batch (attempt ${consecutiveErrors}/${MAX_AUTO_RETRIES})…` },
          }))
        } else if (stage === 'conflict') {
          // Someone/something else (another tab, a stale loop) currently owns this file server-side.
          // Wait it out rather than hammering — the server's own staleness check will reclaim the
          // lock after 90s if that other run actually died, so this only needs to outlast that.
          consecutiveConflicts++
          await new Promise(r => setTimeout(r, 5000))
        } else {
          consecutiveErrors = 0
          consecutiveConflicts = 0
        }
        stage = await runOneBatch(fileName, sourceMaterialId)
        if (stage !== 'error') consecutiveErrors = 0
        if (stage !== 'conflict') consecutiveConflicts = 0

        // Manual pause — only honoured between batches (see ref comment above), so whatever
        // the batch that just finished saved is safe; nothing is left half-written.
        if (stage === 'batch_done' && pauseRequested.current.has(fileName)) {
          pauseRequested.current.delete(fileName)
          console.log(`[extract] "${fileName}" — paused by user request`)
          setChunkExtraction(prev => ({
            ...prev,
            [fileName]: { ...prev[fileName], status: 'paused', message: 'Paused — click Resume to continue from where it left off.' },
          }))
          return
        }
      }

      if (stage === 'conflict') {
        console.error(`[extract] "${fileName}" — gave up after ${MAX_CONFLICT_WAITS} conflict waits, still locked by another run.`)
        setChunkExtraction(prev => ({
          ...prev,
          [fileName]: { ...prev[fileName], status: 'paused', message: 'Still locked by another run — wait a minute, then click Resume.' },
        }))
      }
      console.log(`[extract] "${fileName}" — extraction loop exited (final stage: ${stage})`)

      // Done doesn't mean complete — it means every section was visited. Whether what was
      // found in each section actually made it into the DB intact is a separate question, and
      // is exactly what got missed before (chunk_status read "extracted" while ~88% of one
      // real document's content had silently been dropped). Run the same check automatically
      // instead of relying on the admin to remember to ask for it.
      if (stage === 'done' && fileType === 'notes' && /\.docx$/i.test(fileName)) {
        await verifyExtraction(fileName, sourceMaterialId)
      }
    } finally {
      activeExtractions.current.delete(fileName)
    }
  }

  /** Re-parses the real file and diffs it against the chunks just saved — no AI calls, fast.
   *  Logs the full report to the console either way, and surfaces a short summary inline so a
   *  gap doesn't require opening dev tools to notice. */
  async function verifyExtraction(fileName: string, sourceMaterialId: string) {
    setChunkExtraction(prev => ({
      ...prev,
      [fileName]: { ...prev[fileName], verify: { status: 'running' } },
    }))
    try {
      const res = await fetch('/api/admin/chunks/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_material_id: sourceMaterialId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        console.error(`[verify] "${fileName}" failed:`, json?.error)
        setChunkExtraction(prev => ({
          ...prev,
          [fileName]: { ...prev[fileName], verify: { status: 'error', message: json?.error ?? 'Verify failed' } },
        }))
        return
      }
      console.log(
        `[verify] "${fileName}" — ${json.sections_covered}/${json.sections_total} sections covered, ` +
        `${json.char_coverage_pct}% characters captured` +
        (json.sections_missing > 0 ? `, MISSING sections: ${JSON.stringify(json.missing_sections)}` : '') +
        (json.thin_sections?.length > 0 ? `, THIN sections: ${JSON.stringify(json.thin_sections)}` : '')
      )
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: {
          ...prev[fileName],
          verify: {
            status: 'done',
            sectionsTotal: json.sections_total,
            sectionsCovered: json.sections_covered,
            charCoveragePct: json.char_coverage_pct,
            missingCount: json.sections_missing,
            thinCount: json.thin_sections?.length ?? 0,
          },
        },
      }))
    } catch (err) {
      console.error(`[verify] "${fileName}" threw:`, err)
      setChunkExtraction(prev => ({
        ...prev,
        [fileName]: { ...prev[fileName], verify: { status: 'error', message: err instanceof Error ? err.message : 'Verify failed' } },
      }))
    }
  }

  /** Loads the first ~5 pages' worth of sections, original text next to what got saved as
   *  chunks, so the admin can read it directly rather than only trusting coverage percentages. */
  async function loadPreview(fileName: string, sourceMaterialId: string) {
    setPreview(prev => ({ ...prev, [fileName]: { status: 'loading' } }))
    try {
      const res = await fetch('/api/admin/chunks/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_material_id: sourceMaterialId, page_limit: 5 }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setPreview(prev => ({ ...prev, [fileName]: { status: 'error', message: json?.error ?? 'Preview failed' } }))
        return
      }
      setPreview(prev => ({ ...prev, [fileName]: { status: 'done', sections: json.sections ?? [], usedPageNumbers: !!json.used_page_numbers } }))
    } catch (err) {
      setPreview(prev => ({ ...prev, [fileName]: { status: 'error', message: err instanceof Error ? err.message : 'Preview failed' } }))
    }
  }

  // Deletes every source_materials row, knowledge_chunk, question, and the per-user history/SRS
  // rows that exist solely because of those questions — a true blank slate, for when picking
  // through a pile of duplicate/half-finished uploads (left over from troubleshooting before
  // Resume/Backfill/Reset existed) isn't worth it and starting over is simpler.
  async function wipeEverything() {
    if (!window.confirm(
      'Delete EVERY source material, knowledge chunk, and question — and the answer history / spaced-repetition rows tied to those questions? This cannot be undone. Nothing about topics or user accounts is touched.'
    )) return
    if (!window.confirm('Really sure? This wipes the entire content pipeline back to zero.')) return
    setWiping(true)
    try {
      const res = await fetch('/api/admin/content/full-reset', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        alert(json?.error ?? 'Reset failed')
        return
      }
      window.location.href = '/admin/content/upload'
    } finally {
      setWiping(false)
    }
  }

  const activeUploadedFiles = uploadedFiles.filter(f => !archivedFiles.has(f.file.name))
  const archivedUploadedFiles = uploadedFiles.filter(f => archivedFiles.has(f.file.name))
  const readyToExtract = activeUploadedFiles.filter(f => f.status === 'done' && f.source_material_id)

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl mb-1" style={{ color: 'var(--text-primary)' }}>Upload Content</h1>
            <p className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
              Files are saved, then you extract knowledge chunks. Questions are generated later from the{' '}
              <Link href="/admin/content/chunks" style={{ color: 'var(--amber-text)' }} className="hover:underline">
                Knowledge Graph
              </Link>.
            </p>
          </div>
          <button
            onClick={wipeEverything}
            disabled={wiping}
            title="Delete every source material, knowledge chunk, and question — full reset back to zero"
            style={{
              background: 'rgba(248,113,113,0.10)',
              color: 'var(--status-wrong)',
              fontFamily: 'var(--font-dm-sans)',
              fontWeight: 500,
              fontSize: 12,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid rgba(248,113,113,0.3)',
              cursor: wiping ? 'not-allowed' : 'pointer',
              opacity: wiping ? 0.5 : 1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            className="hover:brightness-110"
          >
            {wiping ? 'Wiping…' : 'Wipe everything & start fresh ↺'}
          </button>
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
            desc="Official SRA sample question papers (.pdf). Pick FLK1 or FLK2 only — Claude auto-detects each question's topic and matches it to an existing knowledge chunk from notes, extracting style/difficulty signal only. It never creates new chunks."
            badge="requires notes first"
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
        {activeUploadedFiles.length > 0 && (
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
              {activeUploadedFiles.map(entry => {
                const extraction = chunkExtraction[entry.file.name]
                const fullyExtracted = extraction?.status === 'done'
                return (
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
                    {fullyExtracted && (
                      <button
                        onClick={() => setArchivedFiles(prev => new Set(prev).add(entry.file.name))}
                        title="Tuck this away — you can still find it under Previously uploaded"
                        style={{
                          background: 'transparent', border: '1px solid var(--surface-border)', color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-dm-sans)', fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        Done — move to history
                      </button>
                    )}
                  </div>
                </div>
                )
              })}
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
                    : 'Claude classifies each question\'s topic on its own, matches it to a chunk that already exists for that topic (extracted from notes), then records the verbatim answer, the trap it sets, and how hard it really is. No new chunks are created here — only existing ones are enriched with style/difficulty signal.'
                  }
                </p>

                <label className="block mb-3">
                  <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    Which paper is this?{' '}
                    {fileType === 'questions' ? (
                      <span style={{ color: 'var(--status-warning)' }}>
                        — required, no topic to pick: each question's topic is auto-detected and matched to its own chunk
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>— narrows the topic list below to the right 6 topics</span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    {([
                      ['all', 'Not sure'],
                      ['FLK1', 'FLK1'],
                      ['FLK2', 'FLK2'],
                    ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setPaperFilter(val)
                          // Clear any topic pick from the other paper so a stale selection
                          // can't silently stay applied after narrowing the list.
                          if (val !== 'all' && chunkTopicId) {
                            const current = topics.find(t => t.id === chunkTopicId)
                            if (current && current.paper !== val) setChunkTopicId('')
                          }
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 7,
                          fontSize: 12,
                          fontFamily: 'var(--font-dm-sans)',
                          border: paperFilter === val ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                          background: paperFilter === val ? 'var(--amber-soft)' : 'transparent',
                          color: paperFilter === val ? 'var(--amber-text)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </label>

                {fileType === 'notes' && (
                  <label className="block mb-5">
                    <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                      Topic override{' '}<span style={{ color: 'var(--text-muted)' }}>— leave blank to auto-detect from section headers</span>
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
                      {topics
                        .filter(t => paperFilter === 'all' || t.paper === paperFilter)
                        .map(t => <option key={t.id} value={t.id}>{t.name} ({t.paper})</option>)}
                    </select>
                  </label>
                )}

                {fileType === 'questions' && paperFilter !== 'all' && topicChunkCount === 0 && (
                  <div
                    className="flex items-start gap-2.5 mb-5 px-4 py-3 rounded-lg"
                    style={{ background: 'rgba(224,90,90,0.08)', border: '1px solid rgba(224,90,90,0.3)' }}
                  >
                    <span style={{ color: '#E87878', fontSize: 14, lineHeight: '1.4' }}>⚠</span>
                    <p className="font-sans text-xs" style={{ color: '#E87878', lineHeight: 1.6 }}>
                      No knowledge chunks exist yet for any {paperFilter} topic — extraction will not work. Upload and
                      extract revision notes first; sample questions only match against chunks that already exist,
                      they never create new ones.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  {readyToExtract.map(f => {
                    const state = chunkExtraction[f.file.name]
                    const isRunning = state?.status === 'running'
                    const isDone = state?.status === 'done'
                    const isError = state?.status === 'error'
                    const isPaused = state?.status === 'paused'
                    const notStarted = !state
                    const needsTopic = fileType === 'questions' && paperFilter === 'all'
                    const noChunksYet = fileType === 'questions' && paperFilter !== 'all' && topicChunkCount === 0
                    // Notes .docx files have a Contents page that must be read and confirmed
                    // (Phase 1) before Phase 2 (real extraction) is allowed to run — this is
                    // what stops TOC bullet lines from ever reaching extraction at all, rather
                    // than relying on filtering them back out afterwards. Other file types
                    // (sample-question PDFs, plain .txt notes) have no TOC concept and skip this.
                    const isDocxNotes = fileType === 'notes' && /\.docx$/i.test(f.file.name)
                    const outline = outlinePhase[f.file.name]
                    const outlineConfirmed = outline?.status === 'confirmed'
                    const blocked = needsTopic || noChunksYet || (isDocxNotes && !outlineConfirmed)

                    return (
                      <div key={f.file.name}>
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="font-sans text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {f.file.name}
                          </p>
                          {notStarted && isDocxNotes && !outlineConfirmed && (
                            <div className="flex items-center gap-2 shrink-0">
                              {(!outline || outline.status === 'idle' || outline.status === 'error') && (
                                <button
                                  onClick={() => readOutline(f.file.name, f.source_material_id!)}
                                  style={{
                                    background: 'var(--amber)', color: '#0A0A08', fontFamily: 'var(--font-dm-sans)',
                                    fontWeight: 500, fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                  }}
                                  className="hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                                >
                                  Step 2a — Read Contents →
                                </button>
                              )}
                              {outline?.status === 'loading' && (
                                <span className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>Reading Contents page…</span>
                              )}
                              {outline?.status === 'ready' && (
                                <button
                                  onClick={() => confirmOutline(f.file.name, f.source_material_id!)}
                                  style={{
                                    background: 'var(--status-correct)', color: '#0A0A08', fontFamily: 'var(--font-dm-sans)',
                                    fontWeight: 500, fontSize: 12, padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                  }}
                                  className="hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                                >
                                  ✓ Confirm — looks right, continue
                                </button>
                              )}
                              {outline?.status === 'confirming' && (
                                <span className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>Confirming…</span>
                              )}
                            </div>
                          )}
                          {notStarted && (!isDocxNotes || outlineConfirmed) && (
                            <button
                              onClick={() => !blocked && extractChunks(f.file.name, f.source_material_id!)}
                              disabled={blocked}
                              title={
                                needsTopic ? 'Select FLK1 or FLK2 above first — needed to auto-match each question to its topic'
                                : noChunksYet ? `No knowledge chunks exist yet for any ${paperFilter} topic — extract revision notes first`
                                : undefined
                              }
                              style={{
                                background: blocked ? 'var(--surface-3)' : 'var(--amber)',
                                color: blocked ? 'var(--text-muted)' : '#0A0A08',
                                fontFamily: 'var(--font-dm-sans)',
                                fontWeight: 500,
                                fontSize: 12,
                                padding: '6px 14px',
                                borderRadius: 6,
                                border: 'none',
                                cursor: blocked ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                              className={blocked ? '' : 'hover:brightness-110 active:scale-[0.98] transition-all duration-150'}
                            >
                              {needsTopic ? 'Select FLK1 or FLK2 first' : noChunksYet ? 'No chunks for this paper yet' : 'Extract chunks →'}
                            </button>
                          )}
                          {isDone && (
                            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--status-correct)' }}>
                              ✓ {state.chunksFound} {fileType === 'questions' ? 'questions matched' : 'chunks saved'}
                              {fileType === 'questions' && !!state.unmatchedFound && (
                                <span style={{ color: 'var(--status-warning)' }}>
                                  {' '}· {state.unmatchedFound} flagged unmatched — review manually
                                </span>
                              )}
                            </span>
                          )}
                          {isError && (
                            <span className="font-sans text-xs shrink-0" style={{ color: 'var(--status-wrong)' }}>
                              Failed — {state.message}
                            </span>
                          )}
                          {isPaused && (
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-sans text-xs" style={{ color: 'var(--status-warning)' }}>
                                Paused — {state.chunksFound ?? 0} chunks saved so far
                              </span>
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
                                }}
                                className="hover:brightness-110 active:scale-[0.98] transition-all duration-150"
                              >
                                Resume →
                              </button>
                            </div>
                          )}
                          {isRunning && (
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-sans text-xs" style={{ color: 'var(--amber-text)' }}>
                                {state.chunksFound ?? 0} found
                              </span>
                              <button
                                onClick={() => pauseRequested.current.add(f.file.name)}
                                title="Stops after the current batch finishes — nothing saved is lost, click Resume later to continue"
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-secondary)',
                                  fontFamily: 'var(--font-dm-sans)',
                                  border: '1px solid var(--surface-border)',
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                                className="hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150"
                              >
                                Pause
                              </button>
                            </div>
                          )}
                        </div>

                        {outline?.status === 'error' && (
                          <p className="font-sans text-xs mt-1" style={{ color: 'var(--status-wrong)' }}>
                            {outline.message}
                          </p>
                        )}

                        {(outline?.status === 'ready' || outline?.status === 'confirming' || outline?.status === 'confirmed') && (
                          <div className="mt-2 mb-2">
                            <p className="font-sans text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                              {outlineConfirmed ? '✓ Contents confirmed — ' : ''}
                              Contents page read — {(outline.entries ?? []).length} headings/subheadings found
                              {typeof outline.frontMatterPageEnd === 'number' && outline.frontMatterPageEnd > 0 && (
                                <> · real content starts at page {outline.frontMatterPageEnd + 1}</>
                              )}
                            </p>
                            <div
                              className="rounded-lg overflow-y-auto"
                              style={{ maxHeight: 220, background: 'var(--surface-2)', border: '1px solid var(--surface-border)', padding: '8px 10px' }}
                            >
                              {(outline.entries ?? []).map((o, i) => (
                                <p
                                  key={i}
                                  className="font-mono text-[10px] leading-5"
                                  style={{ color: 'var(--text-secondary)', paddingLeft: Math.max(0, o.level - 1) * 14 }}
                                >
                                  {o.title}{o.page !== null ? ` — p.${o.page}` : ''}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

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

                        {(isRunning || isDone) && state.outline && state.outline.length > 0 && (
                          <details className="mt-2 mb-1">
                            <summary
                              className="font-sans text-[11px] cursor-pointer select-none"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Contents page read — {state.outline.length} headings/subheadings found, used to help tag topics below
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
                              {state.outline.map((o, i) => (
                                <p
                                  key={i}
                                  className="font-mono text-[10px] leading-5"
                                  style={{ color: 'var(--text-secondary)', paddingLeft: Math.max(0, (o.level - 1)) * 14 }}
                                >
                                  {o.title}{o.page !== null ? ` — p.${o.page}` : ''}
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

                        {state?.verify?.status === 'running' && (
                          <p className="font-sans text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            ⟳ Checking coverage — re-reading the file and comparing against what was saved…
                          </p>
                        )}
                        {state?.verify?.status === 'error' && (
                          <p className="font-sans text-[11px] mt-2" style={{ color: 'var(--status-wrong)' }}>
                            Coverage check failed — {state.verify.message}
                          </p>
                        )}
                        {state?.verify?.status === 'done' && (() => {
                          const v = state.verify!
                          const allGood = (v.missingCount ?? 0) === 0 && (v.thinCount ?? 0) === 0
                          return (
                            <p
                              className="font-sans text-[11px] mt-2"
                              style={{ color: allGood ? 'var(--status-correct)' : 'var(--status-wrong)' }}
                            >
                              {allGood ? '✓ Coverage check passed' : '⚠ Coverage gaps found'} —{' '}
                              {v.sectionsCovered}/{v.sectionsTotal} sections, {v.charCoveragePct}% of characters captured
                              {!allGood && (
                                <>
                                  {(v.missingCount ?? 0) > 0 && ` · ${v.missingCount} sections missing entirely`}
                                  {(v.thinCount ?? 0) > 0 && ` · ${v.thinCount} thin`}
                                  {' — see the same file on the '}
                                  <Link href="/admin" style={{ color: 'var(--status-wrong)', textDecoration: 'underline' }}>admin dashboard</Link>
                                  {' for the full list, or check the browser console for this run\'s log.'}
                                </>
                              )}
                            </p>
                          )
                        })()}

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
                            {fileType === 'notes' && /\.docx$/i.test(f.file.name) && (preview[f.file.name]?.status ?? 'idle') === 'idle' && (
                              <button
                                onClick={() => loadPreview(f.file.name, f.source_material_id!)}
                                style={{
                                  fontSize: 12,
                                  color: 'var(--text-secondary)',
                                  fontFamily: 'var(--font-dm-sans)',
                                  border: '1px solid var(--surface-border)',
                                  padding: '5px 12px',
                                  borderRadius: 6,
                                  background: 'transparent',
                                  cursor: 'pointer',
                                }}
                                className="hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-150"
                              >
                                Preview first 5 pages →
                              </button>
                            )}
                          </div>
                        )}

                        {preview[f.file.name]?.status === 'loading' && (
                          <p className="font-sans text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            ⟳ Loading original text and saved chunks for the first 5 pages…
                          </p>
                        )}
                        {preview[f.file.name]?.status === 'error' && (
                          <p className="font-sans text-[11px] mt-2" style={{ color: 'var(--status-wrong)' }}>
                            Preview failed — {(preview[f.file.name] as { message: string }).message}
                          </p>
                        )}
                        {preview[f.file.name]?.status === 'done' && (() => {
                          const p = preview[f.file.name] as { status: 'done'; sections: PreviewSection[]; usedPageNumbers: boolean }
                          return (
                            <div className="mt-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <p className="font-sans text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                  {p.sections.length} section{p.sections.length === 1 ? '' : 's'}
                                  {p.usedPageNumbers ? ' on pages 1–5' : ' (no page numbers detected — showing first sections in document order)'}
                                  {' '}— original text on the left of each block, what got saved as chunks below it.
                                </p>
                                <button
                                  onClick={() => setPreview(prev => ({ ...prev, [f.file.name]: { status: 'idle' } }))}
                                  style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                  Hide
                                </button>
                              </div>
                              <div
                                className="rounded-lg overflow-y-auto space-y-3"
                                style={{ maxHeight: 480, background: 'var(--surface-2)', border: '1px solid var(--surface-border)', padding: 12 }}
                              >
                                {p.sections.map((s, i) => {
                                  const zeroChunks = s.chunks.length === 0
                                  const looksThin = s.original_chars > 200 && s.chunk_chars < s.original_chars * 0.6
                                  return (
                                    <div
                                      key={i}
                                      className="rounded-md"
                                      style={{
                                        border: `1px solid ${zeroChunks ? 'rgba(248,113,113,0.4)' : looksThin ? 'rgba(251,191,36,0.4)' : 'var(--surface-border)'}`,
                                        padding: 10,
                                      }}
                                    >
                                      <p className="font-mono text-[10px] mb-1.5" style={{ color: 'var(--amber-text)' }}>
                                        {s.section}
                                        {zeroChunks && <span style={{ color: 'var(--status-wrong)' }}> — ⚠ NO CHUNKS SAVED</span>}
                                        {!zeroChunks && looksThin && <span style={{ color: 'var(--status-warning)' }}> — ⚠ thin ({s.chunk_chars}/{s.original_chars} chars)</span>}
                                      </p>
                                      <p className="font-sans text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>Original text ({s.original_chars} chars):</p>
                                      <pre
                                        className="font-mono text-[10px] whitespace-pre-wrap mb-2"
                                        style={{ color: 'var(--text-secondary)', maxHeight: 120, overflowY: 'auto', background: 'var(--surface-1)', borderRadius: 4, padding: 6 }}
                                      >
                                        {s.original_content}
                                      </pre>
                                      <p className="font-sans text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                                        Saved as {s.chunks.length} chunk{s.chunks.length === 1 ? '' : 's'} ({s.chunk_chars} chars):
                                      </p>
                                      {s.chunks.length > 0 ? (
                                        <ol className="space-y-1">
                                          {s.chunks.map((c, ci) => (
                                            <li key={ci} className="font-mono text-[10px]" style={{ color: 'var(--text-primary)', background: 'var(--surface-1)', borderRadius: 4, padding: 6 }}>
                                              [{c.rule_type}] {c.rule_text}
                                            </li>
                                          ))}
                                        </ol>
                                      ) : (
                                        <p className="font-mono text-[10px]" style={{ color: 'var(--status-wrong)' }}>(nothing — this section has zero saved chunks)</p>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Previously uploaded — files whose chunks are already extracted, tucked out of the
            way so this page stays about whatever's actively being worked on. Each one can be
            brought back into the active list above to re-check or re-extract it. */}
        {archivedUploadedFiles.length > 0 && (
          <details className="mb-8" style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12 }}>
            <summary
              className="font-sans text-sm font-medium cursor-pointer"
              style={{ color: 'var(--text-secondary)', padding: '14px 18px' }}
            >
              Previously uploaded ({archivedUploadedFiles.length})
            </summary>
            <div className="divide-y" style={{ borderColor: 'var(--surface-border)' }}>
              {archivedUploadedFiles.map(entry => (
                <div key={entry.file.name} className="flex items-center gap-3" style={{ padding: '12px 18px' }}>
                  <CheckIcon size={14} />
                  <span className="font-sans text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                    {entry.file.name}
                  </span>
                  {chunkExtraction[entry.file.name]?.status === 'done' && (
                    <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {chunkExtraction[entry.file.name]?.chunksFound ?? 0} chunks
                    </span>
                  )}
                  <button
                    onClick={() => setArchivedFiles(prev => { const next = new Set(prev); next.delete(entry.file.name); return next })}
                    style={{
                      background: 'transparent', border: '1px solid var(--surface-border)', color: 'var(--amber-text)',
                      fontFamily: 'var(--font-dm-sans)', fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    Bring back
                  </button>
                </div>
              ))}
            </div>
          </details>
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
                : 'Match to Knowledge Graph — pick FLK1 or FLK2 only. Claude auto-detects each question\'s topic, matches it to an existing chunk, and records style/difficulty signal. Requires notes already extracted; never creates new chunks.'
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
