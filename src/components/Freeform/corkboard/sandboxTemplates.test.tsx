import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { TemplatePreview, TemplatesPanel } from './sandboxTemplates';
import { isTemplateItem } from './sandboxBoard';

const plot = { id: 'plot', label: 'Plot-driven', film: 'Example Film', year: 1999, blurb: 'A chain of scenes.', counts: { scenes: 3, characters: 2, world: 1, stickies: 4 } };

test('the empty board offers each template and applies the one picked', () => {
  const onUse = jest.fn(); const onClose = jest.fn();
  const { container, getByText } = render(<TemplatesPanel templates={[plot]} dark={false} busyId={null} top={100} onUse={onUse} onClose={onClose} />);
  expect(getByText('Templates to get you started')).toBeTruthy();
  expect(container.querySelector('[data-template="plot"]')!.textContent).toMatch(/Plot-driven.*Example Film.*1999/);
  fireEvent.click(container.querySelector('[data-use-template="plot"]')!);
  expect(onUse).toHaveBeenCalledWith('plot');
  fireEvent.click(container.querySelector('[aria-label="Close templates"]')!);
  expect(onClose).toHaveBeenCalled();
});

test('while one lands the buttons wait', () => {
  const { container } = render(<TemplatesPanel templates={[plot]} dark={false} busyId="plot" top={100} onUse={() => {}} onClose={() => {}} />);
  const b = container.querySelector('[data-use-template="plot"]') as HTMLButtonElement;
  expect(b.disabled).toBe(true);
  expect(b.textContent).toMatch(/Laying it out/);
});

test('template material is marked until the writer edits it', () => {
  expect(isTemplateItem({ kind: 'card', id: 'a', entity: { id: 'a', type: 'event', template: '1' } as any, attached: [] } as any)).toBe(true);
  expect(isTemplateItem({ kind: 'card', id: 'b', entity: { id: 'b', type: 'event' } as any, attached: [] } as any)).toBe(false);
  expect(isTemplateItem({ kind: 'sticky', id: 'f', fragment: { id: 'f', template: true } } as any)).toBe(true);
});

test('a template lands like a braindump board: world along the top, scenes weaving in order, characters in the weave', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const { itemSize } = require('./sandboxBoard');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  // World material lands as world notes: loose template stickies, the way a dump leaves it.
  const world = (id: string) => ({ kind: 'sticky', id, fragment: { id, kind: 'story', factKind: 'world', text: 'A rule of this world that shapes every scene.', template: true } });
  const scenes = Array.from({ length: 10 }, (_, i) => card(`s${i + 1}`, 'event'));
  const items = [card('c1', 'character'), card('c2', 'character'), card('c3', 'character'), world('w1'), world('w2'), world('w3'), ...scenes];
  const involves = [{ from: 's1', to: 'c1' }, { from: 's4', to: 'c2' }, { from: 's2', to: 'c1' }];
  const at = templateLayout(items, scenes.map((x) => x.id), involves, 1440);
  const sceneYs = scenes.map((x) => at[x.id].y);
  for (const w of ['w1', 'w2', 'w3']) expect(at[w].y + itemSize(items.find((x: any) => x.id === w)).h).toBeLessThan(Math.min(...sceneYs));
  // Scenes start just under the world notes, not far below them.
  const worldBottom = Math.max(...['w1', 'w2', 'w3'].map((w) => at[w].y + itemSize(items.find((x: any) => x.id === w)).h));
  expect(Math.min(...sceneYs) - worldBottom).toBeLessThan(120);
  // Four across (Ben's layout, 2026-11-08): the fifth scene starts the next
  // row, coming back from the right.
  expect(at.s5.y).toBeGreaterThan(at.s1.y + 150);
  expect(at.s5.x).toBeGreaterThan(at.s1.x + 700);
  // The first row runs left to right in story order, each a step lower.
  expect(at.s2.x).toBeGreaterThan(at.s1.x);
  expect(at.s3.x).toBeGreaterThan(at.s2.x);
  expect(at.s2.y).toBeGreaterThan(at.s1.y + 10);
  expect(at.s3.y).toBeGreaterThan(at.s2.y + 10);
  // Nothing overlaps.
  const boxes = items.map((it: any) => ({ id: it.id, ...at[it.id], ...itemSize(it) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap ? `${a.id} overlaps ${b.id}` : 'ok').toBe('ok');
  }
  // A character sits near the first scene they are in.
  const near = (c: string, s: string) => Math.hypot(at[c].x - at[s].x, at[c].y - at[s].y);
  expect(near('c1', 's1')).toBeLessThan(400);
  expect(near('c2', 's4')).toBeLessThan(400);
});

