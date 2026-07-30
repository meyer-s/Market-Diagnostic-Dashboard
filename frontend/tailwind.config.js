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
          '50': 'rgb(var(--stealth-50) / <alpha-value>)',
          '100': 'rgb(var(--stealth-100) / <alpha-value>)',
          '200': 'rgb(var(--stealth-200) / <alpha-value>)',
          '300': 'rgb(var(--stealth-300) / <alpha-value>)',
          '400': 'rgb(var(--stealth-400) / <alpha-value>)',
          '500': 'rgb(var(--stealth-500) / <alpha-value>)',
          '600': 'rgb(var(--stealth-600) / <alpha-value>)',
          '700': 'rgb(var(--stealth-700) / <alpha-value>)',
          '750': 'rgb(var(--stealth-750) / <alpha-value>)',
          '800': 'rgb(var(--stealth-800) / <alpha-value>)',
          '850': 'rgb(var(--stealth-850) / <alpha-value>)',
          '900': 'rgb(var(--stealth-900) / <alpha-value>)',
          '950': 'rgb(var(--stealth-950) / <alpha-value>)',
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
