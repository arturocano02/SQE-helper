/**
 * chunk-extractor.ts
 *
 * Two-stage pipeline for turning admin FLK notes (.docx) into knowledge chunks.
 *
 * Stage 1 — Parse:
 *   docx → raw OOXML (word/document.xml via JSZip) → section tree. The heading
 *   hierarchy is auto-discovered per document rather than assumed: a model is
 *   built from each paragraph's actual colour/bold/italic/underline/caps/font
 *   size (and Word's own Heading1-9/Title paragraph styles when present), so
 *   the same code copes with colour-coded notes, Word-styled documents, and
 *   plain bold/caps-only documents alike. Approximate page numbers are tracked
 *   for citation throughout.
 *
 * Stage 2 — Extract:
 *   Each leaf section's content is split deterministically into atomic units
 *   (tables whole, list items individually, prose blocks as-is) — no LLM
 *   segmentation, so coverage is guaranteed. Haiku then classifies each unit
 *   for rule_type + key_terms only.
 */

import JSZip from 'jszip'
import Anthropic from '@anthropic-ai/sdk'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DocSection {
  level: number       // 1 = paper/topic, 2 = subtopic, 3 = section, 4 = subsection, 5 = definition block
  title: string
  path: string[]      // breadcrumb: ["Business Law and Practice", "Shareholders", "Service Contracts"]
  content: string     // plain text of this section (excluding child section content)
  children: DocSection[]
  firstPage: number | null   // best-effort page number this section starts on (see parseDocxBlocks)
}

export interface ExtractedChunk {
  rule_text: string         // verbatim source text, formatting preserved (markdown-style)
  exact_source_quote: null  // deprecated — rule_text IS the source now
  context_text?: string | null
  key_terms: string[]
  rule_type: 'definition' | 'threshold' | 'test' | 'exception' | 'procedure' | 'consequence' | 'general_principle' | 'uncertain'
  source_section: string   // human-readable breadcrumb
  subtopic_name: string
  section_name: string
  topic_slug: string | null
}

// Mirrors the mapping in chunker.ts — kept in sync manually
const HEADER_TO_SLUG: Record<string, string> = {
  'BUSINESS LAW AND PRACTICE': 'business-law',
  'BUSINESS LAW':              'business-law',
  'DISPUTE RESOLUTION':        'dispute-resolution',
  'CONTRACT':                  'contract',
  'TORT':                      'tort',
  'PUBLIC LAW':                'legal-system',
  'LEGAL SYSTEM':              'legal-system',
  'LEGAL SYSTEM AND CONSTITUTIONAL LAW': 'legal-system',
  'LEGAL SERVICES':            'legal-services',
  'PROPERTY PRACTICE':         'property-practice',
  'LAND LAW':                  'land-law',
  'TRUSTS':                    'trusts',
  'WILLS':                     'wills',
  'WILLS AND ADMINISTRATION':  'wills',
  'WILLS AND ADMINISTRATION OF ESTATES': 'wills',
  'SOLICITORS ACCOUNTS':       'solicitors-accounts',
  "SOLICITORS' ACCOUNTS":      'solicitors-accounts',
  'CRIMINAL LAW':              'criminal-law',
  'CRIMINAL LAW AND PRACTICE': 'criminal-law',
  'CRIMINAL LITIGATION':       'criminal-law',
}

function detectTopicSlug(path: string[]): string | null {
  for (const part of path) {
    const upper = part.toUpperCase().trim()
    if (HEADER_TO_SLUG[upper]) return HEADER_TO_SLUG[upper]
    for (const [key, slug] of Object.entries(HEADER_TO_SLUG)) {
      if (upper.includes(key) || key.includes(upper)) return slug
    }
  }
  return null
}

export interface ExtractionProgress {
  stage: 'parsing' | 'sections_found' | 'extracting' | 'done' | 'error'
  message: string
  sections_total?: number
  sections_done?: number
  chunks_found?: number
  /** Emitted once after parsing, before extraction — lists every section path found.
   *  Lets the admin verify the parser found all expected topics before extraction runs. */
  sections_found?: string[]
  /** Emitted alongside sections_found — the heading styles the parser actually detected
   *  in this document and the level it assigned each one, so a misread hierarchy is
   *  visible before extraction runs rather than discovered after the fact. */
  heading_styles?: Array<{ level: number; kind: string; sample: string; count: number; source: string }>
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: docx → raw OOXML → structured blocks → section tree
//
// The heading hierarchy in these notes is conveyed through TEXT COLOUR, not
// just bold/italic/caps:
//   black ALL-CAPS underlined   → topic        (e.g. BUSINESS LAW AND PRACTICE)
//   red   ALL-CAPS underlined   → subtopic      (e.g. BUSINESS MODELS)
//   blue  ALL-CAPS underlined   → section       (e.g. OVERVIEW)
//   green underlined, not caps  → subsection    (e.g. Sole trader)
//   orange underlined, not italic → definition block heading, subpoints follow
//   red ALL-CAPS italic, not underlined → NOTE — flagged, not part of the hierarchy
//
// Mammoth's HTML output strips run colour entirely, so this structure was
// invisible to the old parser (it could only guess from bold/italic/links).
// This stage reads word/document.xml directly via JSZip so colour, bold,
// italic, and underline are all available per run, exactly as Word stored them.
// ─────────────────────────────────────────────────────────────────────────────

interface DocxRun {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  color: string | null     // 6-digit hex, uppercase, or null if unset/"auto"
  fontSize: number | null  // points (Word stores half-points; halved here), or null if not set
}

interface DocxParagraph {
  kind: 'paragraph'
  runs: DocxRun[]
  pStyle: string | null   // Word's own paragraph style id (e.g. "Heading1", "Title") when the
                           // author used Word's built-in heading styles — a reliable signal that
                           // doesn't depend on guessing from colour/bold at all
  page: number
}

interface DocxTable {
  kind: 'table'
  rows: string[][]
  headerRowEmphasis: boolean   // true unconditionally — row 0 is the header by table convention,
                                // bold or not (see parseTableXml)
  firstColEmphasis: boolean    // column 0 reads as a row-label column
  page: number
}

type DocxBlock = DocxParagraph | DocxTable

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
}

