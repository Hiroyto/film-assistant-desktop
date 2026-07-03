// Resend code throttle 60s (BR-MIGRAR-005). No desktop persiste `lastResendCodeAt`
// em SQLite (settings) para que o cooldown NÃO seja esquecido durante OS sleep —
// recalculado ao acordar. Na web, fallback em memória (comportamento legado).
import { isDesktop } from '../../../lib/ipcClient';
import { getSetting, setSetting } from '../../../data/local-db/repositories/settingsRepo';

export const RESEND_COOLDOWN_MS = 60_000;
const SETTING_KEY = 'lastResendCodeAt';

let memoryLastResendAt: number | null = null; // fallback web

/** Cálculo puro do estado do cooldown. */
export function cooldownState(lastResendAt: number | null, now: number): { allowed: boolean; remainingMs: number } {
  if (lastResendAt == null) return { allowed: true, remainingMs: 0 };
  const elapsed = now - lastResendAt;
  const remaining = RESEND_COOLDOWN_MS - elapsed;
  return remaining <= 0 ? { allowed: true, remainingMs: 0 } : { allowed: false, remainingMs: remaining };
}

async function readLastResendAt(): Promise<number | null> {
  if (isDesktop()) {
    return (await getSetting<number>(SETTING_KEY)) ?? null;
  }
  return memoryLastResendAt;
}

/** Pode reenviar o código agora? (persistente entre sleeps no desktop). */
export async function canResend(now: number = Date.now()): Promise<{ allowed: boolean; remainingMs: number }> {
  return cooldownState(await readLastResendAt(), now);
}

/** Registra que o código foi reenviado agora (inicia o cooldown). */
export async function recordResend(now: number = Date.now()): Promise<void> {
  if (isDesktop()) {
    await setSetting(SETTING_KEY, now, new Date(now).toISOString());
  } else {
    memoryLastResendAt = now;
  }
}
