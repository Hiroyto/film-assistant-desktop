// localGraphStore — FIL-518 stage 2a: the client-held story graph's
// persistence shelf. IndexedDB, one record per storyId, holding the
// list-project-entities payload (+ card layouts, so a cold board renders
// with real positions instead of flashing defaults) and a fetchedAt stamp.
//
// This is a SHELF, not an engine, and a copy, not the source of truth:
// Neptune stays authoritative, the network reconciles the copy, and every
// read path must tolerate this returning null (private mode, eviction,
// version bumps, first visit). All failures degrade to the network path.
//
// Cross-tab: BroadcastChannel announces "a fresh payload was persisted for
// story X" so other tabs re-hydrate from the shelf instead of drifting.
// The channel does not deliver to the posting tab.

import type { CardLayout, ListProjectEntitiesResponse, ProjectEdges, ProjectEntity, ProjectInformation } from './freeformApi';

const DB_NAME = 'ff-graph-store';
const STORE = 'graphs';
const DB_VERSION = 1;
// Bump when the stored record shape changes — mismatched records read as null.
// v2: purge shelves poisoned by pre-allowlist deltas (a Theme entity reached
// CardBox and crashed the board, 2026-07-16).
const RECORD_VERSION = 2;
const CHANNEL = 'ff-graph-store';

export interface StoredGraph {
  storyId: string;
  v: number;
  payload: ListProjectEntitiesResponse;
  layouts?: Record<string, CardLayout>;
  fetchedAt: number;
  /** Cognito user who cached this graph. Reads for a DIFFERENT user return
   *  null, so one account never renders another's cached story on a shared
   *  browser. Absent on legacy records (pre-user-scoping) — those read through
   *  once and get re-stamped on the next save. */
  userId?: string;
}

// Growth guardrails: the shelf is a cache, not an archive. Without these it
// grows one full graph per story ever opened and never shrinks (observed: 50
// graphs, 43 of them deleted stories). Prune runs opportunistically after each
// save.
const MAX_ENTRIES = 25;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * The signed-in Cognito user, resolved SYNCHRONOUSLY from Amplify's cached
 * `LastAuthUser` in localStorage (same value as the `cognito:username` claim
 * the app keys everything on). Lets the shelf scope reads/writes to the current
 * account without threading userId (and without an async session fetch) through
 * every call site. Returns null when logged out or storage is unavailable —
 * callers then read/write unscoped, exactly as before.
 */
function currentCognitoUserId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('CognitoIdentityServiceProvider.') && k.endsWith('.LastAuthUser')) {
        const v = localStorage.getItem(k);
        if (v) return v;
      }
    }
  } catch { /* storage blocked (private mode / iframe) */ }
  return null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'storyId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

