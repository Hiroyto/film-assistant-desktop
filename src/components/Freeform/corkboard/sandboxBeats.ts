// components/Freeform/corkboard/sandboxBeats.ts
//
// BEATS ON THE LINE (Ben, 2026-11-05, the sandbox-beats branch). A broad beat
// from a dump (stored as a sequence) is a card on the board, on the same line
// as the scenes: the beat, then its scenes, then the next beat. Nothing new is
// stored: a beat is a sequence, its scenes are what it contains, its colour is
// the one the strip gave it.
//
//   - beatLinks: the line's extra links: beat -> its first scene, and the end
//     of the stretch before -> the next beat. Never closes a loop with the
//     scenes' own links (the writer's order wins).
//   - beatOf: which beat a scene sits in.
//   - beatSpots: where a beat with no spot yet goes: beside its first scene,
//     else after the stretch before it, in the nearest free gap.

import type { Pos } from './sandboxBoard';

export type Link = { from: string; to: string };
export interface BeatInput { id: string; color: string; scenes: string[] }

function reachesIn(edges: Link[]) {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  return {
    add: (e: Link) => out.set(e.from, [...(out.get(e.from) ?? []), e.to]),
    reaches: (a: string, b: string): boolean => {
      if (a === b) return true;
      const seen = new Set<string>([a]); const stack = [a];
      while (stack.length) { const v = stack.pop()!; for (const n of out.get(v) ?? []) { if (n === b) return true; if (!seen.has(n)) { seen.add(n); stack.push(n); } } }
      return false;
    },
  };
}

/** Scene ids in line order (their own links), ties by the order given. */
export function sceneLine(ids: string[], precedes: Link[]): string[] {
  const set = new Set(ids);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const next = new Map<string, string[]>(); const indeg = new Map(ids.map((id) => [id, 0]));
  const seen = new Set<string>();
  for (const p of precedes) {
    if (!set.has(p.from) || !set.has(p.to) || p.from === p.to || seen.has(`${p.from}>${p.to}`)) continue;
    seen.add(`${p.from}>${p.to}`);
    next.set(p.from, [...(next.get(p.from) ?? []), p.to]); indeg.set(p.to, (indeg.get(p.to) ?? 0) + 1);
  }
  const ready = ids.filter((id) => !indeg.get(id)); const out: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => idx.get(a)! - idx.get(b)!);
    const id = ready.shift()!; out.push(id);
    for (const n of next.get(id) ?? []) { indeg.set(n, indeg.get(n)! - 1); if (indeg.get(n) === 0) ready.push(n); }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** The line's links for beats, given the beats in story order. */
export function beatLinks(beats: BeatInput[], scenes: string[], precedes: Link[]): Link[] {
  const order = sceneLine(scenes, precedes);
  const rank = new Map(order.map((id, i) => [id, i]));
  const sceneSet = new Set(scenes);
  const g = reachesIn(precedes.filter((p) => p.from !== p.to));
  const out: Link[] = [];
  const add = (from: string, to: string) => {
    if (from === to || g.reaches(to, from)) return;
    const e = { from, to }; out.push(e); g.add(e);
  };
  // A beat into its own first scene first: that link is the beat's
  // membership, so it outranks the joins between stretches when they clash.
  const membersOf = beats.map((b) => b.scenes.filter((s) => sceneSet.has(s)).sort((x, y) => (rank.get(x) ?? 1e9) - (rank.get(y) ?? 1e9)));
  beats.forEach((b, i) => { if (membersOf[i].length) add(b.id, membersOf[i][0]); });
  let tail: string | null = null;
  beats.forEach((b, i) => {
    const members = membersOf[i];
    if (tail) add(tail, b.id);
    tail = members.length ? members[members.length - 1] : b.id;
  });
  return out;
}

