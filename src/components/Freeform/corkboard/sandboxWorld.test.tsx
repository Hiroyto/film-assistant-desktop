// World entries on the sandbox (Ben, 2026-10-22: "it should match the strip
// design closely"): on the board a world entry is a sage strip with its kind
// in the head and the stickies it holds; opened, it shows those stickies (and
// takes a new one by hand), its kind to change, and the Peer pill (questions
// and a read), nothing else. A
// sample's world material ships as entries, drawn the same.
// Stories and words are invented.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SandboxFragment } from '../../../lib/freeformApi';
import { SandboxBoard, defaultLayout, stageItemsFrom } from './sandboxBoard';
import { templateLayout } from './sandboxTemplates';

if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };

const entities = [{ id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' }] as any[];
const held = (id: string, text: string): SandboxFragment => ({ id, kind: 'note', author: 'writer', text, source: text, label: '', about: '', open: true, dumpId: 'd1', attachedTo: 'world_tide', clusterId: null, createdAt: '2026-10-22T09:00:00Z' });
const entry = (over: Record<string, unknown> = {}) => ({ id: 'world_tide', kind: 'rule', title: 'The tide takes one boat a year', text: 'The tide takes one boat a year, and the harbour pretends not to count.', label: '', source: '', touches: [{ id: 'chr_ada', type: 'character', role: 'happened to' }], establishedIn: [], createdAt: '2026-10-22T09:00:00Z', ...over });
const board = (over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => {
  const fragments = [held('f_1', 'Nobody rows out on the anniversary.'), held('f_2', 'Ada keeps the count anyway.')];
  const items = stageItemsFrom({ entities, fragments, badges: [], precedes: [], world: [entry(over)] } as any);
  const positions = defaultLayout(items, {}, { w: 1400 });
  return render(<SandboxBoard items={items} positions={positions} onMove={() => {}} allEntities={entities} {...props} />);
};

describe('a world entry on the board', () => {
  it('is a sage strip: its kind in the head, the writer\'s words, nothing else', () => {
    const { container } = board();
    const strip = container.querySelector('[data-world-strip="world_tide"]') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.querySelector('[data-story-head]')?.textContent).toBe('World · rule');
    expect(strip.textContent).toContain('the harbour pretends not to count');
    // The old card's extras are gone.
    expect(strip.textContent).not.toMatch(/intent|on the page|touches/);
  });

  it('a sample\'s world entry is the same strip', () => {
    const { container } = board({ template: true });
    expect(container.querySelector('[data-world-strip="world_tide"] [data-story-head]')?.textContent).toBe('World · rule');
  });

  it('an entry of kind other reads plainly as World', () => {
    const { container } = board({ kind: 'other' });
    expect(container.querySelector('[data-world-strip="world_tide"] [data-story-head]')?.textContent).toBe('World');
  });
});

describe('a world entry opened', () => {
  it('shows its stickies round it, and the Peer pill beside them; nothing else', () => {
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind: () => {} });
    const pills = [...container.querySelectorAll('[data-focus-slide]')].map((p) => p.getAttribute('data-focus-slide'));
    expect(pills).toEqual(['stickies', 'peer']);
    expect(container.querySelectorAll('[data-focus-satellite]').length).toBe(2);
    expect(screen.getByText('Ada keeps the count anyway.')).toBeTruthy();
  });

  it('changes its kind from the world types', () => {
    const onSetWorldKind = jest.fn();
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind });
    fireEvent.click(container.querySelector('[data-focus-card] [data-kind-pick]') as HTMLElement);
    const options = [...container.querySelectorAll('[data-kind-option]')].map((o) => o.getAttribute('data-kind-option'));
    expect(options).toEqual(['rule', 'history', 'faction', 'place', 'thing', 'other']);
    fireEvent.click(container.querySelector('[data-kind-option="history"]') as HTMLElement);
    expect(onSetWorldKind).toHaveBeenCalledWith('world_tide', 'history');
  });

  it('takes a sticky by hand: the sticky in its head hangs a live one beside it (2026-10-22)', () => {
    const onAddSticky = jest.fn();
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind: () => {}, onAddSticky });
    fireEvent.click(container.querySelector('[data-focus-card] [data-add-sticky]') as HTMLElement);
    const live = container.querySelector('[data-focus-sticky="draft-sticky"] [data-inline-text]') as HTMLElement;
    expect(live).toBeTruthy();
    live.textContent = 'The count is kept in chalk on the harbour wall.';
    fireEvent.blur(live);
    expect(onAddSticky).toHaveBeenCalledWith('world_tide', 'The count is kept in chalk on the harbour wall.');
    // Nothing else a card has: no braindump-into, no delete, no line.
    expect(container.querySelector('[data-focus-card] [data-dump-into]')).toBeNull();
    expect(container.querySelector('[data-focus-card] [data-add-line]')).toBeNull();
  });

  it('has no title line: like the strip, its words are the whole of it', () => {
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind: () => {} });
    expect(container.querySelector('[data-focus-card] [data-inline-text="focus-title"]')).toBeNull();
    expect(container.querySelector('[data-focus-card] [data-inline-text="focus-body"]')?.textContent).toContain('the harbour pretends not to count');
  });
});

