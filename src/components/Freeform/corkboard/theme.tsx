// components/Freeform/corkboard/theme.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useContext, createContext } from 'react';

// ---------------------------------------------------------------------
// Theme — dark is the default (matches the main site). Light is the cream
// board built earlier. Components read the mode via context so it doesn't
// have to thread through every prop list. The dark surface + glow-line
// treatment is modeled on components/ScenesCanvas (ScenesCanvasWorkspace).
// ---------------------------------------------------------------------
export type ThemeMode = 'dark' | 'light';

export const ThemeCtx = createContext<ThemeMode>('dark');

export const useThemeMode = () => useContext(ThemeCtx);

export const THEME_STORE_KEY = 'ff-theme';

// ScenesCanvas's brand orange (connector glow, grid dots).
export const DARK_ORANGE = '#ff6b35';

// Lift a hex color toward white — the light palette's entity colors read
// muddy on the near-black stage; dark mode uses lifted variants for accents.
export function liftColor(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amt);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const SunIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M19.4 4.6l-1.8 1.8M6.4 17.6l-1.8 1.8" />
  </svg>
);

export const MoonIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