/** Parse a single <w:r>...</w:r> run into its text + formatting. */
function parseRun(runXml: string): DocxRun {
  const rPrMatch = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
  const rPr = rPrMatch ? rPrMatch[1] : ''

  // <w:b/> = on. <w:b w:val="0"|"false"|"none"/> = explicitly off.
  const flagPresent = (tag: string): boolean => {
    const m = rPr.match(new RegExp(`<w:${tag}\\b([^>]*)\\/?>`))
    if (!m) return false
    const valMatch = m[1].match(/w:val="([^"]+)"/)
    if (!valMatch) return true
    return !['0', 'false', 'none'].includes(valMatch[1].toLowerCase())
  }

  const underlineTag = rPr.match(/<w:u\b([^>]*)\/?>/)
  const underline = !!underlineTag && (() => {
    const valMatch = underlineTag[1].match(/w:val="([^"]+)"/)
    return !valMatch || valMatch[1].toLowerCase() !== 'none'
  })()

  const colorTag = rPr.match(/<w:color\b([^>]*)\/?>/)
  let color: string | null = null
  if (colorTag) {
    const valMatch = colorTag[1].match(/w:val="([0-9A-Fa-f]{6}|auto)"/i)
    if (valMatch && valMatch[1].toLowerCase() !== 'auto') color = valMatch[1].toUpperCase()
  }

  const szTag = rPr.match(/<w:sz\b([^>]*)\/?>/)
  let fontSize: number | null = null
  if (szTag) {
    const valMatch = szTag[1].match(/w:val="(\d+)"/)
    if (valMatch) fontSize = parseInt(valMatch[1], 10) / 2  // half-points → points
  }

  const textMatches = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
  const text = textMatches.map(m => decodeXmlEntities(m[1])).join('')

  return { text, bold: flagPresent('b'), italic: flagPresent('i'), underline, color, fontSize }
}

/** Parse a <w:p ...>...</w:p> block into its runs plus Word's own paragraph style id, if any. */
function parseParagraphXml(pXml: string): { runs: DocxRun[]; pStyle: string | null } {
  const pPrMatch = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)
  let pStyle: string | null = null
  if (pPrMatch) {
    const styleMatch = pPrMatch[1].match(/<w:pStyle\s+w:val="([^"]+)"/)
    if (styleMatch) pStyle = styleMatch[1]
  }
  const runMatches = [...pXml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)]
  const runs = runMatches.map(m => parseRun(m[0])).filter(r => r.text.length > 0)
  return { runs, pStyle }
}

/**
 * Parse a <w:tbl>...</w:tbl> block into a plain-text grid.
 *
 * Header detection does NOT depend on bold: row 0 is always treated as the
 * header (the universal tabular convention — true whether or not the author
 * bothered to bold it), and the optional header separator/bolding for the
 * first column is decided from a broadened formatting signal (bold, italic,
 * underline, OR a non-default colour on a majority of that column's data
 * cells) rather than bold alone. None of this gates whether a cell's text
 * makes it into the chunk — every cell is captured regardless.
 */
function parseTableXml(tblXml: string): DocxTable {
  const rowMatches = [...tblXml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)]
  const rows: string[][] = []
  const cellRunsByRow: DocxRun[][][] = []

  for (const rowMatch of rowMatches) {
    const cellMatches = [...rowMatch[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)]
    const cells: string[] = []
    const cellRuns: DocxRun[][] = []
    for (const cellMatch of cellMatches) {
      const runs = [...cellMatch[0].matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)]
        .map(m => parseRun(m[0]))
        .filter(r => r.text.trim().length > 0)
      cells.push(runs.map(r => r.text).join(' ').replace(/\s+/g, ' ').trim())
      cellRuns.push(runs)
    }
    if (cells.some(c => c.length > 0)) {
      rows.push(cells)
      cellRunsByRow.push(cellRuns)
    }
  }

  const hasEmphasis = (runs: DocxRun[]): boolean =>
    runs.length > 0 && runs.some(r => r.bold || r.underline || r.italic || classifyColor(r.color) !== 'black')

  const dataRowCellRuns = cellRunsByRow.slice(1)
  const firstColHits = dataRowCellRuns.filter(r => r[0] && hasEmphasis(r[0])).length
  const firstColEmphasis = dataRowCellRuns.length > 0 && firstColHits >= Math.ceil(dataRowCellRuns.length * 0.5)

  return {
    kind: 'table',
    rows,
    headerRowEmphasis: true,
    firstColEmphasis,
    page: 0,
  }
}

/** Unzip a docx buffer and return the raw <w:body> inner XML. */
async function readDocumentXmlBody(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('word/document.xml not found — not a valid .docx file')
  const xml = await file.async('string')
  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/)
  return bodyMatch ? bodyMatch[1] : xml
}

/**
 * Walk the document body in order, extracting paragraphs and tables as a flat
 * list of blocks with best-effort page numbers attached.
 *
 * Page numbers come from <w:lastRenderedPageBreak/> markers (and explicit
 * <w:br w:type="page"/> breaks), which Word embeds at the position pagination
 * fell on a page boundary as of the last save that triggered repagination.
 * This is the only pagination signal available without rendering the document,
 * so page numbers are a close approximation — good enough for "which page did
 * this come from" citations, not guaranteed to match a fresh print-to-PDF.
 */
function parseDocxBlocks(bodyXml: string): DocxBlock[] {
  // Tables don't nest in these documents — pull them out first so the paragraph
  // regex below doesn't also match the <w:p> elements living inside table cells.
  const tableXmls: string[] = []
  const withPlaceholders = bodyXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (m) => {
    tableXmls.push(m)
    return ` TBL${tableXmls.length - 1} `
  })

  const blocks: DocxBlock[] = []
  let page = 1

  const tokenRe = /<w:p[ >][\s\S]*?<\/w:p>| TBL(\d+) /g
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(withPlaceholders)) !== null) {
    if (match[1] !== undefined) {
      const table = parseTableXml(tableXmls[parseInt(match[1], 10)])
      table.page = page
      blocks.push(table)
    } else {
      const hasPageBreak = /<w:lastRenderedPageBreak\s*\/>/.test(match[0]) || /<w:br\s+w:type="page"\s*\/?>/.test(match[0])
      const { runs, pStyle } = parseParagraphXml(match[0])
      blocks.push({ kind: 'paragraph', runs, pStyle, page })
      if (hasPageBreak) page++
    }
  }

  return blocks
}

