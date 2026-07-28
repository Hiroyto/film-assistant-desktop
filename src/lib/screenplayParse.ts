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
// freeform-script.tsx (text -> typed paragraphs). Eval: screenplayParse.test.ts
// over a real positioned-PDF fixture + the flat Shawshank 24pp.

export type ScriptLineType =
  | 'scene' | 'description' | 'character' | 'dialogue' | 'parenthetical' | 'transition';

export interface PdfTextItem { str: string; x: number; y: number; w: number }
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

// ---- shared grammar --------------------------------------------------------

const SLUG_LINE = /^(INT|EXT|EST|INT\.?\s*\/\s*EXT|I\/E)[.\s\-–]/i;
const TRANSITION_RE = /^(CUT TO|SMASH CUT|MATCH CUT|WIPE TO|DISSOLVE TO|FADE (IN|OUT|TO|UP)|IRIS (IN|OUT)|TIME CUT)\b[.: ]*$|[A-Z ]+TO:$/;
const PAGE_ARTIFACT = /^\s*(\d+\.?|\(CONTINUED\)|CONTINUED:?( \(\d+\))?|\(MORE\))\s*$/i;
// A cue is caps plus the usual furniture: digits, apostrophes, dots, hyphens,
// and a parenthetical extension ((O.S.), (V.O.), (CONT'D), (into phone)...).
const CUE_SHAPE = /^[A-Z0-9 .'\-#&]+(\s*\((?:[^)]{1,24})\))?\s*$/;
// Caps lines that are camera/editing directions, never speakers.
const SHOT_HEADING = /^(CLOSE ?UP|CLOSE ON|CLOSE SHOT|ANGLE|ANGLES? ON|INSERT|POV|REVERSE|WIDE|WIDER|AERIAL|TRACKING|MOVING|PAN|TILT|CRANE|ESTABLISHING|MONTAGE|SERIES OF SHOTS|BACK TO|TITLE|SUPER|LATER|CONTINUOUS|INTERCUT)\b/;

const isCapsish = (t: string) => {
  const core = t.replace(/\([^)]*\)/g, '').trim();
  return core.length >= 2 && core === core.toUpperCase() && /[A-Z]/.test(core);
};

// ---- Layer 0: positioned items -> physical lines -> indented text ----------

interface PhysicalLine { text: string; x: number; y: number; page: number }

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
    for (const [y, items] of rows) {
      items.sort((a, b) => a.x - b.x);
      let text = '';
      let cursor: number | null = null;
      for (const it of items) {
        if (cursor !== null && it.x - cursor > charW * 0.6) text += ' ';
        text += it.str;
        cursor = it.x + it.w;
      }
      const t = text.trim();
      if (!t) continue;
      const x = items[0].x;
      // Positional page furniture: bare numbers / CONTINUED in the top or
      // bottom margin bands never reach the text.
      const topBand = y > page.height * 0.93;
      const bottomBand = y < page.height * 0.06;
      if ((topBand || bottomBand) && PAGE_ARTIFACT.test(t)) continue;
      lines.push({ text: t, x, y, page: pi });
    }
  });
  // Reading order: page, then top-to-bottom (pdf y origin is bottom-left).
  lines.sort((a, b) => a.page - b.page || b.y - a.y);
  const charWidth = median(widths) || 7.2;
  const leftMargin = lines.length ? Math.min(...lines.map((l) => l.x)) : 0;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue;
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0.5) gaps.push(g);
  }
  return { lines, charWidth, leftMargin, lineGap: median(gaps) || 12 };
}

/** The canonical text: each physical line indented by its column (leading
 *  spaces = x offset in character cells), vertical gaps become blank lines.
 *  This is the ONE text braindump prose, source spans, and the classifier
 *  share; the layout signal survives flattening because it IS the text. */
export function pdfPagesToIndentedText(pages: PdfPageItems[]): string {
  const { lines, charWidth, leftMargin, lineGap } = linesFromPdfPages(pages);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i > 0) {
      const prev = lines[i - 1];
      const gap = prev.page === l.page ? prev.y - l.y : Infinity;
      if (gap > lineGap * 1.7) out.push('');
    }
    const indent = Math.max(0, Math.min(60, Math.round((l.x - leftMargin) / charWidth)));
    out.push(' '.repeat(indent) + l.text);
  }
  return out.join('\n').trim();
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---- Layer 1: the classifier ----------------------------------------------

interface Line { text: string; indent: number; blank: boolean }

interface IndentRoles {
  dialogue?: [number, number];
  parenthetical?: [number, number];
  character?: [number, number];
  transition?: [number, number];
}

