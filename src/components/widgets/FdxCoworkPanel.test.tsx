/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// O protótipo read-only só mostra arquivos que ELE abriu: payloads do watcher
// vindos do cowork sincronizado não o acordam — nem depois do "stop" da janela
// do cowork, que antes fazia o board read-only aparecer. `craco test`.
const mockChanged: { h: ((p: unknown) => void) | null } = { h: null };

jest.mock('../../lib/ipcClient', () => ({ isDesktop: () => true }));
jest.mock('../../lib/fdxClient', () => ({
  openFdx: jest.fn(),
  closeFdx: jest.fn(async () => undefined),
  onFdxChanged: jest.fn((h: (p: unknown) => void) => {
    mockChanged.h = h;
    return () => { mockChanged.h = null; };
  }),
}));
jest.mock('../../lib/fdxSync', () => ({
  getFdxSyncSnapshot: jest.fn(() => ({ bound: false })),
  openFdxSync: jest.fn(async () => true),
}));
jest.mock('./useFdxSync', () => ({ useFdxSync: jest.fn() }));
jest.mock('./FdxBoard', () => ({ FdxBoard: () => <div data-testid="fdx-board" /> }));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { closeFdx, onFdxChanged, openFdx } from '../../lib/fdxClient';
import { getFdxSyncSnapshot, openFdxSync } from '../../lib/fdxSync';
import { useFdxSync } from './useFdxSync';
import { FdxCoworkPanel } from './FdxCoworkPanel';

const payload = (over: Record<string, unknown> = {}) => ({
  ok: true,
  path: 'C:/scripts/pilot.fdx',
  fileName: 'pilot.fdx',
  title: 'Pilot',
  sceneCount: 3,
  paragraphCount: 10,
  updatedAt: '2026-10-16T12:00:00.000Z',
  scenes: [],
  ...over,
});

const CONTROL = '.fdx cowork (read-only)';

// O jest do CRA roda com resetMocks: as implementações dadas nas factories
// somem antes de cada teste, então são (re)instaladas aqui.
beforeEach(() => {
  mockChanged.h = null;
  (onFdxChanged as jest.Mock).mockImplementation((h: (p: unknown) => void) => {
    mockChanged.h = h;
    return () => { mockChanged.h = null; };
  });
  (closeFdx as jest.Mock).mockResolvedValue(undefined);
  (openFdxSync as jest.Mock).mockResolvedValue(true);
  (useFdxSync as jest.Mock).mockReturnValue({ active: false, bound: true });
  (getFdxSyncSnapshot as jest.Mock).mockReturnValue({ bound: false });
});

describe('FdxCoworkPanel — só mostra o que ele mesmo abriu', () => {
  it('arquivo do cowork sincronizado: payloads do watcher não acordam o painel, nem depois do stop', () => {
    (useFdxSync as jest.Mock).mockReturnValue({ active: true, bound: true });
    const { container, rerender } = render(<FdxCoworkPanel />);
    act(() => { mockChanged.h?.(payload()); });
    expect(container).toBeEmptyDOMElement();

    // "stop" na janela do cowork: o motor desliga; o painel continua calado.
    (useFdxSync as jest.Mock).mockReturnValue({ active: false, bound: true });
    rerender(<FdxCoworkPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(CONTROL)).toBeNull();
    expect(screen.queryByTestId('fdx-board')).toBeNull();
  });

  it('menu com corkboard vinculado vai para o cowork sincronizado, não para o protótipo', () => {
    (getFdxSyncSnapshot as jest.Mock).mockReturnValue({ bound: true });
    render(<FdxCoworkPanel />);
    act(() => { window.dispatchEvent(new Event('app:open-fdx')); });
    expect(openFdxSync).toHaveBeenCalledTimes(1);
    expect(openFdx).not.toHaveBeenCalled();
  });

  it('protótipo: o menu abre o arquivo, mostra controle e board; stop fecha e solta o arquivo', async () => {
    (openFdx as jest.Mock).mockResolvedValue(payload());
    const { container } = render(<FdxCoworkPanel />);
    await act(async () => { window.dispatchEvent(new Event('app:open-fdx')); });
    expect(await screen.findByText(CONTROL)).toBeInTheDocument();
    expect(screen.getByTestId('fdx-board')).toBeInTheDocument();

    // Saves do arquivo que ele abriu continuam chegando.
    act(() => { mockChanged.h?.(payload({ sceneCount: 4 })); });
    expect(screen.getByText(CONTROL)).toBeInTheDocument();

    fireEvent.click(screen.getByText('stop'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(closeFdx).toHaveBeenCalledTimes(1);

    // Depois do stop o arquivo não é mais dele: um payload tardio não o reabre.
    act(() => { mockChanged.h?.(payload()); });
    expect(container).toBeEmptyDOMElement();
  });
});
