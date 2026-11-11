// components/Freeform/corkboard/stickyMenu.tsx
//
// WHAT A STICKY BECOMES (Ben, 2026-10-31): one menu, two ways in. Right-click
// a sticky (Philip, 2026-10-30: "my instinct is to right click") or click its
// "Sticky ▾" label (for hands that never right-click). From it the sticky is
// turned into a scene, character, world entry or sequence in its place (the
// whole sticky becomes the card's words; the card starts unnamed), or put on
// a card that exists. Dragging it onto a card still works, and now
// asks first (DropConfirm).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { plainOf } from './richText';
import { STICKY_COLOR_KEYS, STICKY_PAPER } from './sandbox';

export type MenuCard = { id: string; name: string; kind: 'scene' | 'character' | 'world'; suggested?: boolean };
/** What a sticky can be turned into. */
export type TurnKind = 'scene' | 'character' | 'world' | 'sequence';

/** Longest world title kept whole. */
const NAME_MAX = 80;

/** A world entry needs a title (its id is its name) though its strip shows
 *  only its words: the sticky's first line, cut near 80 characters, never
 *  seen. A card from a sticky takes no name at all (Ben, 2026-11-01). */
export function worldTitleOf(text: string): string {
  const first = plainOf(text).split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (first.length <= NAME_MAX) return first;
  const cut = first.slice(0, NAME_MAX + 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut.slice(0, NAME_MAX)).trim()}…`;
}

const KIND_WORD: Record<MenuCard['kind'], string> = { scene: 'Scene', character: 'Character', world: 'World' };
const KIND_DOT: Record<MenuCard['kind'], string> = { scene: '#2f6fd6', character: '#e67e22', world: '#4f7a42' };

export function StickyMenu({ at, dark, line, cards, color, onColor, onTurnInto, onPutOn, onUnpin, onUngroup, onDelete, onClose }: {
  /** Viewport point the menu opens at. */
  at: { x: number; y: number };
  dark: boolean;
  /** A line of dialogue: it goes on a scene or to a character, never becomes one. */
  line?: boolean;
  /** Cards it can go on, the likeliest first. */
  cards: MenuCard[];
  /** The writer's colour for it (a sticky paper key), or none. */
  color?: string;
  onColor?: (color: string) => void;
  onTurnInto?: (kind: TurnKind) => void;
  onPutOn: (cardId: string) => void;
  /** A pinned sticky: take it off its card, loose beside it (2026-11-01). */
  onUnpin?: () => void;
  /** A grouped sticky: take it out of its group (2026-11-02). */
  onUngroup?: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [pane, setPane] = useState<'main' | 'put'>('main');
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [armed, setArmed] = useState(false);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? cards.filter((c) => c.name.toLowerCase().includes(t)) : cards;
  }, [cards, q]);
  // Closes on a press anywhere else, on Esc, and when the board scrolls; a
  // scroll inside the menu scrolls the menu (Ben, 2026-11-01: it popped away).
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const wheel = (e: WheelEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (pane === 'put') { setPane('main'); setQ(''); } else onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('wheel', wheel); };
  }, [onClose, pane]);
  useEffect(() => { if (pane === 'put') filterRef.current?.focus(); else ref.current?.focus(); }, [pane]);
  const W = 248;
  const { left, fit } = useMenuFit(ref, at, W, [pane, shown.length]);

  const ink = dark ? '#e6e6ea' : '#1d2230';
  const faint = dark ? '#7a7a84' : '#9a9ea8';
  const hover = dark ? 'rgba(255,255,255,.07)' : 'rgba(29,34,48,.06)';
  const row = (on = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
    padding: '7px 9px', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550, color: ink, background: on ? hover : 'transparent',
  });
  const pick = (id: string) => { onPutOn(id); onClose(); };
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = shown[Math.min(hi, shown.length - 1)]; if (c) pick(c.id); }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      ref={ref} data-sticky-menu role="menu" aria-label="Sticky" tabIndex={-1}
      onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop} onContextMenu={(e) => { e.preventDefault(); stop(e); }}
      style={{
        position: 'fixed', left, top: fit.top, width: W, zIndex: 1000, outline: 'none',
        ...(fit.maxH ? { maxHeight: fit.maxH, overflowY: 'auto', overscrollBehavior: 'contain' } : {}),
        background: dark ? '#1c1c20' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e3e0d6'}`, borderRadius: 10,
        boxShadow: '0 14px 36px rgba(0,0,0,.22)', padding: 5, fontFamily: 'system-ui, sans-serif',
      }}
    >
      {pane === 'main' ? (
        <>
          {/* Its colour (Ben, 2026-10-31: free colour coding, unnamed): the
              paper it shows is marked; a click paints it and the menu stays,
              so colours can be tried. */}
          {onColor && (
            <>
              <div role="group" aria-label="Color" data-sticky-menu-colors style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px 7px' }}>
                {STICKY_COLOR_KEYS.map((k) => {
                  const on = color === k;
                  return (
                    <button
                      key={k} type="button" data-sticky-color={k} aria-label={k} aria-pressed={on} title={k}
                      onClick={() => { if (!on) onColor(k); }}
                      style={{ width: 18, height: 18, borderRadius: '50%', padding: 0, cursor: 'pointer', background: dark ? STICKY_PAPER[k].dark : STICKY_PAPER[k].light, border: on ? `2px solid ${dark ? '#f2f2f4' : '#1d2230'}` : `1px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(29,34,48,.16)'}`, boxSizing: 'border-box' }}
                    />
                  );
                })}
              </div>
              <Sep dark={dark} />
            </>
          )}
          {/* What it becomes (Ben, 2026-10-31): any kind of card; the whole
              sticky is its words and the card starts unnamed (2026-11-01). */}
          {!line && onTurnInto && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: faint, padding: '5px 9px 3px' }}>Turn into</div>
              <MenuItem dark={dark} testId="turn-scene" label="Scene" icon={<SceneGlyph />} onClick={() => { onTurnInto('scene'); onClose(); }} />
              <MenuItem dark={dark} testId="turn-character" label="Character" icon={<PersonGlyph />} onClick={() => { onTurnInto('character'); onClose(); }} />
              <MenuItem dark={dark} testId="turn-world" label="World" icon={<GlobeGlyph />} onClick={() => { onTurnInto('world'); onClose(); }} />
              <MenuItem dark={dark} testId="turn-sequence" label="Sequence" icon={<StackGlyph />} onClick={() => { onTurnInto('sequence'); onClose(); }} />
              {/* A subplot has no home on the sandbox until the strip (FIL-707/709);
                  made now, the sticky would vanish into nothing on the board. */}
              <div title="Comes with the strip" style={{ ...row(), cursor: 'default', color: faint }} data-sticky-menu-item="turn-subplot">
                <span aria-hidden style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}><ThreadGlyph /></span>
                <span style={{ flex: 1 }}>Subplot</span>
                <span style={{ fontSize: 10.5 }}>soon</span>
              </div>
              <Sep dark={dark} />
            </>
          )}
          <div title="Coming soon" style={{ ...row(), cursor: 'default', color: faint }} data-sticky-menu-item="media">
            <span aria-hidden style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}><ImageGlyph /></span>
            <span style={{ flex: 1 }}>Add image or link</span>
            <span style={{ fontSize: 10.5 }}>soon</span>
          </div>
          <MenuItem dark={dark} testId="put-on" label={onUnpin ? 'Move to another card' : line ? 'Put on a scene or character' : 'Put on a card'} hint="›" icon={<PinGlyph />} onClick={() => { setPane('put'); setHi(0); }} />
          {onUnpin && <MenuItem dark={dark} testId="unpin" label="Unpin from the card" icon={<PinGlyph />} onClick={() => { onUnpin(); onClose(); }} />}
          {onUngroup && <MenuItem dark={dark} testId="ungroup" label="Take out of the group" icon={<StackGlyph />} onClick={() => { onUngroup(); onClose(); }} />}
          <Sep dark={dark} />
          <MenuItem dark={dark} testId="delete" danger label={armed ? 'Sure? Click again' : 'Delete'} icon={<BinGlyph />}
            onClick={() => { if (armed) { onDelete(); onClose(); } else { setArmed(true); window.setTimeout(() => setArmed(false), 3000); } }} />
        </>
      ) : (
        <div onKeyDown={onListKey}>
          <button type="button" data-sticky-menu-item="back" onClick={() => { setPane('main'); setQ(''); }} style={{ ...row(), fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: faint, padding: '5px 8px' }}>‹ Put on a card</button>
          <input
            ref={filterRef} value={q} placeholder="Find a card" aria-label="Find a card"
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '6px 8px', margin: '2px 0 4px', borderRadius: 6, border: `1px solid ${dark ? '#2e2e35' : '#e6e3da'}`, background: dark ? '#141417' : '#fbfaf7', color: ink, outline: 'none' }}
          />
          <div role="listbox" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {shown.length === 0 && <div style={{ padding: '8px 9px', fontSize: 12, color: faint }}>{cards.length ? 'No card by that name' : 'No cards on the board yet'}</div>}
            {shown.map((c, i) => (
              <button
                key={c.id} type="button" role="option" aria-selected={i === hi} data-sticky-menu-card={c.id}
                onMouseEnter={() => setHi(i)} onClick={() => pick(c.id)} style={row(i === hi)}
              >
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: c.kind === 'character' ? '50%' : 2, flexShrink: 0, background: KIND_DOT[c.kind] }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.name || 'Untitled'}</span>
                <span style={{ fontSize: 10.5, color: faint, flexShrink: 0 }}>{c.suggested ? 'likely' : KIND_WORD[c.kind]}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: '6px 9px 3px', fontSize: 11, color: faint, borderTop: `1px solid ${dark ? '#2a2a30' : '#efece4'}`, marginTop: 4 }}>or drag the sticky onto a card</div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** A sticky dropped on a card asks first (Ben, 2026-10-31). Enter puts it
 *  on; Esc or a press anywhere else sends it back to where it was. */
