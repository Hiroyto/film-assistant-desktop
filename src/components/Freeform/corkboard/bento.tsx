// components/Freeform/corkboard/bento.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { hexToRgba } from '../../../components/Freeform/entityColors';
import RGL, { WidthProvider, type Layout } from 'react-grid-layout';
import { liftColor, useThemeMode } from './theme';

// =====================================================================
// Bento section-tile system (card-surface rework).
//
// The fullscreen sheet is a react-grid-layout of section tiles. Each tile is a
// draggable + resizable card: drag the header to reorder, drag the bottom-right
// handle to resize (widen to the full column count, grow/shrink rows). The
// grid compacts vertically so there's no dead vertical space. A tile collapses
// to a 1×1 chip (header only, with a one-line summary) and restores to its
// prior size on expand. Per-card-type tile sets + default sizes/expand state
// are declared by each sheet (Event / Character / Arc) via `tiles`.
// =====================================================================

export const BentoGrid = WidthProvider(RGL);

// Small row height → tiles fit their content (auto-height); a tile's row-span
// is derived from a measured pixel height, not authored. Width is the only
// user-resizable axis.
export const BENTO_ROW_H = 4;

export const BENTO_MARGIN = 10;

export function pxToRows(px: number): number {
  return Math.max(1, Math.ceil((px + BENTO_MARGIN) / (BENTO_ROW_H + BENTO_MARGIN)));
}

export type SectionTileDef = {
  id: string;
  label: string;
  /** One-line summary shown on the collapsed chip (e.g. "2 arcs"). */
  summary?: string;
  /** Default WIDTH in grid columns when expanded. Height is auto (fits text). */
  defaultW?: number;
  defaultExpanded?: boolean;
  /** Accent stripe color (entity color, or a section-specific hue). */
  accent?: string;
  content: React.ReactNode;
};

export type BentoLayoutBuilder = (
  tiles: SectionTileDef[],
  columns: number,
  collapsed: Set<string>,
) => Layout[];

export const buildBentoLayout: BentoLayoutBuilder = (tiles, columns, collapsed) => {
  // Initial left-to-right flow pack; h is a placeholder corrected on first
  // measure (auto-height). RGL compacts vertically.
  let x = 0;
  let y = 0;
  const out: Layout[] = [];
  for (const t of tiles) {
    const w = collapsed.has(t.id) ? 1 : Math.min(t.defaultW ?? 2, columns);
    if (x + w > columns) { x = 0; y += 8; }
    out.push({ i: t.id, x, y, w, h: 6, minW: 1, minH: 1 });
    x += w;
  }
  return out;
};

// Designed default layout (per Ben): the writer's workspace is the centerpiece.
// Top row is a 2x2 split — `topId` (Summary) and `centerId` (Open Questions /
// working section) side by side. Every other tile flows 2-up BELOW, filling
// both columns (no dead column), ordered by `priority` with data-bearing
// (expanded) tiles first and empty (collapsed) ones sinking to the bottom as
// chips. RGL's vertical compaction masonries the two columns tight; h is
// auto-measured. Shared by the Character and Event sheets (different priority
// lists); Event leads with sub-events.
export function makeDesignedBentoLayout(
  topId: string,
  centerId: string,
  priority: string[],
): BentoLayoutBuilder {
  return (tiles, columns, collapsed) => {
    const half = Math.max(1, Math.floor(columns / 2));
    const byId = new Map(tiles.map((t) => [t.id, t]));
    const out: Layout[] = [];
    const place = (id: string, x: number, y: number, w: number) => {
      if (byId.has(id)) out.push({ i: id, x, y, w, h: 6, minW: 1, minH: 1 });
    };
    // Top row: Summary | Open Questions, side by side (each half-width).
    let y = 0;
    const hasTop = byId.has(topId);
    const hasCenter = byId.has(centerId);
    if (hasTop) place(topId, 0, 0, half);
    if (hasCenter) place(centerId, hasTop ? half : 0, 0, half);
    if (hasTop || hasCenter) y = 6;
    const placed = new Set([topId, centerId]);
    // Everything else flows 2-up across both columns, priority order, with
    // data-bearing tiles ahead of empty (collapsed) ones.
    const restIds = [
      ...priority.filter((id) => byId.has(id) && !placed.has(id)),
      ...tiles.map((t) => t.id).filter((id) => !placed.has(id) && !priority.includes(id)),
    ];
    const ordered = [
      ...restIds.filter((id) => !collapsed.has(id)),
      ...restIds.filter((id) => collapsed.has(id)),
    ];
    let x = 0;
    for (const id of ordered) {
      if (x + half > columns) { x = 0; y += 6; }
      place(id, x, y, half);
      x += half;
    }
    return out;
  };
}

