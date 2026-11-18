// SharedBoardCanvas — o board de um link compartilhado, com a cara do corkboard.
//
// Dois jeitos de ver, com os nomes do board original:
//   Master  o palco como o roteirista o arrumou: os notecards das cenas nas
//           posições dele, o fio da ordem contada, as caixas de sequência, as
//           pílulas de personagem e os laços entre elas. Dá para arrastar o
//           palco, dar zoom, abrir um card e mover cards.
//   Beats   todas as cenas em ordem de história, uma grade de leitura.
//
// É um preview: nada aqui chega à história. Dá para arrumar à vontade (arrastar
// um card, uma sequência inteira, reordenar as cenas nos Beats), e a arrumação
// fica guardada só no navegador de quem a fez (`memoryKey`, por link), com um
// botão para voltar ao que o roteirista deixou. Medidas, cores e traços vêm do
// board (corkboard/constants, cards.tsx CardBox, connectors.tsx ConnectorLayer),
// para os dois se parecerem.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CHAR_PILL_H, CHAR_PILL_W, COL_GAP, COLLAPSED_H, COLLAPSED_W, DRAG_THRESHOLD_PX, EVENT_CARD_W, EXPANDED_W, REL_COLLAPSED_H, REL_COLLAPSED_W, ROW_GAP,
} from '../Freeform/corkboard/constants';
import { liftColor } from '../Freeform/corkboard/theme';
import { entityColorForMode, getEntityColor, hexToRgba } from '../Freeform/entityColors';
import type { SharedBoard, SharedCanvas, SharedCanvasCard, SharedScene, SharedSection } from '../../lib/shareLinks';

type Pos = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number; cx: number; cy: number };
type View = { x: number; y: number; z: number };
type Person = SharedBoard['characters'][number];

const FONT = 'system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
// A caixa de sequência: as mesmas medidas do board (ballEffects.seqBoxRect).
const SEQ_HEADER_H = 24;
const SEQ_PAD = 14;
const SEQ_BOX_MIN_W = 300;
const Z_MIN = 0.25;
const Z_MAX = 2;
const FIT_MIN = 0.45; // abaixo disso o título de um card não se lê
const REL_COLOR = getEntityColor('relationship');

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
const sizeOf = (kind: SharedCanvasCard['kind']): { w: number; h: number } =>
  kind === 'character' ? { w: CHAR_PILL_W, h: CHAR_PILL_H } : kind === 'scene' ? { w: EVENT_CARD_W, h: COLLAPSED_H } : { w: COLLAPSED_W, h: COLLAPSED_H };
/** Onde a reta centro a centro sai do retângulo: a linha não passa por baixo do card. */
function edgePoint(from: Rect, to: { cx: number; cy: number }): Pos {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
  const t = Math.min(dx === 0 ? Infinity : from.w / 2 / Math.abs(dx), dy === 0 ? Infinity : from.h / 2 / Math.abs(dy));
  return { x: from.cx + dx * t, y: from.cy + dy * t };
}
const sc = (n: number): string => `SC ${String(n).padStart(2, '0')}`;

/** O palco de um retrato: o que o roteirista arrumou. Um link antigo não traz
 *  o palco; para ele o palco é montado aqui, no desenho do auto-layout do board
 *  (o elenco à esquerda, a espinha das cenas descendo ao lado, cada sequência
 *  na sua caixa), para que todo link possa ser arrumado. Pura. */
export function stageOf(board: SharedBoard): { characters: Person[]; canvas: SharedCanvas } {
  const characters = board.characters.map((p, i) => (p.id ? p : { ...p, id: `cast_${i}` }));
  if (board.canvas) return { characters, canvas: board.canvas };
  const cards: SharedCanvasCard[] = [];
  const CAST_X = 24;
  const CAST_GAP_X = 136;
  characters.forEach((p, i) => cards.push({
    id: p.id as string, kind: 'character', x: CAST_X + (i % 2) * (CHAR_PILL_W + CAST_GAP_X), y: 24 + Math.floor(i / 2) * (CHAR_PILL_H + ROW_GAP),
  }));
  const spineX = characters.length ? CAST_X + 2 * CHAR_PILL_W + CAST_GAP_X + COL_GAP : 24;
  const idByName = new Map(characters.map((p) => [p.name, p.id as string] as const));
  const thread: SharedCanvas['thread'] = [];
  const boxes: SharedCanvas['boxes'] = [];
  const involves: SharedCanvas['involves'] = [];
  let y = 24;
  let prev: string | null = null;
  const link = (id: string): void => { if (prev) thread.push([prev, id]); prev = id; };
  for (const s of board.sections) {
    const boxed = !!s.title && s.scenes.length > 0;
    if (boxed) y += SEQ_HEADER_H + SEQ_PAD;
    for (const scene of s.scenes) {
      cards.push({ id: scene.id, kind: 'scene', x: spineX, y });
      y += COLLAPSED_H + ROW_GAP;
      link(scene.id);
      for (const name of scene.characters) { const who = idByName.get(name); if (who) involves.push([scene.id, who]); }
    }
    if (boxed) { boxes.push({ id: s.id, members: s.scenes.map((x) => x.id) }); y += SEQ_PAD; }
    else if (s.title) { cards.push({ id: s.id, kind: 'sequence', x: spineX, y }); y += COLLAPSED_H + ROW_GAP; link(s.id); }
  }
  return { characters, canvas: { cards, thread, boxes, involves, bonds: [] } };
}

