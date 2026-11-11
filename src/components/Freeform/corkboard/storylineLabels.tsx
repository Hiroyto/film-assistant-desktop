// components/Freeform/corkboard/storylineLabels.tsx (card colours, 2026-10-09)
//
// COLOUR IS A PROPERTY OF THE CARD (Ben, 2026-10-09). Like a highlighter on
// an index card: you pick a colour on the card itself, that is the whole
// act; a name for the colour is optional and comes later, in the legend.
// One colour per scene. Coloured cards wear their colour always (the frame
// and the rule; the kicker still says Scene), no mode to switch on. The
// legend lists the colours in use with counts, names them in place, and
// filters additively on click. (A derived Cast lens was built and dropped
// the same day: not needed.)
//
// The research behind it (Bochco, John August, Final Draft's Beat Board,
// Scrivener, WriterDuet): one colour per storyline, picked on the card, the
// read is a run of one colour on the ordered wall, names optional, no
// standard palette. Scenes only, for now. The system never colours a card.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LabelSet, ProjectEdges, ProjectEntity } from '../../../lib/freeformApi';
import { LABEL_PALETTE } from '../../../lib/freeformApi';
import { liftColor } from './theme';
import { InlineText } from './inlineText';

/** The first set's name until the writer names it (Ben, 2026-11-04: "labels
 *  should be custom labels"). Older stories stored 'Storyline' or 'Label'. */
export const DEFAULT_SET_NAME = 'Custom labels';
export const setNameOf = (dimension: string | undefined) => (!dimension || dimension === 'Label' || dimension === 'Storyline' ? DEFAULT_SET_NAME : dimension);
export const EMPTY_LABEL_SET: LabelSet = { dimension: DEFAULT_SET_NAME, labels: [] };
const sans = 'system-ui, sans-serif';
/** FIL-708: the strip scrolls sideways, fading at its edges, never wraps. */
const stripScroll: React.CSSProperties = { flexWrap: 'nowrap', paddingBottom: 6 };
/** Only the chips scroll and fade at the right edge; the set's name, its
 *  switcher and the paint toggle stay put and are never faded. */
const chipScroll: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' };
const fadeMask = (left: boolean, right: boolean) => {
  const m = `linear-gradient(to right, ${left ? 'transparent 0, #000 28px' : '#000 0'}, ${right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`;
  return { WebkitMaskImage: m, maskImage: m };
};
/** A mouse wheel turns the chips sideways (Ben, 2026-11-05: "only works on
 *  trackpad"), and an arrow at each edge with more beyond it steps along. */
