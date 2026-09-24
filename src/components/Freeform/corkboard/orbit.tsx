// components/Freeform/corkboard/orbit.tsx — the full sheet as a corkboard.
//
// FIL-588. The bento showed every section at once: opening a scene landed the
// writer on a dense grid of tiles and three separate deep-usage sessions said
// the same thing, that they did not know what to do with it. This surface
// inverts that. The card you opened sits in the middle. A mini toolbar names
// the categories that touch it. Selecting one floats JUST that category's
// cards around the focal, connected to it. One category on stage at a time —
// selecting replaces, never stacks, because stacking is how the bento got to
// twelve tiles.
//
// It consumes the SAME SectionTileDef[] the bento does, so a sheet switches by
// swapping the component. A tile with `items` becomes real satellites; a tile
// without them falls back to rendering its existing `content` in one floating
// panel. That fallback is what makes this adoptable one category at a time
// instead of as a rewrite — and a converted category keeps its `content` too,
// reachable from the category's own button, because that content is where the
// adding and removing lives.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hexToRgba } from '../entityColors';
import { NOTE_FONT_SERIF, PEER_BLUE } from '../tokens';
import { useThemeMode } from './theme';
import { getCardLayouts, updateCardPosition } from '../../../lib/freeformApi';
import type { SectionTileDef } from './bento';
/** WowFlow asks the open sheet to show a category (see the listener in
 *  OrbitSheet). A window event, so the tour holds no handle on the sheet. */
export const ORBIT_PICK_EVENT = 'ff-orbit-pick';
export function requestOrbitCategory(id: string) {
  try { window.dispatchEvent(new CustomEvent(ORBIT_PICK_EVENT, { detail: id })); } catch { /* ignore */ }
}


/** One floating card in the ring. A tile supplies these to get satellites
 *  instead of the fallback panel. */
export type OrbitItem = {
  id: string;
  /** Small uppercase line above the title (type, SC number, relation). */
  kicker?: string;
  /** Renders the kicker in mono — for SC numbers and other machine-ish refs. */
  kickerMono?: boolean;
  title: string;
  body?: string;
  /** Overrides the category accent for this one card (e.g. an entity color). */
  accent?: string;
  /** pill = character node · note = default card · peer = the peer's voice ·
   *  ghost = an absence worth showing (an unfilled slot, an unset state). */
  shape?: 'pill' | 'note' | 'peer' | 'ghost';
  /** Draws the card's border dashed — for something that exists as an edge
   *  rather than as a card of its own (a structural tie), matching how the
   *  board draws the same distinction in its connectors. */
  dashed?: boolean;
  /** Small status chip beside the kicker. */
  tag?: string;
  tagColor?: string;
  /** Labelled rows of chips — the knowledge card's who-knows / who-doesn't.
   *  Kept behind a click: collapsed, the card shows a one-line tally so the
   *  ring stays readable; expanded, it shows the names. */
  rows?: Array<{ label: string; labelColor: string; chips: string[]; dashed?: boolean }>;
  /** One-line summary shown while collapsed (e.g. "2 know · 1 in the dark").
   *  A two-element tuple says something different once the card is open, so
   *  the control never reads "open" on a card that is already open. */
  rowsSummary?: string | [closed: string, open: string];
  /** Width while expanded. Defaults to the shape's width; a card that opens
   *  into something substantial (a peer chat) asks for more. */
  expandedWidth?: number;
  /** Live content revealed when the card is expanded — the real editing
   *  control, not a read-out of it. A knowledge card puts its knows /
   *  suspects / in-the-dark chip editors here, so setting who holds a fact
   *  happens on the card in the ring rather than in a side panel. Drag and
   *  the collapse-click are both suppressed inside this region. */
  expanded?: React.ReactNode;
  /** Fires when this card opens or closes. Lets a category react to what the
   *  writer is reading — the peer swaps the focal card's body for its read
   *  while one of its questions is open. */
  onExpandChange?: (open: boolean) => void;
  /** Opens this satellite as its own sheet. Makes every satellite a door.
   *  A card with rows and no onOpen uses the click to expand instead. */
  onOpen?: () => void;
  /** Rendered on the card's FACE, under the body, without a click. For the one
   *  thing a category wants readable down the whole run at once — the arc lens
   *  on a character's scenes — while everything else stays behind the fold.
   *  Cascade only: a ring has no "run" to read down.
   *
   *  Pass a FUNCTION to receive the card's open state. The cascade uses this
   *  to yield: its face carries the highest-ranked thing the stop has while
   *  closed, and renders nothing once open, because the expanded slate below
   *  already holds that same material in its invariant position. Without
   *  this the text appears twice on every opened card. */
  faceExtra?: React.ReactNode | ((open: boolean) => React.ReactNode);
  /** Set the body in the note serif rather than the chrome sans. */
  bodySerif?: boolean;
  /** Overrides the card's border colour to say something is wrong with it
   *  rather than something is selected. The cascade uses it for a stop whose
   *  reading the pass says the pages contradict: the card has to be findable
   *  down a long run without opening it. */
  alert?: string;
};

const CARD_W = { pill: 240, note: 272, peer: 296, ghost: 272 } as const;
/** Used only to seed the ring before the cards report their real heights. */
const CARD_H_GUESS = 104;
/** Movement under this reads as a click, not a drag. Matches the board. */
const DRAG_THRESHOLD_PX = 4;
/** Height the floating action pill occupies at the bottom of the stage. The
 *  ring keeps out of it and a dropped card is clamped above it, so nothing
 *  ever comes to rest behind the controls. */
const BOTTOM_INSET = 62;

/** Everything the action bar needs to add to a category WITHOUT opening the
 *  editor panel. A tile that supplies this gets a picker that grows out of
 *  the Add button; one that doesn't falls back to opening its `content`. */
export type OrbitAdd = {
  /** Names what gets added: "someone", "a fact". Used on the button and the
   *  input's placeholder. */
  noun: string;
  /** PICK mode — choose from things that already exist. Omit for a category
   *  whose whole point is writing something new. */
  candidates?: Array<{ id: string; label: string; sublabel?: string }>;
  onAdd?: (id: string) => void | Promise<void>;
  /** WRITE mode — type it and it becomes a card. A category can offer both:
   *  the list filters as you type and what you typed is always addable. */
  onCreate?: (text: string) => void | Promise<void>;
  /** Shown when there is nothing left to pick. */
  emptyHint?: string;
};

/** A placed satellite's stored position. FRACTIONAL (0..1 of the stage), not
 *  pixels: a ring arranged on a laptop has to still read on a 27", and the
 *  sheet is sized to the viewport. */
type Frac = { fx: number; fy: number };

/** Namespaced key for the shared CardLayouts table, so satellite placements
 *  live beside board positions without a second table or a Lambda change.
 *  `orbit#` can never collide with a real card id. */
const layoutKey = (focalId: string, satId: string) => `orbit#${focalId}#${satId}`;

