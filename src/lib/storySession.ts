// lib/storySession.ts — FIL-518 stage 3: the story-session layer.
//
// One module-scope session per story, alive while ANY view of the story is
// mounted (ref-counted, with a linger so board↔script switches never drop
// it). Owns:
//   1. THE WebSocket connection for the story (views subscribe to raw
//      messages instead of opening their own; fixes FIL-524 — a graph_delta
//      landing while the writer is in the Script view still reaches the
//      local copy).
//   2. graph_delta application to the in-memory payload + the IndexedDB
//      shelf, plus payload change notification for any listening view.
//   3. The WRITER-EDIT QUEUE (design doc freeform-writer-edit-sync-v1.md):
//      per-story FIFO coalesced by cardId+field, persisted to localStorage,
//      applied to the local payload instantly, pushed to Neptune in the
//      background with retry. The reconciliation belt is the backstop; a
//      push that never lands reverts visibly on the next refetch.
//
// Scope v1: rename (working_name) + description. narrative_status stays on
// the synchronous path — its D'-10 supersession gate is an interactive 409
// flow a background queue cannot answer.

import {
  updateCardName,
  updateCardDescription,
  tagEventPrecedes,
  untagEventPrecedes,
  tagSequenceContains,
  tagEventInvolvesCharacter,
  tagCauses,
  untagCauses,
  tagEventEvokes,
  setStructuralEdge,
  deleteStructuralEdge,
  type ListProjectEntitiesResponse,
} from './freeformApi';
import { mergeGraphDelta, saveStoredGraph, type GraphDelta } from './localGraphStore';

type EditField = 'working_name' | 'description';
export type QueuedEdit = {
  cardId: string;
  field: EditField;
  value: string;
  at: number;
};

// FIL-518 structural-edit queue (Ben's design, 2026-07-18): SEMANTIC ops,
// strict FIFO, no coalescing — replaying one writer's ordered history
// reproduces their final topology by construction. Composite ops (splice,
// move) queue as ONE atomic unit and expand to their API calls at push time,
// so a reload can never replay half a splice. Dead-target pushes drop like
// the field queue's 404s; the belt shows server truth.
export type StructOp =
  | { kind: 'precedes_tag'; from: string; to: string }
  | { kind: 'precedes_untag'; from: string; to: string }
  | { kind: 'precedes_splice'; anchorFrom: string; anchorTo: string; insertId: string }
  | { kind: 'contains_move'; sequenceId: string; eventId: string }
  | { kind: 'involves_tag'; eventId: string; characterId: string }
  | { kind: 'causes_tag'; from: string; to: string }
  | { kind: 'causes_untag'; from: string; to: string }
  | { kind: 'evokes_tag'; eventId: string; arcId: string }
  | { kind: 'structural_set'; from: string; to: string; predicate: string }
  | { kind: 'structural_delete'; from: string; to: string };
export type QueuedStructOp = StructOp & { at: number };

// In-memory only (never persisted): fired after a queued op's push lands,
// e.g. the description edit's extraction kick. Reload drops it — the
// backend hash dedup makes a skipped kick cheap.
const onPushedByKey = new Map<string, () => void>();

type MessageListener = (msg: any) => void;
type PayloadListener = (payload: ListProjectEntitiesResponse) => void;

