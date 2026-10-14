// O empty state do board: "Already have a screenplay?" é uma seção com header
// e dois botões — cowork num .fdx (só desktop, que tem o watcher) e import
// one-shot (em todo lugar). Cada um liga o seu handler.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoardEmptyState } from './emptyState';

const noop = () => {};

describe('BoardEmptyState — "Already have a screenplay?"', () => {
  it('desktop: header + as duas portas, cada uma no seu handler', () => {
    const onImport = jest.fn();
    const onCowork = jest.fn();
    render(<BoardEmptyState onBraindump={noop} onCreate={noop} onImport={onImport} onCowork={onCowork} />);

    expect(screen.getByRole('heading', { name: /already have a screenplay\?/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cowork with a \.fdx/i }));
    fireEvent.click(screen.getByRole('button', { name: /import a \.fdx once/i }));
    expect(onCowork).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('web (sem cowork): o header fica e só o import one-shot é oferecido', () => {
    render(<BoardEmptyState onBraindump={noop} onCreate={noop} onImport={noop} />);

    expect(screen.getByRole('heading', { name: /already have a screenplay\?/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cowork/i })).toBeNull();
    expect(screen.getByRole('button', { name: /import a \.fdx once/i })).toBeTruthy();
  });
});
