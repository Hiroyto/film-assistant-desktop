// src/lib/screenplayParse.ts
//
// Screenplay element classification (Layers 0+1 of the import parser).
// LAW: classify once at ingest from the richest signal available, store typed
// blocks, never re-guess at render.
//
//   Layer 0 (layout): pdf.js positioned items -> physical lines with x-offsets
//     -> per-document indent columns encoded INTO the canonical text as
//     leading spaces (so braindump prose, source spans, and the classifier all
//     share one text and spans stay valid offsets). Page-number/header
//     artifacts are dropped by position; vertical gaps become blank lines.
//   Layer 1 (grammar): a Fountain-style state machine over the lines. With
//     layout, the per-document indent clusters name the elements
//     (self-calibrating: relative columns, not absolute inches). Without
//     layout (pasted or legacy flat text) grammar + lookahead carry it:
//     notably, an all-caps line whose next line starts lowercase is a CAPS
//     INTRO inside action, never a character cue.
//
// Consumers: pdfText.ts (PDF -> indented text), importedTextToHtml in
// freeform-script.tsx (text -> typed paragraphs), the editor's plain-text
// paste + Reformat (editor/extensions/PlainTextPaste.ts). Eval:
// screenplayParse.test.ts over a real positioned-PDF fixture, the flat and
// indented Shawshank 24pp, Paul's pilot scene one and Ben's tide-gauge scene.
//
// MIRROR: freeform-workflow-app/lib/screenplay-parse.mjs is the server port.
// Any change to the grammar lands in BOTH files; both evals run the same
// fixtures.
//
// 2026-09-15 (Ben's import-formatting regression):
//   - Column detection ignores FRONT MATTER (everything above the first
//     slugline). Scene one now carries the title page (the August span fix),
//     and a flush-left contact block on that page formed the shallowest
//     indent cluster, which the detector took as the action column; every
//     role shifted one column and scene one came out all-action.
//   - The action column is a KNOWN band, so a body whose margin is not the
//     document's leftmost x (that same title page) stops flagging every
//     action paragraph as residue.
//   - TITLE PAGE detection: the head of the front matter, up to the first
//     line that reads as script, becomes `title` blocks (one per line).
//   - SPEECH GROUPS survive a blank line: the first line after a cue (or a
//     parenthetical) is speech even across a blank, so double-spaced plain
//     text (the editor's own paste/carve shape) keeps its cues. A blank
//     after a dialogue line still ends the speech unless a wryly follows.
//   - Curly quotes and apostrophes are cue furniture (SERGEANT “HAYES”).
//   - perLine / inScript options + classifyParagraphs for the editor's
//     Reformat (one block per paragraph, cues allowed without a slugline).
//   - DOCUMENT COLUMNS FOR SHORT SLICES (2026-09-16, Reckless Roger import):
//     a scene slice with fewer than three indent clusters fell to the flat
//     grammar, where any short caps line with a parenthetical speaks
//     ("MUSIC CARRIES OVER (1:18)" became a cue over a paragraph of action
//     although it sat in the action column). documentRoles() reads the
//     columns once per window and opts.roles hands them to every slice.
//   - Script-start lines (OVER BLACK, FADE IN, TITLE CARD) never cue, and a
//     cue extension never carries digits or a colon (timestamps).

export type ScriptLineType =
  | 'title' | 'scene' | 'description' | 'character' | 'dialogue' | 'parenthetical' | 'transition';

export interface PdfTextItem {
  str: string; x: number; y: number; w: number;
  /** The paragraph this run belongs to, from a TAGGED PDF's structure tree
   *  (pdfText.ts). Absent on untagged PDFs. */
  para?: string;
}
export interface PdfPageItems { width: number; height: number; items: PdfTextItem[] }

export interface ScriptBlock {
  type: ScriptLineType;
  text: string;
  /** L2 confidence scoring: true when the decision was weak (flat-mode speech
   *  that could have swallowed action, layout lines in no known column, L3
   *  demotions). These are the spans a model referee would re-judge; until
   *  live imports show residue here, the referee lane stays unbuilt. */
  uncertain?: true;
}

export interface ClassifyOptions {
  /** The text sits inside a script: cues are allowed before any slugline and
   *  no title page is detected (a selection, a mid-document paste). */
  inScript?: boolean;
  /** One block per non-blank line: no page-artifact skipping, no multi-line
   *  parentheticals. For callers that map blocks back onto editor paragraphs. */
  perLine?: boolean;
  /** Column roles read from the whole document (documentRoles), handed to a
   *  slice too short to find its own. null = treat as flat text. */
  roles?: IndentRoles | null;
  /** The text is in the TYPED layout (an FDX / Fade In import): every
   *  element sits on its own exact column, so the columns ARE the types and
   *  nothing is guessed. See classifyTypedText. */
  typed?: boolean;
}

// ---- shared grammar --------------------------------------------------------

