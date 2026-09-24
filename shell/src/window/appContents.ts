// Qual webContents é o RENDERER do app numa janela. Com a moldura custom
// (window/chrome.ts) o webContents da própria BrowserWindow desenha só a faixa de
// título e o app vive numa WebContentsView — quem fala com o renderer resolve aqui.
import { BrowserWindow, WebContents } from 'electron';

const appContents = new WeakMap<BrowserWindow, WebContents>();

export function setAppContents(win: BrowserWindow, wc: WebContents): void {
  appContents.set(win, wc);
}

/** O webContents do app nesta janela (o da própria janela quando não há moldura custom). */
export function appContentsOf(win: BrowserWindow): WebContents {
  return appContents.get(win) ?? win.webContents;
}
