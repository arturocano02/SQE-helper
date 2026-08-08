'use client'

import Celebration from './Celebration'

/**
 * Triggers a confetti burst on the session summary page, scaled to how well the
 * session went. Excellent results get a big burst, good results get a lighter one,
 * lower tiers skip confetti (the summary page still gives them a gentler pop-in
 * animation + an always-encouraging message — see SessionSummaryPage).
 */
export default function SessionCelebration({ pct }: { pct: number }) {
  if (pct >= 90) return <Celebration show pieces={pct === 100 ? 100 : 70} />
  if (pct >= 70) return <Celebration show pieces={35} />
  return null
}
