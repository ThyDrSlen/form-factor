const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, '..', 'app/**/*.{js,jsx,ts,tsx}'),
    join(__dirname, '..', 'components/**/*.{js,jsx,ts,tsx}'),
    join(__dirname, '..', 'contexts/**/*.{js,jsx,ts,tsx}'),
    join(__dirname, '..', 'lib/**/*.{js,jsx,ts,tsx}'),
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#050E1F',
        card: '#0D2036',
        panel: '#0F2339',
        edge: '#13263C',
        line: '#1B2E4A',
        accent: '#4C8CFF',
        brand: '#4C8CFF',
        border: '#1B2E4A',
        success: '#3CC8A9',
        ink: '#050E1F',
        inkMuted: '#6781A6',
        text: {
          primary: '#F5F7FF',
          secondary: '#8CA5C6',
          muted: '#5F789A',
        },
        weight: '#3CC8A9',
      },
    },
  },
  plugins: [],
};

