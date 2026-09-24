// Moldura custom (Windows + macOS): a barra de título nativa não aceita cor arbitrária
// (nem no Windows 10 nem no macOS), então ela some (titleBarStyle 'hidden') e a janela
// ganha uma faixa própria, na cor do TOPO do app. Sobre ela ficam os controles nativos:
// os botões do Windows (titleBarOverlay, recoloridos junto) e os semáforos do macOS.
//
// O app NÃO é empurrado para baixo da faixa por CSS (headers fixed top:0 e layouts em
// 100vh quebrariam): ele roda numa WebContentsView posicionada abaixo dela, com o
// viewport já sem a faixa. O webContents da própria BrowserWindow desenha só a faixa
// (página data: sem preload, em sandbox) — arrastável e, no Windows, com o botão do
// menu: a barra de menu nativa some junto com a de título (os atalhos continuam).
import {
  app,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Menu,
  WebContents,
  WebContentsView,
  WebPreferences,
} from 'electron';
import { IS_TEST } from '../test/testState';
import { setAppContents } from './appContents';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** Só Windows/macOS. Sob a paridade (ELECTRON_IS_TEST) fica a moldura nativa: o harness
 *  pega a página por firstWindow(), que com a faixa poderia ser a errada. */
export const CUSTOM_CHROME = (isMac || isWin) && !IS_TEST;

/** Altura da faixa = a da barra de título nativa de cada OS. */
const TITLEBAR_H = isMac ? 28 : 32;

export const DEFAULT_CHROME_COLOR = '#1a1a1c'; // bgdark1 (tailwind.config.js)

/** A página da faixa não tem preload nem Node — só desenha e arrasta. */
export const STRIP_WEB_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
};

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

const symbolColorFor = (bg: string): string => (isLight(bg) ? '#1f1f1f' : '#e6e6e6');

/** Opções extras do BrowserWindow para a moldura custom (vazio = moldura nativa). */
export function chromeWindowOptions(): BrowserWindowConstructorOptions {
  if (!CUSTOM_CHROME) return {};
  if (isMac) return { titleBarStyle: 'hidden' };
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: DEFAULT_CHROME_COLOR,
      symbolColor: symbolColorFor(DEFAULT_CHROME_COLOR),
      height: TITLEBAR_H,
    },
  };
}