const SLUG_LINE = /^(INT|EXT|EST|INT\.?\s*\/\s*EXT|I\/E)[.\s\-–]/i;
const TRANSITION_RE = /^(CUT TO|SMASH CUT|MATCH CUT|WIPE TO|DISSOLVE TO|FADE (IN|OUT|TO|UP)|IRIS (IN|OUT)|TIME CUT)\b[.: ]*$|[A-Z ]+TO:$/;
// (\d+\.?)+ also catches a page number stamped twice at one spot ("2.2.").
const PAGE_ARTIFACT = /^\s*((\d+\.?)+|\(CONTINUED\)|CONTINUED:?( \(\d+\))?|\(MORE\))\s*$/i;
// A cue is caps plus the usual furniture: digits, apostrophes (straight or
// curly), quotes, dots, hyphens, and a parenthetical extension ((O.S.),
// (V.O.), (CONT'D), (into phone)...).
// Extensions may stack: WOMAN (O.S.) (CONT'D).
// No digits or colons inside the extension: "(1:18)" is a timestamp on a
// sound direction, not a speaker.
const CUE_SHAPE = /^[A-Z0-9 .'’‘“”"\-#&]+(\s*\((?:[^)0-9:]{1,24})\))*\s*$/;
// Caps lines that are camera/editing directions, never speakers.
// BEGIN / END / END OF forms of a montage, series, intercut or flashback are
// structure, never speakers ("BEGIN MONTAGE" was a cue, 2026-09-16).
const SHOT_HEADING = /^(CLOSE ?UP|CLOSE ON|CLOSE SHOT|ANGLE|ANGLES? ON|INSERT|POV|REVERSE|WIDE|WIDER|AERIAL|TRACKING|MOVING|PAN|TILT|CRANE|ESTABLISHING|MONTAGE|SERIES OF SHOTS|BACK TO|TITLE|SUPER|LATER|CONTINUOUS|INTERCUT|FLASHBACK|(BEGIN|END|END OF)\s+(MONTAGE|SERIES|INTERCUT|FLASHBACK|DREAM))\b/;
// Lines that open the script proper; a title page never runs past one.
const SCRIPT_START = /^(FADE IN|FADE UP|OVER BLACK|ON BLACK|FROM BLACK|IN BLACK|BLACK SCREEN|BLACKNESS|DARKNESS|TITLE CARD|TITLES?:|SUPER:|SUPERIMPOSE|MONTAGE|INSERT|OPEN ON|WE OPEN|COLD OPEN|TEASER|PROLOGUE|ACT ONE|ACT 1)\b/i;
// Lines that mark a title page: bylines, source credits, contact, rights.
const TITLE_MARKER = /^(written|screenplay|teleplay|story|created|original screenplay|an original screenplay|adapted|directed)\b|^by\b|^\(?based (up)?on\b|@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\brights reserved\b|copyright|©|\bwga\b|\bdraft\b|\brevision\b|\bregistered\b|\b[a-z0-9-]+\.(com|net|org|io|co|uk|me|tv|film)\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}$|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/i;
const TITLE_MAX_LINES = 25;

const isCapsish = (t: string) => {
  const core = t.replace(/\([^)]*\)/g, '').trim();
  return core.length >= 2 && core === core.toUpperCase() && /[A-Z]/.test(core);
};

// ---- Layer 0: positioned items -> physical lines -> indented text ----------

interface PhysicalLine { text: string; x: number; y: number; page: number; para?: string; /** right edge of the last run */ right: number }

/** Group a page's items into physical lines by y (screenplay PDFs are a single
 *  column, so same-baseline items are one line), items joined in x order. */
export function linesFromPdfPages(pages: PdfPageItems[]): { lines: PhysicalLine[]; charWidth: number; leftMargin: number; lineGap: number } {
  const lines: PhysicalLine[] = [];
  const widths: number[] = [];
  const Y_TOL = 2.5;
  pages.forEach((page, pi) => {
    const rows = new Map<number, PdfTextItem[]>();
    for (const it of page.items) {
      if (!it.str || !it.str.trim()) continue;
      if (it.str.length >= 4 && it.w > 0) widths.push(it.w / it.str.length);
      let key: number | null = null;
      for (const k of rows.keys()) if (Math.abs(k - it.y) <= Y_TOL) { key = k; break; }
      if (key === null) { key = it.y; rows.set(key, []); }
      rows.get(key)!.push(it);
    }
    const charW = median(widths) || 7.2;
    for (const [y, row] of rows) {
      row.sort((a, b) => a.x - b.x);
      const items = stripMarginMarks(row, page.width, median(widths) || 7.2);
      let text = '';
      let cursor: number | null = null;
      let prev: PdfTextItem | null = null;
      for (const it of items) {
        // A run printed twice at the same spot (Final Draft stamps the page
        // number twice) would join into "2.2." and slip past the artifact
        // filter: keep one.
        if (prev && prev.str === it.str && Math.abs(prev.x - it.x) < 0.5) continue;
        prev = it;
        if (cursor !== null && it.x - cursor > charW * 0.6) text += ' ';
        text += it.str;
        cursor = it.x + it.w;
      }
      const t = text.trim();
      if (!t) continue;
      const x = items[0].x;
      // Positional page furniture: bare numbers / CONTINUED in the top or
      // bottom margin bands never reach the text, scene numbers and all
      // ("12 CONTINUED: 12" heads a shooting script's page).
      const topBand = y > page.height * 0.93;
      const bottomBand = y < page.height * 0.06;
      const bare = t.replace(/^\d{1,4}[A-Z]{0,2}\.?\s+/, '').replace(/(\s+\d{1,4}[A-Z]{0,2}\.?)+\s*$/, '');
      if ((topBand || bottomBand) && (PAGE_ARTIFACT.test(t) || PAGE_ARTIFACT.test(bare))) continue;
      if (/^\(?CONTINUED\)?:?$/i.test(bare)) continue;
      const para = items.find((it) => it.para)?.para;
      const right = Math.max(...items.map((it) => it.x + (it.w || it.str.length * charW)));
      lines.push({ text: t, x, y, page: pi, right, ...(para ? { para } : {}) });
    }
  });
  // Reading order: page, then top-to-bottom (pdf y origin is bottom-left).
  lines.sort((a, b) => a.page - b.page || b.y - a.y);
  const charWidth = median(widths) || 7.2;
  // The body's left edge: the leftmost x a real share of lines sit on, not
  // the leftmost mark on the page. One stray margin mark (a scene number on
  // a heading with no INT/EXT, a revision letter) used to become the edge and
  // shift every column for the whole document. Lines left of it clamp to 0.
  const leftMargin = bodyLeftEdge(lines.map((l) => l.x));
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue;
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0.5) gaps.push(g);
  }
  return { lines, charWidth, leftMargin, lineGap: baseGap(gaps) || 12 };
}

