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
          '100': '#eef3f9',
          '200': '#d5dfec',
          '300': '#b9c7d8',
          '400': '#a1b2c7',
          '500': '#91a4bd',
          '600': '#46566c',
          '700': '#3f5068',
          '750': '#334258',
          '800': '#26364a',
          '850': '#1e2b3d',
          '900': '#182333',
          '950': '#0e1520',
        },
        'accent': {
          'green': '#69d6a3',
          'yellow': '#f3cb69',
          'red': '#ff8a93',
        },
        'pulse': {
          '400': '#83bfff',
        }
      }
    },
  },
  plugins: [],
}
