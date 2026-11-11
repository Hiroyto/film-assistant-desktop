// components/Freeform/corkboard/sandboxConnect.ts
//
// CONNECT ON THE BOARD (Ben, 2026-11-05: "need a way to connect scenes that
// we manually create and order them"). The writer drags the handle on a
// scene onto another scene: that one comes next.
//
//   - It goes right after the scene dragged from. When that scene already
//     had a next one, it goes in between: A -> B becomes A -> new -> B.
//   - A scene already somewhere in the line moves: its old neighbours join
//     up so no gap is left (the Scenes view's rule for a dragged card).
//   - Never a loop; nothing to do when it is already next.
//
// Pure: the diff the page applies (untag `remove`, then tag `add`), the same
// shape the Scenes view hands onReorderScene, so undo works the same.

export type Link = { from: string; to: string };

const key = (p: Link) => `${p.from}|${p.to}`;

function reachesIn(edges: Link[]) {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  return (a: string, b: string): boolean => {
    const seen = new Set<string>([a]);
    const stack = [a];
    while (stack.length) {
      const v = stack.pop()!;
      for (const n of out.get(v) ?? []) {
        if (n === b) return true;
        if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    return false;
  };
}

/** The scene right before / after `id`: of its direct links, the closest one. */
function nearest(edges: Link[], id: string, side: 'prev' | 'next'): string | null {
  const reaches = reachesIn(edges);
  const ids = [...new Set(edges.filter((e) => (side === 'prev' ? e.to === id : e.from === id)).map((e) => (side === 'prev' ? e.from : e.to)))];
  if (!ids.length) return null;
  // Before it: the one no other leader comes after. After it: the one no
  // other follower comes before.
  const near = side === 'prev'
    ? ids.find((l) => !ids.some((o) => o !== l && reaches(l, o)))
    : ids.find((f) => !ids.some((o) => o !== f && reaches(o, f)));
  return near ?? ids[0];
}

/**
 * The links to change so `to` comes right after `from`. `scenes` limits the
 * links considered to scenes on the board. null: nothing to do, or it would
 * loop.
 */
export function connectDiff(precedes: Link[], from: string, to: string, scenes?: Set<string>): { remove: Link[]; add: Link[] } | null {
  if (!from || !to || from === to) return null;
  const seen = new Set<string>();
  const edges = precedes.filter((p) => p.from !== p.to && (!scenes || (scenes.has(p.from) && scenes.has(p.to)))).filter((p) => { const k = key(p); if (seen.has(k)) return false; seen.add(k); return true; });
  if (edges.some((e) => e.from === from && e.to === to) && nearest(edges, from, 'next') === to) return null;

  // Lift `to` out of the line; its old neighbours join up.
  const p = nearest(edges, to, 'prev'), n = nearest(edges, to, 'next');
  let next = edges.filter((e) => e.from !== to && e.to !== to);
  if (p && n && !reachesIn(next)(p, n)) next.push({ from: p, to: n });
  // In right after `from`, before what came after it.
  const b = nearest(next, from, 'next');
  if (b) next = next.filter((e) => !(e.from === from && e.to === b));
  next.push({ from, to });
  if (b) next.push({ from: to, to: b });

  // A loop means `to` could not sit there (it already leads into `from`
  // through scenes it does not touch directly): leave everything.
  const reaches = reachesIn(next);
  if (next.some((e) => reaches(e.to, e.from))) return null;

  const before = new Set(edges.map(key));
  const after = new Set(next.map(key));
  const remove = edges.filter((e) => !after.has(key(e)));
  const add = next.filter((e) => !before.has(key(e)));
  return remove.length || add.length ? { remove, add } : null;
}

/**
 * The links to change so `id` comes right before `before`, lifted out of
 * where it is (its old neighbours join up). For a scene dropped at the start
 * of the line, where there is no scene to put it after.
 */
export function placeBeforeDiff(precedes: Link[], id: string, before: string, scenes?: Set<string>): { remove: Link[]; add: Link[] } | null {
  if (!id || !before || id === before) return null;
  const seen = new Set<string>();
  const edges = precedes.filter((p) => p.from !== p.to && (!scenes || (scenes.has(p.from) && scenes.has(p.to)))).filter((p) => { const k = key(p); if (seen.has(k)) return false; seen.add(k); return true; });
  const p = nearest(edges, id, 'prev'), n = nearest(edges, id, 'next');
  const next = edges.filter((e) => e.from !== id && e.to !== id);
  if (p && n && !reachesIn(next)(p, n)) next.push({ from: p, to: n });
  next.push({ from: id, to: before });
  const reaches = reachesIn(next);
  if (next.some((e) => reaches(e.to, e.from))) return null;
  const was = new Set(edges.map(key)); const now = new Set(next.map(key));
  const remove = edges.filter((e) => !now.has(key(e)));
  const add = next.filter((e) => !was.has(key(e)));
  return remove.length || add.length ? { remove, add } : null;
}
