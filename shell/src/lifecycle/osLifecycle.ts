// OS lifecycle — sleep/resume + before-quit (AD-03 / Implicação 5 do paradigma).
// Em desktop, setInterval pode não disparar durante sleep; o resume dispara
// refresh JIT de token no renderer. before-quit dispara flush da sync queue.
import { app, powerMonitor } from 'electron';
import type { OsEvent } from '../ipc/channels';

type Handler = (event: OsEvent) => void;

/**
 * Registra listeners de OS lifecycle e encaminha eventos ao renderer via `emit`.
 * - `resumed`: laptop acordou → renderer faz fetchAuthSession JIT (AD-03).
 * - `before-quit`: app vai fechar → sync-agent.flushAllPending (BR-MIGRAR-008).
 */
export function registerOsLifecycle(emit: Handler): void {
  powerMonitor.on('resume', () => emit('resumed'));

  // Também tratamos unlock da tela como "resumed" (cobre desktop que não dorme).
  powerMonitor.on('unlock-screen', () => emit('resumed'));

  app.on('before-quit', () => emit('before-quit'));
}
