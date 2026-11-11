// Beats on the line (Ben, 2026-11-05).
import { beatLinks, beatOf, beatSpots, sceneLine } from './sandboxBeats';

const L = (...ids: string[]) => ids.slice(1).map((to, i) => ({ from: ids[i], to }));

test('a beat leads into its first scene; the stretch before leads into the next beat', () => {
  const links = beatLinks([
    { id: 'b1', color: '#a', scenes: [] },
    { id: 'b2', color: '#b', scenes: ['s2', 's1'] },
    { id: 'b3', color: '#c', scenes: ['s3'] },
  ], ['s1', 's2', 's3'], L('s1', 's2', 's3'));
  expect(links).toHaveLength(4);
  expect(links).toEqual(expect.arrayContaining([
    { from: 'b1', to: 'b2' },
    { from: 'b2', to: 's1' },
    { from: 's2', to: 'b3' },
    { from: 'b3', to: 's3' },
  ]));
});

test('the writer\'s scene order wins: a beat link that would loop is left out', () => {
  // s9 is in beat 2 but the writer put it last, after beat 3's scene.
  const links = beatLinks([
    { id: 'b2', color: '#b', scenes: ['s9'] },
    { id: 'b3', color: '#c', scenes: ['s3'] },
  ], ['s3', 's9'], L('s3', 's9'));
  expect(links).toContainEqual({ from: 'b2', to: 's9' });
  expect(links.some((l) => l.from === 's9' && l.to === 'b3')).toBe(false);
});

test('which beat a scene sits in', () => {
  const m = beatOf([{ id: 'b1', color: '#a', scenes: ['s1', 's2'] }, { id: 'b2', color: '#b', scenes: ['s3'] }]);
  expect(m.get('s2')).toBe('b1');
  expect(m.get('s3')).toBe('b2');
  expect(m.has('s4')).toBe(false);
});

test('scene line order follows the links, ties by the order given', () => {
  expect(sceneLine(['c', 'a', 'b'], L('a', 'b'))).toEqual(['c', 'a', 'b']);
});

test('a beat with no spot goes beside its first scene, clear of other cards', () => {
  const placed = { s1: { x: 500, y: 100, w: 300, h: 140 }, s2: { x: 900, y: 100, w: 300, h: 140 } };
  const spots = beatSpots({ beats: [{ id: 'b1', color: '#a', scenes: ['s1', 's2'] }], placed, sizeOf: () => ({ w: 300, h: 140 }), scenes: ['s1', 's2'], precedes: L('s1', 's2') });
  expect(spots.b1.x + 300).toBeLessThanOrEqual(500);
  expect(Math.abs(spots.b1.y - 100)).toBeLessThan(160);
});

test('an empty beat goes after the stretch before it; a beat with a spot keeps it', () => {
  const placed = { s1: { x: 40, y: 40, w: 300, h: 140 }, b1: { x: 600, y: 600, w: 300, h: 140 } };
  const spots = beatSpots({ beats: [{ id: 'b1', color: '#a', scenes: ['s1'] }, { id: 'b2', color: '#b', scenes: [] }], placed, sizeOf: () => ({ w: 300, h: 140 }), scenes: ['s1'], precedes: [] });
  expect(spots.b1).toBeUndefined();
  expect(spots.b2.x).toBeGreaterThan(340);
});

import { beatLine } from './sandboxBeats';

test('checkpoints: a beat owns what follows it on the line, up to the next beat', () => {
  // Nell: the writer's order mixes the stored lists (reports in 3, causeway in 4, warns back in 3).
  const r = beatLine([
    { id: 'B1', color: '', scenes: [] },
    { id: 'B2', color: '', scenes: ['follows'] },
    { id: 'B3', color: '', scenes: ['reports', 'warns'] },
    { id: 'B4', color: '', scenes: ['causeway', 'skipper'] },
  ], ['reports', 'causeway', 'skipper', 'warns', 'follows'], L('reports', 'causeway', 'skipper', 'warns', 'follows'));
  expect(r.line).toEqual(['B3', 'reports', 'B4', 'causeway', 'skipper', 'warns', 'B1', 'B2', 'follows']);
  expect(r.beatOf.get('warns')).toBe('B4');
  expect(r.scenesOf.get('B3')).toEqual(['reports']);
  expect(r.scenesOf.get('B1')).toEqual([]);
  expect(r.links).toEqual(expect.arrayContaining([{ from: 'reports', to: 'B4' }, { from: 'B4', to: 'causeway' }, { from: 'warns', to: 'B1' }, { from: 'B1', to: 'B2' }]));
});

test('checkpoints: an empty last beat goes at the end; scenes before any beat belong to none', () => {
  const r = beatLine([{ id: 'B1', color: '', scenes: ['b'] }, { id: 'B2', color: '', scenes: [] }], ['a', 'b'], L('a', 'b'));
  expect(r.line).toEqual(['a', 'B1', 'b', 'B2']);
  expect(r.beatOf.has('a')).toBe(false);
});

test('checkpoints: a dump\'s chain with no link into the line goes with the beat it was dumped into', () => {
  const r = beatLine([
    { id: 'B2', color: '', scenes: ['x1', 'x2'] },
    { id: 'B3', color: '', scenes: ['a', 'b'] },
  ], ['a', 'b', 'x1', 'x2'], [...L('a', 'b'), ...L('x1', 'x2')]);
  expect(r.line).toEqual(['B2', 'x1', 'x2', 'B3', 'a', 'b']);
});

import { beatPlaceAt } from './sandboxBeats';

test('movable beats: a beat\'s own link outranks its stored scenes', () => {
  const beats = [{ id: 'B1', color: '', scenes: ['a'] }, { id: 'B2', color: '', scenes: ['c'] }];
  const before = beatLine(beats, ['a', 'b', 'c'], L('a', 'b', 'c'), [{ from: 'B2', to: 'b' }]);
  expect(before.line).toEqual(['B1', 'a', 'B2', 'b', 'c']);
  const after = beatLine(beats, ['a', 'b', 'c'], L('a', 'b', 'c'), [{ from: 'c', to: 'B2' }]);
  expect(after.line).toEqual(['B1', 'a', 'b', 'c', 'B2']);
});

test('movable beats: where a dropped beat lands', () => {
  const isScene = (x: string) => !x.startsWith('B');
  expect(beatPlaceAt(['B1', 'a', 'b', 'B3', 'c'], 2, isScene)).toEqual({ before: 'b' });
  expect(beatPlaceAt(['B1', 'a', 'b', 'B3', 'c'], 3, isScene)).toEqual({ before: 'c' });
  expect(beatPlaceAt(['B1', 'a', 'b'], 3, isScene)).toEqual({ after: 'b' });
});
