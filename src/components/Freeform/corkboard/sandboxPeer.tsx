// components/Freeform/corkboard/sandboxPeer.tsx (the Peer on the sandbox, 2026-10-20)
//
// The Peer's questions on the sandbox board (design: "The Peer on the
// Sandbox"). On demand only: the toolbar's Peer button asks for a board pass;
// the opened card has a Peer pill.
//
// A Peer question is a sticky (Ben, 2026-10-20: "this should look like a
// sticky, but with the Peer logo on it"): the board's own paper and shadow,
// square corners, serif words, in the question paper (pale blue, deep teal in
// dark), with the glasses and "Peer" where a writer's sticky shows its dump.
// The question alone for now (Ben, 2026-10-20: the writer's quoted words
// are off the sticky; the quote stays on the record, where the grounding
// check uses it). It never counts toward a card.
//
// Where they show:
//   - folded (the default, and "Hide Peer questions"): one small Peer sticky
//     on the top edge of the card they are about, with a count past one;
//   - out on the board (after a pass, or "Show Peer questions"): each one
//     beside its card with a line to it, like Show stickies;
//   - on an opened card: the Peer pill, its questions hung round the card.

import React, { useEffect, useRef, useState } from 'react';
import type { PeerAnswerReceipt, SandboxFragment } from '../../../lib/freeformApi';
import InternIcon from '../InternIcon';
import { PEER_BLUE, PEER_BLUE_INK, PEER_BLUE_LIGHT } from '../tokens';
import { PAPER } from './sandbox';

export const PEER_STICKY_W = 168;
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";

/** Where each open question lives on the board: the item it hangs on, or
 *  the item that holds the first thing it is about. A question with nowhere
 *  to go (everything it was about is gone) is left out. */