export async function loadStoredGraph(storyId: string, userId?: string): Promise<StoredGraph | null> {
  const scopeUser = userId ?? currentCognitoUserId();
  try {
    const db = await openDb();
    return await new Promise<StoredGraph | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(storyId);
      req.onsuccess = () => {
        const rec = req.result as StoredGraph | undefined;
        if (!rec || rec.v !== RECORD_VERSION || !rec.payload?.entities || !rec.payload?.edges) {
          resolve(null);
          return;
        }
        // User-scoped read: a record owned by a different account reads as
        // absent, so the caller falls through to the (authz-gated) network
        // path instead of rendering someone else's cached story.
        if (scopeUser && rec.userId && rec.userId !== scopeUser) {
          resolve(null);
          return;
        }
        resolve(rec);
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Persist a fresh payload (and optionally layouts). Merging: an update that
 * carries only the payload preserves previously stored layouts, so the
 * script view (which never fetches layouts) keeps the board's shelf warm
 * without erasing positions.
 */
export async function saveStoredGraph(
  storyId: string,
  update: { payload?: ListProjectEntitiesResponse; layouts?: Record<string, CardLayout> },
  userId?: string,
): Promise<void> {
  if (!update.payload && !update.layouts) return;
  const owner = userId ?? currentCognitoUserId() ?? undefined;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(storyId);
      getReq.onsuccess = () => {
        const prev = getReq.result as StoredGraph | undefined;
        const base: StoredGraph | null = prev && prev.v === RECORD_VERSION ? prev : null;
        const payload = update.payload ?? base?.payload;
        if (!payload) { resolve(); return; } // never store a layouts-only husk
        const rec: StoredGraph = {
          storyId,
          v: RECORD_VERSION,
          payload,
          layouts: update.layouts ?? base?.layouts,
          fetchedAt: Date.now(),
          userId: owner ?? base?.userId,
        };
        store.put(rec);
      };
      getReq.onerror = () => resolve();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
    if (update.payload) announceGraphUpdate(storyId);
    // Bound growth: fire-and-forget so it never delays the caller. The just-
    // saved story is the newest by fetchedAt, so the cap never evicts it.
    void pruneStoredGraphs();
  } catch { /* shelf unavailable: the network path is unaffected */ }
}

export async function clearStoredGraph(storyId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(storyId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

/** Empty the entire shelf. Called on sign-out / account switch so one account's
 *  cached story graphs never sit readable for the next user of this browser.
 *  Uses store.clear() (not deleteDatabase) to avoid open-connection races with
 *  other tabs. */
export async function clearAllStoredGraphs(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

/** Evict stale (older than maxAgeMs) and overflow (beyond the newest
 *  maxEntries by fetchedAt) shelves. Idempotent, best-effort, self-contained. */
export async function pruneStoredGraphs(
  opts?: { maxEntries?: number; maxAgeMs?: number },
): Promise<void> {
  const maxEntries = opts?.maxEntries ?? MAX_ENTRIES;
  const maxAgeMs = opts?.maxAgeMs ?? MAX_AGE_MS;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const all = store.getAll();
      all.onsuccess = () => {
        const recs = (all.result as StoredGraph[]) ?? [];
        const now = Date.now();
        const survivors: StoredGraph[] = [];
        for (const r of recs) {
          if (r.fetchedAt && now - r.fetchedAt > maxAgeMs) store.delete(r.storyId);
          else survivors.push(r);
        }
        if (survivors.length > maxEntries) {
          survivors.sort((a, b) => (b.fetchedAt ?? 0) - (a.fetchedAt ?? 0));
          for (const r of survivors.slice(maxEntries)) store.delete(r.storyId);
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

// ---- Graph deltas (FIL-516) ----
//
// The server emits `graph_delta` over WS at model-complete: the resolved
// extraction (entities + edges + information, final vids) BEFORE the
// Neptune flush. Applying it to the local copy is what makes extraction
// results render at model speed. Merging is additive and idempotent: the
// post-write refetch carries the same elements and dedupes to a no-op.
// A delta never resurrects or trashes (local deleted_at wins) — retirements
// travel by refetch.

export interface GraphDelta {
  entities?: ProjectEntity[];
  edges?: Partial<ProjectEdges>;
  information?: ProjectInformation[];
}

type Pair = { from: string; to: string };
const pairKey = (x: Pair) => `${x.from}|${x.to}`;
const PAIR_BUCKETS = ['involves', 'occurs_in', 'precedes', 'sequence_precedes', 'contains'] as const;

// Only card kinds the board renders may enter the local graph via a delta —
// an unknown type reaching CardBox has no entity color and crashes the board
// (the Theme incident, 2026-07-16). Defense in depth with the backend
// allowlist.
const CARD_TYPES = new Set(['character', 'event', 'location', 'relationship', 'sequence', 'arc']);

export function mergeGraphDelta(
  prev: ListProjectEntitiesResponse,
  delta: GraphDelta,
): ListProjectEntitiesResponse {
  const entities = [...prev.entities];
  const entIdx = new Map(entities.map((e, i) => [e.id, i] as const));
  for (const ent of delta.entities ?? []) {
    if (!ent?.id || !CARD_TYPES.has(String(ent.type))) continue;
    const i = entIdx.get(ent.id);
    if (i === undefined) {
      entIdx.set(ent.id, entities.length);
      entities.push(ent);
    } else {
      entities[i] = { ...entities[i], ...ent, deleted_at: entities[i].deleted_at };
    }
  }

  const edges: ProjectEdges = { ...prev.edges };
  for (const bucket of PAIR_BUCKETS) {
    const add = (delta.edges?.[bucket] ?? []) as Pair[];
    if (!add.length) continue;
    const cur = (prev.edges[bucket] ?? []) as Pair[];
    const seen = new Set(cur.map(pairKey));
    const fresh = add.filter((x) => x?.from && x?.to && !seen.has(pairKey(x)));
    if (fresh.length) (edges as any)[bucket] = [...cur, ...fresh];
  }
  {
    const add = delta.edges?.structural ?? [];
    if (add.length) {
      const key = (x: { from: string; to: string; predicate: string }) => `${x.from}|${x.to}|${x.predicate}`;
      const cur = prev.edges.structural ?? [];
      const seen = new Set(cur.map(key));
      const fresh = add.filter((x) => x?.from && x?.to && !seen.has(key(x)));
      if (fresh.length) edges.structural = [...cur, ...fresh];
    }
  }
  {
    // Knowledge states REPLACE by (knower, fact, label) — a re-assertion can
    // change state/qualifier, and the server's single-cardinality edge props
    // behave the same way.
    const add = delta.edges?.knowledge ?? [];
    if (add.length) {
      const key = (x: { knower_id: string; info_id: string; label?: string }) => `${x.knower_id}|${x.info_id}|${x.label ?? ''}`;
      const dk = new Map(add.map((x) => [key(x), x]));
      const cur = prev.edges.knowledge ?? [];
      edges.knowledge = [...cur.filter((x) => !dk.has(key(x))), ...add];
    }
  }

  const information = [...(prev.information ?? [])];
  const infIdx = new Map(information.map((x, i) => [x.id, i] as const));
  for (const inf of delta.information ?? []) {
    if (!inf?.id) continue;
    const i = infIdx.get(inf.id);
    if (i === undefined) {
      infIdx.set(inf.id, information.length);
      information.push(inf);
    } else {
      information[i] = {
        ...information[i],
        ...inf,
        established_in_event_ids: [
          ...new Set([
            ...(information[i].established_in_event_ids ?? []),
            ...(inf.established_in_event_ids ?? []),
          ]),
        ],
      };
    }
  }

  return { ...prev, entities, edges, information };
}

/** How many delta edges are NOT already present in the current payload —
 *  counted over the same buckets the corkboard's edge-growth belt counts. */
export function countFreshDeltaEdges(cur: ListProjectEntitiesResponse | null, delta: GraphDelta): number {
  if (!cur) return 0;
  let n = 0;
  for (const bucket of ['involves', 'occurs_in', 'precedes', 'contains'] as const) {
    const add = (delta.edges?.[bucket] ?? []) as Pair[];
    if (!add.length) continue;
    const seen = new Set(((cur.edges[bucket] ?? []) as Pair[]).map(pairKey));
    n += add.filter((x) => x?.from && x?.to && !seen.has(pairKey(x))).length;
  }
  {
    const add = delta.edges?.knowledge ?? [];
    if (add.length) {
      const key = (x: { knower_id: string; info_id: string; label?: string }) => `${x.knower_id}|${x.info_id}|${x.label ?? ''}`;
      const seen = new Set((cur.edges.knowledge ?? []).map(key));
      n += add.filter((x) => !seen.has(key(x))).length;
    }
  }
  return n;
}

// ---- Cross-tab announcements ----

// BroadcastChannel excludes only the posting CHANNEL INSTANCE, not the
// posting tab — a tab with a separate listener instance hears its own
// announcements (observed live 2026-07-14: same-tab "re-hydrated from
// another tab" right after every save). Tag messages with a per-tab id and
// ignore our own.
const TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function announceGraphUpdate(storyId: string): void {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: 'graph_updated', storyId, from: TAB_ID });
    bc.close();
  } catch { /* BroadcastChannel unavailable: tabs reconcile via refetch belts */ }
}

/** Subscribe to OTHER tabs persisting a fresh payload for any story.
 *  Returns an unsubscribe function. */
export function onGraphUpdate(cb: (storyId: string) => void): () => void {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (ev) => {
      if (
        ev?.data?.type === 'graph_updated' &&
        typeof ev.data.storyId === 'string' &&
        ev.data.from !== TAB_ID
      ) {
        cb(ev.data.storyId);
      }
    };
    return () => bc.close();
  } catch {
    return () => {};
  }
}
