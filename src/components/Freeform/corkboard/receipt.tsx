// components/Freeform/corkboard/receipt.tsx
//
// THE RECEIPT — what a braindump did, in the board's own card language.
//
// Before this, a dump's only account of itself was a counts string in a dock
// that closes itself ("Done. Extracted 3 char · 4 event · 2 loc"), and the
// questions panel opened itself on top of whatever else was on screen. So the
// writer watched cards appear and had no way to learn what arrived, where it
// went, or what was still owed. Paul Kitson's number one note, raised three
// separate times in one call: "I want to be able to see if I can have some
// kind of control or even clarity."
//
// Shape (Ben, 2026-09-09):
//   - a concentration banner across the top edge, so the mix reads at a glance
//   - GROUPED BY DESTINATION: the sequence, then the new scenes inside it with
//     their SC numbers. Saying "where" structurally beats repeating "landed in
//     X" on every row, and it makes the receipt read like the rail
//   - every row is a board jump
//   - ONE rule. Above it what happened, below it what is owed
//   - questions are a count and a door, never a list. Naming them here doubled
//     the panel and turned the card into a wall
//
// Lifecycle: with questions outstanding there is no dwell timer, the pill says
// "waiting on you" and the bottom-left button answers them. Settled, the badge
// flips to "All placed" and the same slot becomes "Done". Writer-dismissed at
// both ends, so nothing the writer has not seen can vanish on them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEntityColor } from '../entityColors';
import { useThemeMode } from './theme';

/** AUTO-MERGE: one answer the mode applied on the writer's behalf (script
 *  extraction only). Listed on the receipt as a log line, never a question. */
export interface AppliedRow {
  cardId: string;
  questionType: 'merge_suggestion' | 'compare' | 'unplaced' | 'altitude' | 'retelling';
  answer: 'replace' | 'merge' | 'keep';
  /** The card the answer acted on (for a re-telling, the live card). */
  title: string;
  target: { id: string; title: string } | null;
  /** Re-telling only: the telling that was replaced. '' when unknown. */
  priorSummary: string;
  answeredAt: string;
}

const ORANGE = '#ff8c42';
const SEQ_GREEN = '#22c55e';
const PEER = '#54bfdb';

/** Past this many groups the list collapses to heads. Below it a follow-up
 *  dump reads whole without moving; above it a first dump would otherwise be
 *  a wall of seven sequences. */
const COLLAPSE_OVER = 4;

export interface ReceiptScene {
  id: string;
  title: string;
  /** Spine position. Absent for a scene the spine does not order yet. */
  scNo?: number;
  /** What the dump did to this card (Ben, 2026-09-11: one list, tagged, not
   *  two blocks). 'new' minted it; 'updated' re-told an existing card from
   *  the pages; 'folded' merged a duplicate into it (`folded` names the
   *  duplicate). Absent = new. */
  kind?: 'new' | 'updated' | 'folded';
  folded?: string;
  /** What changed, in a line, for a card the dump added to without minting
   *  (a character's new traits or a name it now also answers to). */
  detail?: string;
}

export interface ReceiptGroup {
  /** React key for a group that is not a destination (the Characters group:
   *  its rows sit outside the story order and its head jumps nowhere). */
  key?: string;
  /** The destination. null = on the spine but inside no sequence. */
  destId: string | null;
  destTitle: string;
  color: string;
  scenes: ReceiptScene[];
}

export interface ReceiptProps {
  groups: ReceiptGroup[];
  /** Everything not shown as a row, counted: characters, locations, facts. */
  tail: { characters: number; locations: number; facts: number };
  /** Weighted segments for the top banner, in draw order. */
  bars: Array<{ color: string; weight: number }>;
  /** Cards held off the board with a question against them. */
  pending: number;
  /** Where this came from. Defaults to the braindump; a script carve says
   *  "From your pages", a mixed return says "Since you were here". */
  eyebrow?: string;
  /** Lede when nothing structural landed (a facts-only dump). */
  ledeEmpty?: string;