// SCENE NUMBERS (2026-10-02, Ben's Final Draft PDF of Heads and Tails came
// in with every slugline as "1 EXT. STREET - NIGHT 1 1"): Final Draft prints
// a slugline's number in BOTH margins. Kept, they hid every slugline from the
// scene matchers (all anchored at INT/EXT) and the left-margin number became
// the page's left edge, shifting every column. Scene numbers ride only on
// sluglines, so they are stripped only where what is left is one; revision
// asterisks in the right margin go everywhere.
const SCENE_NO = /^\d{1,4}[A-Z]{0,2}\.?$/;

function stripMarginMarks(items: PdfTextItem[], pageWidth: number, charW: number): PdfTextItem[] {
  let body = items;
  while (body.length > 1 && /^\*+$/.test(body[body.length - 1].str.trim()) && body[body.length - 1].x > pageWidth * 0.75) {
    body = body.slice(0, -1);
  }
  // A margin number stands APART from the heading (Final Draft prints them
  // half an inch out); a number the writer typed ("EXT. HIGHWAY 61") sits
  // one space from its words and stays.
  const apart = (a: PdfTextItem, b: PdfTextItem) => b.x - (a.x + (a.w || a.str.length * charW)) >= charW * 2.5;
  let lead = 0;
  while (lead < body.length - 1 && SCENE_NO.test(body[lead].str.trim()) && apart(body[lead], body[lead + 1])) lead++;
  // The right margin may carry the number twice: the RUN of numbers must
  // stand apart from the heading's last word.
  let tail = body.length;
  while (tail - 1 > lead && SCENE_NO.test(body[tail - 1].str.trim())) tail--;
  if (tail < body.length && !apart(body[tail - 1], body[tail])) tail = body.length;
  if (lead === 0 && tail === body.length) return body;
  const rest = body.slice(lead, tail).map((it) => it.str).join(' ').trim();
  return SLUG_LINE.test(rest) ? body.slice(lead, tail) : body;
}

function bodyLeftEdge(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const floor = Math.max(3, Math.ceil(xs.length * 0.05));
  for (let i = 0; i < sorted.length; i++) {
    let n = 0;
    for (let j = i; j < sorted.length && sorted[j] - sorted[i] <= 2; j++) n++;
    if (n >= floor) return sorted[i];
  }
  return sorted[0];
}

/** The SINGLE-line spacing: the smallest COMMON vertical gap, not the
 *  median. In a dialogue-heavy script (cue, one-line speech, one-line
 *  action) most gaps are paragraph gaps, so the median is the double gap
 *  and "1.7x the median" never fires: every paragraph on a page fused into
 *  one block (Paul's pilot, 2026-09-15: 17 blank lines in 589, all at page
 *  tops). Gaps cluster within +-0.75pt; the shallowest cluster holding at
 *  least 5% of the gaps (and 3) is the line pitch. */
function baseGap(gaps: number[]): number {
  if (!gaps.length) return 0;
  const sorted = [...gaps].sort((a, b) => a - b);
  const clusters: Array<{ center: number; count: number }> = [];
  for (const g of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && g - last.center <= 0.75) {
      last.center = (last.center * last.count + g) / (last.count + 1);
      last.count += 1;
    } else clusters.push({ center: g, count: 1 });
  }
  const floor = Math.max(3, Math.ceil(gaps.length * 0.05));
  const base = clusters.find((c) => c.count >= floor);
  return base ? base.center : median(gaps);
}

/** A vertical gap that opens a new paragraph. Not "a whole blank line": only
 *  Final Draft-style PDFs space paragraphs by a full line. Word and Docs
 *  space them by paragraph spacing (Word's default is ~1.5x the line pitch),
 *  and the old 1.7x cutoff fused every action paragraph on the page into one
 *  block (Paul, 2026-09-23, a Word-made pilot). Lines inside a paragraph sit
 *  on the base pitch within a point or two, so anything 30% and 3pt past it
 *  is a paragraph break. */
const isParagraphGap = (gap: number, lineGap: number) =>
  gap > lineGap * 1.3 && gap - lineGap >= 3;

/** The canonical text: each physical line indented by its column (leading
 *  spaces = x offset in character cells), vertical gaps become blank lines.
 *  This is the ONE text braindump prose, source spans, and the classifier
 *  share; the layout signal survives flattening because it IS the text. */
