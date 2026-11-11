/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// A janela do cowork nasce minimizada (um chip); o chip abre a janela; "–"
// minimiza de volta; "stop" fica discreto no rodapé da janela aberta. `craco test`.
jest.mock('../../lib/fdxSync', () => ({
  bindFdxSync: jest.fn(),
  chooseFdxCandidate: jest.fn(async () => null),
  confirmFdxCandidate: jest.fn(async () => true),
  discardFdxCandidate: jest.fn(async () => undefined),
  dismissFdxUndo: jest.fn(),
  undoFdxResync: jest.fn(async () => undefined),
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
import { chooseFdxCandidate, confirmFdxCandidate, discardFdxCandidate, dismissFdxUndo, stopFdxSync, undoFdxResync } from '../../lib/fdxSync';
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

describe('FdxCoworkControl — arquivo perdido, confirmação do arquivo novo e desfazer', () => {
  it('fileMissing: chip "File not found" e o alerta com "Choose the file…" (chooseFdxCandidate); "Later" fecha só o alerta', () => {
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({ active: false, fileMissing: 'pilot.fdx', lastSyncAt: undefined }));
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByText('File not found')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /file not found/i })).toHaveTextContent('pilot.fdx');
    fireEvent.click(screen.getByText('Choose the file…'));
    expect(chooseFdxCandidate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Later'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('File not found')).toBeInTheDocument(); // o chip fica
  });

  it('candidato: relatório + "Sync with this file" (confirm) / "Cancel" (discard); roteiro diferente vira "Sync anyway" com o aviso', () => {
    const report = { scenes: 3, matched: 2, changed: 1, added: 1, missing: 0, mapped: 2, sameScript: true };
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({
      active: false, fileMissing: 'pilot.fdx', candidate: { fileName: 'pilot.fdx', path: 'C:/p.fdx', report },
    }));
    const { rerender } = render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByTestId('cowork-candidate-report')).toHaveTextContent('3 scenes in the file. 2 match the board (1 changed since the last sync), 1 new.');
    fireEvent.click(screen.getByText('Sync with this file'));
    expect(confirmFdxCandidate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel'));
    expect(discardFdxCandidate).toHaveBeenCalledTimes(1);

    (useFdxSync as jest.Mock).mockReturnValue(snapshot({
      active: false, fileMissing: 'pilot.fdx',
      candidate: { fileName: 'other.fdx', path: 'D:/o.fdx', report: { ...report, matched: 0, added: 3, missing: 2, sameScript: false } },
    }));
    rerender(<FdxCoworkControl key="2" storyId="s1" auth={AUTH} />);
    expect(screen.getByText('Sync anyway')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(/doesn't look like the same screenplay/);
  });

  it('depois de confirmar: faixa "Wrong file?" com Undo (undoFdxResync) e dispensar (dismissFdxUndo)', () => {
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({ undo: { fileName: 'other.fdx', previousFileName: 'pilot.fdx', at: 'x' } }));
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByRole('status')).toHaveTextContent('Now syncing with other.fdx (was pilot.fdx). Wrong file?');
    fireEvent.click(screen.getByText('Undo'));
    expect(undoFdxResync).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissFdxUndo).toHaveBeenCalledTimes(1);
  });
});

describe('FdxCoworkControl — cowork com um .fountain', () => {
  it('o chip e a janela nomeiam o formato do arquivo, e o auto-sync explica a espera', () => {
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({ fileName: 'tide.fountain' }));
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByText('.fountain cowork')).toBeInTheDocument();
    expect(screen.queryByText('.fdx cowork')).toBeNull();
    openChip();
    expect(screen.getByText('.fountain cowork')).toBeInTheDocument();
    expect(screen.getByText('Auto-sync on')).toHaveAttribute('title', expect.stringMatching(/after the file stops changing/));
  });

  it('arquivo perdido: o alerta não fala em Final Draft', () => {
    (useFdxSync as jest.Mock).mockReturnValue(snapshot({ active: false, fileName: 'tide.fountain', fileMissing: 'tide.fountain', lastSyncAt: undefined }));
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    expect(screen.getByRole('dialog', { name: 'Fountain file not found' })).toHaveTextContent('tide.fountain');
    expect(screen.queryByText(/Final Draft/)).toBeNull();
  });

  it('um .fdx continua com os textos do Final Draft', () => {
    render(<FdxCoworkControl storyId="s1" auth={AUTH} />);
    openChip();
    expect(screen.getByText('Auto-sync on')).toHaveAttribute('title', expect.stringMatching(/every Final Draft save/));
  });
});