test('template scenes are numbered in story order even when the first one is newer than the rest', () => {
  const { SandboxBoard, stageItemsFrom, defaultLayout } = require('./sandboxBoard');
  const ev = (id: string) => ({ id, type: 'event', state: 'parked', template: '1', working_title: id, summary: '' });
  // Base order puts the older "party" first; the newer "arrival" leads into it.
  const entities = [ev('party'), ev('takeover'), ev('arrival')];
  const precedes = [{ from: 'arrival', to: 'party' }, { from: 'party', to: 'takeover' }];
  const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes, world: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} edges={{ precedes } as any} precedes={precedes} />);
  const no = (id: string) => container.querySelector(`[data-stage-item="${id}"] [data-order-no]`)?.textContent;
  expect([no('arrival'), no('party'), no('takeover')]).toEqual(['1', '2', '3']);
});

test('a world note that names its scene sits beside that scene; one that does not runs along the top', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  const note = (id: string, near?: string) => ({ kind: 'sticky', id, fragment: { id, kind: 'story', factKind: 'world', text: 'A rule of this world.', template: true, ...(near ? { near } : {}) } });
  const scenes = Array.from({ length: 6 }, (_, i) => card(`s${i + 1}`, 'event'));
  const items = [note('top'), note('n5', 's5'), ...scenes];
  const at = templateLayout(items, scenes.map((x) => x.id), [], 1440);
  expect(at.top.y).toBeLessThan(Math.min(...scenes.map((x) => at[x.id].y)));
  expect(Math.hypot(at.n5.x - at.s5.x, at.n5.y - at.s5.y)).toBeLessThan(400);
  expect(at.n5.y).toBeGreaterThan(at.s1.y);
});

test('a crowded first scene still keeps its world note close (The Matrix shape)', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  const note = (id: string, near: string) => ({ kind: 'sticky', id, fragment: { id, kind: 'story', factKind: 'world', text: 'To leave, a crew member has to reach a ringing phone. No phone, no exit.', template: true, near } });
  const scenes = Array.from({ length: 10 }, (_, i) => card(`s${i + 1}`, 'event'));
  const chars = [['neo', [2]], ['morpheus', [3]], ['trinity', [1]], ['smith', [1]], ['cypher', [4]]] as Array<[string, number[]]>;
  const notes = [note('phones', 's1'), note('agents', 's3'), note('sim', 's4'), note('war', 's5'), note('death', 's6'), note('zion', 's9')];
  const items = [...chars.map(([n]) => card(n, 'character')), ...notes, ...scenes];
  const involves = chars.flatMap(([n, ss]) => ss.map((k) => ({ from: `s${k}`, to: n })));
  const at = templateLayout(items, scenes.map((x) => x.id), involves, 1440);
  // Near = the gap between the two cards' edges, not their corners (a strip
  // is as wide as a scene, so corner distance overstates it).
  const { itemSize } = require('./sandboxBoard');
  const box = (k: string) => ({ ...at[k], ...itemSize(items.find((x: any) => x.id === k)) });
  const gap = (a: string, b: string) => { const p = box(a), q = box(b); return Math.hypot(Math.max(0, p.x - (q.x + q.w), q.x - (p.x + p.w)), Math.max(0, p.y - (q.y + q.h), q.y - (p.y + p.h))); };
  for (const [n, sc] of [['phones', 's1'], ['agents', 's3'], ['sim', 's4'], ['war', 's5'], ['death', 's6'], ['zion', 's9']]) expect(`${n}: ${gap(n, sc) < 120 ? 'near' : Math.round(gap(n, sc))}`).toBe(`${n}: near`);
});

