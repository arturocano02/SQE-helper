/**
 * chunk-extractor.ts
 *
 * Two-stage pipeline for turning admin FLK notes (.docx) into knowledge chunks.
 *
 * Stage 1 — Parse:
 *   docx → mammoth HTML → section tree (topic / subtopic / section hierarchy)
 *
 * Stage 2 — Extract:
 *   For each leaf section: call Claude with a tight system prompt to extract
 *   every distinct legal rule as a self-contained JSON chunk.
 *
 * The section-by-section approach keeps context windows small (~2–5k tokens
 * per call) which is both cheap and more accurate than one giant prompt.
 */

import mammoth from 'mammoth'
import Anthropic from '@anthropic-ai/sdk'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DocSection {
  level: number       // 1 = paper/topic, 2 = subtopic, 3 = section, 4 = subsection
  title: string
  path: string[]      // breadcrumb: ["Business Law and Practice", "Shareholders", "Service Contracts"]
  content: string     // plain text of this section (excluding child section content)
  children: DocSection[]
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
  stage: 'parsing' | 'extracting' | 'done' | 'error'
  message: string
  sections_total?: number
  sections_done?: number
  chunks_found?: number
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: docx → HTML → section tree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract HTML from a docx Buffer using mammoth.
 * Mammoth maps Word heading styles (Heading 1–6) to h1–h6.
 * Bold → <strong>, italic → <em>, underline → <u>.
 */
async function docxToHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  return result.value
}

/**
 * Strip all HTML tags and normalise whitespace from a string.
 * Used only for heading text extraction.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Convert mammoth HTML to markdown-style plain text, preserving structure:
 * - Bullet lists  →  - item
 * - Numbered lists → 1. item
 * - Bold          →  **text**
 * - Tables        →  | col | col |
 * Used for section content so Claude sees the original formatting.
 */
