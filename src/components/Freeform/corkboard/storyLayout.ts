// components/Freeform/corkboard/storyLayout.ts
//
// WHERE A BRAINDUMP'S CARDS LAND (Ben, 2026-11-03: "more mimic the template
// layout and try to stream cards into that flow and format, prioritizing a
// readable scene flow and fitting the other cards where they fit in the
// gaps"). The template's weave (sandboxTemplates.tsx templateLayout), for
// any dump:
//
//   - story and world notes along the top of the new block;
//   - the scenes weave in story order, three across then back, each one a
//     little higher or lower than its neighbour, so the thread winds through;
//   - each character in a gap beside the first scene they are in (a scene
//     already on the board counts), never on the thread or another card;
//   - a sticky or group beside the card it is about, in the gaps left; the
//     rest at the right edge of the weave.
//
// Only the new items are placed. Everything already on the board keeps its
// spot and is in the way: on a board with cards, the new block starts under
// them. `order` is the reading order the cards stream in.

import { itemSize, rawTitle, type Pos, type StageItem } from './sandboxBoard';

type Rect = { x: number; y: number; w: number; h: number };

export interface StoryLayoutInput {
  /** Every item on the board after the dump. */
  items: StageItem[];
  /** The ids to place (the dump's new items). */
  fresh: Set<string>;
  /** Where everything else is now. */
  placed: Record<string, Pos>;
  /** Scene ids in story order. */
  sceneOrder: string[];
  /** Scene to character (INVOLVES). */
  involves: Array<{ from: string; to: string }>;
  /** The visible board: a dump fits inside it where it can (Ben, 2026-11-03:
   *  "when we create cards we should try to fit it into the initial view"). */
  boardW?: number;
  viewH?: number;
  viewTop?: number;
  /** Where the weave already starts (its top), when cards the board placed
   *  are being laid again with a later dump's: it stays where it was. */
  origin?: number;
}

const LEFT = 24, TOP = 24;
/** Where a weave starts on an empty board (the page's fallback origin). */
export const WEAVE_TOP = TOP;
const wob = (i: number, amp: number) => (((i * 37 + 11) % 9) - 4) * (amp / 4);
const isScene = (it: StageItem) => it.kind === 'card' && (it.entity.type === 'event' || it.entity.type === 'sequence');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** What a loose sticky or a group is about, as a title or a name. */
function aboutOf(it: StageItem): string[] {
  if (it.kind === 'sticky') return [it.fragment.near ?? '', it.fragment.about ?? ''].filter(Boolean);
  if (it.kind === 'group') return [...(it.badge?.touches ?? []), ...it.members.map((m) => m.about ?? '')].filter(Boolean);
  return [];
}

