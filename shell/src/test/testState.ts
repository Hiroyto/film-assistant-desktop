// Estado e contrato de canais da ponte de teste (TestBridge) — só ativa sob
// ELECTRON_IS_TEST=1. NÃO importa nada de electron-main: é seguro tanto no main
// quanto no preload (sandbox:false). Os canais espelham os métodos que os parity
// specs acionam em window.__TEST__ (parity/specs/*.spec.ts são o contrato).

/** True quando o app roda em modo de teste de paridade (fixtures setam o env). */
export const IS_TEST = process.env.ELECTRON_IS_TEST === '1';

/** Canais IPC test-only (renderer -> main). Registrados só quando IS_TEST. */
export const TEST_IPC = {
  EMIT_OS: 'test:emitOs',
  EMIT_DEEP_LINK: 'test:emitDeepLink',
  EMIT_UPDATE: 'test:emitUpdate',
  INSTALL_REQUESTED: 'test:installRequested',
  MENU_STRUCTURE: 'test:menuStructure',
  MENU_ITEM_ENABLED: 'test:menuItemEnabled',
  CLICK_MENU: 'test:clickMenu',
  CLICK_MENU_LABEL: 'test:clickMenuLabel',
  LAST_OPEN_EXTERNAL: 'test:lastOpenExternal',
} as const;

let lastExternal: string | null = null;

/** Registra a última URL aberta externamente (Stripe AD-04 / menu) — só em teste. */
export function recordExternal(url: string): void {
  if (IS_TEST) lastExternal = url;
}

/** Última URL passada a openExternal — observada por window.__TEST__.lastOpenExternal(). */
export function getLastExternal(): string | null {
  return lastExternal;
}

// Instalação de update (SCR-0029 "Restart Now") — em teste NÃO chamamos
// quitAndInstall (mataria o app); apenas registramos a intenção p/ o spec observar.
let installRequested = false;

export function recordInstallRequested(): void {
  if (IS_TEST) installRequested = true;
}

export function getInstallRequested(): boolean {
  return installRequested;
}
