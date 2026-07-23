// =====================================================================
// spotlight.ts — the wow-flow's rule-based "what the engine found" detector.
//
// FIL-506. This is the demo-magic guardrail: it surfaces ONE non-obvious,
// TRUE thing the continuity engine inferred from the writer's prose, anchored
// to a real card on the canvas, with templated copy. It runs over the
// list-project-entities payload the board already loaded — NO LLM, so it can
// never fabricate. Rules are priority-ordered (most dramatic first); the first
// rule whose precondition is genuinely satisfied wins. If nothing fires, we
// return null and the wow skips the spotlight beat rather than inventing one.
//
// Reusable beyond onboarding (an ongoing "insights" surface later), but scoped
// to the wow for now.
// =====================================================================

import type { ProjectEntity, ProjectEdges, ProjectInformation } from '../../../lib/freeformApi';

export type SpotlightRuleId =
  | 'dramatic_irony'
  | 'throughline'
  | 'relationship'
  | 'arc'
  | 'richness';

export interface SpotlightFinding {
  ruleId: SpotlightRuleId;
  /** Entity ids the coachmark should anchor/spotlight (rendered cards). */
  cardIds: string[];
  /** Short bold line. */
  headline: string;
  /** One- or two-sentence templated body. All slots filled from the graph. */
  body: string;
}

export interface SpotlightInput {
  entities: ProjectEntity[];
  edges: ProjectEdges;
  information: ProjectInformation[];
}

// ---- helpers ---------------------------------------------------------

const isAudienceKnower = (knowerId: string) =>
  typeof knowerId === 'string' && knowerId.toLowerCase().startsWith('audience');

const normState = (s: string | undefined) => (s ?? '').toLowerCase().trim();
const isKnows = (s: string | undefined) => normState(s) === 'knows';
const isInDark = (s: string | undefined) => {
  const n = normState(s);
  return n === 'doesnt_know' || n === "doesn't_know" || n === 'does_not_know';
};
const isSuspects = (s: string | undefined) => normState(s) === 'suspects';

const displayName = (e?: ProjectEntity) =>
  (e?.working_name || e?.working_title || '').trim();

/** Strip a trailing period so we can quote a summary inside a sentence. */
const clean = (s: string) => (s || '').trim().replace(/\.+$/, '');

// ---- rules (priority order) -----------------------------------------

type Rule = (input: SpotlightInput, ctx: DetectCtx) => SpotlightFinding | null;

interface DetectCtx {
  byId: Map<string, ProjectEntity>;
  infoById: Map<string, ProjectInformation>;
  alive: ProjectEntity[];
  characters: ProjectEntity[];
  events: ProjectEntity[];
  locations: ProjectEntity[];
}

// 1) Dramatic irony — strongest. An Information someone KNOWS while a CHARACTER
//    is in the dark (or only suspects). Prefer the audience-knows / character-
//    doesn't case (the loaded "we know something they don't" gap).
const ruleDramaticIrony: Rule = ({ edges }, ctx) => {
  const knowledge = edges.knowledge ?? [];
  if (!knowledge.length) return null;

  // Group knower states per info.
  type Grp = { knows: string[]; inDark: string[]; suspects: string[] };
  const perInfo = new Map<string, Grp>();
  for (const k of knowledge) {
    if (!k?.info_id || !k?.knower_id) continue;
    const info = ctx.infoById.get(k.info_id);
    if (!info || info.irony_hidden) continue;
    const g = perInfo.get(k.info_id) ?? { knows: [], inDark: [], suspects: [] };
    if (isKnows(k.state)) g.knows.push(k.knower_id);
    else if (isInDark(k.state)) g.inDark.push(k.knower_id);
    else if (isSuspects(k.state)) g.suspects.push(k.knower_id);
    perInfo.set(k.info_id, g);
  }

  // Candidate = an info where someone knows AND a CHARACTER is in the dark.
  // Score: character-in-dark with an audience knower ranks highest.
  type Cand = { infoId: string; inDarkCharId: string; audienceKnows: boolean; partial: boolean };
  const cands: Cand[] = [];
  for (const [infoId, g] of perInfo) {
    if (!g.knows.length) continue;
    const audienceKnows = g.knows.some(isAudienceKnower);
    const inDarkPool = [...g.inDark, ...g.suspects];
    for (const knowerId of inDarkPool) {
      if (isAudienceKnower(knowerId)) continue; // want a CHARACTER in the dark
      const ent = ctx.byId.get(knowerId);
      if (!ent || ent.type !== 'character') continue;
      cands.push({
        infoId,
        inDarkCharId: knowerId,
        audienceKnows,
        partial: g.inDark.indexOf(knowerId) === -1, // only in suspects pool
      });
    }
  }
  if (!cands.length) return null;

  // Prefer: audience-knows > full-in-dark (not just suspects).
  cands.sort((a, b) => {
    if (a.audienceKnows !== b.audienceKnows) return a.audienceKnows ? -1 : 1;
    if (a.partial !== b.partial) return a.partial ? 1 : -1;
    return 0;
  });
  const best = cands[0];
  const info = ctx.infoById.get(best.infoId);
  const inDark = ctx.byId.get(best.inDarkCharId);
  if (!info || !inDark) return null;

  const infoText = clean(info.summary);
  const who = displayName(inDark) || 'a character';
  const verb = best.partial ? 'only suspects it' : "doesn't know";

  if (best.audienceKnows) {
    return {
      ruleId: 'dramatic_irony',
      cardIds: [best.inDarkCharId],
      headline: 'It caught the dramatic irony.',
      body: `You never spelled it out, but it's here: the audience knows "${infoText}," and ${who} ${verb}. That gap is the tension the scene runs on.`,
    };
  }
  return {
    ruleId: 'dramatic_irony',
    cardIds: [best.inDarkCharId],
    headline: 'It caught the dramatic irony.',
    body: `Someone in your story knows "${infoText}," and ${who} ${verb}. The engine tracked that asymmetry without you tagging it.`,
  };
};

