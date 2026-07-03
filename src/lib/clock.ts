// Relógio controlável — seam único de temporização do app. Em produção delega aos
// timers/relógio reais; em modo teste (parity) um relógio FAKE permite que
// window.__TEST__.advanceTimers(ms) avance o tempo virtual e dispare os callbacks
// pendentes de forma determinística.
//
// Adotado pelos sites de polling/watchdog que os parity specs exercitam via advanceTimers:
//   • features/scripts/model/aiLockWatchdog.ts    (watchdog AI 120s+grace — spec 04)
//   • features/characters/model/refresh.ts        (watchdog refresh 5min — spec 05)
//   • features/pricing/model/checkoutFlow.ts      (polling Stripe 5s/2min — spec 06)
//   • features/story-workspace/model/storySave.ts (autosave 30min + debounce 10s — spec 07)
// Outros sites de timer (sync/scheduler, auth/session, lib/useWebSocket) podem adotar
// o mesmo `clock` se specs futuros precisarem — ver src/test-bridge/README.md.

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle | null | undefined): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle | null | undefined): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => {
    if (h != null) clearTimeout(h);
  },
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => {
    if (h != null) clearInterval(h);
  },
};

let impl: Clock = realClock;

// Singleton com lookup em tempo de chamada: trocar `impl` afeta chamadas já
// importadas (os módulos guardam a referência `clock`, não os métodos diretos).
export const clock: Clock = {
  now: () => impl.now(),
  setTimeout: (fn, ms) => impl.setTimeout(fn, ms),
  clearTimeout: (h) => impl.clearTimeout(h),
  setInterval: (fn, ms) => impl.setInterval(fn, ms),
  clearInterval: (h) => impl.clearInterval(h),
};

interface FakeTimer {
  id: number;
  fn: () => void;
  dueAt: number;
  intervalMs: number | null; // null = timeout (one-shot)
}

export interface FakeClock extends Clock {
  /** Avança o tempo virtual em `ms`, disparando os callbacks vencidos em ordem. */
  advance(ms: number): void;
  /** Tempo virtual atual (ms). */
  current(): number;
}

const ADVANCE_MAX_STEPS = 100_000; // backstop contra loop de re-agendamento runaway

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  let seq = 1;
  const timers = new Map<number, FakeTimer>();

  return {
    now: () => current,
    current: () => current,
    setTimeout: (fn, ms) => {
      const id = seq++;
      timers.set(id, { id, fn, dueAt: current + Math.max(0, ms), intervalMs: null });
      return id as unknown as TimerHandle;
    },
    clearTimeout: (h) => {
      if (h != null) timers.delete(h as unknown as number);
    },
    setInterval: (fn, ms) => {
      const id = seq++;
      const period = Math.max(1, ms);
      timers.set(id, { id, fn, dueAt: current + period, intervalMs: period });
      return id as unknown as TimerHandle;
    },
    clearInterval: (h) => {
      if (h != null) timers.delete(h as unknown as number);
    },
    advance: (ms) => {
      const target = current + ms;
      // Dispara em ordem cronológica; intervals re-agendam; timers criados dentro de
      // um callback entram no laço se vencerem antes de `target`.
      let steps = 0;
      for (;;) {
        let next: FakeTimer | null = null;
        for (const t of timers.values()) {
          if (
            t.dueAt <= target &&
            (!next || t.dueAt < next.dueAt || (t.dueAt === next.dueAt && t.id < next.id))
          ) {
            next = t;
          }
        }
        if (!next) break;
        if (++steps > ADVANCE_MAX_STEPS) {
          console.error('[fakeClock] advance excedeu o limite de passos — abortando');
          break;
        }
        current = next.dueAt;
        if (next.intervalMs != null) {
          next.dueAt = current + next.intervalMs; // re-agenda o interval
        } else {
          timers.delete(next.id);
        }
        try {
          next.fn();
        } catch (e) {
          console.error('[fakeClock] callback lançou', e);
        }
      }
      current = target;
    },
  };
}

/** Instala o relógio fake como implementação ativa. Retorna a instância. */
export function installFakeClock(start = 0): FakeClock {
  const f = createFakeClock(start);
  impl = f;
  return f;
}

/** Restaura o relógio real (produção). Usado em teardown de testes unit. */
export function resetClock(): void {
  impl = realClock;
}
