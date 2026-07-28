// lib/localSlice.ts
//
// FIL-518 stage 2b: client-side peer-slice composition, SHADOW MODE ONLY.
//
// Recomputes the build-slice output locally from the client-held
// list-project-entities payload, so we can diff it against the server's
// slice and measure whether the local graph copy is composition-complete.
// Nothing here feeds the peer; the only consumer is a console.info diff
// (see runSliceShadow, wired into usePeerSession.ask()).
//
// The pure composition functions (buildSlice and friends) are a faithful
// port of freeform-workflow-app/lib/peer-slice.mjs. The graph reconstruction
// replaces freeform-workflow-app/lib/neptune-reads.mjs: instead of Gremlin
// walks it derives the same loader output shapes from the payload's
// entities / information / edges arrays.
//
// Known non-derivable tiers (Dynamo-only) are set to empty and listed in
// SHADOW_SKIP_TIERS so diffSlices ignores them:
//   - prior_responses / prior_open_questions (focal card iteration history)
//   - per-character prior_responses / open_questions (enrichment splice)
//
// Known soft semantic gaps (kept in the diff, flagged here for triage):
//   - Ordering: several loader tiers inherit Neptune's traversal order
//     (co-character fetch order, information walk order, knowledge edge
//     order). Locally we inherit the payload's array order instead. Sort
//     comparators downstream are identical, but unsorted tiers and sort
//     ties can legitimately differ in order.
//   - Character-focal focal_knowledge: the server does NOT alive-filter the
//     target Information (fact layer); the payload's knowledge edges DO
//     filter trashed Information. A trashed fact's edge appears server-side
//     only.
//   - Enrichment knowledge_arcs.established_in_event_ids: the server fold
//     is not alive-filtered; the payload's established_in_event_ids is.
//     A fact anchored on a trashed scene differs by that one id.

import type {
  ListProjectEntitiesResponse,
  ProjectEntity,
  ProjectInformation,
} from './freeformApi';
import { loadStoredGraph } from './localGraphStore';

// Tiers that cannot be recomputed locally (Dynamo-only). diffSlices ignores
// these keys at any depth. 'per_char_prior_responses' is the budget label the
// server uses for the nested cap; the nested slice key itself is
// 'prior_responses' (covered), kept here per spec for completeness.
export const SHADOW_SKIP_TIERS = [
  'prior_responses',
  'prior_open_questions',
  'per_char_prior_responses',
  'open_questions',
];

export interface LocalSliceOptions {
  focalType: 'character' | 'event' | 'sequence';
  focalId: string;
  cardId: string;
  sourceProse?: string;
}

export interface SliceMismatch {
  path: string;
  kind: 'missing-local' | 'missing-server' | 'value';
  local?: any;
  server?: any;
}

export interface SliceDiff {
  equal: boolean;
  mismatches: SliceMismatch[];
}

// =====================================================================
// Ported composition (peer-slice.mjs). Same field names, same comparators,
// same caps. Kept as close to the server source as TypeScript allows.
// =====================================================================

const SLICE_CAPS = {
  co_characters: 6,
  mentioned_characters: 5,
  character_overlap_events: 6,
  prior_responses: 8,
  prior_open_questions: 12,
  per_char_prior_responses: 2,
  per_char_other_events: 8,
};

const nsRelevance = (ns: any) => (ns === 'on_screen' ? 2 : ns === 'offstage' ? 1 : 0);

function byRecencyDesc(getter: (x: any) => any) {
  return (a: any, b: any) => {
    const ta = getter(a) || '';
    const tb = getter(b) || '';
    if (ta === tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta < tb ? 1 : -1;
  };
}

function capTier(items: any[], n: number, label: string, budget: Record<string, any>) {
  if (!Array.isArray(items) || items.length <= n) return items;
  const dropped = items.length - n;
  const cur = budget[label] ?? { dropped: 0, instances: 0 };
  budget[label] = { dropped: cur.dropped + dropped, instances: cur.instances + 1 };
  return items.slice(0, n);
}

function trimEnrichedCharacter(c: any, budget: Record<string, any>) {
  const out = { ...c };
  if (Array.isArray(out.prior_responses) && out.prior_responses.length > 0) {
    out.prior_responses = capTier(
      out.prior_responses.slice().sort(byRecencyDesc((r: any) => r.answered_at)),
      SLICE_CAPS.per_char_prior_responses,
      'per_char_prior_responses',
      budget,
    );
  }
  if (Array.isArray(out.other_events)) {
    // Deterministic id-sort before the cap so local and server keep the SAME
    // 8 (the cap was insertion-order = Gremlin order server / payload order
    // local; they diverged on >8-event co-characters). Mirrors peer-slice.mjs.
    out.other_events = capTier(
      out.other_events.slice().sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
      SLICE_CAPS.per_char_other_events,
      'per_char_other_events',
      budget,
    );
  }
  return out;
}

function stripPrivate(entry: any) {
  const { _precedes, _preceded_by, ...rest } = entry;
  return rest;
}

function topoSortEvokesByPrecedes(sequence: any[]): any[] {
  if (sequence.length <= 1) {
    return sequence.map((e) => stripPrivate(e));
  }
  const nsRank = (ns: any) => (ns === 'backstory' ? 0 : 1);
  const idToIdx = new Map<string, number>();
  sequence.forEach((e, i) => idToIdx.set(e.event_id, i));
  const idToEntry = new Map(sequence.map((e) => [e.event_id, e]));
  const compareReady = (a: string, b: string) => {
    const ra = nsRank(idToEntry.get(a)?.event_narrative_status);
    const rb = nsRank(idToEntry.get(b)?.event_narrative_status);
    if (ra !== rb) return ra - rb;
    return (idToIdx.get(a) ?? 0) - (idToIdx.get(b) ?? 0);
  };
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of sequence) {
    indeg.set(e.event_id, 0);
    adj.set(e.event_id, []);
  }
  for (const e of sequence) {
    for (const succId of e._precedes ?? []) {
      if (!idToIdx.has(succId)) continue;
      adj.get(e.event_id)!.push(succId);
      indeg.set(succId, (indeg.get(succId) ?? 0) + 1);
    }
  }
  const ready = sequence
    .filter((e) => (indeg.get(e.event_id) ?? 0) === 0)
    .map((e) => e.event_id)
    .sort(compareReady);
  const out: any[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    const entry = idToEntry.get(id);
    if (entry) out.push(entry);
    for (const next of adj.get(id) ?? []) {
      const remaining = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) {
        let i = 0;
        while (i < ready.length && compareReady(ready[i], next) < 0) i++;
        ready.splice(i, 0, next);
      }
    }
  }
  if (out.length < sequence.length) {
    const seen = new Set(out.map((e) => e.event_id));
    for (const e of sequence) {
      if (!seen.has(e.event_id)) out.push(e);
    }
  }
  return out.map(stripPrivate);
}

function computeArcDerivedStatus(sortedSequence: any[]) {
  if (sortedSequence.length === 0) {
    return { status_label: 'not yet raised' };
  }
  const last = sortedSequence[sortedSequence.length - 1];
  const raisedIn = sortedSequence.find((e) => e.transition === 'introduces');
  const lastResolved = [...sortedSequence].reverse().find((e) => e.transition === 'resolves');
  const out: any = {};
  if (lastResolved) {
    out.status_label = `resolved at ${lastResolved.event_working_title}`;
    out.resolved_in_event_id = lastResolved.event_id;
  } else {
    out.status_label = `active as of ${last.event_working_title}`;
  }
  if (raisedIn) {
    out.raised_in_event_id = raisedIn.event_id;
  }
  return out;
}

