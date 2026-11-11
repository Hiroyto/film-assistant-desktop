// components/Freeform/corkboard/dialogue.tsx
//
// DIALOGUE (Ben, 2026-10-11): a line of dialogue is not a card. It is a
// slightly special sticky: the writer's exact words, set the way a script
// sets a line (the speaker in capitals over it, in the script face), on the
// scene it belongs to and on the character who says it. Who says it is the
// one thing an ordinary sticky does not have, so it is picked right here.

import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const SCRIPT_FACE = "'Courier Prime','Courier New',Courier,monospace";

export type CastMember = { id: string; name: string };

// QUOTES (Ben, 2026-10-12): a line is shown in quotation marks, and the
// marks are the sticky's, not the words': quotes the writer typed around the
// line are taken off on save (and here, for lines saved before), so a line
// never shows doubled marks. Only marks at the very ends go; a quote inside
// the line is the writer's and stays.
// Double marks go from either end, even alone (a writer who typed only the
// opening one); single marks only as a pair, since a lone one at an end is
// usually an apostrophe ('til, talkin').
const D_OPEN = '"“„«';
const D_CLOSE = '"”“»';
const S_OPEN = "'‘";
const S_CLOSE = "'’";
export function bareLine(text: string): string {
  let t = String(text ?? '').trim();
  for (let k = 0; k < 3 && t; k++) {
    const first = t.charAt(0), last = t.charAt(t.length - 1);
    if (t.length > 1 && S_OPEN.includes(first) && S_CLOSE.includes(last)) { t = t.slice(1, -1).trim(); continue; }
    const opens = D_OPEN.includes(first);
    const closes = t.length > 1 && D_CLOSE.includes(last);
    if (!opens && !closes) break;
    t = t.slice(opens ? 1 : 0, closes ? -1 : undefined).trim();
  }
  return t;
}
export const quotedLine = (text: string) => `\u201c${bareLine(text)}\u201d`;
/** The characters a line can be given to, and their names by id. */
export const CastCtx = createContext<{ list: CastMember[]; nameOf: (id: string | null | undefined) => string }>({ list: [], nameOf: () => '' });
export const useCast = () => useContext(CastCtx);

