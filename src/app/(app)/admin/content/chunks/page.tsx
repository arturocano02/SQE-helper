'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { KnowledgeChunk, Topic } from '@/types/database'
import { createClient } from '@/lib/supabase/client'

type ChunkRow = KnowledgeChunk & { subtopics?: { name: string } | null }

const RULE_TYPE_COLORS: Record<string, string> = {
  definition: '#a78bfa',
  threshold: 'var(--amber-text)',
  test: '#60a5fa',
  exception: 'var(--status-wrong)',
  procedure: 'var(--text-secondary)',
  consequence: 'var(--status-warning)',
  general_principle: 'var(--text-muted)',
  uncertain: 'var(--status-wrong)',
}

const RULE_TYPES = ['definition', 'threshold', 'test', 'exception', 'procedure', 'consequence', 'general_principle', 'uncertain']

type ViewMode = 'tree' | 'list'

interface GroupedChunks {
  topic: Topic
  subtopics: Array<{
    name: string | null
    chunks: ChunkRow[]
  }>
  ungrouped: ChunkRow[]
}

function groupChunks(chunks: ChunkRow[], topics: Topic[]): GroupedChunks[] {
  const topicMap = new Map<string, GroupedChunks>()
  for (const t of topics) {
    topicMap.set(t.id, { topic: t, subtopics: [], ungrouped: [] })
  }

  for (const chunk of chunks) {
    const group = topicMap.get(chunk.topic_id)
    if (!group) continue
    if (chunk.subtopics?.name) {
      const existing = group.subtopics.find(s => s.name === chunk.subtopics?.name)
      if (existing) existing.chunks.push(chunk)
      else group.subtopics.push({ name: chunk.subtopics.name, chunks: [chunk] })
    } else {
      group.ungrouped.push(chunk)
    }
  }

  return Array.from(topicMap.values()).filter(
    g => g.subtopics.length > 0 || g.ungrouped.length > 0
  )
}

const EMPTY_NEW_CHUNK = {
  topic_id: '',
  subtopic_name: '',
  rule_text: '',
  context_text: '',
  source_section: '',
  key_terms: '',
  rule_type: 'general_principle',
}

