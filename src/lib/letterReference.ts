/**
 * Detects whether an MCQ explanation refers to an option by its letter
 * (e.g. "Option B is correct", "answer C is wrong", "(D) is incorrect").
 *
 * Why this matters: option letters get reassigned after generation
 * (see shuffleCorrectAnswer in /api/admin/generate and /api/questions/generate-more,
 * and the reshuffle in /api/admin/questions/rebalance). If the explanation text
 * bakes in a letter reference from before that reassignment, the explanation can
 * end up naming the wrong letter as correct — the exact bug this module guards against.
 *
 * Intentionally conservative (may have false positives on legitimate legal text like
 * "Schedule A" or "Part B") — callers should treat a match as "needs manual review or
 * rewrite", not silently drop or auto-correct the row.
 */
const LETTER_REFERENCE_PATTERNS = [
  /\boption\s+[A-E]\b/i,
  /\banswer\s+[A-E]\b/i,
  /\b[A-E]\s+is\s+(the\s+)?(correct|right|wrong|incorrect)\b/i,
  /\bcorrect\s+answer\s+is\s+[A-E]\b/i,
  /\(\s*[A-E]\s*\)\s*(is|was)\b/i,
  /\bchoice\s+[A-E]\b/i,
]

export function explanationReferencesLetter(explanation: string | null | undefined): boolean {
  if (!explanation) return false
  return LETTER_REFERENCE_PATTERNS.some(re => re.test(explanation))
}