// ─────────────────────────────────────────────────────────────────────────────
// Format-detecting heading classification
//
// Nothing here is hard-coded to one document's colour convention. The model
// is built fresh from each document: find the "body text" baseline (the
// formatting that accounts for the most running text), treat anything that
// looks different from that as a heading candidate, group identical-looking
// candidates together, and rank the resulting groups by visual prominence
// (bigger font, bold, underlined, all-caps, and non-default colour all push
// a style "higher" up the hierarchy). A document that uses Word's built-in
// Heading 1/2/3 styles, one that colour-codes headings, and one that just
// uses bold/caps/size each produce their own model, discovered from the
// text itself rather than from a fixed colour table.
// ─────────────────────────────────────────────────────────────────────────────

type ColorBucket = 'black' | 'red' | 'blue' | 'green' | 'orange' | 'other'

function classifyColor(hex: string | null): ColorBucket {
  if (!hex) return 'black'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'black'
  if (r < 70 && g < 70 && b < 70) return 'black'
  if (r > 130 && g < 100 && b < 100) return 'red'
  if (b > 130 && b >= r && b >= g) return 'blue'
  if (g > 100 && g >= r && g > b) return 'green'
  if (r > 150 && g >= 80 && g <= 200 && b < 100) return 'orange'
  return 'other'
}

interface ParagraphSignature {
  text: string
  color: ColorBucket
  bold: boolean
  italic: boolean
  underline: boolean
  allCaps: boolean
  fontSize: number | null
}

/** The formatting "signature" of a paragraph, taken from its first non-empty run. */
function paragraphSignature(runs: DocxRun[]): ParagraphSignature {
  const text = runs.map(r => r.text).join('').trim()
  const dominant = runs.find(r => r.text.trim().length > 0) ?? runs[0] ??
    { bold: false, italic: false, underline: false, color: null, text: '', fontSize: null }
  const allCaps = text.length > 0 && text === text.toUpperCase() && /[A-Z]{2,}/.test(text)
  return {
    text,
    color: classifyColor(dominant.color),
    bold: dominant.bold,
    italic: dominant.italic,
    underline: dominant.underline,
    allCaps,
    fontSize: dominant.fontSize,
  }
}

/** A signature, collapsed to a string key for grouping identical-looking paragraphs. */
function signatureKey(sig: ParagraphSignature): string {
  return `${sig.bold ? 1 : 0}|${sig.italic ? 1 : 0}|${sig.underline ? 1 : 0}|${sig.color}|${sig.allCaps ? 1 : 0}|${sig.fontSize ?? 'd'}`
}

/**
 * What fraction of a paragraph's characters actually carry its dominant
 * (first non-empty run's) formatting. A real heading is styled uniformly
 * end to end — this comes out near 1.0. A content line with an emphasised
 * lead-in ("**Costs** – no formalities to register, so there are no costs.")
 * is only styled across its first word or two — this comes out low. Without
 * this check, paragraphSignature's "judge the whole paragraph by its first
 * run" shortcut mistakes label-style content lines for headings, since a
 * short bold/coloured lead-in is exactly what genuine headings look like
 * too — only the share of the paragraph it covers tells them apart.
 */
function dominantTextCoverage(runs: DocxRun[]): number {
  const dominant = runs.find(r => r.text.trim().length > 0)
  if (!dominant) return 0
  const totalLen = runs.reduce((sum, r) => sum + r.text.length, 0)
  if (totalLen === 0) return 0
  const matchLen = runs
    .filter(r => r.bold === dominant.bold && r.italic === dominant.italic && r.underline === dominant.underline && r.color === dominant.color)
    .reduce((sum, r) => sum + r.text.length, 0)
  return matchLen / totalLen
}

const HEADING_COVERAGE_THRESHOLD = 0.7

type HeadingKind = 'topic' | 'subtopic' | 'section' | 'subsection' | 'definition' | 'note'

interface HeadingClassification {
  level: number   // hierarchy depth — used for stack-based nesting (0 = note, not nested)
  kind: HeadingKind
  text: string
}

const KIND_BY_DEPTH: HeadingKind[] = ['topic', 'subtopic', 'section', 'subsection', 'definition']
function kindForLevel(level: number): HeadingKind {
  return KIND_BY_DEPTH[Math.min(level, KIND_BY_DEPTH.length) - 1] ?? 'definition'
}

const NOTE_PREFIX_RE = /^(note|nb|n\.b\.|important|warning|caution)\s*[:\-–]/i

/** Content-based note detection — catches notes regardless of how they're styled. */
function isNoteText(text: string): boolean {
  return NOTE_PREFIX_RE.test(text.trim())
}

/**
 * Emphasised + capitalised + slanted + non-underlined reads as a "pay
 * attention" annotation in most hand-formatted notes. The source document
 * this was built against uses red for it, but the signal generalises: any
 * non-black colour in that same combination means the same thing, since
 * notes are deliberately styled to stand OUT from the heading hierarchy
 * rather than nest within it.
 */
function isNoteSignature(sig: ParagraphSignature): boolean {
  return sig.italic && sig.allCaps && !sig.underline && sig.color !== 'black'
}

/** Word's own outline level for a paragraph using a built-in heading style, if any. */
function pStyleLevel(pStyle: string | null): number | null {
  if (!pStyle) return null
  if (/^Title$/i.test(pStyle)) return 1
  const m = pStyle.match(/^Heading(\d)$/i)
  return m ? parseInt(m[1], 10) : null
}

export interface HeadingStyleSummary {
  level: number
  kind: HeadingKind
  sample: string
  count: number
  source: 'word-style' | 'visual'
}

