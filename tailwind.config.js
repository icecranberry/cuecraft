/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0d10',
          900: '#111418',
          850: '#161a20',
          800: '#1c2128',
          750: '#232932',
          700: '#2b323d',
          600: '#3a4350',
          500: '#5b6673',
          400: '#8a94a1',
          300: '#b6bec9',
          200: '#d7dce2',
          100: '#eef1f4'
        },
        accent: {
          500: '#f59e0b',
          400: '#fbbf24',
          600: '#d97706'
        }
      },
      fontSize: {
        xxs: ['0.6875rem', '1rem']
      }
    }
  },
  plugins: []
};