type Session = {
  storyId: string;
  userId: string | null;
  token: string | null;
  refs: number;
  ws: WebSocket | null;
  wsWanted: boolean;
  /** When the current socket OPENED (null while closed) — consumers use it to
   *  apply an identify-write grace before enqueueing streamed work. */
  wsOpenedAt: number | null;
  reconnectDelayMs: number;
  lingerTimer: number | null;
  reconnectTimer: number | null;
  payload: ListProjectEntitiesResponse | null;
  messageListeners: Set<MessageListener>;
  payloadListeners: Set<PayloadListener>;
  // Edit queue: coalesced latest-value-per-(cardId|field), FIFO by first-
  // queued order, one push in flight at a time.
  queue: Map<string, QueuedEdit>;
  pushing: boolean;
  retryTimer: number | null;
  retryAttempt: number;
  // Structural-op queue: strict FIFO array, no coalescing, own push loop.
  structQueue: QueuedStructOp[];
  structPushing: boolean;
  structRetryTimer: number | null;
  structRetryAttempt: number;
  // Streamed-card side-buffer (FIL-518, last piece): provisional
  // PRE-RESOLUTION entities from entity_streamed, held so a view that
  // mounts mid-run can fold them in. Deliberately OUTSIDE the payload and
  // NEVER shelf-saved — a streamed card may die in resolution (roster echo,
  // focal duplicate, resolver dedup) and must not contaminate the durable
  // local copy. Cleared when the run's resolved truth arrives (graph_delta /
  // braindump_complete); age-filtered on read as the dead-run failsafe.
  streamBuffer: Map<string, { entity: any; at: number }>;
  /** Cross-view "an extraction is running" pulse: the script view stamps an
   *  expiry when it enqueues; the board shimmers its cards until expiry or
   *  braindump_complete. Purely cosmetic, so a TTL (not exact completion) is
   *  an acceptable clear for the WS-silent lanes (scene-pages). */
  extractionPulseUntil: number;
  pulseListeners: Set<() => void>;
};

const sessions = new Map<string, Session>();

const LINGER_MS = 30000; // survive board↔script route swaps (unmount → mount)
const RETRY_BACKOFF_MS = [2000, 8000, 30000];
const queueKey = (storyId: string) => `ff-editq-${storyId}`;
const structQueueKey = (storyId: string) => `ff-structq-${storyId}`;

