// The stacked outline (Ben, 2026-11-07).
import { COL, columnSlots, columnsBlockIndexAt, columnsLayout, columnsOf, columnsSceneIndexAt, moveBlock, stretchOf } from './sandboxColumns';

const isBeat = (id: string) => id.startsWith('B');

test('a column per beat, its scenes under it; scenes before any beat get a column with no tab', () => {
  expect(columnsOf(['a', 'B1', 's1', 's2', 'B2'], isBeat)).toEqual([
    { beat: null, scenes: ['a'] },
    { beat: 'B1', scenes: ['s1', 's2'] },
    { beat: 'B2', scenes: [] },
  ]);
});

test('the tab on top, the scenes stacked under it, the columns left to right', () => {
  const lay = columnsLayout(['B1', 's1', 's2', 'B2', 's3'], isBeat);
  const b1 = lay.get('B1')!, s1 = lay.get('s1')!, s2 = lay.get('s2')!, b2 = lay.get('B2')!, s3 = lay.get('s3')!;
  expect(s1.x).toBe(b1.x);
  expect(s1.y).toBeGreaterThan(b1.y + b1.h);
  expect(s2.y).toBe(s1.y + COL.sceneH + COL.gap);
  expect(b2.x).toBe(b1.x + COL.w + COL.colGap);
  expect(s3.y).toBe(s1.y);
});

test('every column ends in a slot; an empty beat\'s is a whole scene tall', () => {
  const slots = columnSlots(['B1', 's1', 'B2'], isBeat);
  expect(slots[0]).toMatchObject({ beat: 'B1', after: 's1', empty: false });
  expect(slots[0].rect.h).toBe(COL.addH);
  expect(slots[1]).toMatchObject({ beat: 'B2', after: 'B2', empty: true });
  expect(slots[1].rect.h).toBe(COL.sceneH);
});

test('a scene dropped in a column lands among its scenes by height', () => {
  const rest = ['B1', 's1', 's2', 'B2', 's3'];
  const lay = columnsLayout(rest, isBeat);
  const b2 = lay.get('B2')!, s1 = lay.get('s1')!, s2 = lay.get('s2')!;
  // Over B2's column, at the top: right after B2.
  expect(columnsSceneIndexAt(rest, isBeat, { x: b2.x + 10, y: s1.y - 30 })).toBe(4);
  // Over B2's column, low: after s3.
  expect(columnsSceneIndexAt(rest, isBeat, { x: b2.x, y: s2.y + 40 })).toBe(5);
  // Over B1's column, between s1 and s2.
  expect(columnsSceneIndexAt(rest, isBeat, { x: s1.x, y: s1.y + 70 })).toBe(2);
});

test('a column moves as a block, never ahead of the scenes with no beat', () => {
  const order = ['a', 'B1', 's1', 'B2', 's2', 's3'];
  const block = ['B2', ...stretchOf(order, isBeat, 'B2')];
  expect(block).toEqual(['B2', 's2', 's3']);
  const rest = order.filter((x) => !block.includes(x));
  expect(columnsBlockIndexAt(rest, isBeat, 0)).toBe(1);
  expect(moveBlock(order, block, 1)).toEqual(['a', 'B2', 's2', 's3', 'B1', 's1']);
  expect(columnsBlockIndexAt(rest, isBeat, 9999)).toBe(rest.length);
});