  /** Sequences this dump MINTED. A follow-up dump that lands scenes inside
   *  an existing sequence has destinations but minted none, and the lede
   *  should not call the destination new. Absent = count destinations. */
  mintedSequences?: number;
  onJump: (cardId: string) => void;
  /** Drag handle. The header carries it so rows stay clickable. */
  onHandleDown?: (e: React.PointerEvent) => void;
  onHandleMove?: (e: React.PointerEvent) => void;
  onHandleUp?: (e: React.PointerEvent) => void;
  dragging?: boolean;
  onAnswer: () => void;
  onLater: () => void;
  onDone: () => void;
}

export function Receipt({
  groups, tail, bars, pending, onJump, onAnswer, onLater, onDone,
  onHandleDown, onHandleMove, onHandleUp, dragging,
  eyebrow = 'From your braindump', ledeEmpty = 'Your braindump landed',
  mintedSequences,
}: ReceiptProps) {
  const dark = useThemeMode() === 'dark';
  // Groups that actually received scenes open by default even when collapsed:
  // an empty sequence is a name, a populated one is news.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.scenes.length > 0).map((g) => g.destId ?? '~loose')),
  );
  const collapsed = groups.length > COLLAPSE_OVER;
  const settled = pending === 0;

  // SCROLL TELL (Ben, 2026-09-11): the list is height-capped, and a first
  // dump with five sequences showed two with nothing saying more were below.
  // Measure the list: a fade on whichever edge is clipping, and a chip that
  // counts the sequence heads below the fold and scrolls to them.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTell, setScrollTell] = useState<{ up: boolean; down: boolean; below: number }>({ up: false, down: false, below: 0 });
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollTop + el.clientHeight;
    const heads = Array.from(el.querySelectorAll<HTMLElement>('[data-receipt-group]'));
    const below = heads.filter((h) => h.offsetTop + 12 > bottom).length;
    const next = {
      up: el.scrollTop > 4,
      down: el.scrollHeight - bottom > 4,
      below,
    };
    setScrollTell((cur) => (cur.up === next.up && cur.down === next.down && cur.below === next.below ? cur : next));
  }, []);
  useEffect(() => {
    measure();
    const el = listRef.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [measure, groups, open, collapsed]);
  const scrollOn = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.max(120, el.clientHeight - 40), behavior: 'smooth' });
  };

  const lede = useMemo(() => {
    const seqs = mintedSequences ?? groups.filter((g) => g.destId).length;
    const rows = groups.flatMap((g) => g.scenes);
    const fresh = rows.filter((r) => (r.kind ?? 'new') === 'new').length;
    const updated = rows.filter((r) => r.kind === 'updated').length;
    const folded = rows.filter((r) => r.kind === 'folded').length;
    const parts: string[] = [];
    if (seqs > 0) parts.push(`${seqs} new sequence${seqs === 1 ? '' : 's'}`);
    if (fresh > 0) parts.push(`${fresh} new scene${fresh === 1 ? '' : 's'}`);
    const changed = updated + folded;
    if (changed > 0) parts.push(`${changed} scene${changed === 1 ? '' : 's'} updated`);
    if (parts.length === 0) return ledeEmpty;
    return parts.join(', ');
  }, [groups, ledeEmpty, mintedSequences]);

  const surface = dark ? '#141417' : '#fff';
  const hair = dark ? '#26262b' : '#e8e0d2';
  const line = dark ? '#33333a' : '#ddd6c8';
  const ink = dark ? '#e6e6ea' : '#1a1a1a';
  const ink2 = dark ? '#aeaeb6' : '#555';
  const ink4 = dark ? '#6b6b74' : '#999';

  const tailBits: string[] = [];
  if (tail.characters > 0) tailBits.push(`${tail.characters} character${tail.characters === 1 ? '' : 's'}`);
  if (tail.locations > 0) tailBits.push(`${tail.locations} location${tail.locations === 1 ? '' : 's'}`);
  if (tail.facts > 0) tailBits.push(`${tail.facts} fact${tail.facts === 1 ? '' : 's'}`);

  const totalWeight = Math.max(1, bars.reduce((n, b) => n + b.weight, 0));

  return (
    <div
      data-receipt
      data-tour="receipt"
      style={{
        width: 336, background: surface, borderRadius: 11, overflow: 'hidden',
        border: `1px solid ${settled ? 'rgba(34,197,94,0.4)' : 'rgba(255,107,53,0.55)'}`,
        boxShadow: settled
          ? '0 12px 40px rgba(0,0,0,0.45)'
          : '0 14px 46px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,107,53,0.09)',
        fontFamily: 'system-ui, sans-serif',
        // The card is chrome, not content, and it is draggable: without this a
        // drag paints a text selection across everything the pointer crosses.
        userSelect: 'none', WebkitUserSelect: 'none',
        animation: 'ffcardin 220ms cubic-bezier(0.32,0.72,0,1)',
      }}
    >
      {/* Concentration banner: the mix of what landed, read at a glance. */}
      <div style={{ display: 'flex', height: 4 }}>
        {bars.filter((b) => b.weight > 0).map((b, i) => (
          <span key={i} style={{ flex: b.weight / totalWeight, background: b.color }} />
        ))}
      </div>

      <div style={{ padding: '0 14px' }}>
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          style={{
            display: 'flex', alignItems: 'center', gap: 7, paddingTop: 11, marginBottom: 10,
            cursor: onHandleDown ? (dragging ? 'grabbing' : 'grab') : undefined,
            touchAction: 'none',
          }}
        >
          <BrainMark />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: ink4 }}>
            {eyebrow}
          </span>
          {settled ? (
            <span style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: SEQ_GREEN,
              border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)',
              borderRadius: 20, padding: '2px 8px 2px 6px',
            }}>
              <Tick />All placed
            </span>
          ) : (
            <span style={{
              marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: ORANGE,
              border: '1px solid rgba(255,107,53,0.35)', borderRadius: 20, padding: '2px 7px',
            }}>
              waiting on you
            </span>
          )}
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 700, color: ink, lineHeight: 1.35, marginBottom: 10 }}>
          {lede}
        </div>

        {/* Scroll is the backstop, not the answer: the collapse below keeps it
            from being reached in the ordinary case. When it is reached, the
            edges say so. */}
        <div style={{ position: 'relative' }}>
        <div ref={listRef} onScroll={measure} style={{ maxHeight: 264, overflowY: 'auto', paddingRight: 4, marginRight: -4 }}>
          {groups.map((g) => {
            const key = g.key ?? g.destId ?? '~loose';
            const isOpen = !collapsed || open.has(key);
            return (
              <div key={key} data-receipt-group style={{ marginBottom: 9 }}>
                <div
                  onClick={() => {
                    if (collapsed && g.scenes.length > 0) {
                      setOpen((cur) => {
                        const next = new Set(cur);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      });
                      return;
                    }
                    if (g.destId) onJump(g.destId);
                  }}
                  className="ff-receipt-head"
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, fontWeight: 700,
                    color: g.destId || g.key ? g.color : ink4, lineHeight: 1.35, marginBottom: 3,
                    cursor: 'pointer', padding: '3px 4px', marginLeft: -4, borderRadius: 5,
                  }}
                >
                  {collapsed && g.scenes.length > 0 && (
                    <span style={{ fontSize: 9, color: ink4, flexShrink: 0, marginTop: 3 }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  )}
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                    background: g.destId || g.key ? g.color : line,
                  }} />
                  <span style={{ minWidth: 0 }}>{g.destTitle}</span>
                  {g.scenes.length > 0 && (
                    <span style={{
                      marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                      color: g.key ? g.color : getEntityColor('event'), flexShrink: 0, paddingLeft: 6,
                    }}>
                      {g.scenes.length}
                    </span>
                  )}
                </div>
                {isOpen && g.scenes.map((sc) => (
                  <div
                    key={sc.id}
                    onClick={() => onJump(sc.id)}
                    className="ff-receipt-ref"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: ink2,
                      lineHeight: 1.4, padding: '4px 6px 4px 10px', marginLeft: 5,
                      borderRadius: 6, cursor: 'pointer', borderLeft: '2px solid transparent',
                    }}
                  >
                    <span
                      className="ff-receipt-sc"
                      style={{
                        fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700,
                        color: ink4, flexShrink: 0, width: 16, marginTop: 2,
                      }}
                    >
                      {Number.isFinite(sc.scNo) ? String(sc.scNo).padStart(2, '0') : '—'}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      {sc.title}
                      {sc.kind === 'folded' && sc.folded && (
                        <span style={{ display: 'block', fontSize: 11, color: ink4, marginTop: 1 }}>
                          took in {'\u201c'}{sc.folded}{'\u201d'}
                        </span>
                      )}
                      {sc.detail && (
                        <span style={{ display: 'block', fontSize: 11, color: ink4, marginTop: 1 }}>
                          {sc.detail}
                        </span>
                      )}
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingLeft: 6 }}>
                      {(sc.kind === 'updated' || sc.kind === 'folded') && (
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: PEER, border: '1px solid rgba(84,191,219,0.4)', borderRadius: 20, padding: '1px 6px' }}>UPDATED</span>
                      )}
                      {(sc.kind ?? 'new') === 'new' && (
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: SEQ_GREEN, border: '1px solid rgba(34,197,94,0.35)', borderRadius: 20, padding: '1px 6px' }}>NEW</span>
                      )}
                      <span className="ff-receipt-go" style={{ fontSize: 11 }}>↗</span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {scrollTell.up && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 22, pointerEvents: 'none', background: `linear-gradient(${surface}, rgba(0,0,0,0))` }} />
        )}
        {scrollTell.down && (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, pointerEvents: 'none', background: `linear-gradient(rgba(0,0,0,0), ${surface})` }} />
            <div
              onClick={scrollOn}
              style={{
                position: 'absolute', left: '50%', bottom: 2, transform: 'translateX(-50%)',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: ink2, cursor: 'pointer',
                border: `1px solid ${line}`, background: surface, borderRadius: 20, padding: '2px 9px',
                whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              }}
            >
              {scrollTell.below > 0
                ? `${scrollTell.below} more sequence${scrollTell.below === 1 ? '' : 's'} \u2193`
                : 'more \u2193'}
            </div>
          </>
        )}
        </div>

        {tailBits.length > 0 && (
          <div style={{ fontSize: 11, color: ink4, paddingTop: 7 }}>{tailBits.join(', ')}</div>
        )}

      </div>

      {/* The rule. Above it what happened, below it what is owed. */}
      <div style={{ marginTop: 10, padding: '11px 14px 13px', borderTop: `1px solid ${hair}` }}>
        {settled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onDone} style={btn(SEQ_GREEN, 'rgba(34,197,94,0.55)', 'rgba(34,197,94,0.14)')}>
              <Tick />Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: ink }}>
                {pending} need{pending === 1 ? 's' : ''} your call
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: ink4 }}>held off the board</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={onAnswer}
                style={{ ...btn(SEQ_GREEN, 'rgba(34,197,94,0.55)', 'rgba(34,197,94,0.14)'), flex: 1 }}
              >
                {pending === 1 ? 'Review the question' : 'Review questions'}
              </button>
              <button onClick={onLater} style={btn(ink2, line, 'transparent')}>Later</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function btn(color: string, border: string, background: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 700,
    fontFamily: 'inherit', cursor: 'pointer',
    border: `1px solid ${border}`, background, color,
  };
}

function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BrainMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  );
}

export default Receipt;
