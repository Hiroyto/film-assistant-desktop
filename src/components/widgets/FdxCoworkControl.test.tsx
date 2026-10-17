/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// A janela do cowork nasce minimizada (um chip); o chip abre a janela; "–"
// minimiza de volta; "stop" fica discreto no rodapé da janela aberta. `craco test`.
jest.mock('../../lib/fdxSync', () => ({
  bindFdxSync: jest.fn(),
  openFdxSync: jest.fn(async () => true),
  resolveMissingScene: jest.fn(async () => undefined),
  setFdxAuto: jest.fn(),
  stopFdxSync: jest.fn(async () => undefined),
  syncFdxNow: jest.fn(async () => undefined),
}));
jest.mock('../../data/desktop-lifecycle', () => ({ flushPushNow: jest.fn(async () => undefined) }));
jest.mock('./useFdxSync', () => ({ useFdxSync: jest.fn() }));
jest.mock('../Freeform/corkboard/panels', () => ({ BD_ORANGE: '#ff8c42', StagedRow: () => null }));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFdxSync } from './useFdxSync';
import { stopFdxSync } from '../../lib/fdxSync';
import { FdxCoworkControl } from './FdxCoworkControl';

const AUTH = { token: 't', userId: 'u1' } as never;

const snapshot = (over: Record<string, unknown> = {}) => ({
  bound: true,
  storyId: 's1',
  active: true,
  fileName: 'pilot.fdx',
  title: 'Pilot',
  auto: true,
  status: 'idle',
  dirty: false,
  sceneCount: 12,
  mappedCount: 12,
  cardCount: 12,
  mappedEventIds: [],
  missing: [],
  resolving: [],
  lastSyncAt: '2026-10-14T12:00:00.000Z',
  ...over,
});

// Uma pergunta levantada por um job do motor (`fdx_…`) é do cowork.
const fdxRow = (cardId: string) =>
  ({ cardId, sourceBraindumpId: 'fdx_job1', questionType: 'altitude', held: false, target: null }) as never;
const strip = (rows: unknown[]) =>
  ({ rows, braindumps: null, onAnswer: jest.fn(), onSpotlight: jest.fn(), spotlight: false, onOpenCard: jest.fn() }) as never;

const openChip = () => fireEvent.click(screen.getByRole('button', { name: /open the cowork window/i }));

beforeEach(() => {
  jest.clearAllMocks();
  (useFdxSync as jest.Mock).mockReturnValue(snapshot());
});

describe('FdxCoworkControl — janela minimizada por padrão', () => {
  it('ativo: nasce como chip, sem a janela', () => {
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByRole('button', { name: /open the cowork window/i })).toBeInTheDocument();
    expect(screen.getByText('.fdx cowork')).toBeInTheDocument();
    expect(screen.queryByText('Sync now')).toBeNull();
    expect(screen.queryByRole('button', { name: /minimize the cowork window/i })).toBeNull();
  });

  it('inativo: nada, nem o chip', () => {
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({ active: false }));
    const { container } = render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('chip → janela (Sync now, Auto-sync, stop discreto) → "–" volta ao chip', () => {
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    openChip();
    expect(screen.getByText('Sync now')).toBeInTheDocument();
    expect(screen.getByText('Auto-sync on')).toBeInTheDocument();
    expect(screen.getByText('stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open the cowork window/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /minimize the cowork window/i }));
    expect(screen.getByRole('button', { name: /open the cowork window/i })).toBeInTheDocument();
    expect(screen.queryByText('Sync now')).toBeNull();
  });

  it('o chip diz em que pé está: Synced, Syncing (com progresso), Extracting, File changed, Error', () => {
    const { rerender } = render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByText('Synced')).toBeInTheDocument();

    // Elemento NOVO a cada rerender: com o mesmo objeto o React faz bail-out e
    // o componente nem roda de novo.
    const show = (over: Record<string, unknown>) => {
      (useFdxSync as jest.Mock).mockReturnValue(snapshot(over));
      rerender(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    };
    show({ status: 'syncing' });
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    show({ status: 'syncing', progress: { done: 3, total: 12 } });
    expect(screen.getByText('Syncing 3/12')).toBeInTheDocument();
    show({ pending: { count: 2, since: '2026-10-14T12:01:00.000Z', braindumpId: 'fdx_job2', proseLength: 100 } });
    expect(screen.getByText('Extracting…')).toBeInTheDocument();
    // O board já viu o braindump_complete: a IA terminou, os cards ainda não pousaram.
    show({ pending: { count: 2, since: '2026-10-14T12:01:00.000Z', braindumpId: 'fdx_job2', proseLength: 100, completedAt: '2026-10-14T12:03:00.000Z' } });
    expect(screen.getByText('Landing…')).toBeInTheDocument();
    show({ dirty: true, auto: false });
    expect(screen.getByText('File changed')).toBeInTheDocument();
    show({ status: 'error', lastError: 'boom' });
    expect(screen.getByText('Error')).toBeInTheDocument();
    show({ lastSyncAt: undefined });
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('o chip mostra quantas perguntas do cowork esperam resposta', () => {
    render(<FdxCoworkControl storyId="s1" auth={AUTH} strip={strip([fdxRow('c1'), fdxRow('c2')])} />);
    expect(screen.getByText('2 to confirm')).toBeInTheDocument();
  });

  it('minimizar NÃO para o cowork; o stop do rodapé para', () => {
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    openChip();
    fireEvent.click(screen.getByRole('button', { name: /minimize the cowork window/i }));
    expect(stopFdxSync).not.toHaveBeenCalled();
    openChip();
    fireEvent.click(screen.getByText('stop'));
    expect(stopFdxSync).toHaveBeenCalledTimes(1);
  });
});