export function peerHomes(
  questions: SandboxFragment[],
  onBoard: (id: string) => boolean,
  holderOf: (id: string) => string | undefined,
  /** Which questions show; open ones by default. */
  shows: (q: SandboxFragment) => boolean = (q) => q.open && (!q.peer?.state || q.peer.state === 'open'),
): Map<string, SandboxFragment[]> {
  const out = new Map<string, SandboxFragment[]>();
  for (const q of questions) {
    if (!shows(q)) continue;
    const candidates = [q.attachedTo, ...(q.peer?.about ?? [])].filter((x): x is string => !!x);
    let home: string | undefined;
    for (const id of candidates) {
      if (onBoard(id)) { home = id; break; }
      const h = holderOf(id);
      if (h) { home = h; break; }
    }
    if (!home) continue;
    out.set(home, [...(out.get(home) ?? []), q]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return out;
}

/** Height of a Peer sticky, for laying them out before they are measured. */
export function peerStickyHeight(q: SandboxFragment): number {
  const qLines = Math.max(2, Math.ceil(q.text.length / 22));
  return Math.round(30 + qLines * 16.5 + 30);
}

const peerInk = (dark: boolean) => (dark ? PEER_BLUE_LIGHT : PEER_BLUE_INK);

/** Folded: one small Peer sticky on the card's top edge, the glasses on it,
 *  a count past one. A click opens the card on its Peer pill. */
export function PeerMini({ n, dark, fresh, onClick }: { n: number; dark: boolean; fresh?: boolean; onClick: () => void }) {
  const p = PAPER.question;
  return (
    <button
      type="button"
      data-peer-mark
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${n} ${n === 1 ? 'question' : 'questions'} from the Peer`}
      style={{
        position: 'relative', width: 24, height: 24, padding: 0, borderRadius: 1, border: 'none', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: dark ? p.dark : p.light, color: peerInk(dark),
        boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 14px ${p.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
        animation: fresh ? 'ffpeerpulse 1.4s ease-in-out 3' : undefined,
      }}
    >
      <InternIcon size={15} />
      {n > 1 && (
        <span style={{ position: 'absolute', top: -6, right: -7, minWidth: 14, height: 14, padding: '0 3px', boxSizing: 'border-box', borderRadius: 7, background: PEER_BLUE, color: '#fff', font: '700 9px/14px system-ui, sans-serif', textAlign: 'center' }}>{n}</span>
      )}
    </button>
  );
}

/** While its answer box is open the sticky widens (Ben, 2026-10-20: long
 *  answers were cramped into a 168-wide column and scrolled). */
export const PEER_ANSWER_W = 300;
const ANSWER_MAX_H = 280;

/** What an answer added, as lines a writer reads at a glance. */
export function receiptLines(r: PeerAnswerReceipt | null | undefined): string[] {
  if (!r || r.undone) return [];
  // The answer read: each placement where it landed.
  if (r.notes || r.ties || r.world || r.offered) {
    return [
      ...(r.notes ?? []).map((n) => `On ${n.onTitle || 'a card'}: ${n.text}`),
      ...(r.ties ?? []).map((t) => `Tie: ${t.fromTitle || 'one'} \u2192 ${t.toTitle || 'another'}, ${t.label}`),
      ...(r.world ?? []).map((w) => `World: ${w.title}`),
      ...(r.offered ?? []).map((o) => `Asked back: ${o.question}`),
    ];
  }
  const out: string[] = [];
  const byCard = new Map<string, number>();
  for (const s of r.stickies ?? []) { const k = s.onTitle || ''; byCard.set(k, (byCard.get(k) ?? 0) + 1); }
  for (const [title, n] of byCard) out.push(`${n} ${n === 1 ? 'sticky' : 'stickies'} ${title ? `on ${title}` : 'on the board'}`);
  for (const c of r.cards ?? []) out.push(`New ${c.type}: ${c.title || 'untitled'}`);
  return out;
}

/** A Peer sticky's size for layout: wider while answering, and once it holds
 *  the writer's answer (and its receipt). */
export function peerStickySize(q: SandboxFragment, answering = false): { w: number; h: number } {
  const state = q.peer?.state ?? 'open';
  const qLines = Math.max(1, Math.ceil(q.text.length / 36));
  if (state === 'answering' || state === 'answered') {
    const aLines = Math.max(1, Math.ceil((q.peer?.answer ?? '').length / 40));
    // A placement line wraps at about 44 characters.
    const rLines = state === 'answered' ? Math.max(1, receiptLines(q.peer?.receipt).reduce((n, l) => n + Math.ceil(l.length / 44), 0)) + 1 : 1;
    return { w: PEER_ANSWER_W, h: Math.round(30 + qLines * 16 + 14 + aLines * 18 + 14 + rLines * 16 + 30) };
  }
  if (!answering) return { w: PEER_STICKY_W, h: peerStickyHeight(q) };
  return { w: PEER_ANSWER_W, h: Math.round(30 + qLines * 16.5 + 30 + 150) };
}

const stopPointer = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };
/** An action's own click, never the sticky's (the sticky opens on a click). */
const alone = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

/** One Peer question as a sticky: "Peer" and the glasses on top, the
 *  question, the writer's words it rests on, and two quiet actions. It drags
 *  like any sticky. Answer opens the sticky itself into a place to write
 *  (Ben, 2026-10-20: smooth, and part of the paper, not a form field); what
 *  is sent is placed on the board by the answer read, wherever it belongs. */
export function PeerQuestionSticky({ q, dark, onAnswer, answerBusy, onDismiss, answering: answeringProp, onAnsweringChange, live, onFold, onUndo, undoBusy = false, fresh, spot, clickOpens = false }: { q: SandboxFragment; dark: boolean;
  /** A click anywhere on the sticky opens it to answer (Ben, 2026-10-21);
   *  Dismiss still needs its own click. In a focus the board decides
   *  (a still click opens, a drag does not). */
  clickOpens?: boolean;
  /** The Peer's receipt is on this question: it wears a pulsing ring. */
  spot?: boolean;
  /** Just asked: it arrives with a pop and a glow. */
  fresh?: boolean;
  /** While the answer is being taken in: what the reading has found so far. */
  live?: string;
  /** Answered: fold the receipt away (it stays on the card's Peer pill). */
  onFold?: () => void;
  /** Answered: take back everything the answer placed (the answer stays). */
  onUndo?: () => void;
  undoBusy?: boolean;
  /** Send the writer's answer (placed by the answer read). */
  onAnswer?: (text: string) => void;
  /** Why Send waits, if it does (a dump already in flight). */
  answerBusy?: string;
  onDismiss?: () => void;
  /** The board holds which sticky is open, so the stickies around it make room. */
  answering?: boolean;
  onAnsweringChange?: (open: boolean) => void }) {
  const p = PAPER.question;
  const ink = dark ? '#f2f8fa' : '#20363d';
  const [own, setOwn] = useState(false);
  const answering = answeringProp ?? own;
  const setAnswering = (v: boolean) => { if (onAnsweringChange) onAnsweringChange(v); else setOwn(v); };
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Focus the moment it opens, so no first keystroke is lost (a delayed
  // focus dropped the first words typed straight after Answer).
  useEffect(() => { if (answering) box.current?.focus({ preventScroll: true }); }, [answering]);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(44, Math.min(ANSWER_MAX_H, el.scrollHeight))}px`; } }, [draft, answering]);
  const send = () => { const t = draft.trim(); if (!t || answerBusy || !onAnswer) return; onAnswer(t); setAnswering(false); setDraft(''); };
  const act: React.CSSProperties = {
    font: 'inherit', fontFamily: 'system-ui, sans-serif', fontSize: 10.5, fontWeight: 650, padding: '2px 0', minHeight: 20,
    border: 'none', background: 'transparent', color: peerInk(dark), cursor: 'pointer',
  };
  const quiet: React.CSSProperties = { ...act, color: ink, opacity: .6, fontWeight: 600 };
  const canSend = !!draft.trim() && !answerBusy;
  const state = q.peer?.state ?? 'open';
  if (state === 'answering' || state === 'answered') {
    // TAKEN IN (Ben, 2026-10-20): the answer is on the paper at once, a live
    // line while it is read in, then what it added. Never into a void.
    const receipt = q.peer?.receipt;
    const lines = receiptLines(receipt);
    const rule = `1px solid ${dark ? 'rgba(255,255,255,.2)' : 'rgba(32,54,61,.15)'}`;
    return (
      <div data-peer-question={q.id} data-peer-state={state} onClick={(e) => e.stopPropagation()}
        style={{ width: PEER_ANSWER_W, boxSizing: 'border-box', padding: '10px 14px 9px', borderRadius: 1, background: dark ? p.dark : p.light, color: ink,
          boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 18px ${p.glow}` : '0 4px 8px rgba(0,0,0,.08), 0 14px 26px rgba(14,116,144,.14)',
          cursor: 'grab', userSelect: 'none', animation: 'ffpeertaken 360ms cubic-bezier(.2,.7,.2,1) both' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'system-ui, sans-serif', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, color: peerInk(dark), marginBottom: 5 }}>
          <InternIcon size={13} ariaLabel="A question from the Peer" />Peer
          <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontWeight: 600, opacity: .8 }}>{state === 'answered' ? 'Answered' : 'Taking it in'}</span>
        </span>
        <div style={{ fontFamily: SERIF, fontSize: 12, lineHeight: 1.35, opacity: .72 }}>{q.text}</div>
        <div data-peer-given style={{ marginTop: 7, paddingTop: 6, borderTop: rule, fontFamily: SERIF, fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{q.peer?.answer}</div>
        <div data-peer-receipt style={{ marginTop: 7, paddingTop: 6, borderTop: rule, fontFamily: 'system-ui, sans-serif', fontSize: 11, lineHeight: 1.45 }}>
          {state === 'answering' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: peerInk(dark), fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PEER_BLUE, display: 'inline-block', animation: 'cb-pulse 1.2s ease-in-out infinite' }} />
              {live || 'Reading your answer'}
            </span>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.6px', color: peerInk(dark), marginBottom: 3 }}>{receipt?.undone ? 'Taken back' : lines.length ? 'Added' : 'Kept'}</div>
              {lines.length
                ? lines.map((l) => <div key={l} data-peer-receipt-line style={{ display: 'flex', gap: 6 }}><span style={{ color: peerInk(dark) }}>+</span><span>{l}</span></div>)
                : <div style={{ opacity: .75 }}>{receipt?.undone ? 'Your answer stays here; nothing it placed is on the board.' : receipt?.failed ? 'Kept with the question; the Peer could not place it just now.' : 'Kept with the question; nothing new to place.'}</div>}
              {(onFold || (onUndo && lines.length > 0)) && (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <span style={{ flex: 1 }} />
                  {onUndo && lines.length > 0 && <button type="button" {...stopPointer} data-peer-undo disabled={undoBusy} onClick={alone(onUndo)} title="Take back everything this answer placed; your answer stays on the question" style={quiet}>{undoBusy ? 'Taking back' : 'Undo'}</button>}
                  {onFold && <button type="button" {...stopPointer} data-peer-fold onClick={alone(onFold)} title="Fold it onto the card; it stays on the card's Peer pill" style={quiet}>Done</button>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      data-peer-question={q.id}
      {...(fresh ? { 'data-peer-fresh': '' } : {})}
      {...(spot ? { 'data-peer-spot': '' } : {})}
      onClick={(e) => { e.stopPropagation(); if (clickOpens && onAnswer && !answering) setAnswering(true); }}
      title={clickOpens && onAnswer && !answering ? 'Click to answer' : undefined}
      style={{
        width: answering ? PEER_ANSWER_W : PEER_STICKY_W, boxSizing: 'border-box', padding: answering ? '10px 14px 8px' : '9px 11px 7px', borderRadius: 1,
        background: dark ? p.dark : p.light, color: ink,
        boxShadow: dark
          ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 ${answering ? 22 : 14}px ${p.glow}`
          : answering ? '0 4px 8px rgba(0,0,0,.08), 0 14px 26px rgba(14,116,144,.16)' : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
        transition: 'box-shadow 220ms ease, width 260ms cubic-bezier(.2,.7,.2,1), padding 260ms cubic-bezier(.2,.7,.2,1)',
        cursor: answering ? 'default' : clickOpens && onAnswer ? 'pointer' : 'grab', userSelect: 'none',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'system-ui, sans-serif', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, color: peerInk(dark), marginBottom: 5 }}>
        <InternIcon size={13} ariaLabel="A question from the Peer" />Peer
      </span>
      <div data-peer-text style={{ fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.36 }}>{q.text}</div>
      {onAnswer && (
        // The answer opens out of the sticky: its height eases open, the
        // words fade in, and the writing sits on the paper itself.
        <div data-peer-answer-wrap aria-hidden={!answering} style={{ display: 'grid', gridTemplateRows: answering ? '1fr' : '0fr', opacity: answering ? 1 : 0, transition: 'grid-template-rows 260ms cubic-bezier(.2,.7,.2,1), opacity 200ms ease' }}>
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${dark ? 'rgba(255,255,255,.22)' : 'rgba(32,54,61,.18)'}` }}>
              <textarea
                ref={box} {...stopPointer} data-peer-answer value={draft} rows={2} tabIndex={answering ? 0 : -1}
                placeholder="Answer in your own words…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAnswering(false); }
                }}
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', margin: 0, padding: 0, resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: ink, caretColor: peerInk(dark), fontFamily: SERIF, fontSize: 13, lineHeight: 1.45, userSelect: 'text', cursor: 'text', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${dark ? 'rgba(255,255,255,.25)' : 'rgba(32,54,61,.22)'} transparent` }}
              />
            </div>
          </div>
        </div>
      )}
      {(onAnswer || onDismiss) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
          {onAnswer && !answering && <button type="button" {...stopPointer} data-peer-answer-open onClick={alone(() => { setAnswering(true); box.current?.focus({ preventScroll: true }); })} title="Answer it here; it goes in as a dump on this card" style={act}>Answer</button>}
          {onAnswer && answering && (
            <button type="button" {...stopPointer} data-peer-send onClick={alone(send)} disabled={!canSend} title={answerBusy || 'Send (⌘↵): it lands on the card like a dump'}
              style={{ ...act, display: 'inline-flex', alignItems: 'center', gap: 5, opacity: canSend ? 1 : 0.45, cursor: canSend ? 'pointer' : 'default' }}>
              Send<span style={{ fontWeight: 500, opacity: .7 }}>⌘↵</span>
            </button>
          )}
          <span style={{ flex: 1 }} />
          {answering
            ? <button type="button" {...stopPointer} onClick={alone(() => setAnswering(false))} title="Not now (Esc)" style={quiet}>Cancel</button>
            : onDismiss && <button type="button" {...stopPointer} data-peer-dismiss onClick={alone(onDismiss)} title="Put this question away; it is not asked again" style={quiet}>Dismiss</button>}
        </div>
      )}
    </div>
  );
}

