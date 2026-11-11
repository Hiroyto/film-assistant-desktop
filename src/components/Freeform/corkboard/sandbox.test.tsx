// FIL-642: the doorway groups stickies the way the board read describes them,
// and leaks none of the machinery words (ANCHOR-sandbox.md section 14).
// SANDBOX_DUMP_HTML=<dir> also writes light and dark renders to <dir> so the
// panel can be looked at in a browser without a signed-in board.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
// Grouping (two stickies in one dashed box) and the title scan are DOM
// shape, which the role queries cannot express.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SandboxDoorway } from './sandbox';
import { ThemeCtx } from './theme';
import type { ProjectEntity, SandboxBadge, SandboxFragment } from '../../../lib/freeformApi';

const ent = (id: string, type: ProjectEntity['type'], name: string): ProjectEntity =>
  ({ id, type, ...(type === 'event' ? { working_title: name } : { working_name: name }) } as ProjectEntity);

const frag = (over: Partial<SandboxFragment> & { id: string; text: string }): SandboxFragment => ({
  kind: 'idea', author: 'extractor', source: over.text, label: '', about: '', open: true,
  dumpId: 'd1', attachedTo: null, clusterId: null, createdAt: '2026-10-01T00:00:00Z', ...over,
});

const entities = [
  ent('c1', 'character', 'The lighthouse keeper'),
  ent('c2', 'character', 'The surveyor'),
  ent('e1', 'event', 'The lamp goes out'),
];

const fragments: SandboxFragment[] = [
  frag({ id: 'f1', text: 'The keeper hides the logbook from the surveyor.', source: 'I think he hides the logbook from her.', clusterId: 'h1', about: 'The lighthouse keeper', createdAt: '2026-10-01T00:00:00Z' }),
  frag({ id: 'f2', text: 'The surveyor finds the logbook in the lamp room.', source: 'She finds it up in the lamp room later.', clusterId: 'h1', about: 'The surveyor', createdAt: '2026-10-02T00:00:00Z' }),
  frag({ id: 'f3', text: 'The piece might be a chamber drama on one rock.', kind: 'story', createdAt: '2026-10-02T00:00:00Z' }),
  frag({ id: 'f4', text: 'The keeper counts the stairs every climb.', attachedTo: 'c1' }),
  frag({ id: 'f5', text: 'The keeper has not spoken aloud in a year.', kind: 'note', attachedTo: 'c1' }),
  frag({ id: 'f6', text: 'Resolved, should not show.', open: false }),
  frag({ id: 'f7', text: 'Alone in a group of one, so a single.', clusterId: 'h-solo' }),
];

const badges: SandboxBadge[] = [
  { clusterId: 'h1', kind: 'scene', title: 'The logbook', summary: '', touches: ['The lighthouse keeper', 'The surveyor'] },
];

const FORBIDDEN = /\b(fragments?|huddles?|clusters?|parked|held|badge|extractor|graft)\b/i;

function mount(mode: 'light' | 'dark', over: { badges?: SandboxBadge[] } = {}) {
  return render(
    <ThemeCtx.Provider value={mode}>
      <SandboxDoorway fragments={fragments} badges={over.badges ?? []} entities={entities} onOpenCard={jest.fn()} top={60} />
    </ThemeCtx.Provider>,
  );
}

beforeEach(() => { localStorage.clear(); });

test('counts open stickies, groups a huddle, lists the attached ones per card', () => {
  const onOpenCard = jest.fn();
  render(<SandboxDoorway fragments={fragments} badges={[]} entities={entities} onOpenCard={onOpenCard} top={60} />);
  // 6 open of 7 (f6 is resolved).
  expect(screen.getByTitle('6 stickies')).toBeInTheDocument();
  // Loose: f1 f2 (one group), f3, f7 = 4. The header count is the monospaced span after "Stickies".
  expect(screen.getByText('Stickies').textContent).toBe('Stickies4');
  expect(screen.getByText('Nothing is ready yet.')).toBeInTheDocument();
  // The two huddle members share one dashed group.
  const a = screen.getByText('The keeper hides the logbook from the surveyor.');
  const b = screen.getByText('The surveyor finds the logbook in the lamp room.');
  expect(a.closest('div[style*="dashed"]')).toBe(b.closest('div[style*="dashed"]'));
  // about resolves to the card's own title.
  expect(screen.getByText('about The lighthouse keeper')).toBeInTheDocument();
  // On cards: the keeper has two, the button opens the sheet.
  const row = screen.getByText('The lighthouse keeper').closest('button')!;
  expect(row.textContent).toMatch(/2$/);
  fireEvent.click(row);
  expect(onOpenCard).toHaveBeenCalledWith('c1');
  // Where did this come from: the source sentence appears on click only.
  expect(screen.queryByText(/I think he hides the logbook/)).toBeNull();
  fireEvent.click(a);
  expect(screen.getByText(/I think he hides the logbook/)).toBeInTheDocument();
});

test('a badged group moves under Ready with its kind', () => {
  mount('light', { badges });
  expect(screen.queryByText('Nothing is ready yet.')).toBeNull();
  expect(screen.getByText('The logbook')).toBeInTheDocument();
  // On cards counts the attached two, not the badged pair.
  expect(screen.getByText('On cards').textContent).toBe('On cards2');
  expect(screen.getByText('reads as scene')).toBeInTheDocument();
  // Loose count drops to the two singles.
  expect(screen.getByText('Stickies').textContent).toBe('Stickies2');
});

test('the vocabulary budget holds: no machinery word reaches the screen', () => {
  const { container } = mount('light', { badges });
  expect(container.textContent).not.toMatch(FORBIDDEN);
  for (const el of Array.from(container.querySelectorAll('[title]'))) {
    expect(el.getAttribute('title')).not.toMatch(FORBIDDEN);
  }
});

test('collapses to an edge tab and remembers it', () => {
  mount('light');
  fireEvent.click(screen.getByTitle('Hide'));
  expect(screen.getByTitle('Show the sandbox')).toBeInTheDocument();
  expect(localStorage.getItem('ff-sandbox-door')).toBe('0');
});

test('writes light and dark renders when asked', () => {
  const dir = process.env.SANDBOX_DUMP_HTML;
  if (!dir) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  for (const mode of ['light', 'dark'] as const) {
    const { container, unmount } = mount(mode, { badges });
    const bg = mode === 'dark' ? '#0a0a0b' : '#fffefb';
    fs.writeFileSync(`${dir}/doorway-${mode}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>doorway ${mode}</title></head><body style="margin:0;min-height:100vh;background:${bg};background-image:radial-gradient(circle,rgba(234,88,12,.16) 1px,transparent 1.4px);background-size:26px 26px">${container.innerHTML}</body></html>`);
    unmount();
  }
});
