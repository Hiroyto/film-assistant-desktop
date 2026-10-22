// components/Freeform/corkboard/characterTiers.ts
//
// The Characters view, tiered (Ben 2026-10-17). One ring of every character
// held a 25-person cast; an imported feature brings 60+ (Schindler's List: 67,
// 21 of them in a single scene), and the ring grew to ~4000px so the ten who
// carry the story shrank to unreadable. The cast is sorted by what the board
// already knows, and only the principals and supporting players get the web:
//
//   principal   a tie (a relationship card or a structural edge) or in at
//               least 4% of the scenes (min 6); at most 12, strongest first
//   supporting  not principal; a tie or in at least 1.5% of the scenes
//               (min 3); at most 24
//   minor       everyone else: folded into one "Minor cast" drawer that deals
//               out as a grid under the web. Nothing is hidden from the rest
//               of the board and nothing is deleted.
//
// The floors scale with the script, so a 60-scene film and a 240-scene epic
// both land sensibly. Pure: no React, no layout state, so it is tested alone.

export interface TierInput {
  /** Character ids. */
  ids: string[];
  /** Scenes on the board (events), for the percentage floors. */
  sceneCount: number;
  /** Scenes each character is in (INVOLVES edges). */
  presence: Map<string, number>;
  /** Tie weight per character: relationship cards and structural edges. */
  ties: Map<string, number>;
}

export interface Tiers {
  principals: string[];
  supporting: string[];
  minor: string[];
}

export const MAX_PRINCIPALS = 12;
export const MAX_SUPPORTING = 24;

export function tierFloors(sceneCount: number) {
  return {
    principal: Math.max(6, Math.round(sceneCount * 0.04)),
    supporting: Math.max(3, Math.round(sceneCount * 0.015)),
  };
}

export function characterTiers({ ids, sceneCount, presence, ties }: TierInput): Tiers {
  const floors = tierFloors(sceneCount);
  const pres = (id: string) => presence.get(id) ?? 0;
  const tie = (id: string) => ties.get(id) ?? 0;
  // Strongest first: ties weigh with presence (the view's centrality), then a
  // stable id order so the layout never shuffles between renders.
  const ranked = [...ids].sort((a, b) => (tie(b) + pres(b)) - (tie(a) + pres(a)) || a.localeCompare(b));
  const principals = ranked.filter((id) => tie(id) > 0 || pres(id) >= floors.principal).slice(0, MAX_PRINCIPALS);
  const p = new Set(principals);
  const supporting = ranked
    .filter((id) => !p.has(id) && (tie(id) > 0 || pres(id) >= floors.supporting))
    .slice(0, MAX_SUPPORTING);
  const s = new Set(supporting);
  // A cast with no ties and no scenes yet (a fresh braindump) still gets a
  // web: the first few by rank stand in as principals rather than leaving the
  // whole cast in the drawer.
  if (principals.length === 0 && ranked.length > 0) {
    const stand = ranked.slice(0, Math.min(MAX_PRINCIPALS, ranked.length));
    return { principals: stand, supporting: [], minor: ranked.slice(stand.length) };
  }
  return { principals, supporting, minor: ranked.filter((id) => !p.has(id) && !s.has(id)) };
}

// ---- The web: two ovals, wider than tall so the cast fits a laptop screen ----

export const RING_ASPECT = 1.45;

export interface WebGeometry {
  inner: { rx: number; ry: number };
  outer: { rx: number; ry: number } | null;
  /** Bounding box of the web, pills included. */
  width: number;
  height: number;
}

/** Ring sizes for `inner` pills around the center and `outer` pills outside
 *  them. A ring is sized so neighbours at its top and bottom (where pills sit
 *  side by side) clear each other: rx >= n * (pillW + gap) / 2pi. */
export function webGeometry(inner: number, outer: number, pillW: number, pillH: number, gap = 24): WebGeometry {
  const span = (n: number) => (n * (pillW + gap)) / (2 * Math.PI);
  const innerRx = Math.max(pillW + 92, span(inner));
  const innerRing = { rx: innerRx, ry: Math.max(pillH + 106, innerRx / RING_ASPECT) };
  let outerRing: { rx: number; ry: number } | null = null;
  if (outer > 0) {
    const rx = Math.max(innerRing.rx + pillW + 40, span(outer));
    outerRing = { rx, ry: Math.max(innerRing.ry + pillH + 70, rx / RING_ASPECT) };
  }
  const box = outerRing ?? innerRing;
  return { inner: innerRing, outer: outerRing, width: box.rx * 2 + pillW, height: box.ry * 2 + pillH };
}

/** Points on an oval, evenly spaced by angle from the top, `phase` steps in
 *  (half a step on the outer ring staggers it against the inner one). */
export function ovalPoints(n: number, rx: number, ry: number, cx: number, cy: number, phase = 0) {
  return Array.from({ length: n }, (_, i) => {
    const th = (2 * Math.PI * (i + phase)) / Math.max(n, 1) - Math.PI / 2;
    return { x: cx + rx * Math.cos(th), y: cy + ry * Math.sin(th) };
  });
}

/** The largest board zoom at which the web fits the visible board. */
export function fitZoom(webW: number, webH: number, availW: number, availH: number, presets = [1, 0.75, 0.5, 0.25]) {
  return presets.find((z) => webW * z <= availW && webH * z <= availH) ?? presets[presets.length - 1];
}