function Chips({ scroll, children }: { scroll: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!scroll || !el) return;
    // Native and not passive, so the page does not scroll as well.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (el.scrollLeft !== before) e.preventDefault();
      measure();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    measure();
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [scroll, measure]);
  useEffect(() => { measure(); });
  if (!scroll) return <>{children}</>;
  const step = (dir: 1 | -1) => { const el = ref.current; if (!el) return; try { el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' }); } catch { el.scrollLeft += dir * 200; } window.setTimeout(measure, 350); };
  const arrow = (dir: 1 | -1) => (
    <button type="button" data-strip-arrow={dir < 0 ? 'left' : 'right'} aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'} onClick={() => step(dir)}
      style={{ position: 'absolute', top: '50%', [dir < 0 ? 'left' : 'right']: -2, transform: 'translateY(-50%)', zIndex: 2, width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(128,128,128,.35)', background: 'var(--strip-arrow-bg, rgba(128,128,128,.18))', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, backdropFilter: 'blur(4px)' }}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d={dir < 0 ? 'M6.5 1.5 3 5l3.5 3.5' : 'M3.5 1.5 7 5 3.5 8.5'} stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
      {edge.left && arrow(-1)}
      <div ref={ref} data-strip-chips style={{ ...chipScroll, ...fadeMask(edge.left, edge.right) }}>{children}</div>
      {edge.right && arrow(1)}
    </div>
  );
}
const SWATCH_NAMES: Record<string, string> = { '#7e22ce': 'Plum', '#b45309': 'Ochre', '#be123c': 'Crimson', '#334155': 'Slate', '#7c2d12': 'Cocoa', '#c026d3': 'Magenta', '#4d7c0f': 'Olive', '#0f172a': 'Ink' };

export const cardColor = (e: ProjectEntity | undefined): string | undefined => { const c = String((e as any)?.card_color ?? '').toLowerCase(); return LABEL_PALETTE.includes(c) ? c : undefined; };
/** SEVERAL SETS (FIL-707): the story's first set is 'main' (its colour is the
 *  card's `card_color`, what the master reads); every other set keeps the
 *  card's colour in `set_colors[setId]`. One set paints the frames. */
export const MAIN_SET = 'main';
/** FIL-709: the Sequences set, read from the board (a scene's colour there is
 *  its sequence's), never stored as labels. */
export const SEQUENCES_SET = 'sequences';
const HEX6 = /^#[0-9a-f]{6}$/;
export const colorIn = (e: ProjectEntity | undefined, setId?: string): string | undefined => {
  if (!setId || setId === MAIN_SET) return cardColor(e);
  const m = (e as any)?.set_colors;
  const c = String(m && typeof m === 'object' ? (m[setId] ?? '') : '').toLowerCase();
  // A sequence's own colour may be any hex the writer picked on its sheet.
  return setId === SEQUENCES_SET ? (HEX6.test(c) ? c : undefined) : (LABEL_PALETTE.includes(c) ? c : undefined);
};

/** FIL-711: the Subplots set, the story's arcs (not a character's own) as
 *  threads through the scenes. It never paints: a scene shows a dot for each
 *  subplot it carries. */
export const SUBPLOTS_SET = 'subplots';
export interface SubplotChip { id: string; name: string; color: string; description: string; scenes: Array<{ id: string; transition: string }>; suggestionId?: string }

/** The story's subplots, oldest first, each with its colour (its own, else the
 *  next free palette colour) and the sandbox scenes it runs through, in story
 *  order (`rank`), each with its transition ('' when the writer set none). */
export function subplotsFrom(entities: ProjectEntity[], edges: ProjectEdges | undefined, rank: (id: string) => number): SubplotChip[] {
  const made = (e: ProjectEntity) => String((e as any).created_at ?? '');
  const arcs = entities.filter((e) => !e.deleted_at && e.type === 'arc' && !(e as any).character_id).sort((a, b) => made(a).localeCompare(made(b)) || a.id.localeCompare(b.id));
  if (!arcs.length) return [];
  const scenes = new Set(entities.filter((e) => !e.deleted_at && e.type === 'event' && e.state === 'parked').map((e) => e.id));
  const own = (e: ProjectEntity) => { const c = String((e as any).color ?? '').toLowerCase(); return HEX6.test(c) ? c : ''; };
  const taken = new Set(arcs.map(own).filter(Boolean));
  const free = LABEL_PALETTE.filter((c) => !taken.has(c));
  let k = 0;
  return arcs.map((e) => ({
    id: e.id,
    name: String((e as any).working_name || (e as any).working_title || 'Unnamed subplot'),
    color: own(e) || (free.length ? free[k++ % free.length] : LABEL_PALETTE[k++ % LABEL_PALETTE.length]),
    description: String(e.description ?? '').trim(),
    scenes: ((edges as any)?.evokes ?? [])
      .filter((x: any) => x.arc_id === e.id && scenes.has(x.event_id))
      .map((x: any) => ({ id: String(x.event_id), transition: String(x.transition || '') }))
      .sort((a: { id: string }, b: { id: string }) => rank(a.id) - rank(b.id)),
  }));
}

/** A subplot's path in story order: "introduces › complicates › resolves?".
 *  With no "resolves" the open end shows as a question. */
export function subplotPath(chip: SubplotChip): string {
  // Only the words the writer set (Ben, 2026-11-07: "'touches' as default
  // doesn't make a ton of sense"); a scene with none says nothing here.
  if (!chip.scenes.length) return 'No scenes yet.';
  return chip.scenes.map((s) => s.transition || '').filter(Boolean).join(' › ');
}

/** FIL-711: the Subplots set in the strip. A chip per subplot (its colour, name,
 *  scene count), pending suggestions as dashed "Suggested" chips, "+ subplot".
 *  A click opens a chip in place; the set never paints the frames. */
export function SubplotStrip({ chips, suggestions, dark, onOpen, openId, renderOpen, onNew, switcher, landing }: {
  chips: SubplotChip[]; suggestions: SubplotChip[]; dark: boolean; onOpen: (id: string) => void; openId?: string | null;
  renderOpen?: (chip: SubplotChip) => React.ReactNode; onNew?: () => void; switcher?: React.ReactNode; landing?: string | null }) {
  const muted = dark ? '#8a8a93' : '#8a8578';
  const ink = dark ? '#e6e6ea' : '#1d2230';
  const chip = (c: SubplotChip, suggested: boolean) => {
    const key = suggested ? `sugg:${c.suggestionId}` : c.id;
    if (renderOpen && openId === key) return <React.Fragment key={key}>{renderOpen(c)}</React.Fragment>;
    const col = shade(c.color, dark);
    return (
      <button key={key} type="button" data-subplot-chip={key} onClick={(e) => { notePill(e.currentTarget); onOpen(key); }} title="Open: its scenes light up"
        style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6, height: 28, padding: '0 9px 0 6px', borderRadius: 999, border: `1px ${suggested ? 'dashed' : 'solid'} ${suggested ? muted : (dark ? '#2a2a30' : '#e3dbcb')}`, background: suggested ? 'transparent' : (dark ? '#1a1a1e' : '#fff'), color: ink, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: sans, animation: landing === key ? 'sbxSeqLand 600ms ease-out' : undefined }}>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: suggested ? 'transparent' : col, border: suggested ? `1.5px dashed ${muted}` : 'none', boxSizing: 'border-box' }} />
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        {suggested
          ? <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: muted }}>Suggested</span>
          : c.scenes.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: muted, fontVariantNumeric: 'tabular-nums' }}>{c.scenes.length}</span>}
      </button>
    );
  };
  return (
    <div data-color-legend data-subplot-strip style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 0', fontFamily: sans, ...stripScroll }}>
      <style>{'@keyframes sbxSeqLand{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}'}</style>
      {switcher ?? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, marginRight: 4, flexShrink: 0 }}>Subplots</span>}
<Chips scroll={true}>
      {chips.map((c) => chip(c, false))}
      {suggestions.map((c) => chip(c, true))}
      {onNew && <button type="button" data-subplot-new onClick={onNew} title="Make a subplot" style={{ flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999, border: `1px solid ${dark ? '#2a2a30' : '#e3dbcb'}`, background: 'transparent', color: muted, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: sans, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>+</span>Subplot</button>}
      </Chips>
      <span data-subplot-dots-note style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12, color: muted, paddingRight: 10 }}>Shown as dots on scenes</span>
    </div>
  );
}

