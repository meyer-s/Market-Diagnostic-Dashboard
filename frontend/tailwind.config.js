/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'stealth': {
          '700': '#2d3748',
          '800': '#1a202c',
          '900': '#171923',
        },
        'accent': {
          'green': '#48bb78',
          'yellow': '#ecc94b',
          'red': '#f56565',
        }
      }
    },
  },
  plugins: [],
}
