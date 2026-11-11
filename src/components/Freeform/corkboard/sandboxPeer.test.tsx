// The Peer's questions on the sandbox board (2026-10-20): where each one
// lives, what the sticky shows, and that the board read keeps them out of the
// writer's stickies. Stories and words are invented.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SandboxFragment } from '../../../lib/freeformApi';
import { PeerQuestionSticky, PeerReadSection, peerHomes, readHeadline, receiptLines } from './sandboxPeer';

const q = (id: string, over: Partial<SandboxFragment> = {}, about: string[] = []): SandboxFragment => ({
  id, kind: 'question', author: 'peer', text: `Question ${id}?`, source: 'the lighthouse keeps its own hours', label: '', about: '',
  open: true, dumpId: '', attachedTo: null, clusterId: null, createdAt: `2026-10-20T10:00:0${id.length % 10}Z`,
  peer: { key: `stakes:${id}`, kind: 'stakes', family: 'development', quote: 'the lighthouse keeps its own hours', about, state: 'open', passId: 'p1' },
  ...over,
});

describe('peerHomes', () => {
  const board = new Set(['evt_keeper', 'chr_ada', 'frag_loose']);
  const holders = new Map([['frag_in_group', 'group:frag_head']]);
  const homes = (list: SandboxFragment[]) => peerHomes(list, (id) => board.has(id), (id) => holders.get(id));

  it('hangs a question on the card it is attached to', () => {
    const m = homes([q('a', { attachedTo: 'evt_keeper' }, ['evt_keeper'])]);
    expect([...m.keys()]).toEqual(['evt_keeper']);
  });

  it('puts a question about a sticky by that sticky, or by the group that holds it', () => {
    const m = homes([q('b', {}, ['frag_loose']), q('c', {}, ['frag_in_group'])]);
    expect(m.get('frag_loose')?.map((x) => x.id)).toEqual(['b']);
    expect(m.get('group:frag_head')?.map((x) => x.id)).toEqual(['c']);
  });

  it('gathers several questions on one card, and skips dismissed, closed and homeless ones', () => {
    const m = homes([
      q('d', { attachedTo: 'chr_ada' }),
      q('ee', { attachedTo: 'chr_ada' }),
      q('f', { attachedTo: 'chr_ada', open: false }),
      q('g', { attachedTo: 'chr_ada', peer: { key: 'k', kind: 'stakes', family: 'gap', quote: '', about: [], state: 'closed', passId: '' } }),
      q('h', { attachedTo: 'evt_gone' }, ['evt_gone']),
    ]);
    expect(m.get('chr_ada')?.map((x) => x.id)).toEqual(['d', 'ee']);
    expect(m.size).toBe(1);
  });
});