/** Per-document indent clusters -> element roles. Relative and self-
 *  calibrating: whatever columns THIS document uses, ranked action < dialogue
 *  < parenthetical < character < transition, cross-checked against content
 *  (a cue column is mostly caps; a parenthetical column mostly parens). */
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
  const [, ...aboveAction] = meaningful; // meaningful[0] = action/slug column
  const roles: IndentRoles = {};
  const capsRatio = (band: [number, number]) => {
    const inBand = lines.filter((l) => !l.blank && l.indent >= band[0] && l.indent <= band[1]);
    return inBand.length ? inBand.filter((l) => isCapsish(l.text)).length / inBand.length : 0;
  };
  const parenRatio = (band: [number, number]) => {
    const inBand = lines.filter((l) => !l.blank && l.indent >= band[0] && l.indent <= band[1]);
    return inBand.length ? inBand.filter((l) => /^\(/.test(l.text)).length / inBand.length : 0;
  };
  const bandOf = (c: { center: number }) => [c.center - 2, c.center + 2] as [number, number];
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

/** Classify indented (or flat) text into typed screenplay blocks. */
export function classifyScriptText(text: string): ScriptBlock[] {
  const rawLines = text.split('\n');
  const lines: Line[] = rawLines.map((raw) => {
    const t = raw.replace(/\s+$/, '');
    const trimmed = t.trim();
    return { text: trimmed, indent: t.length - t.replace(/^ +/, '').length, blank: trimmed.length === 0 };
  });
  const roles = detectIndentRoles(lines);

  const blocks: ScriptBlock[] = [];
  // Property access (not a bare let) so TS control-flow narrowing doesn't
  // collapse the closure-mutated current block to never at the read sites.
  const state: { cur: ScriptBlock | null } = { cur: null };
  const close = () => { if (state.cur && state.cur.text.trim()) blocks.push(state.cur); state.cur = null; };
  const start = (type: ScriptLineType, text: string) => { close(); state.cur = { type, text }; };
  const append = (text: string) => { if (state.cur) state.cur.text += ` ${text}`; };

  // Dialogue-group state: inside a cue's speech (dialogue + parentheticals).
  let inSpeech = false;
  let firstSlugSeen = false;
  let openParen = false;

  const nextNonBlank = (from: number): Line | null => {
    for (let j = from; j < lines.length; j++) if (!lines[j].blank) return lines[j];
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.blank) { close(); inSpeech = false; openParen = false; continue; }
    const t = l.text;

    // Belt for flat text: page artifacts that had no positional strip.
    if (PAGE_ARTIFACT.test(t)) continue;

    // Multi-line parenthetical continuation.
    if (openParen) {
      append(t);
      if (/\)\s*$/.test(t)) { openParen = false; }
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
      if (/^\([^)]*\)\s*$/.test(t)) { start('parenthetical', t); close(); continue; }
      if (t.indexOf(')') === -1) { start('parenthetical', t); openParen = true; continue; }
      if (state.cur?.type === 'dialogue') append(t);
      else start('dialogue', t);
      continue;
    }

    // Character cue. Shot headings ("CLOSEUP -- PAROLE FORM", "INSERT",
    // "ANGLE ON...") are caps at cue-ish shapes but never speak: the " -- "
    // separator and the shot lexicon exclude them (they stay action).
    const next = nextNonBlank(i + 1);
    const shotHeading = / -- /.test(t) || SHOT_HEADING.test(t);
    const looksCue = canCue && isCapsish(t) && CUE_SHAPE.test(t) && !shotHeading && t.length <= 40 && !!next;
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
      continue;
    }

    // Dialogue vs action.
    if (roles) {
      if (inBand(l.indent, roles.dialogue) && firstSlugSeen) {
        if (state.cur?.type === 'dialogue') append(t);
        else start('dialogue', t);
        continue;
      }
      if (inBand(l.indent, roles.parenthetical) && /^\(/.test(t)) {
        if (/^\([^)]*\)\s*$/.test(t)) { start('parenthetical', t); close(); continue; }
        if (t.indexOf(')') === -1) { start('parenthetical', t); openParen = true; continue; }
        // Inline wryly at the parenthetical column: dialogue; L3 peels the paren.
        if (state.cur?.type === 'dialogue') append(t);
        else start('dialogue', t);
        continue;
      }
      // Action column (or unknown): description. A line sitting in NO known
      // column is the layout path's residue: flag it for the referee.
      const knownColumn = l.indent <= 2 || inBand(l.indent, roles.dialogue) || inBand(l.indent, roles.parenthetical) || inBand(l.indent, roles.character) || inBand(l.indent, roles.transition);
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

export function repairScriptBlocks(blocks: ScriptBlock[]): ScriptBlock[] {
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

// ---- Output ---------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

export function scriptTextToHtml(text: string): string {
  const blocks = repairScriptBlocks(classifyScriptText(text));
  const residue = scriptParseResidue(blocks);
  if (residue.uncertain > 0) {
    // eslint-disable-next-line no-console
    console.info('[screenplay-parse] residue', residue);
  }
  return scriptBlocksToHtml(blocks);
}
