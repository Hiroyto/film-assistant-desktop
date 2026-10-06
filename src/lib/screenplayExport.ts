// src/lib/screenplayExport.ts
//
// The script's way out (PDF, Final Draft) and Final Draft's way in.
//
//   layoutScreenplay   typed blocks -> paginated lines, Final Draft geometry:
//                      Courier 12pt, 6 lines/inch, 54 body lines a page,
//                      sluglines never stranded at a page foot, speeches
//                      split with (MORE) / (CONT'D), action split only
//                      between sentences. Pure, so it is testable.
//   exportScreenplayPdf  the layout drawn with jsPDF.
//   blocksToFdx / exportScreenplayFdx   Final Draft XML out.
//   fdxToBlocks        Final Draft XML in (Fade In exports FDX too).
//   blocksToIndentedText  typed blocks -> the canonical indented text the
//                      import pipeline reads (the same shape pdfText.ts
//                      builds from a PDF), so an FDX import rides the one
//                      extraction door and the classifier reads exact
//                      columns instead of guessing.
//
// Paul, 2026-09-23: his imported action came back fused into one paragraph.
// The old exporter (exportScreenplayToPdf) had the same fault in the other
// direction: no space between action paragraphs, 1.5x line spacing, and
// jsPDF's built-in Courier silently dropping every em dash and curly quote.

import { TYPED_COLUMNS, type ScriptLineType } from './screenplayParse';

export interface ExportBlock { type: ScriptLineType; text: string }

// ---- geometry (inches; the page is letter, 8.5 x 11) -----------------------

const LPP = 54;               // body lines per page: 1in top + 1in bottom margins
const PT_PER_LINE = 12;       // 6 lines per inch
const TOP_IN = 1;
const PAGE_W_IN = 8.5;
const RIGHT_EDGE_IN = 7.5;    // 1in right margin

interface Column { x: number; width: number }   // x from the page's left edge; width in characters (10 cpi)
const COLUMN: Record<Exclude<ScriptLineType, 'title' | 'transition'>, Column> = {
  scene: { x: 1.5, width: 60 },
  description: { x: 1.5, width: 60 },
  character: { x: 3.7, width: 38 },
  parenthetical: { x: 3.1, width: 23 },
  dialogue: { x: 2.5, width: 35 },
};
// Blank lines above each element (Final Draft's default screenplay template).
const SPACE_BEFORE: Record<ScriptLineType, number> = {
  title: 0, scene: 1, description: 1, character: 1, parenthetical: 0, dialogue: 0, transition: 1,
};

export interface LaidLine { text: string; x: number; align?: 'right' | 'center' }
/** One sheet: LPP slots, null = blank. */
export type LaidPage = Array<LaidLine | null>;
export interface ScreenplayLayout { titlePage: Array<{ line: LaidLine; slot: number }> | null; pages: LaidPage[] }

// ---- text helpers ------------------------------------------------------------

/** The PDF's Courier is a standard font: WinAnsi only. Em dashes, curly
 *  quotes and ellipses vanish without a trace, so they become the
 *  typewriter forms a screenplay has always used. */
export function courierSafe(s: string): string {
  return s
    .replace(/\s*[—―]\s*/g, ' -- ')
    .replace(/–/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\t\n\r -~\u00a1-\u00ff]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ -- /, '-- ')
    .trim();
}