interface HeadingStyleModel {
  bodyKey: string | null
  visualLevels: Map<string, { level: number; kind: HeadingKind }>
  summary: HeadingStyleSummary[]
}

/**
 * Pass 1 — scan every paragraph once and discover, from how it's actually
 * formatted, what its place in the heading hierarchy is. See the section
 * comment above for the approach.
 */
function buildHeadingStyleModel(paragraphs: DocxParagraph[]): HeadingStyleModel {
  // Explicit Word heading styles are the most reliable signal available —
  // trust them completely and keep those paragraphs out of the visual
  // clustering pool below.
  const explicit = new Set<DocxParagraph>()
  for (const p of paragraphs) {
    if (pStyleLevel(p.pStyle) !== null) explicit.add(p)
  }

  // Body-text baseline: the signature accounting for the most characters of
  // running text. Headings are short and rare by definition, so the bulk of
  // the document's character count is body text, whatever that looks like.
  const charsBySignature = new Map<string, number>()
  for (const p of paragraphs) {
    if (explicit.has(p)) continue
    const text = p.runs.map(r => r.text).join('')
    if (!text.trim()) continue
    charsBySignature.set(signatureKey(paragraphSignature(p.runs)), (charsBySignature.get(signatureKey(paragraphSignature(p.runs))) ?? 0) + text.length)
  }
  let bodyKey: string | null = null
  let bodyChars = -1
  for (const [key, chars] of charsBySignature) {
    if (chars > bodyChars) { bodyChars = chars; bodyKey = key }
  }
  let bodyFontSize: number | null = null
  if (bodyKey) {
    for (const p of paragraphs) {
      const sig = paragraphSignature(p.runs)
      if (signatureKey(sig) === bodyKey) { bodyFontSize = sig.fontSize; break }
    }
  }

  // Cluster heading candidates — short paragraphs that don't read as body
  // text, aren't list items, and aren't notes — by their formatting signature.
  const clusters = new Map<string, { sig: ParagraphSignature; count: number; sample: string }>()
  for (const p of paragraphs) {
    if (explicit.has(p)) continue
    const text = p.runs.map(r => r.text).join('').trim()
    if (!text || text.length > 140) continue
    if (LIST_ITEM_RE.test(text)) continue
    if (dominantTextCoverage(p.runs) < HEADING_COVERAGE_THRESHOLD) continue
    const sig = paragraphSignature(p.runs)
    if (isNoteSignature(sig) || isNoteText(text)) continue
    const key = signatureKey(sig)
    if (key === bodyKey) continue
    const looksDistinct = sig.bold || sig.italic || sig.underline || sig.allCaps || sig.color !== 'black' ||
      (sig.fontSize !== null && bodyFontSize !== null && sig.fontSize > bodyFontSize)
    if (!looksDistinct) continue
    const existing = clusters.get(key)
    if (existing) existing.count++
    else clusters.set(key, { sig, count: 1, sample: text })
  }

  // Rank by visual prominence — bigger, bolder, underlined, all-caps, and
  // colour-coded styles read as higher-level (broader) headings.
  const scored = [...clusters.entries()].map(([key, c]) => {
    const sizeDelta = c.sig.fontSize !== null && bodyFontSize !== null ? c.sig.fontSize - bodyFontSize : 0
    const score =
      sizeDelta * 10 +
      (c.sig.allCaps ? 6 : 0) +
      (c.sig.underline ? 4 : 0) +
      (c.sig.bold ? 3 : 0) +
      (c.sig.color !== 'black' ? 2 : 0) +
      (c.sig.italic && !c.sig.bold ? -1 : 0)
    return { key, score, count: c.count, sample: c.sample }
  }).sort((a, b) => b.score - a.score)

  const visualLevels = new Map<string, { level: number; kind: HeadingKind }>()
  const summary: HeadingStyleSummary[] = []
  scored.forEach((c, i) => {
    const level = i + 1
    const kind = kindForLevel(level)
    visualLevels.set(c.key, { level, kind })
    summary.push({ level, kind, sample: c.sample, count: c.count, source: 'visual' })
  })

  // Surface any Word-style headings in the same summary for admin visibility.
  const wordStyleCounts = new Map<number, { count: number; sample: string }>()
  for (const p of paragraphs) {
    const lvl = pStyleLevel(p.pStyle)
    if (lvl === null) continue
    const text = p.runs.map(r => r.text).join('').trim()
    const existing = wordStyleCounts.get(lvl)
    if (existing) existing.count++
    else wordStyleCounts.set(lvl, { count: 1, sample: text })
  }
  for (const [level, info] of wordStyleCounts) {
    summary.push({ level, kind: kindForLevel(level), sample: info.sample, count: info.count, source: 'word-style' })
  }
  summary.sort((a, b) => a.level - b.level)

  return { bodyKey, visualLevels, summary }
}

/**
 * Classify one paragraph against a model already built for this document.
 * Word heading styles win outright when present; otherwise the paragraph's
 * signature is looked up in the model discovered from the whole document.
 */
function classifyHeadingParagraph(p: DocxParagraph, model: HeadingStyleModel): HeadingClassification | null {
  const text = p.runs.map(r => r.text).join('').trim()
  if (!text) return null

  const explicitLevel = pStyleLevel(p.pStyle)
  if (explicitLevel !== null && text.length <= 200) {
    return { level: explicitLevel, kind: kindForLevel(explicitLevel), text }
  }

  if (text.length > 140) return null
  if (dominantTextCoverage(p.runs) < HEADING_COVERAGE_THRESHOLD) return null

  const sig = paragraphSignature(p.runs)
  if (isNoteSignature(sig)) return { level: 0, kind: 'note', text }

  const key = signatureKey(sig)
  if (key === model.bodyKey) return null

  const match = model.visualLevels.get(key)
  return match ? { level: match.level, kind: match.kind, text } : null
}

