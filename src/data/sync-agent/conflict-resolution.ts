// Conflict resolution (AD-02): last-write-wins explícito, com PROMPT ao usuário em
// divergências grandes (>500 chars de diff OU >1h de gap). Snapshot pré-resolução
// permite undo (RISK-003). Decisão pura + orquestração (com repos injetados).

export type ConflictWinner = 'local' | 'remote';

export interface ConflictResolution {
  winner: ConflictWinner;
  /** Se true, a UI deve prompar o usuário antes de aplicar (divergência grande). */
  requiresPrompt: boolean;
  reason: string;
}

export const LARGE_DIVERGENCE_CHARS = 500;
export const LARGE_DIVERGENCE_GAP_MS = 60 * 60 * 1000; // 1h

/** Heurística de "divergência grande" (AD-02). */
export function isLargeDivergence(
  localUpdatedAt: string,
  remoteUpdatedAt: string,
  localContent: string,
  remoteContent: string,
): boolean {
  const gap = Math.abs((Date.parse(localUpdatedAt) || 0) - (Date.parse(remoteUpdatedAt) || 0));
  if (gap > LARGE_DIVERGENCE_GAP_MS) return true;
  return Math.abs(localContent.length - remoteContent.length) > LARGE_DIVERGENCE_CHARS;
}

/** Last-write-wins por updated_at. */
export function lastWriteWins(localUpdatedAt: string, remoteUpdatedAt: string): ConflictWinner {
  const l = Date.parse(localUpdatedAt) || 0;
  const r = Date.parse(remoteUpdatedAt) || 0;
  return r > l ? 'remote' : 'local';
}

/**
 * Decide a resolução de um conflito. Em divergência grande, marca requiresPrompt
 * (a UI mostra o diff e o usuário escolhe — AD-02); senão aplica LWW silencioso.
 */
export function decideConflict(args: {
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localContent: string;
  remoteContent: string;
}): ConflictResolution {
  const { localUpdatedAt, remoteUpdatedAt, localContent, remoteContent } = args;
  const large = isLargeDivergence(localUpdatedAt, remoteUpdatedAt, localContent, remoteContent);
  const winner = lastWriteWins(localUpdatedAt, remoteUpdatedAt);
  return {
    winner,
    requiresPrompt: large,
    reason: large ? 'large_divergence' : 'last_write_wins',
  };
}
