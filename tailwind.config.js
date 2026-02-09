/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0b1220',
        surface: '#111a2b',
        'surface-2': '#0f172a',
        border: 'rgba(255, 255, 255, 0.08)',
        text: '#e5e7eb',
        'text-dim': '#94a3b8',
        muted: '#94a3b8',
        accent: '#3b82f6',
        accentBlue: '#3b82f6',
        success: '#22c55e',
        danger: '#ef4444',
        warning: '#f59e0b',
        info: '#06b6d4',
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '10px',
      },
      gridTemplateColumns: {
        app: '280px 1fr 320px',
        main: 'repeat(12, minmax(0, 1fr))',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-in-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-down': 'slide-down 0.3s ease-out',
      },
    },
  },
  plugins: [],
}

