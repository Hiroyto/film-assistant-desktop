// FdxCoworkPanel — PROTÓTIPO (só leitura) do coworking .fdx. Painel flutuante
// desktop-only: abre um .fdx (editado por outro app) e mostra, ao vivo, a cada
// save no disco, quantas cenas/parágrafos tem + as primeiras scene headings.
// Prova o fluxo end-to-end (main watcher -> IPC -> renderer). Não é UI final.
import React, { useEffect, useRef, useState } from 'react';
import { isDesktop } from '../../lib/ipcClient';
import { openFdx, closeFdx, onFdxChanged } from '../../lib/fdxClient';
import { FdxBoard } from './FdxBoard';

function hhmmss(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function FdxCoworkPanel(): JSX.Element | null {
  const [payload, setPayload] = useState<FdxPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Push do main a cada save do arquivo observado.
    return onFdxChanged((p) => {
      setPayload(p);
      setPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 600);
    });
  }, []);

  if (!isDesktop()) return null;

  const open = async () => {
    setBusy(true);
    try {
      const p = await openFdx();
      if (p) {
        setPayload(p);
        if (p.ok) setBoardOpen(true); // abre o board já na 1ª leitura
      }
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    await closeFdx();
    setPayload(null);
    setBoardOpen(false);
  };

  const box: React.CSSProperties = {
    position: 'fixed',
    right: 12,
    bottom: 40, // acima da sync-status-bar (~28px)
    zIndex: 45,
    width: 300,
    background: '#1f1f22',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 12,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  };
  const btn: React.CSSProperties = {
    background: '#e67e22',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  };
  const dot: React.CSSProperties = {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 6,
    background: pulse ? '#5dd4c8' : payload?.ok ? '#4ecdc4' : '#888',
    transition: 'background 200ms',
  };

  return (
    <>
      {boardOpen && payload && payload.ok ? (
        <FdxBoard payload={payload} onClose={() => setBoardOpen(false)} />
      ) : null}

      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: 12 }}>
            <span style={dot} />
            .fdx cowork (leitura)
          </strong>
          {payload ? (
            <button type="button" onClick={stop} style={{ ...btn, background: 'transparent', color: 'rgba(255,255,255,0.6)', padding: 2 }}>
              parar
            </button>
          ) : null}
        </div>

        {!payload ? (
          <button type="button" onClick={open} disabled={busy} style={btn}>
            {busy ? 'Abrindo…' : 'Abrir .fdx'}
          </button>
        ) : (
          <div>
            <div style={{ opacity: 0.7, marginBottom: 6, wordBreak: 'break-all' }}>{payload.fileName}</div>
            {payload.ok ? (
              <>
                <div style={{ marginBottom: 8 }}>
                  <strong>{payload.sceneCount}</strong> cenas · {payload.paragraphCount} parágrafos
                  {payload.title ? <> · “{payload.title}”</> : null}
                </div>
                <button type="button" onClick={() => setBoardOpen(true)} style={btn}>
                  Ver board ↗
                </button>
              </>
            ) : (
              <div style={{ color: '#e88' }}>{payload.error || 'não foi possível ler'}</div>
            )}
            <div style={{ marginTop: 8, opacity: 0.5 }}>atualizado {hhmmss(payload.updatedAt)}</div>
          </div>
        )}
      </div>
    </>
  );
}

export default FdxCoworkPanel;