function topoSortByPrecedes(events: any[]): any[] {
  if (events.length <= 1) return events.slice();
  const titleToIdx = new Map<string, number>();
  events.forEach((e, i) => titleToIdx.set(e.working_title, i));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of events) {
    indeg.set(e.working_title, 0);
    adj.set(e.working_title, []);
  }
  for (const e of events) {
    for (const succTitle of e.precedes ?? []) {
      if (!titleToIdx.has(succTitle)) continue;
      adj.get(e.working_title)!.push(succTitle);
      indeg.set(succTitle, (indeg.get(succTitle) ?? 0) + 1);
    }
  }
  const ready = events
    .filter((e) => (indeg.get(e.working_title) ?? 0) === 0)
    .map((e) => e.working_title)
    .sort((a, b) => (titleToIdx.get(a) ?? 0) - (titleToIdx.get(b) ?? 0));
  const out: any[] = [];
  const byTitle = new Map(events.map((e) => [e.working_title, e]));
  while (ready.length > 0) {
    const t = ready.shift()!;
    const e = byTitle.get(t);
    if (e) out.push(e);
    for (const next of adj.get(t) ?? []) {
      const remaining = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) {
        const targetIdx = titleToIdx.get(next) ?? 0;
        let i = 0;
        while (i < ready.length && (titleToIdx.get(ready[i]) ?? 0) < targetIdx) i++;
        ready.splice(i, 0, next);
      }
    }
  }
  if (out.length < events.length) {
    const seen = new Set(out.map((e) => e.working_title));
    for (const e of events) {
      if (!seen.has(e.working_title)) out.push(e);
    }
  }
  return out;
}

// FIL-505 knowledge fold. LEGACY_DEPTH marks the un-anchored legacy seed:
// current, but superseded by any real scene-anchored ancestor delta.
const LEGACY_DEPTH = Number.MAX_SAFE_INTEGER;

function classifyKnowledgeAnchor(
  atEvent: string,
  ancestorDepth: Map<string, number>,
  successorDepth: Map<string, number>,
): { bucket: string; depth?: number } {
  if (!atEvent) return { bucket: 'now', depth: LEGACY_DEPTH };
  if (ancestorDepth.has(atEvent)) return { bucket: 'now', depth: ancestorDepth.get(atEvent) };
  if (successorDepth.has(atEvent)) return { bucket: 'future', depth: successorDepth.get(atEvent) };
  return { bucket: 'elsewhere' };
}

function foldKnowledgeGroup(
  group: any[],
  ancestorDepth: Map<string, number>,
  successorDepth: Map<string, number>,
) {
  let current: any = null;
  let currentDepth = Infinity;
  let future: any = null;
  let futureDepth = Infinity;
  const elsewhere: any[] = [];
  for (const e of group) {
    const { bucket, depth } = classifyKnowledgeAnchor(e.at_event ?? '', ancestorDepth, successorDepth);
    if (bucket === 'now') {
      if ((depth as number) < currentDepth) { current = e; currentDepth = depth as number; }
    } else if (bucket === 'future') {
      if ((depth as number) < futureDepth) { future = e; futureDepth = depth as number; }
    } else {
      elsewhere.push(e);
    }
  }
  return { current, future, elsewhere };
}

