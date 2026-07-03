// SCR-0029 shell.update-available-modal (modernizado / AD-09). Aparece quando o
// updater emite 'update.downloaded'. "Later" suprime re-prompt por 24h; "Restart Now"
// chama installUpdate (relaunch). Textos = DEV-003 (agent-proposed).
import React, { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../../../data/local-db/repositories/settingsRepo';
import { isDesktop } from '../../../lib/ipcClient';

const SKIP_KEY = 'lastUpdatePromptSkippedAt';
const SKIP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function UpdateAvailableModal(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onUpdate) return;
    return window.electronAPI.onUpdate(async (info) => {
      if (info.type !== 'downloaded') return;
      if (isDesktop()) {
        const last = await getSetting<number>(SKIP_KEY);
        if (last && Date.now() - last < SKIP_WINDOW_MS) return; // não re-prompt < 24h
      }
      setVersion(info.version || '');
      setRestarting(false);
      setOpen(true);
    });
  }, []);

  if (!open) return null;

  const later = async () => {
    if (isDesktop()) await setSetting(SKIP_KEY, Date.now());
    setOpen(false);
  };
  const restartNow = async () => {
    setRestarting(true);
    await window.electronAPI?.installUpdate?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
      <div className="w-full max-w-[480px] rounded-xl bg-bgdark2 p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-white">Update Available</h2>
        {restarting ? (
          <p className="mt-4 text-fontWhite07">Restarting…</p>
        ) : (
          <>
            <p className="mt-3 text-fontWhite07">
              Version <span className="text-semanticWarning font-medium">{version || 'new'}</span> is ready to install.
            </p>
            <button
              type="button"
              className="mt-2 text-sm text-fontWhite05 hover:text-fontWhite07"
              onClick={() => setShowNotes((s) => !s)}
            >
              {showNotes ? 'Hide release notes' : 'Show release notes'}
            </button>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={later} className="px-4 py-2 text-fontWhite07 hover:text-white">
                Later
              </button>
              <button
                type="button"
                onClick={restartNow}
                className="rounded-md bg-orange px-4 py-2 font-medium text-white hover:bg-hoverOrangeBorder"
              >
                Restart Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default UpdateAvailableModal;
