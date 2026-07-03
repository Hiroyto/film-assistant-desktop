// Testes do BC-07 — Tour keyboard (COD-006) + palette consolidado (tech-debt #9).
import {
  isBlockedKey,
  isSkipKey,
  handleTourKeydown,
  BLOCKED_NAV_CODES,
} from '../tour/model/tourKeyboard';
import { createCommandPalette } from './model/commandPalette';

function fakeKey(opts: { key?: string; code?: string; metaKey?: boolean; ctrlKey?: boolean }) {
  return {
    key: opts.key ?? '',
    code: opts.code ?? '',
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    preventDefault: jest.fn(),
  } as unknown as KeyboardEvent;
}

describe('Tour keyboard (BR-MIGRAR-040 / COD-006)', () => {
  it('bloqueia as 9 navigation keys + TAB', () => {
    expect(BLOCKED_NAV_CODES).toContain('Tab');
    expect(isBlockedKey('ArrowDown')).toBe(true);
    expect(isBlockedKey('Tab')).toBe(true);
    expect(isBlockedKey('KeyA')).toBe(false);
  });
  it('ESC é skip explícito → chama onSkip + preventDefault', () => {
    const onSkip = jest.fn();
    const e = fakeKey({ key: 'Escape' });
    expect(handleTourKeydown(e, { onSkip })).toBe(true);
    expect(onSkip).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });
  it('tecla de navegação é bloqueada sem skip', () => {
    const onSkip = jest.fn();
    const e = fakeKey({ code: 'Tab' });
    expect(handleTourKeydown(e, { onSkip })).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
  it('isSkipKey só para Escape', () => {
    expect(isSkipKey('Escape')).toBe(true);
    expect(isSkipKey('Enter')).toBe(false);
  });
});

describe('commandPalette consolidado (tech-debt #9)', () => {
  it('Cmd+K alterna o open e notifica subscribers (um só listener)', () => {
    const cp = createCommandPalette();
    const seen: boolean[] = [];
    cp.subscribe((o) => seen.push(o));
    cp.handleKeydown(fakeKey({ key: 'k', metaKey: true }));
    expect(cp.isOpen()).toBe(true);
    cp.handleKeydown(fakeKey({ key: 'k', ctrlKey: true }));
    expect(cp.isOpen()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it('Escape fecha quando aberto', () => {
    const cp = createCommandPalette();
    cp.open();
    cp.handleKeydown(fakeKey({ key: 'Escape' }));
    expect(cp.isOpen()).toBe(false);
  });
});