/**
 * CHECKPOINTS (Ben, 2026-11-05: "a beat owns whatever comes after it on the
 * line, up to the next beat" - "yep i thought that was the plan"). The
 * stored scene lists only say where a beat goes: just before the first of
 * them on the line (an empty beat, just before the next beat that has
 * scenes, or at the end). From there the line decides: every scene belongs
 * to the nearest beat before it, so a beat's stretch is always one piece and
 * moving a scene past a beat moves it into that beat.
 *
 * Returns the whole line (scenes and beats in order), each scene's beat,
 * each beat's scenes, and the links that put the beats on the line (the
 * element before -> the beat -> the element after).
 */
export function beatLine(beats: BeatInput[], scenes: string[], precedes: Link[], anchors: Link[] = []): {
  line: string[]; beatOf: Map<string, string>; scenesOf: Map<string, string[]>; links: Link[];
} {
  // Scenes the links leave free (a dump's own chain with no link into the
  // line) go with the beat they were dumped into: ties are broken by the
  // stored beat's place, then the order given (2026-11-05: Sequence 2's new
  // scenes fell to the end, under the last beat).
  const storedAt = new Map<string, number>();
  beats.forEach((b, i) => { for (const sc of b.scenes) if (!storedAt.has(sc)) storedAt.set(sc, i); });
  const given = new Map(scenes.map((id, i) => [id, i]));
  const tie = [...scenes].sort((a, b) => (storedAt.get(a) ?? 1e6) - (storedAt.get(b) ?? 1e6) || given.get(a)! - given.get(b)!);
  const order = sceneLine(tie, precedes);
  const rank = new Map(order.map((id, i) => [id, i]));
  // Where each beat goes: the index of the scene it sits before. Its own
  // place first (MOVABLE BEATS, 2026-11-05): a link beat -> scene puts it
  // right before that scene; scene -> beat, right after it. Without one, just
  // before the first of its stored scenes.
  const at = new Map<string, number>();
  for (const b of beats) {
    const before = anchors.find((a) => a.from === b.id && rank.has(a.to));
    const after = before ? undefined : anchors.find((a) => a.to === b.id && rank.has(a.from));
    if (before) { at.set(b.id, rank.get(before.to)!); continue; }
    if (after) { at.set(b.id, rank.get(after.from)! + 1); continue; }
    const r = b.scenes.map((sc) => rank.get(sc)).filter((x): x is number => x !== undefined);
    if (r.length) at.set(b.id, Math.min(...r));
  }
  // An empty beat goes before the next beat (in story order) that has a
  // place, or at the end of the line.
  for (let i = beats.length - 1; i >= 0; i--) {
    const b = beats[i];
    if (at.has(b.id)) continue;
    const next = beats.slice(i + 1).find((x) => at.has(x.id));
    at.set(b.id, next ? at.get(next.id)! : order.length);
  }
  const beatOrder = new Map(beats.map((b, i) => [b.id, i]));
  const before = new Map<number, string[]>();
  for (const b of beats) { const k = at.get(b.id)!; before.set(k, [...(before.get(k) ?? []), b.id]); }
  before.forEach((list) => list.sort((x, y) => beatOrder.get(x)! - beatOrder.get(y)!));
  const line: string[] = [];
  for (let i = 0; i <= order.length; i++) {
    line.push(...(before.get(i) ?? []));
    if (i < order.length) line.push(order[i]);
  }
  const beatIds = new Set(beats.map((b) => b.id));
  const beatOf = new Map<string, string>();
  const scenesOf = new Map<string, string[]>(beats.map((b) => [b.id, []]));
  let cur: string | null = null;
  for (const id of line) {
    if (beatIds.has(id)) { cur = id; continue; }
    if (cur) { beatOf.set(id, cur); scenesOf.get(cur)!.push(id); }
  }
  const links: Link[] = [];
  line.forEach((id, i) => {
    if (!beatIds.has(id)) return;
    if (i > 0) links.push({ from: line[i - 1], to: id });
    if (i + 1 < line.length) links.push({ from: id, to: line[i + 1] });
  });
  return { line, beatOf, scenesOf, links };
}

/** Scene -> the beat it sits in. */
export function beatOf(beats: BeatInput[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of beats) for (const s of b.scenes) if (!m.has(s)) m.set(s, b.id);
  return m;
}

