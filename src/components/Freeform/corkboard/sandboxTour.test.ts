// The sandbox guide's card keeps clear of what it points at and what opened
// around it (Ben, 2026-11-08: "the modal is covering the only sticky").
import { placeCard } from './sandboxTour';

const view = { w: 1400, h: 800 };
const card = { w: 320, h: 180 };
const overlaps = (p: { left: number; top: number }, b: { left: number; top: number; width: number; height: number }) =>
  p.left < b.left + b.width && b.left < p.left + card.w && p.top < b.top + b.height && b.top < p.top + card.h;

test('beside the target when there is room', () => {
  const t = { left: 200, top: 300, width: 300, height: 140 };
  const p = placeCard(t, card, [], view);
  expect(overlaps(p, t)).toBe(false);
  // Close to it: within a short reach of one of its edges.
  const gapX = Math.max(0, t.left - (p.left + card.w), p.left - (t.left + t.width));
  const gapY = Math.max(0, t.top - (p.top + card.h), p.top - (t.top + t.height));
  expect(Math.max(gapX, gapY)).toBeLessThan(60);
});

test('never on a sticky that opened beside the target', () => {
  const t = { left: 500, top: 300, width: 400, height: 160 };
  const sticky = { left: 920, top: 300, width: 160, height: 100 };
  const chips = { left: 450, top: 250, width: 600, height: 36 };
  const p = placeCard(t, card, [sticky, chips], view);
  for (const b of [t, sticky, chips]) expect(overlaps(p, b)).toBe(false);
});

test('a centred card when there is nothing to point at', () => {
  const p = placeCard(null, card, [], view);
  expect(p.left).toBe((view.w - card.w) / 2);
});

test('beside its target even when board cards are around; clear of the target (2026-11-08)', () => {
  const t = { left: 100, top: 100, width: 300, height: 140 };
  const cards = [{ left: 100, top: 260, width: 300, height: 140 }, { left: 420, top: 100, width: 300, height: 140 }];
  const p = placeCard(t, card, [], view, [], cards);
  expect(overlaps(p, t)).toBe(false);
  const gapX = Math.max(0, t.left - (p.left + card.w), p.left - (t.left + t.width));
  const gapY = Math.max(0, t.top - (p.top + card.h), p.top - (t.top + t.height));
  expect(Math.max(gapX, gapY)).toBeLessThan(60);
});
