// FdxBoard — moldura do board .fdx (protótipo, read-only). Header com
// título/contagem/close + o canvas posicionado (FdxCanvas), que reusa o modelo
// e o layout reais do corkboard. Ao vivo: novos beats entram, o que muda brilha.
import React, { useMemo } from 'react';
import { fdxToEntities } from '../../lib/fdxToEntities';
import { FdxCanvas } from './FdxCanvas';

export function FdxBoard({ payload, onClose }: { payload: FdxPayload; onClose: () => void }): JSX.Element {
  const counts = useMemo(() => {
    const m = fdxToEntities(payload);
    return { events: m.events.length, locations: m.locations.length };
  }, [payload.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 46, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: 'min(1040px, 94vw)', height: '86vh', display: 'flex', flexDirection: 'column',
          background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.92)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>{payload.title || payload.fileName}</div>
            <div style={{ fontSize: 12, opacity: 0.55 }}>
              {counts.events} scenes · {counts.locations} locations · drag the cards · updated {new Date(payload.updatedAt).toLocaleTimeString()}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >
            close
          </button>
        </div>

        {payload.ok ? (
          <FdxCanvas payload={payload} />
        ) : (
          <div style={{ padding: 24, opacity: 0.6 }}>{payload.error || 'no scenes found'}</div>
        )}
      </div>
    </div>
  );
}

export default FdxBoard;