function htmlToMarkdown(html: string): string {
  let md = html

  // Bold / underline → **text** (underline is commonly used for emphasis in law notes)
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '**$1**')
  // Italic → _text_
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '_$1_')
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '_$1_')

  // Tables — convert each row to pipe-delimited line
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body) => {
    const rows: string[] = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRe.exec(body)) !== null) {
      const cells: string[] = []
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
      let cellMatch: RegExpExecArray | null
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(stripHtml(cellMatch[1]).trim())
      }
      if (cells.length > 0) rows.push('| ' + cells.join(' | ') + ' |')
    }
    return rows.join('\n') + '\n'
  })

  // Ordered list items → "N. item"
  let olCounter = 0
  md = md.replace(/<ol[^>]*>/gi, () => { olCounter = 0; return '' })
  md = md.replace(/<\/ol>/gi, '\n')
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    olCounter++
    return `${olCounter}. ${stripHtml(content).trim()}\n`
  })

  // Unordered list items → "- item"
  md = md.replace(/<ul[^>]*>/gi, '')
  md = md.replace(/<\/ul>/gi, '\n')
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${stripHtml(content).trim()}\n`)

  // Paragraphs → newlines
  md = md.replace(/<\/p>/gi, '\n')
  md = md.replace(/<p[^>]*>/gi, '')
  md = md.replace(/<br\s*\/?>/gi, '\n')

  // Strip any remaining tags
  md = md.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  // Normalise whitespace — collapse 3+ blank lines to 2
  md = md.replace(/\n{3,}/g, '\n\n').trim()

  return md
}

/**
 * Parse mammoth HTML into a flat list of {level, title, content} objects,
 * then assemble into a tree.
 *
 * Works with both:
 * a) Proper Word heading styles (h1–h4 tags)
 * b) Flat paragraphs where headings are ALL-CAPS or short bold-only lines
 */
export function parseHtmlToSections(html: string): DocSection[] {
  // Split on heading tags to get blocks
  // We treat h1–h4 as structural headings
  const headingRe = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi
  const paragraphRe = /<p[^>]*>([\s\S]*?)<\/p>/gi

  // Check if the doc has proper heading tags
  const hasHeadings = /<h[1-4]/i.test(html)

  if (hasHeadings) {
    return parseByHeadingTags(html)
  } else {
    return parseByAllCapsHeuristic(html)
  }
}

function parseByHeadingTags(html: string): DocSection[] {
  // Split HTML into tokens: either a heading or a block of content
  const tokens: Array<{ type: 'heading'; level: number; text: string } | { type: 'content'; html: string }> = []

  // Use a simple state machine over the HTML string
  let pos = 0
  const headingRe = /<(h([1-4]))[^>]*>([\s\S]*?)<\/h[1-4]>/gi
  let match: RegExpExecArray | null

  while ((match = headingRe.exec(html)) !== null) {
    // Everything between previous position and this heading is content
    if (match.index > pos) {
      const contentHtml = html.slice(pos, match.index)
      const text = stripHtml(contentHtml)
      if (text.trim()) {
        tokens.push({ type: 'content', html: contentHtml })
      }
    }
    tokens.push({
      type: 'heading',
      level: parseInt(match[2], 10),
      text: stripHtml(match[3]).trim(),
    })
    pos = match.index + match[0].length
  }
  // Tail content after last heading
  if (pos < html.length) {
    const text = stripHtml(html.slice(pos))
    if (text.trim()) {
      tokens.push({ type: 'content', html: html.slice(pos) })
    }
  }

  return buildSectionTree(tokens)
}

function parseByAllCapsHeuristic(html: string): DocSection[] {
  // Extract all <p> tags. Paragraphs that are short and ALL-CAPS are treated as headings.
  const tokens: Array<{ type: 'heading'; level: number; text: string } | { type: 'content'; html: string }> = []

  const paragraphRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let match: RegExpExecArray | null

  while ((match = paragraphRe.exec(html)) !== null) {
    const raw = match[1]
    const text = stripHtml(raw).trim()
    if (!text) continue

    const isAllCaps = text === text.toUpperCase() && /[A-Z]/.test(text) && text.length < 80
    const isBoldOnly = /^<strong>[^<]+<\/strong>$/.test(raw.trim()) && text.length < 80

    if (isAllCaps) {
      // Determine level by text length / context: very short all-caps = level 1, longer = level 2
      const level = text.length < 30 ? 1 : 2
      tokens.push({ type: 'heading', level, text })
    } else if (isBoldOnly) {
      tokens.push({ type: 'heading', level: 3, text })
    } else {
      tokens.push({ type: 'content', html: match[0] })
    }
  }

  return buildSectionTree(tokens)
}

function buildSectionTree(
  tokens: Array<{ type: 'heading'; level: number; text: string } | { type: 'content'; html: string }>
): DocSection[] {
  const roots: DocSection[] = []
  const stack: DocSection[] = []

  for (const token of tokens) {
    if (token.type === 'heading') {
      const section: DocSection = {
        level: token.level,
        title: token.text,
        path: [],
        content: '',
        children: [],
      }

      // Pop stack back to parent level
      while (stack.length > 0 && stack[stack.length - 1].level >= token.level) {
        stack.pop()
      }

      // Build path from stack
      section.path = [...stack.map(s => s.title), token.text]

      if (stack.length === 0) {
        roots.push(section)
      } else {
        stack[stack.length - 1].children.push(section)
      }

      stack.push(section)
    } else {
      // Content belongs to the current section (top of stack)
      // Use htmlToMarkdown to preserve bullet points, numbered lists, tables, bold
      const md = htmlToMarkdown(token.html)
      if (md && stack.length > 0) {
        stack[stack.length - 1].content += (stack[stack.length - 1].content ? '\n\n' : '') + md
      }
    }
  }

  return roots
}

/**
 * Flatten a section tree into leaf sections that have content.
 * A "leaf" is either a section with no children, or a section where
 * the content is substantial enough to process independently.
 */
export function flattenToLeaves(sections: DocSection[]): DocSection[] {
  const leaves: DocSection[] = []

  function walk(section: DocSection) {
    const hasContent = section.content.trim().length > 100
    const hasChildren = section.children.length > 0

    if (!hasChildren && hasContent) {
      leaves.push(section)
    } else if (hasChildren) {
      // If this section itself has substantial content, treat it as a leaf too
      if (hasContent) {
        // Create a virtual "intro" leaf for the section's own content
        leaves.push({
          ...section,
          title: section.title,
          children: [],
        })
      }
      section.children.forEach(walk)
    }
  }

  sections.forEach(walk)
  return leaves
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2a: Mechanical splitting — guaranteed complete, zero AI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split markdown content into atomic chunks purely mechanically.
 * No AI involved — nothing can be omitted.
 *
 * Rules:
 *   - Each bullet point (- or *) → its own chunk
 *   - Each numbered list item    → its own chunk
 *   - Table rows                 → kept together as one chunk per table
 *   - Prose paragraphs           → one chunk per paragraph (blank-line separated)
 */
function splitMarkdownIntoAtomicChunks(markdown: string): string[] {
  const lines = markdown.split('\n')
  const chunks: string[] = []
  let current: string[] = []
  let inTable = false

  function flush() {
    const text = current.join('\n').trim()
    if (text.length > 3) chunks.push(text)
    current = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Empty line = boundary between prose paragraphs / after table
    if (!trimmed) {
      flush()
      inTable = false
      continue
    }

    // Table row — accumulate all rows of the same table together
    if (trimmed.startsWith('|')) {
      if (!inTable) {
        flush() // flush any preceding prose
        inTable = true
      }
      current.push(line)
      continue
    }

    // If we were in a table and hit a non-table line, flush the table
    if (inTable) {
      flush()
      inTable = false
    }

    // Bullet point — each is its own chunk
    if (/^[-*]\s+\S/.test(trimmed)) {
      flush()
      chunks.push(trimmed)
      continue
    }

    // Numbered list item — each is its own chunk
    if (/^\d+[.)]\s+\S/.test(trimmed)) {
      flush()
      chunks.push(trimmed)
      continue
    }

    // Regular prose line — accumulate into a paragraph chunk
    current.push(line)
  }

  flush()

  return chunks.filter(c => c.trim().length > 3)
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2b: Classification — Claude Haiku adds rule_type + key_terms only
// rule_text is NEVER modified. Haiku is used (cheap) because this is
// simple classification, not generation.
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You are classifying pre-extracted UK law knowledge chunks for SQE1 exam preparation.

For each numbered chunk provided, return ONLY:
- rule_type: what kind of legal rule it is
- key_terms: up to 5 specific legal terms exactly as they appear in the chunk text

RULES:
- Do NOT modify or reproduce the chunk text
- Do NOT summarise or paraphrase
- Classify only — return metadata

rule_type options: definition | threshold | test | exception | procedure | consequence | general_principle | uncertain

"uncertain" = the chunk contains a statutory reference that looks corrupt or inconsistent, or the meaning is genuinely ambiguous.

Return ONLY a JSON array, one object per chunk, in the same order as input. No explanation, no markdown fences.

[{"rule_type":"...","key_terms":["term1","term2"]}]`