export function storyLayout({ items, fresh, placed, sceneOrder, involves, boardW = 1440, viewH, viewTop = 0, origin }: StoryLayoutInput): { pos: Record<string, Pos>; order: string[]; origin: number } {
  const out: Record<string, Pos> = {};
  const rects: Rect[] = [];
  for (const it of items) {
    if (fresh.has(it.id) || it.kind === 'token') continue;
    const p = placed[it.id];
    if (p) rects.push({ ...p, ...itemSize(it) });
  }
  const put = (it: StageItem, p: Pos) => { const z = itemSize(it); out[it.id] = { x: Math.round(Math.max(0, p.x)), y: Math.round(Math.max(0, p.y)) }; rects.push({ ...out[it.id], ...z }); };
  const clear = (p: Pos, z: { w: number; h: number }, pad = 18) => rects.every((r) => p.x + z.w + pad <= r.x || r.x + r.w + pad <= p.x || p.y + z.h + pad <= r.y || r.y + r.h + pad <= p.y);
  const posOf = (id: string) => out[id] ?? placed[id];

  const freshItems = items.filter((it) => fresh.has(it.id) && it.kind !== 'token');
  // The weave starts where it already was, or, new, under what is there.
  const blockTop = origin !== undefined ? origin : rects.length ? Math.max(...rects.map((r) => r.y + r.h)) + 80 : TOP;

  // Along the top: story notes and world material that names no card.
  const anchorTitles = new Map<string, string>();
  for (const it of items) if (it.kind === 'card') { const t = norm(rawTitle(it.entity)); if (t) anchorTitles.set(t, it.id); }
  const anchorFor = (it: StageItem): string | null => {
    for (const a of aboutOf(it)) {
      if (items.some((x) => x.id === a)) return a;
      const n = norm(a);
      if (!n) continue;
      if (anchorTitles.has(n)) return anchorTitles.get(n)!;
      for (const [t, id] of anchorTitles) if (t.includes(n) || n.includes(t)) return id;
    }
    return null;
  };
  const topRow = freshItems.filter((it) => it.kind === 'world' || (it.kind === 'sticky' && it.fragment.kind === 'story') || ((it.kind === 'sticky' || it.kind === 'group') && !anchorFor(it) && (it.kind === 'group' ? it.badge?.kind === 'world' : !!it.fragment.worldKind)));
  let wx = LEFT, wy = blockTop, rowH = 0;
  topRow.forEach((it, i) => {
    const z = itemSize(it);
    if (wx > LEFT && wx + z.w > boardW) { wx = LEFT + 40; wy += rowH + 24; rowH = 0; }
    put(it, { x: wx + wob(i, 12), y: wy + wob(i + 3, 10) });
    wx += z.w + 28 + Math.abs(wob(i + 5, 16));
    rowH = Math.max(rowH, z.h);
  });
  const minY = topRow.length ? wy + rowH + 24 : blockTop;
  // A weave laid again starts where it was; only a new block keeps clear of
  // what is above it (2026-11-04: the gap was added on every slide, so the
  // weave sank 120px a dump).
  const top = topRow.length ? wy + rowH + 64 : origin !== undefined ? blockTop : blockTop + (rects.length ? 120 : 40);

  // The scenes weave in story order.
  const rank = new Map(sceneOrder.map((id, i) => [id, i]));
  const scenes = freshItems.filter(isScene).sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
  const sz = scenes.length ? itemSize(scenes[0]) : { w: 300, h: 140 };
  // Across: three at most, tightened to fit the visible width, a margin on
  // the left for the people at the weave's turns.
  let perBand = Math.max(2, Math.min(3, Math.floor((boardW - LEFT - sz.w) / (sz.w + 64)) + 1));
  const margin = (n: number) => Math.min(170, Math.max(24, boardW - LEFT - sz.w - (n - 1) * (sz.w + 24) - 24));
  let stepX = Math.min(sz.w + 64, (boardW - LEFT - margin(perBand) - sz.w) / Math.max(1, perBand - 1));
  if (stepX < sz.w + 24 && perBand > 2) { perBand = 2; stepX = Math.min(sz.w + 64, (boardW - LEFT - margin(2) - sz.w)); }
  const WEAVE_X = LEFT + margin(perBand);
  // Down: the bands close up to fit the visible height when they can, but
  // never so tight that a person cannot sit between them.
  const bands = Math.ceil(scenes.length / perBand);
  const roomDown = viewH ? viewH - (top - viewTop) - sz.h - 24 : 0;
  const bandH = bands > 1 && roomDown > 0 ? Math.max(sz.h + 120, Math.min(sz.h + 240, roomDown / (bands - 1))) : sz.h + 240;
  const riseBy = Math.max(30, Math.min(90, bandH - sz.h - 150));
  const slotAt = (n: number): Pos => {
    const band = Math.floor(n / perBand), j = n % perBand;
    const col = band % 2 === 0 ? j : perBand - 1 - j;
    const rise = j % 2 === 0 ? 0 : riseBy;
    return { x: WEAVE_X + col * stepX + wob(n, 22), y: top + band * bandH + rise + wob(n + 2, 18) };
  };
  // A card the writer placed by hand may sit in a slot: the scene takes the
  // next free slot along the weave, so the story still reads in order around
  // it (Ben, 2026-11-04: "skip blocked slots"; stepping down past it sent the
  // opening scenes under the writer's cards).
  // BESIDE ITS NEIGHBOUR (Ben, 2026-11-04: a new scene "lands on the board
  // beside its neighbours in that line"). When the scene right before it in
  // the line (or, failing that, right after) stays where it is, the writer's
  // card or one this dump already set beside one, the new scene goes next to
  // it: after it to the right, else below, left, above. Only then the weave.
  const fixedScene = new Set(items.filter((it) => isScene(it) && !fresh.has(it.id) && placed[it.id]).map((it) => it.id));
  const sceneIds = new Set(items.filter(isScene).map((it) => it.id));
  const lineOrder = sceneOrder.filter((id) => sceneIds.has(id));
  // The nearest free spot to the side it reads from (after its leader: to
  // the right; before its follower: to the left), within about two cards of
  // the neighbour. A crowded board has no room right beside it; the nearest
  // gap still reads as next to it.
  const besideSpot = (a: Pos, after: boolean): Pos | null => {
    const side = after ? a.x + sz.w + 64 : a.x - sz.w - 64;
    const want = { x: Math.max(0, Math.min(boardW - sz.w, side)), y: a.y + 20 };
    const ok = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x + sz.w <= boardW && clear(p, sz, 12);
    let best: Pos | null = null, bestD = Infinity;
    for (let dx = -2 * (sz.w + 64); dx <= 2 * (sz.w + 64); dx += 20) {
      for (let dy = -2 * (sz.h + 70); dy <= 2 * (sz.h + 70); dy += 20) {
        const p = { x: a.x + dx, y: a.y + dy };
        const d = Math.hypot(p.x - want.x, (p.y - want.y) * 1.3);
        if (d < bestD && ok(p)) { best = p; bestD = d; }
      }
    }
    return best;
  };
  const besideNeighbour = (id: string): Pos | null => {
    const k = lineOrder.indexOf(id);
    if (k < 0) return null;
    for (const [nb, after] of [[lineOrder[k - 1], true], [lineOrder[k + 1], false]] as Array<[string | undefined, boolean]>) {
      if (!nb || !fixedScene.has(nb)) continue;
      const a = posOf(nb);
      if (!a) continue;
      const p = besideSpot(a, after);
      if (p) return p;
    }
    return null;
  };
  let slot = 0;
  scenes.forEach((it) => {
    const near = besideNeighbour(it.id);
    if (near) { put(it, near); fixedScene.add(it.id); return; }
    let p = slotAt(slot);
    for (let k = 0; k < 40 && !clear(p, sz, 12); k++) p = slotAt(++slot);
    for (let k = 0; k < 30 && !clear(p, sz, 12); k++) p = { ...p, y: p.y + 40 };
    put(it, p);
    slot += 1;
  });
  // The thread between scenes is not a place to sit.
  for (let k = 0; k < scenes.length - 1; k++) {
    const a = out[scenes[k].id], b = out[scenes[k + 1].id];
    const ax = a.x + sz.w / 2, ay = a.y + sz.h / 2, bx = b.x + sz.w / 2, by = b.y + sz.h / 2;
    if (Math.abs(bx - ax) < Math.abs(by - ay)) rects.push({ x: (ax + bx) / 2 - 8, y: Math.min(ay, by), w: 16, h: Math.abs(by - ay) });
    else rects.push({ x: Math.min(ax, bx), y: (ay + by) / 2 - 8, w: Math.abs(bx - ax), h: 16 });
  }

  // Beside an anchor card, in a gap; failing that, outward around it;
  // failing that, the right edge of the weave.
  let edgeY = top;
  const edgeX = Math.max(LEFT, Math.min(WEAVE_X + (perBand - 1) * stepX + sz.w + 28, boardW - 240));
  const placeNear = (it: StageItem, anchorIds: string[], i: number) => {
    const z = itemSize(it);
    // Beside a card already on the board, any gap up there will do; beside a
    // new one, keep under the top row.
    const floor = anchorIds.some((id) => !fresh.has(id) || fixedScene.has(id)) ? TOP : minY;
    const ok = (p: Pos) => p.x >= 0 && p.x + z.w <= boardW && p.y >= floor && clear(p, z);
    const spotsBy = (anchor: Pos, az: { w: number; h: number }): Pos[] => {
      const xs = [anchor.x - 30, anchor.x + 30, anchor.x + az.w - z.w, anchor.x + az.w - z.w + 60].map((x, k) => x + wob(i + k, 10));
      xs.push(anchor.x + az.w / 2 - 30 - z.w, anchor.x + az.w / 2 + 30);
      const below = anchor.y + az.h + 34, above = anchor.y - z.h - 18;
      return [
        ...xs.map((x) => ({ x, y: below })),
        ...xs.map((x) => ({ x, y: above })),
        { x: anchor.x + az.w + 28, y: anchor.y + 40 + wob(i, 16) },
        { x: anchor.x - z.w - 28, y: anchor.y + 40 + wob(i, 16) },
        { x: anchor.x + az.w + 28, y: below },
        { x: anchor.x - z.w - 28, y: below },
      ];
    };
    const anchors = anchorIds.map((id) => ({ p: posOf(id), it: items.find((x) => x.id === id) })).filter((a): a is { p: Pos; it: StageItem } => !!a.p && !!a.it);
    for (const a of anchors) for (const p of spotsBy(a.p, itemSize(a.it))) if (ok(p)) { put(it, p); return; }
    // A crowded board: the nearest gap around the first anchor, before the
    // wider ring (2026-11-04: the ring's coarse steps skipped the gap right
    // under the scene and sent the character two bands down).
    if (anchors[0]) {
      const a = anchors[0], az = itemSize(a.it);
      const cx = a.p.x + az.w / 2 - z.w / 2, cy = a.p.y + az.h / 2 - z.h / 2;
      let best: Pos | null = null, bestD = Infinity;
      for (let dx = -(az.w + z.w + 60); dx <= az.w + z.w + 60; dx += 20) {
        for (let dy = -(az.h + z.h + 80); dy <= az.h + z.h + 80; dy += 20) {
          const p = { x: cx + dx, y: cy + dy };
          const d = Math.hypot(dx, dy * 1.3);
          if (d < bestD && ok(p)) { best = p; bestD = d; }
        }
      }
      if (best) { put(it, best); return; }
    }
    const first = anchors[0];
    if (first) {
      const az = itemSize(first.it);
      const cx = first.p.x + az.w / 2 - z.w / 2, cy = first.p.y + az.h / 2 - z.h / 2;
      for (let r = 1; r <= 6; r++) {
        for (let a = 0; a < 12; a++) {
          const th = (a / 12) * Math.PI * 2 + r * 0.4;
          const p = { x: cx + Math.cos(th) * r * (z.w * 0.8), y: cy + Math.sin(th) * r * (z.h + 30) };
          if (ok(p)) { put(it, p); return; }
        }
      }
    }
    while (!clear({ x: edgeX, y: edgeY }, z)) edgeY += 24;
    put(it, { x: edgeX, y: edgeY });
    edgeY += z.h + 24;
  };

  // Characters beside the first scene they are in (new or already there).
  const sceneRank = (id: string) => rank.get(id) ?? 1e6;
  const scenesOf = (charId: string) => involves.filter((e) => e.to === charId && items.some((x) => x.id === e.from && isScene(x))).map((e) => e.from).sort((a, b) => sceneRank(a) - sceneRank(b));
  const chars = freshItems.filter((it) => it.kind === 'card' && !isScene(it)).sort((a, b) => sceneRank(scenesOf(a.id)[0] ?? '') - sceneRank(scenesOf(b.id)[0] ?? ''));
  chars.forEach((it, i) => placeNear(it, scenesOf(it.id), i));

  // Stickies and groups beside what they are about; the rest at the edge.
  const placedTop = new Set(topRow.map((it) => it.id));
  const notes = freshItems.filter((it) => (it.kind === 'sticky' || it.kind === 'group') && !placedTop.has(it.id));
  notes.sort((a, b) => sceneRank(anchorFor(a) ?? '') - sceneRank(anchorFor(b) ?? ''))
    .forEach((it, i) => { const a = anchorFor(it); placeNear(it, a ? [a] : [], i + chars.length); });

  // Reading order to stream in: the top notes, the scenes along the thread,
  // the people, then the notes in their gaps.
  const order = [...topRow, ...scenes, ...chars, ...notes].map((it) => it.id).filter((id) => out[id]);
  return { pos: out, order, origin: blockTop };
}

