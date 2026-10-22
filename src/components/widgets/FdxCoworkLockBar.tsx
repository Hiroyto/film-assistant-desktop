// FdxCoworkLockBar — trava de edição do roteiro enquanto um .fdx cowork a
// story. Dois escritores de save-scene-text (o Final Draft, via motor, e o
// editor daqui) sobrescreveriam um ao outro — o último save vence. Então o
// editor nasce READ-ONLY enquanto o cowork está ligado para a story, com a
// opção de destravar, que vem com o aviso do risco. A escolha vale para esta
// sessão do app (sessionStorage): ao reabrir, volta a travado — o padrão seguro.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fdxCoworkFileFor } from '../../lib/fdxSync';
import { useFdxSync } from './useFdxSync';

export interface FdxCoworkLock {
  /** Nome do .fdx que cowork a story, ou null (sem cowork: nada a travar). */
  coworkFile: string | null;
  /** Travado: cowork ligado e edição não destravada. */
  readOnly: boolean;
  unlocked: boolean;
  unlock: () => void;
  relock: () => void;
}

const unlockKey = (storyId: string): string => `ff-fdx-edit-unlock-${storyId}`;
const readUnlock = (storyId: string | undefined): boolean => {
  if (!storyId) return false;
  try { return sessionStorage.getItem(unlockKey(storyId)) === '1'; } catch { return false; }
};
const writeUnlock = (storyId: string | undefined, on: boolean): void => {
  if (!storyId) return;
  try {
    if (on) sessionStorage.setItem(unlockKey(storyId), '1');
    else sessionStorage.removeItem(unlockKey(storyId));
  } catch { /* storage privado/cheio: a escolha vale só até o reload */ }
};

/** O estado da trava para uma story: cowork ligado? destravado nesta sessão? */
export function useFdxCoworkLock(storyId: string | undefined): FdxCoworkLock {
  const snap = useFdxSync();
  const coworkFile = useMemo(() => {
    // `snap` entra só para recomputar a cada emit do motor (bind/open/stop/
    // resume); a fonte é o motor, se vinculado à story, senão o store persistido.
    if (!storyId) return null;
    return snap ? fdxCoworkFileFor(storyId) : null;
  }, [storyId, snap]);
  const [unlocked, setUnlocked] = useState(() => readUnlock(storyId));
  useEffect(() => { setUnlocked(readUnlock(storyId)); }, [storyId]);
  const unlock = useCallback(() => { writeUnlock(storyId, true); setUnlocked(true); }, [storyId]);
  const relock = useCallback(() => { writeUnlock(storyId, false); setUnlocked(false); }, [storyId]);
  return { coworkFile, readOnly: !!coworkFile && !unlocked, unlocked, unlock, relock };
}

const FONT = 'system-ui, sans-serif';

/** A faixa acima do roteiro (travado: aviso + "Enable editing…"; destravado:
 *  alerta + "Back to read-only") e o diálogo de confirmação do destravar. */
export function FdxCoworkLockBar({ lock, theme }: { lock: FdxCoworkLock; theme: 'dark' | 'light' }): JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  if (!lock.coworkFile) return null;
  const dark = theme === 'dark';
  const bar: React.CSSProperties = {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '7px 18px', fontSize: 12.5, fontFamily: FONT,
    borderBottom: `1px solid ${dark ? '#232328' : '#e8e0d2'}`, lineHeight: 1.4,
  };
  const btn: React.CSSProperties = {
    border: `1px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', color: 'inherit',
    borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  return (
    <>
      {lock.readOnly ? (
        <div
          role="status"
          data-testid="cowork-lock-bar"
          style={{ ...bar, background: dark ? 'rgba(93,212,200,0.08)' : 'rgba(15,127,159,0.08)', color: dark ? '#c9c9d1' : '#2c2c28' }}
        >
          <span>
            Read-only. This screenplay is coworking with <strong>{lock.coworkFile}</strong> in Final Draft. Edits made here would conflict with the file.
          </span>
          <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={() => setConfirming(true)}>Enable editing…</button>
        </div>
      ) : (
        <div
          role="status"
          data-testid="cowork-lock-bar"
          style={{ ...bar, background: dark ? 'rgba(234,179,8,0.1)' : 'rgba(194,65,12,0.08)', color: dark ? '#eab308' : '#9a3412' }}
        >
          <span aria-hidden>⚠</span>
          <span>
            Editing enabled while the cowork is on. Changes here and saves from <strong>{lock.coworkFile}</strong> can overwrite each other.
          </span>
          <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={lock.relock}>Back to read-only</button>
        </div>
      )}
      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit while coworking?"
          style={{
            position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', fontFamily: FONT,
          }}
        >
          <div
            style={{
              width: 440, maxWidth: 'calc(100vw - 32px)', background: dark ? '#1f1f22' : '#fffdf8', color: dark ? 'rgba(255,255,255,0.9)' : '#2c2c28',
              border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : '#e8e0d2'}`, borderRadius: 12, padding: 18, fontSize: 13, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Edit while coworking?</div>
            <p style={{ margin: '0 0 8px', lineHeight: 1.5 }}>
              This screenplay is being written in Final Draft (<strong>{lock.coworkFile}</strong>) and synced to the board on every save.
            </p>
            <p style={{ margin: '0 0 8px', lineHeight: 1.5 }}>
              If you also edit here, the two copies can conflict: the file and the app write the same scenes, and the last save wins.
              Text you type here may be replaced by the next Final Draft save, or overwrite it.
            </p>
            <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.75 }}>Safer: edit in Final Draft, or stop the cowork first.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" style={btn} onClick={() => setConfirming(false)}>Keep read-only</button>
              <button
                type="button"
                style={{ ...btn, background: '#b45309', borderColor: '#b45309', color: '#fff' }}
                onClick={() => { lock.unlock(); setConfirming(false); }}
              >
                Enable editing anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default FdxCoworkLockBar;
