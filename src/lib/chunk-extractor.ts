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
  // Populated only in "questions" mode — the verbatim correct-answer/explanation text
  // from the sample question this chunk was extracted from. Used later as a style
  // reference for AI-generated questions (never reproduced verbatim in new questions).
  exact_source_quote: string | null
  context_text?: string | null
  key_terms: string[]
  rule_type: 'definition' | 'threshold' | 'test' | 'exception' | 'procedure' | 'consequence' | 'general_principle' | 'uncertain'
  source_section: string   // human-readable breadcrumb
  source_page_start: number | null  // best-effort first page this rule appears on
  source_page_end: number | null    // best-effort last page this rule appears on
  subtopic_name: string
  section_name: string
  topic_slug: string | null
  // Populated only in "questions" mode — Claude's read on how hard the sample
  // question this chunk came from actually is, and why. Feeds the per-topic
  // question style guide and helps calibrate AI-generated question difficulty.
  inferred_difficulty: 'easy' | 'medium' | 'hard' | null
  difficulty_reason: string | null
}

// Mirrors the mapping in chunker.ts — kept in sync manually
export const HEADER_TO_SLUG: Record<string, string> = {
  'BUSINESS LAW AND PRACTICE': 'business-law',
  'BUSINESS LAW':              'business-law',
  'DISPUTE RESOLUTION':        'dispute-resolution',
  'CONTRACT':                  'contract',
  'TORT':                      'tort',
  // FLK1 no longer has a separate "Legal Services" topic — it and "Legal System and
  // Constitutional Law" were merged into one topic, renamed "Public" in the app. Every header
  // variant for either of the old two topics maps to that same slug now, hard-coded here so a
  // re-upload can never recreate "Legal Services" as its own topic again.
  'PUBLIC':                    'legal-system',
  'PUBLIC LAW':                'legal-system',
  'LEGAL SYSTEM':              'legal-system',
  'LEGAL SYSTEM AND CONSTITUTIONAL LAW': 'legal-system',
  'LEGAL SERVICES':            'legal-system',
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

export function detectTopicSlug(path: string[], outlineTopicMap?: Map<string, string>): string | null {
  for (const part of path) {
    const upper = part.toUpperCase().trim()
    if (HEADER_TO_SLUG[upper]) return HEADER_TO_SLUG[upper]
    for (const [key, slug] of Object.entries(HEADER_TO_SLUG)) {
      if (upper.includes(key) || key.includes(upper)) return slug
    }
    // Fall back to whatever the Contents page told us this heading belongs to — covers
    // subtopic-level titles (e.g. "Director's duties and responsibilities") that don't
    // appear in the static dictionary above but sit under a recognised topic in the TOC.
    if (outlineTopicMap?.has(upper)) return outlineTopicMap.get(upper)!
  }
  return null
}

// The 12 real SQE1 topic slugs (deduped from HEADER_TO_SLUG's values) — kept derived rather
// than hand-duplicated so it can never drift out of sync with the dictionary above.
const KNOWN_TOPIC_SLUGS = Array.from(new Set(Object.values(HEADER_TO_SLUG)))

/**
 * AI fallback for topic detection, used only when detectTopicSlug() finds no match.
 *
 * Why this exists: HEADER_TO_SLUG and outlineTopicMap both only recognise the exact 12 SQE1
 * paper/topic names. Revision-note documents very often organise their own chapter headings
 * around narrower real-world categories instead (e.g. "TRADITIONAL PARTNERSHIPS",
 * "BUSINESS MODELS", "FORMATION OF A COMPANY" — none of which literally contain the string
 * "Business Law and Practice"), and a TOC page typically only lists those same narrower
 * headings, never re-stating the broader SQE1 paper name above them. Both lookups then
 * legitimately return null for the entire chapter, and — because a single multi-topic
 * document like a full FLK1 summary can't have one fallback topic preselected for the whole
 * file — every chunk under that chapter was previously dropped silently in flushChunks with
 * zero error surfaced. This call only fires once per chapter heading (cached by the caller)
 * and asks Haiku to do the semantic match a fixed dictionary can't.
 */
async function classifyTopicSlugWithAI(
  client: Anthropic,
  breadcrumb: string,
  sampleText: string,
): Promise<string | null> {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: `You map a UK SQE1 law revision-notes heading to exactly one of these 12 topic slugs:\n${KNOWN_TOPIC_SLUGS.join(', ')}\n\nReturn ONLY the slug, nothing else. If genuinely none fit, return "none".`,
      messages: [{ role: 'user', content: `Heading: ${breadcrumb}\n\nSample content: ${sampleText.slice(0, 400)}` }],
    })
    const raw = message.content[0].type === 'text' ? message.content[0].text.trim().toLowerCase() : 'none'
    return KNOWN_TOPIC_SLUGS.includes(raw) ? raw : null
  } catch (err) {
    console.error(`[chunk-extractor] AI topic-slug fallback failed for "${breadcrumb}":`, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Front matter (Contents / Table of Contents pages)
//
// These pages aren't real legal content — they're the heading hierarchy of the rest of the
// document with page numbers, and the parser's heading detector (built from observed text
// formatting, not a fixed style) often mis-reads every TOC bullet as if it were itself a real
// heading. Rather than just discarding that, the same structure is parsed into an outline
// (heading + page number per entry) and used to help tag the real content that follows.
// ─────────────────────────────────────────────────────────────────────────────

// Matches a "Contents" / "Table of Contents" page heading, tolerating a page number stuck
// directly onto the title (dot-leader tab stops get stripped during text extraction, so
// "CONTENTS .......... 3" can come through as "CONTENTS3").
const TOC_TITLE_RE = /^\s*(table of )?contents\s*\d*\s*$/i

/** True if this node is itself a Contents/Table of Contents page heading. */
function isFrontMatterNode(section: DocSection): boolean {
  return TOC_TITLE_RE.test(section.title.trim())
}

/**
 * True if a section's own body content is just its own heading restated with a page number
 * stuck on — e.g. content "Formation of a company7" under a heading also titled "Formation of
 * a company". This is what an individual TOC bullet line looks like when the parser reads it
 * as its own section node rather than as a child of a single "Contents" blob: no real legal
 * rule, just the dot-leader artifact. A genuine section never has body text identical to its
 * own heading, so this never false-positives on real content.
 */
function isTocBulletNoise(section: DocSection): boolean {
  const content = section.content.trim()
  if (!content) return false
  const { title: contentAsTitle } = splitTitlePage(content)
  const { title: ownTitle } = splitTitlePage(section.title)
  return contentAsTitle.toLowerCase() === ownTitle.toLowerCase()
}

export interface OutlineEntry {
  title: string
  page: number | null
  level: number
  children: OutlineEntry[]
}

/** Splits a TOC entry's mashed-together "Title123" text back into title + page number. */
function splitTitlePage(raw: string): { title: string; page: number | null } {
  const trimmed = raw.trim()
  const m = trimmed.match(/^(.*\D)\s*(\d+)$/)
  if (m) return { title: m[1].trim(), page: parseInt(m[2], 10) }
  return { title: trimmed, page: null }
}

/** Parses a block of TOC bullet content (one entry per line, "Title<digits>" mashed together by
 *  dot-leader stripping) into outline child entries. Needed because the heading classifier
 *  sometimes folds a whole run of TOC bullet lines into one node's body content rather than
 *  giving each its own child heading — see the comment on buildOutlineFromNode below. */
function parseTocBulletContent(content: string): OutlineEntry[] {
  const lines = content.split(/\n+/).map(l => l.trim()).filter(Boolean)
  const entries: OutlineEntry[] = []
  for (const line of lines) {
    const { title, page } = splitTitlePage(line)
    if (!title || page === null) continue
    entries.push({ title, page, level: 0, children: [] })
  }
  return entries
}

/**
 * A TOC bullet line (e.g. "BUSINESS LAW AND PRACTICE .... 3") sometimes gets classified as a
 * heading in its own right, because it shares the exact same bold/caps/colour signature as that
 * chapter's REAL heading later in the document — the visual-clustering model has no way to tell
 * "this bold-caps line is a TOC entry" from "this bold-caps line is the real chapter title." When
 * that happens, TOC_FORCED_LEVEL has already popped the literal "Contents" node off the stack by
 * the time it's hit, so the bullet line attaches as a SIBLING of Contents, not a child — and its
 * own sub-bullets (which don't match any heading style) land as flat \n\n-joined text in its
 * .content instead of as further child nodes. So a node here may carry its outline children
 * either as real DocSection children (the more common shape) or as bullet-text content (this
 * document's shape) — both are handled.
 */
function buildOutlineFromNode(node: DocSection): OutlineEntry[] {
  return node.children.map(child => ({
    ...splitTitlePage(child.title),
    level: child.level,
    children: child.children.length > 0 ? buildOutlineFromNode(child) : parseTocBulletContent(child.content),
  }))
}

/** Finds every Contents/TOC page anywhere in the tree (doesn't descend past a match — its
 *  children ARE the outline, not another nested front-matter page). */
function findFrontMatterNodes(sections: DocSection[]): DocSection[] {
  const found: DocSection[] = []
  function walk(list: DocSection[]) {
    for (const s of list) {
      if (isFrontMatterNode(s)) { found.push(s); continue }
      walk(s.children)
    }
  }
  walk(sections)
  return found
}

/**
 * Collects every node anywhere in the tree whose firstPage falls within the front-matter page
 * range, in document order — this is the actual TOC content even when it didn't end up nested
 * under the literal "Contents" heading node. (See buildOutlineFromNode: a TOC chapter-line gets
 * popped to a SIBLING of Contents once TOC_FORCED_LEVEL takes Contents out of the stack, so
 * walking Contents's own .children alone can miss the whole outline — page range is a more
 * reliable signal than tree position here.) Skips Contents nodes themselves.
 */
function collectFrontMatterRegionNodes(sections: DocSection[], frontMatterPageEnd: number): DocSection[] {
  const found: DocSection[] = []
  function walk(list: DocSection[], depth: number) {
    for (const s of list) {
      // A genuine TOC chapter-line is recognisable by its OWN title ending in a dot-leader page
      // number (e.g. "BUSINESS LAW AND PRACTICE3"). The page-range check alone isn't enough: the
      // document's own root title can ALSO coincidentally end in a digit (e.g. "FLK1" → splits as
      // title "FLK" + page 1) and the REAL chapter heading that duplicates a TOC line's text (e.g.
      // "BUSINESS LAW AND PRACTICE", no digit suffix) both also sit on a front-matter page — but
      // their .children span the entire rest of the document, so including either here would dump
      // the whole document tree into the outline. depth > 0 rules out the document's own root
      // title specifically (it's never itself a TOC line).
      const isTocLine = depth > 0 && s.firstPage !== null && s.firstPage <= frontMatterPageEnd && !isFrontMatterNode(s) && splitTitlePage(s.title).page !== null
      if (isTocLine) {
        found.push(s)
        continue
      }
      walk(s.children, depth + 1)
    }
  }
  walk(sections, 0)
  return found
}

function buildOutlineFromRegionNode(node: DocSection): OutlineEntry {
  const { title, page } = splitTitlePage(node.title)
  const children = node.children.length > 0
    ? node.children.map(child => ({
        ...splitTitlePage(child.title),
        level: child.level,
        children: child.children.length > 0 ? buildOutlineFromNode(child) : parseTocBulletContent(child.content),
      }))
    : parseTocBulletContent(node.content)
  return { title, page, level: node.level, children }
}

/**
 * The physical last page the Contents section occupies. Deliberately NOT computed by walking
 * the Contents node's subtree — heading-level misclassification elsewhere in a document (e.g.
 * one chapter's title using a different Word style than the rest) can still leave stray real
 * content nested under Contents even after the forced-level fix in classifyHeadingParagraph,
 * and a subtree walk would then report some much later page as "front matter," silently
 * excluding real content.
 *
 * Only the FIRST (earliest-page) match is used as "the" master Contents page — a document can
 * have other headings that happen to be titled just "Contents" deeper in (e.g. a per-chapter
 * mini-index before a later Part begins), and those are real content, not front matter. Taking
 * the max across every match was wrong: it let a later, unrelated "Contents" heading push the
 * cutoff forward by dozens of pages, silently excluding everything in between. The document's
 * real front matter is always the one at the very start.
 */
function computeFrontMatterPageEnd(frontMatterNodes: DocSection[]): number {
  let earliestPage: number | null = null
  for (const node of frontMatterNodes) {
    if (node.firstPage === null) continue
    if (earliestPage === null || node.firstPage < earliestPage) earliestPage = node.firstPage
  }
  return earliestPage === null ? 0 : earliestPage + 1
}

/** Maps every heading the Contents page mentions (topic AND subtopic level, upper-cased) to
 *  the topic slug it falls under, by tracking which recognised topic heading we're currently
 *  nested below as we walk down the outline. */
function buildOutlineTopicMap(outline: OutlineEntry[]): Map<string, string> {
  const map = new Map<string, string>()
  function resolveOwnSlug(title: string): string | null {
    const upper = title.toUpperCase().trim()
    if (HEADER_TO_SLUG[upper]) return HEADER_TO_SLUG[upper]
    for (const [key, slug] of Object.entries(HEADER_TO_SLUG)) {
      if (upper.includes(key) || key.includes(upper)) return slug
    }
    return null
  }
  function walk(entries: OutlineEntry[], inheritedSlug: string | null) {
    for (const entry of entries) {
      const slug = resolveOwnSlug(entry.title) ?? inheritedSlug
      if (slug) map.set(entry.title.toUpperCase().trim(), slug)
      walk(entry.children, slug)
    }
  }
  walk(outline, null)
  return map
}

/** Flattens the outline tree into an ordered list for SSE transport (UI just needs order + level). */
export function flattenOutlineForTransport(entries: OutlineEntry[]): Array<{ title: string; page: number | null; level: number }> {
  const out: Array<{ title: string; page: number | null; level: number }> = []
  // Uses actual tree depth here, NOT e.level — e.level is the raw internal classification level
  // (stack-nesting numbers like 83/84 for a TOC-style line, used only to decide nesting while
  // building the section tree). The UI indents each row by level * 14px, so handing it the raw
  // internal number pushes every line over a thousand pixels off-screen. Depth (0, 1, 2, ...) is
  // what a reader actually wants to see: topic, subtopic, sub-subtopic.
  function walk(list: OutlineEntry[], depth: number) {
    for (const e of list) {
      out.push({ title: e.title, page: e.page, level: depth })
      walk(e.children, depth + 1)
    }
  }
  // Starts at 1 (not 0) to match the UI's `(level - 1) * 14px` indent math, which expects
  // top-level entries at level 1.
  walk(entries, 1)
  return out
}

export interface ExtractionProgress {
  stage: 'parsing' | 'sections_found' | 'extracting' | 'batch_done' | 'done' | 'error'
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
  /** Emitted alongside sections_found — the document's Contents/TOC page, parsed into a
   *  heading + page-number outline rather than discarded outright. Used internally to help
   *  tag content sections whose heading text alone doesn't match the static topic dictionary,
   *  and surfaced here so the admin can see the document's expected structure up front. */
  outline?: Array<{ title: string; page: number | null; level: number }>
  /** Questions-mode only — running count of sample questions that couldn't be matched to any
   *  existing chunk. Surfaced so the admin sees these flagged instead of them silently vanishing. */
  unmatched_found?: number
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

/**
 * Level for a paragraph inside Word's auto-generated Table of Contents (pStyle "TOC1", "TOC2",
 * ...) — the style's own digit is the TOC's nesting depth, the single most reliable signal
 * available for telling a chapter-level TOC line from a subtopic-level one. It isn't sufficient
 * on its own though: some source documents (seen in this app's FLK1 notes) reuse one TOC style,
 * e.g. TOC2, for every depth and rely purely on the chapter line being ALL CAPS while subtopic
 * lines are mixed case — relying on the style digit alone would flatten those into one level.
 * Folding in the ALL CAPS signal (one level shallower than the bare style digit implies) handles
 * both shapes: a genuinely depth-2 TOC2 style still nests under a depth-1 TOC1 line when both are
 * present (FLK2's notes), and an ALL-CAPS TOC2 chapter line still sits shallower than a mixed-case
 * TOC2 subtopic line when only one style is used for both (FLK1's notes).
 */
function tocStyleLevel(pStyle: string | null, text: string): number | null {
  const m = pStyle?.match(/^TOC(\d+)$/i)
  if (!m) return null
  const depth = parseInt(m[1], 10)
  const allCaps = text.length > 0 && text === text.toUpperCase() && /[A-Z]{2,}/.test(text)
  return 80 + depth * 2 - (allCaps ? 1 : 0)
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
    const text = p.runs.map(r => r.text).join('').trim()
    if (pStyleLevel(p.pStyle) !== null || tocStyleLevel(p.pStyle, text) !== null) explicit.add(p)
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
// Deeper than any real heading level the visual-clustering/Word-style model can produce —
// forcing the Contents/TOC heading to this level means the very next heading of ANY kind
// pops it off the nesting stack immediately, so it can only ever "absorb" content that comes
// right after it on the Contents page itself, before the next real heading appears.
const TOC_FORCED_LEVEL = 99

/** True if `text` is, after stripping a dot-leader-stripped page number stuck on the end (the
 *  same "Title123" → {title, page} shape splitTitlePage already handles for TOC lines), an exact
 *  match for one of the 12 known SQE1 chapter headings in HEADER_TO_SLUG. Used to force chapter
 *  boundaries to level 1 regardless of how the visual model ranks their style — see the comment
 *  at the call site in classifyHeadingParagraph. */
function forcedChapterLevel(text: string): number | null {
  const { title } = splitTitlePage(text)
  const upper = title.toUpperCase().trim()
  return upper in HEADER_TO_SLUG ? 1 : null
}

function classifyHeadingParagraph(p: DocxParagraph, model: HeadingStyleModel): HeadingClassification | null {
  const text = p.runs.map(r => r.text).join('').trim()
  if (!text) return null

  // Must be checked BEFORE the explicit Word-style branch below — if "CONTENTS" happens to
  // use Word's built-in "Title" style, pStyleLevel would hand it level 1, and since nothing
  // else in the whole rest of the document is ever shallow enough to pop a level-1 node off
  // the stack, the ENTIRE remaining document would nest underneath it forever. That's exactly
  // what was happening: the outline dump showed every heading in the document, all wrongly
  // tagged as Contents/TOC content.
  if (TOC_TITLE_RE.test(text)) {
    return { level: TOC_FORCED_LEVEL, kind: 'definition', text }
  }

  // A TOC bullet line's own style (TOC1/TOC2/...) plus its ALL CAPS-ness is a far more reliable
  // depth signal than the visual clustering below, which has no way to tell a chapter-level TOC
  // line from a subtopic-level one when both happen to share the same run formatting (seen in
  // this app's FLK2 notes, where every TOC line is ALL CAPS regardless of depth). Checked before
  // the generic Word-style branch since pStyleLevel doesn't recognise "TOCn" styles at all.
  const tocLevel = tocStyleLevel(p.pStyle, text)
  if (tocLevel !== null) {
    return { level: tocLevel, kind: 'definition', text }
  }

  // One of the 12 real SQE1 chapter names, exactly — a closed, known set, so whenever a
  // paragraph's text matches one exactly it's always a true chapter boundary, regardless of how
  // the visual-clustering model below ranks its style. Without this, a document compiled from
  // differently-styled source chapters (seen in a real FLK2 master-notes file, where later
  // chapters' heading style scored lower than "PROPERTY PRACTICE"'s) gets every chapter after
  // the first visually-distinct one silently nested AS A CHILD of whichever chapter the model
  // happened to rank level 1 — which then makes every chunk for the rest of the document inherit
  // that one wrong topic, since detectTopicSlug() returns on the first matching path segment
  // (path[0]), and path[0] is now always the wrongly-never-closed first chapter. Forcing these
  // exact strings to level 1 regardless of visual styling means a same-or-lower-styled later
  // chapter still correctly pops the previous chapter off the stack and opens as its own root.
  const chapterLevel = forcedChapterLevel(text)
  if (chapterLevel !== null) {
    return { level: chapterLevel, kind: kindForLevel(chapterLevel), text }
  }

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

/** Result of a single batched extraction call — may cover only part of the document. */
export interface BatchExtractionResult {
  chunks: ExtractedChunk[]
  /** Total number of leaf sections (notes mode) or question batches (questions mode) in the whole document. */
  totalUnits: number
  /** How many units have now been processed, counting this call and everything before it. */
  unitsDone: number
  /** True once every unit in the document has been processed. */
  done: boolean
}

/** Full Stage 1 entry point: docx buffer → section tree, with auto-discovered headings and page tracking. */
export async function parseDocxToSections(buffer: Buffer): Promise<{
  sections: DocSection[]
  headingStyles: HeadingStyleSummary[]
  outline: OutlineEntry[]
  outlineTopicMap: Map<string, string>
  frontMatterPageEnd: number
}> {
  const bodyXml = await readDocumentXmlBody(buffer)
  const blocks = parseDocxBlocks(bodyXml)
  const paragraphs = blocks.filter((b): b is DocxParagraph => b.kind === 'paragraph')
  const model = buildHeadingStyleModel(paragraphs)
  const sections = buildSectionTreeFromBlocks(blocks, model)

  // Pull the outline (headings + page numbers) out of any Contents/TOC page before its bullet
  // lines get dropped from real extraction — it's a ready-made map of every topic/subtopic the
  // rest of the document covers, used below to tag content whose own heading text doesn't
  // directly match the static HEADER_TO_SLUG dictionary.
  const frontMatterNodes = findFrontMatterNodes(sections)
  const frontMatterPageEnd = computeFrontMatterPageEnd(frontMatterNodes)
  const outline = collectFrontMatterRegionNodes(sections, frontMatterPageEnd).map(buildOutlineFromRegionNode)
  const outlineTopicMap = buildOutlineTopicMap(outline)

  return { sections, headingStyles: model.summary, outline, outlineTopicMap, frontMatterPageEnd }
}

/**
 * Flatten a section tree into leaf sections that have content.
 * A "leaf" is either a section with no children, or a section where
 * the content is substantial enough to process independently.
 *
 * `frontMatterPageEnd`, when known, is the authoritative filter: anything physically printed on
 * the Contents pages is excluded regardless of where the (sometimes scrambled) heading hierarchy
 * placed it in the tree. The text-shape checks below remain as a fallback for documents where no
 * usable page-break markers were found (frontMatterPageEnd === 0).
 */
/**
 * Canonical breadcrumb for a leaf section — this exact string is what `source_section` is
 * stored as on every knowledge_chunk row, and is how every recovery/verification route
 * (backfill, verify, preview) re-matches a freshly re-parsed leaf back to its saved chunks.
 * Was previously copy-pasted in three separate route files; centralised here so a future
 * change to the format can't silently desync one of those copies from the others.
 */
export function breadcrumbFor(section: { path: string[]; firstPage: number | null }): string {
  return section.path.join(' > ') + (section.firstPage ? ` (p. ${section.firstPage})` : '')
}

export function flattenToLeaves(sections: DocSection[], frontMatterPageEnd = 0): DocSection[] {
  const leaves: DocSection[] = []

  function walk(section: DocSection) {
    // No minimum content length — even a single sentence is a legal rule we must not lose.
    const hasContent = section.content.trim().length > 0
    const hasChildren = section.children.length > 0

    const onContentsPage = frontMatterPageEnd > 0 && section.firstPage !== null && section.firstPage <= frontMatterPageEnd

    // A Contents/TOC heading's own accumulated text is the dot-leader bullet blob, never real
    // content — drop it. IMPORTANT: still always recurse into children below regardless. In
    // some documents the heading-level model nests the real chapters underneath the (mis-ranked)
    // Contents heading rather than as later siblings, so bailing out of the whole subtree here
    // (as an earlier version of this function did) silently deleted the entire document.
    const dropOwnContent = onContentsPage || isFrontMatterNode(section) || isTocBulletNoise(section)

    if (!hasChildren && hasContent) {
      if (!dropOwnContent) leaves.push(section)
    } else if (hasChildren) {
      // If this section has its own content (intro text above its child sections),
      // emit it as a virtual leaf first so it isn't lost.
      if (hasContent && !dropOwnContent) {
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
// Exported for unit tests (chunk-extractor.test.ts) and for any route that needs to recompute
// units outside the main extraction flow — this is the single function responsible for the
// "100% coverage" guarantee, so it must be directly testable on its own, without a real docx.
export function splitContentIntoUnits(content: string): string[] {
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

// Exported for the /api/admin/chunks/backfill recovery route, which needs to re-run extraction
// for individual leaf sections that were already visited once but whose chunks never made it
// into the DB (see that route's header comment for why).
export async function extractChunksFromSection(
  client: Anthropic,
  section: DocSection,
  topicName: string,
  outlineTopicMap?: Map<string, string>,
  // Cached per chapter heading (path[1] or path[0]) across a whole extraction run, so the AI
  // fallback below only ever costs one Haiku call per chapter, not one per leaf section.
  topicSlugCache?: Map<string, string | null>,
): Promise<ExtractedChunk[]> {
  const breadcrumb   = breadcrumbFor(section)
  const subtopicName = section.path[1] ?? section.path[0] ?? topicName
  const sectionName  = section.path[section.path.length - 1] ?? subtopicName

  if (!section.content.trim()) return []

  let topicSlug = detectTopicSlug(section.path, outlineTopicMap)

  if (!topicSlug) {
    // The static dictionary + TOC-derived map both missed — fall back to Haiku, cached by
    // chapter so a long chapter with many leaf sections only triggers this once.
    const chapterKey = (section.path[1] ?? section.path[0] ?? breadcrumb).toUpperCase().trim()
    if (topicSlugCache?.has(chapterKey)) {
      topicSlug = topicSlugCache.get(chapterKey) ?? null
    } else {
      topicSlug = await classifyTopicSlugWithAI(client, breadcrumb, section.content)
      topicSlugCache?.set(chapterKey, topicSlug)
    }
  }

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
      source_page_start:  section.firstPage,
      source_page_end:    section.firstPage,
      subtopic_name:      subtopicName,
      section_name:       sectionName,
      topic_slug:         topicSlug,
      inferred_difficulty: null,
      difficulty_reason:  null,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions mode: MATCH sample MCQs to EXISTING (notes-derived) knowledge chunks
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURAL RULE — do not break this: knowledge_chunks are only ever created
// from revision notes (extractChunksFromDocx, above). Sample question papers never
// create a new chunk. Instead, each sample MCQ is matched against the chunks that
// already exist for the topic (which must come from notes uploaded first), and the
// match only ever WRITES style/difficulty signal (a verbatim quote + a difficulty
// judgement) onto that existing chunk's row. If a question doesn't match anything
// already in the knowledge graph, it is skipped — never used to invent a new rule.

/** A candidate chunk a sample question can be matched against. */
export interface ChunkCandidate {
  id: string
  rule_text: string
  source_section: string
}

/**
 * The only thing a sample-question batch is allowed to produce: zero, one, or several
 * matched chunks + style signal. A question can legitimately test more than one rule at
 * once (e.g. a completion-date question that combines a time-limit rule and a notice-period
 * rule) — `chunk_ids` is empty, never invented, when nothing in the provided list is a
 * genuine match. An empty array is a FLAG for the admin, not a silent drop.
 */
export interface ChunkMatch {
  chunk_ids: string[]
  exact_source_quote: string | null
  context_text: string | null
  inferred_difficulty: 'easy' | 'medium' | 'hard' | null
  difficulty_reason: string | null
  matched: boolean
  /** The question itself, normalized so it can be saved into the question bank as a draft
   *  (origin: 'sample_paper') — never shown to users until an admin approves it, same as
   *  any AI-generated draft. Null only if the batch text for this entry was too garbled to
   *  recover a clean MCQ (still kept as a flagged entry, just with no insertable content). */
  prompt: string | null
  options: { label: string; text: string }[] | null
  correct_answer: string | null
}

/** Result of a single batched MATCH call — mirrors BatchExtractionResult but for matches. */
export interface BatchMatchResult {
  matches: ChunkMatch[]
  totalUnits: number
  unitsDone: number
  done: boolean
  matchedCount: number
  unmatchedCount: number
}

const QUESTIONS_MATCH_SYSTEM_PROMPT = `You are analyzing official SQE1 sample exam questions to understand how they test an EXISTING knowledge graph of legal rules, and how hard each question actually is. This is signal-gathering, not rule extraction.

You are given a list of EXISTING knowledge chunks (id + rule_text), already extracted from this topic's revision notes — these are the ONLY rules you may reference. You are also given a batch of sample MCQs.

Your job is NOT to write new legal rules. For each MCQ:
1. Decide which chunk(s) from the provided list the question actually tests, by comparing the question's correct answer/explanation to each chunk's rule_text. Most questions test exactly ONE rule — but some genuinely combine two or three (e.g. a single question that depends on both a time-limit rule and an exception to it). List every chunk id it really relies on in "chunk_ids".
2. If none of the provided chunks is a genuine match, set "chunk_ids" to an empty array []. Do not force a weak match just to fill the field — an honest "no match" is more useful than a wrong tag.
3. Copy the CORRECT ANSWER and its explanation verbatim into "exact_source_quote".
4. Note the trap or misconception the wrong options exploit in "context_text".
5. Judge how hard the question actually is to get right and explain why in "difficulty_reason".
6. Also normalize the question itself for re-use in the live question bank (it goes in as a DRAFT — an admin reviews it before it's ever shown to a student, regardless of match status): "prompt" is the question stem verbatim, "options" is exactly 5 entries {label, text} for labels A-E with their text exactly as written, and "correct_answer" is the correct label. If the source has fewer/more than 5 options, or you can't confidently recover a clean 5-option MCQ from the text, set "prompt", "options" and "correct_answer" all to null instead of guessing — it's still kept and flagged, just without insertable content.

DIFFICULTY CALIBRATION — judge each question independently, do not default to "medium":
- "easy": tests a single well-known rule directly, distractors are clearly wrong, no multi-step reasoning required
- "medium": requires applying a rule to specific facts, or distinguishing between two genuinely plausible options
- "hard": requires combining multiple rules, spotting an exception to a general rule, working through a multi-step calculation/timeline, or the wrong options are deliberately close to correct (e.g. right rule but wrong threshold/party/time limit)

"difficulty_reason" must explain the SPECIFIC thing that makes it that difficulty.

STRICT RULES — do not break any of these:

1. ONLY MATCH, NEVER INVENT. Every id in "chunk_ids" must be copied exactly from the provided list. Never invent an id, and never describe a rule that isn't one of the provided chunks. If nothing matches, the array must be empty — not your best guess.

2. VERBATIM QUOTE. "exact_source_quote" must copy the correct answer text and/or the explanation text from the question exactly — word for word. Do not paraphrase.

3. PRESERVE ALL QUALIFIERS. Do not drop thresholds, time limits, exceptions, percentages, or party names when quoting.

4. If the question text includes an "[Answer key]" line, that is the correct answer pulled from a separate answer-key section of the document — treat it exactly as you would an inline answer.

5. NEVER INVENT OPTIONS EITHER. "options" must be the 5 options exactly as they appear in the source. If you're not confident you've recovered all 5 correctly, set prompt/options/correct_answer to null rather than fabricating or padding.

Return ONLY a JSON array, one entry PER QUESTION (in order, including unmatched ones — never skip an entry). No explanation, no markdown fences.

[
  {
    "chunk_ids": ["uuid-from-the-provided-list", "..."],
    "exact_source_quote": "Verbatim text of the correct answer / explanation from the question",
    "context_text": "The common misconception the wrong options exploit; also note any ambiguity",
    "inferred_difficulty": "easy|medium|hard",
    "difficulty_reason": "The specific thing that makes this question that difficulty",
    "prompt": "The question stem verbatim, or null",
    "options": [{"label": "A", "text": "..."}, {"label": "B", "text": "..."}, {"label": "C", "text": "..."}, {"label": "D", "text": "..."}, {"label": "E", "text": "..."}],
    "correct_answer": "A|B|C|D|E or null"
  }
]`

// Larger than the notes-mode batching would use — the candidate list (resent in full on every
// call) dominates token cost far more than a few extra questions does, so grouping more
// questions per call amortizes that fixed cost instead of paying it over and over.
const QUESTIONS_PER_EXTRACTION_BATCH = 10

// Sample papers are commonly laid out as: all questions first, then a separate
// "Answers" / "Answer Key" / "Suggested Answers" section at the very end with the
// correct letter + explanation per question number. Left alone, that means the batch
// containing question 4 never sees its own answer — it's pages away. This detects that
// layout and re-attaches each answer directly under its matching "Question N" block
// before the document is split into batches, so every batch is self-contained no matter
// how the source PDF separated questions from answers.
function mergeAnswerKeySection(rawText: string): string {
  const headerRe = /\n[ \t]*(answers?|answer\s*key|suggested\s*answers?|model\s*answers?)[ \t]*\n/i
  const match = headerRe.exec(rawText)
  // Require the heading to be in the back half of the document — an early match is far
  // more likely to be a stray mention of the word "answer" inside a question, not a real key.
  if (!match || match.index < rawText.length * 0.3) return rawText

  const questionsPart = rawText.slice(0, match.index)
  const answersPart = rawText.slice(match.index + match[0].length)

  // Parse "N. <answer text...>" entries — each runs until the next numbered entry or EOF.
  const entries = [...answersPart.matchAll(/(?:^|\n)\s*(\d{1,3})[\.\)]\s+([\s\S]*?)(?=\n\s*\d{1,3}[\.\)]\s|$)/g)]
  if (entries.length < 3) return rawText // doesn't look like a real answer key — leave untouched

  const answerByNumber = new Map<number, string>()
  for (const m of entries) {
    const text = m[2].trim()
    if (text) answerByNumber.set(parseInt(m[1], 10), text)
  }

  const qSplits = [...questionsPart.matchAll(/\n(?=Question\s+(\d{1,3})\s*\n)/gi)]
  if (qSplits.length < 3) return rawText // questions weren't "Question N" headed — nothing to merge against

  const positions = qSplits.map(m => ({ index: m.index!, num: parseInt(m[1], 10) }))
  positions.push({ index: questionsPart.length, num: -1 })

  let rebuilt = questionsPart.slice(0, positions[0].index)
  for (let i = 0; i < positions.length - 1; i++) {
    const block = questionsPart.slice(positions[i].index, positions[i + 1].index)
    const answer = answerByNumber.get(positions[i].num)
    const hasInlineAnswer = /correct answer|^\s*answer:/im.test(block)
    rebuilt += (!answer || hasInlineAnswer) ? block : `${block.trimEnd()}\n\n[Answer key] ${answer}\n`
  }

  return rebuilt
}

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

// Sample-paper PDFs are extracted with a `[[PAGE:N]]` marker prepended before
// each page's text (see /api/admin/upload's pagerender). This scans a batch
// of question text for those markers, returns the min/max page number seen,
// and strips the markers out before the text is sent to Claude — Claude never
// needs to see them, but we keep the page range to attach to every chunk
// extracted from this batch.
function extractPageRange(text: string): { pageStart: number | null; pageEnd: number | null; cleaned: string } {
  const matches = [...text.matchAll(/\[\[PAGE:(\d+)\]\]\n?/g)]
  if (matches.length === 0) return { pageStart: null, pageEnd: null, cleaned: text }
  const pages = matches.map(m => parseInt(m[1], 10))
  const cleaned = text.replace(/\[\[PAGE:\d+\]\]\n?/g, '')
  return { pageStart: Math.min(...pages), pageEnd: Math.max(...pages), cleaned }
}

// Keeps the candidate list sent to Claude bounded — large topics can have hundreds of
// chunks, and every batch call resends the full list. Truncating rule_text and capping
// the count keeps token usage sane without materially hurting match quality (Claude only
// needs enough of each rule_text to tell candidates apart).
const MAX_CANDIDATES_PER_CALL = 150
const CANDIDATE_RULE_TEXT_CHARS = 160

function buildCandidateBlock(candidates: ChunkCandidate[]): string {
  return candidates
    .slice(0, MAX_CANDIDATES_PER_CALL)
    .map(c => `- id: ${c.id}\n  rule: ${c.rule_text.slice(0, CANDIDATE_RULE_TEXT_CHARS)}`)
    .join('\n')
}

async function matchQuestionBatchToChunks(
  client: Anthropic,
  batch: string,
  batchIndex: number,
  topicHint: string,
  candidates: ChunkCandidate[],
): Promise<ChunkMatch[]> {
  const { cleaned: cleanedBatch } = extractPageRange(batch)
  const candidateBlock = buildCandidateBlock(candidates)
  const validIds = new Set(candidates.map(c => c.id))

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    // Responses now also carry the normalized question (prompt + 5 options) for every
    // entry, not just the style signal — bumped up from 8000 so a full batch of 10
    // questions doesn't routinely hit the truncate-and-bisect path.
    max_tokens: 12000,
    system: QUESTIONS_MATCH_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Topic context: ${topicHint}\n\nEXISTING CHUNKS for this topic (match against these only):\n${candidateBlock}\n\nBatch ${batchIndex + 1} — sample questions:\n\n${cleanedBatch}`,
    }],
  })

  if (message.stop_reason === 'max_tokens') {
    console.warn(
      `[chunk-extractor] Questions match batch ${batchIndex} truncated — splitting into two sub-batches`
    )
    const mid = findParagraphBoundary(batch, Math.floor(batch.length / 2)) || Math.floor(batch.length / 2)
    const [firstHalf, secondHalf] = await Promise.all([
      matchQuestionBatchToChunks(client, batch.slice(0, mid), batchIndex * 10,     topicHint, candidates),
      matchQuestionBatchToChunks(client, batch.slice(mid),    batchIndex * 10 + 1, topicHint, candidates),
    ])
    return [...firstHalf, ...secondHalf]
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: Array<{
    chunk_ids?: unknown
    exact_source_quote?: string
    context_text?: string
    inferred_difficulty?: string
    difficulty_reason?: string
    prompt?: string | null
    options?: unknown
    correct_answer?: string | null
  }>

  try {
    parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('Not an array')
  } catch {
    console.error(`[chunk-extractor] Questions match batch ${batchIndex} parse failed:`, cleaned.slice(0, 200))
    return []
  }

  // Every entry is kept — including ones with no valid match — so the caller can count and
  // report unmatched questions instead of them silently vanishing. Only individual hallucinated
  // ids are stripped out of chunk_ids; we never invent a replacement for a stripped id.
  return parsed.map(m => {
    const rawIds = Array.isArray(m.chunk_ids) ? m.chunk_ids : []
    const chunk_ids = rawIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))

    // Only treat the question as insertable if it's a genuinely clean 5-option MCQ with a
    // valid correct label — anything short of that, we'd rather drop the content (still flag
    // the match) than save a malformed question into the live bank.
    const rawOptions = Array.isArray(m.options) ? m.options : []
    const cleanOptions = rawOptions.filter(
      (o): o is { label: string; text: string } =>
        !!o && typeof o === 'object' && typeof (o as { label?: unknown }).label === 'string' && typeof (o as { text?: unknown }).text === 'string'
    )
    const validLabels = new Set(['A', 'B', 'C', 'D', 'E'])
    const hasFiveValidOptions = cleanOptions.length === 5 && cleanOptions.every(o => validLabels.has(o.label))
    const correctLabel = typeof m.correct_answer === 'string' ? m.correct_answer : null
    const isInsertable = !!m.prompt?.trim() && hasFiveValidOptions && !!correctLabel && validLabels.has(correctLabel)
      && cleanOptions.some(o => o.label === correctLabel)

    return {
      chunk_ids,
      exact_source_quote: m.exact_source_quote?.trim() || null,
      context_text: m.context_text?.trim() || null,
      inferred_difficulty: (['easy', 'medium', 'hard'].includes(m.inferred_difficulty ?? '')
        ? m.inferred_difficulty
        : null) as 'easy' | 'medium' | 'hard' | null,
      difficulty_reason: m.difficulty_reason?.trim() || null,
      matched: chunk_ids.length > 0,
      prompt: isInsertable ? m.prompt!.trim() : null,
      options: isInsertable ? cleanOptions : null,
      correct_answer: isInsertable ? correctLabel : null,
    }
  })
}

/**
 * Match a sample MCQ paper (raw text, e.g. from PDF) against EXISTING knowledge chunks
 * for the topic. Never creates a new chunk — only ever writes style/difficulty signal
 * onto a chunk that already exists from notes. `candidates` must be non-empty (the
 * caller is responsible for requiring notes to have been uploaded and extracted first).
 */
export async function matchQuestionsToChunks(
  rawText: string,
  topicName: string,
  candidates: ChunkCandidate[],
  onProgress: (p: ExtractionProgress) => void,
  onMatches?: (matches: ChunkMatch[]) => Promise<void>,
  range?: { offset: number; limit: number },
  onUnitDone?: (absoluteIndex: number) => Promise<void>,
): Promise<BatchMatchResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  if (candidates.length === 0) {
    onProgress({
      stage: 'error',
      message: 'No knowledge chunks exist for this topic yet — upload and extract revision notes before sample questions.',
      error: 'No candidate chunks',
    })
    throw new Error('No candidate chunks for this topic — extract notes first')
  }

  onProgress({ stage: 'parsing', message: 'Locating answer key and splitting questions into batches…' })

  // Re-run on every batch call — deterministic given the same rawText, so offsets always
  // line up the same way across resumed batches. Merging the answer key first means a
  // batch is self-contained even when the source PDF lists answers separately at the end
  // (the common "all questions, then 80 pages later an answer key" layout).
  const mergedText = mergeAnswerKeySection(rawText)
  const batches = splitIntoQuestionBatches(mergedText)

  if (batches.length === 0) {
    onProgress({ stage: 'error', message: 'No question batches found.', error: 'No questions detected' })
    throw new Error('No question batches found')
  }

  const offset = range?.offset ?? 0
  const limit = range?.limit ?? batches.length
  const batchSlice = batches.slice(offset, offset + limit)

  onProgress({
    stage: 'parsing',
    message: `Found ${batches.length} batches (~${QUESTIONS_PER_EXTRACTION_BATCH} questions each) — matching against ${candidates.length} existing chunks`,
    sections_total: batches.length,
    sections_done: offset,
    chunks_found: 0,
  })

  const newMatches: ChunkMatch[] = []

  for (let i = 0; i < batchSlice.length; i++) {
    const absoluteIndex = offset + i
    onProgress({
      stage: 'extracting',
      message: `Matching batch ${absoluteIndex + 1} / ${batches.length} to existing chunks…`,
      sections_total: batches.length,
      sections_done: absoluteIndex,
      chunks_found: newMatches.length,
    })

    try {
      const matches = await matchQuestionBatchToChunks(client, batchSlice[i], absoluteIndex, topicName, candidates)
      newMatches.push(...matches)
      // Flush this batch's matches immediately so partial progress survives a dropped connection
      if (onMatches && matches.length > 0) {
        await onMatches(matches)
      }
    } catch (err) {
      console.error(`[chunk-extractor] Error on question match batch ${absoluteIndex}:`, err)
    }

    // Persist the exact resume point right after this question-batch — same reasoning as notes mode.
    if (onUnitDone) {
      await onUnitDone(absoluteIndex + 1)
    }
  }

  const unitsDone = Math.min(offset + batchSlice.length, batches.length)
  const done = unitsDone >= batches.length
  const matchedCount = newMatches.filter(m => m.matched).length
  const unmatchedCount = newMatches.length - matchedCount

  onProgress({
    stage: done ? 'done' : 'extracting',
    message: done
      ? `Done — ${unitsDone} batches matched`
      : `Batch complete — ${unitsDone} / ${batches.length} question-batches matched so far`,
    sections_total: batches.length,
    sections_done: unitsDone,
    chunks_found: newMatches.length,
  })

  return { matches: newMatches, totalUnits: batches.length, unitsDone, done, matchedCount, unmatchedCount }
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
 * @param range      - optional { offset, limit } to process only a slice of the document's leaf
 *                      sections. Used to run extraction in small resumable batches — each call
 *                      processes at most `limit` sections starting at `offset`, so a single request
 *                      never has to run long enough to risk a serverless timeout. The caller (the API
 *                      route) tracks `offset` in the database and keeps calling until `done` is true.
 * @param onUnitDone - optional callback invoked immediately after each individual section finishes
 *                      (chunks already flushed via onChunks by that point), with the absolute index
 *                      of the section just completed. Lets the caller persist exact resume position
 *                      after every section, not just at the end of the batch — so even a mid-batch
 *                      crash can only ever cause one section's chunks to be at risk of reprocessing.
 * @returns          - batch result: this call's chunks plus total/done bookkeeping for resumability
 */
export async function extractChunksFromDocx(
  buffer: Buffer,
  topicName: string,
  onProgress: (p: ExtractionProgress) => void,
  onChunks?: (chunks: ExtractedChunk[]) => Promise<void>,
  range?: { offset: number; limit: number },
  onUnitDone?: (absoluteIndex: number) => Promise<void>,
): Promise<BatchExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Stage 1: Parse ──────────────────────────────────────────────────────────
  // Re-parsed on every batch call — cheap (no AI calls), and guarantees the same
  // deterministic leaf list every time so offsets always line up correctly.
  onProgress({ stage: 'parsing', message: 'Reading document structure and detecting its heading format…' })

  let tree: DocSection[]
  let headingStyles: HeadingStyleSummary[] = []
  let outline: OutlineEntry[] = []
  let outlineTopicMap = new Map<string, string>()
  let frontMatterPageEnd = 0
  try {
    const parsed = await parseDocxToSections(buffer)
    tree = parsed.sections
    headingStyles = parsed.headingStyles
    outline = parsed.outline
    outlineTopicMap = parsed.outlineTopicMap
    frontMatterPageEnd = parsed.frontMatterPageEnd
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    onProgress({ stage: 'error', message: 'Failed to parse document', error: msg })
    throw err
  }

  const leaves = flattenToLeaves(tree, frontMatterPageEnd)

  if (leaves.length === 0) {
    onProgress({ stage: 'error', message: 'No sections found in document. Check the document structure.' })
    throw new Error('No sections found')
  }

  const offset = range?.offset ?? 0
  const limit = range?.limit ?? leaves.length
  const batchLeaves = leaves.slice(offset, offset + limit)

  // Emit section tree before extraction so the admin can verify all expected topics were found.
  // If a topic is missing here, the parser didn't detect it — check heading formatting in the docx.
  // Only meaningful on the first batch, but harmless (and cheap) to re-send every time.
  const sectionPaths = leaves.map(l => l.path.join(' > ') || l.title)
  onProgress({
    stage: 'sections_found',
    message: `Found ${leaves.length} sections — verify all expected topics appear below before extraction starts`,
    sections_total: leaves.length,
    sections_done: offset,
    chunks_found: 0,
    sections_found: sectionPaths,
    heading_styles: headingStyles,
    outline: flattenOutlineForTransport(outline),
  })

  // ── Stage 2: Extract this batch only ────────────────────────────────────────
  const batchChunks: ExtractedChunk[] = []
  // Cached per chapter heading across this whole batch (and re-created fresh on the next
  // batch call) — keeps the AI topic-slug fallback to one Haiku call per chapter, not one
  // per leaf section within it.
  const topicSlugCache = new Map<string, string | null>()

  for (let i = 0; i < batchLeaves.length; i++) {
    const absoluteIndex = offset + i
    const section = batchLeaves[i]
    const label = section.path.slice(-2).join(' > ') || section.title

    onProgress({
      stage: 'extracting',
      message: `Extracting: ${label}`,
      sections_total: leaves.length,
      sections_done: absoluteIndex,
      chunks_found: batchChunks.length,
    })

    try {
      const chunks = await extractChunksFromSection(client, section, topicName, outlineTopicMap, topicSlugCache)
      batchChunks.push(...chunks)
      // Flush this section's chunks immediately so partial progress survives a dropped connection
      if (onChunks && chunks.length > 0) {
        await onChunks(chunks)
      }
    } catch (err) {
      // Log but continue — don't fail the whole extraction for one section
      console.error(`[chunk-extractor] Error on section "${label}":`, err)
    }

    // Persist the exact resume point right after this section, not at the end of the batch —
    // this is what makes even a mid-batch crash only ever risk reprocessing one section.
    if (onUnitDone) {
      await onUnitDone(absoluteIndex + 1)
    }
  }

  const unitsDone = Math.min(offset + batchLeaves.length, leaves.length)
  const done = unitsDone >= leaves.length

  onProgress({
    stage: done ? 'done' : 'extracting',
    message: done
      ? `Extraction complete — ${unitsDone} sections processed`
      : `Batch complete — ${unitsDone} / ${leaves.length} sections processed so far`,
    sections_total: leaves.length,
    sections_done: unitsDone,
    chunks_found: batchChunks.length,
  })

  return { chunks: batchChunks, totalUnits: leaves.length, unitsDone, done }
}