export function DropConfirm({ at, dark, question, yes, onYes, onNo }: { at: { x: number; y: number }; dark: boolean; question: string; yes: string; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onNo(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onYes(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onNo(); }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onYes, onNo]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      ref={ref} data-drop-confirm role="dialog" aria-label={question}
      onPointerDown={stop} onPointerUp={stop} onClick={stop}
      style={{
        position: 'absolute', left: 0, top: 0, transform: `translate(${at.x}px, ${at.y}px)`, zIndex: 42,
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 4px 12px', borderRadius: 999,
        background: dark ? '#1c1c20' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e3e0d6'}`,
        boxShadow: '0 10px 28px rgba(0,0,0,.18)', fontFamily: 'system-ui, sans-serif', fontSize: 12.5, color: dark ? '#e6e6ea' : '#1d2230', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, marginRight: 2 }}>{question}</span>
      <button type="button" data-drop-confirm-no onClick={onNo} style={{ font: 'inherit', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: 'inherit' }}>Cancel</button>
      <button type="button" data-drop-confirm-yes onClick={onYes} style={{ font: 'inherit', fontSize: 12, fontWeight: 700, padding: '4px 14px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#ff8c42', color: '#fff' }}>{yes}</button>
    </div>
  );
}

/** Kept on screen, measured (2026-11-01: opened low, it ran off the page):
 *  moved up or left as far as it needs, and when it is taller than the
 *  window it fits the window and scrolls inside. */
