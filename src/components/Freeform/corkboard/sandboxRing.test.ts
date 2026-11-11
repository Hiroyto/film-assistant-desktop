// Tie geometry: the people around an opened card stay in view with their
// labels clear, and the Characters web never stacks cards or runs a tie under
// a third card. Names and labels are invented.
import { LABEL_H, labelSpot, ringLabel, ringSlots, straightPoints, webLabelSpots, webLayout, type Rect } from './sandboxRing';

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** How many pairs of the rects overlap. */
const touching = (rs: Rect[]) => rs.reduce((n, r, i) => n + rs.slice(i + 1).filter((q) => meets(r, q)).length, 0);
const W = 220, H = 112;

describe('ringSlots', () => {
  const ring = (view: Rect | undefined, labels: string[], cardH = 150) => {
    const c = { x: (view?.w ?? 1400) / 2, y: (view?.h ?? 700) / 2 };
    const card = { x: c.x - 280, y: c.y - cardH / 2, w: 560, h: cardH };
    const pills = { x: card.x - 20, y: Math.max(4, card.y - 46) - 4, w: 600, h: 38 };
    const lws = labels.map((l) => 16 + l.length * 6.4);
    const pos = ringSlots({ card, pills, view, items: lws.map((lw) => ({ w: W, h: H, lw: lw || undefined })), chipH: 30 });
    return { card, pills, lws, sats: pos.map((p) => ({ x: p.x, y: p.y, w: W, h: H })) };
  };

  it('keeps the ellipse for a slide without labels', () => {
    const { card, sats } = ring(undefined, ['', '']);
    // Right of the card and left of it, level with its middle.
    expect(sats[0].x).toBeCloseTo(card.x + card.w + 44, 0);
    expect(sats[0].y + H / 2).toBeCloseTo(card.y + card.h / 2, 0);
    expect(sats[1].x + W).toBeCloseTo(card.x - 44, 0);
  });

  it('pushes the ring out until the longest label fits with air', () => {
    const short = ring(undefined, ['knows', 'knows']).sats[0].x;
    const long = ring(undefined, ['owes a great deal to', 'knows']).sats[0].x;
    expect(long).toBeGreaterThan(short + 60);
  });

  it('five ties in a laptop-sized view: all in view, none overlapping, every label clear', () => {
    const view = { x: 10, y: 10, w: 1210, h: 515 };
    const labels = ['owes a great deal to', 'argues with', 'drawn to', 'keeps secrets from', 'teases'];
    const { card, pills, lws, sats } = ring(view, labels);
    sats.forEach((r) => {
      expect(r.x).toBeGreaterThanOrEqual(view.x);
      expect(r.y).toBeGreaterThanOrEqual(view.y);
      expect(r.x + r.w).toBeLessThanOrEqual(view.x + view.w);
      expect(r.y + r.h).toBeLessThanOrEqual(view.y + view.h);
      expect(meets(r, card)).toBe(false);
    });
    expect(touching(sats)).toBe(0);
    const placed: Rect[] = [];
    sats.forEach((r, i) => {
      const s = ringLabel(card, r, [pills, ...sats.filter((_, j) => j !== i), ...placed], lws[i]);
      expect(s.fits).toBe(true);
      placed.push({ x: s.at.x - lws[i] / 2, y: s.at.y - LABEL_H / 2, w: lws[i], h: LABEL_H });
    });
  });

  it('what cannot fit in view goes off its right or bottom, never onto another card', () => {
    const view = { x: 10, y: 10, w: 1100, h: 520 };
    const labels = Array.from({ length: 9 }, (_, i) => `owes a great deal to ${i}`);
    const { card, sats } = ring(view, labels, 260);
    sats.forEach((r) => {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(meets(r, card)).toBe(false);
    });
    expect(touching(sats)).toBe(0);
  });
});

