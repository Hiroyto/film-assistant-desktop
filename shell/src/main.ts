// Electron main process — boot do shell desktop (BC-09 Platform Shell).
// Framework: Electron (ADR-001 accepted — ver target_architecture.md §AD-06).
//
// Inicializa e conecta: IPC bridge, deep links (filmassistant://), OS lifecycle
// (resume/before-quit — AD-03), auto-update (AD-09). A camada de dados (SQLite via
// IPC db:query) é plugada na Tarefa 07; as telas novas do shell, na Tarefa 15.

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { IPC } from './ipc/channels';
import { registerIpcHandlers, sendToRenderer } from './ipc/bridge';
import { registerDeepLinkProtocol, setDeepLinkHandler, emitDeepLinkFromArgv } from './deep-links/protocol';
import { registerOsLifecycle } from './lifecycle/osLifecycle';
import { registerAutoUpdate } from './updater/autoUpdate';
import { registerDbHandlers } from './db/dbHandlers';
import { closeDb } from './db/database';
import { buildAppMenu } from './menu/appMenu';
import { registerTestBridge } from './test/testBridge';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1c', // bgdark1 (tailwind.config.js)
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // permite o preload usar ipcRenderer/Node
    },
  });

  // Renderer = SPA React (mesmo codebase, build CRA). AD-07: codebase único.
  if (isDev) {
    const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
    void mainWindow.loadURL(startUrl);
    // Sob a suíte de paridade (ELECTRON_IS_TEST=1) NÃO abrimos o DevTools destacado:
    // ele viraria uma segunda janela e poderia ser retornado por _electron.firstWindow().
    if (process.env.ELECTRON_IS_TEST !== '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'build', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Conecta os eventos do shell ao renderer da janela atual. */
function wireShellToRenderer(): void {
  // Deep links (Stripe/Cognito callbacks). Buffer interno cobre cold-start.
  setDeepLinkHandler((payload) => sendToRenderer(mainWindow, IPC.DEEP_LINK, payload));
  // OS lifecycle (resume/before-quit) — AD-03 / Implicação 5.
  registerOsLifecycle((event) => sendToRenderer(mainWindow, IPC.OS_EVENT, { event }));
  // Auto-update (AD-09).
  registerAutoUpdate((info) => sendToRenderer(mainWindow, IPC.UPDATE, info));
}

// Single-instance lock: deep links no Windows chegam como argv para a 2ª instância,
// que devem ser encaminhados para a instância viva.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    emitDeepLinkFromArgv(argv); // Windows: deep link veio no argv
  });

  void app.whenReady().then(() => {
    registerDbHandlers(); // abre SQLite + roda migrations + registra db:query/db:batch
    registerIpcHandlers();
    registerDeepLinkProtocol();
    createWindow();
    buildAppMenu(() => mainWindow, { isDev }); // SCR-0027 menu nativo
    registerTestBridge(() => mainWindow); // no-op fora de ELECTRON_IS_TEST=1
    wireShellToRenderer();
    emitDeepLinkFromArgv(process.argv); // Windows cold-start com deep link

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => closeDb());
}