function useMenuFit(ref: React.RefObject<HTMLDivElement | null>, at: { x: number; y: number }, width: number, deps: unknown[]) {
  const left = Math.max(8, Math.min(at.x, (typeof window !== 'undefined' ? window.innerWidth : 1400) - width - 8));
  const [fit, setFit] = useState<{ top: number; maxH?: number }>({ top: at.y });
  useLayoutEffect(() => {
    const el = ref.current;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const h = el ? el.scrollHeight : 0;
    if (!h) { setFit({ top: Math.max(8, at.y) }); return; }
    if (h > vh - 16) setFit({ top: 8, maxH: vh - 16 });
    else setFit({ top: Math.max(8, Math.min(at.y, vh - h - 8)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.x, at.y, ...deps]);
  return { left, fit };
}

/** What the read of a group suggested (the badge), when there is one. */
export type GroupSuggestion = { kind: string; worldKind?: string; title: string; summary: string; addTo?: { id: string; title: string; type: string } | null };
type MakeKind = 'scene' | 'character' | 'world';

/** WHAT A GROUP BECOMES (Ben, 2026-11-02: "a drop down akin to our sticky
 *  drop down. clean and simple", then "too many options, there needs to be
 *  like a green button that someone can press here to confirm"). With a
 *  suggestion: what it reads as, in full, and ONE green button that does it
 *  (Make it a scene, or Add to the card it is about); "Something else" and
 *  "Not yet" stay quiet underneath. A group nobody read has nothing to
 *  confirm: it lists the three kinds. */
export function GroupMenu({ at, dark, suggestion, onMake, onAddTo, onNotYet, onClose }: {
  at: { x: number; y: number };
  dark: boolean;
  suggestion?: GroupSuggestion | null;
  onMake: (kind: MakeKind) => void;
  onAddTo?: (cardId: string) => void;
  onNotYet?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [others, setOthers] = useState(false);
  useEffect(() => {
    const out = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', out, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', out, { passive: true });
    return () => { window.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', key, true); window.removeEventListener('wheel', out); };
  }, [onClose]);
  useEffect(() => { ref.current?.focus(); }, []);
  const W = 264;
  const { left, fit } = useMenuFit(ref, at, W, [suggestion?.title, others]);
  const faint = dark ? '#7a7a84' : '#9a9ea8';
  const ink = dark ? '#e6e6ea' : '#1d2230';
  const green = dark ? '#34d399' : '#059669';
  const s = suggestion;
  const addTo = s?.addTo && onAddTo ? s.addTo : null;
  const kindWord = (k: string) => (k === 'world' ? 'a world card' : `a ${k}`);
  const kindLine = !s ? '' : s.addTo ? `Notes on ${s.addTo.title}` : s.kind === 'world' ? `Reads as world${s.worldKind && s.worldKind !== 'other' ? ` · ${s.worldKind}` : ''}` : `Reads as a ${s.kind}`;
  const make = (k: MakeKind) => { onMake(k); onClose(); };
  const kinds: Array<[MakeKind, string, React.ReactNode]> = [['scene', 'Scene', <SceneGlyph />], ['character', 'Character', <PersonGlyph />], ['world', 'World', <GlobeGlyph />]];
  // With a suggestion, the green button is the suggested kind; Something
  // else offers the other two (or all three when the button is Add to).
  const rest = kinds.filter(([k]) => addTo || k !== s?.kind);
  const big: React.CSSProperties = { font: 'inherit', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left', padding: '8px 11px', borderRadius: 8, cursor: 'pointer' };
  const quiet: React.CSSProperties = { font: 'inherit', fontSize: 12, fontWeight: 550, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', border: 'none', background: 'transparent', color: faint };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      ref={ref} data-group-menu role="menu" aria-label="Group" tabIndex={-1}
      onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop} onContextMenu={(e) => { e.preventDefault(); stop(e); }}
      style={{
        position: 'fixed', left, top: fit.top, width: W, zIndex: 1000, outline: 'none',
        ...(fit.maxH ? { maxHeight: fit.maxH, overflowY: 'auto', overscrollBehavior: 'contain' } : {}),
        background: dark ? '#1c1c20' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e3e0d6'}`, borderRadius: 10,
        boxShadow: '0 14px 36px rgba(0,0,0,.22)', padding: 5, fontFamily: 'system-ui, sans-serif',
      }}
    >
      {s ? (
        <>
          <div data-group-suggestion style={{ padding: '7px 9px 4px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: faint }}>{kindLine}</div>
            {s.title && <div style={{ fontSize: 13, fontWeight: 650, color: ink, marginTop: 3, lineHeight: 1.3 }}>{s.title}</div>}
            {s.summary && <div style={{ fontSize: 12, color: dark ? '#a8a8b2' : '#5f6470', marginTop: 3, lineHeight: 1.4 }}>{s.summary}</div>}
          </div>
          {/* Two choices of the same weight, each saying what it does (Ben,
              2026-11-02: "leave not yet as a big button too on the same
              scale with the consequences of hitting that button"). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 4px 4px' }}>
            <button
              type="button" data-group-confirm
              onClick={() => { if (addTo) { onAddTo!(addTo.id); onClose(); } else make(s.kind as MakeKind); }}
              style={{ ...big, border: 'none', background: green, color: '#fff' }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>{addTo ? `Add to ${addTo.title}` : `Make it ${kindWord(s.kind)}`}</span>
              <span data-consequence style={{ fontSize: 11, fontWeight: 500, opacity: .9 }}>{addTo ? 'These stickies go on that card.' : `${s.kind === 'world' ? 'A world card' : s.kind === 'character' ? 'A character card' : 'A scene card'} with this name; the stickies go on it.`}</span>
            </button>
            {onNotYet && (
              <button
                type="button" data-sticky-menu-item="not-yet"
                onClick={() => { onNotYet(); onClose(); }}
                style={{ ...big, border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: dark ? '#232328' : '#fff', color: ink }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>Not yet</span>
                <span data-consequence style={{ fontSize: 11, fontWeight: 500, color: faint }}>They stay a loose group, and this suggestion goes away.</span>
              </button>
            )}
          </div>
          {others && (
            <div data-group-others>
              {rest.map(([k, label, icon]) => <MenuItem key={k} dark={dark} testId={`make-${k}`} label={addTo ? `Make it ${kindWord(k)}` : label} icon={icon} onClick={() => make(k)} />)}
            </div>
          )}
          {!others && (
            <div style={{ padding: '0 2px 2px' }}>
              <button type="button" data-group-other onClick={() => setOthers(true)} style={quiet}>Something else ▾</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: faint, padding: '5px 9px 3px' }}>Make it</div>
          {kinds.map(([k, label, icon]) => <MenuItem key={k} dark={dark} testId={`make-${k}`} label={label} icon={icon} onClick={() => make(k)} />)}
        </>
      )}
    </div>,
    document.body,
  );
}

function MenuItem({ dark, label, hint, onClick, danger, testId, icon }: { dark: boolean; label: React.ReactNode; hint?: string; onClick: () => void; danger?: boolean; testId: string; icon?: React.ReactNode }) {
  const [h, setH] = useState(false);
  return (
    <button type="button" role="menuitem" data-sticky-menu-item={testId} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
        padding: '7px 9px', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550,
        color: danger ? (dark ? '#ff8a7a' : '#c0392b') : (dark ? '#e6e6ea' : '#1d2230'),
        background: h ? (dark ? 'rgba(255,255,255,.07)' : 'rgba(29,34,48,.06)') : 'transparent',
      }}>
      <span aria-hidden style={{ width: 16, display: 'inline-flex', justifyContent: 'center', opacity: .8 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: dark ? '#7a7a84' : '#9a9ea8' }}>{hint}</span>}
    </button>
  );
}

function Sep({ dark }: { dark: boolean }) { return <div aria-hidden style={{ height: 1, margin: '4px 6px', background: dark ? '#2a2a30' : '#efece4' }} />; }
const glyph = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function SceneGlyph() { return <svg {...glyph}><rect x="2" y="3" width="12" height="10" rx="1.2" /><path d="M2 6h12" /></svg>; }
function PinGlyph() { return <svg {...glyph}><path d="M8 14V9" /><path d="M5 2h6l-1 4 2 3H4l2-3z" /></svg>; }
function PersonGlyph() { return <svg {...glyph}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 14c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3" /></svg>; }
function GlobeGlyph() { return <svg {...glyph}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" /></svg>; }
function StackGlyph() { return <svg {...glyph}><rect x="2" y="5" width="12" height="9" rx="1.2" /><path d="M4 3h8" /></svg>; }
function ThreadGlyph() { return <svg {...glyph}><path d="M2 12c3 0 3-8 6-8s3 8 6 8" /></svg>; }
function ImageGlyph() { return <svg {...glyph}><rect x="2" y="3" width="12" height="10" rx="1.2" /><circle cx="6" cy="7" r="1.2" /><path d="M14 11l-3.5-3L5 13" /></svg>; }
function BinGlyph() { return <svg {...glyph}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></svg>; }
