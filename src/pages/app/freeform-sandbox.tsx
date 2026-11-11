// pages/app/freeform-sandbox.tsx (FIL-641 board half, build order step 5)
//
// /freeform/:storyId/sandbox. The room behind the doorway: a free board of
// parked cards and loose stickies, with the braindump dock ON it. A dump made
// here is a sandbox dump (`board: 'sandbox'`): what it mints is parked and
// lands on this board, never the master (ANCHOR-sandbox.md section 8, "which
// board a dump belongs to is which board you were on").
//
// On landing the floating receipt opens in review and walks what landed, one
// item at a time; the board centres each item and lights it. The review is
// required: Done appears at the last item. Mock:
// https://claude.ai/artifact/E8G4MvMvXwazFWuX5uDZH7.
//
// Not here yet: place / park / demote, the pending-change and ready lines
// (FIL-640), promote on a story sticky (FIL-652).

import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { UserContext } from '../../App';
import { addHuddleToCard, convertCardAltitude, deleteWorldEntry, saveWorldEntry, undoAddHuddleToCard, createCard, deleteCard, restoreCard, tagEventInvolvesCharacter, type ProjectEntity, listBraindumps, saveFragment, deleteFragment, demoteCard, dismissBadge, rereadHuddle, enqueueExtractionJob, establishWorldEntry, makeSceneFromWorld, getCardLayouts, listProjectEntities, makeHuddleCard, saveStoryFact, updateCardDescription, updateCardNarrativeStatus, updateCardPosition, updateFragment, type ListProjectEntitiesResponse, type NarrativeStatus, type SandboxBadge, type StoryFactKind, undoDemoteCard, undoMakeHuddleCard, deleteStoryFact, updateWorldEntry, updateCardName, LABEL_PALETTE, createArc, updateArc, deleteArc, restoreArc, setSequenceColor, tagEventEvokes, untagEventEvokes, listArcSuggestions, acceptArcSuggestion, dismissArcSuggestion, type ArcSuggestion, tagSequenceContains, untagSequenceContains, saveLabelSet, type LabelSet, type StorySet, tagEventPrecedes, untagEventPrecedes, setCardColor, listStagedQuestions, answerStagedQuestion, type StagedQuestion, listTemplates, applyTemplate, clearTemplate, claimTemplateCard, type SandboxTemplate, setStructuralEdge, deleteStructuralEdge, sandboxPeerPass, sandboxPeerCard, answerPeerQuestion, undoPeerAnswer, type SandboxFragment } from '../../lib/freeformApi';
import { AddPick, type Tie } from '../../components/Freeform/corkboard/sandboxFocus';
import { SandboxCoach, TOUR_TEMPLATE_ID, markSandboxTourSeen, sandboxTourSeen, sandboxTourSteps } from '../../components/Freeform/corkboard/sandboxTour';
import { TEMPLATES_W, TemplatePreview, TemplatesPanel, templateLayout } from '../../components/Freeform/corkboard/sandboxTemplates';
import { ArcSheet, CharacterSheet, EventSheet, LocationSheet, RelationshipSheet, SequenceSheet } from '../../components/Freeform/corkboard/sheets';
import { Shell, CorkboardLoading } from '../../components/Freeform/corkboard/shell';
import { MoonIcon, SunIcon, THEME_STORE_KEY, ThemeCtx, storedTheme, type ThemeMode } from '../../components/Freeform/corkboard/theme';
import { BraindumpDock, ToolbarButton } from '../../components/Freeform/corkboard/toolbar';
import { BoardEmptyState, BraindumpIcon } from '../../components/Freeform/corkboard/emptyState';
import { worldTitleOf, type TurnKind } from '../../components/Freeform/corkboard/stickyMenu';
import { stickyPaperKey } from '../../components/Freeform/corkboard/sandbox';
import { SandboxBoard, cardTitle, rawTitle, cardSize, defaultLayout, freeSpotIn, itemSize, nudgeClear, stageItemsFrom, STICKY_W, type DumpText, type Pos, type SandboxDraft, type StageItem, type StickyPatch } from '../../components/Freeform/corkboard/sandboxBoard';
import { SandboxReceipt, type ReviewItem } from '../../components/Freeform/corkboard/sandboxReceipt';
import { WorldSheet } from '../../components/Freeform/corkboard/worldSheet';
import FreeformScript from './freeform-script';
import { storyLayout, chainOrder, WEAVE_TOP } from '../../components/Freeform/corkboard/storyLayout';
import { TrashButton } from '../../components/Freeform/corkboard/sandboxTrash';
import { ColorLegend, setNameOf, DEFAULT_SET_NAME, colorCounts, colorIn, nameOf, MAIN_SET, SEQUENCES_SET, SetSwitcher, SequenceStrip, StripCard, sequencesInOrder, SUBPLOTS_SET, SubplotStrip, subplotsFrom, subplotPath, type SubplotChip } from '../../components/Freeform/corkboard/storylineLabels';
import { bareLine } from '../../components/Freeform/corkboard/dialogue';
import { playPageWipe } from '../../lib/pageWipe';
import { acquireStorySession, type StorySessionHandle } from '../../lib/storySession';
import { badgeHeading, progressLine, worldKindLabel } from '../../components/Freeform/corkboard/sandboxProgress';
import { beatLine, beatSpots } from '../../components/Freeform/corkboard/sandboxBeats';
import { connectDiff, placeBeforeDiff } from '../../components/Freeform/corkboard/sandboxConnect';

/** A beat's colour until the writer picks one (Ben, 2026-11-05). */
const BEAT_PURPLE = '#5b21b6';

/** A fresh read's line with its beats on it (sandbox-beats). */
function linesOf(payload: { entities?: ProjectEntity[]; edges?: any }): Array<{ from: string; to: string }> {
  const pre = payload.edges?.precedes ?? [];
  const chips = sequencesInOrder(payload.entities ?? [], payload.edges);
  const scenes = (payload.entities ?? []).filter((e) => !e.deleted_at && e.state === 'parked' && e.type === 'event').map((e) => e.id);
  return [...pre, ...beatLine(chips.map((c) => ({ id: c.id, color: c.color, scenes: c.scenes })), scenes, pre, payload.edges?.cross_precedes ?? []).links];
}



/** Sandbox positions live in the shared CardLayouts table under their own
 *  prefix, beside the master's, the way the orbit sheet stores satellites. */
const LAYOUT_PREFIX = 'sandbox#';
/** The backend's id slug (card-create.mjs), so a card + New makes has an id
 *  the page knows before the write lands. */
const idSlug = (t: string) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

