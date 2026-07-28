// components/Freeform/corkboard/connectors.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState } from 'react';
import { getEntityColor } from '../../../components/Freeform/entityColors';
import { type ProjectEdges, type ProjectEntity } from '../../../lib/freeformApi';
import { CANVAS_PAD, CHAR_PILL_H, CHAR_PILL_W, COLLAPSED_H, COLLAPSED_W, COL_GAP, EVENT_CARD_W, EXPANDED_W, PEER_GAP, REL_COLLAPSED_H, REL_COLLAPSED_W, ROW_GAP, collapsedSizeOf, type Pos } from './constants';
import { DARK_ORANGE, useThemeMode } from './theme';

// =====================================================================
// Position calc — place peer to the right of the parent card; fall back
// to the left if it would overflow.
// =====================================================================

export function computePeerPosition(parentPos: Pos | undefined, parent: ProjectEntity): Pos | null {
  if (!parentPos) return null;
  const parentW = EXPANDED_W; // parent is expanded when peer is up
  return {
    x: parentPos.x + parentW + PEER_GAP,
    y: parentPos.y,
  };
}

// =====================================================================
// ConnectorLayer — SVG overlay drawing PRECEDES (Event→Event arrows) and
// structural (Character↔Character labeled dashes) edges between cards.
// Sits behind cards inside the canvas; pointer-events:none so card drags
// pass through.
// =====================================================================

