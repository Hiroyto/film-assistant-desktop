import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { InlineText } from './inlineText';
import { RichText, paperFromDom, paperHtml, plainOf, richRuns } from './richText';

const dom = (html: string) => { const el = document.createElement('div'); el.innerHTML = html; return el; };

describe('sticky words (FIL-714)', () => {
  it('reads **bold**, *italic* and __underline__ runs and leaves unpaired markers as typed', () => {
    expect(richRuns('**Scene one** the *storm* night')).toEqual([
      { text: 'Scene one', b: true }, { text: ' the ' }, { text: 'storm', i: true }, { text: ' night' },
    ]);
    expect(richRuns('a * b')).toEqual([{ text: 'a * b' }]);
    expect(richRuns('__under__')).toEqual([{ text: 'under', u: true }]);
  });

  it('nests markers: ***both*** is bold italic, no stars left over (Ben 2026-10-31)', () => {
    expect(richRuns('***ediedi***')).toEqual([{ text: 'ediedi', b: true, i: true }]);
    expect(richRuns('**a *b* c**')).toEqual([{ text: 'a ', b: true }, { text: 'b', b: true, i: true }, { text: ' c', b: true }]);
  });

  it('reads an escaped star as a star', () => {
    expect(richRuns('5 \\* 3 \\* 2')).toEqual([{ text: '5 * 3 * 2' }]);
  });

  it('strips markers for sizing and model reads', () => {
    expect(plainOf('**Scene one**\nNell *hides* the ***book***')).toBe('Scene one\nNell hides the book');
  });

  it('writes what the editor holds as markers, and reads them back the same', () => {
    const cases: Array<[string, string]> = [
      ['<b><i>ediedi</i></b>', '***ediedi***'],
      ['Test<br>u<br><br><b>bold</b> and <i>it</i>', 'Test\nu\n\n**bold** and *it*'],
      ['<div>one</div><div><u>two</u></div>', 'one\n__two__'],
      ['<b>bold </b>next', '**bold** next'],
      ['5 * 3', '5 \\* 3'],
    ];
    for (const [html, text] of cases) {
      expect(paperFromDom(dom(html))).toBe(text);
      expect(paperFromDom(dom(paperHtml(text)))).toBe(text);
    }
  });

  it('draws the writer\'s paragraphs and styles', () => {
    const { container } = render(<RichText text={'**Scene one**\nNell __hides__ the book'} />);
    expect(container.querySelector('strong')?.textContent).toBe('Scene one');
    expect(container.querySelector('u')?.textContent).toBe('hides');
    expect(container.textContent).toBe('Scene one\nNell hides the book');
  });

  it('paper mode edits styled words, not markers', () => {
    const { container } = render(<InlineText value="**Scene one**" paper onSave={jest.fn()} testId="t" />);
    const el = container.querySelector('[data-inline-text="t"]') as HTMLElement;
    expect(el.textContent).toBe('Scene one');
    expect(el.querySelector('b')?.textContent).toBe('Scene one');
  });

  it('paper mode: Enter is a new paragraph, not a save; Cmd+Enter saves', () => {
    const onSave = jest.fn();
    const { container } = render(<InlineText value="" paper autoFocus onSave={onSave} testId="t" />);
    const el = container.querySelector('[data-inline-text="t"]') as HTMLElement;
    el.focus();
    el.innerHTML = 'First thought<br><b>then</b>';
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: 'Enter', metaKey: true });
    fireEvent.blur(el);
    expect(onSave).toHaveBeenCalledWith('First thought\n**then**');
  });

  it('outside paper mode Enter still saves', () => {
    const onSave = jest.fn();
    const { container } = render(<InlineText value="" autoFocus onSave={onSave} testId="t" />);
    const el = container.querySelector('[data-inline-text="t"]') as HTMLElement;
    el.focus();
    el.textContent = 'A title';
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.blur(el);
    expect(onSave).toHaveBeenCalledWith('A title');
  });
});

