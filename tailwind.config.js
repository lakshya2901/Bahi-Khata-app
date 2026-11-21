/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Navy of the "MAHAVEER" lettering
        brand: {
          50: '#EEF4FB', 100: '#D9E6F5', 200: '#B6CDEA', 300: '#86ABD9', 400: '#4F82C0',
          500: '#2C629F', 600: '#1F5590', 700: '#17497F', 800: '#123B66', 900: '#0D2B4B',
        },
        // Gold of "AGENCIES" and the line-art
        gold: {
          50: '#FDF9EC', 100: '#FAEFCB', 200: '#F4DE97', 300: '#EBC965', 400: '#E2B84E',
          500: '#D9A93E', 600: '#BF8F2B', 700: '#9A7122',
        },
        // The orange of the sun-ring
        saffron: { 50: '#FEF3E7', 400: '#F7A24C', 500: '#F28C2C', 600: '#DC7712' },
        // The warm off-white behind the logo
        cream: { DEFAULT: '#F8F7F1', deep: '#F0EEE3' },
      },
    },
  },
  plugins: [],
};