export function ConnectorLayer({
  width,
  height,
  entities,
  positions,
  edges,
  expandedCardId,
  hoveredCardId,
  forcedTie,
  expandedCardH,
  focusMode,
  hiddenIds,
  linkDrag,
  onRemovePrecedes,
  onRemoveCauses,
  displacements,
  overrides,
  relMidpoints,
  reifiedPairs,
  onEditStructural,
  arcThreadGeo,
  backstorySplit,
  sequenceBoxRects,
}: {
  width: number;
  height: number;
  entities: ProjectEntity[];
  positions: Record<string, Pos>;
  edges: ProjectEdges;
  expandedCardId: string | null;
  /** Hovered character node — demoted structural ties light up while the
   *  pointer rests on one of their endpoints. */
  hoveredCardId?: string | null;
  /** Force ONE structural tie to full weight regardless of hover/expand —
   *  the wow tour's relationship beat spotlights a demoted tie with this. */
  forcedTie?: { from: string; to: string } | null;
  expandedCardH: number;
  focusMode: boolean;
  hiddenIds?: Set<string>;
  /** When set, render a ghost PRECEDES arrow from the source card's
   *  bottom-center to the current cursor canvas-coord. Highlights any
   *  hovered drop target (card or existing arrow). */
  linkDrag?: {
    fromCardId: string;
    mouseCanvas: Pos;
    moved: boolean;
    overCardId: string | null;
    overEdgeKey: string | null;
    causesMode: boolean;
  } | null;
  /** Click handler on an existing PRECEDES line — drops the edge. */
  onRemovePrecedes?: (fromId: string, toId: string) => void;
  /** D'-11 — click handler on an existing CAUSES line — drops the edge. */
  onRemoveCauses?: (fromId: string, toId: string) => void;
  /** Per-card displacement (ball cluster push). When set, line endpoints
   *  use the rendered position, not the natural one. */
  displacements?: Map<string, { dx: number; dy: number }>;
  /** Per-card position overrides (ball cluster stack slots). */
  overrides?: Map<string, { pos: Pos }>;
  /** Reified Relationship cards rendered at the midpoint of their endpoints.
   *  relId → { x, y (card top-left), aId, bId }. Used to draw the relationship
   *  as the edge (stubs to each endpoint) and to position its rect. */
  relMidpoints?: Map<string, { x: number; y: number; aId: string; bId: string }>;
  /** Char-pair keys ("aId|bId", both orderings) with a reified Relationship —
   *  their structural dashed edge is suppressed (the card represents it). */
  reifiedPairs?: Set<string>;
  /** Click a structural tie → open the edit popover at the edge midpoint. */
  onEditStructural?: (s: { from: string; to: string; predicate: string; mx: number; my: number }) => void;
  /** Arcs as threads: precomputed path + color per arc (geometry lives in the
   *  parent so the ball layer can share the anchor). */
  arcThreadGeo?: { arcId: string; color: string; pathD: string }[];
  /** Throughline view — suppress PRECEDES edges that cross the backstory /
   *  on-screen boundary (backstory sits outside audience-time there). */
  backstorySplit?: boolean;
  /** A sequence that's a container renders as a box, not a card — its edges
   *  (sequence throughline) attach to the box BORDER and follow it. seqId → rect. */
  sequenceBoxRects?: Map<string, { x: number; y: number; w: number; h: number }>;
}) {
  // Which PRECEDES edge is currently hovered (for the ✕ remove button).
  // Hover state lives in the connector layer rather than per-line to avoid
  // re-rendering every line on every mouseenter.
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  // Dark mode renders connectors in the ScenesCanvas language: a wide soft
  // halo pass under a 2px core pass run through the subtleGlow blur filter.
  const dark = useThemeMode() === 'dark';

  // Per-card visual rect — width/height varies with expansion. Memoize so
  // we don't recompute for every line. Skips cards hidden behind a ball
  // cluster so connectors don't dangle into empty space.
  const typeById = new Map(entities.map((e) => [e.id, e.type]));
  const rectOf = (id: string) => {
    if (hiddenIds?.has(id)) return null;
    // A sequence container: its edges attach to the box border, centered on the
    // whole container, not the card-sized anchor point.
    const box = sequenceBoxRects?.get(id);
    if (box) {
      return { x: box.x, y: box.y, w: box.w, h: box.h, cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
    }
    const relMid = relMidpoints?.get(id);
    let p: Pos;
    if (relMid) {
      // Reified relationship card sits at its computed midpoint, ignoring any
      // stored position / ball displacement.
      p = { x: relMid.x, y: relMid.y };
    } else {
      const natural = positions[id];
      if (!natural) return null;
      const override = overrides?.get(id);
      const displacement = displacements?.get(id);
      p = override
        ? override.pos
        : displacement
        ? { x: natural.x + displacement.dx, y: natural.y + displacement.dy }
        : natural;
    }
    const isExp = expandedCardId === id;
    const csz = collapsedSizeOf(typeById.get(id)); // character = name pill
    const w = isExp ? EXPANDED_W : relMid ? REL_COLLAPSED_W : csz.w;
    const h = isExp ? (expandedCardH > 0 ? expandedCardH : csz.h) : relMid ? REL_COLLAPSED_H : csz.h;
    return { x: p.x, y: p.y, w, h, cx: p.x + w / 2, cy: p.y + h / 2 };
  };

  // Edge endpoint: project the center→center line onto the source/target
  // card rectangle and emit at the boundary so the line doesn't pass under
  // the card's interior.
  const edgePoint = (from: { cx: number; cy: number; x: number; y: number; w: number; h: number }, to: { cx: number; cy: number }) => {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
    // Clamp the parametric step `t` so (cx + t*dx, cy + t*dy) lands on the
    // closest edge of the from-rect.
    const halfW = from.w / 2;
    const halfH = from.h / 2;
    const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
    const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
    const t = Math.min(tx, ty);
    return { x: from.cx + dx * t, y: from.cy + dy * t };
  };

  // A perfectly vertical/horizontal connector renders the dark glow + wide halo
  // as a flat translucent band rather than a crisp thread. Detect straightness so
  // those soft passes can be dropped for straight segments (crisp line only).
  const isStraightLine = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
    Math.abs(p1.x - p2.x) < 1.5 || Math.abs(p1.y - p2.y) < 1.5;

  const labelById = new Map(
    entities.map((e) => [e.id, e.working_name ?? e.working_title ?? e.id]),
  );

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: 'none',
        // Above the sequence container's dead-area drag surface (zIndex 0) so a
        // connector's click-to-remove hit-target wins over the box drag. Still
        // below the cards (zIndex 1+, later in the DOM), so lines stay behind them.
        zIndex: 1,
        opacity: focusMode ? 0.18 : 1,
        transition: 'opacity 280ms ease-out',
      }}
    >
      <defs>
        <marker
          id="cb-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={dark ? 5.5 : 7}
          markerHeight={dark ? 5.5 : 7}
          orient="auto-start-reverse"
        >
          {/* Dark: PRECEDES head is VIOLET (the chronological throughline reads
              as the violet dashed line; CAUSES takes orange). Light unchanged. */}
          <path d="M 0 0 L 10 5 L 0 10 z" fill={dark ? '#a78bfa' : '#94a3b8'} opacity={dark ? 0.85 : 1} />
        </marker>
        {/* D'-11 — CAUSES arrowhead. Light: warm orange vs the gray PRECEDES
            head. Dark: orange (swapped — violet now belongs to PRECEDES). */}
        <marker
          id="cb-causes-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={dark ? 5.5 : 7}
          markerHeight={dark ? 5.5 : 7}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={dark ? DARK_ORANGE : '#e8833a'} opacity={dark ? 0.85 : 1} />
        </marker>
        {/* Soft glow for dark-mode connectors (from ScenesCanvasWorkspace's
            subtleGlow): blur the line and merge it back under itself. */}
        <filter id="cb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Sequence throughline — Sequence→Sequence chronology arrows, auto-chained
          in plot order at extraction. Same look as the event throughline; these
          are derived (not individually editable), so no splice/remove affordance. */}
      {(edges.sequence_precedes ?? []).map((e, i) => {
        const fr = rectOf(e.from);
        const tr = rectOf(e.to);
        if (!fr || !tr) return null;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const straight = isStraightLine(p1, p2);
        return (
          <g key={`sp-${i}`} style={{ animation: 'cb-edge-in 420ms ease-out' }}>
            {dark && !straight && (
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#8b5cf6" strokeWidth={4} opacity={0.09} strokeLinecap="round" />
            )}
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={dark ? '#a78bfa' : '#94a3b8'}
              strokeWidth={dark ? 1.6 : 1.5}
              strokeDasharray={dark ? '8 4' : undefined}
              opacity={dark ? 0.75 : 0.7}
              strokeLinecap="round"
              filter={dark && !straight ? 'url(#cb-glow)' : undefined}
              markerEnd="url(#cb-arrow)"
            />
          </g>
        );
      })}

      {/* PRECEDES — Event→Event directional arrows. Clickable to drop;
          highlighted during link-drag splice hover. Hover shows a ✕
          button at the midpoint for discoverability. */}
      {edges.precedes.map((e, i) => {
        // Throughline view: backstory is outside audience-time — never draw a
        // PRECEDES edge between a backstory beat and an on-screen scene.
        if (backstorySplit) {
          const fb = entities.find((x) => x.id === e.from)?.narrative_status === 'backstory';
          const tb = entities.find((x) => x.id === e.to)?.narrative_status === 'backstory';
          if (fb !== tb) return null;
        }
        const fr = rectOf(e.from);
        const tr = rectOf(e.to);
        if (!fr || !tr) return null;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const straight = isStraightLine(p1, p2);
        const removable = !!onRemovePrecedes;
        const edgeKey = `${e.from}|${e.to}`;
        const isSpliceTarget =
          !!linkDrag && linkDrag.moved && linkDrag.overEdgeKey === edgeKey;
        const isHovered = !linkDrag && hoveredEdgeKey === edgeKey;
        // Suppress click-to-remove during link-drag so the drop's mouseup
        // doesn't also fire a click that drops the edge we're splicing.
        const allowClickRemove = removable && !linkDrag;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        // Provisional STREAMED edge (optimistic spine, mid-extraction): pulse a
        // wide glow underlay on the streaming cards' shimmer cadence — the
        // line's own "working on it" cue until the write trues it up.
        const streaming = !!(e as { streamed?: boolean }).streamed;
        return (
          <g key={`p-${i}`} style={{ animation: 'cb-edge-in 420ms ease-out' }}>
            {streaming && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#8b5cf6"
                strokeWidth={7}
                strokeLinecap="round"
                style={{ animation: 'cb-edge-shimmer 1.5s ease-in-out infinite' }}
              />
            )}
            {/* Dark: wide soft halo painted UNDER the core (ScenesCanvas).
                Violet — the chronological throughline owns the violet dashed
                look in dark mode (CAUSES is orange). */}
            {dark && !straight && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#8b5cf6"
                strokeWidth={isSpliceTarget || isHovered ? 6 : 4}
                opacity={isSpliceTarget || isHovered ? 0.18 : 0.09}
                strokeLinecap="round"
              />
            )}
            {/* Visible line. Brighter + thicker on splice target OR hover. */}
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={
                isSpliceTarget
                  ? '#3b82f6'
                  : dark
                  ? isHovered
                    ? '#c4b5fd'
                    : '#a78bfa'
                  : isHovered
                  ? '#475569'
                  : '#94a3b8'
              }
              strokeWidth={dark ? (isSpliceTarget || isHovered ? 2.4 : 1.6) : isSpliceTarget || isHovered ? 2.5 : 1.5}
              strokeDasharray={dark ? '8 4' : undefined}
              opacity={dark ? (isSpliceTarget || isHovered ? 0.95 : 0.75) : isSpliceTarget || isHovered ? 1 : 0.7}
              strokeLinecap="round"
              filter={dark && !straight ? 'url(#cb-glow)' : undefined}
              markerEnd="url(#cb-arrow)"
              style={{ transition: 'stroke 120ms, stroke-width 120ms' }}
            />
            {/* Hit-target overlay — wider invisible stroke for easier
                clicking + hover tracking. Pointer-events: stroke so the
                wide region is reactive even though the parent SVG is
                pointer-events:none. */}
            {allowClickRemove && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                onMouseLeave={() => setHoveredEdgeKey((cur) => (cur === edgeKey ? null : cur))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setHoveredEdgeKey(null);
                  onRemovePrecedes!(e.from, e.to);
                }}
              >
                <title>Click to remove this link</title>
              </line>
            )}
            {/* ✕ remove button at midpoint, visible on hover. Filled
                circle background + glyph; clickable independently of the
                line itself so the affordance is obvious. */}
            {allowClickRemove && isHovered && (
              <g
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                onMouseLeave={() => setHoveredEdgeKey((cur) => (cur === edgeKey ? null : cur))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setHoveredEdgeKey(null);
                  onRemovePrecedes!(e.from, e.to);
                }}
              >
                <circle
                  cx={mx}
                  cy={my}
                  r={9}
                  fill="#fff"
                  stroke="#475569"
                  strokeWidth={1.5}
                />
                <text
                  x={mx}
                  y={my + 3.5}
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                  fill="#475569"
                  textAnchor="middle"
                  style={{ userSelect: 'none' }}
                >
                  ✕
                </text>
                <title>Remove this PRECEDES link</title>
              </g>
            )}
          </g>
        );
      })}

      {/* D'-11 — CAUSES. NOT drawn on the board: the master view shows ORDER
          only (the PRECEDES spine); causal links stay in the graph and read on
          the card sheets (Causality tile). Alt+drag still writes them. Flip
          this to true (or wire a toolbar toggle) to draw them again — the v11
          design intent was always chronology-default, causality-as-a-layer. */}
      {false && (edges.causes ?? []).map((e, i) => {
        const fr = rectOf(e.from);
        const tr = rectOf(e.to);
        if (!fr || !tr) return null;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const straight = isStraightLine(p1, p2);
        const removable = !!onRemoveCauses;
        const edgeKey = `causes|${e.from}|${e.to}`;
        const isHovered = !linkDrag && hoveredEdgeKey === edgeKey;
        const allowClickRemove = removable && !linkDrag;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        return (
          <g key={`c-${i}`} style={{ animation: 'cb-edge-in 420ms ease-out' }}>
            {/* Dark: orange halo + glow (swapped — violet now belongs to the
                chronological PRECEDES throughline). */}
            {dark && !straight && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={DARK_ORANGE}
                strokeWidth={isHovered ? 6 : 4}
                opacity={isHovered ? 0.16 : 0.08}
                strokeLinecap="round"
              />
            )}
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={dark ? (isHovered ? '#ffb088' : DARK_ORANGE) : isHovered ? '#c2410c' : '#e8833a'}
              strokeWidth={dark ? (isHovered ? 2.4 : 1.6) : isHovered ? 2.5 : 1.6}
              strokeDasharray={dark ? undefined : '2 4'}
              opacity={dark ? (isHovered ? 0.95 : 0.75) : isHovered ? 1 : 0.85}
              strokeLinecap="round"
              filter={dark && !straight ? 'url(#cb-glow)' : undefined}
              markerEnd="url(#cb-causes-arrow)"
              style={{ transition: 'stroke 120ms, stroke-width 120ms' }}
            />
            {allowClickRemove && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="transparent"
                strokeWidth={16}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                onMouseLeave={() => setHoveredEdgeKey((cur) => (cur === edgeKey ? null : cur))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setHoveredEdgeKey(null);
                  onRemoveCauses!(e.from, e.to);
                }}
              >
                <title>Click to remove this CAUSES link</title>
              </line>
            )}
            {allowClickRemove && isHovered && (
              <g
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                onMouseLeave={() => setHoveredEdgeKey((cur) => (cur === edgeKey ? null : cur))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setHoveredEdgeKey(null);
                  onRemoveCauses!(e.from, e.to);
                }}
              >
                <circle cx={mx} cy={my} r={9} fill="#fff" stroke="#c2410c" strokeWidth={1.5} />
                <text
                  x={mx}
                  y={my + 3.5}
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                  fill="#c2410c"
                  textAnchor="middle"
                  style={{ userSelect: 'none' }}
                >
                  ✕
                </text>
                <title>Remove this CAUSES link</title>
              </g>
            )}
          </g>
        );
      })}

      {/* Ghost arrow while link-dragging. Orange + tighter dash in CAUSES
          mode (Alt held), blue otherwise. */}
      {linkDrag && linkDrag.moved && (() => {
        const fr = rectOf(linkDrag.fromCardId);
        if (!fr) return null;
        const targetPoint = { cx: linkDrag.mouseCanvas.x, cy: linkDrag.mouseCanvas.y };
        const p1 = edgePoint(fr, targetPoint);
        const validTarget =
          linkDrag.overCardId && linkDrag.overCardId !== linkDrag.fromCardId;
        const causesMode = linkDrag.causesMode;
        const stroke = causesMode
          ? validTarget
            ? '#e8833a'
            : '#f0c4a0'
          : validTarget
          ? '#3b82f6'
          : '#cbd5e1';
        return (
          <line
            x1={p1.x}
            y1={p1.y}
            x2={linkDrag.mouseCanvas.x}
            y2={linkDrag.mouseCanvas.y}
            stroke={stroke}
            strokeWidth={2}
            strokeDasharray={causesMode ? '2 4' : '6 4'}
            opacity={0.9}
            markerEnd={causesMode ? 'url(#cb-causes-arrow)' : 'url(#cb-arrow)'}
          />
        );
      })()}

      {/* Structural — Character↔Character dashed lines with predicate label. */}
      {edges.structural.map((e, i) => {
        // Suppress the dashed tie when a reified Relationship represents this
        // pair — the relationship card on the edge stands in for it.
        if (reifiedPairs?.has(`${e.from}|${e.to}`)) return null;
        const fr = rectOf(e.from);
        const tr = rectOf(e.to);
        if (!fr || !tr) return null;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        // Label placement: prefer the midpoint, but if a card / pill covers it,
        // SLIDE along the line (alternating outward from center) to the first
        // clear spot. Focused-only labels keep this cheap: a few rect checks
        // against every visible card rect.
        const findLabelSpot = (halfW: number, halfH: number): { x: number; y: number } => {
          const obstacles = entities
            .map((ent) => rectOf(ent.id))
            .filter((r): r is NonNullable<ReturnType<typeof rectOf>> => !!r);
          for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
            const cx0 = p1.x + (p2.x - p1.x) * t;
            const cy0 = p1.y + (p2.y - p1.y) * t;
            const clear = !obstacles.some(
              (o) => cx0 - halfW < o.x + o.w && cx0 + halfW > o.x && cy0 - halfH < o.y + o.h && cy0 + halfH > o.y,
            );
            if (clear) return { x: cx0, y: cy0 };
          }
          return { x: mx, y: my }; // everything covered — midpoint fallback
        };
        // Perspective label (dual-wording convention): when the tie is focused
        // FROM an endpoint, read the fact from THAT character's side — hovering
        // Mabel shows 'abducted by', hovering Eoji shows 'abductor of'. Same
        // stored edge, two readings. Tie-hover / no anchor keeps the forward
        // wording; legacy edges without an inverse always read forward.
        const perspectiveId =
          hoveredCardId === e.from || hoveredCardId === e.to ? hoveredCardId
          : expandedCardId === e.from || expandedCardId === e.to ? expandedCardId
          : null;
        const rawPred = perspectiveId === e.to ? (e.inverse_predicate || e.predicate) : e.predicate;
        const pred = (rawPred ?? '').replace(/_/g, ' ').toLowerCase();
        const edgeKey = `s|${e.from}|${e.to}`;
        const isHovered = !linkDrag && hoveredEdgeKey === edgeKey;
        const editable = !!onEditStructural && !linkDrag;
        // Structural ties are DEMOTED by default: a whisper of a line, no label
        // (crossing labeled dashes were the board's worst noise). Full treatment
        // only on FOCUS — an endpoint character is expanded OR hovered, the tie
        // itself is hovered, or the wow tour is spotlighting this exact tie.
        // Reified pills stay the primary language.
        const focused = isHovered
          || expandedCardId === e.from || expandedCardId === e.to
          || hoveredCardId === e.from || hoveredCardId === e.to
          || (!!forcedTie
            && ((forcedTie.from === e.from && forcedTie.to === e.to)
              || (forcedTie.from === e.to && forcedTie.to === e.from)));
        return (
          <g key={`s-${i}`} opacity={focused ? 0.85 : 0.65}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={dark
                ? (focused ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.1)')
                : focused ? '#8a7a66' : 'rgba(196,181,165,0.35)'}
              strokeWidth={focused ? 2 : 1}
              strokeDasharray="5 3"
              style={{ transition: 'stroke 120ms, stroke-width 120ms' }}
            />
            {/* Hit-target — click to open the edit popover. */}
            {editable && (
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke="transparent" strokeWidth={16}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
                onMouseLeave={() => setHoveredEdgeKey((cur) => (cur === edgeKey ? null : cur))}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setHoveredEdgeKey(null);
                  onEditStructural!({ from: e.from, to: e.to, predicate: e.predicate ?? '', mx, my });
                }}
              >
                <title>Click to edit this tie</title>
              </line>
            )}
            {pred && focused && (() => {
              const spot = findLabelSpot(pred.length * 3.2 + 5, 9);
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect
                    x={spot.x - pred.length * 3.2}
                    y={spot.y - 8}
                    width={pred.length * 6.4}
                    height={14}
                    rx={2}
                    fill={dark ? '#141417' : '#fafafa'}
                    opacity={0.92}
                  />
                  <text
                    x={spot.x}
                    y={spot.y + 2}
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                    fill={dark ? '#a0a0aa' : '#666'}
                    textAnchor="middle"
                    style={{ letterSpacing: 0.3 }}
                  >
                    {pred}
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* Reified Relationship cards ARE the edge: ONE continuous dashed line
          straight between the two characters; the relationship pill renders on
          top (higher z-index) at the midpoint, so no break/gap shows behind it.
          Anchored to each character's COLLAPSED footprint so the endpoints stay
          static when a card is expanded. */}
      {relMidpoints && Array.from(relMidpoints.entries()).map(([relId, v]) => {
        const toAnchor = (r: ReturnType<typeof rectOf>) =>
          r && { x: r.x, y: r.y, w: CHAR_PILL_W, h: CHAR_PILL_H, cx: r.x + CHAR_PILL_W / 2, cy: r.y + CHAR_PILL_H / 2 };
        const ar = toAnchor(rectOf(v.aId));
        const br = toAnchor(rectOf(v.bId));
        if (!ar || !br) return null;
        const s = edgePoint(ar, br);
        const t = edgePoint(br, ar);
        return (
          <line
            key={`rel-${relId}`}
            x1={s.x} y1={s.y} x2={t.x} y2={t.y}
            stroke={REL_STUB_COLOR} strokeWidth={dark ? 1.2 : 1.4} strokeDasharray="4 3" opacity={dark ? 0.4 : 0.55}
          />
        );
      })}

      {/* Arc threads — precomputed beziers sewn through the events each arc
          EVOKES (geometry in the parent; ball layer shares the anchor). Dark:
          each thread gets a halo + glow pass in its own color. */}
      {arcThreadGeo?.map((g) => (
        <g key={`arc-${g.arcId}`} style={{ animation: 'cb-edge-in 420ms ease-out' }}>
          {dark && (
            <path
              d={g.pathD}
              fill="none"
              stroke={g.color}
              strokeWidth={4}
              opacity={0.08}
              strokeLinecap="round"
            />
          )}
          <path
            d={g.pathD}
            fill="none"
            stroke={g.color}
            strokeWidth={dark ? 1.6 : 1.8}
            opacity={dark ? 0.75 : 0.78}
            strokeLinecap="round"
            filter={dark ? 'url(#cb-glow)' : undefined}
          />
        </g>
      ))}
    </svg>
  );
}

export const REL_STUB_COLOR = getEntityColor('relationship');

// Distinct hues so multiple arc threads stay legible where they cross/overlap.
export const ARC_THREAD_PALETTE = [
  '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#0ea5e9',
];

// ---- Arc-thread geometry (shared by the path renderer + the ball placement) ----
export type ThreadRect = { x: number; y: number; w: number; h: number; cx: number; cy: number };

export type ThreadPt = { x: number; y: number };

export const ARC_OFFSET_SPACING = 7;

export function arcEdgeOf(r: ThreadRect, p: ThreadPt): 'T' | 'B' | 'L' | 'R' {
  const eps = 0.6;
  if (Math.abs(p.x - r.x) < eps) return 'L';
  if (Math.abs(p.x - (r.x + r.w)) < eps) return 'R';
  if (Math.abs(p.y - r.y) < eps) return 'T';
  return 'B';
}

export function arcOutwardNormal(r: ThreadRect, p: ThreadPt): ThreadPt {
  switch (arcEdgeOf(r, p)) {
    case 'T': return { x: 0, y: -1 };
    case 'B': return { x: 0, y: 1 };
    case 'L': return { x: -1, y: 0 };
    default: return { x: 1, y: 0 };
  }
}

// A point on the LEFT/RIGHT side at the card's mid-height (threads run through
// the sides; the connecting bezier handles vertical travel).
export function arcSidePoint(r: ThreadRect, side: 'L' | 'R'): ThreadPt {
  return { x: side === 'L' ? r.x : r.x + r.w, y: r.cy };
}

export function arcOffsetAlongEdge(r: ThreadRect, p: ThreadPt, idx: number, count: number): ThreadPt {
  if (count <= 1) return p;
  const d = (idx - (count - 1) / 2) * ARC_OFFSET_SPACING;
  const e = arcEdgeOf(r, p);
  return e === 'T' || e === 'B' ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d };
}

