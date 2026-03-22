import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // KiwiMart brand palette
        gold: {
          DEFAULT: '#D4A843',
          dark: '#B8912E',
          light: '#F5ECD4',
          pale: '#FDF6E3',
        },
        ink: {
          DEFAULT: '#141414',
          mid: '#73706A',
          dim: '#9E9A91',
        },
        surface: {
          DEFAULT: '#F8F7F4',
          2: '#EFEDE8',
          off: '#FAFAF8',
        },
        border: {
          DEFAULT: '#C9C5BC',
          light: '#E3E0D9',
        },
      },
      fontFamily: {
        playfair: ['var(--font-playfair)', 'Georgia', 'serif'],
        sans: ['var(--font-dm-sans)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        sm: '0 2px 8px rgba(0,0,0,.06)',
        DEFAULT: '0 4px 20px rgba(0,0,0,.09)',
        lg: '0 12px 40px rgba(0,0,0,.13)',
        xl: '0 24px 60px rgba(0,0,0,.17)',
        gold: '0 4px 20px rgba(212,168,67,.25)',
      },
    },
  },
  plugins: [],
};

export default config;

