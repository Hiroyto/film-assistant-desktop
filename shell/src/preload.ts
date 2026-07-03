// Preload — ponte segura main <-> renderer via contextBridge (BC-09 / borda AD-07).
//
// Expõe `window.electronAPI`. A tipagem está em src/electron.d.ts (renderer).
// IPC de dados (db.query) é adicionado na Tarefa 07.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC, DeepLinkPayload, OsEvent, UpdatePayload, MenuEvent } from './ipc/channels';
import { IS_TEST, TEST_IPC } from './test/testState';

/** Helper: inscreve em um canal e retorna unsubscribe. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  /** Marcador de runtime: renderer roda dentro do shell desktop. */
  isDesktop: true as const,
  platform: process.platform,

  /** Abre URL no browser externo (Stripe deep link AD-04). */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

  /** Query SQL parametrizada no SQLite local (BC-08). mode: run|all|get. */
  dbQuery: (req: { sql: string; params?: unknown[]; mode: 'run' | 'all' | 'get' }): Promise<unknown> =>
    ipcRenderer.invoke(IPC.DB_QUERY, req),

  /** Batch transacional de statements (BC-08). */
  dbBatch: (req: { ops: { sql: string; params?: unknown[] }[] }): Promise<unknown> =>
    ipcRenderer.invoke(IPC.DB_BATCH, req),

  /** Deep links filmassistant:// (Stripe success/cancel, Cognito). */
  onDeepLink: (handler: (payload: DeepLinkPayload) => void): (() => void) =>
    subscribe<DeepLinkPayload>(IPC.DEEP_LINK, handler),

  /** Eventos OS lifecycle (resume/before-quit) — AD-03. */
  onOsEvent: (event: OsEvent, handler: () => void): (() => void) =>
    subscribe<{ event: OsEvent }>(IPC.OS_EVENT, (payload) => {
      if (payload.event === event) handler();
    }),

  /** Eventos de auto-update (AD-09). */
  onUpdate: (handler: (info: UpdatePayload) => void): (() => void) =>
    subscribe<UpdatePayload>(IPC.UPDATE, handler),

  /** Itens do menu nativo acionados (SCR-0027). */
  onMenu: (handler: (event: MenuEvent) => void): (() => void) =>
    subscribe<{ event: MenuEvent }>(IPC.MENU, (payload) => handler(payload.event)),

  /** Relaunch para instalar o update baixado (SCR-0029). */
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;

// --- Ponte de teste (SOMENTE sob ELECTRON_IS_TEST=1) -------------------------
// Expõe as capacidades do main que os parity specs precisam acionar a partir do
// renderer (window.__TEST__ é montado no renderer a partir disto). Ausente em
// produção: o renderer detecta o modo teste pela presença de window.__TEST_SHELL__.
if (IS_TEST) {
  const testShell = {
    emitOs: (event: string): Promise<void> => ipcRenderer.invoke(TEST_IPC.EMIT_OS, event),
    emitDeepLink: (url: string): Promise<boolean> => ipcRenderer.invoke(TEST_IPC.EMIT_DEEP_LINK, url),
    emitUpdate: (type: string, version?: string): Promise<void> =>
      ipcRenderer.invoke(TEST_IPC.EMIT_UPDATE, { type, version }),
    installRequested: (): Promise<boolean> => ipcRenderer.invoke(TEST_IPC.INSTALL_REQUESTED),
    menuStructure: (): Promise<unknown[]> => ipcRenderer.invoke(TEST_IPC.MENU_STRUCTURE),
    menuItemEnabled: (id: string): Promise<boolean | null> => ipcRenderer.invoke(TEST_IPC.MENU_ITEM_ENABLED, id),
    clickMenu: (event: string): Promise<void> => ipcRenderer.invoke(TEST_IPC.CLICK_MENU, event),
    clickMenuLabel: (label: string): Promise<boolean> => ipcRenderer.invoke(TEST_IPC.CLICK_MENU_LABEL, label),
    lastOpenExternal: (): Promise<string | null> => ipcRenderer.invoke(TEST_IPC.LAST_OPEN_EXTERNAL),
  };
  contextBridge.exposeInMainWorld('__TEST_SHELL__', testShell);
}