function stripHtml(): string {
  // Windows: botão do menu à esquerda (os botões da janela ficam à direita, no overlay).
  const menuButton = isWin
    ? '<button id="m" title="Menu" aria-label="Menu"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>'
    : '';
  // Só a faixa (TITLEBAR_H) é região de arrasto — esta página ocupa a janela inteira,
  // por baixo da view do app, e um drag de altura total pegaria cliques do app.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;user-select:none;cursor:default}
#bar{position:absolute;left:0;right:0;top:0;height:${TITLEBAR_H}px;-webkit-app-region:drag}
#m{-webkit-app-region:no-drag;position:absolute;left:6px;top:${(TITLEBAR_H - 26) / 2}px;width:34px;height:26px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--fg,${symbolColorFor(DEFAULT_CHROME_COLOR)});cursor:pointer}
#m:hover{background:var(--hover,rgba(255,255,255,.1))}
</style></head><body><div id="bar">${menuButton}</div><script>
var m = document.getElementById('m');
if (m) m.addEventListener('click', function () { window.open('about:blank#app-menu'); });
</script></body></html>`;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Monta a faixa na janela e cria a WebContentsView do app abaixo dela. Retorna o
 * webContents do app (que recebe preload, guardas de navegação e o carregamento).
 */
export function mountCustomChrome(win: BrowserWindow, appWebPreferences: WebPreferences): WebContents {
  const view = new WebContentsView({ webPreferences: appWebPreferences });
  view.setBackgroundColor(DEFAULT_CHROME_COLOR);
  win.contentView.addChildView(view);
  const appWc = view.webContents;
  setAppContents(win, appWc);

  // ---- Faixa: o webContents da própria janela -------------------------------
  const strip = win.webContents;
  void strip.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(stripHtml())}`);
  strip.on('will-navigate', (e) => e.preventDefault());
  strip.on('will-attach-webview', (e) => e.preventDefault());
  // O teclado é sempre do app: o clique no ≡ focaria a faixa, e os roles de edição do
  // menu (que miram o webContents focado) e a digitação depois dele cairiam nela.
  const focusApp = (): void => {
    if (!appWc.isDestroyed()) appWc.focus();
  };
  strip.on('focus', focusApp);
  strip.setWindowOpenHandler(({ url }) => {
    if (url.endsWith('#app-menu')) {
      focusApp();
      Menu.getApplicationMenu()?.popup({ window: win, x: 6, y: TITLEBAR_H, callback: focusApp });
    }
    return { action: 'deny' };
  });
  // O título da janela (taskbar / Alt+Tab / Dock) segue o do app, não o da faixa.
  strip.on('page-title-updated', (e) => e.preventDefault());
  appWc.on('page-title-updated', (_e, title) => {
    if (!win.isDestroyed()) win.setTitle(title);
  });

  // ---- Layout: o app ocupa tudo abaixo da faixa ----------------------------
  const layout = (): void => {
    if (win.isDestroyed()) return;
    const { width, height } = win.contentView.getBounds();
    // Tela cheia: os controles nativos somem, a faixa também.
    const top = win.isFullScreen() ? 0 : TITLEBAR_H;
    view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    // macOS: sheets (diálogos, file pickers, confirm) descem abaixo da faixa, não do topo.
    if (isMac) win.setSheetOffset(top);
  };
  layout();
  // O content view reporta o tamanho já assentado — o 'resize'/'maximize' da janela
  // chega antes (no 1º maximize o app ficava 2px curto).
  win.contentView.on('bounds-changed', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);

  // A janela ganhar foco devolve o teclado ao app.
  win.on('focus', focusApp);

  // ---- Fechar: passa pelo beforeunload do app --------------------------------
  // Fechar a janela NÃO fecha a view nem roda o beforeunload dela (o flush do roteiro
  // e da Home depende dele). O close passa pelo app primeiro, com a semântica nativa:
  // um beforeunload que cancela (save em voo) mantém a janela aberta.
  let appClosed = false;
  let quitting = false;
  const onBeforeQuit = (): void => {
    quitting = true;
  };
  app.on('before-quit', onBeforeQuit);
  win.on('close', (e) => {
    if (appClosed || appWc.isDestroyed()) return;
    e.preventDefault();
    appWc.close({ waitForBeforeUnload: true });
  });
  appWc.on('will-prevent-unload', () => {
    quitting = false; // o app cancelou: o quit em curso também para, como no nativo
  });
  appWc.once('destroyed', () => {
    appClosed = true;
    if (!win.isDestroyed()) win.close();
    if (quitting) app.quit(); // o preventDefault acima abortou o quit; retoma
  });
  win.once('closed', () => app.removeListener('before-quit', onBeforeQuit));

  // ---- Cor: a faixa acompanha o pixel do topo do app ------------------------
  // Lê o render real (capturePage) em vez do CSS: cobre gradientes, o tema claro do
  // board e backdrops de modal sem cada tela precisar declarar sua cor.
  let current = DEFAULT_CHROME_COLOR;
  const apply = (hex: string): void => {
    if (hex === current || win.isDestroyed()) return;
    current = hex;
    const fg = symbolColorFor(hex);
    win.setBackgroundColor(hex); // a página da faixa é transparente: aparece a cor da janela
    if (isWin) win.setTitleBarOverlay({ color: hex, symbolColor: fg });
    const hover = isLight(hex) ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)';
    void strip
      .executeJavaScript(
        `document.documentElement.style.setProperty('--fg','${fg}');document.documentElement.style.setProperty('--hover','${hover}');`,
      )
      .catch(() => {});
  };
  const sample = async (): Promise<string | null> => {
    if (win.isDestroyed() || appWc.isDestroyed() || win.isMinimized() || !win.isVisible()) return null;
    const img = await appWc.capturePage({ x: 0, y: 0, width: 4, height: 1 });
    if (img.isEmpty()) return null;
    const px = img.toBitmap(); // BGRA
    if (px.length < 4 || px[3] < 255) return null; // ainda não pintou
    return `#${[px[2], px[1], px[0]].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };
  let syncing = false;
  const sync = async (): Promise<void> => {
    if (syncing) return;
    syncing = true;
    try {
      // Duas leituras iguais seguidas: não pinta a faixa com um frame de transição.
      const a = await sample();
      if (!a) return;
      await delay(120);
      if ((await sample()) === a) apply(a);
    } catch {
      /* janela fechando */
    } finally {
      syncing = false;
    }
  };
  const soon = (): void => {
    for (const ms of [60, 400, 1200]) setTimeout(() => void sync(), ms);
  };
  appWc.on('did-finish-load', soon);
  appWc.on('did-navigate-in-page', soon); // rotas do HashRouter
  win.on('focus', soon);
  // Mudanças sem navegação (tema do board, modal abrindo): leitura leve periódica,
  // só com a janela em foco.
  const timer = setInterval(() => {
    if (!win.isDestroyed() && win.isFocused()) void sync();
  }, 1500);
  win.once('closed', () => clearInterval(timer));

  return appWc;
}
