// pages/app/freeform-corkboard.tsx
//
// FIL-496 — the real freeform corkboard surface at /freeform/:storyId.
//
// What's wired:
//   - Day 1: list-project-entities from Neptune (real data on real cards)
//   - Day 2: per-user card positions (drag, persisted to CardLayouts Dynamo)
//   - Day 2 closer: click a card → it expands in place; "Ask peer" inside the
//     expanded card spawns a floating PeerCard on the canvas next to it.
//     Full loop: build-slice → enqueue-peer-first-pass → WS-streamed prose.
//
// Not yet:
//   - Event/Location/Relationship-focal Ask peer (slice loader is character-only
//     today; see neptune-reads.mjs).
//   - PRECEDES + structural lines on canvas (§3 throughline).
//   - Real per-type card components (CharacterCard / EventCard / etc., §4) —
//     the expanded card here is a temporary inline render of the raw props.
//   - Respond-to-question flow (CardResponse + cascade).

import React, { useState, useEffect, useMemo, useRef, useCallback, useContext } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import CascadeSummaryPanel from '../../components/Freeform/CascadeSummaryPanel';
import CascadeToast from '../../components/Freeform/CascadeToast';
import RecentUpdatesTray from '../../components/Freeform/RecentUpdatesTray';
import { getEntityColor, hexToRgba } from '../../components/Freeform/entityColors';
import { PEER_BLUE } from '../../components/Freeform/tokens';
import { SupersessionRequiredError, acceptArcSuggestion, createArc, createArcFromEvents, createCard, createInformation, deleteArc, deleteCard, deleteStructuralEdge, dismissArcSuggestion, enqueueCardExtraction, enqueueExtractionJob, getCardLayouts, isMockMode, listArcSuggestions, listCardQuestions, listProjectEntities, promoteStructuralToRelationship, resolveNarrativeStatusFlip, restoreArc, restoreCard, setStructuralEdge, slugForCard, tagCauses, tagEventEvokes, tagEventInvolvesCharacter, tagEventPrecedes, tagSequenceContains, untagCauses, untagEventPrecedes, updateArc, updateCardDescription, updateCardName, updateCardNarrativeStatus, updateCardPosition, type ArcKind, type ArcSuggestion, type CardLayout, type EvokesTransition, type ListProjectEntitiesResponse, type NarrativeStatus, type PersistedQuestion, type ProjectEntity, type SupersessionRequiredResponse } from '../../lib/freeformApi';
import { useCascadeEvents } from '../../lib/useCascadeEvents';
import { fetchAuthSession } from 'aws-amplify/auth';
import axios from 'axios';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { UserContext } from '../../App';
import { CardBox, EditableDescription, EditableName } from '../../components/Freeform/corkboard/cards';
import { ARC_THREAD_PALETTE, ConnectorLayer, buildArcThread, computeAutoLayout, computePeerPosition, topoSortEventsByPrecedes, type ThreadRect } from '../../components/Freeform/corkboard/connectors';
import { ARC_BALL_H, ARC_BALL_W, ARC_DOT, BALL_DISPLACE_GAP, BALL_H, BALL_ID_ARCS, BALL_ID_BACKSTORY, BALL_ID_CHARACTERS, BALL_RAIL_PAD, BALL_ROW_GAP, BALL_STACK_GAP, BALL_TRANSITION_MS, BALL_W, CANVAS_PAD, CHAR_PILL_H, CHAR_PILL_W, CLUSTER_META, CLUSTER_ORDER, COL_GAP, COLLAPSED_H, COLLAPSED_W, DRAG_THRESHOLD_PX, EXPANDED_W, PEER_CARD_W, PEER_GAP, EVENT_CARD_W, REL_COLLAPSED_H, REL_COLLAPSED_W, ROW_GAP, collapsedSizeOf, type Pos } from '../../components/Freeform/corkboard/constants';
import { CreateArcFromEventsModal, CreateCardModal, ResetProjectButton, SupersessionModal, type CreateModalKind } from '../../components/Freeform/corkboard/modals';
import { INFO_ACCENT, RightPanel, TrashOverlay } from '../../components/Freeform/corkboard/panels';
import { FloatingPeerCard, QuestionComposer, notifyResponseExtracted, setPeerWriteActive } from '../../components/Freeform/corkboard/peer';
import { ArcSheet, CharacterSheet, EventSheet, LocationSheet, RelationshipSheet, SequenceSheet } from '../../components/Freeform/corkboard/sheets';
import { BraindumpMeter, CorkboardLoading, Shell } from '../../components/Freeform/corkboard/shell';
import type { WinPhase } from '../../components/Freeform/corkboard/shell';
import { computeCardSignals } from '../../components/Freeform/corkboard/signals';
import { MoonIcon, SunIcon, THEME_STORE_KEY, ThemeCtx, type ThemeMode } from '../../components/Freeform/corkboard/theme';
import { BallChip, BraindumpDock, ToolbarButton } from '../../components/Freeform/corkboard/toolbar';
import WowFlow from '../../components/Freeform/corkboard/WowFlow';
import { markWowSeen } from '../../components/Freeform/corkboard/wowShared';

// Total edge count across the edge buckets that a braindump produces — the
// "graph assembled" signal (used as a lost-WS belt to flip a braindump to done
// when its edges land even if the braindump_complete WS was missed).
const edgeCountOf = (d: ListProjectEntitiesResponse | null): number =>
  (d?.edges?.precedes?.length ?? 0) +
  (d?.edges?.involves?.length ?? 0) +
  (d?.edges?.occurs_in?.length ?? 0) +
  (d?.edges?.contains?.length ?? 0) +
  (d?.edges?.knowledge?.length ?? 0);

// Outline of a throughline-grid sequence region: vertically stacked row spans
// (y-contiguous within a run) traced down the right side and back up the left,
// text-selection style, so wrapped member rows fuse into one shape.
function gridRegionPath(spans: Array<{ x0: number; y0: number; x1: number; y1: number }>): string {
  if (spans.length === 0) return '';
  const p: string[] = [`M ${spans[0].x0} ${spans[0].y0}`, `L ${spans[0].x1} ${spans[0].y0}`];
  for (let i = 0; i < spans.length - 1; i++) {
    p.push(`L ${spans[i].x1} ${spans[i].y1}`, `L ${spans[i + 1].x1} ${spans[i + 1].y0}`);
  }
  const last = spans[spans.length - 1];
  p.push(`L ${last.x1} ${last.y1}`, `L ${last.x0} ${last.y1}`);
  for (let i = spans.length - 1; i > 0; i--) {
    p.push(`L ${spans[i].x0} ${spans[i].y0}`, `L ${spans[i - 1].x0} ${spans[i - 1].y1}`);
  }
  return `${p.join(' ')} Z`;
}