export function arcCubicAt(p0: ThreadPt, c1: ThreadPt, c2: ThreadPt, p3: ThreadPt, t: number): ThreadPt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

// Build the SVG path for an arc thread sewn through `stops` (touched event
// cards, in story order) + a ball anchor (midpoint of the middle segment, ON
// the curve). Sides propagate so each segment exits the previous scene and
// enters the next on the SAME side (bulge out, tuck back in); within a card the
// thread passes through to the opposite side.
export function buildArcThread(
  stops: { id: string; rect: ThreadRect }[],
  arcsAtEvent: Map<string, string[]>,
  arcId: string,
): { pathD: string; ballAnchor: ThreadPt | null; samples: ThreadPt[] } {
  const n = stops.length;
  if (n < 2) return { pathD: '', ballAnchor: null, samples: [] };
  const entrySide: (('L' | 'R') | null)[] = new Array(n).fill(null);
  const exitSide: (('L' | 'R') | null)[] = new Array(n).fill(null);
  exitSide[0] = stops[1].rect.cx < stops[0].rect.cx ? 'L' : 'R';
  for (let i = 1; i < n; i++) {
    entrySide[i] = exitSide[i - 1];
    exitSide[i] = i < n - 1 ? (entrySide[i] === 'L' ? 'R' : 'L') : null;
  }
  const nodes = stops.map((s, i) => {
    const r = s.rect;
    const arcs = arcsAtEvent.get(s.id) ?? [];
    const idx = Math.max(0, arcs.indexOf(arcId));
    let entry = entrySide[i] ? arcSidePoint(r, entrySide[i]!) : null;
    let exit = exitSide[i] ? arcSidePoint(r, exitSide[i]!) : null;
    if (entry) entry = arcOffsetAlongEdge(r, entry, idx, arcs.length);
    if (exit) exit = arcOffsetAlongEdge(r, exit, idx, arcs.length);
    return { rect: r, entry, exit };
  });
  const segs: string[] = [];
  const beziers: { p0: ThreadPt; c1: ThreadPt; c2: ThreadPt; p3: ThreadPt }[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (!a.exit || !b.entry) continue;
    const na = arcOutwardNormal(a.rect, a.exit);
    const nb = arcOutwardNormal(b.rect, b.entry);
    const dist = Math.hypot(b.entry.x - a.exit.x, b.entry.y - a.exit.y);
    const k = Math.min(dist * 0.72, 180);
    const c1 = { x: a.exit.x + na.x * k, y: a.exit.y + na.y * k };
    const c2 = { x: b.entry.x + nb.x * k, y: b.entry.y + nb.y * k };
    beziers.push({ p0: a.exit, c1, c2, p3: b.entry });
    segs.push(`M ${a.exit.x} ${a.exit.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.entry.x} ${b.entry.y}`);
  }
  if (beziers.length === 0) return { pathD: '', ballAnchor: null, samples: [] };
  // Sample points ALONG the curve so the ball can ride to the point nearest the
  // viewport as the user scrolls (phase 3).
  const samples: ThreadPt[] = [];
  for (const bz of beziers) for (let s = 0; s < 8; s++) samples.push(arcCubicAt(bz.p0, bz.c1, bz.c2, bz.p3, s / 8));
  const last = beziers[beziers.length - 1];
  samples.push(arcCubicAt(last.p0, last.c1, last.c2, last.p3, 1));
  const mid = beziers[Math.floor((beziers.length - 1) / 2)];
  return { pathD: segs.join(' '), ballAnchor: arcCubicAt(mid.p0, mid.c1, mid.c2, mid.p3, 0.5), samples };
}