/** Render a content paragraph's runs to markdown-ish plain text, preserving emphasis. */
function renderParagraphText(runs: DocxRun[]): string {
  return runs
    .map(r => {
      const t = r.text
      if (!t.trim()) return t
      const colorBucket = classifyColor(r.color)
      const colourOnlyEmphasis = colorBucket !== 'black' && colorBucket !== 'other' && !r.bold && !r.italic
      if (r.bold && r.italic) return `**_${t}_**`
      if (r.bold || colourOnlyEmphasis) return `**${t}**`
      if (r.italic) return `_${t}_`
      return t
    })
    .join('')
}

/** Render a parsed table to a markdown table — header separator after row 1 always inserted, regardless of formatting. */
function renderTableMarkdown(t: DocxTable): string {
  if (t.rows.length === 0) return ''
  const lines: string[] = []
  t.rows.forEach((row, ri) => {
    const cells = row.map((cell, ci) => {
      const isHeaderRow = ri === 0 && t.headerRowEmphasis
      const isHeaderCol = ci === 0 && ri > 0 && t.firstColEmphasis
      return (isHeaderRow || isHeaderCol) ? `**${cell}**` : cell
    })
    lines.push('| ' + cells.join(' | ') + ' |')
    if (ri === 0) lines.push('| ' + row.map(() => '---').join(' | ') + ' |')
  })
  return lines.join('\n')
}

/**
 * Build the section tree directly from ordered docx blocks, classifying
 * headings against the model already discovered for this document.
 * Headings push/pop a stack by level; notes and tables attach as content to
 * whichever section is currently open; content before the first heading
 * (cover page / table of contents) is discarded.
 */
function buildSectionTreeFromBlocks(blocks: DocxBlock[], model: HeadingStyleModel): DocSection[] {
  const roots: DocSection[] = []
  const stack: DocSection[] = []

  function appendContent(text: string, page: number) {
    if (!text.trim() || stack.length === 0) return
    const top = stack[stack.length - 1]
    top.content += (top.content ? '\n\n' : '') + text
    if (top.firstPage === null) top.firstPage = page
  }

  for (const block of blocks) {
    if (block.kind === 'table') {
      appendContent(renderTableMarkdown(block), block.page)
      continue
    }

    const text = block.runs.map(r => r.text).join('').trim()
    if (!text) continue

    const heading = classifyHeadingParagraph(block, model)

    if (heading?.kind === 'note') {
      appendContent(`**[NOTE]** ${text}`, block.page)
      continue
    }

    if (heading) {
      const section: DocSection = {
        level: heading.level,
        title: heading.text,
        path: [],
        content: '',
        children: [],
        firstPage: block.page,
      }
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop()
      }
      section.path = [...stack.map(s => s.title), heading.text]
      if (stack.length === 0) roots.push(section)
      else stack[stack.length - 1].children.push(section)
      stack.push(section)
      continue
    }

    const rendered = renderParagraphText(block.runs)
    appendContent(isNoteText(text) ? `**[NOTE]** ${rendered}` : rendered, block.page)
  }

  return roots
}

/** Full Stage 1 entry point: docx buffer → section tree, with auto-discovered headings and page tracking. */
export async function parseDocxToSections(buffer: Buffer): Promise<{ sections: DocSection[]; headingStyles: HeadingStyleSummary[] }> {
  const bodyXml = await readDocumentXmlBody(buffer)
  const blocks = parseDocxBlocks(bodyXml)
  const paragraphs = blocks.filter((b): b is DocxParagraph => b.kind === 'paragraph')
  const model = buildHeadingStyleModel(paragraphs)
  const sections = buildSectionTreeFromBlocks(blocks, model)
  return { sections, headingStyles: model.summary }
}

/**
 * Flatten a section tree into leaf sections that have content.
 * A "leaf" is either a section with no children, or a section where
 * the content is substantial enough to process independently.
 */
export function flattenToLeaves(sections: DocSection[]): DocSection[] {
  const leaves: DocSection[] = []

  function walk(section: DocSection) {
    // No minimum content length — even a single sentence is a legal rule we must not lose.
    const hasContent = section.content.trim().length > 0
    const hasChildren = section.children.length > 0

    if (!hasChildren && hasContent) {
      leaves.push(section)
    } else if (hasChildren) {
      // If this section has its own content (intro text above its child sections),
      // emit it as a virtual leaf first so it isn't lost.
      if (hasContent) {
        leaves.push({ ...section, children: [] })
      }
      section.children.forEach(walk)
    }
    // Sections with no content and no children are structural noise — skip.
  }

  sections.forEach(walk)
  return leaves
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Deterministic chunk splitting (notes mode)
//
// Each leaf section's markdown content is split into atomic units in document
// order. No LLM is used for segmentation — everything is verbatim and complete:
//
//   Table blocks   (lines starting with |) → one chunk per table
//   Pure list blocks (every non-empty line is a list item) → one chunk per item
//   Mixed blocks    (prose + list, or prose only) → one chunk per block
//
// This guarantees 100% coverage, strict source order, and eliminates Sonnet
// cost and latency from the notes extraction phase entirely.
// Haiku still classifies each chunk for rule_type + key_terms.
// ─────────────────────────────────────────────────────────────────────────────

// Matches lines that begin with a list marker: "- item", "• item", "1. item", "1) item"
const LIST_ITEM_RE = /^(?:[-•*]|\d+[.)]) /

/** Find the paragraph boundary (double newline) nearest to `target` index. */
function findParagraphBoundary(text: string, target: number): number {
  const before = text.lastIndexOf('\n\n', target)
  const after  = text.indexOf('\n\n', target)
  if (before === -1 && after === -1) return target
  if (before === -1) return after + 2
  if (after  === -1) return before + 2
  return (target - before) <= (after - target) ? before + 2 : after + 2
}

/** Wait for `ms` milliseconds — used for exponential back-off on API errors. */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Split a section's markdown content into atomic units for chunk creation.
 * All content is preserved verbatim and in document order.
 *
 * Table block  → one unit (keeps column headers with data rows)
 * Pure list    → one unit per list item (each stands alone as a rule/exception)
 * Mixed/prose  → one unit per paragraph block (prose provides context for any list beneath it)
 */