export function OrbitSheet({
  tiles,
  focalTileIds = [],
  defaultCategoryId,
  focalAccent,
  focalCardId,
  persistKey,
  auth,
  projectId,
}: {
  tiles: SectionTileDef[];
  /** Tiles whose content belongs INSIDE the focal card — the card's own
   *  material, the part no category owns (summary, the sub-event outline).
   *  They get no chip: they are always visible. */
  focalTileIds?: string[];
  focalAccent: string;
  /** The card this sheet is for. Scopes stored satellite placements. */
  focalCardId: string;
  /** The category this kind of card calls home. Without it the sheet lands on
   *  whichever category happens to hold items, which is incidental: a
   *  character with no scenes yet opened on Relationships, an arc with none
   *  opened on Peer. A sheet that declares a home opens there EVERY time, and
   *  even when it is empty, because an empty timeline is the thing the writer
   *  came to fill. Declaring one also switches off the per-card memory below:
   *  a home and a remembered last pick cannot both decide where you land, and
   *  a stale pick from one visit weeks ago is not a preference. */
  defaultCategoryId?: string;
  /** Remembers the last category per card, so reopening a scene you were
   *  working the knowledge of does not dump you back on Cast. Ignored when
   *  the sheet declares a defaultCategoryId. */
  persistKey?: string;
  /** Omit to get a sheet that arranges itself and never persists placements. */
  auth?: { userId: string; token: string };
  projectId?: string;
}) {
  const dark = useThemeMode() === 'dark';
  const focalIdsKey = focalTileIds.join('|');
  const focalTiles = useMemo(
    () => focalIdsKey.split('|').filter(Boolean)
      .map((id) => tiles.find((t) => t.id === id))
      .filter((t): t is SectionTileDef => !!t),
    [tiles, focalIdsKey],
  );
  const cats = useMemo(() => {
    const skip = new Set(focalIdsKey.split('|').filter(Boolean));
    return tiles.filter((t) => !skip.has(t.id));
  }, [tiles, focalIdsKey]);

  const storeKey = persistKey && !defaultCategoryId ? `ff-orbit-cat:${persistKey}` : null;
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (storeKey) {
      try { return localStorage.getItem(storeKey); } catch { return null; }
    }
    return null;
  });
  // Re-seed when the sheet is reused for a different card without unmounting.
  const loadedKey = useRef(persistKey);
  useEffect(() => {
    if (loadedKey.current === persistKey) return;
    loadedKey.current = persistKey;
    let next: string | null = null;
    if (storeKey) {
      try { next = localStorage.getItem(storeKey); } catch { /* private mode */ }
    }
    setActiveId(next);
  }, [persistKey, storeKey]);

  const active = cats.find((c) => c.id === activeId)
    ?? cats.find((c) => c.id === defaultCategoryId)
    ?? cats.find((c) => (c.items?.length ?? 0) > 0)
    ?? cats[0]
    ?? null;
  const pick = useCallback((id: string) => {
    setActiveId(id);
    if (storeKey) {
      try { localStorage.setItem(storeKey, id); } catch { /* private mode */ }
    }
  }, [storeKey]);
  // The first-run tour walks the chips one by one (WowFlow); it asks for a
  // category through a window event so it needs no handle on this sheet.
  useEffect(() => {
    const onPick = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string' && cats.some((c) => c.id === id)) pick(id);
    };
    window.addEventListener(ORBIT_PICK_EVENT, onPick);
    return () => window.removeEventListener(ORBIT_PICK_EVENT, onPick);
  }, [cats, pick]);
  // A category whose meaning IS the order of its items drops the focal card
  // and lays itself out as a rail instead. See Throughline below.
  // A rail with nothing on it is not a rail. The throughline layout drops the
  // focal card, so an EMPTY one left the stage blank except for the category's
  // own empty note floating where a satellite would be, and the card's summary
  // vanished with it. An empty throughline falls back to the ring, which is
  // where the empty state reads as an invitation instead of a bug.
  const isThroughline = active?.layout === 'throughline' && (active?.items?.length ?? 0) > 0;

  // Stage geometry, measured — the sheet is fixed to the viewport and the ring
  // has to survive a laptop as well as a 27". Everything below derives from
  // these two numbers, never from a hardcoded frame.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 1280, h: 700 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The focal card is content-sized. Assuming a height meant the threads
  // anchored to a rectangle that wasn't there — on a short summary they left
  // from a point ~40px BELOW the card and read as stubs floating in the
  // gutter. Measured, like the satellites.
  const focalRef = useRef<HTMLDivElement | null>(null);
  const [focalH, setFocalH] = useState(0);
  // The dep list holds ONE boolean and must stay that way. Without any deps
  // this re-ran on every render, tearing down and re-creating the observer
  // each time — and observe() fires its callback immediately, so every render
  // scheduled another setState and React hit "maximum update depth exceeded".
  // A throughline category unmounts the focal card entirely, so the ref goes
  // null and comes back as a DIFFERENT element; re-running on exactly that
  // flip is what re-attaches the observer, without re-running on anything
  // else. The equality guard keeps a re-measure that reports the same number
  // from starting a render at all.
  useLayoutEffect(() => {
    const el = focalRef.current;
    if (!el) return;
    const read = () => setFocalH((prev) => (prev === el.offsetHeight ? prev : el.offsetHeight));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isThroughline]);

  // Deduped by id, defensively. A category that emits two items with the same
  // id breaks React's list reconciliation: the orphaned cards never unmount
  // and pile up on every category switch, so a ring ends up showing another
  // category's satellites. One bad id used to corrupt the whole surface.
  const items = useMemo(() => {
    const raw = active?.items ?? [];
    const seen = new Set<string>();
    const out: OrbitItem[] = [];
    for (const it of raw) {
      if (seen.has(it.id)) {
        console.warn('[orbit] duplicate item id dropped', { category: active?.id, id: it.id });
        continue;
      }
      seen.add(it.id);
      out.push(it);
    }
    return out;
  }, [active]);
  const itemsRef = useRef<OrbitItem[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Drag state lives above the layout memo because the layout reads it: the
  // threads re-aim from the live position on every mousemove.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Which card is open. Held HERE, not per-card: opening a second question
  // while the first was still expanded left two big cards fighting for the
  // same ring, and for the peer it meant two answers to the same focal read.
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const toggleItem = useCallback((id: string) => {
    setOpenItemId((prev) => {
      const next = prev === id ? null : id;
      if (prev && prev !== next) itemsRef.current.find((i) => i.id === prev)?.onExpandChange?.(false);
      if (next) itemsRef.current.find((i) => i.id === next)?.onExpandChange?.(true);
      return next;
    });
  }, []);
  const dragRef = useRef<{
    satId: string; mouse: { x: number; y: number }; start: { x: number; y: number };
    moved: boolean; last: { x: number; y: number };
  } | null>(null);

  // ---- Stored placements -------------------------------------------------
  // Loaded once per (project, focal card) from the SAME CardLayouts table the
  // board writes to, under an `orbit#` namespaced cardId.
  const [placed, setPlaced] = useState<Record<string, Frac>>({});
  useEffect(() => {
    let cancelled = false;
    setPlaced({});
    if (!auth || !projectId || !focalCardId) return;
    getCardLayouts({ userId: auth.userId, projectId }, auth.token)
      .then((res) => {
        if (cancelled) return;
        const prefix = layoutKey(focalCardId, '');
        const next: Record<string, Frac> = {};
        for (const l of res.layouts ?? []) {
          if (!l.cardId.startsWith(prefix)) continue;
          const satId = l.cardId.slice(prefix.length);
          if (satId) next[satId] = { fx: l.x, fy: l.y };
        }
        setPlaced(next);
      })
      .catch((err) => console.warn('[orbit] layout load failed:', err));
    return () => { cancelled = true; };
  }, [auth, projectId, focalCardId]);

  const savePlacement = useCallback((satId: string, frac: Frac) => {
    setPlaced((prev) => ({ ...prev, [satId]: frac }));
    if (!auth || !projectId || !focalCardId) return;
    updateCardPosition(
      { userId: auth.userId, projectId, cardId: layoutKey(focalCardId, satId), x: frac.fx, y: frac.fy },
      auth.token,
    ).catch((err) => console.warn('[orbit] save placement failed:', err));
  }, [auth, projectId, focalCardId]);

  // Measured satellite heights, so the ring centres each card on its slot and
  // the connectors meet its real edge.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measure = useCallback((id: string, h: number, w: number) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
    setWidths((prev) => (prev[id] === w ? prev : { ...prev, [id]: w }));
  }, []);
  const activeCatId = active?.id;
  useEffect(() => {
    setOpenItemId((prev) => {
      if (prev) itemsRef.current.find((i) => i.id === prev)?.onExpandChange?.(false);
      return null;
    });
  }, [activeCatId]);


  const focalW = Math.min(440, Math.max(300, stage.w - 2 * (CARD_W.peer + 72)));
  const layout = useMemo(
    // dragId/dragPos are deps on purpose: the threads have to re-aim on every
    // mousemove, the way the board's connectors follow a card. Without them
    // the layout only recomputed on drop and the line sat at the old slot
    // while the card was already somewhere else.
    () => placeRing(items, stage, focalW, focalH, heights, widths, placed,
      dragId && dragPos ? { id: dragId, x: dragPos.x, y: dragPos.y } : null),
    [items, stage, focalW, focalH, heights, widths, placed, dragId, dragPos],
  );

  // ---- Drag --------------------------------------------------------------
  // Set on a drag that actually moved, read-and-cleared by the click that
  // follows. mouseup nulls dragRef before the click fires, so the guard has
  // to live outside it or every drag also counts as a click.
  const suppressClickRef = useRef(false);
  const consumeClickSuppression = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  const onSatMouseDown = useCallback((e: React.MouseEvent, satId: string, at: { x: number; y: number }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      satId, mouse: { x: e.clientX, y: e.clientY }, start: at, moved: false, last: at,
    };
    setDragId(satId);
    setDragPos(at);
  }, []);

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.mouse.x;
      const dy = e.clientY - d.mouse.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const next = {
        x: Math.max(0, d.start.x + dx),
        // Can't be dragged down behind the floating controls.
        y: Math.max(0, Math.min(d.start.y + dy, Math.max(0, stage.h - BOTTOM_INSET - 40))),
      };
      d.last = next;
      setDragPos(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragId(null);
      setDragPos(null);
      if (!d || !d.moved) return;
      suppressClickRef.current = true;
      // Store as a fraction of the stage so the placement survives a resize.
      savePlacement(d.satId, {
        fx: stage.w > 0 ? d.last.x / stage.w : 0,
        fy: stage.h > 0 ? d.last.y / stage.h : 0,
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragId, stage.w, stage.h, savePlacement]);

  const resetPlacements = useCallback(() => {
    const ids = Object.keys(placed);
    setPlaced({});
    if (!auth || !projectId || !focalCardId) return;
    // No delete endpoint on the layouts table; parking a placement off-frame
    // would be worse than re-writing it, so a reset re-saves each card at its
    // computed ring slot instead of pretending the row is gone.
    for (const satId of ids) {
      const i = items.findIndex((it) => it.id === satId);
      const slot = i >= 0 ? layout.slots[i] : null;
      if (!slot) continue;
      updateCardPosition(
        {
          userId: auth.userId, projectId, cardId: layoutKey(focalCardId, satId),
          x: stage.w > 0 ? slot.x / stage.w : 0,
          y: stage.h > 0 ? slot.y / stage.h : 0,
        },
        auth.token,
      ).catch(() => { /* best effort */ });
    }
  }, [placed, auth, projectId, focalCardId, items, layout.slots, stage.w, stage.h]);

  const accent = active?.accent ?? focalAccent;
  // The override's CONTENT stays mounted whenever the category supplies one;
  // only this flag flips. Mounting it on the same frame as the size change is
  // what stopped the cross-fade from animating.
  const showFocalOverride = !!active?.focalOverride && active.focalOverrideActive !== false;
  const hasItems = items.length > 0;
  // A converted category still owns an editor (add / remove / set state). It
  // opens from the category button; an unconverted one IS its editor, so it
  // shows straight away.
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => { setEditorOpen(false); }, [activeCatId]);
  // A category with its own picker never opens the editor panel from Add —
  // that popping up across the board was the thing being fixed.
  const showEditor = !!active && !active.add && (!hasItems || editorOpen);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Mini toolbar. The chip is the ONLY place a category announces itself,
          so the count rides it even when its cards are off stage — a zero is
          information (nobody is in this scene yet), not noise to hide. */}
      <div
        style={{
          flexShrink: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: 6, padding: '12px 20px 10px',
        }}
      >
        {cats.map((c) => {
          const on = c.id === active?.id;
          const a = c.accent ?? focalAccent;
          return (
            <button
              key={c.id}
              data-tour={`orbit-chip-${c.id}`}
              onClick={() => pick(c.id)}
              title={c.hint}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30,
                padding: '0 12px', fontSize: 12, fontWeight: 600, letterSpacing: 0.1,
                borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'system-ui, sans-serif',
                border: `1px solid ${on ? hexToRgba(a, 0.55) : dark ? '#2a2a30' : '#e3e5ea'}`,
                background: on ? hexToRgba(a, dark ? 0.16 : 0.1) : dark ? '#1a1a1e' : '#fff',
                color: on ? a : dark ? '#c8c8d0' : '#3d4250',
                transition: 'background 120ms ease-out, border-color 120ms ease-out',
              }}
            >
              {c.icon
                ? <span style={{ display: 'inline-flex', lineHeight: 0, color: a, flexShrink: 0 }}>{c.icon}</span>
                : <span style={{ width: 7, height: 7, borderRadius: '50%', background: a, flexShrink: 0 }} />}
              <span>{c.label}</span>
              {c.summary != null && (
                <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11, opacity: 0.7 }}>
                  {c.summary}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active?.stageHeader && (
        <div style={{ flexShrink: 0, padding: '0 20px 8px' }}>{active.stageHeader}</div>
      )}

      <div
        ref={stageRef}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto', cursor: dragId ? 'grabbing' : 'default' }}
      >
        {/* Two arrangements, one set of items. A ring says "these all touch
            the focal"; a rail says "these happen in this order". A category
            declares which sentence it is making. */}
        {isThroughline ? (
          <Throughline
            items={items}
            accent={accent}
            dark={dark}
            openItemId={openItemId}
            onToggle={toggleItem}
            heights={heights}
            onMeasure={measure}
            stageW={stage.w}
          />
        ) : (
          <>
          {/* Threads from the focal's edge to each satellite. Under the cards,
              never in the way of a click. */}
          {layout.paths.length > 0 && (
            <svg
              width={stage.w}
              height={stage.h}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
            >
              {layout.paths.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={accent} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5} />
              ))}
            </svg>
          )}

          {/* The focal card: what you opened, and only its own material. */}
          <div
            ref={focalRef}
            style={{
              position: 'absolute',
              left: layout.focal.x, top: layout.focal.y, width: focalW,
              maxHeight: Math.max(200, stage.h - 48),
              overflowY: 'auto',
              boxSizing: 'border-box',
              background: dark ? '#1a1a1e' : '#fff',
              border: `2px solid ${dark ? hexToRgba(focalAccent, 0.65) : focalAccent}`,
              borderLeft: `4px solid ${focalAccent}`,
              borderRadius: 10,
              padding: '16px 18px',
              boxShadow: dark ? '0 12px 40px rgba(0,0,0,0.5)' : '0 12px 32px rgba(120,90,40,0.14)',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {active?.focalAction && (
              <div
                // Sits above the focal's own material so the ask is the first
                // thing under the writer's eye while the peer is on stage.
                onMouseDown={(e) => e.stopPropagation()}
                style={{ marginBottom: 14 }}
              >
                {active.focalAction}
              </div>
            )}
            {/* The focal's own material and whatever the active category wants
                the middle for, cross-faded. Both stay mounted so the swap is a
                transition rather than a re-render, and the card's height eases
                between the two instead of jumping. */}
            <div
              data-tour="orbit-focal"
              style={{
                display: 'grid',
                gridTemplateRows: showFocalOverride ? '0fr' : '1fr',
                opacity: showFocalOverride ? 0 : 1,
                transition: 'grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms ease-out',
              }}
            >
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                {focalTiles.map((t, i) => (
                  <div key={t.id} style={{ marginTop: i === 0 ? 0 : 16 }}>
                    {i > 0 && (
                      <div
                        style={{
                          fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
                          color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 6,
                        }}
                      >
                        {t.label}
                        {t.summary != null && <span style={{ opacity: 0.7 }}> · {t.summary}</span>}
                      </div>
                    )}
                    {t.content}
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateRows: showFocalOverride ? '1fr' : '0fr',
                opacity: showFocalOverride ? 1 : 0,
                transition: 'grid-template-rows 260ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-out 60ms',
              }}
            >
              <div style={{ overflow: 'hidden', minHeight: 0 }}>{active?.focalOverride}</div>
            </div>
          </div>

          {/* Satellites. */}
          {items.map((it, i) => {
            const pos = layout.slots[i]; // already carries the live drag position
            if (!pos) return null;
            return (
              <Satellite
                key={it.id}
                item={it}
                catAccent={accent}
                x={pos.x}
                y={pos.y}
                dark={dark}
                dragging={dragId === it.id}
                placed={!!placed[it.id]}
                open={openItemId === it.id}
                onToggle={() => toggleItem(it.id)}
                onMeasure={measure}
                onDragStart={(e) => onSatMouseDown(e, it.id, pos)}
                wasDragged={consumeClickSuppression}
              />
            );
          })}
          </>
        )}

        {/* The category's ADD surface. Editing an item that already exists
            happens on that item's own card in the ring — expanding a card
            gives you its real controls — so this panel is for bringing
            something new into the category, plus whatever a category needs
            that no single card owns. For an unconverted category it is still
            the whole category, and shows straight away. */}
        {showEditor && active && (
          <div
            style={{
              position: 'absolute',
              // Beside the focal when there is one; against the right edge
              // when the category dropped it for a rail.
              left: isThroughline
                ? Math.max(12, stage.w - 364)
                : Math.max(12, Math.min(stage.w - 364, layout.focal.x + focalW + 40)),
              top: 16,
              width: 340,
              maxHeight: stage.h - 80,
              overflowY: 'auto',
              boxSizing: 'border-box',
              background: dark ? '#151518' : '#fff',
              border: `1px solid ${dark ? '#2a2a30' : '#e3e5ea'}`,
              borderLeft: `4px solid ${accent}`,
              borderRadius: 10,
              padding: '12px 14px',
              boxShadow: dark ? '0 8px 28px rgba(0,0,0,0.45)' : '0 8px 24px rgba(120,90,40,0.14)',
              fontFamily: 'system-ui, sans-serif',
              zIndex: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: accent, fontWeight: 600 }}>
                {active.label}
              </span>
              {hasItems && (
                <button
                  onClick={() => setEditorOpen(false)}
                  aria-label="Close editor"
                  style={{ background: 'transparent', border: 'none', color: dark ? '#82828c' : '#888', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 2 }}
                >
                  ×
                </button>
              )}
            </div>
            {active.content}
          </div>
        )}

        {!hasItems && !!active?.add && (
          <div
            style={{
              position: 'absolute', left: 0, right: 0, bottom: BOTTOM_INSET + 34,
              textAlign: 'center', fontSize: 12, color: dark ? '#63636d' : '#9a9aa4',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Nothing in {active?.label.toLowerCase()} yet.
          </div>
        )}
      </div>

      {/* Action bar: the one contextual action for whatever is on stage. */}
      {active && (hasItems || !!active.add) && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 20px 14px',
            // Only the pill itself takes clicks; the rest of the strip stays
            // board, so a card under it is still draggable.
            pointerEvents: 'none',
          }}
        >
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '7px 10px', borderRadius: 999,
            background: dark ? 'rgba(20,20,23,0.82)' : 'rgba(255,255,255,0.86)',
            border: `1px solid ${dark ? '#26262b' : '#ece5d7'}`,
            backdropFilter: 'blur(8px)',
            boxShadow: dark ? '0 6px 22px rgba(0,0,0,0.5)' : '0 6px 18px rgba(120,90,40,0.12)',
          }}
        >
          {active.add ? (
            <AddPicker
              add={active.add}
              accent={accent}
              dark={dark}
              open={editorOpen}
              setOpen={setEditorOpen}
            />
          ) : (
            <button
              onClick={() => setEditorOpen((v) => !v)}
              title={editorOpen ? 'Close' : `Add to ${active.label.toLowerCase()} — to change one that's already here, expand its card`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
                fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
                border: `1px solid ${hexToRgba(accent, 0.55)}`,
                background: hexToRgba(accent, dark ? 0.12 : 0.08),
                color: accent,
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{editorOpen ? '×' : '+'}</span>
              <span>{editorOpen ? 'Done' : 'Add'}</span>
            </button>
          )}
          {/* Whatever else this category needs at hand — a lens the writer
              flips for the whole run, not an action on one card. */}
          {active.barAction}
          <span style={{ fontSize: 11, color: dark ? '#63636d' : '#9a9aa4', fontFamily: 'system-ui, sans-serif' }}>
            {isThroughline ? 'In told order \u00b7 click a card to open it' : 'Click a card to open it'}
          </span>
          {/* A rail has no placements to tidy: the order is the graph's, not
              something the writer dragged into being. */}
          {!isThroughline && Object.keys(placed).length > 0 && (
            <button
              onClick={resetPlacements}
              title="Put this category's cards back on their computed ring"
              style={{
                height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600, borderRadius: 7,
                cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
                border: `1px solid ${dark ? '#2a2a30' : '#e3e5ea'}`,
                background: dark ? '#1a1a1e' : '#fff',
                color: dark ? '#c8c8d0' : '#3d4250',
              }}
            >
              Tidy up
            </button>
          )}
        </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Add control for a category that knows how to add: the button GROWS into
 * the picker, anchored to itself. Opening a full editor panel on the far side
 * of the board to answer "which character?" made the writer's eye leave the
 * thing they were pointing at. Stays open after a pick so a scene with four
 * people in it is four clicks, not four round trips.
 */
function AddPicker({
  add, accent, dark, open, setOpen,
}: {
  add: OrbitAdd;
  accent: string;
  dark: boolean;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQ('');
  }, [open]);

  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (add.candidates ?? [])
      .filter((c) => !n || c.label.toLowerCase().includes(n) || (c.sublabel ?? '').toLowerCase().includes(n))
      .slice(0, 60);
  }, [q, add.candidates]);
  // WRITE-only categories skip the list entirely: the point of a fact is that
  // it doesn't exist yet, so a roster of the ones that already do is just a
  // wall between the writer and typing.
  const writeOnly = !add.candidates && !!add.onCreate;
  const submit = useCallback(async () => {
    const text = q.trim();
    if (!text || !add.onCreate || busy) return;
    setBusy(true);
    try {
      await add.onCreate(text);
      setQ('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [q, add, busy]);

  return (
    <>
      {open && (
        // Click-away closes. Behind the popover, above everything else.
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 41 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px',
            fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap',
            border: `1px solid ${hexToRgba(accent, open ? 0.75 : 0.55)}`,
            background: hexToRgba(accent, open ? (dark ? 0.2 : 0.14) : (dark ? 0.12 : 0.08)),
            color: accent,
            transition: 'background 120ms ease-out, border-color 120ms ease-out',
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>{open ? '×' : '+'}</span>
          <span>{open ? 'Done' : `Add ${add.noun}`}</span>
        </button>

        {open && (
          <div
            style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
              width: writeOnly ? 300 : 280,
              maxHeight: writeOnly ? undefined : 300,
              display: 'flex', flexDirection: 'column',
              background: dark ? '#1a1a1e' : '#fff',
              border: `1px solid ${hexToRgba(accent, 0.4)}`,
              borderRadius: 10,
              boxShadow: dark ? '0 10px 32px rgba(0,0,0,0.55)' : '0 10px 28px rgba(120,90,40,0.18)',
              overflow: 'hidden',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
                if (e.key === 'Enter') {
                  if (writeOnly || (add.onCreate && list.length === 0)) void submit();
                  else if (list[0] && add.onAdd) { void add.onAdd(list[0].id); setQ(''); }
                }
              }}
              placeholder={writeOnly ? `Write ${add.noun}…` : `Add ${add.noun}…`}
              style={{
                border: 'none', borderBottom: `1px solid ${dark ? '#2a2a30' : '#eee'}`,
                background: 'transparent', outline: 'none', padding: '9px 12px',
                fontSize: 12.5, fontFamily: 'inherit', color: dark ? '#e6e6ea' : '#1d2230',
              }}
            />
            {writeOnly ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px' }}>
                <span style={{ fontSize: 10.5, color: dark ? '#63636d' : '#9a9aa4' }}>
                  {busy ? 'Adding…' : 'Enter to add'}
                </span>
                <button
                  onClick={() => void submit()}
                  disabled={!q.trim() || busy}
                  style={{
                    height: 26, padding: '0 12px', fontSize: 11.5, fontWeight: 600, borderRadius: 6,
                    fontFamily: 'inherit', cursor: q.trim() && !busy ? 'pointer' : 'not-allowed',
                    border: `1px solid ${hexToRgba(accent, q.trim() ? 0.55 : 0.2)}`,
                    background: q.trim() ? hexToRgba(accent, dark ? 0.16 : 0.1) : 'transparent',
                    color: q.trim() ? accent : dark ? '#55555c' : '#c0c0c0',
                  }}
                >
                  Add
                </button>
              </div>
            ) : (
            <div style={{ overflowY: 'auto', padding: 4 }}>
              {list.length === 0 ? (
                <div style={{ padding: '10px 10px 12px', fontSize: 11.5, color: dark ? '#63636d' : '#9a9aa4' }}>
                  {q.trim() ? 'Nothing matches.' : (add.emptyHint ?? 'Nothing left to add.')}
                </div>
              ) : list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { void add.onAdd?.(c.id); setQ(''); inputRef.current?.focus(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', padding: '7px 9px', borderRadius: 6,
                    fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
                    color: dark ? '#d6d6de' : '#2c3140',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(accent, dark ? 0.14 : 0.09))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  {c.sublabel && (
                    <span style={{ fontSize: 10.5, color: dark ? '#63636d' : '#9a9aa4', flexShrink: 0 }}>{c.sublabel}</span>
                  )}
                </button>
              ))}
            </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** One floating card. Reports its measured height so the ring can settle. */
function Satellite({
  item, catAccent, x, y, dark, dragging, placed, open, onToggle, onMeasure, onDragStart, wasDragged,
}: {
  item: OrbitItem;
  catAccent: string;
  x: number;
  y: number;
  dark: boolean;
  dragging: boolean;
  placed: boolean;
  /** Controlled by the sheet so only one card is ever open. */
  open: boolean;
  onToggle: () => void;
  onMeasure: (id: string, h: number, w: number) => void;
  onDragStart: (e: React.MouseEvent) => void;
  /** True exactly once after a drag that moved, so the click it produced is
   *  swallowed instead of expanding the card. */
  wasDragged: () => boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Observed, not read once per render: while a card expands its height
  // changes every frame with no React render behind it, and the ring reads
  // these numbers to place cards and aim threads. Measuring on render alone
  // made the threads snap to the final size instead of growing with the card.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => onMeasure(item.id, el.offsetHeight, el.offsetWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.id, onMeasure]);
  const shape = item.shape ?? 'note';
  const a = item.accent ?? catAccent;
  const isPeer = shape === 'peer';
  const isPill = shape === 'pill';
  const isGhost = shape === 'ghost';
  const canExpand = !!item.expanded || !!item.rows?.length;
  // A card that can expand spends its click on expanding; one that can't
  // spends it on opening. Nothing has both, so the gesture is never ambiguous.
  const clickAction = canExpand && !item.onOpen ? onToggle : item.onOpen;
  // An expanded card carries real controls, so it needs room the collapsed
  // shape doesn't have. The ring re-reads its measured width and re-threads.
  const width = open && item.expanded
    ? Math.max(CARD_W[shape], item.expandedWidth ?? 316)
    : CARD_W[shape];

  const skin: React.CSSProperties = isPeer
    ? {
        // OPAQUE, not the canvas card's 4% wash. These float over the focal
        // once expanded, and at 4% the focal's prose read straight through
        // them — two paragraphs occupying the same pixels. The tint rides on
        // top of a solid base instead.
        background: dark
          ? 'linear-gradient(rgba(84,191,219,0.06), rgba(84,191,219,0.06)), #17181c'
          : 'linear-gradient(rgba(84,191,219,0.07), rgba(84,191,219,0.07)), #ffffff',
        border: `1px solid ${hexToRgba(PEER_BLUE, 0.5)}`,
        borderLeft: `3px solid ${PEER_BLUE}`,
        borderRadius: 10,
      }
    : isPill
    ? {
        background: item.dashed
          ? (dark ? '#191a1d' : '#fafafa')
          : (dark ? '#221d12' : '#fdf6e8'),
        border: `1px ${item.dashed ? 'dashed' : 'solid'} ${hexToRgba(a, item.dashed ? 0.5 : 0.55)}`,
        borderRadius: 14,
      }
    : isGhost
    ? {
        background: dark ? '#141518' : '#fdfcfa',
        border: `1px dashed ${hexToRgba(a, 0.5)}`,
        borderRadius: 6,
      }
    : {
        background: dark ? '#1a1a1e' : '#fff',
        border: `1px ${item.dashed ? 'dashed' : 'solid'} ${dark ? '#2a2a30' : hexToRgba(a, 0.4)}`,
        borderLeft: `4px ${item.dashed ? 'dashed' : 'solid'} ${a}`,
        borderRadius: 6,
      };

  return (
    <div
      ref={ref}
      onMouseDown={onDragStart}
      onClick={() => { if (!wasDragged()) clickAction?.(); }}
      role={clickAction ? 'button' : undefined}
      title={item.onOpen ? 'Open as its own sheet · drag to place' : 'Drag to place'}
      style={{
        position: 'absolute', left: x, top: y,
        width, boxSizing: 'border-box',
        padding: '10px 12px',
        cursor: dragging ? 'grabbing' : 'grab',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
        zIndex: dragging ? 12 : open ? 8 : 5,
        boxShadow: dragging
          ? '0 10px 28px rgba(0,0,0,0.4)'
          : isGhost ? 'none' : dark ? '0 4px 16px rgba(0,0,0,0.3)' : '0 4px 14px rgba(120,90,40,0.10)',
        opacity: isGhost ? 0.85 : 1,
        // Easing while dragging would make the card trail the cursor.
        transition: dragging
          ? 'none'
          : 'left 180ms ease-out, top 180ms ease-out, width 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 180ms ease-out',
        ...skin,
      }}
    >
      {(item.kicker || item.tag || placed) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          {item.kicker && (
            <span
              style={{
                fontSize: item.kickerMono ? 10 : 9, letterSpacing: 0.6, textTransform: 'uppercase',
                color: isPeer ? PEER_BLUE : a, fontWeight: item.kickerMono ? 800 : 600,
                fontFamily: item.kickerMono ? 'ui-monospace, "SF Mono", Menlo, monospace' : undefined,
              }}
            >
              {item.kicker}
            </span>
          )}
          {item.tag && (
            <span
              style={{
                fontSize: 9.5, fontWeight: 600, letterSpacing: 0.3,
                color: item.tagColor ?? a,
                background: hexToRgba(item.tagColor ?? a, 0.14),
                padding: '2px 7px', borderRadius: 999,
              }}
            >
              {item.tag}
            </span>
          )}
          {placed && (
            <span
              title="You placed this card"
              style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: hexToRgba(a, 0.7) }}
            />
          )}
        </div>
      )}
      <div
        style={{
          fontSize: isPeer ? 14 : 13, fontWeight: 600, lineHeight: 1.3,
          color: dark ? '#e6e6ea' : '#1d2230',
          fontFamily: isPeer ? NOTE_FONT_SERIF : undefined,
        }}
      >
        {item.title}
      </div>
      {item.body && (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dark ? '#9a9aa4' : '#6b6f7d', marginTop: 5 }}>
          {item.body}
        </div>
      )}

      {/* Collapsed, a rows-card states the shape of the irony in one line;
          expanded, it names who is on each side. */}
      {canExpand && (
        <ExpandRegion
          open={open}
          summary={Array.isArray(item.rowsSummary)
            ? (open ? item.rowsSummary[1] : item.rowsSummary[0])
            : (item.rowsSummary ?? 'details')}
          dark={dark}
        >
          {item.expanded ?? (
            <>
              {(item.rows ?? []).map((r, i) => (
                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: i === 0 ? 0 : 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 9.5, color: r.labelColor, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                    {r.label}
                  </span>
                  {r.chips.map((c, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: 10.5, color: dark ? '#e0a456' : '#8a6a2f',
                        background: dark ? '#221d12' : '#fdf6e8',
                        border: `1px ${r.dashed ? 'dashed' : 'solid'} ${hexToRgba('#e0a456', 0.45)}`,
                        padding: '2px 8px', borderRadius: 999,
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ))}
            </>
          )}
        </ExpandRegion>
      )}
    </div>
  );
}

/** The fold on a card: a one-line summary you click, and the region it opens.
 *  Shared by the ring's satellites and the rail's stops so a card behaves the
 *  same whichever arrangement it is in. */
function ExpandRegion({
  open, summary, dark, children,
}: {
  open: boolean;
  summary: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  // The control belongs at the BOTTOM of whatever the card is currently
  // showing. Rendered above the revealed region it lands in the MIDDLE of an
  // open card, reading as a divider in the content rather than the way out.
  const control = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginTop: 8, marginBottom: open ? 0 : 0,
        fontSize: 11, color: dark ? '#8f8f9a' : '#6b6f7d',
      }}
    >
      <span>{summary}</span>
      <span
        style={{
          fontSize: 10, opacity: 0.6, lineHeight: 1,
          display: 'inline-block',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        ▾
      </span>
    </div>
  );
  return (
    <>
      {!open && control}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          transition: 'grid-template-rows 240ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-out',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div
            // The revealed region owns its own pointer events: mousedown here
            // must not start a card drag, and a click on a chip must not fold
            // the card back up under the writer's cursor.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ paddingTop: 10, cursor: 'default' }}
          >
            {children}
          </div>
        </div>
      </div>
      {open && control}
    </>
  );
}

/** Widest a stop gets. The reference surface gives a beat most of a column
 *  and lets the prose run; a narrow card would turn every summary into a
 *  ragged tower and the zig-zag into a ladder. */
const STOP_W_MAX = 500;
const STOP_W_MIN = 320;
/** Clear water between the two lanes. The connector's whole job is to be
 *  legible in this gap. */
const LANE_GAP_MIN = 150;
const LANE_GAP_MAX = 240;
/** Below this the two lanes cannot both hold a readable card, so the cascade
 *  collapses to a single column. */
const TWO_LANE_MIN_W = 860;
/** Minimum vertical offset from one stop to the next. This is what makes the
 *  run a STAIRCASE: the next card starts partway down the current one rather
 *  than below it, so the two read as overlapping steps. */
const STAGGER_Y = 150;
/** Air below the last card in a lane before that lane may be used again.
 *  Cross-lane cards overlap freely; same-lane cards never do. */
const LANE_CLEAR_Y = 56;
const RAIL_PAD = 40;
/** Seeds the cascade for the single frame before the stops report real
 *  heights. */
const STOP_H_GUESS = 190;

/**
 * The ordered arrangement: no focal, no placements — a zig-zag cascade.
 *
 * A ring makes every satellite equidistant from the middle, which is exactly
 * the right sentence for a scene's cast (they are all just IN it) and exactly
 * the wrong one for a character's scenes, where the whole content is that one
 * comes after another. So this drops the focal card entirely — the sheet's
 * header already names the card you opened, and repeating it in the middle
 * only costs the run its room — and steps the items down the page in two
 * alternating lanes, left, right, left, right, joined by a curve that sweeps
 * across the gap. It never sorts: the order it is given IS the claim, and it
 * belongs to whoever built the items.
 *
 * Two things make it read as a staircase rather than as two columns. Each stop
 * starts only STAGGER_Y down from the one before it, so consecutive stops
 * OVERLAP vertically and the eye is pulled diagonally; and the connector
 * leaves and arrives horizontally, so the sweep across the gap is the widest
 * thing on screen at that height.
 *
 * Stops in the SAME lane never overlap — a stop is pushed down until it clears
 * the last one on its side. That is what lets a card grow when it opens (and
 * carry the per-scene character material coming later) without any of this
 * needing to know how tall anything is in advance.
 */
function Throughline({
  items, accent, dark, openItemId, onToggle, heights, onMeasure, stageW,
}: {
  items: OrbitItem[];
  accent: string;
  dark: boolean;
  openItemId: string | null;
  onToggle: (id: string) => void;
  heights: Record<string, number>;
  onMeasure: (id: string, h: number, w: number) => void;
  stageW: number;
}) {
  const usableW = Math.max(stageW, 420);
  const twoLane = usableW >= TWO_LANE_MIN_W;
  const stopW = twoLane
    ? Math.max(STOP_W_MIN, Math.min(STOP_W_MAX, Math.floor((usableW - 2 * RAIL_PAD - LANE_GAP_MIN) / 2)))
    : Math.max(280, Math.min(STOP_W_MAX, usableW - 2 * RAIL_PAD));
  const laneGap = twoLane
    ? Math.max(LANE_GAP_MIN, Math.min(LANE_GAP_MAX, usableW - 2 * RAIL_PAD - 2 * stopW))
    : 0;
  // Centre the whole [lane | gap | lane] block rather than pinning it left, so
  // the cascade sits under the chips it belongs to.
  const blockW = twoLane ? stopW * 2 + laneGap : stopW;
  const x0 = Math.max(RAIL_PAD, Math.round((usableW - blockW) / 2));
  const laneX = (lane: number) => x0 + lane * (stopW + laneGap);

  const hOf = (it: OrbitItem) => heights[it.id] ?? STOP_H_GUESS;
  const pos: Array<{ x: number; y: number; lane: number }> = [];
  // Bottom of the last stop placed in each lane, so a lane is never reused
  // before it is free.
  const laneBottom = [-Infinity, -Infinity];
  items.forEach((it, i) => {
    const lane = twoLane ? i % 2 : 0;
    const staggered = i === 0 ? RAIL_PAD : pos[i - 1].y + STAGGER_Y;
    const clear = laneBottom[lane] + LANE_CLEAR_Y;
    const y = Math.round(Math.max(RAIL_PAD, staggered, clear));
    pos.push({ x: laneX(lane), y, lane });
    laneBottom[lane] = y + hOf(it);
  });

  const totalH = pos.reduce((m, p, i) => Math.max(m, p.y + hOf(items[i])), 0) + RAIL_PAD + BOTTOM_INSET;
  const totalW = twoLane ? x0 + blockW + RAIL_PAD : x0 + stopW + RAIL_PAD;

  // One thread per gap, clipped to both cards by the SAME edgePoint the ring
  // aims its threads with. Anchoring both ends at a fixed side instead put a
  // stop's incoming and outgoing thread on the same point, and the pair read
  // as one line forking rather than as a chain passing through. edgePoint also
  // picks the right kind of join for free: side-to-side while two stops
  // overlap vertically, bottom-to-top once the next one has been pushed clear.
  // Solid and heavier than the ring's threads — here the connection is the
  // spine of the surface, not a note about it.
  const links = items.slice(0, -1).map((it, i) => {
    const a = pos[i], b = pos[i + 1];
    const ha = hOf(it), hb = hOf(items[i + 1]);
    const from = edgePoint(a.x, a.y, stopW, ha, b.x + stopW / 2, b.y + hb / 2);
    const to = edgePoint(b.x, b.y, stopW, hb, a.x + stopW / 2, a.y + ha / 2);
    const dx = to.x - from.x, dy = to.y - from.y;
    const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
    // Each end leaves along the NORMAL of the edge it crossed, which is what
    // makes a curve read as attached to that spot rather than aimed past it.
    const bow = Math.max(40, Math.hypot(dx, dy) * 0.45);
    const c1 = from.axis === 'x'
      ? `${round1(from.x + sx * bow)} ${round1(from.y)}`
      : `${round1(from.x)} ${round1(from.y + sy * bow)}`;
    const c2 = to.axis === 'x'
      ? `${round1(to.x - sx * bow)} ${round1(to.y)}`
      : `${round1(to.x)} ${round1(to.y - sy * bow)}`;
    return {
      d: `M ${round1(from.x)} ${round1(from.y)} C ${c1}, ${c2}, ${round1(to.x)} ${round1(to.y)}`,
      accent: items[i + 1].accent ?? accent,
    };
  });

  return (
    <div style={{ position: 'relative', width: totalW, height: totalH }}>
      {links.length > 0 && (
        <svg width={totalW} height={totalH} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
          {links.map((l, i) => (
            <path key={i} d={l.d} fill="none" stroke={l.accent} strokeWidth={2.5} strokeLinecap="round" opacity={0.75} />
          ))}
        </svg>
      )}
      {items.map((it, i) => (
        <Stop
          key={it.id}
          item={it}
          catAccent={accent}
          dark={dark}
          x={pos[i].x}
          y={pos[i].y}
          w={stopW}
          open={openItemId === it.id}
          onToggle={() => onToggle(it.id)}
          onMeasure={onMeasure}
        />
      ))}
    </div>
  );
}

/** One card on the cascade: a header band naming the step, then the material.
 *  Same fold as a satellite, no drag — here the position is the meaning, so
 *  there is nothing for the writer to place. */
function Stop({
  item, catAccent, dark, x, y, w, open, onToggle, onMeasure,
}: {
  item: OrbitItem;
  catAccent: string;
  dark: boolean;
  x: number;
  y: number;
  w: number;
  open: boolean;
  onToggle: () => void;
  onMeasure: (id: string, h: number, wid: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Observed rather than read per render, for the same reason the ring does
  // it: an opening card changes height every frame with no React render behind
  // it, and every stop below is placed off these numbers. Measured on render
  // alone, the cascade would jump to the final size instead of opening into it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => onMeasure(item.id, el.offsetHeight, el.offsetWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [item.id, onMeasure]);

  const a = item.accent ?? catAccent;
  const canExpand = !!item.expanded || !!item.rows?.length;
  const clickAction = canExpand && !item.onOpen ? onToggle : item.onOpen;
  return (
    <div
      ref={ref}
      onClick={() => clickAction?.()}
      role={clickAction ? 'button' : undefined}
      style={{
        position: 'absolute', left: x, top: y,
        width: w, boxSizing: 'border-box',
        cursor: clickAction ? 'pointer' : 'default',
        fontFamily: 'system-ui, sans-serif',
        background: dark ? '#191a1e' : '#fff',
        border: `1px solid ${
          item.alert
            ? hexToRgba(item.alert, open ? 0.85 : 0.6)
            : open ? hexToRgba(a, 0.55) : dark ? '#2b2b32' : '#e6e3dc'
        }`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: dark ? '0 6px 22px rgba(0,0,0,0.38)' : '0 6px 18px rgba(120,90,40,0.11)',
        // Stops sit ABOVE the connectors, so a curve terminates at a card edge
        // rather than crossing it.
        zIndex: open ? 3 : 2,
      }}
    >
      {/* Header band: the step's number, what it is called, and its status.
          Banded rather than inline because at this card width a bare kicker
          floats away from the title it belongs to. */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 14px',
          background: dark ? '#1e1f24' : '#faf8f4',
          borderBottom: `1px solid ${dark ? '#26272d' : '#eeebe4'}`,
        }}
      >
        {item.kicker && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
              fontFamily: item.kickerMono ? 'ui-monospace, "SF Mono", Menlo, monospace' : undefined,
              color: '#fff', background: a,
              padding: '3px 9px', borderRadius: 6,
            }}
          >
            {item.kicker}
          </span>
        )}
        <span
          style={{
            flex: 1, minWidth: 0,
            fontSize: 14, fontWeight: 600, lineHeight: 1.3,
            color: dark ? '#e9e9ee' : '#1d2230',
          }}
        >
          {item.title}
        </span>
        {item.tag && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 9.5, fontWeight: 600, letterSpacing: 0.3,
              color: item.tagColor ?? a,
              background: hexToRgba(item.tagColor ?? a, 0.14),
              padding: '2px 7px', borderRadius: 999,
            }}
          >
            {item.tag}
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px 12px' }}>
        {item.body && (
          // Generously clamped rather than tight: a stop this wide is meant to
          // be READ, and the same-lane clearance rule means a tall card costs
          // nothing but its own room. Opening lifts the clamp entirely.
          <div
            style={{
              // The cascade sets its scene summary in the SAME face as the
              // reading below it, so the card reads as one voice describing a
              // scene rather than a caption over a quotation.
              ...(item.bodySerif
                ? { fontFamily: NOTE_FONT_SERIF, fontSize: 13.5, lineHeight: 1.55 }
                : { fontSize: 12.5, lineHeight: 1.6 }),
              color: dark ? '#9a9aa4' : '#6b6f7d',
              ...(open ? {} : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical' as const,
                WebkitLineClamp: 8,
                overflow: 'hidden',
              }),
            }}
          >
            {item.body}
          </div>
        )}
        {item.faceExtra && (
          <div
            // Clicks BUBBLE: the face is the card's content, so clicking the
            // sentence on it opens the card the way clicking anywhere else
            // does. Anything inside that is a control (a button, an open
            // editor) stops propagation for itself.
            style={{ marginTop: item.body ? 10 : 0 }}
          >
            {typeof item.faceExtra === 'function' ? item.faceExtra(open) : item.faceExtra}
          </div>
        )}
        {canExpand && (
          <ExpandRegion
            open={open}
            summary={Array.isArray(item.rowsSummary)
              ? (open ? item.rowsSummary[1] : item.rowsSummary[0])
              : (item.rowsSummary ?? 'details')}
            dark={dark}
          >
            {item.expanded}
          </ExpandRegion>
        )}
      </div>
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Where a ray from a rectangle's centre toward (tx, ty) crosses its border,
 *  plus which pair of edges it crossed: 'x' for left/right, 'y' for top/bottom.
 *  The caller uses that to aim the curve's tangent along the edge normal. */
function edgePoint(x: number, y: number, w: number, h: number, tx: number, ty: number) {
  const cx = x + w / 2, cy = y + h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy, axis: 'x' as const };
  const tX = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return { x: cx + dx * t, y: cy + dy * t, axis: (tX <= tY ? 'x' : 'y') as 'x' | 'y' };
}

/**
 * Place the focal and its ring inside the measured stage.
 *
 * Up to six satellites take ring slots (right, left, above, below) so the
 * arrangement reads as an orbit. Past six — a big ensemble scene, a long fact
 * list — the ring would collide with itself, so both sides become stacked
 * columns instead. Same cards, same connectors; it just stops pretending to
 * be a circle at the point where a circle stops being readable.
 *
 * A card the writer has PLACED ignores all of that and sits where they put it.
 */
function placeRing(
  items: OrbitItem[],
  stage: { w: number; h: number },
  focalW: number,
  /** MEASURED height of the focal card; 0 before the first layout pass. */
  focalHMeasured: number,
  heights: Record<string, number>,
  widths: Record<string, number>,
  placed: Record<string, Frac>,
  /** The card under the cursor this frame, in stage px. Overrides everything
   *  else for that one card so its thread tracks the drag live. */
  live: { id: string; x: number; y: number } | null,
): { focal: { x: number; y: number }; slots: Array<{ x: number; y: number }>; paths: string[] } {
  const hOf = (it: OrbitItem) => heights[it.id] ?? CARD_H_GUESS;
  // Measured width wins: an expanded card grows past its collapsed shape.
  const wOf = (it: OrbitItem) => widths[it.id] ?? CARD_W[it.shape ?? 'note'];
  // Everything below places against the height the writer can actually use.
  const usableH = Math.max(160, stage.h - BOTTOM_INSET);
  // Fall back to an estimate only for the single frame before the card
  // reports its real height.
  const focalH = Math.min(
    focalHMeasured > 0 ? focalHMeasured : 280,
    Math.max(120, usableH - 24),
  );
  const focal = {
    x: Math.max(16, Math.round((stage.w - focalW) / 2)),
    y: Math.max(16, Math.round((usableH - focalH) / 2)),
  };
  if (items.length === 0) return { focal, slots: [], paths: [] };

  const gutter = 28;
  const rightX = Math.min(stage.w - CARD_W.peer - 16, focal.x + focalW + gutter);
  const leftXFor = (it: OrbitItem) => Math.max(16, focal.x - gutter - wOf(it));
  const midY = focal.y + focalH / 2;

  const slots: Array<{ x: number; y: number }> = [];
  // Auto-placed cards take ring slots; placed ones are pinned and sit out of
  // the packing entirely, so removing one from the flow closes its gap.
  // Slots are assigned by the item's OWN index, never by its position among
  // the unplaced. Packing the unplaced ones meant placing a card renumbered
  // every card after it — drag the right-hand card and the left-hand one
  // flipped across the focal to take its slot. A card the writer never
  // touched must not move. A placed card leaving a hole in the ring is the
  // correct outcome; it is where the writer took it from.
  const ring = items.length <= 6;

  if (ring) {
    const rightIdx: number[] = [], leftIdx: number[] = [], topIdx: number[] = [], botIdx: number[] = [];
    items.forEach((it, i) => {
      // Placed cards STAY in the packing. Skipping them shrank their column's
      // total height, which re-centred whatever else was in that column — so
      // dragging one card still nudged another. Its slot is computed and then
      // simply overridden below.
      if (i === 4) topIdx.push(i);
      else if (i === 5) botIdx.push(i);
      else if (i % 2 === 0) rightIdx.push(i);
      else leftIdx.push(i);
    });
    const stackColumn = (idx: number[], xFor: (it: OrbitItem) => number) => {
      const total = idx.reduce((s, i) => s + hOf(items[i]), 0) + 20 * Math.max(0, idx.length - 1);
      let y = midY - total / 2;
      for (const i of idx) {
        slots[i] = { x: xFor(items[i]), y: Math.max(12, Math.round(y)) };
        y += hOf(items[i]) + 20;
      }
    };
    stackColumn(rightIdx, () => rightX);
    stackColumn(leftIdx, leftXFor);
    for (const i of topIdx) {
      slots[i] = {
        x: Math.round(focal.x + (focalW - wOf(items[i])) / 2),
        y: Math.max(12, focal.y - 20 - hOf(items[i])),
      };
    }
    for (const i of botIdx) {
      slots[i] = {
        x: Math.round(focal.x + (focalW - wOf(items[i])) / 2),
        y: Math.min(focal.y + focalH + 20, Math.max(12, usableH - hOf(items[i]))),
      };
    }
  } else {
    // Same rule in the column layout: which side a card belongs to is fixed
    // by its index, so pinning one never reflows the rest.
    const half = Math.ceil(items.length / 2);
    let ry = 16, ly = 16;
    items.forEach((it, i) => {
      if (i < half) {
        slots[i] = { x: rightX, y: Math.round(ry) };
        ry += hOf(it) + 16;
      } else {
        slots[i] = { x: leftXFor(it), y: Math.round(ly) };
        ly += hOf(it) + 16;
      }
    });
  }

  // Placed cards, resolved from their stored fraction and clamped so a stage
  // that shrank can never strand one off-frame.
  items.forEach((it, i) => {
    const p = placed[it.id];
    if (!p) return;
    const w = wOf(it);
    slots[i] = {
      x: Math.round(Math.max(0, Math.min(stage.w - w, p.fx * stage.w))),
      y: Math.round(Math.max(0, Math.min(Math.max(0, usableH - Math.min(hOf(it), 120)), p.fy * stage.h))),
    };
  });

  if (live) {
    const li = items.findIndex((it) => it.id === live.id);
    if (li >= 0) slots[li] = { x: Math.round(live.x), y: Math.round(live.y) };
  }

  // One thread per card, focal centre to card centre, clipped to both
  // rectangles so it starts and ends on an edge rather than under the cards.
  const fcx = focal.x + focalW / 2;
  const fcy = focal.y + focalH / 2;
  const paths = items.map((it, i) => {
    const sl = slots[i];
    if (!sl) return '';
    const w = wOf(it), h = hOf(it);
    const scx = sl.x + w / 2, scy = sl.y + h / 2;
    const from = edgePoint(focal.x, focal.y, focalW, focalH, scx, scy);
    const to = edgePoint(sl.x, sl.y, w, h, fcx, fcy);
    const dx = to.x - from.x, dy = to.y - from.y;
    // A card overlapping the focal has no gap to bridge; drawing one puts a
    // line under both cards.
    if (dx * dx + dy * dy < 100) return '';
    // Each thread leaves along the NORMAL of the edge it exits — horizontal
    // off a side, vertical off the top or bottom — which is what makes a
    // curve read as attached to that spot on the card. The old version bowed
    // every thread from one shared anchor, so they merged into a single trunk
    // near the focal instead of reading as separate lines.
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const c1 = from.axis === 'x' ? `${round1(mx)} ${round1(from.y)}` : `${round1(from.x)} ${round1(my)}`;
    const c2 = to.axis === 'x' ? `${round1(mx)} ${round1(to.y)}` : `${round1(to.x)} ${round1(my)}`;
    return `M ${round1(from.x)} ${round1(from.y)} C ${c1}, ${c2}, ${round1(to.x)} ${round1(to.y)}`;
  }).filter(Boolean);

  return { focal, slots, paths };
}
