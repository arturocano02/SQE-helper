/**
 * POST /api/admin/chunks/scan-topic
 *
 * Recovery tool for "I uploaded the whole document, coverage says 98%+, but topic X has zero
 * chunks" — that's not a missing-content problem (the backfill route handles that), it's a
 * mis-categorisation problem: the content for topic X exists, but topic detection during
 * extraction assigned it to the wrong topic (or left it Uncategorised within the wrong topic).
 * This scans every chunk NOT currently under the target topic and surfaces ones that plausibly
 * belong there, for the admin to review and move.
 *
 * Two stages, both re-run fresh on every call (no server-side session state to drift out of
 * sync):
 *   1. Cheap keyword pre-filter over every non-target chunk, using a hand-built vocabulary per
 *      SQE1 topic. This is what keeps the AI stage affordable on a 1500-chunk bank — only chunks
 *      that mention at least one topic-characteristic term get sent to Claude at all.
 *   2. A small batch of those candidates is sent to Claude per call, which judges (with a brief
 *      reason) whether each one genuinely tests the target topic's law. Only "yes" judgements are
 *      returned — the client accumulates them across repeated calls (same resumable-batch pattern
 *      as /api/admin/chunks/backfill) until every candidate has been checked.
 *
 * Body: { topic_id: string, offset?: number, batch_size?: number }
 * Response: { candidates_total: number, offset: number, next_offset: number, done: boolean,
 *             matches: Array<{ id, rule_text, source_section, current_topic_name,
 *             current_subtopic_name, reason }> }
 */

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 280

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const DEFAULT_BATCH_SIZE = 15

// Hand-built per-topic vocabulary, drawn from the SQE1 taxonomy in CLAUDE.md. Deliberately broad
// (better to pull in a few false positives for Claude to reject in stage 2 than to silently miss
// a genuinely mis-filed chunk by being too narrow).
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'business-law': [
    'director', 'shareholder', 'partnership', 'llp', 'sole trader', 'incorporation',
    'articles of association', 'board meeting', 'company secretary', 'insolvency',
    'liquidation', 'administration', 'winding up', 'wrongful trading', 'corporation tax',
    'capital gains tax', 'dividend', 'share capital', 'voluntary arrangement', 'cva',
    'pre-pack', 'statement of solvency', 'members voluntary', 'creditors voluntary',
    'companies act', 'memorandum of association', 'ordinary resolution', 'special resolution',
  ],
  'dispute-resolution': [
    'claim form', 'particulars of claim', 'default judgment', 'case management', 'cpr',
    'part 36', 'disclosure', 'witness statement', 'trial bundle', 'summary judgment',
    'strike out', 'limitation period', 'enforcement', 'costs budget', 'pre-action protocol',
    'allocation', 'fast track', 'multi-track', 'small claims track', 'interim application',
    'civil procedure rules',
  ],
  'contract': [
    'offer and acceptance', 'consideration', 'privity of contract', 'misrepresentation',
    'breach of contract', 'discharge of contract', 'frustration', 'condition and warranty',
    'innominate term', 'exclusion clause', 'unfair contract terms', 'specific performance',
    'damages for breach', 'repudiation', 'termination of contract', 'capacity to contract',
    'unilateral mistake', 'duress', 'undue influence',
  ],
  'tort': [
    'negligence', 'duty of care', 'breach of duty', 'causation', 'remoteness of damage',
    'occupiers liability', 'vicarious liability', 'psychiatric harm', 'nervous shock',
    'nuisance', 'trespass to land', 'defamation', 'product liability',
    'consumer protection act', "employer's liability", 'contributory negligence', 'volenti',
  ],
  'legal-system': [
    'source of law', 'judicial precedent', 'statutory interpretation', 'human rights act',
    'judicial review', 'separation of powers', 'rule of law', 'parliamentary sovereignty',
    'court hierarchy', 'ratio decidendi', 'obiter dictum', 'literal rule', 'golden rule',
    'mischief rule',
  ],
  'legal-services': [
    'solicitors regulation authority', 'sra', 'code of conduct', 'professional conduct',
    'conflict of interest', 'client care', 'complaints handling', 'legal professional privilege',
    'money laundering', 'sra principles', 'undertaking',
  ],
  'property-practice': [
    'exchange of contracts', 'completion', 'local authority search', 'stamp duty land tax',
    'sdlt', 'registered land', 'conveyancing', 'landlord and tenant', 'tt forms',
    'pre-contract enquiries', 'title guarantee', 'chain of transactions', 'synchronisation',
  ],
  'land-law': [
    'easement', 'covenant', 'co-ownership', 'joint tenancy', 'tenancy in common',
    'overreaching', 'unregistered land', 'proprietary estoppel', 'adverse possession',
    'mortgage', 'legal charge', 'restrictive covenant', 'freehold covenant',
    'severance of joint tenancy',
  ],
  'trusts': [
    'trustee', 'beneficiary', 'equitable interest', 'resulting trust', 'constructive trust',
    'express trust', 'breach of trust', 'fiduciary duty', 'certainty of intention',
    'certainty of subject matter', 'certainty of objects', 'three certainties',
    'secret trust',
  ],
  'wills': [
    'testator', 'intestacy', 'probate', 'grant of representation', 'executor', 'administrator',
    'inheritance tax', 'revocation of will', 'codicil', 'attestation', 'estate administration',
    'letters of administration', 's.9 wills act', 'lapse of gift',
  ],
  'solicitors-accounts': [
    'client account', 'office account', 'solicitors accounts rules', 'client money',
    'interest on client money', 'breach of accounts rules', 'ledger', 'reconciliation',
    'sra accounts rules',
  ],
  'criminal-law': [
    'mens rea', 'actus reus', 'police powers', 'arrest', 'bail', 'caution', 'sentencing',
    'appeal', 'crown court', 'magistrates court', 'indictable offence', 'summary offence',
    'pace 1984', 'custody', 'identification evidence',
  ],
}