/** Word wrap to a width in characters (Courier is fixed pitch, so characters
 *  are the honest unit). A word longer than the line breaks hard. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (line) { out.push(line); line = ''; }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

const CONTD = /\s*\((CONT'?D|CONT’D|CONTINUED)\)\s*$/i;

// ---- title page ----------------------------------------------------------------

// The editor's title roles (Screenwritingline.tsx), so the PDF lays the page
// out the way the writer saw it: head a third of the way down, a gap before
// each credit, the contact block at the foot, flush left.
const TITLE_CREDIT = /^(written|screenplay|teleplay|story|created|original screenplay|an original screenplay|adapted|directed|based)\b/i;
const TITLE_CONTACT = /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\brights reserved\b|copyright|©|\bwga\b|\bdraft\b|\brevision\b|\bregistered\b|\b[a-z0-9-]+\.(com|net|org|io|co|uk|me|tv|film)\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/i;
const TITLE_PAGE_LINES = 60; // the title page uses the whole sheet, 1in top to the foot

export function splitTitleLines(lines: string[]): { head: string[]; contact: string[] } {
  const firstContact = lines.findIndex((t) => TITLE_CONTACT.test(t));
  return firstContact < 0
    ? { head: lines, contact: [] }
    : { head: lines.slice(0, firstContact), contact: lines.slice(firstContact) };
}

function layoutTitlePage(lines: string[]): ScreenplayLayout['titlePage'] {
  if (!lines.length) return null;
  const { head, contact } = splitTitleLines(lines);
  const out: Array<{ line: LaidLine; slot: number }> = [];
  // Head: centred, starting a third of the way down (slot 20 of 60 below the
  // 1in top), three blank lines before a credit, one after it.
  let slot = 20;
  head.forEach((t, i) => {
    if (i > 0) slot += TITLE_CREDIT.test(t) ? 4 : TITLE_CREDIT.test(head[i - 1]) ? 2 : 1;
    out.push({ line: { text: t, x: PAGE_W_IN / 2, align: 'center' }, slot });
  });
  // Contact: flush left at the body margin, its last line on the foot line.
  const contactTop = TITLE_PAGE_LINES - 6 - contact.length;
  const headEnd = slot + 2;
  const start = Math.max(contactTop, headEnd);
  contact.forEach((t, i) => out.push({ line: { text: t, x: 1.5 }, slot: start + i }));
  // A head too long for the page (a Word "title page" that is really a
  // character list) pulls back to the top instead of running off the sheet.
  const last = Math.max(...out.map((o) => o.slot));
  if (last >= TITLE_PAGE_LINES) {
    const shift = last - TITLE_PAGE_LINES + 1;
    for (const o of out) o.slot = Math.max(0, o.slot - shift);
  }
  return out;
}

// ---- body pagination ---------------------------------------------------------

interface Part { type: ScriptLineType; text: string }
interface Unit {
  type: ScriptLineType;
  before: number;
  /** A speech is cue + parentheticals + dialogue; anything else is one part. */
  parts: Part[];
  lines: LaidLine[];
}

function laid(type: ScriptLineType, text: string): LaidLine[] {
  if (type === 'transition') return [{ text: text.toUpperCase(), x: RIGHT_EDGE_IN, align: 'right' }];
  const col = COLUMN[type as keyof typeof COLUMN] ?? COLUMN.description;
  const shown = type === 'scene' || type === 'character' ? text.toUpperCase() : text;
  return wrapText(shown, col.width).map((t) => ({ text: t, x: col.x }));
}
const layParts = (parts: Part[]) => parts.flatMap((p) => laid(p.type, p.text));

const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|[A-Z])\.$/;
/** Sentence pieces of a paragraph, for breaking a page inside it. A period
 *  after an abbreviation or an initial is not a sentence end. */
