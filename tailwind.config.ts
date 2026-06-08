import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg:           '#0D0D0B',  // page background — near black
        surface:      '#1A1A16',  // cards — clearly above bg
        surface2:     '#242420',  // inputs / hover — above surface
        border:       '#32322A',  // visible borders
        accent:       '#C8922A',
        'accent-dim': '#5C3F0D',
        primary:      '#EEE9DF',
        secondary:    '#8C876F',
        muted:        '#4A4740',
        success:      '#4ADE80',
        error:        '#F87171',
        warning:      '#FBBF24',
      },
      fontFamily: {
        serif: ['var(--font-cormorant)', 'Georgia', 'serif'],
        sans:  ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        none: '0',
        sm:   '0.375rem',   // 6px
        DEFAULT: '0.625rem', // 10px
        md:   '0.75rem',    // 12px
        lg:   '1rem',       // 16px
        xl:   '1.25rem',    // 20px
        '2xl':'1.5rem',     // 24px
        full: '9999px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}
export default config