function loadStructQueue(storyId: string): QueuedStructOp[] {
  try {
    const raw = localStorage.getItem(structQueueKey(storyId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as QueuedStructOp[];
    return Array.isArray(arr) ? arr.filter((op) => op && typeof op.kind === 'string') : [];
  } catch {
    return [];
  }
}

function persistStructQueue(s: Session) {
  try {
    if (s.structQueue.length === 0) localStorage.removeItem(structQueueKey(s.storyId));
    else localStorage.setItem(structQueueKey(s.storyId), JSON.stringify(s.structQueue));
  } catch { /* quota: queue still lives in memory this session */ }
}

function loadQueue(storyId: string): Map<string, QueuedEdit> {
  try {
    const raw = localStorage.getItem(queueKey(storyId));
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as QueuedEdit[];
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.map((op) => [`${op.cardId}|${op.field}`, op]));
  } catch {
    return new Map();
  }
}

function persistQueue(s: Session) {
  try {
    if (s.queue.size === 0) localStorage.removeItem(queueKey(s.storyId));
    else localStorage.setItem(queueKey(s.storyId), JSON.stringify([...s.queue.values()]));
  } catch { /* quota: queue still lives in memory this session */ }
}

function getSession(storyId: string): Session {
  let s = sessions.get(storyId);
  if (!s) {
    s = {
      storyId,
      userId: null,
      token: null,
      refs: 0,
      ws: null,
      wsWanted: false,
      wsOpenedAt: null,
      reconnectDelayMs: 2000,
      lingerTimer: null,
      reconnectTimer: null,
      payload: null,
      messageListeners: new Set(),
      payloadListeners: new Set(),
      queue: loadQueue(storyId),
      pushing: false,
      retryTimer: null,
      retryAttempt: 0,
      structQueue: loadStructQueue(storyId),
      structPushing: false,
      structRetryTimer: null,
      structRetryAttempt: 0,
      streamBuffer: new Map(),
      extractionPulseUntil: 0,
      pulseListeners: new Set(),
    };
    sessions.set(storyId, s);
  }
  return s;
}

// Apply a queued edit's value onto a payload IN PLACE (entities array is
// replaced so React consumers see a new reference via notify).
function applyEditToPayload(payload: ListProjectEntitiesResponse, op: QueuedEdit): ListProjectEntitiesResponse {
  const entities = payload.entities.map((e: any) => {
    if (e.id !== op.cardId) return e;
    if (op.field === 'working_name') {
      return { ...e, working_name: op.value, working_title: e.working_title !== undefined ? op.value : e.working_title };
    }
    // description; events/sequences mirror summary (same rule as the server)
    return { ...e, description: op.value, summary: e.summary !== undefined ? op.value : e.summary };
  });
  return { ...payload, entities };
}

// Apply a queued structural op's edges-transform onto a payload. Purely
// additive/subtractive on the edges arrays; missing endpoints are harmless
// (downstream renderers alive-filter) and the push-side 404 drop converges.
function applyStructOpToPayload(payload: ListProjectEntitiesResponse, op: QueuedStructOp): ListProjectEntitiesResponse {
  const e = payload.edges;
  switch (op.kind) {
    case 'precedes_tag':
      // Mirrors the server's reverse-auto-flip: tagging A→B drops B→A.
      return { ...payload, edges: { ...e, precedes: [
        ...e.precedes.filter((p) => !(p.from === op.from && p.to === op.to) && !(p.from === op.to && p.to === op.from)),
        { from: op.from, to: op.to },
      ] } };
    case 'precedes_untag':
      return { ...payload, edges: { ...e, precedes: e.precedes.filter((p) => !(p.from === op.from && p.to === op.to)) } };
    case 'precedes_splice':
      return { ...payload, edges: { ...e, precedes: [
        ...e.precedes.filter((p) =>
          !(p.from === op.anchorFrom && p.to === op.anchorTo) &&
          !(p.from === op.anchorFrom && p.to === op.insertId) &&
          !(p.from === op.insertId && p.to === op.anchorTo)),
        { from: op.anchorFrom, to: op.insertId },
        { from: op.insertId, to: op.anchorTo },
      ] } };
    case 'contains_move':
      // Disjoint server-side: a scene is in at most one sequence.
      return { ...payload, edges: { ...e, contains: [
        ...e.contains.filter((c) => c.to !== op.eventId),
        { from: op.sequenceId, to: op.eventId },
      ] } };
    case 'involves_tag':
      return e.involves.some((i) => i.from === op.eventId && i.to === op.characterId)
        ? payload
        : { ...payload, edges: { ...e, involves: [...e.involves, { from: op.eventId, to: op.characterId }] } };
    case 'causes_tag':
      return e.causes.some((c) => c.from === op.from && c.to === op.to)
        ? payload
        : { ...payload, edges: { ...e, causes: [...e.causes, { from: op.from, to: op.to }] } };
    case 'causes_untag':
      return { ...payload, edges: { ...e, causes: e.causes.filter((c) => !(c.from === op.from && c.to === op.to)) } };
    case 'evokes_tag':
      return e.evokes.some((ev) => ev.event_id === op.eventId && ev.arc_id === op.arcId)
        ? payload
        : { ...payload, edges: { ...e, evokes: [...e.evokes, { event_id: op.eventId, arc_id: op.arcId, state_at_event: '', transition: '' as const, evidence_quote: '' }] } };
    case 'structural_set':
      return { ...payload, edges: { ...e, structural: [
        ...e.structural.filter((st) => !(st.from === op.from && st.to === op.to)),
        { from: op.from, to: op.to, predicate: op.predicate },
      ] } };
    case 'structural_delete':
      return { ...payload, edges: { ...e, structural: e.structural.filter((st) => !(st.from === op.from && st.to === op.to)) } };
    default:
      return payload;
  }
}

// Pending writer edits overlay every payload the session takes ownership of
// (network replaces, delta merges): the queues are the freshest writer truth
// until their pushes land (design doc edge 4). Struct ops re-apply in FIFO
// order so a mid-queue refetch never visually undoes a drag.
function overlayQueue(s: Session, payload: ListProjectEntitiesResponse): ListProjectEntitiesResponse {
  let out = payload;
  for (const op of s.queue.values()) out = applyEditToPayload(out, op);
  for (const op of s.structQueue) out = applyStructOpToPayload(out, op);
  return out;
}

function notifyPayload(s: Session) {
  if (!s.payload) return;
  for (const fn of s.payloadListeners) {
    try { fn(s.payload); } catch { /* listener error never breaks the session */ }
  }
}

function openWs(s: Session) {
  if (!s.wsWanted || s.ws || !s.userId) return;
  const wsEndpoint = process.env.REACT_APP_WEBSOCKET_ENDPOINT;
  if (!wsEndpoint) return;
  const ws = new WebSocket(wsEndpoint);
  s.ws = ws;
  ws.onopen = () => {
    if (s.ws !== ws) return;
    s.reconnectDelayMs = 2000;
    s.wsOpenedAt = Date.now();
    try {
      ws.send(JSON.stringify({ action: 'identify', userId: s.userId, storyId: s.storyId, timestamp: Date.now() }));
    } catch { /* ignore */ }
  };
  ws.onmessage = (raw) => {
    if (s.ws !== ws) return;
    let msg: any;
    try { msg = JSON.parse(raw.data); } catch { return; }
    // Drop cross-story traffic, but let projectId-LESS messages through: the
    // peer stream events (prose_delta, question_complete, …) carry only a
    // clientRequestId — subscribers scope by it (useStreamingPeer rides this
    // socket now instead of opening its own).
    if (msg?.projectId && msg.projectId !== s.storyId) return;
    // Session-owned handling FIRST: graph_delta reaches the local copy and
    // the shelf no matter which view is mounted (FIL-524). Views still get
    // the raw message for their own concerns (meter, done-split, streaming).
    if (msg.type === 'graph_delta' && msg.delta) {
      const delta = msg.delta as GraphDelta;
      // The resolved truth for the run has arrived: the provisional stream
      // buffer is superseded (confirmed cards are in the delta; dead ones
      // were dropped in resolution and must vanish).
      s.streamBuffer.clear();
      if (s.payload) {
        s.payload = overlayQueue(s, mergeGraphDelta(s.payload, delta));
        void saveStoredGraph(s.storyId, { payload: s.payload });
        notifyPayload(s);
      }
    } else if (msg.type === 'entity_streamed' && msg.entity?.id) {
      // Side-buffer only — never the payload, never the shelf (see the
      // streamBuffer field comment). A mounted view's own handler renders
      // the live animation; the buffer serves views that mount mid-run.
      s.streamBuffer.set(String(msg.entity.id), { entity: msg.entity, at: Date.now() });
    } else if (msg.type === 'braindump_complete') {
      s.streamBuffer.clear();
      if (s.extractionPulseUntil > 0) {
        s.extractionPulseUntil = 0;
        for (const fn of s.pulseListeners) { try { fn(); } catch { /* cosmetic */ } }
      }
    }
    for (const fn of s.messageListeners) {
      try { fn(msg); } catch { /* one bad listener never starves the rest */ }
    }
  };
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = null;
    s.wsOpenedAt = null;
    if (s.wsWanted && !s.reconnectTimer) {
      const delay = s.reconnectDelayMs;
      s.reconnectDelayMs = Math.min(30000, s.reconnectDelayMs * 2);
      s.reconnectTimer = window.setTimeout(() => {
        s.reconnectTimer = null;
        openWs(s);
      }, delay);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

function closeWs(s: Session) {
  s.wsWanted = false;
  if (s.reconnectTimer) { window.clearTimeout(s.reconnectTimer); s.reconnectTimer = null; }
  const ws = s.ws;
  s.ws = null;
  if (ws) { try { ws.close(); } catch { /* ignore */ } }
}

async function pushLoop(s: Session): Promise<void> {
  if (s.pushing) return;
  s.pushing = true;
  try {
    while (s.queue.size > 0) {
      const [key, op] = s.queue.entries().next().value as [string, QueuedEdit];
      if (!s.token) return; // no auth yet: retry on next acquire/queue kick
      try {
        if (op.field === 'working_name') {
          await updateCardName({ cardId: op.cardId, projectId: s.storyId, workingName: op.value }, s.token);
        } else {
          await updateCardDescription({ cardId: op.cardId, projectId: s.storyId, description: op.value }, s.token);
        }
        // Only delete if unchanged while in flight (a newer edit re-queues
        // under the same key with a newer value: keep it).
        if (s.queue.get(key) === op) s.queue.delete(key);
        persistQueue(s);
        s.retryAttempt = 0;
        console.info('[edit-queue] pushed', { cardId: op.cardId, field: op.field });
        const cb = onPushedByKey.get(`${s.storyId}|${key}`);
        if (cb) {
          onPushedByKey.delete(`${s.storyId}|${key}`);
          try { cb(); } catch { /* callback error never breaks the loop */ }
        }
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/not found|404/i.test(msg)) {
          // Card gone server-side (trashed elsewhere): drop the op, the belt
          // already reflects server truth.
          console.warn('[edit-queue] target card gone; dropping edit', { cardId: op.cardId, field: op.field });
          s.queue.delete(key);
          persistQueue(s);
          continue;
        }
        const delay = RETRY_BACKOFF_MS[Math.min(s.retryAttempt, RETRY_BACKOFF_MS.length - 1)];
        s.retryAttempt++;
        console.warn('[edit-queue] push failed; retrying', { cardId: op.cardId, field: op.field, delay, error: msg });
        if (!s.retryTimer) {
          s.retryTimer = window.setTimeout(() => {
            s.retryTimer = null;
            void pushLoop(s);
          }, delay);
        }
        return; // leave the loop; the timer resumes it
      }
    }
  } finally {
    s.pushing = false;
  }
}

// Expand a semantic op into its API calls. Sequential within a composite:
// the splice's untag must land before its tags for the same reason the
// original sync path ordered them.
async function pushStructOp(s: Session, op: QueuedStructOp): Promise<void> {
  const token = s.token as string;
  const projectId = s.storyId;
  switch (op.kind) {
    case 'precedes_tag':
      await tagEventPrecedes({ fromEventId: op.from, toEventId: op.to, projectId }, token);
      return;
    case 'precedes_untag':
      await untagEventPrecedes({ fromEventId: op.from, toEventId: op.to, projectId }, token);
      return;
    case 'precedes_splice':
      await untagEventPrecedes({ fromEventId: op.anchorFrom, toEventId: op.anchorTo, projectId }, token);
      await tagEventPrecedes({ fromEventId: op.anchorFrom, toEventId: op.insertId, projectId }, token);
      await tagEventPrecedes({ fromEventId: op.insertId, toEventId: op.anchorTo, projectId }, token);
      return;
    case 'contains_move':
      await tagSequenceContains({ sequenceId: op.sequenceId, eventId: op.eventId, projectId }, token);
      return;
    case 'involves_tag':
      await tagEventInvolvesCharacter({ eventId: op.eventId, characterId: op.characterId, projectId }, token);
      return;
    case 'causes_tag':
      await tagCauses({ fromId: op.from, toId: op.to, projectId }, token);
      return;
    case 'causes_untag':
      await untagCauses({ fromId: op.from, toId: op.to, projectId }, token);
      return;
    case 'evokes_tag':
      await tagEventEvokes({ eventId: op.eventId, arcId: op.arcId, projectId }, token);
      return;
    case 'structural_set':
      await setStructuralEdge({ projectId, fromId: op.from, toId: op.to, predicate: op.predicate }, token);
      return;
    case 'structural_delete':
      await deleteStructuralEdge({ projectId, fromId: op.from, toId: op.to }, token);
      return;
  }
}

async function structPushLoop(s: Session): Promise<void> {
  if (s.structPushing) return;
  s.structPushing = true;
  try {
    while (s.structQueue.length > 0) {
      if (!s.token) return; // no auth yet: retry on next acquire/queue kick
      const op = s.structQueue[0];
      try {
        await pushStructOp(s, op);
        s.structQueue.shift();
        persistStructQueue(s);
        s.structRetryAttempt = 0;
        console.info('[struct-queue] pushed', { kind: op.kind });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (/not found|404/i.test(msg)) {
          // An endpoint is gone server-side (trashed elsewhere): drop the op,
          // the belt already reflects server truth. NOTE: a half-landed
          // composite (splice leg 2 404s) also drops here — its landed legs
          // are idempotent and the belt/spine hygiene heal the remainder.
          console.warn('[struct-queue] target gone; dropping op', { kind: op.kind });
          s.structQueue.shift();
          persistStructQueue(s);
          continue;
        }
        const delay = RETRY_BACKOFF_MS[Math.min(s.structRetryAttempt, RETRY_BACKOFF_MS.length - 1)];
        s.structRetryAttempt++;
        console.warn('[struct-queue] push failed; retrying', { kind: op.kind, delay, error: msg });
        if (!s.structRetryTimer) {
          s.structRetryTimer = window.setTimeout(() => {
            s.structRetryTimer = null;
            void structPushLoop(s);
          }, delay);
        }
        return; // leave the loop; the timer resumes it
      }
    }
  } finally {
    s.structPushing = false;
  }
}

// ============================== public API ==============================

export type StorySessionHandle = {
  onMessage: (fn: MessageListener) => () => void;
  /** Socket status for streamed-work barriers: open + when it opened. */
  wsState: () => { open: boolean; openedAt: number | null };
  onPayload: (fn: PayloadListener) => () => void;
  /** Cross-view extraction pulse: fires on stamp + on braindump_complete clear. */
  onExtractionPulse: (fn: () => void) => () => void;
  extractionPulseUntil: () => number;
  /** The session's current payload (freshest local truth incl. pending edits). */
  getPayload: () => ListProjectEntitiesResponse | null;
  /** A view loaded/refetched from the network: the session takes ownership
   *  (overlaying any pending writer edits). quiet=true skips notifying
   *  listeners (the caller already has this payload in its own state). */
  setPayload: (payload: ListProjectEntitiesResponse, opts?: { quiet?: boolean }) => ListProjectEntitiesResponse;
  /** Local-first writer edit: applies to the local copy instantly, persists
   *  to the queue, pushes in the background. Returns the updated payload. */
  queueEdit: (op: { cardId: string; field: EditField; value: string }, opts?: { onPushed?: () => void }) => ListProjectEntitiesResponse | null;
  /** Provisional entities streamed during a run that is (or was just) in
   *  flight — for a view mounting mid-run to fold into its render state.
   *  Age-filtered (5 min) so a dead run can't leave ghosts. NEVER persist
   *  these; the delta/refetch carries the resolved truth. */
  getStreamedEntities: () => any[];
  /** Refresh auth after token rotation so background pushes keep working. */
  setAuth: (auth: { userId: string; token: string } | null) => void;
  release: () => void;
};

/** Module-level enqueue for components without a session handle (sheets,
 *  script proxy). The session must be alive (a view holds it) for the push
 *  to have auth; the op persists regardless and pushes when auth arrives. */
export function queueEditGlobal(
  storyId: string,
  op: { cardId: string; field: EditField; value: string },
  opts?: { onPushed?: () => void },
): void {
  const s = getSession(storyId);
  const q: QueuedEdit = { ...op, at: Date.now() };
  s.queue.set(`${op.cardId}|${op.field}`, q);
  if (opts?.onPushed) onPushedByKey.set(`${storyId}|${op.cardId}|${op.field}`, opts.onPushed);
  persistQueue(s);
  if (s.payload) {
    s.payload = applyEditToPayload(s.payload, q);
    void saveStoredGraph(s.storyId, { payload: s.payload });
    notifyPayload(s);
  }
  void pushLoop(s);
}

/** Local-first structural edit (FIL-518): applies to the session payload
 *  instantly, persists to the FIFO struct queue, pushes in the background.
 *  The caller keeps its own optimistic local apply; this makes it durable. */
export function queueStructOpGlobal(storyId: string, op: StructOp): void {
  const s = getSession(storyId);
  const q: QueuedStructOp = { ...op, at: Date.now() };
  s.structQueue.push(q);
  persistStructQueue(s);
  if (s.payload) {
    s.payload = applyStructOpToPayload(s.payload, q);
    void saveStoredGraph(s.storyId, { payload: s.payload });
    notifyPayload(s);
  }
  void structPushLoop(s);
}

/** Overlay ALL pending writer edits (field + structural) onto a payload.
 *  For views that hold their own render state: wrap every payload that
 *  arrives from the network/shelf/delta so a refetch mid-queue never
 *  visually undoes a pending edit. */
export function overlayPending(storyId: string, payload: ListProjectEntitiesResponse): ListProjectEntitiesResponse {
  return overlayQueue(getSession(storyId), payload);
}

/** Stamp the cross-view extraction pulse (script-side enqueues call this).
 *  Each call EXTENDS the expiry; braindump_complete clears it early. */
export function pulseExtractionGlobal(storyId: string, ttlMs = 90000): void {
  const s = getSession(storyId);
  s.extractionPulseUntil = Math.max(s.extractionPulseUntil, Date.now() + ttlMs);
  for (const fn of s.pulseListeners) { try { fn(); } catch { /* cosmetic */ } }
}

export function acquireStorySession(
  storyId: string,
  auth: { userId: string; token?: string | null } | null,
): StorySessionHandle {
  const s = getSession(storyId);
  s.refs++;
  // userId always adopts (the socket identify needs it); the token only
  // adopts when REAL — a token-less acquirer (useStreamingPeer riding the
  // socket) must never clobber the page's token and stall the push loops.
  if (auth) {
    s.userId = auth.userId;
    if (auth.token) s.token = auth.token;
  }
  if (s.lingerTimer) { window.clearTimeout(s.lingerTimer); s.lingerTimer = null; }
  s.wsWanted = true;
  openWs(s);
  if (s.queue.size > 0) void pushLoop(s); // resume a persisted queue
  if (s.structQueue.length > 0) void structPushLoop(s);
  let released = false;
  return {
    onMessage: (fn) => {
      s.messageListeners.add(fn);
      return () => s.messageListeners.delete(fn);
    },
    wsState: () => ({
      open: !!s.ws && s.ws.readyState === WebSocket.OPEN,
      openedAt: s.wsOpenedAt,
    }),
    onPayload: (fn) => {
      s.payloadListeners.add(fn);
      return () => s.payloadListeners.delete(fn);
    },
    onExtractionPulse: (fn: () => void) => {
      s.pulseListeners.add(fn);
      return () => s.pulseListeners.delete(fn);
    },
    extractionPulseUntil: () => s.extractionPulseUntil,
    getPayload: () => s.payload,
    setPayload: (payload, opts) => {
      s.payload = overlayQueue(s, payload);
      if (!opts?.quiet) notifyPayload(s);
      return s.payload;
    },
    queueEdit: ({ cardId, field, value }, opts) => {
      queueEditGlobal(storyId, { cardId, field, value }, opts);
      return s.payload;
    },
    getStreamedEntities: () => {
      const cutoff = Date.now() - 5 * 60 * 1000;
      const out: any[] = [];
      for (const [id, v] of s.streamBuffer) {
        if (v.at < cutoff) s.streamBuffer.delete(id);
        else out.push(v.entity);
      }
      return out;
    },
    setAuth: (a) => {
      if (a) {
        s.userId = a.userId; s.token = a.token;
        if (s.queue.size > 0) void pushLoop(s);
        if (s.structQueue.length > 0) void structPushLoop(s);
      }
    },
    release: () => {
      if (released) return;
      released = true;
      s.refs--;
      if (s.refs <= 0) {
        s.refs = 0;
        // Linger: a board↔script switch unmounts one view before mounting
        // the other; dropping the socket for that gap is exactly FIL-524.
        s.lingerTimer = window.setTimeout(() => {
          s.lingerTimer = null;
          if (s.refs === 0) closeWs(s);
        }, LINGER_MS);
      }
    },
  };
}
