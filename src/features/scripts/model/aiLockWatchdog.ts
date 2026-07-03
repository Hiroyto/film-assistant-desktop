// AI editor lock watchdog (COD-004 / BR-MIGRAR-051 / FIL-315). O editor é travado
// durante uma call de AI; se o caminho de unlock for perdido (erro não tratado),
// o usuário fica preso. O watchdog força o unlock após 120s + grace, evitando o
// stuck state. O hook legado `useInlineAI` adota este watchdog SEM mudar o editor.
import { clock, TimerHandle } from '../../../lib/clock';

export const AI_LOCK_TIMEOUT_MS = 120_000; // 120s (R-AI-8 / R-SCN-7)
export const AI_LOCK_GRACE_MS = 5_000; // grace antes de forçar unlock
export const AI_LOCK_TOTAL_MS = AI_LOCK_TIMEOUT_MS + AI_LOCK_GRACE_MS;

export interface AiLockWatchdog {
  /** Inicia o watchdog ao travar o editor (op = nome da operação p/ telemetria). */
  start: (op?: string) => void;
  /** Limpa ao concluir (success/error) — caminho normal de unlock. */
  clear: () => void;
  /** Está ativo? */
  isActive: () => boolean;
}

/**
 * Cria um watchdog. `onTimeout(op)` é chamado se o lock não for limpo a tempo —
 * deve forçar o unlock do editor e emitir screenplay.ai.failed (stuck recovery).
 */
export function createAiLockWatchdog(onTimeout: (op?: string) => void): AiLockWatchdog {
  let timer: TimerHandle | null = null;
  let currentOp: string | undefined;

  const clear = () => {
    if (timer) {
      clock.clearTimeout(timer);
      timer = null;
    }
    currentOp = undefined;
  };

  return {
    start: (op?: string) => {
      clear(); // reinicia se já havia um lock
      currentOp = op;
      timer = clock.setTimeout(() => {
        timer = null;
        const op2 = currentOp;
        currentOp = undefined;
        onTimeout(op2);
      }, AI_LOCK_TOTAL_MS);
    },
    clear,
    isActive: () => timer !== null,
  };
}