export default function FreeformSandbox() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { user: appUser } = useContext(UserContext);
  const workTitle: string | undefined = storyId ? appUser?.works?.[storyId]?.title : undefined;

  // Light unless the writer chose dark (FIL-701); the master's toggle, the
  // same stored choice (Ben, 2026-11-07: the sandbox needs one too).
  const [theme, setTheme] = useState<ThemeMode>(storedTheme);
  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_STORE_KEY, next); } catch { /* this session only */ }
      return next;
    });
  }, []);
  const dark = theme === 'dark';

  const [auth, setAuth] = useState<{ userId: string; token: string } | null>(null);
  const [data, setData] = useState<ListProjectEntitiesResponse | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  // + New makes a card at once (2026-10-12). Until its write lands the page
  // holds it (a refetch keeps it), and anything done to it waits its turn.
  const pendingCreate = useRef(new Map<string, Promise<unknown>>());
  /** Cards the writer made on this page: never held by a dump's waves. */
  const madeHere = useRef(new Set<string>());
  const optimistic = useRef(new Map<string, ProjectEntity>());
  const afterCreate = useCallback((id: string) => pendingCreate.current.get(id) ?? Promise.resolve(), []);
  const [saved, setSaved] = useState<Record<string, Pos>>({});
  // SAME SCENE OR NEW SCENE (Ben, 2026-10-13): a card a dump made that is
  // probably a scene already on the board is held off the board behind a
  // question, and the receipt does not close until it is answered.
  const [sameQs, setSameQs] = useState<StagedQuestion[]>([]);
  // The dumps in the writer's words, by dump id: a token opens to read one back.
  const [dumps, setDumps] = useState<Record<string, DumpText>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const userId = String(session.tokens?.idToken?.payload?.['cognito:username'] ?? '');
        if (!userId || !token) throw new Error('Not authenticated');
        if (cancelled) return;
        setAuth({ userId, token });
        const [payload, layouts] = await Promise.all([
          listProjectEntities({ projectId: storyId }, token),
          getCardLayouts({ userId, projectId: storyId }, token).catch(() => ({ layouts: [] })),
        ]);
        if (cancelled) return;
        setData(payload);
        const pos: Record<string, Pos> = {};
        for (const l of layouts.layouts ?? []) {
          if (l.cardId.startsWith(LAYOUT_PREFIX)) pos[l.cardId.slice(LAYOUT_PREFIX.length)] = { x: l.x, y: l.y };
        }
        setSaved(pos);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [storyId]);

  // Loaded with the board and again after each dump lands. A convenience:
  // a failed read leaves the tokens closed-only, never breaks the board.
  const loadDumps = useCallback(async (token: string) => {
    if (!storyId) return;
    try {
      const res = await listBraindumps({ projectId: storyId }, token);
      const next: Record<string, DumpText> = {};
      for (const b of res.braindumps ?? []) if (b.braindumpId) next[b.braindumpId] = { prose: b.prose, createdAt: b.createdAt };
      setDumps(next);
    } catch { /* tokens still open, with a quiet line instead of the words */ }
  }, [storyId]);
  useEffect(() => { if (auth) void loadDumps(auth.token); }, [auth, loadDumps]);

  // STREAMING (Ben, 2026-10-17; one at a time since 2026-11-03). What a dump
  // makes is held off the board while it runs; once it is done every new item
  // gets its spot in the story's weave (storyLayout) and they come in one at
  // a time in reading order: scenes along the thread, the people beside them,
  // then the notes; the receipt opens after the last. Cards are the dump's
  // when new since it started and not made on this page; stickies by dumpId.
  // A card the writer adds mid-dump is never held. Every spot is set before
  // the first card shows, so nothing jumps while they arrive.
  const [waves, setWaves] = useState<{ braindumpId: string; beforeIds: Set<string>; beforeFrags: Set<string>; beforeWorld: Set<string>; beforeBadges: Map<string, string>; released: 0 | 1 | 2; fly: Set<string>;
    /** Streaming (Ben, 2026-11-03): the dump's items shown so far, one at a time in reading order. */
    shown?: Set<string> } | null>(null);
  const waveTimers = useRef<number[]>([]);
  useEffect(() => () => { for (const t of waveTimers.current) window.clearTimeout(t); }, []);
  // A loose sticky the writer sized carries that size (sandbox#size#<id>,
  // x = width, y = height, in the same saved map as positions).
  const sizedFragments = useMemo(() => (data?.fragments ?? []).map((f) => {
    const z = saved[`size#${f.id}`];
    return z ? { ...f, size: { w: z.x, h: z.y } } : f;
  }), [data, saved]);
  // SEQUENCES ARE BEATS (sandbox-beats, 2026-11-05): in story order, each
  // with its colour and its scenes, from what is stored now.
  // Beats are one deep purple until the writer picks a colour of their own
  // (Ben, 2026-11-05: "a cool deep purple by default ... then the user can
  // choose their own color coding").
  const seqChips = useMemo(() => {
    const own = new Map((data?.entities ?? []).map((e) => [e.id, String((e as any).color ?? '').toLowerCase()]));
    return sequencesInOrder(data?.entities ?? [], data?.edges).map((c) => ({ ...c, color: /^#[0-9a-f]{6}$/.test(own.get(c.id) ?? '') ? own.get(c.id)! : BEAT_PURPLE }));
  }, [data?.entities, data?.edges]);
  // CHECKPOINTS: the line with its beats on it; each scene belongs to the
  // beat before it (sandboxBeats.ts beatLine).
  const beatRes = useMemo(() => {
    const pre = data?.edges?.precedes ?? [];
    const scenes = (data?.entities ?? []).filter((e) => !e.deleted_at && e.state === 'parked' && e.type === 'event').map((e) => e.id);
    return beatLine(seqChips.map((c) => ({ id: c.id, color: c.color, scenes: c.scenes })), scenes, pre, (data?.edges as any)?.cross_precedes ?? []);
  }, [data?.edges, data?.entities, seqChips]);
  const lineLinks = useMemo(() => [...(data?.edges?.precedes ?? []), ...beatRes.links], [data?.edges, beatRes]);
  // A scene the writer sized carries that size too (Ben, 2026-11-05), same key.
  // A scene wears its beat (its id and colour: the bar and the thread); a beat
  // its colour, how many scenes it has and whether the writer marked it done.
  const sizedEntities = useMemo(() => {
    const colorOf = new Map(seqChips.map((c) => [c.id, c.color]));
    // Colour coding (the bar on a beat's scenes, its stretch of the thread)
    // only for a beat the writer gave a colour (Ben, 2026-11-05); the tab
    // itself is always drawn, purple until coloured.
    const coded = new Set((data?.entities ?? []).filter((e) => e.type === 'sequence' && /^#[0-9a-f]{6}$/.test(String((e as any).color ?? '').toLowerCase())).map((e) => e.id));
    return (data?.entities ?? []).map((e) => {
      const z = e.type === 'event' ? saved[`size#${e.id}`] : undefined;
      let out: ProjectEntity = z ? ({ ...e, card_size: { w: z.x, h: z.y } } as ProjectEntity) : e;
      const b = e.type === 'event' ? beatRes.beatOf.get(e.id) : undefined;
      if (b) out = { ...out, beat_id: b, beat_color: coded.has(b) ? (colorOf.get(b) ?? '') : '' } as ProjectEntity;
      if (e.type === 'sequence' && colorOf.has(e.id)) out = { ...out, beat_color: colorOf.get(e.id), beat_coded: coded.has(e.id), beat_count: beatRes.scenesOf.get(e.id)?.length ?? 0 } as ProjectEntity;
      return out;
    });
  }, [data, saved, seqChips, beatRes]);
  const sceneSeqColor = useMemo(() => { const m = new Map<string, string>(); for (const c of seqChips) for (const sid of c.scenes) m.set(sid, c.color); return m; }, [seqChips]);
  const allItems: StageItem[] = useMemo(
    () => (data ? stageItemsFrom({ entities: sizedEntities.filter((e) => !sameQs.some((q) => q.cardId === e.id)), fragments: sizedFragments, badges: data.badges ?? [], precedes: lineLinks, world: data.world ?? [], sequenceColors: sceneSeqColor }) : []),
    [data, sameQs, sizedFragments, sizedEntities, sceneSeqColor, lineLinks],
  );
  const items: StageItem[] = useMemo(() => {
    if (!data || !waves) return allItems;
    const w = waves;
    // The board read carries no src_braindump, so a dump's card is any card
    // that is new since the dump started and was not made on this page.
    const heldCard = (e: ProjectEntity) => !w.beforeIds.has(e.id) && !madeHere.current.has(e.id);
    const heldSticky = (f: { id: string; dumpId: string }) => f.dumpId === w.braindumpId && !w.beforeFrags.has(f.id);
    // Streaming: a held item shows once its turn comes; a sticky with its
    // group, or with the card it hangs on (or at once on a card already there).
    const sh = w.shown;
    const fragShown = (f: SandboxFragment) => !!sh && (sh.has(f.id) || (!!f.clusterId && sh.has(`group:${f.clusterId}`)) || (!!f.attachedTo && (sh.has(f.attachedTo) || w.beforeIds.has(f.attachedTo) || w.beforeWorld.has(f.attachedTo))));
    return stageItemsFrom({
      entities: sizedEntities.filter((e) => !sameQs.some((q) => q.cardId === e.id)).filter((e) => (sh ? sh.has(e.id) : w.released >= 1) || !heldCard(e)),
      fragments: sizedFragments.filter((f) => (sh ? fragShown(f) : w.released >= 2) || !heldSticky(f)),
      badges: (data.badges ?? []).filter((b) => w.beforeBadges.get(b.clusterId) === `${b.kind}|${b.title}`),
      precedes: lineLinks,
      world: (data.world ?? []).filter((x) => w.beforeWorld.has(x.id) || !!sh?.has(x.id)),
      sequenceColors: sceneSeqColor,
    });
  }, [data, sameQs, waves, allItems, sizedFragments, sizedEntities, sceneSeqColor, lineLinks]);
  // A beat with no spot of its own sits beside its first scene, or after the
  // stretch before it (sandbox-beats); a drag gives it a spot like any card.
  const positions = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth - 80 : 1400;
    const base = defaultLayout(allItems, saved, { w });
    const unsaved = seqChips.filter((c) => !saved[c.id] && allItems.some((i) => i.id === c.id));
    if (!unsaved.length) return base;
    const placed: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const it of allItems) { if (it.kind === 'token' || unsaved.some((c) => c.id === it.id)) continue; const p = base[it.id]; if (p) placed[it.id] = { ...p, ...itemSize(it) }; }
    const sizeOf = (id: string) => { const it = allItems.find((i) => i.id === id); return it ? itemSize(it) : cardSize('sequence'); };
    const scenes = allItems.filter((i) => i.kind === 'card' && i.entity.type === 'event').map((i) => i.id);
    const spots = beatSpots({ beats: seqChips.filter((c) => allItems.some((i) => i.id === c.id)).map((c) => ({ id: c.id, color: c.color, scenes: beatRes.scenesOf.get(c.id) ?? [] })), placed, sizeOf, scenes, precedes: data?.edges?.precedes ?? [], boardW: w });
    return { ...base, ...spots };
  }, [allItems, saved, seqChips, data?.edges, beatRes]);
  // What the board looked like when a dump started: where each thing sat and
  // which spots were the writer's, so the dump lands around them (storyLayout).
  const boardNow = useRef<{ positions: Record<string, Pos>; ids: Set<string>; saved: Record<string, Pos> }>({ positions: {}, ids: new Set(), saved: {} });
  boardNow.current = { positions, ids: new Set(allItems.map((i) => i.id)), saved };

  const onMove = useCallback((id: string, pos: Pos) => {
    setSaved((cur) => ({ ...cur, [id]: pos }));
    if (!auth || !storyId) return;
    updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}${id}`, x: Math.round(pos.x), y: Math.round(pos.y) }, auth.token).catch(() => { /* position is a convenience */ });
  }, [auth, storyId]);
  // NOTHING OVERLAPS (FIL-715; Ben, 2026-11-01: "overlaps shouldn't happen
  // but should just nudge cards around the sticky edges"). A sticky that
  // grew, a card just made, anything moved by hand: once it is on the board
  // at its new size, what it lands on steps clear of it, and those moves are
  // saved like a drag. An id waits for its item to arrive (a refetch), but
  // not for ever.
  const clearIds = useRef<Map<string, number>>(new Map());
  const [clearTick, setClearTick] = useState(0);
  const clearAround = useCallback((id: string) => { clearIds.current.set(id, Date.now()); setClearTick((n) => n + 1); }, []);
  useEffect(() => {
    const now = Date.now();
    clearIds.current.forEach((t, id) => { if (now - t > 15000) clearIds.current.delete(id); });
    const present = new Set(allItems.map((it) => it.id));
    const ids = [...clearIds.current.keys()].filter((id) => present.has(id) && positions[id]);
    if (!ids.length) return;
    ids.forEach((id) => clearIds.current.delete(id));
    const boxes = allItems.flatMap((it) => { const p = positions[it.id]; if (!p) return []; const sz = itemSize(it); return [{ id: it.id, x: p.x, y: p.y, w: sz.w, h: sz.h }]; });
    for (const [id, pos] of Object.entries(nudgeClear(ids, boxes))) onMove(id, pos);
  }, [positions, allItems, clearTick, onMove]);
  // WHO PLACED A CARD (Ben, 2026-11-04: "slide the weave"). A card the board
  // laid out (storyLayout) is the weave's: a later dump lays it again, so the
  // story stays in order. A card the writer drags is theirs and stays put.
  // Kept beside the spots (sandbox#auto#<id>: x 1 the board's, 0 the writer's).
  const setPlacedBy = useCallback((id: string, byBoard: boolean) => {
    const key = `auto#${id}`;
    setSaved((cur) => ({ ...cur, [key]: { x: byBoard ? 1 : 0, y: 0 } }));
    if (!auth || !storyId) return;
    updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}${key}`, x: byBoard ? 1 : 0, y: 0 }, auth.token).catch(() => { /* a convenience */ });
  }, [auth, storyId]);
  const onBoardMove = useCallback((id: string, pos: Pos) => {
    onMove(id, pos); clearAround(id);
    if (boardNow.current.saved[`auto#${id}`]?.x === 1) setPlacedBy(id, false);
  }, [onMove, clearAround, setPlacedBy]);

  // ---- The dump ------------------------------------------------------------
  // Closed at rest (Ben, 2026-10-08): the board is the thing; the dump
  // hangs under the toolbar when asked for, as on the master.
  const [dockOpen, setDockOpen] = useState(false);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'extracting' | 'done' | 'error'>('idle');
  // A DUMP IN FLIGHT LOCKS THE BOARD'S MAKING (Ben, 2026-10-17): no template
  // and no hand-made card or sticky until it has landed. Editing what is
  // already on the board stays open. The ref serves memoised handlers.
  const dumpBusy = phase === 'submitting' || phase === 'extracting' || !!waves;
  const dumpBusyRef = useRef(false);
  dumpBusyRef.current = dumpBusy;
  const [msg, setMsg] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ dumpNo: number; ids: Set<string>; review: ReviewItem[] } | null>(null);
  // The writer's second thought (Ben, 2026-10-08): one undo for the last
  // commitment made by hand (a card turned into a sticky, a huddle made a
  // card, a story sticky promoted). Held until the next one or Dismiss.
  // UNDO AND REDO IN THE TOOLBAR (Ben, 2026-10-15, as on the master): every
  // commitment goes on a history; Undo steps back through it, Redo forward
  // for the ones that know how to do themselves again. The toast still
  // offers Undo for the one just made, until dismissed.
  type UndoEntry = { label: string; run: () => Promise<unknown>; redo?: () => Promise<unknown>; /** To take it back off the history (an untouched new card that went). */ key?: string };
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [undo, setToast] = useState<UndoEntry | null>(null);
  // A commitment arrives here (a plain state setter, so every handler can
  // hold it without listing it) and goes on the history at once.
  const [undoIn, setUndo] = useState<UndoEntry | null>(null);
  useEffect(() => {
    if (!undoIn) return;
    setToast(undoIn);
    setUndoStack((st) => [...st.slice(-29), undoIn]);
    setRedoStack([]);
    setUndo(null);
  }, [undoIn]);
  const runUndo = useCallback(() => {
    const e = undoStack[undoStack.length - 1];
    if (!e) return;
    setUndoStack((st) => st.slice(0, -1)); setToast(null);
    if (e.redo) setRedoStack((st) => [...st, e]);
    e.run().then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack]);
  const runRedo = useCallback(() => {
    const e = redoStack[redoStack.length - 1];
    if (!e?.redo) return;
    setRedoStack((st) => st.slice(0, -1)); setUndoStack((st) => [...st, e]);
    e.redo().then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redoStack]);
  // ⌘Z and ⇧⌘Z, except while typing.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 'z') return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'))) return;
      ev.preventDefault();
      if (ev.shiftKey) runRedo(); else runUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runUndo, runRedo]);
  const [landingFrom, setLandingFrom] = useState<Pos | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // The templates panel hangs from the toolbar's bottom edge (Ben,
  // 2026-10-15); the template under the pointer previews beside it.
  const [barBottom, setBarBottom] = useState(120);
  const [tplPreview, setTplPreview] = useState<string | null>(null);
  useLayoutEffect(() => {
    // The toolbar and, while it is open, the dump under it.
    const bar = dockRef.current;
    if (!bar) return;
    const read = () => setBarBottom(Math.round(bar.getBoundingClientRect().bottom));
    read();
    window.addEventListener('resize', read);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(bar);
    return () => { window.removeEventListener('resize', read); ro?.disconnect(); };
  });
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  // THE BOARD FILLS TO THE BOTTOM (Ben, 2026-10-13): its height is measured
  // from where it starts down to the window's bottom, less the Shell's 20px
  // bottom padding, not a fixed guess at what sits above it (the header, the
  // toolbar and the facts strip vary). Re-measured when the window or the
  // page above it changes size.
  const [wrapH, setWrapH] = useState<number | null>(null);
  const hasData = !!data;
  // THE FLOATING TOOLBAR (Ben, 2026-10-15: "the same floating toolbox on
  // scroll that we have on master"). The board scrolls in its own box, so the
  // page never scrolls the bar away; instead, once the board is scrolled down
  // the bar (with the legend and the dump) lifts off and floats at the top of
  // the window with the master's shadow, and the board grows to fill the
  // window under it. The board's scroll is shifted by what it grew, so nothing
  // on it moves. Back at the top, everything settles where it was. As on the
  // master, the floating bar has Top and Hide; hidden, a small tab stays.
  const [floatOn, setFloatOn] = useState(false);
  const [floatBox, setFloatBox] = useState<{ left: number; width: number; height: number }>({ left: 0, width: 0, height: 0 });
  const [barHidden, setBarHidden] = useState(false);
  const floatRef = useRef(false);
  floatRef.current = floatOn;
  const floatShift = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  // THE MOTION (Ben, 2026-10-15: "it kind of just jumps"): how far the bar
  // travels between its place and the window's top, so it glides there and
  // back, and the board rises over the title instead of snapping up. CSS
  // animations, so they run on the compositor (no frame loop).
  const [floatMotion, setFloatMotion] = useState<{ lift: number; rise: number; settling: number }>({ lift: 0, rise: 0, settling: 0 });
  useEffect(() => {
    const wrap = stageWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      if (floatRef.current) return;
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      setWrapH(Math.max(420, Math.round(window.innerHeight - top - 20)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    // Everything above the board too (2026-10-13: closing the braindump dock
    // left the board short). The page keeps its 100vh minimum when the dock
    // closes, so the body's size does not change and the body alone never
    // re-measured; the dock's own box does change.
    for (let el: Element | null = wrap; el && el !== document.body; el = el.parentElement) {
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) ro?.observe(sib);
    }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [hasData]);
  const pollRef = useRef<number | null>(null);
  // STREAMING, step 1 (2026-10-17): the live-update socket the master board
  // rides. A sandbox dump's braindump_complete arrives when the whole job is
  // done, so the page reads the board then instead of waiting for two
  // identical polls (3 to 6 s on a ~10 s dump). The poll stays the fallback.
  const sessionRef = useRef<StorySessionHandle | null>(null);
  useEffect(() => {
    if (!auth || !storyId) return undefined;
    const h = acquireStorySession(storyId, { userId: auth.userId, token: auth.token });
    sessionRef.current = h;
    return () => { sessionRef.current = null; h.release(); };
  }, [auth, storyId]);
  /** The item the receipt is on, lit on the board. */
  const [spot, setSpot] = useState<string | null>(null);
  /** Focused dump (anchor section 2): the card the dock is aimed at. What
   *  the writer types goes onto it; nothing additive waits. */
  const [focal, setFocal] = useState<{ id: string; title: string } | null>(null);
  // The aim ends with the panel (Ben, 2026-11-05: "the 'into' is also sticky
  // after closing the panel along with the button on the card itself").
  useEffect(() => { if (!dockOpen) setFocal(null); }, [dockOpen]);
  const aimAt = useCallback((cardId: string) => {
    const e = (data?.entities ?? []).find((x) => x.id === cardId);
    if (!e) return;
    setFocal((cur) => (cur?.id === cardId ? null : { id: cardId, title: cardTitle(e) }));
    setDockOpen(true);
    try { dockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
  }, [data]);

  const refetch = useCallback(async () => {
    if (!auth || !storyId) return null;
    const raw = await listProjectEntities({ projectId: storyId }, auth.token);
    const have = new Set((raw.entities ?? []).map((e) => e.id));
    const held = [...optimistic.current.values()].filter((e) => !have.has(e.id));
    const payload = held.length ? { ...raw, entities: [...(raw.entities ?? []), ...held] } : raw;
    setData(payload);
    return payload;
  }, [auth, storyId]);

  // ---- The Peer on the sandbox (2026-10-20) -------------------------------
  // On demand only: the toolbar's Peer button asks for a board-wide pass. It
  // is queued; the questions land as Peer question stickies and the socket
  // says how it went. Nothing runs after a dump.
  /** Out on the board (after a pass, or Show Peer questions) or folded onto their cards. */
  const [peerExpanded, setPeerExpanded] = useState(false);
  const [peerBusy, setPeerBusy] = useState(false);
  const [peerFresh, setPeerFresh] = useState<Set<string>>(new Set());
  /** The board pass's receipt (2026-10-21): each question it left, by card. */
  const [peerReceipt, setPeerReceipt] = useState<{ items: ReviewItem[]; lede: string } | null>(null);
  /** How the last ask on a card went, when there is something to say. */
  const [peerCardNote, setPeerCardNote] = useState<{ cardId: string; text: string } | null>(null);
  /** The Peer receipt's walk: the question it rings. */
  const [peerSpot, setPeerSpot] = useState<string | null>(null);
  /** The questions the open receipt is about: out on the board until it closes. */
  const [peerSpotlight, setPeerSpotlight] = useState<Set<string>>(new Set());
  useEffect(() => { if (!peerCardNote) return undefined; const t = window.setTimeout(() => setPeerCardNote(null), 9000); return () => window.clearTimeout(t); }, [peerCardNote]);
  /** The card the Peer is reading right now (the Peer button on a card). */
  const [peerAskBusy, setPeerAskBusy] = useState<string | null>(null);
  // THE BOARD READ, KEPT WITH NO BUTTON (Ben, 2026-11-07: cut the Peer pill
  // from the toolbar, "keep the functionality though ... if we decide to add
  // the button back it will be there"). Wire a button to runPeerPass to bring
  // it back; the toolbar pill it had is in git history (before this commit).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const runPeerPass = useCallback(async () => {
    if (!auth || !storyId || peerBusy) return;
    setPeerBusy(true);
    const before = new Set((dataRef.current?.peerQuestions ?? []).map((q) => q.id));
    let passId = '';
    let done = false;
    let timer = 0;
    let stop: (() => void) | undefined;
    const land = async (m: any) => {
      if (done) return;
      done = true;
      stop?.();
      window.clearTimeout(timer);
      let payload: ListProjectEntitiesResponse | null = null;
      try { payload = await refetch(); } catch { /* the board stays as it was */ }
      const fresh = (payload?.peerQuestions ?? []).filter((q) => !before.has(q.id) && q.open);
      setPeerBusy(false);
      if (fresh.length) {
        // A pass puts only its NEW questions out on the board, tied to their
        // cards (Ben, 2026-10-21); the rest stay folded. Each card pulses as
        // its question lands, then the receipt walks them.
        setPeerSpotlight(new Set(fresh.map((q) => q.id)));
        setPeerFresh(new Set(fresh.map((q) => q.id)));
        window.setTimeout(() => setPeerFresh(new Set()), 3200);
        const ents = payload?.entities ?? [];
        const titleOf = (id: string | null | undefined) => { const e = ents.find((x) => x.id === id); return e ? cardTitle(e) : ''; };
        const items: ReviewItem[] = fresh.map((q) => {
          const home = q.attachedTo ?? q.peer?.about?.[0] ?? q.id;
          const t = titleOf(home);
          return { targetId: home, questionId: q.id, line: 'peer', where: t ? `On ${t}` : 'On the board', heading: q.text, quote: '', hint: 'Click the question on the board to answer it.' };
        });
        setPeerReceipt({ items, lede: `The Peer read the board \u00b7 ${fresh.length} ${fresh.length === 1 ? 'question' : 'questions'}` });
        return;
      }
      const status = m?.status ?? (fresh.length ? 'asked' : 'late');
      setNotice(
        status === 'asked' ? 'The Peer read the board and has no new questions.'
          : status === 'nothing_new' ? 'Nothing new since the Peer last read the board.'
            : status === 'empty' ? 'Nothing on the board for the Peer to read yet. Dump something first.'
              : status === 'late' ? 'The Peer is taking longer than usual. Its questions land on the board when it is done.'
                : 'The Peer could not read the board just now. Try again in a moment.',
      );
    };
    stop = sessionRef.current?.onMessage((m) => {
      if (m?.type !== 'sandbox_peer_pass' || m?.projectId !== storyId) return;
      if (passId && m.passId && m.passId !== passId) return;
      void land(m);
    });
    try {
      const r = await sandboxPeerPass({ projectId: storyId, userId: auth.userId }, auth.token);
      passId = r.passId;
    } catch (e: any) {
      done = true;
      stop?.();
      setPeerBusy(false);
      setNotice(String(e?.message ?? e).includes('rate') ? 'That is a lot of asking at once. Try again in a minute.' : 'The Peer could not start just now. Try again in a moment.');
      return;
    }
    // No socket word in a minute: read the board anyway.
    if (!done) timer = window.setTimeout(() => { void land(null); }, 60000);
  }, [auth, storyId, peerBusy, refetch]);
  /** Dismiss: the question goes away and its gap is never asked again. */
  const onDismissQuestion = useCallback((id: string) => {
    if (!auth || !storyId) return;
    const setState = (open: boolean) => setData((cur) => cur ? { ...cur, peerQuestions: (cur.peerQuestions ?? []).map((q) => (q.id === id ? { ...q, open, peer: q.peer ? { ...q.peer, state: open ? 'open' : 'dismissed' } : q.peer } : q)) } : cur);
    setState(false);
    updateFragment({ projectId: storyId, fragmentId: id, open: false }, auth.token).catch(() => { refetch().catch(() => {}); });
    const token = auth.token;
    setUndo({
      label: 'Dismissed a question',
      run: () => { setState(true); return updateFragment({ projectId: storyId, fragmentId: id, open: true }, token); },
      redo: () => { setState(false); return updateFragment({ projectId: storyId, fragmentId: id, open: false }, token); },
    });
  }, [auth, storyId, refetch]);
  /** The Peer button on a card (one function, Ben 2026-10-21): its read, as
   *  a one-line take, and up to 3 questions about it. */
  const askPeerCard = useCallback(async (cardId: string) => {
    if (!auth || !storyId || peerAskBusy) return;
    const mode = 'both' as const;
    const setBusy = setPeerAskBusy;
    setBusy(cardId);
    setPeerCardNote(null);
    const beforeQs = new Set((dataRef.current?.peerQuestions ?? []).map((q) => q.id));
    let askId = '';
    let done = false;
    let timer = 0;
    let stop: (() => void) | undefined;
    const land = async (m: any) => {
      if (done) return;
      done = true;
      stop?.();
      window.clearTimeout(timer);
      let payload: ListProjectEntitiesResponse | null = null;
      try { payload = await refetch(); } catch { /* the board stays as it was */ }
      setBusy(null);
      const status = m?.status ?? 'late';
      // New questions pop in round the card; when none survive, the card says so.
      const fresh = (payload?.peerQuestions ?? []).filter((q) => !beforeQs.has(q.id) && q.open);
      if (fresh.length) {
        setPeerFresh(new Set(fresh.map((q) => q.id)));
        window.setTimeout(() => setPeerFresh(new Set()), 3200);
      }
      const openHere = (payload?.peerQuestions ?? []).filter((q) => q.open && q.attachedTo === cardId).length;
      if (status === 'asked' && !fresh.length) setPeerCardNote({ cardId, text: openHere ? 'No new questions this time. Answer the open one, or dump more into this card.' : 'No new questions this time. Dump more into this card and ask again.' });
      else if (status === 'asked') setPeerCardNote({ cardId, text: `${fresh.length} new ${fresh.length === 1 ? 'question' : 'questions'} on this card.` });
      else if (status === 'nothing_new') setPeerCardNote({ cardId, text: 'Nothing new on the board since the Peer last read this card.' });
      else if (status === 'failed') setPeerCardNote({ cardId, text: 'The Peer could not read this card just now. Try again in a moment.' });
      else if (status === 'late') setPeerCardNote({ cardId, text: 'The Peer is taking longer than usual. Its read and questions land here when it is done.' });
    };
    stop = sessionRef.current?.onMessage((m) => {
      if (m?.type !== 'sandbox_peer_card' || m?.projectId !== storyId || m?.cardId !== cardId) return;
      if (m?.mode && m.mode !== mode) return;
      if (askId && m.askId && m.askId !== askId) return;
      void land(m);
    });
    try {
      const r = await sandboxPeerCard({ projectId: storyId, userId: auth.userId, cardId, mode }, auth.token);
      askId = r.askId;
    } catch (e: any) {
      done = true;
      stop?.();
      setBusy(null);
      setNotice(String(e?.message ?? e).includes('rate') ? 'That is a lot of asking at once. Try again in a minute.' : 'The Peer could not start just now. Try again in a moment.');
      return;
    }
    if (!done) timer = window.setTimeout(() => { void land(null); }, 60000);
  }, [auth, storyId, peerAskBusy, refetch]);

  // ---- Same scene or new scene (2026-10-13) --------------------------------
  // The open questions about cards on this board: a held sandbox card the
  // dump read as probably a scene already here (merge suggestion or compare).
  const loadSameQs = useCallback(async (entities: ProjectEntity[]): Promise<StagedQuestion[]> => {
    if (!auth || !storyId) return [];
    try {
      const res = await listStagedQuestions({ projectId: storyId }, auth.token);
      const held = new Map(entities.filter((e) => !e.deleted_at && e.state === 'parked' && String((e as any).staged ?? '') === '1').map((e) => [e.id, e]));
      const qs = (res.questions ?? []).filter((q) => q.status === 'pending' && (q.question_type === 'merge_suggestion' || q.question_type === 'compare') && !!q.target_vid && held.has(q.cardId));
      setSameQs(qs);
      return qs;
    } catch { return []; }
  }, [auth, storyId]);
  const answerSame = useCallback(async (q: StagedQuestion, same: boolean) => {
    if (!auth || !storyId) return;
    const settle = (done: string) => setLanded((l) => (l ? { ...l, review: l.review.map((r) => (r.questionId === q.cardId ? { ...r, done } : r)) } : l));
    settle(same ? 'Same scene' : 'New scene');
    setSameQs((qs) => qs.filter((x) => x.cardId !== q.cardId));
    try {
      await answerStagedQuestion({ projectId: storyId, userId: auth.userId, cardId: q.cardId, answer: same ? 'merge' : 'keep' }, auth.token);
    } catch (e: any) {
      setNotice(`That answer did not save: ${e?.message ?? e}`);
    }
    refetch().catch(() => {});
  }, [auth, storyId, refetch]);
  const sameItem = useCallback((q: StagedQuestion, entities: ProjectEntity[]): ReviewItem => {
    const card = entities.find((e) => e.id === q.cardId);
    const target = entities.find((e) => e.id === q.target_vid);
    const targetTitle = target ? cardTitle(target) : q.target_title;
    return {
      targetId: q.target_vid, line: 'pending', questionId: q.cardId, required: true,
      where: `On the board · ${targetTitle}`,
      heading: 'Same scene, or a new one?',
      quote: String(card?.summary ?? '').trim() || String(card?.evidence_quote ?? '').trim() || q.candidate_title,
      note: `This reads like "${targetTitle}" again. Same scene keeps anything new on it as a sticky; new scene puts this on the board as its own card.`,
      actions: [
        { label: 'Same scene', primary: true, onPick: () => { void answerSame(q, true); } },
        { label: 'New scene', onPick: () => { void answerSame(q, false); } },
      ],
    };
  }, [answerSame]);
  // A question still open when the page loads reopens the receipt: it does
  // not go away until it is answered.
  const reopenedRef = useRef(false);
  useEffect(() => {
    if (!data || reopenedRef.current) return;
    reopenedRef.current = true;
    const entities = data.entities ?? [];
    void loadSameQs(entities).then((qs) => {
      if (qs.length) setLanded((l) => l ?? { dumpNo: 0, ids: new Set(), review: qs.map((q) => sameItem(q, entities)) });
    });
  }, [data, loadSameQs, sameItem]);

  // ---- Cards open, stickies edit (FIL-644) --------------------------------
  const [sheetCardId, setSheetCardId] = useState<string | null>(null);
  // The focus on the board (sandboxFocus.tsx): a click on a card opens it
  // there, in place; the master's full sheet is one more door from it.
  const [focusId, setFocusId] = useState<string | null>(null);
  const noResponses = useMemo(() => new Set<string>(), []);
  const onStickyEdit = useCallback((id: string, edit: StickyPatch) => {
    if (!auth || !storyId) return;
    let patch = edit;
    // A world strip's kind (2026-10-15): worn in its header at once.
    if (patch.factKind !== undefined || patch.worldKind !== undefined) {
      const { factKind, worldKind } = patch;
      setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((f) => (f.id === id ? { ...f, ...(factKind !== undefined ? { factKind } : {}), ...(worldKind !== undefined ? { worldKind } : {}) } : f)) } : cur);
      updateFragment({ projectId: storyId, fragmentId: id, ...(factKind !== undefined ? { factKind } : {}), ...(worldKind !== undefined ? { worldKind } : {}) }, auth.token).catch(() => { refetch().catch(() => {}); });
      if (!patch.text && patch.label === undefined && patch.speaker === undefined) return;
    }
    // A line's speaker (2026-10-11): one at a time, '' for no one yet.
    if (patch.speaker !== undefined) {
      const sp = patch.speaker;
      setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((f) => (f.id === id ? { ...f, speaker: sp || null } : f)) } : cur);
      updateFragment({ projectId: storyId, fragmentId: id, speaker: sp }, auth.token).catch(() => { refetch().catch(() => {}); });
      if (!patch.text && patch.label === undefined) return;
    }
    // A line's own quote marks come off (the sticky draws them).
    if (patch.text && (dataRef.current?.fragments ?? []).find((f) => f.id === id)?.kind === 'dialogue') {
      const bare = bareLine(patch.text);
      if (!bare) return;
      patch = { ...patch, text: bare };
    }
    if (!patch.text && patch.label === undefined) return;
    // Optimistic: the sticky is the writer's the moment they save.
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((f) => (f.id === id ? { ...f, ...(patch.text ? { text: patch.text, author: 'writer' } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) } : f)) } : cur);
    updateFragment({ projectId: storyId, fragmentId: id, ...(patch.text ? { text: patch.text } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) }, auth.token).catch(() => { refetch().catch(() => {}); });
    // More words, a taller sticky: what it now covers steps clear.
    if (patch.text) clearAround(id);
  }, [auth, storyId, refetch, clearAround]);
  const onStickyDelete = useCallback((id: string) => {
    if (!auth || !storyId) return;
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).filter((f) => f.id !== id) } : cur);
    deleteFragment({ projectId: storyId, fragmentId: id }, auth.token).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch]);
  // FIL-640: the writer's answer to a badge. Make it: one parked card of the
  // chosen kind, the stickies attached. Not yet: the badge comes off.
  const onMakeCard = useCallback((clusterId: string, kind: 'scene' | 'character' | 'world') => {
    if (!auth || !storyId) return;
    const badge = (data?.badges ?? []).find((b) => b.clusterId === clusterId);
    makeHuddleCard({ projectId: storyId, clusterId, kind }, auth.token).then((res) => {
      setUndo({
        label: `Made ${kind === 'world' ? 'a world card' : `a ${kind} card`}${res.title ? `: ${res.title}` : ''}`,
        run: () => undoMakeHuddleCard({ projectId: storyId, userId: auth.userId, clusterId, cardId: res.cardId, kind, badge: badge ? { kind: badge.kind, worldKind: badge.worldKind, title: badge.title, summary: badge.summary, touches: badge.touches } : undefined }, auth.token),
      });
      return refetch();
    }).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch, data]);
  // A huddle about a card that exists goes onto that card (2026-10-12),
  // instead of becoming a second one. Undo returns the huddle and its badge.
  const onAddHuddleTo = useCallback((clusterId: string, cardId: string) => {
    if (!auth || !storyId) return;
    const badge = (data?.badges ?? []).find((b) => b.clusterId === clusterId);
    const card = (data?.entities ?? []).find((e) => e.id === cardId);
    setData((cur) => cur ? { ...cur, badges: (cur.badges ?? []).filter((b) => b.clusterId !== clusterId), fragments: (cur.fragments ?? []).map((f) => (f.clusterId === clusterId ? { ...f, clusterId: null, attachedTo: cardId } : f)) } : cur);
    addHuddleToCard({ projectId: storyId, clusterId, cardId }, auth.token).then((res) => {
      setUndo({
        label: `Added to ${card ? cardTitle(card) : 'the card'}`,
        run: () => undoAddHuddleToCard({ projectId: storyId, clusterId, cardId, fragmentIds: res.attached, badge: badge ? { kind: badge.kind, worldKind: badge.worldKind, title: badge.title, summary: badge.summary, touches: badge.touches } : undefined }, auth.token),
      });
      return refetch();
    }).catch((e) => { setNotice(`Not added: ${e?.message ?? e}`); refetch().catch(() => {}); });
  }, [auth, storyId, data, refetch]);
  const onNotYet = useCallback((clusterId: string) => {
    if (!auth || !storyId) return;
    setData((cur) => cur ? { ...cur, badges: (cur.badges ?? []).filter((b) => b.clusterId !== clusterId) } : cur);
    dismissBadge({ projectId: storyId, clusterId }, auth.token).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch]);
  // FIL-652: promote a story sticky to the title row. The fact is saved by
  // the writer's hand (source: writer), the sticky resolves (open: false).
  const onPromote = useCallback((fragmentId: string, kind: StoryFactKind, text: string) => {
    if (!auth || !storyId || !text.trim()) return;
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((f) => (f.id === fragmentId ? { ...f, open: false } : f)) } : cur);
    saveStoryFact({ projectId: storyId, userId: auth.userId, kind, text: text.trim() }, auth.token)
      .then((res) => {
        const factId = res?.fact?.id;
        setUndo({
          label: `Promoted to the title row: ${text.trim()}`,
          run: async () => {
            if (factId) await deleteStoryFact({ projectId: storyId, userId: auth.userId, id: factId }, auth.token);
            await updateFragment({ projectId: storyId, fragmentId, open: true }, auth.token);
          },
        });
        return updateFragment({ projectId: storyId, fragmentId, open: false }, auth.token);
      })
      .then(() => refetch())
      .catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch]);
  // FIL-641: place goes to the master's wall with this card as the drop
  // card; demote turns the card back into a sticky, its stickies with it.
  const onPlaceCard = useCallback((cardId: string) => {
    if (!storyId) return;
    playPageWipe('left', () => navigate(`/freeform/${storyId}`, { state: { placeParked: cardId } }));
  }, [navigate, storyId]);
  // Anchor section 9: a parked scene's pages, in the one script editor,
  // scoped to that scene. They stay with the card until it is placed.
  // THE CARD MORPHS INTO THE EDITOR (Ben, 2026-10-08): no route, no wipe,
  // no frame. The focused card goes page-wide and the one script editor is
  // its body; its stickies, cast and where come in around it as the
  // margins. Draft again, or leaving the focus, closes it and refetches.
  const [writingId, setWritingId] = useState<string | null>(null);
  const onWriteCard = useCallback((cardId: string) => {
    setFocusId(cardId);
    setWritingId((cur) => (cur === cardId ? null : cardId));
  }, []);
  const closeWriting = useCallback(() => { setWritingId(null); refetch().catch(() => {}); }, [refetch]);
  // The card + New just made. Left with nothing on it (no name, no telling,
  // no sticky, no line, no cast, no colour) it was never wanted: it goes
  // quietly. Checked a beat later, after a name typed on the way out lands.
  const [freshId, setFreshId] = useState<string | null>(null);
  // A scene made with the + on the thread: how to take its links back out if
  // it goes untouched (sandbox-beats, 2026-11-05).
  const insertRevert = useRef<Map<string, () => Promise<unknown>>>(new Map());
  const dropIfUntouched = useCallback((id: string) => {
    if (!auth || !storyId) return;
    const d = dataRef.current;
    const e = (d?.entities ?? []).find((x) => x.id === id);
    if (!e || e.deleted_at) return;
    const touched = !!rawTitle(e) || !!String(e.summary ?? e.description ?? '').trim() || !!e.card_color
      || (d?.fragments ?? []).some((f) => f.attachedTo === id || f.speaker === id)
      || (d?.edges?.involves ?? []).some((x) => x.from === id || x.to === id);
    if (touched) { insertRevert.current.delete(id); return; }
    // Its links come out BEFORE it is deleted: deleting a card between two
    // others joins them, and the join would outlive the card.
    const revertLinks = insertRevert.current.get(id);
    if (revertLinks) insertRevert.current.delete(id);
    const linksOut = revertLinks ? revertLinks().catch(() => {}) : Promise.resolve();
    optimistic.current.delete(id);
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).filter((x) => x.id !== id) } : cur);
    // The card never was: its "Made" comes off the history too.
    const gone = (e: UndoEntry) => e.key === `made:${id}`;
    setToast((cur) => (cur && gone(cur) ? null : cur));
    setUndoStack((st) => st.filter((e) => !gone(e)));
    setRedoStack((st) => st.filter((e) => !gone(e)));
    afterCreate(id).then(() => linksOut).then(() => deleteCard({ cardId: id, projectId: storyId }, auth.token)).catch(() => {});
  }, [auth, storyId, afterCreate]);
  const onFocusChange = useCallback((id: string | null) => {
    setFocusId(id);
    if (writingId && id !== writingId) closeWriting();
    if (freshId && id !== freshId) { const leaving = freshId; setFreshId(null); window.setTimeout(() => dropIfUntouched(leaving), 150); }
  }, [writingId, closeWriting, freshId, dropIfUntouched]);
  const onDemoteCard = useCallback((cardId: string, where?: Pos) => {
    if (!auth || !storyId) return;
    const e = (data?.entities ?? []).find((x) => x.id === cardId);
    const w = (data?.world ?? []).find((x) => x.id === cardId);
    // Where the card sits now, default spot or dragged (Ben, 2026-11-01).
    const at = where ?? saved[cardId];
    setFocusId((cur) => (cur === cardId ? null : cur));
    demoteCard({ projectId: storyId, userId: auth.userId, cardId }, auth.token).then((res) => {
      // The sticky lands where the card was; so does the group it forms with
      // what was added as a card (FIL-718).
      if (at) { onMove(res.fragmentId, at); if (res.huddle) onMove(`group:${res.huddle}`, at); }
      // What comes back may be a lone sticky or a group (the card had
      // stickies, or was made from a group): whichever is on the board clears
      // its neighbours; the other id is never found and drops.
      clearAround(res.fragmentId);
      if (res.huddle) clearAround(`group:${res.huddle}`);
      setUndo({
        label: `Turned ${e ? cardTitle(e) : w ? `"${w.title}"` : 'the card'} into a sticky`,
        run: () => undoDemoteCard({ projectId: storyId, userId: auth.userId, cardId, fragmentId: res.fragmentId }, auth.token),
      });
      return refetch();
    }).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch, data, saved, onMove, clearAround]);
  // The card's telling, by hand, on the focus (Ben, 2026-10-08).
  // SCENES (Ben, 2026-10-08): the scene cards alone in a clean grid, drag to
  // reorder. A drop chains the moved card between its new neighbours
  // (PRECEDES by the writer's hand); nothing else is written.
  const [scenesMode, setScenesMode] = useState(false);
  // Which layout the Scenes view shows, remembered on this browser (per viewer).
  type ScenesLayout = 'grid' | 'columns' | 'timeline';
  const [scenesLayout, setScenesLayoutRaw] = useState<ScenesLayout>(() => { try { const v = localStorage.getItem('ff-scenes-layout'); return v === 'timeline' || v === 'columns' ? v : 'grid'; } catch { return 'grid'; } });
  const setScenesLayout = useCallback((k: ScenesLayout) => { setScenesLayoutRaw(k); try { localStorage.setItem('ff-scenes-layout', k); } catch { /* this session only */ } }, []);
  // The Characters view (2026-10-15): the master's web, on the sandbox.
  const [charactersMode, setCharactersMode] = useState(false);
  // Stickies fold into their cards' edges until the writer asks to see them
  // (Ben, 2026-10-15).
  const [showStickies, setShowStickies] = useState(false);
  // The world alone, a column per kind (Ben, 2026-10-15).
  const [worldMode, setWorldMode] = useState(false);
  // The grid's order, the writer's: index per scene under order#<id> in the
  // same saved map as positions (sandbox#order#<id>, x = index).
  const gridOrder = useMemo(() => Object.entries(saved).filter(([k]) => k.startsWith('order#')).sort((a, b) => a[1].x - b[1].x).map(([k]) => k.slice('order#'.length)), [saved]);
  const onGridOrder = useCallback((order: string[]) => {
    const changed: Array<[string, number]> = [];
    setSaved((cur) => {
      const next = { ...cur };
      order.forEach((id, i) => { const k = `order#${id}`; if (!cur[k] || cur[k].x !== i) { changed.push([id, i]); next[k] = { x: i, y: 0 }; } });
      return next;
    });
    if (!auth || !storyId) return;
    for (const [id, i] of changed) updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}order#${id}`, x: i, y: 0 }, auth.token).catch(() => { /* a convenience */ });
  }, [auth, storyId]);
  const onReorderScene = useCallback((cardId: string, diff: { remove: Array<{ from: string; to: string }>; add: Array<{ from: string; to: string }> }) => {
    if (!auth || !storyId) return;
    type E = { from: string; to: string };
    const key = (p: E) => `${p.from}|${p.to}`;
    const apply = (remove: E[], add: E[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const gone = new Set(remove.map(key));
        const kept = (prev.edges?.precedes ?? []).filter((p) => !gone.has(key(p)));
        const seen = new Set(kept.map(key));
        return { ...prev, edges: { ...prev.edges, precedes: [...kept, ...add.filter((a) => !seen.has(key(a)))] } };
      });
      return Promise.allSettled(remove.map((p) => untagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token)))
        .then(() => Promise.allSettled(add.map((p) => tagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))));
    };
    const e = (data?.entities ?? []).find((x) => x.id === cardId);
    apply(diff.remove, diff.add).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: `Moved ${e ? cardTitle(e) : 'the scene'}`, run: () => apply(diff.add, diff.remove), redo: () => apply(diff.remove, diff.add) });
  }, [auth, storyId, data, refetch]);
  // MOVABLE BEATS (Ben, 2026-11-05): a beat's own place on the line, kept as
  // one link: beat -> the scene it sits before, or the scene it follows ->
  // beat at the end. Moving it swaps that link; Undo puts the old one back.
  const onPlaceBeat = useCallback((beatId: string, at: { before?: string; after?: string }) => {
    if (!auth || !storyId) return;
    type E = { from: string; to: string };
    const key = (p: E) => `${p.from}|${p.to}`;
    const sceneIds = new Set((data?.entities ?? []).filter((e) => e.type === 'event').map((e) => e.id));
    const cur: E[] = ((data?.edges as any)?.cross_precedes ?? []).filter((p: E) => (p.from === beatId && sceneIds.has(p.to)) || (p.to === beatId && sceneIds.has(p.from)));
    const want: E[] = at.before ? [{ from: beatId, to: at.before }] : at.after ? [{ from: at.after, to: beatId }] : [];
    const remove = cur.filter((p) => !want.some((w) => key(w) === key(p)));
    const add = want.filter((w) => !cur.some((p) => key(p) === key(w)));
    if (!remove.length && !add.length) return;
    const apply = (rm: E[], ad: E[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const gone = new Set(rm.map(key));
        const kept = (((prev.edges as any)?.cross_precedes ?? []) as E[]).filter((p) => !gone.has(key(p)));
        return { ...prev, edges: { ...prev.edges, cross_precedes: [...kept, ...ad.filter((a) => !kept.some((k) => key(k) === key(a)))] } as any };
      });
      return Promise.allSettled(rm.map((p) => untagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token)))
        .then(() => Promise.allSettled(ad.map((p) => tagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))));
    };
    const e = (data?.entities ?? []).find((x) => x.id === beatId);
    apply(remove, add).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: `Moved ${e ? cardTitle(e) : 'the beat'}`, run: () => apply(add, remove), redo: () => apply(remove, add) });
  }, [auth, storyId, data, refetch]);
  // MOVING ON THE LINE (Scenes grid, sandbox-beats 2026-11-05). A scene or a
  // beat goes exactly where it is dropped in the order the grid SHOWS
  // (`shown`). The grid is the order: a moved scene joins the scenes right
  // after the scene before the drop; every beat is pinned where it sits
  // (right before the next scene, or after the last), and beats side by side
  // keep their order through the beat chain. Writes go out one batch at a
  // time and the story is read back only when all of them have landed: a
  // read between two quick drags snapped the grid back (Ben: "not sticky").
  const lineQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lineBusy = useRef(0);
  // A COLUMN MOVES WHOLE (Scenes columns, 2026-11-07): `carry` is the beat
  // and its scenes in order; they go in together at `index` of what is left,
  // each scene in turn right after the one before it.
  const onMoveInLine = useCallback((itemId: string, index: number, shown: string[], carry?: string[]) => {
    if (!auth || !storyId) return;
    type E = { from: string; to: string };
    const key = (p: E) => `${p.from}|${p.to}`;
    const d = dataRef.current;
    const kind = new Map((d?.entities ?? []).map((e) => [e.id, e.type]));
    const isScene = (x: string) => kind.get(x) === 'event';
    const isBeat = (x: string) => kind.get(x) === 'sequence';
    if (!shown.includes(itemId)) return;
    const block = carry?.length ? carry : [itemId];
    const rest = shown.filter((x) => !block.includes(x));
    const at = Math.max(0, Math.min(rest.length, index));
    const desired = [...rest.slice(0, at), ...block, ...rest.slice(at)];
    const pre: E[] = d?.edges?.precedes ?? [];
    const cross: E[] = (d?.edges as any)?.cross_precedes ?? [];
    const seqP: E[] = d?.edges?.sequence_precedes ?? [];
    const sceneSet = new Set((d?.entities ?? []).filter((e) => e.type === 'event').map((e) => e.id));
    const rm: E[] = []; const ad: E[] = [];
    // The scenes' own links: each moved scene in turn right after the scene
    // before it (the first after the scene before the drop), worked on a copy
    // of the links so the net change goes out once.
    const moving = block.filter(isScene);
    if (moving.length) {
      let X: string | undefined; for (let k = at - 1; k >= 0; k--) if (isScene(rest[k])) { X = rest[k]; break; }
      let Y: string | undefined; for (let k = at; k < rest.length; k++) if (isScene(rest[k])) { Y = rest[k]; break; }
      const inScenes = (p: E) => sceneSet.has(p.from) && sceneSet.has(p.to);
      const start = pre.filter(inScenes);
      let cur = start;
      let prev = X;
      for (const s of moving) {
        const diff = prev ? connectDiff(cur, prev, s, sceneSet) : Y ? placeBeforeDiff(cur, s, Y, sceneSet) : null;
        if (diff) { const gone = new Set(diff.remove.map(key)); cur = [...cur.filter((p) => !gone.has(key(p))), ...diff.add]; }
        prev = s;
      }
      const was = new Set(start.map(key)), now = new Set(cur.map(key));
      rm.push(...start.filter((p) => !now.has(key(p)))); ad.push(...cur.filter((p) => !was.has(key(p))));
    }
    // Every beat pinned where it sits in the new order.
    const beats = desired.filter(isBeat);
    desired.forEach((b, k) => {
      if (!isBeat(b)) return;
      let nY: string | undefined; for (let q = k + 1; q < desired.length; q++) if (isScene(desired[q])) { nY = desired[q]; break; }
      let pX: string | undefined; for (let q = k - 1; q >= 0; q--) if (isScene(desired[q])) { pX = desired[q]; break; }
      const w: E | null = nY ? { from: b, to: nY } : pX ? { from: pX, to: b } : null;
      const cur = cross.filter((c) => (c.from === b && sceneSet.has(c.to)) || (c.to === b && sceneSet.has(c.from)));
      for (const c of cur) if (!w || key(c) !== key(w)) rm.push(c);
      if (w && !cur.some((c) => key(c) === key(w))) ad.push(w);
    });
    // Beats side by side keep this order: the beat chain follows it.
    const beatSet = new Set(beats);
    const chainNow = seqP.filter((p) => beatSet.has(p.from) && beatSet.has(p.to));
    const chainWant = beats.slice(1).map((to, i) => ({ from: beats[i], to }));
    for (const c of chainNow) if (!chainWant.some((w) => key(w) === key(c))) rm.push(c);
    for (const w of chainWant) if (!chainNow.some((c) => key(c) === key(w))) ad.push(w);
    if (!rm.length && !ad.length) return;
    const bucket = (p: E) => (isBeat(p.from) && isBeat(p.to) ? 'seq' : isBeat(p.from) || isBeat(p.to) ? 'cross' : 'pre');
    const apply = (r: E[], a: E[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const gone = new Set(r.map(key));
        const keep = (list: E[]) => list.filter((p) => !gone.has(key(p)));
        return { ...prev, edges: { ...prev.edges,
          precedes: [...keep(prev.edges?.precedes ?? []), ...a.filter((x) => bucket(x) === 'pre')],
          cross_precedes: [...keep(((prev.edges as any)?.cross_precedes ?? []) as E[]), ...a.filter((x) => bucket(x) === 'cross')],
          sequence_precedes: [...keep(prev.edges?.sequence_precedes ?? []), ...a.filter((x) => bucket(x) === 'seq')],
        } as any };
      });
      lineBusy.current += 1;
      const run = lineQueue.current.then(() => Promise.allSettled(r.map((p) => untagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))))
        .then(() => Promise.allSettled(a.map((p) => tagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))));
      lineQueue.current = run.catch(() => {});
      return run.finally(() => { lineBusy.current -= 1; if (lineBusy.current === 0) refetch().catch(() => {}); });
    };
    const e = (d?.entities ?? []).find((x) => x.id === itemId);
    apply(rm, ad).catch(() => {});
    setUndo({ label: `Moved ${e ? cardTitle(e) : 'the card'}`, run: () => apply(ad, rm), redo: () => apply(rm, ad) });
  }, [auth, storyId, refetch]);
  // CARD COLOUR (2026-10-09): picked on the card, named later in the legend,
  // filtered additively. (The Cast lens was dropped the same day: not needed.)
  // SEVERAL SETS (FIL-707, 2026-11-03): the strip shows one set at a time (the
  // dot on a card, the names, the filter all follow it); one set, maybe
  // another, colours the frames. A story with one set reads as before.
  // SUBPLOTS (FIL-711): the story's arcs as a set in the strip, its scenes in
  // story order (the grid's saved order, then when made); pending arc
  // suggestions ride along as dashed chips. Reading them costs no model call.
  const sceneRank = useMemo(() => {
    const m = new Map<string, number>(gridOrder.map((id, i) => [id, i]));
    const made = (data?.entities ?? []).filter((e) => e.type === 'event').sort((a, b) => String((a as any).created_at ?? '').localeCompare(String((b as any).created_at ?? '')));
    made.forEach((e, i) => { if (!m.has(e.id)) m.set(e.id, 100000 + i); });
    return m;
  }, [gridOrder, data?.entities]);
  const subChips = useMemo(() => subplotsFrom(data?.entities ?? [], data?.edges, (id) => sceneRank.get(id) ?? 1e9), [data?.entities, data?.edges, sceneRank]);
  const [arcSuggestions, setArcSuggestions] = useState<ArcSuggestion[]>([]);
  const loadSuggestions = useCallback(() => {
    if (!auth || !storyId) return;
    listArcSuggestions({ projectId: storyId }, auth.token).then((r) => setArcSuggestions(r.suggestions ?? [])).catch(() => { /* suggestions are optional */ });
  }, [auth, storyId]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);
  const suggChips: SubplotChip[] = useMemo(() => arcSuggestions.map((g) => ({ id: `sugg:${g.suggestionId}`, suggestionId: g.suggestionId, name: g.suggestedName, color: '#64748b', description: g.description ?? '', scenes: [] })), [arcSuggestions]);
  const sets: StorySet[] = useMemo(() => {
    const raw = data?.labelSets?.length ? data.labelSets : [{ id: MAIN_SET, ...(data?.labelSet ?? { dimension: DEFAULT_SET_NAME, labels: [] }) }];
    const own = raw.map((x) => (x.id === MAIN_SET ? { ...x, dimension: setNameOf(x.dimension) } : x));
    // Subplots and Sequences are always offered, first, then the writer's
    // own sets (Ben, 2026-11-04); picked while empty, they show their
    // + Subplot / + Sequence to start one.
    // Sequences are beats on the board now (sandbox-beats), not a set.
    return [
      { id: SUBPLOTS_SET, dimension: 'Subplots', labels: [] },
      ...own,
    ];
  }, [data?.labelSets, data?.labelSet]);
  // THE SET YOU PICK COLOURS THE BOARD (Ben, 2026-11-03: the "Colours the
  // board" toggle made no sense). Subplots never paint: with them shown the
  // frames go plain and each scene wears its subplot dots. The pick is a
  // per-viewer convenience, remembered on this browser per story.
  const pickKey = `ff-strip-set#${storyId ?? ''}`;
  const [shownPick, setShownPickRaw] = useState<string | null>(() => { try { return localStorage.getItem(pickKey); } catch { return null; } });
  const setShownPick = useCallback((id: string | null) => { setShownPickRaw(id); try { if (id) localStorage.setItem(pickKey, id); else localStorage.removeItem(pickKey); } catch { /* this session only */ } }, [pickKey]);
  const savedPaint = sets.some((x) => x.id === data?.paintSet) ? data!.paintSet! : MAIN_SET;
  const shownSet = shownPick && sets.some((x) => x.id === shownPick) ? shownPick : savedPaint;
  const paintSet = shownSet === SUBPLOTS_SET ? 'none' : shownSet;
  const shown = sets.find((x) => x.id === shownSet) ?? sets[0];
  const [colorFilter, setColorFilter] = useState<Set<string>>(() => new Set());
  useEffect(() => { setColorFilter(new Set()); }, [shownSet]);
  const toggleFilter = useCallback((key: string) => setColorFilter((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; }), []);
  const parkedHere = useMemo(() => (data?.entities ?? []).filter((e) => !e.deleted_at && e.state === 'parked'), [data?.entities]);
  const colorCountsHere = useMemo(() => colorCounts(parkedHere, shownSet), [parkedHere, shownSet]);
  // What each set is, as its tooltip in the menu (Ben, 2026-11-04: "more
  // informative as to what those are").
  const setHint = (id: string) => (id === SEQUENCES_SET ? 'Chronological sections of your story.'
    : id === SUBPLOTS_SET ? 'Arcs that develop across your story.'
      : 'Your own colors and names for scenes.');
  const setChoices = useMemo(() => sets.map((x) => ({ id: x.id, name: x.dimension, hint: setHint(x.id), colors: x.id === SEQUENCES_SET ? seqChips.map((c) => c.color) : x.id === SUBPLOTS_SET ? subChips.map((c) => c.color) : [...colorCounts(parkedHere, x.id).keys()] })), [sets, parkedHere, seqChips, subChips]);
  const onSetColor = useCallback((cardId: string, color: string) => {
    if (!auth || !storyId) return;
    const setId = shownSet;
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => {
      if (e.id !== cardId) return e;
      if (setId === MAIN_SET) return { ...e, card_color: color || undefined };
      const m = { ...((e as any).set_colors ?? {}) };
      if (color) m[setId] = color; else delete m[setId];
      return { ...e, set_colors: m } as ProjectEntity;
    }) } : cur);
    afterCreate(cardId).then(() => setCardColor({ projectId: storyId, userId: auth.userId, cardId, color, ...(setId === MAIN_SET ? {} : { setId }) }, auth.token)).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch, afterCreate, shownSet]);
  const saveNames = useCallback(async (next: LabelSet, which?: string) => {
    if (!auth || !storyId) return;
    const setId = which ?? shownSet;
    setData((cur) => cur ? (setId === MAIN_SET
      ? { ...cur, labelSet: next, labelSets: cur.labelSets?.map((x) => (x.id === MAIN_SET ? { ...x, ...next } : x)) }
      : { ...cur, labelSets: cur.labelSets?.map((x) => (x.id === setId ? { ...x, ...next } : x)) }) : cur);
    try { await saveLabelSet({ projectId: storyId, userId: auth.userId, dimension: next.dimension, labels: next.labels, ...(setId === MAIN_SET ? {} : { setId }) }, auth.token); } catch { /* refetch shows the truth */ }
    await refetch();
  }, [auth, storyId, refetch, shownSet]);
  const onNameColor = useCallback((color: string, name: string) => {
    const labels = shown.labels.filter((l) => l.color !== color);
    if (name.trim()) labels.push({ id: `lab_${color.slice(1)}`, name: name.trim(), color });
    void saveNames({ dimension: shown.dimension, labels });
  }, [shown, saveNames]);
  const onHeading = useCallback((name: string) => { void saveNames({ dimension: name.trim() || (shownSet === MAIN_SET ? DEFAULT_SET_NAME : 'Untitled set'), labels: shown.labels }); }, [shown, shownSet, saveNames]);
  // Any of the writer's sets, from its own row in the set menu.
  const onRenameSet = useCallback((setId: string, name: string) => {
    const x = sets.find((y) => y.id === setId);
    if (!x) return;
    void saveNames({ dimension: name.trim() || (setId === MAIN_SET ? DEFAULT_SET_NAME : 'Untitled set'), labels: x.labels }, setId);
  }, [sets, saveNames]);
  const onNewSet = useCallback(async () => {
    if (!auth || !storyId) return;
    try {
      const r = await saveLabelSet({ projectId: storyId, userId: auth.userId, setId: 'new', dimension: 'New set' }, auth.token);
      await refetch();
      if (r.set?.id) setShownPick(r.set.id);
    } catch { refetch().catch(() => {}); }
  }, [auth, storyId, refetch, setShownPick]);
  const onRemoveSet = useCallback(async (setId: string) => {
    if (!auth || !storyId || setId === MAIN_SET) return;
    setShownPick(null);
    setData((cur) => cur ? { ...cur, labelSets: cur.labelSets?.filter((x) => x.id !== setId), paintSet: cur.paintSet === setId ? MAIN_SET : cur.paintSet } : cur);
    try { await saveLabelSet({ projectId: storyId, userId: auth.userId, setId, remove: true }, auth.token); } catch { /* refetch shows the truth */ }
    await refetch();
  }, [auth, storyId, refetch, setShownPick]);
  const onEditDescription = useCallback(async (cardId: string, text: string) => {
    if (!auth || !storyId) return;
    await afterCreate(cardId);
    if (cardId.startsWith('world_')) {
      setData((cur) => cur ? { ...cur, world: (cur.world ?? []).map((w) => (w.id === cardId ? { ...w, text } : w)) } : cur);
      try { await updateWorldEntry({ projectId: storyId, id: cardId, text }, auth.token); } catch { /* the refetch below shows the truth */ }
    } else if (cardId.startsWith('arc_')) {
      // A subplot's words (its own card on the sandbox, FIL-711).
      setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === cardId ? { ...e, description: text } : e)) } : cur);
      try { await updateArc({ arcId: cardId, projectId: storyId, description: text }, auth.token); } catch { /* the refetch below shows the truth */ }
    } else {
      setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === cardId ? { ...e, summary: text, description: text } : e)) } : cur);
      try { await updateCardDescription({ cardId, projectId: storyId, description: text }, auth.token); } catch { /* the refetch below shows the truth */ }
    }
    await refetch();
  }, [auth, storyId, refetch, afterCreate]);
  // An opened world entry's kind, picked (Ben, 2026-10-22).
  const onSetWorldKind = useCallback(async (id: string, kind: string) => {
    if (!auth || !storyId) return;
    setData((cur) => cur ? { ...cur, world: (cur.world ?? []).map((w) => (w.id === id ? { ...w, kind } : w)) } : cur);
    try { await updateWorldEntry({ projectId: storyId, id, kind }, auth.token); } catch (e: any) { setNotice(`The kind was not saved: ${e?.message ?? e}`); }
    await refetch();
  }, [auth, storyId, refetch]);
  const onEditTitle = useCallback(async (cardId: string, text: string) => {
    if (!auth || !storyId) return;
    // Optimistic first so the card reads its name at once, then the write
    // (after the card itself, when + New made it a moment ago).
    if (!cardId.startsWith('world_')) {
      optimistic.current.has(cardId) && optimistic.current.set(cardId, { ...optimistic.current.get(cardId)!, working_name: text, working_title: text });
      setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === cardId ? { ...e, ...(e.type === 'event' || e.type === 'sequence' ? { working_title: text } : { working_name: text }) } : e)) } : cur);
    }
    if (cardId.startsWith('arc_')) {
      // A subplot's name: update-arc (its id stays).
      setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === cardId ? { ...e, working_name: text } : e)) } : cur);
      try { await updateArc({ arcId: cardId, projectId: storyId, workingName: text }, auth.token); } catch { /* refetch shows the truth */ }
      await refetch();
      return;
    }
    await afterCreate(cardId);
    if (cardId.startsWith('world_')) {
      setData((cur) => cur ? { ...cur, world: (cur.world ?? []).map((w) => (w.id === cardId ? { ...w, title: text } : w)) } : cur);
      try { await updateWorldEntry({ projectId: storyId, id: cardId, title: text }, auth.token); } catch { /* refetch shows the truth */ }
    } else {
      setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === cardId ? { ...e, ...(e.type === 'event' || e.type === 'sequence' ? { working_title: text } : { working_name: text }) } : e)) } : cur);
      try { await updateCardName({ cardId, projectId: storyId, workingName: text }, auth.token); } catch { /* refetch shows the truth */ }
    }
    await refetch();
  }, [auth, storyId, refetch, afterCreate]);
  // The view around a focused card is the writer's too: where they drag the
  // connected cards is kept per focal card (sandbox#focusrel#<focal>#<item>),
  // as an offset from the opened card (2026-10-12): the card now opens in the
  // middle of the view, wherever that is, and what the writer placed around it
  // comes with it. The older absolute spots (sandbox#focus#...) are not read.
  // The draft screen keeps its own arrangement (`<focal>~w`, 2026-10-13):
  // the card is page-wide there, so the ring's offsets do not carry over.
  const layoutKey = (focalId: string) => (writingId && writingId === focalId ? `${focalId}~w` : focalId);
  const focusLayout = useMemo(() => {
    if (!focusId) return undefined;
    const pre = `focusrel#${layoutKey(focusId)}#`;
    const out: Record<string, Pos> = {};
    for (const [k, v] of Object.entries(saved)) if (k.startsWith(pre)) out[k.slice(pre.length)] = v;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, focusId, writingId]);
  const onMoveInFocus = useCallback((focalId: string, itemId: string, pos: Pos) => {
    const key = `focusrel#${layoutKey(focalId)}#${itemId}`;
    setSaved((cur) => ({ ...cur, [key]: pos }));
    if (!auth || !storyId) return;
    updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}${key}`, x: Math.round(pos.x), y: Math.round(pos.y) }, auth.token).catch(() => { /* a convenience */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, storyId, writingId]);
  // THE CHARACTERS WEB IS THE WRITER'S TO ARRANGE (Ben, 2026-10-15: "editable
  // and draggable, not fixed in place"). The first drag keeps every character
  // where the web had it and the dragged one where it was let go
  // (sandbox#web#<gen>#<id>), so nothing shifts when ties change later.
  // Re-arrange starts a new generation (sandbox#webgen), which brings the
  // automatic layout back without deleting a row.
  const webGen = saved.webgen?.x ?? 0;
  const webSaved = useMemo(() => {
    const pre = `web#${webGen}#`;
    const out: Record<string, Pos> = {};
    for (const [k, v] of Object.entries(saved)) if (k.startsWith(pre)) out[k.slice(pre.length)] = v;
    return out;
  }, [saved, webGen]);
  const onMoveInWeb = useCallback((moves: Array<{ id: string; pos: Pos }>) => {
    const keyed = moves.map((m) => ({ key: `web#${webGen}#${m.id}`, pos: { x: Math.round(m.pos.x), y: Math.round(m.pos.y) } }));
    setSaved((cur) => { const next = { ...cur }; for (const k of keyed) next[k.key] = k.pos; return next; });
    if (!auth || !storyId) return;
    for (const k of keyed) updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}${k.key}`, x: k.pos.x, y: k.pos.y }, auth.token).catch(() => { /* a convenience */ });
  }, [auth, storyId, webGen]);
  const onRearrangeWeb = useCallback(() => {
    const gen = webGen + 1;
    setSaved((cur) => ({ ...cur, webgen: { x: gen, y: 0 } }));
    if (!auth || !storyId) return;
    updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}webgen`, x: gen, y: 0 }, auth.token).catch(() => { /* a convenience */ });
  }, [auth, storyId, webGen]);
  // A card opened from the web goes back to the web when it closes.
  const backToWeb = useRef(false);
  const onChangeNarrativeStatus = useCallback((cardId: string, next: NarrativeStatus) => {
    if (!auth || !storyId) return;
    updateCardNarrativeStatus({ cardId, projectId: storyId, narrativeStatus: next }, auth.token).then(() => refetch()).catch(() => {});
  }, [auth, storyId, refetch]);

  // ---- By hand: cards and stickies (Ben, 2026-10-09) ----------------------
  // "+ New" asks for a blank scene, character or sticky where the writer is
  // looking; a double-click on empty board asks for a sticky right there.
  // The draft is live; its words make it (create-card parked, save-fragment),
  // nothing is written for a draft left empty. Undo takes it back.
  const [draft, setDraft] = useState<SandboxDraft | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // The New menu's tip, beside the hovered kind.
  const [newTip, setNewTip] = useState<{ text: string; top: number } | null>(null);
  useEffect(() => { if (!newOpen) setNewTip(null); }, [newOpen]);
  const [notice, setNotice] = useState<string | null>(null);
  // ---- Templates to get you started (Ben + Otavio, 2026-10-14) ------------
  // On an empty board a panel on the left offers a ready board per way of
  // building a story, from a film the writer knows. It lands flagged: editing
  // a card makes it theirs; Clear template takes the rest away.
  const [templates, setTemplates] = useState<SandboxTemplate[]>([]);
  const [tplClosed, setTplClosed] = useState(false);
  const [tplBusy, setTplBusy] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    if (!auth || !storyId) return;
    listTemplates({ projectId: storyId }, auth.token).then((r) => setTemplates(r.templates ?? [])).catch(() => { /* no panel then */ });
  }, [auth, storyId]);
  const hasTemplate = useMemo(() => !!data && (
    (data.entities ?? []).some((e) => !e.deleted_at && String((e as any).template ?? '') === '1')
    || (data.fragments ?? []).some((f) => f.template)
    || (data.world ?? []).some((w) => w.template)
  ), [data]);
  // Templates only at a plain empty state (Ben, 2026-10-17): opening the
  // braindump panel or a dump in flight puts them away until the board is
  // back to empty with the panel closed.
  const templatesShowing = !!data && items.length === 0 && !tplClosed && templates.length > 0 && !dockOpen && !dumpBusy;
  const showEmpty = !!data && items.length === 0 && !dockOpen && !draft && !writingId && !scenesMode && !charactersMode && !worldMode && phase !== 'submitting' && phase !== 'extracting';
  // THE FIRST-RUN GUIDE (sandboxTour.tsx): it waits on its first step for
  // The Matrix to land, then walks the board it lays down.
  const [coachOn, setCoachOn] = useState(false);
  const [coachStep, setCoachStep] = useState<string | null>(null);
  const tourWaitsTemplate = useRef(false);
  const tourStarted = useRef(false);
  const onUseTemplate = useCallback(async (id: string) => {
    if (!auth || !storyId || dumpBusyRef.current) return;
    const t = templates.find((x) => x.id === id);
    setTplBusy(id);
    try {
      await applyTemplate({ projectId: storyId, templateId: id }, auth.token);
      const payload = await refetch();
      // Lay it out like a braindump would leave it: world along the top, the
      // scenes weaving in story order, characters in the weave (templateLayout).
      if (payload) {
        const landed = stageItemsFrom({ entities: payload.entities ?? [], fragments: payload.fragments ?? [], badges: payload.badges ?? [], precedes: payload.edges?.precedes ?? [], world: payload.world ?? [] });
        const order = chainOrder(landed, linesOf(payload));
        const boardW = stageWrapRef.current?.clientWidth ? stageWrapRef.current.clientWidth - 40 : 1440;
        for (const [cid, pos] of Object.entries(templateLayout(landed, order, payload.edges?.involves ?? [], boardW))) onMove(cid, pos);
      }
      if (tourWaitsTemplate.current) {
        // The guide walks on by itself; seen from here, so a reload does not
        // start it over a board that is no longer empty.
        tourWaitsTemplate.current = false;
        markSandboxTourSeen();
      } else setNotice(`${t?.film ?? 'The template'} is on your board. Edit any card and it is yours; Clear template takes the rest away.`);
    } catch (e: any) {
      setNotice(`That template did not land: ${e?.message ?? e}`);
    } finally {
      setTplBusy(null);
    }
  }, [auth, storyId, templates, refetch, onMove]);
  useEffect(() => { if (!clearArmed) return; const t = window.setTimeout(() => setClearArmed(false), 3000); return () => window.clearTimeout(t); }, [clearArmed]);
  const onClearTemplate = useCallback(async () => {
    if (!auth || !storyId) return;
    if (!clearArmed) { setClearArmed(true); return; }
    setClearArmed(false);
    try {
      const r = await clearTemplate({ projectId: storyId }, auth.token);
      await refetch();
      setNotice(r.cleared ? 'The template is gone. What you made your own stays.' : 'Nothing left of the template.');
    } catch (e: any) {
      setNotice(`Could not clear the template: ${e?.message ?? e}`);
    }
  }, [auth, storyId, clearArmed, refetch]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(t); }, [notice]);
  // Where something new goes: the middle of the view, the nearest free spot.
  const spotFor = useCallback((size: { w: number; h: number }) => {
    const wrap = stageWrapRef.current;
    const view = wrap ? { x: wrap.scrollLeft, y: wrap.scrollTop, w: wrap.clientWidth, h: wrap.clientHeight } : { x: 0, y: 0, w: 1200, h: 600 };
    const taken = items.map((it) => { const p = positions[it.id]; const sz = itemSize(it); return p ? { x: p.x, y: p.y, w: sz.w, h: sz.h } : null; }).filter((b): b is { x: number; y: number; w: number; h: number } => !!b);
    return freeSpotIn(view, size, taken);
  }, [items, positions]);
  const openDraft = useCallback((kind: SandboxDraft['kind']) => {
    setNewOpen(false);
    if (dumpBusyRef.current) return;
    onFocusChange(null); setWritingId(null); setScenesMode(false); setCharactersMode(false); setWorldMode(false);
    setDraft({ kind, pos: spotFor({ w: STICKY_W, h: 104 }), at: Date.now() });
  }, [onFocusChange, spotFor]);
  // A NEW CARD OPENS EXPANDED (Ben, 2026-10-12): + New makes the card at
  // once, untitled, and opens it in the expanded view with the caret in its
  // name, so the name, the telling, stickies, lines and cast are all there
  // from the first moment. Its id is known before the write lands (a nonce).
  // keepView (Ben, 2026-11-05: "if i add a scene in the timeline, once i go
  // back from the full card, i should be returned to the timeline view"): a
  // scene added from the Scenes view opens over it and closes back to it.
  const makeCard = useCallback((kind: 'scene' | 'character', at?: Pos, keepView?: boolean): string | undefined => {
    setNewOpen(false);
    if (dumpBusyRef.current) return;
    setDraft(null); setWritingId(null); if (!keepView) setScenesMode(false); setCharactersMode(false); setWorldMode(false);
    if (!auth || !storyId) return;
    onFocusChange(null);
    const type = kind === 'scene' ? 'event' : 'character';
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9]/g, '').slice(0, 20);
    const id = `${type === 'event' ? 'evt' : 'char'}_new_${nonce}_${idSlug(storyId)}`;
    const pos = at ?? spotFor(cardSize(type));
    const now = new Date().toISOString();
    const ent = { id, type, working_name: '', description: '', state: 'parked', parked_at: now, created_at: now, established_traits: [], open_dimensions: [], evidence_quote: '', ...(type === 'event' ? { working_title: '', summary: '', narrative_status: 'on_screen' } : {}) } as unknown as ProjectEntity;
    optimistic.current.set(id, ent);
    setData((cur) => cur ? { ...cur, entities: [...(cur.entities ?? []), ent] } : cur);
    onMove(id, pos);
    setFreshId(id);
    setFocusId(id);
    madeHere.current.add(id);
    const made = createCard({ kind: type, projectId: storyId, userId: auth.userId, workingName: '', untitled: true, nonce, state: 'parked' }, auth.token)
      .then((res) => {
        if ('exists' in res || res.entity.id !== id) throw new Error('the new card did not land where expected');
        optimistic.current.delete(id);
        setUndo({ label: `Made ${kind === 'scene' ? 'a scene' : 'a character'}`, run: () => deleteCard({ cardId: id, projectId: storyId }, auth.token), redo: () => restoreCard({ cardId: id, projectId: storyId }, auth.token), key: `made:${id}` });
      })
      .catch((e) => {
        optimistic.current.delete(id);
        setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).filter((x) => x.id !== id) } : cur);
        setFocusId((cur) => (cur === id ? null : cur));
        setFreshId((cur) => (cur === id ? null : cur));
        setNotice(`The card was not made: ${e?.message ?? e}`);
        throw e;
      })
      .finally(() => { pendingCreate.current.delete(id); });
    pendingCreate.current.set(id, made.catch(() => {}));
    return id;
  }, [auth, storyId, onFocusChange, spotFor, onMove]);
  // THE + ON THE THREAD (Ben, 2026-11-05): a new scene between two cards on
  // the line. It joins the scenes right after the scene at or before the
  // left end, and a beat on either side keeps its side of it. The new card
  // opens to be named; the links go in once it exists.
  const onInsertBetween = useCallback((fromId: string, toId: string | null, at: Pos) => {
    if (!auth || !storyId) return;
    type E = { from: string; to: string };
    const key = (p: E) => `${p.from}|${p.to}`;
    const line = beatRes.line;
    const kind = new Map((data?.entities ?? []).map((e) => [e.id, e.type]));
    const i = line.indexOf(fromId), j = toId ? line.indexOf(toId) : -1;
    if (i < 0 || (toId && j < 0)) return;
    let X: string | undefined; for (let k = i; k >= 0; k--) if (kind.get(line[k]) === 'event') { X = line[k]; break; }
    let Y: string | undefined; if (j >= 0) for (let k = j; k < line.length; k++) if (kind.get(line[k]) === 'event') { Y = line[k]; break; }
    const id = makeCard('scene', at, true);
    if (!id) return;
    // What it lands on steps clear of it, like any new card (Ben, 2026-11-05).
    clearAround(id);
    // Every link to change, scenes' and beats' alike, as one step.
    const pre: E[] = data?.edges?.precedes ?? [];
    const cross: E[] = (data?.edges as any)?.cross_precedes ?? [];
    const sceneSet = new Set([...(data?.entities ?? []).filter((e) => e.type === 'event').map((e) => e.id), id]);
    const sceneDiff = X ? connectDiff(pre, X, id, sceneSet) : Y ? { remove: [], add: [{ from: id, to: Y }] } : null;
    const rm: E[] = [...(sceneDiff?.remove ?? [])];
    const ad: E[] = [...(sceneDiff?.add ?? [])];
    const beatPlace = (b: string, want: E) => { for (const p of cross) if ((p.from === b && sceneSet.has(p.to)) || (p.to === b && sceneSet.has(p.from))) if (key(p) !== key(want)) rm.push(p); ad.push(want); };
    if (kind.get(fromId) === 'sequence') beatPlace(fromId, { from: fromId, to: id });
    if (toId && kind.get(toId) === 'sequence') beatPlace(toId, Y ? { from: toId, to: Y } : { from: id, to: toId });
    const isCross = (p: E) => kind.get(p.from) === 'sequence' || kind.get(p.to) === 'sequence';
    const apply = (r: E[], a: E[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const gone = new Set(r.map(key));
        const keep = (list: E[]) => list.filter((p) => !gone.has(key(p)));
        const p0 = keep(prev.edges?.precedes ?? []); const c0 = keep(((prev.edges as any)?.cross_precedes ?? []) as E[]);
        return { ...prev, edges: { ...prev.edges, precedes: [...p0, ...a.filter((x) => !isCross(x))], cross_precedes: [...c0, ...a.filter(isCross)] } as any };
      });
      return Promise.allSettled(r.map((p) => untagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token)))
        .then(() => Promise.allSettled(a.map((p) => tagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))))
        .then(() => refetch());
    };
    insertRevert.current.set(id, () => apply(ad, rm));
    const made = pendingCreate.current.get(id) ?? Promise.resolve();
    made.then(() => apply(rm, ad)).then(() => {
      // One step on the history: "Added a scene" takes the scene and its links back.
      setUndoStack((st) => st.filter((e) => e.key !== `made:${id}`));
      setUndo({ label: 'Added a scene', key: `made:${id}`,
        run: () => apply(ad, rm).then(() => deleteCard({ cardId: id, projectId: storyId }, auth.token)),
        redo: () => restoreCard({ cardId: id, projectId: storyId }, auth.token).then(() => apply(rm, ad)) });
    }).catch(() => {});
  }, [auth, storyId, beatRes, data, makeCard, refetch, clearAround]);
  // ADD A SCENE TO A BEAT (Ben, 2026-11-05: "an easy way to add a scene to an
  // empty beat"): at the end of its stretch, its first when it has none; it
  // opens to be named. On the board it lands beside the beat's last card.
  const addSceneToBeat = useCallback((beatId: string) => {
    const line = beatRes.line;
    const i = line.indexOf(beatId);
    if (i < 0) return;
    const stretch = beatRes.scenesOf.get(beatId) ?? [];
    const end = stretch.length ? stretch[stretch.length - 1] : beatId;
    const k = line.indexOf(end);
    const next = k >= 0 && k + 1 < line.length ? line[k + 1] : null;
    const p = positions[end] ?? positions[beatId];
    onFocusChange(null);
    onInsertBetween(end, next, p ? { x: Math.round(p.x + 60), y: Math.round(p.y + 90) } : { x: 40, y: 40 });
  }, [beatRes, positions, onFocusChange, onInsertBetween]);
  // FIL-708: A PILL OPENS IN PLACE. Click a chip in the strip and it becomes a
  // small index card there; its scenes light on the board with a stripe in its
  // colour, everything else dims, and a click on a scene adds it (or, lit,
  // takes it out). Open card goes to its full card; Esc steps back one level.
  // A sequence's scenes are its CONTAINS; a label's, the scenes in its colour.
  const [stripOpen, setStripOpen] = useState<string | null>(null);
  // HIDE THE STRIP (FIL-707): one toggle in the toolbar, right side, left of
  // Undo (Ben, 2026-11-04: both in one place). Per viewer, remembered per story on this
  // browser. Hiding closes its card and lifts any filter it was holding, so
  // nothing stays dimmed with no way to undim it.
  const hiddenKey = `ff-strip-hidden#${storyId ?? ''}`;
  const [stripHidden, setStripHiddenRaw] = useState<boolean>(() => { try { return localStorage.getItem(hiddenKey) === '1'; } catch { return false; } });
  const setStripHidden = useCallback((v: boolean) => { setStripHiddenRaw(v); try { if (v) localStorage.setItem(hiddenKey, '1'); else localStorage.removeItem(hiddenKey); } catch { /* this session only */ } }, [hiddenKey]);
  const hideStrip = useCallback(() => { setStripOpen(null); setColorFilter(new Set()); setStripHidden(true); }, [setStripHidden]);
  // Once per browser, on an empty board with the templates out.
  useEffect(() => {
    if (tourStarted.current || !templatesShowing || sandboxTourSeen() || !templates.some((x) => x.id === TOUR_TEMPLATE_ID)) return undefined;
    const t = window.setTimeout(() => {
      if (tourStarted.current) return;
      tourStarted.current = true;
      tourWaitsTemplate.current = true;
      setCoachOn(true);
    }, 800);
    return () => window.clearTimeout(t);
  }, [templatesShowing, templates]);
  // What the guide's steps reach for, read at the moment they run.
  type CoachApi = { hasTemplate: () => boolean; useTemplate: () => void; openCard: (id: string) => void; closeCard: () => void; openSubplot: (name: string) => void; showScenes: (on: boolean) => void; clearTemplate: () => void };
  const coachApi = useRef<CoachApi | null>(null);
  coachApi.current = {
    hasTemplate: () => hasTemplate,
    useTemplate: () => { void onUseTemplate(TOUR_TEMPLATE_ID); },
    openCard: (id) => { setScenesMode(false); setCharactersMode(false); setWorldMode(false); onFocusChange(id); },
    closeCard: () => { onFocusChange(null); setWritingId(null); },
    openSubplot: (name) => {
      onFocusChange(null); setScenesMode(false); setStripHidden(false);
      const c = subChips.find((x) => x.name === name) ?? subChips[0];
      if (!c) return;
      if (shownSet === SUBPLOTS_SET) setStripOpen(c.id);
      else { openAfterSwitch.current = c.id; setShownPick(SUBPLOTS_SET); }
    },
    showScenes: (on) => { onFocusChange(null); setStripOpen(null); setCharactersMode(false); setWorldMode(false); setScenesMode(on); },
    clearTemplate: () => {
      if (!auth || !storyId) return;
      clearTemplate({ projectId: storyId }, auth.token).then(() => refetch()).catch((e: any) => setNotice(`Could not clear the template: ${e?.message ?? e}`));
    },
  };
  const coachSteps = useMemo(() => {
    const call = <K extends keyof CoachApi>(k: K) => ((...args: any[]) => (coachApi.current![k] as any)(...args)) as CoachApi[K];
    return sandboxTourSteps({
      hasTemplate: call('hasTemplate'), useTemplate: call('useTemplate'), openCard: call('openCard'), closeCard: call('closeCard'),
      openSubplot: call('openSubplot'), showScenes: call('showScenes'), clearTemplate: call('clearTemplate'),
      finish: () => { markSandboxTourSeen(); tourWaitsTemplate.current = false; setCoachOn(false); },
    });
  }, []);
  // FOCUS MODE (FIL-722; Philip's play state, Ben 2026-11-04): the board
  // alone, full screen. No toolbar, strip or dock; a click on a card puts its
  // stickies out or folds them; double-click still makes a sticky, drags and
  // Cmd+Z still work. Esc or the corner button leaves. True full screen when
  // the browser allows it, else the board fills the window.
  const [focusMode, setFocusMode] = useState(false);
  // An Esc that closes an open card closes only the card.
  const focusOpenRef = useRef(false);
  focusOpenRef.current = !!(focusId || sheetCardId || writingId);
  const [openStickies, setOpenStickies] = useState<ReadonlySet<string>>(() => new Set());
  const toggleStickies = useCallback((id: string) => setOpenStickies((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  // THE WAY HOME (FIL-719, Marko got lost): back to the plain board from any
  // view, card, filter or overlay.
  const goHome = useCallback(() => {
    setFocusId(null); setWritingId(null); setScenesMode(false); setCharactersMode(false); setWorldMode(false);
    setShowStickies(false); setPeerExpanded(false); setStripOpen(null); setColorFilter(new Set()); setSheetCardId(null);
  }, []);
  const enterFocus = useCallback(() => {
    goHome(); setDockOpen(false); setNewOpen(false); setOpenStickies(new Set()); setFocusMode(true);
    try { void document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch { /* fills the window instead */ }
  }, [goHome]);
  const leaveFocus = useCallback(() => {
    setFocusMode(false); setFocusId(null); setOpenStickies(new Set());
    try { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); } catch { /* not full screen */ }
  }, []);
  useEffect(() => {
    if (!focusMode) return;
    // The browser's own Esc leaves full screen; leaving it leaves focus mode.
    const onFs = () => { if (!document.fullscreenElement) leaveFocus(); };
    // Without full screen, Esc leaves, unless it is closing something first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.fullscreenElement || focusOpenRef.current) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      leaveFocus();
    };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    // The page under the board stops scrolling and drops the gutter it keeps
    // for its bar (scrollbar-gutter: stable), so no strip shows down the
    // right edge (Ben, 2026-11-04).
    const root = document.documentElement; const was = [root.style.overflow, root.style.scrollbarGutter];
    root.style.overflow = 'hidden'; root.style.scrollbarGutter = 'auto';
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKey); [root.style.overflow, root.style.scrollbarGutter] = was; };
  }, [focusMode, leaveFocus]);
  // Switching sets closes the open card, unless the switch was made to open
  // one (a subplot just made lands open in the Subplots set).
  const openAfterSwitch = useRef<string | null>(null);
  useEffect(() => { setStripOpen(openAfterSwitch.current); openAfterSwitch.current = null; }, [shownSet]);
  const openSeq = shownSet === SEQUENCES_SET ? seqChips.find((c) => c.id === stripOpen) : undefined;
  const openSub = shownSet === SUBPLOTS_SET ? subChips.find((c) => c.id === stripOpen) : undefined;
  const openColor = shownSet !== SEQUENCES_SET && shownSet !== SUBPLOTS_SET && stripOpen && /^#[0-9a-f]{6}$/.test(stripOpen) ? stripOpen : null;
  // A scene put in a subplot joins it with no word for what it does (Ben,
  // 2026-11-07: "'touches' as default doesn't make a ton of sense"); the
  // writer sets one from the chip on its edge, or the Peer does later.
  const toggleSubScene = useCallback((arcId: string, sceneId: string, isIn: boolean, transition = '') => {
    if (!auth || !storyId) return;
    const edit = (add: boolean) => setData((cur) => cur ? { ...cur, edges: { ...cur.edges, evokes: [...((cur.edges as any)?.evokes ?? []).filter((x: any) => !(x.arc_id === arcId && x.event_id === sceneId)), ...(add ? [{ event_id: sceneId, arc_id: arcId, transition, state_at_event: '' }] : [])] } as any } : cur);
    const write = (add: boolean): Promise<unknown> => (add ? tagEventEvokes({ projectId: storyId, eventId: sceneId, arcId, transition }, auth.token) : untagEventEvokes({ projectId: storyId, eventId: sceneId, arcId }, auth.token));
    edit(!isIn);
    afterCreate(sceneId).then(() => write(!isIn)).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: isIn ? 'Took the scene out' : 'Added the scene', run: async () => { edit(isIn); await write(isIn); await refetch(); }, key: `subscene:${arcId}:${sceneId}` });
  }, [auth, storyId, afterCreate, refetch]);
  // WHAT A SCENE DOES TO A SUBPLOT, set from its chip. A re-tag cannot clear
  // the word, so None takes the tag off and puts it back bare (its reading
  // kept). Undo sets the old word back.
  const setSubTransition = useCallback((arcId: string, sceneId: string, to: string) => {
    if (!auth || !storyId) return;
    const edge = (((dataRef.current?.edges as any)?.evokes ?? []) as any[]).find((x) => x.arc_id === arcId && x.event_id === sceneId);
    if (!edge) return;
    const was = String(edge.transition ?? '');
    if (was === to) return;
    const state = String(edge.state_at_event ?? '');
    const edit = (w: string) => setData((cur) => cur ? { ...cur, edges: { ...cur.edges, evokes: ((cur.edges as any)?.evokes ?? []).map((x: any) => (x.arc_id === arcId && x.event_id === sceneId ? { ...x, transition: w || undefined } : x)) } as any } : cur);
    const write = async (w: string) => {
      if (w) { await tagEventEvokes({ projectId: storyId, eventId: sceneId, arcId, transition: w }, auth.token); return; }
      await untagEventEvokes({ projectId: storyId, eventId: sceneId, arcId }, auth.token);
      await tagEventEvokes({ projectId: storyId, eventId: sceneId, arcId, ...(state ? { stateAtEvent: state } : {}) }, auth.token);
    };
    edit(to);
    write(to).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: to ? `Set it to ${to}` : 'Cleared what it does', run: async () => { edit(was); await write(was); await refetch(); }, key: `word:${arcId}:${sceneId}` });
  }, [auth, storyId, refetch]);
  // The scenes in story order, for a subplot's Add a scene.
  const scenesInOrder = useMemo(() => {
    const ev = (data?.entities ?? []).filter((e) => e.type === 'event' && e.state === 'parked' && !e.deleted_at);
    const rank = new Map(beatRes.line.map((id, k) => [id, k]));
    return [...ev].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  }, [data?.entities, beatRes]);
  const toggleSeqScene = useCallback((seqId: string, sceneId: string, isIn: boolean) => {
    if (!auth || !storyId) return;
    const edit = (add: boolean) => setData((cur) => cur ? { ...cur, edges: { ...cur.edges, contains: [...(cur.edges?.contains ?? []).filter((c) => (add ? c.to !== sceneId : !(c.from === seqId && c.to === sceneId))), ...(add ? [{ from: seqId, to: sceneId }] : [])] } } : cur);
    const write = (add: boolean): Promise<unknown> => (add ? tagSequenceContains({ projectId: storyId, sequenceId: seqId, eventId: sceneId }, auth.token) : untagSequenceContains({ projectId: storyId, sequenceId: seqId, eventId: sceneId }, auth.token));
    edit(!isIn);
    afterCreate(sceneId).then(() => write(!isIn)).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: isIn ? 'Took the scene out' : 'Added the scene', run: async () => { edit(isIn); await write(isIn); await refetch(); }, key: `seqscene:${seqId}:${sceneId}` });
  }, [auth, storyId, afterCreate, refetch]);
  const closeStrip = useCallback(() => setStripOpen(null), []);
  const stripPick = useMemo(() => {
    if (openSub) { const lit = new Set(openSub.scenes.map((x) => x.id)); return { lit, color: openSub.color, addLabel: `+ Add to ${openSub.name || 'this subplot'}`, outLabel: `In ${openSub.name || 'this subplot'} · click to take out`, tags: new Map(openSub.scenes.map((x) => [x.id, x.transition])), onClose: closeStrip, onToggle: (sid: string) => toggleSubScene(openSub.id, sid, lit.has(sid)) }; }
    if (openSeq) { const lit = new Set(openSeq.scenes); return { lit, color: openSeq.color, onClose: closeStrip, onToggle: (sid: string) => toggleSeqScene(openSeq.id, sid, lit.has(sid)) }; }
    if (openColor) {
      const lit = new Set(parkedHere.filter((e) => e.type === 'event' && colorIn(e, shownSet) === openColor).map((e) => e.id));
      return { lit, color: openColor, onClose: closeStrip, onToggle: (sid: string) => onSetColor(sid, lit.has(sid) ? '' : openColor) };
    }
    return undefined;
  }, [openSub, openSeq, openColor, parkedHere, shownSet, toggleSeqScene, toggleSubScene, onSetColor, closeStrip]);
  const sceneDots = useMemo(() => {
    if (shownSet !== SUBPLOTS_SET) return undefined;
    const m = new Map<string, string[]>();
    for (const c of subChips) for (const x of c.scenes) m.set(x.id, [...(m.get(x.id) ?? []), c.color]);
    return m;
  }, [shownSet, subChips]);
  // WHERE A SCENE SITS (Ben, 2026-11-03: "make it an actual point, like
  // 3.2"): with the Sequences set shown, each scene in a sequence wears its
  // sequence's number and its own place in it, in story order.
  const scenePlace = useMemo(() => {
    if (shownSet !== SEQUENCES_SET) return undefined;
    const m = new Map<string, { label: string; color: string }>();
    seqChips.forEach((c, i) => {
      [...c.scenes].sort((a, b) => (sceneRank.get(a) ?? 1e9) - (sceneRank.get(b) ?? 1e9)).forEach((sid, k) => m.set(sid, { label: `${i + 1}.${k + 1}`, color: c.color }));
    });
    return m;
  }, [shownSet, seqChips, sceneRank]);
  // AN OPENED SEQUENCE OR SUBPLOT IS A SANDBOX CARD (Ben, 2026-11-03: "sequences
  // and arcs need the sandbox style cards too"). Neither lives on the board,
  // so while one is open it joins the board's items as a card: the focus card,
  // its scenes woven under it in story order, the rest of the board faded.
  const boardItems: StageItem[] = useMemo(() => {
    if (!focusId || items.some((i) => i.id === focusId)) return items;
    const e = (data?.entities ?? []).find((x) => x.id === focusId);
    if (!e || e.deleted_at || !((e.type === 'sequence' && e.state === 'parked') || (e.type === 'arc' && !(e as any).character_id))) return items;
    const attached = (data?.fragments ?? []).filter((f) => f.open && f.attachedTo === e.id);
    return [...items, { id: e.id, kind: 'card', entity: e, attached } as StageItem];
  }, [focusId, items, data?.entities, data?.fragments]);
  // It has no spot on the board: it comes in from the top, under the strip.
  const boardPositions = useMemo(() => (boardItems === items || !focusId ? positions : { ...positions, [focusId]: { x: 24, y: 8 } }), [boardItems, items, focusId, positions]);
  // Making a subplot (+ subplot, New > Subplot): "Unnamed subplot", parked on
  // the sandbox, opened in the strip for the writer to name and fill.
  // A new "Unnamed subplot", numbered past any name taken, a deleted one's
  // too (the backend refuses those with a 409 the board cannot see).
  const mintSubplot = useCallback(async (): Promise<ProjectEntity> => {
    if (!auth || !storyId) throw new Error('not signed in');
    const taken = new Set((dataRef.current?.entities ?? []).filter((e) => e.type === 'arc').map((e) => String((e as any).working_name ?? '')));
    for (let n = 1; n <= 40; n++) {
      const name = n === 1 ? 'Unnamed subplot' : `Unnamed subplot ${n}`;
      if (taken.has(name)) continue;
      const r = await createArc({ projectId: storyId, userId: auth.userId, workingName: name, kind: 'thematic', board: 'sandbox' }, auth.token);
      if ('created' in r) return r.entity;
    }
    throw new Error('no free name for it');
  }, [auth, storyId]);
  const makeSubplot = useCallback(async () => {
    setNewOpen(false);
    if (!auth || !storyId) return;
    try {
      const r = { entity: await mintSubplot() };
      await refetch();
      if (shownSet !== SUBPLOTS_SET) openAfterSwitch.current = r.entity.id;
      setShownPick(SUBPLOTS_SET); setStripOpen(r.entity.id); setLandingSeq(r.entity.id);
      setUndo({ label: 'Made a subplot', run: () => deleteArc({ arcId: r.entity.id, projectId: storyId }, auth.token).then(() => refetch()), key: `made:${r.entity.id}` });
    } catch (e: any) {
      setNotice(`The subplot was not made: ${e?.message ?? e}`);
    }
  }, [auth, storyId, refetch, shownSet, setShownPick, mintSubplot]);
  // A SUBPLOT FROM A SCENE (Ben, 2026-11-07: "finish subplots"): a new
  // subplot with this scene in it, opened as its own card to be named and
  // filled from its Scenes "+". One Undo takes the subplot away.
  const subplotFromScene = useCallback(async (sceneId: string) => {
    if (!auth || !storyId) return;
    try {
      const arcId = (await mintSubplot()).id;
      await tagEventEvokes({ projectId: storyId, eventId: sceneId, arcId }, auth.token);
      await refetch();
      onFocusChange(arcId);
      setUndo({ label: 'Made a subplot', run: () => deleteArc({ arcId, projectId: storyId }, auth.token).then(() => refetch()), key: `made:${arcId}` });
    } catch (e: any) {
      setNotice(`The subplot was not made: ${e?.message ?? e}`);
    }
  }, [auth, storyId, refetch, onFocusChange, mintSubplot]);
  const onAcceptSuggestion = useCallback(async (suggestionId: string) => {
    if (!auth || !storyId) return;
    try {
      const r = await acceptArcSuggestion({ projectId: storyId, userId: auth.userId, suggestionId, board: 'sandbox' }, auth.token);
      setArcSuggestions((cur) => cur.filter((g) => g.suggestionId !== suggestionId));
      await refetch();
      if (r.arcId) { setStripOpen(r.arcId); setLandingSeq(r.arcId); }
    } catch (e: any) { setNotice(`The suggestion was not taken: ${e?.message ?? e}`); }
  }, [auth, storyId, refetch]);
  const onDismissSuggestion = useCallback(async (suggestionId: string) => {
    if (!auth || !storyId) return;
    setArcSuggestions((cur) => cur.filter((g) => g.suggestionId !== suggestionId));
    setStripOpen(null);
    dismissArcSuggestion({ projectId: storyId, suggestionId }, auth.token).catch(() => { loadSuggestions(); });
  }, [auth, storyId, loadSuggestions]);
  const onRenameSubplot = useCallback((arcId: string, name: string) => {
    if (!auth || !storyId || !name.trim()) return;
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === arcId ? { ...e, working_name: name.trim() } : e)) } : cur);
    updateArc({ arcId, projectId: storyId, workingName: name.trim() }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch]);
  // A PILL WHILE A CARD IS OPEN (Ben, 2026-11-05: "if i click into another
  // pill while looking at sequences, that should jump me immediately to that
  // card"). With a sequence or subplot open on the board, a pill opens its
  // own card there; otherwise it opens in place in the strip, as before.
  const onStripPill = useCallback((id: string) => {
    const open = focusId ? (dataRef.current?.entities ?? []).find((e) => e.id === focusId) : undefined;
    const target = (dataRef.current?.entities ?? []).find((e) => e.id === id);
    if (open && (open.type === 'sequence' || open.type === 'arc') && target && (target.type === 'sequence' || target.type === 'arc')) {
      setStripOpen(id);
      if (id !== focusId) { setScenesMode(false); setCharactersMode(false); setWorldMode(false); onFocusChange(id); }
      return;
    }
    setStripOpen((cur) => (cur === id ? null : id));
  }, [focusId, onFocusChange]);
  // A subplot goes (Ben, 2026-11-05: "subplots also need to be deletable"):
  // its dots leave the scenes; Undo brings it back with them.
  const onDeleteSubplot = useCallback((arcId: string) => {
    if (!auth || !storyId) return;
    const e = (dataRef.current?.entities ?? []).find((x) => x.id === arcId);
    const name = e ? String((e as any).working_name || 'the subplot') : 'the subplot';
    const now = new Date().toISOString();
    setStripOpen(null);
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((x) => (x.id === arcId ? { ...x, deleted_at: now } : x)) } : cur);
    deleteArc({ arcId, projectId: storyId }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: `Deleted ${name}`, run: () => restoreArc({ arcId, projectId: storyId }, auth.token).then(() => refetch()), redo: () => deleteArc({ arcId, projectId: storyId }, auth.token).then(() => refetch()) });
  }, [auth, storyId, refetch]);
  useEffect(() => {
    if (!stripOpen || sheetCardId || focusId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setStripOpen(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stripOpen, sheetCardId, focusId]);
  const seqWords = useCallback((id: string) => { const e = (data?.entities ?? []).find((x) => x.id === id); return String(e?.summary ?? e?.description ?? '').trim(); }, [data?.entities]);
  const scenesWord = (n: number) => `${n} ${n === 1 ? 'scene' : 'scenes'}`;
  // An opened subplot shows its path under its words; its Peer is the card's
  // Peer pill, as on scenes and characters (Ben, 2026-11-03).
  const onBeatColor = useCallback((id: string, color: string) => {
    if (!auth || !storyId) return;
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((e) => (e.id === id ? { ...e, color } as ProjectEntity : e)) } : cur);
    setSequenceColor({ sequenceId: id, projectId: storyId, color }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
  }, [auth, storyId, refetch]);
  const focusExtra = useCallback((id: string) => {
    // A beat's own control: done when its scenes cover it (sandbox-beats). It
    // shrinks to a marker on the line; reopening brings the card back.
    if (seqChips.some((c) => c.id === id)) {
      const cur = seqChips.find((c) => c.id === id)?.color;
      return (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" data-beat-add-scene onClick={() => addSceneToBeat(id)} title="A new scene at the end of this beat"
            style={{ font: 'inherit', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: dark ? '#e8e8ec' : '#1d2230', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>+</span>Add a scene
          </button>
          <span data-beat-colors style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            {[BEAT_PURPLE, ...LABEL_PALETTE.filter((c) => c !== BEAT_PURPLE)].map((c) => (
              <button key={c} type="button" aria-label="Beat color" title="Color this beat" onClick={() => onBeatColor(id, c)}
                style={{ width: 16, height: 16, borderRadius: '50%', padding: 0, cursor: 'pointer', background: c, border: cur === c ? `2px solid ${dark ? '#fff' : '#1d2230'}` : '1px solid rgba(0,0,0,.15)' }} />
            ))}
          </span>
        </div>
      );
    }
    const sub = subChips.find((c) => c.id === id);
    if (!sub) return null;
    return <div data-focus-path style={{ fontSize: 11.5, color: dark ? '#9a9aa4' : '#777', marginTop: 8 }}>{subplotPath(sub)}</div>;
  }, [subChips, dark, seqChips, onBeatColor, addSceneToBeat]);
  // FIL-709: make a sequence (New > Sequence, "+ sequence"), raise a scene to
  // one, put one back on the board as a scene, and set their order by dragging
  // the chips. A sequence is a scene raised a level (convert-card-altitude),
  // minted under its name, so an unnamed one is "Unnamed sequence", numbered.
  const [landingSeq, setLandingSeq] = useState<string | null>(null);
  useEffect(() => { if (!landingSeq) return; const t = window.setTimeout(() => setLandingSeq(null), 1200); return () => window.clearTimeout(t); }, [landingSeq]);
  // Something just made lands in the strip: a hidden strip comes back to show it.
  useEffect(() => { if ((landingSeq || stripOpen) && stripHidden) setStripHidden(false); }, [landingSeq, stripOpen, stripHidden, setStripHidden]);
  const seqName = useCallback(() => {
    const taken = new Set((dataRef.current?.entities ?? []).filter((e) => !e.deleted_at).map((e) => String((e as any).working_title || (e as any).working_name || '')));
    let n = 1; let name = 'Unnamed beat';
    while (taken.has(name)) name = `Unnamed beat ${++n}`;
    return name;
  }, []);
  const raiseToSequence = useCallback(async (cardId: string, name: string) => {
    if (!auth || !storyId) throw new Error('not signed in');
    const convert = () => convertCardAltitude({ projectId: storyId, userId: auth.userId, cardId, to: 'sequence' }, auth.token);
    try { return (await convert()).toId; } catch (err: any) {
      // One of that name in the trash refuses the mint (409): take "(2)" and try once more.
      if (!/409/.test(String(err?.message ?? err))) throw err;
      await updateCardName({ cardId, projectId: storyId, workingName: `${name} (2)` }, auth.token);
      return (await convert()).toId;
    }
  }, [auth, storyId]);
  const showSequence = useCallback((id: string) => { setShownPick(SEQUENCES_SET); setLandingSeq(id); }, [setShownPick]);
  const makeSequence = useCallback(async () => {
    setNewOpen(false);
    if (!auth || !storyId || dumpBusyRef.current) return;
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9]/g, '').slice(0, 20);
    const name = seqName();
    try {
      const res = await createCard({ kind: 'event', projectId: storyId, userId: auth.userId, workingName: '', untitled: true, nonce, state: 'parked' }, auth.token);
      if ('exists' in res) throw new Error('the new card did not land');
      await updateCardName({ cardId: res.entity.id, projectId: storyId, workingName: name }, auth.token);
      const id = await raiseToSequence(res.entity.id, name);
      await refetch();
      // A beat lands on the board (sandbox-beats); it opens as its card, the words ready to write.
      onFocusChange(id);
      setUndo({ label: 'Made a beat', run: () => deleteCard({ cardId: id, projectId: storyId }, auth.token), redo: () => restoreCard({ cardId: id, projectId: storyId }, auth.token), key: `made:${id}` });
    } catch (e: any) {
      setNotice(`The beat was not made: ${e?.message ?? e}`);
      refetch().catch(() => {});
    }
  }, [auth, storyId, seqName, raiseToSequence, refetch, onFocusChange]);
  const onToSequence = useCallback(async (cardId: string) => {
    if (!auth || !storyId) return;
    const e = (dataRef.current?.entities ?? []).find((x) => x.id === cardId);
    if (!e) return;
    await afterCreate(cardId);
    const was = positions[cardId];
    setFocusId(null);
    try {
      let name = String((e as any).working_title || '').trim();
      if (!name) { name = seqName(); await updateCardName({ cardId, projectId: storyId, workingName: name }, auth.token); }
      const id = await raiseToSequence(cardId, name);
      await refetch();
      showSequence(id);
      setUndo({ label: `Made ${name} a beat`, run: async () => {
        const back = await convertCardAltitude({ projectId: storyId, userId: auth.userId, cardId: id, to: 'event' }, auth.token);
        if (was) onMove(back.toId, was);
      }, key: `seq:${id}` });
    } catch (err: any) {
      setNotice(`It did not become a sequence: ${err?.message ?? err}`);
      refetch().catch(() => {});
    }
  }, [auth, storyId, afterCreate, seqName, raiseToSequence, refetch, showSequence, onMove, positions]);
  const onSequenceToScene = useCallback(async (seqId: string) => {
    if (!auth || !storyId) return;
    try {
      const back = await convertCardAltitude({ projectId: storyId, userId: auth.userId, cardId: seqId, to: 'event' }, auth.token);
      onMove(back.toId, spotFor(cardSize('event')));
      setSheetCardId(null);
      await refetch();
      setFocusId(back.toId);
      setUndo({ label: 'Put the sequence on the board', run: async () => { const id = await raiseToSequence(back.toId, ''); showSequence(id); }, key: `scene:${back.toId}` });
    } catch (err: any) {
      setNotice(`It did not go on the board: ${err?.message ?? err}`);
      refetch().catch(() => {});
    }
  }, [auth, storyId, onMove, spotFor, refetch, raiseToSequence, showSequence]);
  const onReorderSequences = useCallback((order: string[]) => {
    if (!auth || !storyId) return;
    const ids = new Set(order);
    const before = (dataRef.current?.edges?.sequence_precedes ?? []).filter((p) => ids.has(p.from) && ids.has(p.to));
    const want = order.slice(1).map((to, i) => ({ from: order[i], to }));
    const key = (p: { from: string; to: string }) => `${p.from}>${p.to}`;
    const wantKeys = new Set(want.map(key)); const haveKeys = new Set(before.map(key));
    const remove = before.filter((p) => !wantKeys.has(key(p)));
    const add = want.filter((p) => !haveKeys.has(key(p)));
    if (!remove.length && !add.length) return;
    setData((cur) => cur ? { ...cur, edges: { ...cur.edges, sequence_precedes: [...(cur.edges?.sequence_precedes ?? []).filter((p) => !(ids.has(p.from) && ids.has(p.to))), ...want] } } : cur);
    const apply = (rm: typeof remove, ad: typeof add) => Promise.allSettled(rm.map((p) => untagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token)))
      .then(() => Promise.allSettled(ad.map((p) => tagEventPrecedes({ projectId: storyId, fromEventId: p.from, toEventId: p.to }, auth.token))));
    apply(remove, add).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: 'Moved a sequence', run: () => apply(add, remove), redo: () => apply(remove, add) });
  }, [auth, storyId, refetch]);
  // TURN A STICKY INTO A CARD (Ben, 2026-10-31, the sticky menu): a scene,
  // character, sequence or world entry takes the sticky's place, its first
  // line the name and the rest the body ("we lost our second line": the rest
  // used to stay on a sticky hung on the card, out of sight). The sticky
  // rests (open: false), its words now the card's. Undo deletes the card and
  // puts the sticky back where it was.
  // A sequence from a sticky with no name line still needs a name (its id is
  // minted from it): "Unnamed sequence", numbered past any already there.
  const unnamedSequenceName = useCallback(() => {
    const taken = new Set((dataRef.current?.entities ?? []).map((e) => rawTitle(e)));
    let n = 1;
    let name = 'Unnamed sequence';
    while (taken.has(name)) name = `Unnamed sequence ${++n}`;
    return name;
  }, []);
  const onTurnInto = useCallback((stickyId: string, kind: TurnKind) => {
    if (!auth || !storyId || dumpBusyRef.current) return;
    const f = (dataRef.current?.fragments ?? []).find((x) => x.id === stickyId);
    if (!f) return;
    // THE STICKY IS THE CARD'S WORDS (Ben, 2026-11-01: "just take the sticky
    // content and apply it to the promoted card"): nothing is lifted out as
    // a name; the card starts unnamed and the writer names it.
    const body = f.text.trim();
    // The sticky's paper rides on what it becomes, for the way back (Ben, 2026-11-01).
    const stickyColor = stickyPaperKey(f);
    if (!body) return;
    // A grouped sticky has no spot of its own: the card takes its group's.
    const pinnedAt = f.attachedTo ? positions[f.attachedTo] : undefined;
    const pos = positions[stickyId] ?? (f.clusterId ? positions[`group:${f.clusterId}`] : undefined) ?? (pinnedAt ? { x: pinnedAt.x + 324, y: pinnedAt.y } : undefined) ?? spotFor(cardSize(kind === 'character' ? 'character' : 'event'));
    const word = kind === 'world' ? 'a world card' : `a ${kind}`;
    const rest = () => setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, open: false } : x)) } : cur);
    const failed = (e: any, dropId?: string) => {
      if (dropId) { optimistic.current.delete(dropId); setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).filter((x) => x.id !== dropId), fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? f : x)) } : cur); }
      else setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? f : x)) } : cur);
      setNotice(`The sticky was not turned into ${word}: ${e?.message ?? e}`);
      refetch().catch(() => {});
    };
    const undoFor = (cardId: string, remove: () => Promise<unknown>) => setUndo({
      label: `Made ${word}`,
      run: async () => { await updateFragment({ projectId: storyId, fragmentId: stickyId, open: true }, auth.token); await remove(); },
      key: `made:${cardId}`,
    });
    if (kind === 'world') {
      rest();
      // A world strip shows its text, not its title: the text is the whole
      // sticky, name line and all, formatting kept. Its title (its id) is
      // the first line, or a cut of a long one, never seen (nameInWords
      // tells the way back the words are all there is).
      saveWorldEntry({ projectId: storyId, kind: 'other', title: worldTitleOf(f.text), text: body, stickyColor, nameInWords: true, fromSticky: stickyId }, auth.token)
        .then(async (res) => {
          onMove(res.id, pos);
          clearAround(res.id);
          await updateFragment({ projectId: storyId, fragmentId: stickyId, open: false }, auth.token);
          // A world entry's id is its name: one of the same name deleted
          // before (an undone one) is saved again still deleted, and never
          // shows. Then the sticky comes back rather than vanish.
          const after = await refetch();
          if (after && !(after.world ?? []).some((w) => w.id === res.id)) {
            await updateFragment({ projectId: storyId, fragmentId: stickyId, open: true }, auth.token);
            throw new Error('a world card of this name was deleted before; rename the sticky\'s first line and try again');
          }
          undoFor(res.id, () => deleteWorldEntry({ projectId: storyId, id: res.id }, auth.token));
        })
        .catch((e) => failed(e));
      return;
    }
    const type = kind === 'character' ? 'character' : 'event';
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9]/g, '').slice(0, 20);
    const id = `${type === 'event' ? 'evt' : 'char'}_new_${nonce}_${idSlug(storyId)}`;
    const now = new Date().toISOString();
    const ent = { id, type: kind === 'sequence' ? 'sequence' : type, working_name: '', description: body, state: 'parked', parked_at: now, created_at: now, established_traits: [], open_dimensions: [], evidence_quote: '', ...(type === 'event' ? { working_title: '', summary: body, narrative_status: 'on_screen' } : {}) } as unknown as ProjectEntity;
    optimistic.current.set(id, ent);
    setData((cur) => cur ? { ...cur, entities: [...(cur.entities ?? []), ent], fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, open: false } : x)) } : cur);
    onMove(id, pos);
    clearAround(id);
    madeHere.current.add(id);
    // Every card written so far, so a step that fails takes them all back
    // and the sticky returns: never a stray scene with the words gone.
    const written: string[] = [];
    const made = createCard({ kind: type, projectId: storyId, userId: auth.userId, workingName: '', untitled: true, nonce, state: 'parked', stickyColor, fromSticky: stickyId }, auth.token)
      .then(async (res) => {
        if ('exists' in res || res.entity.id !== id) throw new Error('the new card did not land where expected');
        written.push(id);
        optimistic.current.delete(id);
        // The card stays unnamed for the writer to name; a sequence needs a
        // name to be minted under ("Unnamed sequence", numbered).
        const name = kind === 'sequence' ? unnamedSequenceName() : '';
        if (name) await updateCardName({ cardId: id, projectId: storyId, workingName: name }, auth.token);
        await updateCardDescription({ cardId: id, projectId: storyId, description: body }, auth.token);
        let finalId = id;
        if (kind === 'sequence') {
          // A sequence is a scene card raised a level (the master's convert),
          // minted again under an id made from its name. One of that name in
          // the trash (an undone sequence) refuses the mint (409); a sequence
          // cannot be renamed, so the scene takes "(2)" first and tries once more.
          const convert = () => convertCardAltitude({ projectId: storyId, userId: auth.userId, cardId: id, to: 'sequence' }, auth.token);
          let conv;
          try { conv = await convert(); } catch (err: any) {
            if (!/409/.test(String(err?.message ?? err))) throw err;
            await updateCardName({ cardId: id, projectId: storyId, workingName: `${name} (2)` }, auth.token);
            conv = await convert();
          }
          finalId = conv.toId;
          written.push(finalId);
          // It lives in the strip now (FIL-709), not on the board.
          showSequence(finalId);
        }
        await updateFragment({ projectId: storyId, fragmentId: stickyId, open: false }, auth.token);
        undoFor(finalId, () => deleteCard({ cardId: finalId, projectId: storyId }, auth.token));
        return refetch();
      })
      .catch(async (e) => {
        for (const w of written) { try { await deleteCard({ cardId: w, projectId: storyId }, auth.token); } catch { /* the refetch shows what is left */ } }
        try { await updateFragment({ projectId: storyId, fragmentId: stickyId, open: true }, auth.token); } catch { /* as above */ }
        failed(e, id);
      })
      .finally(() => { pendingCreate.current.delete(id); });
    pendingCreate.current.set(id, made.catch(() => {}));
  }, [auth, storyId, positions, spotFor, onMove, refetch, clearAround, unnamedSequenceName, showSequence]);
  // A sticky's colour, from its menu (Ben, 2026-10-31). Undo puts the old one back.
  const onStickyColor = useCallback((stickyId: string, color: string) => {
    if (!auth || !storyId) return;
    const before = (dataRef.current?.fragments ?? []).find((x) => x.id === stickyId)?.color ?? '';
    if (before === color) return;
    const paint = (c: string) => setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, color: c } : x)) } : cur);
    paint(color);
    updateFragment({ projectId: storyId, fragmentId: stickyId, color }, auth.token)
      .then(() => setUndo({
        label: color ? 'Colored a sticky' : 'Took a sticky\'s color off',
        run: async () => { paint(before); await updateFragment({ projectId: storyId, fragmentId: stickyId, color: before }, auth.token); },
        redo: async () => { paint(color); await updateFragment({ projectId: storyId, fragmentId: stickyId, color }, auth.token); },
      }))
      .catch((e) => { paint(before); setNotice(`The color was not saved: ${e?.message ?? e}`); });
  }, [auth, storyId]);
  const onRequestSticky = useCallback((pos: Pos) => { if (!dumpBusyRef.current) setDraft({ kind: 'sticky', pos, at: Date.now() }); }, []);
  const onDraftMove = useCallback((pos: Pos) => setDraft((d) => (d ? { ...d, pos } : d)), []);
  const onStickyResize = useCallback((id: string, size: { w: number; h: number }) => {
    const key = `size#${id}`;
    setSaved((cur) => ({ ...cur, [key]: { x: size.w, y: size.h } }));
    clearAround(id);
    if (!auth || !storyId) return;
    updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: `${LAYOUT_PREFIX}${key}`, x: size.w, y: size.h }, auth.token).catch(() => { /* a convenience */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, storyId, clearAround]);
  const onDraftCancel = useCallback(() => setDraft(null), []);
  const onDraftCommit = useCallback((text: string, speaker?: string) => {
    const d = draft;
    setDraft(null);
    const line = d?.kind === 'dialogue';
    const words = line ? bareLine(text) : text.trim();
    if (!d || !words || !auth || !storyId) return;
    saveFragment({ projectId: storyId, text: words, kind: line ? 'dialogue' : 'note', ...(line && speaker ? { speaker } : {}) }, auth.token).then((res) => {
      const f = res.fragment;
      setData((cur) => cur ? { ...cur, fragments: [...(cur.fragments ?? []).filter((x) => x.id !== f.id), { ...f, about: f.about ?? '', dumpId: f.dumpId ?? '', createdAt: f.createdAt ?? new Date().toISOString() }] } : cur);
      onMove(f.id, d.pos);
      clearAround(f.id);
      setUndo({ label: line ? 'Wrote a line' : 'Wrote a sticky', run: () => deleteFragment({ projectId: storyId, fragmentId: f.id }, auth.token) });
      return refetch();
    }).catch((e) => { setNotice(`The ${line ? 'line' : 'sticky'} was not saved: ${e?.message ?? e}`); });
  }, [draft, auth, storyId, onMove, refetch, clearAround]);
  // Delete a scene or character from its expanded view (2026-10-12). Its
  // stickies are not deleted with it: they come loose onto the board; a
  // character's lines keep their scene and lose their speaker. Undo restores
  // the card (and a character's relationships).
  const onDeleteCard = useCallback((cardId: string) => {
    if (!auth || !storyId) return;
    const e = (data?.entities ?? []).find((x) => x.id === cardId);
    const name = e ? rawTitle(e) : '';
    if (freshId === cardId) setFreshId(null);
    setFocusId((cur) => (cur === cardId ? null : cur));
    setWritingId((cur) => (cur === cardId ? null : cur));
    optimistic.current.delete(cardId);
    setData((cur) => cur ? { ...cur, entities: (cur.entities ?? []).map((x) => (x.id === cardId ? { ...x, deleted_at: new Date().toISOString() } : x)) } : cur);
    afterCreate(cardId)
      .then(() => deleteCard({ cardId, projectId: storyId }, auth.token))
      .then(() => {
        setUndo({ label: `Deleted ${name ? name : e?.type === 'character' ? 'an untitled character' : 'an untitled scene'}`, run: () => restoreCard({ cardId, projectId: storyId }, auth.token), redo: () => deleteCard({ cardId, projectId: storyId }, auth.token) });
        return refetch();
      })
      .catch((err) => { setNotice(`The card was not deleted: ${err?.message ?? err}`); refetch().catch(() => {}); });
  }, [auth, storyId, data, freshId, afterCreate, refetch]);
  // A loose sticky dropped on a card (2026-10-12). A line dropped on a
  // character becomes theirs to say (it then hangs on them); anything else
  // hangs on the card it was dropped on. Undo puts it back as it was.
  const onDropSticky = useCallback((stickyId: string, cardId: string) => {
    if (!auth || !storyId) return;
    const f = (data?.fragments ?? []).find((x) => x.id === stickyId);
    if (!f) return;
    const card = (data?.entities ?? []).find((x) => x.id === cardId);
    const world = (data?.world ?? []).find((x) => x.id === cardId);
    const name = card ? cardTitle(card) : world?.title ?? 'the card';
    if (f.kind === 'dialogue' && card?.type === 'character') {
      const before = f.speaker ?? '';
      setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, speaker: cardId } : x)) } : cur);
      updateFragment({ projectId: storyId, fragmentId: stickyId, speaker: cardId }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
      setUndo({ label: `${name} says the line`, run: () => updateFragment({ projectId: storyId, fragmentId: stickyId, speaker: before }, auth.token), redo: () => updateFragment({ projectId: storyId, fragmentId: stickyId, speaker: cardId }, auth.token) });
      return;
    }
    const before = f.attachedTo ?? '';
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, attachedTo: cardId, clusterId: null } : x)) } : cur);
    updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: cardId }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: `${f.kind === 'dialogue' ? 'Line' : 'Sticky'} put on ${name}`, run: () => updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: before }, auth.token), redo: () => updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: cardId }, auth.token) });
  }, [auth, storyId, data, refetch]);
  // UNPIN (Ben, 2026-11-01: "a quick unpin button"): the sticky leaves its
  // card and lies loose just right of it; Undo pins it back.
  const onUnpinSticky = useCallback((stickyId: string, cardId: string) => {
    if (!auth || !storyId) return;
    const c = positions[cardId];
    const card = (data?.entities ?? []).find((x) => x.id === cardId);
    if (c) onMove(stickyId, { x: c.x + (card ? cardSize(card.type).w : 300) + 24, y: c.y });
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, attachedTo: null, clusterId: null } : x)) } : cur);
    clearAround(stickyId);
    updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: '' }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); });
    setUndo({ label: 'Unpinned the sticky', run: () => updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: cardId }, auth.token), redo: () => updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: '' }, auth.token) });
  }, [auth, storyId, data, positions, onMove, clearAround, refetch]);
  // GROUPS BY HAND (Ben, 2026-11-02: "peel out of the group and re-add"). A
  // sticky dropped on a group joins it (on a loose sticky, the two make one);
  // its menu takes it out, loose beside the group. The group is read again
  // after, as a dump would, so its pill says what it now reads as.
  const reread = useCallback((clusterId: string | null | undefined) => {
    if (!auth || !storyId || !clusterId) return;
    rereadHuddle({ projectId: storyId, clusterId }, auth.token).then(() => refetch()).catch(() => { /* the group stays as it is */ });
  }, [auth, storyId, refetch]);
  const onGroupSticky = useCallback((stickyId: string, headId: string) => {
    if (!auth || !storyId) return;
    const f = (dataRef.current?.fragments ?? []).find((x) => x.id === stickyId);
    if (!f) return;
    const head = (dataRef.current?.fragments ?? []).find((x) => x.id === headId);
    const into = head?.clusterId || headId;
    const before = { clusterId: f.clusterId ?? '', attachedTo: f.attachedTo ?? '' };
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, clusterId: into, attachedTo: null } : x.id === headId && !x.clusterId ? { ...x, clusterId: into } : x)) } : cur);
    updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: headId }, auth.token)
      .then((res) => { reread(res.fragment?.clusterId ?? into); if (res.leftGroup) reread(res.leftGroup); return refetch(); })
      .catch(() => { refetch().catch(() => {}); });
    clearAround(`group:${into}`);
    const back = () => (before.attachedTo
      ? updateFragment({ projectId: storyId, fragmentId: stickyId, attachTo: before.attachedTo }, auth.token)
      : updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: before.clusterId }, auth.token));
    setUndo({ label: 'Put the sticky in the group', run: () => back().then(() => { reread(into); if (before.clusterId) reread(before.clusterId); }), redo: () => updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: headId }, auth.token) });
  }, [auth, storyId, refetch, reread, clearAround]);
  const onUngroupSticky = useCallback((stickyId: string, groupHeadId: string) => {
    if (!auth || !storyId) return;
    // Loose, just right of its group.
    const gid = `group:${groupHeadId}`;
    const g = positions[gid];
    const gi = allItems.find((it) => it.id === gid);
    if (g) onMove(stickyId, { x: g.x + (gi ? itemSize(gi).w : 340) + 24, y: g.y });
    setData((cur) => cur ? { ...cur, fragments: (cur.fragments ?? []).map((x) => (x.id === stickyId ? { ...x, clusterId: null } : x)) } : cur);
    updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: '' }, auth.token)
      .then((res) => { if (res.leftGroup) reread(res.leftGroup); return refetch(); })
      .catch(() => { refetch().catch(() => {}); });
    clearAround(stickyId);
    setUndo({ label: 'Took the sticky out of the group', run: () => updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: groupHeadId }, auth.token).then(() => reread(groupHeadId)), redo: () => updateFragment({ projectId: storyId, fragmentId: stickyId, huddle: '' }, auth.token) });
  }, [auth, storyId, positions, allItems, onMove, refetch, reread, clearAround]);
  // Cast from the expanded scene (2026-10-12): pick a character, they are in.
  const onAddCast = useCallback((sceneId: string, characterId: string) => {
    if (!auth || !storyId) return;
    setData((cur) => cur ? { ...cur, edges: { ...cur.edges, involves: [...(cur.edges?.involves ?? []), { from: sceneId, to: characterId }] } } : cur);
    afterCreate(sceneId)
      .then(() => tagEventInvolvesCharacter({ eventId: sceneId, characterId, projectId: storyId }, auth.token))
      .then(() => refetch())
      .catch((err) => { setNotice(`Not added to the cast: ${err?.message ?? err}`); refetch().catch(() => {}); });
  }, [auth, storyId, afterCreate, refetch]);
  // ---- Ties between characters (2026-10-15) --------------------------------
  // Written in the voice of the character the writer is looking from: the
  // old wording (either direction) goes, the new one is stored from -> to.
  // The tie lives on the story, shown on the sandbox and the master alike.
  const dropTie = useCallback(async (t: Tie) => {
    if (!auth || !storyId) return;
    await deleteStructuralEdge({ projectId: storyId, fromId: t.from, toId: t.to }, auth.token);
    await deleteStructuralEdge({ projectId: storyId, fromId: t.to, toId: t.from }, auth.token).catch(() => { /* none that way */ });
  }, [auth, storyId]);
  const onSetTie = useCallback((fromId: string, toId: string, predicate: string, prev?: Tie) => {
    if (!auth || !storyId) return;
    const text = predicate.trim();
    if (!text) return;
    setData((cur) => {
      if (!cur) return cur;
      const keep = (cur.edges?.structural ?? []).filter((x) => !((x.from === fromId && x.to === toId) || (x.from === toId && x.to === fromId)));
      return { ...cur, edges: { ...cur.edges, structural: [...keep, { from: fromId, to: toId, predicate: text }] } as any };
    });
    (async () => {
      if (prev?.source === 'tie') await dropTie(prev);
      await setStructuralEdge({ projectId: storyId, fromId, toId, predicate: text }, auth.token);
    })().then(() => refetch()).catch((err) => { setNotice(`That tie did not save: ${err?.message ?? err}`); refetch().catch(() => {}); });
  }, [auth, storyId, dropTie, refetch]);
  const onRemoveTie = useCallback((t: Tie) => {
    if (!auth || !storyId) return;
    if (t.source === 'tie') {
      setData((cur) => cur ? { ...cur, edges: { ...cur.edges, structural: (cur.edges?.structural ?? []).filter((x) => !((x.from === t.a && x.to === t.b) || (x.from === t.b && x.to === t.a))) } as any } : cur);
      dropTie(t).then(() => refetch()).catch((err) => { setNotice(`That tie was not removed: ${err?.message ?? err}`); refetch().catch(() => {}); });
    } else if (t.relId && t.relParked) {
      deleteCard({ cardId: t.relId, projectId: storyId }, auth.token).then(() => refetch()).catch((err) => { setNotice(`That tie was not removed: ${err?.message ?? err}`); });
    }
  }, [auth, storyId, dropTie, refetch]);
  const onAddSticky = useCallback((cardId: string, text: string) => {
    const words = text.trim();
    if (!words || !auth || !storyId) return;
    afterCreate(cardId).then(() => saveFragment({ projectId: storyId, text: words, kind: 'note', attachTo: cardId }, auth.token)).then((res) => {
      const f = res.fragment;
      setData((cur) => cur ? { ...cur, fragments: [...(cur.fragments ?? []).filter((x) => x.id !== f.id), { ...f, about: f.about ?? '', dumpId: f.dumpId ?? '', createdAt: f.createdAt ?? new Date().toISOString() }] } : cur);
      const e = (data?.entities ?? []).find((x) => x.id === cardId);
      const w = (data?.world ?? []).find((x) => x.id === cardId);
      setUndo({ label: `Wrote a sticky on ${e ? cardTitle(e) : w ? w.title : 'the card'}`, run: () => deleteFragment({ projectId: storyId, fragmentId: f.id }, auth.token) });
      return refetch();
    }).catch((e) => { setNotice(`The sticky was not saved: ${e?.message ?? e}`); });
  }, [auth, storyId, data, refetch, afterCreate]);
  // A line from a focused card (2026-10-11): on a scene it hangs there, said
  // by whoever was picked; on a character it is theirs, with no scene yet.
  const onAddLine = useCallback((cardId: string, text: string, speaker: string) => {
    const words = bareLine(text);
    if (!words || !auth || !storyId) return;
    const card = (data?.entities ?? []).find((x) => x.id === cardId);
    const onCharacter = card?.type === 'character';
    const who = speaker || (onCharacter ? cardId : '');
    afterCreate(cardId).then(() => saveFragment({ projectId: storyId, text: words, kind: 'dialogue', ...(onCharacter ? {} : { attachTo: cardId }), ...(who ? { speaker: who } : {}) }, auth.token)).then((res) => {
      const f = res.fragment;
      setData((cur) => cur ? { ...cur, fragments: [...(cur.fragments ?? []).filter((x) => x.id !== f.id), { ...f, about: f.about ?? '', dumpId: f.dumpId ?? '', createdAt: f.createdAt ?? new Date().toISOString() }] } : cur);
      setUndo({ label: `Wrote a line${card ? ` on ${cardTitle(card)}` : ''}`, run: () => deleteFragment({ projectId: storyId, fragmentId: f.id }, auth.token) });
      return refetch();
    }).catch((e) => { setNotice(`The line was not saved: ${e?.message ?? e}`); });
  }, [auth, storyId, data, refetch, afterCreate]);

  const onSubmit = useCallback(async () => {
    const prose = text.trim();
    const aim = focal;
    if (!auth || !storyId || !prose) return;
    const braindumpId = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const traitsOf = (e: { established_traits?: string[] } | undefined) => (Array.isArray(e?.established_traits) ? e!.established_traits.map(String) : []);
    const focalBefore = aim ? (data?.entities ?? []).find((e) => e.id === aim.id) : undefined;
    const before = {
      ids: new Set((data?.entities ?? []).filter((e) => !e.deleted_at).map((e) => e.id)),
      frags: new Set((data?.fragments ?? []).map((f) => f.id)),
      badges: new Map((data?.badges ?? []).map((b) => [b.clusterId, `${b.kind}|${b.title}`])),
      world: new Set((data?.world ?? []).map((w) => w.id)),
      dumps: new Set((data?.fragments ?? []).map((f) => f.dumpId)).size,
      // A focused dump may only merge traits onto its card: watch those too.
      focalTraits: new Set(traitsOf(focalBefore)),
      focalDesc: String(focalBefore?.description ?? focalBefore?.summary ?? ''),
      board: { positions: { ...boardNow.current.positions }, ids: new Set(boardNow.current.ids), saved: { ...boardNow.current.saved } },
    };
    const focalAt = aim;
    try {
      const d = dockRef.current?.getBoundingClientRect();
      const s = stageWrapRef.current?.getBoundingClientRect();
      if (d && s) setLandingFrom({ x: d.left + d.width / 2 - s.left + stageWrapRef.current!.scrollLeft - 75, y: d.top + d.height / 2 - s.top + stageWrapRef.current!.scrollTop - 40 });
    } catch { /* no flight */ }
    setPhase('submitting');
    setMsg('Sending your dump to the sandbox…');
    setLanded(null);
    setSpot(null);
    try {
      // Dumping into a template card is working on it: it becomes the
      // writer's first, or the pipeline would not see it (2026-10-14).
      if (aim && String((focalBefore as any)?.template ?? '') === '1') await claimTemplateCard({ projectId: storyId, cardId: aim.id }, auth.token);
      for (const t of waveTimers.current) window.clearTimeout(t);
      waveTimers.current = [];
      setWaves({ braindumpId, beforeIds: before.ids, beforeFrags: before.frags, beforeWorld: before.world, beforeBadges: before.badges, released: 0, fly: new Set() });
      await enqueueExtractionJob({ jobType: 'extract-braindump', userId: auth.userId, projectId: storyId, braindumpId, prose, board: 'sandbox', ...(aim ? { focalCardId: aim.id } : {}) }, auth.token);
      setPhase('extracting');
      setMsg(aim ? `Reading it into ${aim.title}. Usually 10 to 20 seconds.` : 'Reading it. Stickies and cards land here when it is done, usually 10 to 20 seconds.');
    } catch (e: any) {
      setWaves(null);
      setPhase('error');
      setMsg(e?.message ?? String(e));
      return;
    }
    const startedAt = Date.now();
    let lastSig = '';
    let stable = 0;
    // The backend's own "done" for this dump: one read is then enough.
    let doneSeen = false;
    let emptyAfterDone = 0;
    let inFlight = false;
    let finished = false;
    const stopListening = sessionRef.current?.onMessage((m) => {
      if (finished || doneSeen || m?.braindumpId !== braindumpId) return;
      // PROGRESS LINE (Ben, 2026-10-17): what the readers found, then that
      // it is being placed. Words only; the cards still land after cleanup.
      if (m?.type === 'sandbox_dump_progress') {
        const line = progressLine(m);
        if (line) setMsg(line);
        return;
      }
      if (m?.type !== 'braindump_complete') return;
      doneSeen = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
      pollRef.current = null;
      // For a sandbox dump the backend sends this only when the WHOLE job is
      // done (questions saved, worker tail run; graph-writes, 2026-10-17), so
      // the board read can happen at once.
      void tick();
    });
    const finish = () => { finished = true; stopListening?.(); pollRef.current = null; };
    const tick = async (): Promise<void> => {
      if (finished || inFlight) return;
      inFlight = true;
      try { await tickOnce(); } finally { inFlight = false; }
    };
    const tickOnce = async () => {
      let payload: ListProjectEntitiesResponse | null = null;
      try { payload = await refetch(); } catch { /* try again */ }
      if (payload) {
        const newEnt = (payload.entities ?? []).filter((e) => !e.deleted_at && e.state === 'parked' && !before.ids.has(e.id));
        const newFrag = (payload.fragments ?? []).filter((f) => f.open && !before.frags.has(f.id) && f.author !== 'peer');
        const focalNow = focalAt ? (payload.entities ?? []).find((e) => e.id === focalAt.id) : undefined;
        const newTraits = traitsOf(focalNow).filter((tr) => !before.focalTraits.has(tr));
        const descChanged = !!focalNow && String(focalNow.description ?? focalNow.summary ?? '') !== before.focalDesc;
        const newBadges: SandboxBadge[] = (payload.badges ?? []).filter((b) => before.badges.get(b.clusterId) !== `${b.kind}|${b.title}`);
        const newWorld = (payload.world ?? []).filter((w) => !before.world.has(w.id));
        const sig = [...newEnt.map((e) => e.id), ...newFrag.map((f) => f.id), ...newTraits.map((tr) => `t:${tr}`), ...newBadges.map((b) => `b:${b.clusterId}`), ...newWorld.map((w) => `w:${w.id}`), descChanged ? 'desc' : ''].filter(Boolean).sort().join('|');
        // CONFIRMED DONE (Ben, 2026-10-17): the receipt never opens before the
        // backend says the whole job finished, by the socket or by the
        // worker's marker on the board read. Two identical reads only count
        // against a backend too old to send doneDumps.
        const markerDone = Array.isArray(payload.doneDumps) ? payload.doneDumps.includes(braindumpId) : null;
        if (markerDone) doneSeen = true;
        if (sig) {
          stable = sig === lastSig ? stable + 1 : 0;
          lastSig = sig;
          if (doneSeen || (markerDone === null && stable >= 1)) {
            // Probably-the-same-scene cards come first, as questions; they stay
            // off the board until answered.
            const qs = await loadSameQs(payload.entities ?? []);
            const heldIds = new Set(qs.map((q) => q.cardId));
            const ids = new Set<string>([...newEnt.filter((e) => !heldIds.has(e.id)).map((e) => e.id), ...newFrag.map((f) => f.id), ...newWorld.map((w) => w.id)]);
            const review: ReviewItem[] = qs.map((q) => sameItem(q, payload!.entities ?? []));
            if (focalAt && newTraits.length) {
              review.push({
                targetId: focalAt.id, line: 'attached',
                where: `On the board · ${focalAt.title}`,
                heading: `Added to ${focalAt.title}`,
                quote: newTraits.join(' · '),
                note: 'Traits, from your words.',
                done: 'Added',
              });
            }
            if (focalAt && descChanged && focalNow) {
              // The adjusted description, with the prior kept on the card:
              // Undo writes it back (Ben, 2026-10-07: adjust, do not append).
              const prior = String((focalNow as any).description_prior ?? before.focalDesc);
              const cardId = focalAt.id;
              review.push({
                targetId: cardId, line: 'pending',
                where: `On the board · ${focalAt.title}`,
                heading: 'Description adjusted',
                quote: String(focalNow.description ?? focalNow.summary ?? ''),
                note: 'Restated from your words. The earlier description is kept until you undo.',
                actions: [{ label: 'Keep', primary: true, onPick: () => {} }, { label: 'Undo', onPick: () => {
                  if (!auth || !storyId) return;
                  updateCardDescription({ cardId, projectId: storyId, description: prior }, auth.token).then(() => refetch()).catch(() => {});
                } }],
              });
            }
            for (const b of newBadges) {
              const clusterId = b.clusterId;
              review.push({
                targetId: clusterId, line: 'ready',
                where: 'Loose · ready',
                heading: badgeHeading(b),
                quote: b.summary,
                note: b.touches.length ? `Touches ${b.touches.join(', ')}. The stickies stay under it; nothing is made until you say.` : 'The stickies stay under it; nothing is made until you say.',
                actions: [
                  ...(b.addTo ? [{ label: `Add to ${b.addTo.title}`, primary: true, onPick: () => onAddHuddleTo(clusterId, b.addTo!.id) }] : []),
                  ...(b.addTo && b.addTo.type !== 'character' ? [] : [{ label: 'Make it a scene', primary: !b.addTo && b.kind === 'scene', onPick: () => onMakeCard(clusterId, 'scene') }]),
                  ...(b.addTo && b.addTo.type === 'character' ? [] : [{ label: 'Make it a character', primary: !b.addTo && b.kind === 'character', onPick: () => onMakeCard(clusterId, 'character') }]),
                  { label: 'Make it a world card', primary: !b.addTo && b.kind === 'world', onPick: () => onMakeCard(clusterId, 'world') },
                  { label: 'Not yet', onPick: () => onNotYet(clusterId) },
                ],
              });
            }
            for (const w of newWorld) {
              review.push({ targetId: w.id, line: 'card', where: worldKindLabel(w.kind), heading: w.title, quote: w.text, note: 'Intent until a scene on the page establishes it.', done: 'Landed' });
            }
            // Cards only (Ben, 2026-10-17): locations and stickies are not
            // walked by the receipt. Stickies are on the board, story stickies
            // keep their own Promote; a location is not a card here at all.
            for (const e of newEnt) {
              if (heldIds.has(e.id) || e.type === 'location') continue;
              const scene = e.type === 'event' || e.type === 'sequence';
              review.push({
                targetId: e.id, line: 'card',
                where: `On the board · ${scene ? 'Scene' : e.type.charAt(0).toUpperCase() + e.type.slice(1)}`,
                heading: cardTitle(e),
                quote: String(e.evidence_quote ?? '').trim(),
                note: scene ? 'A card, not on the master. Drag it to the master board when it is ready to be placed.' : 'Lives here until a scene that uses it is placed.',
                done: 'Landed',
              });
            }
            finish();
            setMsg(null);
            setText('');
            setFocal(null);
            const landedNow = { dumpNo: before.dumps + 1, ids, review };
            const token = auth.token;
            const finishLanding = () => {
              setWaves((w) => (w && w.braindumpId === braindumpId ? null : w));
              setLanded(landedNow);
              void loadDumps(token);
              setPhase('done');
              // The dump is done and on the board: the braindump field closes
              // (Ben, 2026-10-17). It stays open on "nothing new" and on errors,
              // where the writer's text is still in it.
              setDockOpen(false);
            };
            // THE DUMP LANDS IN THE STORY'S FLOW (Ben, 2026-11-03): the
            // template's weave (storyLayout), around what is already there, and
            // streamed one card at a time in reading order: scenes along the
            // thread, then the people beside them, then the notes in the gaps.
            const landedItems = stageItemsFrom({ entities: (payload.entities ?? []).filter((e) => !heldIds.has(e.id)), fragments: payload.fragments ?? [], badges: payload.badges ?? [], precedes: linesOf(payload), world: payload.world ?? [] });
            const fresh = new Set(landedItems.filter((it) => it.kind !== 'token' && !before.board.ids.has(it.id)).map((it) => it.id));
            // The weave is laid again with the new cards (Ben, 2026-11-04):
            // what the board placed before slides to keep story order; what
            // the writer placed stays exactly where it was.
            const byBoard = new Set(landedItems.filter((it) => before.board.saved[`auto#${it.id}`]?.x === 1).map((it) => it.id));
            const relay = new Set([...fresh, ...byBoard]);
            for (const it of landedItems) if (!relay.has(it.id) && it.kind !== 'token' && !before.board.saved[it.id] && before.board.positions[it.id]) onMove(it.id, before.board.positions[it.id]);
            // The weave re-lays from where it FIRST started (sandbox#weave),
            // not from where its cards sit now: once they have stepped round
            // the writer's cards, that is lower than the story's start.
            const weaveAt = before.board.saved.weave?.y;
            const view = stageWrapRef.current;
            const boardW = view?.clientWidth ? view.clientWidth - 40 : 1440;
            const laid = storyLayout({ items: landedItems, fresh: relay, placed: before.board.positions, sceneOrder: chainOrder(landedItems, linesOf(payload)), involves: payload.edges?.involves ?? [], boardW, viewH: view?.clientHeight ? view.clientHeight - 20 : undefined, viewTop: view?.scrollTop ?? 0, origin: byBoard.size ? (weaveAt ?? WEAVE_TOP) : undefined });
            if (weaveAt === undefined && Object.keys(laid.pos).length) onMove('weave', { x: 0, y: laid.origin });
            for (const [id, p] of Object.entries(laid.pos)) {
              const was = before.board.positions[id];
              if (!was || Math.abs(was.x - p.x) > 1 || Math.abs(was.y - p.y) > 1) onMove(id, p);
              if (fresh.has(id)) setPlacedBy(id, true);
            }
            // The cards already there slide now; only the new ones stream in.
            const order = laid.order.filter((id) => fresh.has(id));
            if (!order.length) { finishLanding(); return; }
            // The new block may start under what is there: bring it into view.
            try {
              const wrap = stageWrapRef.current;
              const ys = Object.values(laid.pos).map((q) => q.y);
              const topY = ys.length ? Math.min(...ys) : 0;
              if (wrap && (topY < wrap.scrollTop || topY > wrap.scrollTop + wrap.clientHeight - 160)) wrap.scrollTo({ top: Math.max(0, topY - 60), behavior: 'smooth' });
            } catch { /* the writer scrolls */ }
            // About 3 seconds for the whole landing, a fifth of a second a card at most.
            const beat = Math.max(80, Math.min(220, Math.round(2800 / order.length)));
            setWaves((w) => (w && w.braindumpId === braindumpId ? { ...w, released: 0, shown: new Set(), fly: new Set(order) } : w));
            let k = 0;
            const step = () => {
              k += 1;
              const shownNow = new Set(order.slice(0, k));
              setWaves((w) => (w && w.braindumpId === braindumpId ? { ...w, shown: shownNow } : w));
              waveTimers.current.push(window.setTimeout(k < order.length ? step : finishLanding, k < order.length ? beat : 800));
            };
            waveTimers.current.push(window.setTimeout(step, 60));
            return;
          }
        } else if (doneSeen && ++emptyAfterDone >= 3) {
          // Done, and three reads a beat apart show nothing new: the dump
          // added nothing this board can show. Say so instead of waiting
          // out the 240s.
          setWaves(null);
          setPhase('done');
          setMsg('The read finished and found nothing new to add. Your text is still here.');
          finish();
          return;
        }
      }
      // 240s: the prose prepass may now take two 40s attempts per reader
      // before the main pass (which is itself a minute on a long dump).
      if (Date.now() - startedAt > 240000) {
        setPhase('error');
        setMsg('Nothing landed. The read did not finish or found nothing new; your text is still here, try the dump again.');
        setWaves(null);
        finish();
        return;
      }
      if (!finished) pollRef.current = window.setTimeout(tick, doneSeen ? 1000 : 3000);
    };
    pollRef.current = window.setTimeout(tick, 6000);
  }, [auth, storyId, text, data, refetch, focal, onMakeCard, onAddHuddleTo, onNotYet, loadDumps, loadSameQs, sameItem, onMove, setPlacedBy]);
  // ---- Answering a Peer question (Ben, 2026-10-20) -------------------------
  // Not a dump: the answer is kept on the question, and the answer read
  // places it on the board wherever it belongs (2026-10-21).
  // It is never into a void: the sticky shows the answer at once, a live line
  // follows the reading, then what it added. The receipt stays out until
  // folded; the card's Peer pill keeps it.
  const [peerLive, setPeerLive] = useState<Record<string, string>>({});
  const [peerShown, setPeerShown] = useState<Set<string>>(new Set());
  const setQ = useCallback((id: string, patch: (q: SandboxFragment) => SandboxFragment) => setData((cur) => cur ? { ...cur, peerQuestions: (cur.peerQuestions ?? []).map((q) => (q.id === id ? patch(q) : q)) } : cur), []);
  const onAnswerQuestion = useCallback(async (q: SandboxFragment, _cardId: string, answer: string) => {
    if (!auth || !storyId || !answer.trim()) return;
    const id = q.id;
    setQ(id, (x) => ({ ...x, peer: x.peer ? { ...x.peer, state: 'answering', answer: answer.trim() } : x.peer }));
    setPeerShown((cur) => new Set(cur).add(id));
    setPeerLive((cur) => ({ ...cur, [id]: 'Reading your answer' }));
    let braindumpId = '';
    let done = false;
    let timer = 0;
    const settle = async () => {
      if (done) return;
      done = true;
      stop?.();
      window.clearTimeout(timer);
      try { await refetch(); } catch { /* the board stays as it was */ }
      setPeerLive((cur) => { const n = { ...cur }; delete n[id]; return n; });
    };
    const stop = sessionRef.current?.onMessage((m) => {
      if (m?.projectId && m.projectId !== storyId) return;
      if (m?.type === 'sandbox_peer_answer' && m.questionId === id) {
        if (m.status === 'failed') setNotice(m.error || 'The Peer could not place your answer just now; it is kept on the question.');
        void settle();
        return;
      }
      if (!braindumpId || m?.braindumpId !== braindumpId) return;
      if (m?.type === 'sandbox_dump_progress') { const line = progressLine(m); if (line) setPeerLive((cur) => ({ ...cur, [id]: line })); }
      else if (m?.type === 'braindump_complete') setPeerLive((cur) => ({ ...cur, [id]: 'Placing it' }));
    });
    try {
      const r = await answerPeerQuestion({ projectId: storyId, userId: auth.userId, questionId: id, text: answer.trim() }, auth.token);
      braindumpId = r.braindumpId;
    } catch (e: any) {
      done = true;
      stop?.();
      setQ(id, (x) => ({ ...x, peer: x.peer ? { ...x.peer, state: 'open', answer: undefined } : x.peer }));
      setPeerLive((cur) => { const n = { ...cur }; delete n[id]; return n; });
      setNotice(`The answer was not taken: ${e?.message ?? e}`);
      return;
    }
    // No word in two minutes: read the board anyway.
    if (!done) timer = window.setTimeout(() => { void settle(); }, 120000);
  }, [auth, storyId, refetch, setQ]);
  // Undo an answer: everything it placed comes off the board; the answer
  // stays on the question, and its receipt says it was taken back.
  const [undoBusyId, setUndoBusyId] = useState<string | null>(null);
  const onUndoAnswer = useCallback(async (id: string) => {
    if (!auth || !storyId || undoBusyId) return;
    setUndoBusyId(id);
    try {
      await undoPeerAnswer({ projectId: storyId, userId: auth.userId, questionId: id }, auth.token);
      await refetch();
    } catch (e: any) {
      setNotice(`Could not take it back: ${e?.message ?? e}`);
    } finally {
      setUndoBusyId(null);
    }
  }, [auth, storyId, undoBusyId, refetch]);
  const onFoldQuestion = useCallback((id: string) => setPeerShown((cur) => { const n = new Set(cur); n.delete(id); return n; }), []);
  useEffect(() => () => { if (pollRef.current) window.clearTimeout(pollRef.current); }, []);

  // ---- The walk: centre and light the item the receipt is on --------------
  const onStep = useCallback((item: ReviewItem) => {
    setSpot(item.targetId);
    const wrap = stageWrapRef.current;
    if (!wrap) return;
    // The target element: the item itself, or the group that holds it.
    const holder = items.find((i) => i.id === item.targetId || (i.kind === 'group' && i.members.some((m) => m.id === item.targetId)));
    const el = holder ? wrap.querySelector<HTMLElement>(`[data-stage-item="${CSS.escape(holder.id)}"]`) : null;
    if (!el) return;
    // Centre as far as the board allows, no zoom: the ring does the pointing.
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    wrap.scrollTo({
      left: wrap.scrollLeft + (r.left + r.width / 2) - (w.left + w.width / 2),
      top: wrap.scrollTop + (r.top + r.height / 2) - (w.top + w.height / 2),
      behavior: 'smooth',
    });
  }, [items]);
  // THE PEER RECEIPT'S WALK (Ben, 2026-10-21: "jump to focus on the parent
  // card and the question"): a card opens on its Peer pill with the question
  // ringed; a question on a world entry or loose stickies is centred and
  // ringed on the board.
  // Not into the card (Ben, 2026-10-21: "i dont want it to just pull me into
  // the expanded card"): the board centres on the question beside its card,
  // rings the question and lights the card.
  const onPeerStep = useCallback((item: ReviewItem) => {
    setPeerSpot(item.questionId ?? null);
    setSpot(item.targetId);
    if (focusId) onFocusChange(null);
    window.setTimeout(() => {
      const wrap = stageWrapRef.current;
      const el = item.questionId ? wrap?.querySelector<HTMLElement>(`[data-peer-question="${CSS.escape(item.questionId)}"]`) : null;
      if (!wrap || !el) { onStep(item); return; }
      const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      wrap.scrollTo({ left: wrap.scrollLeft + (r.left + r.width / 2) - (w.left + w.width / 2), top: wrap.scrollTop + (r.top + r.height / 2) - (w.top + w.height / 2), behavior: 'smooth' });
    }, 80);
  }, [focusId, onFocusChange, onStep]);
  const lede = useMemo(() => {
    if (!landed) return '';
    // The receipt walks cards, questions and changes, not stickies or
    // locations (Ben, 2026-10-17), so the lede counts what it walks.
    const cards = landed.review.filter((r) => r.line === 'card').length;
    const asks = landed.review.filter((r) => r.required && !r.done).length;
    if (landed.dumpNo === 0) return asks ? `${asks} ${asks === 1 ? 'question' : 'questions'} still waiting from your last dump` : 'All answered';
    return cards ? `Dump ${landed.dumpNo}: ${cards} ${cards === 1 ? 'card' : 'cards'}` : `Dump ${landed.dumpNo}`;
  }, [landed]);

  const headerExtra = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: dark ? '#9a9aa4' : '#777' }}>
      <span>Sandbox</span>
    </span>
  );

  // The floating toolbar's watch on the board's scroll (see floatOn above).
  // It lifts off once the board is scrolled further than it will grow, so
  // the shifted scroll never lands back at the top and settles it again.
  useEffect(() => {
    const w = stageWrapRef.current;
    if (!w) return;
    const onScroll = () => {
      if (writingId) return;
      if (!floatRef.current) {
        const home = dockRef.current?.getBoundingClientRect();
        const top = w.getBoundingClientRect().top;
        const shift = Math.max(0, Math.round(top - 12));
        if (!home || w.scrollTop <= shift + 24) return;
        floatShift.current = shift;
        pendingScroll.current = w.scrollTop - shift;
        setFloatBox({ left: home.left, width: home.width, height: home.height });
        setFloatMotion({ lift: Math.max(0, Math.round(home.top - 12)), rise: shift, settling: 0 });
        setFloatOn(true);
      } else if (w.scrollTop <= 0) {
        pendingScroll.current = floatShift.current;
        setFloatMotion((m) => ({ ...m, settling: Date.now() }));
        setFloatOn(false);
        setBarHidden(false);
      }
    };
    w.addEventListener('scroll', onScroll, { passive: true });
    return () => w.removeEventListener('scroll', onScroll);
  });
  useLayoutEffect(() => {
    const w = stageWrapRef.current;
    if (!w || pendingScroll.current == null) return;
    w.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
    // Settled again: the board is measured to the window's bottom anew.
    if (!floatOn) setWrapH(Math.max(420, Math.round(window.innerHeight - (w.getBoundingClientRect().top + window.scrollY) - 20)));
  }, [floatOn]);
  // Writing lifts the board over everything: nothing floats then.
  useEffect(() => { if (writingId && floatRef.current) { setFloatOn(false); setBarHidden(false); } }, [writingId]);
  const toTop = () => { pendingScroll.current = 0; setFloatMotion((m) => ({ ...m, settling: Date.now() })); setFloatOn(false); setBarHidden(false); };

  if (error) return <ThemeCtx.Provider value={theme}><Shell storyId={storyId} title={workTitle} headerExtra={headerExtra}><div style={{ color: 'crimson' }}>Error: {error}</div></Shell></ThemeCtx.Provider>;
  if (!data) return <ThemeCtx.Provider value={theme}><Shell storyId={storyId} title={workTitle} headerExtra={headerExtra}><CorkboardLoading /></Shell></ThemeCtx.Provider>;

  return (
    <ThemeCtx.Provider value={theme}>
      <Shell storyId={storyId} title={workTitle} headerExtra={headerExtra} headerRight={
        // Focus sits over the toolbar's right end, above Undo (Ben, 2026-11-04).
        <ToolbarButton
          label="Focus"
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M3 8V5a2 2 0 0 1 2-2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /></svg>}
          onClick={enterFocus}
          paper
          title="The board alone, full screen. Click a card to put its stickies out; double-click for a new sticky. Esc leaves."
        />
      }>
        {/* The toolbar, the master's own strip with only Braindump on it for
            now (Ben, 2026-10-08); the rest gets worked up here. The dump
            hangs under it and the field's top edge is the line under the
            bar, as on the master. */}
        <div ref={dockRef} style={{ marginBottom: 12, ...(floatOn ? { height: floatBox.height } : {}) }}>
          {!(floatOn && barHidden) && (
          <div
            key={floatOn ? 'float' : `flow${floatMotion.settling}`}
            data-sandbox-toolbar={floatOn ? 'floating' : ''}
            style={floatOn
              ? { position: 'fixed', top: 12, left: floatBox.left, width: floatBox.width, zIndex: 140, ['--ff-lift' as any]: `${floatMotion.lift}px`, animation: 'ffBarLift 300ms cubic-bezier(.2,.7,.2,1) both' }
              : floatMotion.settling ? { position: 'relative', zIndex: 140, ['--ff-lift' as any]: `${floatMotion.lift}px`, animation: 'ffBarDrop 300ms cubic-bezier(.2,.7,.2,1) both' } : undefined}
          >
            <style>{'@keyframes ffBarLift{from{transform:translateY(var(--ff-lift))}to{transform:none}}@keyframes ffBarDrop{from{transform:translateY(calc(-1 * var(--ff-lift)))}to{transform:none}}@keyframes ffBoardRise{from{clip-path:inset(var(--ff-rise) 0 0 0 round 10px)}to{clip-path:inset(0 0 0 0 round 10px)}}'}</style>
          <div
            style={{
              position: 'relative', zIndex: 140, padding: '8px 10px',
              background: dark ? '#141417' : '#fff',
              border: dark ? '1px solid #26262b' : '1px solid #ebe8e0',
              borderBottom: dockOpen ? 'none' : (dark ? '1px solid #26262b' : '1px solid #ebe8e0'),
              borderRadius: dockOpen ? '10px 10px 0 0' : 10,
              boxShadow: dockOpen ? '0 0 15px rgba(255,107,53,0.12), 0 0 35px rgba(255,107,53,0.06)' : floatOn ? (dark ? '0 6px 24px rgba(0,0,0,0.55)' : '0 6px 20px rgba(120,90,40,0.14)') : (dark ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(120,90,40,0.07)'),
              transition: 'border-color 200ms ease',
              display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'system-ui, sans-serif',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <ToolbarButton
                label="New"
                icon={<span style={{ fontSize: 15, lineHeight: 1, fontWeight: 600 }}>+</span>}
                onClick={() => setNewOpen((v) => !v)}
                disabled={dumpBusy}
                trailing={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', opacity: 0.75 }}><path d="m6 9 6 6 6-6" /></svg>}
                active={newOpen}
                accent="#515d72"
                prominent
                title={dumpBusy ? 'Waiting for the braindump to land' : 'Make a scene, a character, a sticky or a line of dialogue by hand (or double-click the board for a sticky)'}
              />
              {newOpen && !dumpBusy && (
                <>
                  <div aria-hidden onClick={() => setNewOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 150 }} />
                  <div role="menu" data-new-menu style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 151, minWidth: 180, padding: 4, borderRadius: 9, background: dark ? '#1a1a1e' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e6e0d2'}`, boxShadow: '0 12px 32px rgba(0,0,0,.25)', fontFamily: 'system-ui, sans-serif' }}>
                    {/* One short tip per kind, beside the menu like the strip's set menu (2026-11-05; draft copy). */}
                    {([['scene', 'Scene', '#3b82f6', 'A moment that happens on screen.'], ['character', 'Character', '#d4a24c', 'Someone in your story.'], ['sequence', 'Beat', BEAT_PURPLE, 'A step in your story, bigger than a scene.'], ['subplot', 'Subplot', '#b91c1c', 'Arcs that develop across your story.'], ['sticky', 'Sticky', '#e9bf89', 'A loose note or idea.'], ['dialogue', 'Line of dialogue', '#9cbcf0', 'Something a character says.']] as const).map(([k, label, c, tipText]) => (
                      <button key={k} type="button" role="menuitem" data-new-kind={k} onClick={() => { setNewTip(null); if (k === 'scene' || k === 'character') makeCard(k); else if (k === 'sequence') void makeSequence(); else if (k === 'subplot') void makeSubplot(); else openDraft(k); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', font: 'inherit', fontSize: 13, padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: dark ? '#e6e6ea' : '#1d2230', cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = dark ? '#26262c' : '#f6f2ea'; setNewTip({ text: tipText, top: e.currentTarget.offsetTop }); }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; setNewTip((t) => (t?.text === tipText ? null : t)); }}
                      >
                        <span style={{ width: 9, height: 9, borderRadius: k === 'sticky' ? 1 : 2, background: c, flexShrink: 0 }} />
                        {label}
                      </button>
                    ))}
                    {newTip && (
                      <div data-new-tip role="tooltip" style={{ position: 'absolute', left: 'calc(100% + 8px)', top: newTip.top, width: 'max-content', maxWidth: 240, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, background: dark ? '#26262c' : '#1d2230', color: dark ? '#e8e8ec' : '#fff', fontSize: 12, lineHeight: 1.45, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,.28)', pointerEvents: 'none' }}>
                        {newTip.text}
                      </div>
                    )}
                  </div>
                </>
              )}
            </span>
            <ToolbarButton
              tourId="sbx-braindump"
              label={phase === 'extracting' || phase === 'submitting' ? 'Braindump · running' : 'Braindump'}
              icon={phase === 'extracting' || phase === 'submitting'
                ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ea580c', display: 'inline-block', animation: 'cb-pulse 1.2s ease-in-out infinite' }} />
                : <BraindumpIcon size={15} />}
              onClick={() => setDockOpen((v) => !v)}
              active={dockOpen}
              accent="#db4b13"
              prominent
              title="Dump an idea; it lands on this board as stickies and cards (⌘↵ to process)"
            />
            {/* The master's toolbar (Ben, 2026-10-15): the create group, a
                rule, then the views as quiet paper buttons. */}
            <div style={{ width: 1, height: 20, background: dark ? '#26262b' : '#eeebe5', margin: '0 4px' }} />
            <ToolbarButton
              tourId="sbx-home"
              label="Board" iconOnly
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /></svg>}
              onClick={goHome}
              active={!scenesMode && !charactersMode && !worldMode && !focusId && !writingId}
              paper large
              title="Home: back to the plain board from any view or open card. Closes cards, views, filters and stickies that are out."
            />
            {/* THE SCENES VIEW'S LAYOUTS (Ben, 2026-11-05): the grid, or the
                timeline read left to right with beats as bands. While the view
                is open the switch rides INSIDE the Scenes pill (Ben: "have this
                scenes button wrap the grid timeline options"), one control. */}
            <span data-scenes-toggle style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 8,
              paddingRight: scenesMode ? 4 : 0, background: scenesMode ? (dark ? '#d8d8de' : '#3d3f45') : 'transparent' }}>
              <ToolbarButton
                tourId="sbx-scenes"
                label="Scenes"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><rect x="3" y="4" width="7" height="7" rx="1" /><rect x="14" y="4" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
                onClick={() => { setFocusId(null); setWritingId(null); setCharactersMode(false); setWorldMode(false); setScenesMode((v) => !v); }}
                active={scenesMode}
                paper large
                title="Your scenes and beats in story order. Drag a card to put it in order."
              />
              {scenesMode && (
                <span role="group" aria-label="Scenes layout" data-scenes-layout style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  {(['grid', 'columns', 'timeline'] as const).map((k) => {
                    const on = scenesLayout === k;
                    return (
                      <button key={k} type="button" data-scenes-layout-pick={k} aria-pressed={on} onClick={() => setScenesLayout(k)}
                        title={k === 'grid' ? 'Cards in rows, in story order.' : k === 'columns' ? 'A column per beat, its scenes stacked under it. Drag a beat to move its column.' : 'One track, left to right, beats as bands over their scenes.'}
                        style={{ font: 'inherit', fontFamily: 'system-ui, sans-serif', fontSize: 12, fontWeight: 600, height: 26, padding: '0 10px', borderRadius: 6, cursor: 'pointer', border: 'none',
                          background: on ? (dark ? '#16161a' : '#fff') : 'transparent',
                          color: on ? (dark ? '#e6e6ea' : '#1d2230') : (dark ? 'rgba(22,22,26,.62)' : 'rgba(255,255,255,.7)'),
                          transition: 'background 120ms ease-out, color 120ms ease-out' }}>
                        {k === 'grid' ? 'Grid' : k === 'columns' ? 'Columns' : 'Timeline'}
                      </button>
                    );
                  })}
                </span>
              )}
            </span>
            <ToolbarButton
              tourId="sbx-characters"
              label="Characters"
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><circle cx="12" cy="12" r="2.5" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 7.2 10 10.5M17 7.2 14 10.5M7 16.8 10 13.5M17 16.8 14 13.5" /></svg>}
              onClick={() => { setFocusId(null); setWritingId(null); setScenesMode(false); setWorldMode(false); setCharactersMode((v) => !v); }}
              active={charactersMode}
              paper large
              title="The characters alone: the most connected in the middle, every tie a labelled line. Drag a character to move it, or onto another to tie them; click a label to change it, a card to open it."
            />
            <ToolbarButton
              tourId="sbx-world"
              label="World"
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>}
              onClick={() => { setFocusId(null); setWritingId(null); setScenesMode(false); setCharactersMode(false); setShowStickies(false); setWorldMode((v) => !v); }}
              active={worldMode}
              paper large
              title="The story's world alone, a column per kind: its settings, rules, history, factions. Click one to change it or what kind it is."
            />
            {charactersMode && Object.keys(webSaved).length > 0 && (
              <ToolbarButton
                label="Re-arrange"
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></svg>}
                onClick={onRearrangeWeb}
                paper large
                title="Put the characters back in the automatic layout: the most connected in the middle, the rest in a ring."
              />
            )}
            {hasTemplate && (
              <ToolbarButton
                label={clearArmed ? 'Sure? Clear it' : 'Clear template'}
                icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></svg>}
                onClick={() => { void onClearTemplate(); }}
                active={clearArmed}
                accent={clearArmed ? '#ef4444' : undefined}
                paper large
                title="Remove what is left of the template. Any card you edited is yours and stays."
              />
            )}
            {focal && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 999, border: '1px solid #ff8c42', color: '#ff8c42', fontWeight: 600, fontSize: 11, maxWidth: 320 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>into {focal.title}</span>
                <button type="button" onClick={() => setFocal(null)} title="Dump onto the board instead" style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
              </span>
            )}
            <span style={{ flex: 1 }} />
            {/* Show stickies and Show Peer questions left the toolbar (Ben,
                2026-11-07): a card's stickies and a Peer marker still open
                one at a time. */}
            <ToolbarButton
              label={stripHidden ? 'Show strip' : 'Hide strip'}
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>}
              onClick={() => (stripHidden ? setStripHidden(false) : hideStrip())}
              paper large
              title={stripHidden ? 'Bring back the strip under the toolbar: Custom labels, Sequences, Subplots and any set you made.' : 'Put the strip away for a cleaner board.'}
            />
            <ToolbarButton
              label={dark ? 'Light mode' : 'Dark mode'} iconOnly paper large
              icon={dark ? SunIcon : MoonIcon}
              onClick={toggleTheme}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            />
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <ToolbarButton
                label="Undo" collapsed paper large
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>}
                onClick={runUndo}
                disabled={undoStack.length === 0}
                title={undoStack.length ? `Undo: ${undoStack[undoStack.length - 1].label} (⌘Z)` : 'Nothing to undo'}
              />
              <ToolbarButton
                label="Redo" collapsed paper large
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>}
                onClick={runRedo}
                disabled={redoStack.length === 0}
                title={redoStack.length ? `Redo: ${redoStack[redoStack.length - 1].label} (⇧⌘Z)` : 'Nothing to redo'}
              />
            </span>
            {floatOn && (
              <>
                <div style={{ width: 1, height: 18, background: dark ? '#26262b' : '#eeebe5', margin: '0 2px' }} />
                <ToolbarButton
                  label="Top" paper
                  icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>}
                  onClick={toTop}
                  title="Jump back to the top of the board"
                />
                <ToolbarButton
                  label="Hide" paper large
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>}
                  onClick={() => setBarHidden(true)}
                  title="Hide the toolbar while scrolling; a small tab stays top-right"
                />
              </>
            )}
          </div>
          {/* There unless the writer hid it (its menu is how a set is picked or made). */}
          {/* Put away while the braindump panel is open (Ben, 2026-11-05); back when it closes. */}
          {!stripHidden && !dockOpen && (
            <div style={{ padding: '0 10px 6px', background: dark ? '#141417' : '#fff', border: dark ? '1px solid #26262b' : '1px solid #ece5d7', borderTop: 'none', borderRadius: dockOpen ? 0 : '0 0 10px 10px', marginTop: -1 }}>
              {shownSet === SUBPLOTS_SET ? (
                <SubplotStrip chips={subChips} suggestions={suggChips} dark={dark} openId={stripOpen} landing={landingSeq}
                  onOpen={onStripPill} onNew={() => { void makeSubplot(); }}
                  switcher={<SetSwitcher sets={setChoices} current={shownSet} dark={dark} onPick={setShownPick} onNew={() => { void onNewSet(); }} onRemove={(id) => { void onRemoveSet(id); }} onRename={onRenameSet} />}
                  renderOpen={(c) => c.suggestionId
                    ? <StripCard dashed kicker="Suggested subplot" name={c.name} words={c.description} color={c.color} dark={dark} onClose={() => setStripOpen(null)}
                        actions={<>
                          <button type="button" data-sugg-accept onClick={() => { void onAcceptSuggestion(c.suggestionId!); }} style={{ font: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#16a34a', color: '#fff' }}>Accept</button>
                          <button type="button" data-sugg-dismiss onClick={() => { void onDismissSuggestion(c.suggestionId!); }} style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: dark ? '#e8e8ec' : '#1d2230' }}>Dismiss</button>
                        </>} />
                    : <StripCard kicker={`Subplot · ${scenesWord(c.scenes.length)}`} name={c.name} onName={(t) => onRenameSubplot(c.id, t)} words={subplotPath(c)} color={c.color} dark={dark} onOpenCard={() => { setScenesMode(false); setCharactersMode(false); setWorldMode(false); onFocusChange(c.id); }} onClose={() => setStripOpen(null)}
                        addSlot={(() => {
                          // ADD A SCENE, DIRECT (Ben, 2026-11-07: "this click to add needs to be more
                          // direct and obvious"): the scenes not in it, in story order, and a new one.
                          const inIt = new Set(c.scenes.map((x) => x.id));
                          return <AddPick dark={dark} stayOpen title="Add a scene to this subplot" testAttr="data-strip-add-scene" find="Find a scene" none="No scene by that name."
                            options={scenesInOrder.filter((e) => !inIt.has(e.id)).map((e) => ({ id: e.id, name: cardTitle(e), color: '#3b82f6' }))}
                            onPick={(id) => toggleSubScene(c.id, id, false)}
                            onNew={{ label: 'New scene', run: () => { const id = makeCard('scene'); if (id) toggleSubScene(c.id, id, false); } }}
                            trigger={{ label: '+ Add a scene', style: { font: 'inherit', fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${c.color}`, background: 'transparent', color: dark ? '#e6e6ea' : '#1d2230' } }} />;
                        })()}
                        hint="Click scenes on the board to add or take them out." hintStrong
                        actions={<TrashButton dark={dark} label="subplot" testId="subplot-delete" onConfirm={() => onDeleteSubplot(c.id)} />} />} />
              ) : shownSet === SEQUENCES_SET ? (
                <SequenceStrip chips={seqChips} dark={dark} active={colorFilter} onToggle={toggleFilter} onClear={() => setColorFilter(new Set())}
                  onOpen={onStripPill} onNew={() => { void makeSequence(); }} onReorder={onReorderSequences} landing={landingSeq}
                  openId={stripOpen}
                  renderOpen={(c, n) => <StripCard kicker={`Sequence ${n} · ${scenesWord(c.scenes.length)}`} name={c.name} words={seqWords(c.id)} color={c.color} dark={dark} onOpenCard={() => { setScenesMode(false); setCharactersMode(false); setWorldMode(false); onFocusChange(c.id); }} onClose={() => setStripOpen(null)} />}
                  switcher={<SetSwitcher sets={setChoices} current={shownSet} dark={dark} onPick={setShownPick} onNew={() => { void onNewSet(); }} onRemove={(id) => { void onRemoveSet(id); }} onRename={onRenameSet} />} />
              ) : <ColorLegend set={shown} counts={colorCountsHere} active={colorFilter} dark={dark} onToggle={toggleFilter} onClear={() => setColorFilter(new Set())} onName={onNameColor} onHeading={onHeading}
                switcher={<SetSwitcher sets={setChoices} current={shownSet} dark={dark} onPick={setShownPick} onNew={() => { void onNewSet(); }} onRemove={(id) => { void onRemoveSet(id); }} onRename={onRenameSet} />}
                emptyHint="Color a scene with its dot to start this set"
                scroll openKey={stripOpen} onOpenChip={(c) => setStripOpen((cur) => (cur === c ? null : c))}
                renderOpen={(c) => <StripCard kicker={`${shown.dimension} · ${scenesWord(colorCountsHere.get(c) ?? 0)}`} name={nameOf(shown, c) ?? ''} onName={(t) => onNameColor(c, t)} color={c} dark={dark} onClose={() => setStripOpen(null)} />} />}
            </div>
          )}
          <BraindumpDock
            open={dockOpen}
            text={text}
            setText={setText}
            phase={phase}
            message={msg}
            onSubmit={onSubmit}
            onClose={() => setDockOpen(false)}
            showIntent={false}
          />
          </div>
          )}
        </div>
        {/* The small tab while the floating bar is hidden: back to the top, or the bar back. */}
        {floatOn && barHidden && (
          <div data-sandbox-mini-tab style={{ position: 'fixed', top: 12, right: 24, zIndex: 140, display: 'flex', gap: 6, fontFamily: 'system-ui, sans-serif' }}>
            {([['↑', 'Jump back to the top of the board', toTop], ['☰', 'Show the toolbar', () => setBarHidden(false)]] as const).map(([glyph, title, go]) => (
              <button key={glyph} type="button" onClick={go} title={title}
                style={{ width: 32, height: 32, borderRadius: 16, border: dark ? '1px solid #2a2a30' : '1px solid #ebe8e0', background: dark ? '#1a1a1e' : '#fff', color: dark ? '#c8c8d0' : '#3d4250', fontSize: glyph === '↑' ? 14 : 13, fontWeight: 700, cursor: 'pointer', boxShadow: dark ? '0 4px 14px rgba(0,0,0,0.5)' : '0 4px 14px rgba(120,90,40,0.14)' }}>
                {glyph}
              </button>
            ))}
          </div>
        )}

        {focusMode && <style>{'[data-focus-mode]::-webkit-scrollbar{display:none}'}</style>}
        {focusMode && (
          <div data-focus-exit style={{ position: 'fixed', top: 14, right: 18, zIndex: 300, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'system-ui, sans-serif' }}>
            <span style={{ fontSize: 12, color: dark ? '#6e6e78' : '#a39d90' }}>Double-click anywhere to make a sticky</span>
            <button type="button" onClick={leaveFocus} title="Leave focus mode (Esc)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 8, border: `1px solid ${dark ? '#2a2a30' : '#e1ddd5'}`, background: dark ? '#1a1a1e' : '#fff', color: dark ? '#c8c8d0' : '#3d3f45', font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: dark ? '0 2px 10px rgba(0,0,0,.5)' : '0 2px 10px rgba(120,90,40,.12)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
              Leave focus
            </button>
          </div>
        )}
        <div
          ref={stageWrapRef}
          className="cb-scroll"
          data-focus-mode={focusMode ? '' : undefined}
          style={writingId || focusMode ? {
            // WRITING (Ben, 2026-10-08): somewhat full screen. The same board
            // element lifts to fill the window (no remount, the morph holds);
            // the story name and the toolbar step away behind it; the clean
            // board is the only thing around the pages.
            position: 'fixed', inset: 0, zIndex: 290, overflow: 'hidden', borderRadius: 0, border: 'none',
            background: dark ? '#0a0a0b' : '#fffefb',
            // Focus still scrolls a board bigger than the screen, with no bar.
            ...(focusMode && !writingId ? { overflow: 'auto', scrollbarWidth: 'none' as const } : {}),
          } : {
            position: 'relative', overflow: 'auto',
            border: `1px solid ${dark ? '#232328' : '#f0e8da'}`, borderRadius: 10,
            background: dark ? 'transparent' : 'rgba(255,255,255,.6)',
            height: wrapH ?? 'calc(100vh - 230px)', minHeight: 420,
            // Floating: the board fills the window under the bar.
            ...(floatOn ? { position: 'fixed' as const, top: 12, bottom: 12, left: floatBox.left, width: floatBox.width, height: 'auto', minHeight: 0, zIndex: 100, background: dark ? '#0f0f11' : '#fdfbf7', ['--ff-rise' as any]: `${floatMotion.rise}px`, animation: 'ffBoardRise 320ms cubic-bezier(.2,.7,.2,1) both' } : {}),
          }}
        >
          {/* THE EMPTY BOARD (Ben, 2026-10-15): the master's own empty state,
              without its import for now; by hand it makes what the sandbox
              makes: a character, a scene, a sticky. */}
          {showEmpty && (
            <BoardEmptyState
              onBraindump={() => setDockOpen(true)}
              onCreate={(k) => { const key = String(k); if (key === 'sticky') openDraft('sticky'); else makeCard(key === 'scene' ? 'scene' : 'character'); }}
              starters={[
                { key: 'character', label: 'Character', hint: 'Someone the story is about', color: '#d4a24c' },
                { key: 'scene', label: 'Scene', hint: 'Something that happens', color: '#3b82f6' },
                { key: 'sticky', label: 'Sticky', hint: 'A thought to place later', color: '#e2b65c' },
              ]}
              blurb="Paste an outline, a treatment, a few notes, or just write freely. It lands here as stickies and cards you can move around."
              leftInset={templatesShowing ? TEMPLATES_W - 24 : 0}
            />
          )}
          {templatesShowing && (
            <TemplatesPanel templates={templates} dark={dark} busyId={tplBusy} top={barBottom} only={coachOn && coachStep === 'template' ? TOUR_TEMPLATE_ID : undefined} onPreview={setTplPreview} onUse={(id) => { setTplPreview(null); void onUseTemplate(id); }} onClose={() => { setTplPreview(null); setTplClosed(true); }} />
          )}
          {templatesShowing && tplPreview && templates.find((t) => t.id === tplPreview) && (
            <TemplatePreview template={templates.find((t) => t.id === tplPreview)!} dark={dark} left={TEMPLATES_W + 28} top={barBottom + 20} />
          )}
          <SandboxBoard
            items={boardItems} positions={boardPositions} onMove={onBoardMove} spot={spot} landingIds={waves ? waves.fly : landed?.ids} landingFrom={landingFrom}
            onOpenCard={(id) => setSheetCardId(id)}
            focusId={focusId}
            onFocus={(id) => {
              if (id) {
                // Opening a card fresh decides where closing it returns to.
                if (!focusId) backToWeb.current = charactersMode;
                setCharactersMode(false); setWorldMode(false);
              } else if (backToWeb.current) { backToWeb.current = false; setCharactersMode(true); }
              onFocusChange(id);
            }}
            writingId={writingId}
            scenesMode={scenesMode}
            charactersMode={charactersMode}
            worldMode={worldMode}
            webSaved={webSaved}
            onMoveInWeb={onMoveInWeb}
            showStickies={showStickies}
            openStickies={focusMode ? openStickies : undefined}
            onToggleStickies={focusMode ? (id) => { const it = boardItems.find((x) => x.id === id); if (it && 'attached' in it && it.attached.length) toggleStickies(id); else setFocusId(id); } : undefined}
            peerQuestions={(data.peerQuestions ?? []).filter((q) => ['open', 'answering', 'answered'].includes(q.peer?.state ?? (q.open ? 'open' : '')))}
            peerExpanded={peerExpanded}
            onPeerExpand={() => setPeerExpanded(true)}
            peerFresh={peerFresh}
            onDismissQuestion={onDismissQuestion}
            onSetWorldKind={(id, kind) => { void onSetWorldKind(id, kind); }}
            onUndoAnswer={(id) => { void onUndoAnswer(id); }}
            undoBusyId={undoBusyId}
            onAnswerQuestion={(q, cardId, text) => { void onAnswerQuestion(q, cardId, text); }}
            peerLive={peerLive}
            peerShown={peerShown}
            onFoldQuestion={onFoldQuestion}
            peerReading={peerBusy}
            peerCardNote={peerCardNote}
            peerSpot={peerSpot}
            peerSpotlight={peerSpotlight}
            peerReads={data.peerReads}
            peerAskBusy={peerAskBusy}
            onAskPeer={(id) => { void askPeerCard(id); }}
            hideEmptyHint
            templatesShowing={templatesShowing}
            precedes={data.edges?.precedes ?? []}
            lineLinks={lineLinks}
            onPlaceBeat={onPlaceBeat}
            onInsertBetween={onInsertBetween}
            onMoveInLine={onMoveInLine}
            scenesLayout={scenesLayout}
            onReorderScene={onReorderScene}
            gridOrder={gridOrder}
            onGridOrder={onGridOrder}
            colorFilter={colorFilter}
            labelSet={shown}
            onSetColor={shownSet === SEQUENCES_SET || shownSet === SUBPLOTS_SET ? undefined : onSetColor}
            onToSequence={(id) => { void onToSequence(id); }}
            stripPick={focusId ? undefined : stripPick}
            sceneDots={sceneDots}
            focusExtra={focusExtra}
            scenePlace={scenePlace}
            colorSetId={shownSet}
            paintSetId={paintSet}
            editor={writingId ? <FreeformScript key={writingId} embedded={{ sceneId: writingId, theme, onClose: closeWriting, onOpenCard: (cid) => { closeWriting(); setFocusId(cid); } }} /> : null}
            allEntities={data.entities ?? []}
            edges={data.edges}
            world={data.world ?? []}
            onStickyEdit={onStickyEdit}
            onStickyDelete={onStickyDelete}
            onDumpInto={aimAt}
            stripColorOf={(id) => seqChips.find((c) => c.id === id)?.color ?? subChips.find((c) => c.id === id)?.color}
            aimedCardId={focal?.id ?? null}
            onMakeCard={onMakeCard}
            onAddHuddleTo={onAddHuddleTo}
            onNotYet={onNotYet}
            onPromote={(id, kind, t) => onPromote(id, kind as StoryFactKind, t)}
            onPlaceCard={onPlaceCard}
            onDemoteCard={onDemoteCard}
            onEditDescription={onEditDescription}
            onEditTitle={onEditTitle}
            focusLayout={focusLayout}
            onMoveInFocus={onMoveInFocus}
            onWriteCard={onWriteCard}
            dumps={dumps}
            draft={draft}
            onDraftCommit={onDraftCommit}
            onDraftMove={onDraftMove}
            onStickyResize={onStickyResize}
            onTurnInto={onTurnInto}
            onStickyColor={onStickyColor}
            onDraftCancel={onDraftCancel}
            onRequestSticky={onRequestSticky}
            onAddSticky={onAddSticky}
            onAddLine={onAddLine}
            freshCardId={freshId}
            onDropSticky={onDropSticky}
            onUnpinSticky={onUnpinSticky}
            onGroupSticky={onGroupSticky}
            onUngroupSticky={onUngroupSticky}
            onDeleteCard={onDeleteCard}
            onAddCast={onAddCast}
            onTagSubplot={(arcId, sceneId) => toggleSubScene(arcId, sceneId, false)}
            onUntagSubplot={(arcId, sceneId) => toggleSubScene(arcId, sceneId, true)}
            onSetTransition={setSubTransition}
            onNewSubplotWithScene={(sceneId) => { void subplotFromScene(sceneId); }}
            onNewSceneInSubplot={(arcId) => { const id = makeCard('scene'); if (id) toggleSubScene(arcId, id, false); }}
            subplotOptions={subChips.map((c) => ({ id: c.id, name: c.name || 'Unnamed subplot', color: c.color }))}
            onSetTie={onSetTie}
            onRemoveTie={onRemoveTie}
          />
        </div>

        {/* The card's sheet: the master's own, scoped to this card, with the
            stickies on it as a category. */}
        {sheetCardId && auth && storyId && (() => {
          const w = (data.world ?? []).find((x) => x.id === sheetCardId);
          if (w) return (
            <WorldSheet
              entry={w} entities={data.entities ?? []} fragments={data.fragments ?? []} dark={dark}
              onClose={() => setSheetCardId(null)} onOpenCard={(id) => setSheetCardId(id)}
              onEditText={(t) => { void onEditDescription(w.id, t); }}
              onEditTitle={(t) => { void onEditTitle(w.id, t); }}
              onMakeScene={() => { makeSceneFromWorld({ projectId: storyId, userId: auth.userId, id: w.id }, auth.token).then(() => { setSheetCardId(null); return refetch(); }).catch(() => { refetch().catch(() => {}); }); }}
              onEstablish={(cardId, undo) => { establishWorldEntry({ projectId: storyId, id: w.id, cardId, undo }, auth.token).then(() => refetch()).catch(() => { refetch().catch(() => {}); }); }}
            />
          );
          const e = (data.entities ?? []).find((x) => x.id === sheetCardId);
          if (!e) return null;
          const common = { key: sheetCardId, entity: e, allEntities: data.entities, edges: data.edges, auth, projectId: storyId, onClose: () => setSheetCardId(null), onEntitiesChanged: () => { refetch().catch(() => {}); }, onOpenCard: (id: string) => setSheetCardId(id) };
          const onUpdateDescription = async (d: string) => { await updateCardDescription({ cardId: e.id, projectId: storyId, description: d }, auth.token); await refetch(); };
          if (e.type === 'event') return <EventSheet {...common} signal={{}} information={data.information ?? []} completedResponseIds={noResponses} onChangeNarrativeStatus={(next) => onChangeNarrativeStatus(e.id, next)} fragments={data.fragments ?? []} labelSet={shown} colorSetId={shownSet} paintSetId={paintSet} onSetColor={(c) => onSetColor(e.id, c)} />;
          if (e.type === 'location') return <LocationSheet {...common} />;
          if (e.type === 'relationship') return <RelationshipSheet {...common} onUpdateDescription={onUpdateDescription} />;
          if (e.type === 'sequence') {
            const at = seqChips.findIndex((c) => c.id === e.id);
            return <SequenceSheet {...common} completedResponseIds={noResponses} onUpdateDescription={onUpdateDescription} onToScene={e.state === 'parked' ? () => { void onSequenceToScene(e.id); } : undefined}
              sandbox={at >= 0 ? { color: seqChips[at].color, number: at + 1, palette: LABEL_PALETTE } : undefined} />;
          }
          if (e.type === 'arc') {
            // FIL-711/720: a subplot's full card, from the strip.
            const sub = subChips.find((c) => c.id === e.id);
            const titleOf = (id: string) => { const x = (data.entities ?? []).find((y) => y.id === id); return x ? String((x as any).working_title || (x as any).working_name || 'Unnamed scene') : 'Unnamed scene'; };
            return <ArcSheet {...common} signal={{} as any} completedResponseIds={noResponses}
              onRename={async (t) => { onRenameSubplot(e.id, t); }}
              onUpdateDescription={async (d) => { await updateArc({ arcId: e.id, projectId: storyId, description: d }, auth.token); await refetch(); }}
              sandbox={sub ? { color: sub.color, palette: LABEL_PALETTE, path: sub.scenes.map((x) => ({ id: x.id, title: titleOf(x.id), transition: x.transition })) } : undefined} />;
          }
          if (e.type === 'character') return <CharacterSheet {...common} signal={{}} information={data.information ?? []} precedesEdges={data.edges?.precedes ?? []} completedResponseIds={noResponses} fragments={data.fragments ?? []} world={data.world ?? []} />;
          return null;
        })()}

        {notice && (
          <div role="status" data-notice style={{ position: 'fixed', left: '50%', bottom: undo ? 70 : 22, transform: 'translateX(-50%)', zIndex: 321, maxWidth: 'min(92vw, 560px)', padding: '9px 14px', borderRadius: 10, background: dark ? '#1a1a1e' : '#fffdf7', border: `1px solid ${dark ? '#2e2e35' : '#e3dbcb'}`, boxShadow: '0 14px 40px rgba(0,0,0,.35)', color: dark ? '#e6e6ea' : '#2c2c28', fontFamily: 'system-ui, sans-serif', fontSize: 12.5 }}>{notice}</div>
        )}
        {undo && (
          <div role="status" style={{ position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 320, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'min(92vw, 640px)', padding: '9px 10px 9px 14px', borderRadius: 10, background: dark ? '#1a1a1e' : '#fffdf7', border: `1px solid ${dark ? '#2e2e35' : '#e3dbcb'}`, boxShadow: '0 14px 40px rgba(0,0,0,.35)', color: dark ? '#e6e6ea' : '#2c2c28', fontFamily: 'system-ui, sans-serif', fontSize: 12.5 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{undo.label}</span>
            <button type="button" onClick={runUndo} style={{ font: 'inherit', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 7, border: '1px solid #ff8c42', background: 'transparent', color: '#ff8c42', cursor: 'pointer', whiteSpace: 'nowrap' }}>Undo</button>
            <button type="button" onClick={() => setToast(null)} title="Keep it" aria-label="Keep it" style={{ font: 'inherit', fontSize: 15, lineHeight: 1, border: 'none', background: 'transparent', color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: '0 2px' }}>×</button>
          </div>
        )}
        {landed && landed.review.length > 0 && (
          <SandboxReceipt
            items={landed.review}
            lede={lede}
            onStep={onStep}
            onDone={() => { setLanded(null); setSpot(null); }}
          />
        )}
        {peerReceipt && !landed && (
          <SandboxReceipt
            peer
            items={peerReceipt.items}
            lede={peerReceipt.lede}
            onStep={onPeerStep}
            onDone={() => { setPeerReceipt(null); setSpot(null); setPeerSpot(null); setPeerSpotlight(new Set()); }}
          />
        )}
        {coachOn && (
          <SandboxCoach steps={coachSteps} dark={dark} onStep={setCoachStep} onSkip={() => { markSandboxTourSeen(); tourWaitsTemplate.current = false; setCoachOn(false); }} />
        )}
      </Shell>
    </ThemeCtx.Provider>
  );
}
