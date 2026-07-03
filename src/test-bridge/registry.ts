// Registro de hooks da ponte de teste (renderer). Cada módulo de feature contribui
// seus hooks de teste via registerTestHook; install.ts monta window.__TEST__ a partir
// daqui. Inerte fora do modo teste — em produção/web nada disto é exposto (install.ts
// faz early-return e o proxy nunca é montado).
//
// Por que um registro em vez de um arquivo único: cada hook de feature precisa de um
// seam DENTRO do seu módulo dono (relógio controlável, safeApiCall, WS de personagens,
// pipeline de IA, billing). O módulo dono importa este registro e expõe seu seam sem
// que a ponte precise conhecer os internals da feature. Ver src/test-bridge/README.md.

export type TestHook = (...args: any[]) => any;

const hooks: Record<string, TestHook> = {};

/** Registra (ou substitui) um hook de teste pelo nome que os parity specs chamam. */
export function registerTestHook(name: string, fn: TestHook): void {
  hooks[name] = fn;
}

/** Snapshot vivo dos hooks registrados (lido pelo proxy de window.__TEST__). */
export function getRegisteredHooks(): Record<string, TestHook> {
  return hooks;
}

/** True quando o shell expôs a ponte de teste (ELECTRON_IS_TEST=1 no preload). */
export function isTestMode(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TEST_SHELL__;
}
