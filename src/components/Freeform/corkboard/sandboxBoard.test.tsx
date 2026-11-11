// The sandbox board: items from a payload, default layout, the vocabulary
// budget. SANDBOX_DUMP_HTML=<dir> also writes light and dark renders.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SandboxBoard, defaultLayout, dumpNumbers, freeSpotIn, losesOnDemote, nudgeClear, sourceRanges, stageItemsFrom, worldColumns, wrapAround } from './sandboxBoard';
import { ThemeCtx } from './theme';
import { bareLine, quotedLine } from './dialogue';
import type { ProjectEntity, SandboxFragment } from '../../../lib/freeformApi';

// jsdom has no PointerEvent; the board's drag/click split reads clientX and
// button from it, so give the tests a MouseEvent-backed stand-in.
if (!(window as any).PointerEvent) {
  (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
}

const frag = (over: Partial<SandboxFragment> & { id: string; text: string }): SandboxFragment => ({
  kind: 'idea', author: 'extractor', source: over.text, label: '', about: '', open: true,
  dumpId: 'd1', attachedTo: null, clusterId: null, createdAt: '2026-10-01T00:00:00Z', ...over,
});

const entities: ProjectEntity[] = [
  { id: 'e1', type: 'event', working_title: 'Orrin stands at the last door, not wanting to open it', summary: 'The chalk marks behind him are gone. He stands at the last door with his hand on it.', state: 'parked', evidence_quote: 'Orrin standing at the last door not wanting to open it' } as ProjectEntity,
  { id: 'e2', type: 'event', working_title: 'He opens it and his daughter is asleep on the floor', summary: 'The door gives. His daughter is inside, sleeping on the floor in her coat.', state: 'parked' } as ProjectEntity,
  { id: 'c1', type: 'character', working_name: 'Orrin', description: 'A night watchman at a shuttered cannery, sixties. Walks the same loop every hour and marks each door with chalk.', state: 'parked' } as ProjectEntity,
  { id: 'c2', type: 'character', working_name: 'The daughter', description: 'Grown. Stopped calling.', state: 'parked' } as ProjectEntity,
  { id: 'l1', type: 'location', working_name: 'The cannery', description: 'Shuttered, winter, the coast.', state: 'parked' } as ProjectEntity,
  { id: 'placed', type: 'event', working_title: 'On the master, must not show' } as ProjectEntity,
];

const fragments: SandboxFragment[] = [
  frag({ id: 'f1', text: 'The chalk marks are wiped clean between rounds.', clusterId: 'h1' }),
  frag({ id: 'f2', text: 'Someone else is walking the loop behind him.', clusterId: 'h1', dumpId: 'd2', createdAt: '2026-10-02T00:00:00Z', source: 'Maybe someone is walking the loop behind him, wiping the marks.' }),
  frag({ id: 'f3', text: 'A quiet two-hander.', kind: 'story' }),
  frag({ id: 'f4', text: 'One night, winter, the coast.', kind: 'story' }),
  frag({ id: 'f5', text: 'He counts the stairs every climb.', attachedTo: 'c1' }),
  frag({ id: 'f6', text: 'Has not spoken aloud in a year.', kind: 'note', attachedTo: 'c1' }),
  frag({ id: 'f7', text: 'Resolved, must not show.', open: false }),
];
const precedes = [{ from: 'e1', to: 'e2' }, { from: 'placed', to: 'e1' }];

const FORBIDDEN = /\b(fragments?|huddles?|clusters?|parked|held|badge|extractor|graft)\b/i;

test('items: parked cards with their attached stickies, loose stickies, one group, one token per dump', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  // l1 (a location) is kept off the board.
  expect(items.map((i) => i.id).sort()).toEqual(['c1', 'c2', 'e1', 'e2', 'group:h1', 'f3', 'f4', 'dump:d1', 'dump:d2'].sort());
  const g = items.find((i) => i.kind === 'group');
  expect(g && g.kind === 'group' ? g.members.map((m) => m.id) : []).toEqual(['f1', 'f2']);
  const c1 = items.find((i) => i.id === 'c1');
  expect(c1 && c1.kind === 'card' ? c1.attached.map((f) => f.id) : []).toEqual(['f5', 'f6']);
  // Order only between parked scenes: e2 is after e1; e1's master predecessor is ignored.
  const e2 = items.find((i) => i.id === 'e2');
  expect(e2 && e2.kind === 'card' ? e2.after : null).toMatch(/^Orrin stands/);
  const e1 = items.find((i) => i.id === 'e1');
  expect(e1 && e1.kind === 'card' ? e1.after : 'x').toBeUndefined();
  // Dump numbers by first appearance; the token counts what the dump left loose.
  expect([...dumpNumbers(fragments).entries()]).toEqual([['d1', 1], ['d2', 2]]);
  const t1 = items.find((i) => i.id === 'dump:d1');
  expect(t1 && t1.kind === 'token' ? t1.looseIds.sort() : []).toEqual(['f1']); // story stickies are not homeless
});

test('default layout gives every item a position and keeps saved ones', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, { c1: { x: 500, y: 500 } }, { w: 1400 });
  for (const it of items) expect(pos[it.id]).toBeDefined();
  expect(pos.c1).toEqual({ x: 500, y: 500 });
  // Story stickies on top, cards under them, loose material to the right.
  expect(pos.f3.y).toBeLessThan(pos.e1.y);
  expect(pos['group:h1'].x).toBeGreaterThan(pos.e1.x);
  // Scenes read in story order on one line; characters start a new row.
  expect(pos.e2.x).toBeGreaterThan(pos.e1.x);
  expect(pos.e2.y).toBe(pos.e1.y);
  expect(pos.c2.y).toBeGreaterThan(pos.e1.y);
  // Saving one card's spot moves nothing else.
  const before = defaultLayout(items, {}, { w: 1400 });
  const after = defaultLayout(items, { e1: { x: 900, y: 900 } }, { w: 1400 });
  for (const it of items) if (it.id !== 'e1' && it.kind !== 'token') expect(after[it.id]).toEqual(before[it.id]);
});

test('the vocabulary budget holds on the board', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [{ clusterId: 'h1', kind: 'scene', title: 'The loop', summary: '', touches: [] }], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} />);
  expect(container.textContent).not.toMatch(FORBIDDEN);
  expect(container.textContent).not.toMatch(/must not show/);
  for (const el of Array.from(container.querySelectorAll('[title]'))) expect(el.getAttribute('title')).not.toMatch(FORBIDDEN);
});

test('writes light and dark renders when asked', () => {
  const dir = process.env.SANDBOX_DUMP_HTML;
  if (!dir) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  const items = stageItemsFrom({ entities, fragments, badges: [{ clusterId: 'h1', kind: 'scene', title: 'The loop', summary: '', touches: [] }], precedes });
  const pos = defaultLayout(items, {}, { w: 1300 });
  for (const mode of ['light', 'dark'] as const) {
    const { container, unmount } = render(
      <ThemeCtx.Provider value={mode}>
        <SandboxBoard items={items} positions={pos} onMove={() => {}} spot="e2" />
      </ThemeCtx.Provider>,
    );
    const bg = mode === 'dark' ? '#0a0a0b' : '#fffefb';
    fs.writeFileSync(`${dir}/board-${mode}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>board ${mode}</title></head><body style="margin:0;background:${bg};font-family:system-ui,sans-serif">${container.innerHTML}</body></html>`);
    unmount();
    // The same board with e1 in focus: the Cast slide up, Orrin sharp.
    const edges = { involves: [{ from: 'e1', to: 'c1' }], occurs_in: [{ from: 'e1', to: 'l1' }], precedes, structural: [] } as any;
    const { container: focusEl, unmount: unmountFocus } = render(
      <ThemeCtx.Provider value={mode}>
        <SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={() => {}} onOpenCard={() => {}} allEntities={entities} edges={edges} />
      </ThemeCtx.Provider>,
    );
    fireEvent.click(focusEl.querySelector('[data-focus-chips] [data-focus-slide="cast"]')!);
    fs.writeFileSync(`${dir}/board-focus-${mode}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>board focus ${mode}</title></head><body style="margin:0;background:${bg};font-family:system-ui,sans-serif">${focusEl.innerHTML}</body></html>`);
    unmountFocus();
  }
});


function click(el: Element) {
  fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 11, clientY: 10, pointerId: 1 });
}

test('a click opens a card (the full sheet when the board has no focus); a drag does not', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onOpenCard = jest.fn();
  const onMove = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={onMove} onOpenCard={onOpenCard} />);
  const card = container.querySelector('[data-stage-item="c1"]')!;
  click(card);
  expect(onOpenCard).toHaveBeenCalledWith('c1');
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(card, { clientX: 60, clientY: 40, pointerId: 1 });
  fireEvent.pointerUp(card, { clientX: 60, clientY: 40, pointerId: 1 });
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onOpenCard).toHaveBeenCalledTimes(1);
});