export function pdfPagesToIndentedText(pages: PdfPageItems[]): string {
  const { lines, charWidth, leftMargin, lineGap } = linesFromPdfPages(pages);
  const indentOf = (l: PhysicalLine) => Math.max(0, Math.min(60, Math.round((l.x - leftMargin) / charWidth)));
  const useTags = trustParagraphTags(lines, indentOf, lineGap);
  const colRight = columnRightEdges(lines, indentOf);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i > 0) {
      const prev = lines[i - 1];
      // PAGE BREAKS (2026-10-02, the import eval: a speech that ran over a
      // page came back as two). A Final Draft speech split carries (MORE) at
      // the foot and CUE (CONT'D) at the head: drop both, the speech goes on.
      if (prev.page !== l.page && MORE_LINE.test(prev.text) && CONTD_CUE.test(l.text)) {
        if (out.length && MORE_LINE.test(out[out.length - 1].trim())) out.pop();
        continue;
      }
      const gap = prev.page === l.page ? prev.y - l.y : Infinity;
      if (prev.page !== l.page && continuesOverPage(prev, l, indentOf)) { /* one paragraph */ }
      else if (isParagraphGap(gap, lineGap)) out.push('');
      // A TAGGED PDF names its paragraphs: a new one in the SAME column is a
      // break geometry may not see (a Docs script typed with no paragraph
      // spacing). Only within a column: a column change already separates
      // cue, wryly and speech, and a blank inside a speech would end it.
      else if (useTags && l.para && prev.para && l.para !== prev.para && Math.abs(indentOf(l) - indentOf(prev)) <= 1) out.push('');
      // WRAP INVARIANT, for untagged PDFs with no paragraph spacing (a Docs
      // script typed with one Enter per paragraph): word wrap only breaks a
      // line when the next word does not fit, so a line that stops short
      // with room for the next line's first word ended its paragraph.
      else if ((!useTags || !l.para || !prev.para) && prev.page === l.page && endsShort(prev, l, indentOf, colRight, charWidth)) out.push('');
    }
    out.push(' '.repeat(indentOf(l)) + l.text);
  }
  return out.join('\n').trim();
}

/** Each column's wrap edge: the 90th-percentile right edge of its lines
 *  (a column needs 6 lines before it has an edge worth trusting). */
function columnRightEdges(lines: PhysicalLine[], indentOf: (l: PhysicalLine) => number): Map<number, number> {
  const byCol = new Map<number, number[]>();
  for (const l of lines) {
    const c = indentOf(l);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(l.right);
  }
  const out = new Map<number, number>();
  for (const [c, rs] of byCol) {
    if (rs.length < 6) continue;
    const sorted = [...rs].sort((a, b) => a - b);
    out.set(c, sorted[Math.floor(sorted.length * 0.9)]);
  }
  return out;
}

function endsShort(prev: PhysicalLine, l: PhysicalLine, indentOf: (l: PhysicalLine) => number, colRight: Map<number, number>, charWidth: number): boolean {
  if (indentOf(prev) !== indentOf(l)) return false;
  const edge = colRight.get(indentOf(prev));
  if (edge === undefined) return false;
  const firstWord = l.text.split(/\s+/)[0] ?? '';
  // Room left on the line > a space + the next word, with half a cell slack.
  return edge - prev.right > (firstWord.length + 1.5) * charWidth;
}

const MORE_LINE = /^\(\s*MORE\s*\)$/i;
const CONTD_CUE = /^[A-Z0-9 .'’\-#&]+(\s*\([^)]{1,24}\))*\s*\(\s*CONT['’]?D\s*\)\s*$/;

/** Does a paragraph run on from the foot of one page to the head of the
 *  next? Word and Docs break paragraphs anywhere, mid-sentence. Tags cannot
 *  say (pdf.js builds the structure tree per page, so one paragraph has a
 *  different key on each side); a line that stops mid-sentence with the next
 *  line in the same column is one paragraph. Final Draft only breaks action
 *  at a sentence end and speech with (MORE), so its pages never trip this. */