export interface SequenceChip { id: string; name: string; color: string; scenes: string[] }

/** FIL-709: the sandbox's sequences in story order (their PRECEDES chain,
 *  then by when they were made), each with its colour (its own, else the
 *  next palette colour not taken) and the scenes it contains. */
export function sequencesInOrder(entities: ProjectEntity[], edges: ProjectEdges | undefined): SequenceChip[] {
  const seqs = entities.filter((e) => !e.deleted_at && e.state === 'parked' && e.type === 'sequence');
  if (!seqs.length) return [];
  const ids = new Set(seqs.map((e) => e.id));
  const made = (e: ProjectEntity) => String((e as any).created_at ?? (e as any).parked_at ?? '');
  const byMade = [...seqs].sort((a, b) => made(a).localeCompare(made(b)) || a.id.localeCompare(b.id));
  const next = new Map<string, string>();
  const hasPrev = new Set<string>();
  for (const p of edges?.sequence_precedes ?? []) {
    if (!ids.has(p.from) || !ids.has(p.to) || next.has(p.from) || hasPrev.has(p.to)) continue;
    next.set(p.from, p.to); hasPrev.add(p.to);
  }
  const order: ProjectEntity[] = [];
  const seen = new Set<string>();
  const byId = new Map(seqs.map((e) => [e.id, e]));
  for (const head of byMade.filter((e) => !hasPrev.has(e.id))) {
    let cur: string | undefined = head.id;
    while (cur && !seen.has(cur)) { seen.add(cur); order.push(byId.get(cur)!); cur = next.get(cur); }
  }
  for (const e of byMade) if (!seen.has(e.id)) { seen.add(e.id); order.push(e); }
  const own = (e: ProjectEntity) => { const c = String((e as any).color ?? '').toLowerCase(); return HEX6.test(c) ? c : ''; };
  const taken = new Set(order.map(own).filter(Boolean));
  const free = LABEL_PALETTE.filter((c) => !taken.has(c));
  let k = 0;
  const alive = new Set(entities.filter((e) => !e.deleted_at).map((e) => e.id));
  return order.map((e) => ({
    id: e.id,
    name: String((e as any).working_title || (e as any).working_name || 'Unnamed sequence'),
    color: own(e) || (free.length ? free[k++ % free.length] : LABEL_PALETTE[k++ % LABEL_PALETTE.length]),
    scenes: (edges?.contains ?? []).filter((c) => c.from === e.id && alive.has(c.to)).map((c) => c.to),
  }));
}
export const isScene = (e: ProjectEntity) => e.type === 'event' || e.type === 'sequence';
/** The writer's name for a colour, if they gave one. */
export const nameOf = (set: LabelSet | undefined, color: string | undefined): string | undefined => (color ? set?.labels.find((l) => l.color === color)?.name : undefined);
export const shade = (color: string, dark: boolean) => (dark ? liftColor(color, 0.3) : color);

/** Scenes per colour in use, in palette order. */
export function colorCounts(entities: ProjectEntity[], setId?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entities) { if (e.deleted_at || !isScene(e)) continue; const c = colorIn(e, setId); if (c) m.set(c, (m.get(c) ?? 0) + 1); }
  return new Map(LABEL_PALETTE.filter((c) => m.has(c)).map((c) => [c, m.get(c)!]));
}

/** Additive filter: no colours picked = everything shows. */
export function colorMatches(e: ProjectEntity, active: Set<string>, setId?: string): boolean {
  if (!active.size || !isScene(e)) return true;
  const c = colorIn(e, setId);
  return !!c && active.has(c);
}

