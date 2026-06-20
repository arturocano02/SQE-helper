'use client'

import Celebration from './Celebration'

/**
 * Triggers a confetti burst on the session summary page for excellent results.
 * Purely additive — sits on top of the existing summary layout, doesn't change it.
 */
export default function SessionCelebration({ pct }: { pct: number }) {
  return <Celebration show={pct >= 90} pieces={pct === 100 ? 90 : 60} />
}
