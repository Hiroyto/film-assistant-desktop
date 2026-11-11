// components/Freeform/corkboard/inlineText.tsx
//
// Linear-style inline editing (Ben, 2026-10-08): the text IS the editor. No
// box opens, no mode switch; the words keep their type and place, the caret
// lands in them, and leaving saves. Enter saves (Shift+Enter for a line
// break), Esc puts the old words back. Plain text only. Pointer events stop
// inside it while it is live so typing never starts a drag on the board.
//
// PAPER MODE (FIL-714, Philip 2026-10-30: "I press enter and it disappears"):
// with `paper`, Enter is a new paragraph and Cmd/Ctrl+Enter saves, as on a
// sheet of paper; Cmd/Ctrl+B, I and U (or PaperBar) make real bold, italic
// and underline. The writer edits styled words, never markers (Ben,
// 2026-10-31); the saved text carries them as markers (richText.tsx).

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { paperFromDom, paperHtml } from './richText';

export function InlineText({ value, onSave, onCancel, placeholder, style, className, multiline = true, autoFocus = false, editable = true, as = 'div', testId, allowEmpty = false, paper = false }: {
  value: string;
  /** Fired on blur or Enter when the words changed. */
  onSave: (text: string) => void;
  /** Fired on Esc, and on blur with no change. */
  onCancel?: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  multiline?: boolean;
  /** Start live, caret at the end (a sticky the writer just clicked). */
  autoFocus?: boolean;
  editable?: boolean;
  as?: 'div' | 'span';
  testId?: string;
  /** Emptying the field is an edit (saves ''), not a revert. For optional
   *  fields such as a sticky's note (2026-10-12: a label could not be deleted). */
  allowEmpty?: boolean;
  /** Enter is a paragraph, Cmd/Ctrl+Enter saves, Cmd/Ctrl+B / I / U style
   *  the words; the value carries markers (stickies; FIL-714). */
  paper?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [live, setLive] = useState(false);
  const valueRef = useRef(value);
  // The DOM holds the words while live; React only writes them when idle,
  // so a refetch mid-edit cannot yank the caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || live) return;
    if (paper) el.innerHTML = paperHtml(value);
    else if (el.textContent !== value) el.textContent = value;
    valueRef.current = value;
  }, [value, live, paper]);
  useEffect(() => {
    if (!autoFocus || !editable) return;
    const el = ref.current;
    if (!el) return;
    setLive(true);
    // No scroll on focus: the board moves the view itself, and a focus scroll
    // cut the focus pan short (a new card stopped at the bottom edge).
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    } catch { /* jsdom */ }
  }, [autoFocus, editable]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = paper ? paperFromDom(el) : el.textContent;
    const text = String(raw ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    setLive(false);
    if ((text || allowEmpty) && text !== valueRef.current.trim()) { valueRef.current = text; onSave(text); }
    else { put(el, valueRef.current); onCancel?.(); }
  };
  const put = (el: HTMLElement, v: string) => { if (paper) el.innerHTML = paperHtml(v); else el.textContent = v; };
  const revert = () => {
    const el = ref.current;
    if (el) put(el, valueRef.current);
    setLive(false);
    el?.blur();
    onCancel?.();
  };
  const Tag = as as any;
  const empty = !value.trim();
  return (
    <>
    <style>{INLINE_CSS}</style>
    <Tag
      ref={ref}
      data-inline-text={testId ?? ''}
      data-placeholder={placeholder ?? ''}
      role={editable ? 'textbox' : undefined}
      aria-label={placeholder}
      contentEditable={editable ? (paper ? 'true' : 'plaintext-only') : undefined}
      suppressContentEditableWarning
      spellCheck={false}
      className={className}
      onFocus={editable ? () => setLive(true) : undefined}
      onBlur={editable ? commit : undefined}
      onPointerDown={editable && live ? (e: React.PointerEvent) => { e.stopPropagation(); } : undefined}
      onPointerUp={editable && live ? (e: React.PointerEvent) => { e.stopPropagation(); } : undefined}
      onClick={editable && live ? (e: React.MouseEvent) => { e.stopPropagation(); } : undefined}
      onKeyDown={editable ? (e: React.KeyboardEvent) => {
        e.stopPropagation();
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape') { e.preventDefault(); revert(); }
        else if (paper && mod && !e.shiftKey && !e.altKey && PAPER_KEYS[e.key.toLowerCase()]) { e.preventDefault(); try { document.execCommand(PAPER_KEYS[e.key.toLowerCase()]); } catch { /* jsdom */ } }
        else if (paper && e.key === 'Enter') {
          e.preventDefault();
          if (mod) (ref.current as HTMLElement | null)?.blur();
          else { try { document.execCommand('insertLineBreak'); } catch { /* jsdom */ } }
        }
        else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); (ref.current as HTMLElement | null)?.blur(); }
      } : undefined}
      onPaste={editable ? (e: React.ClipboardEvent) => {
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        try { document.execCommand('insertText', false, t); } catch { /* jsdom */ }
      } : undefined}
      style={{
        outline: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: editable ? 'text' : undefined, minWidth: 8, display: as === 'span' ? 'inline' : 'block',
        ...(empty && !live ? { minHeight: '1.4em' } : {}),
        ...(live ? { boxShadow: 'inset 0 -1.5px 0 0 currentColor' } : {}),
        ...style,
      }}
    />
    </>
  );
}

const PAPER_KEYS: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };

const INLINE_CSS = `[data-inline-text]:empty::before{content:attr(data-placeholder);opacity:.5;pointer-events:none}`;
