/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// A página de um link compartilhado: mostra só o que o escopo trouxe, sem nada
// editável, e explica quando o link não abre. `craco test`.
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn() }));
jest.mock('../../lib/shareLinks', () => ({
  ...jest.requireActual('../../lib/shareLinks'),
  fetchSharedStory: jest.fn(),
}));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { SharedStoryError, fetchSharedStory } from '../../lib/shareLinks';
import SharedStory from './shared-story';

const BOARD = {
  sections: [
    { id: 'loose_0', title: '', scenes: [{ id: 'e1', number: 1, title: 'Empty crate', summary: 'Voss finds nothing.', characters: ['Voss'], location: 'Harbor warehouse' }] },
    { id: 's1', title: 'Act II', summary: 'The net closes.', scenes: [{ id: 'e2', number: 2, title: 'The pier', summary: '', characters: [] }] },
  ],
  characters: [{ name: 'Voss', description: 'A tired detective.', scenes: 1 }],
  locations: [{ name: 'Harbor warehouse', description: '' }],
};
const SCRIPT = { scenes: [{ id: 'e1', title: 'Empty crate', blocks: [{ type: 'scene', text: 'INT. WAREHOUSE - NIGHT' }, { type: 'character', text: 'VOSS' }, { type: 'dialogue', text: 'Empty.' }] }] };
const story = (snapshot: Record<string, unknown>, scope = 'both') => ({ token: 'tok', scope, title: 'My Story', createdAt: '2026-11-17T12:00:00.000Z', snapshot: { v: 1, ...snapshot } });

const show = (path = '/share/tok') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/share/:token" element={<SharedStory />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** O palco no retrato (links novos): onde cada card está e o que os liga. */
const CANVAS = {
  cards: [{ id: 'e1', kind: 'scene', x: 400, y: 20 }, { id: 'e2', kind: 'scene', x: 400, y: 260 }],
  thread: [['e1', 's1']], boxes: [{ id: 's1', members: ['e2'] }], involves: [], bonds: [],
};
const width = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  (fetchAuthSession as jest.Mock).mockResolvedValue({});
  (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: BOARD, script: SCRIPT }));
});