function splitContentIntoUnits(content: string): string[] {
  const units: string[] = []

  // Work block by block (blank lines separate blocks)
  const blocks = content.split(/\n{2,}/)

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed || trimmed.length < 5) continue

    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    // ── Table block ────────────────────────────────────────────────────────────
    // Keep the whole table as one chunk so column headers stay with data rows.
    if (lines[0].startsWith('|')) {
      units.push(trimmed)
      continue
    }

    const listLines  = lines.filter(l => LIST_ITEM_RE.test(l))
    const proseLines = lines.filter(l => !LIST_ITEM_RE.test(l))

    if (listLines.length > 0 && proseLines.length === 0) {
      // ── Pure list block ────────────────────────────────────────────────────
      // Each item is a separate chunk — they're standalone rules or exceptions.
      for (const item of listLines) {
        if (item.length >= 10) units.push(item)
      }
    } else {
      // ── Mixed or prose block ───────────────────────────────────────────────
      // Prose + list: the prose is the context (e.g. "Approval not required for:").
      // Splitting would make the list items meaningless in isolation, so keep together.
      if (trimmed.length >= 10) units.push(trimmed)
    }
  }

  return units
}

// ── Haiku classification — also unlimited via auto-split batching ─────────────

const CLASSIFY_SYSTEM_PROMPT = `You are classifying pre-extracted UK law knowledge chunks for SQE1 exam preparation.

For each numbered chunk, return ONLY:
- rule_type: what kind of legal rule it is
- key_terms: up to 5 specific legal terms exactly as they appear in the chunk text

Do NOT modify, reproduce, or summarise the chunk text. Classify only.

rule_type values: definition | threshold | test | exception | procedure | consequence | general_principle | uncertain
"uncertain" = statutory reference looks corrupt or meaning is genuinely ambiguous.

Return ONLY a JSON array, one object per chunk, same order as input. No explanation, no fences.
[{"rule_type":"...","key_terms":["term1","term2"]}]`

// 40 chunks × ~100 chars of JSON per classification ≈ 4 000 chars ≈ 1 000 tokens output
// — far under Haiku's 8 192 ceiling. If a chunk is abnormally long, auto-split handles it.
const CLASSIFY_BATCH_SIZE = 40

type ClassifyOutcome =
  | { ok: true;  results: Array<{ rule_type: ExtractedChunk['rule_type']; key_terms: string[] }> }
  | { ok: false; reason: 'truncated' | 'api_error' }

