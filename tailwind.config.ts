import type { Config } from 'tailwindcss'

export default {
  content: ['./components/**/*.vue', './app.vue', './pages/**/*.vue', './composables/**/*.ts'],
  theme: {
    extend: {
      colors: {
        cream: { DEFAULT: '#f7f1e8', deep: '#efe5d6' },
        ink: { DEFAULT: '#1f1b16', soft: '#5b5247', faint: '#8c8174' },
        clay: { DEFAULT: '#c2562b', dark: '#9e4320', light: '#f3d9cb' },
        sage: { DEFAULT: '#5f7a63', light: '#dfe8dc' },
        gold: { DEFAULT: '#b98b2e', light: '#f2e5c4' }
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,27,22,0.06), 0 8px 24px -12px rgba(31,27,22,0.18)'
      }
    }
  }
} satisfies Config
