// Card colours (2026-10-09): the dot's palette, the legend's naming and
// additive filter, the counts, and the vocabulary budget on all of it.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorDot, ColorLegend, setNameOf, colorCounts, colorIn, colorMatches, nameOf, SetSwitcher, SequenceStrip, StripCard, sequencesInOrder, subplotsFrom, subplotPath, SubplotStrip } from './storylineLabels';
import { stageItemsFrom } from './sandboxBoard';
import type { LabelSet, ProjectEntity } from '../../../lib/freeformApi';

const scenes = [
  { id: 'e1', type: 'event', working_title: 'One', card_color: '#7e22ce' },
  { id: 'e2', type: 'event', working_title: 'Two', card_color: '#7e22ce' },
  { id: 'e3', type: 'event', working_title: 'Three', card_color: '#b45309' },
  { id: 'e4', type: 'event', working_title: 'Four' },
  { id: 'c1', type: 'character', working_name: 'Who', card_color: '#be123c' },
] as unknown as ProjectEntity[];
const set: LabelSet = { dimension: 'Storyline', labels: [{ id: 'lab_7e22ce', name: "Teo's thread", color: '#7e22ce' }] };

test('counts are per colour over scenes only; a name is found by colour', () => {
  expect([...colorCounts(scenes).entries()]).toEqual([['#7e22ce', 2], ['#b45309', 1]]);
  expect(nameOf(set, '#7e22ce')).toBe("Teo's thread");
  expect(nameOf(set, '#b45309')).toBeUndefined();
});

test('the filter is additive and empty means everything', () => {
  expect(colorMatches(scenes[0], new Set())).toBe(true);
  expect(colorMatches(scenes[0], new Set(['#b45309']))).toBe(false);
  expect(colorMatches(scenes[0], new Set(['#b45309', '#7e22ce']))).toBe(true);
  expect(colorMatches(scenes[3], new Set(['#7e22ce']))).toBe(false);
  expect(colorMatches(scenes[4], new Set(['#7e22ce']))).toBe(true); // not a scene: never dimmed
});

test('the dot opens the palette; a swatch picks, the named colour is offered by name, None clears', () => {
  const onPick = jest.fn();
  render(<ColorDot value={undefined} set={set} dark={false} onPick={onPick} />);
  fireEvent.click(screen.getByLabelText('Color this card'));
  fireEvent.click(document.querySelector('[data-color-swatch="#b45309"]')!);
  expect(onPick).toHaveBeenLastCalledWith('#b45309');
  fireEvent.click(screen.getByLabelText('Color this card'));
  fireEvent.click(document.querySelector('[data-color-named="#7e22ce"]')!);
  expect(onPick).toHaveBeenLastCalledWith('#7e22ce');
  fireEvent.click(screen.getByLabelText('Color this card'));
  fireEvent.click(document.querySelector('[data-color-none]')!);
  expect(onPick).toHaveBeenLastCalledWith('');
});

