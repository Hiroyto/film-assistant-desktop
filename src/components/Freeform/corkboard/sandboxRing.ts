// Where the people sit around an opened card, where the characters sit in
// the Characters web, and where a tie's label goes on its line. Pure, so the
// layouts can be checked at any window size and any number of ties.

export type Pos = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** A tie label's height (TieLabel: 11px type, 5px padding, a border). */
export const LABEL_H = 24;
/** Air a label keeps from the cards it sits between. */
const AIR = 10;

let measure: CanvasRenderingContext2D | null | undefined;
/** A tie label's drawn width: its words measured in the pill's own font,
 *  plus the pill's padding and border (2026-10-15 the estimate of 6.4px a
 *  letter was out by up to 18px either way). */
export function tieLabelW(text: string): number {
  if (measure === undefined) {
    measure = null;
    try {
      // jsdom has no canvas and says so on the console; keep the estimate there.
      if (typeof document !== 'undefined' && !/jsdom/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
        measure = document.createElement('canvas').getContext('2d');
        if (measure) measure.font = '600 11px system-ui, sans-serif';
      }
    } catch { measure = null; }
  }
  const w = measure ? measure.measureText(text).width + 20 : 16 + text.length * 6.4;
  return Math.min(220, Math.ceil(w));
}

const inside = (r: Rect, q: Pos) => q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h;
const meets = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const pill = (q: Pos, lw: number): Rect => ({ x: q.x - lw / 2, y: q.y - LABEL_H / 2, w: lw, h: LABEL_H });
const centre = (r: Rect): Pos => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The line from an opened card to one of its people: it leaves level and
 *  arrives level, an S between the two centres. */
export function tieCurve(from: Pos, to: Pos): string {
  const mx = (from.x + to.x) / 2;
  return `M${from.x},${from.y} C${mx},${from.y} ${mx},${to.y} ${to.x},${to.y}`;
}
export function tieCurvePoints(from: Pos, to: Pos, n = 48): Pos[] {
  const mx = (from.x + to.x) / 2;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, u = 1 - t;
    return { x: u * u * u * from.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * to.x, y: u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y };
  });
}
export function straightPoints(from: Pos, to: Pos, n = 48): Pos[] {
  return Array.from({ length: n + 1 }, (_, k) => ({ x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }));
}

/** Where a label sits on its line: in the stretch you can see (inside
 *  neither end card), as near that stretch's middle as its whole pill is
 *  clear of both ends and of everything in `avoid`. `fits` is false when no
 *  such spot exists; the label then takes the spot it covers least. */
export function labelSpot(pts: Pos[], ends: Rect[], avoid: Rect[], lw: number, pad = 4): { at: Pos; fits: boolean } {
  const seen = pts.map((q, k) => ({ q, k })).filter(({ q }) => !ends.some((r) => inside(r, q)));
  if (!seen.length) return { at: pts[Math.floor(pts.length / 2)], fits: false };
  const midK = (seen[0].k + seen[seen.length - 1].k) / 2;
  const near = [...seen].sort((a, b) => Math.abs(a.k - midK) - Math.abs(b.k - midK));
  const blocks = [...ends, ...avoid];
  const clear = near.find(({ q }) => !blocks.some((r) => meets(pill(q, lw), r, pad)));
  if (clear) return { at: clear.q, fits: true };
  const covers = (q: Pos) => blocks.filter((r) => meets(pill(q, lw), r)).length;
  const least = near.reduce((best, x) => (covers(x.q) < covers(best.q) ? x : best), near[0]);
  return { at: least.q, fits: false };
}

/** A tie's label between an opened card and one of its people: with air
 *  either side when there is room, tight against them when there is not. */