export function sentences(text: string): string[] {
  const raw = text.match(/[^.!?]*(?:[.!?]+["')\]]*|$)\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  const out: string[] = [];
  for (const piece of raw) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + piece;
    else out.push(piece);
  }
  return out.length ? out : [text];
}

/** The latest break that fits `max` lines: at a sentence end inside a
 *  dialogue or action part, or between parts (never right after a cue or a
 *  parenthetical). Final Draft breaks pages the same way and rewraps what
 *  follows, so the break is never mid-sentence. */
function splitParts(parts: Part[], max: number, minHead: number, minTail: number): [Part[], Part[]] | null {
  let best: [Part[], Part[]] | null = null;
  let bestLines = -1;
  const consider = (head: Part[], tail: Part[]) => {
    if (!tail.length || !head.length) return;
    const last = head[head.length - 1].type;
    if (last === 'character' || last === 'parenthetical') return;
    const h = layParts(head).length;
    if (h > max || h < minHead || h <= bestLines) return;
    if (layParts(tail).length < minTail) return;
    best = [head, tail];
    bestLines = h;
  };
  parts.forEach((p, i) => {
    const before = parts.slice(0, i);
    if (p.type === 'dialogue' || p.type === 'description') {
      const ss = sentences(p.text);
      for (let j = 1; j < ss.length; j++) {
        consider(
          [...before, { type: p.type, text: ss.slice(0, j).join(' ') }],
          [{ type: p.type, text: ss.slice(j).join(' ') }, ...parts.slice(i + 1)],
        );
      }
    }
    consider(parts.slice(0, i + 1), parts.slice(i + 1));
  });
  return best;
}

/** Blocks -> units: a speech (cue + parentheticals + dialogue) is ONE unit so
 *  the paginator can split it the Final Draft way; everything else is one
 *  unit per block. */
function toUnits(blocks: ExportBlock[]): Unit[] {
  const units: Unit[] = [];
  let speech: Unit | null = null;
  for (const b of blocks) {
    if (b.type === 'character') {
      speech = { type: 'character', before: SPACE_BEFORE.character, parts: [b], lines: laid(b.type, b.text) };
      units.push(speech);
      continue;
    }
    if (speech && (b.type === 'dialogue' || b.type === 'parenthetical')) {
      speech.parts.push(b);
      speech.lines.push(...laid(b.type, b.text));
      continue;
    }
    speech = null;
    units.push({ type: b.type, before: SPACE_BEFORE[b.type], parts: [b], lines: laid(b.type, b.text) });
  }
  return units;
}

export function layoutScreenplay(blocks: ExportBlock[]): ScreenplayLayout {
  const clean = blocks
    .map((b) => ({ type: b.type, text: courierSafe(b.text) }))
    .filter((b) => b.text.length > 0);
  const titlePage = layoutTitlePage(clean.filter((b) => b.type === 'title').map((b) => b.text));
  const units = toUnits(clean.filter((b) => b.type !== 'title'));

  const pages: LaidPage[] = [];
  let page: LaidPage = [];
  const newPage = () => { if (page.length) pages.push(page); page = []; };
  const room = () => LPP - page.length;
  const gapFor = (u: Unit) => (page.length ? u.before : 0);
  const put = (u: Unit, lines: LaidLine[]) => {
    for (let i = 0; i < gapFor(u); i++) page.push(null);
    page.push(...lines);
  };

  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const gap = gapFor(u);
    // A slugline keeps its first two lines of scene with it.
    let need = gap + u.lines.length;
    if (u.type === 'scene' && units[ui + 1]) need += units[ui + 1].before + Math.min(2, units[ui + 1].lines.length);
    if (need <= room()) { put(u, u.lines); continue; }

    const avail = room() - gap;
    if (u.type === 'character') {
      // Speech: the cue and at least two lines here with (MORE) under them;
      // the rest goes over under CUE (CONT'D).
      const cut = splitParts(u.parts, avail - 1, 3, 1);
      if (cut) {
        put(u, [...layParts(cut[0]), { text: '(MORE)', x: COLUMN.character.x }]);
        newPage();
        const cue = `${u.parts[0].text.replace(CONTD, '')} (CONT'D)`;
        page.push(...layParts([{ type: 'character', text: cue }, ...cut[1]]));
        continue;
      }
    } else if (u.type === 'description') {
      // Action splits between sentences, two lines either side.
      const cut = splitParts(u.parts, avail, 2, 2);
      if (cut) {
        put(u, layParts(cut[0]));
        newPage();
        page.push(...layParts(cut[1]));
        continue;
      }
    }
    newPage();
    // A unit longer than a whole page (a wall of action) breaks hard.
    let rest = u.lines;
    while (rest.length > LPP) {
      page.push(...rest.slice(0, LPP));
      newPage();
      rest = rest.slice(LPP);
    }
    page.push(...rest);
  }
  newPage();
  return { titlePage, pages };
}

// ---- PDF ------------------------------------------------------------------------

const safeFilename = (title: string, ext: string) =>
  `${(title || 'screenplay').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'screenplay'}.${ext}`;

export async function exportScreenplayPdf(blocks: ExportBlock[], title: string): Promise<void> {
  const doc = await buildScreenplayPdf(blocks, title);
  if (doc) doc.save(safeFilename(title, 'pdf'));
}

/** The PDF document itself (no download), or null when there is nothing to
 *  draw. Separate from the save so the layout can be checked end to end. */
export async function buildScreenplayPdf(blocks: ExportBlock[], title: string) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(12);
  // Baseline of slot i: the line box starts at the 1in top margin; Courier's
  // baseline sits ~9pt into a 12pt line.
  const baseline = (slot: number) => TOP_IN * 72 + slot * PT_PER_LINE + 9;
  const draw = (l: LaidLine, slot: number) => {
    const x = l.x * 72;
    if (l.align === 'right') doc.text(l.text, x, baseline(slot), { align: 'right' });
    else if (l.align === 'center') doc.text(l.text, x, baseline(slot), { align: 'center' });
    else doc.text(l.text, x, baseline(slot));
  };
  const layout = layoutScreenplay(blocks);
  let first = true;
  if (layout.titlePage) {
    for (const { line, slot } of layout.titlePage) draw(line, slot);
    first = false;
  }
  layout.pages.forEach((p, i) => {
    if (!first) doc.addPage();
    first = false;
    // Script page one carries no number; the rest are numbered top right,
    // half an inch down. The title page is not counted.
    if (i > 0) doc.text(`${i + 1}.`, RIGHT_EDGE_IN * 72, 0.5 * 72 + 9, { align: 'right' });
    p.forEach((l, slot) => { if (l) draw(l, slot); });
  });
  if (first) return null; // nothing to export
  doc.setProperties({ title: title || 'Screenplay', creator: 'FilmAssistant' });
  return doc;
}

