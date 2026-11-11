// The card sheets draw and edit the writer's formatting (Ben, 2026-11-01):
// a card made from a formatted sticky never shows its markers.
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { InlineText } from './editors';
import { EditableDescription } from './cards';

test('a sheet field in paper mode draws bold and italic, edits in place, and saves the marks', () => {
  const onSave = jest.fn(() => Promise.resolve());
  const { container } = render(<InlineText paper value={'She **never** looks *back*.'} onSave={onSave} />);
  const el = container.querySelector('[contenteditable]') as HTMLElement;
  expect(el.getAttribute('contenteditable')).toBe('true');
  expect(el.textContent).toBe('She never looks back.');
  expect(el.querySelector('b,strong')!.textContent).toBe('never');
  expect(el.querySelector('i,em')!.textContent).toBe('back');
  fireEvent.focus(el);
  el.innerHTML = 'She <b>always</b> looks <i>back</i>.';
  fireEvent.blur(el);
  expect(onSave).toHaveBeenCalledWith('She **always** looks *back*.');
});

test('the card description editor is paper too, and can be cleared', () => {
  const onSave = jest.fn(() => Promise.resolve());
  const { container } = render(<EditableDescription value={'__Mara__ runs.'} onSave={onSave} />);
  const el = container.querySelector('[contenteditable]') as HTMLElement;
  expect(el.querySelector('u')!.textContent).toBe('Mara');
  expect(el.textContent).not.toMatch(/_/);
  fireEvent.focus(el);
  el.innerHTML = '';
  fireEvent.blur(el);
  expect(onSave).toHaveBeenCalledWith('');
});
