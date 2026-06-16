import type { UserTopicMastery, Confidence } from '@/types/database'

// Thresholds that gate the top mastery tiers — accuracy alone isn't enough.
// A topic can't read as "Strong" or "Mastered" without real exposure to hard questions,
// since acing only easy/medium questions doesn't prove mastery of the topic.
const STRONG_CAP = 74        // score ceiling if the user has never attempted a hard question
const MASTERED_CAP = 89      // score ceiling if hard exposure/accuracy is below the bar
const MIN_HARD_SHARE_FOR_MASTERY = 0.20  // hard questions must be ≥20% of all attempts
const MIN_HARD_ACCURACY_FOR_MASTERY = 0.60 // and ≥60% correct on those hard questions

/**
 * Recalculate mastery score (0–100) from raw correct/total counts.
 * Weights: hard=50%, medium=35%, easy=15%
 *
 * On top of the weighted accuracy average, the score is capped unless the user has
 * meaningfully engaged with hard questions — otherwise a topic drilled only with
 * easy/medium questions (even at 95%+ accuracy) could read as "Mastered", which is
 * misleading. See STRONG_CAP / MASTERED_CAP below.
 */
export function calculateMasteryScore(mastery: Partial<UserTopicMastery>): number {
  const easyTotal = mastery.easy_total ?? 0
  const medTotal = mastery.medium_total ?? 0
  const hardTotal = mastery.hard_total ?? 0
  const totalAttempted = easyTotal + medTotal + hardTotal

  const easyPct = easyTotal ? (mastery.easy_correct ?? 0) / easyTotal : 0
  const medPct = medTotal ? (mastery.medium_correct ?? 0) / medTotal : 0
  const hardPct = hardTotal ? (mastery.hard_correct ?? 0) / hardTotal : 0

  if (totalAttempted === 0) return mastery.mastery_score ?? 0

  // Weighted average
  const easyW = 0.15
  const medW = 0.35
  const hardW = 0.50

  const totalWeight =
    (easyTotal ? easyW : 0) +
    (medTotal ? medW : 0) +
    (hardTotal ? hardW : 0)

  if (totalWeight === 0) return 0

  const rawScore =
    ((easyTotal ? easyPct * easyW : 0) +
     (medTotal ? medPct * medW : 0) +
     (hardTotal ? hardPct * hardW : 0)) / totalWeight

  let score = Math.round(rawScore * 100)

  // Gate the top tiers behind real hard-question engagement.
  const hardShare = hardTotal / totalAttempted
  if (hardTotal === 0) {
    score = Math.min(score, STRONG_CAP)
  } else if (hardShare < MIN_HARD_SHARE_FOR_MASTERY || hardPct < MIN_HARD_ACCURACY_FOR_MASTERY) {
    score = Math.min(score, MASTERED_CAP)
  }

  return score
}

/**
 * What's still needed (if anything) to unlock the next mastery tier for this topic,
 * given hard-question engagement gates. Returns null if no gate is currently blocking.
 */
export function masteryGateMessage(mastery: Partial<UserTopicMastery>): string | null {
  const easyTotal = mastery.easy_total ?? 0
  const medTotal = mastery.medium_total ?? 0
  const hardTotal = mastery.hard_total ?? 0
  const totalAttempted = easyTotal + medTotal + hardTotal
  if (totalAttempted === 0) return null

  const hardPct = hardTotal ? (mastery.hard_correct ?? 0) / hardTotal : 0
  const hardShare = hardTotal / totalAttempted

  if (hardTotal === 0) {
    return 'Try some hard questions on this topic to unlock Strong and Mastered.'
  }
  if (hardShare < MIN_HARD_SHARE_FOR_MASTERY || hardPct < MIN_HARD_ACCURACY_FOR_MASTERY) {
    return `Mastered requires ≥${Math.round(MIN_HARD_ACCURACY_FOR_MASTERY * 100)}% accuracy on a meaningful share of hard questions for this topic.`
  }
  return null
}

/** Seed mastery score from onboarding confidence selection */
export function masteryFromConfidence(confidence: Confidence): number {
  switch (confidence) {
    case 'shaky': return 25
    case 'okay':  return 55
    case 'solid': return 75
  }
}

/** Human-readable mastery label */
export function masteryLabel(score: number): string {
  if (score < 30) return 'Needs work'
  if (score < 55) return 'Building'
  if (score < 75) return 'Developing'
  if (score < 90) return 'Strong'
  return 'Mastered'
}