type Box = { x: number; y: number; w: number; h: number };

/** Spots for beats that have none: beside their first scene (to its left),
 *  else right after the stretch before them, else after the last card. */
export function beatSpots({ beats, placed, sizeOf, scenes, precedes, boardW = 1400 }: {
  beats: BeatInput[]; placed: Record<string, Box>; sizeOf: (id: string) => { w: number; h: number };
  scenes: string[]; precedes: Link[]; boardW?: number;
}): Record<string, Pos> {
  const out: Record<string, Pos> = {};
  const rects: Box[] = Object.values(placed);
  const order = sceneLine(scenes, precedes);
  const rank = new Map(order.map((id, i) => [id, i]));
  const clear = (p: Pos, z: { w: number; h: number }, pad = 16) => rects.every((r) => p.x + z.w + pad <= r.x || r.x + r.w + pad <= p.x || p.y + z.h + pad <= r.y || r.y + r.h + pad <= p.y);
  const near = (a: Box, z: { w: number; h: number }, side: 'left' | 'right'): Pos | null => {
    const want = side === 'left' ? { x: Math.max(0, a.x - z.w - 64), y: a.y } : { x: Math.min(boardW - z.w, a.x + a.w + 64), y: a.y };
    // The nearest free gap anywhere on the board (a crowded board has no
    // room right beside it, 2026-11-05: Nell's beats fell to the bottom).
    let best: Pos | null = null; let bestD = Infinity;
    const maxY = Math.max(want.y, ...rects.map((r) => r.y + r.h)) + z.h + 40;
    for (let x = 0; x + z.w <= boardW; x += 20) {
      for (let y = 0; y <= maxY; y += 20) {
        const d = Math.hypot(x - want.x, (y - want.y) * 1.3);
        if (d >= bestD) continue;
        const p = { x, y };
        if (clear(p, z)) { best = p; bestD = d; }
      }
    }
    return best;
  };
  let tail: Box | null = null;
  for (const b of beats) {
    const z = sizeOf(b.id);
    const members = b.scenes.filter((s) => placed[s]).sort((x, y) => (rank.get(x) ?? 1e9) - (rank.get(y) ?? 1e9));
    let p: Pos | null = placed[b.id] ? { x: placed[b.id].x, y: placed[b.id].y } : null;
    if (!p && members.length) p = near(placed[members[0]], z, 'left');
    if (!p && tail) p = near(tail, z, 'right');
    // The first beat with nothing before it goes ahead of the next stretch.
    if (!p) {
      const k = beats.indexOf(b);
      const nextFirst = beats.slice(k + 1).map((x) => x.scenes.filter((sc) => placed[sc]).sort((a, c) => (rank.get(a) ?? 1e9) - (rank.get(c) ?? 1e9))[0]).find(Boolean);
      const nextBeat = beats.slice(k + 1).find((x) => out[x.id] || placed[x.id]);
      const anchor = nextFirst ? placed[nextFirst] : nextBeat ? (placed[nextBeat.id] ?? { ...out[nextBeat.id], ...sizeOf(nextBeat.id) }) : null;
      if (anchor) p = near(anchor, z, 'left');
    }
    if (!p) { const bottom = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0; p = { x: 24, y: bottom + 40 }; }
    if (!placed[b.id]) { out[b.id] = p; rects.push({ ...p, ...z }); }
    const last = members.length ? placed[members[members.length - 1]] : { ...p, ...z };
    tail = last;
  }
  return out;
}

/**
 * Where a beat lands when it is put at `index` of the line without it: right
 * before the next scene from there, else right after the scene before (the
 * end of the line). Beats in between are stepped over.
 */
export function beatPlaceAt(lineWithout: string[], index: number, isScene: (id: string) => boolean): { before?: string; after?: string } {
  for (let i = Math.max(0, index); i < lineWithout.length; i++) if (isScene(lineWithout[i])) return { before: lineWithout[i] };
  for (let i = Math.min(index, lineWithout.length) - 1; i >= 0; i--) if (isScene(lineWithout[i])) return { after: lineWithout[i] };
  return {};
}
