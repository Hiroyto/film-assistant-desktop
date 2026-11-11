// Connect on the board (Ben, 2026-11-05): drag a scene's handle onto
// another scene and that one comes next.
import { connectDiff, type Link } from './sandboxConnect';

const L = (...ids: string[]): Link[] => ids.slice(1).map((to, i) => ({ from: ids[i], to }));
const apply = (edges: Link[], d: { remove: Link[]; add: Link[] } | null) => {
  if (!d) return edges;
  const gone = new Set(d.remove.map((e) => `${e.from}|${e.to}`));
  return [...edges.filter((e) => !gone.has(`${e.from}|${e.to}`)), ...d.add];
};
const chain = (edges: Link[]) => {
  const next = new Map(edges.map((e) => [e.from, e.to]));
  const heads = edges.map((e) => e.from).filter((f) => !edges.some((e) => e.to === f));
  const out: string[] = [];
  let v: string | undefined = heads[0];
  while (v && !out.includes(v)) { out.push(v); v = next.get(v); }
  return out.join(' > ');
};

test('a loose scene connected to the end of the line joins it', () => {
  const d = connectDiff(L('a', 'b'), 'b', 'n');
  expect(d).toEqual({ remove: [], add: [{ from: 'b', to: 'n' }] });
});

test('connected from a scene with a next one, it goes in between', () => {
  const e = L('a', 'b', 'c');
  const d = connectDiff(e, 'a', 'n');
  expect(d).toEqual({ remove: [{ from: 'a', to: 'b' }], add: [{ from: 'a', to: 'n' }, { from: 'n', to: 'b' }] });
  expect(chain(apply(e, d))).toBe('a > n > b > c');
});

test('a scene already in the line moves, and its old neighbours join up', () => {
  const e = L('a', 'b', 'c', 'd');
  const d = connectDiff(e, 'c', 'b');
  expect(chain(apply(e, d))).toBe('a > c > b > d');
  const d2 = connectDiff(e, 'd', 'a');
  expect(chain(apply(e, d2))).toBe('b > c > d > a');
});

test('a scene that comes before connected onto: moves after it', () => {
  const e = L('a', 'b', 'c');
  expect(chain(apply(e, connectDiff(e, 'b', 'a')))).toBe('b > a > c');
});

test('already next: nothing to do', () => {
  expect(connectDiff(L('a', 'b'), 'a', 'b')).toBeNull();
  expect(connectDiff(L('a', 'b'), 'a', 'a')).toBeNull();
});

test('two loose scenes start a line', () => {
  expect(connectDiff([], 'x', 'y')).toEqual({ remove: [], add: [{ from: 'x', to: 'y' }] });
});

test('a fork leader: the next one is the closest, extra links into the moved scene go', () => {
  // a > b > c with a leftover a > c: connecting n after b puts it before c.
  const e = [...L('a', 'b', 'c'), { from: 'a', to: 'c' }];
  const out = apply(e, connectDiff(e, 'b', 'n'));
  const has = (f: string, t: string) => out.some((x) => x.from === f && x.to === t);
  expect(has('b', 'n') && has('n', 'c') && !has('b', 'c')).toBe(true);
});

test('links to cards that are not scenes on the board are left alone', () => {
  const e = [...L('a', 'b'), { from: 'seq1', to: 'b' }];
  const d = connectDiff(e, 'a', 'b', new Set(['a', 'b']));
  expect(d).toBeNull();
  const d2 = connectDiff(e, 'b', 'a', new Set(['a', 'b']));
  expect(d2?.remove.some((x) => x.from === 'seq1')).toBe(false);
});

import { placeBeforeDiff } from './sandboxConnect';

test('a scene dropped at the start goes before the first one; its old neighbours join up', () => {
  const e = L('a', 'b', 'c');
  const out = apply(e, placeBeforeDiff(e, 'c', 'a'));
  expect(chain(out)).toBe('c > a > b');
  const e2 = L('a', 'b', 'c');
  expect(chain(apply(e2, placeBeforeDiff(e2, 'b', 'a')))).toBe('b > a > c');
});