describe('PeerQuestionSticky', () => {
  it('shows the question without the quote; Answer opens a box on the sticky and Send sends it', () => {
    const onAnswer = jest.fn();
    const onDismiss = jest.fn();
    render(<PeerQuestionSticky q={q('a')} dark={false} onAnswer={onAnswer} onDismiss={onDismiss} />);
    expect(screen.getByText('Question a?')).toBeTruthy();
    expect(screen.queryByText(/the lighthouse keeps its own hours/)).toBeNull();
    expect(screen.getByText('Peer')).toBeTruthy();
    const wrap = () => document.querySelector('[data-peer-answer-wrap]') as HTMLElement;
    expect(wrap().getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByText('Answer'));
    expect(wrap().getAttribute('aria-hidden')).toBe('false');
    const box = screen.getByPlaceholderText('Answer in your own words…');
    fireEvent.change(box, { target: { value: 'She keeps the lamp lit for her brother.' } });
    fireEvent.click(screen.getByText('Send'));
    expect(onAnswer).toHaveBeenCalledWith('She keeps the lamp lit for her brother.');
    expect(wrap().getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds Send while a dump is in flight, and has no Answer with no card to answer on', () => {
    const onAnswer = jest.fn();
    const { unmount } = render(<PeerQuestionSticky q={q('a')} dark={false} onAnswer={onAnswer} answerBusy="Waiting for the dump in flight to land" />);
    fireEvent.click(screen.getByText('Answer'));
    fireEvent.change(screen.getByPlaceholderText('Answer in your own words…'), { target: { value: 'Yes.' } });
    fireEvent.click(screen.getByText('Send'));
    expect(onAnswer).not.toHaveBeenCalled();
    unmount();
    render(<PeerQuestionSticky q={q('b')} dark onDismiss={() => {}} />);
    expect(screen.queryByText('Answer')).toBeNull();
    expect(screen.getByLabelText('A question from the Peer')).toBeTruthy();
  });
});

describe('on the board', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom } = require('./sandboxBoard');
  const entities = [
    { id: 'evt_keeper', type: 'event', working_title: 'The keeper climbs at dusk', summary: 'He climbs.', state: 'parked' },
    { id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' },
  ] as any[];
  const own = { id: 'f_own', kind: 'idea', author: 'writer', text: 'She counts the steps.', source: 'She counts the steps.', label: '', about: '', open: true, dumpId: 'd1', attachedTo: 'chr_ada', clusterId: null, createdAt: '2026-10-20T09:00:00Z' } as SandboxFragment;
  const items = stageItemsFrom({ entities, fragments: [own], badges: [], precedes: [] });
  const positions = defaultLayout(items, {}, { w: 1400 });
  const questions = [q('a', { attachedTo: 'chr_ada' }), q('bb', { attachedTo: 'chr_ada' })];

  it('folded on a titled huddle, the mark takes the bottom corner, clear of the title (2026-10-22)', () => {
    const h1 = { ...own, id: 'f_h1', attachedTo: null, clusterId: 'c1', text: 'The tide takes one boat a year.' } as SandboxFragment;
    const h2 = { ...own, id: 'f_h2', attachedTo: null, clusterId: 'c1', text: 'Nobody rows out on the anniversary.' } as SandboxFragment;
    const badge = { clusterId: 'c1', kind: 'world', worldKind: 'rule', title: 'The tide takes one boat a year', summary: '', touches: [], fragmentIds: ['f_h1', 'f_h2'] };
    const hitems = stageItemsFrom({ entities, fragments: [own, h1, h2], badges: [badge], precedes: [] });
    const hpos = defaultLayout(hitems, {}, { w: 1400 });
    const { container } = render(<SandboxBoard items={hitems} positions={hpos} onMove={() => {}} peerQuestions={[q('h', {}, ['f_h1']), q('c', { attachedTo: 'chr_ada' })]} />);
    expect(container.querySelector('[data-peer-folded="group:c1"]')?.getAttribute('data-peer-corner')).toBe('bottom');
    expect(container.querySelector('[data-peer-folded="chr_ada"]')?.getAttribute('data-peer-corner')).toBe('top');
  });

  it('a question on a world entry takes an answer too (2026-10-21)', () => {
    const world = [{ id: 'world_tide', kind: 'rule', title: 'The tide takes one boat a year', text: 'The tide takes one boat a year', label: '', source: '', touches: [], establishedIn: [] }];
    const witems = stageItemsFrom({ entities, fragments: [own], badges: [], precedes: [], world } as any);
    const wpos = defaultLayout(witems, {}, { w: 1400 });
    const onAnswer = jest.fn();
    const { container } = render(<SandboxBoard items={witems} positions={wpos} onMove={() => {}} peerQuestions={[q('w', { attachedTo: 'world_tide' }, ['world_tide'])]} peerExpanded onAnswerQuestion={onAnswer} />);
    expect(container.querySelector('[data-unfold-peer]')).toBeTruthy();
    fireEvent.click(screen.getByText('Answer'));
    fireEvent.change(screen.getByPlaceholderText('Answer in your own words…'), { target: { value: 'The harbour boys row it out.' } });
    fireEvent.click(screen.getByText('Send'));
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 'w' }), 'world_tide', 'The harbour boys row it out.');
  });

  it('folded: one small Peer sticky with a count on the card; a click opens the card', () => {
    const onFocus = jest.fn();
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={questions} onFocus={onFocus} />);
    const marks = container.querySelectorAll('[data-peer-mark]');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('2');
    expect(container.querySelector('[data-peer-question]')).toBeNull();
    fireEvent.click(marks[0]);
    expect(onFocus).toHaveBeenCalledWith('chr_ada');
    // Never one of the card's own stickies: Ada's edge shows her one sticky.
    expect(container.querySelectorAll('[data-mini-stickies] > span').length).toBe(1);
  });

  it('out on the board: each question beside its card with a line to it, the card keeping its own sticky', () => {
    const onDismiss = jest.fn();
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={questions} peerExpanded onDismissQuestion={onDismiss} onAnswerQuestion={() => {}} />);
    expect(container.querySelector('[data-peer-mark]')).toBeNull();
    expect(container.querySelectorAll('[data-unfold-peer]').length).toBe(2);
    expect(container.querySelectorAll('[data-unfold-line]').length).toBe(2);
    expect(container.querySelectorAll('[data-mini-stickies] > span').length).toBe(1);
    fireEvent.click(screen.getAllByText('Dismiss')[0]);
    expect(onDismiss).toHaveBeenCalledWith('a');
  });

  it('the opened card has a Peer pill; its questions hang round the card', () => {
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={questions} focusId="chr_ada" allEntities={entities} onAnswerQuestion={() => {}} />);
    const pill = container.querySelector('[data-focus-slide="peer"]') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('2');
    expect(container.querySelector('[data-focus-satellite] [data-peer-question]')).toBeNull();
    fireEvent.click(pill);
    expect(container.querySelectorAll('[data-focus-satellite] [data-peer-question]').length).toBe(2);
    expect(screen.getAllByText('Answer').length).toBe(2);
    // No read yet: the card's Peer section points at the glasses on the card.
    expect(container.querySelector('[data-focus-card] [data-peer-read]')?.textContent).toContain('No read yet');
  });

  it('the ask is on the opened card; it turns to the Peer pill', () => {
    const onAskPeer = jest.fn();
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[]} focusId="chr_ada" allEntities={entities} onAskPeer={onAskPeer} />);
    const ask = container.querySelector('[data-focus-card] [data-ask-peer]') ?? container.querySelector('[data-ask-peer]');
    expect(ask).toBeTruthy();
    fireEvent.click(ask as HTMLElement);
    expect(onAskPeer).toHaveBeenCalledWith('chr_ada');
    expect(container.querySelector('[data-focus-slide="peer"]')?.hasAttribute('data-on')).toBe(true);
  });

  it('the Peer pill shows the kept read; the card asks again', () => {
    const onAskPeer = jest.fn();
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[]} focusId="chr_ada" allEntities={entities}
      peerReads={{ chr_ada: { text: 'Ada keeps the light for someone who is not coming back.', at: '', model: '' } }} onAskPeer={onAskPeer} />);
    fireEvent.click(container.querySelector('[data-focus-slide="peer"]') as HTMLElement);
    expect(screen.getByText('Ada keeps the light for someone who is not coming back.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Ask the Peer again'));
    expect(onAskPeer).toHaveBeenCalledWith('chr_ada');
  });
});

