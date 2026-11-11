/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// Trava de edição do roteiro durante o cowork: read-only por padrão com o
// aviso; destravar pede confirmação (risco de conflito) e vale só para a
// sessão e a story. `craco test`.
jest.mock('../../lib/fdxSync', () => ({
  fdxCoworkFileFor: jest.fn(),
  getFdxSyncSnapshot: jest.fn(() => ({})),
  subscribeFdxSync: jest.fn(() => () => {}),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { fdxCoworkFileFor, getFdxSyncSnapshot, subscribeFdxSync } from '../../lib/fdxSync';
import { FdxCoworkLockBar, useFdxCoworkLock } from './FdxCoworkLockBar';

function Harness({ storyId }: { storyId: string }): JSX.Element {
  const lock = useFdxCoworkLock(storyId);
  return (
    <div>
      <span data-testid="ro">{String(lock.readOnly)}</span>
      <FdxCoworkLockBar lock={lock} theme="dark" />
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  (getFdxSyncSnapshot as jest.Mock).mockReturnValue({});
  (subscribeFdxSync as jest.Mock).mockImplementation(() => () => {});
  (fdxCoworkFileFor as jest.Mock).mockReturnValue('pilot.fdx');
});

describe('useFdxCoworkLock + FdxCoworkLockBar', () => {
  it('sem cowork: nada travado, nenhuma barra', () => {
    (fdxCoworkFileFor as jest.Mock).mockReturnValue(null);
    render(<Harness storyId="s1" />);
    expect(screen.getByTestId('ro').textContent).toBe('false');
    expect(screen.queryByTestId('cowork-lock-bar')).toBeNull();
  });

  it('cowork ligado: read-only com o arquivo na barra; destravar pede confirmação com o aviso de conflito; voltar a travar', () => {
    render(<Harness storyId="s1" />);
    expect(screen.getByTestId('ro').textContent).toBe('true');
    expect(screen.getByTestId('cowork-lock-bar')).toHaveTextContent('Read-only');
    expect(screen.getByTestId('cowork-lock-bar')).toHaveTextContent('pilot.fdx');

    fireEvent.click(screen.getByText('Enable editing…'));
    expect(screen.getByRole('dialog')).toHaveTextContent(/conflict/i);
    fireEvent.click(screen.getByText('Keep read-only'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('ro').textContent).toBe('true');

    fireEvent.click(screen.getByText('Enable editing…'));
    fireEvent.click(screen.getByText('Enable editing anyway'));
    expect(screen.getByTestId('ro').textContent).toBe('false');
    expect(screen.getByTestId('cowork-lock-bar')).toHaveTextContent(/overwrite each other/);
    expect(sessionStorage.getItem('ff-fdx-edit-unlock-s1')).toBe('1');

    fireEvent.click(screen.getByText('Back to read-only'));
    expect(screen.getByTestId('ro').textContent).toBe('true');
    expect(sessionStorage.getItem('ff-fdx-edit-unlock-s1')).toBeNull();
  });

  it('cowork com um .fountain: a barra e o aviso nomeiam o arquivo, não o Final Draft', () => {
    (fdxCoworkFileFor as jest.Mock).mockReturnValue('tide.fountain');
    render(<Harness storyId="s1" />);
    const bar = screen.getByTestId('cowork-lock-bar');
    expect(bar).toHaveTextContent('Read-only. This screenplay is coworking with tide.fountain. Edits made here would conflict with the file.');
    fireEvent.click(screen.getByText('Enable editing…'));
    expect(screen.getByRole('dialog')).toHaveTextContent('being written in tide.fountain and synced to the board after every save');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Final Draft');
  });

  it('cowork com um .fdx: os textos do Final Draft ficam', () => {
    render(<Harness storyId="s1" />);
    expect(screen.getByTestId('cowork-lock-bar')).toHaveTextContent('coworking with pilot.fdx in Final Draft.');
  });

  it('a escolha é por story e por sessão', () => {
    sessionStorage.setItem('ff-fdx-edit-unlock-s1', '1');
    const { rerender } = render(<Harness storyId="s1" />);
    expect(screen.getByTestId('ro').textContent).toBe('false');
    rerender(<Harness storyId="s2" />);
    expect(screen.getByTestId('ro').textContent).toBe('true');
  });
});
