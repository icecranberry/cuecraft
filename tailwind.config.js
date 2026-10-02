/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#f5f5f0',
          900: '#ffffff',
          850: '#fafbf8',
          800: '#eff2eb',
          750: '#e8ede4',
          700: '#dce3d8',
          600: '#b6c3b8',
          500: '#67776c',
          400: '#56695c',
          300: '#405548',
          200: '#293f31',
          100: '#182f22'
        },
        accent: {
          500: '#246b50',
          400: '#19583e',
          600: '#174b37'
        }
      },
      fontSize: {
        xxs: ['0.75rem', '1.125rem']
      }
    }
  },
  plugins: []
};
