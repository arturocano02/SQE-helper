'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import ActivityChart from '@/components/ui/ActivityChart'

interface UserRow {
  id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  is_admin: boolean
  created_at: string
  exam_date: string | null
  sessions_completed: number
  questions_answered: number
  correct_answered: number
  accuracy: number | null
  last_active: string | null
}

interface Overview {
  active_now: number
  active_today: number
  active_week: number
  active_month: number
  daily_activity: { day: string; active_users: number; answers: number }[]
}

type SortKey = 'name' | 'sessions_completed' | 'questions_answered' | 'accuracy' | 'last_active' | 'created_at'

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('last_active')
  const [sortDesc, setSortDesc] = useState(true)

  useEffect(() => {
    async function load() {
      const [uRes, oRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/analytics/overview'),
      ])
      const uJson = await uRes.json()
      const oJson = await oRes.json()
      setUsers(uJson.users ?? [])
      setOverview(oJson)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? users.filter(u => (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
      : users

    rows = [...rows].sort((a, b) => {
      let av: string | number = 0
      let bv: string | number = 0
      if (sortKey === 'name') { av = a.name ?? a.email ?? ''; bv = b.name ?? b.email ?? '' }
      else if (sortKey === 'last_active') { av = a.last_active ?? ''; bv = b.last_active ?? '' }
      else if (sortKey === 'created_at') { av = a.created_at; bv = b.created_at }
      else if (sortKey === 'accuracy') { av = a.accuracy ?? -1; bv = b.accuracy ?? -1 }
      else { av = a[sortKey]; bv = b[sortKey] }

      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return rows
  }, [users, search, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  const dailyChartPoints = (overview?.daily_activity ?? []).map(d => ({
    label: new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    value: d.active_users,
  }))

  return (
    <main className="min-h-screen" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-6">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-serif text-2xl" style={{ color: 'var(--text-primary)' }}>Users</h1>
            <p className="font-sans text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {users.length} total user{users.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/admin" className="font-sans text-sm" style={{ color: 'var(--text-secondary)' }}>
            ← Dashboard
          </Link>
        </div>

        {/* Activity stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Active now" value={overview?.active_now ?? '—'} sub="last 15 min" accent />
          <StatCard label="Today" value={overview?.active_today ?? '—'} sub="last 24h" />
          <StatCard label="This week" value={overview?.active_week ?? '—'} sub="last 7 days" />
          <StatCard label="This month" value={overview?.active_month ?? '—'} sub="last 30 days" />
        </div>

        {/* DAU chart */}
        <div
          className="mb-8 p-5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12 }}
        >
          <p className="font-sans text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            Daily active users — last 30 days
          </p>
          <ActivityChart points={dailyChartPoints} emptyLabel="Not enough activity yet to chart." />
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="font-sans text-sm px-4 py-2.5 rounded-lg w-full max-w-sm"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="font-sans text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-24"
            style={{ background: 'var(--surface-1)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14 }}
          >
            <p className="font-serif text-xl mb-1" style={{ color: 'var(--text-muted)' }}>No users found</p>
          </div>
        ) : (
          <div
            style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12, overflow: 'hidden' }}
            className="card-glow"
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                  <SortableHeader label="User" onClick={() => toggleSort('name')} active={sortKey === 'name'} desc={sortDesc} />
                  <SortableHeader label="Sessions" onClick={() => toggleSort('sessions_completed')} active={sortKey === 'sessions_completed'} desc={sortDesc} align="right" />
                  <SortableHeader label="Questions" onClick={() => toggleSort('questions_answered')} active={sortKey === 'questions_answered'} desc={sortDesc} align="right" />
                  <SortableHeader label="Accuracy" onClick={() => toggleSort('accuracy')} active={sortKey === 'accuracy'} desc={sortDesc} align="right" />
                  <SortableHeader label="Last active" onClick={() => toggleSort('last_active')} active={sortKey === 'last_active'} desc={sortDesc} />
                  <SortableHeader label="Joined" onClick={() => toggleSort('created_at')} active={sortKey === 'created_at'} desc={sortDesc} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr
                    key={u.id}
                    className="cursor-pointer transition"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    onClick={() => window.location.assign(`/admin/users/${u.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {u.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatar_url} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                        ) : (
                          <div
                            className="flex items-center justify-center font-serif text-xs"
                            style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--amber-soft)', color: 'var(--amber-text)' }}
                          >
                            {(u.name ?? u.email ?? '?')[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-sans text-sm truncate" style={{ color: 'var(--text-primary)', maxWidth: 220 }}>
                            {u.name ?? 'No name'}
                            {u.is_admin && (
                              <span className="ml-2 font-sans text-[10px] px-1.5 py-0.5 rounded" style={{ border: '1px solid rgba(200,146,42,0.4)', color: 'var(--amber-text)' }}>
                                Admin
                              </span>
                            )}
                          </p>
                          <p className="font-sans text-xs truncate" style={{ color: 'var(--text-muted)', maxWidth: 220 }}>
                            {u.email ?? '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: 'var(--text-primary)' }}>
                      {u.sessions_completed}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{ color: 'var(--text-primary)' }}>
                      {u.questions_answered}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-right" style={{
                      color: u.accuracy === null ? 'var(--text-muted)'
                        : u.accuracy >= 70 ? 'var(--status-correct)'
                        : u.accuracy >= 40 ? 'var(--status-warning)'
                        : 'var(--status-wrong)',
                    }}>
                      {u.accuracy !== null ? `${u.accuracy}%` : '—'}
                    </td>
                    <td className="px-4 py-3 font-sans text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {timeAgo(u.last_active)}
                    </td>
                    <td className="px-4 py-3 font-sans text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)', borderRadius: 12, padding: '16px 18px' }}
      className="card-glow"
    >
      <p className="font-sans text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="font-serif text-3xl tabular-nums" style={{ color: accent ? 'var(--amber-text)' : 'var(--text-primary)' }}>
        {value}
      </p>
      {sub && <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function SortableHeader({ label, onClick, active, desc, align = 'left' }: {
  label: string; onClick: () => void; active: boolean; desc: boolean; align?: 'left' | 'right'
}) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 font-sans text-xs uppercase tracking-wider cursor-pointer select-none"
      style={{ color: active ? 'var(--amber-text)' : 'var(--text-muted)', textAlign: align }}
    >
      {label} {active ? (desc ? '↓' : '↑') : ''}
    </th>
  )
}
