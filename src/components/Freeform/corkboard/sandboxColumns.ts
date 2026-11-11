// components/Freeform/corkboard/sandboxColumns.ts
//
// THE STACKED OUTLINE (Ben, 2026-11-07: "here we can work the stacked outline
// arc studio style"). The Scenes view's third layout: one column per beat, its
// tab on top and its scenes stacked under it in story order, the columns left
// to right as the line reads. Scenes before the first beat get a column with
// no tab. Every beat column ends in a dashed "Add a scene" slot.
//
// Pure: the order in (scenes and beats, as the line reads), rectangles out.

import type { Rect } from './sandboxTimeline';

export const COL = {
  x0: 32,
  y0: 24,
  w: 260,
  headH: 70,
  sceneH: 118,
  gap: 12,
  colGap: 28,
  addH: 44,
};

export type Column = { beat: string | null; scenes: string[] };

/** The columns the line makes: a beat and the scenes after it, up to the next
 *  beat. Scenes before any beat make a column with no beat. */
export function columnsOf(order: string[], isBeat: (id: string) => boolean): Column[] {
  const out: Column[] = [];
  for (const id of order) {
    if (isBeat(id)) out.push({ beat: id, scenes: [] });
    else if (!out.length) out.push({ beat: null, scenes: [id] });
    else out[out.length - 1].scenes.push(id);
  }
  return out;
}

const colX = (i: number, x0: number) => x0 + i * (COL.w + COL.colGap);
const sceneY = (k: number) => COL.y0 + COL.headH + COL.gap + k * (COL.sceneH + COL.gap);

/** Rectangles for every scene and beat in the columns. */
export function columnsLayout(order: string[], isBeat: (id: string) => boolean, x0 = COL.x0): Map<string, Rect> {
  const out = new Map<string, Rect>();
  columnsOf(order, isBeat).forEach((c, i) => {
    const x = colX(i, x0);
    if (c.beat) out.set(c.beat, { x, y: COL.y0, w: COL.w, h: COL.headH });
    c.scenes.forEach((s, k) => out.set(s, { x, y: sceneY(k), w: COL.w, h: COL.sceneH }));
  });
  return out;
}

/** Each column's "Add a scene" slot: where it sits, and the item on the line a
 *  new scene goes after (the column's last scene, or its beat). An empty
 *  beat's slot is a whole scene tall; the others are short. */
export function columnSlots(order: string[], isBeat: (id: string) => boolean, x0 = COL.x0): { beat: string | null; after: string; rect: Rect; empty: boolean }[] {
  return columnsOf(order, isBeat).map((c, i) => {
    const empty = !c.scenes.length;
    const after = empty ? c.beat! : c.scenes[c.scenes.length - 1];
    return { beat: c.beat, after, empty, rect: { x: colX(i, x0), y: sceneY(c.scenes.length), w: COL.w, h: empty ? COL.sceneH : COL.addH } };
  });
}

/** Where a scene dropped with its top left at `pos` lands: its index in the
 *  order without it. The column nearest the hand, then below the scenes whose
 *  middle is above the card's middle. */
export function columnsSceneIndexAt(rest: string[], isBeat: (id: string) => boolean, pos: { x: number; y: number }, x0 = COL.x0): number {
  const cols = columnsOf(rest, isBeat);
  if (!cols.length) return 0;
  const cx = pos.x + COL.w / 2, cy = pos.y + COL.sceneH / 2;
  let best = 0;
  cols.forEach((_, i) => { if (Math.abs(colX(i, x0) + COL.w / 2 - cx) < Math.abs(colX(best, x0) + COL.w / 2 - cx)) best = i; });
  const c = cols[best];
  const k = c.scenes.filter((_, j) => sceneY(j) + COL.sceneH / 2 < cy).length;
  const start = c.beat ? rest.indexOf(c.beat) + 1 : rest.indexOf(c.scenes[0]);
  return start + k;
}

/** Where a column (a beat and its scenes) dropped with its left edge at `x`
 *  lands: its index in the order without it, before the first column whose
 *  middle is right of its middle. Never ahead of the scenes with no beat,
 *  which would then fall into it. */
export function columnsBlockIndexAt(rest: string[], isBeat: (id: string) => boolean, x: number, x0 = COL.x0): number {
  const cols = columnsOf(rest, isBeat);
  const mid = x + COL.w / 2;
  let at = rest.length;
  for (let i = 0; i < cols.length; i++) {
    if (mid < colX(i, x0) + COL.w / 2) { const c = cols[i]; at = c.beat ? rest.indexOf(c.beat) : rest.indexOf(c.scenes[0]); break; }
  }
  const lead = cols[0] && !cols[0].beat ? cols[0].scenes.length : 0;
  return Math.max(lead, at);
}

/** A beat's stretch: the scenes right after it on the line, up to the next beat. */
export function stretchOf(order: string[], isBeat: (id: string) => boolean, beat: string): string[] {
  const i = order.indexOf(beat);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < order.length && !isBeat(order[j]); j++) out.push(order[j]);
  return out;
}

/** The order with `block` (in its own order) taken out and put back at `index`
 *  of what is left. */
export function moveBlock(order: string[], block: string[], index: number): string[] {
  const set = new Set(block);
  const rest = order.filter((x) => !set.has(x));
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** How wide the columns are. */
export function columnsWidth(order: string[], isBeat: (id: string) => boolean, x0 = COL.x0): number {
  const n = columnsOf(order, isBeat).length;
  return n ? colX(n - 1, x0) + COL.w : x0;
}
