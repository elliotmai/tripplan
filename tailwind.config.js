/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0a0908',
          900: '#12100e',
          800: '#1c1916',
          700: '#2a2621',
          600: '#3d3830',
          500: '#5a5248',
        },
        gold: {
          300: '#e8d5a3',
          400: '#d4b87a',
          500: '#c19a4e',
          600: '#a07c32',
        },
        sage: {
          400: '#8aab8e',
          500: '#6b9070',
        },
        rust: {
          400: '#c47c5a',
          500: '#a85e3c',
        },
      },
    },
  },
  plugins: [],
}
