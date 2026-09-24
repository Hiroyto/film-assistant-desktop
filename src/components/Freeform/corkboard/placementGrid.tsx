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
  seqChain,
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
  /** Sequence PRECEDES edges (the section chain), so empty sequences can
   *  render at their chain slot instead of trailing the wall. */
  seqChain?: Array<{ from: string; to: string }>;
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
  dropCard?: { title: string; kind?: 'scene' | 'section' } | null;
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
  select?: { selectedIds: Set<string>; onToggle: (id: string) => void; anyScene?: boolean; accent?: string } | null;
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
  // SECTION PLACEMENT (Ben 2026-08-31, closing the v1 cut): a section on the
  // wall cannot nest and cannot merge into a scene, so its taps mean
  // chaining. Sequence surfaces read "after" instead of "into", cards lose
  // the merge affordance, and the gap seams keep their mixed-spine meaning
  // (a section may legally sit beside scenes in the told-order chain).
  const sectionDrop = dropping && dropCard?.kind === 'section';
  const noMergeEff = noMerge || sectionDrop;
  const focusMode = !!focus;
  const selectMode = !!select;
  const selAccent = select?.accent ?? '#41c476';
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

  // WALL STORY ORDER (Ben 2026-09-02): empty sequences used to render as a
  // tail after every scene (the wall began scenes-only), so the wall's
  // reading order contradicted the board's chain - "Nell runs…" (chain head,
  // empty) drew after sections that have members. Interleave instead: walk
  // the sequence chain; a run of empty sections docks immediately BEFORE the
  // with-members section that follows it in the chain, and empties nothing
  // follows keep the tail. slotOfScene / slotOfEmpty give every cell its
  // wall slot; all geometry below is slot-based.
  const { slotOfScene, slotOfEmpty } = useMemo(() => {
    const emptyIdxById = new Map(emptySeqs.map((e, j) => [e.id, j]));
    // Chain order over ALL story units - sequences AND scenes (Kahn over
    // seqChain, which carries every precedes bucket, lexicographic
    // tiebreak). Scenes must be in the walk (Ben 2026-09-02, second pass):
    // the chain threads THROUGH loose scenes (mixed spine), and a
    // sequences-only walk docked "runs → survey → loose scene → section"'s
    // empties at the section, letting the loose scene jump the chain head.
    const unitIds = entities.filter((e) => e.type === 'sequence' || e.type === 'event').map((e) => e.id);
    const unitSet = new Set(unitIds);
    const adj = new Map<string, string[]>(); const indeg = new Map<string, number>();
    for (const id of unitIds) { adj.set(id, []); indeg.set(id, 0); }
    for (const p of seqChain ?? []) {
      if (unitSet.has(p.from) && unitSet.has(p.to)) {
        adj.get(p.from)!.push(p.to);
        indeg.set(p.to, (indeg.get(p.to) ?? 0) + 1);
      }
    }
    const q = unitIds.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
    const chainOrder: string[] = [];
    while (q.length) {
      const id = q.shift()!;
      chainOrder.push(id);
      for (const nx of adj.get(id) ?? []) {
        const d = (indeg.get(nx) ?? 0) - 1; indeg.set(nx, d);
        if (d === 0) { let k = 0; while (k < q.length && q[k] < nx) k++; q.splice(k, 0, nx); }
      }
    }
    for (const id of unitIds) if (!chainOrder.includes(id)) chainOrder.push(id);
    // Wall anchor per unit: a scene anchors at its own cell (a member scene
    // at its section's first member, so empties never break a region run);
    // a with-members section anchors at its first member.
    const sceneIdxById = new Map(scenes.map((s, i) => [s.id, i]));
    const firstMemberAt = new Map<string, number>();
    scenes.forEach((s, i) => {
      const seq = containerOf.get(s.id);
      if (seq && !firstMemberAt.has(seq.id)) firstMemberAt.set(seq.id, i);
    });
    // Assign each empty sequence an insertion point: before the next unit in
    // the chain that has a wall cell; tail otherwise.
    const before = new Map<number, string[]>(); // scene index -> empty ids docked before it
    const tail: string[] = [];
    let pending: string[] = [];
    for (const id of chainOrder) {
      if (emptyIdxById.has(id)) { pending.push(id); continue; }
      const sceneIdx = sceneIdxById.get(id);
      const at = sceneIdx !== undefined
        ? (containerOf.has(id) ? firstMemberAt.get(containerOf.get(id)!.id) : sceneIdx)
        : firstMemberAt.get(id);
      if (at !== undefined && pending.length) {
        before.set(at, [...(before.get(at) ?? []), ...pending]);
        pending = [];
      }
    }
    tail.push(...pending);
    // Walk scenes, splicing docked empties in; leftovers trail.
    const sceneSlots: number[] = new Array(scenes.length).fill(0);
    const emptySlots: number[] = new Array(emptySeqs.length).fill(0);
    const assigned = new Set<string>([...before.values()].flat().concat(tail));
    let slot = 0;
    scenes.forEach((s, i) => {
      for (const id of before.get(i) ?? []) { emptySlots[emptyIdxById.get(id)!] = slot; slot += 1; }
      sceneSlots[i] = slot; slot += 1;
    });
    for (const id of tail) { emptySlots[emptyIdxById.get(id)!] = slot; slot += 1; }
    // Belt: an empty the chain walk somehow never reached still gets a cell.
    emptySeqs.forEach((e, j) => {
      if (!assigned.has(e.id)) { emptySlots[j] = slot; slot += 1; }
    });
    return { slotOfScene: sceneSlots, slotOfEmpty: emptySlots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, emptySeqs, scenes, containerOf, seqChain]);

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
  // focusIdx is a SLOT (wall cell) index, not a scenes[] index — all
  // geometry below is slot-based since the empty-sequence interleave.
  const focusSceneIdx = focus ? scenes.findIndex((s) => s.id === focus.id) : -1;
  const focusIdx = focusSceneIdx >= 0 ? slotOfScene[focusSceneIdx] : -1;
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
      // Run geometry in SLOT space (members stay slot-contiguous: empties
      // only ever dock at run boundaries, never inside one).
      const s0 = slotOfScene[i], s1 = slotOfScene[j];
      const r0 = Math.floor(s0 / cols), r1 = Math.floor(s1 / cols);
      for (let r = r0; r <= r1; r++) {
        const a = Math.max(s0, r * cols), b = Math.min(s1, r * cols + cols - 1);
        const pa = cellPos(a), pb = cellPos(b);
        // Horizontal pads: the run's outer ends use the wide seam channel;
        // row-wrap continuation edges keep the tight pad.
        const lp = a === s0 ? REGION_END_PAD : REGION_PAD;
        const rp = b === s1 ? REGION_END_PAD : REGION_PAD;
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
  }, [scenes, containerOf, cols, originX, focusRow, focusIdx, focusExtra, slotOfScene]);

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
    // A focused SEQUENCE highlights as one unit: drape ring plus an orange
    // outline on every member cell inside it (Ben 2026-08-31 — reviewing a
    // "scene or sequence?" ask is exactly about what the section holds, so
    // the members must read as part of the highlighted subject).
    const inFocusSeq = !!focus?.id && containerOf.get(e.id)?.id === focus.id;
    const summary = isFocus ? String(e.summary ?? e.description ?? '') : '';
    // Select mode: only container-less scenes are pickable; members dim.
    // Wrap-select picks loose scenes only; arc tagging picks ANY scene.
    const selectable = selectMode && (select!.anyScene === true || !member);
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
          if (focusMode || noMergeEff) return;
          onPick({ targetId: e.id, targetTitle: `merge into “${short(titleOf(e), 22)}”`, action: 'merge' });
        }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        {...(noMergeEff ? {} : dropProps(() => ({ targetId: e.id, targetTitle: `merge into “${short(titleOf(e), 22)}”`, action: 'merge' }), setHov))}
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
          border: `1px solid ${isSelected ? selAccent : inFocusSeq ? ORANGE : hair}`,
          borderLeft: `3px solid ${member ? `${GREEN}0.8)` : '#5f7fe8'}`,
          // overflow stays visible: the merge tooltip floats above the card
          // (the title clips itself via line-clamp).
          padding: isFocus ? '10px 12px 12px' : '10px 12px',
          opacity: closing ? 0 : (selectMode && !selectable ? 0.45 : 1),
          transition: closing ? `${trans}, opacity 240ms 280ms` : trans,
          boxShadow: isSelected
            ? `0 0 0 2.5px ${selAccent}, 0 0 18px ${selAccent}55`
            : isFocus
              ? `0 0 0 2.5px ${ORANGE}, 0 0 20px rgba(255,140,66,0.35)`
              : inFocusSeq
                ? '0 0 10px rgba(255,140,66,0.25)'
                : hov && selectable ? `0 0 0 2px ${selAccent}b3`
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
        {hov && !inert && !noMergeEff && (
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
      // A SECTION never splices between two scenes INSIDE a sequence — it
      // cannot live there (Ben 2026-08-31). Between two loose cards stays
      // legal (mixed spine).
      if (sectionDrop && cL) return opts;
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
  // One traced outline around a wrapped region's row segments (Ben
  // 2026-09-02: "the green should wrap" — two independent rounded boxes read
  // as two sequences). Segments are first extended down through the row gap
  // so consecutive rows touch, then the union's rectilinear outline is walked
  // clockwise (right staircase down, left staircase up) and rounded at each
  // corner. Returns null when consecutive rows share no columns (a disjoint
  // union has no single outline) — caller falls back to per-row boxes.
  const regionOutline = (
    rs: Array<{ x: number; y: number; w: number; h: number }>,
    radius: number,
  ): { d: string; x0: number; y0: number; w: number; h: number } | null => {
    const joined = rs.map((g, i) =>
      i < rs.length - 1 ? { ...g, h: Math.max(g.h, rs[i + 1].y - g.y) } : { ...g });
    for (let i = 1; i < joined.length; i++) {
      const a = joined[i - 1], b = joined[i];
      if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) < 24) return null;
    }
    const pts: Array<[number, number]> = [];
    const push = (x: number, y: number) => {
      const p = pts[pts.length - 1];
      if (!p || p[0] !== x || p[1] !== y) pts.push([x, y]);
    };
    const firstSeg = joined[0], lastSeg = joined[joined.length - 1];
    push(firstSeg.x, firstSeg.y); push(firstSeg.x + firstSeg.w, firstSeg.y);
    for (let i = 0; i + 1 < joined.length; i++) {
      const a = joined[i], b = joined[i + 1];
      push(a.x + a.w, a.y + a.h); push(b.x + b.w, a.y + a.h);
    }
    push(lastSeg.x + lastSeg.w, lastSeg.y + lastSeg.h); push(lastSeg.x, lastSeg.y + lastSeg.h);
    for (let i = joined.length - 1; i > 0; i--) {
      const a = joined[i], b = joined[i - 1];
      push(a.x, a.y); push(b.x, a.y);
    }
    // Drop collinear midpoints so every remaining vertex is a true corner.
    const corners = pts.filter((p, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length], next = pts[(i + 1) % pts.length];
      return !((prev[0] === p[0] && p[0] === next[0]) || (prev[1] === p[1] && p[1] === next[1]));
    });
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const x0 = Math.min(...xs) - 3, y0 = Math.min(...ys) - 3;
    const w = Math.max(...xs) - x0 + 6, h = Math.max(...ys) - y0 + 6;
    const n = corners.length;
    const d: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = corners[i], prev = corners[(i + n - 1) % n], next = corners[(i + 1) % n];
      const inL = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const outL = Math.hypot(next[0] - p[0], next[1] - p[1]);
      if (!inL || !outL) continue;
      const rr = Math.min(radius, inL / 2, outL / 2);
      const pin = [p[0] - ((p[0] - prev[0]) / inL) * rr, p[1] - ((p[1] - prev[1]) / inL) * rr];
      const pout = [p[0] + ((next[0] - p[0]) / outL) * rr, p[1] + ((next[1] - p[1]) / outL) * rr];
      d.push(`${i === 0 ? 'M' : 'L'}${pin[0] - x0},${pin[1] - y0}`,
        `Q${p[0] - x0},${p[1] - y0} ${pout[0] - x0},${pout[1] - y0}`);
    }
    return { d: `${d.join(' ')} Z`, x0, y0, w, h };
  };

  const RegionGroup = ({ seq, segs, first, last, chipAt }: {
    seq: ProjectEntity;
    segs: Array<{ x: number; y: number; w: number; h: number }>;
    first: ProjectEntity; last: ProjectEntity;
    chipAt: { x: number; y: number };
  }) => {
    const [areaHov, setAreaHov] = useState(false);
    const on = areaHov && !inert;
    const isFocus = focus?.id === seq.id;
    const outline = segs.length > 1 ? regionOutline(segs, 12) : null;
    // Hit areas: extended through the row gap when the outline joins them, so
    // hover/click/drop cover the whole drape.
    const hitSegs = outline
      ? segs.map((g, i) => (i < segs.length - 1 ? { ...g, h: Math.max(g.h, segs[i + 1].y - g.y) } : g))
      : segs;
    return (
      <>
        {outline && (
          <svg
            width={outline.w} height={outline.h}
            style={{
              position: 'absolute', left: outline.x0, top: outline.y0,
              zIndex: 130, pointerEvents: 'none', overflow: 'visible',
              opacity: settled && !closing ? 1 : 0,
              transition: `${trans}, opacity 420ms`,
              filter: isFocus
                ? 'drop-shadow(0 0 10px rgba(255,140,66,0.45))'
                : on ? 'drop-shadow(0 0 8px rgba(255,140,66,0.2))' : 'none',
            }}
          >
            <path
              d={outline.d}
              fill={`${GREEN}${on ? '0.09' : '0.07'})`}
              stroke={isFocus || on ? ORANGE : `${GREEN}0.35)`}
              strokeWidth={isFocus ? 2.5 : 1.5}
              style={{ transition: 'stroke 120ms, fill 120ms' }}
            />
          </svg>
        )}
        {hitSegs.map((g, si) => (
          <div
            key={`seg-${si}`}
            onMouseEnter={() => setAreaHov(true)}
            onMouseLeave={() => setAreaHov(false)}
            {...dropProps(() => ({ targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }), setAreaHov)}
            onClick={(e) => { e.stopPropagation(); if (inert) return; onPick(sectionDrop ? { targetId: seq.id, targetTitle: `after “${short(titleOf(seq), 22)}”` } : { targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }); }}
            style={{
              position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h,
              background: outline ? 'transparent' : `${GREEN}${on ? '0.09' : '0.07'})`,
              border: outline ? 'none' : `1.5px solid ${isFocus ? ORANGE : on ? ORANGE : `${GREEN}0.35)`}`,
              borderRadius: 12, zIndex: 131, opacity: settled && !closing ? 1 : 0,
              // height animates with the focus reflow (the drape grows around
              // an expanded cell while the rows below slide down).
              transition: `${trans}, height 520ms cubic-bezier(.22,.9,.26,1), border-color 120ms, background 120ms`,
              cursor: inert ? 'default' : 'pointer',
              // Was rgba(84,191,219,…) — a peer-blue glow left over from
              // before the orange flip, which made a focused sequence read
              // dimmer than a hovered one.
              boxShadow: outline ? 'none' : isFocus ? `0 0 0 2px ${ORANGE}, 0 0 22px rgba(255,140,66,0.35)` : on ? '0 0 14px rgba(255,140,66,0.2)' : 'none',
            }}
          />
        ))}
        <SeqChip seq={seq} x={chipAt.x} y={chipAt.y} onHover={setAreaHov} engaged={on} focused={isFocus} />
        {!inert && !sectionDrop && (
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
        onClick={(e) => { e.stopPropagation(); if (inert) return; onPick(sectionDrop ? { targetId: seq.id, targetTitle: `after “${short(titleOf(seq), 22)}”` } : { targetId: seq.id, targetTitle: `into “${short(titleOf(seq), 22)}”` }); }}
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
            {sectionDrop ? 'tap to chain after' : 'tap to place inside'}
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
  // Slot-neighbor lookup for seam decisions (interleaved wall).
  const sceneAtSlot = new Map<number, number>();
  slotOfScene.forEach((s, i) => sceneAtSlot.set(s, i));
  const emptyAtSlot = new Map<number, number>();
  slotOfEmpty.forEach((s, j) => emptyAtSlot.set(s, j));
  const lastSlot = totalCells - 1;
  // Cells + gutters.
  scenes.forEach((e, i) => {
    const slot = slotOfScene[i];
    const p = cellPos(slot);
    nodes.push(<Mini key={e.id} e={e} x={p.x} y={p.y} member={containerOf.has(e.id)} />);
    if (inert) return; // view-only / select: no placement seams
    // Left seam: between scenes when the previous SLOT is the previous
    // scene; after an interleaved empty sequence when one sits to the left.
    const prevSceneIdx = sceneAtSlot.get(slot - 1);
    const prevEmptyIdx = emptyAtSlot.get(slot - 1);
    if (prevEmptyIdx !== undefined) {
      const A = emptySeqs[prevEmptyIdx];
      nodes.push(<Slat key={`g-${i}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: `after “${short(titleOf(A), 20)}”`,
          pick: { targetId: A.id, targetTitle: `after “${short(titleOf(A), 22)}”`, containment: 'none' } }]} />);
    } else {
      const L = prevSceneIdx !== undefined ? scenes[prevSceneIdx] : null;
      const opts = gutterOptions(L, e);
      if (opts.length) {
        nodes.push(<Slat key={`g-${i}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={opts} />);
      }
    }
    // Right seam when this scene ends the wall.
    if (slot === lastSlot) {
      const opts = gutterOptions(e, null);
      if (opts.length) {
        nodes.push(<Slat key="g-end" x={p.x + CELL_W + GAP_X / 2 - SEAM_W / 2} y={p.y} options={opts} />);
      }
    }
  });
  // Empty sequences: dashed cells continuing the wall.
  const EmptySeqCell = ({ e, x, y }: { e: ProjectEntity; x: number; y: number }) => {
    const [hov, setHov] = useState(false);
    const isFocus = focus?.id === e.id;
    const lit = hov && !inert;
    return (
      <div
        onClick={(ev) => { ev.stopPropagation(); if (inert) return; onPick(sectionDrop
          ? { targetId: e.id, targetTitle: `after “${short(titleOf(e), 22)}”` }
          : { targetId: e.id, targetTitle: `into “${short(titleOf(e), 22)}”` }); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        {...dropProps(() => (sectionDrop
          ? { targetId: e.id, targetTitle: `after “${short(titleOf(e), 22)}”` }
          : { targetId: e.id, targetTitle: `into “${short(titleOf(e), 22)}”` }), setHov)}
        style={{
          position: 'absolute', left: x, top: y, width: CELL_W, height: CELL_H,
          background: `${GREEN}0.06)`,
          borderRadius: 10, cursor: inert ? 'default' : 'pointer', zIndex: 136,
          border: `1.5px dashed ${isFocus || lit ? ORANGE : `${GREEN}0.5)`}`, padding: '10px 12px',
          opacity: settled && !closing ? 1 : 0,
          transition: `${trans}, border-color 120ms, background 120ms`,
          boxShadow: isFocus ? `0 0 0 2px ${ORANGE}, 0 0 22px rgba(255,140,66,0.35)` : lit ? '0 0 14px rgba(255,140,66,0.2)' : 'none',
        }}
      >
        <div style={{ font: '600 12px system-ui', color: '#7fdca6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(e)}</div>
        <div style={{ font: '400 10.5px system-ui', color: quiet, marginTop: 5 }}>{inert ? 'empty sequence' : sectionDrop ? 'empty sequence — chain after' : 'empty sequence — place inside'}</div>
      </div>
    );
  };
  emptySeqs.forEach((e, j) => {
    const slot = slotOfEmpty[j];
    const p = cellPos(slot);
    nodes.push(<EmptySeqCell key={e.id} e={e} x={p.x} y={p.y} />);
    if (inert) return;
    // Seams between/around the empty-sequence cells (Ben 2026-08-23): a card
    // can sit BESIDE a sequence in the told-order chain (containment 'none'
    // -> the backend writes cross PRECEDES, not CONTAINS). Slot-neighbor
    // aware since the interleave: the cell to the left may be another empty,
    // a scene (that scene's own gutter covers the seam), or nothing.
    const prevEmptyIdx = emptyAtSlot.get(slot - 1);
    if (prevEmptyIdx !== undefined) {
      const A = emptySeqs[prevEmptyIdx];
      nodes.push(<Slat key={`sq-g-${j}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[dropping
        ? { label: `between “${short(titleOf(A), 16)}” and “${short(titleOf(e), 16)}” (replaces their link)`,
            pick: { targetId: A.id, targetTitle: `between “${short(titleOf(A), 14)}” and “${short(titleOf(e), 14)}”`, nextId: e.id, containment: 'none' } }
        : { label: `between “${short(titleOf(A), 16)}” and “${short(titleOf(e), 16)}”`,
            pick: { targetId: A.id, targetTitle: `after “${short(titleOf(A), 20)}”`, containment: 'none' } }]} />);
    } else if (slot === 0) {
      nodes.push(<Slat key={`sq-g-first-${j}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: 'at the very start', pick: { targetId: e.id, targetTitle: 'at the very start', position: 'before', containment: 'none' } }]} />);
    } else if (sceneAtSlot.get(slot - 1) === undefined) {
      nodes.push(<Slat key={`sq-g-before-${j}`} x={p.x - GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: `before “${short(titleOf(e), 20)}”`,
          pick: { targetId: e.id, targetTitle: `before “${short(titleOf(e), 22)}”`, position: 'before', containment: 'none' } }]} />);
    }
    if (slot === lastSlot) {
      nodes.push(<Slat key={`sq-g-last-${j}`} x={p.x + CELL_W + GAP_X / 2 - SEAM_W / 2} y={p.y} options={[
        { label: `after “${short(titleOf(e), 20)}”`, pick: { targetId: e.id, targetTitle: `after “${short(titleOf(e), 22)}”`, containment: 'none' } }]} />);
    }
  });

  // The focused card's wall position (scene cell, sequence region's first
  // member, or empty-sequence cell).
  const focusPos = (() => {
    if (!focus) return null;
    const idx = scenes.findIndex((s) => s.id === focus.id);
    if (idx >= 0) return cellPos(slotOfScene[idx]);
    const reg = regions.find((r) => r.seq.id === focus.id);
    if (reg) return { x: reg.segs[0].x + REGION_END_PAD, y: reg.segs[0].y + REGION_PAD };
    const j = emptySeqs.findIndex((s) => s.id === focus.id);
    if (j >= 0) return cellPos(slotOfEmpty[j]);
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
        {sectionDrop ? (
          <span>Placing the section <b style={{ color: ORANGE }}>“{short(dropCard!.title, 32)}”</b>: tap or drop on a <b style={{ color: ORANGE }}>gap</b> to chain it there, or a <b style={{ color: '#7fdca6' }}>sequence</b> to chain after it</span>
        ) : dropping && noMerge ? (
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