/** The read's headline: its first sentence, where the locked prompt always
 *  states its position. The rest is the read's body. */
export function readHeadline(text: string): { head: string; rest: string } {
  const t = (text || '').trim();
  const m = t.match(/^([\s\S]+?[.!?])(\s+|$)/);
  if (!m) return { head: t, rest: '' };
  return { head: m[1].trim(), rest: t.slice(m[0].length).trim() };
}

/** THE PEER'S READ, a section of the card (Ben, 2026-10-21: "probably
 *  worth having it as a subheader in a further expanded card"): on the Peer
 *  pill the opened card extends under a hairline with a small-caps subheader,
 *  the card's own kicker style, and the read in the card's own body type. No
 *  popover, no second voice. Opens with an ease; a note on how the last ask
 *  went sits at its foot. */
export function PeerReadSection({ text, busy, note, dark, frame }: { text: string; busy: boolean; note?: string; dark: boolean;
  /** The card's own rule colour. */
  frame: string }) {
  const ink = peerInk(dark);
  const empty = !text && !busy;
  // The headline shows; a click opens the rest in the card (Ben, 2026-10-21).
  const { head, rest } = readHeadline(text);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [text]);
  const toggle = (e: React.SyntheticEvent) => { e.stopPropagation(); if (rest) setOpen((v) => !v); };
  return (
    <div data-peer-read style={{ display: 'grid', gridTemplateRows: '1fr', animation: 'ffpeersection 360ms cubic-bezier(.2,.7,.2,1) both' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <div style={{ margin: '6px -20px 0', padding: '12px 20px 2px', borderTop: `1px solid ${frame}`, borderTopColor: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: ink, height: 14 }}>
            <InternIcon size={15} ariaLabel="The Peer" />The Peer's read
            {busy && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: 11 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: PEER_BLUE, display: 'inline-block', animation: 'cb-pulse 1.2s ease-in-out infinite' }} />Reading</span>}
          </div>
          {text && (
            <div data-peer-read-text style={{ marginTop: 8, opacity: busy ? 0.55 : 1, transition: 'opacity 300ms ease' }}>
              <div data-peer-headline role={rest ? 'button' : undefined} tabIndex={rest ? 0 : undefined} onClick={toggle} onKeyDown={(e) => { if (rest && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(e); } }}
                aria-expanded={rest ? open : undefined}
                style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: dark ? '#e8e8ec' : '#1d2230', cursor: rest ? 'pointer' : 'text', userSelect: 'text' }}>
                {head}
              </div>
              {rest && (
                <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: 'grid-template-rows 280ms cubic-bezier(.2,.7,.2,1), opacity 220ms ease' }}>
                  <div style={{ overflow: 'hidden', minHeight: 0 }}>
                    <div data-peer-read-rest aria-hidden={!open} style={{ paddingTop: 6, fontSize: 13, lineHeight: 1.55, color: dark ? '#c9c9d1' : '#444', userSelect: 'text' }}>{rest}</div>
                  </div>
                </div>
              )}
              {rest && (
                <button type="button" data-peer-more onPointerDown={(e) => e.stopPropagation()} onClick={toggle}
                  style={{ marginTop: 5, padding: 0, border: 'none', background: 'transparent', font: 'inherit', fontSize: 11.5, fontWeight: 650, color: ink, cursor: 'pointer' }}>
                  {open ? 'Show less' : 'Show the whole read'}
                </button>
              )}
            </div>
          )}
          {!text && busy && <div style={{ marginTop: 8, fontSize: 12.5, color: dark ? '#82828c' : '#888' }}>Reading this card and what is around it. About 15 seconds.</div>}
          {empty && !note && <div style={{ marginTop: 8, fontSize: 12.5, color: dark ? '#82828c' : '#888' }}>No read yet. Ask the Peer with the glasses above.</div>}
          {note && <div data-peer-note style={{ marginTop: 8, fontSize: 11.5, color: dark ? '#82828c' : '#888' }}>{note}</div>}
        </div>
      </div>
    </div>
  );
}