function continuesOverPage(prev: PhysicalLine, l: PhysicalLine, indentOf: (l: PhysicalLine) => number): boolean {
  return Math.abs(indentOf(prev) - indentOf(l)) <= 1 && !/([.!?]["'”’)\]]*|:|--|—)$/.test(prev.text);
}

/** Are this PDF's paragraph tags worth believing? Most lines must carry one,
 *  and they must not split ordinary wrapped lines: a generator that tags
 *  every LINE as a paragraph would shred each action block. The test pairs
 *  are lines that geometry says continue a paragraph after a near-full line
 *  in the same column; if the tags break most of them, they are noise. */
function trustParagraphTags(lines: PhysicalLine[], indentOf: (l: PhysicalLine) => number, lineGap: number): boolean {
  if (!lines.length || lines.filter((l) => l.para).length < lines.length * 0.8) return false;
  const widest = new Map<number, number>();
  for (const l of lines) widest.set(indentOf(l), Math.max(widest.get(indentOf(l)) ?? 0, l.text.length));
  let pairs = 0;
  let split = 0;
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1];
    const b = lines[i];
    if (a.page !== b.page || indentOf(a) !== indentOf(b) || isParagraphGap(a.y - b.y, lineGap)) continue;
    if (a.text.length < (widest.get(indentOf(a)) ?? 0) * 0.8) continue;
    pairs++;
    if (a.para !== b.para) split++;
  }
  return pairs < 5 || split / pairs <= 0.5;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- Layer 1: the classifier ----------------------------------------------

interface Line { text: string; indent: number; blank: boolean }

export interface IndentRoles {
  action?: [number, number];
  dialogue?: [number, number];
  parenthetical?: [number, number];
  character?: [number, number];
  transition?: [number, number];
}

/** Per-document indent clusters -> element roles. Relative and self-
 *  calibrating: whatever columns THIS document uses, ranked action < dialogue
 *  < parenthetical < character < transition, cross-checked against content
 *  (a cue column is mostly caps; a parenthetical column mostly parens).
 *  Callers hand it the lines from the first slugline on: front matter votes
 *  for no column (a title page's flush-left contact block once won the
 *  action column and shifted every role, 2026-09-15). */
function detectIndentRoles(lines: Line[]): IndentRoles | null {
  const counts = new Map<number, number>();
  for (const l of lines) {
    if (l.blank) continue;
    counts.set(l.indent, (counts.get(l.indent) ?? 0) + 1);
  }
  // Bucket indents within +-1 into clusters.
  const centers: Array<{ center: number; count: number }> = [];
  for (const [ind, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    const last = centers[centers.length - 1];
    if (last && ind - last.center <= 2) {
      last.center = Math.round((last.center * last.count + ind * n) / (last.count + n));
      last.count += n;
    } else centers.push({ center: ind, count: n });
  }
  const meaningful = centers.filter((c) => c.count >= 2);
  if (meaningful.length < 3) return null; // flat text: no layout signal
  // The action column is the shallowest SUBSTANTIAL cluster: at least a tenth
  // of the biggest one. A two-line cluster at the far left (a window's head
  // slugline trimmed to indent 0, a title page's contact block) used to win
  // the action column and shift every role one column to the right
  // (2026-09-17, windows 2 and 3 of a re-import came out all-action).
  const biggest = Math.max(...meaningful.map((c) => c.count));
  const actionIdx = meaningful.findIndex((c) => c.count * 10 >= biggest);
  if (actionIdx < 0 || meaningful.length - actionIdx < 3) return null;
  const [actionCol, ...aboveAction] = meaningful.slice(actionIdx);
  const bandOf = (c: { center: number }) => [c.center - 2, c.center + 2] as [number, number];
  const roles: IndentRoles = { action: bandOf(actionCol) };
  const capsRatio = (band: [number, number]) => {
    const inBand = lines.filter((l) => !l.blank && l.indent >= band[0] && l.indent <= band[1]);
    return inBand.length ? inBand.filter((l) => isCapsish(l.text)).length / inBand.length : 0;
  };
  const parenRatio = (band: [number, number]) => {
    const inBand = lines.filter((l) => !l.blank && l.indent >= band[0] && l.indent <= band[1]);
    return inBand.length ? inBand.filter((l) => /^\(/.test(l.text)).length / inBand.length : 0;
  };
  // Assign by order, then verify by content; unverifiable columns are skipped
  // rather than guessed (grammar still sees those lines).
  const unassigned = [...aboveAction];
  // Character: the BIGGEST caps-dominated column. Depth alone is a trap: a
  // right-aligned transition column is also all-caps but has a handful of
  // lines, while a script's cue column has hundreds (the Shawshank fixture:
  // 172 cues at one column vs 5 transitions deeper right).
  const capsClusters = unassigned
    .map((c, idx) => ({ idx, c, ratio: capsRatio(bandOf(c)) }))
    .filter((x) => x.ratio >= 0.7);
  if (capsClusters.length) {
    const best = capsClusters.reduce((a, b) => (b.c.count > a.c.count ? b : a));
    roles.character = bandOf(best.c);
    // Anything meaningfully deeper than the cue column is transition ground.
    roles.transition = [roles.character[1] + 1, 999];
    unassigned.splice(best.idx, 1);
  }
  // Parenthetical: the parens-dominated column.
  for (let i = 0; i < unassigned.length; i++) {
    const band = bandOf(unassigned[i]);
    if (parenRatio(band) >= 0.6) {
      roles.parenthetical = bandOf(unassigned.splice(i, 1)[0]);
      break;
    }
  }
  // Dialogue: the shallowest remaining column above action.
  if (unassigned.length) roles.dialogue = bandOf(unassigned[0]);
  return roles.dialogue || roles.character ? roles : null;
}

const inBand = (indent: number, band?: [number, number]) => !!band && indent >= band[0] && indent <= band[1];

const toLines = (text: string): Line[] => text.split('\n').map((raw) => {
  const t = raw.replace(/\s+$/, '');
  const trimmed = t.trim();
  return { text: trimmed, indent: t.length - t.replace(/^ +/, '').length, blank: trimmed.length === 0 };
});

/** The document's column roles, front matter excluded. Computed once per
 *  window and handed to every scene slice via opts.roles, so a short scene
 *  reads its columns from the whole script instead of falling to the flat
 *  grammar. null = no layout signal (flat text). */
export function documentRoles(text: string): IndentRoles | null {
  const lines = toLines(text);
  const firstSlug = lines.findIndex((l) => !l.blank && SLUG_LINE.test(l.text));
  return detectIndentRoles(firstSlug > 0 ? lines.slice(firstSlug) : lines);
}

/** Index of the first line AFTER the title page (0 = no title page). The
 *  title page is the head of the front matter: it stops at the first line
 *  that reads as script (FADE IN, OVER BLACK, a transition, a shot heading,
 *  a sentence of prose) and only counts when at least one line is a title
 *  marker (a byline, a source credit, contact details, rights). Front matter
 *  with no marker is the cold open, not a title page. */
function titlePageEnd(lines: Line[]): number {
  const firstSlug = lines.findIndex((l) => !l.blank && SLUG_LINE.test(l.text));
  if (firstSlug <= 0) return 0;
  let end = 0; let marker = false; let seen = 0;
  for (let i = 0; i < firstSlug; i++) {
    const l = lines[i];
    if (l.blank) continue;
    const t = l.text;
    if (SCRIPT_START.test(t) || TRANSITION_RE.test(t) || SHOT_HEADING.test(t)) break;
    const isMarker = TITLE_MARKER.test(t);
    if (!isMarker) {
      const words = t.split(/\s+/).length;
      const sentence = /[.!?]["”')]*$/.test(t) && words >= 4;
      if (sentence || words >= 9 || t.length > 70) break;
    }
    if (++seen > TITLE_MAX_LINES) break;
    if (isMarker) marker = true;
    end = i + 1;
  }
  return marker ? end : 0;
}

/** Classify indented (or flat) text into typed screenplay blocks. */
export function classifyScriptText(text: string, opts: ClassifyOptions = {}): ScriptBlock[] {
  const lines = toLines(text);
  const roles = opts.roles !== undefined ? opts.roles : documentRoles(text);
  const titleEnd = opts.inScript ? 0 : titlePageEnd(lines);

  const blocks: ScriptBlock[] = [];
  // Property access (not a bare let) so TS control-flow narrowing doesn't
  // collapse the closure-mutated current block to never at the read sites.
  const state: { cur: ScriptBlock | null } = { cur: null };
  const close = () => { if (state.cur && state.cur.text.trim()) blocks.push(state.cur); state.cur = null; };
  const start = (type: ScriptLineType, text: string) => { close(); state.cur = { type, text }; };
  const append = (text: string) => { if (state.cur) state.cur.text += ` ${text}`; };

  // Dialogue-group state: inside a cue's speech (dialogue + parentheticals).
  // awaitingSpeech: the cue (or a wryly) has not been answered with dialogue
  // yet, so a blank line must not end the group.
  let inSpeech = false;
  let awaitingSpeech = false;
  let firstSlugSeen = !!opts.inScript;
  let openParen = false;

  const nextNonBlank = (from: number): Line | null => {
    for (let j = from; j < lines.length; j++) if (!lines[j].blank) return lines[j];
    return null;
  };
  const closeParenthetical = () => {
    if (opts.perLine) { close(); awaitingSpeech = true; } else openParen = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.blank) {
      close();
      openParen = false;
      // A blank line ends a speech only once the cue has been answered, and
      // never when a wryly is next: double-spaced plain text keeps its groups.
      if (inSpeech && !awaitingSpeech) {
        const nx = nextNonBlank(i + 1);
        if (!(nx && /^\(/.test(nx.text))) inSpeech = false;
      }
      continue;
    }
    const t = l.text;

    // Title page: one block per line, never merged, never a cue.
    if (i < titleEnd) {
      if (PAGE_ARTIFACT.test(t)) continue;
      close();
      blocks.push({ type: 'title', text: t });
      continue;
    }

    // Belt for flat text: page artifacts that had no positional strip.
    if (!opts.perLine && PAGE_ARTIFACT.test(t)) continue;

    // Multi-line parenthetical continuation.
    if (openParen) {
      append(t);
      if (/\)\s*$/.test(t)) { openParen = false; awaitingSpeech = true; }
      continue;
    }

    if (SLUG_LINE.test(t)) {
      firstSlugSeen = true;
      inSpeech = false;
      start('scene', t);
      close();
      continue;
    }

    if (isCapsish(t) && (TRANSITION_RE.test(t) || (inBand(l.indent, roles?.transition) && t.length <= 28))) {
      inSpeech = false;
      start('transition', t);
      close();
      continue;
    }

    // Nothing before the first slugline speaks: title pages and front matter
    // are description, never cues (kills the "TEST 2" -> cue trap).
    const canCue = firstSlugSeen;

    // Parenthetical (wryly) handling, flat/in-speech. A line starting "(":
    //  - pure standalone "(...)"  -> its own parenthetical block
    //  - genuinely unclosed "(..." -> opens a multi-line parenthetical
    //  - "(...) then more text"    -> INLINE wryly: this is dialogue, and L3
    //    peels the leading paren into its own block. The old bug set openParen
    //    on any line not ENDING in ")", so an inline wryly ate the whole speech.
    if (/^\(/.test(t) && inSpeech) {
      if (/^\([^)]*\)\s*$/.test(t)) { start('parenthetical', t); close(); awaitingSpeech = true; continue; }
      if (t.indexOf(')') === -1) { start('parenthetical', t); closeParenthetical(); continue; }
      if (state.cur?.type === 'dialogue') append(t);
      else start('dialogue', t);
      awaitingSpeech = false;
      continue;
    }

    // Character cue. Shot headings ("CLOSEUP -- PAROLE FORM", "INSERT",
    // "ANGLE ON...") are caps at cue-ish shapes but never speak: the " -- "
    // separator and the shot lexicon exclude them (they stay action).
    const next = nextNonBlank(i + 1);
    const shotHeading = / -- /.test(t) || SHOT_HEADING.test(t);
    const looksCue = canCue && isCapsish(t) && CUE_SHAPE.test(t) && !shotHeading && !SCRIPT_START.test(t) && t.length <= 40 && !!next;
    const cueByLayout = looksCue && inBand(l.indent, roles?.character);
    // Flat-text rule: an all-caps line whose successor starts lowercase is a
    // CAPS INTRO inside action ("ANDY DUFRESNE / is on the witness stand"),
    // never a cue. With layout the column already settled it.
    const nextStartsLower = !!next && /^[a-z]/.test(next.text);
    const cueByGrammar = looksCue && !roles && !nextStartsLower;
    if (cueByLayout || cueByGrammar) {
      inSpeech = false;
      start('character', t);
      close();
      inSpeech = true;
      awaitingSpeech = true;
      continue;
    }

    // Dialogue vs action.
    if (roles) {
      if (inBand(l.indent, roles.dialogue) && firstSlugSeen) {
        if (state.cur?.type === 'dialogue') append(t);
        else start('dialogue', t);
        awaitingSpeech = false;
        continue;
      }
      if (inBand(l.indent, roles.parenthetical) && /^\(/.test(t)) {
        if (/^\([^)]*\)\s*$/.test(t)) { start('parenthetical', t); close(); awaitingSpeech = true; continue; }
        if (t.indexOf(')') === -1) { start('parenthetical', t); closeParenthetical(); continue; }
        // Inline wryly at the parenthetical column: dialogue; L3 peels the paren.
        if (state.cur?.type === 'dialogue') append(t);
        else start('dialogue', t);
        awaitingSpeech = false;
        continue;
      }
      // Action column (or unknown): description. A line sitting in NO known
      // column is the layout path's residue: flag it for the referee.
      const knownColumn = l.indent <= 2 || inBand(l.indent, roles.action) || inBand(l.indent, roles.dialogue) || inBand(l.indent, roles.parenthetical) || inBand(l.indent, roles.character) || inBand(l.indent, roles.transition);
      inSpeech = false;
      if (state.cur?.type === 'description') append(t);
      else start('description', t);
      if (!knownColumn && state.cur) state.cur.uncertain = true;
      continue;
    }

    // A rejected cue (caps intro whose continuation starts lowercase) is
    // ACTION and ends any open speech — "ANDY DUFRESNE / is on the witness
    // stand" must never be swallowed into the previous speaker's dialogue.
    const capsIntro = isCapsish(t) && CUE_SHAPE.test(t) && nextStartsLower;
    if (capsIntro) {
      inSpeech = false;
      start('description', t);
      continue;
    }

    // Flat text: inside a speech, keep dialogue until a structural line ends
    // it. This is the known swallow-risk (no layout, no blank lines: a long
    // speech may have eaten trailing action) — long flat-mode speeches carry
    // the uncertain flag for the future referee.
    if (inSpeech) {
      if (state.cur?.type === 'dialogue') append(t);
      else start('dialogue', t);
      awaitingSpeech = false;
      if (state.cur && state.cur.text.length > 220) state.cur.uncertain = true;
      continue;
    }
    // A caps-intro line whose continuation starts lowercase merges into one
    // action block (un-shredding the PDF hard wrap).
    if (state.cur?.type === 'description' && /^[a-z]/.test(t)) append(t);
    else if (state.cur?.type === 'description') { close(); start('description', t); }
    else start('description', t);
  }
  close();
  return blocks;
}

// ---- Layer 3: invariant repair ---------------------------------------------
// Screenplay grammar as enforced rules over the classified blocks. The
// classifier is a per-line/per-column judgment; these are the GLOBAL laws no
// valid screenplay breaks, applied as deterministic repairs (no model calls):
//   1. A character cue must be followed by speech (dialogue/parenthetical).
//      An orphan cue is a caps line of action wearing the wrong hat: demote.
//   2. Dialogue must be preceded by its speech group (cue, parenthetical, or
//      more dialogue). Orphan dialogue is action: demote.
//   3. A parenthetical lives inside a speech group. Stray parens are action.
// Demotions cascade (a demoted cue orphans its dialogue), so repair runs to a
// fixed point; adjacent description blocks produced by demotion merge back.

export function repairScriptBlocks(blocks: ScriptBlock[], opts: { keepCount?: boolean } = {}): ScriptBlock[] {
  const out = blocks.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      const prev = out[i - 1];
      const next = out[i + 1];
      if (b.type === 'character' && (!next || (next.type !== 'dialogue' && next.type !== 'parenthetical'))) {
        b.type = 'description';
        b.uncertain = true; // a repair means the classifier misread something
        changed = true;
      } else if (b.type === 'dialogue' && (!prev || !['character', 'parenthetical', 'dialogue'].includes(prev.type))) {
        b.type = 'description';
        b.uncertain = true;
        changed = true;
      } else if (b.type === 'parenthetical' && (!prev || !['character', 'dialogue'].includes(prev.type))) {
        b.type = 'description';
        b.uncertain = true;
        changed = true;
      }
    }
  }
  // keepCount: the caller maps blocks back onto its own paragraphs 1:1, so
  // no merging and no peeling.
  if (opts.keepCount) return out;
  // Merge adjacent description blocks that demotion created (a demoted cue and
  // its demoted "dialogue" are one action paragraph again).
  const merged: ScriptBlock[] = [];
  for (const b of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === 'description' && b.type === 'description' && /^[a-z]/.test(b.text)) {
      last.text += ` ${b.text}`;
    } else merged.push(b);
  }
  // Peel a LEADING inline parenthetical out of a dialogue block into its own
  // parenthetical block. Screenplays put a wryly on its own indented line;
  // PDFs routinely inline it at the head of the speech ("(refers to his notes)
  // I'll see you in Hell..."). Repeats for stacked wrylies; a paren mid-word
  // ("I said (quote) no") is untouched because only a LEADING "(" peels.
  const peeled: ScriptBlock[] = [];
  for (const b of merged) {
    if (b.type !== 'dialogue') { peeled.push(b); continue; }
    let text = b.text;
    let m = /^(\([^)]*\))\s*([\s\S]*)$/.exec(text);
    while (m) {
      peeled.push({ type: 'parenthetical', text: m[1] });
      text = m[2];
      m = text ? /^(\([^)]*\))\s*([\s\S]*)$/.exec(text) : null;
    }
    if (text) peeled.push({ ...b, text });
  }
  return peeled;
}

