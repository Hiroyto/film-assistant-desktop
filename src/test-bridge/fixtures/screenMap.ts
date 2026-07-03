// Mapa screen→montagem (parity 19D). A navegação do App é por react-router
// (/login, /home, /profile, /prices, /scenes, /scripts). Muitas "telas" dos specs
// são sub-views/modais dentro dessas rotas — modeladas via `subview`, que é exposto
// pelo FixtureContext para o componente-dono honrar (quando wired). Mapeamento de
// melhor-esforço fiel à topologia de rotas existente (App.tsx §Routes).
import type { ScreenSpec } from './types';

const AUTH: Pick<ScreenSpec, 'requiresAuth'> = { requiresAuth: true };
const PUBLIC: Pick<ScreenSpec, 'requiresAuth'> = { requiresAuth: false };

export const SCREEN_MAP: Record<string, ScreenSpec> = {
  // --- Auth (públicas) ---
  login: { route: '/login', ...PUBLIC },
  signup: { route: '/login', subview: 'signup', ...PUBLIC },
  'confirm-code': { route: '/login', subview: 'confirm', ...PUBLIC },
  forgot: { route: '/login', subview: 'forgot', ...PUBLIC },

  // --- Home e suas sub-views ---
  home: { route: '/home', ...AUTH },
  outline: { route: '/home', subview: 'outline', ...AUTH },
  foundation: { route: '/home', subview: 'foundation', ...AUTH },
  characters: { route: '/home', subview: 'characters', ...AUTH },
  summary: { route: '/home', subview: 'summary', ...AUTH },
  tour: { route: '/home', subview: 'tour', ...AUTH },

  // --- Scenes e variantes ---
  scenes: { route: '/scenes', ...AUTH },
  'scenes-canvas': { route: '/scenes', subview: 'canvas', ...AUTH },
  segment: { route: '/scenes', subview: 'segment', ...AUTH },
  'segment-canvas': { route: '/scenes', subview: 'segment-canvas', ...AUTH },
  'action-preview': { route: '/scenes', subview: 'action-preview', ...AUTH },

  // --- Scripts ---
  scripts: { route: '/scripts', ...AUTH },

  // --- Billing / perfil ---
  profile: { route: '/profile', ...AUTH },
  pricing: { route: '/prices', ...AUTH },
  privacy: { route: '/profile', subview: 'privacy', ...AUTH },
  terms: { route: '/profile', subview: 'terms', ...AUTH },

  // --- Diversos ---
  error: { route: '/home', subview: 'error', ...AUTH },
};

/** Resolve uma tela; default conservador = /home autenticado. */
export function resolveScreen(screen: string | null): ScreenSpec {
  if (screen && SCREEN_MAP[screen]) return SCREEN_MAP[screen];
  return { route: '/home', requiresAuth: true };
}
