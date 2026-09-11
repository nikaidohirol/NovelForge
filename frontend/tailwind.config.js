/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        grape: {
          50: '#f5f2fc',
          100: '#ece5f9',
          200: '#d8ccf2',
          300: '#bda8e8',
          400: '#a98fe0',
          500: '#8b6cd0',
          600: '#7452b8',
          700: '#5e419a',
          800: '#483178',
          900: '#322355',
        },
      },
      boxShadow: {
        soft: '0 8px 24px rgba(116, 82, 184, 0.14)',
        lift: '0 12px 32px rgba(116, 82, 184, 0.22)',
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