test('the focus: a click asks for it; the card holds its own words, the chips float above, what touches it hangs around it; the rest softens', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onFocus = jest.fn();
  const onOpenCard = jest.fn();
  const edges = { involves: [{ from: 'e1', to: 'c1' }, { from: 'placed', to: 'c1' }], occurs_in: [{ from: 'e1', to: 'l1' }], precedes, structural: [] } as any;
  const { container, rerender } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} />);
  click(container.querySelector('[data-stage-item="e1"]')!);
  expect(onFocus).toHaveBeenCalledWith('e1');
  expect(onOpenCard).not.toHaveBeenCalled();
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} />);
  const fc = container.querySelector('[data-focus-card]')!;
  expect(fc).toBeTruthy();
  // The whole summary, not the three-line clamp; the draft is the rightmost orbit chip, not on the card.
  expect(fc.textContent).toMatch(/with his hand on it/);
  expect(fc.textContent).not.toMatch(/drafted/i);
  const chipRow = container.querySelector('[data-focus-chips]')!;
  expect(chipRow.lastElementChild!.getAttribute('data-focus-draft')).not.toBeNull();
  expect(chipRow.lastElementChild!.textContent).toMatch(/^Draft/);
  // The telling edits in place: click it, type, save reaches the page with the card id.
  const onEditDescription = jest.fn();
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} onEditDescription={onEditDescription} />);
  // The title too; and a connected card drags around the focus (kept per focal, never the board position).
  const onEditTitle = jest.fn();
  const onMoveInFocus = jest.fn();
  const onMoveBoard = jest.fn();
  rerender(<SandboxBoard items={items} positions={pos} onMove={onMoveBoard} focusId="e1" onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} onEditDescription={onEditDescription} onEditTitle={onEditTitle} onMoveInFocus={onMoveInFocus} />);
  const titleEl = container.querySelector('[data-inline-text="focus-title"]') as HTMLElement;
  expect(titleEl.textContent).toMatch(/^Orrin stands/);
  titleEl.textContent = 'The last door';
  fireEvent.blur(titleEl);
  expect(onEditTitle).toHaveBeenCalledWith('e1', 'The last door');
  const c1El = container.querySelector('[data-stage-item="c1"]')!;
  fireEvent.pointerDown(c1El, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(c1El, { clientX: 90, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(c1El, { clientX: 90, clientY: 60, pointerId: 1 });
  expect(onMoveInFocus).toHaveBeenCalledTimes(1);
  expect(onMoveInFocus.mock.calls[0][0]).toBe('e1');
  expect(onMoveInFocus.mock.calls[0][1]).toBe('c1');
  expect(onMoveBoard).not.toHaveBeenCalled();
  const bodyEl = container.querySelector('[data-inline-text="focus-body"]') as HTMLElement;
  expect(bodyEl.textContent).toMatch(/with his hand on it/);
  // Paper: bold, italic and underline edited as drawn (2026-11-01).
  expect(bodyEl.getAttribute('contenteditable')).toBe('true');
  bodyEl.textContent = 'He stands at the last door and cannot open it.';
  fireEvent.blur(bodyEl);
  expect(onEditDescription).toHaveBeenCalledWith('e1', 'He stands at the last door and cannot open it.');
  // Chips float above the card, outside it: stickies first, then cast, where (no order pill).
  expect(fc.querySelector('[data-focus-slide]')).toBeNull();
  const chips = Array.from(container.querySelectorAll('[data-focus-chips] [data-focus-slide]')).map((b) => b.getAttribute('data-focus-slide'));
  expect(chips).toEqual(['stickies', 'peer', 'cast', 'where', 'subplots']);
  // No stickies on e1, so it opens on Cast: Orrin's own card moves in (no ghost for him), the rest softens.
  expect(container.querySelector('[data-focus-ghost="c1"]')).toBeNull();
  expect(container.querySelector('[data-stage-item="c1"]')!.getAttribute('data-soft')).toBeNull();
  expect(container.querySelector('[data-stage-item="c2"]')!.getAttribute('data-soft')).toBe('1');
  // Where: the location is off the board, so it hangs as a ghost card that opens its sheet.
  fireEvent.click(container.querySelector('[data-focus-slide="where"]')!);
  fireEvent.click(container.querySelector('[data-focus-ghost="l1"]')!);
  expect(onOpenCard).toHaveBeenCalledWith('l1');
  // Writing: the card goes page-wide with the editor as its body; stickies, cast and where all hang around it.
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" writingId="e1" editor={<div data-testid="pages">PAGES</div>} onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} />);
  const wc = container.querySelector('[data-focus-card][data-writing="1"]')!;
  expect(wc).toBeTruthy();
  expect(wc.querySelector('[data-focus-editor] [data-testid="pages"]')).toBeTruthy();
  // The margins are toggles in the draft's header (no pills over the margin):
  // stickies and cast shown, locations hidden, each switched on its own.
  expect(container.querySelector('[data-focus-chips]')).toBeNull();
  expect(Array.from(wc.querySelectorAll('[data-margin-toggle]')).map((b) => [b.getAttribute('data-margin-toggle'), b.getAttribute('aria-pressed')])).toEqual([['stickies', 'true'], ['cast', 'true'], ['where', 'false']]);
  expect(container.querySelector('[data-stage-item="c1"]')!.getAttribute('data-soft')).toBeNull();
  expect(container.querySelector('[data-focus-ghost="l1"]')).toBeNull();
  fireEvent.click(wc.querySelector('[data-margin-toggle="where"]')!);
  expect(container.querySelector('[data-focus-ghost="l1"]')).toBeTruthy();
  expect(container.querySelector('[data-stage-item="c1"]')!.getAttribute('data-soft')).toBeNull();
  fireEvent.click(wc.querySelector('[data-margin-toggle="cast"]')!);
  expect(container.querySelector('[data-stage-item="c1"]')!.getAttribute('data-soft')).toBe('1');
  localStorage.removeItem('ff-draft-margins'); // the toggles remember; later tests start fresh
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} />);
  // Escape closes.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onFocus).toHaveBeenLastCalledWith(null);
  // A character's focus: its stickies hang around it as paper; chips are stickies,
  // relationships (always there since 2026-10-15) and scenes.
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={onFocus} onOpenCard={onOpenCard} allEntities={entities} edges={edges} />);
  expect(container.querySelectorAll('[data-focus-sticky]')).toHaveLength(2);
  expect(container.querySelector('[data-focus-card] [data-focus-sticky]')).toBeNull();
  expect(Array.from(container.querySelectorAll('[data-focus-chips] [data-focus-slide]')).map((b) => b.getAttribute('data-focus-slide'))).toEqual(['stickies', 'peer', 'relationships', 'scenes']);
  fireEvent.click(container.querySelector('[data-focus-slide="scenes"]')!);
  // The master's scene is a ghost; the parked one is the board's own card.
  expect(container.querySelector('[data-focus-ghost="placed"]')!.textContent).toMatch(/on the master/);
  expect(container.querySelector('[data-focus-ghost="e1"]')).toBeNull();
  // The cascade (2026-10-13): the board's scene first, the master's after, in
  // alternating lanes stepping down under the card, one solid thread, and the
  // rest of the board filtered all but out.
  const xy = (el: Element) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform)!; return { x: +m[1], y: +m[2] }; };
  const first = xy(container.querySelector('[data-stage-item="e1"]')!);
  const second = xy(container.querySelector('[data-focus-ghost="placed"]')!.closest('[data-focus-satellite]')!);
  expect(second.y).toBeGreaterThan(first.y);
  expect(second.x).toBeGreaterThan(first.x);
  const threads = Array.from(container.querySelectorAll('svg path')).filter((p) => p.getAttribute('stroke-width') === '2.5');
  expect(threads.length).toBe(2);
  expect(threads.every((p) => !p.getAttribute('stroke-dasharray'))).toBe(true);
  expect((container.querySelector('[data-stage-item="c2"]') as HTMLElement).style.opacity).toBe('0.06');
  fireEvent.click(container.querySelector('[data-focus-ghost="placed"]')!);
  expect(onOpenCard).toHaveBeenCalledWith('placed');
  expect(container.textContent).not.toMatch(FORBIDDEN);
});

test('a click on a sticky edits it in place; Save and Delete reach the page', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onStickyEdit = jest.fn();
  const onStickyDelete = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onStickyEdit={onStickyEdit} onStickyDelete={onStickyDelete} />);
  // A member of the huddle, by its own sticky element.
  click(container.querySelector('[data-sticky-id="f2"]')!);
  // Linear-style: the words are the editor. Type into them, leave, saved.
  const tx = container.querySelector('[data-inline-text="sticky-text"]') as HTMLElement;
  expect(tx.textContent).toBe('Someone else is walking the loop behind him.');
  tx.textContent = 'Someone else walks the loop behind him.';
  // A regular sticky has no note field (only a line does); leaving the words
  // for the editor's own buttons keeps it open.
  expect(container.querySelector('[data-inline-text="sticky-label"]')).toBeNull();
  fireEvent.blur(tx, { relatedTarget: container.querySelector('[data-sticky-live]') });
  const dir = process.env.SANDBOX_DUMP_HTML;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').writeFileSync(`${dir}/board-edit.html`, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fffefb;font-family:system-ui,sans-serif">${container.innerHTML}</body></html>`);
  }
  expect(onStickyEdit).toHaveBeenNthCalledWith(1, 'f2', { text: 'Someone else walks the loop behind him.' });
  // The live face stays until the writer leaves it (no Done button since
  // 2026-10-31; Esc or a click away closes it).
  expect(container.querySelector('[data-inline-text="sticky-text"]')).not.toBeNull();
  expect(screen.queryByText('done')).toBeNull();
  fireEvent.blur(container.querySelector('[data-inline-text="sticky-text"]')!, { relatedTarget: null });
  expect(container.querySelector('[data-inline-text="sticky-text"]')).toBeNull();
  click(container.querySelector('[data-sticky-id="f3"]')!);
  // The trash can: the first click arms it, the second deletes.
  fireEvent.click(container.querySelector('[data-sticky-live] [data-delete-card]')!);
  expect(onStickyDelete).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector('[data-sticky-live] [data-delete-confirm]')!);
  expect(onStickyDelete).toHaveBeenCalledWith('f3');
  // Leaving the editor for somewhere outside it closes it.
  click(container.querySelector('[data-sticky-id="f2"]')!);
  fireEvent.blur(container.querySelector('[data-inline-text="sticky-text"]')!, { relatedTarget: null });
  expect(container.querySelector('[data-sticky-live]')).toBeNull();
});


test('a collapsed card is title and summary only: no draft, place, sticky or dump controls', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onDumpInto={() => {}} onPlaceCard={() => {}} onDemoteCard={() => {}} onWriteCard={() => {}} />);
  const card = container.querySelector('[data-stage-item="e1"]')!;
  expect(card.textContent).not.toMatch(/not drafted|dump here|place|sticky/i);
  expect(card.querySelector('[data-dump-into]')).toBeNull();
});

test('scenes: the scene cards alone in a grid in story order; a drop re-chains only the moved card', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onReorderScene = jest.fn();
  const onGridOrder = jest.fn();
  const onMove = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={onMove} scenesMode precedes={precedes} onReorderScene={onReorderScene} onGridOrder={onGridOrder} />);
  const tf = (id: string) => (container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform;
  // e1 then e2 (e1 precedes e2) on one row; the character cards are off stage.
  const x = (t: string) => Number(/translate\((-?[\d.]+)px/.exec(t)![1]);
  expect(x(tf('e2'))).toBeGreaterThan(x(tf('e1')));
  expect((container.querySelector('[data-stage-item="c1"]') as HTMLElement).style.opacity).toBe('0');
  // Drag e2 to the left of e1: it is chained before e1 (old prev e1, new next e1); nothing is saved as a board position.
  const e2 = container.querySelector('[data-stage-item="e2"]')!;
  fireEvent.pointerDown(e2, { button: 0, clientX: 400, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(e2, { clientX: 40, clientY: 50, pointerId: 1 });
  // While in the hand: the hole shows at the first slot and e1 has made room (moved one slot on).
  expect(container.querySelector('[data-grid-hole]')).toBeTruthy();
  expect(x(tf('e1'))).toBeGreaterThan(24);
  fireEvent.pointerUp(e2, { clientX: 40, clientY: 50, pointerId: 1 });
  expect(container.querySelector('[data-grid-hole]')).toBeNull();
  // e2 leaves e1's tail and goes in front of it: the one link flips.
  expect(onGridOrder).toHaveBeenCalledWith(['e2', 'e1']);
  expect(onReorderScene).toHaveBeenCalledWith('e2', { remove: [{ from: 'e1', to: 'e2' }], add: [{ from: 'e2', to: 'e1' }] });
  expect(onMove).not.toHaveBeenCalled();
});

test('scenes: linking two loose cards moves only the follower; the rest of the grid stays put', () => {
  const four: ProjectEntity[] = ['s1', 's2', 's3', 's4'].map((id) => ({ id, type: 'event', working_title: id, state: 'parked' } as ProjectEntity));
  const items = stageItemsFrom({ entities: four, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container, rerender } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} scenesMode precedes={[]} />);
  const tf = (id: string) => (container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform;
  const before = Object.fromEntries(['s1', 's2', 's3', 's4'].map((id) => [id, tf(id)]));
  // s4 is dropped between s1 and s2 (a link s1 -> s4 is written): s4 moves behind s1, s2 and s3 shift one slot right; s1 does not move.
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} scenesMode precedes={[{ from: 's1', to: 's4' }]} />);
  expect(tf('s1')).toBe(before.s1);
  expect(tf('s4')).toBe(before.s2);
  expect(tf('s2')).toBe(before.s3);
  // Linking s3 behind s2 later moves nothing (it already follows s2).
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} scenesMode precedes={[{ from: 's1', to: 's4' }, { from: 's2', to: 's3' }]} />);
  expect(tf('s1')).toBe(before.s1);
  expect(tf('s4')).toBe(before.s2);
  expect(tf('s2')).toBe(before.s3);
  expect(tf('s3')).toBe(before.s4);
});

