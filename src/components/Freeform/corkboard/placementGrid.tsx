// components/Freeform/corkboard/placementGrid.tsx
//
// Placement Control v1c — the grid placement surface (concept B; wall
// revision 2026-08-20: wrap EXACTLY like the Outline grid). One cohesive
// wall of notecards in strict reading order, left→right, wrapping into
// rows — nothing restructures for sequences. Sequences DRAPE OVER the wall
// as tinted green regions traced around their member cells with a name
// chip, the outline view's own idiom.
//
// THE GUTTERS ARE THE SLOTS (uniform, one line each — no stacking):
//   between two members            → "between A and B"
//   before a sequence's first card → "start of the sequence" (position
//                                    'before': the chain leads INTO it)
//   after a sequence's last card   → "end of the sequence" (primary) with
//                                    "outside" as a second pill in the same
//                                    hover popover (containment 'none')
//   elsewhere                      → "after …"
// TAPPING A CARD IS A MERGE (action 'merge'); tapping a region chip places
// inside that sequence; empty sequences are dashed cells at the end.
//
// Canvas-local (toolbar + dock stay live), opaque board surface, fonts match
// the board's cards, FLIP-in from true positions, Esc cancels.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type ProjectEntity } from '../../../lib/freeformApi';

export interface GridPick {
  targetId: string;
  targetTitle: string;
  containment?: 'none';
  position?: 'before';
  action?: 'merge';
  /** Reading-order right neighbour of a between-gutter. Only carried in DROP
   *  mode (the spine drop): placing between two chained cards replaces their
   *  one PRECEDES edge. Dump placement stays add-only and never sends this. */
  nextId?: string;
}

const ORANGE = '#ff8c42';
const ORANGE_DEEP = '#ff6b35';
const GREEN = 'rgba(65,196,118,';

// The outline wall's cell: EVENT_CARD_W × COLLAPSED_H with tight gaps. The
// x-gap here is wider only because it hosts the seam channel.
const CELL_W = 300;
const CELL_H = 110;
const GAP_X = 52;
const GAP_Y = 40;
const SEAM_W = 30;
const PAD_TOP = 56;
const REGION_PAD = 9;
// Run ends reach further out so the start/end seams get room to breathe
// (18 + 18 at a region-to-region boundary still leaves the outside line a
// 16px free lane in the 52px gap).
const REGION_END_PAD = 18;

const short = (t: string, n = 28) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const titleOf = (e: ProjectEntity | undefined) =>
  e ? String(e.working_title ?? e.working_name ?? e.id) : '';