test('the panel sits on the window edge under the toolbar, and hovering a template previews its shape', () => {
  const character = {
    id: 'character', label: 'Character-driven', film: 'Example Film', year: 1999, blurb: 'Invented.',
    counts: { scenes: 2, characters: 3, world: 1, stickies: 0, ties: 2 },
    preview: {
      characters: [{ key: 'a', name: 'Ada' }, { key: 'b', name: 'Bo' }, { key: 'c', name: 'Cy' }],
      ties: [{ from: 'a', to: 'b', predicate: 'owes_money_to' }, { from: 'a', to: 'c', predicate: 'teaches' }],
      scenes: [{ key: 's1', title: 'The loan', act: 1, color: '#7e22ce' }, { key: 's2', title: 'The debt', act: 2, color: '#b45309' }],
      world: [{ key: 'w', kind: 'place', text: 'A small town.' }],
    },
  };
  const onPreview = jest.fn();
  const { container } = render(<TemplatesPanel templates={[character]} dark={false} busyId={null} top={112} onPreview={onPreview} onUse={() => {}} onClose={() => {}} />);
  const panel = container.querySelector('[data-templates-panel]') as HTMLElement;
  expect(panel.style.position).toBe('fixed');
  expect(panel.style.left).toBe('0px');
  expect(panel.style.top).toBe('112px');
  expect(panel.style.bottom).toBe('0px');
  fireEvent.mouseEnter(container.querySelector('[data-template="character"]')!);
  expect(onPreview).toHaveBeenCalledWith('character');
  // The character-driven preview lights the web: every tie a label.
  const pv = render(<TemplatePreview template={character} dark={false} left={388} top={132} />);
  expect(pv.container.querySelector('[data-template-preview="character"]')!.textContent).toMatch(/owes money to.*teaches|teaches.*owes money to/);
  expect(pv.container.textContent).toMatch(/Ada/);
});

test('acts as beat tabs: the weave keeps scene spacing and nothing overlaps (2026-11-08)', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const { itemSize } = require('./sandboxBoard');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  const order = ['A1', 's1', 's2', 's3', 's4', 'A2', 's5', 's6', 's7', 's8', 'A3', 's9', 's10'];
  const line = order.map((id) => card(id, id.startsWith('A') ? 'sequence' : 'event'));
  const chars = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => card(id, 'character'));
  const involves = [{ from: 's1', to: 'c1' }, { from: 's1', to: 'c2' }, { from: 's2', to: 'c3' }, { from: 's3', to: 'c4' }, { from: 's5', to: 'c5' }];
  const items = [...chars, ...line];
  const at = templateLayout(items, order, involves, 1440);
  // Neighbouring scenes in a band sit a scene's width apart, not a tab's.
  expect(at.s2.x - at.s1.x).toBeGreaterThanOrEqual(300);
  // The opening tab hangs over the first scene; the next act's tab takes its
  // place in the line, opening the second row at the right, its first scene
  // beside it going back.
  expect(at.A1.y + 70).toBeLessThanOrEqual(at.s1.y);
  expect(Math.abs(at.A1.x - at.s1.x)).toBeLessThan(100);
  expect(Math.abs(at.A2.x - at.s4.x)).toBeLessThan(120);
  expect(at.A2.y).toBeGreaterThan(at.s4.y + 150);
  expect(at.s5.x).toBeLessThan(at.A2.x);
  const boxes = items.map((it: any) => ({ id: it.id, ...at[it.id], ...itemSize(it) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap ? `${a.id} overlaps ${b.id}` : 'ok').toBe('ok');
  }
});