const CLASSIFY_BATCH_SIZE = 40 // chunks per Haiku call

async function classifyChunkBatch(
  haiku: Anthropic,
  chunkTexts: string[],
  sectionContext: string,
): Promise<Array<{ rule_type: ExtractedChunk['rule_type']; key_terms: string[] }>> {
  if (chunkTexts.length === 0) return []

  const numbered = chunkTexts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')

  try {
    const message = await haiku.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Section: ${sectionContext}\n\nChunks:\n${numbered}`,
      }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) throw new Error('not array')

    return parsed.map((p: { rule_type?: string; key_terms?: string[] }) => ({
      rule_type: (p.rule_type as ExtractedChunk['rule_type']) ?? 'general_principle',
      key_terms: Array.isArray(p.key_terms) ? p.key_terms : [],
    }))
  } catch {
    // If classification fails, fall back to defaults — chunk text is still saved correctly
    return chunkTexts.map(() => ({ rule_type: 'general_principle' as const, key_terms: [] }))
  }
}

async function extractChunksFromSection(
  client: Anthropic,
  section: DocSection,
  topicName: string,
): Promise<ExtractedChunk[]> {
  const breadcrumb = section.path.join(' > ')
  const subtopicName = section.path[1] ?? section.path[0] ?? topicName
  const sectionName = section.path[section.path.length - 1] ?? subtopicName
  const topicSlug = detectTopicSlug(section.path)

  // Phase 1: Mechanical split — guaranteed to capture everything
  const chunkTexts = splitMarkdownIntoAtomicChunks(section.content)
  if (chunkTexts.length === 0) return []

  // Phase 2: Haiku classifies in batches — cheap, never touches rule_text
  const classifications: Array<{ rule_type: ExtractedChunk['rule_type']; key_terms: string[] }> = []

  for (let i = 0; i < chunkTexts.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = chunkTexts.slice(i, i + CLASSIFY_BATCH_SIZE)
    const result = await classifyChunkBatch(client, batch, breadcrumb)
    classifications.push(...result)
  }

  return chunkTexts.map((text, i) => ({
    rule_text: text,                          // verbatim mechanical extract — never touched by AI
    exact_source_quote: null,
    context_text: null,
    key_terms: classifications[i]?.key_terms ?? [],
    rule_type: classifications[i]?.rule_type ?? 'general_principle',
    source_section: breadcrumb,
    subtopic_name: subtopicName,
    section_name: sectionName,
    topic_slug: topicSlug,
  }))
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

  // Last resort: 4000-char chunks
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 4000) {
    const c = text.slice(i, i + 4000).trim()
    if (c.length > 100) chunks.push(c)
  }
  return chunks
}

async function extractChunksFromQuestionBatch(
  client: Anthropic,
  batch: string,
  batchIndex: number,
  topicHint: string,
): Promise<ExtractedChunk[]> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: QUESTIONS_EXTRACTION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Topic context: ${topicHint}\nBatch ${batchIndex + 1}:\n\n${batch}`,
    }],
  })

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
 * @returns          - flat array of extracted chunks ready for DB insertion
 */
export async function extractChunksFromDocx(
  buffer: Buffer,
  topicName: string,
  onProgress: (p: ExtractionProgress) => void,
): Promise<ExtractedChunk[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ── Stage 1: Parse ──────────────────────────────────────────────────────────
  onProgress({ stage: 'parsing', message: 'Converting document to structured sections…' })

  let html: string
  try {
    html = await docxToHtml(buffer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    onProgress({ stage: 'error', message: 'Failed to parse document', error: msg })
    throw err
  }

  const tree = parseHtmlToSections(html)
  const leaves = flattenToLeaves(tree)

  if (leaves.length === 0) {
    onProgress({ stage: 'error', message: 'No sections found in document. Check the document structure.' })
    throw new Error('No sections found')
  }

  onProgress({
    stage: 'parsing',
    message: `Found ${leaves.length} sections to process`,
    sections_total: leaves.length,
    sections_done: 0,
    chunks_found: 0,
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