describe('taken in', () => {
  const answered = (state: string, receipt: any = null) => q('a', { open: state !== 'answered', peer: { key: 'k', kind: 'stakes', family: 'development', quote: '', about: [], state, passId: '', answer: 'Her brother, who never came back from the boats.', receipt } });

  it('while being read in: the answer on the paper and a live line', () => {
    render(<PeerQuestionSticky q={answered('answering')} dark={false} live="Found 2 things for this scene" />);
    expect(screen.getByText('Her brother, who never came back from the boats.')).toBeTruthy();
    expect(screen.getByText('Found 2 things for this scene')).toBeTruthy();
    expect(screen.getByText('Taking it in')).toBeTruthy();
  });

  it('answered: what the answer added, and Done folds it', () => {
    const onFold = jest.fn();
    const receipt = { stickies: [{ id: 's1', text: 'x', on: 'evt', onTitle: 'The keeper climbs' }, { id: 's2', text: 'y', on: 'evt', onTitle: 'The keeper climbs' }], cards: [{ id: 'c', type: 'character', title: 'Her brother' }] };
    render(<PeerQuestionSticky q={answered('answered', receipt)} dark onFold={onFold} />);
    expect(screen.getByText('2 stickies on The keeper climbs')).toBeTruthy();
    expect(screen.getByText('New character: Her brother')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(onFold).toHaveBeenCalled();
  });

  it('answered through the answer read: each placement where it landed, and Undo', () => {
    const onUndo = jest.fn();
    const receipt = {
      stickies: [], cards: [],
      notes: [{ id: 'n1', on: 'chr_ada', onTitle: 'Ada', onType: 'character', text: 'Ada keeps the lamp lit for her brother.' }],
      ties: [{ from: 'chr_ada', to: 'chr_bo', fromTitle: 'Ada', toTitle: 'Bo', label: 'sister of' }],
      world: [{ id: 'w1', kind: 'rule', title: 'Keepers never leave the rock in winter.' }],
      offered: [{ id: 'q2', question: 'Is the lamp lit every night, or only for him?', against: 'the scene', onTitle: 'The keeper climbs' }],
    };
    render(<PeerQuestionSticky q={answered('answered', receipt)} dark={false} onUndo={onUndo} onFold={() => {}} />);
    expect(screen.getByText('On Ada: Ada keeps the lamp lit for her brother.')).toBeTruthy();
    expect(screen.getByText('Tie: Ada \u2192 Bo, sister of')).toBeTruthy();
    expect(screen.getByText('World: Keepers never leave the rock in winter.')).toBeTruthy();
    expect(screen.getByText('Asked back: Is the lamp lit every night, or only for him?')).toBeTruthy();
    fireEvent.click(screen.getByText('Undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('taken back: the answer stays, the receipt says so, and Undo is gone', () => {
    const receipt = { stickies: [], cards: [], notes: [{ id: 'n1', on: 'chr_ada', onTitle: 'Ada', onType: 'character', text: 'x' }], undone: true };
    render(<PeerQuestionSticky q={answered('answered', receipt)} dark={false} onUndo={() => {}} />);
    expect(screen.getByText('Taken back')).toBeTruthy();
    expect(screen.getByText(/Your answer stays here/)).toBeTruthy();
    expect(screen.queryByText('Undo')).toBeNull();
    expect(screen.getByText('Her brother, who never came back from the boats.')).toBeTruthy();
  });

  it('when the Peer could not place it, the answer is kept and it says so', () => {
    render(<PeerQuestionSticky q={answered('answered', { stickies: [], cards: [], notes: [], failed: true })} dark={false} />);
    expect(screen.getByText(/could not place it just now/)).toBeTruthy();
  });

  it('an answer that added nothing new still says it was kept', () => {
    render(<PeerQuestionSticky q={answered('answered', { stickies: [], cards: [] })} dark={false} />);
    expect(screen.getByText(/Kept with the question/)).toBeTruthy();
    expect(receiptLines(null)).toEqual([]);
  });
});

describe('the read and answers on the board', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom, dumpNumbers } = require('./sandboxBoard');
  const entities = [{ id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' }] as any[];
  const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes: [] });
  const positions = defaultLayout(items, {}, { w: 1400 });

  it('turning to the Peer pill fires nothing; the Peer button on the card is the one ask', () => {
    const ask = jest.fn();
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} focusId="chr_ada" allEntities={entities} onAskPeer={ask} />);
    fireEvent.click(container.querySelector('[data-focus-slide="peer"]') as HTMLElement);
    expect(ask).not.toHaveBeenCalled();
    expect(container.querySelector('[data-read-peer]')).toBeNull();
    fireEvent.click(container.querySelector('[data-ask-peer]') as HTMLElement);
    expect(ask).toHaveBeenCalledWith('chr_ada');
  });

  it('a kept read shows as the take on the Peer pill', () => {
    const r2 = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} focusId="chr_ada" allEntities={entities} onAskPeer={() => {}} peerReads={{ chr_ada: { text: 'Ada keeps the light.', at: '', model: '' } }} />);
    fireEvent.click(r2.container.querySelector('[data-focus-slide="peer"]') as HTMLElement);
    expect(r2.container.querySelector('[data-focus-card] [data-peer-read]')).toBeTruthy();
  });

  it('folded, a question being answered still sits out beside its card', () => {
    const live = q('a', { attachedTo: 'chr_ada', open: false, peer: { key: 'k', kind: 'stakes', family: 'development', quote: '', about: [], state: 'answering', passId: '', answer: 'Because the lamp was his.' } });
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[live]} />);
    expect(container.querySelector('[data-unfold-peer] [data-peer-state="answering"]')).toBeTruthy();
  });

  it("an answer's stickies are never numbered as a dump", () => {
    const f = (id: string, dumpId: string, fromAnswer?: string) => ({ id, kind: 'note', author: 'extractor', text: id, source: id, label: '', about: '', open: true, dumpId, attachedTo: 'chr_ada', clusterId: null, createdAt: '2026-10-20T00:00:00Z', ...(fromAnswer ? { fromAnswer } : {}) });
    expect([...dumpNumbers([f('a', 'd1'), f('b', 'bd_ans', 'q1')]).keys()]).toEqual(['d1']);
  });
});