export function ringLabel(card: Rect, sat: Rect, avoid: Rect[], lw: number): { at: Pos; fits: boolean; roomy: boolean } {
  const pts = tieCurvePoints(centre(card), centre(sat));
  const roomy = labelSpot(pts, [card, sat], avoid, lw, AIR);
  if (roomy.fits) return { ...roomy, roomy: true };
  return { ...labelSpot(pts, [card, sat], avoid, lw, 4), roomy: false };
}

// Right, left, the upper diagonals, the lower diagonals, straight up, straight
// down; past eight a second ring further out.
const SLOTS = [0, Math.PI, -Math.PI / 3, -2 * Math.PI / 3, Math.PI / 3, 2 * Math.PI / 3, -Math.PI / 2, Math.PI / 2];

export type RingItem = { w: number; h: number; /** its tie label's width, when it has one */ lw?: number };

/** The people around an opened card (a scene's cast, a character's ties).
 *  Each sits on an ellipse just clear of the card, pushed out together until
 *  every label fits in its gap. With a `view`, any that would leave it (a
 *  character with many ties, a laptop window) or land on a card or label
 *  already placed move to the nearest spot that is in view and clear, its
 *  label included (2026-10-15: five ties or a narrow window pushed cards off
 *  the right and the bottom). What cannot fit anywhere keeps its ellipse spot
 *  and the board scrolls to it. */
export function ringSlots(o: { card: Rect; pills?: Rect; view?: Rect; items: RingItem[]; chipH: number }): Pos[] {
  const { card, items } = o;
  const c = centre(card);
  const fixed = o.pills ? [o.pills] : [];
  const rect = (p: Pos, it: RingItem): Rect => ({ x: p.x - it.w / 2, y: p.y - it.h / 2, w: it.w, h: it.h });
  const radii = items.map((it, i) => {
    const th = SLOTS[i % SLOTS.length];
    const lap = Math.floor(i / SLOTS.length);
    // The slots above the card clear the chip row that floats there.
    return {
      th,
      rx: card.w / 2 + it.w / 2 + 44 + lap * (it.w + 24),
      ry: card.h / 2 + it.h / 2 + 36 + (Math.sin(th) < -0.1 ? o.chipH + 26 : 0) + lap * (it.h + 24),
    };
  });
  const at = (i: number, k: number): Pos => ({ x: c.x + k * radii[i].rx * Math.cos(radii[i].th), y: c.y + k * radii[i].ry * Math.sin(radii[i].th) });
  // One push for the whole ring, so it stays an ellipse: far enough out that
  // the longest-reaching label fits with air.
  let K = 1;
  items.forEach((it, i) => {
    if (!it.lw) return;
    let k = 1;
    while (k < 3 && !ringLabel(card, rect(at(i, k), it), fixed, it.lw).roomy) k += 0.03;
    K = Math.max(K, k);
  });
  const ideal = items.map((it, i) => rect(at(i, K), it));
  if (!o.view) return ideal.map((r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y) }));
  const view = o.view;
  const inView = (r: Rect) => r.x >= view.x && r.y >= view.y && r.x + r.w <= view.x + view.w && r.y + r.h <= view.y + view.h;
  const placed: Rect[] = [];
  const labels: Rect[] = [];
  const out: Pos[] = [];
  type Pass = { view: boolean; roomy: boolean };
  // A spot is good when it is clear of the card, the chips, the people and
  // labels already placed, and its own label fits on its line; in view and
  // with air when the pass asks for them.
  const good = (r: Rect, it: RingItem, p: Pass): Rect | null | false => {
    // The stage starts at 0,0; past the view's right and bottom it scrolls.
    if (r.x < 0 || r.y < 0 || (p.view && !inView(r)) || meets(r, card, 16) || fixed.some((f) => meets(r, f, 12)) || placed.some((q) => meets(r, q, 16)) || labels.some((l) => meets(r, l, 6))) return false;
    if (!it.lw) return null;
    const s = ringLabel(card, r, [...fixed, ...placed, ...labels], it.lw);
    return s.fits && (s.roomy || !p.roomy) ? pill(s.at, it.lw) : false;
  };
  // Nearest first: the ellipse's own direction, then turning away from it a
  // step at a time, each tried from just clear of the card outward.
  const search = (i: number, it: RingItem, p: Pass): { r: Rect; lab: Rect | null } | null => {
    const d = { x: ideal[i].x + it.w / 2 - c.x, y: ideal[i].y + it.h / 2 - c.y };
    const phi = Math.atan2(d.y, d.x);
    const reach = Math.hypot(view.w, view.h) * (p.view ? 1 : 2);
    for (const deg of [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90]) {
      const a = phi + (deg * Math.PI) / 180;
      for (let r = 0; r < reach; r += 8) {
        const cand = rect({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }, it);
        if (meets(cand, card, 16) || fixed.some((f) => meets(cand, f, 12))) continue;
        const g = good(cand, it, p);
        if (g !== false) return { r: cand, lab: g };
        if (p.view && !meets(cand, view)) break;
      }
    }
    return null;
  };
  // In view with air; in view, tight; out of view (the board scrolls) but
  // clear; and only then the ellipse spot whatever it lands on.
  const passes: Pass[] = [{ view: true, roomy: true }, { view: true, roomy: false }, { view: false, roomy: true }];
  items.forEach((it, i) => {
    const first = good(ideal[i], it, passes[0]);
    let hit: { r: Rect; lab: Rect | null } | null = first !== false ? { r: ideal[i], lab: first } : null;
    for (const p of passes) { if (hit) break; hit = search(i, it, p); }
    const r = hit?.r ?? ideal[i];
    placed.push(r);
    if (hit?.lab) labels.push(hit.lab);
    out.push({ x: Math.max(0, r.x), y: Math.max(0, r.y) });
  });
  return out;
}

