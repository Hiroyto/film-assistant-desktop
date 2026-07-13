// components/Freeform/corkboard/connectors.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState } from 'react';
import { getEntityColor } from '../../../components/Freeform/entityColors';
import { type ProjectEdges, type ProjectEntity } from '../../../lib/freeformApi';
import { CANVAS_PAD, COLLAPSED_H, COLLAPSED_W, COL_GAP, EXPANDED_W, PEER_GAP, REL_COLLAPSED_H, REL_COLLAPSED_W, ROW_GAP, type Pos } from './constants';
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
}: {
  width: number;
  height: number;
  entities: ProjectEntity[];
  positions: Record<string, Pos>;
  edges: ProjectEdges;
  expandedCardId: string | null;
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
  const rectOf = (id: string) => {
    if (hiddenIds?.has(id)) return null;
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
    const w = isExp ? EXPANDED_W : relMid ? REL_COLLAPSED_W : COLLAPSED_W;
    const h = isExp ? (expandedCardH > 0 ? expandedCardH : COLLAPSED_H) : relMid ? REL_COLLAPSED_H : COLLAPSED_H;
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
        zIndex: 0,
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
          <path d="M 0 0 L 10 5 L 0 10 z" fill={dark ? DARK_ORANGE : '#94a3b8'} opacity={dark ? 0.85 : 1} />
        </marker>
        {/* D'-11 — CAUSES arrowhead. Light: warm orange vs the gray PRECEDES
            head. Dark: violet — orange is the PRECEDES glow there. */}
        <marker
          id="cb-causes-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={dark ? 5.5 : 7}
          markerHeight={dark ? 5.5 : 7}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={dark ? '#a78bfa' : '#e8833a'} opacity={dark ? 0.85 : 1} />
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
        return (
          <g key={`p-${i}`}>
            {/* Dark: wide soft halo painted UNDER the core (ScenesCanvas). */}
            {dark && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={DARK_ORANGE}
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
                  ? DARK_ORANGE
                  : isHovered
                  ? '#475569'
                  : '#94a3b8'
              }
              strokeWidth={dark ? (isSpliceTarget || isHovered ? 2.4 : 1.6) : isSpliceTarget || isHovered ? 2.5 : 1.5}
              opacity={dark ? (isSpliceTarget || isHovered ? 0.95 : 0.75) : isSpliceTarget || isHovered ? 1 : 0.7}
              strokeLinecap="round"
              filter={dark ? 'url(#cb-glow)' : undefined}
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

      {/* D'-11 — CAUSES. Event/Arc → Event/Arc causal links. Dashed orange,
          distinct from PRECEDES (solid gray) and structural (dashed tan).
          Layered on top of PRECEDES so an Event→Event pair can show both.
          Clickable to drop; hover shows a ✕ at the midpoint. */}
      {(edges.causes ?? []).map((e, i) => {
        const fr = rectOf(e.from);
        const tr = rectOf(e.to);
        if (!fr || !tr) return null;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const removable = !!onRemoveCauses;
        const edgeKey = `causes|${e.from}|${e.to}`;
        const isHovered = !linkDrag && hoveredEdgeKey === edgeKey;
        const allowClickRemove = removable && !linkDrag;
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        return (
          <g key={`c-${i}`}>
            {/* Dark: violet halo + glow (orange belongs to PRECEDES there). */}
            {dark && (
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="#8b5cf6"
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
              stroke={dark ? (isHovered ? '#c4b5fd' : '#a78bfa') : isHovered ? '#c2410c' : '#e8833a'}
              strokeWidth={dark ? (isHovered ? 2.4 : 1.5) : isHovered ? 2.5 : 1.6}
              strokeDasharray={dark ? '8 4' : '2 4'}
              opacity={dark ? (isHovered ? 0.95 : 0.7) : isHovered ? 1 : 0.85}
              strokeLinecap="round"
              filter={dark ? 'url(#cb-glow)' : undefined}
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
        const pred = (e.predicate ?? '').replace(/_/g, ' ').toLowerCase();
        const edgeKey = `s|${e.from}|${e.to}`;
        const isHovered = !linkDrag && hoveredEdgeKey === edgeKey;
        const editable = !!onEditStructural && !linkDrag;
        return (
          <g key={`s-${i}`} opacity={0.65}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={dark ? (isHovered ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)') : isHovered ? '#8a7a66' : '#c4b5a5'}
              strokeWidth={isHovered ? 2 : 1.2}
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
            {pred && (
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={mx - pred.length * 3.2}
                  y={my - 8}
                  width={pred.length * 6.4}
                  height={14}
                  rx={2}
                  fill={dark ? '#141417' : '#fafafa'}
                  opacity={0.92}
                />
                <text
                  x={mx}
                  y={my + 2}
                  fontSize={10}
                  fontFamily="system-ui, sans-serif"
                  fill={dark ? '#a0a0aa' : '#666'}
                  textAnchor="middle"
                  style={{ letterSpacing: 0.3 }}
                >
                  {pred}
                </text>
              </g>
            )}
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
          r && { x: r.x, y: r.y, w: COLLAPSED_W, h: COLLAPSED_H, cx: r.x + COLLAPSED_W / 2, cy: r.y + COLLAPSED_H / 2 };
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
        <g key={`arc-${g.arcId}`}>
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

export function computeAutoLayout(entities: ProjectEntity[]): Record<string, Pos> {
  const columns: Record<string, number> = {
    character: 0,
    event: 1,
    location: 2,
    relationship: 3,
  };
  const byType: Record<string, ProjectEntity[]> = {};
  for (const e of entities) (byType[e.type] ??= []).push(e);

  const out: Record<string, Pos> = {};
  for (const [type, list] of Object.entries(byType)) {
    const col = columns[type] ?? 4;
    list.forEach((e, i) => {
      out[e.id] = {
        x: CANVAS_PAD + col * (COLLAPSED_W + COL_GAP),
        y: CANVAS_PAD + i * (COLLAPSED_H + ROW_GAP),
      };
    });
  }
  return out;
}