export function PlacementGrid({
  entities,
  contains,
  eventOrder,
  positions,
  canvasWidth,
  onPick,
  onCancel,
  dark,
  dropCard,
  onDrop,
  viewOrigin,
  focus,
  open,
  onExited,
  select,
  noMerge,
  onLeaveUnplaced,
}: {
  entities: ProjectEntity[];
  contains: Array<{ from: string; to: string }>;
  /** Scene ids in story order (the SC-chip spine sort). */
  eventOrder: string[];
  /** Canvas-space card positions — the FLIP start points. */
  positions: Record<string, { x: number; y: number } | undefined>;
  /** Width of the VISIBLE canvas slice in canvas coords (viewport / zoom),
   *  NOT the canvas element's width: canvasW tracks content extent and can be
   *  far wider than the screen, which clipped the wall's right edge. */
  canvasWidth: number;
  onPick: (pick: GridPick) => void;
  onCancel: () => void;
  dark: boolean;
  /** Spine-drop mode: a staged card is mid-drag from the strip. The same
   *  seams take DROPS instead of taps, and the between-gutter names the one
   *  link it will replace. */
  dropCard?: { title: string } | null;
  onDrop?: (pick: GridPick) => void;
  /** Top-left of the VISIBLE canvas slice in canvas coords. The wall anchors
   *  here so it lands where the writer is looking, not at the canvas origin. */
  viewOrigin?: { x: number; y: number };
  /** Strip compare mode: VIEW-ONLY wall focused on one existing card. The
   *  focused cell rings braindump orange (the strip is the tail end of a
   *  braindump), the viewport centers on it vertically, and every placement
   *  affordance (seams, taps, merge badges) is off. */
  focus?: { id: string; ghostTitle?: string } | null;
  /** SELECT mode (New → Sequence): the wall is a picker. Scenes without a
   *  container toggle in/out of the selection; members and sequences are
   *  shown for context only. No seams, no footer (the parent renders the
   *  naming form). */
  select?: { selectedIds: Set<string>; onToggle: (id: string) => void } | null;
  /** Exit choreography: the parent keeps this mounted and flips `open` false
   *  instead of unmounting; the cells fly back to their board positions while
   *  the backdrop fades, then onExited fires and the parent unmounts. */
  open?: boolean;
  onExited?: () => void;
  /** Fresh-card placement (New -> Scene / empty Sequence): tapping a card is
   *  NOT a merge (there is nothing to merge; Ben 2026-08-23). */
  noMerge?: boolean;
  /** Fresh-card placement: the one intentional way OUT without placing —
   *  renders a "Leave unplaced" button and disables the Esc cancel (an
   *  orphaned card must be a deliberate press, never a stray keystroke). */
  onLeaveUnplaced?: () => void;
}) {
  const dropping = !!dropCard && !!onDrop;
  const focusMode = !!focus;
  const selectMode = !!select;
  // View-only affordance gating: both focus and select modes turn off the
  // placement seams/taps; select adds its own tap (toggle).
  const inert = focusMode || selectMode;
  const closing = open === false;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => onExitedRef.current?.(), 560);
    return () => window.clearTimeout(t);
  }, [closing]);
  // dragover/drop for a seam or cell. HTML5 targets mounted mid-drag still
  // receive these as the pointer moves over them.
  const dropProps = (pick: () => GridPick, setHov?: (h: boolean) => void) =>
    dropping
      ? {
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHov?.(true); },
          onDragLeave: () => setHov?.(false),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault(); e.stopPropagation(); setHov?.(false); onDrop!(pick());
          },
        }
      : {};
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const scenes = useMemo(
    () => eventOrder.map((id) => byId.get(id)).filter((e): e is ProjectEntity => !!e),
    [eventOrder, byId],
  );
  const containerOf = useMemo(() => {
    const m = new Map<string, ProjectEntity>();
    for (const c of contains) {
      const seq = byId.get(c.from);
      if (seq && seq.type === 'sequence') m.set(c.to, seq);
    }
    return m;
  }, [contains, byId]);
  const emptySeqs = useMemo(
    () => entities.filter((e) => e.type === 'sequence' && !contains.some((c) => c.from === e.id)),
    [entities, contains],
  );

  // ---- the wall: strict reading order, centered, wrapping ----------------
  // Geometry frozen at mount: the corkboard re-renders (and its rect shifts)
  // constantly; a wall that re-anchors mid-session would slide under the
  // writer's cursor.
  const [view] = useState(() => ({
    x: viewOrigin?.x ?? 0,
    y: viewOrigin?.y ?? 0,
    w: Math.max(CELL_W + 72, canvasWidth),
  }));
  const availW = Math.max(CELL_W, view.w - 72);
  const cols = Math.max(2, Math.floor((availW + GAP_X) / (CELL_W + GAP_X)));
  const gridW = cols * (CELL_W + GAP_X) - GAP_X;
  const originX = view.x + 36 + Math.max(0, (availW - gridW) / 2);
  // A focused SCENE cell expands to show its summary; the wall REFLOWS around
  // it: rows below shift down by the measured extra height (reported by the
  // cell after render), so the expansion opens a slot instead of overlapping.
  const focusIdx = focus ? scenes.findIndex((s) => s.id === focus.id) : -1;
  const focusRow = focusIdx >= 0 ? Math.floor(focusIdx / cols) : -1;
  const [focusExtra, setFocusExtra] = useState(0);
  useEffect(() => { setFocusExtra(0); }, [focus?.id]);
  const cellPos = (i: number) => {
    const row = Math.floor(i / cols);
    return {
      x: originX + (i % cols) * (CELL_W + GAP_X),
      y: view.y + PAD_TOP + row * (CELL_H + GAP_Y) + (focusRow >= 0 && row > focusRow ? focusExtra : 0),
    };
  };
  const totalCells = scenes.length + emptySeqs.length;
  const totalH = view.y + PAD_TOP + Math.ceil(Math.max(1, totalCells) / cols) * (CELL_H + GAP_Y)
    + (focusRow >= 0 ? focusExtra : 0) + 150;

  // Sequence regions: contiguous runs of same-container cells, traced per row
  // (the outline view's selection-style drape).
  const regions = useMemo(() => {
    const out: Array<{ seq: ProjectEntity; segs: Array<{ x: number; y: number; w: number; h: number }>; first: ProjectEntity; last: ProjectEntity; chipAt: { x: number; y: number } }> = [];
    let i = 0;
    while (i < scenes.length) {
      const seq = containerOf.get(scenes[i].id);
      if (!seq) { i += 1; continue; }
      let j = i;
      while (j + 1 < scenes.length && containerOf.get(scenes[j + 1].id)?.id === seq.id) j += 1;
      const segs: Array<{ x: number; y: number; w: number; h: number }> = [];
      const r0 = Math.floor(i / cols), r1 = Math.floor(j / cols);
      for (let r = r0; r <= r1; r++) {
        const a = Math.max(i, r * cols), b = Math.min(j, r * cols + cols - 1);
        const pa = cellPos(a), pb = cellPos(b);
        // Horizontal pads: the run's outer ends use the wide seam channel;
        // row-wrap continuation edges keep the tight pad.
        const lp = a === i ? REGION_END_PAD : REGION_PAD;
        const rp = b === j ? REGION_END_PAD : REGION_PAD;
        segs.push({
          x: pa.x - lp, y: pa.y - REGION_PAD,
          w: pb.x + CELL_W + rp - (pa.x - lp),
          // The drape grows with an expanded focus cell inside this run's row.
          h: CELL_H + REGION_PAD * 2 + (r === focusRow && a <= focusIdx && focusIdx <= b ? focusExtra : 0),
        });
      }
      out.push({ seq, segs, first: scenes[i], last: scenes[j], chipAt: { x: segs[0].x + 6, y: segs[0].y - 11 } });
      i = j + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, containerOf, cols, originX, focusRow, focusIdx, focusExtra]);

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (closing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !onLeaveUnplaced) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, closing]);

  const cardBg = dark ? '#1b1c22' : '#fff';
  const hair = dark ? '#2a2b31' : '#e2e2e8';
  const ink = dark ? '#e8e8ec' : '#222';
  const quiet = dark ? '#8b8b96' : '#8a8a94';
  const trans = 'left 520ms cubic-bezier(.22,.9,.26,1), top 520ms cubic-bezier(.22,.9,.26,1), opacity 420ms';

  // A gutter with one primary pick + optional extra picks, all in one hover
  // popover (one visible line — never stacked slats).
  const Slat = ({ x, y, options, thin, ghost }: {
    x: number; y: number;
    options: Array<{ label: string; pick: GridPick }>;
    /** In-region start/end seams: slimmer channel, slightly shorter line. */
    thin?: boolean;
    /** Rest-invisible: only shows when its region is engaged (or hovered
     *  directly), so boundaries carry ONE resting line, not three. */
    ghost?: boolean;
  }) => {
    const [hov, setHov] = useState(false);
    const lineVisible = hov || !ghost;
    return (
      <div
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        {...dropProps(() => options[0].pick, setHov)}
        style={{
          position: 'absolute', left: x, top: y, width: thin ? 16 : SEAM_W, height: CELL_H,
          zIndex: 138, display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: settled && !closing ? 1 : 0,
          transition: closing ? 'opacity 160ms' : 'opacity 300ms 300ms', cursor: 'pointer',
        }}
        onClick={(e) => { e.stopPropagation(); onPick(options[0].pick); }}
      >
        <span style={{
          width: hov ? 4 : 2, height: thin ? '72%' : '84%', borderRadius: 2,
          background: hov ? ORANGE : lineVisible ? 'rgba(255,140,66,0.34)' : 'transparent',
          boxShadow: hov ? '0 0 12px rgba(255,140,66,0.7)' : 'none',
          transition: 'all 120ms',
        }} />
        {hov && (() => {
          // Clamp near the visible edges (a centered label slides off-screen
          // on the first/last gutters) and let long labels wrap.
          const nearLeft = x < view.x + 150;
          const nearRight = x > view.x + view.w - 170;
          return (
            <div style={{
              position: 'absolute', top: -8,
              ...(nearLeft ? { left: -4, transform: 'translateY(-100%)' }
                : nearRight ? { right: -4, transform: 'translateY(-100%)' }
                : { left: '50%', transform: 'translate(-50%, -100%)' }),
              display: 'flex', flexDirection: 'column', gap: 4,
              alignItems: nearLeft ? 'flex-start' : nearRight ? 'flex-end' : 'center',
              zIndex: 140,
            }}>
              {options.map((o, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); onPick(o.pick); }}
                  style={{
                    font: `600 10.5px/1.4 system-ui`, color: i === 0 ? '#fff' : ORANGE,
                    whiteSpace: 'normal', width: 'max-content', maxWidth: 230,
                    textAlign: 'center', cursor: 'pointer',
                    background: i === 0
                      ? `linear-gradient(135deg, ${ORANGE_DEEP}, ${ORANGE})`
                      : dark ? 'rgba(14,15,18,0.97)' : 'rgba(255,255,255,0.97)',
                    border: `1px solid ${ORANGE}`, borderRadius: 12, padding: '2px 10px',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    );
  };

  const Mini = ({ e, x, y, member }: { e: ProjectEntity; x: number; y: number; member: boolean }) => {
    const [hov, setHov] = useState(false);
    const start = positions[e.id] ?? { x, y };
    // Exit: fly back to the board position while the backdrop fades, fading
    // out over the last stretch so the differently-sized real card underneath
    // doesn't pop at unmount.
    const p = settled && !closing ? { x, y } : start;
    const isFocus = focus?.id === e.id;
    const summary = isFocus ? String(e.summary ?? e.description ?? '') : '';
    // Select mode: only container-less scenes are pickable; members dim.
    const selectable = selectMode && !member;
    const isSelected = selectMode && select!.selectedIds.has(e.id);
    // Report the expanded height so the wall reflows around this cell (rows
    // below shift by the extra). Same-value guard: this inner component
    // remounts every parent render, so the effect re-fires with stable input.
    const selfRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (!isFocus) return;
      const el = selfRef.current;
      if (!el) return;
      const next = Math.max(0, el.offsetHeight - CELL_H);
      setFocusExtra((cur) => (Math.abs(next - cur) < 1 ? cur : next));
    });
    return (
      <div
        ref={selfRef}
        onClick={(ev) => {
          ev.stopPropagation();
          if (selectMode) { if (selectable) select!.onToggle(e.id); return; }
          if (focusMode || noMerge) return;
          onPick({ targetId: e.id, targetTitle: `merge into “${short(titleOf(e), 22)}”`, action: 'merge' });
        }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        {...(noMerge ? {} : dropProps(() => ({ targetId: e.id, targetTitle: `merge into “${short(titleOf(e), 22)}”`, action: 'merge' }), setHov))}
        style={{
          position: 'absolute', left: p.x, top: p.y, width: CELL_W,
          // The focused cell EXPANDS to show its summary (the question is
          // "is this the same beat?", so the telling must be readable);
          // z-raised, it overlaps the row below harmlessly in view-only mode.
          ...(isFocus ? { minHeight: CELL_H, height: 'auto' as const } : { height: CELL_H }),
          background: cardBg, borderRadius: 10, cursor: selectMode ? (selectable ? 'pointer' : 'default') : focusMode ? 'default' : 'pointer',
          // Hovered card rises above the sequence chips so its merge tooltip
          // (a child, trapped in this stacking context) can't hide behind them.
          zIndex: isFocus ? 141 : hov ? 142 : 136,
          border: `1px solid ${isSelected ? '#41c476' : hair}`,
          borderLeft: `3px solid ${member ? `${GREEN}0.8)` : '#5f7fe8'}`,
          // overflow stays visible: the merge tooltip floats above the card
          // (the title clips itself via line-clamp).
          padding: isFocus ? '10px 12px 12px' : '10px 12px',
          opacity: closing ? 0 : (selectMode && !selectable ? 0.45 : 1),
          transition: closing ? `${trans}, opacity 240ms 280ms` : trans,
          boxShadow: isSelected
            ? '0 0 0 2.5px #41c476, 0 0 18px rgba(65,196,118,0.35)'
            : isFocus
              ? `0 0 0 2.5px ${ORANGE}, 0 0 20px rgba(255,140,66,0.35)`
              : hov && selectable ? '0 0 0 2px rgba(65,196,118,0.7)'
              : hov && !inert ? `0 0 0 2px ${ORANGE}` : 'none',
        }}
      >
        <div style={{
          fontSize: 15, fontWeight: 650, lineHeight: 1.32, color: ink,
          fontFamily: 'system-ui, sans-serif',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {titleOf(e)}
        </div>
        {isFocus && summary && (
          <div style={{
            marginTop: 8, fontSize: 12.5, lineHeight: 1.55,
            color: dark ? '#c9c9d2' : '#444', fontFamily: 'system-ui, sans-serif',
            display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {summary}
          </div>
        )}
        {isFocus && focus?.ghostTitle && (
          // The incoming card's marker rides the expanded cell's bottom edge
          // (a fixed grid-level y would land under the summary).
          <div style={{
            position: 'absolute', left: 0, top: 'calc(100% + 12px)', maxWidth: CELL_W,
            font: '600 10.5px/1.5 system-ui', color: ORANGE,
            background: dark ? 'rgba(10,14,17,0.95)' : 'rgba(255,255,255,0.96)',
            border: `1.5px dashed ${ORANGE}`, borderRadius: 999, padding: '2px 10px',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            pointerEvents: 'none',
            opacity: closing ? 0 : 1, transition: 'opacity 160ms',
          }}>
            + “{short(focus.ghostTitle, 34)}”
          </div>
        )}
        {hov && !inert && !noMerge && (
          <span style={{
            position: 'absolute', right: 8, bottom: 7,
            font: '700 9.5px system-ui', color: '#fff',
            background: `linear-gradient(135deg, ${ORANGE_DEEP}, ${ORANGE})`,
            borderRadius: 999, padding: '2px 8px', pointerEvents: 'none',
          }}>
            merge
          </span>
        )}
      </div>
    );
  };

  // Gutter options between reading-order neighbours L (may be null at the
  // very start) and R (null past the end).
  // Between-cell gutters. Start/end-of-sequence live as their own thin seams
  // INSIDE the region edges, so boundary gutters here carry only the OUTSIDE
  // meaning (one line, one purpose).
  const gutterOptions = (L: ProjectEntity | null, R: ProjectEntity | null) => {
    const cL = L ? containerOf.get(L.id) : undefined;
    const cR = R ? containerOf.get(R.id) : undefined;
    const opts: Array<{ label: string; pick: GridPick }> = [];
    // "Between" = same container, OR both loose (no boundary crossed). A
    // gutter on a sequence boundary keeps its after/outside meaning.
    if (L && R && ((cL && cL.id === cR?.id) || (!cL && !cR))) {
      // Drop mode is the one lane where "between" MEANS between: the pair's
      // own PRECEDES edge is replaced (named here so the writer sees the
      // displacement before releasing). Tap mode stays add-only "after L".
      opts.push(dropping
        ? { label: `between “${short(titleOf(L), 18)}” and “${short(titleOf(R), 18)}” (replaces their link)`,
            pick: { targetId: L.id, targetTitle: `between “${short(titleOf(L), 16)}” and “${short(titleOf(R), 16)}”`, nextId: R.id } }
        : { label: `between “${short(titleOf(L), 18)}” and “${short(titleOf(R), 18)}”`,
            pick: { targetId: L.id, targetTitle: `after “${short(titleOf(L), 22)}”` } });
      return opts;
    }
    if (L) {
      opts.push({
        label: cL ? `after “${short(titleOf(cL), 20)}” · outside` : `after “${short(titleOf(L), 20)}”`,
        pick: { targetId: L.id, targetTitle: cL ? `after “${short(titleOf(cL), 16)}” · outside` : `after “${short(titleOf(L), 22)}”`, ...(cL ? { containment: 'none' as const } : {}) },
      });
    } else if (R) {
      opts.push({ label: 'at the very start',
        pick: { targetId: R.id, targetTitle: 'at the very start', position: 'before', ...(cR ? { containment: 'none' as const } : {}) } });
    }
    return opts;
  };

  // One sequence run: segments + chip + start/end seams, sharing a hover
  // state. Engaging the sequence (chip or frame) turns its OUTLINE orange —
  // "the dump lands on this sequence" — and reveals its in-region seams
  // (rest state keeps boundaries to a single line).
  const RegionGroup = ({ seq, segs, first, last, chipAt }: {
    seq: ProjectEntity;
    segs: Array<{ x: number; y: number; w: number; h: number }>;
    first: ProjectEntity; last: ProjectEntity;
    chipAt: { x: number; y: number };
  }) => {
    const [areaHov, setAreaHov] = useState(false);
    const on = areaHov && !inert;
    const isFocus = focus?.id === seq.id;
    return (
      <>
        {segs.map((g, si) => (
          <div
            key={`seg-${si}`}
            onMouseEnter={() => setAreaHov(true)}
            onMouseLeave={() => setAreaHov(false)}
            {...dropProps(() => ({ targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }), setAreaHov)}
            onClick={(e) => { e.stopPropagation(); if (inert) return; onPick({ targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }); }}
            style={{
              position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h,
              background: `${GREEN}${on ? '0.09' : '0.07'})`,
              border: `1.5px solid ${isFocus ? ORANGE : on ? ORANGE : `${GREEN}0.35)`}`,
              borderRadius: 12, zIndex: 131, opacity: settled && !closing ? 1 : 0,
              // height animates with the focus reflow (the drape grows around
              // an expanded cell while the rows below slide down).
              transition: `${trans}, height 520ms cubic-bezier(.22,.9,.26,1), border-color 120ms, background 120ms`,
              cursor: inert ? 'default' : 'pointer',
              boxShadow: isFocus ? '0 0 20px rgba(84,191,219,0.3)' : on ? '0 0 14px rgba(255,140,66,0.2)' : 'none',
            }}
          />
        ))}
        <SeqChip seq={seq} x={chipAt.x} y={chipAt.y} onHover={setAreaHov} engaged={on} focused={isFocus} />
        {!inert && (
          <>
            <Slat thin
              x={segs[0].x + REGION_END_PAD / 2 - 8} y={segs[0].y + REGION_PAD}
              options={[{ label: `start of “${short(titleOf(seq), 24)}”`,
                pick: { targetId: first.id, targetTitle: `start of “${short(titleOf(seq), 20)}”`, position: 'before' } }]} />
            <Slat thin
              x={segs[segs.length - 1].x + segs[segs.length - 1].w - REGION_END_PAD / 2 - 8}
              y={segs[segs.length - 1].y + REGION_PAD}
              options={[{ label: `end of “${short(titleOf(seq), 24)}”`,
                pick: { targetId: last.id, targetTitle: `end of “${short(titleOf(seq), 20)}”` } }]} />
          </>
        )}
      </>
    );
  };

  // The sequence's name chip: single line at rest; on hover it grows
  // DOWNWARD (top edge stays put) and wraps so the full name reads.
  const SeqChip = ({ seq, x, y, onHover, engaged, focused }: {
    seq: ProjectEntity; x: number; y: number;
    onHover?: (h: boolean) => void; engaged?: boolean; focused?: boolean;
  }) => {
    const [selfHov, setSelfHov] = useState(false);
    const hov = (selfHov && !inert) || !!engaged;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); if (inert) return; onPick({ targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }); }}
        onMouseEnter={() => { setSelfHov(true); onHover?.(true); }}
        onMouseLeave={() => { setSelfHov(false); onHover?.(false); }}
        {...dropProps(() => ({ targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }), (h) => { setSelfHov(h); onHover?.(h); })}
        style={{
          position: 'absolute', left: x, top: y, maxWidth: CELL_W + 40, textAlign: 'left',
          font: '600 11px/1.45 system-ui', cursor: inert ? 'default' : 'pointer',
          // Hover/engage = orange OUTLINE only (the focus signal); the chip
          // keeps its own colors. The compare focus rings peer-blue instead.
          color: '#7fdca6',
          background: dark ? '#11151a' : '#f2faf5',
          border: `1px solid ${focused || hov ? ORANGE : `${GREEN}0.5)`}`,
          borderRadius: selfHov ? 10 : 999, padding: selfHov ? '4px 11px 5px' : '2px 11px',
          whiteSpace: selfHov ? 'normal' : 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
          zIndex: selfHov ? 141 : 137, opacity: settled && !closing ? 1 : 0,
          transition: `${trans}, border-radius 120ms, border-color 120ms`,
          boxShadow: hov ? '0 0 10px rgba(255,140,66,0.35)' : 'none',
        }}
      >
        {titleOf(seq)}
        {selfHov && !inert && (
          <span style={{ display: 'block', font: '400 10px system-ui', color: quiet, marginTop: 2 }}>
            tap to place inside
          </span>
        )}
      </button>
    );
  };

  const nodes: React.ReactNode[] = [];
  // Regions first (under the cards).
  regions.forEach(({ seq, segs, first, last, chipAt }, ri) => {
    nodes.push(
      <RegionGroup key={`region-${seq.id}-${ri}`} seq={seq} segs={segs} first={first} last={last} chipAt={chipAt} />,
    );
  });
  // Cells + gutters.
  scenes.forEach((e, i) => {
    const p = cellPos(i);
    nodes.push(<Mini key={e.id} e={e} x={p.x} y={p.y} member={containerOf.has(e.id)} />);
    if (inert) return; // view-only / select: no placement seams
    const L = i > 0 ? scenes[i - 1] : null;
    const opts = gutterOptions(i % cols === 0 ? L : L, e);
    if (opts.length) {
      nodes.push(<Slat key={`g-${i}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={opts} />);
    }
  });
  if (scenes.length && !inert) {
    const last = scenes[scenes.length - 1];
    const p = cellPos(scenes.length - 1);
    const opts = gutterOptions(last, null);
    // The wall continues into the empty-sequence cells, so this end seam is
    // ALSO the seam before the first of them: offer that placement too.
    if (emptySeqs.length) {
      const A = emptySeqs[0];
      opts.push({ label: `before “${short(titleOf(A), 20)}”`,
        pick: { targetId: A.id, targetTitle: `before “${short(titleOf(A), 22)}”`, position: 'before', containment: 'none' } });
    }
    if (opts.length) {
      nodes.push(<Slat key="g-end" x={p.x + CELL_W + GAP_X / 2 - SEAM_W / 2} y={p.y} options={opts} />);
    }
  }
  // Empty sequences: dashed cells continuing the wall.
  const EmptySeqCell = ({ e, x, y }: { e: ProjectEntity; x: number; y: number }) => {
    const [hov, setHov] = useState(false);
    const isFocus = focus?.id === e.id;
    const lit = hov && !inert;
    return (
      <div
        onClick={(ev) => { ev.stopPropagation(); if (inert) return; onPick({ targetId: e.id, targetTitle: `into “${short(titleOf(e), 22)}”` }); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        {...dropProps(() => ({ targetId: e.id, targetTitle: `into “${short(titleOf(e), 22)}”` }), setHov)}
        style={{
          position: 'absolute', left: x, top: y, width: CELL_W, height: CELL_H,
          background: `${GREEN}0.06)`,
          borderRadius: 10, cursor: inert ? 'default' : 'pointer', zIndex: 136,
          border: `1.5px dashed ${isFocus || lit ? ORANGE : `${GREEN}0.5)`}`, padding: '10px 12px',
          opacity: settled && !closing ? 1 : 0,
          transition: `${trans}, border-color 120ms, background 120ms`,
          boxShadow: isFocus ? '0 0 20px rgba(84,191,219,0.3)' : lit ? '0 0 14px rgba(255,140,66,0.2)' : 'none',
        }}
      >
        <div style={{ font: '600 12px system-ui', color: '#7fdca6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(e)}</div>
        <div style={{ font: '400 10.5px system-ui', color: quiet, marginTop: 5 }}>{inert ? 'empty sequence' : 'empty sequence — place inside'}</div>
      </div>
    );
  };
  emptySeqs.forEach((e, j) => {
    const p = cellPos(scenes.length + j);
    nodes.push(<EmptySeqCell key={e.id} e={e} x={p.x} y={p.y} />);
    if (inert) return;
    // Seams between/around the empty-sequence cells (Ben 2026-08-23): a card
    // can sit BESIDE a sequence in the told-order chain (containment 'none'
    // -> the backend writes cross PRECEDES, not CONTAINS).
    if (j > 0) {
      const A = emptySeqs[j - 1];
      nodes.push(<Slat key={`sq-g-${j}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[dropping
        ? { label: `between “${short(titleOf(A), 16)}” and “${short(titleOf(e), 16)}” (replaces their link)`,
            pick: { targetId: A.id, targetTitle: `between “${short(titleOf(A), 14)}” and “${short(titleOf(e), 14)}”`, nextId: e.id, containment: 'none' } }
        : { label: `between “${short(titleOf(A), 16)}” and “${short(titleOf(e), 16)}”`,
            pick: { targetId: A.id, targetTitle: `after “${short(titleOf(A), 20)}”`, containment: 'none' } }]} />);
    } else if (!scenes.length) {
      nodes.push(<Slat key="sq-g-first" x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: 'at the very start', pick: { targetId: e.id, targetTitle: 'at the very start', position: 'before', containment: 'none' } }]} />);
    }
    if (j === emptySeqs.length - 1) {
      nodes.push(<Slat key="sq-g-last" x={p.x + CELL_W + GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: `after “${short(titleOf(e), 20)}”`, pick: { targetId: e.id, targetTitle: `after “${short(titleOf(e), 22)}”`, containment: 'none' } }]} />);
    }
  });

  // The focused card's wall position (scene cell, sequence region's first
  // member, or empty-sequence cell).
  const focusPos = (() => {
    if (!focus) return null;
    const idx = scenes.findIndex((s) => s.id === focus.id);
    if (idx >= 0) return cellPos(idx);
    const reg = regions.find((r) => r.seq.id === focus.id);
    if (reg) return { x: reg.segs[0].x + REGION_END_PAD, y: reg.segs[0].y + REGION_PAD };
    const j = emptySeqs.findIndex((s) => s.id === focus.id);
    if (j >= 0) return cellPos(scenes.length + j);
    return null;
  })();

  // Ghost of the incoming card pinned under the focused SEQUENCE (a focused
  // scene cell expands and carries its own ghost at its live bottom edge):
  // "this is what's asking about that". The panel carries the full delta.
  const focusIsScene = focus ? scenes.some((s) => s.id === focus.id) : false;
  if (focusMode && focusPos && focus?.ghostTitle && !focusIsScene) {
    nodes.push(
      <div
        key="focus-ghost"
        style={{
          position: 'absolute', left: focusPos.x, top: focusPos.y + CELL_H + 12,
          maxWidth: CELL_W, zIndex: 141, pointerEvents: 'none',
          font: '600 10.5px/1.5 system-ui', color: ORANGE,
          background: dark ? 'rgba(10,14,17,0.95)' : 'rgba(255,255,255,0.96)',
          border: `1.5px dashed ${ORANGE}`, borderRadius: 999, padding: '2px 10px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          opacity: settled && !closing ? 1 : 0,
          transition: closing ? 'opacity 160ms' : 'opacity 300ms 300ms',
        }}
      >
        + “{short(focus.ghostTitle, 34)}”
      </div>,
    );
  }

  // Compare focus: vertically center the viewport on the focused cell. The
  // wall's geometry is frozen, so this runs once per focused card. Double rAF
  // + behavior 'auto' per the board's scroll quirks (the manual-sticky toolbar
  // cancels smooth scrolls; same-commit scrolls no-op).
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusY = focusPos ? focusPos.y : null;
  const focusId = focus?.id ?? null;
  useEffect(() => {
    if (focusId == null || focusY == null) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      const el = overlayRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // CSS zoom: rects are visual px, offsetHeight is layout px; the ratio
      // recovers the zoom without threading it through.
      const scale = el.offsetHeight ? rect.height / el.offsetHeight : 1;
      const centerY = rect.top + (focusY + (CELL_H + focusExtra) / 2) * scale;
      window.scrollBy({ top: Math.round(centerY - window.innerHeight / 2), behavior: 'auto' });
    }));
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [focusId, focusY, focusExtra]);

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute', left: 0, top: 0, right: 0, minHeight: '100%',
        height: Math.max(totalH, 400), zIndex: 130,
        // Exit: the overlay goes inert immediately so the board is usable
        // while the cards fly home.
        pointerEvents: closing ? 'none' : undefined,
      }}
    >
      {/* Backdrop on its own layer so it can FADE both ways while the cells
          fly: in over the real board at mount, out to reveal it on exit. */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        style={{
          position: 'absolute', inset: 0,
          backgroundColor: dark ? '#0a0a0b' : '#fdfaf3',
          backgroundImage: dark
            ? 'radial-gradient(circle, rgba(255,107,53,0.18) 1px, transparent 1px)'
            : 'radial-gradient(circle, rgba(234,88,12,0.16) 1px, transparent 1.4px)',
          backgroundSize: dark ? '40px 40px' : '26px 26px',
          backgroundPosition: '8px 8px',
          opacity: settled && !closing ? 1 : 0,
          transition: 'opacity 340ms',
        }}
      />
      {nodes}
      {!selectMode && <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 150, display: 'flex', alignItems: 'center', gap: 12,
        opacity: settled && !closing ? 1 : 0, transition: 'opacity 200ms',
        padding: '9px 18px', borderRadius: 999,
        background: dark ? 'rgba(20,22,28,0.96)' : 'rgba(255,255,255,0.97)',
        border: `1.5px solid ${ORANGE_DEEP}`, boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
        fontSize: 12.5, color: ink, fontFamily: 'system-ui, sans-serif',
      }}>
        {dropping && noMerge ? (
          <span>Placing <b style={{ color: ORANGE }}>“{short(dropCard!.title, 32)}”</b>: tap or drop on a <b style={{ color: ORANGE }}>gap</b>, or a <b style={{ color: '#7fdca6' }}>sequence</b> to go inside</span>
        ) : dropping ? (
          <span>Placing <b style={{ color: ORANGE }}>“{short(dropCard!.title, 32)}”</b>: tap or drop on a <b style={{ color: ORANGE }}>gap</b>, a <b style={{ color: ORANGE }}>card</b> to merge into it, or a <b style={{ color: '#7fdca6' }}>sequence</b></span>
        ) : focusMode ? (
          <span>Story order: where <b style={{ color: ORANGE }}>“{short(titleOf(byId.get(focus!.id)), 32)}”</b> sits</span>
        ) : (
          <span>Story order — tap a <b style={{ color: ORANGE }}>gap</b> to place, a <b style={{ color: ORANGE }}>card</b> to merge into it, a <b style={{ color: '#7fdca6' }}>sequence chip</b> to go inside</span>
        )}
        {onLeaveUnplaced ? (
          <button
            onClick={onLeaveUnplaced}
            title="Keep the card on the board without a place in the story order — connect it any time with the link orb"
            style={{ background: 'transparent', border: `1px solid ${dark ? '#3a3a42' : '#d8d2c4'}`, color: quiet, fontWeight: 600, cursor: 'pointer', fontSize: 11.5, padding: '3px 11px', borderRadius: 999, fontFamily: 'inherit' }}
          >
            Leave unplaced
          </button>
        ) : (
          <button
            onClick={onCancel}
            style={{ background: 'transparent', border: 'none', color: ORANGE, fontWeight: 600, cursor: 'pointer', fontSize: 12.5, padding: 0, fontFamily: 'inherit' }}
          >
            {focusMode ? 'close (Esc)' : 'cancel (Esc)'}
          </button>
        )}
      </div>}
    </div>
  );
}