test('scenes: a drop links the card with its neighbours on the wall, in wall order; untouched cards stay unlinked', () => {
  const four: ProjectEntity[] = ['s1', 's2', 's3', 's4'].map((id) => ({ id, type: 'event', working_title: id, state: 'parked' } as ProjectEntity));
  const items = stageItemsFrom({ entities: four, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onReorderScene = jest.fn();
  const onGridOrder = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} scenesMode precedes={[]} onReorderScene={onReorderScene} onGridOrder={onGridOrder} />);
  // Carry s4 (slot 3) to slot 1, between s1 and s2.
  const s4 = container.querySelector('[data-stage-item="s4"]')!;
  // jsdom's stage is 1200 wide: three columns of 300 + 24, rows of 140 + 28.
  const slot = (i: number) => ({ x: 24 + (i % 3) * 324 + 150, y: 24 + Math.floor(i / 3) * 168 + 70 });
  fireEvent.pointerDown(s4, { button: 0, clientX: slot(3).x, clientY: slot(3).y, pointerId: 1 });
  fireEvent.pointerMove(s4, { clientX: slot(1).x, clientY: slot(1).y, pointerId: 1 });
  fireEvent.pointerUp(s4, { clientX: slot(1).x, clientY: slot(1).y, pointerId: 1 });
  expect(onGridOrder).toHaveBeenCalledWith(['s1', 's4', 's2']);
  expect(onReorderScene).toHaveBeenCalledWith('s4', { remove: [], add: [{ from: 's1', to: 's4' }, { from: 's4', to: 's2' }] });
  // With that order saved, the run shows its numbers on the wall: s1 1, s4 2, s2 3; s3 none.
  const { container: c2 } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} scenesMode precedes={[{ from: 's1', to: 's4' }, { from: 's4', to: 's2' }]} gridOrder={['s1', 's4', 's2']} />);
  const no = (id: string) => c2.querySelector(`[data-stage-item="${id}"] [data-order-no]`)?.textContent ?? null;
  expect([no('s1'), no('s4'), no('s2'), no('s3')]).toEqual(['1', '2', '3', null]);
});



test('the group pill opens the menu; the pick and Not yet reach the page', () => {
  const badges = [{ clusterId: 'h1', kind: 'scene', title: 'The loop', summary: 'The chalk marks are wiped clean; someone walks the loop behind him.', touches: ['Orrin'] }];
  const items = stageItemsFrom({ entities, fragments, badges, precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onMakeCard = jest.fn();
  const onNotYet = jest.fn();
  const onOpenCard = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onMakeCard={onMakeCard} onNotYet={onNotYet} onOpenCard={onOpenCard} />);
  const pill = () => container.querySelector('[data-stage-item="group:h1"] [data-group-pill]')!;
  fireEvent.click(pill());
  // One green button confirms the suggestion.
  expect(document.querySelector('[data-group-confirm]')!.textContent).toMatch(/^Make it a scene.*the stickies go on it\./);
  expect(document.querySelector('[data-sticky-menu-item="not-yet"]')!.textContent).toMatch(/Not yet.*loose group/);
  fireEvent.click(document.querySelector('[data-group-confirm]')!);
  expect(onMakeCard).toHaveBeenCalledWith('h1', 'scene');
  // Another kind is one quiet step away.
  fireEvent.click(pill());
  expect(document.querySelector('[data-sticky-menu-item="make-character"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-group-other]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-item="make-character"]')!);
  expect(onMakeCard).toHaveBeenCalledWith('h1', 'character');
  fireEvent.click(pill());
  fireEvent.click(document.querySelector('[data-sticky-menu-item="not-yet"]')!);
  expect(onNotYet).toHaveBeenCalledWith('h1');
  expect(onOpenCard).not.toHaveBeenCalled();
});



// MANUAL CARDS AND STICKIES (2026-10-09): a draft is live where it stands;
// its words make it, an empty one or Esc drops it and nothing is written.
test('a card made with + New opens expanded, the caret in its name; Enter goes on to its telling; unnamed it reads Untitled', () => {
  const fresh = { id: 'n1', type: 'event', working_title: '', working_name: '', summary: '', state: 'parked' } as unknown as ProjectEntity;
  const all = [...entities, fresh];
  const items = stageItemsFrom({ entities: all, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container, rerender } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="n1" freshCardId="n1" onFocus={() => {}} allEntities={all} edges={{}} onEditTitle={() => {}} onEditDescription={() => {}} />);
  const title = container.querySelector('[data-focus-card] [data-inline-text="focus-title"]') as HTMLElement;
  expect(title.getAttribute('data-placeholder')).toBe('Name this scene');
  expect(document.activeElement).toBe(title);
  title.textContent = 'The keeper climbs to the lamp';
  fireEvent.keyDown(title, { key: 'Enter' });
  expect(document.activeElement).toBe(container.querySelector('[data-focus-card] [data-inline-text="focus-body"]'));
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={all} edges={{}} />);
  expect(container.querySelector('[data-stage-item="n1"]')!.textContent).toContain('Unnamed');
});

test('a scene deletes from its expanded view after one more click; the cast pick adds a character', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onDelete = jest.fn(); const onAddCast = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e2" onFocus={() => {}} allEntities={entities} edges={{ involves: [{ from: 'e2', to: 'c1' }] } as any} onDeleteCard={onDelete} onAddCast={onAddCast} />);
  fireEvent.click(container.querySelector('[data-focus-card] [data-delete-card]')!);
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector('[data-focus-card] [data-delete-confirm]')!);
  expect(onDelete).toHaveBeenCalledWith('e2');
  // e2 has no location tagged; Where still shows (Ben, 2026-10-13).
  expect(Array.from(container.querySelectorAll('[data-focus-chips] [data-focus-slide]')).map((b) => b.getAttribute('data-focus-slide'))).toContain('where');
  // The "+" joined to the Cast pill opens a menu of who is not in it yet.
  fireEvent.click(container.querySelector('[data-focus-chips] [data-add-cast]')!);
  const menu = document.querySelector('[data-add-cast-menu]')!;
  expect([...menu.querySelectorAll('[data-add-cast-option]')].map((o) => o.getAttribute('data-add-cast-option'))).toEqual(['c2']);
  fireEvent.click(menu.querySelector('[data-add-cast-option="c2"]')!);
  expect(onAddCast).toHaveBeenCalledWith('e2', 'c2');
  expect(document.querySelector('[data-add-cast-menu]')).toBeNull();
});

test('on the draft screen a sticky moves and keeps where it was put', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onMoveInFocus = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" writingId="c1" editor={<div data-testid="pages">PAGES</div>} onFocus={() => {}} allEntities={entities} edges={{}} onMoveInFocus={onMoveInFocus} />);
  const sat = container.querySelector('[data-focus-satellite]') as HTMLElement;
  expect(sat).toBeTruthy();
  fireEvent.pointerDown(sat, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(sat, { clientX: 160, clientY: 140, pointerId: 1 });
  fireEvent.pointerUp(sat, { clientX: 160, clientY: 140, pointerId: 1 });
  expect(onMoveInFocus).toHaveBeenCalledTimes(1);
  expect(onMoveInFocus.mock.calls[0][0]).toBe('c1');
});

test('a character deletes from its expanded view too', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onDelete = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={() => {}} allEntities={entities} edges={{}} onDeleteCard={onDelete} />);
  fireEvent.click(container.querySelector('[data-focus-card] [data-delete-card]')!);
  fireEvent.click(container.querySelector('[data-focus-card] [data-delete-confirm]')!);
  expect(onDelete).toHaveBeenCalledWith('c1');
});

test('a draft sticky saves its words; a double-click on empty board asks for one there', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onCommit = jest.fn(); const onRequest = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} draft={{ kind: 'sticky', pos: { x: 40, y: 40 } }} onDraftCommit={onCommit} onDraftCancel={() => {}} onRequestSticky={onRequest} />);
  const text = container.querySelector('[data-draft-sticky] [data-inline-text="draft-sticky-text"]') as HTMLElement;
  text.textContent = 'The radio only works in the rain.';
  fireEvent.keyDown(text, { key: 'Enter' });
  fireEvent.blur(text);
  expect(onCommit).toHaveBeenCalledWith('The radio only works in the rain.');
  const stage = container.querySelector('[data-sandbox-stage]') as HTMLElement;
  fireEvent.doubleClick(stage, { clientX: 300, clientY: 200 });
  expect(onRequest).toHaveBeenCalledTimes(1);
  // On a card, a double-click is not a request for a sticky.
  fireEvent.doubleClick(container.querySelector('[data-stage-item="e1"]')!, { clientX: 50, clientY: 50 });
  expect(onRequest).toHaveBeenCalledTimes(1);
});

test('+ sticky on the focused card hangs a live sticky beside it; its words go onto that card', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onAdd = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={() => {}} allEntities={entities} edges={{}} onAddSticky={onAdd} onDemoteCard={() => {}} />);
  const add = container.querySelector('[data-focus-card] [data-add-sticky]') as HTMLElement;
  expect(add).toBeTruthy();
  fireEvent.click(add);
  const live = container.querySelector('[data-focus-sticky="draft-sticky"] [data-inline-text]') as HTMLElement;
  expect(live).toBeTruthy();
  expect(live.getAttribute('data-placeholder')).toBe('Write the sticky');
  live.textContent = 'Never says his brother\'s name.';
  fireEvent.blur(live);
  expect(onAdd).toHaveBeenCalledWith('c1', 'Never says his brother\'s name.');
  expect(container.querySelector('[data-focus-sticky="draft-sticky"]')).toBeNull();
});

// THE DUMP, READ BACK (2026-10-11): a token opens its dump in the writer's
// words; the sentences that became stickies are marked; those stickies light.
test('sourceRanges: each source found once, in order, overlaps merged, case forgiven', () => {
  const prose = 'He walks the loop. Maybe someone is walking the loop behind him, wiping the marks. The chalk is fresh.';
  const r = sourceRanges(prose, ['the chalk is fresh.', 'Maybe someone is walking the loop behind him, wiping the marks.', 'walking the loop behind him', 'tiny']);
  expect(r.map(([a, b]) => prose.slice(a, b))).toEqual(['Maybe someone is walking the loop behind him, wiping the marks.', 'The chalk is fresh.']);
});

test('a click on a dump token reads the dump back; its stickies light; Esc closes it', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const dumps = { d2: { prose: 'He walks the loop every hour. Maybe someone is walking the loop behind him, wiping the marks.', createdAt: '2026-10-02T00:00:00Z' } };
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} dumps={dumps} />);
  click(container.querySelector('[data-stage-item="dump:d2"]')!);
  const slip = container.querySelector('[data-dump-slip="2"]') as HTMLElement;
  expect(slip).toBeTruthy();
  expect(slip.querySelector('[data-dump-prose]')!.textContent).toBe(dumps.d2.prose);
  expect([...slip.querySelectorAll('[data-dump-source]')].map((m) => m.textContent)).toEqual(['Maybe someone is walking the loop behind him, wiping the marks.']);
  // f2 (dump 2) sits in the huddle: the huddle lights, the cards do not.
  expect(container.querySelector('[data-stage-item="group:h1"]')!.className).toContain('ff-lit');
  expect(container.querySelector('[data-stage-item="e1"]')!.className).not.toContain('ff-lit');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(container.querySelector('[data-dump-slip]')).toBeNull();
  // A second click on the token closes it as well.
  click(container.querySelector('[data-stage-item="dump:d1"]')!);
  expect(container.querySelector('[data-dump-slip="1"]')).toBeTruthy();
  click(container.querySelector('[data-stage-item="dump:d1"]')!);
  expect(container.querySelector('[data-dump-slip]')).toBeNull();
});

// DIALOGUE (2026-10-11): a line is a special sticky: the speaker over the
// words in the script face, on its scene and on the character who says it.
test('a line shows who says it; an opened character carries the lines they say', () => {
  const line = frag({ id: 'l1', kind: 'dialogue', text: 'Go home. I will finish the round.', attachedTo: 'e1', speaker: 'c1' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, line], badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const { container, rerender } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={() => {}} allEntities={entities} edges={{}} />);
  // On its scene: the stickies slide (first when the card has stickies) hangs it with the cue.
  const onScene = container.querySelector('[data-focus-sticky="l1"]') as HTMLElement;
  expect(onScene).toBeTruthy();
  expect(onScene.querySelector('[data-dialogue-cue]')!.textContent).toBe('Orrin');
  expect(onScene.querySelector('[data-dialogue-face]')!.textContent).toContain('\u201cGo home. I will finish the round.\u201d');
  // On the speaker: the same line hangs beside Orrin with his own stickies.
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={() => {}} allEntities={entities} edges={{}} />);
  expect(container.querySelector('[data-focus-sticky="l1"]')).toBeTruthy();
  expect(container.querySelector('[data-focus-sticky="f5"]')).toBeTruthy();
});

