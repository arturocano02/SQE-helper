'use client'

import { useState } from 'react'
import type { SourceMaterial } from '@/types/database'

interface SourceMaterialRowProps {
  material: SourceMaterial
}

const statusStyles: Record<string, string> = {
  done:       'text-success',
  processing: 'text-warning',
  failed:     'text-error',
}

const statusLabels: Record<string, string> = {
  done:       '✓ Done',
  processing: '⟳ Processing',
  failed:     '✗ Failed',
}

export default function SourceMaterialRow({ material: m }: SourceMaterialRowProps) {
  const [expanded, setExpanded] = useState(false)

  const progressPct = m.total_chunks > 0
    ? Math.round((m.chunks_processed / m.total_chunks) * 100)
    : m.status === 'done' ? 100 : 0

  const date = new Date(m.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-surface2 transition">
        <td className="p-4">
          <p className="text-primary font-medium text-sm">{m.file_name}</p>
          {m.error_message && (
            <p className="text-error text-xs mt-0.5 truncate max-w-xs">{m.error_message}</p>
          )}
        </td>
        <td className="p-4">
          <span className="uppercase text-xs text-secondary bg-surface2 border border-border px-2 py-0.5 rounded">
            {m.file_type}
          </span>
        </td>
        <td className={`p-4 text-sm ${statusStyles[m.status] ?? 'text-secondary'}`}>
          {statusLabels[m.status] ?? m.status}
        </td>
        <td className="p-4 w-32">
          {m.total_chunks > 0 ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs text-muted tabular-nums">{progressPct}%</span>
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        <td className="p-4">
          <span className="text-accent font-medium tabular-nums">
            {m.questions_generated > 0 ? m.questions_generated : '—'}
          </span>
        </td>
        <td className="p-4 text-secondary text-xs">{date}</td>
        <td className="p-4">
          {m.raw_text && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-secondary hover:text-primary transition"
              title={expanded ? 'Hide extracted text' : 'View extracted text'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
        </td>
      </tr>

      {/* Expanded raw text viewer */}
      {expanded && m.raw_text && (
        <tr className="border-b border-border">
          <td colSpan={7} className="p-0">
            <div className="bg-bg border-t border-border/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-secondary text-xs">Extracted text preview — {m.raw_text.length.toLocaleString()} characters</p>
                <button
                  onClick={() => setExpanded(false)}
                  className="text-xs text-muted hover:text-secondary transition"
                >
                  Collapse
                </button>
              </div>
              <pre className="text-xs text-secondary font-mono bg-surface border border-border rounded p-4 max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {m.raw_text.slice(0, 3000)}{m.raw_text.length > 3000 ? '\n\n[… truncated — showing first 3000 characters]' : ''}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