/** Type a list of editor paragraphs 1:1 (the Reformat action). Returns one
 *  type per input, null for blank inputs or when the mapping cannot be
 *  guaranteed (the caller keeps the existing type). inScript defaults to
 *  true: a selection mid-script has no slugline above it. */
export function classifyParagraphs(texts: string[], opts: { inScript?: boolean } = {}): Array<ScriptLineType | null> {
  const idx: number[] = []; const parts: string[] = [];
  texts.forEach((t, i) => {
    const s = String(t ?? '').replace(/\s+/g, ' ').trim();
    if (s) { idx.push(i); parts.push(s); }
  });
  const out: Array<ScriptLineType | null> = texts.map(() => null);
  if (!parts.length) return out;
  const blocks = repairScriptBlocks(
    classifyScriptText(parts.join('\n\n'), { perLine: true, inScript: opts.inScript !== false }),
    { keepCount: true },
  );
  if (blocks.length !== parts.length) return out;
  blocks.forEach((b, k) => { out[idx[k]] = b.type; });
  return out;
}

// ---- Output ---------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- typed layout (FDX / Fade In imports) -----------------------------------

/** Exact columns of the TYPED layout. A Final Draft or Fade In file states
 *  every element's type, so the import text gives each type a column of its
 *  own and the classifier reads them back instead of guessing (guessing cost
 *  title-case cues, outlines and non-INT/EXT headings, 2026-10-02: 24 of
 *  Ben's FDX files). Action sits ONE column right of sluglines: invisible to
 *  every layout reader (indent clusters bucket within 2), decisive here.
 *  MIRROR: freeform-workflow-app/lib/screenplay-parse.mjs. */