test('+ line on a scene: pick who says it, write it, Enter makes it', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onAddLine = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={() => {}} allEntities={entities} edges={{}} onAddLine={onAddLine} />);
  fireEvent.click(container.querySelector('[data-focus-card] [data-add-line]')!);
  const draft = container.querySelector('[data-draft-line="sat-line"]') as HTMLElement;
  expect(draft).toBeTruthy();
  // The picker: a cue-styled button, a menu of the story's characters.
  fireEvent.click(draft.querySelector('[data-speaker-pick]')!);
  const menu = document.querySelector('[data-speaker-menu]') as HTMLElement;
  expect([...menu.querySelectorAll('[data-speaker-option]')].map((o) => o.textContent)).toEqual(['No one yet', 'Orrin', 'The daughter']);
  fireEvent.click(menu.querySelector('[data-speaker-option="c2"]')!);
  expect(document.querySelector('[data-speaker-menu]')).toBeNull();
  expect(draft.querySelector('[data-speaker-pick]')!.textContent).toContain('The daughter');
  const text = draft.querySelector('[data-line-text]') as HTMLElement;
  text.textContent = 'You came back.';
  fireEvent.keyDown(text, { key: 'Enter' });
  expect(onAddLine).toHaveBeenCalledWith('e1', 'You came back.', 'c2');
});

test('a draft line stays open while the hand moves between its words and its speaker', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onCommit = jest.fn(); const onCancel = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} draft={{ kind: 'dialogue', pos: { x: 40, y: 40 } }} onDraftCommit={onCommit} onDraftCancel={onCancel} />);
  const draft = container.querySelector('[data-draft-line]') as HTMLElement;
  const text = draft.querySelector('[data-line-text]') as HTMLElement;
  const pick = draft.querySelector('[data-speaker-pick]') as HTMLElement;
  text.textContent = 'Not tonight.';
  fireEvent.blur(text, { relatedTarget: pick });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.click(pick);
  const menu = document.querySelector('[data-speaker-menu]') as HTMLElement;
  // Focus going into the menu (it lives outside the draft) does not end the draft.
  fireEvent.blur(pick, { relatedTarget: menu });
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.click(menu.querySelector('[data-speaker-option="c1"]')!);
  fireEvent.blur(pick, { relatedTarget: document.body });
  expect(onCommit).toHaveBeenCalledWith('Not tonight.', 'c1');
  expect(onCancel).not.toHaveBeenCalled();
});

test('freeSpotIn: a new card takes open space in view, nearest the middle; only a full view sends it right', () => {
  const view = { x: 0, y: 0, w: 1200, h: 600 };
  const size = { w: 300, h: 140 };
  const hit = (p: { x: number; y: number }, t: { x: number; y: number; w: number; h: number }) => p.x < t.x + t.w + 16 && p.x + size.w + 16 > t.x && p.y < t.y + t.h + 16 && p.y + size.h + 16 > t.y;
  // An empty view: the middle.
  const m = freeSpotIn(view, size, []);
  expect(Math.hypot(m.x - 450, m.y - 230)).toBeLessThan(16);
  // A card on the middle: the nearest open spot, still in view, not far right.
  const mid = { x: 440, y: 220, w: 300, h: 140 };
  const p = freeSpotIn(view, size, [mid]);
  expect(hit(p, mid)).toBe(false);
  expect(p.x + size.w).toBeLessThanOrEqual(1200);
  expect(p.y + size.h).toBeLessThanOrEqual(600);
  // Open space that is off the card-sized steps (a gap at the left) is found.
  const wall = [{ x: 330, y: 0, w: 900, h: 600 }];
  const q = freeSpotIn(view, size, wall);
  expect(q.x).toBeLessThan(330 - 300);
  // A full view: just past the right edge of what is there.
  const full = [{ x: 0, y: 0, w: 1200, h: 600 }];
  const r = freeSpotIn(view, size, full);
  expect(r.x).toBe(1216);
});

test('wrapAround: stickies hug the expanded card, right side first, then round the bottom; no overlaps', () => {
  const card = { x: 400, y: 300, w: 740, h: 330 };
  const sizes = [104, 120, 96, 140, 104, 110, 98, 130].map((h) => ({ w: 160, h }));
  const at = wrapAround(card, sizes, { gap: 14, top: 50 });
  const boxes = at.map((p, i) => ({ ...p, w: sizes[i].w, h: sizes[i].h }));
  const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // First on the right side, level with the card's top.
  expect(at[0]).toEqual({ x: card.x + card.w + 14, y: card.y });
  for (const b of boxes) {
    expect(meets(b, card)).toBe(false);
    // Near: within one sticky width of the card on every side.
    expect(b.x).toBeGreaterThanOrEqual(card.x - 14 - 160 - 1);
    expect(b.x + b.w).toBeLessThanOrEqual(card.x + card.w + 14 + 160 + 1);
    expect(b.y + b.h).toBeLessThanOrEqual(card.y + card.h + 14 + 140 + 1);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(meets(boxes[i], boxes[j])).toBe(false);
});

test('a line wears quote marks once: typed marks at the ends come off, apostrophes and inner quotes stay', () => {
  expect(quotedLine('"Go home."')).toBe('\u201cGo home.\u201d');
  expect(quotedLine('\u201cGo home.\u201d')).toBe('\u201cGo home.\u201d');
  expect(quotedLine('Go home.')).toBe('\u201cGo home.\u201d');
  expect(bareLine("'til morning")).toBe("'til morning");
  expect(bareLine("I'm not talkin'")).toBe("I'm not talkin'");
  expect(bareLine('She said "no" twice.')).toBe('She said "no" twice.');
});

test('a line hung beside an opened card edits fully there: speaker, words, delete', () => {
  const line = frag({ id: 'l1', kind: 'dialogue', text: 'You came back.', attachedTo: 'e1' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, line], badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onStickyEdit = jest.fn(); const onStickyDelete = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={() => {}} allEntities={entities} edges={{}} onStickyEdit={onStickyEdit} onStickyDelete={onStickyDelete} />);
  const sat = container.querySelector('[data-focus-sticky="l1"]')!.closest('[data-focus-satellite]')!;
  fireEvent.pointerDown(sat, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
  fireEvent.pointerUp(sat, { clientX: 5, clientY: 5, pointerId: 1 });
  const live = container.querySelector('[data-focus-sticky="l1"] [data-sticky-live]') as HTMLElement;
  expect(live).toBeTruthy();
  fireEvent.click(live.querySelector('[data-speaker-pick]')!);
  fireEvent.click(document.querySelector('[data-speaker-menu] [data-speaker-option="c2"]')!);
  expect(onStickyEdit).toHaveBeenCalledWith('l1', { speaker: 'c2' });
  fireEvent.click(live.querySelector('[data-delete-card]')!);
  fireEvent.click(live.querySelector('[data-delete-confirm]')!);
  expect(onStickyDelete).toHaveBeenCalledWith('l1');
});

test('a real click on a sticky opens it even though the release is reported on its wrapper (pointer capture)', () => {
  const line = frag({ id: 'l9', kind: 'dialogue', author: 'writer', text: 'I be the captain', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, line], badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onStickyEdit = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onStickyEdit={onStickyEdit} onStickyDelete={() => {}} />);
  const wrap = container.querySelector('[data-stage-item="l9"]')!;
  // No "line · yours" header: the cue and the quote marks say what it is.
  expect(wrap.textContent).not.toMatch(/line|yours/i);
  // As a captured pointer does: both events land on the wrapper itself.
  fireEvent.pointerDown(wrap, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(wrap, { clientX: 11, clientY: 10, pointerId: 1 });
  expect(container.querySelector('[data-stage-item="l9"] [data-sticky-live]')).toBeTruthy();
});

test('a line\'s note sits under it, reads "Add a Note" when empty, and can be cleared', () => {
  const noted = frag({ id: 'n7', kind: 'dialogue', author: 'writer', text: 'The radio only works in the rain.', label: 'whispered', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, noted], badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onStickyEdit = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onStickyEdit={onStickyEdit} onStickyDelete={() => {}} />);
  // On the face: under the line, not above it as a header.
  const face = container.querySelector('[data-sticky-id="n7"]')!;
  const kids = Array.from(face.querySelectorAll('[data-dialogue-face], [data-line-note]'));
  expect(kids.map((k) => (k.hasAttribute('data-line-note') ? 'note' : 'line'))).toEqual(['line', 'note']);
  click(container.querySelector('[data-sticky-id="n7"]')!);
  const note = container.querySelector('[data-inline-text="sticky-label"]') as HTMLElement;
  expect(note.getAttribute('data-placeholder')).toBe('Add a Note');
  fireEvent.focus(note);
  note.textContent = '';
  fireEvent.blur(note, { relatedTarget: container.querySelector('[data-sticky-live]') });
  expect(onStickyEdit).toHaveBeenCalledWith('n7', { label: '' });
});

test('a line with a speaker and no scene hangs on that character, not loose on the board', () => {
  const line = frag({ id: 'l5', kind: 'dialogue', author: 'writer', text: 'Count the stairs with me.', speaker: 'c1', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, line], badges: [], precedes });
  expect(items.find((i) => i.id === 'l5')).toBeUndefined();
  const c1 = items.find((i) => i.id === 'c1');
  expect(c1 && c1.kind === 'card' ? c1.attached.map((f) => f.id) : []).toContain('l5');
  // A speaker not on this board: the line stays loose.
  const away = frag({ id: 'l6', kind: 'dialogue', author: 'writer', text: 'Not here.', speaker: 'char_on_master', dumpId: '' });
  expect(stageItemsFrom({ entities, fragments: [...fragments, away], badges: [], precedes }).find((i) => i.id === 'l6')).toBeTruthy();
});

test('dragging a loose sticky onto a card offers it, and letting go there asks before it goes on (2026-10-31)', () => {
  const loose = frag({ id: 's8', kind: 'note', author: 'writer', text: 'The radio only works in the rain.', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, loose], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 2000, y: 2000 }, e1: { x: 100, y: 100 } };
  const onDrop = jest.fn(); const onMove = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={onMove} allEntities={entities} onDropSticky={onDrop} />);
  const el = container.querySelector('[data-stage-item="s8"]')!;
  // Grab the sticky at its corner and carry its middle over e1 (100..400 x 100..240).
  fireEvent.pointerDown(el, { button: 0, clientX: 2000, clientY: 2000, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 200, clientY: 120, pointerId: 1 });
  expect(container.querySelector('[data-drop-hint]')!.textContent).toBe('Put this sticky on this scene');
  fireEvent.pointerUp(el, { clientX: 200, clientY: 120, pointerId: 1 });
  // It waits over the card and asks; nothing is written yet.
  expect(onDrop).not.toHaveBeenCalled();
  expect(container.querySelector('[data-drop-hint]')).toBeNull();
  const ask = container.querySelector('[data-drop-confirm]')!;
  expect(ask.textContent).toMatch(/Add sticky to card\?/);
  fireEvent.click(container.querySelector('[data-drop-confirm-yes]')!);
  expect(onDrop).toHaveBeenCalledWith('s8', 'e1');
  expect(onMove).not.toHaveBeenCalled();
  expect(container.querySelector('[data-drop-confirm]')).toBeNull();
});