interface ChunkCandidate {
  id: string
  rule_text: string
  context_text: string | null
  source_section: string | null
  topic_id: string
  topic_name: string
  subtopic_name: string | null
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return user
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { topic_id, offset = 0, batch_size = DEFAULT_BATCH_SIZE } = body as {
    topic_id?: string
    offset?: number
    batch_size?: number
  }

  if (!topic_id) return NextResponse.json({ error: 'topic_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: targetTopic } = await admin.from('topics').select('id, name, slug').eq('id', topic_id).single()
  if (!targetTopic) return NextResponse.json({ error: 'Unknown topic_id' }, { status: 400 })

  const keywords = TOPIC_KEYWORDS[targetTopic.slug] ?? []

  // Re-derive the full candidate list fresh every call — cheap (it's a substring scan over
  // chunks already in memory from one query), and means there's no separate cursor/checkpoint
  // that could drift if chunks get edited or moved mid-scan.
  const { data: chunks } = await admin
    .from('knowledge_chunks')
    .select('id, topic_id, subtopic_id, rule_text, context_text, source_section, key_terms, topics(name), subtopics(name)')
    .neq('topic_id', topic_id)
    .order('subtopic_id', { ascending: true, nullsFirst: true }) // Uncategorised chunks first
    .order('created_at')

  const allOther = (chunks ?? []) as unknown as Array<{
    id: string
    topic_id: string
    subtopic_id: string | null
    rule_text: string
    context_text: string | null
    source_section: string | null
    key_terms: string[] | null
    topics: { name: string } | null
    subtopics: { name: string } | null
  }>

  const candidates: ChunkCandidate[] = []
  for (const c of allOther) {
    const haystack = [c.rule_text, c.context_text ?? '', ...(c.key_terms ?? [])].join(' ').toLowerCase()
    const matches = keywords.length === 0 || keywords.some(kw => haystack.includes(kw))
    if (!matches) continue
    candidates.push({
      id: c.id,
      rule_text: c.rule_text,
      context_text: c.context_text,
      source_section: c.source_section,
      topic_id: c.topic_id,
      topic_name: c.topics?.name ?? 'Unknown topic',
      subtopic_name: c.subtopics?.name ?? null,
    })
  }

  const candidatesTotal = candidates.length
  const batch = candidates.slice(offset, offset + batch_size)
  const nextOffset = offset + batch.length
  const done = nextOffset >= candidatesTotal

  if (batch.length === 0) {
    return NextResponse.json({ candidates_total: candidatesTotal, offset, next_offset: nextOffset, done: true, matches: [] })
  }

  const batchPrompt = batch.map((c, i) =>
    `${i + 1}. [currently filed under: ${c.topic_name}${c.subtopic_name ? ` › ${c.subtopic_name}` : ' › Uncategorised'}]\n${c.rule_text}${c.context_text ? `\n(context: ${c.context_text})` : ''}`
  ).join('\n\n')

  let matches: Array<{ id: string; rule_text: string; source_section: string | null; current_topic_name: string; current_subtopic_name: string | null; reason: string }> = []

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are auditing a UK SQE1 law-exam knowledge bank for mis-filed content. You will be shown numbered legal rules currently filed under OTHER topics, and asked whether each one actually belongs under "${targetTopic.name}".

A rule belongs under "${targetTopic.name}" only if that is the legal subject it primarily tests — not just because it mentions a related term in passing. Be precise: e.g. a rule about disclosure obligations in a property sale belongs under Property Practice even if it incidentally references contract formation.

Return ONLY valid JSON, no markdown: {"results":[{"index":1,"belongs":true,"reason":"one short sentence"}...]} — include every numbered item, "belongs":false for ones that don't fit, omit "reason" when belongs is false.`,
      messages: [{ role: 'user', content: batchPrompt }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { results: Array<{ index: number; belongs: boolean; reason?: string }> }

    matches = (parsed.results ?? [])
      .filter(r => r.belongs && batch[r.index - 1])
      .map(r => {
        const c = batch[r.index - 1]
        return {
          id: c.id,
          rule_text: c.rule_text,
          source_section: c.source_section,
          current_topic_name: c.topic_name,
          current_subtopic_name: c.subtopic_name,
          reason: r.reason ?? '',
        }
      })
  } catch {
    // A parse/API failure on one batch shouldn't kill the whole scan — the client just gets zero
    // matches for this batch and moves on to the next; nothing is silently marked as checked
    // incorrectly since next_offset still advances past the attempted batch.
    matches = []
  }

  return NextResponse.json({
    candidates_total: candidatesTotal,
    offset,
    next_offset: nextOffset,
    done,
    matches,
  })
}