describe('the take and the feedback', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom } = require('./sandboxBoard');
  const read = 'The Clerk has power over the bakeries, but his own stake in that power is still open. Everyone knows his title.';

  it('the read is a section of the card: its headline shows, the rest opens in the card on a click', () => {
    expect(readHeadline(read)).toEqual({ head: 'The Clerk has power over the bakeries, but his own stake in that power is still open.', rest: 'Everyone knows his title.' });
    render(<PeerReadSection text={read} busy={false} dark={false} frame="#3b82f6" />);
    expect(screen.getByText("The Peer's read")).toBeTruthy();
    expect(screen.getByText('The Clerk has power over the bakeries, but his own stake in that power is still open.')).toBeTruthy();
    const rest = () => document.querySelector('[data-peer-read-rest]') as HTMLElement;
    expect(rest().getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByText('Show the whole read'));
    expect(rest().getAttribute('aria-hidden')).toBe('false');
    expect(rest().textContent).toBe('Everyone knows his title.');
  });

  it('says how an ask went, under the read', () => {
    render(<PeerReadSection text="" busy={false} note="No new questions this time. Answer the open one, or dump more into this card." dark frame="#3b82f6" />);
    expect(screen.getByText(/No new questions this time/)).toBeTruthy();
  });

  const entities = [
    { id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' },
    { id: 'chr_bo', type: 'character', working_name: 'Bo', description: 'Her brother.', state: 'parked' },
  ] as any[];
  const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes: [] });
  const positions = defaultLayout(items, {}, { w: 1400 });

  it('while the pass reads, every card breathes; where a question lands, the card pulses', () => {
    const { container, rerender } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerReading />);
    expect(container.querySelectorAll('[data-stage-item].ff-peer-reading').length).toBe(2);
    const fresh = q('a', { attachedTo: 'chr_ada' });
    rerender(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[fresh]} peerExpanded peerFresh={new Set(['a'])} />);
    expect(container.querySelector('[data-stage-item="chr_ada"]')?.className).toContain('ff-peer-landed');
    expect(container.querySelector('[data-stage-item="chr_bo"]')?.className ?? '').not.toContain('ff-peer-landed');
    expect(container.querySelector('[data-peer-fresh]')).toBeTruthy();
  });

  it('the card breathes while the Peer reads it', () => {
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} focusId="chr_ada" allEntities={entities} onAskPeer={() => {}} peerAskBusy="chr_ada" />);
    expect(container.querySelector('[data-focus-card] [data-peer-breathing]')).toBeTruthy();
  });
});

