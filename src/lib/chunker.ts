/**
 * Split FLK notes into context-aware chunks for Claude.
 *
 * Each returned chunk is prefixed with its section header so Claude always
 * knows which topic it's processing, even if the header sits in a prior chunk.
 *
 * Matches the FLK1/FLK2 notes format:
 *   - ALL CAPS lines = major topic/subtopic headers
 *   - coloured subheadings are NOT all-caps (ignored as split points)
 *   - tables, bullet points, numbered steps follow each header
 */

const MAX_CHUNK_CHARS = 7000

// Topic header → slug mapping so we can label each chunk precisely
const HEADER_TO_SLUG: Record<string, string> = {
  'BUSINESS LAW AND PRACTICE': 'business-law',
  'BUSINESS LAW':              'business-law',
  'DISPUTE RESOLUTION':        'dispute-resolution',
  'CONTRACT':                  'contract',
  'TORT':                      'tort',
  'PUBLIC':                    'legal-system',
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

export interface TextChunk {
  text: string
  topicSlug: string | null   // known topic from nearest ALL CAPS header, if any
  topicHeader: string | null // raw header text
}

function isSectionHeader(line: string): boolean {
  const t = line.trim()
  if (t.length < 4) return false
  // ALL CAPS, must contain at least one letter
  return t === t.toUpperCase() && /[A-Z]/.test(t)
}

function resolveSlug(header: string): string | null {
  const upper = header.trim().toUpperCase()
  if (HEADER_TO_SLUG[upper]) return HEADER_TO_SLUG[upper]
  // Fuzzy: check if any known key is contained in the header
  for (const [key, slug] of Object.entries(HEADER_TO_SLUG)) {
    if (upper.includes(key) || key.includes(upper)) return slug
  }
  return null
}

export function chunkText(text: string): TextChunk[] {
  const lines = text.split('\n')
  const chunks: TextChunk[] = []

  let currentLines: string[] = []
  let currentLen = 0
  let currentHeader: string | null = null
  let currentSlug: string | null = null

  function flush() {
    const body = currentLines.join('\n').trim()
    if (body.length < 50) return
    chunks.push({
      // Prefix every chunk with its section context so Claude is never guessing
      text: currentHeader
        ? `[SECTION: ${currentHeader}]\n\n${body}`
        : body,
      topicSlug: currentSlug,
      topicHeader: currentHeader,
    })
    currentLines = []
    currentLen = 0
  }

  for (const line of lines) {
    const isHeader = isSectionHeader(line)

    if (isHeader && currentLen > 100) {
      flush()
      // Update the running header context
      currentHeader = line.trim()
      currentSlug = resolveSlug(currentHeader)
    } else if (isHeader) {
      // Still at the top of a chunk — update header without flushing
      currentHeader = line.trim()
      currentSlug = resolveSlug(currentHeader)
    }

    currentLines.push(line)
    currentLen += line.length + 1

    if (currentLen >= MAX_CHUNK_CHARS) flush()
  }

  flush()
  return chunks
}

/**
 * Import mode chunker — splits on "Question N" headings (SQE sample paper format).
 * Groups QUESTIONS_PER_CHUNK questions together so each Claude call processes
 * a manageable batch. Falls back to character-based splitting if no question
 * headings are found (e.g. older formats).
 */
const QUESTIONS_PER_CHUNK = 5

export function chunkForImport(text: string): string[] {
  // Try to split on "Question N" headings (official SQE format)
  const questionSplits = [...text.matchAll(/\n(?=Question\s+\d{1,3}\s*\n)/gi)]

  if (questionSplits.length >= 10) {
    // Build per-question sections
    const positions = questionSplits.map(m => m.index!)
    positions.push(text.length) // sentinel

    const questionBlocks: string[] = []
    for (let i = 0; i < positions.length - 1; i++) {
      const block = text.slice(positions[i], positions[i + 1]).trim()
      if (block.length > 50) questionBlocks.push(block)
    }

    // Group into batches of QUESTIONS_PER_CHUNK
    const chunks: string[] = []
    for (let i = 0; i < questionBlocks.length; i += QUESTIONS_PER_CHUNK) {
      chunks.push(questionBlocks.slice(i, i + QUESTIONS_PER_CHUNK).join('\n\n---\n\n'))
    }
    return chunks
  }

  // Fallback: character-based splitting
  const CHUNK_SIZE = 6000
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + CHUNK_SIZE, text.length)
    if (end < text.length) {
      const region = text.slice(i + 2000, end)
      const match = region.search(/\n\d{1,3}[\.\)]/)
      if (match !== -1) end = i + 2000 + match
    }
    const chunk = text.slice(i, end).trim()
    if (chunk.length > 100) chunks.push(chunk)
    i = end
  }
  return chunks
}