export const TYPED_COLUMNS: Record<ScriptLineType, number> = {
  scene: 0, description: 1, dialogue: 10, parenthetical: 16, character: 22, title: 30, transition: 45,
};

/** Typed-layout text -> blocks. A block is a run of lines on one column; a
 *  blank line or a column change starts the next. The text's FIRST line has
 *  always lost its indent (the import trims its text, the window splitter
 *  trims each window), so it reads from content: a slugline is a scene, a
 *  line heading a title page is title, anything else action. */
export function classifyTypedText(text: string): ScriptBlock[] {
  const byCol = new Map<number, ScriptLineType>(
    (Object.entries(TYPED_COLUMNS) as Array<[ScriptLineType, number]>).map(([t, c]) => [c, t]),
  );
  const lines = toLines(text);
  const firstIdx = lines.findIndex((l) => !l.blank);
  const blocks: ScriptBlock[] = [];
  let cur: ScriptBlock | null = null;
  lines.forEach((l, i) => {
    if (l.blank) { cur = null; return; }
    let type = byCol.get(l.indent) ?? 'description';
    if (i === firstIdx && l.indent === 0 && !SLUG_LINE.test(l.text)) {
      const next = lines.slice(i + 1).find((x) => !x.blank);
      type = next && byCol.get(next.indent) === 'title' ? 'title' : 'description';
    }
    // Title lines are one block each (the title page is laid out per line).
    if (cur && cur.type === type && type !== 'title') { cur.text += ' ' + l.text; return; }
    cur = { type, text: l.text };
    blocks.push(cur);
  });
  return blocks;
}