// 2) Throughline — events auto-ordered into a chain via PRECEDES the writer
//    never numbered. Walk the longest forward chain.
const ruleThroughline: Rule = ({ edges }, ctx) => {
  const precedes = (edges.precedes ?? []).filter(
    (e) => e?.from && e?.to && ctx.byId.has(e.from) && ctx.byId.has(e.to),
  );
  if (precedes.length < 2) return null; // need >=3 beats to feel like a throughline

  const next = new Map<string, string>();
  const hasIncoming = new Set<string>();
  for (const e of precedes) {
    next.set(e.from, e.to);
    hasIncoming.add(e.to);
  }
  // Start from a node with no incoming precedes; walk forward.
  const starts = [...next.keys()].filter((id) => !hasIncoming.has(id));
  let longest: string[] = [];
  for (const s of starts) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = s;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = next.get(cur);
    }
    if (chain.length > longest.length) longest = chain;
  }
  if (longest.length < 3) return null;

  const titles = longest
    .map((id) => displayName(ctx.byId.get(id)))
    .filter(Boolean);
  const preview = titles.slice(0, 3).join(' → ');
  return {
    ruleId: 'throughline',
    cardIds: longest,
    headline: 'It built your throughline.',
    body: `From the prose alone, the engine ordered ${longest.length} beats into a throughline: ${preview}${longest.length > 3 ? ' …' : ''}.`,
  };
};

// 3) Relationship inference — an inferred structural tie between two characters.
const ruleRelationship: Rule = ({ edges }, ctx) => {
  const structural = (edges.structural ?? []).filter(
    (e) => e?.from && e?.to && e?.predicate && ctx.byId.has(e.from) && ctx.byId.has(e.to),
  );
  if (!structural.length) return null;
  const e = structural[0];
  const a = displayName(ctx.byId.get(e.from));
  const b = displayName(ctx.byId.get(e.to));
  if (!a || !b) return null;
  const pred = e.predicate.replace(/_/g, ' ').toLowerCase();
  return {
    ruleId: 'relationship',
    cardIds: [e.from, e.to],
    headline: 'It inferred a relationship.',
    body: `From how you wrote them, the engine inferred ${a} is ${pred} ${b} — a tie you never stated outright.`,
  };
};

// 4) Arc — a thread the engine surfaced (EVOKES through >=2 beats).
const ruleArc: Rule = ({ edges }, ctx) => {
  const evokes = (edges.evokes ?? []).filter((e) => e?.arc_id && e?.event_id);
  if (!evokes.length) return null;
  const perArc = new Map<string, Set<string>>();
  for (const e of evokes) {
    const set = perArc.get(e.arc_id) ?? new Set<string>();
    set.add(e.event_id);
    perArc.set(e.arc_id, set);
  }
  let bestArc = '';
  let bestCount = 0;
  for (const [arcId, evset] of perArc) {
    if (evset.size > bestCount) {
      bestArc = arcId;
      bestCount = evset.size;
    }
  }
  if (bestCount < 2) return null;
  const arc = ctx.byId.get(bestArc);
  const name = displayName(arc);
  if (!name) return null;
  return {
    ruleId: 'arc',
    cardIds: [bestArc],
    headline: 'It spotted a thread.',
    body: `The engine traced "${name}" running through ${bestCount} of your beats — a throughline you didn't have to mark.`,
  };
};

// 5) Richness — last resort. Always true if anything was extracted. Never the
//    wow on its own, but better than no spotlight when the graph is thin.
const ruleRichness: Rule = (_input, ctx) => {
  const c = ctx.characters.length;
  const e = ctx.events.length;
  const l = ctx.locations.length;
  if (c + e + l === 0) return null;
  const parts: string[] = [];
  if (c) parts.push(`${c} character${c === 1 ? '' : 's'}`);
  if (e) parts.push(`${e} beat${e === 1 ? '' : 's'}`);
  if (l) parts.push(`${l} location${l === 1 ? '' : 's'}`);
  // Anchor to the most-connected character if there is one, else first event.
  const anchor = ctx.characters[0]?.id ?? ctx.events[0]?.id;
  return {
    ruleId: 'richness',
    cardIds: anchor ? [anchor] : [],
    headline: 'It structured your idea.',
    body: `From one paragraph, the engine pulled ${parts.join(', ')} and wired them together.`,
  };
};

const RULES: Rule[] = [
  ruleDramaticIrony,
  ruleThroughline,
  ruleRelationship,
  ruleArc,
  ruleRichness,
];

/**
 * Run the priority-ordered rules over the loaded graph; return the first TRUE
 * finding, or null to skip the spotlight (never fabricate).
 */
export function detectSpotlight(input: SpotlightInput): SpotlightFinding | null {
  const entities = (input.entities ?? []).filter((e) => !e?.deleted_at);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const infoById = new Map((input.information ?? []).map((i) => [i.id, i]));
  const ctx: DetectCtx = {
    byId,
    infoById,
    alive: entities,
    characters: entities.filter((e) => e.type === 'character'),
    events: entities.filter((e) => e.type === 'event'),
    locations: entities.filter((e) => e.type === 'location'),
  };
  for (const rule of RULES) {
    try {
      const finding = rule(input, ctx);
      if (finding && finding.cardIds.length) return finding;
    } catch {
      /* a misbehaving rule must never break the wow — skip it */
    }
  }
  return null;
}
