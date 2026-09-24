// Electron main process — boot do shell desktop (BC-09 Platform Shell).
// Framework: Electron (ADR-001 accepted — ver target_architecture.md §AD-06).
//
// Inicializa e conecta: IPC bridge, deep links (filmassistant://), OS lifecycle
// (resume/before-quit — AD-03), auto-update (AD-09). A camada de dados (SQLite via
// IPC db:query) é plugada na Tarefa 07; as telas novas do shell, na Tarefa 15.

import { app, BrowserWindow, session, WebContents, WebPreferences } from 'electron';
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
import { registerFdx } from './fdx/watcher';
import { openExternal } from './platform/external';
import { CUSTOM_CHROME, DEFAULT_CHROME_COLOR, STRIP_WEB_PREFERENCES, chromeWindowOptions, mountCustomChrome } from './window/chrome';
import { appContentsOf } from './window/appContents';

const isDev = !app.isPackaged;

// Segurança: a ponte de teste (ELECTRON_IS_TEST=1) jamais pode ser ativada num app
// empacotado. O main já ignora a flag quando isPackaged (test/testState.ts); aqui
// removemos a variável do ambiente para que o preload dos renderers (que herdam o
// env deste processo) também não a veja.
if (app.isPackaged) delete process.env.ELECTRON_IS_TEST;

let mainWindow: BrowserWindow | null = null;

/** URL de boot do renderer: dev server/static server em dev, build/index.html empacotado. */
const RENDERER_START_URL = isDev ? process.env.ELECTRON_START_URL || 'http://localhost:3000' : null;

/**
 * Só o renderer do próprio app pode ficar na janela principal: em dev, a origem do
 * ELECTRON_START_URL; empacotado, arquivos locais (file://). Qualquer outra URL é
 * navegação para conteúdo remoto — que herdaria o preload (window.electronAPI) e,
 * com ele, acesso ao SQLite local. Bloqueamos e mandamos para o browser do OS.
 */
function isAllowedRendererUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'about:' || u.protocol === 'devtools:') return true;
  if (RENDERER_START_URL) return u.origin === new URL(RENDERER_START_URL).origin;
  return u.protocol === 'file:';
}

/** Guardas de navegação do renderer do app (Electron security checklist #13/#14). */
function hardenWebContents(wc: WebContents): void {
  wc.on('will-navigate', (event, url) => {
    if (isAllowedRendererUrl(url)) return;
    event.preventDefault();
    console.warn('[security] navegação bloqueada para', url);
    void openExternal(url);
  });
  // Novas janelas (window.open / target=_blank) nunca são criadas dentro do app:
  // http(s) vai para o browser externo; o resto é descartado.
  wc.setWindowOpenHandler(({ url }) => {
    console.warn('[security] window.open bloqueado para', url);
    void openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  // Sem pedidos de permissão (câmera, mic, notificações, …) — o app não usa nenhum.
  wc.session.setPermissionRequestHandler((_wc, permission, callback) => {
    console.warn('[security] permissão negada:', permission);
    callback(false);
  });
}

// CORS bypass para a API Gateway AWS. O renderer roda numa origem que o backend
// não libera (dev: http://localhost:3000; empacotado: file:// → Origin null), e
// a integração /works é non-proxy sem ACAO na resposta real — então todo POST de
// sync falhava CORS e a fila nunca drenava (app "offline"). Aqui, no processo
// main, injetamos os headers de CORS APENAS nas respostas do host da API Gateway
// (escopo mínimo), o que também cobre o preflight OPTIONS. Auth é por header
// Authorization (sem cookies), então ACAO '*' é seguro (sem Allow-Credentials).
const AWS_API_HOST = /\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/i;

function installApiCorsBypass(): void {
  const ses = session.defaultSession;
  // Log de boot — confirma no terminal do desktop:start que o main NOVO carregou.
  console.log('[cors-bypass] ativo para *.execute-api.*.amazonaws.com');
  ses.webRequest.onHeadersReceived((details, callback) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch {
      /* url inválida — não mexe */
    }
    // Só requisições vindas da janela principal (o renderer do app) recebem o bypass.
    const fromMainWindow =
      !!mainWindow && !mainWindow.isDestroyed() && details.webContentsId === appContentsOf(mainWindow).id;
    if (!AWS_API_HOST.test(host) || !fromMainWindow) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...(details.responseHeaders ?? {}) };
    // Remove variantes existentes (case-insensitive) pra não duplicar o header.
    for (const key of Object.keys(headers)) {
      if (/^access-control-allow-(origin|headers|methods)$/i.test(key)) delete headers[key];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['Authorization, Content-Type, X-Request-Id, *'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    callback({ responseHeaders: headers });
  });
}

function createWindow(): void {
  const appWebPreferences: WebPreferences = {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false, // permite o preload usar ipcRenderer/Node
  };
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: DEFAULT_CHROME_COLOR,
    // Ícone da janela/taskbar. Em dev vem de public/; empacotado, do build/
    // (CRA copia public/icon.png -> build/icon.png). No macOS o dock usa o .icns
    // do packagerConfig, então isto é sobretudo para Windows/Linux.
    icon: isDev
      ? path.join(__dirname, '..', '..', 'public', 'icon.png')
      : path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    ...chromeWindowOptions(),
    // Com a moldura custom a janela só desenha a faixa de título: o preload (e, com
    // ele, o acesso ao SQLite) vai apenas para o webContents do app.
    webPreferences: CUSTOM_CHROME ? STRIP_WEB_PREFERENCES : appWebPreferences,
  });

  const appWc = CUSTOM_CHROME ? mountCustomChrome(mainWindow, appWebPreferences) : mainWindow.webContents;
  hardenWebContents(appWc);

  // Renderer = SPA React (mesmo codebase, build CRA). AD-07: codebase único.
  if (RENDERER_START_URL) {
    void appWc.loadURL(RENDERER_START_URL);
    // Sob a suíte de paridade (ELECTRON_IS_TEST=1) NÃO abrimos o DevTools destacado:
    // ele viraria uma segunda janela e poderia ser retornado por _electron.firstWindow().
    if (process.env.ELECTRON_IS_TEST !== '1') appWc.openDevTools({ mode: 'detach' });
  } else {
    void appWc.loadFile(path.join(__dirname, '..', '..', 'build', 'index.html'));
  }

  if (CUSTOM_CHROME) {
    // O 'ready-to-show' da janela seria o paint da faixa (instantâneo): espera o app.
    const show = (): void => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    };
    appWc.once('dom-ready', show);
    appWc.once('did-fail-load', show);
    setTimeout(show, 5000); // nunca deixar a janela invisível
  } else {
    mainWindow.once('ready-to-show', () => mainWindow?.show());
  }
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
    installApiCorsBypass(); // headers de CORS p/ a API Gateway (antes de carregar a janela)
    createWindow();
    buildAppMenu(() => mainWindow, { isDev }); // SCR-0027 menu nativo
    registerTestBridge(() => mainWindow); // no-op fora de ELECTRON_IS_TEST=1
    registerFdx(() => mainWindow); // protótipo coworking .fdx (só leitura)
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
