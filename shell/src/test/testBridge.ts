// Ponte de teste (lado main) — registrada SOMENTE sob ELECTRON_IS_TEST=1.
// Expõe IPC test-only que os parity specs acionam via window.__TEST_SHELL__
// (montado no preload). Reusa exatamente os mesmos eventos main->renderer da
// produção (OS lifecycle, deep links) para que os subscribers do renderer
// disparem idênticos a um cenário real. NUNCA registrado em produção.
import { ipcMain, Menu, MenuItem, BrowserWindow } from 'electron';
import { IPC, parseDeepLink, MenuEvent } from '../ipc/channels';
import { sendToRenderer } from '../ipc/bridge';
import { IS_TEST, TEST_IPC, getLastExternal, getInstallRequested } from './testState';
import type { UpdatePayload } from '../ipc/channels';

interface SerializedMenuItem {
  label: string;
  id: string | null;
  enabled: boolean;
  role?: string;
  accelerator?: string;
  type: string;
  /** Labels dos itens do submenu (contrato do spec 12: menu.find(m).items). */
  items?: string[];
  submenu?: SerializedMenuItem[];
}

/** Serializa o menu nativo numa árvore inspecionável pelo spec (menuStructure). */
function serializeMenu(items: MenuItem[]): SerializedMenuItem[] {
  return items.map((it) => ({
    label: it.label,
    id: it.id ?? null,
    enabled: it.enabled,
    role: it.role,
    accelerator: it.accelerator,
    type: it.type,
    // `items` = labels rasos do submenu (spec 12 asserta arrayContaining de strings);
    // `submenu` = árvore completa (introspecção detalhada). Ambos derivam da mesma fonte.
    items: it.submenu ? it.submenu.items.map((s) => s.label).filter(Boolean) : undefined,
    submenu: it.submenu ? serializeMenu(it.submenu.items) : undefined,
  }));
}

/** Busca recursiva de um item de menu pelo label visível (clickMenuLabel). */
function findByLabel(items: MenuItem[], label: string): MenuItem | null {
  for (const it of items) {
    if (it.label === label) return it;
    if (it.submenu) {
      const found = findByLabel(it.submenu.items, label);
      if (found) return found;
    }
  }
  return null;
}

/** Registra os handlers IPC test-only. No-op fora do modo teste. */
export function registerTestBridge(getWindow: () => BrowserWindow | null): void {
  if (!IS_TEST) return;
  console.warn('[testBridge] ELECTRON_IS_TEST=1 — ponte de teste ATIVA (jamais usar em produção)');

  // OS lifecycle: reemite o mesmo push da produção (osLifecycle.ts -> IPC.OS_EVENT).
  ipcMain.handle(TEST_IPC.EMIT_OS, (_e, event: string) => {
    sendToRenderer(getWindow(), IPC.OS_EVENT, { event });
  });

  // Deep link: parseia e reemite igual ao protocol.ts -> IPC.DEEP_LINK.
  ipcMain.handle(TEST_IPC.EMIT_DEEP_LINK, (_e, url: string) => {
    const payload = parseDeepLink(url);
    if (payload) sendToRenderer(getWindow(), IPC.DEEP_LINK, payload);
    return !!payload;
  });

  // Auto-update (SCR-0029): reemite o mesmo push da produção (autoUpdate.ts -> IPC.UPDATE).
  ipcMain.handle(TEST_IPC.EMIT_UPDATE, (_e, payload: UpdatePayload) => {
    sendToRenderer(getWindow(), IPC.UPDATE, payload);
  });

  // Intenção de instalar o update (Restart Now) — registrada pelo handler de UPDATE_INSTALL.
  ipcMain.handle(TEST_IPC.INSTALL_REQUESTED, () => getInstallRequested());

  // Introspecção do menu nativo (paridade de contrato — spec 12).
  ipcMain.handle(TEST_IPC.MENU_STRUCTURE, () => {
    const menu = Menu.getApplicationMenu();
    return menu ? serializeMenu(menu.items) : [];
  });

  ipcMain.handle(TEST_IPC.MENU_ITEM_ENABLED, (_e, id: string) => {
    return Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? null;
  });

  // Aciona um item que emite MenuEvent ao renderer (equivale ao clique do usuário).
  ipcMain.handle(TEST_IPC.CLICK_MENU, (_e, event: MenuEvent) => {
    sendToRenderer(getWindow(), IPC.MENU, { event });
  });

  // Aciona um item pelo label (ex: 'Open GitHub' -> openExternal, registrado).
  ipcMain.handle(TEST_IPC.CLICK_MENU_LABEL, (_e, label: string) => {
    const menu = Menu.getApplicationMenu();
    const item = menu ? findByLabel(menu.items, label) : null;
    const click = item?.click as undefined | ((...a: unknown[]) => void);
    if (typeof click === 'function') click(item, getWindow() ?? undefined, {});
    return !!item;
  });

  ipcMain.handle(TEST_IPC.LAST_OPEN_EXTERNAL, () => getLastExternal());
}
