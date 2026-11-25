/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#102A56',
          dark: '#0A1D3A',
          light: '#1C3E73',
        },
        teal: {
          DEFAULT: '#12A6A0',
          dark: 'var(--teal-strong)',
          light: 'var(--teal-soft)',
        },
        gold: {
          DEFAULT: '#F4B740',
          light: 'var(--gold-soft)',
        },
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        surfaceAlt: 'var(--surface-alt)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 4px 22px rgba(16, 42, 86, 0.07)',
        lift: '0 12px 32px rgba(16, 42, 86, 0.13)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.4rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'intro-pop': {
          '0%': { opacity: '0', transform: 'scale(0.65) translateY(12px)' },
          '60%': { opacity: '1', transform: 'scale(1.06) translateY(0)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'intro-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(244,183,64,0.55)' },
          '100%': { boxShadow: '0 0 0 26px rgba(244,183,64,0)' },
        },
        'intro-text': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'intro-line': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s ease-out both',
        'intro-pop': 'intro-pop 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'intro-ring': 'intro-ring 1.2s ease-out infinite',
        'intro-text': 'intro-text 0.5s ease-out both',
        'intro-line': 'intro-line 1.2s ease-in-out both',
      },
    },
  },
  plugins: [],
};