export default function FreeformCorkboard() {
  const { storyId } = useParams<{ storyId: string }>();
  const routerLocation = useLocation();
  const routerNavigate = useNavigate();
  // The app-level user record — works[storyId] carries the story's title +
  // workflow tag (the corkboard's graph data lives in the freeform backend).
  const { user: appUser, setUser } = useContext(UserContext);
  const workTitle: string | undefined = storyId ? appUser?.works?.[storyId]?.title : undefined;

  // Guard: a non-demo storyId that isn't one of the user's works → back to the
  // dashboard (only once works have loaded; undefined means still fetching).
  // justCreated (set by the dashboard's create flow) skips the guard — the
  // async work-record create may not have landed in user.works yet.
  const arrivedJustCreated = !!(routerLocation.state as { justCreated?: boolean } | null)?.justCreated;
  // FIL-506 wow: first-sign-in lands the user on a per-user wow sandbox project
  // (`wow_<sub>`) that isn't in their works grid. Skip the unknown-story guard
  // for it (like demo_*), and arriving with { wow:true } also bypasses.
  const arrivedWow = !!(routerLocation.state as { wow?: boolean } | null)?.wow;
  const isWow = arrivedWow || !!storyId?.startsWith('wow_');
  useEffect(() => {
    if (!storyId || storyId.startsWith('demo_') || storyId.startsWith('wow_') || arrivedJustCreated || arrivedWow) return;
    if (appUser?.works && !appUser.works[storyId]) {
      routerNavigate('/dashboard');
    }
  }, [storyId, appUser, routerNavigate, arrivedJustCreated, arrivedWow]);

  // FIL-506 wow: arriving on a wow project (or with { wow:true }) runs the flow;
  // wowDone stops it for this mount, and completeWow marks it seen so the
  // dashboard onboarding won't re-trigger on later visits. Re-test by reopening
  // a wow project (or clearing site data to re-arm the dashboard pickup).
  const [wowDone, setWowDone] = useState(false);
  const wowActive = isWow && !wowDone;
  const completeWow = useCallback(() => {
    markWowSeen();
    setWowDone(true);
  }, []);

  const [auth, setAuth] = useState<{ userId: string; token: string } | null>(null);
  const [data, setData] = useState<ListProjectEntitiesResponse | null>(null);
  const [layouts, setLayouts] = useState<Record<string, CardLayout>>({});
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  // In-board zoom via the CSS `zoom` property on the canvas — scales the whole
  // board (cards, connectors, containers) while normal page scroll still pans, so
  // a feature-length import is legible without leaving the app. The drag / link /
  // new-card coordinate math divides client offsets by this (a point N screen px
  // from the canvas origin is N/zoom board px); zoomRef mirrors it so the
  // window-level mousemove handlers read the current value without re-binding.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which card is expanded (showing full content). Click-to-expand.
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // Hovered character node — demoted structural ties light up (with labels)
  // while the pointer rests on one of their endpoints. Characters only, so the
  // board isn't re-rendering on every card hover.
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  // Wow-tour relationship beat: force ONE structural tie to full weight while
  // its coachmark spotlights it (demoted ties are invisible at rest). Set on
  // step enter, cleared on exit / tour end.
  const [wowTie, setWowTie] = useState<{ from: string; to: string } | null>(null);
  // Which card has a peer popup open on the canvas. Set by Ask peer button.
  // Independent of expandedCardId so the peer survives card collapse if needed.
  const [peerForCardId, setPeerForCardId] = useState<string | null>(null);
  // Measured height of the expanded card — used to size the canvas so the
  // expanded card doesn't get clipped by overflow:hidden. Content height
  // varies (open_dimensions, sub_events, traits), so we measure rather than
  // estimate.
  const [expandedCardH, setExpandedCardH] = useState<number>(0);

  // Braindump header state.
  const [braindumpText, setBraindumpText] = useState('');
  const [braindumpPhase, setBraindumpPhase] = useState<'idle' | 'submitting' | 'extracting' | 'done' | 'error'>('idle');
  const [braindumpMsg, setBraindumpMsg] = useState<string | null>(null);
  // Braindump lives in a toolbar slide-out now (BraindumpDock), not a
  // permanently-open header box. Extraction keeps running while closed.
  const [braindumpOpen, setBraindumpOpen] = useState(false);
  // Field focus — the toolbar's orange underside brightens in sync.
  const [braindumpFocused, setBraindumpFocused] = useState(false);

  // Dashboard hero seeding: arriving from "create corkboard story" with
  // brainstorm text in navigation state opens the dock prefilled — one
  // keystroke (⌘↵) from the first extraction. Runs once per mount.
  const braindumpSeededRef = useRef(false);
  useEffect(() => {
    const seed = (routerLocation.state as { braindump?: string } | null)?.braindump;
    if (seed && !braindumpSeededRef.current) {
      braindumpSeededRef.current = true;
      setBraindumpText(seed);
      setBraindumpOpen(true);
      // Nothing is submitted automatically — the writer edits/adds freely and
      // chooses when to extract.
      setBraindumpMsg('Brought your brainstorm over. Edit or add to it, then hit Process when ready.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inflightBraindumpRef = useRef<string | null>(null);
  // True while a LARGE screenplay import is running the windowed extraction path
  // (multi-minute, writes window-by-window). It disables the fast give-up timers
  // and the edge-count belt — which would otherwise resolve the moment window 1's
  // edges land, dropping the tracker and shimmer long before the run is done.
  // Only braindump_complete (or a long safety backstop) resolves a windowed run;
  // braindump_progress keeps it alive and refetches per window.
  const windowedRunRef = useRef(false);
  // Interval poll id for the windowed path — WS can't be trusted over a multi-
  // minute run (the socket dies; braindump_complete comes back sent:0), so we
  // refetch on a timer so the board builds regardless of WS delivery.
  const windowedPollRef = useRef<number | null>(null);
  // Windowed-import meter phase (reading → structuring → processing → wiring),
  // plus the per-window progress + a live elapsed clock. Driven by the backend
  // phase pings when the socket delivers, and by an elapsed/poll estimate when it
  // doesn't — so the meter names the real step instead of going quiet mid-run.
  const [winPhase, setWinPhase] = useState<WinPhase | null>(null);
  const [winProg, setWinProg] = useState<{ window?: number; total?: number }>({});
  const [winElapsed, setWinElapsed] = useState(0);
  const winPhaseRef = useRef<WinPhase | null>(null);
  const windowedStartRef = useRef(0);
  const winLastAliveRef = useRef(0);
  const winLastGrowthRef = useRef(0);
  const WIN_PHASE_ORDER: Record<WinPhase, number> = { reading: 0, structuring: 1, processing: 2, wiring: 3 };
  // Advance the windowed phase MONOTONICALLY — a late/duplicate signal (WS ping
  // arriving after the elapsed estimate already moved on) can never rewind it.
  const bumpWinPhase = useCallback((p: WinPhase) => {
    const cur = winPhaseRef.current;
    if (cur && WIN_PHASE_ORDER[p] <= WIN_PHASE_ORDER[cur]) return;
    winPhaseRef.current = p;
    setWinPhase(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resetWinMeter = useCallback(() => {
    winPhaseRef.current = null;
    setWinPhase(null);
    setWinProg({});
    setWinElapsed(0);
  }, []);
  // Edge count at braindump submit — the baseline for detecting "the graph
  // assembled" (edges landed) even if the braindump_complete WS is lost, so the
  // reveal tracker / shimmer / peer gate clear promptly instead of waiting 45s.
  const edgeCountAtSubmitRef = useRef(0);
  // Alive-card count at submit — the meter shows THIS braindump's delta, not the
  // whole board (so an incremental dump reads "Pulled 3 cards", not "Pulled 30").
  const cardCountAtSubmitRef = useRef(0);
  // One-shot: after a WINDOWED import resolves, re-apply the full auto-layout to
  // ALL cards once edges land. A re-import keeps already-seen entities at their
  // old (scattered) positions, so the new sequence containers would otherwise
  // wrap stale member spots instead of stacking. Consumed by the relayout effect.
  const relayoutWindowedRef = useRef(false);
  const dataRef = useRef<ListProjectEntitiesResponse | null>(null);
  // One-shot flag: arm the FIL-515 dock auto-collapse only on a real extraction
  // completion, so manually re-opening the empty dock later doesn't auto-close.
  const dockAutoCloseRef = useRef(false);
  // Streamed card ids awaiting a PRECEDES-order re-stack once the edge refetch
  // lands (set on braindump_complete; consumed by the relayout effect).
  const relayoutAfterStreamRef = useRef<string[] | null>(null);
  // Ids of entities streamed in (dev streaming) but not yet persisted to
  // Neptune. A refetch that races the write must NOT wipe these optimistic
  // cards (otherwise they vanish then pop back in). Cleared on braindump_complete.
  const streamedIdsRef = useRef<Set<string>>(new Set());

  // Manual card creation (§7). Toolbar dropdown opens a small modal with
  // working_name + description. Pre-flight collision check against current
  // entities to catch slug clashes without a server round-trip; server-side
  // 409 is a backstop for race conditions. Collision against a soft-deleted
  // vertex (§9) routes to "Restore?" instead of "Open it?".
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  // D'-5 — modal kind widened to include 'arc' for the FE side; backend
  // wrapper still distinguishes (createArc vs createCard) inside onSubmitCreate.
  const [createKind, setCreateKind] = useState<CreateModalKind | null>(null);
  // ArcKind selector state when createKind === 'arc'.
  const [createArcKind, setCreateArcKind] = useState<ArcKind>('audience_question');
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createCollision, setCreateCollision] = useState<{ cardId: string; name: string; deleted: boolean } | null>(null);
  // "Follows" picker for Event creation — vertex id of the event the new
  // event should be PRECEDED_BY. Empty string = unconnected. Defaulted
  // heuristically when the modal opens for kind='event' (tail of the
  // longest on_screen PRECEDES chain).
  const [createPrecededBy, setCreatePrecededBy] = useState<string>('');

  // Trash overlay (§9). Lists soft-deleted entities; click → restoreCard.
  const [trashOpen, setTrashOpen] = useState(false);

  // cascade_complete tracking — set of cardResponseIds whose extraction has
  // landed. FloatingPeerCard's QuestionComposer watches this to flip its
  // status from 'submitted' → 'extracted'.
  const [completedResponseIds, setCompletedResponseIds] = useState<Set<string>>(new Set());
  // Count of peer-response submissions (fires immediately on submit, before the
  // cascade lands). Drives the wow's "answered → continue" beat.
  const [submissionCount, setSubmissionCount] = useState(0);
  // In-flight peer-answer cascades (submit ++, cascade_complete --). Drives the
  // top "working in the background" toast so an answer that's still extracting
  // reads as active work, not a stuck "extracting".
  const [pendingCascades, setPendingCascades] = useState(0);
  // Watchdog: if cascades stay pending with no change for 90s (a lost
  // cascade_complete WS), force-clear so the toast can't hang forever.
  useEffect(() => {
    if (pendingCascades <= 0) return;
    const t = window.setTimeout(() => setPendingCascades(0), 90000);
    return () => window.clearTimeout(t);
  }, [pendingCascades]);

  // Per-card persisted-questions cache, populated lazily when a card expands.
  // Powers the "Working sections" counts on the Character expanded body
  // (open / answered / stashed) without forcing a refetch every render.
  const [cardQuestionsCache, setCardQuestionsCache] = useState<Record<string, PersistedQuestion[]>>({});

  // Which card is open in the level-3 character sheet overlay.
  const [sheetCardId, setSheetCardId] = useState<string | null>(null);

  // Focus mode anchoring — board-native (not an overlay). When peer opens,
  // the focal card glides to CANVAS coords centered in the currently-visible
  // board region, the peer card lands beside it, and cards intersecting the
  // pair's footprint are temporarily displaced sideways to make room (same
  // transient-offset pattern as the ball clusters). Computed once per open —
  // the pair then lives on the board and scrolls with it. Null when closed.
  const [peerFocusPos, setPeerFocusPos] = useState<Pos | null>(null);
  // Brief flag after the peer closes so the focal + displaced cards GLIDE
  // back to their stored spots instead of snapping (keeps left/top
  // transitions on through the return animation).
  const [focusExiting, setFocusExiting] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Sticky toolbar — position:sticky is defeated by an overflow ancestor in the
  // app shell, so we do it manually: the bar lives in a fixed-height wrapper
  // (toolbarHomeRef) and snaps to position:fixed at the viewport top once the
  // wrapper scrolls past. The pinned category balls hang below its bottom edge.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarHomeRef = useRef<HTMLDivElement | null>(null);
  const [toolbarStuck, setToolbarStuck] = useState(false);
  const [toolbarBox, setToolbarBox] = useState<{ left: number; width: number; height: number }>(
    { left: 0, width: 0, height: 46 },
  );
  // Writer chose to hide the floating bar while scrolling — only suppresses
  // the STUCK (fixed) bar; scrolling back to top always reveals the in-flow
  // bar again. A small top-right tab re-shows it / jumps to top meanwhile.
  const [toolbarHidden, setToolbarHidden] = useState(false);

  // Focused canvas views — transient layout PROJECTIONS over the same graph
  // (stored positions are never written; drags inside a view are transient via
  // the webDrag path and reset on switch):
  //   master      — the free-form board (stored positions, balls active)
  //   characters  — characters splayed on a ring so relationships read clearly;
  //                 events/arcs hidden
  //   throughline — events stacked in PRECEDES order with generous spacing so
  //                 the arc threads have room; characters/relationships hidden
  const [viewMode, setViewMode] = useState<'master' | 'characters' | 'throughline'>('master');
  // Throughline sub-layout: the single vertical column (spine + arc threads) or
  // the writers-room GRID wall (notecards in reading order wrapping into rows;
  // no arrows, the SC numbers carry the order). Persisted per browser.
  const [throughlineLayout, setThroughlineLayout] = useState<'column' | 'grid'>(() => {
    try {
      return localStorage.getItem('ff-throughline-layout') === 'grid' ? 'grid' : 'column';
    } catch {
      return 'column';
    }
  });
  const switchThroughlineLayout = useCallback((m: 'column' | 'grid') => {
    setThroughlineLayout(m);
    // In-view drags are transient projections of THIS layout; a card dragged in
    // the column would otherwise pin to that spot in the grid.
    setWebDrag({});
    try { localStorage.setItem('ff-throughline-layout', m); } catch { /* ignore */ }
  }, []);
  // Toolbar toggle: hide sequence containers/cards so the board shows just the
  // event scenes (member scenes stay visible; sequence connectors drop too).
  const [hideSequences, setHideSequences] = useState(false);
  const switchView = useCallback((v: 'master' | 'characters' | 'throughline') => {
    setViewMode(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Theme — dark by default (the site's language); persisted per browser.
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORE_KEY);
      return stored === 'light' || stored === 'dark' ? stored : 'dark';
    } catch {
      return 'dark';
    }
  });
  const dark = theme === 'dark';
  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_STORE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Per-cluster expand state, keyed by ball id → the canvas-Y the deal-out is
  // anchored at (captured when the writer expands, so the dealt cards sit in the
  // view at that moment and DON'T re-flow every scroll frame). A key present =
  // expanded; absent = collapsed (members bunched in the ball). In-memory only.
  const [ballExpanded, setBallExpanded] = useState<Record<string, number>>({});
  // Sequence containers: a sequence that CONTAINS scenes renders as a container
  // box with its member scenes nested inside. Expanded by default (Ben's call);
  // this maps a sequence id → true when the writer collapses it. In-memory only.
  const [sequenceCollapsed, setSequenceCollapsed] = useState<Record<string, boolean>>({});
  // Which sequence container's header is hovered (reveals the slide-out header).
  const [hoveredSeqId, setHoveredSeqId] = useState<string | null>(null);
  // Close-delay so moving the cursor from the label to the pop-up header doesn't
  // dismiss it mid-transit (the classic hover-gap problem).
  const seqHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterSeqHover = useCallback((id: string) => {
    if (seqHoverTimer.current) { clearTimeout(seqHoverTimer.current); seqHoverTimer.current = null; }
    setHoveredSeqId(id);
  }, []);
  const leaveSeqHover = useCallback((id: string) => {
    if (seqHoverTimer.current) clearTimeout(seqHoverTimer.current);
    seqHoverTimer.current = setTimeout(() => setHoveredSeqId((c) => (c === id ? null : c)), 220);
  }, []);

  // Transient drag positions for cards that have been DEALT OUT of a ball. The
  // writer can drag a dealt card around; the position feeds back into the ball
  // override (so edges/relationships follow) but is NOT persisted and is reset
  // when the card re-bunches (pruned below once it leaves the overrides).
  const [webDrag, setWebDrag] = useState<Record<string, Pos>>({});
  // Drag state — declared up here (above the ballEffects + arc-ball memos, which
  // read them: ballEffects exempts the actively-dragged loose card from the
  // container nudge; the arc-ball memo goes compact while dragging). Refs below.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSeqId, setDraggingSeqId] = useState<string | null>(null);

  // -------- Cascade events (toast + tray + summary panel) --------

  const resolveCardLabel = useCallback(
    (cardId: string) => {
      const e = data?.entities.find((x) => x.id === cardId);
      return e?.working_name ?? e?.working_title ?? cardId;
    },
    [data],
  );
  const cascadeState = useCascadeEvents({
    userId: auth?.userId ?? '',
    projectId: storyId ?? '',
    storyId,
    resolveCardLabel,
    disabled: !auth || !storyId,
  });

  // D'-9 — bootstrap fetch of pending arc suggestions so suggestions
  // emitted while the writer was offline still surface as toasts/tray
  // entries when they come back.
  useEffect(() => {
    if (!auth || !storyId) return;
    let cancelled = false;
    listArcSuggestions({ projectId: storyId }, auth.token)
      .then((res) => {
        if (cancelled) return;
        setArcSuggestions(res.suggestions ?? []);
      })
      .catch((err) => {
        console.warn('[corkboard] list-arc-suggestions failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, storyId]);

  // Re-pull arc suggestions on demand. The windowed-import poll calls this so the
  // Panel populates (the worker writes suggestions AFTER the graph lands, and the
  // `arc_suggestion` WS that would push them dies on a long run), and so the
  // completion check can see them still arriving and keep waiting.
  // Current suggestion count, mirrored to a ref for the windowed poll's stability
  // signature (reads without re-binding the interval). Updated on every refetch.
  const arcSuggestionCountRef = useRef(0);
  const refreshArcSuggestions = useCallback(async () => {
    if (!auth || !storyId) return;
    try {
      const res = await listArcSuggestions({ projectId: storyId }, auth.token);
      const sugs = res.suggestions ?? [];
      arcSuggestionCountRef.current = sugs.length;
      setArcSuggestions(sugs);
    } catch (err) {
      console.warn('[corkboard] refresh-arc-suggestions failed:', err);
    }
  }, [auth, storyId]);
  const refreshArcSuggestionsRef = useRef(refreshArcSuggestions);
  useEffect(() => { refreshArcSuggestionsRef.current = refreshArcSuggestions; }, [refreshArcSuggestions]);

  // -------- Auth + data load --------

  // Refresh just the entities (positions/layouts unaffected). Called after
  // braindump extraction lands new cards, after cascade extraction, and via
  // the manual refresh button. Re-fetches the auth token via fetchAuthSession
  // so a stale captured token (Cognito IDs expire after ~1hr) doesn't silently
  // 401 the request.
  const refreshEntities = useCallback(async () => {
    if (!auth || !storyId) return;
    try {
      const session = await fetchAuthSession();
      const freshToken = session.tokens?.idToken?.toString() ?? auth.token;
      const entitiesRes = await listProjectEntities({ projectId: storyId }, freshToken);
      setData((prev) => {
        // While a braindump is mid-flight, a poll can race the Neptune write —
        // and under NCU contention that write can take 45s+, so a fallback poll
        // easily reads a PARTIAL graph (only the first-written vertices, i.e. the
        // characters). NEVER drop a card already on the board during an inflight
        // braindump: additively merge so streamed cards AND non-streamed
        // sequences (which never arrive via entity_streamed) survive a partial
        // refetch. The authoritative braindump_complete refetch — which clears
        // inflight FIRST — is the only one allowed to reconcile/remove.
        if (!prev || !inflightBraindumpRef.current) return entitiesRes;
        const got = new Set(entitiesRes.entities.map((e) => e.id));
        const keep = prev.entities.filter((e) => !e.deleted_at && !got.has(e.id));
        return keep.length ? { ...entitiesRes, entities: [...entitiesRes.entities, ...keep] } : entitiesRes;
      });
      if (freshToken !== auth.token) {
        setAuth((cur) => (cur ? { ...cur, token: freshToken } : cur));
      }
      console.info('[corkboard] refreshed entities — count:', entitiesRes.entities.length);
    } catch (e) {
      console.warn('[corkboard] refresh failed:', e);
    }
  }, [auth, storyId]);

  useEffect(() => {
    if (!storyId) {
      setError('No storyId in URL');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const userId = String(session.tokens?.idToken?.payload?.['cognito:username'] ?? '');
        if (!userId || !token) throw new Error('Not authenticated');
        if (cancelled) return;
        setAuth({ userId, token });

        // Neptune Serverless can reject the first cold list-project-entities
        // with a memory-limit 500 before it scales off the NCU floor; the same
        // read succeeds seconds later once the cluster warms. Auto-retry with a
        // short backoff so the writer never sees the transient (the backend's
        // own retry window is too short to ride out the scale-up). Reads are
        // idempotent, so re-running the whole load is safe.
        const loadOnce = () =>
          Promise.all([
            listProjectEntities({ projectId: storyId }, token),
            getCardLayouts({ userId, projectId: storyId }, token),
          ]);
        const RETRY_DELAYS = [1800, 4000];
        let entitiesRes: Awaited<ReturnType<typeof listProjectEntities>>;
        let layoutsRes: Awaited<ReturnType<typeof getCardLayouts>>;
        for (let attempt = 0; ; attempt++) {
          try {
            [entitiesRes, layoutsRes] = await loadOnce();
            break;
          } catch (loadErr) {
            if (attempt >= RETRY_DELAYS.length) throw loadErr;
            console.warn(`[corkboard] load attempt ${attempt + 1} failed, retrying`, loadErr);
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            if (cancelled) return;
          }
        }
        if (cancelled) return;

        const layoutMap: Record<string, CardLayout> = {};
        for (const l of layoutsRes.layouts) layoutMap[l.cardId] = l;
        setData(entitiesRes);
        setLayouts(layoutMap);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storyId]);

  // -------- Compute initial positions (stored layouts + auto-defaults) --------

  // §9 soft-delete split: alive entities render on the canvas; deleted ones
  // populate the Trash overlay. data.entities is the union (project-reads
  // returns both since the FE renders both surfaces from one read).
  const aliveEntities = useMemo(
    () => data?.entities.filter((e) => !e.deleted_at) ?? [],
    [data],
  );
  const deletedEntities = useMemo(
    () =>
      (data?.entities.filter((e) => !!e.deleted_at) ?? []).sort(
        (a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)),
      ),
    [data],
  );
  // Cards stream in during extraction but their edges/metadata land on the final
  // refetch — pulse the cards while that's still happening so the board reads as
  // "still wiring up" rather than finished-but-bare.
  const edgesGenerating = braindumpPhase === 'submitting' || braindumpPhase === 'extracting';
  // The staged braindump meter (draggable) covers ALL braindumps; the top toast
  // is now just for peer-answer cascades still being woven in.
  const bgProcessing = pendingCascades > 0;
  const bgProcessingLabel = 'Working your answer into the outline…';
  // Keep the peer's write gate in sync: while a braindump's extraction + graph
  // write is in flight, the peer holds its slice build (asking now would read a
  // half-written graph). Cleared the moment the braindump settles.
  useEffect(() => {
    setPeerWriteActive(edgesGenerating);
    return () => setPeerWriteActive(false);
  }, [edgesGenerating]);
  // Mirror data into a ref so the submit callback can baseline the edge count
  // without re-creating on every data change.
  useEffect(() => { dataRef.current = data; }, [data]);
  // Windowed-meter heartbeat: a 1s ticker while a windowed import runs. It keeps
  // the elapsed clock live AND advances the phase from elapsed + card growth when
  // the WS phase pings don't arrive (the socket dies on a multi-minute run). All
  // advances are monotonic via bumpWinPhase, so a WS ping and this estimate never
  // fight. Thresholds are deliberately loose — split+segment is quick, the global
  // pass is a beat, then fills dominate for minutes with no cards until the write
  // burst, and the spine (wiring) lands right at the tail after growth settles.
  useEffect(() => {
    if (!(braindumpPhase === 'extracting' && windowedRunRef.current)) return;
    const iv = window.setInterval(() => {
      const el = Date.now() - windowedStartRef.current;
      setWinElapsed(el);
      if (el > 8000) bumpWinPhase('structuring');
      if (el > 24000) bumpWinPhase('processing');
      const alive = (dataRef.current?.entities ?? []).filter((e) => !e.deleted_at).length;
      if (alive > cardCountAtSubmitRef.current) {
        if (alive !== winLastAliveRef.current) {
          winLastAliveRef.current = alive;
          winLastGrowthRef.current = Date.now();
        } else if (Date.now() - winLastGrowthRef.current > 10000) {
          // Cards have landed and stopped growing ⇒ the writes are done and the
          // global PRECEDES spine is being stitched. That's the wiring step.
          bumpWinPhase('wiring');
        }
      }
    }, 1000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [braindumpPhase]);
  // Lost-WS belt: while a braindump is in flight, resolve locally once the
  // edge-bearing graph has landed AND SETTLED — edges past the submit baseline,
  // unchanged across two observations at least 4s apart. First-new-edge was the
  // old trigger, and it fired on MID-WRITE partial reads (the batched write +
  // the worker's arc/evokes/causes tail spread the landing over seconds now):
  // the tracker dropped early, polls died with it, and the wow walkthrough
  // built itself from a graph still missing its relationships. The steady
  // while-inflight poll (in runBraindumpExtraction) feeds this the consecutive
  // reads it needs. braindump_complete (WS alive) still resolves instantly.
  const beltStableRef = useRef<{ count: number; at: number } | null>(null);
  useEffect(() => {
    if (braindumpPhase !== 'extracting' || !inflightBraindumpRef.current) {
      beltStableRef.current = null;
      return;
    }
    // A windowed import writes edges after EVERY window, so the first window's
    // edges would trip this belt and resolve the run mid-way. Skip it there —
    // braindump_progress keeps it alive and braindump_complete resolves it.
    if (windowedRunRef.current) return;
    const n = edgeCountOf(data);
    if (n <= edgeCountAtSubmitRef.current) return;
    const prev = beltStableRef.current;
    const now = Date.now();
    if (!prev || prev.count !== n) {
      beltStableRef.current = { count: n, at: now }; // still growing — keep watching
      return;
    }
    if (now - prev.at < 4000) return; // same count but re-read too soon to call it settled
    // Edges landed and held steady — mirror the braindump_complete tidy-up so
    // the lost-WS path matches the normal one: stash streamed ids for the
    // PRECEDES re-stack, clear them, release the inflight gate, flip to done.
    beltStableRef.current = null;
    inflightBraindumpRef.current = null;
    if (streamedIdsRef.current.size) {
      relayoutAfterStreamRef.current = [...streamedIdsRef.current];
    }
    streamedIdsRef.current.clear();
    setBraindumpPhase('done');
  }, [braindumpPhase, data]);

  // Reified Relationship cards live ON the connection between their two
  // characters: positioned at the midpoint of the endpoint cards' centers, and
  // re-tracked as those cards move (so the relationship is effectively the edge,
  // not a free-floating card). Resolve endpoints by working_name/alias.
  const charByName = useMemo(() => {
    const m = new Map<string, ProjectEntity>();
    for (const e of aliveEntities) {
      if (e.type !== 'character') continue;
      if (e.working_name) m.set(e.working_name, e);
      for (const a of e.aliases ?? []) m.set(a, e);
    }
    return m;
  }, [aliveEntities]);

  // relId → { x, y (card top-left at the midpoint), aId, bId (endpoint card ids) }.
  // relMidpoints / reifiedPairs are defined after ballEffects (below) so they
  // can anchor to a character's effective position — including the dealt-out /
  // dragged position when it's been released from a ball.

  // Arcs as threads: each arc's touched events (EVOKES) ordered by PRECEDES.
  // Threads with ≥2 placed events draw as a bezier sewn through those cards
  // (ConnectorLayer). Arcs with 0–1 touched events stay free-floating cards.
  const arcThreads = useMemo(() => {
    const eventIds = aliveEntities.filter((e) => e.type === 'event').map((e) => e.id);
    const set = new Set(eventIds);
    // Topo-rank events by PRECEDES (Kahn, id-stable tiebreak); cycles/leftovers trail.
    const adj = new Map<string, string[]>();
    const indeg = new Map<string, number>();
    for (const id of eventIds) { adj.set(id, []); indeg.set(id, 0); }
    for (const p of data?.edges?.precedes ?? []) {
      if (set.has(p.from) && set.has(p.to)) {
        adj.get(p.from)!.push(p.to);
        indeg.set(p.to, (indeg.get(p.to) ?? 0) + 1);
      }
    }
    const q = eventIds.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
    const rank = new Map<string, number>();
    let r = 0;
    while (q.length) {
      const id = q.shift()!;
      rank.set(id, r++);
      for (const nx of adj.get(id) ?? []) {
        const d = (indeg.get(nx) ?? 0) - 1;
        indeg.set(nx, d);
        if (d === 0) { let i = 0; while (i < q.length && q[i] < nx) i++; q.splice(i, 0, nx); }
      }
    }
    for (const id of eventIds) if (!rank.has(id)) rank.set(id, r++);

    const byArc = new Map<string, Set<string>>();
    for (const ev of data?.edges?.evokes ?? []) {
      if (!byArc.has(ev.arc_id)) byArc.set(ev.arc_id, new Set());
      byArc.get(ev.arc_id)!.add(ev.event_id);
    }
    const threads: { arcId: string; eventIds: string[] }[] = [];
    for (const [arcId, evs] of byArc) {
      if (!aliveEntities.some((e) => e.id === arcId && e.type === 'arc')) continue;
      const ordered = [...evs]
        .filter((id) => set.has(id) && positions[id])
        .sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b));
      if (ordered.length >= 2) threads.push({ arcId, eventIds: ordered });
    }
    return threads;
  }, [aliveEntities, data, positions]);


  // R4 — structural-tie edit popover. Opened by clicking a dashed structural
  // edge on the canvas; relabel / delete / promote-to-relationship.
  const [editStructural, setEditStructural] = useState<
    { from: string; to: string; predicate: string; mx: number; my: number; isNew?: boolean } | null
  >(null);
  const [structDraft, setStructDraft] = useState('');
  const [structBusy, setStructBusy] = useState(false);
  const openStructuralEditor = useCallback(
    (s: { from: string; to: string; predicate: string; mx: number; my: number }) => {
      setEditStructural(s);
      setStructDraft(s.predicate);
    },
    [],
  );
  const closeStructuralEditor = useCallback(() => {
    setEditStructural(null);
    setStructBusy(false);
  }, []);
  useEffect(() => {
    if (!editStructural) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeStructuralEditor(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editStructural, closeStructuralEditor]);
  const runStructural = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (!auth || !storyId) return;
      setStructBusy(true);
      try {
        await fn();
        await refreshEntities();
      } catch (err) {
        console.warn('[corkboard] structural edit failed', err);
      } finally {
        closeStructuralEditor();
      }
    },
    [auth, storyId, refreshEntities, closeStructuralEditor],
  );

  const autoPositions = useMemo(
    () => computeAutoLayout(
      aliveEntities,
      data?.edges?.precedes ?? [],
      typeof window !== 'undefined' ? window.innerWidth : 1400,
      data?.edges?.contains ?? [],
    ),
    [aliveEntities, data?.edges?.precedes, data?.edges?.contains],
  );

  // Story-order scene numbers ("SC 07") for the notecard-style event cards:
  // every alive event, container members included, numbered by the PRECEDES
  // spine (disconnected events append in insertion order after the chain).
  const sceneNoById = useMemo(() => {
    const sorted = topoSortEventsByPrecedes(
      aliveEntities.filter((e) => e.type === 'event'),
      data?.edges?.precedes ?? [],
    );
    const m = new Map<string, number>();
    sorted.forEach((e, i) => m.set(e.id, i + 1));
    return m;
  }, [aliveEntities, data?.edges?.precedes]);

  // Re-tidy the board into the clean chronological layout: events stacked in
  // PRECEDES (story) order, the other types in their columns. Overrides any
  // dragged/stored positions and persists the result so it survives reload.
  const arrangeChronologically = useCallback(() => {
    if (!auth || !storyId || !data) return;
    const fresh = computeAutoLayout(
      aliveEntities,
      data.edges?.precedes ?? [],
      typeof window !== 'undefined' ? window.innerWidth : 1400,
      data.edges?.contains ?? [],
    );
    const ids = Object.keys(fresh);
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = fresh[id];
      return next;
    });
    setWebDrag({});
    for (const id of ids) {
      updateCardPosition(
        { userId: auth.userId, projectId: storyId, cardId: id, x: fresh[id].x, y: fresh[id].y },
        auth.token,
      ).catch((e) => console.warn('[corkboard] arrange persist failed:', e));
    }
  }, [auth, storyId, data, aliveEntities]);

  // Derived per-card signals (counts/labels pulled from edges). Computed once
  // per data change so cards don't each re-walk the edge list on render.
  const signals = useMemo(() => computeCardSignals(data), [data]);

  useEffect(() => {
    if (!data) return;
    // Merge, don't replace: preserve existing positions (e.g., dragged but
    // not yet round-tripped through layouts state). Only place entities we
    // haven't seen before — which on initial load is all of them, and on
    // braindump-driven refetch is just the new ones. Position deleted
    // entities too (cheap) so restore brings them back to their last spot.
    setPositions((prev) => {
      const next = { ...prev };
      for (const e of data.entities) {
        if (next[e.id]) continue;
        const stored = layouts[e.id];
        next[e.id] = stored
          ? { x: stored.x, y: stored.y }
          : (autoPositions[e.id] ?? { x: 0, y: 0 });
      }
      // Member scenes keep the position computeAutoLayout already gave them above
      // (a SINGLE COLUMN in PRECEDES/story order directly under their sequence
      // anchor), so each container box stays narrow and the sequences read as one
      // clean vertical spine in order — instead of the 2-col grid that used to run
      // here, which widened the boxes and fanned the containers to the right. A
      // saved/dragged position still wins (the loop above only fills unseen ids).
      // Seed the four category balls' default positions — a row across the top
      // of the canvas. Stored layouts override (the synthetic ids live in
      // CardLayouts like any other cardId, so a dragged ball persists).
      CLUSTER_ORDER.forEach((id, i) => {
        if (next[id]) return;
        const stored = layouts[id];
        next[id] = stored
          ? { x: stored.x, y: stored.y }
          : { x: CANVAS_PAD + i * (BALL_W + BALL_ROW_GAP), y: CANVAS_PAD };
      });
      return next;
    });
  }, [data, layouts, autoPositions]);

  // Canvas-coord y of the visible top edge — the membership threshold for the
  // sticky categories (Characters/Arcs ball up once this passes their lowest
  // card). Updated by the scroll/resize effect below (rAF-throttled).
  const [viewportCanvasTop, setViewportCanvasTop] = useState(0);
  // Viewport dims + the board's offset from the document top — the board's
  // MINIMUM size fills the viewport under the toolbar (it still grows with
  // content beyond that). Replaces the demo-era fixed 1200×600 floor.
  // Declared HERE (above ballEffects) because the throughline grid derives its
  // column count from the viewport width — same TDZ rule as draggingId.
  const [viewportWH, setViewportWH] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1400,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));

  // -------- Sticky-on-scroll ball clusters --------
  //
  // Non-event nodes bunch into four category balls (Characters / Arcs /
  // Locations / Backstory) that stick to the top of the visible canvas
  // (position:fixed, smooth). Each category balls as a UNIT:
  //  - Locations & Backstory are balled from the initial stage.
  //  - Characters & unconnected Arcs are sticky-on-scroll: their cards stay free
  //    (with edges/relationships) until the viewport scrolls past the BOTTOM of
  //    the category's lowest card, then the whole category bunches into the ball.
  // Collapsed → members hidden. Expanded → members deal out in a column anchored
  // to where the view was when expanded (transient overrides — stored positions
  // untouched; the cards keep their default placement when not balled).

  // Alive event ids in PRECEDES topo order (Kahn, id-stable tiebreak; cycles /
  // unconnected trail in id order). Drives the throughline view's stack.
  const eventOrder = useMemo(() => {
    const ids = aliveEntities.filter((e) => e.type === 'event').map((e) => e.id);
    const set = new Set(ids);
    const adj = new Map<string, string[]>();
    const indeg = new Map<string, number>();
    for (const id of ids) { adj.set(id, []); indeg.set(id, 0); }
    for (const p of data?.edges?.precedes ?? []) {
      if (set.has(p.from) && set.has(p.to)) {
        adj.get(p.from)!.push(p.to);
        indeg.set(p.to, (indeg.get(p.to) ?? 0) + 1);
      }
    }
    const q = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
    const out: string[] = [];
    while (q.length) {
      const id = q.shift()!;
      out.push(id);
      for (const nx of adj.get(id) ?? []) {
        const d = (indeg.get(nx) ?? 0) - 1;
        indeg.set(nx, d);
        if (d === 0) { let i = 0; while (i < q.length && q[i] < nx) i++; q.splice(i, 0, nx); }
      }
    }
    for (const id of ids) if (!out.includes(id)) out.push(id);
    return out;
  }, [aliveEntities, data]);

  // Character centrality for the Characters view — who anchors the web. Reified
  // relationships weigh most, then structural ties, then sheer event presence.
  const charCentrality = useMemo(() => {
    const score = new Map<string, number>();
    const bump = (id: string | undefined, by: number) => {
      if (id) score.set(id, (score.get(id) ?? 0) + by);
    };
    for (const e of aliveEntities) {
      if (e.type !== 'relationship') continue;
      bump(charByName.get(e.character_a ?? '')?.id, 3);
      bump(charByName.get(e.character_b ?? '')?.id, 3);
    }
    for (const s of data?.edges?.structural ?? []) {
      bump(s.from, 2);
      bump(s.to, 2);
    }
    for (const iv of data?.edges?.involves ?? []) bump(iv.to, 1);
    return score;
  }, [aliveEntities, charByName, data]);

  // Throughline grid — the scene the surfaced arc cards are anchored to.
  // Expanding one of those arc cards moves expandedCardId to the ARC, which
  // would otherwise drop the anchor and hide the very card being opened.
  const lastGridArcAnchorRef = useRef<string | null>(null);

  const ballEffects = useMemo(() => {
    type Cluster = {
      id: string; label: string; color: string; count: number;
      balled: boolean; pinned: boolean; expanded: boolean;
      /** Projection-specific ball spot (e.g. throughline view pins Backstory
       *  above the spine) — overrides the stored draggable position. */
      pos?: Pos;
    };
    type SeqBox = { seqId: string; name: string; collapsed: boolean; count: number; x: number; y: number; w: number; h: number; color: string };
    type Effects = {
      overrides: Map<string, { pos: Pos }>;
      displacements: Map<string, { dx: number; dy: number }>;
      hiddenIds: Set<string>;
      clusters: Cluster[];
      sequenceBoxes: SeqBox[];
      // Sequences that have member scenes render as a minimal name label inside
      // their container (the events are the focus), not as a full card.
      minimizedSeqIds: Set<string>;
      // Throughline GRID only — sequence overlays draped over the cohesive
      // wall: a text-selection-style region traced around each sequence's
      // member CELLS (one entry per contiguous run), leaving the reading-order
      // grid itself untouched. `labeled` marks the run carrying the name chip.
      gridSeqRegions: Array<{
        seqId: string; runKey: string; name: string; color: string; labeled: boolean;
        count: number;
        spans: Array<{ x0: number; y0: number; x1: number; y1: number }>;
      }>;
      // Throughline GRID only — cosmetic reading-order chevrons, one centered
      // in the gap between consecutive scenes on the same row. Pure eye-guides
      // (the order is already set), non-interactive.
      gridArrows: Pos[];
    };
    const out: Effects = {
      overrides: new Map(),
      displacements: new Map(),
      hiddenIds: new Set(),
      clusters: [],
      sequenceBoxes: [],
      minimizedSeqIds: new Set(),
      gridSeqRegions: [],
      gridArrows: [],
    };

    // Threaded arcs ride their thread (and ball on it); only UNCONNECTED arcs
    // (no ≥2-event thread) join the Arcs cluster.
    const threadedArcIds = new Set(arcThreads.map((t) => t.arcId));
    const membersFor = (ballId: string): ProjectEntity[] => {
      switch (ballId) {
        case BALL_ID_CHARACTERS:
          return aliveEntities.filter((e) => e.type === 'character');
        case BALL_ID_ARCS:
          return aliveEntities.filter((e) => e.type === 'arc' && !threadedArcIds.has(e.id));
        case BALL_ID_BACKSTORY:
          return aliveEntities.filter(
            (e) => e.type === 'event' && e.narrative_status === 'backstory',
          );
        default:
          return [];
      }
    };

    // Locations never render on the canvas — they're sidebar-only (panel →
    // Locations section). Hiding them here also drops their connectors.
    for (const e of aliveEntities) {
      if (e.type === 'location') out.hiddenIds.add(e.id);
      if (hideSequences && e.type === 'sequence') out.hiddenIds.add(e.id);
    }

    // -------- Focused views — transient layout projections. No balls; the
    // repositioned cards get overrides (so drags are transient via webDrag and
    // edges/relationships track), everything off-view is hidden. --------
    if (viewMode === 'characters') {
      // Splay the characters on a ring so every relationship line + pill has
      // room to read. Events + arcs leave the stage.
      for (const e of aliveEntities) {
        if (e.type === 'event' || e.type === 'arc' || e.type === 'sequence') out.hiddenIds.add(e.id);
      }
      // Most-connected character anchors the center; the rest spread on a wide
      // ring around them (ordered by centrality so heavy hitters sit near the
      // top of the ring).
      const chars = [...aliveEntities.filter((e) => e.type === 'character')].sort(
        (a, b) => (charCentrality.get(b.id) ?? 0) - (charCentrality.get(a.id) ?? 0) || a.id.localeCompare(b.id),
      );
      const n = chars.length;
      if (n > 0) {
        const [center, ...ring] = chars;
        const m = ring.length;
        // Ring radius = just enough arc for each pill + a small gap. Characters
        // render as name pills, so the ring packs tight and the whole cast fits
        // on screen; zoom covers an unusually large ensemble. The ring centers
        // in the visible board (same width math as the throughline layouts).
        const r = Math.max(170, (m * (CHAR_PILL_W + 24)) / (2 * Math.PI));
        const ringAvailW = Math.max(CHAR_PILL_W, viewportWH.w / zoom - 48 - CANVAS_PAD * 2);
        const cx = CANVAS_PAD + ringAvailW / 2;
        const cy = 72 + r + CHAR_PILL_H / 2;
        out.overrides.set(center.id, {
          pos: webDrag[center.id] ?? { x: cx - CHAR_PILL_W / 2, y: cy - CHAR_PILL_H / 2 },
        });
        ring.forEach((c, i) => {
          const th = (2 * Math.PI * i) / Math.max(m, 1) - Math.PI / 2;
          out.overrides.set(c.id, {
            pos: webDrag[c.id] ?? {
              x: Math.max(0, cx + r * Math.cos(th) - CHAR_PILL_W / 2),
              y: Math.max(0, cy + r * Math.sin(th) - CHAR_PILL_H / 2),
            },
          });
        });
      }
      return out;
    }
    if (viewMode === 'throughline') {
      // On-screen/offstage events in one clean PRECEDES-ordered column with
      // generous spacing — the arc threads weave along the sides. Backstory
      // stays OUT of the spine (it sits outside audience-time): it bunches
      // into the Backstory ball above the first scene; dealing it out stacks
      // the beats in a column left of the spine. Characters / relationships /
      // unthreaded arcs leave the stage; threaded arc balls keep riding.
      for (const e of aliveEntities) {
        if (e.type === 'character' || e.type === 'relationship') out.hiddenIds.add(e.id);
        if (e.type === 'arc' && !threadedArcIds.has(e.id)) out.hiddenIds.add(e.id);
        // Sequences are controlled by the show/hide toggle here too (member
        // scenes always stay in eventOrder → the spine). Hidden by default reads
        // as a clean event throughline; shown, they sit in a right lane (below).
        if (e.type === 'sequence' && hideSequences) out.hiddenIds.add(e.id);
      }
      const entById = new Map(aliveEntities.map((e) => [e.id, e]));
      const spine = eventOrder.filter(
        (id) => entById.get(id)?.narrative_status !== 'backstory',
      );
      const backstory = aliveEntities.filter(
        (e) => e.type === 'event' && e.narrative_status === 'backstory',
      );

      if (throughlineLayout === 'grid') {
        // GRID — the writers-room wall: ONE cohesive grid of notecards in
        // strict reading order, left to right, wrapping into rows. Nothing
        // restructures for sequences. The SC numbers + reading order ARE the
        // throughline, so connectors are off (gated at the ConnectorLayer
        // call) and arcs leave the stage entirely. Sequences drape OVER the
        // wall instead: a text-selection-style tinted region traced around
        // each sequence's member cells + a name chip on its border (the
        // regions render from gridSeqRegions; hideSequences clears them).
        const GAP_X = 24;
        const GAP_Y = 28;
        const PAD_OUT = 8; // region padding past the outer cards (outer edges)
        // Columns from the visible width at the current zoom — CSS zoom shrinks
        // the layout, so /zoom widens the wall as the writer zooms out. Reflows
        // on resize (viewportWH is a ballEffects dep).
        const availW = Math.max(EVENT_CARD_W, viewportWH.w / zoom - 48 - CANVAS_PAD * 2);
        const cols = Math.max(2, Math.floor((availW + GAP_X) / (EVENT_CARD_W + GAP_X)));
        const gridW = cols * (EVENT_CARD_W + GAP_X) - GAP_X;
        // The wall centers in the visible board.
        const originX = CANVAS_PAD + Math.max(0, (availW - gridW) / 2);
        const cellPos = (i: number, gtop: number): Pos => ({
          x: originX + (i % cols) * (EVENT_CARD_W + GAP_X),
          y: gtop + Math.floor(i / cols) * (COLLAPSED_H + GAP_Y),
        });

        // Arcs leave the stage — EXCEPT the ones touching an EXPANDED scene:
        // those surface as normal arc cards stacked beside the expanded card,
        // so the writer sees what threads through the scene without thread
        // spaghetti across the row wraps.
        let expandedEventId =
          expandedCardId && spine.includes(expandedCardId) ? expandedCardId : null;
        if (expandedEventId) {
          lastGridArcAnchorRef.current = expandedEventId;
        } else if (
          expandedCardId &&
          entById.get(expandedCardId)?.type === 'arc' &&
          lastGridArcAnchorRef.current &&
          (data?.edges?.evokes ?? []).some(
            (ev) => ev.event_id === lastGridArcAnchorRef.current && ev.arc_id === expandedCardId,
          )
        ) {
          // Expanding a surfaced arc card keeps the set anchored to the scene
          // it surfaced from.
          expandedEventId = lastGridArcAnchorRef.current;
        }
        const touchedArcIds = new Set<string>();
        if (expandedEventId) {
          for (const ev of data?.edges?.evokes ?? []) {
            if (ev.event_id === expandedEventId) touchedArcIds.add(ev.arc_id);
          }
        }
        for (const e of aliveEntities) {
          if (e.type === 'sequence') out.hiddenIds.add(e.id);
          if (e.type === 'arc' && !touchedArcIds.has(e.id)) out.hiddenIds.add(e.id);
        }

        let top = 60;
        // Backstory keeps its ball (outside audience-time); expanded, the beats
        // deal out as their own wrapped rows above the wall.
        if (backstory.length > 0) {
          const meta = CLUSTER_META[BALL_ID_BACKSTORY];
          const ballPos = webDrag[BALL_ID_BACKSTORY] ?? { x: originX, y: 60 };
          const expanded = ballExpanded[BALL_ID_BACKSTORY] != null;
          out.clusters.push({
            id: BALL_ID_BACKSTORY,
            label: meta.label,
            color: getEntityColor(meta.colorKey),
            count: backstory.length,
            balled: true,
            pinned: false,
            expanded,
            pos: ballPos,
          });
          top = 60 + BALL_H + 40;
          if (!expanded) {
            for (const m of backstory) out.hiddenIds.add(m.id);
          } else {
            backstory.forEach((m, i) => {
              out.overrides.set(m.id, { pos: webDrag[m.id] ?? cellPos(i, top) });
            });
            top += Math.ceil(backstory.length / cols) * (COLLAPSED_H + GAP_Y) + 18;
          }
        }

        // The wall itself — every spine event in reading order, one flat wrap.
        spine.forEach((id, i) => {
          out.overrides.set(id, { pos: webDrag[id] ?? cellPos(i, top) });
        });

        // The expanded scene's touched arcs stack beside it (right of the
        // expanded width; flip left when that would leave the wall).
        if (expandedEventId && touchedArcIds.size > 0) {
          const p = out.overrides.get(expandedEventId)?.pos;
          if (p) {
            const asz = collapsedSizeOf('arc');
            const rightX = p.x + EXPANDED_W + 16;
            const ax = rightX + asz.w <= originX + gridW + GAP_X ? rightX : p.x - asz.w - 16;
            let ai = 0;
            for (const id of touchedArcIds) {
              out.overrides.set(id, {
                pos: webDrag[id] ?? { x: ax, y: p.y + ai * (asz.h + 12) },
              });
              ai++;
            }
          }
        }

        // Reading-order chevrons between same-row neighbors (the wrap to the
        // next row reads itself). Sized to fit the slot between two adjacent
        // sequence regions (GAP_X 24 minus 8 padding each side leaves 8px).
        for (let i = 0; i < spine.length - 1; i++) {
          if (Math.floor(i / cols) !== Math.floor((i + 1) / cols)) continue;
          out.gridArrows.push({
            x: originX + (i % cols) * (EVENT_CARD_W + GAP_X) + EVENT_CARD_W + GAP_X / 2,
            y: top + Math.floor(i / cols) * (COLLAPSED_H + GAP_Y) + COLLAPSED_H / 2,
          });
        }

        // Sequence overlays — for each sequence, its members' CELL indices
        // group into contiguous runs; each run traces a region: per-row spans
        // padded to half the row gap on internal boundaries (so stacked rows
        // fuse into one shape) and PAD_OUT on the outer edges. Cells are the
        // LAID-OUT slots (a transiently dragged card leaves its region).
        if (!hideSequences) {
          const idxOf = new Map(spine.map((id, i) => [id, i]));
          const membersBySeq = new Map<string, number[]>();
          for (const c of data?.edges?.contains ?? []) {
            const idx = idxOf.get(c.to);
            if (idx == null) continue;
            const arr = membersBySeq.get(c.from);
            if (arr) arr.push(idx);
            else membersBySeq.set(c.from, [idx]);
          }
          const seqColor = getEntityColor('sequence');
          const rowTopY = (r: number) => top + r * (COLLAPSED_H + GAP_Y);
          const cellX = (c: number) => originX + c * (EVENT_CARD_W + GAP_X);
          for (const [seqId, idxs] of membersBySeq) {
            const seqEnt = entById.get(seqId);
            if (!seqEnt || seqEnt.type !== 'sequence') continue;
            idxs.sort((a, b) => a - b);
            const runs: Array<[number, number]> = [];
            for (const i of idxs) {
              const lastRun = runs[runs.length - 1];
              if (lastRun && i === lastRun[1] + 1) lastRun[1] = i;
              else runs.push([i, i]);
            }
            const color = (((seqEnt.color ?? '') as string).trim()) || seqColor;
            const name = seqEnt.working_title ?? seqEnt.working_name ?? '';
            runs.forEach(([a, b], ri) => {
              const r0 = Math.floor(a / cols);
              const r1 = Math.floor(b / cols);
              const spans: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
              for (let r = r0; r <= r1; r++) {
                const s = Math.max(a, r * cols);
                const e2 = Math.min(b, r * cols + cols - 1);
                spans.push({
                  x0: cellX(s % cols) - PAD_OUT,
                  x1: cellX(e2 % cols) + EVENT_CARD_W + PAD_OUT,
                  y0: rowTopY(r) - (r === r0 ? PAD_OUT : GAP_Y / 2),
                  y1: rowTopY(r) + COLLAPSED_H + (r === r1 ? PAD_OUT : GAP_Y / 2),
                });
              }
              out.gridSeqRegions.push({
                seqId, runKey: `${seqId}:${ri}`, name, color, spans,
                labeled: ri === 0, count: idxs.length,
              });
            });
          }
        }
        return out;
      }

      // The spine centers in the visible board (same width math as the grid,
      // so switching layouts doesn't shift the horizontal center).
      const colAvailW = Math.max(EVENT_CARD_W, viewportWH.w / zoom - 48 - CANVAS_PAD * 2);
      const colX = CANVAS_PAD + Math.max(0, (colAvailW - EVENT_CARD_W) / 2);
      // The ball defaults to sitting above the first scene but is draggable
      // (transient, via webDrag — resets on view switch). The spine's top is
      // fixed regardless of where the ball is moved.
      const ballPos = webDrag[BALL_ID_BACKSTORY] ?? { x: colX, y: 60 };
      const spineTop = backstory.length > 0 ? 60 + BALL_H + 56 : 80;
      spine.forEach((id, i) => {
        out.overrides.set(id, {
          pos: webDrag[id] ?? { x: colX, y: spineTop + i * (COLLAPSED_H + 110) },
        });
      });
      // Shown sequences WRAP their member scenes in a container box (like master),
      // built from the members' spine positions so a sequence reads as a chapter
      // around its run of events. (Member-less sequences don't appear here.)
      if (!hideSequences) {
        const seqColor = getEntityColor('sequence');
        const SEQ_HEADER_H = 24, PAD = 14, SEQ_BOX_MIN_W = 300;
        const containsBySeq = new Map<string, string[]>();
        for (const c of data?.edges?.contains ?? []) {
          const arr = containsBySeq.get(c.from);
          if (arr) arr.push(c.to);
          else containsBySeq.set(c.from, [c.to]);
        }
        for (const [seqId, memberIds] of containsBySeq) {
          const seqEnt = entById.get(seqId);
          if (!seqEnt || seqEnt.type !== 'sequence') continue;
          const members = memberIds
            .map((id) => entById.get(id))
            .filter((e): e is ProjectEntity => !!e && !e.deleted_at);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const m of members) {
            const p = out.overrides.get(m.id)?.pos;
            if (!p) continue;
            const w = expandedCardId === m.id ? EXPANDED_W : EVENT_CARD_W;
            const h = expandedCardId === m.id && expandedCardH > 0 ? expandedCardH : COLLAPSED_H;
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + w); maxY = Math.max(maxY, p.y + h);
          }
          if (!Number.isFinite(minX)) continue;
          out.minimizedSeqIds.add(seqId);
          out.sequenceBoxes.push({
            seqId,
            name: seqEnt.working_title ?? seqEnt.working_name ?? '',
            collapsed: false,
            count: members.length,
            color: (seqEnt.color ?? '').trim() || seqColor,
            x: minX - PAD,
            y: minY - SEQ_HEADER_H - PAD,
            w: Math.max(maxX - minX, SEQ_BOX_MIN_W) + PAD * 2,
            h: (maxY - minY) + SEQ_HEADER_H + PAD * 2,
          });
        }
      }
      if (backstory.length > 0) {
        const meta = CLUSTER_META[BALL_ID_BACKSTORY];
        const anchorY = ballExpanded[BALL_ID_BACKSTORY];
        const expanded = anchorY != null;
        out.clusters.push({
          id: BALL_ID_BACKSTORY,
          label: meta.label,
          color: getEntityColor(meta.colorKey),
          count: backstory.length,
          balled: true,
          pinned: false,
          expanded,
          pos: ballPos,
        });
        if (!expanded) {
          for (const m of backstory) out.hiddenIds.add(m.id);
        } else {
          const bx = Math.max(CANVAS_PAD, colX - EVENT_CARD_W - 80);
          backstory.forEach((m, i) => {
            out.overrides.set(m.id, {
              pos:
                webDrag[m.id] ?? {
                  x: bx,
                  y: ballPos.y + BALL_H + BALL_STACK_GAP + i * (COLLAPSED_H + BALL_STACK_GAP),
                },
            });
          });
        }
      }
      return out;
    }
    const lastCardBottom = (members: ProjectEntity[]): number => {
      let maxBottom = -Infinity;
      for (const m of members) {
        const p = positions[m.id];
        if (p) maxBottom = Math.max(maxBottom, p.y + COLLAPSED_H);
      }
      return maxBottom;
    };

    // Board width — used to size the Characters "web" grid.
    let boardW = 1200;
    for (const e of aliveEntities) {
      const p = positions[e.id];
      if (p) boardW = Math.max(boardW, p.x + EVENT_CARD_W + CANVAS_PAD);
    }

    const balledMemberIds: string[] = [];
    const clusterBboxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const ballId of CLUSTER_ORDER) {
      const members = membersFor(ballId);
      const meta = CLUSTER_META[ballId];
      const anchorY = ballExpanded[ballId];
      const expanded = anchorY != null;
      const ballPos = positions[ballId];

      // `balled` — is the ball shown at all. `pinned` — is it stuck to the top
      // of the viewport vs sitting free at its draggable canvas position.
      let balled: boolean;
      let pinned: boolean;
      if (meta.alwaysBalled) {
        // Locations / Backstory — a free, draggable canvas ball that pins to the
        // top only once the viewport scrolls past its position.
        balled = members.length > 0;
        pinned = !ballPos || ballPos.y < viewportCanvasTop;
      } else {
        // Characters / Arcs — appear (pinned at top) once the viewport scrolls
        // past the category's lowest card; free cards until then.
        balled = members.length > 0 && viewportCanvasTop >= lastCardBottom(members);
        pinned = true;
      }

      out.clusters.push({
        id: ballId,
        label: meta.label,
        color: getEntityColor(meta.colorKey),
        count: members.length,
        balled,
        pinned,
        expanded,
      });
      if (!balled) continue;
      for (const m of members) balledMemberIds.push(m.id);

      if (!expanded) {
        // Collapsed: hide all members entirely (bunched in the ball).
        for (const m of members) out.hiddenIds.add(m.id);
        continue;
      }
      // Expanded — deal out directly BELOW the ball wherever it currently sits:
      // under the pinned-at-top position when pinned, else under the free canvas
      // ball. (A free ball is at ballPos.y, which can be lower than the captured
      // scroll-Y, so anchoring to the scroll-Y would let the ball overlap the
      // column — the bug this fixes.) Transient overrides; stored pos untouched.
      const ballTopY = pinned ? anchorY + BALL_RAIL_PAD : (ballPos ? ballPos.y : anchorY);
      const originY = ballTopY + BALL_H + BALL_STACK_GAP;

      if (ballId === BALL_ID_CHARACTERS) {
        // Characters fill the available space as a WEB, not a stack: a 2D grid
        // across the board width with cells occupied by the visible event spine
        // skipped, so the characters slot into gaps and their relationship edges
        // read as a web. No displacement — they fill around existing cards.
        // Characters are name pills now — grid cells sized to the pill so the
        // dealt-out web packs tight instead of leaving card-sized craters.
        const cellW = CHAR_PILL_W + BALL_STACK_GAP;
        const cellH = CHAR_PILL_H + BALL_STACK_GAP;
        const originX = CANVAS_PAD;
        const cols = Math.max(2, Math.min(6, Math.floor((boardW - 2 * CANVAS_PAD) / cellW)));
        const cellKey = (c: number, r: number) => `${c},${r}`;
        const occupied = new Set<string>();
        for (const e of aliveEntities) {
          if (e.type !== 'event' || e.narrative_status === 'backstory') continue;
          const p = positions[e.id];
          if (!p) continue;
          const c0 = Math.floor((p.x - originX) / cellW);
          const r0 = Math.floor((p.y - originY) / cellH);
          const c1 = Math.floor((p.x + EVENT_CARD_W - originX) / cellW);
          const r1 = Math.floor((p.y + COLLAPSED_H - originY) / cellH);
          for (let r = r0; r <= r1; r++)
            for (let c = c0; c <= c1; c++)
              if (c >= 0 && c < cols && r >= 0) occupied.add(cellKey(c, r));
        }
        let slot = 0;
        for (const m of members) {
          // advance to the next free grid cell (row-major)
          for (;;) {
            const c = slot % cols;
            const r = Math.floor(slot / cols);
            slot++;
            if (occupied.has(cellKey(c, r))) continue;
            out.overrides.set(m.id, {
              pos: webDrag[m.id] ?? { x: originX + c * cellW, y: originY + r * cellH },
            });
            break;
          }
        }
        continue;
      }

      // Other categories — a column below the ball, pushing overlapping cards aside.
      const colX = ballPos ? ballPos.x : CANVAS_PAD;
      members.forEach((m, i) => {
        out.overrides.set(m.id, {
          pos: webDrag[m.id] ?? { x: colX, y: originY + i * (COLLAPSED_H + BALL_STACK_GAP) },
        });
      });
      const lastSlotY =
        originY + (members.length - 1) * (COLLAPSED_H + BALL_STACK_GAP) + COLLAPSED_H;
      clusterBboxes.push({
        x: colX,
        y: ballTopY,
        w: Math.max(BALL_W, EVENT_CARD_W),
        h: lastSlotY - ballTopY,
      });
    }

    // Push non-member cards sideways out of any expanded deal-out column.
    if (clusterBboxes.length > 0) {
      const memberSet = new Set(balledMemberIds);
      for (const e of aliveEntities) {
        if (memberSet.has(e.id)) continue;
        const p = positions[e.id];
        if (!p) continue;
        const csz = collapsedSizeOf(e.type);
        const card = { x: p.x, y: p.y, w: csz.w, h: csz.h };
        let maxDx = 0;
        for (const b of clusterBboxes) {
          const overlapsX = card.x < b.x + b.w && card.x + card.w > b.x;
          const overlapsY = card.y < b.y + b.h && card.y + card.h > b.y;
          if (!overlapsX || !overlapsY) continue;
          const dx = b.x + b.w + BALL_DISPLACE_GAP - card.x;
          if (dx > maxDx) maxDx = dx;
        }
        if (maxDx > 0) out.displacements.set(e.id, { dx: maxDx, dy: 0 });
      }
    }

    // Sequence containers — a sequence that CONTAINS scenes OWNS them. Expanded
    // (default): members nest in a column inside a container box below the
    // sequence card. Collapsed: members hide behind the box (count badge on the
    // card). Reuses overrides/hiddenIds so cards + connectors follow for free.
    const seqColor = getEntityColor('sequence');
    const containsBySeq = new Map<string, string[]>();
    // When sequences are hidden, leave this empty so the whole sequence-box
    // section below no-ops (no boxes, members not nested/hidden). The sequence
    // entities themselves are hidden via the top loop, leaving the event scenes.
    if (!hideSequences) {
      for (const c of data?.edges?.contains ?? []) {
        const arr = containsBySeq.get(c.from);
        if (arr) arr.push(c.to);
        else containsBySeq.set(c.from, [c.to]);
      }
    }
    const PAD = 14;
    // Header band reserved at the box top for the label + ▾/↗ buttons. The box
    // always keeps this clear ABOVE the topmost member so the header never
    // overlaps a scene; the first scene sits flush below it. Must match
    // computeAutoLayout's LABEL_H so collapse/expand doesn't jump.
    const SEQ_HEADER_H = 24;
    // Min box width so the header (▾ + label[≤220] + open ↗ ≈ 300px of content)
    // always fits, even around a single narrow member column. Just wide enough to
    // wrap the header with a small right margin — not wider.
    const SEQ_BOX_MIN_W = 300;
    const basePos = (id: string): Pos | undefined => out.overrides.get(id)?.pos ?? positions[id];
    // Container box rect derived from the member bbox: reserve the header band
    // directly above the members, clamp to the min width. `posOf` resolves each
    // member's effective position (base, or base+displacement in the final pass).
    const seqBoxRect = (
      members: ProjectEntity[],
      posOf: (id: string) => Pos | undefined,
      anchor: Pos | undefined,
    ): { x: number; y: number; w: number; h: number } | null => {
      let mMinX = Infinity, mMinY = Infinity, mMaxX = -Infinity, mMaxY = -Infinity;
      for (const m of members) {
        const p = posOf(m.id);
        if (!p) continue;
        // Use the member's EFFECTIVE size so the box grows to wrap an expanded
        // scene instead of the scene spilling past the box edges.
        const w = expandedCardId === m.id ? EXPANDED_W : EVENT_CARD_W;
        const h = expandedCardId === m.id && expandedCardH > 0 ? expandedCardH : COLLAPSED_H;
        mMinX = Math.min(mMinX, p.x); mMinY = Math.min(mMinY, p.y);
        mMaxX = Math.max(mMaxX, p.x + w); mMaxY = Math.max(mMaxY, p.y + h);
      }
      if (!Number.isFinite(mMinX)) {
        if (!anchor) return null;
        mMinX = anchor.x; mMaxX = anchor.x + COLLAPSED_W;
        mMinY = anchor.y + SEQ_HEADER_H; mMaxY = anchor.y + SEQ_HEADER_H;
      }
      const innerW = mMaxX - mMinX;
      return {
        x: mMinX - PAD,
        y: mMinY - SEQ_HEADER_H - PAD, // reserve the header band above the members
        w: Math.max(innerW, SEQ_BOX_MIN_W) + PAD * 2,
        h: (mMaxY - mMinY) + SEQ_HEADER_H + PAD * 2,
      };
    };

    // ---- Pass 1: classify sequences. Collapsed -> hide members + emit the small
    // box now. Expanded -> stash member info + a PRELIMINARY box rect (from base
    // positions) to use as a nudge obstacle. Final expanded rects are built in
    // pass 3 (after displacement) so a nudged neighbor's box follows it. ----
    type SeqInfo = { seqId: string; name: string; color: string; members: ProjectEntity[]; memberIds: Set<string>; anchor: Pos | undefined };
    type SeqRect = { seqId: string; memberIds: Set<string>; x: number; y: number; w: number; h: number };
    const expandedSeqs: SeqInfo[] = [];
    const seqObstacles: SeqRect[] = [];
    const allSeqMemberIds = new Set<string>();
    for (const [seqId, memberIds] of containsBySeq) {
      const seqEnt = aliveEntities.find((e) => e.id === seqId && e.type === 'sequence' && !e.deleted_at);
      if (!seqEnt) continue;
      const members = memberIds
        .map((id) => aliveEntities.find((e) => e.id === id && !e.deleted_at))
        .filter((e): e is ProjectEntity => !!e);
      if (members.length === 0) continue;
      // A sequence that owns scenes is always a minimal name label (not a full
      // card) — the events are the focus. Writer-chosen color, else the default.
      out.minimizedSeqIds.add(seqId);
      for (const m of members) allSeqMemberIds.add(m.id);
      const color = (seqEnt.color ?? '').trim() || seqColor;
      const name = seqEnt.working_title ?? seqEnt.working_name ?? '';
      const collapsed = !!sequenceCollapsed[seqId];
      const anchor = basePos(seqId);
      if (collapsed) {
        for (const m of members) out.hiddenIds.add(m.id);
        // Derive the collapsed box's top-left + width from the member bbox (same
        // as the expanded box) so collapse/expand changes only HEIGHT — no x/y/w
        // jump when the members sit off the clean column.
        const r = seqBoxRect(members, basePos, anchor);
        if (!r) continue;
        out.sequenceBoxes.push({
          seqId, name, collapsed: true, count: members.length, color,
          x: r.x, y: r.y, w: r.w, h: SEQ_HEADER_H + PAD,
        });
        continue;
      }
      // Expanded — prelim box from BASE positions (nudge obstacle).
      const prelim = seqBoxRect(members, basePos, anchor);
      if (!prelim) continue;
      const memberSet = new Set(members.map((m) => m.id));
      expandedSeqs.push({ seqId, name, color, members, memberIds: memberSet, anchor });
      seqObstacles.push({ seqId, memberIds: memberSet, ...prelim });
    }

    // ---- Pass 2: nudge. An expanded container's border should push things out
    // of its way instead of overlapping them. Two moves, both rightward (matches
    // the cluster deal-out), combined via max so nothing fights an existing push:
    //   (a) box-vs-box: pack the expanded boxes left-to-right so they don't
    //       overlap each other, shifting a whole box (anchor + all members) as a
    //       unit so it translates rather than distorting.
    //   (b) box-vs-loose-card: push any card that is NOT a sequence member out of
    //       the (post-pack) boxes. Members of OTHER sequences are excluded here —
    //       they move with their own box in (a). ----
    // Box-edge breathing room matches the board's default card spacing (per axis)
    // so a nudged card clears an expanded container with the same gap two stacked
    // cards have, instead of a tight ball-style gap.
    const GAP_X = COL_GAP;
    const GAP_Y = ROW_GAP;
    const boxDx = new Map<string, number>(); // per-sequence rigid shift
    // (a) sweep packed boxes by current left edge; greedily clear prior boxes.
    const packed: SeqRect[] = [];
    for (const ob of [...seqObstacles].sort((a, b) => a.x - b.x || a.y - b.y)) {
      let dx = 0;
      for (const done of packed) {
        const x = ob.x + dx;
        const overlapsX = x < done.x + done.w && x + ob.w > done.x;
        const overlapsY = ob.y < done.y + done.h && ob.y + ob.h > done.y;
        if (overlapsX && overlapsY) dx = Math.max(dx, done.x + done.w + GAP_X - ob.x);
      }
      boxDx.set(ob.seqId, dx);
      packed.push({ ...ob, x: ob.x + dx });
    }
    // apply the rigid box shift to each box's anchor + members
    for (const s of expandedSeqs) {
      const dx = boxDx.get(s.seqId) ?? 0;
      if (dx <= 0) continue;
      const bump = (id: string) => {
        const cur = out.displacements.get(id);
        out.displacements.set(id, { dx: Math.max(cur?.dx ?? 0, dx), dy: cur?.dy ?? 0 });
      };
      bump(s.seqId);
      for (const m of s.members) bump(m.id);
    }
    // (b) loose cards: push non-sequence cards clear of the post-pack boxes,
    // out the NEAREST edge — right if the card sits beside the box, DOWN if it
    // sits under it. Collect the loose set + each card's direct push first, so
    // the downward pushes can then RIPPLE to the cards below them (preserving the
    // gaps rather than bunching).
    type LooseCard = { id: string; x: number; y: number; w: number; h: number };
    const looseCards: LooseCard[] = [];
    const directDx = new Map<string, number>();
    const directDy = new Map<string, number>();
    if (packed.length > 0) {
      for (const e of aliveEntities) {
        if (out.hiddenIds.has(e.id)) continue;
        if (e.type === 'location') continue;
        // The card the writer is actively dragging is exempt: it floats freely
        // over a container instead of being shoved aside mid-drag. The nudge
        // re-applies the instant the drag ends (draggingId clears), so a card
        // dropped on a container still settles out of its way on release.
        // (Dragging a CONTAINER uses draggingSeqId, not draggingId, so loose
        // cards still get pushed by a moving box — only this direction is exempt.)
        if (e.id === draggingId) continue;
        // Container sequences (minimized, with member scenes) move with their
        // members via box packing above — skip them here. But a MEMBER-LESS
        // sequence renders as a normal card and must nudge like any other card.
        if (out.minimizedSeqIds.has(e.id)) continue;
        if (allSeqMemberIds.has(e.id)) continue; // a sequence's member moves with its box
        const base = basePos(e.id);
        if (!base) continue;
        // ALWAYS the collapsed footprint — even for the expanded card. If the
        // nudge re-measured on expansion, growing a pill into a full card would
        // change its displacement and the card would JUMP away from its node.
        // Expansion must open IN PLACE; the expanded card's z-index lifts it
        // above container chrome instead of being pushed out of overlap.
        const nsz = collapsedSizeOf(e.type);
        const card: LooseCard = { id: e.id, x: base.x, y: base.y, w: nsz.w, h: nsz.h };
        looseCards.push(card);
        const cur = out.displacements.get(e.id);
        let dx = cur?.dx ?? 0;
        let dy = cur?.dy ?? 0;
        for (const b of packed) {
          const overlapsX = card.x < b.x + b.w && card.x + card.w > b.x;
          const overlapsY = card.y < b.y + b.h && card.y + card.h > b.y;
          if (!overlapsX || !overlapsY) continue;
          const clearRight = b.x + b.w + GAP_X - card.x; // move left edge past the right border
          const clearDown = b.y + b.h + GAP_Y - card.y;  // move top past the bottom border
          if (clearRight <= clearDown) dx = Math.max(dx, clearRight);
          else dy = Math.max(dy, clearDown);
        }
        if (dx > 0) directDx.set(e.id, dx);
        if (dy > 0) directDy.set(e.id, dy);
      }
    }
    // Ripple the downward pushes: any loose card below a down-pushed card (and
    // overlapping its column) drops by at least as much, so the gap to the cards
    // beneath is preserved instead of collapsing. Single top-to-bottom sweep.
    const rippleDy = new Map<string, number>();
    if (directDy.size > 0) {
      const sorted = [...looseCards].sort((a, b) => a.y - b.y);
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        let dy = directDy.get(c.id) ?? 0;
        for (let j = 0; j < i; j++) {
          const a = sorted[j];
          if (a.y >= c.y) continue; // a must sit above c
          const overlapsX = a.x < c.x + c.w && a.x + a.w > c.x;
          if (!overlapsX) continue;
          const ady = rippleDy.get(a.id) ?? 0;
          if (ady > dy) dy = ady; // drop at least as far as the card above
        }
        if (dy > 0) rippleDy.set(c.id, dy);
      }
    }
    // Commit loose-card displacements (dx from the nearest-edge pass, dy from the
    // ripple). Falls back to any pre-existing displacement (e.g. cluster push).
    for (const c of looseCards) {
      const dx = directDx.get(c.id) ?? out.displacements.get(c.id)?.dx ?? 0;
      const dy = rippleDy.get(c.id) ?? out.displacements.get(c.id)?.dy ?? 0;
      if (dx > 0 || dy > 0) out.displacements.set(c.id, { dx, dy });
    }

    // ---- Pass 3: final expanded box rects from base + displacement (anchor seed
    // AND members), so a box pushed in pass 2 translates as a unit and a box that
    // wraps pushed members follows them. ----
    for (const s of expandedSeqs) {
      const aDisp = out.displacements.get(s.seqId);
      const anchorDisp: Pos | undefined = s.anchor
        ? { x: s.anchor.x + (aDisp?.dx ?? 0), y: s.anchor.y + (aDisp?.dy ?? 0) }
        : undefined;
      const posOf = (id: string): Pos | undefined => {
        const base = basePos(id);
        if (!base) return undefined;
        const d = out.displacements.get(id);
        return d ? { x: base.x + d.dx, y: base.y + d.dy } : base;
      };
      const rect = seqBoxRect(s.members, posOf, anchorDisp);
      if (!rect) continue;
      out.sequenceBoxes.push({
        seqId: s.seqId, name: s.name, collapsed: false, count: s.members.length, color: s.color, ...rect,
      });
    }

    return out;
  }, [aliveEntities, positions, ballExpanded, arcThreads, viewportCanvasTop, webDrag, viewMode, throughlineLayout, viewportWH.w, zoom, eventOrder, charCentrality, data?.edges?.contains, data?.edges?.evokes, sequenceCollapsed, expandedCardId, expandedCardH, hideSequences, draggingId]);

  // Prune transient web-drag positions once a card is no longer dealt out (its
  // ball re-bunched or scrolled back to free cards) — so re-expanding resets it
  // to the computed layout. No-op (same ref) when nothing changed.
  useEffect(() => {
    setWebDrag((cur) => {
      const ids = Object.keys(cur);
      if (ids.length === 0) return cur;
      // Keep entries for dealt-out cards (in overrides) and for balls at a
      // projection-specific spot (cluster.pos — e.g. the throughline Backstory
      // ball). Everything else (re-bunched / view switched) resets.
      const keep = (id: string) =>
        ballEffects.overrides.has(id) ||
        ballEffects.clusters.some((c) => c.id === id && c.pos);
      let changed = false;
      const next: Record<string, Pos> = {};
      for (const id of ids) {
        if (keep(id)) next[id] = cur[id];
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [ballEffects]);

  // Reified relationships render at the midpoint of their two character cards.
  // Anchor to each character's EFFECTIVE position — the ball override (dealt-out
  // grid cell or dragged spot) when released from a ball, else the stored
  // position — so the relationship line + pill follow the characters into the
  // web and track them as they're dragged. Only relationships whose both
  // endpoints resolve + have a position get a midpoint.
  // Board-native focus mode: cards intersecting the focal+peer footprint get
  // pushed sideways out of the cleared zone. Stores the ABSOLUTE render
  // position per displaced card (transient — stored positions untouched;
  // everything glides back on close). Mirrors the ball-cluster displacement
  // pattern. Relationships are skipped: their pills render at the midpoint of
  // their two characters and follow the displaced endpoints on their own.
  const peerClear = useMemo(() => {
    const m = new Map<string, Pos>();
    if (!peerForCardId || !peerFocusPos) return m;
    const MARGIN = 28;
    const clear = {
      x: peerFocusPos.x - MARGIN,
      y: peerFocusPos.y - MARGIN,
      w: EXPANDED_W + PEER_GAP + PEER_CARD_W + MARGIN * 2,
      h: Math.max(expandedCardH, 560) + MARGIN * 2,
    };
    const clearCx = clear.x + clear.w / 2;
    for (const e of aliveEntities) {
      if (e.id === peerForCardId) continue;
      if (e.type === 'relationship') continue;
      if (ballEffects.hiddenIds.has(e.id)) continue;
      const nat = positions[e.id];
      const ov = ballEffects.overrides.get(e.id);
      const bd = ballEffects.displacements.get(e.id);
      const p = ov ? ov.pos : bd && nat ? { x: nat.x + bd.dx, y: nat.y + bd.dy } : nat;
      if (!p) continue;
      const { w, h } = collapsedSizeOf(e.type); // character = name pill footprint
      const intersects =
        p.x < clear.x + clear.w && p.x + w > clear.x && p.y < clear.y + clear.h && p.y + h > clear.y;
      if (!intersects) continue;
      // Push to the nearer horizontal side; if the left side would shove the
      // card off the canvas edge, push right instead.
      const pushLeftX = clear.x - w - BALL_DISPLACE_GAP;
      const pushRightX = clear.x + clear.w + BALL_DISPLACE_GAP;
      const goLeft = p.x + w / 2 < clearCx && pushLeftX >= CANVAS_PAD;
      m.set(e.id, { x: goLeft ? pushLeftX : pushRightX, y: p.y });
    }
    return m;
  }, [peerForCardId, peerFocusPos, expandedCardH, aliveEntities, positions, ballEffects]);

  // Connector lines + relationship midpoints must see the focus-mode
  // positions too, so edges track the displaced cards and the focal at its
  // anchor instead of pointing at where the cards used to be. Overrides win
  // over displacements inside ConnectorLayer, matching the render loop.
  const connectorOverrides = useMemo(() => {
    if (peerClear.size === 0 && !(peerForCardId && peerFocusPos)) return ballEffects.overrides;
    const m = new Map(ballEffects.overrides);
    for (const [id, p] of peerClear) m.set(id, { pos: p });
    if (peerForCardId && peerFocusPos) m.set(peerForCardId, { pos: peerFocusPos });
    return m;
  }, [ballEffects, peerClear, peerForCardId, peerFocusPos]);

  const relMidpoints = useMemo(() => {
    const effPos = (id: string): Pos | undefined =>
      (peerForCardId === id ? peerFocusPos ?? undefined : undefined) ??
      peerClear.get(id) ??
      ballEffects.overrides.get(id)?.pos ??
      positions[id];
    const out = new Map<string, { x: number; y: number; aId: string; bId: string }>();
    for (const e of aliveEntities) {
      if (e.type !== 'relationship') continue;
      const a = charByName.get(e.character_a ?? '');
      const b = charByName.get(e.character_b ?? '');
      if (!a || !b) continue;
      const pa = effPos(a.id);
      const pb = effPos(b.id);
      if (!pa || !pb) continue;
      // Anchor to the endpoints' COLLAPSED centers so expanding a character
      // card doesn't shift the midpoint or the line endpoints — the card grows
      // from a fixed top-left, so its collapsed center is the stable anchor.
      // Characters collapse to the name pill, so their center is the pill's.
      const cax = pa.x + CHAR_PILL_W / 2;
      const cay = pa.y + CHAR_PILL_H / 2;
      const cbx = pb.x + CHAR_PILL_W / 2;
      const cby = pb.y + CHAR_PILL_H / 2;
      const mx = (cax + cbx) / 2;
      const my = (cay + cby) / 2;
      // The relationship card itself balls up when collapsed, squares when expanded.
      const dr = expandedCardId === e.id
        ? { w: EXPANDED_W, h: expandedCardH > 0 ? expandedCardH : COLLAPSED_H }
        : { w: REL_COLLAPSED_W, h: REL_COLLAPSED_H };
      out.set(e.id, { x: mx - dr.w / 2, y: my - dr.h / 2, aId: a.id, bId: b.id });
    }
    return out;
  }, [aliveEntities, charByName, positions, expandedCardId, expandedCardH, ballEffects, peerClear, peerForCardId, peerFocusPos]);

  // Char-pair keys (both orderings) that have a reified Relationship — the
  // ConnectorLayer suppresses any structural dashed edge for these pairs, since
  // the relationship card now represents the connection.
  const reifiedPairs = useMemo(() => {
    const s = new Set<string>();
    for (const v of relMidpoints.values()) {
      s.add(`${v.aId}|${v.bId}`);
      s.add(`${v.bId}|${v.aId}`);
    }
    return s;
  }, [relMidpoints]);

  // Thread geometry: per arc, the SVG path (for ConnectorLayer) + a ball anchor
  // ON the curve (for the arc ball that rides the thread). Built here so both
  // layers share one source of truth. Event rects use COLLAPSED dims (static on
  // expand) + ball-cluster displacement, matching the canvas. (After ballEffects
  // since it reads the cluster hidden/displacement state.)
  const arcThreadGeo = useMemo(() => {
    // The throughline grid has no threads at all — arcs are hidden there
    // (except the ones surfacing as cards beside an expanded scene), and an
    // empty geo also empties arcBallById so no ball rides a phantom thread.
    if (arcThreads.length === 0 || (viewMode === 'throughline' && throughlineLayout === 'grid'))
      return [] as { arcId: string; color: string; pathD: string; ballAnchor: { x: number; y: number } | null; samples: { x: number; y: number }[] }[];
    const arcsAtEvent = new Map<string, string[]>();
    arcThreads.forEach((t) => t.eventIds.forEach((eid) => {
      if (!arcsAtEvent.has(eid)) arcsAtEvent.set(eid, []);
      arcsAtEvent.get(eid)!.push(t.arcId);
    }));
    const eventRectFor = (id: string): ThreadRect | null => {
      if (ballEffects.hiddenIds.has(id)) return null;
      const nat = positions[id];
      if (!nat) return null;
      const ov = ballEffects.overrides.get(id);
      const disp = ballEffects.displacements.get(id);
      const p = ov ? ov.pos : disp ? { x: nat.x + disp.dx, y: nat.y + disp.dy } : nat;
      return { x: p.x, y: p.y, w: EVENT_CARD_W, h: COLLAPSED_H, cx: p.x + EVENT_CARD_W / 2, cy: p.y + COLLAPSED_H / 2 };
    };
    return arcThreads
      .map((t, ti) => {
        // Writer-chosen color wins; otherwise auto-assign from the palette by
        // index (stable for a given thread set).
        const chosen = (aliveEntities.find((e) => e.id === t.arcId)?.color as string | undefined);
        const color = chosen && chosen.trim() ? chosen.trim() : ARC_THREAD_PALETTE[ti % ARC_THREAD_PALETTE.length];
        const stops = t.eventIds
          .map((id) => ({ id, rect: eventRectFor(id) }))
          .filter((s): s is { id: string; rect: ThreadRect } => !!s.rect);
        const { pathD, ballAnchor, samples } = buildArcThread(stops, arcsAtEvent, t.arcId);
        return { arcId: t.arcId, color, pathD, ballAnchor, samples };
      })
      .filter((g) => g.pathD);
  }, [arcThreads, positions, ballEffects, expandedCardId, expandedCardH, aliveEntities, viewMode, throughlineLayout]);

  // Phase 3 — the arc ball slides along its thread to stay in view as the user
  // scrolls. `viewportCanvasY` is the canvas-coord y at the center of the
  // visible canvas region; updated on scroll/resize (rAF-throttled).
  const [viewportCanvasY, setViewportCanvasY] = useState(0);
  // viewport-px top/left of the visible canvas → where the position:fixed balls
  // pin. stickyTopPx is 0 once the header has scrolled away, so the balls don't
  // move during normal scrolling (smooth). (viewportCanvasTop, the membership
  // threshold, is declared earlier — it's read by ballEffects above.)
  const [stickyTopPx, setStickyTopPx] = useState(0);
  const [canvasLeftPx, setCanvasLeftPx] = useState(0);
  const [canvasDocTop, setCanvasDocTop] = useState(200);
  // True while scrolling — the balls render as small dots (smooth) and only
  // become the labeled pill once motion stops.
  const [arcsMoving, setArcsMoving] = useState(false);
  // Drag state declared near the top of the component (above ballEffects); refs
  // below.
  const arcsMovingTimer = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const visTop = Math.max(rect.top, 0);
      const visBot = Math.min(rect.bottom, vh);
      setViewportCanvasY((visTop + visBot) / 2 - rect.top);
      setViewportCanvasTop(visTop - rect.top);
      // Manual sticky toolbar: once its in-flow home scrolls above the pin
      // line, the bar goes position:fixed at the home's left/width.
      const home = toolbarHomeRef.current?.getBoundingClientRect();
      if (home) {
        const stuck = home.top < 12;
        setToolbarStuck(stuck);
        setToolbarBox((cur) => {
          const height = toolbarRef.current?.getBoundingClientRect().height ?? cur.height;
          if (cur.left === home.left && cur.width === home.width && cur.height === height) return cur;
          return { left: home.left, width: home.width, height };
        });
      }
      // Pinned balls hang below the toolbar once it's riding the viewport
      // (its bottom edge), else below the visible canvas top.
      const toolbarBottom = toolbarRef.current?.getBoundingClientRect().bottom ?? 0;
      setStickyTopPx(Math.max(visTop, toolbarBottom + 4));
      setCanvasLeftPx(rect.left);
      const docTop = rect.top + window.scrollY;
      setCanvasDocTop((cur) => (Math.abs(cur - docTop) > 1 ? docTop : cur));
      setViewportWH((cur) =>
        cur.w === window.innerWidth && cur.h === window.innerHeight
          ? cur
          : { w: window.innerWidth, h: window.innerHeight },
      );
    };
    const onScroll = () => {
      setArcsMoving(true);
      if (arcsMovingTimer.current) clearTimeout(arcsMovingTimer.current);
      arcsMovingTimer.current = window.setTimeout(() => setArcsMoving(false), 180);
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (arcsMovingTimer.current) clearTimeout(arcsMovingTimer.current);
    };
    // Re-run when loading flips: on first mount the page is still the loading
    // screen (no canvas to measure), so the initial update() is a no-op and
    // canvasDocTop would sit on its default — leaving a bottom gap.
  }, [loading]);

  // The dock sliding open/closed moves the board's top edge — re-measure once
  // its 240ms transition settles so the height floor adapts without the page
  // briefly overflowing the viewport.
  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
    return () => window.clearTimeout(t);
  }, [braindumpOpen]);

  // FIL-515: once a braindump finishes and its text has cleared (the content
  // has disappeared into cards), collapse the dock so the empty field gets out
  // of the way. ONE-SHOT per completion (dockAutoCloseRef, set when extraction
  // completes) — otherwise re-opening the now-empty dock later would auto-close
  // it again. Short delay lets the "Done" status register before the slide-up.
  useEffect(() => {
    if (dockAutoCloseRef.current && braindumpPhase === 'done' && braindumpText.trim() === '' && braindumpOpen) {
      dockAutoCloseRef.current = false;
      const t = window.setTimeout(() => setBraindumpOpen(false), 700);
      return () => window.clearTimeout(t);
    }
  }, [braindumpPhase, braindumpText, braindumpOpen]);

  // The "Done. Extracted …" status is a completion confirmation, not a permanent
  // banner — clear it a few seconds after the run finishes so it fades instead
  // of sitting on the board forever. (A new submit overwrites it immediately.)
  useEffect(() => {
    if (braindumpPhase !== 'done' || !braindumpMsg) return;
    const t = window.setTimeout(() => setBraindumpMsg(null), 4000);
    return () => window.clearTimeout(t);
  }, [braindumpPhase, braindumpMsg]);

  // After a streaming braindump completes, re-stack the just-revealed cards in
  // PRECEDES (story) order — but only once the edge-bearing refetch has landed
  // (the stream placed them in arrival order, before any edges existed).
  useEffect(() => {
    const ids = relayoutAfterStreamRef.current;
    if (!ids || !data) return;
    const eventIds = ids.filter((id) => data.entities.find((e) => e.id === id)?.type === 'event');
    // 2+ events but no PRECEDES yet → the refetch hasn't landed; wait for it.
    if (eventIds.length >= 2 && (data.edges?.precedes?.length ?? 0) === 0) return;
    relayoutAfterStreamRef.current = null;
    const fresh = computeAutoLayout(
      aliveEntities,
      data.edges?.precedes ?? [],
      typeof window !== 'undefined' ? window.innerWidth : 1400,
      data.edges?.contains ?? [],
    );
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of ids) if (fresh[id]) next[id] = fresh[id];
      return next;
    });
  }, [data, aliveEntities]);

  // After a WINDOWED import resolves, re-apply the FULL auto-layout to every card
  // once the structural edges have landed — so sequences stack in order and their
  // members sit in a tight single column, regardless of any stale positions a
  // re-import left behind. One-shot (flag set on resolve; cleared here).
  useEffect(() => {
    if (!relayoutWindowedRef.current || !data) return;
    const ents = data.entities ?? [];
    const hasSeqs = ents.some((e) => e.type === 'sequence');
    const eventCount = ents.filter((e) => e.type === 'event').length;
    // Wait for the edges the layout depends on: sequences need CONTAINS, a multi-
    // event board needs PRECEDES. Otherwise the refetch hasn't fully landed yet.
    if (hasSeqs && (data.edges?.contains?.length ?? 0) === 0) return;
    if (eventCount >= 2 && (data.edges?.precedes?.length ?? 0) === 0) return;
    relayoutWindowedRef.current = false;
    const fresh = computeAutoLayout(
      aliveEntities,
      data.edges?.precedes ?? [],
      typeof window !== 'undefined' ? window.innerWidth : 1400,
      data.edges?.contains ?? [],
    );
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(fresh)) next[id] = fresh[id];
      return next;
    });
    setWebDrag({});
  }, [data, aliveEntities]);

  // arcId → { ball position on the thread, color }. While scrolling, the ball
  // rides to the sample nearest the viewport center (no avoidance — it's a small
  // dot). At rest, it settles on the nearest sample whose pill clears the event/
  // character cards AND the other already-placed balls (so labels don't overlap).
  const arcBallById = useMemo(() => {
    const m = new Map<string, { pos: { x: number; y: number }; color: string }>();
    if (arcThreadGeo.length === 0) return m;
    const dimsFor = (id: string, type?: string): { x: number; y: number; w: number; h: number } | null => {
      if (ballEffects.hiddenIds.has(id)) return null;
      const nat = positions[id];
      if (!nat) return null;
      const ov = ballEffects.overrides.get(id);
      const disp = ballEffects.displacements.get(id);
      const p = ov ? ov.pos : disp ? { x: nat.x + disp.dx, y: nat.y + disp.dy } : nat;
      const sz = collapsedSizeOf(type);
      return { x: p.x, y: p.y, w: sz.w, h: sz.h };
    };
    const obstacles = aliveEntities
      .filter((e) => e.type === 'event' || e.type === 'character')
      .map((e) => dimsFor(e.id, e.type))
      .filter((r): r is { x: number; y: number; w: number; h: number } => !!r);
    const overlaps = (a: { x: number; y: number; w: number; h: number }, list: { x: number; y: number; w: number; h: number }[]) =>
      list.some((o) => !(a.x + a.w < o.x || a.x > o.x + o.w || a.y + a.h < o.y || a.y > o.y + o.h));
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const g of arcThreadGeo) {
      if (!g.samples || g.samples.length === 0) continue;
      // Scrolling: ride the dot to the sample nearest the viewport centre. During
      // a DRAG we DON'T special-case the position — it uses the same stable
      // settle logic below (only the SIZE drops to a dot), which holds a clear
      // spot near the line instead of jumping as the geometry deforms.
      if (arcsMoving) {
        let best = g.samples[0];
        let bestD = Infinity;
        for (const s of g.samples) {
          const d = Math.abs(s.y - viewportCanvasY);
          if (d < bestD) { bestD = d; best = s; }
        }
        m.set(g.arcId, { pos: best, color: g.color });
        continue;
      }
      // At rest: settle the pill where the dot is riding (nearest-viewport
      // sample), walking outward only a SHORT way along the thread for a
      // clear spot. Unbounded search used to pick a clear sample anywhere on
      // the thread, so stopping a scroll made the pill expand far from the
      // dot — reading as the ball teleporting across the screen. If nothing
      // nearby is clear, stay at the anchor and tolerate the overlap (the
      // pill is opaque); local-but-overlapping beats far-but-clear.
      const sorted = [...g.samples].sort(
        (a, b) => Math.abs(a.y - viewportCanvasY) - Math.abs(b.y - viewportCanvasY),
      );
      const anchor = sorted[0];
      const MAX_SETTLE_PX = 180;
      let chosen = anchor;
      for (const s of sorted) {
        if (Math.hypot(s.x - anchor.x, s.y - anchor.y) > MAX_SETTLE_PX) continue;
        const pill = { x: s.x - ARC_BALL_W / 2, y: s.y - ARC_BALL_H / 2, w: ARC_BALL_W, h: ARC_BALL_H };
        if (!overlaps(pill, obstacles) && !overlaps(pill, placed)) { chosen = s; break; }
      }
      placed.push({ x: chosen.x - ARC_BALL_W / 2, y: chosen.y - ARC_BALL_H / 2, w: ARC_BALL_W, h: ARC_BALL_H });
      m.set(g.arcId, { pos: chosen, color: g.color });
    }
    return m;
  }, [arcThreadGeo, viewportCanvasY, arcsMoving, aliveEntities, positions, ballEffects]);

  // A collapsed relationship bubble hides until it has clear space at the
  // midpoint — i.e. its pill rect overlaps no other rendered card. (Expanded
  // relationships, which the writer opened, always show. The dashed connecting
  // line stays either way; only the bubble is suppressed.) Mirrors the render
  // loop's position precedence so the rects match what's actually on screen.
  const relOccluded = useMemo(() => {
    type R = { id: string; rel: boolean; x: number; y: number; w: number; h: number };
    const rects: R[] = [];
    for (const e of aliveEntities) {
      if (ballEffects.hiddenIds.has(e.id)) continue;
      const relMid = relMidpoints.get(e.id);
      const arcBall = e.type === 'arc' ? arcBallById.get(e.id) : undefined;
      const natural = positions[e.id];
      if (!natural && !relMid && !arcBall) continue;
      const expanded = expandedCardId === e.id;
      let x: number, y: number, w: number, h: number;
      if (relMid) {
        w = expanded ? EXPANDED_W : REL_COLLAPSED_W;
        h = expanded ? (expandedCardH > 0 ? expandedCardH : COLLAPSED_H) : REL_COLLAPSED_H;
        x = relMid.x; y = relMid.y;
      } else if (arcBall) {
        const compact = arcsMoving && !expanded;
        w = expanded ? EXPANDED_W : compact ? ARC_DOT : ARC_BALL_W;
        h = expanded ? (expandedCardH > 0 ? expandedCardH : 200) : compact ? ARC_DOT : ARC_BALL_H;
        x = arcBall.pos.x - w / 2; y = arcBall.pos.y - h / 2;
      } else {
        const override = ballEffects.overrides.get(e.id);
        const disp = ballEffects.displacements.get(e.id);
        const p = override
          ? override.pos
          : disp
          ? { x: natural!.x + disp.dx, y: natural!.y + disp.dy }
          : natural!;
        const osz = collapsedSizeOf(e.type); // character = name pill footprint
        w = expanded ? EXPANDED_W : osz.w;
        h = expanded ? (expandedCardH > 0 ? expandedCardH : osz.h) : osz.h;
        x = p.x; y = p.y;
      }
      rects.push({ id: e.id, rel: !!relMid, x, y, w, h });
    }
    const occluded = new Set<string>();
    for (const r of rects) {
      if (!r.rel || expandedCardId === r.id) continue;
      for (const o of rects) {
        if (o.id === r.id) continue;
        if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) {
          occluded.add(r.id);
          break;
        }
      }
    }
    return occluded;
  }, [aliveEntities, ballEffects, relMidpoints, arcBallById, positions, expandedCardId, expandedCardH, arcsMoving]);

  // -------- Drag + click handling --------
  //
  // mousedown begins potential drag. If mouse moves > DRAG_THRESHOLD_PX before
  // mouseup, it's a drag (save final position). Otherwise it's a click → toggle
  // expand on the card.

  const dragRef = useRef<{
    cardId: string;
    mouseStart: Pos;
    cardStart: Pos;
    moved: boolean;
    /** Captured at mousedown so the mouseup handler can detect a multi-
     *  select click (shift / meta) and route accordingly. */
    shiftKey: boolean;
    metaKey: boolean;
    /** True when dragging a card that's currently DEALT OUT of a ball — the
     *  drag is transient (webDrag), not persisted to CardLayouts. */
    isWeb: boolean;
    /** Latest position during the drag — read on drop for sequence-membership
     *  detection (the closure's `positions` is stale from drag-start). */
    lastPos?: Pos;
  } | null>(null);

  // Container drag — dragging a sequence's header or border moves the WHOLE
  // shape: the sequence anchor + every member scene shift by the same delta, so
  // the box (bbox) and its connectors travel together.
  const seqDragRef = useRef<{
    seqId: string;
    mouseStart: Pos;
    starts: Map<string, Pos>; // sequence id + each member id → start position
    moved: boolean;
  } | null>(null);

  // Link-drag — used by the Event card's drag-to-connect handle. When set,
  // a ghost arrow follows the cursor from the source event's handle. On
  // mouseup, hit-tests against other event cards' rects → tagEventPrecedes.
  // Separate from card-drag because the link handle stops propagation on
  // mousedown so the card itself doesn't enter drag mode.
  const [linkDrag, setLinkDrag] = useState<{
    fromCardId: string;
    mouseCanvas: Pos;
    /** Set true once we've actually moved beyond a small threshold — used
     *  to suppress the ghost arrow on a stray click on the handle. */
    moved: boolean;
    /** Event vertex id under the cursor (hover target), null otherwise. */
    overCardId: string | null;
    /** Existing PRECEDES edge under the cursor as `${from}|${to}` —
     *  drop here splices the dragged event between the two endpoints. */
    overEdgeKey: string | null;
    /** D'-11 — Alt held → this drag writes a CAUSES edge instead of
     *  PRECEDES/EVOKES. Tracked live (updated on every move) so the ghost
     *  arrow recolors as the writer holds/releases Alt mid-drag. The drop
     *  decision itself reads the mouseup event's altKey for authority. */
    causesMode: boolean;
  } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Transient success toast for link actions that don't leave a connector on the
  // board (adding a character to a cast, etc.). Auto-clears.
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!linkNotice) return;
    const t = window.setTimeout(() => setLinkNotice(null), 2600);
    return () => window.clearTimeout(t);
  }, [linkNotice]);

  // D'-8 — multi-select state for "create arc from events" + click-arc-to-
  // highlight-events. shift- or meta-click an Event card to add/remove
  // from the selection. Plain click clears. Selection ring is arc-violet.
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  // D'-8 — clicking an Arc card sets this; events that EVOKE that arc
  // render with a colored ring. Click empty canvas / re-click same arc to
  // clear. Distinct from expandedCardId (which is the inline-expand toggle).
  const [highlightedArcId, setHighlightedArcId] = useState<string | null>(null);
  // D'-9 — pending arc suggestions from extraction. Surfaced as a right-
  // side drawer; toolbar badge ("Suggestions · N") opens it. Loaded on
  // bootstrap, appended on arc_suggestion WS events. Accept → creates
  // Arc vertex; dismiss is sticky.
  const [arcSuggestions, setArcSuggestions] = useState<ArcSuggestion[]>([]);
  // On-demand right-side panel (Information facts + arc suggestions). Opened
  // from the permanent toolbar button.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Section the wow tour wants force-expanded in the right panel (e.g. Information).
  const [panelForceSection, setPanelForceSection] = useState<string | null>(null);
  // Card-action gate driven by the wow tour: while a coachmark is up, cards are
  // locked except for the single action the step is coaching.
  const [tourGate, setTourGate] = useState<{ active: boolean; allow: 'expand' | 'fullcard' | 'ask' | null }>({ active: false, allow: null });
  const tourBlocks = (action: 'expand' | 'fullcard' | 'ask') => tourGate.active && tourGate.allow !== action;

  // D'-8 — "Create arc from N events" modal state.
  const [createArcFromEventsOpen, setCreateArcFromEventsOpen] = useState(false);
  const [createArcFromEventsName, setCreateArcFromEventsName] = useState('');
  const [createArcFromEventsKind, setCreateArcFromEventsKind] = useState<ArcKind>('audience_question');
  const [createArcFromEventsDesc, setCreateArcFromEventsDesc] = useState('');
  const [createArcFromEventsSubmitting, setCreateArcFromEventsSubmitting] = useState(false);
  const [createArcFromEventsError, setCreateArcFromEventsError] = useState<string | null>(null);

  const onCardMouseDown = useCallback(
    (e: React.MouseEvent, cardId: string) => {
      if (e.button !== 0) return;
      // A dealt-out card drags from its current (override) position transiently;
      // a ball at a projection-specific spot (cluster.pos) likewise; any other
      // card drags from its stored position and persists.
      const override = ballEffects.overrides.get(cardId);
      const viewBallPos = ballEffects.clusters.find((c) => c.id === cardId)?.pos;
      // If the card is resting at a nudged (container-displaced) position, lift it
      // from THERE, not its raw stored base — otherwise exempting it from the
      // nudge on pickup snaps it back to the overlapping drop point. Bake the
      // nudged spot into its stored position too, so it stops overlapping.
      const disp = !override && !viewBallPos ? ballEffects.displacements.get(cardId) : undefined;
      const stored = positions[cardId];
      const dispStart = disp && stored ? { x: stored.x + disp.dx, y: stored.y + disp.dy } : stored;
      const start = override ? override.pos : viewBallPos ?? dispStart;
      if (!start) return;
      if (disp && dispStart) setPositions((p) => ({ ...p, [cardId]: dispStart }));
      // Focal card in focus mode is pinned by the centering transform —
      // dragging would fight it. Close the peer panel to interact normally.
      if (peerForCardId === cardId) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        cardId,
        mouseStart: { x: e.clientX, y: e.clientY },
        cardStart: { x: start.x, y: start.y },
        moved: false,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey || e.ctrlKey,
        isWeb: !!override || !!viewBallPos,
      };
      setDraggingId(cardId);
    },
    [positions, peerForCardId, ballEffects],
  );

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.mouseStart.x;
      const dy = e.clientY - d.mouseStart.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const z = zoomRef.current || 1; // client px → board px under zoom
      const nextPos = {
        x: Math.max(0, d.cardStart.x + dx / z),
        y: Math.max(0, d.cardStart.y + dy / z),
      };
      d.lastPos = nextPos;
      // A dealt-out card moves transiently via webDrag (feeds the ball override,
      // so edges follow); everything else moves its stored position.
      if (d.isWeb) {
        setWebDrag((w) => ({ ...w, [d.cardId]: nextPos }));
      } else {
        setPositions((p) => ({ ...p, [d.cardId]: nextPos }));
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      if (!d) return;
      if (!d.moved) {
        // Click → toggle. A category ball toggles its cluster's expand state;
        // any other id toggles card expansion. Expanding captures the current
        // scroll-Y (canvas coords) as the deal-out anchor so the dealt cards
        // land in view and don't re-flow while scrolling.
        if (CLUSTER_META[d.cardId]) {
          setBallExpanded((cur) => {
            const next = { ...cur };
            if (next[d.cardId] != null) {
              delete next[d.cardId];
            } else {
              const rect = canvasRef.current?.getBoundingClientRect();
              next[d.cardId] = rect ? Math.max(rect.top, 0) - rect.top : 0;
            }
            return next;
          });
          return;
        }
        const ent = data?.entities.find((x) => x.id === d.cardId);
        // D'-8 — shift / meta-click on an Event card toggles multi-select
        // membership (for the "Create arc from N events" flow). Doesn't
        // change expand state. Non-event cards ignore the modifier.
        if ((d.shiftKey || d.metaKey) && ent?.type === 'event') {
          setSelectedEventIds((cur) => {
            const next = new Set(cur);
            if (next.has(d.cardId)) next.delete(d.cardId);
            else next.add(d.cardId);
            return next;
          });
          return;
        }
        // D'-8 — plain click on an Arc card toggles canvas-level highlight
        // of its EVOKING events. Re-click same arc clears.
        if (ent?.type === 'arc') {
          setHighlightedArcId((cur) => (cur === d.cardId ? null : d.cardId));
          // Still toggle expand so the writer can read the card.
          setExpandedCardId((prev) => (prev === d.cardId ? null : d.cardId));
          return;
        }
        // Plain click on a regular card → clear any selection / highlight
        // first, then toggle its expand. If clicking the already-expanded
        // card, collapse (and dismiss its peer). If clicking another card,
        // expand that one; leave any open peer alone unless it belonged to
        // the previously-expanded card.
        if (selectedEventIds.size > 0) setSelectedEventIds(new Set());
        if (highlightedArcId) setHighlightedArcId(null);
        setExpandedCardId((prev) => {
          if (prev === d.cardId) {
            setPeerForCardId((peerId) => (peerId === d.cardId ? null : peerId));
            return null;
          }
          return d.cardId;
        });
        return;
      }
      // Drag → persist final position. Dealt-out (web) drags are transient —
      // they live in webDrag and reset when the card re-bunches, so skip persist.
      if (d.isWeb) return;
      if (!auth || !storyId) return;
      setPositions((p) => {
        const final = p[d.cardId];
        if (final) {
          updateCardPosition(
            { userId: auth.userId, projectId: storyId, cardId: d.cardId, x: final.x, y: final.y },
            auth.token,
          ).catch((err) => console.warn('[corkboard] save position failed:', err));
        }
        return p;
      });

      // Sequence membership via bodily card-drag (event cards only): dropping an
      // event inside a DIFFERENT container's box moves/nests it there. Dragging a
      // member out is intentionally NOT a thing here (too easy to do by accident);
      // removal is a manual control on the card (see the EventSheet Sequence tile).
      const evt = data?.entities.find((x) => x.id === d.cardId);
      const fp = d.lastPos;
      if (evt?.type === 'event' && fp) {
        const cx = fp.x + EVENT_CARD_W / 2;
        const cy = fp.y + COLLAPSED_H / 2;
        const contains = data?.edges?.contains ?? [];
        const curSeqId = contains.find((c) => c.to === d.cardId)?.from ?? null;
        const eid = d.cardId;
        let dropSeqId: string | null = null;
        for (const b of ballEffects.sequenceBoxes) {
          if (b.seqId === curSeqId) continue;
          if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) { dropSeqId = b.seqId; break; }
        }
        if (dropSeqId && dropSeqId !== curSeqId) {
          setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, contains: [...prev.edges.contains.filter((c) => c.to !== eid), { from: dropSeqId!, to: eid }] } } : prev));
          tagSequenceContains({ sequenceId: dropSeqId, eventId: eid, projectId: storyId }, auth.token)
            .then(() => setLinkNotice(curSeqId ? 'Scene moved to sequence' : 'Scene added to sequence'))
            .catch((err) => {
              setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, contains: prev.edges.contains.filter((c) => !(c.from === dropSeqId! && c.to === eid)) } } : prev));
              setLinkError(err?.message ?? String(err));
            });
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingId, auth, storyId]);

  // -------- Sequence container drag (header / border → move whole shape) --------
  const onSeqContainerMouseDown = useCallback((e: React.MouseEvent, seqId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const starts = new Map<string, Pos>();
    const sp = positions[seqId];
    if (sp) starts.set(seqId, { x: sp.x, y: sp.y });
    for (const c of data?.edges?.contains ?? []) {
      if (c.from !== seqId) continue;
      const mp = positions[c.to];
      if (mp) starts.set(c.to, { x: mp.x, y: mp.y });
    }
    seqDragRef.current = { seqId, mouseStart: { x: e.clientX, y: e.clientY }, starts, moved: false };
    setDraggingSeqId(seqId);
  }, [positions, data?.edges?.contains]);

  useEffect(() => {
    if (!draggingSeqId) return;
    const onMove = (e: MouseEvent) => {
      const d = seqDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.mouseStart.x;
      const dy = e.clientY - d.mouseStart.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const z = zoomRef.current || 1; // client px → board px under zoom
      setPositions((p) => {
        const next = { ...p };
        for (const [id, s] of d.starts) {
          next[id] = { x: Math.max(0, s.x + dx / z), y: Math.max(0, s.y + dy / z) };
        }
        return next;
      });
    };
    const onUp = () => {
      const d = seqDragRef.current;
      seqDragRef.current = null;
      setDraggingSeqId(null);
      if (!d || !d.moved || !auth || !storyId) return;
      setPositions((p) => {
        for (const id of d.starts.keys()) {
          const fp = p[id];
          if (fp) {
            updateCardPosition(
              { userId: auth.userId, projectId: storyId, cardId: id, x: fp.x, y: fp.y },
              auth.token,
            ).catch((err) => console.warn('[corkboard] save seq position failed:', err));
          }
        }
        return p;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingSeqId, auth, storyId]);

  // -------- Link drag (Event drag-to-connect → PRECEDES) --------

  const onLinkHandleMouseDown = useCallback((e: React.MouseEvent, cardId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const z = zoomRef.current || 1;
    const mouseCanvas = {
      x: (e.clientX - rect.left) / z,
      y: (e.clientY - rect.top) / z,
    };
    setLinkDrag({
      fromCardId: cardId,
      mouseCanvas,
      moved: false,
      overCardId: null,
      overEdgeKey: null,
      causesMode: e.altKey,
    });
    setLinkError(null);
  }, []);

  useEffect(() => {
    if (!linkDrag) return;
    const rectOf = (e: ProjectEntity, p: Pos) => {
      const isExp = expandedCardId === e.id;
      const sz = collapsedSizeOf(e.type); // characters collapse to the name pill
      const w = isExp ? EXPANDED_W : sz.w;
      const h = isExp && expandedCardH > 0 ? expandedCardH : sz.h;
      return { x: p.x, y: p.y, w, h, cx: p.x + w / 2, cy: p.y + h / 2 };
    };
    const positionOf = (entId: string): Pos | null => {
      const natural = positions[entId];
      if (!natural) return null;
      const override = ballEffects.overrides.get(entId);
      const displacement = ballEffects.displacements.get(entId);
      return override
        ? override.pos
        : displacement
        ? { x: natural.x + displacement.dx, y: natural.y + displacement.dy }
        : natural;
    };
    const eventRect = (entId: string) => {
      const ent = aliveEntities.find((x) => x.id === entId);
      if (!ent) return null;
      if (ballEffects.hiddenIds.has(entId)) return null;
      const p = positionOf(entId);
      if (!p) return null;
      return rectOf(ent, p);
    };
    // Mirror ConnectorLayer's edge-point clamp: where does the line from
    // `from` toward `to` exit the from-rect? Used to compute the visible
    // segment for arrow hit-testing.
    const edgePoint = (
      from: { cx: number; cy: number; w: number; h: number },
      to: { cx: number; cy: number },
    ) => {
      const dx = to.cx - from.cx;
      const dy = to.cy - from.cy;
      if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
      const tx = dx === 0 ? Infinity : (from.w / 2) / Math.abs(dx);
      const ty = dy === 0 ? Infinity : (from.h / 2) / Math.abs(dy);
      const t = Math.min(tx, ty);
      return { x: from.cx + dx * t, y: from.cy + dy * t };
    };
    // Distance from point p to segment ab. Used for arrow hit-testing.
    const distToSegment = (p: Pos, a: Pos, b: Pos) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + t * dx;
      const cy = a.y + t * dy;
      return Math.hypot(p.x - cx, p.y - cy);
    };

    // Drop targets: Event cards (→ PRECEDES) and Arc cards (→ EVOKES).
    // The link handle lives on Event cards only, so the source is always
    // an event; the target type determines which edge gets written.
    const hitTestCard = (canvasPos: Pos): string | null => {
      // Cards first (event / arc / character, and member-LESS sequences which
      // render as a normal card) so a drop on a member scene inside a container
      // targets the scene, not the box. Minimized container sequences render as a
      // box and are hit-tested in the box loop below.
      for (const ent of aliveEntities) {
        const isCardTarget =
          ent.type === 'event' ||
          ent.type === 'arc' ||
          ent.type === 'character' ||
          (ent.type === 'sequence' && !ballEffects.minimizedSeqIds.has(ent.id));
        if (!isCardTarget) continue;
        if (ent.id === linkDrag.fromCardId) continue;
        if (ballEffects.hiddenIds.has(ent.id)) continue;
        const naturalPos = positions[ent.id];
        if (!naturalPos) continue;
        const override = ballEffects.overrides.get(ent.id);
        const displacement = ballEffects.displacements.get(ent.id);
        const pos = override
          ? override.pos
          : displacement
          ? { x: naturalPos.x + displacement.dx, y: naturalPos.y + displacement.dy }
          : naturalPos;
        const r = rectOf(ent, pos);
        if (
          canvasPos.x >= r.x &&
          canvasPos.x <= r.x + r.w &&
          canvasPos.y >= r.y &&
          canvasPos.y <= r.y + r.h
        ) {
          return ent.id;
        }
      }
      // No card hit — a drop inside a sequence container's box targets the
      // sequence (→ add the dragged event as a member).
      for (const b of ballEffects.sequenceBoxes) {
        if (b.seqId === linkDrag.fromCardId) continue;
        if (canvasPos.x >= b.x && canvasPos.x <= b.x + b.w && canvasPos.y >= b.y && canvasPos.y <= b.y + b.h) {
          return b.seqId;
        }
      }
      return null;
    };

    /** Returns the `${from}|${to}` key of the nearest PRECEDES edge
     *  within hitThreshold pixels of canvasPos, excluding any edge that
     *  has the dragged event as an endpoint (splicing onto an edge
     *  touching yourself would self-loop). Null if none match. */
    const hitTestEdge = (canvasPos: Pos): string | null => {
      const hitThreshold = 10;
      let best: { key: string; dist: number } | null = null;
      for (const e of data?.edges.precedes ?? []) {
        if (e.from === linkDrag.fromCardId || e.to === linkDrag.fromCardId) continue;
        const fr = eventRect(e.from);
        const tr = eventRect(e.to);
        if (!fr || !tr) continue;
        const p1 = edgePoint(fr, tr);
        const p2 = edgePoint(tr, fr);
        const d = distToSegment(canvasPos, p1, p2);
        if (d <= hitThreshold && (!best || d < best.dist)) {
          best = { key: `${e.from}|${e.to}`, dist: d };
        }
      }
      return best?.key ?? null;
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const z = zoomRef.current || 1;
      const canvasPos = { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
      const causesMode = e.altKey;
      setLinkDrag((cur) => {
        if (!cur) return cur;
        const dx = canvasPos.x - cur.mouseCanvas.x;
        const dy = canvasPos.y - cur.mouseCanvas.y;
        const moved = cur.moved || Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX;
        const overCardId = moved ? hitTestCard(canvasPos) : null;
        // Card hit takes priority over edge hit — if cursor is on top of
        // an event card, treat it as a connect target, not a splice. CAUSES
        // (Alt) never splices, so don't hit-test arrows in causesMode.
        const overEdgeKey =
          moved && !overCardId && !causesMode ? hitTestEdge(canvasPos) : null;
        return { ...cur, mouseCanvas: canvasPos, moved, overCardId, overEdgeKey, causesMode };
      });
    };

    const onUp = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const canvasPos = rect
        ? { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z }
        : null;
      const target = canvasPos ? hitTestCard(canvasPos) : null;
      const edgeKey = canvasPos && !target ? hitTestEdge(canvasPos) : null;
      const from = linkDrag.fromCardId;
      // Always clear the drag state first; API calls are async.
      setLinkDrag(null);
      if (!auth || !storyId) return;

      // Branch 1: dropped on a card → connect. Target type determines
      // edge type. Event target → PRECEDES (with reverse-auto-flip).
      // Arc target → EVOKES with empty transition / state (writer can
      // refine via the EventSheet "Evokes arcs" panel or ArcSheet timeline).
      if (target && target !== from) {
        const targetEnt = data?.entities.find((e) => e.id === target);
        if (!targetEnt) return;

        const fromEnt = data?.entities.find((x) => x.id === from);
        const sType = fromEnt?.type;
        const tType = targetEnt.type;

        // Character → Character: a structural tie. Create it (so the line appears
        // and persists) with a neutral placeholder, then immediately pop the
        // label editor at the drop point so the writer names the relationship
        // instead of it silently defaulting to a misleading 'related'.
        if (sType === 'character' && tType === 'character') {
          if ((data?.edges.structural ?? []).some((s) => s.from === from && s.to === target)) return;
          const predicate = 'related';
          setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, structural: [...prev.edges.structural, { from, to: target, predicate }] } } : prev));
          setStructuralEdge({ projectId: storyId, fromId: from, toId: target, predicate }, auth.token)
            .catch((err) => {
              setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, structural: prev.edges.structural.filter((s) => !(s.from === from && s.to === target)) } } : prev));
              setLinkError(err?.message ?? String(err));
            });
          setEditStructural({ from, to: target, predicate, mx: e.clientX, my: e.clientY, isNew: true });
          setStructDraft('');
          return;
        }

        // Character ↔ Event: add the character to the event's cast (INVOLVES).
        // No connector is drawn for INVOLVES; a toast confirms it.
        if ((sType === 'character' && tType === 'event') || (sType === 'event' && tType === 'character')) {
          const eventId = sType === 'event' ? from : target;
          const characterId = sType === 'character' ? from : target;
          if ((data?.edges.involves ?? []).some((i) => i.from === eventId && i.to === characterId)) {
            setLinkNotice('Character already in the cast');
            return;
          }
          setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, involves: [...prev.edges.involves, { from: eventId, to: characterId }] } } : prev));
          tagEventInvolvesCharacter({ eventId, characterId, projectId: storyId }, auth.token)
            .then(() => setLinkNotice('Character added to the cast'))
            .catch((err) => {
              setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, involves: prev.edges.involves.filter((i) => !(i.from === eventId && i.to === characterId)) } } : prev));
              setLinkError(err?.message ?? String(err));
            });
          return;
        }

        // Event ↔ Sequence: add the event as a member scene (CONTAINS, disjoint
        // server-side — a scene is in at most one sequence). Dropping a member of
        // sequence A onto B MOVES it (drops A's membership, adds B's).
        if ((sType === 'event' && tType === 'sequence') || (sType === 'sequence' && tType === 'event')) {
          const sequenceId = sType === 'sequence' ? from : target;
          const eventId = sType === 'event' ? from : target;
          if ((data?.edges.contains ?? []).some((c) => c.from === sequenceId && c.to === eventId)) return;
          const wasMember = (data?.edges.contains ?? []).some((c) => c.to === eventId);
          setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, contains: [...prev.edges.contains.filter((c) => c.to !== eventId), { from: sequenceId, to: eventId }] } } : prev));
          // Reposition the event to where it was dropped (inside the new box) so it
          // nests there and leaves the old container, instead of the box stretching
          // back to the event's old spot. Only when the event was the dragged source.
          if (canvasPos && sType === 'event') {
            const np = { x: Math.max(0, canvasPos.x - EVENT_CARD_W / 2), y: Math.max(0, canvasPos.y - COLLAPSED_H / 2) };
            setPositions((p) => ({ ...p, [eventId]: np }));
            updateCardPosition({ userId: auth.userId, projectId: storyId, cardId: eventId, x: np.x, y: np.y }, auth.token).catch(() => {});
          }
          tagSequenceContains({ sequenceId, eventId, projectId: storyId }, auth.token)
            .then(() => setLinkNotice(wasMember ? 'Scene moved to sequence' : 'Scene added to sequence'))
            .catch((err) => {
              setData((prev) => (prev ? { ...prev, edges: { ...prev.edges, contains: prev.edges.contains.filter((c) => !(c.from === sequenceId && c.to === eventId)) } } : prev));
              setLinkError(err?.message ?? String(err));
            });
          return;
        }

        // Only Events are valid sources for the remaining edge types (PRECEDES /
        // CAUSES / EVOKES). Anything else (e.g. character → arc) is a no-op.
        if (sType !== 'event') return;

        // D'-11 — Alt held at drop → CAUSES. Target may be Event OR Arc.
        // Layered on top of PRECEDES (an Event→Event pair can carry both),
        // so this branch runs before the PRECEDES/EVOKES branches and skips
        // the reverse-auto-flip / Q7 logic those carry.
        if (e.altKey && (targetEnt.type === 'event' || targetEnt.type === 'arc')) {
          const exists = (data?.edges.causes ?? []).some(
            (c) => c.from === from && c.to === target,
          );
          if (exists) return;
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  edges: {
                    ...prev.edges,
                    causes: [...prev.edges.causes, { from, to: target }],
                  },
                }
              : prev,
          );
          tagCauses(
            { fromId: from, toId: target, projectId: storyId },
            auth.token,
          ).catch((err) => {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    edges: {
                      ...prev.edges,
                      causes: prev.edges.causes.filter(
                        (c) => !(c.from === from && c.to === target),
                      ),
                    },
                  }
                : prev,
            );
            setLinkError(err?.message ?? String(err));
            console.warn('[corkboard] tag-causes failed:', err);
          });
          return;
        }

        if (targetEnt.type === 'event') {
          const exists = (data?.edges.precedes ?? []).some(
            (p) => p.from === from && p.to === target,
          );
          if (exists) return;
          const hadReverse = (data?.edges.precedes ?? []).some(
            (p) => p.from === target && p.to === from,
          );
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  edges: {
                    ...prev.edges,
                    precedes: [
                      ...prev.edges.precedes.filter(
                        (p) => !(p.from === target && p.to === from),
                      ),
                      { from, to: target },
                    ],
                  },
                }
              : prev,
          );
          tagEventPrecedes(
            { fromEventId: from, toEventId: target, projectId: storyId },
            auth.token,
          ).catch((err) => {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    edges: {
                      ...prev.edges,
                      precedes: [
                        ...prev.edges.precedes.filter(
                          (p) => !(p.from === from && p.to === target),
                        ),
                        ...(hadReverse ? [{ from: target, to: from }] : []),
                      ],
                    },
                  }
                : prev,
            );
            setLinkError(err?.message ?? String(err));
            console.warn('[corkboard] tag-event-precedes failed:', err);
          });
          return;
        }

        if (targetEnt.type === 'arc') {
          const exists = (data?.edges.evokes ?? []).some(
            (e) => e.event_id === from && e.arc_id === target,
          );
          if (exists) return;
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  edges: {
                    ...prev.edges,
                    evokes: [
                      ...prev.edges.evokes,
                      {
                        event_id: from,
                        arc_id: target,
                        state_at_event: '',
                        transition: '',
                        evidence_quote: '',
                      },
                    ],
                  },
                }
              : prev,
          );
          tagEventEvokes(
            { eventId: from, arcId: target, projectId: storyId },
            auth.token,
          )
            .then(() => setLinkNotice('Event now evokes arc'))
            .catch((err) => {
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    edges: {
                      ...prev.edges,
                      evokes: prev.edges.evokes.filter(
                        (e) => !(e.event_id === from && e.arc_id === target),
                      ),
                    },
                  }
                : prev,
            );
            setLinkError(err?.message ?? String(err));
            console.warn('[corkboard] tag-event-evokes failed:', err);
          });
          return;
        }
        return;
      }

      // Branch 2: dropped on an existing PRECEDES arrow → splice the
      // dragged event in. A→C becomes A→B + B→C atomically (sequential
      // API calls; revert all if any leg fails). Suppressed in CAUSES mode —
      // Alt+drag never splices. Event sources only (splicing inserts into the
      // PRECEDES chain — a character/other source has nothing to splice).
      const fromIsEvent = data?.entities.find((x) => x.id === from)?.type === 'event';
      if (edgeKey && !e.altKey && fromIsEvent) {
        const [oldFrom, oldTo] = edgeKey.split('|');
        if (!oldFrom || !oldTo) return;
        if (oldFrom === from || oldTo === from) return; // belt + suspenders
        // Optimistic: drop old, add two new.
        setData((prev) =>
          prev
            ? {
                ...prev,
                edges: {
                  ...prev.edges,
                  precedes: [
                    ...prev.edges.precedes.filter(
                      (p) => !(p.from === oldFrom && p.to === oldTo),
                    ),
                    { from: oldFrom, to: from },
                    { from, to: oldTo },
                  ],
                },
              }
            : prev,
        );
        (async () => {
          try {
            await untagEventPrecedes(
              { fromEventId: oldFrom, toEventId: oldTo, projectId: storyId },
              auth.token,
            );
            await tagEventPrecedes(
              { fromEventId: oldFrom, toEventId: from, projectId: storyId },
              auth.token,
            );
            await tagEventPrecedes(
              { fromEventId: from, toEventId: oldTo, projectId: storyId },
              auth.token,
            );
          } catch (err: any) {
            // Revert: restore old, drop the two new.
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    edges: {
                      ...prev.edges,
                      precedes: [
                        ...prev.edges.precedes.filter(
                          (p) =>
                            !(p.from === oldFrom && p.to === from) &&
                            !(p.from === from && p.to === oldTo),
                        ),
                        { from: oldFrom, to: oldTo },
                      ],
                    },
                  }
                : prev,
            );
            setLinkError(err?.message ?? String(err));
            console.warn('[corkboard] PRECEDES splice failed:', err);
          }
        })();
        return;
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    linkDrag,
    auth,
    storyId,
    data,
    aliveEntities,
    positions,
    expandedCardId,
    expandedCardH,
    ballEffects,
  ]);

  // Drop an existing PRECEDES edge. Wired into the connector layer's
  // arrow-click handler.
  const onRemovePrecedes = useCallback(
    (fromId: string, toId: string) => {
      if (!auth || !storyId) return;
      setData((prev) =>
        prev
          ? {
              ...prev,
              edges: {
                ...prev.edges,
                precedes: prev.edges.precedes.filter(
                  (p) => !(p.from === fromId && p.to === toId),
                ),
              },
            }
          : prev,
      );
      untagEventPrecedes(
        { fromEventId: fromId, toEventId: toId, projectId: storyId },
        auth.token,
      ).catch((err) => {
        // Revert.
        setData((prev) =>
          prev
            ? {
                ...prev,
                edges: {
                  ...prev.edges,
                  precedes: [...prev.edges.precedes, { from: fromId, to: toId }],
                },
              }
            : prev,
        );
        console.warn('[corkboard] untag-event-precedes failed:', err);
      });
    },
    [auth, storyId],
  );

  // D'-11 — drop an existing CAUSES edge. Wired into the connector layer's
  // CAUSES-line click handler. Endpoints are generic vertex ids (Event|Arc).
  const onRemoveCauses = useCallback(
    (fromId: string, toId: string) => {
      if (!auth || !storyId) return;
      setData((prev) =>
        prev
          ? {
              ...prev,
              edges: {
                ...prev.edges,
                causes: prev.edges.causes.filter(
                  (c) => !(c.from === fromId && c.to === toId),
                ),
              },
            }
          : prev,
      );
      untagCauses({ fromId, toId, projectId: storyId }, auth.token).catch((err) => {
        setData((prev) =>
          prev
            ? {
                ...prev,
                edges: {
                  ...prev.edges,
                  causes: [...prev.edges.causes, { from: fromId, to: toId }],
                },
              }
            : prev,
        );
        console.warn('[corkboard] untag-causes failed:', err);
      });
    },
    [auth, storyId],
  );

  // Click on empty canvas → collapse + dismiss peer + close both balls +
  // clear D'-8 multi-select + arc highlight.
  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    setExpandedCardId(null);
    setPeerForCardId(null);
    setBallExpanded({}); // collapse all category balls
    setSelectedEventIds(new Set());
    setHighlightedArcId(null);
  }, []);

  // -------- Braindump submit --------

  // Shared submit core: enqueue extract-braindump for a block of prose (writer
  // braindump OR parsed screenplay text) + the fallback polls. Callers validate
  // length first.
  const runBraindumpExtraction = useCallback(async (prose: string, opts?: { sourceFormat?: 'screenplay'; wow?: boolean }) => {
    if (!auth || !storyId) return;
    const braindumpId = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    inflightBraindumpRef.current = braindumpId;
    // Large screenplay imports (> ~25pp) run the windowed backend path — multi-
    // minute, window-by-window. Mark it so the fast give-up timers + edge belt
    // don't resolve it early; it resolves on braindump_complete (or a long backstop).
    const isWindowed = opts?.sourceFormat === 'screenplay' && prose.length > 40000;
    windowedRunRef.current = isWindowed;
    edgeCountAtSubmitRef.current = edgeCountOf(dataRef.current); // baseline for the lost-WS belt
    cardCountAtSubmitRef.current = (dataRef.current?.entities ?? []).filter((e) => !e.deleted_at).length;
    if (isWindowed) {
      windowedStartRef.current = Date.now();
      winLastAliveRef.current = cardCountAtSubmitRef.current;
      winLastGrowthRef.current = Date.now();
      resetWinMeter();
      bumpWinPhase('reading');
    } else {
      resetWinMeter();
    }
    setBraindumpPhase('submitting');
    setBraindumpMsg('Queueing extraction…');
    try {
      await enqueueExtractionJob(
        {
          jobType: 'extract-braindump',
          userId: auth.userId,
          projectId: storyId,
          braindumpId,
          prose,
          ...(opts?.sourceFormat ? { sourceFormat: opts.sourceFormat } : {}),
          // Dev-only: stream entities in card-by-card (REACT_APP_FREEFORM_STREAMING
          // is set in .env.development only; prod runs the batch path). The wow
          // flow (FIL-506) forces streaming regardless of env — the card-by-card
          // reveal IS the wow; the non-streaming recovery path backstops failures.
          ...(process.env.REACT_APP_FREEFORM_STREAMING === 'true' || opts?.wow ? { streaming: true } : {}),
        },
        auth.token,
      );
      setBraindumpPhase('extracting');
      const idAtSubmit = braindumpId;
      if (isWindowed) {
        // Windowed import: minutes long, and the WS socket does not survive it —
        // so POLL. Refetch every 15s so the board builds window-by-window
        // regardless of WS. The interval self-terminates when the run resolves
        // (inflight cleared by braindump_complete or the backstop). WS
        // progress/complete, when they do arrive, are a fast path on top.
        setBraindumpMsg('Reading the script. This can take a few minutes; cards appear as each part is processed.');
        if (windowedPollRef.current) window.clearInterval(windowedPollRef.current);
        const STABLE_MS = 45000; // graph unchanged this long ⇒ the run is done
        let lastSig = '';
        let stableSince = Date.now();
        const resolveWindowed = () => {
          inflightBraindumpRef.current = null;
          windowedRunRef.current = false;
          if (windowedPollRef.current) { window.clearInterval(windowedPollRef.current); windowedPollRef.current = null; }
          setBraindumpPhase('done'); // stops the shimmer + tracker + meter
          setBraindumpMsg('Done reading the script.');
          setBraindumpText('');
          dockAutoCloseRef.current = true;
          resetWinMeter();
          relayoutWindowedRef.current = true; // snap the board into the clean layout
          refreshEntitiesRef.current();
          refreshArcSuggestionsRef.current();
        };
        windowedPollRef.current = window.setInterval(() => {
          if (inflightBraindumpRef.current !== idAtSubmit) {
            if (windowedPollRef.current) { window.clearInterval(windowedPollRef.current); windowedPollRef.current = null; }
            return;
          }
          refreshEntitiesRef.current();
          // Also re-pull arc suggestions — the worker writes them (+ CAUSES/EVOKES
          // edges) AFTER the graph lands, so this is the only way the Panel fills
          // and the only way the completion check can see them still arriving.
          refreshArcSuggestionsRef.current();
          // Completion by STABILITY, over the WHOLE result — entities AND edges AND
          // arc suggestions. Watching entity count alone resolved the moment the
          // last window's cards landed, dropping the tracker while the PRECEDES
          // spine, CAUSES edges, and arc suggestions were still being written (the
          // "didn't wait for arcs / out a sequence" drop). Two guards before we
          // call it done: the graph must be non-empty AND the PRECEDES spine must
          // have landed (edges grew past submit), so we never resolve during the
          // pre-spine fill lull.
          const n = (dataRef.current?.entities ?? []).length;
          const e = edgeCountOf(dataRef.current);
          const s = arcSuggestionCountRef.current;
          const sig = `${n}:${e}:${s}`;
          const spineLanded = e > edgeCountAtSubmitRef.current;
          if (sig !== lastSig) { lastSig = sig; stableSince = Date.now(); }
          else if (n > 0 && spineLanded && Date.now() - stableSince > STABLE_MS) { resolveWindowed(); }
        }, 15000);
        // Hard backstop past the Lambda ceiling, in case the graph never stabilizes.
        window.setTimeout(() => {
          if (inflightBraindumpRef.current === idAtSubmit) resolveWindowed();
        }, 960000);
      } else {
        setBraindumpMsg('Extracting, usually 15-30s. New cards will appear when ready.');
        // Steady fallback poll while inflight (every 8s): keeps the board filling
        // even when the braindump_complete WS is lost, and gives the stability
        // belt the consecutive reads it needs to judge "settled" instead of
        // resolving on the first partial mid-write read. Self-terminates when
        // the run resolves (WS handler / belt / hard stop clear inflight).
        const pollIv = window.setInterval(() => {
          if (inflightBraindumpRef.current !== idAtSubmit) {
            window.clearInterval(pollIv);
            return;
          }
          refreshEntitiesRef.current();
        }, 8000);
        // At 45s, keep the writer informed — but DON'T flip to done: the write +
        // worker tail can legitimately still be landing, and a premature 'done'
        // is exactly what dropped the tracker early and let the wow walkthrough
        // build from a half-written graph.
        window.setTimeout(() => {
          if (inflightBraindumpRef.current === idAtSubmit) {
            setBraindumpMsg('Still working. A big idea can take a minute…');
          }
        }, 45000);
        // Hard stop: if neither braindump_complete nor the stability belt ever
        // resolved (truly lossy run), resolve authoritatively at 100s.
        window.setTimeout(() => {
          if (inflightBraindumpRef.current === idAtSubmit) {
            inflightBraindumpRef.current = null;
            setBraindumpPhase('done');
            setBraindumpMsg('Extraction took longer than expected. Check for new cards.');
            setBraindumpText('');
            dockAutoCloseRef.current = true;
            refreshEntitiesRef.current();
          }
        }, 100000);
      }
    } catch (err: any) {
      setBraindumpPhase('error');
      setBraindumpMsg(err.message ?? String(err));
      inflightBraindumpRef.current = null;
    }
  }, [auth, storyId]);

  const onSubmitBraindump = useCallback(async () => {
    const prose = braindumpText.trim();
    if (prose.length < 20) {
      setBraindumpMsg('Need at least 20 characters.');
      setBraindumpPhase('error');
      return;
    }
    // During the wow, force the card-by-card streaming reveal regardless of env.
    await runBraindumpExtraction(prose, { wow: wowActive });
  }, [braindumpText, runBraindumpExtraction, wowActive]);

  // -------- Script (PDF) drop → extraction --------

  // Drop a PDF screenplay anywhere on the board: parse its text client-side,
  // then auto-submit it through the same extract-braindump pipeline. Thin v1
  // (FIL-511): short scripts/excerpts; chunking + a screenplay-specific
  // segmentation prompt are phase 2. Scanned/image PDFs yield no text.
  const [scriptDragOver, setScriptDragOver] = useState(false);
  const scriptInputRef = useRef<HTMLInputElement | null>(null);

  const handleScriptFile = useCallback(async (file: File) => {
    if (!auth || !storyId) return;
    if (braindumpPhase === 'submitting' || braindumpPhase === 'extracting') return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setBraindumpPhase('error');
      setBraindumpMsg('Drop a PDF screenplay.');
      return;
    }
    setBraindumpOpen(false);
    setBraindumpPhase('submitting');
    setBraindumpMsg(`Reading ${file.name}…`);
    try {
      const { parsePdfToText } = await import('../../lib/pdfText');
      const text = await parsePdfToText(file, (p, total) =>
        setBraindumpMsg(`Reading ${file.name}… page ${p}/${total}`),
      );
      const prose = text.trim();
      if (prose.length < 40) {
        setBraindumpPhase('error');
        setBraindumpMsg('Could not read text from that PDF (is it a scanned image?).');
        return;
      }
      await runBraindumpExtraction(prose, { sourceFormat: 'screenplay' });
    } catch (err: any) {
      setBraindumpPhase('error');
      setBraindumpMsg(`Could not read that PDF: ${err?.message ?? String(err)}`);
    }
  }, [auth, storyId, braindumpPhase, runBraindumpExtraction]);

  // Window-level file drag/drop so a screenplay can be dropped anywhere on the
  // board (and so the browser doesn't navigate to the file on a stray drop).
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setScriptDragOver(true); } };
    const onDragLeave = (e: DragEvent) => { if (e.relatedTarget === null) setScriptDragOver(false); };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setScriptDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleScriptFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleScriptFile]);

  // -------- Manual card creation --------

  // Default "Follows" — tail of the longest existing on_screen PRECEDES
  // chain. We look for events that have no outgoing PRECEDES edge (i.e.,
  // nothing follows them yet), prefer on_screen narrative_status, and
  // among those pick the one with the most predecessors so the new event
  // extends the deepest existing chain. Empty string when there are no
  // events or the heuristic finds nothing reasonable.
  const computeFollowsDefault = useCallback((): string => {
    if (!data) return '';
    const events = data.entities.filter((e) => e.type === 'event' && !e.deleted_at);
    if (events.length === 0) return '';
    const hasOutgoing = new Set<string>();
    for (const p of data.edges.precedes) hasOutgoing.add(p.from);
    const indegree = new Map<string, number>();
    for (const p of data.edges.precedes) {
      indegree.set(p.to, (indegree.get(p.to) ?? 0) + 1);
    }
    const tails = events.filter((e) => !hasOutgoing.has(e.id));
    // Score: prefer on_screen, then by indegree (deepest chain), then by
    // most recent created_at.
    const scored = tails.map((e) => ({
      e,
      onScreen: e.narrative_status === 'on_screen' ? 1 : 0,
      indeg: indegree.get(e.id) ?? 0,
      created: e.created_at ?? '',
    }));
    scored.sort((a, b) =>
      b.onScreen - a.onScreen ||
      b.indeg - a.indeg ||
      String(b.created).localeCompare(String(a.created)),
    );
    return scored[0]?.e.id ?? '';
  }, [data]);

  const openCreateModal = useCallback((kind: CreateModalKind) => {
    setCreateKind(kind);
    setCreateName('');
    setCreateDesc('');
    setCreateError(null);
    setCreateCollision(null);
    setCreateArcKind('audience_question'); // reset default each open
    setCreatePrecededBy(kind === 'event' ? computeFollowsDefault() : '');
    setNewMenuOpen(false);
  }, [computeFollowsDefault]);

  const closeCreateModal = useCallback(() => {
    setCreateKind(null);
    setCreateName('');
    setCreateDesc('');
    setCreateError(null);
    setCreateCollision(null);
    setCreatePrecededBy('');
  }, []);

  // + New → Information. A fact needs an establishing scene (the backend
  // requires it — facts are established somewhere, never free-floating), so
  // this is its own small modal: summary + scene picker. Seeds the picker with
  // the currently-expanded event when there is one.
  const [createInfoOpen, setCreateInfoOpen] = useState(false);
  const [createInfoSummary, setCreateInfoSummary] = useState('');
  const [createInfoEventId, setCreateInfoEventId] = useState('');
  const [createInfoError, setCreateInfoError] = useState<string | null>(null);
  const [createInfoSubmitting, setCreateInfoSubmitting] = useState(false);
  const openCreateInfoModal = useCallback(() => {
    setCreateInfoSummary('');
    const exp = expandedCardId
      ? data?.entities.find((e) => e.id === expandedCardId && e.type === 'event')
      : undefined;
    setCreateInfoEventId(exp?.id ?? '');
    setCreateInfoError(null);
    setCreateInfoOpen(true);
    setNewMenuOpen(false);
  }, [expandedCardId, data]);
  const onSubmitCreateInfo = useCallback(async () => {
    if (!auth || !storyId) return;
    const summary = createInfoSummary.trim();
    if (!summary) { setCreateInfoError('The fact itself is required.'); return; }
    if (!createInfoEventId) { setCreateInfoError('Pick the scene where this is established.'); return; }
    setCreateInfoSubmitting(true);
    setCreateInfoError(null);
    try {
      await createInformation(
        { projectId: storyId, eventId: createInfoEventId, summary },
        auth.token,
      );
      setCreateInfoOpen(false);
      refreshEntitiesRef.current();
    } catch (err: any) {
      setCreateInfoError(err.message ?? String(err));
    } finally {
      setCreateInfoSubmitting(false);
    }
  }, [auth, storyId, createInfoSummary, createInfoEventId]);

  // D'-8 — open / close "Create arc from N events" modal.
  const openCreateArcFromEventsModal = useCallback(() => {
    setCreateArcFromEventsName('');
    setCreateArcFromEventsDesc('');
    setCreateArcFromEventsKind('audience_question');
    setCreateArcFromEventsError(null);
    setCreateArcFromEventsOpen(true);
  }, []);
  const closeCreateArcFromEventsModal = useCallback(() => {
    setCreateArcFromEventsOpen(false);
    setCreateArcFromEventsName('');
    setCreateArcFromEventsDesc('');
    setCreateArcFromEventsError(null);
  }, []);
  const onSubmitArcFromEvents = useCallback(async () => {
    if (!auth || !storyId) return;
    const name = createArcFromEventsName.trim();
    if (!name) {
      setCreateArcFromEventsError('Name required.');
      return;
    }
    const eventIds = Array.from(selectedEventIds);
    if (eventIds.length === 0) {
      setCreateArcFromEventsError('Select at least one event first.');
      return;
    }
    setCreateArcFromEventsSubmitting(true);
    setCreateArcFromEventsError(null);
    try {
      const result = await createArcFromEvents(
        {
          projectId: storyId,
          userId: auth.userId,
          workingName: name,
          kind: createArcFromEventsKind,
          description: createArcFromEventsDesc.trim() || undefined,
          eventIds,
        },
        auth.token,
      );
      // Optimistic state: add the new Arc entity + the EVOKES edges so
      // the canvas reflects it immediately. refreshEntities still fires
      // for backfill (sub_events etc. surfaced from the entity loader).
      setData((prev) => {
        if (!prev) return prev;
        const newEvokesEdges = eventIds.map((eid) => ({
          event_id: eid,
          arc_id: result.entity.id,
          state_at_event: '',
          transition: (result.eventDetails.find((d) => d.event_id === eid)
            ?.transition ?? '') as EvokesTransition | '',
          evidence_quote: '',
        }));
        return {
          ...prev,
          entities: [...prev.entities, result.entity],
          edges: {
            ...prev.edges,
            evokes: [...prev.edges.evokes, ...newEvokesEdges],
          },
        };
      });
      // Auto-position the new arc near the centroid of its events so it
      // doesn't land at (0,0).
      const centroid = (() => {
        const valid = eventIds
          .map((id) => positions[id])
          .filter((p): p is Pos => !!p);
        if (valid.length === 0) return { x: CANVAS_PAD, y: CANVAS_PAD };
        return {
          x: Math.round(valid.reduce((s, p) => s + p.x, 0) / valid.length),
          y: Math.round(
            valid.reduce((s, p) => s + p.y, 0) / valid.length +
              COLLAPSED_H +
              ROW_GAP,
          ),
        };
      })();
      setPositions((p) => ({ ...p, [result.entity.id]: centroid }));
      updateCardPosition(
        {
          userId: auth.userId,
          projectId: storyId,
          cardId: result.entity.id,
          x: centroid.x,
          y: centroid.y,
        },
        auth.token,
      ).catch((err) =>
        console.warn('[corkboard] arc-from-events position save failed:', err),
      );
      setSelectedEventIds(new Set());
      closeCreateArcFromEventsModal();
    } catch (err: any) {
      setCreateArcFromEventsError(err?.message ?? String(err));
    } finally {
      setCreateArcFromEventsSubmitting(false);
    }
  }, [
    auth,
    storyId,
    createArcFromEventsName,
    createArcFromEventsKind,
    createArcFromEventsDesc,
    selectedEventIds,
    positions,
    closeCreateArcFromEventsModal,
  ]);

  // D'-9 — accept an arc suggestion. Calls the backend which creates the
  // Arcs spawn in their own lane RIGHT of the throughline (matching the
  // auto-layout), stacked below any existing arcs so a new one never lands
  // mid-board on top of another. (Plain top-down createArc + accepted
  // suggestions; create-from-events keeps its centroid placement near the
  // selected scenes.)
  const computeNewArcPosition = useCallback((): Pos => {
    const boardW = typeof window !== 'undefined' ? window.innerWidth : 1400;
    const centerX = Math.round(boardW / 2 - EVENT_CARD_W / 2);
    const arcX = centerX + EVENT_CARD_W + COL_GAP; // one lane right of the spine
    const arcCount = (data?.entities ?? []).filter((e) => e.type === 'arc' && !e.deleted_at).length;
    return { x: arcX, y: CANVAS_PAD + arcCount * (COLLAPSED_H + ROW_GAP) };
  }, [data]);

  // Arc vertex via createArc semantics + marks the suggestion accepted.
  // Optimistic: drop the suggestion from in-memory list immediately + add
  // the new arc entity. Accepted arcs land in the ARC LANE right of the
  // throughline, stacked below existing arcs (same rule as manual create) —
  // viewport-center placement piled every accepted arc onto the same spot
  // mid-board.
  const onAcceptArcSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!auth || !storyId) return;
      const sug = arcSuggestions.find((s) => s.suggestionId === suggestionId);
      if (!sug) return;
      // Optimistic — drop suggestion immediately.
      setArcSuggestions((cur) => cur.filter((s) => s.suggestionId !== suggestionId));
      const pos = computeNewArcPosition();
      try {
        const res = await acceptArcSuggestion(
          {
            projectId: storyId,
            userId: auth.userId,
            suggestionId,
            position: pos,
          },
          auth.token,
        );
        if (res.entity) {
          setData((prev) =>
            prev ? { ...prev, entities: [...prev.entities, res.entity!] } : prev,
          );
          setPositions((p) => ({ ...p, [res.entity!.id]: pos }));
          setLayouts((l) => ({
            ...l,
            [res.entity!.id]: {
              cardId: res.entity!.id,
              x: pos.x,
              y: pos.y,
              updatedAt: new Date().toISOString(),
            },
          }));
        } else {
          // Already-existed case → refetch for the canonical entity.
          refreshEntitiesRef.current().catch(() => {});
        }
      } catch (err: any) {
        // Revert by re-adding the suggestion.
        setArcSuggestions((cur) =>
          cur.some((s) => s.suggestionId === suggestionId) ? cur : [sug, ...cur],
        );
        console.warn('[corkboard] accept-arc-suggestion failed:', err);
      }
    },
    [auth, storyId, arcSuggestions, computeNewArcPosition],
  );

  const onDismissArcSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!auth || !storyId) return;
      const sug = arcSuggestions.find((s) => s.suggestionId === suggestionId);
      setArcSuggestions((cur) => cur.filter((s) => s.suggestionId !== suggestionId));
      try {
        await dismissArcSuggestion(
          { projectId: storyId, suggestionId },
          auth.token,
        );
      } catch (err) {
        if (sug) {
          setArcSuggestions((cur) =>
            cur.some((s) => s.suggestionId === suggestionId) ? cur : [sug, ...cur],
          );
        }
        console.warn('[corkboard] dismiss-arc-suggestion failed:', err);
      }
    },
    [auth, storyId, arcSuggestions],
  );

  // Place new card near the viewport center, expressed in canvas coords.
  // Cheap heuristic — writer can drag if it's not where they want it.
  const computeNewCardPosition = useCallback((): Pos => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: CANVAS_PAD, y: CANVAS_PAD };
    const z = zoomRef.current || 1;
    const vx = (window.innerWidth / 2 - rect.left) / z;
    const vy = (window.innerHeight / 2 - rect.top) / z;
    return {
      x: Math.max(CANVAS_PAD, Math.round(vx - COLLAPSED_W / 2)),
      y: Math.max(CANVAS_PAD, Math.round(vy - COLLAPSED_H / 2)),
    };
  }, []);

  const onSubmitCreate = useCallback(async () => {
    if (!auth || !storyId || !createKind) return;
    const name = createName.trim();
    if (!name) {
      setCreateError('Name required.');
      return;
    }
    setCreateError(null);

    // Pre-flight slug check against in-memory entities (alive + deleted —
    // both surface from list-project-entities). Avoids a round-trip for the
    // common "writer typed an existing name" case + prevents creating a stray
    // manual-source Braindump vertex on the server. Deleted-match routes to
    // "Restore?" via the modal (§9).
    const prefix =
      createKind === 'character' ? 'char'
        : createKind === 'event' ? 'evt'
        : createKind === 'arc' ? 'arc'
        : 'loc';
    const expectedId = `${prefix}_${slugForCard(name)}_${slugForCard(storyId)}`;
    const existing = data?.entities.find((e) => e.id === expectedId);
    if (existing) {
      setCreateCollision({
        cardId: existing.id,
        name: existing.working_name ?? existing.working_title ?? name,
        deleted: !!existing.deleted_at,
      });
      return;
    }

    setCreateSubmitting(true);
    try {
      const pos = createKind === 'arc' ? computeNewArcPosition() : computeNewCardPosition();
      let newEntity: ProjectEntity;
      if (createKind === 'arc') {
        // D'-1 — top-down arc creation via createArc (separate from createCard).
        const result = await createArc(
          {
            projectId: storyId,
            userId: auth.userId,
            workingName: name,
            kind: createArcKind,
            description: createDesc.trim() || undefined,
            position: pos,
          },
          auth.token,
        );
        if ('exists' in result) {
          setCreateCollision({ cardId: result.cardId, name, deleted: result.deleted });
          return;
        }
        newEntity = result.entity;
      } else {
        const result = await createCard(
          {
            kind: createKind,
            projectId: storyId,
            userId: auth.userId,
            workingName: name,
            description: createDesc.trim() || undefined,
            position: pos,
            precededByEventId:
              createKind === 'event' && createPrecededBy
                ? createPrecededBy
                : undefined,
          },
          auth.token,
        );
        if ('exists' in result) {
          setCreateCollision({ cardId: result.cardId, name, deleted: result.deleted });
          return;
        }
        newEntity = result.entity;
        // Optimistic PRECEDES edge: surface the new edge in data.edges so
        // the throughline UI and slice see it immediately.
        if (
          createKind === 'event' &&
          createPrecededBy &&
          result.precedesEdgeWritten
        ) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  edges: {
                    ...prev.edges,
                    precedes: [
                      ...prev.edges.precedes,
                      { from: createPrecededBy, to: newEntity.id },
                    ],
                  },
                }
              : prev,
          );
        }
        // Fire full extraction over the description: enriches the focal
        // card's fields AND creates any other entities the writer mentioned
        // (other characters, locations, edges). Backend dedups by hash so
        // re-firing on the same description is a cheap no-op. Only runs
        // for Character/Event/Location (Arc is handled in the other branch).
        kickExtractionRef.current(newEntity.id, createDesc.trim());
      }
      setData((prev) =>
        prev ? { ...prev, entities: [...prev.entities, newEntity] } : prev,
      );
      setPositions((p) => ({ ...p, [newEntity.id]: pos }));
      setLayouts((l) => ({
        ...l,
        [newEntity.id]: {
          cardId: newEntity.id,
          x: pos.x,
          y: pos.y,
          updatedAt: new Date().toISOString(),
        },
      }));
      setExpandedCardId(newEntity.id);
      closeCreateModal();
    } catch (err: any) {
      setCreateError(err?.message ?? String(err));
    } finally {
      setCreateSubmitting(false);
    }
  }, [
    auth,
    storyId,
    createKind,
    createArcKind,
    createName,
    createDesc,
    createPrecededBy,
    data,
    computeNewCardPosition,
    computeNewArcPosition,
    closeCreateModal,
  ]);

  const onOpenCollision = useCallback(async () => {
    if (!createCollision || !auth || !storyId) return;
    if (createCollision.deleted) {
      // Restore the soft-deleted vertex before opening it. Dispatch by the
      // createKind currently in the modal — arc collisions route to
      // restoreArc; card collisions to restoreCard.
      try {
        if (createKind === 'arc') {
          await restoreArc({ arcId: createCollision.cardId, projectId: storyId }, auth.token);
        } else {
          await restoreCard({ cardId: createCollision.cardId, projectId: storyId }, auth.token);
        }
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e) =>
              e.id === createCollision.cardId ? { ...e, deleted_at: undefined } : e,
            ),
          };
        });
        refreshEntities();
      } catch (err: any) {
        setCreateError(err?.message ?? String(err));
        return;
      }
    }
    setExpandedCardId(createCollision.cardId);
    closeCreateModal();
  }, [createCollision, createKind, auth, storyId, refreshEntities, closeCreateModal]);

  // -------- Soft delete + restore (§9) --------

  const onDeleteCard = useCallback(
    async (cardId: string) => {
      if (!auth || !storyId) return;
      const nowIso = new Date().toISOString();
      // D'-5 — dispatch by entity type. Arcs route to deleteArc; cards route
      // to deleteCard. The backend handlers are distinct because Arc isn't in
      // ALLOWED_KINDS for delete-card.
      const entity = data?.entities.find((e) => e.id === cardId);
      const isArc = entity?.type === 'arc';
      // Optimistic stamp + close any UI surface tied to the card.
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) =>
            e.id === cardId ? { ...e, deleted_at: nowIso } : e,
          ),
        };
      });
      setExpandedCardId((cur) => (cur === cardId ? null : cur));
      setPeerForCardId((cur) => (cur === cardId ? null : cur));
      setSheetCardId((cur) => (cur === cardId ? null : cur));
      try {
        if (isArc) {
          await deleteArc({ arcId: cardId, projectId: storyId }, auth.token);
        } else {
          await deleteCard({ cardId, projectId: storyId }, auth.token);
        }
      } catch (err) {
        console.warn('[corkboard] delete failed, reverting:', err);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e) =>
              e.id === cardId ? { ...e, deleted_at: undefined } : e,
            ),
          };
        });
      }
    },
    [auth, storyId, data],
  );

  const onRenameCard = useCallback(
    async (cardId: string, newName: string) => {
      if (!auth || !storyId) throw new Error('Not authenticated');
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Name required');

      // Optimistic update — apply locally before the backend round-trip so
      // the EditableName exits edit mode immediately.
      const previous = data?.entities.find((e) => e.id === cardId);
      const isArc = previous?.type === 'arc';
      const prevName = previous?.working_name ?? previous?.working_title ?? '';
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) => {
            if (e.id !== cardId) return e;
            const next = { ...e, working_name: trimmed };
            if (e.working_title !== undefined) next.working_title = trimmed;
            return next;
          }),
        };
      });

      try {
        if (isArc) {
          // D'-1 — arc rename routes through update-arc (backend's
          // update-card-name only handles Character/Event/Location).
          const result = await updateArc(
            { arcId: cardId, projectId: storyId, workingName: trimmed },
            auth.token,
          );
          if (result.aliases) {
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                entities: prev.entities.map((e) =>
                  e.id === cardId ? { ...e, aliases: result.aliases } : e,
                ),
              };
            });
          }
        } else {
          const result = await updateCardName(
            { cardId, projectId: storyId, workingName: trimmed },
            auth.token,
          );
          // Backend echoes the canonical aliases array — patch it onto the
          // local entity so future renames carry forward the full history.
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              entities: prev.entities.map((e) =>
                e.id === cardId ? { ...e, aliases: result.aliases } : e,
              ),
            };
          });
          // If Relationship vertices were updated to reflect the new name in
          // their character_a/character_b strings, refresh entities so the
          // Relationship cards re-render with the new endpoint name.
          if (result.relationshipsAffected > 0) {
            refreshEntities();
          }
        }
      } catch (err) {
        // Revert + rethrow so EditableName knows the save failed.
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e) => {
              if (e.id !== cardId) return e;
              const reverted = { ...e, working_name: prevName };
              if (e.working_title !== undefined) reverted.working_title = prevName;
              return reverted;
            }),
          };
        });
        console.warn('[corkboard] rename failed:', err);
        throw err;
      }
    },
    [auth, storyId, data, refreshEntities],
  );

  // Kick the background extraction LLM pass for a card whose description
  // was just (re)written. Triggers the full extraction pipeline — the
  // focal vertex gets its enrichment fields populated AND any other
  // entities the writer mentioned (other characters, locations, edges)
  // are created via the resolver. Backend gates type + length + dedup, so
  // we just need a length precheck here to avoid wasting an SQS round-trip
  // on bare creates. Don't read from `data` — freshly-created cards may
  // not be in state yet when this fires from onSubmitCreate.
  const kickExtraction = useCallback(
    (cardId: string, description: string) => {
      if (!auth || !storyId) return;
      if (description.trim().length < 40) return;
      enqueueCardExtraction(
        { cardId, projectId: storyId, userId: auth.userId },
        auth.token,
      ).catch((err) => {
        console.warn('[corkboard] extraction enqueue failed:', err);
      });
      // Fallback polls in case the card_extracted WS event drops. Each
      // refetches list-project-entities. Extraction usually lands at 8-20s
      // (LLM + Neptune writes), so the polls give us coverage both sides.
      window.setTimeout(() => {
        refreshEntitiesRef.current().catch(() => {});
      }, 15000);
      window.setTimeout(() => {
        refreshEntitiesRef.current().catch(() => {});
      }, 35000);
      console.info('[corkboard] extraction kicked for', cardId);
    },
    [auth, storyId],
  );
  useEffect(() => {
    kickExtractionRef.current = kickExtraction;
  }, [kickExtraction]);

  // D'-5b — update a card's description (or Event's summary). Optimistic
  // update with revert on error. Mirrors onRenameCard's contract: throws so
  // the EditableDescription can revert its draft locally.
  const onUpdateDescription = useCallback(
    async (cardId: string, newDescription: string) => {
      if (!auth || !storyId) throw new Error('Not authenticated');
      const previous = data?.entities.find((e) => e.id === cardId);
      const prevDesc = previous?.description ?? '';
      const prevSummary = previous?.summary ?? '';
      const isEvent = previous?.type === 'event';
      // Optimistic: write the new value to both description + summary (for
      // events) so the card body re-renders immediately.
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) => {
            if (e.id !== cardId) return e;
            const next = { ...e, description: newDescription };
            if (isEvent) next.summary = newDescription;
            return next;
          }),
        };
      });
      try {
        await updateCardDescription(
          { cardId, projectId: storyId, description: newDescription },
          auth.token,
        );
        // Description committed — kick full extraction (focal enrichment +
        // any newly-mentioned entities + edges). Backend dedups by hash so
        // re-saves of the same content cost nothing.
        kickExtraction(cardId, newDescription);
      } catch (err) {
        // Revert + rethrow so the editor knows the save failed.
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e) => {
              if (e.id !== cardId) return e;
              const reverted = { ...e, description: prevDesc };
              if (isEvent) reverted.summary = prevSummary;
              return reverted;
            }),
          };
        });
        console.warn('[corkboard] description update failed:', err);
        throw err;
      }
    },
    [auth, storyId, data, kickExtraction],
  );

  const onChangeNarrativeStatus = useCallback(
    async (cardId: string, next: NarrativeStatus) => {
      if (!auth || !storyId) return;
      const prev = data?.entities.find((e) => e.id === cardId)?.narrative_status;
      if (prev === next) return;
      // Optimistic update.
      setData((p) => {
        if (!p) return p;
        return {
          ...p,
          entities: p.entities.map((e) =>
            e.id === cardId ? { ...e, narrative_status: next } : e,
          ),
        };
      });
      try {
        await updateCardNarrativeStatus(
          { cardId, projectId: storyId, narrativeStatus: next },
          auth.token,
        );
      } catch (err) {
        // D'-10 — backend returned 409 with violations. Revert the
        // optimistic state and open the supersession modal so the writer
        // can choose how to resolve each Q7-violating EVOKES edge before
        // the flip commits.
        if (err instanceof SupersessionRequiredError) {
          setData((p) => {
            if (!p) return p;
            return {
              ...p,
              entities: p.entities.map((e) =>
                e.id === cardId ? { ...e, narrative_status: prev } : e,
              ),
            };
          });
          setSupersession(err.payload);
          return;
        }
        console.warn('[corkboard] narrative_status update failed, reverting:', err);
        setData((p) => {
          if (!p) return p;
          return {
            ...p,
            entities: p.entities.map((e) =>
              e.id === cardId ? { ...e, narrative_status: prev } : e,
            ),
          };
        });
      }
    },
    [auth, storyId, data],
  );

  // D'-10 — supersession modal state. Set when updateCardNarrativeStatus
  // throws SupersessionRequiredError. Cleared by the modal (cancel or
  // after successful resolveNarrativeStatusFlip).
  const [supersession, setSupersession] = useState<SupersessionRequiredResponse | null>(null);
  const onResolveSupersession = useCallback(
    async (resolutions: Array<{ arcId: string; action: 'demote' | 'remove' }>) => {
      if (!auth || !storyId || !supersession) return;
      const { cardId, narrativeStatus } = supersession;
      // Optimistic: apply the resolutions to local edge state + flip the
      // event's narrative_status. Revert all on error.
      const beforeEdges = data?.edges.evokes ?? [];
      const removeArcIds = new Set(
        resolutions.filter((r) => r.action === 'remove').map((r) => r.arcId),
      );
      const demoteArcIds = new Set(
        resolutions.filter((r) => r.action === 'demote').map((r) => r.arcId),
      );
      setData((p) => {
        if (!p) return p;
        return {
          ...p,
          entities: p.entities.map((e) =>
            e.id === cardId ? { ...e, narrative_status: narrativeStatus } : e,
          ),
          edges: {
            ...p.edges,
            evokes: p.edges.evokes
              .filter((ev) => !(ev.event_id === cardId && removeArcIds.has(ev.arc_id)))
              .map((ev) =>
                ev.event_id === cardId && demoteArcIds.has(ev.arc_id)
                  ? { ...ev, transition: 'touches' as EvokesTransition }
                  : ev,
              ),
          },
        };
      });
      try {
        await resolveNarrativeStatusFlip(
          {
            cardId,
            projectId: storyId,
            narrativeStatus,
            resolutions,
          },
          auth.token,
        );
        setSupersession(null);
      } catch (err: any) {
        // Revert.
        setData((p) => {
          if (!p) return p;
          const prev = supersession.violations.length > 0 ? 'on_screen' : narrativeStatus;
          return {
            ...p,
            entities: p.entities.map((e) =>
              e.id === cardId ? { ...e, narrative_status: prev } : e,
            ),
            edges: { ...p.edges, evokes: beforeEdges },
          };
        });
        console.warn('[corkboard] resolve-narrative-status-flip failed:', err);
        alert(err?.message ?? 'Resolution failed — try again');
      }
    },
    [auth, storyId, supersession, data],
  );

  const onRestoreCard = useCallback(
    async (cardId: string) => {
      if (!auth || !storyId) return;
      const entity = data?.entities.find((e) => e.id === cardId);
      const prevDeletedAt = entity?.deleted_at;
      const isArc = entity?.type === 'arc';
      // Optimistic clear.
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entities: prev.entities.map((e) =>
            e.id === cardId ? { ...e, deleted_at: undefined } : e,
          ),
        };
      });
      try {
        if (isArc) {
          await restoreArc({ arcId: cardId, projectId: storyId }, auth.token);
        } else {
          await restoreCard({ cardId, projectId: storyId }, auth.token);
        }
        // Refetch so edges to/from the restored card resurface (project-reads
        // filters edges by alive endpoints; we need to re-pull now that the
        // endpoint is alive again).
        refreshEntities();
      } catch (err) {
        console.warn('[corkboard] restore failed, reverting:', err);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            entities: prev.entities.map((e) =>
              e.id === cardId ? { ...e, deleted_at: prevDeletedAt } : e,
            ),
          };
        });
      }
    },
    [auth, storyId, data, refreshEntities],
  );

  // -------- WS subscription for braindump_complete events --------
  //
  // Stale-closure-safe: stash the latest refreshEntities + auth in refs so the
  // WS handler always calls the current version without forcing the effect to
  // re-run on auth token rotation. Prior bug: WS effect depended on
  // `refreshEntities` identity, which changed whenever auth changed (inside
  // refreshEntities a token rotate calls setAuth). Result: WS reconnected
  // mid-stream and braindump_complete events arriving during the reconnect
  // gap were silently lost.
  const refreshEntitiesRef = useRef(refreshEntities);
  useEffect(() => { refreshEntitiesRef.current = refreshEntities; }, [refreshEntities]);

  // kickExtraction is declared further down — use a ref so callers above
  // (onSubmitCreate) can dispatch through the always-current instance
  // without participating in their memoization deps. Default is a no-op
  // until the real kickExtraction is assigned.
  const kickExtractionRef = useRef<(cardId: string, description: string) => void>(
    () => {},
  );
  const userIdForWs = auth?.userId ?? null;

  useEffect(() => {
    if (!userIdForWs || !storyId) return;
    const wsEndpoint = process.env.REACT_APP_WEBSOCKET_ENDPOINT;
    if (!wsEndpoint) return;

    let cancelled = false;
    const ws = new WebSocket(wsEndpoint);

    ws.onopen = () => {
      if (cancelled) return;
      try {
        ws.send(JSON.stringify({
          action: 'identify',
          userId: userIdForWs,
          storyId,
          timestamp: Date.now(),
        }));
      } catch { /* ignore */ }
    };

    ws.onmessage = (raw) => {
      if (cancelled) return;
      let msg: any;
      try { msg = JSON.parse(raw.data); } catch { return; }
      if (msg?.projectId !== storyId) return;

      // Dev streaming: a vertex finished extracting — drop its card on the
      // board immediately (card-by-card reveal). The final braindump_complete
      // refetch reconciles edges + authoritative fields. Ids match the backend
      // (slug), so the refetch dedups instead of duplicating.
      if (msg.type === 'entity_streamed' && msg.entity?.id) {
        const e = msg.entity;
        streamedIdsRef.current.add(e.id);
        setData((prev) => {
          if (!prev) return prev;
          if (prev.entities.some((x) => x.id === e.id)) return prev;
          const ent = {
            id: e.id,
            type: e.type,
            working_name: e.working_name,
            working_title: e.working_title,
            narrative_status: e.narrative_status,
            description: e.description ?? e.summary ?? '',
            int_ext: e.int_ext,
          } as ProjectEntity;
          return { ...prev, entities: [...prev.entities, ent] };
        });
        return;
      }

      if (msg.type === 'braindump_progress') {
        // Windowed import: a phase transition (reading → structuring → processing
        // → wiring) and/or a window's cards landing. Keep the run alive (tracker +
        // shimmer stay on — it IS still processing), name the phase on the meter,
        // and refetch so the board builds window-by-window. These pings are the
        // fast path; the FE ticker carries the meter when the socket has died.
        if (inflightBraindumpRef.current) {
          if (msg.phase && ['reading', 'structuring', 'processing', 'wiring'].includes(msg.phase)) {
            bumpWinPhase(msg.phase as WinPhase);
          }
          if (msg.window || msg.total) {
            setWinProg({ window: msg.window, total: msg.total });
            winLastGrowthRef.current = Date.now(); // a window just wrote ⇒ still growing
          }
          if (msg.window && (msg.total ?? 0) > 1) {
            setBraindumpMsg(`Processing the script: part ${msg.window}/${msg.total}…`);
          }
          refreshEntitiesRef.current();
        }
        return;
      }

      if (msg.type === 'braindump_complete') {
        const counts = msg.counts ?? {};
        const total =
          (counts.characters ?? 0) +
          (counts.events ?? 0) +
          (counts.locations ?? 0) +
          (counts.relationships ?? 0);
        setBraindumpPhase('done');
        setBraindumpMsg(
          total === 0
            ? 'Extraction returned no new entities.'
            : `Done. Extracted ${counts.characters ?? 0} char · ${counts.events ?? 0} event · ${counts.locations ?? 0} loc.`,
        );
        setBraindumpText('');
        dockAutoCloseRef.current = true;
        if (windowedRunRef.current) relayoutWindowedRef.current = true; // snap into the clean layout
        inflightBraindumpRef.current = null;
        windowedRunRef.current = false; // windowed run resolved
        resetWinMeter();
        refreshArcSuggestionsRef.current(); // arcs were written just before this WS
        if (windowedPollRef.current) { window.clearInterval(windowedPollRef.current); windowedPollRef.current = null; }
        // Streamed cards were positioned in ARRIVAL order (PRECEDES didn't exist
        // yet). Stash them so the effect below re-stacks them in PRECEDES (story)
        // order ONCE the edge-bearing refetch lands — doing it here would race
        // the refetch and re-place them in arrival order again.
        if (streamedIdsRef.current.size) {
          relayoutAfterStreamRef.current = [...streamedIdsRef.current];
        }
        streamedIdsRef.current.clear();
        refreshEntitiesRef.current();
        return;
      }

      if (msg.type === 'cascade_complete') {
        // Card-response extraction landed — refetch entities + mark the
        // originating response as extracted so the composer can show "done."
        console.info(
          '[corkboard] cascade_complete WS:',
          msg.cardResponseId,
          '· new:', msg.newEntities?.length ?? 0,
          '· cross:', msg.crossCardLandings?.length ?? 0,
        );
        setPendingCascades((c) => Math.max(0, c - 1));
        if (msg.cardResponseId) {
          setCompletedResponseIds((prev) => {
            const next = new Set(prev);
            next.add(msg.cardResponseId);
            return next;
          });
          // Release the response-submission queue: the next queued answer
          // (if any) submits now that this one's extraction has landed.
          notifyResponseExtracted(msg.cardResponseId);
        }
        // Immediate refresh + delayed safety net in case Neptune replicas
        // haven't fully synced yet at the moment we get the WS event.
        refreshEntitiesRef.current();
        window.setTimeout(() => refreshEntitiesRef.current(), 2500);
        return;
      }

      if (msg.type === 'card_enriched') {
        // Single-vertex enrichment pass landed (internal building block,
        // not the primary manual-create / edit trigger anymore). Refetch
        // so the focal card's new fields land.
        console.info(
          '[corkboard] card_enriched WS:',
          msg.cardId,
          msg.label,
          '· applied:', msg.applied,
        );
        refreshEntitiesRef.current();
        window.setTimeout(() => refreshEntitiesRef.current(), 2500);
        return;
      }

      if (msg.type === 'card_extracted') {
        // Full extraction from a manual card's description landed. The
        // focal card's fields are populated AND new entities mentioned in
        // the description (waitress, locations, edges, etc.) are in the
        // graph. Refetch list-project-entities so the canvas sees them.
        console.info(
          '[corkboard] card_extracted WS:',
          msg.cardId,
          msg.label,
          '· counts:', msg.counts,
        );
        refreshEntitiesRef.current();
        window.setTimeout(() => refreshEntitiesRef.current(), 2500);
        return;
      }

      if (msg.type === 'arc_suggestion') {
        // D'-9 — an arc candidate has crossed the surface threshold
        // (>=2 braindumps mentioning it). Add or update the in-memory
        // suggestion list so the toast / tray surfaces it. wasNew=false
        // means we're updating an already-pending suggestion with new
        // evidence; merge rather than duplicate.
        console.info(
          '[corkboard] arc_suggestion WS:',
          msg.suggestionId,
          msg.suggestedName,
          '· mentions:', msg.mentionCount,
        );
        setArcSuggestions((cur) => {
          const idx = cur.findIndex((s) => s.suggestionId === msg.suggestionId);
          const next: ArcSuggestion = {
            suggestionId: msg.suggestionId,
            projectId: storyId ?? '',
            suggestedName: msg.suggestedName,
            suggestedKind: msg.suggestedKind,
            description: msg.description ?? '',
            evidenceQuotes: msg.evidenceQuotes ?? [],
            sourceBraindumpIds: [],
            mentionCount: msg.mentionCount ?? 0,
            status: 'pending',
          };
          if (idx === -1) return [next, ...cur];
          const merged = [...cur];
          merged[idx] = { ...merged[idx], ...next };
          return merged;
        });
        return;
      }
    };

    ws.onclose = () => { /* ignore — reopen on remount */ };
    ws.onerror = () => { /* onclose follows */ };

    return () => {
      cancelled = true;
      try { ws.close(1000, 'unmount'); } catch { /* ignore */ }
    };
    // Deps: only userId + storyId. NOT auth (which rotates on token refresh)
    // and NOT refreshEntities (which is invoked via ref so its latest version
    // is always called). This keeps the WS connection stable across token
    // rotations — prior bug had reconnects mid-stream losing WS events.
  }, [userIdForWs, storyId]);

  // -------- Lazy fetch per-card questions when expanded --------

  const refreshCardQuestions = useCallback(
    async (cardId: string) => {
      if (!auth) return;
      try {
        const res = await listCardQuestions({ cardId, withOpenThreads: true }, auth.token);
        setCardQuestionsCache((prev) => ({ ...prev, [cardId]: res.questions }));
      } catch (err) {
        console.warn('[corkboard] listCardQuestions failed:', err);
      }
    },
    [auth],
  );

  useEffect(() => {
    if (!expandedCardId || !auth) return;
    if (cardQuestionsCache[expandedCardId]) return; // cached
    refreshCardQuestions(expandedCardId);
  }, [expandedCardId, auth, cardQuestionsCache, refreshCardQuestions]);

  // Also refresh the card's questions when a cascade completes that originated
  // from this card — so the "answered" count bumps in real time.
  useEffect(() => {
    if (!expandedCardId) return;
    refreshCardQuestions(expandedCardId);
  }, [completedResponseIds, expandedCardId, refreshCardQuestions]);

  // -------- Compute focus-mode anchor (canvas coords) --------

  useEffect(() => {
    if (!peerForCardId) {
      setPeerFocusPos(null);
      // Keep position transitions on briefly so the focal + displaced cards
      // glide back to their stored spots instead of snapping.
      setFocusExiting(true);
      const t = window.setTimeout(() => setFocusExiting(false), BALL_TRANSITION_MS + 80);
      return () => window.clearTimeout(t);
    }
    // Anchor the focal+peer pair on the BOARD, centered in the region the
    // writer is currently looking at. Computed once per open (no scroll/resize
    // tracking — the pair is board-native and scrolls with the canvas).
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const combinedW = EXPANDED_W + PEER_GAP + PEER_CARD_W;
    // Viewport-centered x, translated into canvas coords (÷zoom).
    const x = Math.max(CANVAS_PAD, ((window.innerWidth - combinedW * z) / 2 - rect.left) / z);
    // Below the toolbar with breathing room; clamp inside the canvas.
    const toolbarBottom = toolbarRef.current?.getBoundingClientRect().bottom ?? 0;
    const yViewport = Math.max(toolbarBottom + 24, window.innerHeight * 0.1);
    const y = Math.max(CANVAS_PAD, (yViewport - rect.top) / z);
    setPeerFocusPos({ x, y });
  }, [peerForCardId]);

  // -------- Measure expanded card height (drives canvas height) --------

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!expandedCardId) {
      setExpandedCardH(0);
      return;
    }
    const el = cardRefs.current[expandedCardId];
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setExpandedCardH(entry.contentRect.height + 28); // +padding (14*2)
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expandedCardId]);

  // -------- Story rename --------
  // Any story that has a persisted works record can be renamed (demo + wow
  // stories have records too); the works-presence check is the real gate.
  const canRename = !!storyId && !!appUser?.works?.[storyId];
  const renameStory = async (newTitle: string) => {
    const title = newTitle.trim();
    if (!storyId || !auth || !title || title === workTitle) return;
    const prevTitle = workTitle;
    // Optimistic: update the local works record so the header reflects it now.
    const patchTitle = (t?: string) => setUser((u: any) =>
      u?.works?.[storyId] ? { ...u, works: { ...u.works, [storyId]: { ...u.works[storyId], title: t } } } : u);
    patchTitle(title);
    try {
      const session = await fetchAuthSession();
      const tk = session.tokens?.idToken?.toString() ?? auth.token;
      // The works "save" event upserts by storyId (same path the outline editor's
      // title change uses) and returns the refreshed works map. Freeform records
      // carry no outline fields, so the empty S1-S9 are a no-op; workflow must be
      // re-sent so the freeform routing tag survives the write.
      const res = await axios.post(`${process.env.REACT_APP_URL}/works`, {
        event: 'save', title, userId: auth.userId, storyId, workflow: 'freeform',
        M: '', T: '', G: '', CQ: '', SUM: '', BRAINSTORM: '',
        S1: '', S2: '', S3: '', S4: '', S5: '', S6: '', S7: '', S8: '', S9: '',
      }, { headers: { Authorization: tk } });
      const works = res?.data?.body?.works ?? res?.data?.works;
      if (works) setUser((u: any) => (u ? { ...u, works } : u));
    } catch (err) {
      console.warn('[corkboard] rename failed, reverting:', err);
      patchTitle(prevTitle);
    }
  };

  // -------- Render --------

  if (loading) return <ThemeCtx.Provider value={theme}><Shell storyId={storyId} title={workTitle}><CorkboardLoading /></Shell></ThemeCtx.Provider>;
  if (error) return <ThemeCtx.Provider value={theme}><Shell storyId={storyId} title={workTitle}><div style={{ color: 'crimson' }}>Error: {error}</div></Shell></ThemeCtx.Provider>;
  if (!data) return <ThemeCtx.Provider value={theme}><Shell storyId={storyId} title={workTitle}>No data.</Shell></ThemeCtx.Provider>;

  // Peer card position: beside the focus anchor once it's computed; falls
  // back to next-to-parent for the single pre-anchor frame so the card lifts
  // from the focal and glides into place. peer-for-deleted should never
  // happen (delete closes peer), but guard via aliveEntities lookup.
  const peerEntity = peerForCardId ? aliveEntities.find((e) => e.id === peerForCardId) : null;
  const peerPos = peerEntity
    ? peerFocusPos
      ? { x: peerFocusPos.x + EXPANDED_W + PEER_GAP, y: peerFocusPos.y }
      : computePeerPosition(positions[peerEntity.id], peerEntity)
    : null;

  // Throughline grid — the wall shows ORDER only: no PRECEDES lines, no arc
  // threads (the SC numbers carry the throughline; row-wrap arrows are noise).
  const gridActive = viewMode === 'throughline' && throughlineLayout === 'grid';

  const typeOfCard = (cardId: string) => data.entities.find((e) => e.id === cardId)?.type;
  const heightOf = (cardId: string) =>
    expandedCardId === cardId && expandedCardH > 0 ? expandedCardH : collapsedSizeOf(typeOfCard(cardId)).h;
  const widthOf = (cardId: string) =>
    expandedCardId === cardId ? EXPANDED_W : collapsedSizeOf(typeOfCard(cardId)).w;

  // Effective position for sizing: the view/ball override when present, else the
  // stored position PLUS any nudge displacement — must mirror the render exactly
  // so a card pushed down/right by a sequence-box nudge grows the board instead
  // of sliding off it. Hidden entities don't stretch the canvas (a focused view
  // shouldn't inherit the master board's sprawl).
  const sizePosOf = (id: string): Pos | null => {
    if (ballEffects.hiddenIds.has(id)) return null;
    const ov = ballEffects.overrides.get(id)?.pos;
    if (ov) return ov;
    const base = positions[id];
    if (!base) return null;
    const d = ballEffects.displacements.get(id);
    return d ? { x: base.x + d.dx, y: base.y + d.dy } : base;
  };
  // Board floors: fill the viewport under the toolbar (48 = Shell side
  // padding; 24 = breathing room at the bottom). Content extends it further.
  const canvasMinH = Math.max(480, viewportWH.h - canvasDocTop - 24);
  const canvasMinW = Math.max(800, viewportWH.w - 48);
  const canvasH = Math.max(
    canvasMinH,
    ...aliveEntities.map((e) => {
      const p = sizePosOf(e.id);
      return p ? p.y + heightOf(e.id) + CANVAS_PAD : 0;
    }),
    ...(peerPos ? [peerPos.y + 800] : []),
  );
  const canvasW = Math.max(
    canvasMinW,
    ...aliveEntities.map((e) => {
      const p = sizePosOf(e.id);
      return p ? p.x + widthOf(e.id) + CANVAS_PAD : 0;
    }),
    ...(peerPos ? [peerPos.x + PEER_CARD_W + CANVAS_PAD] : []),
  );

  return (
    <ThemeCtx.Provider value={theme}>
    <Shell storyId={storyId} title={workTitle} canRename={canRename} onRename={renameStory}>
      {/* Toolbar — one cohesive control strip: stats on the left, controls on
          the right. Manually sticky (an app-shell overflow ancestor defeats
          position:sticky): the wrapper holds the bar's slot in flow; once it
          scrolls past, the bar snaps to position:fixed at the viewport top.
          The pinned category balls hang below its bottom edge. */}
      <div
        ref={toolbarHomeRef}
        style={{ height: toolbarStuck ? toolbarBox.height : undefined, marginBottom: braindumpOpen ? 0 : 12 }}
      >
      {!(toolbarStuck && toolbarHidden) && (
      <div
        ref={toolbarRef}
        style={{
          ...(toolbarStuck
            ? {
                top: 12,
                left: toolbarBox.left,
                width: toolbarBox.width,
                boxSizing: 'border-box' as const,
              }
            : null),
          zIndex: 140,
          position: toolbarStuck ? 'fixed' : 'relative',
          padding: '8px 10px',
          background: dark ? '#141417' : '#fff',
          border: dark ? '1px solid #26262b' : '1px solid #ece5d7',
          // While the braindump field hangs below, the FIELD's top border is
          // the line under the bar (one element draws the whole frame) — the
          // bar contributes no bottom border of its own.
          borderBottom: braindumpOpen
            ? 'none'
            : dark ? '1px solid #26262b' : '1px solid #ece5d7',
          transition: 'border-color 200ms ease',
          borderRadius: braindumpOpen ? '10px 10px 0 0' : 10,
          boxShadow: braindumpOpen
            ? braindumpFocused
              ? '0 0 10px rgba(255,140,0,0.4), 0 0 25px rgba(255,140,0,0.2), 0 0 50px rgba(255,140,0,0.1)'
              : '0 0 15px rgba(255,107,53,0.12), 0 0 35px rgba(255,107,53,0.06)'
            : toolbarStuck
            ? dark ? '0 6px 24px rgba(0,0,0,0.55)' : '0 6px 20px rgba(120,90,40,0.14)'
            : dark ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(120,90,40,0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Focused views — layout projections over the same graph. Master is
            the free-form board; the others are transient (nothing persists). */}
        <ToolbarButton
          label="Master"
          icon="▦"
          tourId="toolbar-views"
          onClick={() => switchView('master')}
          active={viewMode === 'master'}
          accent={viewMode === 'master' ? '#ea580c' : undefined}
          title="The full free-form board with your stored layout"
        />
        <ToolbarButton
          label="Characters"
          icon="◎"
          onClick={() => switchView('characters')}
          active={viewMode === 'characters'}
          accent={viewMode === 'characters' ? '#ea580c' : undefined}
          title="Splay the characters out to read their relationships; events step aside"
        />
        {/* "Outline" is the writer-facing name (the step outline: scenes in
            story order); the internal viewMode key stays 'throughline'. */}
        <ToolbarButton
          label="Outline"
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
              <path d="M12 3v18" />
              <path d="M8 7l4-4 4 4" />
              <path d="M8 17l4 4 4-4" />
            </svg>
          }
          onClick={() => switchView('throughline')}
          active={viewMode === 'throughline'}
          accent={viewMode === 'throughline' ? '#ea580c' : undefined}
          title="Your step outline: scenes in story order"
        />
        {/* Throughline sub-layout — column (spine + threads) | grid (the
            writers-room wall: reading-order notecards wrapping into rows). */}
        {viewMode === 'throughline' && (
          <div
            style={{
              display: 'flex', gap: 2, padding: 2, borderRadius: 8,
              border: `1px solid ${dark ? '#2a2a30' : '#e8e0d2'}`,
              background: dark ? '#101013' : '#faf6ee',
            }}
          >
            {(['column', 'grid'] as const).map((m) => {
              const active = throughlineLayout === m;
              return (
                <button
                  key={m}
                  onClick={() => switchThroughlineLayout(m)}
                  title={m === 'column'
                    ? 'One vertical spine in story order, arc threads alongside'
                    : 'The writers-room wall: numbered notecards in reading order, wrapping into rows'}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 6,
                    padding: '4px 9px', fontSize: 11, fontWeight: active ? 800 : 600,
                    fontFamily: 'system-ui, sans-serif',
                    background: active ? '#ea580c' : 'transparent',
                    color: active ? '#fff' : dark ? 'rgba(255,255,255,0.66)' : '#555',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {m === 'column' ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                      <rect x="7" y="3" width="10" height="5" rx="1" />
                      <rect x="7" y="10" width="10" height="5" rx="1" />
                      <rect x="7" y="17" width="10" height="5" rx="1" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                      <rect x="3" y="3" width="8" height="6" rx="1" />
                      <rect x="13" y="3" width="8" height="6" rx="1" />
                      <rect x="3" y="12" width="8" height="6" rx="1" />
                      <rect x="13" y="12" width="8" height="6" rx="1" />
                    </svg>
                  )}
                  {m === 'column' ? 'Column' : 'Grid'}
                </button>
              );
            })}
          </div>
        )}
        {aliveEntities.some((e) => e.type === 'sequence') && viewMode !== 'characters' && (
          <ToolbarButton
            label={hideSequences ? 'Show sequences' : 'Hide sequences'}
            icon={
              hideSequences ? (
                // eye-off — sequences currently hidden
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                // eye — sequences currently shown
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )
            }
            onClick={() => setHideSequences((v) => !v)}
            active={hideSequences}
            accent={hideSequences ? '#ea580c' : undefined}
            title="Hide the sequence containers to see just the event scenes"
          />
        )}
        <ToolbarButton
          label="Script"
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6" />
              <path d="M9 17h6" />
            </svg>
          }
          onClick={() => storyId && routerNavigate(`/freeform/${storyId}/script`)}
          title="Write the screenplay: your scenes in story order, ready to draft"
        />
        <ToolbarButton
          label="Arrange"
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
              <path d="M21 6H3" />
              <path d="M15 12H3" />
              <path d="M9 18H3" />
            </svg>
          }
          onClick={arrangeChronologically}
          title="Re-stack the board: events in story (PRECEDES) order. Overrides manual card positions."
        />
        {isMockMode && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', padding: '0 6px' }}>
            MOCK DATA
          </span>
        )}
        <div style={{ flex: 1 }} />

        <ToolbarButton
          label={deletedEntities.length > 0 ? `Trash · ${deletedEntities.length}` : 'Trash'}
          icon={
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
              <path
                d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
            </svg>
          }
          onClick={() => setTrashOpen(true)}
          disabled={deletedEntities.length === 0}
          title={
            deletedEntities.length === 0
              ? 'No deleted cards'
              : `${deletedEntities.length} deleted card${deletedEntities.length === 1 ? '' : 's'}, view and restore`
          }
        />
        <ToolbarButton
          label={
            braindumpPhase === 'extracting' || braindumpPhase === 'submitting'
              ? 'Braindump · running'
              : 'Braindump'
          }
          icon={
            braindumpPhase === 'extracting' || braindumpPhase === 'submitting' ? (
              <span
                style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#ea580c',
                  display: 'inline-block', animation: 'cb-pulse 1.2s ease-in-out infinite',
                }}
              />
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: 'block' }}
              >
                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
                <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
                <path d="M6 18a4 4 0 0 1-1.967-.516" />
                <path d="M19.967 17.484A4 4 0 0 1 18 18" />
              </svg>
            )
          }
          onClick={() => setBraindumpOpen((v) => !v)}
          active={braindumpOpen}
          accent={
            braindumpOpen || braindumpPhase === 'extracting' || braindumpPhase === 'submitting'
              ? '#ea580c'
              : undefined
          }
          title="Dump an idea; extraction turns it into cards (⌘↵ to process)"
        />
        <ToolbarButton
          label="Import"
          tourId="toolbar-import"
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
          }
          onClick={() => scriptInputRef.current?.click()}
          title="Import a PDF screenplay; its text is extracted into cards (or drop one anywhere on the board)"
        />
        <input
          ref={scriptInputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleScriptFile(f);
            e.currentTarget.value = '';
          }}
        />
        <ToolbarButton
          label={arcSuggestions.length > 0 ? `Panel · ${arcSuggestions.length}` : 'Panel'}
          icon="ⓘ"
          onClick={() => setRightPanelOpen(true)}
          accent={arcSuggestions.length > 0 ? getEntityColor('arc') : undefined}
          title="Open the side panel: suggestions, information, arcs"
        />

        <div style={{ position: 'relative' }}>
          <ToolbarButton
            label="New"
            icon="+"
            tourId="toolbar-new"
            trailing={
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', opacity: 0.75 }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            }
            onClick={() => setNewMenuOpen((v) => !v)}
            active={newMenuOpen}
            title="Create a card manually (without braindump)"
          />
          {newMenuOpen && (
            <>
              <div
                onClick={() => setNewMenuOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 50,
                  background: 'transparent',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 51,
                  minWidth: 150,
                  background: dark ? '#1a1a1e' : '#fff',
                  border: dark ? '1px solid #2a2a30' : '1px solid #e3e5ea',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(15,18,30,0.12)',
                  padding: 5,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {(['character', 'event', 'location', 'arc'] as CreateModalKind[]).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => openCreateModal(kind)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      padding: '7px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: dark ? '#d6d6de' : '#2c3140',
                      cursor: 'pointer',
                      borderRadius: 6,
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f5f7')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: getEntityColor(kind), flexShrink: 0,
                      }}
                    />
                    {kind.charAt(0).toUpperCase() + kind.slice(1)}
                  </button>
                ))}
                <button
                  onClick={openCreateInfoModal}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: '7px 10px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: dark ? '#d6d6de' : '#2c3140',
                    cursor: 'pointer',
                    borderRadius: 6,
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f5f7')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  title="A story fact — established in a scene, trackable by who knows it"
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: INFO_ACCENT, flexShrink: 0 }} />
                  Information
                </button>
              </div>
            </>
          )}
        </div>

        {/* Demo-project reset — only on demo_ projectIds (server-side gate
            requires this prefix anyway). Two-click confirm to avoid accidents. */}
        {storyId?.startsWith('demo_') && auth && (
          <ResetProjectButton
            projectId={storyId}
            token={auth.token}
            onCleared={async () => {
              // Wipe all local UI state tied to the project so the canvas is
              // truly fresh — refetch entities + clear layout/peer/sheet state.
              setExpandedCardId(null);
              setPeerForCardId(null);
              setSheetCardId(null);
              setTrashOpen(false);
              setPositions({});
              setLayouts({});
              setCardQuestionsCache({});
              setCompletedResponseIds(new Set());
              await refreshEntities();
            }}
          />
        )}

        {/* Theme toggle — moon in light mode (switch to dark), sun in dark. */}
        <ToolbarButton
          label=""
          icon={dark ? SunIcon : MoonIcon}
          onClick={toggleTheme}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        />

        {toolbarStuck && (
          <>
            <div style={{ width: 1, height: 18, background: dark ? '#26262b' : '#ece5d7', margin: '0 2px' }} />
            <ToolbarButton
              label="Top"
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              }
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              title="Jump back to the top of the board"
            />
            <ToolbarButton
              label="Hide"
              icon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ display: 'block' }}
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              }
              onClick={() => setToolbarHidden(true)}
              title="Hide the toolbar while scrolling; a small tab stays top-right"
            />
          </>
        )}
      </div>
      )}
      </div>

      {/* Mini tab — replaces the hidden floating toolbar: re-show + jump-to-top. */}
      {toolbarStuck && toolbarHidden && (
        <div
          style={{
            position: 'fixed', top: 12, right: 24, zIndex: 140,
            display: 'flex', gap: 6,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            title="Jump back to the top of the board"
            style={{
              width: 32, height: 32, borderRadius: 16,
              border: dark ? '1px solid #2a2a30' : '1px solid #ece5d7',
              background: dark ? '#1a1a1e' : '#fff', color: dark ? '#c8c8d0' : '#3d4250',
              fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
              boxShadow: dark ? '0 4px 14px rgba(0,0,0,0.5)' : '0 4px 14px rgba(120,90,40,0.14)',
            }}
          >
            ↑
          </button>
          <button
            onClick={() => setToolbarHidden(false)}
            title="Show the toolbar"
            style={{
              width: 32, height: 32, borderRadius: 16,
              border: dark ? '1px solid #2a2a30' : '1px solid #ece5d7',
              background: dark ? '#1a1a1e' : '#fff', color: dark ? '#c8c8d0' : '#3d4250',
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: dark ? '0 4px 14px rgba(0,0,0,0.5)' : '0 4px 14px rgba(120,90,40,0.14)',
            }}
          >
            ☰
          </button>
        </div>
      )}

      <BraindumpDock
        open={braindumpOpen}
        text={braindumpText}
        setText={setBraindumpText}
        phase={braindumpPhase}
        message={braindumpMsg}
        onSubmit={onSubmitBraindump}
        onClose={() => setBraindumpOpen(false)}
        onFocusChange={setBraindumpFocused}
        floating={
          toolbarStuck
            ? { top: 12 + toolbarBox.height, left: toolbarBox.left, width: toolbarBox.width }
            : null
        }
      />

      {/* Staged braindump meter (draggable) — shown while any braindump extracts,
          not just the wow. Streamed-card count, then edge/throughline wiring. */}
      {edgesGenerating && (
        <BraindumpMeter
          aliveCount={Math.max(0, aliveEntities.length - cardCountAtSubmitRef.current)}
          edgeCount={Math.max(0, edgeCountOf(data) - edgeCountAtSubmitRef.current)}
          winPhase={winPhase}
          winProg={winProg}
          elapsedMs={winElapsed}
        />
      )}

      {/* In-board zoom control — a small floating segmented control at the board's
          bottom-right (the canonical canvas-zoom spot, reads as part of the board).
          Discrete levels only; page scroll still pans. */}
      <div
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 130,
          display: 'flex', alignItems: 'center', gap: 2, padding: 3,
          borderRadius: 10, userSelect: 'none',
          background: dark ? 'rgba(20,21,26,0.92)' : 'rgba(255,255,255,0.94)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
          fontFamily: 'system-ui, sans-serif', fontSize: 12, fontWeight: 600,
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((z) => {
          const active = Math.abs(zoom - z) < 0.005;
          return (
            <button
              key={z}
              onClick={() => setZoom(z)}
              title={`Zoom ${Math.round(z * 100)}%`}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 7,
                padding: '5px 9px', minWidth: 40,
                background: active ? '#ff6b35' : 'transparent',
                color: active ? '#fff' : dark ? 'rgba(255,255,255,0.72)' : '#333',
                fontWeight: active ? 800 : 600,
              }}
            >
              {Math.round(z * 100)}%
            </button>
          );
        })}
      </div>

      {/* Top-of-page background-work toast — a peer answer still being woven in.
          Reassures the writer that work is happening instead of a card sitting
          silently on "extracting". */}
      {bgProcessing && (
        <div
          style={{
            position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9994, display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 16px', borderRadius: 999,
            background: dark ? 'rgba(20,21,26,0.96)' : 'rgba(255,255,255,0.97)',
            border: dark ? '1px solid #2a2a30' : '1px solid #e2e8f0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            fontFamily: 'system-ui, sans-serif', pointerEvents: 'none',
          }}
        >
          <span
            style={{
              width: 13, height: 13, borderRadius: 999, flexShrink: 0,
              border: '2px solid rgba(234,88,12,0.3)', borderTopColor: '#ea580c',
              display: 'inline-block', animation: 'cb-spin 0.8s linear infinite',
            }}
          />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: dark ? '#e6e6ea' : '#333' }}>
            {bgProcessingLabel}
          </span>
        </div>
      )}

      {/* FIL-506 — corkboard half of the wow (review sample → reveal → spotlight → peer). */}
      <WowFlow
        active={wowActive}
        data={data}
        braindumpPhase={braindumpPhase}
        onPrefillSample={(text) => {
          setBraindumpText(text);
          setBraindumpOpen(true);
        }}
        onSetPanel={(open) => setRightPanelOpen(open)}
        onOpenPanelSection={(id) => { setRightPanelOpen(true); setPanelForceSection(id); }}
        onTourGate={setTourGate}
        onHighlightTie={setWowTie}
        onOpenSheet={(id) => setSheetCardId(id)}
        sheetOpenId={sheetCardId}
        expandedCardId={expandedCardId}
        peerOpenCardId={peerForCardId}
        submissionCount={submissionCount}
        onComplete={completeWow}
      />

      <div
        ref={canvasRef}
        onMouseDown={onCanvasMouseDown}
        className="cb-noselect"
        style={{
          position: 'relative',
          width: canvasW,
          height: canvasH,
          // In-board zoom: CSS `zoom` scales the whole board and its used size, so
          // page scroll still pans and fixed chrome (toolbar/panels) is untouched.
          zoom,
          // Zoomed out, the shrunk board CENTERS in the viewport instead of
          // hugging the left edge (auto margins compute on the zoomed layout
          // size; coordinate math already reads rect.left, so drags stay exact).
          margin: zoom < 0.999 ? '0 auto' : undefined,
          // The board surface — JUST the dot grid (subtle, scrolls with the
          // board). The lamp + vignette wash is global on the Shell and reads
          // through the board's transparent fill, so the gradient is seamless
          // across toolbar, margins, and board. Light: dots over a translucent
          // white veil over the Shell's cream wash.
          backgroundImage: dark
            ? 'radial-gradient(circle, rgba(255,107,53,0.18) 1px, transparent 1px)'
            : 'radial-gradient(circle, rgba(234,88,12,0.16) 1px, transparent 1.4px)',
          backgroundSize: dark ? '40px 40px' : '26px 26px',
          backgroundPosition: '8px 8px',
          backgroundColor: dark ? 'transparent' : 'rgba(255,255,255,0.6)',
          border: dark ? '1px solid #232328' : '1px solid #f0e8da',
          borderRadius: 10,
          boxShadow: dark
            ? 'none'
            : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 6px rgba(120,90,40,0.05)',
          overflow: 'hidden',
          userSelect: 'none',
          cursor: draggingId ? 'grabbing' : 'default',
        }}
      >
        {/* SVG overlay — PRECEDES + structural connectors. Sits behind cards
            (rendered first, lower z-index). pointer-events: none so it
            doesn't block card drags. Dimmed during focus mode. */}
        <ConnectorLayer
          width={canvasW}
          height={canvasH}
          entities={aliveEntities}
          positions={positions}
          edges={gridActive ? { ...data.edges, precedes: [], sequence_precedes: [] } : data.edges}
          expandedCardId={expandedCardId}
          hoveredCardId={hoveredCardId}
          forcedTie={wowTie}
          expandedCardH={expandedCardH}
          focusMode={peerForCardId !== null}
          hiddenIds={ballEffects.hiddenIds}
          displacements={ballEffects.displacements}
          overrides={connectorOverrides}
          linkDrag={linkDrag}
          onRemovePrecedes={onRemovePrecedes}
          onRemoveCauses={onRemoveCauses}
          relMidpoints={relMidpoints}
          reifiedPairs={reifiedPairs}
          onEditStructural={openStructuralEditor}
          arcThreadGeo={arcThreadGeo}
          backstorySplit={viewMode === 'throughline'}
          sequenceBoxRects={new Map(ballEffects.sequenceBoxes.map((b) => [b.seqId, { x: b.x, y: b.y, w: b.w, h: b.h }]))}
        />
        {/* Throughline grid — cosmetic reading-order chevrons in the gaps
            between same-row neighbors. Non-interactive eye-guides only. */}
        {ballEffects.gridArrows.length > 0 && (
          <svg
            width={canvasW}
            height={canvasH}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 0 }}
          >
            {ballEffects.gridArrows.map((a, i) => (
              <path
                key={`gridarrow-${i}`}
                d={`M ${a.x - 3} ${a.y - 5} L ${a.x + 3} ${a.y} L ${a.x - 3} ${a.y + 5}`}
                fill="none"
                stroke={dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.28)'}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        )}
        {/* Throughline grid — sequence overlays draped over the cohesive wall:
            a tinted region traced around each sequence's member cells (rows
            fuse into one shape), name chip riding the top border. Renders
            behind the cards; the chip opens the sequence's full sheet. */}
        {ballEffects.gridSeqRegions.length > 0 && (
          <svg
            width={canvasW}
            height={canvasH}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 0 }}
          >
            {ballEffects.gridSeqRegions.map((g) => (
              <path
                key={`gridseq-${g.runKey}`}
                d={gridRegionPath(g.spans)}
                fill={hexToRgba(g.color, 0.05)}
                stroke={hexToRgba(g.color, 0.45)}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ))}
          </svg>
        )}
        {ballEffects.gridSeqRegions.filter((g) => g.labeled).map((g) => {
          const hovered = hoveredSeqId === g.seqId;
          const seqEnt = data.entities.find((e) => e.id === g.seqId);
          const summary = (seqEnt?.summary ?? seqEnt?.description ?? '').trim();
          const chipX = g.spans[0].x0 + 12;
          const chipY = g.spans[0].y0 - 10;
          return (
            <React.Fragment key={`gridseqlbl-${g.seqId}`}>
              <div
                onClick={() => setSheetCardId(g.seqId)}
                onMouseEnter={() => enterSeqHover(g.seqId)}
                onMouseLeave={() => leaveSeqHover(g.seqId)}
                title="Open the sequence"
                style={{
                  position: 'absolute', left: chipX, top: chipY,
                  zIndex: 2, cursor: 'pointer', padding: '2px 9px', borderRadius: 999,
                  fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5,
                  fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap',
                  maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
                  background: dark ? '#141417' : '#fff',
                  border: `1px solid ${hexToRgba(g.color, 0.55)}`,
                  color: g.color,
                }}
              >
                {g.name || 'Sequence'}
              </div>
              {/* Hover card — same header card the master container shows,
                  dropped below the chip. */}
              <div
                onMouseEnter={() => enterSeqHover(g.seqId)}
                onMouseLeave={() => leaveSeqHover(g.seqId)}
                style={{
                  position: 'absolute', left: chipX, top: chipY + 26,
                  width: 250, zIndex: 33,
                  background: dark ? '#1a1a1e' : '#fff',
                  border: `1px solid ${hexToRgba(g.color, 0.4)}`, borderRadius: 10,
                  padding: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
                  opacity: hovered ? 1 : 0,
                  transform: hovered ? 'translateY(0)' : 'translateY(-6px)',
                  pointerEvents: hovered ? 'auto' : 'none',
                  transition: 'opacity 150ms ease, transform 150ms ease',
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: g.color, fontWeight: 700, marginBottom: 4 }}>
                  Sequence · {g.count} scene{g.count === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e6e6ea' : '#1a1a1a', marginBottom: summary ? 6 : 8, lineHeight: 1.3 }}>
                  {g.name || 'Sequence'}
                </div>
                {summary && (
                  <p style={{ fontSize: 11.5, lineHeight: 1.5, color: dark ? '#aeaeb6' : '#555', margin: '0 0 8px' }}>
                    {summary.length > 170 ? summary.slice(0, 170) + '…' : summary}
                  </p>
                )}
                <button
                  onClick={() => setSheetCardId(g.seqId)}
                  style={{
                    height: 26, padding: '0 12px', borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${hexToRgba(g.color, 0.5)}`, background: hexToRgba(g.color, 0.14),
                    color: g.color, fontSize: 11.5, fontWeight: 600,
                  }}
                >
                  Open ↗
                </button>
              </div>
            </React.Fragment>
          );
        })}
        {/* Sequence containers — the box wraps its freely-draggable member scenes
            (events are the focus); the sequence shows as a minimal name label that
            reveals a header on hover. Box renders behind the cards (DOM order). */}
        {ballEffects.sequenceBoxes.map((b) => {
          const seqEnt = data.entities.find((e) => e.id === b.seqId);
          const hovered = hoveredSeqId === b.seqId;
          // Suppress the box's grow/shrink transition during ANY live drag that
          // moves it — the container drag (draggingSeqId) OR an individual member
          // scene being dragged (draggingId ∈ members) — so the border tracks 1:1
          // instead of trailing the cards and catching up at the end.
          const memberDragging = !!draggingId && (data.edges?.contains ?? []).some((c) => c.from === b.seqId && c.to === draggingId);
          const liveMove = draggingSeqId === b.seqId || memberDragging;
          // Opaque tinted header bg (tint layered over a solid surface) so PRECEDES
          // arrows passing behind the header don't show through it.
          const headerBg = `linear-gradient(${hexToRgba(b.color, 0.18)}, ${hexToRgba(b.color, 0.18)}), ${theme === 'dark' ? '#1a1a1e' : '#fff'}`;
          // Link-drag target: the box is the current drop target while dragging an
          // arrow over it → highlight the border + a ring so the writer sees it.
          const isLinkTarget = !!linkDrag?.moved && linkDrag.overCardId === b.seqId && linkDrag.fromCardId !== b.seqId;
          const HEADER_W = 250;
          const boardW = typeof window !== 'undefined' ? window.innerWidth : 1400;
          const slideLeft = boardW - (b.x + b.w) < HEADER_W + 40;
          const summary = (seqEnt?.summary ?? seqEnt?.description ?? '').trim();
          const onEnter = () => enterSeqHover(b.seqId);
          const onLeave = () => leaveSeqHover(b.seqId);
          return (
            <React.Fragment key={`seqbox-${b.seqId}`}>
              <div
                // Same anchor the member-less SequenceCompact card uses, so the
                // wow tour's sequence beat resolves whether the sequence renders
                // as a card or (once it has a member scene) as this container.
                data-tour={`card-${b.seqId}`}
                onMouseDown={b.collapsed ? undefined : (e) => onSeqContainerMouseDown(e, b.seqId)}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                style={{
                  position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h,
                  border: `${isLinkTarget ? 2.5 : 1.5}px ${b.collapsed ? 'dashed' : 'solid'} ${hexToRgba(b.color, hovered || isLinkTarget || draggingSeqId === b.seqId ? 0.9 : 0.4)}`,
                  borderRadius: 14, background: hexToRgba(b.color, isLinkTarget ? 0.14 : draggingSeqId === b.seqId ? 0.1 : 0.05),
                  boxShadow: isLinkTarget ? `0 0 0 4px ${hexToRgba(b.color, 0.22)}` : undefined,
                  // Expanded: the whole box is a drag surface (the dead area moves
                  // the container); the member cards sit above it (higher z / later
                  // in the DOM) so they stay interactive. Collapsed: click-through.
                  pointerEvents: b.collapsed ? 'none' : 'auto',
                  cursor: b.collapsed ? 'default' : 'move',
                  zIndex: 0,
                  // Entrance: scale up from the top-left so a sequence becoming a
                  // container expands out of the card's spot instead of popping.
                  // Plays once when the box element mounts (conversion / load).
                  animation: b.collapsed ? undefined : 'cb-seqbox-in 260ms cubic-bezier(0.22,1,0.36,1)',
                  transformOrigin: 'top left',
                  // Grow/shrink in place on collapse/expand (top-left stays put), so
                  // the container animates instead of popping. Suppressed while
                  // dragging this box so the move tracks the cursor 1:1.
                  transition: liveMove
                    ? 'none'
                    : 'width 220ms cubic-bezier(0.22,1,0.36,1), height 220ms cubic-bezier(0.22,1,0.36,1), left 220ms cubic-bezier(0.22,1,0.36,1), top 220ms cubic-bezier(0.22,1,0.36,1), border-color 140ms ease',
                }}
              />
              {/* Border drag-strips — drag any edge to move the whole container.
                  Only the ~10px edges are handles; the interior stays click-through
                  so the member scene cards remain interactive. */}
              {!b.collapsed && ([
                { k: 't', x: b.x, y: b.y, w: b.w, h: 10 },
                { k: 'b', x: b.x, y: b.y + b.h - 10, w: b.w, h: 10 },
                { k: 'l', x: b.x, y: b.y, w: 10, h: b.h },
                { k: 'r', x: b.x + b.w - 10, y: b.y, w: 10, h: b.h },
              ]).map((s) => (
                <div
                  key={s.k}
                  onMouseDown={(e) => onSeqContainerMouseDown(e, b.seqId)}
                  style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h, cursor: 'move', zIndex: 1 }}
                />
              ))}
              {/* Minimal label = drag handle (header text). Toggle stays a click;
                  open the sheet from the hover header's "Open ↗". */}
              <div
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                onMouseDown={(e) => onSeqContainerMouseDown(e, b.seqId)}
                title="Drag to move the sequence"
                style={{ position: 'absolute', left: b.x + 10, top: b.y + 6, zIndex: 32, display: 'flex', alignItems: 'center', gap: 6, cursor: 'move' }}
              >
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSequenceCollapsed((c) => ({ ...c, [b.seqId]: !b.collapsed }))}
                  title={b.collapsed ? 'Expand sequence' : 'Collapse sequence'}
                  style={{
                    height: 20, minWidth: 20, padding: '0 5px', borderRadius: 6,
                    border: `1px solid ${hexToRgba(b.color, 0.4)}`, background: headerBg,
                    color: b.color, fontSize: 11, fontWeight: 700, lineHeight: 1, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                  }}
                >
                  {b.collapsed ? `▸ ${b.count}` : '▾'}
                </button>
                <span
                  style={{
                    maxWidth: 220, height: 20, padding: '0 8px', borderRadius: 6,
                    background: headerBg, color: b.color,
                    fontSize: 11, fontWeight: 600, lineHeight: '20px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: 'inline-block', userSelect: 'none',
                  }}
                >
                  {b.name || 'Sequence'}
                </span>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSheetCardId(b.seqId)}
                  title="Open full sequence card"
                  style={{
                    height: 20, width: 22, borderRadius: 6,
                    border: `1px solid ${hexToRgba(b.color, 0.4)}`, background: headerBg,
                    color: b.color, fontSize: 12, fontWeight: 700, lineHeight: 1, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ↗
                </button>
              </div>
              {/* Hover header — slides out to the side with available space. */}
              <div
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                style={{
                  position: 'absolute', top: b.y,
                  left: slideLeft ? b.x - HEADER_W - 10 : b.x + b.w + 10,
                  width: HEADER_W, zIndex: 33,
                  background: dark ? '#1a1a1e' : '#fff',
                  border: `1px solid ${hexToRgba(b.color, 0.4)}`, borderRadius: 10,
                  padding: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
                  opacity: hovered ? 1 : 0,
                  transform: hovered ? 'translateX(0)' : `translateX(${slideLeft ? 8 : -8}px)`,
                  pointerEvents: hovered ? 'auto' : 'none',
                  transition: 'opacity 150ms ease, transform 150ms ease',
                }}
              >
                <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: b.color, fontWeight: 700, marginBottom: 4 }}>
                  Sequence · {b.count} scene{b.count === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e6e6ea' : '#1a1a1a', marginBottom: summary ? 6 : 8, lineHeight: 1.3 }}>
                  {b.name || 'Sequence'}
                </div>
                {summary && (
                  <p style={{ fontSize: 11.5, lineHeight: 1.5, color: dark ? '#aeaeb6' : '#555', margin: '0 0 8px' }}>
                    {summary.length > 170 ? summary.slice(0, 170) + '…' : summary}
                  </p>
                )}
                <button
                  onClick={() => setSheetCardId(b.seqId)}
                  style={{
                    height: 26, padding: '0 12px', borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${hexToRgba(b.color, 0.5)}`, background: hexToRgba(b.color, 0.14),
                    color: b.color, fontSize: 11.5, fontWeight: 600,
                  }}
                >
                  Open ↗
                </button>
              </div>
            </React.Fragment>
          );
        })}
        {aliveEntities.map((entity) => {
          if (ballEffects.hiddenIds.has(entity.id)) return null;
          // A sequence that owns scenes is a container: the full card is replaced
          // by the minimal name label rendered in the box layer above.
          if (ballEffects.minimizedSeqIds.has(entity.id)) return null;
          // Reified relationships render at the midpoint of their two
          // characters (tracking them), not at a stored position.
          const relMid = relMidpoints.get(entity.id);
          // Hide the bubble until it has clear space (no overlap at the midpoint).
          if (relMid && expandedCardId !== entity.id && relOccluded.has(entity.id)) return null;
          // Arcs with a thread ride a ball anchored ON the thread (instead of a
          // free-floating card).
          const arcBall = entity.type === 'arc' ? arcBallById.get(entity.id) : undefined;
          const naturalPos = positions[entity.id];
          if (!naturalPos && !relMid && !arcBall) return null;
          const expanded = expandedCardId === entity.id;
          const override = ballEffects.overrides.get(entity.id);
          const displacement = ballEffects.displacements.get(entity.id);
          let renderPos: Pos;
          if (relMid) {
            renderPos = { x: relMid.x, y: relMid.y };
          } else if (arcBall) {
            // Center the ball (or, when expanded, the card) on the thread anchor.
            // While scrolling it's a small dot; at rest, the labeled pill.
            const compactBall = (arcsMoving || !!draggingId || !!draggingSeqId) && !expanded;
            const bw = expanded ? EXPANDED_W : compactBall ? ARC_DOT : ARC_BALL_W;
            const bh = expanded ? (expandedCardH > 0 ? expandedCardH : 200) : compactBall ? ARC_DOT : ARC_BALL_H;
            renderPos = { x: arcBall.pos.x - bw / 2, y: arcBall.pos.y - bh / 2 };
          } else if (override) {
            renderPos = override.pos;
          } else if (displacement) {
            renderPos = { x: naturalPos!.x + displacement.dx, y: naturalPos!.y + displacement.dy };
          } else {
            renderPos = naturalPos!;
          }
          // Board-native focus mode: the focal card glides to the anchor;
          // cards in the cleared zone shift sideways (transient, animated).
          const isFocalCard = peerForCardId === entity.id;
          if (isFocalCard && peerFocusPos) {
            renderPos = peerFocusPos;
          } else {
            const pd = peerClear.get(entity.id);
            if (pd) renderPos = pd;
          }
          return (
            <CardBox
              key={entity.id}
              entity={entity}
              pos={renderPos}
              expanded={expanded}
              isDragging={draggingId === entity.id}
              hasPeerOpen={peerForCardId === entity.id}
              isFocusMode={peerForCardId !== null}
              isFocal={isFocalCard}
              signal={signals[entity.id]}
              cardQuestions={expanded ? cardQuestionsCache[entity.id] : undefined}
              auth={auth}
              projectId={storyId}
              completedResponseIds={completedResponseIds}
              animatePosition={!!(override || displacement || relMid || (arcBall && !draggingId && !draggingSeqId) || peerClear.has(entity.id) || (isFocalCard && peerFocusPos) || focusExiting)}
              ballColor={arcBall?.color}
              ballCompact={!!arcBall && (arcsMoving || !!draggingId || !!draggingSeqId) && !expanded}
              processing={edgesGenerating && !expanded}
              onMouseDown={(e) => { if (tourBlocks('expand')) return; onCardMouseDown(e, entity.id); }}
              sceneNo={entity.type === 'event' ? sceneNoById.get(entity.id) : undefined}
              onHoverChange={
                entity.type === 'character'
                  ? (hovering) => setHoveredCardId((cur) => (hovering ? entity.id : cur === entity.id ? null : cur))
                  : undefined
              }
              onLinkHandleMouseDown={
                // The grid wall is about the order that's already set — no
                // drag-to-connect there (write PRECEDES from column/master).
                tourGate.active || gridActive
                  ? undefined
                  : entity.type === 'event' || entity.type === 'character'
                  ? (e) => onLinkHandleMouseDown(e, entity.id)
                  : undefined
              }
              isLinkSource={linkDrag?.fromCardId === entity.id}
              isLinkTarget={
                !!linkDrag &&
                linkDrag.moved &&
                linkDrag.overCardId === entity.id &&
                linkDrag.fromCardId !== entity.id
              }
              isSelected={selectedEventIds.has(entity.id)}
              isArcHighlighted={
                !!highlightedArcId &&
                (entity.id === highlightedArcId ||
                  (entity.type === 'event' &&
                    (data?.edges.evokes ?? []).some(
                      (ev) =>
                        ev.event_id === entity.id && ev.arc_id === highlightedArcId,
                    )))
              }
              onAskPeer={() => { if (tourBlocks('ask')) return; setPeerForCardId(entity.id); }}
              onOpenSheet={() => { if (tourBlocks('fullcard')) return; setSheetCardId(entity.id); }}
              onDelete={() => { if (tourGate.active) return; onDeleteCard(entity.id); }}
              onRename={(newName) => { if (tourGate.active) return Promise.resolve(); return onRenameCard(entity.id, newName); }}
              onUpdateDescription={(d) => { if (tourGate.active) return Promise.resolve(); return onUpdateDescription(entity.id, d); }}
              onChangeNarrativeStatus={(next) => { if (tourGate.active) return; onChangeNarrativeStatus(entity.id, next); }}
              onQuestionsChanged={() => refreshCardQuestions(entity.id)}
              cardRef={(el) => {
                cardRefs.current[entity.id] = el;
              }}
            />
          );
        })}
        {/* R4 — structural-tie edit popover, anchored at the clicked edge's
            midpoint. Relabel / promote-to-relationship / delete. */}
        {editStructural && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: editStructural.mx,
              top: editStructural.my,
              transform: 'translate(-50%, 10px)',
              zIndex: 130,
              width: 252,
              background: dark ? '#1a1a1e' : '#fff',
              border: dark ? '1px solid #2a2a30' : '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
              padding: 12,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>
                {editStructural.isNew ? 'Label this tie' : 'Edit tie'}
              </span>
              <button onClick={closeStructuralEditor} style={{ border: 'none', background: 'none', cursor: 'pointer', color: dark ? '#63636d' : '#bbb', fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <input
              value={structDraft}
              onChange={(e) => setStructDraft(e.target.value)}
              placeholder="e.g. mentor of, rival, sibling"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && structDraft.trim() && !structBusy) {
                  runStructural(() => setStructuralEdge({ projectId: storyId!, fromId: editStructural.from, toId: editStructural.to, predicate: structDraft.trim() }, auth!.token));
                }
              }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, border: dark ? '1px solid #2a2a30' : '1px solid #e2e8f0', borderRadius: 6, outline: 'none', color: dark ? '#e6e6ea' : '#222' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <button
                disabled={structBusy || !structDraft.trim()}
                onClick={() => runStructural(() => setStructuralEdge({ projectId: storyId!, fromId: editStructural.from, toId: editStructural.to, predicate: structDraft.trim() }, auth!.token))}
                style={{ padding: '5px 12px', fontSize: 11.5, fontWeight: 500, border: 'none', borderRadius: 6, background: structBusy || !structDraft.trim() ? '#eee' : PEER_BLUE, color: structBusy || !structDraft.trim() ? '#999' : '#fff', cursor: structBusy || !structDraft.trim() ? 'not-allowed' : 'pointer' }}
              >
                Save
              </button>
              <button
                disabled={structBusy}
                onClick={() => runStructural(() => promoteStructuralToRelationship({ projectId: storyId!, fromId: editStructural.from, toId: editStructural.to, kind: structDraft.trim() || undefined }, auth!.token))}
                title="Turn this tie into a reified relationship card"
                style={{ padding: '5px 10px', fontSize: 11.5, fontWeight: 500, border: `1px solid ${hexToRgba(getEntityColor('relationship'), 0.5)}`, borderRadius: 6, background: dark ? '#1a1a1e' : '#fff', color: getEntityColor('relationship'), cursor: structBusy ? 'not-allowed' : 'pointer' }}
              >
                Promote ↗
              </button>
              <button
                disabled={structBusy}
                onClick={() => runStructural(() => deleteStructuralEdge({ projectId: storyId!, fromId: editStructural.from, toId: editStructural.to }, auth!.token))}
                style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11.5, fontWeight: 500, border: 'none', borderRadius: 6, background: 'none', color: '#dc2626', cursor: structBusy ? 'not-allowed' : 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
        {/* Category balls — Characters / Arcs / Locations / Backstory. Pinned
            to the top of the visible canvas (position:fixed → smooth as you
            scroll). Shown only when the category is balled (Locations/Backstory
            always; Characters/Arcs once scrolled past their cards). Drag to slide
            along the row; click to deal the members out into view. */}
        {ballEffects.clusters.map((c) => {
          if (!c.balled || c.count === 0) return null;
          const stored = c.pos ?? positions[c.id];
          if (!stored) return null;
          // Pinned → fixed at the viewport top; free → absolute at canvas pos
          // (a projection-specific c.pos wins over the stored draggable spot).
          const pos = c.pinned
            ? { x: canvasLeftPx + stored.x, y: stickyTopPx + BALL_RAIL_PAD }
            : { x: stored.x, y: stored.y };
          return (
            <BallChip
              key={c.id}
              label={c.label}
              noun={CLUSTER_META[c.id].noun}
              color={c.color}
              count={c.count}
              pos={pos}
              pinned={c.pinned}
              expanded={c.expanded}
              isDragging={draggingId === c.id}
              isFocusMode={peerForCardId !== null}
              onMouseDown={(e) => onCardMouseDown(e, c.id)}
            />
          );
        })}

        {/* Focus scrim — BOARD-scoped (inside the canvas, so the toolbar and
            panels stay live). Sits above ordinary cards (z 1/20), below the
            focal+peer pair (145). A blue ambient lamp radiates from the pair
            (the peer's analog of the orange dock glow) over a soft vignette.
            Pointer-events: none — dimmed cards already disable their own. */}
        {peerEntity && peerFocusPos && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: dark
                ? `radial-gradient(ellipse 880px 580px at ${peerFocusPos.x + (EXPANDED_W + PEER_GAP + PEER_CARD_W) / 2}px ${peerFocusPos.y + 280}px, ${hexToRgba(PEER_BLUE, 0.07)} 0%, transparent 60%), radial-gradient(ellipse 1100px 760px at ${peerFocusPos.x + (EXPANDED_W + PEER_GAP + PEER_CARD_W) / 2}px ${peerFocusPos.y + 280}px, rgba(8,9,13,0.26) 0%, rgba(8,9,13,0.44) 60%, rgba(8,9,13,0.58) 100%)`
                : `radial-gradient(ellipse 880px 580px at ${peerFocusPos.x + (EXPANDED_W + PEER_GAP + PEER_CARD_W) / 2}px ${peerFocusPos.y + 280}px, ${hexToRgba(PEER_BLUE, 0.06)} 0%, transparent 60%), radial-gradient(ellipse 1100px 760px at ${peerFocusPos.x + (EXPANDED_W + PEER_GAP + PEER_CARD_W) / 2}px ${peerFocusPos.y + 280}px, rgba(250,246,238,0.38) 0%, rgba(244,236,222,0.52) 60%, rgba(238,228,210,0.66) 100%)`,
              zIndex: 100,
              transition: 'opacity 280ms ease-out',
            }}
          />
        )}

        {peerEntity && peerPos && auth && storyId && (
          <FloatingPeerCard
            key={peerEntity.id}
            entity={peerEntity}
            projectId={storyId}
            userId={auth.userId}
            token={auth.token}
            pos={peerPos}
            onClose={() => setPeerForCardId(null)}
            completedResponseIds={completedResponseIds}
            onCardQuestionsChanged={() => refreshCardQuestions(peerEntity.id)}
            onCascadeFallbackRefresh={() => refreshEntitiesRef.current()}
            onResponseSubmitted={() => { setSubmissionCount((c) => c + 1); setPendingCascades((c) => c + 1); }}
          />
        )}
      </div>

      {/* Link-action toast — confirms drag-to-connect actions that leave no
          connector on the board (cast adds, structural ties), and surfaces link
          errors. Bottom-center, auto-clears. */}
      {(linkNotice || linkError) && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 160, padding: '10px 16px', borderRadius: 10,
            background: linkError ? (theme === 'dark' ? '#3a1d1d' : '#fee2e2') : (theme === 'dark' ? '#1c2a1f' : '#ecfdf3'),
            color: linkError ? (theme === 'dark' ? '#fca5a5' : '#b91c1c') : (theme === 'dark' ? '#86efac' : '#15803d'),
            border: `1px solid ${linkError ? (theme === 'dark' ? '#7f1d1d' : '#fecaca') : (theme === 'dark' ? '#2f5e2f' : '#bbf7d0')}`,
            fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            maxWidth: 440, textAlign: 'center',
          }}
          onClick={() => { setLinkNotice(null); setLinkError(null); }}
        >
          {linkError ?? linkNotice}
        </div>
      )}

      {/* Cascade toasts — top-right, stacked. z-index keeps them above
          canvas/peer but below the sheet overlay. Arc suggestions used to
          stack here too; they now live in a right-side drawer opened from
          the toolbar badge. */}
      {cascadeState.activeToasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 150,
            maxWidth: 380,
          }}
        >
          {cascadeState.activeToasts.map((toast) => (
            <CascadeToast
              key={toast.cardResponseId}
              newEntities={
                toast.crossCardLandings.length > 0
                  ? toast.crossCardLandings
                  : toast.newEntities
              }
              onCollapseToTray={() => cascadeState.dismissToast(toast.cardResponseId)}
              onViewDetails={() => cascadeState.openSummaryPanel(toast)}
            />
          ))}
        </div>
      )}

      {/* D'-9 — arc-suggestion right-side drawer. Toolbar badge toggles. */}
      {rightPanelOpen && (
        <RightPanel
          information={data.information ?? []}
          suggestions={arcSuggestions}
          arcs={aliveEntities.filter((e) => e.type === 'arc')}
          locations={aliveEntities.filter((e) => e.type === 'location')}
          occursIn={data.edges?.occurs_in ?? []}
          signals={signals}
          entities={aliveEntities}
          auth={auth}
          projectId={storyId ?? ''}
          onAcceptSuggestion={onAcceptArcSuggestion}
          onDismissSuggestion={onDismissArcSuggestion}
          onOpenCard={(cardId) => setSheetCardId(cardId)}
          onEntitiesChanged={refreshEntities}
          onClose={() => setRightPanelOpen(false)}
          openSection={panelForceSection}
        />
      )}

      {/* Recent updates tray — bottom-right corner. */}
      {cascadeState.trayEntries.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 140,
            maxWidth: 380,
          }}
        >
          <RecentUpdatesTray
            entries={cascadeState.trayEntries}
            onEntryClick={cascadeState.openSummaryPanel}
            onClearViewed={cascadeState.clearViewedFromTray}
          />
        </div>
      )}

      {/* Cascade summary panel — opens when writer clicks a toast or tray
          entry. Centered modal. */}
      {cascadeState.summaryPanelTarget && (
        <div
          onClick={cascadeState.closeSummaryPanel}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
            <CascadeSummaryPanel
              event={cascadeState.summaryPanelTarget}
              originatingCardLabel={resolveCardLabel(
                cascadeState.summaryPanelTarget.originatingCardId,
              )}
              onClose={cascadeState.closeSummaryPanel}
            />
          </div>
        </div>
      )}

      {/* Script-drop overlay — shown while a file is dragged over the board.
          pointer-events:none so the drop still reaches the window handler. */}
      {scriptDragOver && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 300, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: dark ? 'rgba(10,10,12,0.72)' : 'rgba(250,250,250,0.78)',
            backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              padding: '40px 56px', borderRadius: 18,
              border: `2px dashed ${hexToRgba('#ff6b35', 0.7)}`,
              background: dark ? 'rgba(23,23,27,0.85)' : 'rgba(255,255,255,0.9)',
              boxShadow: `0 0 60px ${hexToRgba('#ff6b35', 0.18)}`,
              textAlign: 'center', fontFamily: 'system-ui, sans-serif',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6" />
              <path d="m9 15 3-3 3 3" />
            </svg>
            <div style={{ fontSize: 17, fontWeight: 600, color: dark ? '#ededf1' : '#1d2230' }}>
              Drop your screenplay
            </div>
            <div style={{ fontSize: 12.5, color: dark ? '#9a9aa4' : '#777', maxWidth: 280, lineHeight: 1.5 }}>
              We’ll read the PDF and extract its scenes, characters, and locations into cards.
            </div>
          </div>
        </div>
      )}

      {/* Trash overlay (§9). */}
      {trashOpen && (
        <TrashOverlay
          entities={deletedEntities}
          onRestore={(cardId) => {
            onRestoreCard(cardId);
          }}
          onClose={() => setTrashOpen(false)}
        />
      )}

      {/* D'-8 — floating "Create arc from N events" action. Surfaces only
          when at least one Event is selected via shift / meta-click. */}
      {selectedEventIds.size > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 130,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: dark ? '#1a1a1e' : '#fff',
            border: `2px solid ${getEntityColor('arc')}`,
            borderRadius: 6,
            padding: '8px 12px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span style={{ fontSize: 12, color: dark ? '#c2c2ca' : '#444' }}>
            {selectedEventIds.size} event{selectedEventIds.size === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            onClick={openCreateArcFromEventsModal}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '5px 10px',
              borderRadius: 4,
              border: 'none',
              background: getEntityColor('arc'),
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif',
            }}
            title="Create a new Arc card from the selected events"
          >
            + Create arc
          </button>
          <button
            type="button"
            onClick={() => setSelectedEventIds(new Set())}
            style={{
              fontSize: 11,
              color: dark ? '#82828c' : '#888',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            title="Clear selection"
          >
            clear
          </button>
        </div>
      )}

      {/* D'-8 — "Create arc from N events" modal. */}
      {createArcFromEventsOpen && (
        <CreateArcFromEventsModal
          arcKind={createArcFromEventsKind}
          setArcKind={setCreateArcFromEventsKind}
          name={createArcFromEventsName}
          setName={setCreateArcFromEventsName}
          description={createArcFromEventsDesc}
          setDescription={setCreateArcFromEventsDesc}
          eventLabels={Array.from(selectedEventIds).map((id) => {
            const e = data?.entities.find((x) => x.id === id);
            return {
              id,
              label: e?.working_title ?? e?.working_name ?? id,
              narrativeStatus: e?.narrative_status,
            };
          })}
          submitting={createArcFromEventsSubmitting}
          error={createArcFromEventsError}
          onSubmit={onSubmitArcFromEvents}
          onCancel={closeCreateArcFromEventsModal}
        />
      )}

      {/* D'-10 — supersession modal opens when flipping an event to
          backstory would invalidate existing EVOKES per Q7. Writer picks
          per-arc resolution (demote to touches OR remove) before the
          flip commits. */}
      {supersession && (
        <SupersessionModal
          payload={supersession}
          eventTitle={
            data?.entities.find((e) => e.id === supersession.cardId)?.working_title ??
            data?.entities.find((e) => e.id === supersession.cardId)?.working_name ??
            supersession.cardId
          }
          onCancel={() => setSupersession(null)}
          onResolve={onResolveSupersession}
        />
      )}

      {/* Create-card modal (§7) — also handles Arc creation (D'-5) via the
          same chrome, with an ArcKind picker rendered when kind === 'arc'.
          For kind='event', surfaces a "Follows" picker so the new beat
          lands in the throughline immediately. */}
      {createKind && (
        <CreateCardModal
          kind={createKind}
          arcKind={createArcKind}
          setArcKind={setCreateArcKind}
          name={createName}
          setName={setCreateName}
          description={createDesc}
          setDescription={setCreateDesc}
          precededBy={createPrecededBy}
          setPrecededBy={setCreatePrecededBy}
          eventOptions={(data?.entities ?? [])
            .filter((e) => e.type === 'event' && !e.deleted_at)
            .map((e) => ({
              id: e.id,
              label: e.working_title ?? e.working_name ?? e.id,
              narrativeStatus: e.narrative_status,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))}
          submitting={createSubmitting}
          error={createError}
          collision={createCollision}
          onSubmit={onSubmitCreate}
          onOpenCollision={onOpenCollision}
          onCancel={closeCreateModal}
        />
      )}

      {/* + New → Information modal — fact summary + establishing scene. */}
      {createInfoOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setCreateInfoOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(20,20,20,0.32)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ width: 460, background: dark ? '#1a1a1e' : '#fff', borderRadius: 12, border: dark ? '1px solid #2a2a30' : '1px solid #ece5d7', boxShadow: '0 18px 50px rgba(15,18,30,0.22)', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: INFO_ACCENT }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e6e6ea' : '#1d2230' }}>New information</span>
            </div>
            <textarea
              value={createInfoSummary}
              onChange={(e) => setCreateInfoSummary(e.target.value)}
              autoFocus
              placeholder="The fact itself — e.g. 'The Wife is having an affair'"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 64,
                padding: '9px 11px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit',
                border: dark ? '1px solid #2a2a30' : '1px solid #e3e5ea', borderRadius: 8, outline: 'none',
                background: dark ? '#1d1d22' : '#f7f8fa', color: dark ? '#e6e6ea' : '#1d2230', marginBottom: 10,
              }}
            />
            <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 4 }}>
              Established in
            </div>
            <select
              value={createInfoEventId}
              onChange={(e) => setCreateInfoEventId(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '7px 9px', fontSize: 12.5,
                border: dark ? '1px solid #2a2a30' : '1px solid #e3e5ea', borderRadius: 8, background: dark ? '#1a1a1e' : '#fff',
                color: createInfoEventId ? '#1d2230' : '#999', fontFamily: 'inherit', marginBottom: 12,
              }}
            >
              <option value="">Choose the scene where this is established…</option>
              {(data?.entities ?? [])
                .filter((e) => e.type === 'event' && !e.deleted_at)
                .map((e) => ({ id: e.id, label: e.working_title ?? e.working_name ?? e.id }))
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
            </select>
            {createInfoError && (
              <div style={{ fontSize: 11.5, color: '#dc2626', marginBottom: 10 }}>{createInfoError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setCreateInfoOpen(false)}
                style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 600, border: dark ? '1px solid #2a2a30' : '1px solid #e3e5ea', borderRadius: 7, background: dark ? '#1a1a1e' : '#fff', color: dark ? '#9a9aa4' : '#6b7080', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                onClick={onSubmitCreateInfo}
                disabled={createInfoSubmitting}
                style={{
                  height: 30, padding: '0 16px', fontSize: 12, fontWeight: 600, border: 'none',
                  borderRadius: 7, background: createInfoSubmitting ? '#e8eaef' : INFO_ACCENT,
                  color: createInfoSubmitting ? '#9aa0ad' : '#fff',
                  cursor: createInfoSubmitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                }}
              >
                {createInfoSubmitting ? 'Creating…' : 'Create fact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Level-3 sheet overlay — dispatches by entity type. */}
      {sheetCardId && auth && storyId && (() => {
        const e = data.entities.find((x) => x.id === sheetCardId);
        if (!e) return null;
        if (e.type === 'event') {
          return (
            <EventSheet
              key={sheetCardId}
              entity={e}
              signal={signals[sheetCardId] ?? {}}
              allEntities={data.entities}
              edges={data.edges}
              information={data.information}
              auth={auth}
              projectId={storyId}
              completedResponseIds={completedResponseIds}
              onClose={() => setSheetCardId(null)}
              onEntitiesChanged={refreshEntities}
              onChangeNarrativeStatus={(next) => onChangeNarrativeStatus(sheetCardId, next)}
              onOpenCard={(cardId) => setSheetCardId(cardId)}
            />
          );
        }
        if (e.type === 'location') {
          return (
            <LocationSheet
              key={sheetCardId}
              entity={e}
              allEntities={data.entities}
              edges={data.edges}
              onClose={() => setSheetCardId(null)}
            />
          );
        }
        if (e.type === 'relationship') {
          return (
            <RelationshipSheet
              key={sheetCardId}
              entity={e}
              allEntities={data.entities}
              edges={data.edges}
              auth={auth}
              projectId={storyId}
              onClose={() => setSheetCardId(null)}
              onUpdateDescription={(d) => onUpdateDescription(sheetCardId, d)}
              onEntitiesChanged={refreshEntities}
            />
          );
        }
        if (e.type === 'sequence') {
          return (
            <SequenceSheet
              key={sheetCardId}
              entity={e}
              allEntities={data.entities}
              edges={data.edges}
              auth={auth}
              projectId={storyId}
              completedResponseIds={completedResponseIds}
              onClose={() => setSheetCardId(null)}
              onEntitiesChanged={refreshEntities}
              onOpenCard={(cardId) => setSheetCardId(cardId)}
              onUpdateDescription={(d) => onUpdateDescription(sheetCardId, d)}
            />
          );
        }
        if (e.type === 'arc') {
          return (
            <ArcSheet
              key={sheetCardId}
              entity={e}
              signal={signals[sheetCardId] ?? {}}
              allEntities={data.entities}
              edges={data.edges}
              auth={auth}
              projectId={storyId}
              onClose={() => setSheetCardId(null)}
              onRename={(newName) => onRenameCard(sheetCardId, newName)}
              onUpdateDescription={(d) => onUpdateDescription(sheetCardId, d)}
              onOpenCard={(cardId) => setSheetCardId(cardId)}
              onEntitiesChanged={refreshEntities}
            />
          );
        }
        return (
          <CharacterSheet
            key={sheetCardId}
            entity={e}
            signal={signals[sheetCardId] ?? {}}
            allEntities={data.entities}
            edges={data.edges}
            precedesEdges={data.edges.precedes ?? []}
            auth={auth}
            projectId={storyId}
            completedResponseIds={completedResponseIds}
            onClose={() => setSheetCardId(null)}
            onEntitiesChanged={refreshEntities}
            onOpenCard={(cardId) => setSheetCardId(cardId)}
          />
        );
      })()}
    </Shell>
    </ThemeCtx.Provider>
  );
}