test('a dropped sticky that is not wanted on the card goes back, nothing written', () => {
  const loose = frag({ id: 's8', kind: 'note', author: 'writer', text: 'The radio only works in the rain.', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, loose], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 2000, y: 2000 }, e1: { x: 100, y: 100 } };
  const onDrop = jest.fn(); const onMove = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={onMove} allEntities={entities} onDropSticky={onDrop} />);
  const el = container.querySelector('[data-stage-item="s8"]')! as HTMLElement;
  fireEvent.pointerDown(el, { button: 0, clientX: 2000, clientY: 2000, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 200, clientY: 120, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 200, clientY: 120, pointerId: 1 });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(container.querySelector('[data-drop-confirm]')).toBeNull();
  expect(onDrop).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
  expect(el.style.transform).toMatch(/translate\(2000px, 2000px\)/);
});

test('right-click on a loose sticky opens what it can become: a card of any kind, or onto a card', () => {
  const loose = frag({ id: 's8', kind: 'note', author: 'writer', text: '**Scene one**\nJim goes to the store.', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, loose], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 900, y: 600 } };
  const onDrop = jest.fn(); const onTurn = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onDropSticky={onDrop} onTurnInto={onTurn} />);
  const note = container.querySelector('[data-sticky-id="s8"]')!;
  // The label is the visible way in.
  expect(note.querySelector('[data-sticky-kind]')!.textContent).toBe('Sticky');
  fireEvent.contextMenu(note, { clientX: 300, clientY: 200 });
  // Turn-into kinds first, putting it on a card last but delete; no Edit.
  const order = Array.from(document.querySelectorAll('[data-sticky-menu-item]')).map((e) => e.getAttribute('data-sticky-menu-item'));
  expect(order).toEqual(['turn-scene', 'turn-character', 'turn-world', 'turn-sequence', 'turn-subplot', 'media', 'put-on', 'delete']);
  fireEvent.click(document.querySelector('[data-sticky-menu-item="turn-character"]')!);
  expect(onTurn).toHaveBeenCalledWith('s8', 'character');
  expect(document.querySelector('[data-sticky-menu]')).toBeNull();
  fireEvent.click(note.querySelector('[data-sticky-kind]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-item="put-on"]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-card="e1"]')!);
  expect(onDrop).toHaveBeenCalledWith('s8', 'e1');
});

test('a sticky is colour coded from its menu, freely, and drawn in that paper (2026-10-31)', () => {
  const plain = frag({ id: 's8', kind: 'note', author: 'writer', text: 'Plain.', dumpId: '' });
  const painted = frag({ id: 's9', kind: 'note', author: 'writer', text: 'Painted.', dumpId: '', color: 'purple' } as any);
  const items = stageItemsFrom({ entities, fragments: [...fragments, plain, painted], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 900, y: 600 }, s9: { x: 900, y: 800 } };
  const onColor = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onDropSticky={() => {}} onStickyColor={onColor} />);
  const bg = (id: string) => (container.querySelector(`[data-sticky-id="${id}"]`) as HTMLElement).style.background;
  expect(bg('s9')).not.toBe(bg('s8'));
  fireEvent.contextMenu(container.querySelector('[data-sticky-id="s8"]')!, { clientX: 300, clientY: 200 });
  expect(document.querySelectorAll('[data-sticky-color]').length).toBe(8);
  fireEvent.click(document.querySelector('[data-sticky-color="orange"]')!);
  expect(onColor).toHaveBeenCalledWith('s8', 'orange');
  // The menu stays for another try; the paper a sticky shows is marked,
  // its kind's own when it has no colour of its own.
  expect(document.querySelector('[data-sticky-menu]')).not.toBeNull();
  expect(document.querySelector('[data-sticky-color="pink"]')!.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.contextMenu(container.querySelector('[data-sticky-id="s9"]')!, { clientX: 300, clientY: 200 });
  expect(document.querySelector('[data-sticky-color="purple"]')!.getAttribute('aria-pressed')).toBe('true');
});

test('a sticky inside a group has the same menu: colour, turn into, put on, delete (2026-11-01)', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onColor = jest.fn(); const onTurn = jest.fn(); const onDrop = jest.fn(); const onDelete = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onDropSticky={onDrop} onStickyColor={onColor} onTurnInto={onTurn} onStickyDelete={onDelete} />);
  // f2 sits in the group h1 with f1.
  expect(container.querySelector('[data-stage-item="group:h1"] [data-sticky-id="f2"]')).not.toBeNull();
  fireEvent.contextMenu(container.querySelector('[data-sticky-id="f2"]')!, { clientX: 300, clientY: 200 });
  expect(document.querySelector('[data-sticky-menu]')).not.toBeNull();
  fireEvent.click(document.querySelector('[data-sticky-color="green"]')!);
  expect(onColor).toHaveBeenCalledWith('f2', 'green');
  fireEvent.click(document.querySelector('[data-sticky-menu-item="turn-scene"]')!);
  expect(onTurn).toHaveBeenCalledWith('f2', 'scene');
  fireEvent.click(container.querySelector('[data-stage-item="group:h1"] [data-sticky-id="f1"] [data-sticky-kind]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-item="put-on"]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-card="e1"]')!);
  expect(onDrop).toHaveBeenCalledWith('f1', 'e1');
  fireEvent.contextMenu(container.querySelector('[data-sticky-id="f1"]')!, { clientX: 300, clientY: 200 });
  fireEvent.click(document.querySelector('[data-sticky-menu-item="delete"]')!);
  fireEvent.click(document.querySelector('[data-sticky-menu-item="delete"]')!);
  expect(onDelete).toHaveBeenCalledWith('f1');
});

test('a huddle about a card that exists: the green button adds it to that card', () => {
  const badges = [{ clusterId: 'h1', kind: 'scene', title: 'The marks are wiped', summary: 'Someone wipes the marks.', touches: [], addTo: { id: 'e1', title: 'Orrin stands at the last door, not wanting to open it', type: 'event' as const } }];
  const items = stageItemsFrom({ entities, fragments, badges, precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onAdd = jest.fn(); const onMake = jest.fn(); const onNot = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onAddHuddleTo={onAdd} onMakeCard={onMake} onNotYet={onNot} />);
  const pill = container.querySelector('[data-stage-item="group:h1"] [data-group-pill]')!;
  expect(pill.textContent).toMatch(/Add to scene/);
  fireEvent.click(pill);
  const menu = document.querySelector('[data-group-menu]')!;
  expect(menu.textContent).toMatch(/Notes on Orrin stands at the last door/);
  // The green button adds it to the card; making a card instead is tucked away.
  expect(menu.querySelector('[data-group-confirm]')!.textContent).toMatch(/^Add to Orrin stands at the last door, not wanting to open it/);
  fireEvent.click(menu.querySelector('[data-group-other]')!);
  expect([...menu.querySelectorAll('[data-group-others] [data-sticky-menu-item]')].map((b) => b.getAttribute('data-sticky-menu-item'))).toEqual(['make-scene', 'make-character', 'make-world']);
  fireEvent.click(menu.querySelector('[data-group-confirm]')!);
  expect(onAdd).toHaveBeenCalledWith('h1', 'e1');
  expect(onMake).not.toHaveBeenCalled();
  expect(document.querySelector('[data-group-menu]')).toBeNull();
});

test('a read group: one pill, and a menu with the suggestion and one green button (2026-11-02)', () => {
  const badges = [{ clusterId: 'h1', kind: 'world', worldKind: 'rule', title: 'The marks are a rule', summary: 'Every door is marked each hour.', touches: [] }];
  const items = stageItemsFrom({ entities, fragments, badges, precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onMake = jest.fn(); const onNot = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onMakeCard={onMake} onNotYet={onNot} />);
  const pill = container.querySelector('[data-stage-item="group:h1"] [data-group-pill]')!;
  expect(pill.textContent).toMatch(/World · rule/);
  expect(pill.textContent).toMatch(/The marks are a rule/);
  fireEvent.click(pill);
  const menu = document.querySelector('[data-group-menu]')!;
  expect(menu.querySelector('[data-group-suggestion]')!.textContent).toMatch(/Reads as world · rule.*The marks are a rule.*Every door is marked each hour\./);
  expect(menu.querySelector('[data-group-confirm]')!.textContent).toMatch(/^Make it a world card.*A world card with this name/);
  fireEvent.click(menu.querySelector('[data-sticky-menu-item="not-yet"]')!);
  expect(onNot).toHaveBeenCalledWith('h1');
  fireEvent.click(pill);
  fireEvent.click(document.querySelector('[data-group-confirm]')!);
  expect(onMake).toHaveBeenCalledWith('h1', 'world');
});

test('a character\'s relationships: labelled lines read from their side, edited in place, a "+" ties them to someone', () => {
  const ents = [
    { id: 'c1', type: 'character', state: 'parked', working_name: 'Teo' },
    { id: 'c2', type: 'character', state: 'parked', working_name: 'Captain' },
    { id: 'c3', type: 'character', state: 'parked', working_name: 'Deckhand' },
  ] as any[];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  // Stored in the captain's voice; from Teo's side it reads the other way.
  const edges = { structural: [{ from: 'c2', to: 'c1', predicate: 'crossed_with', inverse_predicate: 'was_crossed_by' }] } as any;
  const onSetTie = jest.fn(); const onRemoveTie = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={() => {}} allEntities={ents} edges={edges} onSetTie={onSetTie} onRemoveTie={onRemoveTie} />);
  fireEvent.click(container.querySelector('[data-focus-slide="relationships"]')!);
  const label = container.querySelector('[data-tie-label]') as HTMLElement;
  expect(label.textContent).toBe('was crossed by');
  fireEvent.click(label);
  const input = container.querySelector('[data-tie-editor] input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'owes a favour to' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSetTie).toHaveBeenCalledWith('c1', 'c2', 'owes a favour to', expect.objectContaining({ from: 'c2', to: 'c1', source: 'tie' }));
  // The "+" offers who is not tied to them yet.
  fireEvent.click(container.querySelector('[data-focus-chips] [data-add-tie]')!);
  const menu = document.querySelector('[data-add-cast-menu]')!;
  expect([...menu.querySelectorAll('[data-add-cast-option]')].map((o) => o.getAttribute('data-add-cast-option'))).toEqual(['c3']);
  fireEvent.click(menu.querySelector('[data-add-cast-option="c3"]')!);
  expect(onSetTie).toHaveBeenLastCalledWith('c1', 'c3', 'related');
});

test('the Characters view: the characters alone in a web, a label on every tie, drag one onto another to tie them', () => {
  const ents = [
    { id: 'c1', type: 'character', state: 'parked', working_name: 'Teo' },
    { id: 'c2', type: 'character', state: 'parked', working_name: 'Captain' },
    { id: 'c3', type: 'character', state: 'parked', working_name: 'Deckhand' },
    { id: 'e1', type: 'event', state: 'parked', working_title: 'The ferry loses power' },
  ] as any[];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const edges = { structural: [{ from: 'c2', to: 'c1', predicate: 'crossed_with' }], involves: [{ from: 'e1', to: 'c1' }] } as any;
  const onSetTie = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={ents} edges={edges} charactersMode onSetTie={onSetTie} onRemoveTie={() => {}} />);
  const at = (id: string) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform)!; return { x: +m[1], y: +m[2] }; };
  // The scene steps away; the characters stay.
  expect((container.querySelector('[data-stage-item="e1"]') as HTMLElement).style.opacity).toBe('0');
  expect((container.querySelector('[data-stage-item="c1"]') as HTMLElement).style.opacity).toBe('1');
  // One tie, one label.
  expect([...container.querySelectorAll('[data-tie-label]')].map((l) => l.textContent)).toEqual(['crossed with']);
  // Drag the deckhand onto Teo: they are tied, and the label opens to write.
  const from = at('c3'), to = at('c1');
  const el = container.querySelector('[data-stage-item="c3"]') as HTMLElement;
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100 + (to.x - from.x), clientY: 100 + (to.y - from.y), pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100 + (to.x - from.x), clientY: 100 + (to.y - from.y), pointerId: 1 });
  expect(onSetTie).toHaveBeenCalledWith('c3', 'c1', 'related');
});

