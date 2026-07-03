// LEGADO (wire shape) — preservado para a web SPA. `contest_submitted` é deprecated
// e IGNORADO no desktop (community out of scope — BR-DESCARTAR-001).
export interface User {
    cap?: number;
    subscription?: string;
    privacy?: boolean;
    sign_up_date?: string;
    // Mapa { [storyId]: storyData } — o runtime sempre usa Object.keys/entries
    // (nunca como array). O legado tipava como Array por engano; corrigido p/ que
    // o local-first (worksFromLocal) atribua sem cast.
    works?: Record<string, any>;
    contest_submitted?: boolean;
  }

// ===========================================================================
// CANÔNICO (AGG-User) — Fonte: target_domain_model.md (AGG-User, AGG-Subscription).
// ===========================================================================

/** MFA dormente (DEC-007): lido de Cognito attributes, sem UI no desktop. */
export type MfaConfigured = 'OPTIONAL' | 'OFF';

export interface CanonicalUser {
  /** Cognito sub. */
  userId: string;
  /** Email é o username Cognito (BR-MIGRAR-001). */
  email: string;
  preferred_username?: string;
  /** Token balance (BR-MIGRAR-044) — atualizado a cada response AI que traz cap. */
  cap: number;
  /** Free-form string; `'member'` é o único valor especial (BR-MIGRAR-031). */
  subscription: string | null;
  /** Fetched mas não wired (DEC-008 — Privacy dialog literal). */
  privacy: boolean | null;
  mfaConfigured: MfaConfigured;
  /** Hard-coded 5 (DEC-009 / BR-MIGRAR-009) — não buscado do backend. */
  storyLimit: number;
}

/** Limite de stories por user (DEC-009). Espelha STORIES_LIMIT de story.ts. */
export const STORY_LIMIT = 5;

/** Valor especial de subscription que destrava features member-gated. */
export const MEMBER_SUBSCRIPTION = 'member';

/** Gating (BR-MIGRAR-031 / R-PAY-2): só `'member'` é checado. */
export function isMember(subscription: string | null | undefined): boolean {
  return subscription === MEMBER_SUBSCRIPTION;
}

// --- Value Object: TokenCap (inteiro ≥ 0, update atômico — BR-MIGRAR-044) ----

export function normalizeCap(cap: unknown): number {
  const n = Math.trunc(Number(cap));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface CapDelta {
  oldCap: number;
  newCap: number;
  delta: number;
}

/** Calcula o delta para a overlay +N/-N do header (BR-MIGRAR-030). */
export function capDelta(oldCap: number, newCap: number): CapDelta {
  const o = normalizeCap(oldCap);
  const n = normalizeCap(newCap);
  return { oldCap: o, newCap: n, delta: n - o };
}

// --- Value Object: ConfirmationCode (6 dígitos numéricos — BR-MIGRAR-004) ----

export const CONFIRMATION_CODE_REGEX = /^\d{6}$/;

export function isValidConfirmationCode(code: string): boolean {
  return CONFIRMATION_CODE_REGEX.test(code);
}
