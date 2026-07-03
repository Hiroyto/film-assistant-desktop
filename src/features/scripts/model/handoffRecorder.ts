// Recorder do conversation_history dos 3 handoffs do pipeline de IA (seam de teste —
// parity specs 04 e 10, BR-MIGRAR-044..051). O pipeline legado (useSceneGeneration)
// grava o histórico em cada handoff; handoffHistories() devolve [h1, h2, h3].
// INERTE em produção: enquanto não armado, record() é no-op (custo ~zero). A ponte
// de teste arma e expõe via registerTestHook.

let armed = false;
let histories: unknown[][] = [[], [], []];

/** Ativa a captura e zera as 3 posições. Chamado só em modo teste. */
export function armHandoffRecorder(): void {
  armed = true;
  histories = [[], [], []];
}

/** Zera o histórico sem desarmar — chamado no início de cada geração de cena. */
export function resetHandoffRecorder(): void {
  histories = [[], [], []];
}

/** Grava o conversation_history do handoff `index` (0=1º, 1=2º, 2=3º). */
export function recordHandoffHistory(index: number, history: unknown[]): void {
  if (!armed || index < 0 || index > 2) return;
  histories[index] = Array.isArray(history) ? [...history] : [];
}

/** [h1, h2, h3] — sempre 3 arrays densos (cópias). */
export function getHandoffHistories(): unknown[][] {
  return histories.map((h) => [...h]);
}
