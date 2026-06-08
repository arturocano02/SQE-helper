/**
 * Split FLK notes text into chunks for Claude processing.
 * Detects ALL CAPS headers (module/section boundaries) and splits there.
 * Max ~2000 tokens ≈ ~8000 characters per chunk.
 */

const MAX_CHUNK_CHARS = 8000

/**
 * Determine if a line looks like a section header:
 *   - entirely UPPERCASE (allowing spaces, digits, punctuation)
 *   - at least 5 chars
 */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 5) return false
  return trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)
}

export function chunkText(text: string): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let current: string[] = []
  let currentLen = 0

  function flush() {
    const chunk = current.join('\n').trim()
    if (chunk.length > 50) chunks.push(chunk)
    current = []
    currentLen = 0
  }

  for (const line of lines) {
    const isHeader = isSectionHeader(line)

    // If we hit a new header and have content, flush
    if (isHeader && currentLen > 200) {
      flush()
    }

    current.push(line)
    currentLen += line.length + 1

    // Hard size limit
    if (currentLen >= MAX_CHUNK_CHARS) {
      flush()
    }
  }

  flush()
  return chunks
}