export const PEER_CSS = '@keyframes ffpeersection{from{grid-template-rows:0fr;opacity:0}to{grid-template-rows:1fr;opacity:1}}@keyframes ffpeerbreathe{0%,100%{box-shadow:0 0 0 0 rgba(84,191,219,0)}50%{box-shadow:0 0 0 4px rgba(84,191,219,.45),0 0 22px rgba(84,191,219,.35)}}@keyframes ffpeerland{0%{box-shadow:0 0 0 0 rgba(84,191,219,.9)}60%{box-shadow:0 0 0 10px rgba(84,191,219,0)}100%{box-shadow:0 0 0 0 rgba(84,191,219,0)}}@keyframes ffpeerarrive{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}[data-stage-item].ff-peer-reading>*{animation:ffpeerbreathe 1.8s ease-in-out infinite}[data-stage-item].ff-peer-landed>*{animation:ffpeerland 1.1s ease-out 2}[data-peer-spot]{animation:ffpeerspot 1.3s ease-in-out infinite}@keyframes ffpeerspot{0%,100%{box-shadow:0 0 0 3px rgba(84,191,219,.85),0 0 18px rgba(84,191,219,.35)}50%{box-shadow:0 0 0 6px rgba(84,191,219,.45),0 0 30px rgba(84,191,219,.5)}}[data-peer-fresh]{animation:ffpeerarrive 520ms cubic-bezier(.2,.7,.2,1) both,ffpeerland 1.1s ease-out 520ms 2}@keyframes ffpeerpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}@keyframes ffpeerband{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}@keyframes ffpeertaken{from{transform:scale(.97);box-shadow:0 0 0 3px rgba(84,191,219,.7)}to{transform:scale(1)}}@media (prefers-reduced-motion: reduce){[data-peer-mark],[data-peer-state],[data-peer-read],[data-peer-fresh],[data-peer-spot],[data-stage-item].ff-peer-reading>*,[data-stage-item].ff-peer-landed>*{animation:none!important}}';
