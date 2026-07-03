// Tipagem ambiente da borda desktop (AD-07). Permite ao renderer detectar o shell:
//   if (window.electronAPI) { /* desktop */ } else { /* web */ }
// A superfície cresce nas Tarefas 06/07 (IPC: db.query, fs, deep-link, os.resumed...).

export {};

declare global {
  /** Payload de um deep link filmassistant:// recebido (emitido pelo shell — Tarefa 06). */
  interface DeepLinkPayload {
    scheme: string;
    host: string;
    path: string;
    query: Record<string, string>;
  }

  interface ElectronAPI {
    readonly isDesktop: true;
    readonly platform: NodeJS.Platform | string;

    // --- Superfície adicionada na Tarefa 06 (shell/ipc, deep-links) — opcional aqui. ---
    /** Abre uma URL no browser externo do OS (shell.openExternal). */
    openExternal?: (url: string) => Promise<void> | void;
    /** Query SQL parametrizada no SQLite local (BC-08). */
    dbQuery?: (req: { sql: string; params?: unknown[]; mode: 'run' | 'all' | 'get' }) => Promise<any>;
    /** Batch transacional de statements (BC-08). */
    dbBatch?: (req: { ops: { sql: string; params?: unknown[] }[] }) => Promise<any>;
    /** Inscreve um handler para deep links filmassistant://. Retorna unsubscribe. */
    onDeepLink?: (handler: (payload: DeepLinkPayload) => void) => () => void;
    /** Inscreve handler de eventos OS lifecycle (resume/before-quit/online/offline). Retorna unsubscribe. */
    onOsEvent?: (event: 'resumed' | 'before-quit' | 'online' | 'offline', handler: () => void) => () => void;
    /** Inscreve handler de eventos de auto-update (AD-09). Retorna unsubscribe. */
    onUpdate?: (handler: (info: { type: 'available' | 'downloaded'; version?: string }) => void) => () => void;
    /** Inscreve handler de itens do menu nativo (SCR-0027). Retorna unsubscribe. */
    onMenu?: (handler: (event: string) => void) => () => void;
    /** Relaunch para instalar o update baixado (SCR-0029). */
    installUpdate?: () => Promise<void>;
  }

  /**
   * Capacidades do main expostas pelo preload SOMENTE sob ELECTRON_IS_TEST=1.
   * Espelho de shell/src/test/testBridge.ts. Sua presença sinaliza "modo teste".
   */
  interface TestShell {
    emitOs: (event: string) => Promise<void>;
    emitDeepLink: (url: string) => Promise<boolean>;
    emitUpdate: (type: string, version?: string) => Promise<void>;
    installRequested: () => Promise<boolean>;
    menuStructure: () => Promise<any[]>;
    menuItemEnabled: (id: string) => Promise<boolean | null>;
    clickMenu: (event: string) => Promise<void>;
    clickMenuLabel: (label: string) => Promise<boolean>;
    lastOpenExternal: () => Promise<string | null>;
  }

  interface Window {
    /** Presente apenas quando a SPA roda dentro do shell Electron. */
    electronAPI?: ElectronAPI;
    /** Ponte de teste do shell — só em builds de paridade (ELECTRON_IS_TEST=1). */
    __TEST_SHELL__?: TestShell;
    /** Superfície que os parity specs consomem — montada por test-bridge/install.ts. */
    __TEST__?: Record<string, (...args: any[]) => any>;
  }
}
