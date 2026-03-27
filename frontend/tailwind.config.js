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
          '700': '#364152',
          '750': '#2a313f',
          '800': '#222a36',
          '850': '#202734',
          '900': '#1d202b',
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