export const buildCharacterBentoLayout = makeDesignedBentoLayout(
  'identity', 'working',
  ['knowledge', 'arcs', 'relationships', 'appears-in'],
);

// Event leads the right column with sub-events (the key Event tile), then
// knowledge + arcs, then the structural tiles.
export const buildEventBentoLayout = makeDesignedBentoLayout(
  'summary', 'working',
  ['subevents', 'knowledge', 'arcs', 'throughline', 'causality', 'established', 'cast', 'location'],
);

// Arc + Relationship have no peer workspace, so the centerId (the tile beside
// Summary on the top row) is the sheet's primary content: the Arc's EVOKES
// timeline / the Relationship's shared events.
export const buildArcBentoLayout = makeDesignedBentoLayout(
  'identity', 'timeline',
  ['involves', 'opendims', 'crossrefs'],
);

export const buildRelationshipBentoLayout = makeDesignedBentoLayout(
  'identity', 'shared',
  ['endpoints', 'opendims'],
);

// --- Bento layout persistence (per-card, localStorage) ---
// Pure UI chrome: each card remembers how the writer arranged its tiles. We
// store only the user-controlled axes (x / y / w) + the collapsed set; h is
// content-driven (ResizeObserver) and re-measured on every mount, so a stored
// h is just a best-effort anti-flash seed. The load path reconciles the saved
// blob against the CURRENT tile defs — tiles added in newer code appear with
// their defaults, tiles since removed are dropped — so changing the tile
// inventory never corrupts a saved layout.
export const BENTO_STORE_PREFIX = 'ff-bento:';

// v6: top row is a 2x2 split (Summary | Open Questions side by side), data
// tiles flow 2-up below. Bumping invalidates the persisted v5 layout so the
// new default takes effect.
export const BENTO_STORE_VERSION = 6;

export type StoredBento = {
  v: number;
  layout: { i: string; x: number; y: number; w: number; h: number }[];
  collapsed: string[];
};