test('the Characters view is the writer\'s to arrange: a drag into open space stays, and keeps the rest where they were', () => {
  const ents = [
    { id: 'c1', type: 'character', state: 'parked', working_name: 'Teo' },
    { id: 'c2', type: 'character', state: 'parked', working_name: 'Captain' },
    { id: 'c3', type: 'character', state: 'parked', working_name: 'Deckhand' },
  ] as any[];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const edges = { structural: [{ from: 'c2', to: 'c1', predicate: 'crossed_with' }] } as any;
  const onMoveInWeb = jest.fn();
  const onSetTie = jest.fn();
  const board = (webSaved?: Record<string, { x: number; y: number }>) => <SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={ents} edges={edges} charactersMode onSetTie={onSetTie} webSaved={webSaved} onMoveInWeb={onMoveInWeb} />;
  const { container, rerender } = render(board());
  const at = (id: string) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform)!; return { x: +m[1], y: +m[2] }; };
  const before = { c1: at('c1'), c2: at('c2'), c3: at('c3') };
  // Far below everyone: open space.
  const el = container.querySelector('[data-stage-item="c3"]') as HTMLElement;
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100, clientY: 700, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 700, pointerId: 1 });
  expect(onSetTie).not.toHaveBeenCalled();
  const moves = onMoveInWeb.mock.calls[0][0] as Array<{ id: string; pos: { x: number; y: number } }>;
  expect(Object.fromEntries(moves.map((m) => [m.id, m.pos]))).toEqual({ c1: before.c1, c2: before.c2, c3: { x: before.c3.x, y: before.c3.y + 600 } });
  // Saved, it is drawn there; the next move sends only what moved.
  rerender(board(Object.fromEntries(moves.map((m) => [m.id, m.pos]))));
  expect(at('c3')).toEqual({ x: before.c3.x, y: before.c3.y + 600 });
  fireEvent.pointerDown(el, { clientX: 100, clientY: 700, button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 140, clientY: 700, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 140, clientY: 700, pointerId: 1 });
  expect(onMoveInWeb.mock.calls[1][0]).toEqual([{ id: 'c3', pos: { x: before.c3.x + 40, y: before.c3.y + 600 } }]);
});

test('a tie label moves with its line while a character is dragged, not after it', () => {
  const ents = [
    { id: 'c1', type: 'character', state: 'parked', working_name: 'Teo' },
    { id: 'c2', type: 'character', state: 'parked', working_name: 'Captain' },
  ] as any[];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const edges = { structural: [{ from: 'c2', to: 'c1', predicate: 'crossed_with' }] } as any;
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="c1" onFocus={() => {}} onMoveInFocus={() => {}} allEntities={ents} edges={edges} onSetTie={() => {}} onRemoveTie={() => {}} />);
  fireEvent.click(container.querySelector('[data-focus-slide="relationships"]')!);
  const label = () => container.querySelector('[data-tie-label]') as HTMLElement;
  expect(label().style.transition).toMatch(/transform/);
  const el = container.querySelector('[data-stage-item="c2"]') as HTMLElement;
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  const before = label().style.transform;
  fireEvent.pointerMove(el, { clientX: 160, clientY: 180, pointerId: 1 });
  expect(label().style.transition).toBe('none');
  expect(label().style.transform).not.toBe(before);
  fireEvent.pointerUp(el, { clientX: 160, clientY: 180, pointerId: 1 });
});

test('show stickies: folded into the card by default; shown, each sticky is out on the board with a line to its card, a line of dialogue by its scene and its speaker', () => {
  const ents = [
    { id: 'e1', type: 'event', state: 'parked', working_title: 'The ferry loses power' },
    { id: 'c1', type: 'character', state: 'parked', working_name: 'Teo' },
  ] as any[];
  const frags = [
    frag({ id: 's1', text: 'The engine room smells of burnt rope.', attachedTo: 'e1' }),
    frag({ id: 's2', text: 'Counts everything twice.', attachedTo: 'c1' }),
    frag({ id: 'l1', text: 'We are not sinking.', kind: 'dialogue', attachedTo: 'e1', speaker: 'c1' } as any),
  ];
  const items = stageItemsFrom({ entities: ents, fragments: frags, badges: [], precedes: [] });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const board = (show: boolean) => <SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={ents} showStickies={show} onStickyEdit={() => {}} />;
  const { container, rerender } = render(board(false));
  expect(container.querySelectorAll('[data-unfold-sticky]').length).toBe(0);
  expect(container.querySelectorAll('[data-mini-stickies]').length).toBeGreaterThan(0);
  rerender(board(true));
  const keys = [...container.querySelectorAll('[data-unfold-sticky]')].map((el) => el.getAttribute('data-unfold-sticky')).sort();
  expect(keys).toEqual(['c1:l1', 'c1:s2', 'e1:l1', 'e1:s1']);
  expect(container.querySelectorAll('[data-unfold-line]').length).toBe(4);
  expect(container.querySelectorAll('[data-mini-stickies]').length).toBe(0);
  // Out on the board, none sits on a card.
  const at = (el: Element) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform)!; return { x: +m[1], y: +m[2] }; };
  const cards = ['e1', 'c1'].map((id) => ({ ...pos[id], ...itemSizeOf(id) }));
  function itemSizeOf(id: string) { return id === 'e1' ? { w: 300, h: 140 } : { w: 220, h: 112 }; }
  const onCard = [...container.querySelectorAll('[data-unfold-sticky]')].filter((el) => { const p = at(el); return cards.some((c) => p.x < c.x + c.w && p.x + 150 > c.x && p.y < c.y + c.h && p.y + 96 > c.y); });
  expect(onCard).toEqual([]);
  // A click opens it to edit, in place.
  fireEvent.click(container.querySelector('[data-unfold-sticky="e1:s1"]')!);
  expect(container.querySelector('[data-unfold-sticky="e1:s1"] textarea, [data-unfold-sticky="e1:s1"] [contenteditable], [data-unfold-sticky="e1:s1"] input')).not.toBeNull();
});

test('the World view: the world alone, a column per kind; a strip\'s kind is picked on it, with no Promote', () => {
  const ents = [{ id: 'e1', type: 'event', state: 'parked', working_title: 'The ferry loses power' }] as any[];
  const frags = [
    frag({ id: 'w1', text: 'A ferry town on a cold coast.', kind: 'story', factKind: 'setting' } as any),
    frag({ id: 'w2', text: 'Nobody crosses after dark.', kind: 'story', factKind: 'world', worldKind: 'rule' } as any),
    frag({ id: 'w3', text: 'The old ferry sank in 1962.', kind: 'story', factKind: 'world', worldKind: 'history' } as any),
    frag({ id: 'w4', text: 'Quiet, grey, slow.', kind: 'story', factKind: 'tone' } as any),
    frag({ id: 'n1', text: 'An ordinary sticky.' }),
  ];
  const items = stageItemsFrom({ entities: ents, fragments: frags, badges: [], precedes: [] });
  const cols = worldColumns(items, 1600);
  expect(cols.heads.map((h) => h.label)).toEqual(['Setting', 'Rules', 'History', 'Tone']);
  expect(cols.pos.has('n1')).toBe(false);
  expect(cols.pos.has('e1')).toBe(false);
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onStickyEdit = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={ents} worldMode onStickyEdit={onStickyEdit} onStickyDelete={() => {}} onPromote={() => {}} />);
  expect([...container.querySelectorAll('[data-world-head]')].map((h) => h.getAttribute('data-world-head'))).toEqual(['setting', 'world:rule', 'world:history', 'tone']);
  expect((container.querySelector('[data-stage-item="e1"]') as HTMLElement).style.opacity).toBe('0');
  expect((container.querySelector('[data-stage-item="n1"]') as HTMLElement).style.opacity).toBe('0');
  // Open the rule; no Promote; pick History.
  const el = container.querySelector('[data-stage-item="w2"]') as HTMLElement;
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId: 1 });
  expect(container.textContent).not.toMatch(/Promote/);
  fireEvent.click(container.querySelector('[data-kind-pick]')!);
  fireEvent.click(document.querySelector('[data-kind-option="world:history"]')!);
  expect(onStickyEdit).toHaveBeenCalledWith('w2', { factKind: 'world', worldKind: 'history' });
});

test('nothing overlaps: what a grown sticky covers steps clear the short way, and a push carries on (FIL-715)', () => {
  const pad = 16;
  const boxes = [
    { id: 's', x: 100, y: 100, w: 300, h: 200 },      // the sticky, grown
    { id: 'a', x: 380, y: 120, w: 180, h: 120 },      // overlapped on its right: goes right
    { id: 'b', x: 600, y: 120, w: 180, h: 120 },      // in a's new way: carried on
    { id: 'c', x: 120, y: 290, w: 180, h: 120 },      // overlapped below: goes down
    { id: 'far', x: 1200, y: 900, w: 100, h: 100 },   // untouched
  ];
  const moved = nudgeClear(['s'], boxes, pad);
  expect(moved.s).toBeUndefined();
  expect(moved.far).toBeUndefined();
  expect(moved.a).toEqual({ x: 100 + 300 + pad, y: 120 });
  expect(moved.c).toEqual({ x: 120, y: 100 + 200 + pad });
  expect(moved.b.x).toBeGreaterThanOrEqual(moved.a.x + 180 + pad);
  // Nothing overlaps after.
  const at = boxes.map((b) => ({ ...b, ...(moved[b.id] ?? {}) }));
  for (const p of at) for (const q of at) {
    if (p.id >= q.id) continue;
    const over = p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
    expect(over).toBe(false);
  }
  // Never off the board's top or left edge.
  const edge = nudgeClear(['s'], [{ id: 's', x: 40, y: 40, w: 200, h: 200 }, { id: 'e', x: 20, y: 20, w: 60, h: 60 }], pad);
  expect(edge.e.x).toBeGreaterThanOrEqual(8);
  expect(edge.e.y).toBeGreaterThanOrEqual(8);
});

test('turning a card back says what it drops, and asks first; a card with nothing to drop turns back at once (FIL-718)', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const edges = { precedes, involves: [{ from: 'e1', to: 'c1' }, { from: 'e2', to: 'c1' }], occurs_in: [{ from: 'e1', to: 'l1' }], structural: [{ from: 'c1', to: 'c2', predicate: 'father_of' }] };
  const e1 = items.find((i) => i.id === 'e1')!;
  const c1 = items.find((i) => i.id === 'c1')!;
  expect(losesOnDemote(e1, edges as any, items)).toEqual(['its place in the scene order', '1 character in it', 'where it happens']);
  expect(losesOnDemote(c1, edges as any, items)).toEqual(['its place in 2 scenes', '1 tie to another character']);
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onDemote = jest.fn();
  const { container, rerender } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} edges={edges as any} focusId="e1" onDemoteCard={onDemote} />);
  fireEvent.click(container.querySelector('[data-demote]')!);
  expect(onDemote).not.toHaveBeenCalled();
  const ask = container.querySelector('[data-demote-ask]')!;
  expect(ask.textContent).toMatch(/loses its place in the scene order, 1 character in it and where it happens\. Undo brings them back/);
  fireEvent.click(container.querySelector('[data-demote-no]')!);
  expect(container.querySelector('[data-demote-ask]')).toBeNull();
  fireEvent.click(container.querySelector('[data-demote]')!);
  fireEvent.click(container.querySelector('[data-demote-yes]')!);
  expect(onDemote).toHaveBeenCalledWith('e1', expect.anything());
  // Nothing to drop: no question.
  onDemote.mockClear();
  rerender(<SandboxBoard items={items} positions={pos} onMove={() => {}} edges={{}} focusId="e2" onDemoteCard={onDemote} />);
  fireEvent.click(container.querySelector('[data-demote]')!);
  expect(container.querySelector('[data-demote-ask]')).toBeNull();
  expect(onDemote).toHaveBeenCalledWith('e2', expect.anything());
});

