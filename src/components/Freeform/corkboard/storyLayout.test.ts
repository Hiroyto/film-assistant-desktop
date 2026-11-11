// The story layout for a braindump (Ben, 2026-11-03): the template's weave,
// scenes in a readable flow, the rest in the gaps, around what is there.
import { storyLayout, chainOrder } from './storyLayout';
import { itemSize, type StageItem } from './sandboxBoard';
import type { ProjectEntity, SandboxFragment } from '../../../lib/freeformApi';

const card = (id: string, type: string, title: string): StageItem => ({ id, kind: 'card', entity: { id, type, working_title: title, working_name: title, state: 'parked' } as unknown as ProjectEntity, attached: [] });
const sticky = (id: string, text: string, about = ''): StageItem => ({ id, kind: 'sticky', fragment: { id, kind: 'note', author: 'extractor', text, source: text, label: '', about, open: true, dumpId: 'd1', attachedTo: null, clusterId: null, createdAt: '' } as unknown as SandboxFragment, dumpNo: 1 });
const overlaps = (pos: Record<string, { x: number; y: number }>, items: StageItem[]) => {
  const rs = items.filter((it) => pos[it.id]).map((it) => ({ id: it.id, ...pos[it.id], ...itemSize(it) }));
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id} on ${b.id}`;
  }
  return null;
};

const scenes = ['s1', 's2', 's3', 's4', 's5'].map((id, i) => card(id, 'event', `Scene ${i + 1}`));
const nell = card('c_nell', 'character', 'Nell');
const tam = card('c_tam', 'character', 'Tam');
const note = sticky('n1', 'who else has her login?', 'Scene 4');
const loose = sticky('n2', 'the causeway as a clock');
const all = [...scenes, nell, tam, note, loose];
const involves = [{ from: 's1', to: 'c_nell' }, { from: 's2', to: 'c_tam' }, { from: 's3', to: 'c_nell' }];

test('on an empty board: the scenes weave in story order, then the people, then the notes; nothing overlaps', () => {
  const { pos, order } = storyLayout({ items: all, fresh: new Set(all.map((i) => i.id)), placed: {}, sceneOrder: ['s1', 's2', 's3', 's4', 's5'], involves, boardW: 1440 });
  expect(order).toEqual(['s1', 's2', 's3', 's4', 's5', 'c_nell', 'c_tam', 'n1', 'n2']);
  // Three across, then back the other way.
  expect(pos.s1.x).toBeLessThan(pos.s2.x); expect(pos.s2.x).toBeLessThan(pos.s3.x);
  expect(pos.s4.y).toBeGreaterThan(pos.s1.y + 150); expect(pos.s4.x).toBeGreaterThan(pos.s5.x);
  expect(overlaps(pos, all)).toBeNull();
  // A character sits near their first scene; a note near the scene it is about.
  const near = (a: string, b: string) => Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
  expect(near('c_nell', 's1')).toBeLessThan(near('c_nell', 's5'));
  expect(near('n1', 's4')).toBeLessThan(near('n1', 's1'));
});

test('on a board with cards: nothing there moves, the new block starts under it, around it', () => {
  const old = [card('o1', 'event', 'Old scene'), card('o_char', 'character', 'Mara')];
  const placed = { o1: { x: 40, y: 40 }, o_char: { x: 400, y: 60 } };
  const items = [...old, ...all];
  const { pos } = storyLayout({ items, fresh: new Set(all.map((i) => i.id)), placed, sceneOrder: ['o1', 's1', 's2', 's3', 's4', 's5'], involves, boardW: 1440 });
  expect(pos.o1).toBeUndefined(); expect(pos.o_char).toBeUndefined();
  const oldBottom = Math.max(...old.map((it) => placed[it.id as 'o1'].y + itemSize(it).h));
  for (const s of scenes) expect(pos[s.id].y).toBeGreaterThan(oldBottom);
  expect(overlaps({ ...placed, ...pos }, items)).toBeNull();
});

test('a new character in a scene already on the board sits by that scene when there is room', () => {
  const old = card('o1', 'event', 'Old scene');
  const placed = { o1: { x: 400, y: 300 } };
  const mara = card('c_mara', 'character', 'Mara');
  const { pos } = storyLayout({ items: [old, mara], fresh: new Set(['c_mara']), placed, sceneOrder: ['o1'], involves: [{ from: 'o1', to: 'c_mara' }], boardW: 1440 });
  // Right beside it, in the gap, not down in a new block.
  expect(Math.hypot(pos.c_mara.x - 400, pos.c_mara.y - 300)).toBeLessThan(260);
});

test('it fits the visible board: nothing past the right edge, the scenes inside the height when they can be', () => {
  const six = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id, i) => card(id, 'event', `Beat ${i + 1}`));
  const cast = [card('p1', 'character', 'One'), card('p2', 'character', 'Two'), card('p3', 'character', 'Three'), card('p4', 'character', 'Four')];
  const items = [...six, ...cast];
  const inv = [{ from: 'a1', to: 'p1' }, { from: 'a2', to: 'p2' }, { from: 'a3', to: 'p3' }, { from: 'a6', to: 'p4' }];
  const boardW = 1300, viewH = 780;
  const { pos } = storyLayout({ items, fresh: new Set(items.map((i) => i.id)), placed: {}, sceneOrder: six.map((s) => s.id), involves: inv, boardW, viewH });
  for (const it of items) expect(pos[it.id].x + itemSize(it).w).toBeLessThanOrEqual(boardW);
  for (const it of six) expect(pos[it.id].y + itemSize(it).h).toBeLessThanOrEqual(viewH);
  expect(overlaps(pos, items)).toBeNull();
});

// A later dump brings earlier scenes (Ben, 2026-11-04: "slide the weave"):
// the board lays its own cards again with the new ones, in story order, from
// where the weave started; a card the writer placed stays and is stepped past.
test('earlier scenes from a later dump take the front; the board\'s cards slide along; the writer\'s stay', () => {
  const later = ['s31', 's32', 's41'].map((id) => card(id, 'event', id));
  const earlier = ['s11', 's21', 's22'].map((id) => card(id, 'event', id));
  const mine = card('c_j', 'character', 'Journalist');
  const first = storyLayout({ items: later, fresh: new Set(later.map((s) => s.id)), placed: {}, sceneOrder: later.map((s) => s.id), involves: [], boardW: 1440 });
  const handPos = { x: 1200, y: 600 };
  const placed = { ...first.pos, c_j: handPos };
  const items = [...earlier, ...later, mine];
  const order = ['s11', 's21', 's22', 's31', 's32', 's41'];
  const origin = Math.min(...later.map((s) => first.pos[s.id].y));
  const second = storyLayout({ items, fresh: new Set(order), placed, sceneOrder: order, involves: [], boardW: 1440, origin });
  // The new earlier scenes take the first spots, where 3.1 used to be.
  expect(second.pos.s11.x).toBe(first.pos.s31.x);
  // ...at the same height: the weave does not sink a band each dump.
  expect(Math.abs(second.pos.s11.y - first.pos.s31.y)).toBeLessThan(40);
  // The scenes already there moved along, in story order, the thread unbroken.
  expect(second.pos.s31.y).toBeGreaterThan(first.pos.s31.y + 100);
  expect(second.order.filter((id) => id.startsWith('s'))).toEqual(order);
  // The writer's card is not moved and nothing lands on it.
  expect(second.pos.c_j).toBeUndefined();
  expect(overlaps({ ...second.pos, c_j: handPos }, items)).toBeNull();
});

// Ben, 2026-11-04 ("skip blocked slots"): a scene the writer dragged into
// the weave's way is a hole, not a wall. The board's scenes keep reading in
// order around it instead of sinking under it.
test('a card the writer placed in a slot is skipped; the opening scenes stay on top', () => {
  const sc = ['s1', 's2', 's3', 's4'].map((id) => card(id, 'event', id));
  const order = sc.map((s) => s.id);
  const first = storyLayout({ items: sc, fresh: new Set(order), placed: {}, sceneOrder: order, involves: [], boardW: 1440 });
  const mine = card('m', 'event', 'Mine');
  const handPos = { ...first.pos.s2 };
  const items = [...sc, mine];
  const origin = Math.min(...order.map((id) => first.pos[id].y));
  const again = storyLayout({ items, fresh: new Set(order), placed: { ...first.pos, m: handPos }, sceneOrder: order, involves: [], boardW: 1440, origin });
  // The first scene keeps its slot; the second takes the next free one.
  expect(Math.abs(again.pos.s1.y - first.pos.s1.y)).toBeLessThan(40);
  expect(Math.abs(again.pos.s2.x - first.pos.s3.x)).toBeLessThan(50);
  expect(Math.abs(again.pos.s2.y - first.pos.s1.y)).toBeLessThan(120);
  // Nothing sinks a band: the last scene is at most one slot further along.
  expect(again.pos.s4.y - first.pos.s4.y).toBeLessThan(400);
  expect(overlaps({ ...again.pos, m: handPos }, items)).toBeNull();
});

test('story order follows every "comes after" link, across dumps: a later dump\'s first scene leads into what was there', () => {
  const sc = ['hides', 'search', 'hands', 'finds', 'bram'].map((id) => card(id, 'event', id));
  // Dump one: hides > search > hands. Dump two: finds > bram, declared first: bram > hides.
  const precedes = [{ from: 'hides', to: 'search' }, { from: 'search', to: 'hands' }, { from: 'finds', to: 'bram' }, { from: 'bram', to: 'hides' }];
  expect(chainOrder(sc, precedes)).toEqual(['finds', 'bram', 'hides', 'search', 'hands']);
  // Without a link between dumps, the order they were made.
  expect(chainOrder(sc, precedes.slice(0, 3))).toEqual(['hides', 'search', 'hands', 'finds', 'bram']);
});

test('a new scene lands beside its line neighbour when the writer placed that card (Nell, 2026-11-04)', () => {
  // The writer spread the scenes over the top; the new scene comes first in
  // the line, right before "reports". It goes beside reports, not two bands down.
  const placed = { reports: { x: 700, y: 60 }, warns: { x: 1100, y: 80 }, skipper: { x: 300, y: 300 }, causeway: { x: 900, y: 360 } };
  const old = Object.keys(placed).map((id) => card(id, 'event', id));
  const follows = card('follows', 'event', 'Nell follows Tam');
  const mate = card('c_mate', 'character', "The survey boat's mate");
  const items = [...old, follows, mate];
  const { pos } = storyLayout({ items, fresh: new Set(['follows', 'c_mate']), placed, sceneOrder: ['follows', 'reports', 'warns', 'skipper', 'causeway'], involves: [{ from: 'follows', to: 'c_mate' }], boardW: 1440 });
  expect(Math.abs(pos.follows.y - placed.reports.y)).toBeLessThan(itemSize(follows).h + 120);
  expect(pos.follows.x).toBeLessThan(placed.reports.x);
  expect(overlaps({ ...placed, ...pos }, items)).toBeNull();
  // Its character goes beside it, up there too.
  expect(pos.c_mate.y).toBeLessThan(placed.causeway.y + 300);
});

test('with nothing fixed beside it, a new scene still takes the weave', () => {
  const { pos } = storyLayout({ items: scenes, fresh: new Set(scenes.map((s) => s.id)), placed: {}, sceneOrder: ['s1', 's2', 's3', 's4', 's5'], involves: [], boardW: 1440 });
  expect(pos.s1.x).toBeLessThan(pos.s2.x); expect(pos.s2.x).toBeLessThan(pos.s3.x);
});