function foldKnowledgeEdges(
  edges: any[],
  keyFn: (e: any) => string,
  ancestorDepth: Map<string, number>,
  successorDepth: Map<string, number>,
) {
  const groups = new Map<string, any[]>();
  for (const e of edges) {
    const k = keyFn(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return Array.from(groups.values(), (g) => foldKnowledgeGroup(g, ancestorDepth, successorDepth));
}

function stripKnowledgePrivate(e: any) {
  if (!e) return e;
  const { at_event, knower_id, info_id, ...rest } = e;
  return rest;
}

function sliceForCharacter(name: string, graph: any, sourceProse: string | undefined, extras: any = {}) {
  const chars = graph.characters ?? [];
  const events = graph.events ?? [];
  const info = graph.information ?? [];
  const kEdges = graph.knowledge_edges ?? [];
  const rels = graph.relationships ?? [];
  const sEdges = graph.structural_edges ?? [];

  const focal = chars.find((c: any) => c.working_name === name);
  if (!focal) throw new Error(`character not found: ${name}`);

  const involvingEventsExtractionOrder = events.filter((e: any) =>
    (e.involves ?? []).includes(name)
  );
  const involvingEvents = topoSortByPrecedes(involvingEventsExtractionOrder);

  const coCharNames = new Set<string>();
  for (const e of involvingEvents) {
    for (const n of e.involves ?? []) {
      if (n !== name) coCharNames.add(n);
    }
  }
  const coCharacters = chars.filter((c: any) => coCharNames.has(c.working_name));

  const coCharSet = new Set(coCharacters.map((c: any) => c.working_name));
  const mentionedCharacters = chars.filter(
    (c: any) => c.working_name !== name && !coCharSet.has(c.working_name)
  );

  const involvingEventTitles = new Set(involvingEvents.map((e: any) => e.working_title));
  const relevantInfo = info.filter((i: any) => involvingEventTitles.has(i.established_in_event));

  const focalKnowledge = kEdges.filter((k: any) => k.knower_name === name);

  const focalAsSubject = kEdges.filter(
    (k: any) =>
      (k.info_summary ?? '').toLowerCase().includes(name.toLowerCase()) &&
      k.knower_name !== name
  );

  const focalRels = rels.filter(
    (r: any) => r.character_a === name || r.character_b === name
  );

  const focalStruct = sEdges.filter(
    (s: any) => s.from_character === name || s.to_character === name
  );

  const arcsInvolving = (extras.arcsForCharacter ?? []).map((arc: any) => {
    const sorted = topoSortEvokesByPrecedes(arc.evokes_sequence ?? []);
    const derived = computeArcDerivedStatus(sorted);
    return {
      id: arc.id,
      working_name: arc.working_name,
      kind: arc.kind,
      description: arc.description,
      evidence_quote: arc.evidence_quote,
      open_dimensions: arc.open_dimensions,
      involves_characters: arc.involves_characters,
      evokes_sequence: sorted,
      ...derived,
    };
  });

  const budget = extras._budget ?? (extras._budget = {});

  const sharedEventCount = new Map<string, number>();
  for (const e of involvingEvents) {
    for (const n of e.involves ?? []) {
      if (n !== name) sharedEventCount.set(n, (sharedEventCount.get(n) ?? 0) + 1);
    }
  }
  const coCharactersOut = capTier(
    coCharacters.slice().sort((a: any, b: any) => {
      const d = (sharedEventCount.get(b.working_name) ?? 0)
        - (sharedEventCount.get(a.working_name) ?? 0);
      if (d) return d;
      return byRecencyDesc((c: any) => c.created_at)(a, b);
    }),
    SLICE_CAPS.co_characters, 'co_characters', budget,
  ).map((c: any) => trimEnrichedCharacter(c, budget));

  const relNames = new Set<string>();
  for (const r of focalRels) { relNames.add(r.character_a); relNames.add(r.character_b); }
  const structNames = new Set<string>();
  for (const s of focalStruct) { structNames.add(s.from_character); structNames.add(s.to_character); }
  const tieRank = (nm: string) => (relNames.has(nm) ? 2 : structNames.has(nm) ? 1 : 0);
  const mentionedOut = capTier(
    mentionedCharacters.slice().sort((a: any, b: any) => {
      const d = tieRank(b.working_name) - tieRank(a.working_name);
      if (d) return d;
      return byRecencyDesc((c: any) => c.created_at)(a, b);
    }),
    SLICE_CAPS.mentioned_characters, 'mentioned_characters', budget,
  ).map((c: any) => trimEnrichedCharacter(c, budget));

  return {
    focal_type: 'character',
    focal_entity: focal,
    events_involving: involvingEvents,
    co_characters: coCharactersOut,
    mentioned_characters: mentionedOut,
    relevant_information: relevantInfo,
    focal_knowledge: focalKnowledge,
    focal_as_subject_of_knowledge: focalAsSubject,
    focal_relationships: focalRels,
    focal_structural_edges: focalStruct,
    arcs_involving: arcsInvolving,
    source_card_prose: sourceProse,
  };
}

function sliceForEvent(title: string, graph: any, sourceProse: string | undefined, extras: any = {}) {
  const events = graph.events ?? [];
  const chars = graph.characters ?? [];
  const locs = graph.locations ?? [];
  const info = graph.information ?? [];
  const kEdges = graph.knowledge_edges ?? [];

  const focal = events.find((e: any) => e.working_title === title);
  if (!focal) throw new Error(`event not found: ${title}`);

  const involvedChars = chars.filter((c: any) => (focal.involves ?? []).includes(c.working_name));
  const inLocs = locs.filter((l: any) => (focal.occurs_in ?? []).includes(l.working_name));
  const infoHere = info.filter((i: any) => i.established_in_event === title);

  const focalEventId = focal.id ?? '';
  const successorDepth: Map<string, number> =
    extras.successorDepth instanceof Map ? extras.successorDepth : new Map();
  const ancestorDepth: Map<string, number> = extras.ancestorDepth instanceof Map
    ? extras.ancestorDepth
    : new Map([[focalEventId, 0]]);

  const relevantInfoSummaries = new Set(infoHere.map((i: any) => i.summary));
  // Disproven arcs bypass the summary match (their fact is excluded from the
  // truth tier by design) — mirrors peer-slice.mjs sliceForEvent.
  const kHere = kEdges.filter((k: any) => k.disproven === true || relevantInfoSummaries.has(k.info_summary));
  const kHereFolded = foldKnowledgeEdges(
    kHere,
    (e: any) => `${e.knower_id || e.knower_name}|${e.info_id || e.info_summary}`,
    ancestorDepth, successorDepth,
  )
    .map((g: any) => g.current)
    .filter(Boolean)
    .map(stripKnowledgePrivate);

  const taggedInvolved = involvedChars.map((c: any) => {
    const byInfo = new Map<string, any[]>();
    for (const a of c.knowledge_arcs ?? []) {
      const key = a.info_id || a.info_summary;
      if (!byInfo.has(key)) byInfo.set(key, []);
      byInfo.get(key)!.push(a);
    }
    const known_at_this_event: any[] = [];
    const future_knowledge: any[] = [];
    const established_elsewhere: any[] = [];
    for (const group of byInfo.values()) {
      const { current, future, elsewhere } = foldKnowledgeGroup(group, ancestorDepth, successorDepth);
      if (current) known_at_this_event.push(stripKnowledgePrivate(current));
      else if (future) future_knowledge.push(stripKnowledgePrivate(future));
      else if (elsewhere.length) established_elsewhere.push(stripKnowledgePrivate(elsewhere[0]));
    }
    return {
      ...c,
      knowledge_arcs_at_event: known_at_this_event,
      future_knowledge_arcs: future_knowledge,
      established_elsewhere_arcs: established_elsewhere,
    };
  });

  const DENSE_HOPS = 2;
  const throughlinePath = (extras.throughlinePath ?? []).map((wp: any) => {
    if (Math.abs(wp.position) <= DENSE_HOPS) return wp;
    return {
      id: wp.id,
      working_title: wp.working_title,
      narrative_status: wp.narrative_status,
      position: wp.position,
      ...(wp.is_focal ? { is_focal: true } : {}),
    };
  });

  const focalCharNames = new Set(
    (focal.involves ?? []).filter((n: any) => typeof n === 'string' && n),
  );
  const characterOverlapEvents = (extras.characterOverlapEvents ?? []).map((e: any) => ({
    ...e,
    shared_characters: (e.involves ?? []).filter((n: string) => focalCharNames.has(n)),
  }));

  const arcsEvoked = (extras.arcsForEvent ?? []).map((arc: any) => {
    const sorted = topoSortEvokesByPrecedes(arc.evokes_sequence ?? []);
    const derived = computeArcDerivedStatus(sorted);
    return {
      id: arc.id,
      working_name: arc.working_name,
      kind: arc.kind,
      description: arc.description,
      evidence_quote: arc.evidence_quote,
      open_dimensions: arc.open_dimensions,
      involves_characters: arc.involves_characters,
      evokes_sequence: sorted,
      ...derived,
    };
  });

  const budget = extras._budget ?? (extras._budget = {});

  const characterOverlapOut = capTier(
    characterOverlapEvents.slice().sort((a: any, b: any) => {
      const d = (b.shared_characters?.length ?? 0) - (a.shared_characters?.length ?? 0);
      if (d) return d;
      const ns = nsRelevance(b.narrative_status) - nsRelevance(a.narrative_status);
      if (ns) return ns;
      return byRecencyDesc((e: any) => e.created_at)(a, b);
    }),
    SLICE_CAPS.character_overlap_events, 'character_overlap_events', budget,
  );

  const taggedInvolvedOut = taggedInvolved.map((c: any) => trimEnrichedCharacter(c, budget));

  const causal = extras.causalEdges ?? { caused_by_focal: [], caused_focal: [] };
  const causalRel = new Map<string, string>();
  for (const id of causal.caused_focal ?? []) causalRel.set(id, 'caused_focal');
  for (const id of causal.caused_by_focal ?? []) causalRel.set(id, 'caused_by_focal');
  const annotateCausal = (node: any) => {
    const rel = node && node.id ? causalRel.get(node.id) : undefined;
    return rel ? { ...node, causal_relation_to_focal: rel } : node;
  };

  return {
    focal_type: 'event',
    focal_entity: focal,
    audience_state: focal.audience_state ?? {},
    throughline_path: throughlinePath.map(annotateCausal),
    character_overlap_events: characterOverlapOut.map(annotateCausal),
    arcs_evoked: arcsEvoked.map(annotateCausal),
    characters_involved: taggedInvolvedOut,
    locations: inLocs,
    information_established_here: infoHere,
    knowledge_edges_anchored_here: kHereFolded,
    source_card_prose: sourceProse,
  };
}

function sliceForSequence(title: string, graph: any, sourceProse: string | undefined) {
  const sequence = graph.sequence;
  if (!sequence) throw new Error(`sequence not found: ${title}`);

  const members = graph.events ?? [];
  const sorted = topoSortByPrecedes(members);
  const memberTitles = new Set(sorted.map((e: any) => e.working_title));

  const member_scenes = sorted.map((e: any) => ({
    id: e.id,
    working_title: e.working_title,
    summary: e.summary,
    narrative_status: e.narrative_status,
    sub_events: e.sub_events ?? [],
    involves: e.involves ?? [],
    occurs_in: e.occurs_in ?? [],
    open_dimensions: e.open_dimensions ?? [],
  }));

  const before: string[] = [];
  const after: string[] = [];
  if (sorted.length > 0) {
    for (const t of sorted[0].preceded_by ?? []) {
      if (!memberTitles.has(t)) before.push(t);
    }
    for (const t of sorted[sorted.length - 1].precedes ?? []) {
      if (!memberTitles.has(t)) after.push(t);
    }
  }

  return {
    focal_type: 'sequence',
    focal_entity: {
      id: sequence.id,
      working_title: sequence.working_title,
      summary: sequence.summary,
      description: sequence.description,
      open_dimensions: sequence.open_dimensions ?? [],
    },
    scene_count: member_scenes.length,
    member_scenes,
    throughline_neighbors: { before, after },
    arcs_threading: graph.arcs_threading ?? [],
    source_card_prose: sourceProse,
  };
}

// =====================================================================
// Payload indexing: derive the loader output shapes from the
// list-project-entities payload (project-reads.mjs shape).
// =====================================================================

type Payload = ListProjectEntitiesResponse;

interface Indexes {
  projectId: string;
  entityById: Map<string, ProjectEntity>;
  aliveById: Map<string, ProjectEntity>;
  infoById: Map<string, ProjectInformation>;
  // Belief tier: ALL facts including pages-superseded ones. Knowledge edges
  // resolve against this so belief history survives pages-as-gospel (law 7:
  // the peer gets maximum dramatic context, tagged disproven). The truth tier
  // (infoById) keeps excluding superseded.
  allInfoById: Map<string, ProjectInformation>;
  // Adjacency, in payload edge-array order. Ids only; alive checks at use site.
  charsByEvent: Map<string, string[]>;      // event id -> character ids (INVOLVES)
  eventsByChar: Map<string, string[]>;      // character id -> event ids (INVOLVES, event source only)
  relsByChar: Map<string, string[]>;        // character id -> relationship ids (INVOLVES, rel source)
  locsByEvent: Map<string, string[]>;       // event id -> location ids (OCCURS_IN)
  precedesOut: Map<string, string[]>;       // event id -> successor event ids
  precedesIn: Map<string, string[]>;        // event id -> predecessor event ids
  structuralOutByChar: Map<string, Array<{ from: string; to: string; predicate: string; evidence_quote?: string }>>;
  structuralInByChar: Map<string, Array<{ from: string; to: string; predicate: string; evidence_quote?: string }>>;
  knowledgeByKnower: Map<string, any[]>;
  knowledgeByInfo: Map<string, any[]>;
  evokesByArc: Map<string, any[]>;
  evokesByEvent: Map<string, any[]>;
  arcsByChar: Map<string, string[]>;        // character id -> arc ids (ARC INVOLVES)
  charsByArc: Map<string, string[]>;        // arc id -> character ids
  infosByEvent: Map<string, string[]>;      // event id -> information ids (ESTABLISHED_IN)
  eventsBySeq: Map<string, string[]>;       // sequence id -> member event ids (CONTAINS)
  causes: Array<{ from: string; to: string; evidence_quote?: string }>;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function pushAny(map: Map<string, any[]>, key: string, value: any) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function isAlive(e: ProjectEntity | undefined): e is ProjectEntity {
  return !!e && !e.deleted_at;
}

function buildIndexes(payload: Payload): Indexes {
  const entityById = new Map<string, ProjectEntity>();
  const aliveById = new Map<string, ProjectEntity>();
  for (const e of payload.entities ?? []) {
    if (!e?.id) continue;
    entityById.set(e.id, e);
    if (!e.deleted_at) aliveById.set(e.id, e);
  }
  const infoById = new Map<string, ProjectInformation>();
  const allInfoById = new Map<string, ProjectInformation>();
  for (const i of payload.information ?? []) {
    if (!i?.id) continue;
    allInfoById.set(i.id, i);
    // Belief/truth split (law 7, 2026-07-18): superseded facts drop out of
    // the TRUTH tier only (information arrays), mirroring the server loaders'
    // hasNot filter. Knowledge edges resolve via allInfoById and carry
    // disproven — the peer path keeps belief history.
    if ((i as any).superseded_by_pages) continue;
    infoById.set(i.id, i);
  }

  const ix: Indexes = {
    projectId: payload.projectId,
    entityById,
    aliveById,
    infoById,
    allInfoById,
    charsByEvent: new Map(),
    eventsByChar: new Map(),
    relsByChar: new Map(),
    locsByEvent: new Map(),
    precedesOut: new Map(),
    precedesIn: new Map(),
    structuralOutByChar: new Map(),
    structuralInByChar: new Map(),
    knowledgeByKnower: new Map(),
    knowledgeByInfo: new Map(),
    evokesByArc: new Map(),
    evokesByEvent: new Map(),
    arcsByChar: new Map(),
    charsByArc: new Map(),
    infosByEvent: new Map(),
    eventsBySeq: new Map(),
    causes: [],
  };

  const edges = payload.edges ?? ({} as Payload['edges']);

  for (const e of edges.involves ?? []) {
    const src = aliveById.get(e.from);
    const dst = aliveById.get(e.to);
    if (!isAlive(src) || !isAlive(dst) || dst.type !== 'character') continue;
    if (src.type === 'event') {
      push(ix.charsByEvent, e.from, e.to);
      push(ix.eventsByChar, e.to, e.from);
    } else if (src.type === 'relationship') {
      push(ix.relsByChar, e.to, e.from);
    }
  }

  for (const e of edges.occurs_in ?? []) {
    const src = aliveById.get(e.from);
    const dst = aliveById.get(e.to);
    if (!isAlive(src) || !isAlive(dst) || src.type !== 'event' || dst.type !== 'location') continue;
    push(ix.locsByEvent, e.from, e.to);
  }

  for (const e of edges.precedes ?? []) {
    if (!isAlive(aliveById.get(e.from)) || !isAlive(aliveById.get(e.to))) continue;
    push(ix.precedesOut, e.from, e.to);
    push(ix.precedesIn, e.to, e.from);
  }

  for (const e of edges.structural ?? []) {
    if (!isAlive(aliveById.get(e.from)) || !isAlive(aliveById.get(e.to))) continue;
    pushAny(ix.structuralOutByChar as any, e.from, e);
    pushAny(ix.structuralInByChar as any, e.to, e);
  }

  for (const k of edges.knowledge ?? []) {
    // Knower must be alive if it is a payload entity; the Audience vertex is
    // not in entities[] and passes through (the server keeps Audience always).
    const knower = entityById.get(k.knower_id);
    if (knower && knower.deleted_at) continue;
    // Belief tier: edges on superseded facts stay in (allInfoById), mirroring
    // the peer loaders' lifted filter; the shape sites tag them disproven.
    if (!allInfoById.has(k.info_id)) continue;
    pushAny(ix.knowledgeByKnower, k.knower_id, k);
    pushAny(ix.knowledgeByInfo, k.info_id, k);
  }

  for (const ev of edges.evokes ?? []) {
    if (!isAlive(aliveById.get(ev.event_id)) || !isAlive(aliveById.get(ev.arc_id))) continue;
    pushAny(ix.evokesByArc, ev.arc_id, ev);
    pushAny(ix.evokesByEvent, ev.event_id, ev);
  }

  for (const ai of edges.arc_involves ?? []) {
    if (!isAlive(aliveById.get(ai.arc_id)) || !isAlive(aliveById.get(ai.character_id))) continue;
    push(ix.arcsByChar, ai.character_id, ai.arc_id);
    push(ix.charsByArc, ai.arc_id, ai.character_id);
  }

  for (const c of edges.contains ?? []) {
    if (!isAlive(aliveById.get(c.from)) || !isAlive(aliveById.get(c.to))) continue;
    push(ix.eventsBySeq, c.from, c.to);
  }

  for (const c of edges.causes ?? []) {
    if (!isAlive(aliveById.get(c.from)) || !isAlive(aliveById.get(c.to))) continue;
    ix.causes.push(c);
  }

  for (const info of payload.information ?? []) {
    for (const evId of info.established_in_event_ids ?? []) {
      if (!isAlive(aliveById.get(evId))) continue;
      push(ix.infosByEvent, evId, info.id);
    }
  }

  return ix;
}

// ---- normalize* mirrors (neptune-reads.mjs shapes) ----

function charNameById(ix: Indexes, id: string): string {
  const e = ix.aliveById.get(id);
  return e && e.type === 'character' ? String(e.working_name ?? '') : '';
}

function normalizeCharacterLocal(e: ProjectEntity) {
  return {
    id: e.id ?? '',
    working_name: e.working_name ?? '',
    description: e.description ?? '',
    established_traits: e.established_traits ?? [],
    open_dimensions: e.open_dimensions ?? [],
    evidence_quote: e.evidence_quote ?? '',
  };
}

function normalizeEventLocal(ix: Indexes, e: ProjectEntity) {
  const involves = (ix.charsByEvent.get(e.id) ?? [])
    .map((cid) => charNameById(ix, cid))
    .filter(Boolean);
  const occursIn = (ix.locsByEvent.get(e.id) ?? [])
    .map((lid) => String(ix.aliveById.get(lid)?.working_name ?? ''))
    .filter(Boolean);
  const precedes = (ix.precedesOut.get(e.id) ?? [])
    .map((eid) => String(ix.aliveById.get(eid)?.working_title ?? ''))
    .filter(Boolean);
  const precededBy = (ix.precedesIn.get(e.id) ?? [])
    .map((eid) => String(ix.aliveById.get(eid)?.working_title ?? ''))
    .filter(Boolean);
  return {
    id: e.id ?? '',
    working_title: e.working_title ?? '',
    summary: e.summary ?? '',
    narrative_status: e.narrative_status ?? '',
    sub_events: e.sub_events ?? [],
    open_dimensions: e.open_dimensions ?? [],
    audience_state: e.audience_state ?? {},
    evidence_quote: e.evidence_quote ?? '',
    involves,
    occurs_in: occursIn,
    precedes,
    preceded_by: precededBy,
  };
}

function normalizeLocationLocal(e: ProjectEntity) {
  return {
    working_name: e.working_name ?? '',
    description: e.description ?? '',
    int_ext: e.int_ext ?? '',
    evidence_quote: e.evidence_quote ?? '',
  };
}

function normalizeRelationshipLocal(e: ProjectEntity) {
  return {
    character_a: e.character_a ?? '',
    character_b: e.character_b ?? '',
    kind: e.kind ?? '',
    description: e.description ?? '',
    rationale: e.rationale ?? '',
    open_dimensions: e.open_dimensions ?? [],
    evidence_quote: e.evidence_quote ?? '',
  };
}

// Same slug the backend uses for deterministic vertex ids. Replicated so the
// co-character / mentioned-character fetch matches server behavior exactly,
// including its rename blind spot (a renamed character's vertex id keeps the
// old slug, so a by-current-name lookup misses it on BOTH sides).
function slug(s: any): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function fetchCharactersByNamesLocal(ix: Indexes, names: string[]) {
  const out: any[] = [];
  for (const n of names) {
    const id = `char_${slug(n)}_${slug(ix.projectId)}`;
    const e = ix.aliveById.get(id);
    if (e && e.type === 'character') out.push(normalizeCharacterLocal(e));
  }
  return out;
}

function knowledgeState(k: any): string {
  return k.state && k.state !== ''
    ? String(k.state)
    : String(k.label ?? '') === 'DOESNT_KNOW'
    ? 'doesnt_know'
    : 'knows';
}

// loadCharacterEnrichment mirror. prior_responses / open_questions are
// Dynamo-only: set empty here and excluded from the diff via SHADOW_SKIP_TIERS.
function buildEnrichment(ix: Indexes, charId: string) {
  const knowledge_arcs = (ix.knowledgeByKnower.get(charId) ?? []).map((k: any) => {
    const inf = ix.allInfoById.get(k.info_id);
    return {
      info_id: String(k.info_id ?? ''),
      info_summary: String(inf?.summary ?? ''),
      state: knowledgeState(k),
      state_qualifier: String(k.state_qualifier ?? ''),
      evidence_quote: String(k.evidence_quote ?? ''),
      at_event: String(k.at_event ?? ''),
      // Server fold is NOT alive-filtered; payload established_in_event_ids is.
      // A fact anchored on a trashed scene can differ by that id (rare).
      established_in_event_ids: (inf?.established_in_event_ids ?? []).map(String),
      // Key present only when true — mirrors the server loaders exactly.
      ...((inf as any)?.superseded_by_pages ? { disproven: true } : {}),
    };
  });

  const other_events = (ix.eventsByChar.get(charId) ?? [])
    .map((eid) => ix.aliveById.get(eid))
    .filter(isAlive)
    .map((e) => ({
      id: String(e.id ?? ''),
      working_title: String(e.working_title ?? ''),
      summary: String(e.summary ?? ''),
      narrative_status: String(e.narrative_status ?? ''),
    }));

  const relationships = (ix.relsByChar.get(charId) ?? [])
    .map((rid) => ix.aliveById.get(rid))
    .filter(isAlive)
    .map(normalizeRelationshipLocal);

  const structural_out = (ix.structuralOutByChar.get(charId) ?? []).map((s: any) => ({
    to_id: String(s.to ?? ''),
    to_name: charNameById(ix, s.to),
    predicate: String(s.predicate ?? ''),
    evidence_quote: String(s.evidence_quote ?? ''),
  }));

  const structural_in = (ix.structuralInByChar.get(charId) ?? []).map((s: any) => ({
    from_id: String(s.from ?? ''),
    from_name: charNameById(ix, s.from),
    predicate: String(s.predicate ?? ''),
    evidence_quote: String(s.evidence_quote ?? ''),
  }));

  return { knowledge_arcs, other_events, relationships, structural_out, structural_in };
}

function spliceEnrichment(ix: Indexes, c: any) {
  const enrich = buildEnrichment(ix, c.id);
  Object.assign(c, {
    knowledge_arcs: enrich.knowledge_arcs,
    other_events: enrich.other_events,
    bonded_relationships: enrich.relationships,
    structural_out: enrich.structural_out,
    structural_in: enrich.structural_in,
    prior_responses: [],
    open_questions: [],
  });
}

// loadArcsForCharacter / loadArcsForEvent mirror (arc rows with full EVOKES
// sequence + _precedes/_preceded_by event-id arrays for the topo-sort).
function buildArcRows(ix: Indexes, arcIds: string[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const arcId of arcIds) {
    if (seen.has(arcId)) continue;
    seen.add(arcId);
    const arc = ix.aliveById.get(arcId);
    if (!arc || arc.type !== 'arc') continue;
    const evokes = (ix.evokesByArc.get(arcId) ?? [])
      .filter((ev: any) => isAlive(ix.aliveById.get(ev.event_id)))
      .map((ev: any) => {
        const e = ix.aliveById.get(ev.event_id)!;
        return {
          event_id: String(ev.event_id ?? ''),
          event_working_title: String(e.working_title ?? e.working_name ?? ''),
          event_narrative_status: String(e.narrative_status ?? 'on_screen'),
          state_at_event: String(ev.state_at_event ?? ''),
          transition: String(ev.transition ?? ''),
          evidence_quote: String(ev.evidence_quote ?? ''),
          _precedes: (ix.precedesOut.get(ev.event_id) ?? []).map(String),
          _preceded_by: (ix.precedesIn.get(ev.event_id) ?? []).map(String),
        };
      });
    out.push({
      id: String(arc.id ?? ''),
      working_name: String(arc.working_name ?? ''),
      kind: String(arc.kind ?? ''),
      description: String(arc.description ?? ''),
      evidence_quote: String(arc.evidence_quote ?? ''),
      open_dimensions: arc.open_dimensions ?? [],
      aliases: arc.aliases ?? [],
      involves_characters: (ix.charsByArc.get(arcId) ?? [])
        .map((cid) => charNameById(ix, cid))
        .filter(Boolean),
      evokes_sequence: evokes,
    });
  }
  return out;
}

// BFS min-hop map over PRECEDES (plain BFS replaces the server's
// simplePath+sack walk; min simple-path length equals min hop count).
function bfsDepths(
  adj: Map<string, string[]>,
  start: string,
  maxDepth?: number,
): Map<string, number> {
  const depths = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  let d = 0;
  while (frontier.length > 0 && (maxDepth === undefined || d < maxDepth)) {
    d += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (depths.has(nb)) continue;
        depths.set(nb, d);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return depths;
}

const THROUGHLINE_DEPTH = 5;

// loadEventThroughline mirror: waypoints at signed positions, dedup keeps
// min-abs position (forward inserted before backward, like the server), sort
// by position then working_title.
function buildThroughline(ix: Indexes, focalId: string): any[] {
  const focal = ix.aliveById.get(focalId);
  if (!focal) return [];

  const waypoint = (e: ProjectEntity, position: number, isFocal: boolean) => ({
    id: String(e.id ?? ''),
    working_title: String(e.working_title ?? ''),
    summary: String(e.summary ?? ''),
    narrative_status: String(e.narrative_status ?? ''),
    sub_events: e.sub_events ?? [],
    involves: (ix.charsByEvent.get(e.id) ?? []).map((cid) => charNameById(ix, cid)).filter(Boolean),
    occurs_in: (ix.locsByEvent.get(e.id) ?? [])
      .map((lid) => String(ix.aliveById.get(lid)?.working_name ?? ''))
      .filter(Boolean),
    position,
    ...(isFocal ? { is_focal: true } : {}),
  });

  const out: any[] = [waypoint(focal, 0, true)];
  const fwd = bfsDepths(ix.precedesOut, focalId, THROUGHLINE_DEPTH);
  for (const [id, depth] of fwd) {
    if (id === focalId) continue;
    const e = ix.aliveById.get(id);
    if (e) out.push(waypoint(e, Math.max(1, depth), false));
  }
  const back = bfsDepths(ix.precedesIn, focalId, THROUGHLINE_DEPTH);
  for (const [id, depth] of back) {
    if (id === focalId) continue;
    const e = ix.aliveById.get(id);
    if (e) out.push(waypoint(e, -Math.max(1, depth), false));
  }

  const byId = new Map<string, any>();
  for (const wp of out) {
    const existing = byId.get(wp.id);
    if (!existing || Math.abs(wp.position) < Math.abs(existing.position)) {
      byId.set(wp.id, wp);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return String(a.working_title).localeCompare(String(b.working_title));
  });
}

// loadCharacterOverlapEvents mirror: per involved character (in order), that
// character's events minus the focal, first contributor wins.
function buildCharacterOverlapEvents(ix: Indexes, focalEventId: string, charIds: string[]) {
  const byId = new Map<string, any>();
  for (const charId of charIds) {
    for (const eid of ix.eventsByChar.get(charId) ?? []) {
      if (!eid || eid === focalEventId) continue;
      if (byId.has(eid)) continue;
      const e = ix.aliveById.get(eid);
      if (!e) continue;
      byId.set(eid, {
        id: String(e.id ?? ''),
        working_title: String(e.working_title ?? ''),
        summary: String(e.summary ?? ''),
        narrative_status: String(e.narrative_status ?? ''),
        sub_events: e.sub_events ?? [],
        involves: (ix.charsByEvent.get(eid) ?? []).map((cid) => charNameById(ix, cid)).filter(Boolean),
        occurs_in: (ix.locsByEvent.get(eid) ?? [])
          .map((lid) => String(ix.aliveById.get(lid)?.working_name ?? ''))
          .filter(Boolean),
      });
    }
  }
  return Array.from(byId.values());
}

// loadCausesForFocal mirror.
function buildCausesForFocal(ix: Indexes, focalId: string) {
  return {
    caused_by_focal: ix.causes.filter((c) => c.from === focalId).map((c) => String(c.to)),
    caused_focal: ix.causes.filter((c) => c.to === focalId).map((c) => String(c.from)),
  };
}

// ---- knowledge edge shapes per focal type ----

function knowerNameAndType(ix: Indexes, knowerId: string): { name: string; type: string } {
  const e = ix.entityById.get(knowerId);
  if (e && e.type === 'character') {
    return { name: String(e.working_name ?? ''), type: 'Character' };
  }
  // The Audience vertex is not a renderable entity, so it never appears in
  // entities[]; any unresolvable knower id is the audience singleton.
  return { name: 'audience', type: 'Audience' };
}

// =====================================================================
// Graph reconstruction per focal type (neptune-reads.mjs loader mirrors)
// =====================================================================

function buildCharacterGraph(ix: Indexes, cardId: string, focalName: string) {
  const focal = ix.aliveById.get(cardId);
  if (!focal || focal.type !== 'character') return null;

  const focalNameInGraph = String(focal.working_name ?? focalName ?? '');

  const involvingEventIds = ix.eventsByChar.get(cardId) ?? [];
  const events = involvingEventIds
    .map((eid) => ix.aliveById.get(eid))
    .filter(isAlive)
    .map((e) => normalizeEventLocal(ix, e));

  const coCharacterNames = new Set<string>();
  for (const e of events) {
    for (const n of e.involves) {
      if (n && n !== focalNameInGraph) coCharacterNames.add(n);
    }
  }
  const coCharacters = fetchCharactersByNamesLocal(ix, Array.from(coCharacterNames));

  // Locations: focal's events' occurs_in, dedup in walk order.
  const locSeen = new Set<string>();
  const locations: any[] = [];
  for (const eid of involvingEventIds) {
    for (const lid of ix.locsByEvent.get(eid) ?? []) {
      if (locSeen.has(lid)) continue;
      locSeen.add(lid);
      const l = ix.aliveById.get(lid);
      if (l) locations.push(normalizeLocationLocal(l));
    }
  }

  // Information established in the focal's events, dedup in walk order.
  // established_in_event resolves to the TITLE of the info's FIRST alive
  // establishing event (loader takes eventTitles[0]).
  const infoSeen = new Set<string>();
  const information: any[] = [];
  for (const eid of involvingEventIds) {
    for (const iid of ix.infosByEvent.get(eid) ?? []) {
      if (infoSeen.has(iid)) continue;
      infoSeen.add(iid);
      const inf = ix.infoById.get(iid);
      if (!inf) continue;
      const firstEventId = (inf.established_in_event_ids ?? [])[0];
      const firstTitle = firstEventId
        ? String(ix.entityById.get(firstEventId)?.working_title ?? '')
        : '';
      information.push({
        summary: inf.summary ?? '',
        evidence_quote: inf.evidence_quote ?? '',
        established_in_event: firstTitle,
      });
    }
  }

  // Knowledge edges where the focal is the knower. Character-focal loader
  // shape carries NO at_event / info_id / knower_id fields, and knower_name
  // is the focalId PARAMETER (not the graph name), per loadCharacterNeighborhood.
  const knowledge_edges = (ix.knowledgeByKnower.get(cardId) ?? []).map((k: any) => {
    const inf = ix.allInfoById.get(k.info_id);
    return {
      knower_name: focalName,
      knower_type: 'Character',
      info_summary: String(inf?.summary ?? ''),
      state: knowledgeState(k),
      state_qualifier: String(k.state_qualifier ?? ''),
      evidence_quote: String(k.evidence_quote ?? ''),
      ...((inf as any)?.superseded_by_pages ? { disproven: true } : {}),
    };
  });

  const relationships = (ix.relsByChar.get(cardId) ?? [])
    .map((rid) => ix.aliveById.get(rid))
    .filter(isAlive)
    .map(normalizeRelationshipLocal);

  // Structural edges: out first then in, from/to as names. The out side uses
  // the focalId parameter for from_character (server passes focalName through).
  const structural_edges = [
    ...(ix.structuralOutByChar.get(cardId) ?? []).map((s: any) => ({
      from_character: focalName,
      to_character: charNameById(ix, s.to),
      predicate: String(s.predicate ?? ''),
      evidence_quote: String(s.evidence_quote ?? ''),
    })),
    ...(ix.structuralInByChar.get(cardId) ?? []).map((s: any) => ({
      from_character: charNameById(ix, s.from),
      to_character: focalName,
      predicate: String(s.predicate ?? ''),
      evidence_quote: String(s.evidence_quote ?? ''),
    })),
  ].filter((s) => s.from_character && s.to_character);

  const mentionedCharNames = new Set<string>();
  for (const r of relationships) {
    if (r.character_a && r.character_a !== focalNameInGraph) mentionedCharNames.add(r.character_a);
    if (r.character_b && r.character_b !== focalNameInGraph) mentionedCharNames.add(r.character_b);
  }
  for (const s of structural_edges) {
    if (s.from_character && s.from_character !== focalNameInGraph) mentionedCharNames.add(s.from_character);
    if (s.to_character && s.to_character !== focalNameInGraph) mentionedCharNames.add(s.to_character);
  }
  for (const c of coCharacters) {
    mentionedCharNames.delete(c.working_name);
  }
  const mentionedCharacters = fetchCharactersByNamesLocal(ix, Array.from(mentionedCharNames));

  const characters = [normalizeCharacterLocal(focal), ...coCharacters, ...mentionedCharacters];

  return {
    characters,
    events,
    information,
    locations,
    knowledge_edges,
    relationships,
    structural_edges,
    themes: [],
  };
}

function buildEventGraph(ix: Indexes, cardId: string, focalTitle: string) {
  const focal = ix.aliveById.get(cardId);
  if (!focal || focal.type !== 'event') return null;

  const involvedCharIds = ix.charsByEvent.get(cardId) ?? [];
  const characters = involvedCharIds
    .map((cid) => ix.aliveById.get(cid))
    .filter(isAlive)
    .map(normalizeCharacterLocal);

  const locations = (ix.locsByEvent.get(cardId) ?? [])
    .map((lid) => ix.aliveById.get(lid))
    .filter(isAlive)
    .map(normalizeLocationLocal);

  // Information established here; established_in_event is the focal title
  // PARAMETER (loadEventNeighborhood passes workingTitle straight through).
  const information = (ix.infosByEvent.get(cardId) ?? [])
    .map((iid) => ix.infoById.get(iid))
    .filter((i): i is ProjectInformation => !!i)
    .map((i) => ({
      summary: i.summary ?? '',
      evidence_quote: i.evidence_quote ?? '',
      established_in_event: focalTitle,
    }));

  // Knowledge edges targeting info established here, in info-walk order.
  // Belief tier: superseded facts' edges stay (allInfoById), tagged disproven,
  // mirroring loadEventNeighborhood's lifted filter for the peer path.
  const knowledge_edges: any[] = [];
  for (const iid of ix.infosByEvent.get(cardId) ?? []) {
    const inf = ix.allInfoById.get(iid);
    if (!inf) continue;
    for (const k of ix.knowledgeByInfo.get(iid) ?? []) {
      const { name, type } = knowerNameAndType(ix, k.knower_id);
      knowledge_edges.push({
        knower_name: name,
        knower_id: String(k.knower_id ?? ''),
        knower_type: type,
        info_summary: String(inf.summary ?? ''),
        info_id: String(iid),
        state: knowledgeState(k),
        state_qualifier: String(k.state_qualifier ?? ''),
        evidence_quote: String(k.evidence_quote ?? ''),
        at_event: String(k.at_event ?? ''),
        ...((inf as any)?.superseded_by_pages ? { disproven: true } : {}),
      });
    }
  }

  return {
    characters,
    events: [normalizeEventLocal(ix, focal)],
    information,
    locations,
    knowledge_edges,
    relationships: [],
    structural_edges: [],
    themes: [],
  };
}

function buildSequenceGraph(ix: Indexes, cardId: string) {
  const seq = ix.aliveById.get(cardId);
  if (!seq || seq.type !== 'sequence') return null;

  const sequence = {
    id: seq.id ?? '',
    working_title: seq.working_title ?? seq.working_name ?? '',
    working_name: seq.working_name ?? seq.working_title ?? '',
    summary: seq.summary ?? seq.description ?? '',
    description: seq.description ?? '',
    open_dimensions: seq.open_dimensions ?? [],
    evidence_quote: seq.evidence_quote ?? '',
  };

  const memberIds = ix.eventsBySeq.get(cardId) ?? [];
  const events = memberIds
    .map((eid) => ix.aliveById.get(eid))
    .filter(isAlive)
    .map((e) => normalizeEventLocal(ix, e));

  // Arcs threading through the member scenes (light: name + kind), dedup in
  // member-then-evokes walk order.
  const arcSeen = new Set<string>();
  const arcs_threading: Array<{ working_name: string; kind: string }> = [];
  for (const eid of memberIds) {
    for (const ev of ix.evokesByEvent.get(eid) ?? []) {
      if (arcSeen.has(ev.arc_id)) continue;
      arcSeen.add(ev.arc_id);
      const arc = ix.aliveById.get(ev.arc_id);
      if (!arc || arc.type !== 'arc') continue;
      const wn = String(arc.working_name ?? '');
      if (wn) arcs_threading.push({ working_name: wn, kind: String(arc.kind ?? '') });
    }
  }

  return { sequence, events, arcs_threading };
}

// =====================================================================
// buildLocalSlice: the shadow entry point
// =====================================================================

// FIL-518 slice cutover: splice Dynamo priors (from get-slice-priors) onto a
// locally-composed slice, applying the SAME recency caps build-slice uses so
// the merged result equals the full server slice. Mutates `slice`.
export function mergePriorsIntoSlice(
  slice: any,
  priors: { focal?: { prior_responses?: any[]; open_questions?: any[] }; byChar?: Record<string, { prior_responses?: any[]; open_questions?: any[] }> },
): void {
  const budget: Record<string, any> = {};
  slice.prior_responses = capTier(
    (priors.focal?.prior_responses ?? []).slice().sort(byRecencyDesc((r: any) => r.answered_at)),
    SLICE_CAPS.prior_responses, 'prior_responses', budget,
  );
  slice.prior_open_questions = capTier(
    (priors.focal?.open_questions ?? []).slice().sort(byRecencyDesc((q: any) => q.asked_at)),
    SLICE_CAPS.prior_open_questions, 'prior_open_questions', budget,
  );
  const byChar = priors.byChar ?? {};
  const attach = (arr: any[] | undefined) => {
    for (const c of arr ?? []) {
      const p = byChar[c?.id];
      if (!p) continue;
      c.prior_responses = capTier(
        (p.prior_responses ?? []).slice().sort(byRecencyDesc((r: any) => r.answered_at)),
        SLICE_CAPS.per_char_prior_responses, 'per_char_prior_responses', budget,
      );
      c.open_questions = p.open_questions ?? [];
    }
  };
  attach(slice.co_characters);
  attach(slice.mentioned_characters);
  attach(slice.characters_involved);
}

export function buildLocalSlice(
  payload: Payload,
  opts: LocalSliceOptions,
): { slice: any; skippedTiers: string[] } | null {
  const { focalType, focalId, cardId, sourceProse } = opts;
  const ix = buildIndexes(payload);

  try {
    let slice: any;

    if (focalType === 'character') {
      const graph = buildCharacterGraph(ix, cardId, focalId);
      if (!graph) return null;
      // Phase-1 enrichment splice for every non-focal character, matching
      // handleBuildSlice's charsToEnrich filter (working_name vs focalId).
      for (const c of graph.characters) {
        if (c?.id && c.working_name !== focalId) spliceEnrichment(ix, c);
      }
      const arcsForCharacter = buildArcRows(ix, ix.arcsByChar.get(cardId) ?? []);
      slice = sliceForCharacter(focalId, graph, sourceProse, {
        arcsForCharacter,
        _budget: {},
      });
    } else if (focalType === 'event') {
      const graph = buildEventGraph(ix, cardId, focalId);
      if (!graph) return null;
      for (const c of graph.characters) {
        if ((c as any)?.id) spliceEnrichment(ix, c);
      }
      const successorDepth = bfsDepths(ix.precedesOut, cardId);
      successorDepth.delete(cardId); // strict successors, focal excluded
      const ancestorDepth = bfsDepths(ix.precedesIn, cardId); // focal at 0
      const throughlinePath = buildThroughline(ix, cardId);
      const characterOverlapEvents = buildCharacterOverlapEvents(
        ix,
        cardId,
        graph.characters.map((c: any) => c.id),
      );
      const arcIds = (ix.evokesByEvent.get(cardId) ?? []).map((ev: any) => String(ev.arc_id));
      const arcsForEvent = buildArcRows(ix, arcIds);
      const causalEdges = buildCausesForFocal(ix, cardId);
      slice = sliceForEvent(focalId, graph, sourceProse, {
        successorDepth,
        ancestorDepth,
        throughlinePath,
        characterOverlapEvents,
        arcsForEvent,
        causalEdges,
        _budget: {},
      });
    } else if (focalType === 'sequence') {
      const graph = buildSequenceGraph(ix, cardId);
      if (!graph) return null;
      slice = sliceForSequence(focalId, graph, sourceProse);
    } else {
      return null;
    }

    // handleBuildSlice attaches these from Dynamo; not derivable locally.
    slice.prior_responses = [];
    slice.prior_open_questions = [];

    return { slice, skippedTiers: SHADOW_SKIP_TIERS.slice() };
  } catch {
    // The ported composition throws when the focal is missing from the
    // reconstructed graph (for example a working_name mismatch after rename).
    // The server would 500 the same way; the shadow just reports not-found.
    return null;
  }
}

// =====================================================================
// diffSlices: structural diff with loose empty equality. Tiers whose
// order the server DEFINES (topo sorts, relevance-cap sorts, position
// sorts) compare order-sensitively; every other array tier inherits
// Gremlin traversal order server-side and payload order locally, so
// those compare as MULTISETS (a pure reordering is not a mismatch; it
// was the dominant false-positive class in the first live shadow runs).
// =====================================================================

const MAX_MISMATCHES = 40;

const ORDERED_KEYS = new Set([
  'throughline_path',
  'character_overlap_events',
  'co_characters',
  'mentioned_characters',
  'events_involving',
  'evokes_sequence',
  'member_scenes',
]);

function isEmptyish(v: any): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function isPlainObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Stable stringify (sorted object keys, emptyish collapsed) so the multiset
// sort pairs equivalent elements regardless of source order.
function canon(v: any): string {
  if (isEmptyish(v)) return '""';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function diffSlices(local: any, server: any, skippedTiers: string[]): SliceDiff {
  const skip = new Set<string>([...skippedTiers, 'source_card_prose']);
  const mismatches: SliceMismatch[] = [];

  const record = (path: string, kind: SliceMismatch['kind'], l?: any, s?: any) => {
    if (mismatches.length >= MAX_MISMATCHES) return;
    mismatches.push({ path, kind, local: clip(l), server: clip(s) });
  };

  const clip = (v: any) => {
    if (typeof v === 'string' && v.length > 160) return `${v.slice(0, 160)}...`;
    return v;
  };

  const walk = (l: any, s: any, path: string, key: string) => {
    if (mismatches.length >= MAX_MISMATCHES) return;
    if (isEmptyish(l) && isEmptyish(s)) return;
    if (isEmptyish(l) && !isEmptyish(s)) { record(path, 'missing-local', l, s); return; }
    if (!isEmptyish(l) && isEmptyish(s)) { record(path, 'missing-server', l, s); return; }

    if (Array.isArray(l) && Array.isArray(s)) {
      let lArr = l;
      let sArr = s;
      if (!ORDERED_KEYS.has(key)) {
        const byCanon = (a: any, b: any) => {
          const ca = canon(a);
          const cb = canon(b);
          return ca < cb ? -1 : ca > cb ? 1 : 0;
        };
        lArr = l.slice().sort(byCanon);
        sArr = s.slice().sort(byCanon);
      }
      const len = Math.max(lArr.length, sArr.length);
      for (let i = 0; i < len; i++) {
        if (mismatches.length >= MAX_MISMATCHES) return;
        walk(lArr[i], sArr[i], `${path}[${i}]`, key);
      }
      return;
    }

    if (isPlainObject(l) && isPlainObject(s)) {
      const keys = new Set([...Object.keys(l), ...Object.keys(s)]);
      for (const k of keys) {
        if (skip.has(k)) continue;
        if (mismatches.length >= MAX_MISMATCHES) return;
        walk(l[k], s[k], path ? `${path}.${k}` : k, k);
      }
      return;
    }

    // Type mismatch (array vs object vs primitive) or unequal primitives.
    if (l !== s) record(path, 'value', l, s);
  };

  walk(local, server, '', '');
  return { equal: mismatches.length === 0, mismatches };
}

// =====================================================================
// runSliceShadow: fire-and-forget shadow diff beside the server call.
// Logs only; never throws to the caller.
// =====================================================================

export async function runSliceShadow(args: {
  payload: ListProjectEntitiesResponse | null;
  storyId: string;
  focalType: 'character' | 'event' | 'relationship' | 'sequence';
  focalId: string;
  cardId: string;
  usedSeed: boolean;
  serverSlice: any;
}): Promise<void> {
  const { storyId, focalType, focalId, cardId, usedSeed, serverSlice } = args;
  try {
    if (usedSeed) {
      console.info('[slice-shadow] skipped', { focalType, focalId, reason: 'seed flow, skipped' });
      return;
    }
    if (focalType === 'relationship') {
      console.info('[slice-shadow] skipped', { focalType, focalId, reason: 'unsupported focal type' });
      return;
    }
    let payload = args.payload;
    if (!payload) {
      payload = (await loadStoredGraph(storyId))?.payload ?? null;
    }
    if (!payload) {
      console.info('[slice-shadow] skipped', { focalType, focalId, reason: 'no local graph payload' });
      return;
    }
    const t0 = performance.now();
    const result = buildLocalSlice(payload, { focalType, focalId, cardId });
    const localMs = Math.round(performance.now() - t0);
    if (!result) {
      console.info('[slice-shadow] skipped', { focalType, focalId, reason: 'focal not found in local payload', localMs });
      return;
    }
    const diff = diffSlices(result.slice, serverSlice, result.skippedTiers);
    console.info('[slice-shadow]', {
      focalType,
      focalId,
      equal: diff.equal,
      mismatchCount: diff.mismatches.length,
      skippedTiers: result.skippedTiers,
      localMs,
      mismatches: diff.mismatches.slice(0, 10).map((m) => ({ path: m.path, kind: m.kind, local: m.local, server: m.server })),
    });
  } catch (err: any) {
    console.info('[slice-shadow] skipped', { focalType, focalId, reason: 'shadow error', error: err?.message ?? String(err) });
  }
}