describe('SharedStory (/share/:token)', () => {
  it('abre o link pelo token, sem sessão, e mostra o título com o selo de somente leitura', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'My Story' })).toBeInTheDocument();
    expect(fetchSharedStory).toHaveBeenCalledWith('tok', null);
    expect(screen.getByTestId('shared-readonly')).toHaveTextContent('Read-only preview');
  });

  it('com sessão, manda o token dela junto (links só para logados)', async () => {
    (fetchAuthSession as jest.Mock).mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } });
    show();
    await screen.findByRole('heading', { name: 'My Story' });
    expect(fetchSharedStory).toHaveBeenCalledWith('tok', 'jwt');
  });

  it('roteiro e board: abre no board, com cenas, sequência, elenco e locais; a aba Script mostra as páginas', async () => {
    show();
    expect(await screen.findByTestId('shared-board')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Beats' }));
    expect(screen.getAllByTestId('shared-scene').map((el) => el.textContent)).toEqual([
      expect.stringContaining('SC 01Empty crate'), expect.stringContaining('SC 02The pier'),
    ]);
    expect(screen.getByRole('heading', { name: 'Act II' })).toBeInTheDocument();
    expect(screen.getByText('A tired detective.')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-script')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Script' }));
    expect(screen.getByTestId('shared-script')).toHaveTextContent('INT. WAREHOUSE - NIGHT');
    expect(screen.getByTestId('shared-script')).toHaveTextContent('Empty.');
    expect(screen.queryByTestId('shared-board')).toBeNull();
  });

  it('só o board: sem abas e sem roteiro', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: BOARD }, 'board'));
    show();
    expect(await screen.findByTestId('shared-board')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('shared-script')).toBeNull();
  });

  it('só o roteiro: abre direto nas páginas, sem board', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ script: SCRIPT }, 'script'));
    show();
    expect(await screen.findByTestId('shared-script')).toHaveTextContent('VOSS');
    expect(screen.queryByTestId('shared-board')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('nada na página é editável', async () => {
    const editable = () => ['textbox', 'combobox', 'listbox', 'checkbox', 'spinbutton', 'slider', 'switch'].flatMap((role) => screen.queryAllByRole(role));
    show();
    await screen.findByTestId('shared-board');
    expect(editable()).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Script' }));
    expect(editable()).toEqual([]);
  });

  it('com o palco no retrato o board abre em Master (os cards onde o roteirista os deixou); Beats troca para a grade', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: { ...BOARD, canvas: CANVAS } }, 'board'));
    show();
    expect(await screen.findByTestId('shared-canvas')).toBeInTheDocument();
    expect(screen.getAllByTestId('canvas-scene')).toHaveLength(2);
    expect(screen.queryByTestId('shared-beats')).toBeNull();
    expect(screen.getByRole('button', { name: 'Master' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Beats' }));
    expect(screen.getByTestId('shared-beats')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-canvas')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Master' }));
    expect(screen.getByTestId('shared-canvas')).toBeInTheDocument();
  });

  it('numa tela estreita a leitura começa pelos Beats, com o Master a um toque', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true, writable: true });
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: { ...BOARD, canvas: CANVAS } }, 'board'));
    show();
    expect(await screen.findByTestId('shared-beats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Master' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('link antigo (sem o palco no retrato): o palco é montado na hora, e também dá para arrumar', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: BOARD }, 'board'));
    show();
    expect(await screen.findByTestId('shared-canvas')).toBeInTheDocument();
    expect(screen.getAllByTestId('canvas-scene')).toHaveLength(2);
    expect(screen.getAllByTestId('canvas-character')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Beats' })).toBeInTheDocument();
  });

  it('o que o visitante arruma fica guardado por link, no navegador dele', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: { ...BOARD, canvas: CANVAS } }, 'board'));
    show();
    const crate = await screen.findByRole('button', { name: /SC 01 Empty crate/ });
    const pointer = (target: Element | Window, type: string, x: number, y: number) =>
      act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });
    pointer(crate, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 60, 40);
    pointer(window, 'pointerup', 60, 40);
    expect(JSON.parse(localStorage.getItem('ff-share-stage:tok') ?? 'null')).toEqual({ e1: { x: 450, y: 50 } });
  });

  describe('link ao vivo', () => {
    const live = (over: Record<string, unknown> = {}) => ({ ...story({ board: BOARD, script: SCRIPT }), mode: 'live', asOf: '2026-11-18T15:04:00.000Z', ...over });
    const renamed = { ...BOARD, sections: [{ ...BOARD.sections[0], scenes: [{ ...BOARD.sections[0].scenes[0], title: 'Empty crate (rewritten)' }] }, BOARD.sections[1]] };

    it('diz que é ao vivo e de quando é a leitura; um link de retrato não tem selo nem botão de atualizar', async () => {
      (fetchSharedStory as jest.Mock).mockResolvedValue(live());
      const { unmount } = show();
      expect(await screen.findByTestId('shared-live')).toHaveTextContent('Live');
      expect(screen.getByText(/A read-only preview of the story as it is now \(read at \d{1,2}:04 [AP]M\)\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
      unmount();

      (fetchSharedStory as jest.Mock).mockResolvedValue(story({ board: BOARD, script: SCRIPT }));
      show();
      await screen.findByTestId('shared-board');
      expect(screen.queryByTestId('shared-live')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
      expect(screen.getByText(/Later changes are not shown here\./)).toBeInTheDocument();
    });

    it('Refresh relê a história e o leitor fica onde estava (a aba e a vista)', async () => {
      (fetchSharedStory as jest.Mock).mockResolvedValueOnce(live()).mockResolvedValueOnce(live({ snapshot: { v: 1, board: renamed, script: SCRIPT }, asOf: '2026-11-18T15:09:00.000Z' }));
      show();
      await screen.findByTestId('shared-board');
      fireEvent.click(screen.getByRole('button', { name: 'Beats' }));
      expect(screen.queryByText('Empty crate (rewritten)')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByText('Empty crate (rewritten)')).toBeInTheDocument();
      expect(fetchSharedStory).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('shared-beats')).toBeInTheDocument(); // não voltou para o Master
      expect(screen.getByText(/read at \d{1,2}:09 [AP]M/)).toBeInTheDocument();
    });

    it('se a releitura falha, o que estava na tela fica e a página avisa; se o link foi revogado, a página diz', async () => {
      (fetchSharedStory as jest.Mock)
        .mockResolvedValueOnce(live())
        .mockRejectedValueOnce(new SharedStoryError('failed', 'Could not open this link.'))
        .mockRejectedValueOnce(new SharedStoryError('not-found', 'This link is not available.'));
      show();
      await screen.findByTestId('shared-board');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByText(/Could not refresh just now\./)).toBeInTheDocument();
      expect(screen.getByTestId('shared-board')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer available');
    });

    it('voltar para a aba relê sozinho, mas só se a leitura já tiver mais de meio minuto', async () => {
      (fetchSharedStory as jest.Mock).mockResolvedValue(live());
      const clock = jest.spyOn(Date, 'now');
      const t0 = 1_800_000_000_000;
      clock.mockReturnValue(t0);
      show();
      await screen.findByTestId('shared-board');
      const back = () => act(() => { document.dispatchEvent(new Event('visibilitychange')); });

      clock.mockReturnValue(t0 + 10_000);
      back();
      expect(fetchSharedStory).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(t0 + 31_000);
      back();
      await waitFor(() => expect(fetchSharedStory).toHaveBeenCalledTimes(2));
      clock.mockRestore();
    });
  });

  it('o roteiro sai em folhas', async () => {
    (fetchSharedStory as jest.Mock).mockResolvedValue(story({ script: SCRIPT }, 'script'));
    show();
    await screen.findByTestId('shared-script');
    expect(screen.getAllByTestId('shared-page')).toHaveLength(1);
    expect(screen.getByText('INT. WAREHOUSE - NIGHT')).toHaveStyle({ fontWeight: 700 });
  });

  it('o botão de tema troca claro/escuro e guarda a escolha, a mesma do board (ff-theme)', async () => {
    show();
    await screen.findByTestId('shared-board');
    const toggle = screen.getByTestId('shared-theme-toggle');
    expect(toggle).toHaveAccessibleName('Switch to dark mode');
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Switch to light mode');
    expect(localStorage.getItem('ff-theme')).toBe('dark');
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Switch to dark mode');
    expect(localStorage.getItem('ff-theme')).toBe('light');
  });

  it('quem já usa o tema escuro no app abre o link no escuro; o botão existe também na tela de erro', async () => {
    localStorage.setItem('ff-theme', 'dark');
    (fetchSharedStory as jest.Mock).mockRejectedValue(new SharedStoryError('not-found', 'This link is not available.'));
    show();
    await screen.findByRole('alert');
    expect(screen.getByTestId('shared-theme-toggle')).toHaveAccessibleName('Switch to light mode');
  });

  it('link revogado ou inexistente: explica, sem botão de tentar de novo', async () => {
    (fetchSharedStory as jest.Mock).mockRejectedValue(new SharedStoryError('not-found', 'This link is not available.'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer available');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('link só para logados: pede o sign-in', async () => {
    (fetchSharedStory as jest.Mock).mockRejectedValue(new SharedStoryError('sign-in', 'Sign in to open this link.'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to open this link');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('falha de rede: "Try again" refaz a leitura', async () => {
    (fetchSharedStory as jest.Mock).mockRejectedValueOnce(new SharedStoryError('failed', 'Could not open this link. Check your connection and try again.'));
    show();
    fireEvent.click(await screen.findByText('Try again'));
    expect(await screen.findByTestId('shared-board')).toBeInTheDocument();
    expect(fetchSharedStory).toHaveBeenCalledTimes(2);
  });
});