/** The eight swatches and None; a named colour shows its name. */
export function ColorPalette({ value, set, dark, onPick, onClose, align = 'left' }: { value: string | undefined; set: LabelSet | undefined; dark: boolean; onPick: (color: string) => void; onClose: () => void; align?: 'left' | 'right' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#82828c' : '#888';
  const named = LABEL_PALETTE.filter((c) => nameOf(set, c));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <div onClick={(e) => { e.stopPropagation(); onClose(); }} onPointerDown={stop} style={{ position: 'fixed', inset: 0, zIndex: 340 }} />
      <div data-color-palette onClick={stop} onPointerDown={stop} onPointerUp={stop} style={{ position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, zIndex: 341, width: 212, boxSizing: 'border-box', background: dark ? '#1a1a1e' : '#fffdf7', border: `1px solid ${dark ? '#2e2e35' : '#e3dbcb'}`, borderRadius: 9, boxShadow: '0 14px 40px rgba(0,0,0,.28)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, textTransform: 'none', letterSpacing: 0, fontFamily: sans, cursor: 'default' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {LABEL_PALETTE.map((c) => (
            <button key={c} type="button" data-color-swatch={c} aria-label={nameOf(set, c) ?? SWATCH_NAMES[c] ?? c} title={nameOf(set, c) ?? SWATCH_NAMES[c]} onClick={() => onPick(c === value ? '' : c)} style={{ height: 30, borderRadius: 6, border: `2px solid ${c === value ? ink : 'transparent'}`, background: shade(c, dark), cursor: 'pointer', padding: 0, outlineOffset: 2 }} />
          ))}
        </div>
        {named.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 4, borderTop: `1px solid ${dark ? '#2a2a30' : '#efe8da'}` }}>
            {named.map((c) => (
              <button key={c} type="button" data-color-named={c} onClick={() => onPick(c === value ? '' : c)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, border: 'none', background: c === value ? (dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)') : 'transparent', color: ink, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: sans }}>
                <span aria-hidden style={{ width: 11, height: 11, borderRadius: 3, background: shade(c, dark), flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(set, c)}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" data-color-none onClick={() => onPick('')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, border: 'none', background: 'transparent', color: muted, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: sans }}>
          <span aria-hidden style={{ width: 11, height: 11, borderRadius: 3, border: `1px dashed ${muted}`, flexShrink: 0 }} />
          No color
        </button>
      </div>
    </>
  );
}

/** The dot on a scene card: its colour, click for the palette. The host may
 *  open it from a right-click through `open` / `onOpenChange`. */
export function ColorDot({ value, set, dark, onPick, size = 12, open, onOpenChange, align = 'left', title }: { value: string | undefined; set: LabelSet | undefined; dark: boolean; onPick?: (color: string) => void; size?: number; open?: boolean; onOpenChange?: (v: boolean) => void; align?: 'left' | 'right'; title?: string }) {
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = (v: boolean) => { if (onOpenChange) onOpenChange(v); else setOwn(v); };
  const muted = dark ? '#82828c' : '#888';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const name = nameOf(set, value);
  return (
    <span data-color-dot style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', textTransform: 'none', letterSpacing: 0 }} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <button
        type="button" data-color-dot-button
        onClick={onPick ? () => setOpen(!isOpen) : undefined}
        aria-label={value ? `Color: ${name ?? SWATCH_NAMES[value] ?? value}` : 'Color this card'}
        title={title ?? (value ? (name ?? SWATCH_NAMES[value] ?? value) : 'Color this card')}
        style={{ width: size + 8, height: size + 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', background: 'transparent', cursor: onPick ? 'pointer' : 'default', borderRadius: 999 }}
      >
        <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: value ? shade(value, dark) : 'transparent', border: value ? 'none' : `1.5px dashed ${muted}`, boxSizing: 'border-box', display: 'block' }} />
      </button>
      {isOpen && onPick && <ColorPalette value={value} set={set} dark={dark} align={align} onPick={(c) => { setOpen(false); onPick(c); }} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** The legend: colours in use with counts; a name typed in place beside
 *  each; the heading renameable; click a swatch to filter, additively. */
export function ColorLegend({ set, counts, active, dark, onToggle, onClear, onName, onHeading, switcher, paint, emptyHint, openKey, onOpenChip, renderOpen, scroll }: { set: LabelSet | undefined; counts: Map<string, number>; active: Set<string>; dark: boolean; onToggle: (color: string) => void; onClear: () => void; onName?: (color: string, name: string) => void; onHeading?: (name: string) => void;
  /** FIL-707: the set switcher beside the heading, the paint toggle at the end, and what an empty set says. */
  switcher?: React.ReactNode; paint?: React.ReactNode; emptyHint?: string;
  /** FIL-708: a click on a chip opens it in place (`renderOpen`) instead of filtering; the strip scrolls sideways. */
  openKey?: string | null; onOpenChip?: (color: string) => void; renderOpen?: (color: string) => React.ReactNode; scroll?: boolean }) {
  const muted = dark ? '#8a8a93' : '#8a8578';
  const ink = dark ? '#e6e6ea' : '#1d2230';
  // An open label stays open even when its last scene leaves it (FIL-708).
  const entries = useMemo(() => [...counts.entries(), ...(renderOpen && openKey && !counts.has(openKey) ? [[openKey, 0] as [string, number]] : [])], [counts, renderOpen, openKey]);
  if (!entries.length && !emptyHint) return null;
  return (
    <div data-color-legend style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 0', fontFamily: sans, ...(scroll ? stripScroll : { flexWrap: 'wrap' }) }}>
      {switcher ? null : onHeading
        ? <InlineText testId="legend-heading" value={setNameOf(set?.dimension)} multiline={false} onSave={onHeading} placeholder={DEFAULT_SET_NAME} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, marginRight: 4 }} />
        : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, marginRight: 4 }}>{setNameOf(set?.dimension)}</span>}
      {switcher}
<Chips scroll={!!scroll}>
      {!entries.length && emptyHint && <span data-legend-empty style={{ fontSize: 12, color: muted, fontStyle: 'italic' }}>{emptyHint}</span>}
      {entries.map(([c, n]) => {
        if (renderOpen && openKey === c) return <React.Fragment key={c}>{renderOpen(c)}</React.Fragment>;
        const on = active.has(c);
        const col = shade(c, dark);
        // FIL-708: chips that open are one button, swatch, name and count
        // (the name is renamed on the open card, not on the chip).
        if (onOpenChip) return (
          <button key={c} type="button" data-legend-color={c} data-legend-open={c} onClick={(e) => { notePill(e.currentTarget); onOpenChip(c); }} title="Open: its scenes light up"
            style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6, height: 28, padding: '0 9px 0 4px', borderRadius: 999, border: `1px solid ${dark ? '#2a2a30' : '#e3dbcb'}`, background: dark ? '#1a1a1e' : '#fff', color: ink, font: 'inherit', cursor: 'pointer', fontFamily: sans }}>
            <span data-legend-swatch={c} aria-hidden style={{ width: 20, height: 20, borderRadius: '50%', background: col, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: nameOf(set, c) ? ink : muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(set, c) ?? 'name it'}</span>
            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, opacity: .6 }}>{n}</span>
          </button>
        );
        return (
          <span key={c} data-legend-color={c} style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6, height: 28, padding: '0 6px 0 4px', borderRadius: 999, border: `1px solid ${on ? col : (dark ? '#2a2a30' : '#e3dbcb')}`, background: dark ? '#1a1a1e' : '#fff', color: ink, opacity: active.size && !on ? .5 : 1, transition: 'opacity 200ms ease' }}>
            <button type="button" data-legend-swatch={c} onClick={() => onToggle(c)} aria-label={`${on ? 'Stop filtering by' : 'Filter by'} ${nameOf(set, c) ?? SWATCH_NAMES[c] ?? c}`} title={on ? 'Show everything again' : 'Show only these'} style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${on ? ink : 'transparent'}`, background: col, cursor: 'pointer', padding: 0 }} />
            {onName
              ? <InlineText testId={`legend-name-${c}`} value={nameOf(set, c) ?? ''} multiline={false} placeholder="name it" onSave={(t) => onName(c, t)} style={{ fontSize: 12, fontWeight: 600, color: ink, minWidth: 48 }} />
              : <span style={{ fontSize: 12, fontWeight: 600 }}>{nameOf(set, c) ?? SWATCH_NAMES[c]}</span>}
            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, opacity: .6 }}>{n}</span>
          </span>
        );
      })}
      {active.size > 0 && <button type="button" data-legend-clear onClick={onClear} style={{ height: 28, padding: '0 10px', borderRadius: 999, border: 'none', background: 'transparent', color: muted, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: sans }}>Show all</button>}
      </Chips>
      {paint}
    </div>
  );
}

export interface SetChoice { id: string; name: string; colors: string[]; /** What the set is, shown as its tooltip. */ hint?: string }

/** FIL-707: which set the strip shows. The button names the set beside a
 *  chevron (Ben, 2026-11-04: "should look a lot more clickable to highlight
 *  how there is layers there"; no icon, Ben hated it). The menu lists every
 *  set; hovering one shows what it is in a tip beside the menu. Each of the
 *  writer's own sets carries its own rename (and, but for Custom labels, its
 *  own remove) on its row, so a set never has to be picked first (Ben,
 *  2026-11-04). Hiding the strip lives in the toolbar. */
export function SetSwitcher({ sets, current, dark, onPick, onNew, onRemove, onRename }: { sets: SetChoice[]; current: string; dark: boolean; onPick: (id: string) => void; onNew: () => void; onRemove?: (id: string) => void; onRename?: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  // The strip scrolls sideways and clips what drops out of it, so the menu is
  // drawn on the page (a portal), placed under the button.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const MENU_W = 272;
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    setAt(r ? { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)) } : { top: 80, left: 16 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) { setAsking(null); setRenaming(null); setTip(null); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#82828c' : '#888';
  const line = dark ? '#2a2a30' : '#efe8da';
  const cur = sets.find((x) => x.id === current);
  const ownSet = (id: string) => id !== SEQUENCES_SET && id !== SUBPLOTS_SET;
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: ink, font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: sans, width: '100%' };
  const iconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, border: 'none', background: 'transparent', color: muted, cursor: 'pointer', padding: 0, flexShrink: 0 };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const showTip = (text: string | undefined, el: HTMLElement) => { if (text) setTip({ text, top: el.getBoundingClientRect().top }); };
  const saveName = () => {
    if (!renaming) return;
    const t = renaming.name.trim(); const was = sets.find((x) => x.id === renaming.id)?.name;
    if (t && t !== was) onRename?.(renaming.id, t);
    setRenaming(null);
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0, marginRight: 4 }} onPointerDown={stop}>
      <style>{`[data-set-switcher]:hover{border-color:${dark ? '#4a4a55' : '#cfc4ae'}!important;background:${dark ? 'rgba(255,255,255,.09)' : '#f3ecdd'}!important}[data-set-menu] [data-set-row]:hover,[data-set-menu] [role="menuitem"]:hover{background:${dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)'}}[data-set-menu] [data-set-row] [data-set-tools]{opacity:.45}[data-set-menu] [data-set-row]:hover [data-set-tools],[data-set-menu] [data-set-row]:focus-within [data-set-tools]{opacity:1}[data-set-menu] [data-set-tools] button:hover{background:${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.07)'}!important;color:${ink}!important}`}</style>
      <button ref={btnRef} type="button" data-set-switcher aria-haspopup="menu" aria-expanded={open}
        title={`${cur?.hint ? `${cur.name}: ${cur.hint}\n\n` : ''}Click to switch to another set or make one.`}
        onClick={toggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px 0 10px', borderRadius: 7, border: `1px solid ${open ? (dark ? '#4a4a55' : '#cfc4ae') : (dark ? '#33333b' : '#e3dbcb')}`, background: open ? (dark ? 'rgba(255,255,255,.09)' : '#f3ecdd') : (dark ? 'rgba(255,255,255,.04)' : '#faf6ee'), color: ink, cursor: 'pointer', font: 'inherit', fontFamily: sans, fontSize: 12, fontWeight: 650, boxShadow: dark ? 'none' : '0 1px 0 rgba(120,90,40,.06)', transition: 'background 120ms ease, border-color 120ms ease' }}>
        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur?.name ?? 'Custom labels'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && at && typeof document !== 'undefined' && createPortal(
        <div onPointerDown={stop} style={{ fontFamily: sans }}>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1340 }} />
          <div role="menu" data-set-menu onMouseLeave={() => setTip(null)} style={{ position: 'fixed', top: at.top, left: at.left, zIndex: 1341, maxHeight: `calc(100vh - ${Math.round(at.top) + 16}px)`, overflowY: 'auto', width: MENU_W, boxSizing: 'border-box', background: dark ? '#1a1a1e' : '#fffdf7', border: `1px solid ${dark ? '#2e2e35' : '#e3dbcb'}`, borderRadius: 9, boxShadow: '0 14px 40px rgba(0,0,0,.28)', padding: 6, fontFamily: sans, textTransform: 'none', letterSpacing: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, padding: '4px 8px 6px' }}>Group scenes by</div>
            {sets.map((x) => {
              const mine = ownSet(x.id);
              if (renaming?.id === x.id) return (
                <div key={x.id} data-set-rename-ask style={{ padding: '4px 6px 6px' }}>
                  <input autoFocus data-set-rename-input value={renaming.name} onChange={(e) => setRenaming({ id: x.id, name: e.target.value })}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={saveName}
                    style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 6, border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: dark ? '#111114' : '#fff', color: ink }} />
                </div>
              );
              if (asking === x.id) return (
                <div key={x.id} data-set-remove-ask style={{ padding: '6px 8px', fontSize: 12, color: ink }}>
                  Remove {x.name}? Its colors come off the cards; the cards stay.
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button type="button" data-set-remove-yes onClick={() => { setAsking(null); onRemove?.(x.id); }} style={{ ...row, width: 'auto', padding: '5px 10px', background: dark ? '#3a1d22' : '#fbe9eb', color: dark ? '#f3b6bf' : '#9f1239', fontSize: 12 }}>Remove</button>
                    <button type="button" data-set-remove-no onClick={() => setAsking(null)} style={{ ...row, width: 'auto', padding: '5px 10px', color: muted, fontSize: 12 }}>Keep it</button>
                  </div>
                </div>
              );
              return (
                <div key={x.id} data-set-row={x.id} onMouseEnter={(e) => showTip(x.hint, e.currentTarget)}
                  style={{ display: 'flex', alignItems: 'center', borderRadius: 6, background: x.id === current ? (dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)') : 'transparent' }}>
                  <button type="button" role="menuitemradio" aria-checked={x.id === current} data-set-choice={x.id} onClick={() => { setOpen(false); onPick(x.id); }} style={{ ...row, flex: 1, minWidth: 0, background: 'transparent' }}>
                    <span aria-hidden style={{ display: 'inline-flex', gap: 2, width: 34, flexShrink: 0 }}>
                      {x.colors.length ? x.colors.slice(0, 4).map((c) => <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: shade(c, dark) }} />) : <span style={{ width: 7, height: 7, borderRadius: '50%', border: `1px dashed ${muted}`, boxSizing: 'border-box' }} />}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                    {x.id === current && <span aria-hidden style={{ color: muted, fontSize: 12 }}>✓</span>}
                  </button>
                  {mine && (onRename || (onRemove && x.id !== MAIN_SET)) && (
                    <span data-set-tools style={{ display: 'inline-flex', gap: 2, paddingRight: 4, transition: 'opacity 120ms ease' }}>
                      {onRename && (
                        <button type="button" data-set-rename={x.id} aria-label={`Rename ${x.name}`} onMouseEnter={(e) => { e.stopPropagation(); showTip('Rename this set.', e.currentTarget.parentElement!.parentElement!); }} onClick={() => setRenaming({ id: x.id, name: x.name })} style={iconBtn}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                      )}
                      {onRemove && x.id !== MAIN_SET && (
                        <button type="button" data-set-remove={x.id} aria-label={`Remove ${x.name}`} onMouseEnter={(e) => { e.stopPropagation(); showTip('Remove this set. The cards stay.', e.currentTarget.parentElement!.parentElement!); }} onClick={() => setAsking(x.id)} style={iconBtn}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            <div style={{ height: 1, background: line, margin: '4px 2px' }} />
            <button type="button" role="menuitem" data-set-new onMouseEnter={(e) => showTip('Color the same scenes another way.', e.currentTarget)} onClick={() => { setOpen(false); onNew(); }} style={{ ...row, color: muted, flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>+ New set <span style={{ fontWeight: 400, fontSize: 11 }}>Acts, characters, timelines</span></button>
          </div>
          {tip && (
            <div data-set-tip role="tooltip" style={{ position: 'fixed', zIndex: 1342, top: tip.top, ...(at.left + MENU_W + 8 + 240 <= window.innerWidth ? { left: at.left + MENU_W + 8 } : { left: Math.max(8, at.left - 248) }), width: 'max-content', maxWidth: 240, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, background: dark ? '#26262c' : '#1d2230', color: dark ? '#e8e8ec' : '#fff', fontSize: 12, lineHeight: 1.45, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,.28)', pointerEvents: 'none' }}>
              {tip.text}
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}


/** FIL-709: the Sequences set in the strip. Numbered chips in story order:
 *  the swatch filters the board to its scenes (additively, like any set),
 *  the name opens the sequence's card, dragging a chip sets its place.
 *  "+ sequence" makes one; a new chip lands with a pulse. */
export function SequenceStrip({ chips, dark, active, onToggle, onClear, onOpen, onNew, onReorder, switcher, paint, landing, openId, renderOpen }: {
  chips: SequenceChip[]; dark: boolean; active: Set<string>; onToggle: (color: string) => void; onClear: () => void;
  onOpen: (id: string) => void; onNew?: () => void; onReorder?: (order: string[]) => void;
  switcher?: React.ReactNode; paint?: React.ReactNode; landing?: string | null;
  /** FIL-708: the chip open in place; `onOpen` then opens it rather than its sheet. */
  openId?: string | null; renderOpen?: (chip: SequenceChip, n: number) => React.ReactNode }) {
  const muted = dark ? '#8a8a93' : '#8a8578';
  const ink = dark ? '#e6e6ea' : '#1d2230';
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (target: string) => {
    if (!drag || drag === target || !onReorder) return;
    const ids = chips.map((c) => c.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(target) + (chips.findIndex((c) => c.id === drag) < chips.findIndex((c) => c.id === target) ? 1 : 0), 0, drag);
    onReorder(ids);
  };
  return (
    <div data-color-legend data-sequence-strip style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 0', fontFamily: sans, ...(renderOpen ? stripScroll : { flexWrap: 'wrap' }) }}>
      <style>{'@keyframes sbxSeqLand{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}@media (prefers-reduced-motion: reduce){[data-seq-landing]{animation:none!important}}'}</style>
      {switcher ?? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, marginRight: 4, flexShrink: 0 }}>Sequences</span>}
<Chips scroll={!!renderOpen}>
      {chips.map((c, i) => {
        // The track: each sequence leads into the next (Ben, 2026-11-03: the
        // order was hard to read, "there's not really a connection").
        const link = i > 0 ? <span aria-hidden data-seq-link style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', margin: '0 -3px' }}><span style={{ width: 12, height: 1.5, background: muted, opacity: .7 }} /><span style={{ width: 0, height: 0, borderLeft: `5px solid ${muted}`, borderTop: '3.5px solid transparent', borderBottom: '3.5px solid transparent', opacity: .7 }} /></span> : null;
        if (renderOpen && openId === c.id) return <React.Fragment key={c.id}>{link}{renderOpen(c, i + 1)}</React.Fragment>;
        const on = active.has(c.color);
        const col = shade(c.color, dark);
        return (<React.Fragment key={c.id}>{link}
          <span data-seq-chip={c.id} data-seq-landing={landing === c.id ? '1' : undefined}
            draggable={!!onReorder}
            onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch { /* some browsers refuse */ } }}
            onDragOver={(e) => { if (drag && drag !== c.id) { e.preventDefault(); setOver(c.id); } }}
            onDragLeave={() => setOver((cur) => (cur === c.id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); drop(c.id); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            title={onReorder ? 'Drag to change its place in the story' : undefined}
            style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 7, height: 28, padding: '0 11px 0 4px', borderRadius: 999, border: `1px solid ${over === c.id ? ink : on ? col : (dark ? '#2a2a30' : '#e3dbcb')}`, background: dark ? '#1a1a1e' : '#fff', color: ink, opacity: drag === c.id ? .4 : active.size && !on ? .5 : 1, transition: 'opacity 200ms ease', cursor: onReorder ? 'grab' : 'default', animation: landing === c.id ? 'sbxSeqLand 600ms ease-out' : undefined }}>
            {/* Its place in the story sits in its colour; the name, one line. */}
            <button type="button" data-seq-swatch={c.id} onClick={(e) => { if (renderOpen) { notePill(e.currentTarget); onOpen(c.id); } else onToggle(c.color); }} aria-label={renderOpen ? `Open sequence ${i + 1}: ${c.name}` : `${on ? 'Stop showing only' : 'Show only'} ${c.name}`} title={renderOpen ? 'Open: its scenes light up' : on ? 'Show everything again' : 'Show only these scenes'}
              style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${on ? ink : 'transparent'}`, background: col, color: '#fff', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, fontFamily: sans, lineHeight: 1 }}>{i + 1}</button>
            <button type="button" data-seq-open={c.id} onClick={(e) => { notePill(e.currentTarget); onOpen(c.id); }} title={`${c.name} · ${c.scenes.length} ${c.scenes.length === 1 ? 'scene' : 'scenes'}`} style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', fontSize: 12, fontWeight: 600, color: ink, cursor: 'pointer', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</button>
            {c.scenes.length > 0 && <span aria-label={`${c.scenes.length} ${c.scenes.length === 1 ? 'scene' : 'scenes'}`} style={{ fontSize: 11, fontWeight: 600, color: muted, fontVariantNumeric: 'tabular-nums' }}>{c.scenes.length}</span>}
          </span></React.Fragment>
        );
      })}
      {onNew && <button type="button" data-seq-new onClick={onNew} title="Make a sequence" style={{ flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999, border: `1px solid ${dark ? '#2a2a30' : '#e3dbcb'}`, background: 'transparent', color: muted, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: sans, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>+</span>Sequence</button>}
      {active.size > 0 && <button type="button" data-legend-clear onClick={onClear} style={{ height: 28, padding: '0 10px', borderRadius: 999, border: 'none', background: 'transparent', color: muted, font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: sans }}>Show all</button>}
      </Chips>
      {paint}
    </div>
  );
}

