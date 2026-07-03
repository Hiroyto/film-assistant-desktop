/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      keyframes: {
        shine: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'custom-spin': {
          to: { transform: 'rotate(360deg)' },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-5px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-5px)" },
        },
      },
      animation: {
        shine: 'shine 3s linear infinite',
        'slow-spin': 'custom-spin 2s linear infinite',
        fadeIn: "fadeIn 0.25s ease-out forwards",
        fadeOut: "fadeOut 0.25s ease-out forwards",
      },
      fontFamily: {
        system: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        arial: ['Arial', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
      },
      colors: {
        bgdark1: '#1a1a1c',
        bgdark2: '#2a2a2e',
        orange: '#ff6b35',
        fontWhite05: 'rgba(255, 255, 255, 0.5)',
        fontWhite: 'rgba(255, 255, 255, 0.6)',
        fontWhite07: 'rgba(255, 255, 255, 0.7)',
        fontGray: 'rgba(255, 255, 255, 0.4)',
        glassBg: 'rgba(255, 255, 255, 0.08)',
        buttonPrivacy: 'rgba(255, 107, 53, 0.15)',
        orange02: 'rgba(255, 107, 53, 0.2)', 
        hoverGlassBg: 'rgba(255, 107, 53, 0.12)',
        orangeBorder: 'rgba(255, 107, 53, 0.3)',
        hoverOrangeBorder: 'rgba(255, 107, 53, 0.5)',
        // Tokens semânticos para os widgets local-first novos (tokens-derived.md §Semânticas).
        // Nunca usar hex literal solto — consumir via estas classes (DEV-005).
        semanticSuccess: '#22c55e', // sync online
        semanticInfo: '#3b82f6',    // sync syncing
        semanticWarning: '#f59e0b', // update available
        semanticError: '#ef4444',   // sync conflict / error accent
        semanticMuted: 'rgba(255, 255, 255, 0.4)', // sync offline
      }
    },
  },
  plugins: [
    require('tailwind-scrollbar'),
  ],
}