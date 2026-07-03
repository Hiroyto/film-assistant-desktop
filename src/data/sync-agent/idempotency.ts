// Idempotência e política de retry/backoff do push (data_migration_plan.md §Ongoing push, §Idempotência).
//
// Funções puras. Usadas pelo push-worker (push-queue.ts — Tarefa 07). O request_id
// UUID acompanha cada mutation no body; o backend reconhece duplicates e retorna
// sucesso sem re-processar (COD-008 — verificar/implementar no backend).

/** Gera um request_id UUID para uma mutation (idempotência server-side). */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (ambientes sem WebCrypto). Não é UUID v4 estrito, mas único o bastante.
  return `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

/** Backoff por tentativa (segundos): 1, 2, 4, 8, 16, 30 (cap). */
export const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const;

/** Após este nº de tentativas, a entry vira status 'failed' (não bloqueia a fila). */
export const MAX_ATTEMPTS = 6;

/** Retorna o delay (ms) antes da próxima tentativa, dado o nº de tentativas já feitas. */
export function backoffMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx] * 1000;
}

/** Calcula o ISO-8601 de next_attempt_at a partir de `from` (default agora). */
export function nextAttemptAt(attempts: number, from: number = Date.now()): string {
  return new Date(from + backoffMs(attempts)).toISOString();
}

/** Se a mutation deve desistir (virar 'failed') após esta tentativa. */
export function shouldGiveUp(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/** Watchdog do character refresh assíncrono (BR-MIGRAR-022 / AD-05): 5 minutos. */
export const CHARACTER_REFRESH_TIMEOUT_MS = 5 * 60 * 1000;