/** O que o visitante mexeu neste link, guardado no navegador dele. */
function readStore<T>(key: string | undefined): T | null {
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
}
function writeStore(key: string | undefined, value: unknown): void {
  if (!key) return;
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem storage: vale só para esta visita */ }
}
/** As posições desta tela: as do retrato, com o que o visitante moveu por cima. */
function placed(home: Record<string, Pos>, moves: Record<string, Pos> | null): Record<string, Pos> {
  const out = { ...home };
  if (moves && typeof moves === 'object') {
    for (const id of Object.keys(home)) {
      const m = moves[id];
      if (m && Number.isFinite(m.x) && Number.isFinite(m.y)) out[id] = { x: m.x, y: m.y };
    }
  }
  return out;
}

function tones(dark: boolean) {
  return dark
    ? { card: '#1a1a1e', ink: '#e8e8ec', mute: '#9a9aa4', faint: '#82828c', hair: '#2a2a30', chip: '#202025', btn: '#1a1a1e', btnInk: '#c8c8d0', btnOn: '#d8d8de', btnOnInk: '#16161a' }
    : { card: '#ffffff', ink: '#222222', mute: '#666666', faint: '#888888', hair: '#e6dfd2', chip: '#f5f5f5', btn: '#ffffff', btnInk: '#3d4250', btnOn: '#ebe4d6', btnOnInk: '#1d2230' };
}
type Tones = ReturnType<typeof tones>;

/** A cor da moldura de uma cena: a que o roteirista deu ao card, ou o azul de evento. */
function sceneColors(scene: SharedScene, dark: boolean): { color: string; accent: string } {
  const color = scene.color || getEntityColor('event');
  return { color, accent: dark ? liftColor(color, 0.3) : entityColorForMode(color, 'light') };
}
const seqColor = (own: string | undefined, dark: boolean): string => own || (dark ? getEntityColor('sequence') : entityColorForMode(getEntityColor('sequence'), 'light'));
const charAccent = (dark: boolean): string => (dark ? liftColor(getEntityColor('character'), 0.3) : entityColorForMode(getEntityColor('character'), 'light'));

function Kicker({ text, accent, mono }: { text: string; accent: string; mono?: boolean }): JSX.Element {
  return (
    <span style={{ fontSize: mono ? 10 : 9, letterSpacing: 0.6, textTransform: 'uppercase', color: accent, fontWeight: mono ? 800 : 600, fontFamily: mono ? MONO : undefined }}>
      {text}
    </span>
  );
}
function Chip({ text, t }: { text: string; t: Tones }): JSX.Element {
  return <span style={{ fontSize: 9, padding: '1px 5px', background: t.chip, color: t.mute, borderRadius: 2, fontWeight: 500 }}>{text}</span>;
}
function Section({ label, t, children }: { label: string; t: Tones; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, letterSpacing: 0.5, color: t.faint, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.ink }}>{children}</div>
    </div>
  );
}

/** O que um card aberto mostra, por tipo. */
function OpenBody({ title, kicker, accent, text, t, onClose, children }: {
  title: string; kicker: React.ReactNode; accent: string; text: string; t: Tones; onClose?: () => void; children?: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {kicker}
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button
            type="button"
            aria-label="Close card"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ border: 'none', background: 'transparent', color: t.mute, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}
          >
            ✕
          </button>
        ) : null}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: t.ink, lineHeight: 1.25, marginBottom: 8 }}>{title}</div>
      {text ? <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55, color: t.ink, opacity: 0.9, whiteSpace: 'pre-wrap' }}>{text}</p> : null}
      {children}
      <div style={{ height: 2, borderRadius: 2, background: hexToRgba(accent, 0.25), marginTop: 2 }} />
    </>
  );
}
function SceneOpen({ scene, t, dark, onClose }: { scene: SharedScene; t: Tones; dark: boolean; onClose?: () => void }): JSX.Element {
  const { accent } = sceneColors(scene, dark);
  return (
    <OpenBody
      title={scene.title}
      accent={accent}
      text={scene.summary}
      t={t}
      onClose={onClose}
      kicker={<><Kicker text={sc(scene.number)} accent={accent} mono />{scene.intExt ? <Chip text={scene.intExt} t={t} /> : null}</>}
    >
      {scene.characters.length ? <Section label="Characters" t={t}>{scene.characters.join(' · ')}</Section> : null}
      {scene.location ? <Section label="Location" t={t}>{scene.location}</Section> : null}
      {scene.beats?.length ? (
        <Section label="Sub-events" t={t}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>{scene.beats.map((b, i) => <li key={i}>{b}</li>)}</ol>
        </Section>
      ) : null}
    </OpenBody>
  );
}