// ---- Final Draft (.fdx) -----------------------------------------------------------

const FDX_TYPE: Record<ScriptLineType, string> = {
  title: 'Action',
  scene: 'Scene Heading',
  description: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
};

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal FDX: Final Draft fills element formatting from its own default
 *  template, so only the typed paragraphs travel. Text keeps its Unicode. */
export function blocksToFdx(blocks: ExportBlock[]): string {
  const para = (type: string, text: string, align?: string) =>
    `    <Paragraph${align ? ` Alignment="${align}"` : ''} Type="${type}">\n      <Text>${xmlEscape(text)}</Text>\n    </Paragraph>`;
  const body = blocks.filter((b) => b.type !== 'title' && b.text.trim());
  const titles = blocks.filter((b) => b.type === 'title' && b.text.trim()).map((b) => b.text.trim());
  const { head, contact } = splitTitleLines(titles);
  const titleXml = titles.length
    ? `  <TitlePage>\n    <Content>\n${[
        ...Array.from({ length: 16 }, () => para('Action', '', 'Center')),
        ...head.map((t) => para('Action', t, 'Center')),
        ...Array.from({ length: 12 }, () => para('Action', '', 'Left')),
        ...contact.map((t) => para('Action', t, 'Left')),
      ].join('\n')}\n    </Content>\n  </TitlePage>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n  <Content>\n${body
    .map((b) => para(FDX_TYPE[b.type], b.text.trim()))
    .join('\n')}\n  </Content>\n${titleXml}</FinalDraft>\n`;
}

export function exportScreenplayFdx(blocks: ExportBlock[], title: string): void {
  const blob = new Blob([blocksToFdx(blocks)], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(title, 'fdx');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Final Draft element names -> ours. Anything else (Shot, General, Cast List,
// New Act, End of Act, Lyrics, Outline...) reads as action: it sits at the
// action margin in Final Draft too.
const FROM_FDX: Record<string, ScriptLineType> = {
  'scene heading': 'scene',
  action: 'description',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
};

/** Parse an .fdx document into typed blocks: the title page first (as
 *  `title`), then the script. Dual dialogue flattens left speech then right.
 *  Script notes and revision marks are dropped; only the <Text> runs count. */
export function fdxToBlocks(xml: string): ExportBlock[] {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('That file is not valid Final Draft XML.');
  const root = dom.documentElement;
  if (!root || root.nodeName !== 'FinalDraft') throw new Error('That file is not a Final Draft document.');
  const textOf = (p: Element) =>
    Array.from(p.children)
      .filter((c) => c.nodeName === 'Text')
      .map((c) => c.textContent ?? '')
      .join('')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  // Paragraphs of a Content element, in order, descending through
  // DualDialogue wrappers but nothing else (ScriptNote bodies hold
  // Paragraphs too).
  const paragraphsOf = (content: Element | undefined): Element[] => {
    if (!content) return [];
    const out: Element[] = [];
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.nodeName === 'Paragraph') {
          out.push(c);
          for (const dd of Array.from(c.children)) if (dd.nodeName === 'DualDialogue') walk(dd);
        } else if (c.nodeName === 'DualDialogue') walk(c);
      }
    };
    walk(content);
    return out;
  };
  const child = (el: Element | null | undefined, name: string) =>
    el ? Array.from(el.children).find((c) => c.nodeName === name) : undefined;

  const blocks: ExportBlock[] = [];
  const titleContent = child(child(root, 'TitlePage'), 'Content');
  for (const p of paragraphsOf(titleContent)) {
    const t = textOf(p);
    if (t) blocks.push({ type: 'title', text: t });
  }
  for (const p of paragraphsOf(child(root, 'Content'))) {
    const t = textOf(p);
    if (!t) continue;
    const type = FROM_FDX[(p.getAttribute('Type') ?? '').toLowerCase()] ?? 'description';
    blocks.push({ type, text: t });
  }
  return blocks;
}

