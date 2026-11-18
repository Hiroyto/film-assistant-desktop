/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// O diálogo "Share": três escopos, o retrato sai do que está salvo, o link
// criado aparece pronto para copiar e pode ser revogado. `craco test`.
jest.mock('../../lib/freeformApi', () => ({ getCardLayouts: jest.fn(), listProjectEntities: jest.fn(), listSceneTexts: jest.fn() }));
jest.mock('../../lib/ipcClient', () => ({ isDesktop: jest.fn() }));
jest.mock('../../lib/shareLinks', () => ({
  ...jest.requireActual('../../lib/shareLinks'),
  createShareLink: jest.fn(),
  listShareLinks: jest.fn(),
  revokeShareLink: jest.fn(),
}));

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getCardLayouts, listProjectEntities, listSceneTexts } from '../../lib/freeformApi';
import { isDesktop } from '../../lib/ipcClient';
import { createShareLink, listShareLinks, revokeShareLink } from '../../lib/shareLinks';
import { ShareStoryDialog } from './ShareStoryDialog';

const AUTH = { userId: 'u1', token: 't' };
const GRAPH = {
  projectId: 's1',
  entities: [{ id: 'e1', type: 'event', working_title: 'Empty crate', summary: 'Voss finds nothing.' }],
  edges: { precedes: [], contains: [], involves: [], occurs_in: [], sequence_precedes: [] },
};
const PAGES = { projectId: 's1', sceneTexts: [{ eventId: 'e1', html: '<p data-line-type="scene">INT. WAREHOUSE - NIGHT</p>', updatedAt: 'x' }] };
const link = (over: Record<string, unknown> = {}) => ({ token: 'tok_new', storyId: 's1', scope: 'board', title: 'My Story', createdAt: '2026-11-17T12:00:00.000Z', ...over });

const writeText = jest.fn();
/** O caminho antigo de cópia (o jsdom não o tem): guarda o que estava selecionado. */
const execCommand = jest.fn();
let selected = '';
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  selected = '';
  execCommand.mockReset().mockImplementation(() => {
    // O campo auxiliar é invisível para leitores de tela: só aparece com { hidden: true }.
    const helper = screen.getAllByRole('textbox', { hidden: true }).find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
    selected = helper && helper.matches(':focus') ? helper.value : ''; // a seleção copiada é a do campo em foco
    return true;
  });
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
  (isDesktop as jest.Mock).mockReturnValue(false);
  (listShareLinks as jest.Mock).mockResolvedValue([]);
  (listProjectEntities as jest.Mock).mockResolvedValue(GRAPH);
  (listSceneTexts as jest.Mock).mockResolvedValue(PAGES);
  (getCardLayouts as jest.Mock).mockResolvedValue({ layouts: [{ cardId: 'e1', x: 500, y: 60 }] });
  (createShareLink as jest.Mock).mockImplementation(async (req: { scope: string }) => link({ scope: req.scope }));
  (revokeShareLink as jest.Mock).mockResolvedValue(undefined);
});

const open = (onClose = jest.fn()) => render(<ShareStoryDialog storyId="s1" title="My Story" auth={AUTH} onClose={onClose} />);

