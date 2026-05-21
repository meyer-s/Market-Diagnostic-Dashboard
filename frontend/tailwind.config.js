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
          '50': '#f5f7fb',
          '100': '#e6edf7',
          '200': '#cbd8ea',
          '300': '#9fb1cb',
          '400': '#7687a0',
          '500': '#5a6b83',
          '600': '#46566c',
          '700': '#3b4658',
          '750': '#2e3645',
          '800': '#26303d',
          '850': '#242d3a',
          '900': '#222633',
          '950': '#0f1727',
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