const cardFrame = (dark: boolean, color: string, accent: string, open: boolean): React.CSSProperties => ({
  background: dark ? '#1a1a1e' : '#fff',
  border: `${open ? 2 : 1}px solid ${open ? (dark ? hexToRgba(accent, 0.65) : color) : dark ? '#2a2a30' : hexToRgba(color, 0.4)}`,
  borderLeft: `4px solid ${accent}`,
  borderRadius: open ? 10 : 6,
  padding: open ? '16px 18px' : '10px 12px',
  boxSizing: 'border-box',
  boxShadow: open
    ? `0 4px 14px rgba(0,0,0,${dark ? 0.55 : 0.1}), 0 0 0 3px ${hexToRgba(accent, 0.12)}`
    : dark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 1px 2px rgba(0,0,0,0.06)',
  fontFamily: FONT,
});
const clamp2: React.CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/** O notecard fechado de uma cena: o número, o título, o elenco numa linha. */
function SceneFace({ scene, t, dark }: { scene: SharedScene; t: Tones; dark: boolean }): JSX.Element {
  const { accent } = sceneColors(scene, dark);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Kicker text={sc(scene.number)} accent={accent} mono />
        {scene.intExt ? <Chip text={scene.intExt} t={t} /> : null}
      </div>
      <div style={{ fontSize: 15, fontWeight: 650, color: t.ink, lineHeight: 1.32, marginBottom: 4, ...clamp2 }}>{scene.title}</div>
      {scene.characters.length ? (
        <div style={{ fontSize: 10.5, color: t.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scene.characters.join(' · ')}</div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Beats: a grade de leitura
// ---------------------------------------------------------------------------

type Group = { id: string; ids: string[] };
const groupsOf = (board: SharedBoard): Group[] => board.sections.map((s) => ({ id: s.id, ids: s.scenes.map((x) => x.id) }));
/** A ordem guardada só vale se fala das mesmas seções e das mesmas cenas do retrato. */
function savedGroups(key: string | undefined, base: Group[]): Group[] | null {
  const raw = readStore<Group[]>(key);
  if (!Array.isArray(raw) || raw.length !== base.length) return null;
  const ok = raw.every((g, i) => g && g.id === base[i].id && Array.isArray(g.ids) && g.ids.every((x) => typeof x === 'string'));
  if (!ok) return null;
  const all = (gs: Group[]): string => gs.flatMap((g) => g.ids).sort().join('\n');
  return all(raw) === all(base) ? raw.map((g) => ({ id: g.id, ids: [...g.ids] })) : null;
}

export function SharedBeats({ board, dark, memoryKey }: { board: SharedBoard; dark: boolean; memoryKey?: string }): JSX.Element {
  const t = tones(dark);
  const [open, setOpen] = useState<string | null>(null);

  // A ordem das cenas NESTA tela. Arrastar uma cena para antes ou depois de
  // outra (ou para dentro de uma sequência) a muda aqui, e só aqui.
  const base = useMemo(() => groupsOf(board), [board]);
  const [groups, setGroups] = useState<Group[]>(() => savedGroups(memoryKey, base) ?? base);
  useEffect(() => { setGroups(savedGroups(memoryKey, base) ?? base); }, [base, memoryKey]);
  const reordered = useMemo(() => JSON.stringify(groups) !== JSON.stringify(base), [groups, base]);
  useEffect(() => { writeStore(memoryKey, reordered ? groups : null); }, [groups, reordered, memoryKey]);
  // O arrasto é um gesto de ponteiro, como no palco (não o arrastar-e-soltar
  // nativo): o card acompanha o cursor e cai onde a barra laranja indica. Só
  // com mouse ou caneta; no toque o dedo rola a página, e o Master é que arruma.
  type Drop = { anchor: string; after: boolean } | { section: string };
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [over, setOver] = useState<Drop | null>(null);
  const grabbed = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  const overRef = useRef<Drop | null>(null);
  overRef.current = over;
  const skipClick = useRef(false);

  // As seções como estão aqui, com as cenas renumeradas pela ordem daqui.
  const shown = useMemo(() => {
    const meta = new Map(board.sections.map((s) => [s.id, s] as const));
    const sceneById = new Map(board.sections.flatMap((s) => s.scenes.map((x) => [x.id, x] as const)));
    let n = 0;
    return groups.flatMap((g) => {
      const s = meta.get(g.id);
      if (!s || (!s.title && !g.ids.length)) return [];
      const scenes = g.ids.flatMap((id) => { const found = sceneById.get(id); return found ? [{ ...found, number: ++n }] : []; });
      return [{ ...s, scenes }];
    });
  }, [board.sections, groups]);

  /** Tira a cena de onde está e a põe ao lado de outra (`anchor`), ou no fim de uma seção. */
  const move = useCallback((id: string, to: Drop): void => {
    setGroups((cur) => {
      const next = cur.map((g) => ({ ...g, ids: g.ids.filter((x) => x !== id) }));
      const target = 'anchor' in to ? next.find((g) => g.ids.includes(to.anchor)) : next.find((g) => g.id === to.section);
      if (!target) return cur;
      const at = 'anchor' in to ? target.ids.indexOf(to.anchor) + (to.after ? 1 : 0) : target.ids.length;
      target.ids.splice(at, 0, id);
      return next;
    });
  }, []);
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const g = grabbed.current;
      if (!g) return;
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      skipClick.current = true;
      setDrag({ id: g.id, dx, dy });
    };
    const onUp = (): void => {
      const g = grabbed.current;
      grabbed.current = null;
      if (g?.moved && overRef.current) move(g.id, overRef.current);
      setDrag(null);
      setOver(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [move]);
  /** De que lado do card o ponteiro está: a grade corre da esquerda para a direita. */
  const sideOf = (e: React.PointerEvent): boolean => { const r = e.currentTarget.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
  const dropBar = dark ? '#ff8c42' : '#ea580c';
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', fontWeight: 700, color: t.mute, margin: '0 0 8px' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, alignItems: 'start' };
  return (
    <div data-testid="shared-beats" style={{ display: 'grid', gap: 26, fontFamily: FONT, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 30, marginBottom: -12, fontSize: 12, color: t.mute }}>
        <span>Drag a card to reorder the scenes. Nothing here changes the original.</span>
        <span style={{ flex: 1 }} />
        {reordered ? (
          <button
            type="button"
            onClick={() => setGroups(base)}
            title="Put the scenes back in the writer's order"
            style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600, border: `1px solid ${t.hair}`, borderRadius: 7, background: t.btn, color: t.btnInk, cursor: 'pointer', fontFamily: FONT }}
          >
            Reset order
          </button>
        ) : null}
      </div>
      {shown.map((s) => {
        const color = seqColor(undefined, dark);
        return (
          <section
            key={s.id}
            data-testid="beats-section"
            // Soltar na área da seção (fora de um card) põe a cena no fim dela.
            onPointerMove={() => { if (drag && !(over && 'section' in over && over.section === s.id)) setOver({ section: s.id }); }}
            style={{
              // Uma sequência é a região tingida em volta das suas cenas, como no board.
              ...(s.title ? { border: `1.5px solid ${hexToRgba(color, 0.4)}`, background: hexToRgba(color, 0.05), borderRadius: 14, padding: '10px 14px 14px' } : {}),
              ...(drag && over && 'section' in over && over.section === s.id ? { outline: `2px dashed ${dropBar}`, outlineOffset: 3 } : {}),
            }}
          >
            {s.title ? (
              // <div>, não <header>: components/header.css estiliza o elemento
              // `header` solto (barra preta de 75px), e aquilo vaza para cá.
              <div style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color, display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: hexToRgba(color, 0.14) }}>{s.title}</h2>
                {s.summary ? <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, color: t.mute }}>{s.summary}</p> : null}
              </div>
            ) : null}
            <div style={grid}>
              {s.scenes.map((scene) => {
                const { color: c, accent } = sceneColors(scene, dark);
                const isOpen = open === scene.id;
                return (
                  <article
                    key={scene.id}
                    data-testid="shared-scene"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setOpen(isOpen ? null : scene.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : scene.id); } }}
                    onPointerDown={(e) => {
                      if (isOpen || (e.button !== undefined && e.button !== 0) || e.pointerType === 'touch') return;
                      skipClick.current = false;
                      grabbed.current = { id: scene.id, sx: e.clientX, sy: e.clientY, moved: false };
                    }}
                    onPointerMove={(e) => {
                      if (!drag || drag.id === scene.id) return;
                      e.stopPropagation(); // a seção em volta não disputa o alvo
                      const after = sideOf(e);
                      if (!(over && 'anchor' in over && over.anchor === scene.id && over.after === after)) setOver({ anchor: scene.id, after });
                    }}
                    style={{
                      ...cardFrame(dark, c, accent, isOpen), minHeight: COLLAPSED_H, cursor: isOpen ? 'pointer' : 'grab', gridColumn: isOpen ? '1 / -1' : undefined,
                      maxWidth: isOpen ? EXPANDED_W + 120 : undefined, userSelect: isOpen ? 'text' : 'none',
                      // O card arrastado acompanha o cursor e não fica no caminho do ponteiro.
                      ...(drag?.id === scene.id ? {
                        position: 'relative' as const, zIndex: 50, transform: `translate(${drag.dx}px, ${drag.dy}px)`, pointerEvents: 'none' as const, opacity: 0.92,
                        cursor: 'grabbing', boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.6)' : '0 6px 18px rgba(0,0,0,0.16)',
                      } : {}),
                      // Onde ele vai cair: a barra do lado em que o ponteiro está.
                      ...(drag && over && 'anchor' in over && over.anchor === scene.id ? { boxShadow: `${over.after ? 6 : -6}px 0 0 -1px ${dropBar}` } : {}),
                    }}
                  >
                    {isOpen ? <SceneOpen scene={scene} t={t} dark={dark} /> : (
                      <>
                        <SceneFace scene={scene} t={t} dark={dark} />
                        {scene.summary ? <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.5, color: t.mute, ...clamp2, WebkitLineClamp: 3 }}>{scene.summary}</p> : null}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {board.characters.length ? (
        <section>
          <h2 style={label}>Cast</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, alignItems: 'start' }}>
            {board.characters.map((p) => (
              <li key={p.id ?? p.name} style={{ background: dark ? '#221d12' : '#fdf6e8', border: `1px solid ${hexToRgba(charAccent(dark), 0.55)}`, borderRadius: 12, padding: '8px 14px' }}>
                <strong style={{ fontSize: 12.5, fontWeight: 650, color: dark ? '#f0e2c4' : '#7a5a18' }}>{p.name}</strong>
                {p.description ? <p style={{ margin: '3px 0 0', fontSize: 12.5, lineHeight: 1.5, color: t.mute }}>{p.description}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {board.locations.length ? (
        <section>
          <h2 style={label}>Locations</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {board.locations.map((l) => (
              <li key={l.name} title={l.description || undefined} style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 999, border: `1px solid ${t.hair}`, background: t.card, color: t.ink }}>{l.name}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master: o palco
// ---------------------------------------------------------------------------

export function SharedBoardCanvas({ board, dark, memoryKey }: { board: SharedBoard; dark: boolean; memoryKey?: string }): JSX.Element {
  const { characters, canvas } = useMemo(() => stageOf(board), [board]);
  const t = tones(dark);

  const scenes = useMemo(() => new Map(board.sections.flatMap((s) => s.scenes.map((x) => [x.id, x] as const))), [board.sections]);
  const sections = useMemo(() => new Map(board.sections.map((s) => [s.id, s] as const)), [board.sections]);
  const people = useMemo(() => new Map(characters.map((p) => [p.id as string, p] as const)), [characters]);
  const kindOf = useMemo(() => new Map((canvas?.cards ?? []).map((c) => [c.id, c.kind] as const)), [canvas]);

  // Onde cada card está NESTA tela: onde o roteirista o deixou (`home`), com o
  // que este visitante já moveu neste link por cima.
  const home = useMemo(() => Object.fromEntries((canvas?.cards ?? []).map((c) => [c.id, { x: c.x, y: c.y }])) as Record<string, Pos>, [canvas]);
  const [pos, setPos] = useState<Record<string, Pos>>(() => placed(home, readStore<Record<string, Pos>>(memoryKey)));
  useEffect(() => { setPos(placed(home, readStore<Record<string, Pos>>(memoryKey))); }, [home, memoryKey]);
  const moves = useMemo(() => {
    const out: Record<string, Pos> = {};
    for (const id of Object.keys(home)) if (pos[id] && (pos[id].x !== home[id].x || pos[id].y !== home[id].y)) out[id] = pos[id];
    return out;
  }, [home, pos]);
  const moved = Object.keys(moves).length > 0;

  const [view, setView] = useState<View>({ x: 24, y: 24, z: 1 });
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Guarda a arrumação quando o arrasto termina, não a cada pixel.
  useEffect(() => { if (!dragging) writeStore(memoryKey, moved ? moves : null); }, [dragging, moved, moves, memoryKey]);

  const cardRect = useCallback((id: string): Rect | null => {
    const p = pos[id];
    const kind = kindOf.get(id);
    if (!p || !kind) return null;
    const z = sizeOf(kind);
    return rect(p.x, p.y, z.w, z.h);
  }, [pos, kindOf]);

  // A caixa de cada sequência: o contorno das suas cenas, com a faixa do rótulo em cima.
  const boxes = useMemo(() => (canvas?.boxes ?? []).flatMap((b) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const id of b.members) {
      const p = pos[id];
      if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + EVENT_CARD_W); y1 = Math.max(y1, p.y + COLLAPSED_H);
    }
    if (!Number.isFinite(x0)) return [];
    return [{ ...b, rect: rect(x0 - SEQ_PAD, y0 - SEQ_HEADER_H - SEQ_PAD, Math.max(x1 - x0, SEQ_BOX_MIN_W) + SEQ_PAD * 2, y1 - y0 + SEQ_HEADER_H + SEQ_PAD * 2) }];
  }), [canvas, pos]);
  const boxById = useMemo(() => new Map(boxes.map((b) => [b.id, b] as const)), [boxes]);

  // O fio: uma flecha por elo da ordem contada. Numa sequência com cenas a
  // flecha sai da última cena dela e chega na primeira (a regra do board).
  const thread = useMemo(() => {
    const anchor = (id: string, role: 'from' | 'to'): Rect | null => {
      const box = boxById.get(id);
      if (!box) return cardRect(id);
      let best: Rect | null = null;
      for (const m of box.members) {
        const r = cardRect(m);
        if (!r) continue;
        if (!best || (role === 'from' ? r.y + r.h > best.y + best.h : r.y < best.y)) best = r;
      }
      return best ?? box.rect;
    };
    return (canvas?.thread ?? []).flatMap(([from, to], i) => {
      const a = anchor(from, 'from');
      const b = anchor(to, 'to');
      if (!a || !b || (a.x === b.x && a.y === b.y)) return [];
      return [{ key: `t${i}`, p1: edgePoint(a, b), p2: edgePoint(b, a) }];
    });
  }, [canvas, boxById, cardRect]);

  // Laços entre personagens: a linha tracejada e a pílula com o rótulo no meio.
  const bonds = useMemo(() => (canvas?.bonds ?? []).flatMap((b, i) => {
    const ra = cardRect(b.a);
    const rb = cardRect(b.b);
    if (!ra || !rb) return [];
    const p1 = edgePoint(ra, rb);
    const p2 = edgePoint(rb, ra);
    return [{ key: `b${i}`, ...b, p1, p2, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }];
  }), [canvas, cardRect]);

  // Com o ponteiro num card: quem está ligado a ele (cena e seu elenco, ou
  // personagem e suas cenas). O resto recua e os laços aparecem.
  const ties = useMemo(() => {
    if (!hover || dragging) return null;
    const mine = (canvas?.involves ?? []).filter(([s, c]) => s === hover || c === hover);
    if (!mine.length) return null;
    const ids = new Set<string>([hover]);
    for (const [s, c] of mine) { ids.add(s); ids.add(c); }
    const lines = mine.flatMap(([s, c], i) => {
      const a = cardRect(s);
      const b = cardRect(c);
      return a && b ? [{ key: `i${i}`, p1: edgePoint(a, b), p2: edgePoint(b, a) }] : [];
    });
    return { ids, lines };
  }, [hover, dragging, canvas, cardRect]);

  const bounds = useMemo(() => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const eat = (r: Rect | null): void => { if (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); } };
    for (const c of canvas?.cards ?? []) eat(cardRect(c.id));
    for (const b of boxes) eat(b.rect);
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  }, [canvas, boxes, cardRect]);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // Por onde a leitura começa quando o board não cabe: a primeira cena.
  const firstScene = useMemo(() => {
    let best: SharedScene | null = null;
    for (const c of canvas?.cards ?? []) {
      const s = c.kind === 'scene' ? scenes.get(c.id) : undefined;
      if (s && (!best || s.number < best.number)) best = s;
    }
    return best?.id ?? null;
  }, [canvas, scenes]);
  const startRef = useRef<Rect | null>(null);
  startRef.current = firstScene ? cardRect(firstScene) : null;
  const [stageW, setStageW] = useState(0);

  /** Enquadra o board: cabe na largura (sem passar de 100%) e começa no topo.
   *  Numa tela estreita demais para isso, para no menor zoom ainda legível e
   *  abre na primeira cena, em vez de encolher tudo até virar formiga. */
  const fit = useCallback((): void => {
    const el = stageRef.current;
    const b = boundsRef.current;
    const vw = el?.clientWidth ?? 0;
    setStageW(vw);
    if (!vw) { setView({ x: 24 - b.x0, y: 24 - b.y0, z: 1 }); return; }
    const bw = Math.max(1, b.x1 - b.x0);
    const natural = (vw - 48) / bw;
    const z = Math.max(FIT_MIN, Math.min(1, natural));
    const start = startRef.current;
    const x = natural >= FIT_MIN || !start ? (vw - bw * z) / 2 - b.x0 * z : vw / 2 - start.cx * z;
    setView({ x, y: 24 - b.y0 * z, z });
  }, []);
  useLayoutEffect(() => { fit(); }, [fit, canvas]);
  useEffect(() => {
    const onResize = (): void => setStageW(stageRef.current?.clientWidth ?? 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number): void => {
    setView((v) => {
      const el = stageRef.current;
      const px = cx ?? (el?.clientWidth ?? 0) / 2;
      const py = cy ?? (el?.clientHeight ?? 0) / 2;
      const z = Math.max(Z_MIN, Math.min(Z_MAX, v.z * factor));
      const k = z / v.z;
      return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, z };
    });
  }, []);

  // A roda: rola o palco; com Ctrl (ou o gesto de pinça do trackpad), dá zoom
  // no ponto do cursor. Ouvinte nativo e não passivo para poder segurar o
  // scroll/zoom da página.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Um gesto por vez: arrastar o palco (pan), um card, ou uma sequência inteira
  // (a caixa e as cenas dela andam juntas). Um clique que veio no fim de um
  // arrasto não abre o card.
  const gesture = useRef<{ what: string | null; from: Record<string, Pos>; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const posRef = useRef(pos);
  posRef.current = pos;
  /** `what`: o card ou a sequência que se arrasta (null = o palco); `ids`: os cards que vão junto. */
  const begin = (e: React.PointerEvent, what: string | null, ids: string[] = what ? [what] : []): void => {
    if (e.button !== undefined && e.button !== 0) return;
    skipClick.current = false;
    const from: Record<string, Pos> = {};
    for (const id of ids) { const p = posRef.current[id]; if (p) from[id] = p; }
    if (what && !Object.keys(from).length) return;
    gesture.current = { what, from, sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false };
  };
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!g.moved) { g.moved = true; skipClick.current = true; if (g.what) setDragging(g.what); else setPanning(true); }
      if (g.what) {
        const z = viewRef.current.z;
        const from = g.from;
        setPos((p) => {
          const next = { ...p };
          for (const id of Object.keys(from)) next[id] = { x: Math.round(from[id].x + dx / z), y: Math.round(from[id].y + dy / z) };
          return next;
        });
      } else {
        setView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
      }
    };
    const onUp = (): void => { gesture.current = null; setDragging(null); setPanning(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = (id: string): void => { if (skipClick.current) { skipClick.current = false; return; } setOpen((cur) => (cur === id ? null : id)); };
  const cardProps = (id: string, label: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open === id,
    'aria-label': label,
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); if (open !== id) begin(e, id); },
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (open !== id) toggle(id); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((cur) => (cur === id ? null : id)); } },
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((cur) => (cur === id ? null : cur)),
  });
  const dim = (id: string): number => (ties && !ties.ids.has(id) ? 0.35 : 1);
  const lift = (id: string): number => (dragging === id ? 110 : open === id ? 60 : 2);
  const motion = (id: string): string => (dragging === id ? 'none' : 'box-shadow 200ms ease-out, opacity 200ms ease-out');
  const sceneNo = (id: string): string => { const s = scenes.get(id); return s ? `${sc(s.number)} ${s.title}` : ''; };
  const grid = dark ? 40 : 26;
  const line = dark ? '#a78bfa' : '#94a3b8';
  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 30, minWidth: 30, padding: '0 10px', fontSize: 12, fontWeight: 600,
    border: `1px solid ${t.hair}`, borderRadius: 7, background: t.btn, color: t.btnInk, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
  };

  return (
    <div
      ref={stageRef}
      data-testid="shared-canvas"
      onPointerDown={(e) => begin(e, null)}
      onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setOpen(null); }}
      style={{
        position: 'relative', flex: 1, minHeight: 320, overflow: 'hidden', borderRadius: 10, touchAction: 'none', userSelect: 'none',
        cursor: panning ? 'grabbing' : 'grab', fontFamily: FONT,
        // A superfície do board: só a grade de pontos, que anda e cresce com o palco.
        backgroundImage: dark
          ? 'radial-gradient(circle, rgba(255,107,53,0.18) 1px, transparent 1px)'
          : 'radial-gradient(circle, rgba(70,55,35,0.14) 1px, transparent 1.4px)',
        backgroundSize: `${grid * view.z}px ${grid * view.z}px`,
        backgroundPosition: `${view.x + 8 * view.z}px ${view.y + 8 * view.z}px`,
        backgroundColor: dark ? 'transparent' : 'rgba(255,255,255,0.6)',
        border: dark ? '1px solid #232328' : '1px solid #f0e8da',
        boxShadow: dark ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 6px rgba(120,90,40,0.05)',
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        {/* Caixas de sequência, atrás de tudo. */}
        {boxes.map((b) => {
          const color = seqColor(b.color, dark);
          const hot = hover === b.id || open === b.id || dragging === b.id;
          return (
            <div
              key={`box-${b.id}`}
              data-testid="canvas-sequence"
              // A área livre da caixa arrasta a sequência inteira; os cards dela,
              // por cima, continuam soltos.
              onPointerDown={(e) => { e.stopPropagation(); begin(e, b.id, b.members); }}
              onMouseEnter={() => setHover(b.id)}
              onMouseLeave={() => setHover((cur) => (cur === b.id ? null : cur))}
              style={{
                position: 'absolute', left: b.rect.x, top: b.rect.y, width: b.rect.w, height: b.rect.h, zIndex: 0,
                border: `1.5px solid ${hexToRgba(color, hot ? 0.9 : 0.4)}`, borderRadius: 14, background: hexToRgba(color, dragging === b.id ? 0.1 : 0.05),
                cursor: dragging === b.id ? 'grabbing' : 'move', transition: 'border-color 140ms ease',
              }}
            />
          );
        })}

        {/* O fio e os laços. */}
        <svg width={1} height={1} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }} aria-hidden="true">
          <defs>
            <marker id="shared-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={dark ? 5.5 : 7} markerHeight={dark ? 5.5 : 7} orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={line} opacity={dark ? 0.85 : 1} />
            </marker>
          </defs>
          {thread.map((l) => (
            <g key={l.key}>
              {dark ? <line x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} stroke="#8b5cf6" strokeWidth={4} opacity={0.09} strokeLinecap="round" /> : null}
              <line
                data-testid="canvas-thread"
                x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y}
                stroke={line} strokeWidth={dark ? 1.6 : 1.5} strokeDasharray={dark ? '8 4' : undefined} opacity={dark ? 0.75 : 0.7}
                strokeLinecap="round" markerEnd="url(#shared-arrow)"
              />
            </g>
          ))}
          {bonds.map((b) => (
            <line key={b.key} x1={b.p1.x} y1={b.p1.y} x2={b.p2.x} y2={b.p2.y} stroke={REL_COLOR} strokeWidth={dark ? 1.2 : 1.4} strokeDasharray="4 3" opacity={0.7} />
          ))}
          {(ties?.lines ?? []).map((l) => (
            <line key={l.key} x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} stroke={charAccent(dark)} strokeWidth={1.4} strokeDasharray="5 3" opacity={0.85} />
          ))}
        </svg>

        {/* O rótulo de cada sequência: abre o resumo dela. */}
        {boxes.map((b) => {
          const s = sections.get(b.id);
          const color = seqColor(b.color, dark);
          const isOpen = open === b.id;
          const bg = `linear-gradient(${hexToRgba(color, 0.18)}, ${hexToRgba(color, 0.18)}), ${dark ? '#1a1a1e' : '#fff'}`;
          return (
            <React.Fragment key={`label-${b.id}`}>
              <button
                type="button"
                aria-expanded={isOpen}
                // O rótulo é a alça da sequência: arrastar move a caixa, clicar abre o resumo.
                onPointerDown={(e) => { e.stopPropagation(); begin(e, b.id, b.members); }}
                onClick={(e) => { e.stopPropagation(); if (skipClick.current) { skipClick.current = false; return; } setOpen(isOpen ? null : b.id); }}
                onMouseEnter={() => setHover(b.id)}
                onMouseLeave={() => setHover((cur) => (cur === b.id ? null : cur))}
                title="Drag to move the sequence, click to open it"
                style={{
                  position: 'absolute', left: b.rect.x + 10, top: b.rect.y + 6, zIndex: 32, maxWidth: 240, height: 20, padding: '0 8px', borderRadius: 6,
                  border: 'none', background: bg, color, fontSize: 11, fontWeight: 600, lineHeight: '20px', fontFamily: FONT, cursor: dragging === b.id ? 'grabbing' : 'move',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {s?.title || 'Sequence'}
              </button>
              {isOpen && s ? (
                <div
                  data-testid="canvas-open"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{ position: 'absolute', left: b.rect.x + 10, top: b.rect.y + 32, width: EXPANDED_W, zIndex: 60, cursor: 'default', userSelect: 'text', ...cardFrame(dark, color, color, true) }}
                >
                  <OpenBody title={s.title} accent={color} text={s.summary ?? ''} t={t} onClose={() => setOpen(null)} kicker={<Kicker text="Sequence" accent={color} />}>
                    {s.scenes.length ? <Section label="Scenes" t={t}>{s.scenes.map((x) => <div key={x.id}>{sc(x.number)} {x.title}</div>)}</Section> : null}
                  </OpenBody>
                </div>
              ) : null}
            </React.Fragment>
          );
        })}

        {/* As pílulas dos laços, no meio da linha. */}
        {bonds.map((b) => (b.kind ? (
          <div
            key={`pill-${b.key}`}
            style={{
              position: 'absolute', left: b.mid.x - REL_COLLAPSED_W / 2, top: b.mid.y - REL_COLLAPSED_H / 2, width: REL_COLLAPSED_W, minHeight: REL_COLLAPSED_H, zIndex: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '4px 12px', borderRadius: 13, pointerEvents: 'none',
              background: dark ? '#251618' : '#fbe9e9', border: `1px solid ${hexToRgba(REL_COLOR, 0.6)}`,
              fontSize: 10, fontWeight: 600, color: REL_COLOR, letterSpacing: 0.2, lineHeight: 1.2, textAlign: 'center',
            }}
          >
            {b.kind}
          </div>
        ) : null))}

        {/* Os cards. */}
        {canvas.cards.map((c) => {
          const p = pos[c.id];
          if (!p) return null;
          const isOpen = open === c.id;
          if (c.kind === 'scene') {
            const scene = scenes.get(c.id);
            if (!scene) return null;
            const { color, accent } = sceneColors(scene, dark);
            return (
              <div
                key={c.id}
                data-testid="canvas-scene"
                {...cardProps(c.id, `${sc(scene.number)} ${scene.title}`)}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: isOpen ? EXPANDED_W : EVENT_CARD_W, height: isOpen ? 'auto' : COLLAPSED_H, minHeight: isOpen ? 200 : COLLAPSED_H,
                  overflow: 'hidden', zIndex: lift(c.id), opacity: dim(c.id), transition: motion(c.id),
                  cursor: isOpen ? 'default' : dragging === c.id ? 'grabbing' : 'grab', userSelect: isOpen ? 'text' : 'none',
                  ...cardFrame(dark, color, accent, isOpen),
                  ...(dragging === c.id ? { boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.6)' : '0 6px 18px rgba(0,0,0,0.16)' } : {}),
                }}
              >
                {isOpen ? <SceneOpen scene={scene} t={t} dark={dark} onClose={() => setOpen(null)} /> : <SceneFace scene={scene} t={t} dark={dark} />}
              </div>
            );
          }
          if (c.kind === 'character') {
            const who: Person | undefined = people.get(c.id);
            if (!who) return null;
            const accent = charAccent(dark);
            const inScenes = canvas.involves.filter(([, ch]) => ch === c.id).map(([s]) => s);
            return (
              <div
                key={c.id}
                data-testid="canvas-character"
                {...cardProps(c.id, who.name)}
                style={isOpen ? {
                  position: 'absolute', left: p.x, top: p.y, width: EXPANDED_W, minHeight: 120, zIndex: lift(c.id), cursor: 'default', userSelect: 'text',
                  ...cardFrame(dark, getEntityColor('character'), accent, true),
                } : {
                  position: 'absolute', left: p.x, top: p.y, width: CHAR_PILL_W, minHeight: CHAR_PILL_H, zIndex: lift(c.id), opacity: dim(c.id), transition: motion(c.id),
                  display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '6px 16px', borderRadius: 999,
                  background: dark ? '#221d12' : '#fdf6e8', border: `1px solid ${hexToRgba(accent, 0.55)}`,
                  boxShadow: dark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 1px 2px rgba(0,0,0,0.06)', cursor: dragging === c.id ? 'grabbing' : 'grab', fontFamily: FONT,
                }}
              >
                {isOpen ? (
                  <OpenBody title={who.name} accent={accent} text={who.description} t={t} onClose={() => setOpen(null)} kicker={<Kicker text="Character" accent={accent} />}>
                    {inScenes.length ? <Section label="Appears in" t={t}>{inScenes.map((s) => <div key={s}>{sceneNo(s)}</div>)}</Section> : null}
                  </OpenBody>
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 650, color: dark ? '#f0e2c4' : '#7a5a18', letterSpacing: 0.1, lineHeight: 1.25, textAlign: 'center', wordBreak: 'break-word' }}>{who.name}</span>
                )}
              </div>
            );
          }
          // Uma sequência ainda sem cenas é um card.
          const s: SharedSection | undefined = sections.get(c.id);
          if (!s) return null;
          const color = seqColor(undefined, dark);
          return (
            <div
              key={c.id}
              data-testid="canvas-sequence-card"
              {...cardProps(c.id, s.title)}
              style={{
                position: 'absolute', left: p.x, top: p.y, width: isOpen ? EXPANDED_W : COLLAPSED_W, height: isOpen ? 'auto' : COLLAPSED_H, overflow: 'hidden',
                zIndex: lift(c.id), opacity: dim(c.id), transition: motion(c.id), cursor: isOpen ? 'default' : dragging === c.id ? 'grabbing' : 'grab', userSelect: isOpen ? 'text' : 'none',
                ...cardFrame(dark, color, color, isOpen),
              }}
            >
              {isOpen ? (
                <OpenBody title={s.title} accent={color} text={s.summary ?? ''} t={t} onClose={() => setOpen(null)} kicker={<Kicker text="Sequence" accent={color} />} />
              ) : (
                <>
                  <div style={{ marginBottom: 4 }}><Kicker text="Sequence" accent={color} /></div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: t.ink, lineHeight: 1.25, marginBottom: 4 }}>{s.title}</div>
                  {s.summary ? <div style={{ fontSize: 11, lineHeight: 1.4, color: t.mute, ...clamp2 }}>{s.summary}</div> : null}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Controles do palco: zoom, enquadrar e desfazer o que foi movido aqui. */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 140, display: 'flex', gap: 6, alignItems: 'center', cursor: 'default' }}
      >
        {moved ? <button type="button" style={btn} onClick={() => setPos(home)} title="Put every card back where the writer left it">Reset cards</button> : null}
        <button type="button" style={btn} aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>−</button>
        <span data-testid="canvas-zoom" style={{ ...btn, cursor: 'default', minWidth: 52 }}>{Math.round(view.z * 100)}%</span>
        <button type="button" style={btn} aria-label="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
        <button type="button" style={btn} onClick={fit} title="Fit the board to the screen">Fit</button>
      </div>
      {/* A dica só onde há lugar para ela ao lado dos controles. */}
      {stageW === 0 || stageW >= 700 ? (
        <div
          style={{
            position: 'absolute', left: 12, bottom: 12, zIndex: 140, maxWidth: 'calc(100% - 300px)', padding: '5px 10px', borderRadius: 7, pointerEvents: 'none',
            fontSize: 11, lineHeight: 1.4, color: t.mute, background: dark ? 'rgba(20,20,24,0.82)' : 'rgba(255,255,255,0.86)', border: `1px solid ${t.hair}`,
          }}
        >
          Drag a card or a sequence to rearrange · Drag the background to move around · Ctrl + scroll to zoom · Click a card to open it. Nothing here changes the original.
        </div>
      ) : null}
    </div>
  );
}

export default SharedBoardCanvas;
