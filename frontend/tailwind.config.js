/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        'xs': '475px',
      },
      colors: {
        'stealth': {
          '700': '#3b4658',
          '750': '#2e3645',
          '800': '#26303d',
          '850': '#242d3a',
          '900': '#222633',
        },
        'accent': {
          'green': '#48bb78',
          'yellow': '#ecc94b',
          'red': '#f56565',
        },
        'pulse': {
          '400': '#60a5fa',
        }
      }
    },
  },
  plugins: [],
}