describe('labelSpot', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }, b = { x: 400, y: 0, w: 100, h: 50 };
  const line = straightPoints({ x: 50, y: 25 }, { x: 450, y: 25 });
  it('sits in the middle of the stretch you can see', () => {
    const s = labelSpot(line, [a, b], [], 80);
    expect(s.fits).toBe(true);
    expect(s.at.x).toBeCloseTo(250, -1);
  });
  it('slides along the line off something in the way', () => {
    const s = labelSpot(line, [a, b], [{ x: 220, y: 0, w: 60, h: 50 }], 60);
    expect(s.fits).toBe(true);
    expect(s.at.x < 190 || s.at.x > 310).toBe(true);
  });
  it('says so when the gap is too short', () => {
    expect(labelSpot(line, [a, b], [], 400).fits).toBe(false);
  });
});

describe('webLayout', () => {
  const cardOf = (p: { x: number; y: number }): Rect => ({ x: p.x, y: p.y, w: W, h: H });
  const centre = (p: { x: number; y: number }) => ({ x: p.x + W / 2, y: p.y + H / 2 });
  const under = (pos: Map<string, { x: number; y: number }>, ties: Array<{ a: string; b: string }>) => {
    let n = 0;
    for (const t of ties) {
      const pts = straightPoints(centre(pos.get(t.a)!), centre(pos.get(t.b)!), 200);
      for (const [id, p] of pos) if (id !== t.a && id !== t.b && pts.some((q) => q.x > p.x && q.x < p.x + W && q.y > p.y && q.y < p.y + H)) n += 1;
    }
    return n;
  };
  const weigh = (ids: string[], ties: Array<{ a: string; b: string }>) => {
    const w = new Map(ids.map((id) => [id, 0]));
    for (const t of ties) { w.set(t.a, w.get(t.a)! + 2); w.set(t.b, w.get(t.b)! + 2); }
    return w;
  };

  it('puts the most tied in the middle and runs no tie under a third card', () => {
    // A hub tied to four, and two of the four tied across the ring.
    const ids = ['hub', 'ann', 'bo', 'cy', 'di', 'ed'];
    const ties = [{ a: 'hub', b: 'ann' }, { a: 'hub', b: 'bo' }, { a: 'hub', b: 'cy' }, { a: 'hub', b: 'di' }, { a: 'cy', b: 'ed' }, { a: 'bo', b: 'ed' }];
    const pos = webLayout({ ids, ties, weight: weigh(ids, ties), viewW: 1460, viewH: 680, w: W, h: H });
    const mid = centre(pos.get('hub')!);
    const xs = [...pos.values()].map((p) => centre(p).x);
    expect(mid.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, -1);
    expect(under(pos, ties)).toBe(0);
  });

  it('ten characters in a short view: no two cards touch', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const ties = ids.slice(1).map((id) => ({ a: 'p0', b: id }));
    const pos = webLayout({ ids, ties, weight: weigh(ids, ties), viewW: 1230, viewH: 535, w: W, h: H });
    const cards = [...pos.values()].map(cardOf);
    expect(touching(cards)).toBe(0);
    expect(Math.min(...cards.map((r) => r.y))).toBeGreaterThanOrEqual(0);
  });

  it('labels on lines that meet at one card do not cover each other', () => {
    const ids = ['hub', 'a', 'b', 'c', 'd', 'e', 'f'];
    const lw = 130;
    const ties = ids.slice(1).map((id) => ({ a: 'hub', b: id, lw }));
    const pos = webLayout({ ids, ties, weight: weigh(ids, ties), viewW: 1460, viewH: 680, w: W, h: H });
    const cards = [...pos.values()].map(cardOf);
    const spots = webLabelSpots(ties.map((t) => ({ key: t.b, a: centre(pos.get(t.a)!), b: centre(pos.get(t.b)!), lw })), cards);
    const pills = [...spots.values()].map((s) => ({ x: s.x - lw / 2, y: s.y - LABEL_H / 2, w: lw, h: LABEL_H }));
    expect(pills.filter((p) => cards.some((c) => meets(p, c)))).toEqual([]);
    expect(touching(pills)).toBe(0);
  });
});
