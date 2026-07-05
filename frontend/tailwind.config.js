/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dispatcher: '#0F1216',
        ventas: '#F5F3ED',
      }
    },
  },
  plugins: [],
}