export function readBentoStore(persistKey?: string): StoredBento | null {
  if (!persistKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BENTO_STORE_PREFIX + persistKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBento;
    if (!parsed || parsed.v !== BENTO_STORE_VERSION || !Array.isArray(parsed.layout)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBentoStore(persistKey: string | undefined, layout: Layout[], collapsed: Set<string>): void {
  if (!persistKey || typeof window === 'undefined') return;
  try {
    const payload: StoredBento = {
      v: BENTO_STORE_VERSION,
      layout: layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
      collapsed: Array.from(collapsed),
    };
    window.localStorage.setItem(BENTO_STORE_PREFIX + persistKey, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — in-memory state still works.
  }
}

export function initBentoCollapsed(persistKey: string | undefined, tiles: SectionTileDef[]): Set<string> {
  const stored = readBentoStore(persistKey);
  if (!stored) return new Set(tiles.filter((t) => !t.defaultExpanded).map((t) => t.id));
  const savedIds = new Set(stored.layout.map((e) => e.i));
  const savedCollapsed = new Set(stored.collapsed ?? []);
  const out = new Set<string>();
  for (const t of tiles) {
    if (savedIds.has(t.id)) {
      if (savedCollapsed.has(t.id)) out.add(t.id);
    } else if (!t.defaultExpanded) {
      out.add(t.id);
    }
  }
  return out;
}

export function initBentoLayout(
  persistKey: string | undefined,
  tiles: SectionTileDef[],
  columns: number,
  collapsed: Set<string>,
  build: BentoLayoutBuilder = buildBentoLayout,
): Layout[] {
  const defaultLayout = build(tiles, columns, collapsed);
  const stored = readBentoStore(persistKey);
  if (!stored) return defaultLayout;
  const savedById = new Map(stored.layout.map((e) => [e.i, e]));
  const defaultById = new Map(defaultLayout.map((e) => [e.i, e]));
  return tiles.map((t) => {
    const s = savedById.get(t.id);
    if (s) {
      return { i: t.id, x: s.x ?? 0, y: s.y ?? 0, w: Math.min(s.w ?? 2, columns), h: s.h ?? 6, minW: 1, minH: 1 };
    }
    // New tile the saved layout never knew about — fall back to its default slot.
    return defaultById.get(t.id) ?? { i: t.id, x: 0, y: 0, w: 2, h: 6, minW: 1, minH: 1 };
  });
}

// Centered view: the chosen tile spans the full width at the top (expanded);
// the rest flow two-per-row beneath it. Derived from the current layout so each
// tile keeps its measured height.
export function computeCenteredLayout(centerId: string, layout: Layout[], columns: number): Layout[] {
  const half = Math.max(1, Math.floor(columns / 2));
  const center = layout.find((l) => l.i === centerId);
  const centerH = center?.h ?? 6;
  const out: Layout[] = [{ i: centerId, x: 0, y: 0, w: columns, h: centerH, minW: 1, minH: 1 }];
  let x = 0;
  let y = centerH;
  let rowH = 0;
  for (const o of layout) {
    if (o.i === centerId) continue;
    if (x + half > columns) { x = 0; y += rowH; rowH = 0; }
    out.push({ i: o.i, x, y, w: half, h: o.h, minW: 1, minH: 1 });
    x += half;
    rowH = Math.max(rowH, o.h);
  }
  return out;
}

export function BentoSheet({
  tiles,
  columns = 4,
  persistKey,
  buildDefaultLayout,
}: {
  tiles: SectionTileDef[];
  columns?: number;
  /** Stable per-card key (e.g. `event:${entity.id}`). When set, the tile
   *  arrangement is saved to / restored from localStorage for that card. */
  persistKey?: string;
  /** Optional designed default layout (e.g. the Character sheet's). Falls back
   *  to the generic left-to-right flow pack when omitted. */
  buildDefaultLayout?: BentoLayoutBuilder;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initBentoCollapsed(persistKey, tiles),
  );
  const [layout, setLayout] = useState<Layout[]>(() =>
    initBentoLayout(persistKey, tiles, columns, collapsed, buildDefaultLayout),
  );
  const measured = useRef<Record<string, number>>({});
  // Tracks which card's state is currently loaded so we re-init when the sheet
  // is reused for a different card without unmounting.
  const loadedKey = useRef<string | undefined>(persistKey);
  // Center view: which tile is centered (top, full-width) + the arrangement to
  // restore on un-center. A manual drag/resize clears the restore — the user's
  // new placement wins.
  const [centeredId, setCenteredId] = useState<string | null>(null);
  const restoreRef = useRef<{ layout: Layout[]; collapsed: Set<string> } | null>(null);

  // Re-load when the card changes in-place (no remount).
  useEffect(() => {
    if (loadedKey.current === persistKey) return;
    loadedKey.current = persistKey;
    measured.current = {};
    restoreRef.current = null;
    setCenteredId(null);
    const nextCollapsed = initBentoCollapsed(persistKey, tiles);
    setCollapsed(nextCollapsed);
    setLayout(initBentoLayout(persistKey, tiles, columns, nextCollapsed, buildDefaultLayout));
    // tiles/columns intentionally read fresh; only persistKey gates a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]);

  // Persist arrangement changes (debounced — coalesces auto-height churn). The
  // centered view is transient — never persisted, so localStorage keeps the
  // user's real baseline.
  useEffect(() => {
    if (!persistKey || centeredId) return;
    const handle = setTimeout(() => writeBentoStore(persistKey, layout, collapsed), 400);
    return () => clearTimeout(handle);
  }, [persistKey, layout, collapsed, centeredId]);

  // A tile reports its natural content height; we set its row-span to fit it.
  // Width changes (user resize) reflow text → new height → re-fit.
  const onMeasure = useCallback((id: string, px: number) => {
    if (measured.current[id] === px) return;
    measured.current[id] = px;
    const rows = pxToRows(px);
    setLayout((lay) => {
      let changed = false;
      const next = lay.map((it) => {
        if (it.i !== id || it.h === rows) return it;
        changed = true;
        return { ...it, h: rows };
      });
      return changed ? next : lay;
    });
  }, []);

  const toggle = (id: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Height re-fits automatically when content shows/hides (ResizeObserver).
  };

  // Toggle a tile into / out of the centered view. Centering snapshots the
  // current arrangement (once), expands the tile, and lays it full-width on top
  // with the rest two-per-row below. Un-centering restores the snapshot.
  const centerTile = useCallback((id: string) => {
    if (centeredId === id) {
      if (restoreRef.current) {
        setLayout(restoreRef.current.layout);
        setCollapsed(restoreRef.current.collapsed);
        restoreRef.current = null;
      }
      setCenteredId(null);
      return;
    }
    if (centeredId === null) {
      restoreRef.current = { layout, collapsed: new Set(collapsed) };
    }
    setCollapsed((c) => { const n = new Set(c); n.delete(id); return n; });
    setLayout((lay) => computeCenteredLayout(id, lay, columns));
    setCenteredId(id);
  }, [centeredId, layout, collapsed, columns]);

  // A manual drag/resize commits the current arrangement as the new baseline —
  // un-centering won't revert it, and it persists.
  const commitManualMove = useCallback(() => {
    restoreRef.current = null;
    setCenteredId(null);
  }, []);

  // Drop this card's saved arrangement and snap back to the designed default.
  // Passing `undefined` as the persistKey forces the init helpers to ignore
  // storage and use pure defaults. (Iteration escape hatch — no version bump
  // needed to see a changed default.)
  const resetLayout = useCallback(() => {
    if (persistKey && typeof window !== 'undefined') {
      try { window.localStorage.removeItem(BENTO_STORE_PREFIX + persistKey); } catch { /* ignore */ }
    }
    const def = initBentoCollapsed(undefined, tiles);
    setCollapsed(def);
    setLayout(initBentoLayout(undefined, tiles, columns, def, buildDefaultLayout));
    setCenteredId(null);
    restoreRef.current = null;
    measured.current = {};
  }, [persistKey, tiles, columns, buildDefaultLayout]);

  return (
    <div className="cb-scroll" style={{ height: '100%', overflowY: 'auto', padding: '8px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button
          type="button"
          onClick={resetLayout}
          title="Discard this card's saved tile arrangement and restore the default layout"
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase',
            color: '#94a3b8', padding: '2px 4px',
          }}
        >
          ↺ reset layout
        </button>
      </div>
      {/* Styling for library-injected elements (placeholder + resize handles)
          that have no inline-style hook. Not a stylesheet file — a co-located
          block scoped to .bento-grid. */}
      <style>{`
        .bento-grid .react-grid-item.react-grid-placeholder { background: transparent !important; opacity: 0 !important; }
        .bento-grid .react-resizable-handle {
          background: none !important;
          width: 14px !important; height: auto !important;
          top: 0 !important; bottom: 0 !important; margin: 0 !important; padding: 0 !important;
          transform: none !important; z-index: 1 !important;
          opacity: 0; transition: opacity 120ms ease;
        }
        .bento-grid .react-grid-item:hover .react-resizable-handle { opacity: 1; }
        .bento-grid .react-resizable-handle::after {
          content: ''; position: absolute; top: 50%; transform: translateY(-50%);
          width: 3px; height: 60%; max-height: 38px; border-radius: 999px; background: #e2e8f0;
          transition: background 120ms ease;
        }
        .bento-grid .react-resizable-handle-w::after { left: 3px; }
        .bento-grid .react-resizable-handle-e::after { right: 3px; }
        .bento-grid .react-resizable-handle:hover::after { background: #94a3b8; }
        .bento-grid .react-resizable-handle-e { right: 0 !important; left: auto !important; cursor: ew-resize !important; }
        .bento-grid .react-resizable-handle-w { left: 0 !important; right: auto !important; cursor: ew-resize !important; }
      `}</style>
      <BentoGrid
        className="bento-grid"
        style={{ position: 'relative' }}
        layout={layout}
        cols={columns}
        rowHeight={BENTO_ROW_H}
        margin={[BENTO_MARGIN, BENTO_MARGIN]}
        onLayoutChange={(l: Layout[]) => setLayout(l)}
        onDragStart={() => {
          document.body.style.userSelect = 'none';
          (document.body.style as any).webkitUserSelect = 'none';
        }}
        onDragStop={() => {
          document.body.style.userSelect = '';
          (document.body.style as any).webkitUserSelect = '';
          commitManualMove();
        }}
        onResizeStart={() => {
          document.body.style.userSelect = 'none';
          (document.body.style as any).webkitUserSelect = 'none';
        }}
        onResizeStop={() => {
          document.body.style.userSelect = '';
          (document.body.style as any).webkitUserSelect = '';
          commitManualMove();
        }}
        draggableHandle=".bento-grip"
        draggableCancel=".bento-no-drag"
        compactType="vertical"
        isDraggable
        isResizable
        resizeHandles={['e', 'w']}
      >
        {tiles.map((t) => (
          <div key={t.id}>
            <SectionTile
              def={t}
              expanded={!collapsed.has(t.id)}
              centered={centeredId === t.id}
              onToggle={() => toggle(t.id)}
              onCenter={() => centerTile(t.id)}
              onMeasure={onMeasure}
            />
          </div>
        ))}
      </BentoGrid>
    </div>
  );
}

export function SectionTile({
  def,
  expanded,
  centered,
  onToggle,
  onCenter,
  onMeasure,
}: {
  def: SectionTileDef;
  expanded: boolean;
  centered?: boolean;
  onToggle: () => void;
  onCenter?: () => void;
  onMeasure: (id: string, px: number) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const accent = def.accent ?? '#94a3b8';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onMeasure(def.id, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [def.id, expanded, onMeasure]);

  return (
    <div
      ref={ref}
      style={{
        border: dark ? '1px solid #26262b' : '1px solid #e5e7eb',
        borderTop: `2px solid ${dark ? hexToRgba(liftColor(accent, 0.25), 0.65) : accent}`,
        borderRadius: 8,
        background: dark ? '#17171b' : '#fff',
        boxShadow: dark ? '0 2px 12px rgba(0,0,0,0.35)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        // Dragging/clicking the chrome must not start a text selection (the
        // selection both looks wrong and swallows the toggle click). Content
        // re-enables selection below so prose stays copyable.
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Dedicated grip (the ONLY drag handle) + a click-to-toggle label.
          Separate targets so trying to expand never triggers a drag. */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          cursor: 'pointer',
          borderBottom: expanded ? (dark ? '1px solid #222228' : '1px solid #f1f5f9') : 'none',
        }}
      >
        <span
          className="bento-grip"
          title="Drag to move"
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'grab', color: dark ? '#4a4a52' : '#cbd5e1', fontSize: 13, lineHeight: 1, userSelect: 'none', flexShrink: 0, padding: '0 2px', position: 'relative', zIndex: 10 }}
        >
          ⠿
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: dark ? '#8c8c96' : '#475569',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {def.label}
        </span>
        {onCenter && (
          <button
            className="bento-no-drag"
            type="button"
            onClick={(e) => { e.stopPropagation(); onCenter(); }}
            title={centered ? 'Restore layout' : 'Center this tile'}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: centered ? accent : '#cbd5e1', fontSize: 12, lineHeight: 1,
              padding: '0 2px', flexShrink: 0,
            }}
          >
            {centered ? '⤡' : '⤢'}
          </button>
        )}
        <span style={{ fontSize: 11, color: dark ? '#6e6e78' : '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {expanded ? '–' : def.summary ?? '+'}
        </span>
      </div>
      {expanded && (
        <div
          className="bento-no-drag"
          style={{ padding: '8px 10px', userSelect: 'text', WebkitUserSelect: 'text' }}
        >
          {def.content}
        </div>
      )}
    </div>
  );
}