/** Does the segment a-b pass through r? (Liang-Barsky.) */
function crosses(a: Pos, b: Pos, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges: Array<[number, number]> = [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}
function segmentsCross(a: Pos, b: Pos, c: Pos, d: Pos): boolean {
  const o = (p: Pos, q: Pos, r: Pos) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** THE CHARACTERS WEB (the master's web): the most connected character in
 *  the middle, the rest on an ellipse as tall as the view. The ellipse widens,
 *  then deepens, until no two cards touch, however many there are; who sits
 *  where on it is chosen so a tie's line never runs under a third card and
 *  tied people sit near each other (2026-10-15: on The Breakfast Club,
 *  Andrew's line to Allison ran under Bender, as if Bender were tied to her). */
export function webLayout(o: { ids: string[]; ties: Array<{ a: string; b: string; /** its label's width */ lw?: number }>; weight: Map<string, number>; viewW: number; viewH: number; w: number; h: number }): Map<string, Pos> {
  const m = new Map<string, Pos>();
  const { w, h } = o;
  if (!o.ids.length) return m;
  const ranked = [...o.ids].sort((a, b) => (o.weight.get(b) ?? 0) - (o.weight.get(a) ?? 0) || a.localeCompare(b));
  const ring = ranked.slice(1);
  const n = ring.length;
  let rx = Math.max(340, (n * (w + 70)) / (2 * Math.PI));
  let ry = Math.min(rx, Math.max(190, (o.viewH - 96 - h) / 2));
  const rxRoom = Math.max(rx, o.viewW / 2 - w / 2 - 24);
  const spots = () => Array.from({ length: n }, (_, i) => {
    const th = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    return { x: rx * Math.cos(th), y: ry * Math.sin(th) };
  });
  const apart = (pts: Pos[]) => {
    const all = [{ x: 0, y: 0 }, ...pts];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (Math.abs(all[i].x - all[j].x) < w + 24 && Math.abs(all[i].y - all[j].y) < h + 24) return false;
    }
    return true;
  };
  // Wider while the view has room side to side, then deeper as well.
  for (let k = 0; k < 60 && !apart(spots()); k++) {
    if (rx * 1.05 <= rxRoom) rx *= 1.05; else { rx *= 1.05; ry = Math.min(rx, ry * 1.05); }
  }
  const ties = o.ties.filter((t) => t.a !== t.b && ranked.includes(t.a) && ranked.includes(t.b));
  // Judged around the middle card at 0,0: lines under a third card, labels
  // with no room on their line, lines crossing, and length.
  const score = (order: string[], at: Pos[]) => {
    const box = new Map<string, Rect>([[ranked[0], { x: -w / 2, y: -h / 2, w, h }]]);
    order.forEach((id, i) => box.set(id, { x: at[i].x - w / 2, y: at[i].y - h / 2, w, h }));
    const seg = ties.map((t) => [centre(box.get(t.a)!), centre(box.get(t.b)!), t] as const);
    let under = 0, over = 0, len = 0, cramped = 0;
    for (const [a, b, t] of seg) {
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      len += d;
      for (const [id, r] of box) if (id !== t.a && id !== t.b && crosses(a, b, { x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 })) under += 1;
      // The stretch of line between the two cards must hold the label.
      const ux = Math.abs(b.x - a.x) / (d || 1), uy = Math.abs(b.y - a.y) / (d || 1);
      const half = Math.min(ux ? w / 2 / ux : Infinity, uy ? h / 2 / uy : Infinity);
      if (d - 2 * half < (t.lw ?? 80) * ux + LABEL_H * uy + 16) cramped += 1;
    }
    for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) if (segmentsCross(seg[i][0], seg[i][1], seg[j][0], seg[j][1])) over += 1;
    return { cost: under * 1000 + cramped * 400 + over * 100 + len / 10, cramped };
  };
  // Swap pairs while it helps.
  const arrange = (start: string[], at: Pos[]) => {
    let order = start;
    let best = score(order, at).cost;
    for (let pass = 0; pass < 12; pass++) {
      let better = false;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const next = [...order];
        [next[i], next[j]] = [next[j], next[i]];
        const c = score(next, at).cost;
        if (c < best - 1e-6) { best = c; order = next; better = true; }
      }
      if (!better) break;
    }
    return order;
  };
  // Start in weight order (the old layout). While a label has no room on its
  // line, widen the ring, as far as the view has room (a hub's diagonal ties
  // left too short a stretch for a long label); never scroll for it.
  let order = [...ring];
  let at = spots();
  for (let k = 0; k < 20; k++) {
    order = arrange(order, at);
    if (!score(order, at).cramped || rx * 1.05 > rxRoom) break;
    rx *= 1.05;
    at = spots();
  }
  const cx = Math.max(rx + w / 2 + 24, o.viewW / 2), cy = 48 + ry + h / 2;
  m.set(ranked[0], { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) });
  order.forEach((id, i) => m.set(id, { x: Math.round(cx + at[i].x - w / 2), y: Math.round(cy + at[i].y - h / 2) }));
  return m;
}

