// The sandbox receipt walks: one item at a time, prev/next, Done only at the
// last item, and no machinery word on screen.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SandboxReceipt, type ReviewItem } from './sandboxReceipt';

const items: ReviewItem[] = [
  { targetId: 'e1', line: 'card', where: 'On the board · Scene', heading: 'Orrin at the last door', quote: 'Orrin standing at the last door', note: 'A card, not on the master.', done: 'Landed' },
  { targetId: 'f1', line: 'sticky', where: 'Loose · sticky', heading: 'A sticky, nothing to answer', quote: 'the chalk marks being wiped clean', done: 'Landed' },
  { targetId: 'f3', line: 'story', where: 'About the story', heading: 'About the story', quote: 'I want this to be a quiet two-hander', done: 'Landed' },
];

const FORBIDDEN = /\b(fragments?|huddles?|clusters?|parked|held|badge|extractor|graft)\b/i;

test('walks one item at a time and shows Done only at the last', () => {
  const onStep = jest.fn();
  const onDone = jest.fn();
  const { container } = render(<SandboxReceipt items={items} lede="Dump 1: 1 card, 1 sticky, 1 about the story" onStep={onStep} onDone={onDone} />);
  expect(screen.getByText('1 of 3')).toBeInTheDocument();
  expect(screen.getByText('Orrin at the last door')).toBeInTheDocument();
  expect(onStep).toHaveBeenLastCalledWith(items[0], 0);
  expect(screen.queryByLabelText('Done, close the receipt')).toBeNull();
  expect((screen.getByLabelText('Previous') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Next'));
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
  expect(onStep).toHaveBeenLastCalledWith(items[1], 1);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(screen.getByText('3 of 3')).toBeInTheDocument();
  expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Done, close the receipt'));
  expect(onDone).toHaveBeenCalled();
  expect(container.textContent).not.toMatch(FORBIDDEN);
  // Nothing to answer on any line, so the pill never says waiting.
  expect(screen.getByText('nothing waiting')).toBeInTheDocument();
});

test('an item with actions holds the pill on waiting until picked', () => {
  const pick = jest.fn();
  const withAsk: ReviewItem[] = [
    { targetId: 'g1', line: 'ready', where: 'Loose · ready', heading: 'Reads as a scene', quote: 'the chalk marks', actions: [{ label: 'Make it', primary: true, onPick: pick }, { label: 'Not yet', onPick: pick }] },
    ...items,
  ];
  render(<SandboxReceipt items={withAsk} lede="Dump 2" onStep={() => {}} onDone={() => {}} />);
  expect(screen.getByText('waiting on you')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Make it'));
  expect(pick).toHaveBeenCalled();
  expect(screen.getByText('2 of 4')).toBeInTheDocument();
});
