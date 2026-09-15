// FdxCanvas — o "último quilômetro" (protótipo, read-only): monta as entidades
// derivadas do .fdx num CANVAS POSICIONADO, reusando o algoritmo de layout REAL
// do corkboard (computeAutoLayout) + os renderers de card reais
// (EventCompact / LocationCompact). Cards são arrastáveis e as posições
// persistem por arquivo em localStorage. Novos beats entram no auto-layout;
// cards já movidos mantêm a posição; o que muda brilha.
//
// Isolado de propósito do FreeformCorkboard vivo (Dynamo CardLayouts + WebSocket
// + CardBox de ~30 props). Aqui é o mesmo MODELO e o mesmo LAYOUT, sem a máquina
// de sync — plugar no canvas de produção de verdade é decisão de produto.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fdxToEntities, FdxCardVM } from '../../lib/fdxToEntities';
import { EventCompact, LocationCompact } from '../Freeform/corkboard/cards';
import { computeAutoLayout } from '../Freeform/corkboard/connectors';
import type { Pos } from '../Freeform/corkboard/constants';

const CARD_W = 210;
const CARD_H = 120;
const keyFor = (path: string): string => `fdx-layout:${path}`;

function loadOverrides(path: string): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(keyFor(path)) || '{}') as Record<string, Pos>;
  } catch {
    return {};
  }
}
function saveOverrides(path: string, o: Record<string, Pos>): void {
  try {
    localStorage.setItem(keyFor(path), JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function FdxCanvas({ payload }: { payload: FdxPayload }): JSX.Element {
  const model = useMemo(() => fdxToEntities(payload), [payload.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo<FdxCardVM[]>(() => [...model.events, ...model.locations], [model]);

  // Auto-layout via o algoritmo REAL do corkboard (spine de eventos por PRECEDES
  // = ordem das cenas). Guardado: se lançar/vier vazio, cai no grid manual.
  const auto = useMemo<Record<string, Pos>>(() => {
    try {
      const precedes = model.events
        .slice(1)
        .map((e, i) => ({ from: model.events[i].entity.id, to: e.entity.id }));
      const m = computeAutoLayout(all.map((v) => v.entity), precedes);
      return m && Object.keys(m).length ? m : {};
    } catch {
      return {};
    }
  }, [all, model.events]);

  const [overrides, setOverrides] = useState<Record<string, Pos>>(() => loadOverrides(payload.path));
  useEffect(() => { setOverrides(loadOverrides(payload.path)); }, [payload.path]);

  const gridFallback = (idx: number): Pos => ({
    x: 40 + (idx % 6) * (CARD_W + 24),
    y: 40 + Math.floor(idx / 6) * (CARD_H + 24),
  });
  const posOf = (id: string, idx: number): Pos => overrides[id] ?? auto[id] ?? gridFallback(idx);

  // --- glow no que muda ---
  const prev = useRef<Map<string, string>>(new Map());
  const firstRun = useRef(true);
  const [glow, setGlow] = useState<Set<string>>(new Set());
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cur = new Map<string, string>();
    const changed = new Set<string>();
    for (const vm of all) {
      const sig = vm.entity.type === 'event'
        ? `${vm.entity.working_title}#${vm.entity.summary}`
        : `${vm.entity.working_name}#${vm.signal.appearsInEventTitles?.length ?? 0}`;
      cur.set(vm.entity.id, sig);
      const before = prev.current.get(vm.entity.id);
      if (before === undefined || before !== sig) changed.add(vm.entity.id);
    }
    prev.current = cur;
    if (firstRun.current) { firstRun.current = false; return; }
    if (changed.size) {
      setGlow(changed);
      if (glowTimer.current) clearTimeout(glowTimer.current);
      glowTimer.current = setTimeout(() => setGlow(new Set()), 1200);
    }
  }, [payload.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- drag ---
  const drag = useRef<{ id: string; sx: number; sy: number; bx: number; by: number } | null>(null);
  const onDown = (e: React.PointerEvent, id: string, cur: Pos): void => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, bx: cur.x, by: cur.y };
  };
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const nx = Math.max(0, d.bx + (e.clientX - d.sx));
    const ny = Math.max(0, d.by + (e.clientY - d.sy));
    setOverrides((o) => ({ ...o, [d.id]: { x: nx, y: ny } }));
  };
  const onUp = (): void => {
    if (!drag.current) return;
    drag.current = null;
    setOverrides((o) => { saveOverrides(payload.path, o); return o; });
  };

  const bounds = useMemo(() => {
    let w = 900;
    let h = 520;
    all.forEach((vm, i) => {
      const p = posOf(vm.entity.id, i);
      w = Math.max(w, p.x + CARD_W);
      h = Math.max(h, p.y + CARD_H);
    });
    return { w: w + 60, h: h + 60 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, overrides, auto]);

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#111113' }}>
      <div style={{ position: 'relative', width: bounds.w, height: bounds.h }}>
        {all.map((vm, i) => {
          const p = posOf(vm.entity.id, i);
          const on = glow.has(vm.entity.id);
          const isEvent = vm.entity.type === 'event';
          const chip: React.CSSProperties = {
            background: isEvent ? '#e67e22' : '#4ecdc4', color: isEvent ? '#fff' : '#08302c',
            fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '1px 7px', flex: '0 0 auto',
          };
          return (
            <div
              key={vm.entity.id}
              onPointerDown={(e) => onDown(e, vm.entity.id, p)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: CARD_W,
                background: '#1f1f22',
                border: `1px solid ${on ? '#5dd4c8' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: on ? '0 0 0 2px rgba(93,212,200,0.35)' : '0 2px 8px rgba(0,0,0,0.3)',
                borderRadius: 10, padding: 10, cursor: 'grab', userSelect: 'none',
                transition: 'border-color 300ms, box-shadow 300ms',
                color: 'rgba(255,255,255,0.9)', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={chip}>{isEvent ? 'CENA' : vm.entity.int_ext || 'LOC'}</span>
                <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isEvent ? vm.entity.working_title : vm.entity.working_name}
                </span>
              </div>
              {isEvent
                ? <EventCompact entity={vm.entity} signal={vm.signal} />
                : <LocationCompact entity={vm.entity} signal={vm.signal} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FdxCanvas;