/** Each web tie's label: on its straight line, as near the middle as no
 *  card and no label already placed covers it. */
export function webLabelSpots(ties: Array<{ key: string; a: Pos; b: Pos; lw: number }>, cards: Rect[]): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const taken: Rect[] = [];
  for (const t of ties) {
    const ends = cards.filter((r) => inside(r, t.a) || inside(r, t.b));
    const others = cards.filter((r) => !ends.includes(r));
    const s = labelSpot(straightPoints(t.a, t.b), ends, [...others, ...taken], t.lw, 6);
    out.set(t.key, s.at);
    taken.push(pill(s.at, t.lw));
  }
  return out;
}

/** UNFOLDED STICKIES (Ben, 2026-10-15: "show stickies" puts every card's
 *  stickies on the board, lines to their card). Each sticky takes the
 *  nearest open spot around its card: rings ever further out, the right
 *  side first, then below, left, above, each side from its middle; clear of
 *  every card and loose item on the board and of the stickies already
 *  placed; inside `maxW` (the board's width in view) when there is room
 *  there, past it only when there is not. Positions by sticky key. */
export function unfoldAround(parents: Array<{ rect: Rect; items: Array<{ key: string; w: number; h: number }> }>, obstacles: Rect[], gap = 28, maxW = Infinity): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const placed: Rect[] = [];
  let within = true;
  // The line from the card to what hangs off it must not run under another
  // card (2026-10-21: a question about Mara landed below the world card, its
  // line drawn behind it). A spot whose line crosses one is passed over while
  // a clean one exists; the second sweep takes the nearest clear spot.
  let lineFrom: Rect | null = null;
  let mindLine = true;
  const crosses = (a: Pos, b: Pos, o: Rect) => {
    // Sampled along the segment: cheap and plenty for card-sized boxes.
    for (let t = 0.08; t < 0.92; t += 0.04) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x > o.x + 4 && x < o.x + o.w - 4 && y > o.y + 4 && y < o.y + o.h - 4) return true;
    }
    return false;
  };
  const lineClear = (r: Rect) => {
    if (!mindLine || !lineFrom) return true;
    const a = { x: lineFrom.x + lineFrom.w / 2, y: lineFrom.y + lineFrom.h / 2 }, b = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    return !obstacles.some((o) => !(o.x === lineFrom!.x && o.y === lineFrom!.y && o.w === lineFrom!.w && o.h === lineFrom!.h) && crosses(a, b, o));
  };
  const clear = (r: Rect) => r.x >= 0 && r.y >= 0 && (!within || r.x + r.w <= maxW) && !obstacles.some((o) => meets(r, o, 10)) && !placed.some((o) => meets(r, o, 8)) && lineClear(r);
  for (const p of parents) {
    const c = p.rect;
    lineFrom = c;
    for (const it of p.items) {
      const fromMid = (lo: number, hi: number, mid: number) => {
        const xs: number[] = [];
        for (let v = lo; v <= hi; v += 16) xs.push(v);
        return xs.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      };
      let spot: Pos | null = null;
      for (const [pass, line] of [[true, true], [false, true], [true, false], [false, false]] as Array<[boolean, boolean]>) {
        within = pass;
        mindLine = line;
        for (let d = gap; d < gap + 900 && !spot; d += 20) {
          // Each side's band reaches round the corners as the ring grows
          // (2026-10-21): with the row beside a card full and a card below it,
          // the clean spot is often diagonal, past the corner.
          const reach = mindLine ? d : 0;
          const sides: Pos[][] = [
            fromMid(c.y - it.h + 12 - reach, c.y + c.h - 12 + reach, c.y + c.h / 2 - it.h / 2).map((y) => ({ x: c.x + c.w + d, y })),
            fromMid(c.x - it.w + 12 - reach, c.x + c.w - 12 + reach, c.x + c.w / 2 - it.w / 2).map((x) => ({ x, y: c.y + c.h + d })),
            fromMid(c.y - it.h + 12 - reach, c.y + c.h - 12 + reach, c.y + c.h / 2 - it.h / 2).map((y) => ({ x: c.x - d - it.w, y })),
            fromMid(c.x - it.w + 12 - reach, c.x + c.w - 12 + reach, c.x + c.w / 2 - it.w / 2).map((x) => ({ x, y: c.y - d - it.h })),
          ];
          for (const side of sides) {
            const hit = side.find((q) => clear({ x: q.x, y: q.y, w: it.w, h: it.h }));
            if (hit) { spot = hit; break; }
          }
        }
        if (spot) break;
      }
      const at = spot ?? { x: c.x + c.w + gap, y: c.y };
      out.set(it.key, { x: Math.round(at.x), y: Math.round(at.y) });
      placed.push({ x: at.x, y: at.y, w: it.w, h: it.h });
    }
  }
  return out;
}
