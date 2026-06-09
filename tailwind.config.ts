import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // ── New design system tokens (CSS-var backed) ──
        base:    'var(--surface-base)',
        s1:      'var(--surface-1)',
        s2:      'var(--surface-2)',
        s3:      'var(--surface-3)',
        border:  'rgba(255,255,255,0.07)',    // --surface-border
        'border-active': 'rgba(200,146,42,0.35)',

        amber:   'var(--amber)',
        'amber-soft': 'var(--amber-soft)',
        'amber-glow': 'var(--amber-glow)',
        'amber-text': 'var(--amber-text)',

        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted:     'var(--text-muted)',

        correct:  'var(--status-correct)',
        wrong:    'var(--status-wrong)',
        warn:     'var(--status-warning)',
        neutral:  'var(--status-neutral)',

        // ── Legacy aliases (keep old code building) ──
        bg:           'var(--surface-base)',
        surface:      'var(--surface-1)',
        surface2:     'var(--surface-2)',
        accent:       'var(--amber)',
        'accent-dim': 'var(--amber-soft)',
        success:      'var(--status-correct)',
        error:        'var(--status-wrong)',
        warning:      'var(--status-warning)',
      },
      fontFamily: {
        serif: ['var(--font-cormorant)', 'Georgia', 'serif'],
        sans:  ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-dm-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        none:    '0',
        sm:      '4px',
        DEFAULT: '8px',
        md:      '10px',
        lg:      '12px',
        xl:      '16px',
        '2xl':   '20px',
        full:    '9999px',
      },
      transitionDuration: { DEFAULT: '150ms' },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 3px rgba(0,0,0,0.25)',
        glow: '0 0 0 3px var(--amber-glow)',
        'inner-top': '0 1px 0 0 rgba(255,255,255,0.05) inset',
      },
    },
  },
  plugins: [],
}
export default config