export default function ChunksPage() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedTopicId, setSelectedTopicId] = useState<string>('')
  const [filterApproved, setFilterApproved] = useState<'all' | 'approved' | 'pending'>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [editing, setEditing] = useState<ChunkRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const [collapsedTopics, setCollapsedTopics] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [newChunk, setNewChunk] = useState(EMPTY_NEW_CHUNK)
  const [addingSaving, setAddingSaving] = useState(false)
  const [search, setSearch] = useState('')
  const LIMIT = 200 // higher limit for tree view

  useEffect(() => {
    const supabase = createClient()
    supabase.from('topics').select('*').order('sort_order').then(({ data }) => {
      setTopics((data ?? []) as Topic[])
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(LIMIT), page: String(page) })
    if (selectedTopicId) params.set('topic_id', selectedTopicId)
    if (filterApproved === 'approved') params.set('is_approved', 'true')
    if (filterApproved === 'pending') params.set('is_approved', 'false')

    const res = await fetch(`/api/admin/chunks?${params}`)
    const data = await res.json()
    setChunks(data.chunks ?? [])
    setTotal(data.total ?? 0)
    setBulkSelected(new Set())
    setLoading(false)
  }, [selectedTopicId, filterApproved, page])

  useEffect(() => { load() }, [load])

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    await fetch('/api/admin/chunks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing.id,
        rule_text: editing.rule_text,
        context_text: editing.context_text,
        source_section: editing.source_section,
        key_terms: editing.key_terms,
        rule_type: editing.rule_type,
        is_approved: editing.is_approved,
      }),
    })
    setSaving(false)
    setEditing(null)
    load()
  }

  async function toggleApprove(chunk: ChunkRow) {
    await fetch('/api/admin/chunks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chunk.id, is_approved: !chunk.is_approved }),
    })
    load()
  }

  async function deleteChunk(id: string) {
    if (!confirm('Delete this chunk?')) return
    await fetch(`/api/admin/chunks?id=${id}`, { method: 'DELETE' })
    load()
  }

  async function bulkApprove(approve: boolean) {
    if (bulkSelected.size === 0) return
    setBulkApproving(true)
    await fetch('/api/admin/chunks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(bulkSelected), is_approved: approve }),
    })
    setBulkApproving(false)
    load()
  }

  async function bulkDelete() {
    if (bulkSelected.size === 0) return
    if (!confirm(`Permanently delete ${bulkSelected.size} chunk${bulkSelected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkDeleting(true)
    await fetch('/api/admin/chunks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(bulkSelected) }),
    })
    setBulkDeleting(false)
    load()
  }

  async function handleAddChunk() {
    if (!newChunk.topic_id || !newChunk.rule_text.trim()) return
    setAddingSaving(true)

    // Resolve subtopic: if name provided, look up or create subtopic
    let subtopic_id: string | null = null
    if (newChunk.subtopic_name.trim()) {
      const res = await fetch('/api/admin/chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_id: newChunk.topic_id,
          subtopic_name: newChunk.subtopic_name.trim(),
          rule_text: newChunk.rule_text.trim(),
          context_text: newChunk.context_text.trim() || null,
          source_section: newChunk.source_section.trim() || null,
          key_terms: newChunk.key_terms.split(',').map(t => t.trim()).filter(Boolean),
          rule_type: newChunk.rule_type,
        }),
      })
      if (res.ok) {
        setNewChunk(EMPTY_NEW_CHUNK)
        setShowAddModal(false)
        load()
      }
    } else {
      const res = await fetch('/api/admin/chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_id: newChunk.topic_id,
          subtopic_id,
          rule_text: newChunk.rule_text.trim(),
          context_text: newChunk.context_text.trim() || null,
          source_section: newChunk.source_section.trim() || null,
          key_terms: newChunk.key_terms.split(',').map(t => t.trim()).filter(Boolean),
          rule_type: newChunk.rule_type,
        }),
      })
      if (res.ok) {
        setNewChunk(EMPTY_NEW_CHUNK)
        setShowAddModal(false)
        load()
      }
    }
    setAddingSaving(false)
  }

  function toggleTopicCollapse(topicId: string) {
    setCollapsedTopics(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  const approvedCount = chunks.filter(c => c.is_approved).length
  const pendingCount = chunks.length - approvedCount

  // Filter by search
  const filteredChunks = search.trim()
    ? chunks.filter(c =>
        c.rule_text.toLowerCase().includes(search.toLowerCase()) ||
        c.source_section?.toLowerCase().includes(search.toLowerCase()) ||
        c.key_terms?.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : chunks

  const grouped = groupChunks(filteredChunks, topics)

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--surface-border)' }}>
        <div className="max-w-7xl mx-auto px-5 py-4 flex items-center gap-4 flex-wrap">
          <Link href="/admin" className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            ← Admin
          </Link>
          <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>
            Knowledge Graph
          </h1>

          {/* Stats */}
          <div className="flex items-center gap-3 ml-2">
            <Pill label={`${total} total`} />
            <Pill label={`${approvedCount} approved`} color="green" />
            {pendingCount > 0 && <Pill label={`${pendingCount} pending`} color="amber" />}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* View toggle */}
            <div
              className="flex"
              style={{
                border: '1px solid var(--surface-border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {(['tree', 'list'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  style={{
                    padding: '6px 14px',
                    fontFamily: 'var(--font-dm-sans)',
                    fontSize: 12,
                    background: viewMode === m ? 'var(--surface-2)' : 'transparent',
                    color: viewMode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {m === 'tree' ? '⊞ Tree' : '≡ List'}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              style={{
                background: 'var(--amber)',
                color: '#0A0A08',
                fontFamily: 'var(--font-dm-sans)',
                fontWeight: 600,
                fontSize: 13,
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              + Add chunk
            </button>

            <Link
              href="/admin/content/upload"
              className="font-sans text-sm px-3 py-1.5 rounded"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-border)',
                color: 'var(--text-secondary)',
              }}
            >
              ← Upload & Extract
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 py-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <select
            value={selectedTopicId}
            onChange={e => { setSelectedTopicId(e.target.value); setPage(1) }}
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-primary)',
              borderRadius: 8,
              padding: '6px 12px',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: 13,
            }}
          >
            <option value="">All topics</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {(['all', 'approved', 'pending'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilterApproved(f); setPage(1) }}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 12,
                border: filterApproved === f ? '1px solid rgba(200,146,42,0.5)' : '1px solid var(--surface-border)',
                background: filterApproved === f ? 'var(--amber-soft)' : 'var(--surface-1)',
                color: filterApproved === f ? 'var(--amber-text)' : 'var(--text-secondary)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {f === 'all' ? 'All' : f === 'approved' ? '✓ Approved' : '⏳ Pending'}
            </button>
          ))}

          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rule text, terms…"
            style={{
              marginLeft: 'auto',
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-dm-sans)',
              fontSize: 13,
              padding: '6px 12px',
              width: 220,
              outline: 'none',
            }}
          />

          {/* Select All / Deselect All */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBulkSelected(new Set(filteredChunks.map(c => c.id)))}
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-dm-sans)',
                fontSize: 12,
                padding: '5px 12px',
                borderRadius: 6,
                border: '1px solid var(--surface-border)',
                cursor: 'pointer',
              }}
            >
              Select all ({filteredChunks.length})
            </button>
            {bulkSelected.size > 0 && (
              <button
                onClick={() => setBulkSelected(new Set())}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--surface-border)',
                  cursor: 'pointer',
                }}
              >
                Deselect
              </button>
            )}
          </div>

          {bulkSelected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                {bulkSelected.size} selected
              </span>
              <button
                onClick={() => bulkApprove(true)}
                disabled={bulkApproving}
                style={{
                  background: 'var(--status-correct)',
                  color: '#000',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  opacity: bulkApproving ? 0.6 : 1,
                }}
              >
                Approve selected
              </button>
              <button
                onClick={() => bulkApprove(false)}
                disabled={bulkApproving || bulkDeleting}
                style={{
                  background: 'transparent',
                  color: 'var(--status-wrong)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--status-wrong)',
                  cursor: 'pointer',
                  opacity: bulkApproving || bulkDeleting ? 0.6 : 1,
                }}
              >
                Reject selected
              </button>
              <button
                onClick={bulkDelete}
                disabled={bulkApproving || bulkDeleting}
                style={{
                  background: 'rgba(248,113,113,0.12)',
                  color: 'var(--status-wrong)',
                  fontFamily: 'var(--font-dm-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(248,113,113,0.35)',
                  cursor: bulkApproving || bulkDeleting ? 'not-allowed' : 'pointer',
                  opacity: bulkApproving || bulkDeleting ? 0.6 : 1,
                }}
              >
                {bulkDeleting ? 'Deleting…' : 'Delete selected'}
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20" style={{ color: 'var(--text-muted)' }}>Loading…</div>
        ) : filteredChunks.length === 0 ? (
          <div className="text-center py-20 font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            No chunks found. Upload a source document and extract knowledge chunks first.
          </div>
        ) : viewMode === 'tree' ? (
          /* ── TREE VIEW ── */
          <div className="space-y-4">
            {grouped.map(({ topic, subtopics, ungrouped }) => {
              const allChunksInTopic = [...subtopics.flatMap(s => s.chunks), ...ungrouped]
              const topicApproved = allChunksInTopic.filter(c => c.is_approved).length
              const isCollapsed = collapsedTopics.has(topic.id)

              return (
                <div
                  key={topic.id}
                  style={{
                    border: '1px solid var(--surface-border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {/* Topic header */}
                  <button
                    onClick={() => toggleTopicCollapse(topic.id)}
                    style={{
                      width: '100%',
                      background: 'var(--surface-1)',
                      border: 'none',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {isCollapsed ? '▶' : '▼'}
                    </span>
                    <span className="font-serif text-base" style={{ color: 'var(--text-primary)', flex: 1 }}>
                      {topic.name}
                    </span>
                    <span
                      className="font-sans text-xs px-2 py-0.5 rounded"
                      style={{
                        background: 'var(--surface-2)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--surface-border)',
                      }}
                    >
                      {topic.paper}
                    </span>
                    <span className="font-mono text-xs" style={{ color: 'var(--status-correct)' }}>
                      {topicApproved}/{allChunksInTopic.length}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div>
                      {/* Subtopic groups */}
                      {subtopics.map(sub => (
                        <SubtopicGroup
                          key={sub.name}
                          name={sub.name}
                          chunks={sub.chunks}
                          bulkSelected={bulkSelected}
                          onBulkToggle={(id, checked) => {
                            const next = new Set(bulkSelected)
                            if (checked) next.add(id)
                            else next.delete(id)
                            setBulkSelected(next)
                          }}
                          onEdit={setEditing}
                          onApprove={toggleApprove}
                          onDelete={deleteChunk}
                        />
                      ))}

                      {/* Ungrouped chunks */}
                      {ungrouped.length > 0 && (
                        <SubtopicGroup
                          name={null}
                          chunks={ungrouped}
                          bulkSelected={bulkSelected}
                          onBulkToggle={(id, checked) => {
                            const next = new Set(bulkSelected)
                            if (checked) next.add(id)
                            else next.delete(id)
                            setBulkSelected(next)
                          }}
                          onEdit={setEditing}
                          onApprove={toggleApprove}
                          onDelete={deleteChunk}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          /* ── LIST VIEW ── */
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={bulkSelected.size === filteredChunks.length && filteredChunks.length > 0}
                onChange={e => setBulkSelected(e.target.checked ? new Set(filteredChunks.map(c => c.id)) : new Set())}
                style={{ accentColor: 'var(--amber)', width: 14, height: 14 }}
              />
              <span className="font-sans text-xs" style={{ color: 'var(--text-muted)' }}>Select all</span>
            </div>

            {filteredChunks.map(chunk => (
              <ChunkListRow
                key={chunk.id}
                chunk={chunk}
                checked={bulkSelected.has(chunk.id)}
                onToggle={checked => {
                  const next = new Set(bulkSelected)
                  if (checked) next.add(chunk.id)
                  else next.delete(chunk.id)
                  setBulkSelected(next)
                }}
                onEdit={() => setEditing({ ...chunk })}
                onApprove={() => toggleApprove(chunk)}
                onDelete={() => deleteChunk(chunk.id)}
              />
            ))}
          </div>
        )}

        {/* Pagination (list view only) */}
        {viewMode === 'list' && total > LIMIT && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              style={{
                padding: '6px 16px', borderRadius: 6,
                border: '1px solid var(--surface-border)', background: 'transparent',
                color: page === 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-dm-sans)', fontSize: 13,
              }}
            >
              ← Prev
            </button>
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {page} / {Math.ceil(total / LIMIT)}
            </span>
            <button
              disabled={page >= Math.ceil(total / LIMIT)}
              onClick={() => setPage(p => p + 1)}
              style={{
                padding: '6px 16px', borderRadius: 6,
                border: '1px solid var(--surface-border)', background: 'transparent',
                color: page >= Math.ceil(total / LIMIT) ? 'var(--text-muted)' : 'var(--text-secondary)',
                cursor: page >= Math.ceil(total / LIMIT) ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-dm-sans)', fontSize: 13,
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── EDIT MODAL ── */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.88)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 28,
              maxWidth: 680,
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>Edit Chunk</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>Approved</span>
                <input
                  type="checkbox"
                  checked={editing.is_approved}
                  onChange={e => setEditing({ ...editing, is_approved: e.target.checked })}
                  style={{ accentColor: 'var(--status-correct)', width: 16, height: 16 }}
                />
              </label>
            </div>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Rule text *</span>
              <textarea
                rows={5}
                value={editing.rule_text}
                onChange={e => setEditing({ ...editing, rule_text: e.target.value })}
                style={textareaStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Context / surrounding law (optional)</span>
              <textarea
                rows={3}
                value={editing.context_text ?? ''}
                onChange={e => setEditing({ ...editing, context_text: e.target.value })}
                placeholder="Supporting context, related rules, or exam technique notes…"
                style={textareaStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Source section</span>
              <input
                value={editing.source_section ?? ''}
                onChange={e => setEditing({ ...editing, source_section: e.target.value })}
                placeholder="e.g. Business Law › Shareholders › Service Contracts"
                style={inputStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Key terms (comma-separated)</span>
              <input
                value={(editing.key_terms ?? []).join(', ')}
                onChange={e => setEditing({ ...editing, key_terms: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                style={{ ...inputStyle, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
              />
            </label>

            <label className="block mb-6">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Rule type</span>
              <select
                value={editing.rule_type}
                onChange={e => setEditing({ ...editing, rule_type: e.target.value as KnowledgeChunk['rule_type'] })}
                style={inputStyle}
              >
                {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <div className="flex gap-3">
              <button onClick={saveEdit} disabled={saving} style={primaryBtnStyle(saving)}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button onClick={() => setEditing(null)} style={secondaryBtnStyle}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD CHUNK MODAL ── */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,10,8,0.88)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}
        >
          <div
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              borderRadius: 14,
              padding: 28,
              maxWidth: 680,
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            <h3 className="font-serif text-xl mb-5" style={{ color: 'var(--text-primary)' }}>Add knowledge chunk</h3>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Topic *</span>
              <select
                value={newChunk.topic_id}
                onChange={e => setNewChunk({ ...newChunk, topic_id: e.target.value })}
                style={inputStyle}
              >
                <option value="">Select a topic…</option>
                {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Subtopic name (optional)</span>
              <input
                value={newChunk.subtopic_name}
                onChange={e => setNewChunk({ ...newChunk, subtopic_name: e.target.value })}
                placeholder="e.g. Shareholders, Directors Duties…"
                style={inputStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Rule text *</span>
              <textarea
                rows={5}
                value={newChunk.rule_text}
                onChange={e => setNewChunk({ ...newChunk, rule_text: e.target.value })}
                placeholder="State the legal rule precisely and completely. One rule per chunk."
                style={textareaStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Context (optional)</span>
              <textarea
                rows={3}
                value={newChunk.context_text}
                onChange={e => setNewChunk({ ...newChunk, context_text: e.target.value })}
                placeholder="Supporting context, related rules, or exam technique notes…"
                style={textareaStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Source section</span>
              <input
                value={newChunk.source_section}
                onChange={e => setNewChunk({ ...newChunk, source_section: e.target.value })}
                placeholder="e.g. Business Law › Shareholders"
                style={inputStyle}
              />
            </label>

            <label className="block mb-4">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Key terms (comma-separated)</span>
              <input
                value={newChunk.key_terms}
                onChange={e => setNewChunk({ ...newChunk, key_terms: e.target.value })}
                placeholder="e.g. s.168 CA 2006, ordinary resolution, board meeting"
                style={{ ...inputStyle, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
              />
            </label>

            <label className="block mb-6">
              <span className="font-sans text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Rule type</span>
              <select
                value={newChunk.rule_type}
                onChange={e => setNewChunk({ ...newChunk, rule_type: e.target.value })}
                style={inputStyle}
              >
                {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <div className="flex gap-3">
              <button
                onClick={handleAddChunk}
                disabled={addingSaving || !newChunk.topic_id || !newChunk.rule_text.trim()}
                style={primaryBtnStyle(addingSaving || !newChunk.topic_id || !newChunk.rule_text.trim())}
              >
                {addingSaving ? 'Adding…' : 'Add chunk'}
              </button>
              <button onClick={() => setShowAddModal(false)} style={secondaryBtnStyle}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SubtopicGroup({
  name,
  chunks,
  bulkSelected,
  onBulkToggle,
  onEdit,
  onApprove,
  onDelete,
}: {
  name: string | null
  chunks: ChunkRow[]
  bulkSelected: Set<string>
  onBulkToggle: (id: string, checked: boolean) => void
  onEdit: (chunk: ChunkRow) => void
  onApprove: (chunk: ChunkRow) => void
  onDelete: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const approvedCount = chunks.filter(c => c.is_approved).length

  return (
    <div style={{ borderTop: '1px solid var(--surface-border)' }}>
      {/* Subtopic header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          background: 'var(--surface-base)',
          border: 'none',
          padding: '9px 18px 9px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{collapsed ? '▶' : '▼'}</span>
        <span className="font-sans text-sm font-medium" style={{ color: 'var(--text-secondary)', flex: 1 }}>
          {name ?? 'Uncategorised'}
        </span>
        <span className="font-mono text-[11px]" style={{ color: approvedCount === chunks.length ? 'var(--status-correct)' : 'var(--text-muted)' }}>
          {approvedCount}/{chunks.length}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-0">
          {chunks.map(chunk => (
            <ChunkListRow
              key={chunk.id}
              chunk={chunk}
              checked={bulkSelected.has(chunk.id)}
              onToggle={checked => onBulkToggle(chunk.id, checked)}
              onEdit={() => onEdit({ ...chunk })}
              onApprove={() => onApprove(chunk)}
              onDelete={() => onDelete(chunk.id)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChunkListRow({
  chunk,
  checked,
  onToggle,
  onEdit,
  onApprove,
  onDelete,
  indent = false,
}: {
  chunk: ChunkRow
  checked: boolean
  onToggle: (checked: boolean) => void
  onEdit: () => void
  onApprove: () => void
  onDelete: () => void
  indent?: boolean
}) {
  return (
    <div
      style={{
        background: chunk.is_approved ? 'rgba(74,222,128,0.03)' : 'transparent',
        borderTop: '1px solid var(--surface-border)',
        padding: `11px 18px 11px ${indent ? 48 : 18}px`,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onToggle(e.target.checked)}
        style={{ accentColor: 'var(--amber)', width: 13, height: 13, marginTop: 4, flexShrink: 0 }}
      />

      {/* Approved dot */}
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 6,
          background: chunk.is_approved ? 'var(--status-correct)' : 'var(--surface-border)',
        }}
      />

      <div className="flex-1 min-w-0">
        {/* Tags row */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span
            className="font-sans text-[10px] px-1.5 py-0.5 rounded"
            style={{
              color: RULE_TYPE_COLORS[chunk.rule_type] ?? 'var(--text-muted)',
              border: `1px solid ${RULE_TYPE_COLORS[chunk.rule_type] ?? 'var(--surface-border)'}33`,
              background: chunk.rule_type === 'uncertain' ? 'rgba(248,113,113,0.08)' : undefined,
            }}
          >
            {chunk.rule_type === 'uncertain' ? '⚠ uncertain' : chunk.rule_type}
          </span>
          {chunk.key_terms?.slice(0, 4).map(t => (
            <span
              key={t}
              className="font-mono text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
            >
              {t}
            </span>
          ))}
        </div>

        <p className="font-sans text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.55 }}>
          {chunk.rule_text}
        </p>

        {chunk.context_text && (
          <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {chunk.context_text.slice(0, 120)}{chunk.context_text.length > 120 ? '…' : ''}
          </p>
        )}

        {chunk.source_section && (
          <p className="font-sans text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {chunk.source_section}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <ActionBtn onClick={onEdit} label="Edit" />
        <ActionBtn
          onClick={onApprove}
          label={chunk.is_approved ? 'Reject' : 'Approve'}
          color={chunk.is_approved ? 'var(--status-wrong)' : 'var(--status-correct)'}
        />
        <button
          onClick={onDelete}
          title="Delete"
          style={{
            fontSize: 11, padding: '3px 7px', borderRadius: 5,
            border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function ActionBtn({ onClick, label, color }: { onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, padding: '3px 9px', borderRadius: 5,
        border: `1px solid ${color ? color + '55' : 'var(--surface-border)'}`,
        background: 'transparent',
        color: color ?? 'var(--text-secondary)',
        cursor: 'pointer',
        fontFamily: 'var(--font-dm-sans)',
      }}
    >
      {label}
    </button>
  )
}

function Pill({ label, color }: { label: string; color?: 'green' | 'amber' }) {
  const bg = color === 'green' ? 'rgba(74,222,128,0.08)' : color === 'amber' ? 'rgba(200,146,42,0.1)' : 'var(--surface-2)'
  const text = color === 'green' ? 'var(--status-correct)' : color === 'amber' ? 'var(--amber-text)' : 'var(--text-muted)'
  return (
    <span
      className="font-mono text-xs px-2 py-0.5 rounded"
      style={{ background: bg, color: text, border: `1px solid ${text}22` }}
    >
      {label}
    </span>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-dm-sans)',
  fontSize: 13,
  padding: '10px 12px',
  resize: 'vertical',
  lineHeight: 1.6,
  outline: 'none',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-1)',
  border: '1px solid var(--surface-border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-dm-sans)',
  fontSize: 13,
  padding: '8px 12px',
  outline: 'none',
}

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  flex: 1,
  background: disabled ? 'var(--surface-2)' : 'var(--amber)',
  color: disabled ? 'var(--text-muted)' : '#0A0A08',
  fontFamily: 'var(--font-dm-sans)',
  fontWeight: 600,
  fontSize: 14,
  padding: '10px 0',
  borderRadius: 8,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1,
})

const secondaryBtnStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-dm-sans)',
  fontSize: 14,
  padding: '10px 0',
  borderRadius: 8,
  border: '1px solid var(--surface-border)',
  cursor: 'pointer',
}
