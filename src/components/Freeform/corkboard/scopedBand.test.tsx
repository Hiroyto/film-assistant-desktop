// FIL-641: the shell around a parked scene's pages speaks the sandbox's words
// (scene, sticky, card, placed, board) and none of the master script's.
// SANDBOX_DUMP_HTML=<dir> also writes light and dark renders to <dir>, with a
// stand-in page under the card head, so the shell can be looked at without a
// signed-in story.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopedCardHead, ScopedCast, ScopedStickies } from './scopedBand';
import type { ProjectEntity, SandboxFragment } from '../../../lib/freeformApi';

const scene = { id: 'e1', type: 'event', working_title: 'The lamp goes out', summary: 'The keeper lets the light fail for the first time in thirty years.', has_script_text: '1', state: 'parked' } as unknown as ProjectEntity;
const frag = (over: Partial<SandboxFragment> & { id: string; text: string }): SandboxFragment => ({
  kind: 'idea', author: 'extractor', source: over.text, label: '', about: '', open: true,
  dumpId: 'd1', attachedTo: null, clusterId: null, createdAt: '2026-10-01T00:00:00Z', ...over,
});
const fragments = [
  frag({ id: 'f1', text: 'The keeper counts the stairs every climb.', attachedTo: 'e1' }),
  frag({ id: 'f2', text: 'The storm is the one thing he cannot log.', kind: 'note', attachedTo: 'e1', source: 'Maybe the storm is the thing he can\'t write down.' }),
  frag({ id: 'f3', text: 'On another card, should not show.', attachedTo: 'c9' }),
  frag({ id: 'f4', text: 'Resolved, should not show.', attachedTo: 'e1', open: false }),
];

test('the card head: title, summary, drafted, parked', () => {
  render(<ScopedCardHead scene={scene} dark={false} />);
  expect(screen.getByText('The lamp goes out')).toBeInTheDocument();
  expect(screen.getByText(/lets the light fail/)).toBeInTheDocument();
  expect(screen.getByText(/^drafted · parked/)).toBeInTheDocument();
});

test('not drafted reads so', () => {
  render(<ScopedCardHead scene={{ ...scene, has_script_text: undefined } as any} dark={true} />);
  expect(screen.getByText(/^not drafted/)).toBeInTheDocument();
});

test('only the card\'s own open stickies, the writer\'s sentence as hover', () => {
  render(<ScopedStickies sceneId="e1" fragments={fragments} dark={false} />);
  expect(screen.getAllByTestId('scoped-sticky')).toHaveLength(2);
  expect(screen.queryByText(/another card/)).toBeNull();
  expect(screen.queryByText(/Resolved/)).toBeNull();
  expect(screen.getByText(/cannot log/)).toHaveAttribute('title', expect.stringMatching(/can't write down/));
});

test('no stickies still says where things land', () => {
  render(<ScopedStickies sceneId="e1" fragments={[]} dark={true} />);
  expect(screen.getByText(/No stickies yet/)).toBeInTheDocument();
});

test('the left margin: the scene\'s cast and where, each a door back to the board', () => {
  const onOpen = jest.fn();
  const ents = [scene, { id: 'c1', type: 'character', working_name: 'The keeper', description: 'Sixty, silent.' }, { id: 'c2', type: 'character', working_name: 'Elsewhere' }, { id: 'l1', type: 'location', working_name: 'The lamp room' }] as unknown as ProjectEntity[];
  const edges = { involves: [{ from: 'e1', to: 'c1' }], occurs_in: [{ from: 'e1', to: 'l1' }] } as any;
  render(<ScopedCast sceneId="e1" entities={ents} edges={edges} dark={false} onOpen={onOpen} />);
  expect(screen.getByText('The keeper')).toBeInTheDocument();
  expect(screen.getByText('The lamp room')).toBeInTheDocument();
  expect(screen.queryByText('Elsewhere')).toBeNull();
  fireEvent.click(screen.getByText('The keeper'));
  expect(onOpen).toHaveBeenCalledWith('c1');
  const { container } = render(<ScopedCast sceneId="e1" entities={ents} edges={{ involves: [], occurs_in: [] } as any} dark={true} />);
  expect(container.textContent).toMatch(/No one in this scene yet/);
});

test('vocabulary budget: no machinery words', () => {
  const { container } = render(<><ScopedCardHead scene={scene} dark={false} /><ScopedStickies sceneId="e1" fragments={fragments} dark={false} /></>);
  expect(container.textContent).not.toMatch(/fragment|cluster|huddle|extract|graph|vertex|badge|stage|outline|sync|script/i);
});

test('renders to disk when asked', () => {
  const dir = process.env.SANDBOX_DUMP_HTML;
  if (!dir) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  for (const mode of ['light', 'dark'] as const) {
    const dark = mode === 'dark';
    const { container: headEl, unmount: unmountHead } = render(<ScopedCardHead scene={scene} dark={dark} />);
    const { container: railEl, unmount: unmountRail } = render(<ScopedStickies sceneId="e1" fragments={fragments} dark={dark} />);
    const bg = dark ? '#0a0a0b' : '#faf6ee';
    const grid = dark ? 'radial-gradient(circle,rgba(255,107,53,.16) 1px,transparent 1.4px);background-size:40px 40px' : 'radial-gradient(circle,rgba(234,88,12,.14) 1px,transparent 1.4px);background-size:26px 26px';
    const blue = dark ? '#76a8f9' : '#3b82f6';
    const paper = dark ? '#1e1e22' : '#fffdf7';
    const page = `<div style="margin:14px auto 28px;width:816px;height:520px;background:${dark ? '#1e1e1e' : '#fff'};box-shadow:${dark ? '0 4px 24px rgba(0,0,0,.6)' : '0 2px 16px rgba(0,0,0,.18)'};border-radius:2px;padding:96px 96px 0 144px;box-sizing:border-box;font:16px/1.5 'Courier New',Courier,monospace;color:${dark ? '#e8e8ec' : '#111'}">INT. LAMP ROOM - NIGHT<br><br>The lamp is dark. THE KEEPER stands at the glass, counting under his breath.</div>`;
    const bar = `<div style="height:44px;display:flex;align-items:center;gap:14px;padding:0 18px;font:12px system-ui;color:${dark ? '#82828c' : '#888'};border-bottom:1px solid ${dark ? 'rgba(35,35,40,.8)' : 'rgba(232,224,210,.8)'}"><span style="color:#ff8c42;font-weight:700;font-size:13px">← Board</span><span style="color:${dark ? '#e6e6ea' : '#1a1a1a'};font-weight:700;font-size:14px">Sandbox</span><span>one parked scene, its pages</span></div>`;
    const card = `<div style="width:872px;flex-shrink:0;display:flex;flex-direction:column;background:${paper};border:1.5px solid ${blue};border-radius:3px;box-shadow:${dark ? '0 1px 2px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.45)' : '0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(120,90,40,.10)'};overflow:hidden">${headEl.innerHTML}<div style="background:${dark ? '#17171a' : '#f3efe6'};border-top:1px solid ${dark ? '#2a2a30' : '#eadfcc'}">${page}</div></div>`;
    fs.writeFileSync(`${dir}/scoped-${mode}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>scoped ${mode}</title></head><body style="margin:0;min-height:100vh;background:${bg};background-image:${grid};background-position:8px 8px">${bar}<div style="display:flex;justify-content:center;align-items:flex-start;gap:22px;padding:18px 24px">${card}<div style="width:170px;padding-top:6px">${railEl.innerHTML}</div></div></body></html>`);
    unmountHead(); unmountRail();
  }
});