test('a pinned sticky has the sticky menu on right-click, with Unpin (2026-11-01)', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onUnpin = jest.fn(); const onColor = jest.fn(); const onDrop = jest.fn();
  // f5 is pinned to c1; open c1 so its stickies hang round it.
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} focusId="c1" onDropSticky={onDrop} onStickyColor={onColor} onUnpinSticky={onUnpin} />);
  const sat = container.querySelector('[data-focus-sticky="f5"]')!;
  fireEvent.contextMenu(sat, { clientX: 300, clientY: 200 });
  expect(document.querySelector('[data-sticky-menu]')).not.toBeNull();
  fireEvent.click(document.querySelector('[data-sticky-color="blue"]')!);
  expect(onColor).toHaveBeenCalledWith('f5', 'blue');
  // Move to another card offers every card but the one it is on.
  fireEvent.click(document.querySelector('[data-sticky-menu-item="put-on"]')!);
  expect(document.querySelector('[data-sticky-menu-card="c1"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-sticky-menu-card="e1"]')!);
  expect(onDrop).toHaveBeenCalledWith('f5', 'e1');
  fireEvent.contextMenu(sat, { clientX: 300, clientY: 200 });
  fireEvent.click(document.querySelector('[data-sticky-menu-item="unpin"]')!);
  expect(onUnpin).toHaveBeenCalledWith('f5', 'c1');
  // Unpin lives in the menu only (Ben 2026-11-01): no button on the sticky.
  expect(container.querySelector('[data-unpin]')).toBeNull();
});

test('a group with no read still offers Make it, from the same menu without a suggestion (2026-11-02)', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onMake = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onMakeCard={onMake} onNotYet={() => {}} />);
  const group = container.querySelector('[data-stage-item="group:h1"]')!;
  expect(group.querySelector('[data-badge]')).toBeNull();
  const pill = group.querySelector('[data-group-make] [data-group-pill]')!;
  expect(pill.textContent).toMatch(/Make it/);
  fireEvent.click(pill);
  const menu = document.querySelector('[data-group-menu]')!;
  expect(menu.querySelector('[data-group-suggestion]')).toBeNull();
  expect(menu.querySelector('[data-sticky-menu-item="not-yet"]')).toBeNull();
  fireEvent.click(menu.querySelector('[data-sticky-menu-item="make-character"]')!);
  expect(onMake).toHaveBeenCalledWith('h1', 'character');
});

test('groups by hand: a sticky dropped on a group asks and joins it; on a loose sticky, the two group; the menu takes one out (2026-11-02)', () => {
  const loose = frag({ id: 's8', kind: 'note', author: 'writer', text: 'The radio only works in the rain.', dumpId: '' });
  const other = frag({ id: 's9', kind: 'note', author: 'writer', text: 'Static on every channel.', dumpId: '' });
  const items = stageItemsFrom({ entities, fragments: [...fragments, loose, other], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 2000, y: 2000 }, s9: { x: 2600, y: 2600 }, 'group:h1': { x: 900, y: 100 } };
  const onGroup = jest.fn(); const onUngroup = jest.fn(); const onDrop = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} allEntities={entities} onDropSticky={onDrop} onGroupSticky={onGroup} onUngroupSticky={onUngroup} />);
  // Onto the group h1 (at 900, 100).
  const el = container.querySelector('[data-stage-item="s8"]')!;
  fireEvent.pointerDown(el, { button: 0, clientX: 2000, clientY: 2000, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 960, clientY: 130, pointerId: 1 });
  expect(container.querySelector('[data-drop-hint]')!.textContent).toBe('Put this sticky in the group');
  fireEvent.pointerUp(el, { clientX: 960, clientY: 130, pointerId: 1 });
  expect(container.querySelector('[data-drop-confirm]')!.textContent).toMatch(/Add sticky to group\?/);
  fireEvent.click(container.querySelector('[data-drop-confirm-yes]')!);
  expect(onGroup).toHaveBeenCalledWith('s8', 'h1');
  expect(onDrop).not.toHaveBeenCalled();
  // Onto a loose sticky (s9 at 2600, 2600).
  const el2 = container.querySelector('[data-stage-item="s8"]')!;
  fireEvent.pointerDown(el2, { button: 0, clientX: 2000, clientY: 2000, pointerId: 2 });
  fireEvent.pointerMove(el2, { clientX: 2620, clientY: 2620, pointerId: 2 });
  expect(container.querySelector('[data-drop-hint]')!.textContent).toBe('Group these stickies');
  fireEvent.pointerUp(el2, { clientX: 2620, clientY: 2620, pointerId: 2 });
  fireEvent.click(container.querySelector('[data-drop-confirm-yes]')!);
  expect(onGroup).toHaveBeenCalledWith('s8', 's9');
  // Out of the group, from a grouped sticky's menu.
  fireEvent.contextMenu(container.querySelector('[data-stage-item="group:h1"] [data-sticky-id="f2"]')!, { clientX: 300, clientY: 200 });
  fireEvent.click(document.querySelector('[data-sticky-menu-item="ungroup"]')!);
  expect(onUngroup).toHaveBeenCalledWith('f2', 'h1');
});

test('a very long unsized sticky stops at the cap and fades; a sized one and one being written are whole (2026-11-02)', () => {
  const longText = 'The radio only works in the rain. '.repeat(20).trim();
  const long = frag({ id: 's8', kind: 'note', author: 'writer', text: longText, dumpId: '' });
  const sized = { ...frag({ id: 's9', kind: 'note', author: 'writer', text: longText, dumpId: '' }), size: { w: 300, h: 500 } } as any;
  const items = stageItemsFrom({ entities, fragments: [...fragments, long, sized], badges: [], precedes });
  const pos = { ...defaultLayout(items, {}, { w: 1400 }), s8: { x: 2000, y: 2000 }, s9: { x: 2600, y: 2000 } };
  const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-sticky-id') ? 420 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-sticky-id') ? 200 : 0; } });
  try {
    const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} onStickyEdit={() => {}} onStickyDelete={() => {}} onStickyResize={() => {}} />);
    const capped = container.querySelector('[data-sticky-id="s8"]') as HTMLElement;
    expect(capped.style.maxHeight).toBe('200px');
    expect(capped.querySelector('[data-sticky-fade]')).not.toBeNull();
    const own = container.querySelector('[data-sticky-id="s9"]') as HTMLElement;
    expect(own.style.maxHeight).toBe('');
    expect(own.querySelector('[data-sticky-fade]')).toBeNull();
  } finally {
    if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh); else delete (HTMLElement.prototype as any).scrollHeight;
    if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch); else delete (HTMLElement.prototype as any).clientHeight;
  }
});

test('connect: drag a scene\'s dot onto another scene and it comes next; the card itself does not move', () => {
  const ents = ['a', 'b', 'n'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' } as unknown as ProjectEntity));
  const pre = [{ from: 'a', to: 'b' }];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: pre });
  const pos = { a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, n: { x: 0, y: 400 } };
  const onReorderScene = jest.fn();
  const onMove = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={onMove} precedes={pre} onReorderScene={onReorderScene} />);
  const dot = container.querySelector('[data-link-handle="a"]')!;
  expect(dot).toBeTruthy();
  fireEvent.pointerDown(dot, { button: 0, clientX: 300, clientY: 70, pointerId: 1 });
  fireEvent.pointerMove(dot, { clientX: 100, clientY: 450, pointerId: 1 });
  expect(container.querySelector('[data-link-drag]')).toBeTruthy();
  expect((container.querySelector('[data-stage-item="n"]') as HTMLElement).style.outline).toMatch(/dashed/);
  fireEvent.pointerUp(dot, { clientX: 100, clientY: 450, pointerId: 1 });
  expect(container.querySelector('[data-link-drag]')).toBeNull();
  expect(onReorderScene).toHaveBeenCalledWith('n', { remove: [{ from: 'a', to: 'b' }], add: [{ from: 'a', to: 'n' }, { from: 'n', to: 'b' }] });
  expect(onMove).not.toHaveBeenCalled();
  // Let go on empty board: nothing.
  onReorderScene.mockClear();
  fireEvent.pointerDown(dot, { button: 0, clientX: 300, clientY: 70, pointerId: 1 });
  fireEvent.pointerUp(dot, { clientX: 900, clientY: 900, pointerId: 1 });
  expect(onReorderScene).not.toHaveBeenCalled();
});

test('a scene card resizes from its corner like a sticky, and keeps the size it is given', () => {
  const ents = [{ id: 's1', type: 'event', working_title: 'Scene one', working_name: '', state: 'parked', summary: 'words' } as unknown as ProjectEntity];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [] });
  const onStickyResize = jest.fn();
  const { container, rerender } = render(<SandboxBoard items={items} positions={{ s1: { x: 0, y: 0 } }} onMove={() => {}} onStickyResize={onStickyResize} />);
  const grip = container.querySelector('[data-card-grip]')!;
  expect(grip).toBeTruthy();
  fireEvent.pointerDown(grip, { button: 0, clientX: 300, clientY: 140, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 420, clientY: 240, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 420, clientY: 240, pointerId: 1 });
  expect(onStickyResize).toHaveBeenCalledWith('s1', { w: 420, h: 240 });
  // Given a size, the card is drawn at it.
  const sized = stageItemsFrom({ entities: [{ ...ents[0], card_size: { w: 420, h: 240 } } as unknown as ProjectEntity], fragments: [], badges: [], precedes: [] });
  rerender(<SandboxBoard items={sized} positions={{ s1: { x: 0, y: 0 } }} onMove={() => {}} onStickyResize={onStickyResize} />);
  const card = container.querySelector('[data-stage-item="s1"] > div') as HTMLElement;
  expect(card.style.width).toBe('420px');
  expect(card.style.height).toBe('240px');
});

test('an open dump lights the scenes it made, not only the cards holding its stickies', () => {
  const ents = ['s1', 's2', 's3'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' } as unknown as ProjectEntity));
  const frag = { id: 'f1', kind: 'note', author: 'extractor', text: 'a loose note', source: 'a loose note', label: '', about: '', open: true, dumpId: 'bd_100_abc', attachedTo: null, clusterId: null, createdAt: '2026-11-04' } as unknown as SandboxFragment;
  const items = stageItemsFrom({ entities: ents, fragments: [frag], badges: [], precedes: [] });
  const pos = { s1: { x: 0, y: 0 }, s2: { x: 400, y: 0 }, s3: { x: 800, y: 0 }, f1: { x: 0, y: 300 }, 'dump:bd_100_abc': { x: 600, y: 400 } };
  const edges = { mentions: [{ from: 'bd_bd_100_abc_story_1', to: 's1' }, { from: 'bd_bd_100_abc_story_1', to: 's2' }, { from: 'bd_bd_999_zzz_story_1', to: 's3' }] };
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} edges={edges} />);
  const tok = container.querySelector('[data-stage-item="dump:bd_100_abc"]')!;
  fireEvent.pointerDown(tok, { button: 0, clientX: 610, clientY: 410, pointerId: 1 });
  fireEvent.pointerUp(tok, { clientX: 610, clientY: 410, pointerId: 1 });
  const lit = (id: string) => container.querySelector(`[data-stage-item="${id}"]`)!.classList.contains('ff-lit');
  expect(lit('s1')).toBe(true);
  expect(lit('s2')).toBe(true);
  expect(lit('s3')).toBe(false);
});

