import type { Config } from 'tailwindcss'

export default {
  content: ['./components/**/*.vue', './app.vue', './pages/**/*.vue', './composables/**/*.ts'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: '#fafaf7', deep: '#efefe9' },
        ink: { DEFAULT: '#0e0e0e', soft: '#45453f', faint: '#77776f' },
        pop: { DEFAULT: '#ffd23f', dark: '#f5b800', light: '#fff1b8' },
        cobalt: { DEFAULT: '#2f45ff', dark: '#1d2fd6', light: '#dfe3ff' },
        mint: { DEFAULT: '#14845a', light: '#c9f2dc' },
        lilac: { DEFAULT: '#6b4eff', light: '#e6deff' },
        coral: { DEFAULT: '#e5484d', light: '#ffe0e0' }
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        card: '4px 4px 0 0 #0e0e0e',
        hard: '3px 3px 0 0 #0e0e0e',
        lift: '6px 6px 0 0 #0e0e0e'
      }
    }
  }
} satisfies Config
