// Recorder da resolução de conflito (seam de instrumentação — parity spec 12 t17).
// O DesktopShell chama recordConflictResolved() ao aplicar uma resolução; o hook
// lastResolved() lê a última. INERTE em produção: enquanto não for armado, record()
// é no-op. A ponte de teste (install.ts) arma e expõe via registerTestHook.

export interface ResolvedConflict {
  entityType: string;
  entityId: string;
  /** Escolha aplicada: 'local' | 'remote' | 'both' (o spec casa /both|manual_merge/). */
  resolution: string;
}

let armed = false;
let last: ResolvedConflict | null = null;

/** Ativa a captura e zera o estado. Chamado só em modo teste. */
export function armConflictRecorder(): void {
  armed = true;
  last = null;
}

/** Registra a resolução aplicada no instante do Apply. */
export function recordConflictResolved(r: ResolvedConflict): void {
  if (armed) last = r;
}

/** Última resolução capturada (ou null). */
export function getLastResolved(): ResolvedConflict | null {
  return last;
}
