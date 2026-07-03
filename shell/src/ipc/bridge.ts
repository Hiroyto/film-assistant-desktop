// IPC bridge (lado main). Registra handlers invoke e oferece push para o renderer.
import { ipcMain, BrowserWindow, autoUpdater } from 'electron';
import { IPC } from './channels';
import { openExternal } from '../platform/external';
import { IS_TEST, recordInstallRequested } from '../test/testState';

/** Registra os handlers de IPC que o BC-09 possui. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    await openExternal(url);
  });

  // Relaunch para instalar update baixado (SCR-0029 "Restart Now" / AD-09).
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    // Sob a suíte de paridade só registramos a intenção — quitAndInstall mataria o app.
    if (IS_TEST) {
      recordInstallRequested();
      return;
    }
    try {
      autoUpdater.quitAndInstall();
    } catch (err) {
      console.error('[updater] quitAndInstall falhou', err);
    }
  });

  // IPC.DB_QUERY/DB_BATCH são registrados em db/dbHandlers (Tarefa 07).
}

/** Envia um evento push para o renderer (no-op se a janela não existe). */
export function sendToRenderer(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}