describe('the Peer receipt and its walk', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom } = require('./sandboxBoard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxReceipt } = require('./sandboxReceipt');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { unfoldAround } = require('./sandboxRing');

  it('is Peer-coded, never "from your dump"', () => {
    render(<SandboxReceipt peer items={[{ targetId: 'chr_ada', questionId: 'a', line: 'peer', where: 'On Ada', heading: 'Question a?', quote: '', hint: 'Click the question on the board to answer it.' }]} lede={'The Peer read the board \u00b7 1 question'} onStep={() => {}} onDone={() => {}} />);
    expect(screen.getByText('From the Peer')).toBeTruthy();
    expect(screen.getByText('Click the question on the board to answer it.')).toBeTruthy();
    expect(screen.queryByText('From your dump')).toBeNull();
    expect(screen.getByLabelText('From the Peer')).toBeTruthy();
    // An escape written straight into JSX text renders as "\\u2197", not the arrow.
    const hint = document.querySelector('[data-receipt-hint]')!;
    expect(hint.textContent).toContain('\u2197');
    expect(document.body.textContent).not.toMatch(/\\u[0-9a-f]{4}/i);
  });

  it('rings the question it is on, out on the board beside its card', () => {
    const entities = [{ id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' }] as any[];
    const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes: [] });
    const positions = defaultLayout(items, {}, { w: 1400 });
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[q('a', { attachedTo: 'chr_ada' })]} peerExpanded peerSpot="a" />);
    expect(container.querySelector('[data-focus-card]')).toBeNull();
    expect(container.querySelector('[data-unfold-peer] [data-peer-question="a"][data-peer-spot]')).toBeTruthy();
  });

  it("never runs a question's line under another card", () => {
    // Mara at the board's left edge, Felix to her right, a world card right below her.
    const mara = { x: 20, y: 50, w: 220, h: 112 };
    const felix = { x: 260, y: 50, w: 220, h: 112 };
    const world = { x: 20, y: 200, w: 260, h: 130 };
    const at = unfoldAround([{ rect: mara, items: [{ key: 'q', w: 168, h: 130 }] }], [mara, felix, world], 28, 1400).get('q');
    const a = { x: mara.x + mara.w / 2, y: mara.y + mara.h / 2 }, b = { x: at.x + 84, y: at.y + 65 };
    for (let t = 0.1; t < 0.9; t += 0.05) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      for (const o of [felix, world]) expect(x > o.x + 4 && x < o.x + o.w - 4 && y > o.y + 4 && y < o.y + o.h - 4).toBe(false);
    }
  });
});

