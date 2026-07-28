// components/Freeform/corkboard/signals.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React from 'react';
import { type ArcKind, type EvokesTransition, type ListProjectEntitiesResponse } from '../../../lib/freeformApi';
import { CardBox } from './cards';
import { truncate } from './labels';

// =====================================================================
// Card signals — derived counts/labels per card from the graph edges.
// Computed once per data refetch and threaded down to CardBox so per-type
// bodies render type-specific signal lines without re-walking edges.
// =====================================================================

export type CardSignal = {
  // Character
  eventCount?: number;
  structuralCount?: number;
  structuralPreds?: string[];
  structuralPeers?: string[];
  /** Knowledge arcs: what this Character knows / doesn't know. */
  knowsList?: Array<{ info_summary: string; state: string; state_qualifier?: string }>;
  /** Events this Character appears in (with narrative_status). */
  appearsInEvents?: Array<{ id: string; title: string; narrative_status?: string }>;
  // Event
  involvesCharNames?: string[];
  occursInLocNames?: string[];
  precedesNextTitles?: string[];
  precededByTitles?: string[];
  subEventCount?: number;
  /** D'-5 — arcs this event EVOKES (Event card). Captured for symmetry; full
   *  surface in event-focal slice via build-slice. */
  evokesArcNames?: string[];
  /** D'-5 — full per-arc EVOKES entries from this event's perspective. Mirrors
   *  the data the arc card shows on its side, so an event with empty `summary`
   *  still surfaces arc-perspective content. Each entry is what the writer
   *  authored on the EVOKES edge for one of this event's evoked arcs. */
  evokesArcEntries?: Array<{
    arc_id: string;
    arc_name: string;
    arc_kind?: ArcKind | string;
    transition: EvokesTransition | '';
    state_at_event: string;
    evidence_quote: string;
  }>;
  // Location
  appearsInEventTitles?: string[];
  // Arc (FIL-504 / D'-5)
  /** Sorted EVOKES sequence — PRECEDES order with narrative_status tiebreaker
   *  (backstory before rendered/offstage when not connected by PRECEDES).
   *  Mirrors the backend slice composer's evokes_sequence for the music-sheet
   *  view on the expanded card. */
  evokesEntries?: Array<{
    event_id: string;
    event_title: string;
    narrative_status: string;
    transition: EvokesTransition | '';
    state_at_event: string;
  }>;
  /** Derived from latest EVOKES transition (Q6 lock — status isn't stored on
   *  the Arc vertex). "not yet raised" / "active as of X" / "resolved at X". */
  arcStatusLabel?: string;
  /** Names of characters INVOLVES'd on this arc. */
  arcInvolvesCharNames?: string[];
};

