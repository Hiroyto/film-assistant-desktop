// components/Freeform/corkboard/sandboxReceipt.tsx (FIL-641, anchor section 8)
//
// THE SANDBOX DUMP RECEIPT: the master's floating receipt (336 wide, bars,
// eyebrow, drag handle, same berth) in REVIEW MODE. It walks its items one at
// a time and the board moves with it: the page centres the thing the item is
// about and lights it with the jump ring. The review is required (Ben,
// 2026-10-05): it opens on landing, prev / next / arrow keys, Next can skip
// (the item stays pending), and the green Done appears only at the last item.
// Mock: https://claude.ai/artifact/E8G4MvMvXwazFWuX5uDZH7.
//
// Five kinds of line (mock): pending (orange, a change to an existing card),
// ready (green, a huddle the extractor would mint), attached (gold, done with
// undo), story (sage, an overview card), frame (grey, what fell through).
// Today's dumps produce stickies and parked cards, so the lines that exist
// are 'card', 'sticky', 'story'; the rest arrive with FIL-640 / FIL-652.

import React, { useEffect, useRef, useState } from 'react';
import { useThemeMode } from './theme';
import InternIcon from '../InternIcon';
import { PEER_BLUE, PEER_BLUE_INK, PEER_BLUE_LIGHT } from '../tokens';

export type ReviewLine = 'card' | 'sticky' | 'story' | 'pending' | 'ready' | 'attached' | 'frame' | 'peer';

export interface ReviewItem {
  /** The board item to centre and light (a card id, a sticky id, or a group id). */
  targetId: string;
  line: ReviewLine;
  /** "On the board · The office", "Loose · sticky", "About the story". */
  where: string;
  /** One line, bold: what happened or what is asked. */
  heading: string;
  /** The writer's own words, quoted. */
  quote: string;
  /** One quiet sentence under it. */
  note?: string;
  /** Answer buttons. Absent = nothing to answer. */
  actions?: Array<{ label: string; primary?: boolean; onPick: () => void }>;
  /** Set once answered or when there was nothing to answer. */
  done?: string;
  /** Must be answered before the receipt can close (2026-10-13: same scene or new scene). */
  required?: boolean;
  /** The question this item answers, for the page to mark it done. */
  questionId?: string;
  /** What the writer can do with it, in one quiet line (the Peer's receipt: click to answer). */
  hint?: string;
}

const LINE_COLOR: Record<ReviewLine, { light: string; dark: string }> = {
  card: { light: '#3b82f6', dark: '#76a8f9' },
  sticky: { light: '#b8891c', dark: '#e9bf89' },
  story: { light: '#6f9a5f', dark: '#8bbf7a' },
  pending: { light: '#ff8c42', dark: '#ff8c42' },
  ready: { light: '#059669', dark: '#34d399' },
  attached: { light: '#e0a456', dark: '#e9bf89' },
  frame: { light: '#888', dark: '#82828c' },
  // A question the Peer left (2026-10-21).
  peer: { light: '#0e7490', dark: '#7dd3f0' },
};

export function lineColor(line: ReviewLine, dark: boolean): string {
  return dark ? LINE_COLOR[line].dark : LINE_COLOR[line].light;
}

