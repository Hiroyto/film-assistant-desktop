// FdxCoworkPanel — cowork .fdx (SOMENTE LEITURA), opt-in. Não aparece até o
// usuário acionar o menu "File → Open Screenplay (.fdx)…" (evento nativo
// 'app:open-fdx'). Depois de abrir, mostra um controle discreto (arquivo, nº de
// cenas, board, parar) e o board ao vivo. Enquanto nenhum .fdx está aberto,
// renderiza nada — não é mais um widget flutuante permanente. Desktop-only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [pulse, setPulse] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const busyRef = useRef(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const p = await openFdx();
      if (p) {
        setPayload(p);
        if (p.ok) setBoardOpen(true); // abre o board na 1ª leitura
      }
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Push do main a cada save do arquivo observado.
    const off = onFdxChanged((p) => {
      setPayload(p);
      setPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 600);
    });
    // Acionado pelo menu nativo (File → Open Screenplay).
    const onMenuOpen = (): void => void open();
    window.addEventListener('app:open-fdx', onMenuOpen);
    return () => {
      off();
      window.removeEventListener('app:open-fdx', onMenuOpen);
    };
  }, [open]);

  // Opt-in: nada na tela até um .fdx ser aberto pelo menu.
  if (!isDesktop() || !payload) return null;

  const stop = async (): Promise<void> => {
    await closeFdx();
    setPayload(null);
    setBoardOpen(false);
  };

  const box: React.CSSProperties = {
    position: 'fixed', right: 12, bottom: 40, zIndex: 45, width: 300,
    background: '#1f1f22', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
    padding: 12, color: 'rgba(255,255,255,0.9)', fontSize: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  };
  const btn: React.CSSProperties = {
    background: '#e67e22', color: '#fff', border: 'none', borderRadius: 6,
    padding: '6px 10px', cursor: 'pointer', fontWeight: 600,
  };
  const dot: React.CSSProperties = {
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6,
    background: pulse ? '#5dd4c8' : payload.ok ? '#4ecdc4' : '#888', transition: 'background 200ms',
  };

  return (
    <>
      {boardOpen && payload.ok ? (
        <FdxBoard payload={payload} onClose={() => setBoardOpen(false)} />
      ) : null}

      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <strong style={{ fontSize: 12 }}>
            <span style={dot} />
            .fdx cowork (leitura)
          </strong>
          <button type="button" onClick={stop} style={{ ...btn, background: 'transparent', color: 'rgba(255,255,255,0.6)', padding: 2 }}>
            parar
          </button>
        </div>

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
    </>
  );
}

export default FdxCoworkPanel;
