/**
 * SM-2 spaced repetition algorithm
 * https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 */

export interface SrsState {
  ease_factor: number    // starts at 2.5
  interval_days: number  // days until next review
  repetitions: number    // consecutive correct answers
}

/**
 * Quality: 0–5 where 0=complete blackout, 5=perfect response
 * For MCQ: correct=4, incorrect=1
 * For flashcard self-assessment: got_it=5, nearly=3, missed_it=1
 */
export function updateSrs(state: SrsState, quality: number): SrsState & { next_review_at: Date } {
  let { ease_factor, interval_days, repetitions } = state

  if (quality >= 3) {
    // Correct response
    if (repetitions === 0) {
      interval_days = 1
    } else if (repetitions === 1) {
      interval_days = 6
    } else {
      interval_days = Math.round(interval_days * ease_factor)
    }
    repetitions += 1
  } else {
    // Incorrect — reset
    repetitions = 0
    interval_days = 1
  }

  // Update ease factor
  ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  if (ease_factor < 1.3) ease_factor = 1.3

  const next_review_at = new Date()
  next_review_at.setDate(next_review_at.getDate() + interval_days)

  return { ease_factor, interval_days, repetitions, next_review_at }
}

export function defaultSrsState(): SrsState {
  return { ease_factor: 2.5, interval_days: 1, repetitions: 0 }
}
