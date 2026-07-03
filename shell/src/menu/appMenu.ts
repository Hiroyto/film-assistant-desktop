// Menu nativo do OS (SCR-0027 / BR-MIGRAR-039 / AD-09). Win + macOS. Os itens de
// aplicação emitem eventos IPC ao renderer (story.new, commands.cmdk.open, tour.open,
// etc); os itens de edição usam roles nativos. Cmd+K nativo dá descobribilidade ao
// command palette (resolve a parte "menu nativo" do tech-debt #9).
import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';
import { IPC, MenuEvent } from '../ipc/channels';
import { openExternal } from '../platform/external';

type Emit = (event: MenuEvent) => void;

export function buildAppMenu(getWindow: () => BrowserWindow | null, opts: { isDev: boolean }): void {
  const isMac = process.platform === 'darwin';
  const emit: Emit = (event) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.MENU, { event });
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }] // menu "Film Assistant" padrão macOS (About/Quit)
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Story', accelerator: 'CmdOrCtrl+N', click: () => emit('story.new') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', id: 'menu-save', click: () => emit('story.save') },
        { type: 'separator' },
        { label: 'Settings…', enabled: false }, // future feature
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: () => emit('commands.cmdk.open') },
        { label: 'Show Tour', click: () => emit('tour.open') },
        ...(opts.isDev
          ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Film Assistant', click: () => emit('help.about.open') },
        {
          // Roteado pelo helper (valida http(s) e é observável pela ponte de teste).
          label: 'Open GitHub',
          click: () => void openExternal('https://github.com/'),
        },
        { label: 'Check for Updates…', click: () => emit('updater.check') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Habilita/desabilita o item Save conforme há story ativa (estado no_active_story). */
export function setSaveEnabled(enabled: boolean): void {
  const menu = Menu.getApplicationMenu();
  const item = menu?.getMenuItemById('menu-save');
  if (item) item.enabled = enabled;
  void app; // referenciado para clareza de escopo
}