export function SandboxReceipt({
  items,
  lede,
  onStep,
  onDone,
  top = 96,
  peer = false,
}: {
  items: ReviewItem[];
  /** "Dump 4: 2 cards, 3 stickies, 1 about the story". */
  lede: string;
  /** Fires with the current item whenever the walk moves, so the page can
   *  centre and light its target. */
  onStep: (item: ReviewItem, index: number) => void;
  onDone: () => void;
  top?: number;
  /** The Peer's receipt (2026-10-21): its own colour and mark, never "from your dump". */
  peer?: boolean;
}) {
  const dark = useThemeMode() === 'dark';
  const [idx, setIdx] = useState(0);
  const n = items.length;
  const pending = items.filter((i) => i.actions && i.actions.length && !i.done).length;
  const settled = pending === 0;
  // The receipt does not close while a required question is open.
  const blocking = items.filter((i) => i.required && !i.done).length;

  useEffect(() => { if (items[idx]) onStep(items[idx], idx); }, [idx, items, onStep]);

  // Arrow keys walk; nothing else is captured.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(n - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  // Drag by the header, clamped on screen.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setAt({ left: r.left, top: r.top });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setAt({ left: Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - 336 - 8), top: Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - 120) });
  };
  const onHandleUp = () => { dragRef.current = null; };

  const item = items[idx];
  if (!item) return null;
  const color = lineColor(item.line, dark);
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#82828c' : '#888';
  const faint = dark ? '#63636d' : '#aaa';
  const hair = dark ? '#26262b' : '#ece5d7';
  const seq = peer ? (dark ? PEER_BLUE_LIGHT : PEER_BLUE_INK) : dark ? '#64d68e' : '#22c55e';
  const accent = peer ? PEER_BLUE : '#ff8c42';
  const edge = peer ? 'rgba(84,191,219,.55)' : settled ? 'rgba(34,197,94,.4)' : 'rgba(255,107,53,.55)';
  const serif = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
  const btn = (primary?: boolean): React.CSSProperties => ({
    font: 'inherit', fontSize: 11, fontWeight: 600, minHeight: 26, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
    border: primary ? '1px solid transparent' : `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`,
    background: primary ? '#ff8c42' : 'transparent', color: primary ? '#fff' : ink,
  });

  const bars = (['card', 'sticky', 'story', 'pending', 'ready', 'peer'] as ReviewLine[])
    .map((l) => ({ l, w: items.filter((i) => i.line === l).length }))
    .filter((b) => b.w > 0);

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={peer ? 'From the Peer' : 'From your dump'}
      data-sandbox-receipt
      {...(peer ? { 'data-peer-receipt': '' } : {})}
      style={{
        position: 'fixed', zIndex: 200, width: 336,
        ...(at ? { left: at.left, top: at.top } : { right: 20, top }),
        background: dark ? '#1a1a1e' : '#fff', borderRadius: 11, overflow: 'hidden',
        border: `1px solid ${edge}`,
        boxShadow: `${dark ? '-8px 0 28px rgba(0,0,0,.4)' : '-8px 0 28px rgba(0,0,0,.08)'}, 0 0 0 3px ${peer ? 'rgba(84,191,219,.14)' : 'rgba(255,107,53,.09)'}`,
        fontFamily: 'system-ui, sans-serif', color: ink, userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', height: 4 }}>
        {bars.map((b) => <span key={b.l} style={{ flex: b.w, background: lineColor(b.l, dark) }} />)}
      </div>
      <div style={{ padding: '0 14px 12px' }}>
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          style={{ display: 'flex', alignItems: 'center', gap: 7, paddingTop: 11, marginBottom: 8, cursor: 'grab', touchAction: 'none' }}
        >
          {peer
            ? <span style={{ color: seq, display: 'inline-flex', flex: 'none' }}><InternIcon size={16} /></span>
            : <span style={{ width: 14, height: 14, borderRadius: 4, background: 'linear-gradient(135deg,#ff6b35,#ff8c42)', flex: 'none' }} />}
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: peer ? seq : faint }}>{peer ? 'From the Peer' : 'From your dump'}</span>
          {!peer && <span style={{
            marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: '.4px', borderRadius: 20, padding: '2px 7px', whiteSpace: 'nowrap',
            color: settled ? seq : '#ff6b35', border: `1px solid ${settled ? 'rgba(34,197,94,.4)' : 'rgba(255,107,53,.35)'}`, background: settled ? 'rgba(34,197,94,.12)' : 'transparent',
          }}>{settled ? 'nothing waiting' : 'waiting on you'}</span>}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, marginBottom: 10 }}>{lede}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button type="button" aria-label="Previous" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} style={{ font: 'inherit', width: 26, height: 26, borderRadius: 6, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? .35 : 1, fontSize: 13, lineHeight: 1 }}>‹</button>
          <span style={{ fontSize: 11, fontWeight: 700, color: muted, minWidth: 48, textAlign: 'center' }}>{idx + 1} of {n}</span>
          <button type="button" aria-label="Next" disabled={idx === n - 1} onClick={() => setIdx((i) => Math.min(n - 1, i + 1))} style={{ font: 'inherit', width: 26, height: 26, borderRadius: 6, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: idx === n - 1 ? 'default' : 'pointer', opacity: idx === n - 1 ? .35 : 1, fontSize: 13, lineHeight: 1 }}>›</button>
          <span style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {items.map((it, i) => (
              <i key={it.targetId + i} style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: i === idx ? accent : (it.done || !it.actions?.length) && i < idx ? seq : (dark ? '#2e2e36' : '#e4e4ea') }} />
            ))}
          </span>
        </div>

        <div style={{ border: `1px solid ${hair}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, color }}>
            <i style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: color }} />{item.where}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{item.heading}</div>
          {item.quote && <div style={{ fontSize: 12.5, borderLeft: '2px solid #ff8c42', paddingLeft: 10, fontFamily: serif }}>{item.quote}</div>}
          {/* The grey line only explains a question's choices (Ben, 2026-10-17:
              dropped everywhere else). */}
          {item.note && item.required && <div style={{ fontSize: 11, color: muted }}>{item.note}</div>}
          {item.hint && <div data-receipt-hint style={{ fontSize: 11, color: peer ? seq : muted, display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>{peer && <span aria-hidden style={{ fontSize: 12 }}>{'\u2197'}</span>}{item.hint}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
            {item.done && <span style={{ fontSize: 11, color: seq, fontWeight: 600 }}>{item.done}</span>}
            {!item.done && item.actions?.map((a) => (
              <button key={a.label} type="button" onClick={() => { a.onPick(); setIdx((i) => Math.min(n - 1, i + 1)); }} style={btn(a.primary)}>{a.label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span style={{ flex: 1 }} />
          {blocking > 0 && (
            <span data-receipt-blocking style={{ fontSize: 11, color: '#ff6b35', fontWeight: 600 }}>
              {blocking === 1 ? 'Answer the scene question to close' : `Answer ${blocking} scene questions to close`}
            </span>
          )}
          {idx === n - 1 && blocking === 0 && (
            <button
              type="button"
              onClick={onDone}
              aria-label="Done, close the receipt"
              style={{
                font: 'inherit', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 9px', borderRadius: 999, minHeight: 30, cursor: 'pointer',
                border: `1px solid ${settled ? seq : 'rgba(34,197,94,.45)'}`, background: settled ? seq : 'rgba(34,197,94,.12)', color: settled ? '#fff' : seq,
                boxShadow: settled ? `0 0 0 3px ${peer ? 'rgba(84,191,219,.22)' : 'rgba(34,197,94,.18)'}` : 'none',
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: '50%', background: settled ? '#fff' : seq, color: settled ? seq : '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