/** Parse Fade In's Open Screenplay Format (document.xml inside a .fadein)
 *  into typed blocks, title page first. The paragraph type lives on a
 *  <style> child whose attribute was renamed across versions: basestylename
 *  (1.2), baseStyleName (2.x), basestyle (4.0). */
export function osfToBlocks(xml: string): ExportBlock[] {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('That file is not valid Fade In XML.');
  const root = dom.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'document') throw new Error('That file is not a Fade In document.');
  const kids = (el: Element | null | undefined, name: string) =>
    el ? Array.from(el.children).filter((c) => c.nodeName.toLowerCase() === name) : [];
  const typeOf = (para: Element): ScriptLineType => {
    const style = kids(para, 'style')[0];
    const base = style
      ? (Array.from(style.attributes).find((a) => /^base_?style(name)?$/i.test(a.name))?.value ?? '')
      : '';
    return FROM_FDX[base.toLowerCase()] ?? 'description';
  };
  const textOf = (para: Element) =>
    kids(para, 'text').map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
  const blocks: ExportBlock[] = [];
  for (const para of kids(kids(root, 'titlepage')[0], 'para')) {
    const t = textOf(para);
    if (t) blocks.push({ type: 'title', text: t });
  }
  for (const para of kids(kids(root, 'paragraphs')[0], 'para')) {
    const t = textOf(para);
    if (t) blocks.push({ type: typeOf(para), text: t });
  }
  return blocks;
}

/** A .fadein file is a zip whose document.xml is Open Screenplay Format. */
export async function fadeInFileToBlocks(buf: ArrayBuffer): Promise<ExportBlock[]> {
  const { readZipEntry } = await import('./zipRead');
  let xml: Uint8Array | null;
  try {
    xml = await readZipEntry(buf, 'document.xml');
  } catch (e: any) {
    if (/zip/.test(String(e?.message))) throw new Error('That file is not a Fade In document.');
    throw e;
  }
  if (!xml) throw new Error('That Fade In file has no screenplay inside it.');
  return osfToBlocks(new TextDecoder().decode(xml));
}

/** Typed blocks -> the import text in the TYPED layout (TYPED_COLUMNS in
 *  screenplayParse): each element on its own exact column, cues and
 *  sluglines in caps the way Final Draft shows them. Sent with
 *  layout 'typed', so the server reads the columns as types instead of
 *  guessing; every other reader (the segmenter, scene spans, the layout
 *  classifier) still sees an ordinary indented script. */
export function blocksToIndentedText(blocks: ExportBlock[]): string {
  const out: string[] = [];
  let prev: ScriptLineType | null = null;
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    // A blank line wherever Final Draft spaces, and between two blocks of
    // one type (two dialogue paragraphs would otherwise read as one).
    if (prev && (SPACE_BEFORE[b.type] > 0 || prev === b.type || prev === 'title')) out.push('');
    const col = TYPED_COLUMNS[b.type];
    const shown = b.type === 'character' || b.type === 'scene' || b.type === 'transition' ? text.toUpperCase() : text;
    const width = b.type === 'title' || b.type === 'transition' ? 60 : COLUMN[b.type].width;
    const wrapped = b.type === 'title' || b.type === 'transition' ? [shown] : wrapText(shown, width);
    for (const line of wrapped) out.push(' '.repeat(col) + line);
    prev = b.type;
  }
  return out.join('\n');
}

/** Typed blocks from saved editor HTML (the paginated editor's paragraphs). */
export function blocksFromScreenplayHtml(html: string): ExportBlock[] {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  return Array.from(div.querySelectorAll('p')).map((p) => ({
    type: (p.getAttribute('data-line-type') || 'description') as ScriptLineType,
    text: p.textContent?.trim() ?? '',
  })).filter((b) => b.text.length > 0);
}