/** The pill a card is opening out of (Ben, 2026-11-03: "it should morph out
 *  of the pill"): its size, noted at the click, read by the card as it mounts. */
let openingPill: { w: number; h: number } | null = null;
export function notePill(el: Element | null | undefined) {
  const chip = el?.closest('[data-legend-open],[data-seq-chip],[data-subplot-chip]');
  if (!chip) return;
  const r = chip.getBoundingClientRect();
  if (r.width && r.height) openingPill = { w: r.width, h: r.height };
}

/** FIL-708: a pill opened in place, a small index card in the strip. Its
 *  kicker, name, two lines of words, "+ scene", Open card and a close. While
 *  it is open its scenes light on the board and a click adds or removes one.
 *  It scrolls itself into view. */
export function StripCard({ kicker, name, onName, words, color, dark, hint, onAddScene, onOpenCard, onClose, actions, dashed, addSlot, hintStrong = false }: {
  kicker: string; name: string; onName?: (name: string) => void; words?: string; color: string; dark: boolean; hint?: string;
  onAddScene?: () => void; onOpenCard?: () => void; onClose: () => void;
  /** A control in place of "+ scene" (a subplot's Add a scene picker). */
  addSlot?: React.ReactNode;
  /** The hint said loud: in the card's colour, with a pointer (Ben,
   *  2026-11-07, of "click scenes on the board": "make that more obvious"). */
  hintStrong?: boolean;
  /** FIL-711: more buttons (a suggestion's Accept / Dismiss); a dashed frame for a suggestion. */
  actions?: React.ReactNode; dashed?: boolean;
  }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Only a card just opened from its pill grows and scrolls into view. The
  // toolbar is rebuilt when it lifts off to float and when it settles back,
  // and an open card replayed its opening each time (Ben, 2026-11-05: "it
  // collapses and re-expands the sequence card over and over").
  const opening = useRef<{ w: number; h: number } | null | undefined>(undefined);
  if (opening.current === undefined) opening.current = openingPill;
  useLayoutEffect(() => { openingPill = null; }, []);
  useEffect(() => { if (!opening.current) return; try { ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* jsdom */ } }, []);
  // It grows out of its pill: the pill's width, height and round ends, to the
  // card's, the neighbours sliding along; its words fade in once there is room.
  useLayoutEffect(() => {
    const el = ref.current, body = bodyRef.current;
    const pill = opening.current;
    if (!pill || !el || !body || typeof el.animate !== 'function') return;
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return; } catch { /* animate */ }
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const from = pill;
    const ease = 'cubic-bezier(.2,.7,.2,1)';
    el.animate([
      { width: `${from.w}px`, height: `${from.h}px`, borderRadius: `${from.h / 2}px`, borderLeftWidth: '1px' },
      { width: `${w}px`, height: `${h}px`, borderRadius: '4px', borderLeftWidth: getComputedStyle(el).borderLeftWidth },
    ], { duration: 320, easing: ease });
    body.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
  }, []);
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#8a8a93' : '#8a8578';
  const col = shade(color, dark);
  const btn: React.CSSProperties = { font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: ink, whiteSpace: 'nowrap', fontFamily: sans };
  return (
    <div ref={ref} data-strip-card role="group" aria-label={name}
      style={{ flexShrink: 0, width: 280, boxSizing: 'border-box', padding: '9px 12px 10px', borderRadius: 4, background: dark ? '#1e1e22' : '#fffdf7', border: `1.5px ${dashed ? 'dashed' : 'solid'} ${col}`, borderLeftWidth: dashed ? 1.5 : 6, color: ink, fontFamily: sans, overflow: 'hidden', textTransform: 'none', letterSpacing: 0 }}>
      <div ref={bodyRef} style={{ width: 280 - 12 - 6 - 1.5 - 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span data-strip-kicker style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: col, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kicker}</span>
        <button type="button" data-strip-close onClick={onClose} aria-label="Close" title="Close (Esc)" style={{ border: 'none', background: 'transparent', color: muted, cursor: 'pointer', padding: 0, width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
      {onName
        ? <InlineText testId="strip-card-name" value={name} multiline={false} placeholder="name it" onSave={onName} style={{ fontSize: 13.5, fontWeight: 700, color: ink, marginTop: 3, display: 'block' }} />
        : <div data-strip-name style={{ fontSize: 13.5, fontWeight: 700, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>}
      {words && <div data-strip-words style={{ fontSize: 11.5, lineHeight: 1.45, color: dark ? '#b4b4bc' : '#55524a', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{words}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {addSlot ?? (onAddScene && <button type="button" data-strip-add-scene onClick={onAddScene} style={btn}>+ scene</button>)}
        {onOpenCard && <button type="button" data-strip-open-card onClick={onOpenCard} style={btn}>Open card ↗</button>}
        {actions}
      </div>
      {hint && (hintStrong
        ? <div data-strip-hint style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: col, marginTop: 8, padding: '5px 8px', borderRadius: 6, background: `color-mix(in srgb, ${col} ${dark ? 14 : 9}%, transparent)` }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}><path d="M4 4l7 17 2.5-7.5L21 11z" /></svg>
            <span>{hint}</span>
          </div>
        : <div data-strip-hint style={{ fontSize: 11, color: muted, marginTop: 6 }}>{hint}</div>)}
      </div>
    </div>
  );
}