/** Scene ids in story order from the reader's "comes after" links: every
 *  link is kept, across dumps too (a later dump's "first" leads into the
 *  scenes already there), ties go to the order the scenes were made. The
 *  primary unit is the scene (Ben, 2026-11-04): no sequence decides it. */
export function chainOrder(items: StageItem[], precedes: Array<{ from: string; to: string }>): string[] {
  const ids = items.filter((i) => i.kind === 'card' && (i.entity.type === 'event' || i.entity.type === 'sequence')).map((i) => i.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const next = new Map<string, string[]>();
  const indeg = new Map(ids.map((id) => [id, 0]));
  const seenEdge = new Set<string>();
  for (const p of precedes) {
    if (!idx.has(p.from) || !idx.has(p.to) || p.from === p.to || seenEdge.has(`${p.from}>${p.to}`)) continue;
    seenEdge.add(`${p.from}>${p.to}`);
    next.set(p.from, [...(next.get(p.from) ?? []), p.to]);
    indeg.set(p.to, (indeg.get(p.to) ?? 0) + 1);
  }
  const ready = ids.filter((id) => !indeg.get(id));
  const out: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => idx.get(a)! - idx.get(b)!);
    const id = ready.shift()!;
    out.push(id);
    for (const n of next.get(id) ?? []) { indeg.set(n, indeg.get(n)! - 1); if (indeg.get(n) === 0) ready.push(n); }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}
