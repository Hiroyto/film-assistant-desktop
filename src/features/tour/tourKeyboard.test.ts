// COD-006 / BR-MIGRAR-040: the tour must block Tab (focus can't escape) and treat
// Escape as an explicit skip, while letting normal typing through.
import { handleTourKeydown, isBlockedKey, isSkipKey } from './model/tourKeyboard';

function ev(key: string, code: string) {
  const preventDefault = jest.fn();
  return { e: { key, code, preventDefault } as unknown as KeyboardEvent, preventDefault };
}

describe('handleTourKeydown (COD-006)', () => {
  it('Escape => explicit skip (preventDefault + onSkip), handled', () => {
    const onSkip = jest.fn();
    const { e, preventDefault } = ev('Escape', 'Escape');
    expect(handleTourKeydown(e, { onSkip })).toBe(true);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Tab is now blocked (the fix) without skipping', () => {
    const onSkip = jest.fn();
    const { e, preventDefault } = ev('Tab', 'Tab');
    expect(handleTourKeydown(e, { onSkip })).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('nav keys (ArrowUp) are blocked', () => {
    const { e, preventDefault } = ev('ArrowUp', 'ArrowUp');
    expect(handleTourKeydown(e, { onSkip: jest.fn() })).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('regular typing passes through', () => {
    const onSkip = jest.fn();
    const { e, preventDefault } = ev('a', 'KeyA');
    expect(handleTourKeydown(e, { onSkip })).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('isBlockedKey / isSkipKey', () => {
    expect(isBlockedKey('Tab')).toBe(true);
    expect(isBlockedKey('ArrowDown')).toBe(true);
    expect(isBlockedKey('KeyA')).toBe(false);
    expect(isSkipKey('Escape')).toBe(true);
    expect(isSkipKey('Enter')).toBe(false);
  });
});