async function classifyBatchOnce(
  client: Anthropic,
  chunkTexts: string[],
  sectionContext: string,
): Promise<ClassifyOutcome> {
  const numbered = chunkTexts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')

  let message: Awaited<ReturnType<typeof client.messages.create>>
  try {
    message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Section: ${sectionContext}\n\nChunks:\n${numbered}`,
      }],
    })
  } catch (err) {
    console.error(`[chunk-extractor] Haiku API error:`, err)
    return { ok: false, reason: 'api_error' }
  }

  if (message.stop_reason === 'max_tokens') {
    return { ok: false, reason: 'truncated' }
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return { ok: false, reason: 'truncated' }
    return {
      ok: true,
      results: parsed.map((p: { rule_type?: string; key_terms?: string[] }) => ({
        rule_type: (p.rule_type as ExtractedChunk['rule_type']) ?? 'general_principle',
        key_terms: Array.isArray(p.key_terms) ? p.key_terms : [],
      })),
    }
  } catch {
    return { ok: false, reason: 'truncated' }
  }
}

const DEFAULT_CLASSIFICATION = { rule_type: 'general_principle' as const, key_terms: [] }

async function classifyChunkBatch(
  client: Anthropic,
  chunkTexts: string[],
  sectionContext: string,
  depth = 0,
): Promise<Array<{ rule_type: ExtractedChunk['rule_type']; key_terms: string[] }>> {
  if (chunkTexts.length === 0) return []

  const outcome = await classifyBatchOnce(client, chunkTexts, sectionContext)

  if (outcome.ok) return outcome.results

  if (outcome.reason === 'api_error') {
    // Retry with back-off — do NOT bisect
    for (let attempt = 1; attempt <= 2; attempt++) {
      await sleep(1000 * attempt)
      const retry = await classifyBatchOnce(client, chunkTexts, sectionContext)
      if (retry.ok) return retry.results
      if (retry.reason === 'api_error') continue
      break
    }
    // Persistent API error — return defaults rather than dropping chunks
    return chunkTexts.map(() => DEFAULT_CLASSIFICATION)
  }

  // Truncated — bisect the batch
  if (chunkTexts.length === 1 || depth >= 8) {
    return chunkTexts.map(() => DEFAULT_CLASSIFICATION)
  }

  const mid = Math.floor(chunkTexts.length / 2)
  const [first, second] = await Promise.all([
    classifyChunkBatch(client, chunkTexts.slice(0, mid), sectionContext, depth + 1),
    classifyChunkBatch(client, chunkTexts.slice(mid),    sectionContext, depth + 1),
  ])
  return [...first, ...second]
}

async function extractChunksFromSection(
  client: Anthropic,
  section: DocSection,
  topicName: string,
): Promise<ExtractedChunk[]> {
  const breadcrumb   = section.path.join(' > ') + (section.firstPage ? ` (p. ${section.firstPage})` : '')
  const subtopicName = section.path[1] ?? section.path[0] ?? topicName
  const sectionName  = section.path[section.path.length - 1] ?? subtopicName
  const topicSlug    = detectTopicSlug(section.path)

  if (!section.content.trim()) return []

  // ── Step 1: Deterministic splitting — verbatim, 100% coverage, in doc order ──
  const units = splitContentIntoUnits(section.content)
  if (units.length === 0) return []

  // ── Step 2: Haiku classifies — auto-split batching for unlimited capacity ──
  const allClassifications: Array<{ rule_type: ExtractedChunk['rule_type']; key_terms: string[] }> = []
  for (let i = 0; i < units.length; i += CLASSIFY_BATCH_SIZE) {
    const result = await classifyChunkBatch(client, units.slice(i, i + CLASSIFY_BATCH_SIZE), breadcrumb)
    allClassifications.push(...result)
  }

  return units.map((text, i) => {
    const meta = allClassifications[i] ?? { rule_type: 'general_principle' as const, key_terms: [] }
    return {
      rule_text:          text.trim(),
      exact_source_quote: null,
      context_text:       null,
      key_terms:          meta.key_terms,
      rule_type:          meta.rule_type,
      source_section:     breadcrumb,
      subtopic_name:      subtopicName,
      section_name:       sectionName,
      topic_slug:         topicSlug,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions mode: extract legal rules FROM sample MCQ papers
// ─────────────────────────────────────────────────────────────────────────────

const QUESTIONS_EXTRACTION_SYSTEM_PROMPT = `You are analyzing official SQE1 sample exam questions to extract the underlying legal rules being tested.

Your output will be used as the SOURCE OF TRUTH for generating study content. Accuracy and traceability are more important than conciseness.

For each MCQ provided:
1. Copy the CORRECT ANSWER and its explanation verbatim into "exact_source_quote"
2. State the legal rule it tests precisely in "rule_text"
3. Note the trap or misconception the question is designed to catch in "context_text"

STRICT RULES — do not break any of these:

1. VERBATIM QUOTE. "exact_source_quote" must copy the correct answer text and/or the explanation text from the question exactly — word for word. Do not paraphrase.

2. STATUTORY REFERENCES EXACTLY. If the answer mentions "s.172 CA 2006", write exactly that. If the section number looks inconsistent or garbled, flag it as rule_type "uncertain" and explain in context_text.

3. PRESERVE ALL QUALIFIERS. Do not drop thresholds, time limits, exceptions, percentages, or party names.

4. DO NOT INVENT. If you cannot identify a clear statutory reference from the question text, do not add one. Leave it out of rule_text and flag in context_text instead.

5. SELF-CHECK before finalising each chunk:
   - Is exact_source_quote copied verbatim from the question above?
   - Is the statutory reference exactly as it appears in the question?
   - Did I preserve all exceptions and qualifiers?

Return ONLY a JSON array. No explanation, no markdown fences.

[
  {
    "exact_source_quote": "Verbatim text of the correct answer / explanation from the question",
    "rule_text": "The precise legal rule the question tests — must match the verbatim quote in substance",
    "context_text": "The common misconception the wrong options exploit; also note any ambiguity or corrupted section numbers",
    "key_terms": ["exact legal term as written in question"],
    "rule_type": "definition|threshold|test|exception|procedure|consequence|general_principle|uncertain",
    "subtopic_name": "Specific area (e.g. Directors' Duties)",
    "section_name": "Specific aspect (e.g. s.172 Duty to promote success of the company)"
  }
]`

const QUESTIONS_PER_EXTRACTION_BATCH = 5

/**
 * Split raw text from a sample question PDF into batches of questions.
 */
function splitIntoQuestionBatches(text: string): string[] {
  const questionSplits = [...text.matchAll(/\n(?=Question\s+\d{1,3}\s*\n)/gi)]

  if (questionSplits.length >= 5) {
    const positions = questionSplits.map(m => m.index!)
    positions.push(text.length)

    const questionBlocks: string[] = []
    for (let i = 0; i < positions.length - 1; i++) {
      const block = text.slice(positions[i], positions[i + 1]).trim()
      if (block.length > 50) questionBlocks.push(block)
    }

    const batches: string[] = []
    for (let i = 0; i < questionBlocks.length; i += QUESTIONS_PER_EXTRACTION_BATCH) {
      batches.push(questionBlocks.slice(i, i + QUESTIONS_PER_EXTRACTION_BATCH).join('\n\n---\n\n'))
    }
    return batches
  }

  // Fallback: numbered paragraphs "1." or chunk by size
  const numbered = [...text.matchAll(/\n(?=\d{1,3}[\.\)]\s)/g)]
  if (numbered.length >= 5) {
    const positions = numbered.map(m => m.index!)
    positions.push(text.length)
    const blocks = positions.slice(0, -1).map((p, i) => text.slice(p, positions[i + 1]).trim()).filter(b => b.length > 50)
    const batches: string[] = []
    for (let i = 0; i < blocks.length; i += QUESTIONS_PER_EXTRACTION_BATCH) {
      batches.push(blocks.slice(i, i + QUESTIONS_PER_EXTRACTION_BATCH).join('\n\n---\n\n'))
    }
    return batches
  }

  // Last resort: split at double-newlines (paragraph boundaries) in runs of ≤8 000 chars.
  // Never cut inside a paragraph — the boundary must be a blank line.
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 20)
  const chunks: string[] = []
  let current = ''
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > 8000 && current.length > 0) {
      chunks.push(current.trim())
      current = para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text]  // always return at least something
}

async function extractChunksFromQuestionBatch(
  client: Anthropic,
  batch: string,
  batchIndex: number,
  topicHint: string,
): Promise<ExtractedChunk[]> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: QUESTIONS_EXTRACTION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Topic context: ${topicHint}\nBatch ${batchIndex + 1}:\n\n${batch}`,
    }],
  })

  if (message.stop_reason === 'max_tokens') {
    // Split the batch in half and retry each piece independently
    console.warn(
      `[chunk-extractor] Questions batch ${batchIndex} truncated — splitting into two sub-batches`
    )
    const mid = findParagraphBoundary(batch, Math.floor(batch.length / 2)) || Math.floor(batch.length / 2)
    const [firstHalf, secondHalf] = await Promise.all([
      extractChunksFromQuestionBatch(client, batch.slice(0, mid), batchIndex * 10,     topicHint),
      extractChunksFromQuestionBatch(client, batch.slice(mid),    batchIndex * 10 + 1, topicHint),
    ])
    return [...firstHalf, ...secondHalf]
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: Array<{
    exact_source_quote?: string
    rule_text: string
    context_text?: string
    key_terms?: string[]
    rule_type?: string
    subtopic_name?: string
    section_name?: string
  }>

  try {
    parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('Not an array')
  } catch {
    console.error(`[chunk-extractor] Questions batch ${batchIndex} parse failed:`, cleaned.slice(0, 200))
    return []
  }

  const topicSlug = detectTopicSlug([topicHint, batch.slice(0, 500)])

  return parsed
    .filter(c => c.rule_text && c.rule_text.trim().length > 10)
    .map(c => ({
      rule_text: c.rule_text.trim(),
      exact_source_quote: null,
      context_text: c.context_text ?? null,
      key_terms: Array.isArray(c.key_terms) ? c.key_terms : [],
      rule_type: (c.rule_type as ExtractedChunk['rule_type']) ?? 'general_principle',
      source_section: `Sample Questions — ${topicHint} — Batch ${batchIndex + 1}`,
      subtopic_name: c.subtopic_name ?? topicHint,
      section_name: c.section_name ?? `Batch ${batchIndex + 1}`,
      topic_slug: topicSlug,
    }))
}