test('beats: a beat dragged in the Scenes grid takes its new place on the line', () => {
  const ents = [
    { id: 'B1', type: 'sequence', working_title: 'Beat one', working_name: '', state: 'parked', summary: '', beat_color: '#7e22ce', beat_count: 2 },
    ...['a', 'b'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' })),
  ] as unknown as ProjectEntity[];
  const line = [{ from: 'B1', to: 'a' }, { from: 'a', to: 'b' }];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: line });
  const onPlaceBeat = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={{}} onMove={() => {}} scenesMode precedes={[{ from: 'a', to: 'b' }]} lineLinks={line} onPlaceBeat={onPlaceBeat} onReorderScene={() => {}} />);
  const beat = container.querySelector('[data-stage-item="B1"]')!;
  // Grid: B1, a, b in a row. The middle slot puts it between a and b.
  fireEvent.pointerDown(beat, { button: 0, clientX: 40, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(beat, { clientX: 40 + 324 + 10, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(beat, { clientX: 40 + 324 + 10, clientY: 50, pointerId: 1 });
  expect(onPlaceBeat).toHaveBeenLastCalledWith('B1', { before: 'b' });
  // The last slot puts it after the last scene.
  fireEvent.pointerDown(beat, { button: 0, clientX: 40, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(beat, { clientX: 40 + 2 * 324 + 10, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(beat, { clientX: 40 + 2 * 324 + 10, clientY: 50, pointerId: 1 });
  expect(onPlaceBeat).toHaveBeenLastCalledWith('B1', { after: 'b' });
});

test('the thread: hovering shows a + that asks for a scene between the two cards', () => {
  const ents = ['a', 'b'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' } as unknown as ProjectEntity));
  const pre = [{ from: 'a', to: 'b' }];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: pre });
  const onInsertBetween = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={{ a: { x: 0, y: 0 }, b: { x: 600, y: 0 } }} onMove={() => {}} precedes={pre} lineLinks={pre} onInsertBetween={onInsertBetween} />);
  const hit = container.querySelector('[data-thread-hit]')!;
  expect(hit).toBeTruthy();
  expect(container.querySelector('[data-thread-plus]')).toBeNull();
  fireEvent.mouseOver(hit);
  const plus = container.querySelector('[data-thread-plus]')!;
  expect(plus).toBeTruthy();
  fireEvent.click(plus);
  expect(onInsertBetween).toHaveBeenCalledWith('a', 'b', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
});

test('timeline: scenes on one track, a beat as a band over its scenes; a drag moves along the line', () => {
  const ents = [
    { id: 'B1', type: 'sequence', working_title: 'Beat one', working_name: '', state: 'parked', summary: '', beat_color: '#5b21b6', beat_count: 2 },
    ...['a', 'b', 'c'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' })),
  ] as unknown as ProjectEntity[];
  const line = [{ from: 'B1', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: line });
  const onMoveInLine = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={{}} onMove={() => {}} scenesMode scenesLayout="timeline" precedes={[{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]} lineLinks={line} onMoveInLine={onMoveInLine} onReorderScene={() => {}} />);
  const xy = (id: string) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform)!; return { x: Number(m[1]), y: Number(m[2]) }; };
  expect(xy('a').y).toBe(xy('b').y);
  expect(xy('b').x).toBeGreaterThan(xy('a').x);
  expect(xy('B1').y).toBeLessThan(xy('a').y);
  expect(xy('B1').x).toBe(xy('a').x);
  // Drag c to the front of the track: it lands before a.
  const c = container.querySelector('[data-stage-item="c"]')!;
  const a = xy('a'), cpos = xy('c');
  fireEvent.pointerDown(c, { button: 0, clientX: cpos.x + 20, clientY: cpos.y + 20, pointerId: 1 });
  fireEvent.pointerMove(c, { clientX: a.x - 100, clientY: cpos.y + 20, pointerId: 1 });
  fireEvent.pointerUp(c, { clientX: a.x - 100, clientY: cpos.y + 20, pointerId: 1 });
  expect(onMoveInLine).toHaveBeenCalledWith('c', 0, ['B1', 'a', 'b', 'c']);
});

test('columns: a column per beat, scenes stacked under its tab; a tab dragged takes its column', () => {
  const ents = [
    { id: 'B1', type: 'sequence', working_title: 'Beat one', working_name: '', state: 'parked', summary: '', beat_color: '#5b21b6', beat_count: 2 },
    { id: 'B2', type: 'sequence', working_title: 'Beat two', working_name: '', state: 'parked', summary: '', beat_color: '#5b21b6', beat_count: 1 },
    ...['a', 'b', 'c'].map((id) => ({ id, type: 'event', working_title: `Scene ${id}`, working_name: '', state: 'parked', summary: '' })),
  ] as unknown as ProjectEntity[];
  const line = [{ from: 'B1', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'B2' }, { from: 'B2', to: 'c' }];
  const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: line });
  const onMoveInLine = jest.fn();
  const onInsertBetween = jest.fn();
  const { container } = render(<SandboxBoard items={items} positions={{}} onMove={() => {}} scenesMode scenesLayout="columns" precedes={[{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]} lineLinks={line} onMoveInLine={onMoveInLine} onInsertBetween={onInsertBetween} onReorderScene={() => {}} />);
  const xy = (id: string) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((container.querySelector(`[data-stage-item="${id}"]`) as HTMLElement).style.transform)!; return { x: Number(m[1]), y: Number(m[2]) }; };
  expect(xy('a').x).toBe(xy('B1').x);
  expect(xy('b').x).toBe(xy('a').x);
  expect(xy('b').y).toBeGreaterThan(xy('a').y);
  expect(xy('B2').x).toBeGreaterThan(xy('B1').x);
  expect(xy('c').y).toBe(xy('a').y);
  // The foot of B1's column adds after b, before B2.
  fireEvent.click(container.querySelector('[data-beat-slot="B1"]')!);
  expect(onInsertBetween).toHaveBeenCalledWith('b', 'B2', expect.anything());
  // Drag B2's tab to the left of B1: the whole column goes first.
  const t = container.querySelector('[data-stage-item="B2"]')!;
  const b1 = xy('B1'), b2 = xy('B2');
  fireEvent.pointerDown(t, { button: 0, clientX: b2.x + 20, clientY: b2.y + 20, pointerId: 1 });
  fireEvent.pointerMove(t, { clientX: b1.x - 200, clientY: b2.y + 20, pointerId: 1 });
  fireEvent.pointerUp(t, { clientX: b1.x - 200, clientY: b2.y + 20, pointerId: 1 });
  expect(onMoveInLine).toHaveBeenCalledWith('B2', 0, ['B1', 'a', 'b', 'B2', 'c'], ['B2', 'c']);
});

test('subplots: a scene\'s Subplots pill puts it in one; a subplot\'s Scenes pill picks an existing scene or a new one', () => {
  const arc = { id: 'A1', type: 'arc', working_name: 'The daughter thread', state: 'parked' } as unknown as ProjectEntity;
  const arc2 = { id: 'A2', type: 'arc', working_name: 'The loop', state: 'parked' } as unknown as ProjectEntity;
  const all = [...entities, arc, arc2];
  const evokes = [{ arc_id: 'A1', event_id: 'e1', transition: 'touches' }];
  const subplotOptions = [{ id: 'A1', name: 'The daughter thread', color: '#be185d' }, { id: 'A2', name: 'The loop', color: '#0f766e' }];
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onTagSubplot = jest.fn(); const onNewSceneInSubplot = jest.fn(); const onUntagSubplot = jest.fn(); const onNewSubplotWithScene = jest.fn(); const onSetTransition = jest.fn();
  // A scene: its Subplots pill lists the subplots it is not in.
  const { container, unmount } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} focusId="e1" onFocus={() => {}} allEntities={all} edges={{ evokes } as any}
    onTagSubplot={onTagSubplot} onNewSceneInSubplot={onNewSceneInSubplot} subplotOptions={subplotOptions} onUntagSubplot={onUntagSubplot} onNewSubplotWithScene={onNewSubplotWithScene} onSetTransition={onSetTransition} />);
  expect(container.querySelector('[data-focus-slide="subplots"]')!.textContent).toContain('1');
  // Its subplot hangs beside it with a word chip for what the scene does to it.
  fireEvent.click(container.querySelector('[data-focus-slide="subplots"]')!);
  const word = container.querySelector('[data-transition-chip="A1"] [data-transition-pick]')!;
  expect(word.textContent).toBe('touches');
  fireEvent.click(word);
  const words = [...document.querySelectorAll('[data-add-cast-menu] [data-add-cast-option]')].map((o) => o.getAttribute('data-add-cast-option'));
  expect(words).not.toContain('touches');
  expect(words).toContain('develops');
  expect(words[words.length - 1]).toBe('');
  fireEvent.click(document.querySelector('[data-add-cast-menu] [data-add-cast-option="develops"]')!);
  expect(onSetTransition).toHaveBeenCalledWith('A1', 'e1', 'develops');
  // Hovered, it can be taken out.
  fireEvent.pointerEnter(container.querySelector('[data-focus-ghost="A1"]')!.closest('[data-focus-satellite]')!);
  fireEvent.click(container.querySelector('[data-take-out="A1"]')!);
  expect(onUntagSubplot).toHaveBeenCalledWith('A1', 'e1');
  // A new subplot with this scene in it.
  fireEvent.click(container.querySelector('[data-focus-chips] [data-add-subplot]')!);
  fireEvent.click(document.querySelector('[data-add-cast-menu] [data-add-new]')!);
  expect(onNewSubplotWithScene).toHaveBeenCalledWith('e1');
  fireEvent.click(container.querySelector('[data-focus-chips] [data-add-subplot]')!);
  let menu = document.querySelector('[data-add-cast-menu]')!;
  expect([...menu.querySelectorAll('[data-add-cast-option]')].map((o) => o.getAttribute('data-add-cast-option'))).toEqual(['A2']);
  fireEvent.click(menu.querySelector('[data-add-cast-option="A2"]')!);
  expect(onTagSubplot).toHaveBeenCalledWith('A2', 'e1');
  unmount();
  // A subplot: its Scenes pill lists the scenes not in it, and a new one.
  const withArc = [...items, { id: 'A1', kind: 'card', entity: arc, attached: [] } as any];
  const r = render(<SandboxBoard items={withArc} positions={{ ...pos, A1: { x: 24, y: 8 } }} onMove={() => {}} focusId="A1" onFocus={() => {}} allEntities={all} edges={{ evokes } as any}
    onTagSubplot={onTagSubplot} onNewSceneInSubplot={onNewSceneInSubplot} subplotOptions={subplotOptions} />);
  fireEvent.click(r.container.querySelector('[data-focus-chips] [data-add-scene]')!);
  menu = document.querySelector('[data-add-cast-menu]')!;
  expect([...menu.querySelectorAll('[data-add-cast-option]')].map((o) => o.getAttribute('data-add-cast-option'))).toEqual(['e2']);
  fireEvent.click(menu.querySelector('[data-add-cast-option="e2"]')!);
  expect(onTagSubplot).toHaveBeenCalledWith('A1', 'e2');
  // The last scene picked closes the menu.
  expect(document.querySelector('[data-add-cast-menu]')).toBeNull();
  fireEvent.click(r.container.querySelector('[data-focus-chips] [data-add-scene]')!);
  fireEvent.click(document.querySelector('[data-add-cast-menu] [data-add-new]')!);
  expect(onNewSceneInSubplot).toHaveBeenCalledWith('A1');
});

test('a subplot open in the strip: a hovered scene says what a click does', () => {
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes });
  const pos = defaultLayout(items, {}, { w: 1400 });
  const onToggle = jest.fn();
  const pick = { lit: new Set(['e1']), color: '#7c3aed', onToggle, addLabel: '+ Add to The loop', outLabel: 'In The loop · click to take out' };
  const { container } = render(<SandboxBoard items={items} positions={pos} onMove={() => {}} stripPick={pick} />);
  fireEvent.pointerEnter(container.querySelector('[data-stage-item="e2"]')!);
  expect(container.querySelector('[data-strip-pick-hint]')!.textContent).toBe('+ Add to The loop');
  fireEvent.pointerLeave(container.querySelector('[data-stage-item="e2"]')!);
  fireEvent.pointerEnter(container.querySelector('[data-stage-item="e1"]')!);
  expect(container.querySelector('[data-strip-pick-hint]')!.textContent).toBe('In The loop · click to take out');
});
