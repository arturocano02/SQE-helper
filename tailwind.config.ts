import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg:           '#0D0D0B',
        surface:      '#161613',
        surface2:     '#1E1E1A',
        border:       '#2A2A24',
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
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}
export default config