export function computeCardSignals(data: ListProjectEntitiesResponse | null): Record<string, CardSignal> {
  if (!data) return {};

  const out: Record<string, CardSignal> = {};
  const byId = new Map(data.entities.map((e) => [e.id, e]));

  for (const e of data.entities) {
    out[e.id] = { subEventCount: e.sub_events?.length ?? 0 };
  }

  // INVOLVES: from is Event/Relationship, to is Character.
  for (const inv of data.edges.involves) {
    const fromEnt = byId.get(inv.from);
    const toEnt = byId.get(inv.to);
    if (!fromEnt || !toEnt) continue;
    if (fromEnt.type === 'event') {
      const evtSig = out[fromEnt.id]!;
      (evtSig.involvesCharNames ??= []).push(toEnt.working_name ?? toEnt.id);
      const charSig = out[toEnt.id]!;
      charSig.eventCount = (charSig.eventCount ?? 0) + 1;
      (charSig.appearsInEvents ??= []).push({
        id: fromEnt.id,
        title: fromEnt.working_title ?? fromEnt.id,
        narrative_status: fromEnt.narrative_status,
      });
    }
  }

  // KNOWLEDGE: Character/Audience → Information. Surfaces dramatic-irony
  // layer on the Character card (v3 §3.2 KNOWS / DOESNT_KNOW state on edge).
  const infoById = new Map((data.information ?? []).map((i) => [i.id, i]));
  for (const k of data.edges.knowledge ?? []) {
    const knower = byId.get(k.knower_id);
    if (!knower || knower.type !== 'character') continue; // Audience handled elsewhere.
    const info = infoById.get(k.info_id);
    if (!info) continue;
    const charSig = out[knower.id]!;
    (charSig.knowsList ??= []).push({
      info_summary: info.summary,
      state: k.state,
      state_qualifier: k.state_qualifier,
    });
  }

  // OCCURS_IN: from is Event, to is Location.
  for (const oc of data.edges.occurs_in) {
    const fromEnt = byId.get(oc.from);
    const toEnt = byId.get(oc.to);
    if (!fromEnt || !toEnt) continue;
    const evtSig = out[fromEnt.id]!;
    (evtSig.occursInLocNames ??= []).push(toEnt.working_name ?? toEnt.id);
    const locSig = out[toEnt.id]!;
    (locSig.appearsInEventTitles ??= []).push(fromEnt.working_title ?? fromEnt.id);
  }

  // PRECEDES: from is Event, to is Event.
  for (const pr of data.edges.precedes) {
    const fromEnt = byId.get(pr.from);
    const toEnt = byId.get(pr.to);
    if (!fromEnt || !toEnt) continue;
    (out[fromEnt.id]!.precedesNextTitles ??= []).push(toEnt.working_title ?? toEnt.id);
    (out[toEnt.id]!.precededByTitles ??= []).push(fromEnt.working_title ?? fromEnt.id);
  }

  // STRUCTURAL: Character → Character with custom predicate.
  for (const s of data.edges.structural) {
    const fromEnt = byId.get(s.from);
    const toEnt = byId.get(s.to);
    if (!fromEnt || !toEnt) continue;
    const fSig = out[fromEnt.id]!;
    const tSig = out[toEnt.id]!;
    fSig.structuralCount = (fSig.structuralCount ?? 0) + 1;
    tSig.structuralCount = (tSig.structuralCount ?? 0) + 1;
    (fSig.structuralPreds ??= []).push(s.predicate);
    // The to-side reads its OWN side of the fact (dual-wording convention):
    // Mabel shows 'created_by Leah', not 'creator_of'. Legacy edges without
    // an inverse fall back to the forward wording.
    (tSig.structuralPreds ??= []).push(s.inverse_predicate || s.predicate);
    (fSig.structuralPeers ??= []).push(toEnt.working_name ?? toEnt.id);
    (tSig.structuralPeers ??= []).push(fromEnt.working_name ?? fromEnt.id);
  }

  // D'-3 / D'-5 — EVOKES: Event → Arc. Populate arc signals + a back-reference
  // on the originating Event so the Event card can hint at arcs it evokes.
  for (const ev of data.edges.evokes ?? []) {
    const eventEnt = byId.get(ev.event_id);
    const arcEnt = byId.get(ev.arc_id);
    if (!eventEnt || !arcEnt) continue;
    const arcSig = out[arcEnt.id]!;
    (arcSig.evokesEntries ??= []).push({
      event_id: ev.event_id,
      event_title: eventEnt.working_title ?? eventEnt.working_name ?? eventEnt.id,
      narrative_status: eventEnt.narrative_status ?? 'on_screen',
      transition: (ev.transition ?? '') as EvokesTransition | '',
      state_at_event: ev.state_at_event ?? '',
    });
    const eventSig = out[eventEnt.id]!;
    (eventSig.evokesArcNames ??= []).push(arcEnt.working_name ?? arcEnt.id);
    (eventSig.evokesArcEntries ??= []).push({
      arc_id: arcEnt.id,
      arc_name: arcEnt.working_name ?? arcEnt.id,
      arc_kind: arcEnt.kind as ArcKind | undefined,
      transition: (ev.transition ?? '') as EvokesTransition | '',
      state_at_event: ev.state_at_event ?? '',
      evidence_quote: ev.evidence_quote ?? '',
    });
  }

  // D'-3 / D'-5 — Arc-INVOLVES-Character.
  for (const ai of data.edges.arc_involves ?? []) {
    const arcEnt = byId.get(ai.arc_id);
    const charEnt = byId.get(ai.character_id);
    if (!arcEnt || !charEnt) continue;
    const arcSig = out[arcEnt.id]!;
    (arcSig.arcInvolvesCharNames ??= []).push(charEnt.working_name ?? charEnt.id);
  }

  // D'-5 — derived arc status. Sort EVOKES sequence by PRECEDES order with
  // narrative_status tiebreaker (matches backend computeArcDerivedStatus /
  // topoSortEvokesByPrecedes in lib/peer-slice.mjs).
  const precedesMap = new Map<string, Set<string>>();
  for (const p of data.edges.precedes ?? []) {
    if (!precedesMap.has(p.from)) precedesMap.set(p.from, new Set());
    precedesMap.get(p.from)!.add(p.to);
  }
  for (const ent of data.entities) {
    if (ent.type !== 'arc') continue;
    const sig = out[ent.id]!;
    if (!sig.evokesEntries || sig.evokesEntries.length === 0) {
      sig.arcStatusLabel = 'not yet raised';
      continue;
    }
    sig.evokesEntries = topoSortEvokesEntries(sig.evokesEntries, precedesMap);
    const lastResolved = [...sig.evokesEntries].reverse()
      .find((e) => e.transition === 'resolves');
    if (lastResolved) {
      sig.arcStatusLabel = `resolved at ${truncate(lastResolved.event_title, 36)}`;
    } else {
      const last = sig.evokesEntries[sig.evokesEntries.length - 1];
      sig.arcStatusLabel = `active as of ${truncate(last.event_title, 36)}`;
    }
  }

  return out;
}