describe('the Peer on a world entry (2026-10-22)', () => {
  const question = (id: string, state = 'open'): SandboxFragment => ({
    id, kind: 'question', author: 'peer', text: `Who first noticed the tide's count, ${id}?`, source: '', label: '', about: '', open: state === 'open',
    dumpId: '', attachedTo: 'world_tide', clusterId: null, createdAt: '2026-10-22T10:00:00Z',
    peer: { key: `rule_consequence:${id}`, kind: 'rule_consequence', family: 'development', quote: '', about: ['world_tide'], state, passId: 'p1' },
  });

  it('its Peer pill counts its open questions and hangs them round it', () => {
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind: () => {}, peerQuestions: [question('a'), question('b')], onAnswerQuestion: () => {} });
    const pill = container.querySelector('[data-focus-slide="peer"]') as HTMLElement;
    expect(pill.textContent).toContain('2');
    fireEvent.click(pill);
    expect(container.querySelectorAll('[data-focus-satellite] [data-peer-question]').length).toBe(2);
  });

  it('the glasses ask the Peer about the entry, and its read shows on the Peer pill', () => {
    const onAskPeer = jest.fn();
    const { container } = board({}, { focusId: 'world_tide', onSetWorldKind: () => {}, onAskPeer, peerReads: { world_tide: { text: 'The count is the load-bearing part. Who keeps it is open.', at: '', model: '' } } });
    fireEvent.click(container.querySelector('[data-ask-peer]') as HTMLElement);
    expect(onAskPeer).toHaveBeenCalledWith('world_tide');
    expect(screen.getByText(/The count is the load-bearing part/)).toBeTruthy();
  });

  it('a folded Peer mark on a world entry opens it', () => {
    const onFocus = jest.fn();
    const { container } = board({}, { onFocus, peerQuestions: [question('a')] });
    fireEvent.click(container.querySelector('[data-peer-folded="world_tide"] [data-peer-mark]') as HTMLElement);
    expect(onFocus).toHaveBeenCalledWith('world_tide');
  });
});

describe('a sample\'s world entries on its board', () => {
  it('an entry that names its scene sits beside it; one that does not runs along the top', () => {
    const scene = { id: 'evt_tpl_pill', type: 'event', working_title: 'Red pill', summary: 'The choice.', state: 'parked', template: '1' };
    const ents = [scene] as any[];
    const near = entry({ id: 'world_near', template: true, near: 'evt_tpl_pill', touches: [] });
    const top = entry({ id: 'world_top', template: true, touches: [] });
    const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [], world: [near, top] } as any);
    const at = templateLayout(items, ['evt_tpl_pill'], [], 1440);
    const sceneAt = at.evt_tpl_pill;
    expect(at.world_top.y).toBeLessThan(sceneAt.y);
    const d = Math.hypot(at.world_near.x - sceneAt.x, at.world_near.y - sceneAt.y);
    expect(d).toBeLessThan(520);
  });
});

describe('what a world entry touches is not shown on the cards (2026-10-22)', () => {
  it('an opened character has no "Before the story" pill, an opened scene no World pill', () => {
    const scene = { id: 'evt_storm', type: 'event', working_title: 'The storm night', summary: 'Ada rows out.', state: 'parked' };
    const ents = [...entities, scene] as any[];
    const touching = entry({ touches: [{ id: 'chr_ada', type: 'character', role: 'happened to' }, { id: 'evt_storm', type: 'event', role: 'rests on' }] });
    const items = stageItemsFrom({ entities: ents, fragments: [], badges: [], precedes: [], world: [touching] } as any);
    const positions = defaultLayout(items, {}, { w: 1400 });
    const pillsOf = (focusId: string) => {
      const { container, unmount } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} allEntities={ents} world={[touching]} focusId={focusId} />);
      const ids = [...container.querySelectorAll('[data-focus-slide]')].map((p) => p.getAttribute('data-focus-slide'));
      unmount();
      return ids;
    };
    expect(pillsOf('chr_ada')).not.toContain('before');
    expect(pillsOf('evt_storm')).not.toContain('world');
  });
});