describe('opening a question to answer it', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom } = require('./sandboxBoard');
  const entities = [
    { id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' },
    { id: 'chr_bo', type: 'character', working_name: 'Bo', description: 'Her brother.', state: 'parked' },
  ] as any[];
  const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes: [] });
  const positions = defaultLayout(items, {}, { w: 1400 });

  it('a click anywhere on the sticky opens it; Dismiss only dismisses', () => {
    const onDismiss = jest.fn();
    render(<PeerQuestionSticky q={q('a')} dark={false} clickOpens onAnswer={() => {}} onDismiss={onDismiss} />);
    const wrap = () => document.querySelector('[data-peer-answer-wrap]') as HTMLElement;
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
    expect(wrap().getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByText('Question a?'));
    expect(wrap().getAttribute('aria-hidden')).toBe('false');
  });

  it('on the board it grows in place: the question never moves when it opens', () => {
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[q('a', { attachedTo: 'chr_ada' })]} peerExpanded onAnswerQuestion={() => {}} />);
    const slot = () => (container.querySelector('[data-unfold-peer]') as HTMLElement).style.transform;
    const before = slot();
    fireEvent.click(screen.getByText('Question a?'));
    expect(container.querySelector('[data-peer-answer-wrap]')?.getAttribute('aria-hidden')).toBe('false');
    expect(slot()).toBe(before);
  });

  it('in a card\'s ring, a still click opens it', () => {
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} focusId="chr_ada" allEntities={entities} peerQuestions={[q('a', { attachedTo: 'chr_ada' })]} onAnswerQuestion={() => {}} />);
    fireEvent.click(container.querySelector('[data-focus-slide="peer"]') as HTMLElement);
    const sat = container.querySelector('[data-focus-satellite]') as HTMLElement;
    fireEvent.pointerDown(sat, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(sat, { clientX: 100, clientY: 100, button: 0 });
    expect(container.querySelector('[data-focus-satellite] [data-peer-answer-wrap]')?.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('a pass receipt shows only what is new', () => {
  if (!(window as any).PointerEvent) (window as any).PointerEvent = class extends MouseEvent { pointerId = 1; };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SandboxBoard, defaultLayout, stageItemsFrom } = require('./sandboxBoard');
  const entities = [{ id: 'chr_ada', type: 'character', working_name: 'Ada', description: 'The keeper.', state: 'parked' }] as any[];
  const items = stageItemsFrom({ entities, fragments: [], badges: [], precedes: [] });
  const positions = defaultLayout(items, {}, { w: 1400 });

  it('only the questions the pass just left come out; the older ones stay folded on the card', () => {
    const older = q('old', { attachedTo: 'chr_ada', createdAt: '2026-10-19T00:00:00Z' });
    const fresh = q('new', { attachedTo: 'chr_ada', createdAt: '2026-10-21T00:00:00Z' });
    const { container } = render(<SandboxBoard items={items} positions={positions} onMove={() => {}} peerQuestions={[older, fresh]} peerSpotlight={new Set(['new'])} />);
    const out = Array.from(container.querySelectorAll('[data-unfold-peer] [data-peer-question]')).map((e) => e.getAttribute('data-peer-question'));
    expect(out).toEqual(['new']);
    const mark = container.querySelector('[data-peer-mark]');
    expect(mark).toBeTruthy();
    expect(mark?.textContent).toBe('');
  });
});