/** D'-5 — Kahn-style topo-sort over a subset of EVOKES entries using a
 *  PRECEDES adjacency map. Tiebreaker: backstory events sort earlier than
 *  rendered/offstage (matches backend tiebreaker in peer-slice.mjs since
 *  backstory sits outside audience-time). */
export function topoSortEvokesEntries(
  entries: NonNullable<CardSignal['evokesEntries']>,
  precedesMap: Map<string, Set<string>>,
): NonNullable<CardSignal['evokesEntries']> {
  if (entries.length <= 1) return entries.slice();
  const idToIdx = new Map<string, number>();
  entries.forEach((e, i) => idToIdx.set(e.event_id, i));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of entries) {
    indeg.set(e.event_id, 0);
    adj.set(e.event_id, []);
  }
  for (const e of entries) {
    const succ = precedesMap.get(e.event_id);
    if (!succ) continue;
    for (const sId of succ) {
      if (!idToIdx.has(sId)) continue;
      adj.get(e.event_id)!.push(sId);
      indeg.set(sId, (indeg.get(sId) ?? 0) + 1);
    }
  }
  const nsRank = (ns: string) => (ns === 'backstory' ? 0 : 1);
  const compareReady = (a: string, b: string) => {
    const ea = entries[idToIdx.get(a)!];
    const eb = entries[idToIdx.get(b)!];
    const ra = nsRank(ea.narrative_status);
    const rb = nsRank(eb.narrative_status);
    if (ra !== rb) return ra - rb;
    return idToIdx.get(a)! - idToIdx.get(b)!;
  };
  const ready = entries
    .filter((e) => (indeg.get(e.event_id) ?? 0) === 0)
    .map((e) => e.event_id)
    .sort(compareReady);
  const out: typeof entries = [];
  const byEvId = new Map(entries.map((e) => [e.event_id, e]));
  while (ready.length > 0) {
    const id = ready.shift()!;
    const e = byEvId.get(id);
    if (e) out.push(e);
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
  if (out.length < entries.length) {
    const seen = new Set(out.map((e) => e.event_id));
    for (const e of entries) {
      if (!seen.has(e.event_id)) out.push(e);
    }
  }
  return out;
}

/**
 * Topological sort of an event subset by PRECEDES edges. Returns events in
 * story-time order; events not connected by PRECEDES preserve their input
 * order at the end (Kahn-style with stable extraction-order tiebreak).
 */
export function topoSortByPrecedes(
  events: NonNullable<CardSignal['appearsInEvents']>,
  precedesEdges: Array<{ from: string; to: string }>,
): NonNullable<CardSignal['appearsInEvents']> {
  if (events.length === 0) return events;
  const eventIds = new Set(events.map((e) => e.id));
  // Restrict edges to those connecting events in the subset.
  const inSubsetEdges = precedesEdges.filter(
    (e) => eventIds.has(e.from) && eventIds.has(e.to),
  );
  if (inSubsetEdges.length === 0) return events;
  // Build adjacency + indegree maps.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of events) {
    indeg.set(e.id, 0);
    adj.set(e.id, []);
  }
  for (const edge of inSubsetEdges) {
    adj.get(edge.from)!.push(edge.to);
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }
  // Kahn's algorithm with stable order: preserve input order among ties.
  const orderIdx = new Map<string, number>();
  events.forEach((e, i) => orderIdx.set(e.id, i));
  const ready: string[] = [];
  for (const e of events) {
    if ((indeg.get(e.id) ?? 0) === 0) ready.push(e.id);
  }
  // Stable: sort initial ready by input order.
  ready.sort((a, b) => (orderIdx.get(a)! - orderIdx.get(b)!));
  const out: NonNullable<CardSignal['appearsInEvents']> = [];
  const byId = new Map(events.map((e) => [e.id, e]));
  while (ready.length > 0) {
    const id = ready.shift()!;
    const e = byId.get(id);
    if (e) out.push(e);
    for (const next of adj.get(id) ?? []) {
      const remaining = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, remaining);
      if (remaining === 0) {
        // Insert into `ready` preserving input order (linear; tiny N).
        const targetIdx = orderIdx.get(next)!;
        let i = 0;
        while (i < ready.length && (orderIdx.get(ready[i])! < targetIdx)) i++;
        ready.splice(i, 0, next);
      }
    }
  }
  // Any leftovers (shouldn't happen on a DAG, but defensive) — append in
  // input order.
  if (out.length < events.length) {
    const seen = new Set(out.map((e) => e.id));
    for (const e of events) {
      if (!seen.has(e.id)) out.push(e);
    }
  }
  return out;
}
