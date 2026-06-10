'use client'

import { useState } from 'react'
import type { SourceMaterial } from '@/types/database'

interface SourceMaterialRowProps {
  material: SourceMaterial
}

const statusConfig: Record<string, { color: string; label: string }> = {
  done:       { color: 'var(--status-correct)', label: '✓ Done' },
  processing: { color: 'var(--status-warning)', label: '⟳ Processing' },
  failed:     { color: 'var(--status-wrong)',   label: '✗ Failed' },
}

export default function SourceMaterialRow({ material: m }: SourceMaterialRowProps) {
  const [expanded, setExpanded] = useState(false)

  const progressPct = m.total_chunks > 0
    ? Math.round((m.chunks_processed / m.total_chunks) * 100)
    : m.status === 'done' ? 100 : 0

  const date = new Date(m.created_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  const statusCfg = statusConfig[m.status] ?? { color: 'var(--text-secondary)', label: m.status }

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 150ms ease' }}
        className="hover:bg-surface2"
      >
        <td className="p-4">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.file_name}</p>
          {m.error_message && (
            <p className="text-[11px] mt-0.5 truncate max-w-xs" style={{ color: 'var(--status-wrong)' }}>
              {m.error_message}
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
        <td className="p-4 w-32">
          {m.total_chunks > 0 ? (
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
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {progressPct}%
              </span>
            </div>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
        <td className="p-4">
          <span className="font-mono tabular-nums font-medium" style={{ color: 'var(--amber-text)' }}>
            {m.questions_generated > 0 ? m.questions_generated : '—'}
          </span>
        </td>
        <td className="p-4 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{date}</td>
        <td className="p-4">
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