// =====================================================================
// Auto-layout — columns by type. Cards without a stored layout land here.
// =====================================================================

// Order events into story order via a stable PRECEDES topological sort, so the
// events column reads chronologically top→bottom instead of in extraction /
// arrival order (the order a streamed-in screenplay happens to land in). Ties
// and disconnected events keep their input order (Kahn, stable).
export function topoSortEventsByPrecedes(
  events: ProjectEntity[],
  precedesEdges: Array<{ from: string; to: string }>,
): ProjectEntity[] {
  if (events.length < 2) return events;
  const ids = new Set(events.map((e) => e.id));
  const edges = precedesEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  if (edges.length === 0) return events;

  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const orderIdx = new Map<string, number>();
  events.forEach((e, i) => { indeg.set(e.id, 0); adj.set(e.id, []); orderIdx.set(e.id, i); });
  for (const edge of edges) {
    adj.get(edge.from)!.push(edge.to);
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }

  const byId = new Map(events.map((e) => [e.id, e]));
  const ready = events.filter((e) => (indeg.get(e.id) ?? 0) === 0).map((e) => e.id);
  ready.sort((a, b) => orderIdx.get(a)! - orderIdx.get(b)!);
  const out: ProjectEntity[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    const e = byId.get(id);
    if (e) out.push(e);
    for (const next of adj.get(id) ?? []) {
      const remaining = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) {
        const target = orderIdx.get(next)!;
        let i = 0;
        while (i < ready.length && orderIdx.get(ready[i])! < target) i++;
        ready.splice(i, 0, next);
      }
    }
  }
  // Defensive: append any cycle leftovers in input order.
  if (out.length < events.length) {
    const seen = new Set(out.map((e) => e.id));
    for (const e of events) if (!seen.has(e.id)) out.push(e);
  }
  return out;
}

