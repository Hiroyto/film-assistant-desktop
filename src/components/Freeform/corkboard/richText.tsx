// components/Freeform/corkboard/richText.tsx
//
// A sticky's words, drawn (FIL-714, Philip 2026-10-30): his own paragraphs
// kept, bold, italic and underline drawn styled. The stored text stays plain
// with markers in it (**bold**, *italic*, __underline__, \* for a typed star),
// so every reader of a fragment still gets a string. The writer never sees a
// marker (Ben, 2026-10-31: "getting the *s here"): InlineText's paper mode
// edits real bold/italic/underline and writes the markers on save.
//
// Markers are toggles, so they nest: ***both*** is bold italic. An opening
// marker counts only when the same marker closes it later on the line;
// anything else shows as typed.

import React, { useEffect, useState } from 'react';

export type Run = { text: string; b?: boolean; i?: boolean; u?: boolean };
type Mark = 'b' | 'i' | 'u';

/** One paragraph's runs, each with the styles in force over it. */
export function richRuns(line: string): Run[] {
  const out: Run[] = [];
  const on: Record<Mark, boolean> = { b: false, i: false, u: false };
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const last = out[out.length - 1];
    const same = last && !!last.b === on.b && !!last.i === on.i && !!last.u === on.u;
    if (same) last.text += buf;
    else out.push({ text: buf, ...(on.b ? { b: true } : {}), ...(on.i ? { i: true } : {}), ...(on.u ? { u: true } : {}) });
    buf = '';
  };
  /** Whether `tok` turns up unescaped after `from` (a closer for an opener). */
  const closes = (tok: string, from: number) => {
    for (let j = from; j <= line.length - tok.length; j++) {
      if (line[j] === '\\') { j++; continue; }
      if (line.startsWith(tok, j)) return true;
    }
    return false;
  };
  let k = 0;
  while (k < line.length) {
    const c = line[k];
    if (c === '\\' && k + 1 < line.length && '*_\\'.includes(line[k + 1])) { buf += line[k + 1]; k += 2; continue; }
    const tok = line.startsWith('**', k) ? '**' : line.startsWith('__', k) ? '__' : c === '*' ? '*' : '';
    if (tok) {
      const m: Mark = tok === '**' ? 'b' : tok === '__' ? 'u' : 'i';
      if (on[m] || closes(tok, k + tok.length)) { flush(); on[m] = !on[m]; k += tok.length; continue; }
    }
    // Not a marker: the first character shows as typed, and the next is
    // read on its own (an unpaired ** may still open a *).
    buf += c; k++;
  }
  flush();
  return out;
}

/** The words without their markers: for sizing, titles and model reads. */
export function plainOf(text: string): string {
  return text.split('\n').map((l) => richRuns(l).map((r) => r.text).join('')).join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The stored words as editable HTML: what the writer edits (paper mode). */
export function paperHtml(text: string): string {
  return text.split('\n').map((line) => richRuns(line).map((r) => {
    let h = esc(r.text);
    if (r.i) h = `<i>${h}</i>`;
    if (r.b) h = `<b>${h}</b>`;
    if (r.u) h = `<u>${h}</u>`;
    return h;
  }).join('')).join('<br>');
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);

/** What the writer made, as stored words: walks the editor's DOM (the
 *  browser's own <b>/<i>/<u>, <br> and <div> lines) and writes markers. */
export function paperFromDom(root: HTMLElement): string {
  const runs: Run[] = [];
  const push = (text: string, s: Record<Mark, boolean>) => { if (text) runs.push({ text, ...(s.b ? { b: true } : {}), ...(s.i ? { i: true } : {}), ...(s.u ? { u: true } : {}) }); };
  const endsLine = () => { const t = runs.map((r) => r.text).join(''); return !t || t.endsWith('\n'); };
  const walk = (n: Node, s: Record<Mark, boolean>) => {
    if (n.nodeType === 3) { push(String(n.nodeValue ?? '').replace(/\u00a0/g, ' '), s); return; }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    const tag = el.tagName;
    if (tag === 'BR') { push('\n', { b: false, i: false, u: false }); return; }
    const st = el.style;
    const weight = Number(st?.fontWeight) || (st?.fontWeight === 'bold' ? 700 : 0);
    const next = {
      b: tag === 'B' || tag === 'STRONG' ? true : weight ? weight >= 600 : s.b,
      i: tag === 'I' || tag === 'EM' ? true : st?.fontStyle ? st.fontStyle === 'italic' : s.i,
      u: tag === 'U' || /underline/.test(st?.textDecoration ?? '') || /underline/.test((st as any)?.textDecorationLine ?? '') ? true : s.u,
    };
    const block = BLOCK.has(tag);
    if (block && !endsLine()) push('\n', { b: false, i: false, u: false });
    el.childNodes.forEach((c) => walk(c, next));
  };
  root.childNodes.forEach((c) => walk(c, { b: false, i: false, u: false }));
  // Markers, opened and closed at every change of style, never across a line.
  let out = '';
  const cur: Record<Mark, boolean> = { b: false, i: false, u: false };
  const MARK: Record<Mark, string> = { u: '__', b: '**', i: '*' };
  const closeAll = () => { for (const m of ['i', 'b', 'u'] as Mark[]) if (cur[m]) { out += MARK[m]; cur[m] = false; } };
  for (const r of runs) {
    const parts = r.text.split('\n');
    for (let n = 0; n < parts.length; n++) {
      const p = parts[n];
      if (n > 0) { closeAll(); out += '\n'; }
      if (!p) continue;
      // Styles stay off over the spaces at a run's edges (** x** reads oddly).
      const lead = p.match(/^\s*/)?.[0] ?? '', trail = p.slice(lead.length).match(/\s*$/)?.[0] ?? '';
      const core = p.slice(lead.length, p.length - trail.length);
      for (const m of ['i', 'b', 'u'] as Mark[]) if (cur[m] && !r[m]) { out += MARK[m]; cur[m] = false; }
      out += lead;
      if (core) {
        for (const m of ['u', 'b', 'i'] as Mark[]) if (!cur[m] && r[m]) { out += MARK[m]; cur[m] = true; }
        out += core.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/__/g, '\\_\\_');
      }
      if (trail) { closeAll(); out += trail; }
    }
  }
  closeAll();
  return out;
}

