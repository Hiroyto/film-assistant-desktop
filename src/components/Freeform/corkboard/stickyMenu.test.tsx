import { worldTitleOf } from './stickyMenu';

describe('what a sticky becomes', () => {
  it('a world entry from a sticky takes a title it never shows: the first line, cut near 80', () => {
    expect(worldTitleOf('**The tax**\nPaid in bread.')).toBe('The tax');
    expect(worldTitleOf('Mara finds flour on the stairs to the office at three in the morning and decides to say nothing about it to anyone')).toBe('Mara finds flour on the stairs to the office at three in the morning and decides…');
  });
});

describe('the sticky menu stays on screen (2026-11-01)', () => {
  const React = require('react');
  const { render, fireEvent } = require('@testing-library/react');
  const { StickyMenu } = require('./stickyMenu');
  const props = { dark: false, cards: [], onPutOn: () => {}, onDelete: () => {}, color: 'yellow', onColor: () => {}, onTurnInto: () => {} };
  const tall = (h: number) => Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-sticky-menu') ? h : 0; } });
  afterEach(() => { delete (HTMLElement.prototype as any).scrollHeight; });

  it('opened low, it moves up to fit; taller than the window, it fits and scrolls', () => {
    tall(400);
    const onClose = jest.fn();
    render(<StickyMenu {...props} at={{ x: 100, y: window.innerHeight - 20 }} onClose={onClose} />);
    const menu = document.querySelector('[data-sticky-menu]') as HTMLElement;
    expect(parseFloat(menu.style.top)).toBe(window.innerHeight - 400 - 8);
    expect(menu.style.maxHeight).toBe('');
  });

  it('taller than the window: pinned to the top, its height capped, it scrolls inside', () => {
    tall(window.innerHeight + 200);
    render(<StickyMenu {...props} at={{ x: 100, y: 300 }} onClose={() => {}} />);
    const menu = document.querySelector('[data-sticky-menu]') as HTMLElement;
    expect(menu.style.top).toBe('8px');
    expect(menu.style.maxHeight).toBe(`${window.innerHeight - 16}px`);
    expect(menu.style.overflowY).toBe('auto');
  });

  it('a scroll inside the menu keeps it open; a scroll outside closes it', () => {
    const onClose = jest.fn();
    render(<StickyMenu {...props} at={{ x: 100, y: 100 }} onClose={onClose} />);
    fireEvent.wheel(document.querySelector('[data-sticky-menu-item="turn-scene"]')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.wheel(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