describe('ShareStoryDialog', () => {
  it('oferece os três escopos, com "Board only" marcado, e diz que é um preview somente leitura', async () => {
    open();
    expect(screen.getByRole('dialog', { name: /share this story/i })).toHaveTextContent(/read-only preview/i);
    const radios = within(screen.getByRole('radiogroup', { name: 'What to share' })).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Board only'), expect.stringContaining('Script and board'), expect.stringContaining('Script only'),
    ]);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('No links yet.')).toBeInTheDocument();
  });

  it('só o board: não lê as páginas; o retrato não leva roteiro; o link aparece e vai para a área de transferência', async () => {
    open();
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalledTimes(1));
    expect(listSceneTexts).not.toHaveBeenCalled();
    const [req, token] = (createShareLink as jest.Mock).mock.calls[0];
    expect(token).toBe('t');
    expect(req).toMatchObject({ storyId: 's1', scope: 'board', title: 'My Story' });
    expect(Object.keys(req.snapshot).sort()).toEqual(['board', 'v']);
    // O palco vai junto, com o card onde o roteirista o deixou.
    expect(getCardLayouts).toHaveBeenCalledWith({ userId: 'u1', projectId: 's1' }, 't');
    expect(req.snapshot.board.canvas.cards).toEqual([{ id: 'e1', kind: 'scene', x: 500, y: 60 }]);
    expect(await screen.findByDisplayValue('https://filmassistant.io/share/tok_new')).toBeInTheDocument();
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://filmassistant.io/share/tok_new'));
  });

  it('só o roteiro: lê as páginas salvas e o retrato não leva o board', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /script only/i }));
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalledTimes(1));
    expect(listSceneTexts).toHaveBeenCalledWith({ projectId: 's1' }, 't');
    const [req] = (createShareLink as jest.Mock).mock.calls[0];
    expect(req.scope).toBe('script');
    expect(Object.keys(req.snapshot).sort()).toEqual(['script', 'v']);
    expect(req.snapshot.script.scenes[0].blocks).toEqual([{ type: 'scene', text: 'INT. WAREHOUSE - NIGHT' }]);
    expect(getCardLayouts).not.toHaveBeenCalled();
  });

  it('sem os layouts salvos (rede, backend antigo) o link sai assim mesmo, com o palco no auto-layout', async () => {
    (getCardLayouts as jest.Mock).mockRejectedValue(new Error('get-card-layouts failed'));
    open();
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalledTimes(1));
    const [card] = (createShareLink as jest.Mock).mock.calls[0][0].snapshot.board.canvas.cards;
    expect(card).toMatchObject({ id: 'e1', kind: 'scene' });
    expect(Number.isFinite(card.x) && Number.isFinite(card.y)).toBe(true);
  });

  it('roteiro e board: os dois no retrato', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /script and board/i }));
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalledTimes(1));
    expect(Object.keys((createShareLink as jest.Mock).mock.calls[0][0].snapshot).sort()).toEqual(['board', 'script', 'v']);
  });

  it('retrato ou ao vivo: o retrato é o padrão, e cada opção diz o que acontece quando a história muda', async () => {
    open();
    const modes = within(screen.getByRole('radiogroup', { name: 'When the story changes' })).getAllByRole('radio');
    expect(modes.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      [expect.stringMatching(/^Snapshot.*Later changes need a new link\.$/), 'true'],
      [expect.stringMatching(/^Live.*unfinished ones too\.$/), 'false'],
    ]);
    await screen.findByText('No links yet.');
  });

  it('ao vivo: o link é criado sem levar nada da história, e aparece marcado como Live', async () => {
    (createShareLink as jest.Mock).mockImplementation(async (req: { scope: string; mode?: string }) => link({ scope: req.scope, mode: req.mode }));
    open();
    fireEvent.click(screen.getByRole('radio', { name: /script and board/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^Live/ }));
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalledTimes(1));
    const [req, token] = (createShareLink as jest.Mock).mock.calls[0];
    expect(req).toEqual({ storyId: 's1', scope: 'both', title: 'My Story', mode: 'live' }); // sem snapshot
    expect(token).toBe('t');
    // As posições dos cards não são lidas: num link ao vivo é o serviço que as lê, a cada abertura.
    expect(getCardLayouts).not.toHaveBeenCalled();
    expect(await screen.findByTestId('share-link-live')).toHaveTextContent('Live');
  });

  it('ao vivo: sem nada para mostrar o link também não é criado; um link de retrato não leva o selo Live', async () => {
    (listShareLinks as jest.Mock).mockResolvedValue([link({ token: 'tok_old' })]);
    (listProjectEntities as jest.Mock).mockResolvedValue({ projectId: 's1', entities: [], edges: {} });
    open();
    await screen.findByTestId('share-link-row');
    expect(screen.queryByTestId('share-link-live')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Live/ }));
    fireEvent.click(screen.getByText('Create link'));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is nothing on the board to share yet.');
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('ao vivo desligado no servidor: o diálogo mostra o motivo e o retrato continua disponível', async () => {
    (createShareLink as jest.Mock).mockRejectedValue(new Error('Live links are not available on this server.'));
    open();
    fireEvent.click(screen.getByRole('radio', { name: /^Live/ }));
    fireEvent.click(screen.getByText('Create link'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Live links are not available on this server.');
    expect(await screen.findByText('Create link')).toBeEnabled();
  });

  it('nada para compartilhar: avisa e não cria link', async () => {
    (listSceneTexts as jest.Mock).mockResolvedValue({ projectId: 's1', sceneTexts: [] });
    open();
    fireEvent.click(screen.getByRole('radio', { name: /script only/i }));
    fireEvent.click(screen.getByText('Create link'));
    expect(await screen.findByRole('alert')).toHaveTextContent('There are no script pages to share yet.');
    expect(createShareLink).not.toHaveBeenCalled();
  });

  it('links existentes: copiar e revogar', async () => {
    (listShareLinks as jest.Mock).mockResolvedValue([link({ token: 'tok_old', scope: 'both' })]);
    open();
    const row = await screen.findByTestId('share-link-row');
    expect(row).toHaveTextContent('Script and board');
    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://filmassistant.io/share/tok_old'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    // Revogar não tem volta: o primeiro clique só arma o botão.
    fireEvent.click(screen.getByText('Revoke'));
    expect(revokeShareLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Revoke for everyone?'));
    await waitFor(() => expect(revokeShareLink).toHaveBeenCalledWith({ token: 'tok_old' }, 't'));
    await waitFor(() => expect(screen.queryByTestId('share-link-row')).toBeNull());
  });

  it('no desktop a cópia não pede permissão ao navegador (o shell nega todas): vai pela seleção', async () => {
    (isDesktop as jest.Mock).mockReturnValue(true);
    (listShareLinks as jest.Mock).mockResolvedValue([link({ token: 'tok_old' })]);
    open();
    await screen.findByTestId('share-link-row');
    const button = screen.getByText('Copy link');
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(selected).toBe('https://filmassistant.io/share/tok_old');
    expect(screen.queryByRole('alert')).toBeNull();
    // O campo auxiliar some e o foco volta para o botão.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('Copied')).toHaveFocus();
  });

  it('na web, se a API de clipboard recusa, a cópia cai na seleção; só avisa se as duas falharem', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    (listShareLinks as jest.Mock).mockResolvedValue([link({ token: 'tok_old' })]);
    open();
    await screen.findByTestId('share-link-row');
    fireEvent.click(screen.getByText('Copy link'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(selected).toBe('https://filmassistant.io/share/tok_old');
    expect(screen.queryByRole('alert')).toBeNull();

    execCommand.mockReturnValue(false);
    fireEvent.click(screen.getByText('Copied'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy. Select the link and copy it by hand.');
  });

  it('serviço fora do ar: o erro aparece e o diálogo continua de pé', async () => {
    (listShareLinks as jest.Mock).mockRejectedValue(new Error('The share service is not available.'));
    (createShareLink as jest.Mock).mockRejectedValue(new Error('The share service is not available.'));
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('The share service is not available.');
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(createShareLink).toHaveBeenCalled());
    expect(await screen.findByText('Create link')).toBeEnabled();
  });

  it('fecha pelo botão e pelo Esc', () => {
    const onClose = jest.fn();
    open(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