/**
 * Extract knowledge chunks from a sample MCQ paper (raw text, e.g. from PDF).
 * Reads each question and extracts the underlying legal rule being tested —
 * not the question itself, but the rule a student must know to answer correctly.
 */
export async function extractChunksFromQuestions(
  rawText: string,
  topicName: string,
  onProgress: (p: ExtractionProgress) => void,
  onChunks?: (chunks: ExtractedChunk[]) => Promise<void>,
): Promise<ExtractedChunk[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  onProgress({ stage: 'parsing', message: 'Splitting questions into batches…' })

  const batches = splitIntoQuestionBatches(rawText)

  if (batches.length === 0) {
    onProgress({ stage: 'error', message: 'No question batches found.', error: 'No questions detected' })
    throw new Error('No question batches found')
  }

  onProgress({
    stage: 'parsing',
    message: `Found ${batches.length} batches (~${QUESTIONS_PER_EXTRACTION_BATCH} questions each)`,
    sections_total: batches.length,
    sections_done: 0,
    chunks_found: 0,
  })

  const allChunks: ExtractedChunk[] = []

  for (let i = 0; i < batches.length; i++) {
    onProgress({
      stage: 'extracting',
      message: `Extracting rules from batch ${i + 1} / ${batches.length}…`,
      sections_total: batches.length,
      sections_done: i,
      chunks_found: allChunks.length,
    })

    try {
      const chunks = await extractChunksFromQuestionBatch(client, batches[i], i, topicName)
      allChunks.push(...chunks)
      // Flush this batch's chunks immediately so partial progress survives a dropped connection
      if (onChunks && chunks.length > 0) {
        await onChunks(chunks)
      }
    } catch (err) {
      console.error(`[chunk-extractor] Error on question batch ${i}:`, err)
    }
  }

  onProgress({
    stage: 'done',
    message: `Done — ${allChunks.length} legal rules extracted from questions`,
    sections_total: batches.length,
    sections_done: batches.length,
    chunks_found: allChunks.length,
  })

  return allChunks
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full two-stage pipeline.
 *
 * @param buffer     - raw docx file buffer
 * @param topicName  - human-readable topic name for Claude context (e.g. "Business Law and Practice")
 * @param onProgress - callback for streaming progress to the admin UI
 * @param onChunks   - optional callback invoked after each section completes, with that section's chunks.
 *                     Use this to persist chunks incrementally — if the connection drops mid-extraction,
 *                     everything flushed via onChunks is already saved.
 * @returns          - flat array of all extracted chunks (same data as delivered via onChunks)
 */
export async function extractChunksFromDocx(
  buffer: Buffer,
  topicName: string,
  onProgress: (p: ExtractionProgress) => void,
  onChunks?: (chunks: ExtractedChunk[]) => Promise<void>,
): Promise<ExtractedChunk[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Stage 1: Parse ──────────────────────────────────────────────────────────
  onProgress({ stage: 'parsing', message: 'Reading document structure and detecting its heading format…' })

  let tree: DocSection[]
  let headingStyles: HeadingStyleSummary[] = []
  try {
    const parsed = await parseDocxToSections(buffer)
    tree = parsed.sections
    headingStyles = parsed.headingStyles
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    onProgress({ stage: 'error', message: 'Failed to parse document', error: msg })
    throw err
  }

  const leaves = flattenToLeaves(tree)

  if (leaves.length === 0) {
    onProgress({ stage: 'error', message: 'No sections found in document. Check the document structure.' })
    throw new Error('No sections found')
  }

  // Emit section tree before extraction so the admin can verify all expected topics were found.
  // If a topic is missing here, the parser didn't detect it — check heading formatting in the docx.
  const sectionPaths = leaves.map(l => l.path.join(' > ') || l.title)
  onProgress({
    stage: 'sections_found',
    message: `Found ${leaves.length} sections — verify all expected topics appear below before extraction starts`,
    sections_total: leaves.length,
    sections_done: 0,
    chunks_found: 0,
    sections_found: sectionPaths,
    heading_styles: headingStyles,
  })

  // ── Stage 2: Extract ────────────────────────────────────────────────────────
  const allChunks: ExtractedChunk[] = []

  for (let i = 0; i < leaves.length; i++) {
    const section = leaves[i]
    const label = section.path.slice(-2).join(' > ') || section.title

    onProgress({
      stage: 'extracting',
      message: `Extracting: ${label}`,
      sections_total: leaves.length,
      sections_done: i,
      chunks_found: allChunks.length,
    })

    try {
      const chunks = await extractChunksFromSection(client, section, topicName)
      allChunks.push(...chunks)
      // Flush this section's chunks immediately so partial progress survives a dropped connection
      if (onChunks && chunks.length > 0) {
        await onChunks(chunks)
      }
    } catch (err) {
      // Log but continue — don't fail the whole extraction for one section
      console.error(`[chunk-extractor] Error on section "${label}":`, err)
    }
  }

  onProgress({
    stage: 'done',
    message: `Extraction complete — ${allChunks.length} knowledge chunks found`,
    sections_total: leaves.length,
    sections_done: leaves.length,
    chunks_found: allChunks.length,
  })

  return allChunks
}