/** The line as a script sets it: the cue (speaker) over the words. */
export function DialogueFace({ text, speaker, dark, size = 12 }: { text: string; speaker?: string | null; dark: boolean; size?: number }) {
  const { nameOf } = useCast();
  const name = nameOf(speaker);
  return (
    <div data-dialogue-face style={{ fontFamily: SCRIPT_FACE, textAlign: 'center' }}>
      <div data-dialogue-cue style={{ fontSize: size - 1, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', opacity: name ? 1 : .55, marginBottom: 2 }}>
        {name || 'who says it?'}
      </div>
      <div style={{ fontSize: size, lineHeight: 1.35, color: dark ? '#f6f4ee' : '#22303f' }}>{quotedLine(text)}</div>
    </div>
  );
}

/** A line's note (Ben, 2026-10-12: "an extra note that should be under the
 *  dialogue, not treated like a header"): a quiet aside under the words.
 *  Shared by the board, the focus and the editor. */
export const NOTE_STYLE: React.CSSProperties = { marginTop: 5, fontFamily: 'system-ui, sans-serif', fontSize: 10.5, fontStyle: 'italic', fontWeight: 400, lineHeight: 1.35, opacity: .78, textAlign: 'center', letterSpacing: 0, textTransform: 'none' };
export function LineNote({ text, center = true }: { text: string; center?: boolean }) {
  return text ? <div data-line-note style={{ ...NOTE_STYLE, textAlign: center ? 'center' : 'left' }}>{text}</div> : null;
}

/** Who says it: the story's characters, or no one yet (Ben, 2026-10-12:
 *  the system dropdown was "awful"). A cue-styled button that opens a small
 *  menu in the board's own look, in the script face: filter by typing when
 *  the cast is long, arrows and Enter, Esc to close. The menu is portalled
 *  (so no card can sit over it) and marked [data-speaker-menu], which the
 *  editors treat as part of themselves when focus moves into it. */
export function SpeakerPick({ value, onPick, dark, testId }: { value: string | null | undefined; onPick: (id: string) => void; dark: boolean; testId?: string }) {
  const { list, nameOf } = useCast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const name = nameOf(value);
  const opts = [{ id: '', name: 'No one yet' }, ...list].filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const W = 220;
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), (typeof window !== 'undefined' ? window.innerWidth : 1200) - W - 8);
    setAt({ left, top: r.bottom + 4 });
  };
  const openMenu = () => { place(); setQ(''); setHi(Math.max(0, [{ id: '' }, ...list].findIndex((c) => c.id === (value ?? '')))); setOpen(true); };
  const close = (refocus = true) => { setOpen(false); if (refocus) { try { btnRef.current?.focus({ preventScroll: true }); } catch { btnRef.current?.focus(); } } };
  const pick = (id: string) => { onPick(id); close(); };
  useLayoutEffect(() => { if (open && list.length > 6) filterRef.current?.focus({ preventScroll: true }); else if (open) menuRef.current?.focus({ preventScroll: true }); }, [open, list.length]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => place();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true); };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = opts[Math.min(hi, opts.length - 1)]; if (o) pick(o.id); }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const ink = dark ? '#f6f4ee' : '#22303f';
  return (
    <>
      <button
        ref={btnRef} type="button" data-speaker-pick={testId ?? ''} aria-haspopup="listbox" aria-expanded={open}
        title="Who says it"
        onClick={(e) => { e.stopPropagation(); if (open) close(false); else openMenu(); }}
        onPointerDown={stop} onPointerUp={stop}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); openMenu(); } }}
        style={{
          alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', cursor: 'pointer',
          font: 'inherit', fontFamily: SCRIPT_FACE, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '1px 6px', borderRadius: 4, border: `1px dashed ${dark ? 'rgba(255,255,255,.35)' : 'rgba(34,48,63,.3)'}`,
          background: open ? (dark ? 'rgba(255,255,255,.08)' : 'rgba(34,48,63,.06)') : 'transparent', color: ink, opacity: name ? 1 : .7,
        }}
      >
        {/* The face is set on the span: the app's global rule puts every
            button in the system face, and it wins over a button's own style. */}
        <span style={{ fontFamily: SCRIPT_FACE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Who says it?'}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden style={{ flexShrink: 0, opacity: .6 }}><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && at && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef} data-speaker-menu role="listbox" aria-label="Who says it" tabIndex={-1}
          onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop} onKeyDown={onKey}
          style={{
            position: 'fixed', left: at.left, top: at.top, width: W, zIndex: 1000, outline: 'none',
            background: dark ? '#1c1c20' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e3e0d6'}`, borderRadius: 9,
            boxShadow: '0 14px 36px rgba(0,0,0,.22)', padding: 4, fontFamily: 'system-ui, sans-serif',
          }}
        >
          {list.length > 6 && (
            <input
              ref={filterRef} value={q} placeholder="Find a character" aria-label="Find a character"
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '6px 8px', marginBottom: 4, borderRadius: 6, border: `1px solid ${dark ? '#2e2e35' : '#e6e3da'}`, background: dark ? '#141417' : '#fbfaf7', color: dark ? '#e6e6ea' : '#1d2230', outline: 'none' }}
            />
          )}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {opts.map((c, i) => {
              const on = (value ?? '') === c.id;
              return (
                <button
                  key={c.id || '_none'} type="button" role="option" aria-selected={on} data-speaker-option={c.id}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                    padding: '6px 8px', borderRadius: 6, font: 'inherit',
                    fontFamily: c.id ? SCRIPT_FACE : 'system-ui, sans-serif', fontSize: c.id ? 12 : 12, fontWeight: c.id ? 700 : 500,
                    letterSpacing: c.id ? '.04em' : 0, textTransform: c.id ? 'uppercase' : 'none',
                    background: i === hi ? (dark ? 'rgba(150,190,250,.16)' : '#e9f0fb') : 'transparent',
                    color: c.id ? (dark ? '#e6e6ea' : '#22303f') : (dark ? '#9a9aa4' : '#777'),
                  }}
                >
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: on ? (dark ? '#9cbcf0' : '#3a68b0') : 'transparent' }} />
                  <span style={{ fontFamily: c.id ? SCRIPT_FACE : 'system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </button>
              );
            })}
            {!opts.length && <div style={{ padding: '6px 8px', fontSize: 12, color: dark ? '#9a9aa4' : '#888' }}>No one by that name.</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
