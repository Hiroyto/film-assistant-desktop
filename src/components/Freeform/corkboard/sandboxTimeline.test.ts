// The timeline layout (Ben, 2026-11-05).
import { TL, timelineIndexAt, timelineLayout, timelineWidth } from './sandboxTimeline';

const isBeat = (id: string) => id.startsWith('B');

test('scenes sit on one track in order; a beat spans the scenes after it', () => {
  const lay = timelineLayout(['B1', 's1', 's2', 'B2', 's3'], isBeat);
  const s1 = lay.get('s1')!, s2 = lay.get('s2')!, s3 = lay.get('s3')!;
  expect(s1.y).toBe(TL.trackY);
  expect(s2.x).toBe(s1.x + TL.sceneW + TL.gap);
  const b1 = lay.get('B1')!;
  expect(b1.x).toBe(s1.x);
  expect(b1.x + b1.w).toBe(s2.x + s2.w);
  expect(b1.y).toBeLessThan(s1.y);
  expect(lay.get('B2')!.x).toBe(s3.x);
});

test('a beat with no scenes takes a short slot of its own', () => {
  const lay = timelineLayout(['B1', 'B2', 's1'], isBeat);
  const b1 = lay.get('B1')!, b2 = lay.get('B2')!, s1 = lay.get('s1')!;
  expect(b1.w).toBe(TL.emptyW);
  expect(b2.x).toBe(b1.x + TL.emptyW + TL.gap);
  expect(s1.x).toBe(b2.x);
});

test('a drop lands before the first card whose middle is right of it', () => {
  const rest = ['B1', 's1', 's2', 's3'];
  const lay = timelineLayout(rest, isBeat);
  const s2 = lay.get('s2')!;
  expect(timelineIndexAt(rest, isBeat, s2.x - 10, TL.sceneW)).toBe(2);
  expect(timelineIndexAt(rest, isBeat, s2.x + 150, TL.sceneW)).toBe(3);
  expect(timelineIndexAt(rest, isBeat, 0, TL.sceneW)).toBe(0);
  expect(timelineIndexAt(rest, isBeat, 9999, TL.sceneW)).toBe(4);
});

test('the track is as wide as its cards', () => {
  expect(timelineWidth(['s1', 's2'], isBeat)).toBe(TL.x0 + 2 * TL.sceneW + TL.gap);
});
