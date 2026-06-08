import type { UserTopicMastery, Confidence } from '@/types/database'

/**
 * Recalculate mastery score (0–100) from raw correct/total counts.
 * Weights: hard=50%, medium=35%, easy=15%
 */
export function calculateMasteryScore(mastery: Partial<UserTopicMastery>): number {
  const easyPct = mastery.easy_total ? (mastery.easy_correct ?? 0) / mastery.easy_total : 0
  const medPct = mastery.medium_total ? (mastery.medium_correct ?? 0) / mastery.medium_total : 0
  const hardPct = mastery.hard_total ? (mastery.hard_correct ?? 0) / mastery.hard_total : 0

  const hasSeen =
    (mastery.easy_total ?? 0) + (mastery.medium_total ?? 0) + (mastery.hard_total ?? 0) > 0

  if (!hasSeen) return mastery.mastery_score ?? 0

  // Weighted average
  const easyW = 0.15
  const medW = 0.35
  const hardW = 0.50

  const totalWeight =
    (mastery.easy_total ? easyW : 0) +
    (mastery.medium_total ? medW : 0) +
    (mastery.hard_total ? hardW : 0)

  if (totalWeight === 0) return 0

  const score =
    ((mastery.easy_total ? easyPct * easyW : 0) +
     (mastery.medium_total ? medPct * medW : 0) +
     (mastery.hard_total ? hardPct * hardW : 0)) / totalWeight

  return Math.round(score * 100)
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
