'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SourceMaterial } from '@/types/database'

interface SourceMaterialRowProps {
  material: SourceMaterial
}

// chunk_status is the real, currently-maintained status field (see chunk-extractor.ts /
// /api/admin/chunks/extract) — the older `status` column on this table predates the
// chunk-first architecture and is no longer updated by anything, so it's not used here.
const statusConfig: Record<string, { color: string; label: string }> = {
  extracted:  { color: 'var(--status-correct)', label: '✓ Extracted' },
  extracting: { color: 'var(--status-warning)', label: '⟳ Extracting' },
  pending:    { color: 'var(--status-warning)', label: '⏸ Paused' },
  failed:     { color: 'var(--status-wrong)',   label: '✗ Failed' },
}

type BackfillState =
  | { status: 'idle' }
  | { status: 'running'; message: string }
  | { status: 'done'; message: string }
  | { status: 'error'; message: string }

export default function SourceMaterialRow({ material: m }: SourceMaterialRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [backfill, setBackfill] = useState<BackfillState>({ status: 'idle' })
  const [resetting, setResetting] = useState(false)

  // Full wipe-and-restart, for when the topic-resolution bug (see backfill's comment above)
  // dropped so much of a document that patching individual missing sections isn't worth it.
  // Deletes this file's existing chunks (and any questions generated from them) and resets its
  // status to 'pending' so the normal extraction flow — now fixed — can run again from the same
  // already-uploaded .docx. No re-upload needed.
  async function runReset() {
    if (!window.confirm(
      `Delete every chunk already extracted from "${m.file_name}" (and any questions generated from them), then re-extract from scratch using the fixed topic detection?\n\nThis can't be undone.`
    )) return
    setResetting(true)
    try {
      const res = await fetch('/api/admin/chunks/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_material_id: m.id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        alert(json?.error ?? 'Reset failed')
        return
      }
      window.location.href = `/admin/content/upload?resume=${m.id}`
    } finally {
      setResetting(false)
    }
  }

  // Recovery for documents that already finished a full extraction pass under the old topic-
  // detection logic. Headings that didn't literally match one of the 12 SQE1 topic names (e.g.
  // "TRADITIONAL PARTNERSHIPS", "Sole trader") silently dropped every chunk underneath them —
  // chunk_status reads "extracted" because every leaf section WAS visited, but many of their
  // chunks never made it into the DB. Each call to /api/admin/chunks/backfill re-checks (fresh
  // DB read, no separate checkpoint) which sections currently have zero chunks and fills in one
  // small batch, so it's safe to keep calling until remaining_missing hits 0.
  async function runBackfill() {
    setBackfill({ status: 'running', message: 'Checking for missing sections…' })
    let consecutiveErrors = 0
    const MAX_AUTO_RETRIES = 5
    let filledTotal = 0
    while (true) {
      let res: Response
      try {
        res = await fetch('/api/admin/chunks/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_material_id: m.id }),
        })
      } catch {
        consecutiveErrors++
        if (consecutiveErrors > MAX_AUTO_RETRIES) {
          setBackfill({ status: 'error', message: 'Connection lost too many times — click Backfill again to retry.' })
          return
        }
        await new Promise(r => setTimeout(r, Math.min(2000 * 2 ** (consecutiveErrors - 1), 15000)))
        continue
      }
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setBackfill({ status: 'error', message: json?.error ?? 'Backfill failed' })
        return
      }
      consecutiveErrors = 0
      if (json.total_missing_before === 0) {
        setBackfill({ status: 'done', message: 'Nothing missing — every section already had chunks.' })
        return
      }
      filledTotal += json.chunks_inserted_this_batch
      setBackfill({
        status: json.done ? 'done' : 'running',
        message: json.done
          ? `Done — recovered ${filledTotal} chunks across the missing sections.`
          : `Recovered ${filledTotal} chunks so far · ${json.remaining_missing} sections still missing`,
      })
      if (json.done) return
    }
  }

  const sectionsTotal = m.chunk_sections_total ?? 0
  const sectionsDone = m.chunk_sections_done ?? 0
  // Once chunk_status is 'extracted' the document is done regardless of whether
  // chunk_sections_total ever got persisted (e.g. very old rows from before that
  // column existed) — don't show a misleading partial percentage in that case.
  const progressPct = m.chunk_status === 'extracted'
    ? 100
    : sectionsTotal > 0
      ? Math.round((sectionsDone / sectionsTotal) * 100)
      : 0

  const date = new Date(m.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  const statusCfg = statusConfig[m.chunk_status] ?? { color: 'var(--text-secondary)', label: m.chunk_status }
  const needsResume = m.chunk_status === 'pending' || m.chunk_status === 'failed'

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 150ms ease' }}
        className="hover:bg-surface2"
      >
        <td className="p-4">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.file_name}</p>
          {m.chunk_error && (
            <p className="text-[11px] mt-0.5 truncate max-w-xs" style={{ color: 'var(--status-wrong)' }}>
              {m.chunk_error}
            </p>
          )}
        </td>
        <td className="p-4">
          <span
            className="uppercase text-[10px] font-mono px-2 py-0.5 rounded"
            style={{
              background: 'var(--surface-3)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-secondary)',
            }}
          >
            {m.file_type}
          </span>
        </td>
        <td className="p-4">
          <span className="text-sm font-sans" style={{ color: statusCfg.color }}>
            {statusCfg.label}
          </span>
        </td>
        <td className="p-4 w-40">
          {sectionsTotal > 0 ? (
            <div className="flex items-center gap-2">
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: 5, background: 'var(--surface-3)' }}
              >
                <div
                  className="h-full rounded-full progress-fill transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                {sectionsDone}/{sectionsTotal} ({progressPct}%)
              </span>
            </div>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
        <td className="p-4">
          <span className="font-mono tabular-nums font-medium" style={{ color: 'var(--amber-text)' }}>
            {m.chunks_extracted > 0 ? m.chunks_extracted : '—'}
          </span>
        </td>
        <td className="p-4 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{date}</td>
        <td className="p-4">
          <div className="flex items-center gap-3">
            {needsResume && (
              <Link
                href={`/admin/content/upload?resume=${m.id}`}
                className="text-xs font-medium transition hover:underline"
                style={{ color: 'var(--amber-text)' }}
                title="Continue extraction from where it left off — picks up the existing checkpoint, doesn't restart or re-upload."
              >
                Resume →
              </Link>
            )}
            {m.chunks_extracted > 0 && (
              <a
                href={`/api/admin/chunks/export?source_material_id=${m.id}`}
                className="text-xs transition hover:underline"
                style={{ color: 'var(--text-muted)' }}
                title="Download every chunk extracted so far, ordered to mirror the document, for checking against the original file"
              >
                Download ↓
              </a>
            )}
            {m.chunk_status === 'extracted' && m.file_type === 'docx' && backfill.status !== 'running' && !resetting && (
              <button
                onClick={runBackfill}
                className="text-xs font-medium transition hover:underline"
                style={{ color: 'var(--amber-text)' }}
                title="Re-checks every section against the document and fills in any whose chunks never got saved — leaves existing chunks alone. Use this if only some sections look thin."
              >
                Backfill missing →
              </button>
            )}
            {backfill.status === 'running' && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⟳ {backfill.message}</span>
            )}
            {m.chunk_status === 'extracted' && m.file_type === 'docx' && !resetting && backfill.status !== 'running' && (
              <button
                onClick={runReset}
                className="text-xs font-medium transition hover:underline"
                style={{ color: 'var(--status-wrong)' }}
                title="Deletes every chunk extracted from this file (and any questions generated from them), then re-extracts from scratch with the fixed topic detection. Use this if most of the document looks missing, not just a few sections."
              >
                Reset &amp; re-extract ↺
              </button>
            )}
            {resetting && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>⟳ Deleting old chunks…</span>
            )}
            {m.raw_text && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-xs transition"
                style={{ color: 'var(--text-muted)' }}
                title={expanded ? 'Hide extracted text' : 'View extracted text'}
              >
                {expanded ? '▲' : '▼'}
              </button>
            )}
          </div>
          {(backfill.status === 'done' || backfill.status === 'error') && (
            <p className="text-[11px] mt-1" style={{ color: backfill.status === 'error' ? 'var(--status-wrong)' : 'var(--status-correct)' }}>
              {backfill.message}
            </p>
          )}
        </td>
      </tr>

      {expanded && m.raw_text && (
        <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
          <td colSpan={7} className="p-0">
            <div
              style={{
                background: 'var(--surface-base)',
                borderTop: '1px solid var(--surface-border)',
                padding: '16px',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  Extracted text — {m.raw_text.length.toLocaleString()} characters
                </p>
                <button
                  onClick={() => setExpanded(false)}
                  className="text-[11px] transition"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Collapse
                </button>
              </div>
              <pre
                className="text-xs font-mono rounded max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--surface-border)',
                  color: 'var(--text-secondary)',
                  padding: '12px 16px',
                }}
              >
                {m.raw_text.slice(0, 3000)}{m.raw_text.length > 3000 ? '\n\n[… truncated]' : ''}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