test('world cards sit right by the scene that sets them up; the rest of the cast goes to a column (2026-11-08)', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const { itemSize } = require('./sandboxBoard');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  const world = (id: string, near: string) => ({ kind: 'world', id, entry: { id, kind: 'rule', title: id, text: 'A rule of this world that shapes it.', template: true, near }, attached: [], touchTitles: [] });
  const order = ['A1', 'opening', 'rabbit', 'office', 'pill', 'A2', 'awake', 'training', 'oracle', 'betrayal', 'A3', 'rescue', 'one'];
  const line = order.map((id) => card(id, id.startsWith('A') ? 'sequence' : 'event'));
  const chars = ['neo', 'morpheus', 'trinity', 'smith', 'cypher'].map((id) => card(id, 'character'));
  const ws = [world('matrix', 'pill'), world('war', 'awake'), world('agents', 'office'), world('death', 'training'), world('exits', 'opening'), world('zion', 'rescue')];
  const involves = [['opening', 'trinity'], ['opening', 'smith'], ['rabbit', 'neo'], ['rabbit', 'trinity'], ['office', 'neo'], ['office', 'smith'], ['office', 'morpheus'], ['pill', 'neo'], ['pill', 'cypher']].map(([from, to]) => ({ from, to }));
  const items = [...chars, ...ws, ...line];
  const at = templateLayout(items, order, involves, 1440);
  const box = (k: string) => ({ ...at[k], ...itemSize(items.find((x: any) => x.id === k)) });
  const gap = (a: string, b: string) => { const p = box(a), q = box(b); return Math.hypot(Math.max(0, p.x - (q.x + q.w), q.x - (p.x + p.w)), Math.max(0, p.y - (q.y + q.h), q.y - (p.y + p.h))); };
  for (const w of ws) expect(`${w.id}: ${gap(w.id, w.entry.near) < 60 ? 'by its scene' : Math.round(gap(w.id, w.entry.near))}`).toBe(`${w.id}: by its scene`);
  const b = items.map((it: any) => ({ id: it.id, ...box(it.id) }));
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const p = b[i], q = b[j];
    expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h ? `${p.id} overlaps ${q.id}` : 'ok').toBe('ok');
  }
});

test('what sits above the first row of scenes lines up along the top (2026-11-08)', () => {
  const { templateLayout } = require('./sandboxTemplates');
  const { itemSize } = require('./sandboxBoard');
  const card = (id: string, type: string) => ({ kind: 'card', id, entity: { id, type, template: '1', working_title: id, working_name: id }, attached: [] });
  const world = (id: string, near: string) => ({ kind: 'world', id, entry: { id, kind: 'rule', title: id, text: 'A rule of this world that shapes it.', template: true, near }, attached: [], touchTitles: [] });
  const order = ['A1', 'opening', 'rabbit', 'office', 'pill', 'A2', 'awake', 'training', 'oracle', 'betrayal'];
  const line = order.map((id) => card(id, id.startsWith('A') ? 'sequence' : 'event'));
  const chars = ['neo', 'morpheus', 'trinity', 'smith', 'cypher'].map((id) => card(id, 'character'));
  const ws = [world('matrix', 'pill'), world('agents', 'office'), world('exits', 'opening')];
  const involves = [['opening', 'trinity'], ['opening', 'smith'], ['rabbit', 'neo'], ['office', 'smith'], ['office', 'morpheus'], ['pill', 'cypher']].map(([from, to]) => ({ from, to }));
  const items = [...chars, ...ws, ...line];
  const at = templateLayout(items, order, involves, 1440);
  const rowTop = Math.min(at.opening.y, at.rabbit.y, at.office.y, at.pill.y);
  const over = items.filter((it: any) => !['opening', 'rabbit', 'office', 'pill'].includes(it.id) && at[it.id].y < rowTop).map((it: any) => it.id);
  expect(over.length).toBeGreaterThan(2);
  void itemSize;
  expect(over).toContain('A1');
  expect(new Set(over.map((id: string) => at[id].y)).size).toBe(1);
});