export function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const paras = text.split('\n');
  return (
    <span data-rich-text style={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }}>
      {paras.map((p, n) => (
        <React.Fragment key={n}>
          {n > 0 && '\n'}
          {richRuns(p).map((r, k) => {
            let node: React.ReactNode = r.text;
            if (r.i) node = <em>{node}</em>;
            if (r.b) node = <strong style={{ fontWeight: 700 }}>{node}</strong>;
            if (r.u) node = <u>{node}</u>;
            return <React.Fragment key={k}>{node}</React.Fragment>;
          })}
        </React.Fragment>
      ))}
    </span>
  );
}

/** THE FORMATTING BAR (Ben, 2026-10-31: "a formatting panel above this"):
 *  bold, italic, underline over the live sticky. It acts on whatever paper
 *  field has the caret and never takes focus from it. */
export function PaperBar({ dark, style }: { dark: boolean; style?: React.CSSProperties }) {
  const [state, setState] = useState({ bold: false, italic: false, underline: false });
  useEffect(() => {
    const read = () => {
      try { setState({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline') }); } catch { /* jsdom */ }
    };
    document.addEventListener('selectionchange', read);
    read();
    return () => document.removeEventListener('selectionchange', read);
  }, []);
  const ink = dark ? '#e8e6e0' : '#2b2a25';
  const run = (cmd: 'bold' | 'italic' | 'underline') => {
    const el = document.activeElement as HTMLElement | null;
    if (!el?.closest?.('[data-inline-text]')) return;
    try { document.execCommand(cmd); } catch { /* jsdom */ }
    try { setState((s) => ({ ...s, [cmd]: document.queryCommandState(cmd) })); } catch { /* jsdom */ }
  };
  const btn = (cmd: 'bold' | 'italic' | 'underline', label: React.ReactNode, title: string) => (
    <button
      type="button" data-paper-bar-btn={cmd} title={title} aria-label={title} aria-pressed={state[cmd]}
      onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); run(cmd); }}
      style={{
        font: 'inherit', width: 26, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 5, cursor: 'pointer', color: ink,
        background: state[cmd] ? (dark ? 'rgba(255,255,255,.14)' : 'rgba(43,42,37,.10)') : 'transparent',
      }}
    >{label}</button>
  );
  return (
    <div
      data-paper-bar role="toolbar" aria-label="Formatting"
      onMouseDown={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', left: 0, bottom: 'calc(100% + 6px)', zIndex: 30,
        display: 'inline-flex', gap: 1, padding: 2, borderRadius: 7,
        background: dark ? '#26262c' : '#fffdf8',
        border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : 'rgba(43,42,37,.14)'}`,
        boxShadow: dark ? '0 6px 16px rgba(0,0,0,.5)' : '0 4px 12px rgba(60,50,30,.14)',
        fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif", fontSize: 13,
        ...style,
      }}
    >
      {btn('bold', <b>B</b>, 'Bold (⌘B)')}
      {btn('italic', <i>I</i>, 'Italic (⌘I)')}
      {btn('underline', <u>U</u>, 'Underline (⌘U)')}
    </div>
  );
}