export function computeAutoLayout(
  entities: ProjectEntity[],
  precedesEdges: Array<{ from: string; to: string }> = [],
  boardWidth = 1400,
  containsEdges: Array<{ from: string; to: string }> = [],
): Record<string, Pos> {
  // Composition: the CAST spawns as a GRID/web cluster on the left; the story
  // STRUCTURE (events throughline + sequence containers) runs as a spine to the
  // RIGHT of it; the whole [cast | spine] core is centered horizontally on the
  // board, and the cast block is centered vertically against the spine's height
  // so the two read as a balanced pair instead of a single left-margin stack.
  const stride = COLLAPSED_W + COL_GAP;
  const rowStride = COLLAPSED_H + ROW_GAP;

  // CONTAINS — a sequence that owns scenes renders as a CONTAINER box (the bbox
  // of its anchor label + member scenes). Members are laid out INSIDE its block
  // (same column as the anchor), not in the spine, and excluded from it below.
  const membersBySeq = new Map<string, string[]>();
  for (const c of containsEdges) {
    const arr = membersBySeq.get(c.from);
    if (arr) arr.push(c.to);
    else membersBySeq.set(c.from, [c.to]);
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  const memberEventIds = new Set<string>();
  for (const ids of membersBySeq.values()) for (const id of ids) if (byId.has(id)) memberEventIds.add(id);

  const byType: Record<string, ProjectEntity[]> = {};
  for (const e of entities) (byType[e.type] ??= []).push(e);

  const out: Record<string, Pos> = {};

  // --- Geometry: cast grid LEFT of center, structure spine AT center ----------
  // The throughline (events + sequence containers) owns the CENTER column; the
  // cast spawns as a 2-column grid to its LEFT. The char-grid gaps are widened
  // past the board default so a reified-relationship pill (REL_COLLAPSED_W×H)
  // lands in a clean gap between two character cards instead of behind one.
  // Characters render as NAME PILLS (CHAR_PILL_W × CHAR_PILL_H), so the cast
  // grid packs much tighter than the old card grid while still leaving room for
  // a reified-relationship pill (REL_COLLAPSED_W×H) in the gaps.
  const chars = byType.character ?? [];
  const charCols = chars.length <= 1 ? 1 : 2;
  const firstThird = boardWidth / 3;
  const CHAR_COL_GAP = Math.round(
    Math.max(REL_COLLAPSED_W + 12, Math.min(REL_COLLAPSED_W + 56, firstThird - CANVAS_PAD - 2 * CHAR_PILL_W)),
  );
  const CHAR_ROW_GAP = REL_COLLAPSED_H + 22; // room for a pill in the row gap
  const charStrideX = CHAR_PILL_W + CHAR_COL_GAP;
  const charStrideY = CHAR_PILL_H + CHAR_ROW_GAP;
  const charGridW = charCols * CHAR_PILL_W + (charCols - 1) * CHAR_COL_GAP;
  // Cast anchored top-LEFT (first third); throughline pulled toward board center
  // (as close as the cast width allows) with a clear lane between them.
  const gridLeft = CANVAS_PAD;
  const LANE = COL_GAP;
  const centerX = Math.round(boardWidth / 2 - EVENT_CARD_W / 2); // spine = event notecards
  const spineX = Math.max(gridLeft + (chars.length ? charGridW + LANE : 0), centerX);

  // The SPINE is ONE flow in true story order: loose events AND sequence
  // containers interleaved by PRECEDES position, top to bottom. Previously
  // loose events stacked first and every sequence stacked below them (by
  // created_at) — so a scene that comes late in the story could sort above an
  // early sequence. Now a global PRECEDES order ranks every event, a container
  // takes its EARLIEST member's rank, and the two kinds interleave by rank.
  const eventRowStride = COLLAPSED_H + ROW_GAP;
  const LABEL_H = 24; // the container header band — keep equal to ballEffects'
                      // SEQ_HEADER_H so the first scene sits flush below the header
                      // and the box doesn't jump between collapse and expand.
  const BOX_PAD = 14; // must match ballEffects' container box PAD: the rendered box
                      // extends this far above the anchor and below the last scene.
  const MEMBER_GAP = 24; // gap between member scenes inside a container — compact
                         // block, but with enough air that the cards breathe.
  const MEMBER_STRIDE = COLLAPSED_H + MEMBER_GAP;

  // Global PRECEDES rank over EVERY event (members included), so a container's
  // story position is its earliest member's rank.
  const globalOrder = topoSortEventsByPrecedes(byType.event ?? [], precedesEdges);
  const rankOf = new Map<string, number>();
  globalOrder.forEach((e, i) => rankOf.set(e.id, i));
  const BIG = Number.MAX_SAFE_INTEGER;

  // Spine items: loose events + container sequences, each with a sort rank.
  // Member-less sequences render as ordinary cards in the flow too (rank = BIG
  // so they trail, tie-broken by created_at — they have no story position yet).
  type SpineItem = { kind: 'event' | 'seq'; id: string; rank: number; created: string };
  const spineItems: SpineItem[] = [];
  for (const e of byType.event ?? []) {
    if (memberEventIds.has(e.id)) continue;
    spineItems.push({ kind: 'event', id: e.id, rank: rankOf.get(e.id) ?? BIG, created: String(e.created_at ?? '') });
  }
  const membersOrderedBySeq = new Map<string, ProjectEntity[]>();
  for (const s of byType.sequence ?? []) {
    const memberIds = (membersBySeq.get(s.id) ?? []).filter((id) => byId.has(id));
    if (memberIds.length === 0) {
      spineItems.push({ kind: 'event', id: s.id, rank: BIG, created: String(s.created_at ?? '') });
      continue;
    }
    const members = topoSortEventsByPrecedes(memberIds.map((id) => byId.get(id)!).filter(Boolean), precedesEdges);
    membersOrderedBySeq.set(s.id, members);
    const rank = Math.min(...members.map((m) => rankOf.get(m.id) ?? BIG));
    spineItems.push({ kind: 'seq', id: s.id, rank, created: String(s.created_at ?? '') });
  }
  spineItems.sort((a, b) => (a.rank - b.rank) || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));

  let seqY = CANVAS_PAD; // visible top of the next spine element
  for (const item of spineItems) {
    if (item.kind === 'event') {
      out[item.id] = { x: spineX, y: seqY };
      seqY += eventRowStride; // one card + a normal gap
      continue;
    }
    // Container: the box adds BOX_PAD above the anchor and below the last scene.
    // Push the anchor down by BOX_PAD so the BOX TOP (anchor - PAD) lands at seqY,
    // giving the box the same ROW_GAP gap to its neighbors a normal card has.
    const members = membersOrderedBySeq.get(item.id) ?? [];
    const anchorY = seqY + BOX_PAD;
    out[item.id] = { x: spineX, y: anchorY };
    members.forEach((m, i) => { out[m.id] = { x: spineX, y: anchorY + LABEL_H + i * MEMBER_STRIDE }; });
    const lastMemberBottom = anchorY + LABEL_H + (members.length - 1) * MEMBER_STRIDE + COLLAPSED_H;
    seqY = lastMemberBottom + BOX_PAD + ROW_GAP; // box bottom + a normal gap to next
  }

  // --- Cast GRID (2 columns), centered vertically against the spine ----------
  // Order the cast so reified-relationship partners sit ADJACENT in the fill
  // order — adjacent cards put their relationship pill in a clean gap (the
  // widened CHAR_COL_GAP/CHAR_ROW_GAP gives it room) instead of behind a third
  // card. The relationship pills + structural lines then read as a web.
  const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase();
  const nameToId = new Map(chars.map((c) => [norm(c.working_name), c.id]));
  const partners = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!partners.has(a)) partners.set(a, new Set());
    partners.get(a)!.add(b);
  };
  for (const r of byType.relationship ?? []) {
    const a = nameToId.get(norm((r as any).character_a));
    const b = nameToId.get(norm((r as any).character_b));
    if (a && b && a !== b) { link(a, b); link(b, a); }
  }
  const orderedChars: ProjectEntity[] = [];
  const placedChar = new Set<string>();
  for (const c of chars) {
    if (placedChar.has(c.id)) continue;
    orderedChars.push(c); placedChar.add(c.id);
    for (const pid of partners.get(c.id) ?? []) {
      if (placedChar.has(pid)) continue;
      const pc = byId.get(pid);
      if (pc) { orderedChars.push(pc); placedChar.add(pid); }
    }
  }

  // Top row close to the top of the board (no vertical centering against the spine).
  const gridTop = CANVAS_PAD;
  orderedChars.forEach((e, i) => {
    const col = i % charCols;
    const row = Math.floor(i / charCols);
    out[e.id] = { x: gridLeft + col * charStrideX, y: gridTop + row * charStrideY };
  });

  // Arcs that render as free cards (0-1 touched events) sit just RIGHT of the
  // throughline. Reified relationships (pills on cast edges) + locations (mostly
  // sidebar) get a fallback lane further right.
  const arcLane = spineX + EVENT_CARD_W + COL_GAP; // clear the wider event notecards
  const sideX = arcLane + stride;
  const colStack = (list: ProjectEntity[], x: number) =>
    list.forEach((e, i) => { out[e.id] = { x, y: CANVAS_PAD + i * rowStride }; });
  colStack(byType.arc ?? [], arcLane);
  colStack(byType.relationship ?? [], sideX);
  colStack(byType.location ?? [], sideX);

  return out;
}
