// components/Freeform/corkboard/sandboxTimeline.ts
//
// THE TIMELINE (Ben, 2026-11-05: "let's build out the final draft timeline
// view"). The Scenes view's second layout: the line read left to right.
// Scenes sit on one track in story order; a beat is a band above the scenes
// that follow it on the line (its stretch), like a structure bar; a beat with
// no scenes yet takes a short slot of its own on the track.
//
// Pure: the order in (scenes and beats, as the line reads), rectangles out.

export type Rect = { x: number; y: number; w: number; h: number };

export const TL = {
  x0: 32,
  bandY: 24,
  bandH: 58,
  trackY: 24 + 58 + 18,
  sceneW: 240,
  sceneH: 132,
  emptyW: 150,
  gap: 20,
};

/** Rectangles for every scene and beat on the timeline. `isBeat` tells them apart. */
export function timelineLayout(order: string[], isBeat: (id: string) => boolean, x0 = TL.x0): Map<string, Rect> {
  const out = new Map<string, Rect>();
  let x = x0;
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (!isBeat(id)) {
      out.set(id, { x, y: TL.trackY, w: TL.sceneW, h: TL.sceneH });
      x += TL.sceneW + TL.gap;
      continue;
    }
    // A beat spans the scenes after it, up to the next beat.
    let j = i + 1;
    while (j < order.length && !isBeat(order[j])) j++;
    const n = j - i - 1;
    if (n === 0) {
      // No scenes yet: a short slot of its own, the band down to the track.
      out.set(id, { x, y: TL.bandY, w: TL.emptyW, h: TL.bandH });
      x += TL.emptyW + TL.gap;
    } else {
      out.set(id, { x, y: TL.bandY, w: n * TL.sceneW + (n - 1) * TL.gap, h: TL.bandH });
    }
  }
  return out;
}

/** Where an item dropped with its left edge at `x` lands: its index in the
 *  order without it (before the first card whose middle is right of it). */
export function timelineIndexAt(rest: string[], isBeat: (id: string) => boolean, x: number, w: number, x0 = TL.x0): number {
  const lay = timelineLayout(rest, isBeat, x0);
  const mid = x + w / 2;
  for (let i = 0; i < rest.length; i++) {
    const r = lay.get(rest[i])!;
    // A beat band starts where its first scene starts: compare by its left edge.
    const c = isBeat(rest[i]) ? r.x + Math.min(r.w, TL.sceneW) / 2 : r.x + r.w / 2;
    if (mid < c) return i;
  }
  return rest.length;
}

/** How wide the whole track is. */
export function timelineWidth(order: string[], isBeat: (id: string) => boolean, x0 = TL.x0): number {
  let right = x0;
  timelineLayout(order, isBeat, x0).forEach((r) => { right = Math.max(right, r.x + r.w); });
  return right;
}