test('the legend names a colour in place and filters additively', () => {
  const onToggle = jest.fn(); const onName = jest.fn(); const onClear = jest.fn();
  const { container, rerender } = render(<ColorLegend set={set} counts={colorCounts(scenes)} active={new Set()} dark={false} onToggle={onToggle} onClear={onClear} onName={onName} />);
  expect(container.textContent).toMatch(/Teo's thread/);
  expect(container.textContent).toMatch(/2/);
  fireEvent.click(container.querySelector('[data-legend-swatch="#b45309"]')!);
  expect(onToggle).toHaveBeenCalledWith('#b45309');
  const nm = container.querySelector('[data-inline-text="legend-name-#b45309"]') as HTMLElement;
  nm.textContent = 'The captain';
  fireEvent.blur(nm);
  expect(onName).toHaveBeenCalledWith('#b45309', 'The captain');
  rerender(<ColorLegend set={set} counts={colorCounts(scenes)} active={new Set(['#b45309'])} dark={false} onToggle={onToggle} onClear={onClear} onName={onName} />);
  fireEvent.click(container.querySelector('[data-legend-clear]')!);
  expect(onClear).toHaveBeenCalled();
  expect(container.textContent).not.toMatch(/fragment|huddle|cluster|badge|extractor|lens/i);
});

// FIL-707: several sets. The first set reads card_color; any other reads
// the card's set_colors; the switcher picks, makes and removes; one set paints.
test('a card has a colour per set; counts and the filter follow the set asked for', () => {
  const acts = [
    { id: 'e1', type: 'event', card_color: '#7e22ce', set_colors: { set_acts: '#4d7c0f' } },
    { id: 'e2', type: 'event', card_color: '#7e22ce' },
  ] as unknown as ProjectEntity[];
  expect(colorIn(acts[0])).toBe('#7e22ce');
  expect(colorIn(acts[0], 'main')).toBe('#7e22ce');
  expect(colorIn(acts[0], 'set_acts')).toBe('#4d7c0f');
  expect(colorIn(acts[1], 'set_acts')).toBeUndefined();
  expect([...colorCounts(acts, 'set_acts').entries()]).toEqual([['#4d7c0f', 1]]);
  expect(colorMatches(acts[1], new Set(['#4d7c0f']), 'set_acts')).toBe(false);
  expect(colorMatches(acts[0], new Set(['#4d7c0f']), 'set_acts')).toBe(true);
});

test('the switcher lists the sets, makes one, and removes one only after asking', () => {
  const onPick = jest.fn(); const onNew = jest.fn(); const onRemove = jest.fn();
  const sets = [{ id: 'main', name: 'Storyline', colors: ['#7e22ce'] }, { id: 'set_acts', name: 'Acts', colors: [] }];
  const { container, rerender } = render(<SetSwitcher sets={sets} current="main" dark={false} onPick={onPick} onNew={onNew} onRemove={onRemove} />);
  fireEvent.click(container.querySelector('[data-set-switcher]')!);
  expect(screen.getByText('Group scenes by')).toBeTruthy();
  expect(document.querySelector('[data-set-remove="main"]')).toBeNull();
  fireEvent.click(document.querySelector('[data-set-choice="set_acts"]')!);
  expect(onPick).toHaveBeenCalledWith('set_acts');
  rerender(<SetSwitcher sets={sets} current="set_acts" dark={false} onPick={onPick} onNew={onNew} onRemove={onRemove} />);
  fireEvent.click(container.querySelector('[data-set-switcher]')!);
  fireEvent.click(document.querySelector('[data-set-remove="set_acts"]')!);
  expect(onRemove).not.toHaveBeenCalled();
  expect(document.body.textContent).toMatch(/Remove Acts\? Its colors come off the cards; the cards stay\./);
  fireEvent.click(document.querySelector('[data-set-remove-yes]')!);
  expect(onRemove).toHaveBeenCalledWith('set_acts');
  // The menu stays open after a remove, to go on managing sets.
  fireEvent.click(document.querySelector('[data-set-new]')!);
  expect(onNew).toHaveBeenCalled();
});


test('an empty set still shows its strip with a hint', () => {
  const { container } = render(<ColorLegend set={{ dimension: 'Acts', labels: [] }} counts={new Map()} active={new Set()} dark={false} onToggle={() => {}} onClear={() => {}} emptyHint="Color a scene with its dot to start this set" />);
  expect(container.querySelector('[data-legend-empty]')!.textContent).toBe('Color a scene with its dot to start this set');
});

// FIL-709: sequences live in the strip. Story order from their PRECEDES chain
// (then when made), a colour each, their scenes; off the board.
const seqEntities = [
  { id: 'seq_b', type: 'sequence', working_title: 'Survey boat', state: 'parked', created_at: '2026-11-01T00:00:02Z' },
  { id: 'seq_a', type: 'sequence', working_title: 'Runs the station', state: 'parked', created_at: '2026-11-01T00:00:03Z', color: '#0e7490' },
  { id: 'seq_c', type: 'sequence', working_title: 'To a journalist', state: 'parked', created_at: '2026-11-01T00:00:01Z' },
  { id: 'seq_gone', type: 'sequence', working_title: 'Deleted', state: 'parked', deleted_at: 'x' },
  { id: 'seq_master', type: 'sequence', working_title: 'On the master' },
  { id: 'e1', type: 'event', working_title: 'Readings', state: 'parked' },
  { id: 'e2', type: 'event', working_title: 'Book', state: 'parked' },
] as unknown as ProjectEntity[];
const seqEdges = { sequence_precedes: [{ from: 'seq_a', to: 'seq_b' }], contains: [{ from: 'seq_a', to: 'e1' }, { from: 'seq_a', to: 'e2' }] } as any;

test('sequences come in story order, with a colour each and their scenes', () => {
  const chips = sequencesInOrder(seqEntities, seqEdges);
  // seq_c heads alone (made first); seq_a heads the chain a > b.
  expect(chips.map((c) => c.id)).toEqual(['seq_c', 'seq_a', 'seq_b']);
  expect(chips.find((c) => c.id === 'seq_a')!.color).toBe('#0e7490');
  expect(new Set(chips.map((c) => c.color)).size).toBe(3);
  expect(chips.find((c) => c.id === 'seq_a')!.scenes).toEqual(['e1', 'e2']);
  expect(sequencesInOrder(seqEntities.filter((e) => e.type !== 'sequence'), seqEdges)).toEqual([]);
});

test('a sequence is drawn on the board as a beat (sandbox-beats); its scenes carry its colour', () => {
  const chips = sequencesInOrder(seqEntities, seqEdges);
  const colors = new Map<string, string>(); for (const c of chips) for (const sid of c.scenes) colors.set(sid, c.color);
  const items = stageItemsFrom({ entities: seqEntities, fragments: [], badges: [], precedes: [], sequenceColors: colors });
  expect(items.some((i) => i.kind === 'card' && i.entity.type === 'sequence')).toBe(true);
  const e1 = items.find((i) => i.id === 'e1') as any;
  expect(colorIn(e1.entity, 'sequences')).toBe('#0e7490');
});

test('the Sequences strip: numbered chips, the name opens, the swatch filters, a drag reorders', () => {
  const chips = sequencesInOrder(seqEntities, seqEdges);
  const onOpen = jest.fn(); const onToggle = jest.fn(); const onReorder = jest.fn(); const onNew = jest.fn();
  const { container } = render(<SequenceStrip chips={chips} dark={false} active={new Set()} onToggle={onToggle} onClear={() => {}} onOpen={onOpen} onNew={onNew} onReorder={onReorder} />);
  expect(container.textContent).toMatch(/Sequences1To a journalist2Runs the station23Survey boat\+Sequence/);
  fireEvent.click(container.querySelector('[data-seq-open="seq_a"]')!);
  expect(onOpen).toHaveBeenCalledWith('seq_a');
  fireEvent.click(container.querySelector('[data-seq-swatch="seq_a"]')!);
  expect(onToggle).toHaveBeenCalledWith('#0e7490');
  fireEvent.click(container.querySelector('[data-seq-new]')!);
  expect(onNew).toHaveBeenCalled();
  const dt = { setData: () => {}, effectAllowed: '' };
  fireEvent.dragStart(container.querySelector('[data-seq-chip="seq_b"]')!, { dataTransfer: dt });
  fireEvent.dragOver(container.querySelector('[data-seq-chip="seq_c"]')!, { dataTransfer: dt });
  fireEvent.drop(container.querySelector('[data-seq-chip="seq_c"]')!, { dataTransfer: dt });
  expect(onReorder).toHaveBeenCalledWith(['seq_b', 'seq_c', 'seq_a']);
});

test('the Sequences set is never offered for removal', () => {
  const { container } = render(<SetSwitcher sets={[{ id: 'main', name: 'Storyline', colors: [] }, { id: 'sequences', name: 'Sequences', colors: ['#0e7490'] }]} current="sequences" dark={false} onPick={() => {}} onNew={() => {}} onRemove={() => {}} />);
  fireEvent.click(container.querySelector('[data-set-switcher]')!);
  expect(document.querySelector('[data-set-remove]')).toBeNull();
});

// FIL-708: a pill opens in place as a small index card in the strip.
test('a chip opens in place as a small card: kicker, name, words, + scene, Open card, close', () => {
  const onAdd = jest.fn(); const onOpenCard = jest.fn(); const onClose = jest.fn();
  const { container } = render(<StripCard kicker="Sequence 2 · 3 scenes" name="Readings edited" words="She finds the gauge readings edited." color="#0e7490" dark={false} hint="Click a scene to add it" onAddScene={onAdd} onOpenCard={onOpenCard} onClose={onClose} />);
  expect(container.querySelector('[data-strip-kicker]')!.textContent).toBe('Sequence 2 · 3 scenes');
  expect(container.querySelector('[data-strip-name]')!.textContent).toBe('Readings edited');
  expect(container.querySelector('[data-strip-words]')!.textContent).toBe('She finds the gauge readings edited.');
  fireEvent.click(container.querySelector('[data-strip-add-scene]')!); expect(onAdd).toHaveBeenCalled();
  fireEvent.click(container.querySelector('[data-strip-open-card]')!); expect(onOpenCard).toHaveBeenCalled();
  fireEvent.click(container.querySelector('[data-strip-close]')!); expect(onClose).toHaveBeenCalled();
});

test('with chips that open, a click opens the chip instead of filtering, and the open one draws as its card', () => {
  const chips = sequencesInOrder(seqEntities, seqEdges);
  const onOpen = jest.fn(); const onToggle = jest.fn();
  const { container, rerender } = render(<SequenceStrip chips={chips} dark={false} active={new Set()} onToggle={onToggle} onClear={() => {}} onOpen={onOpen} openId={null} renderOpen={(c, n) => <div data-open-card>{n} {c.name}</div>} />);
  fireEvent.click(container.querySelector('[data-seq-swatch="seq_a"]')!);
  expect(onOpen).toHaveBeenCalledWith('seq_a'); expect(onToggle).not.toHaveBeenCalled();
  rerender(<SequenceStrip chips={chips} dark={false} active={new Set()} onToggle={onToggle} onClear={() => {}} onOpen={onOpen} openId="seq_a" renderOpen={(c, n) => <div data-open-card>{n} {c.name}</div>} />);
  expect(container.querySelector('[data-open-card]')!.textContent).toBe('2 Runs the station');
  expect(container.querySelector('[data-seq-chip="seq_a"]')).toBeNull();

  const onOpenChip = jest.fn();
  const { container: legend, rerender: again } = render(<ColorLegend set={set} counts={colorCounts(scenes)} active={new Set()} dark={false} onToggle={onToggle} onClear={() => {}} onOpenChip={onOpenChip} openKey={null} renderOpen={(c) => <div data-open-label>{c}</div>} scroll />);
  fireEvent.click(legend.querySelector('[data-legend-open="#7e22ce"]')!);
  expect(onOpenChip).toHaveBeenCalledWith('#7e22ce'); expect(onToggle).not.toHaveBeenCalled();
  // An open label whose last scene left stays open.
  again(<ColorLegend set={set} counts={colorCounts(scenes)} active={new Set()} dark={false} onToggle={onToggle} onClear={() => {}} onOpenChip={onOpenChip} openKey="#4d7c0f" renderOpen={(c) => <div data-open-label>{c}</div>} scroll />);
  expect(legend.querySelector('[data-open-label]')!.textContent).toBe('#4d7c0f');
});

// FIL-711: subplots. The story's arcs (never a character's own), their sandbox
// scenes in story order with transitions, the path with its open end.
const subEntities = [
  { id: 'arc_cover', type: 'arc', working_name: 'The cover-up', created_at: '1', color: '#b91c1c' },
  { id: 'arc_job', type: 'arc', working_name: "Nell's job", created_at: '2' },
  { id: 'arc_char', type: 'arc', working_name: 'Nell changes', character_id: 'chr_nell', created_at: '3' },
  { id: 's1', type: 'event', working_title: 'Readings', state: 'parked' },
  { id: 's3', type: 'event', working_title: 'Mainland job', state: 'parked' },
  { id: 's4', type: 'event', working_title: 'Causeway', state: 'parked' },
  { id: 'm1', type: 'event', working_title: 'On the master' },
] as unknown as ProjectEntity[];
const subEdges = { evokes: [
  { event_id: 's4', arc_id: 'arc_cover', transition: 'complicates' },
  { event_id: 's1', arc_id: 'arc_cover', transition: 'introduces' },
  { event_id: 'm1', arc_id: 'arc_cover', transition: 'develops' },
  { event_id: 's3', arc_id: 'arc_job', transition: '' },
] } as any;
const rank = (id: string) => ['s1', 's3', 's4'].indexOf(id);

test('subplots: arcs only (not a character arc), sandbox scenes in story order, transitions, colours', () => {
  const subs = subplotsFrom(subEntities, subEdges, rank);
  expect(subs.map((x) => x.id)).toEqual(['arc_cover', 'arc_job']);
  expect(subs[0].color).toBe('#b91c1c');
  expect(subs[0].scenes).toEqual([{ id: 's1', transition: 'introduces' }, { id: 's4', transition: 'complicates' }]);
  expect(subs[1].scenes).toEqual([{ id: 's3', transition: '' }]);
  expect(subplotPath(subs[0])).toBe('introduces › complicates');
  expect(subplotPath(subs[1])).toBe('');
  expect(subplotPath({ ...subs[0], scenes: [{ id: 's1', transition: 'introduces' }, { id: 's4', transition: 'resolves' }] })).toBe('introduces › resolves');
});

test('the Subplots strip: chips, dashed suggestions, + subplot, and it says it never paints', () => {
  const subs = subplotsFrom(subEntities, subEdges, rank);
  const onOpen = jest.fn(); const onNew = jest.fn();
  const sugg = [{ id: 'sugg:g1', suggestionId: 'g1', name: 'Nell and Tam', color: '#64748b', description: '', scenes: [] }];
  const { container } = render(<SubplotStrip chips={subs} suggestions={sugg} dark={false} onOpen={onOpen} onNew={onNew} openId={null} renderOpen={() => <div />} />);
  expect(container.textContent).toMatch(/SubplotsThe cover-up2Nell's job1Nell and TamSuggested\+SubplotShown as dots on scenes/);
  fireEvent.click(container.querySelector('[data-subplot-chip="sugg:g1"]')!);
  expect(onOpen).toHaveBeenCalledWith('sugg:g1');
  fireEvent.click(container.querySelector('[data-subplot-new]')!);
  expect(onNew).toHaveBeenCalled();
});


// An opened sequence or subplot is a sandbox card (Ben, 2026-11-03): its
// scenes are its category, a subplot's carrying their transitions; the Peer
// pill sits between, as on scenes and characters.
test('an opened sequence or subplot: Stickies, Peer, then its Scenes; a subplot kicker per transition', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { focusSlides } = require('./sandboxFocus');
  const ents = [...seqEntities, ...subEntities] as ProjectEntity[];
  const seq = focusSlides({ kind: 'card', entity: ents.find((e) => e.id === 'seq_a'), attached: [] }, { entities: ents, edges: seqEdges, onBoard: new Set(['e1', 'e2']), peerCount: 0 });
  expect(seq.map((x: any) => x.id)).toEqual(['stickies', 'peer', 'scenes']);
  expect(seq[2].rows.map((r: any) => r.id)).toEqual(['e1', 'e2']);
  const sub = focusSlides({ kind: 'card', entity: ents.find((e) => e.id === 'arc_cover'), attached: [] }, { entities: ents, edges: subEdges, onBoard: new Set(), peerCount: 0 });
  expect(sub.map((x: any) => x.id)).toEqual(['stickies', 'peer', 'scenes']);
  expect(sub[2].rows.map((r: any) => `${r.kicker}:${r.id}`)).toEqual(['complicates:s4', 'introduces:s1', 'develops:m1']);
});

// The track (Ben, 2026-11-03): each sequence leads into the next.
test('the Sequences strip joins its chips in order, one link between each pair', () => {
  const chips = sequencesInOrder(seqEntities, seqEdges);
  const { container } = render(<SequenceStrip chips={chips} dark={false} active={new Set()} onToggle={() => {}} onClear={() => {}} onOpen={() => {}} openId={null} renderOpen={() => <div />} />);
  expect(container.querySelectorAll('[data-seq-link]').length).toBe(chips.length - 1);
});

// Ben, 2026-11-04: the switcher names the set and reads as a button, each set
// says what it is, the first set is "Custom labels"; hiding the strip is the
// toolbar's job, not the menu's.
test('the set switcher names the set, shows what each one is, and renames or removes any set of yours from its own row', () => {
  const onRename = jest.fn(); const onRemove = jest.fn(); const onPick = jest.fn();
  const sets = [{ id: 'main', name: setNameOf('Label'), colors: [], hint: 'Your own colors.' }, { id: 'set_2', name: 'New set', colors: [], hint: 'A set you made.' }, { id: 'sequences', name: 'Sequences', colors: [], hint: 'Stretches of the story.' }];
  const { container } = render(<SetSwitcher sets={sets} current="main" dark={false} onPick={onPick} onNew={() => {}} onRename={onRename} onRemove={onRemove} />);
  const btn = container.querySelector('[data-set-switcher]')!;
  expect(btn.textContent).toContain('Custom labels');
  fireEvent.click(btn);
  // Hovering a set shows what it is, in a tip beside the menu.
  fireEvent.mouseEnter(document.querySelector('[data-set-row="sequences"]')!);
  expect(document.querySelector('[data-set-tip]')!.textContent).toBe('Stretches of the story.');
  // A set that is not the one shown renames from its own row, without being picked.
  fireEvent.click(document.querySelector('[data-set-rename="set_2"]')!);
  const input = document.querySelector('[data-set-rename-input]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Acts' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledWith('set_2', 'Acts');
  expect(onPick).not.toHaveBeenCalled();
  // And removes from its row, after a confirm.
  fireEvent.click(document.querySelector('[data-set-remove="set_2"]')!);
  fireEvent.click(document.querySelector('[data-set-remove-yes]')!);
  expect(onRemove).toHaveBeenCalledWith('set_2');
  // Custom labels renames but never removes; Sequences does neither.
  expect(document.querySelector('[data-set-rename="main"]')).not.toBeNull();
  expect(document.querySelector('[data-set-remove="main"]')).toBeNull();
  expect(document.querySelector('[data-set-rename="sequences"]')).toBeNull();
  expect(document.querySelector('[data-set-hide]')).toBeNull();
});

test('Sequences and Subplots cannot be renamed; old default names read as Custom labels', () => {
  const { container } = render(<SetSwitcher sets={[{ id: 'sequences', name: 'Sequences', colors: [] }]} current="sequences" dark={false} onPick={() => {}} onNew={() => {}} onRename={() => {}} />);
  fireEvent.click(container.querySelector('[data-set-switcher]')!);
  expect(document.querySelector('[data-set-rename]')).toBeNull();
  expect(setNameOf('Storyline')).toBe('Custom labels');
  expect(setNameOf('')).toBe('Custom labels');
  expect(setNameOf('Acts')).toBe('Acts');
});
