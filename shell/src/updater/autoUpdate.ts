// Auto-update (AD-09) — update-electron-app + GitHub Releases (latest.yml).
// Framework Electron (ADR-001). Encaminha update.available/downloaded ao renderer
// para a UI (sync-status-bar / update-available-modal — Tarefa 15).
import { app, autoUpdater } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import type { UpdatePayload } from '../ipc/channels';

type Handler = (payload: UpdatePayload) => void;

/**
 * Inicializa o auto-updater. No-op em dev (app não empacotado). `emit` encaminha
 * os eventos ao renderer. Feed: GitHub Releases (público); revisitar S3/CloudFront
 * pós-traction (AD-09).
 */
export function registerAutoUpdate(emit: Handler): void {
  if (!app.isPackaged) {
    console.log('[updater] dev mode — auto-update desabilitado');
    return;
  }

  try {
    // update-electron-app lê repo do package.json ou usa o fornecido; checa periodicamente.
    updateElectronApp({
      updateInterval: '1 hour',
      notifyUser: false, // a UI própria (Tarefa 15) cuida da notificação
      logger: console,
    });
  } catch (err) {
    console.error('[updater] falha ao inicializar', err);
    return;
  }

  autoUpdater.on('update-available', () => emit({ type: 'available' }));
  autoUpdater.on('update-downloaded', (_event, _notes, releaseName) =>
    emit({ type: 'downloaded', version: releaseName }),
  );
  autoUpdater.on('error', (err) => console.error('[updater] error', err));
}