/** Does this text use the TYPED layout? For readers that hold the stored
 *  prose but not the job's layout flag (the script view's span fallback,
 *  when the server's page write did not land). The signature no PDF makes:
 *  sluglines at column 0 and action exactly ONE column right of them (Layer 0
 *  puts both at the same x). */
export function isTypedLayout(text: string): boolean {
  const lines = toLines(text).slice(1).filter((l) => !l.blank); // line one is trimmed
  const slugAt0 = lines.filter((l) => l.indent === 0 && SLUG_LINE.test(l.text)).length;
  const at1 = lines.filter((l) => l.indent === 1).length;
  const actionAt0 = lines.filter((l) => l.indent === 0 && !SLUG_LINE.test(l.text)).length;
  return slugAt0 >= 1 && at1 >= 2 && at1 > actionAt0 * 4;
}

export function scriptBlocksToHtml(blocks: ScriptBlock[]): string {
  return blocks
    .map((b) => `<p data-line-type="${b.type}">${escapeHtml(b.text)}</p>`)
    .join('');
}

/** L2 residue report: how much of this document a model referee would have to
 *  re-judge. The go/no-go meter for building the referee lane. */
export function scriptParseResidue(blocks: ScriptBlock[]): { blocks: number; uncertain: number } {
  return { blocks: blocks.length, uncertain: blocks.filter((b) => b.uncertain).length };
}

export function scriptTextToHtml(text: string, opts: ClassifyOptions = {}): string {
  const blocks = opts.typed ? classifyTypedText(text) : repairScriptBlocks(classifyScriptText(text, opts));
  const residue = scriptParseResidue(blocks);
  if (residue.uncertain > 0) {
    // eslint-disable-next-line no-console
    console.info('[screenplay-parse] residue', residue);
  }
  return scriptBlocksToHtml(blocks);
}
