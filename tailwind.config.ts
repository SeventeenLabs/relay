import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f4f3ee',
        foreground: '#1f1f1c',
        card: '#ffffff',
        'card-foreground': '#1f1f1c',
        popover: '#ffffff',
        'popover-foreground': '#1f1f1c',
        primary: '#ea9f7d',
        'primary-foreground': '#fffefb',
        secondary: '#ecebe4',
        'secondary-foreground': '#1f1f1c',
        muted: '#ecebe4',
        'muted-foreground': '#6f7067',
        accent: '#ecebe4',
        'accent-foreground': '#1f1f1c',
        destructive: '#c65a4f',
        'destructive-foreground': '#fffefb',
        border: '#deddd4',
        input: '#deddd4',
        ring: '#de825e',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.625rem',
        sm: '0.5rem',
      },
      fontFamily: {
        sans: ['Space Grotesk', 'Segoe UI', 'sans-serif'],
        serif: ['Fraunces', 'Segoe UI', 'serif'],
      },
    },
  },
};

export default config;
