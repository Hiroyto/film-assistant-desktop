// Eval for the screenplay import parser (Layers 0+1). Two fixtures:
//   - test2-pdf-items.json: REAL positioned pdf.js items from
//     ~/Downloads/test_2_screenplay.pdf (a filmassistant export: standard
//     Courier columns + a title page). Exercises the layout path end to end.
//   - shawshank-24pp-flat.txt: the flat (layout-stripped) prose of Ben's
//     2026-07-24 Shawshank import — the exact document whose mis-parse
//     (caps intro -> cue, shredded action, page numbers as content) motivated
//     the rebuild. Exercises the no-layout grammar path.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyScriptText,
  repairScriptBlocks,
  pdfPagesToIndentedText,
  scriptTextToHtml,
  type PdfPageItems,
  type ScriptBlock,
} from './screenplayParse';

// The full pipeline the app runs: classify then invariant-repair (L3).
const parse = (t: string) => repairScriptBlocks(classifyScriptText(t));

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('layout path (positioned PDF)', () => {
  const pages: PdfPageItems[] = JSON.parse(fixture('test2-pdf-items.json'));
  const text = pdfPagesToIndentedText(pages);
  const blocks = parse(text);
  const ofType = (t: string) => blocks.filter((b) => b.type === t);

  it('encodes indentation into the canonical text', () => {
    expect(text.split('\n').some((l) => /^ {6,}\S/.test(l))).toBe(true);
  });

  it('finds sluglines as scene blocks', () => {
    expect(ofType('scene').length).toBeGreaterThanOrEqual(1);
    for (const b of ofType('scene')) expect(b.text).toMatch(/^(INT|EXT)/i);
  });

  it('title page front matter never becomes a cue or dialogue', () => {
    const firstSlug = blocks.findIndex((b) => b.type === 'scene');
    for (const b of blocks.slice(0, firstSlug)) {
      expect(['description']).toContain(b.type);
    }
  });

  it('cues are followed by their speech', () => {
    const cues = ofType('character');
    expect(cues.length).toBeGreaterThanOrEqual(1);
    for (const [i, b] of blocks.entries()) {
      if (b.type !== 'character') continue;
      const next = blocks[i + 1];
      expect(next).toBeDefined();
      expect(['dialogue', 'parenthetical']).toContain(next.type);
    }
  });

  it('dialogue exists and never precedes the first cue', () => {
    expect(ofType('dialogue').length).toBeGreaterThanOrEqual(1);
    const firstCue = blocks.findIndex((b) => b.type === 'character');
    const firstDialogue = blocks.findIndex((b) => b.type === 'dialogue');
    expect(firstDialogue).toBeGreaterThan(firstCue);
  });
});

describe('flat-text path (layout-stripped Shawshank)', () => {
  const blocks = parse(fixture('shawshank-24pp-flat.txt'));
  const joined = (t: ScriptBlock) => t.text;

  it('THE bug: a caps intro inside action is not a cue', () => {
    // "ANDY DUFRESNE / is on the witness stand, hands folded..." — the line
    // that motivated this rebuild. Must land inside ONE action block, with the
    // hard-wrapped continuation merged back on.
    const asCue = blocks.find((b) => b.type === 'character' && /^ANDY DUFRESNE$/.test(b.text));
    expect(asCue).toBeUndefined();
    const action = blocks.find((b) => b.type === 'description' && b.text.includes('ANDY DUFRESNE is on the witness stand'));
    expect(action).toBeDefined();
    expect(action!.text).toContain('hands folded');
  });

  it('real cues survive: D.A. (O.S.) speaks', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text.startsWith('D.A.'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toContain('Mr. Dufresne, describe the confrontation');
  });

  it('bare cue + dialogue: ANDY / It was very bitter', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'ANDY');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toMatch(/^It was very bitter/);
  });

  it('sluglines with the odd "--" separators classify as scenes', () => {
    const slug = blocks.find((b) => b.type === 'scene' && b.text.includes('CABIN'));
    expect(slug).toBeDefined();
    expect(blocks.filter((b) => b.type === 'scene').length).toBeGreaterThanOrEqual(5);
  });

  it('page numbers never survive as content', () => {
    for (const b of blocks) expect(joined(b)).not.toMatch(/^\d+\.$/);
  });

  it('hard-wrapped action is unshredded (no one-line confetti)', () => {
    const actions = blocks.filter((b) => b.type === 'description');
    const avgLen = actions.reduce((a, b) => a + b.text.length, 0) / actions.length;
    expect(avgLen).toBeGreaterThan(60);
  });
});

describe('indented path (the live re-import, full columns)', () => {
  // The exact canonical text the 2026-07-24 re-import produced: five real
  // columns (action 0 / dialogue 10 / parens 14 / cues 20 / transitions 42)
  // and 300+ blank lines from vertical gaps.
  const blocks = parse(fixture('shawshank-24pp-indented.txt'));
  const ofType = (t: string) => blocks.filter((b) => b.type === t);

  it('cue column beats the transition column for the character role', () => {
    // 172 cues at indent 20 vs 5 all-caps transitions at 42: the biggest
    // caps column is the speaker column.
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'MAN #1');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toBe('Sit.');
  });

  it('dialogue rides its column: RED answers the parole board', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'RED');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toMatch(/^Yes, sir\. Absolutely\./);
  });

  it('shot headings are action, not speakers', () => {
    expect(blocks.find((b) => b.type === 'character' && /^CLOSEUP/.test(b.text))).toBeUndefined();
    const shot = blocks.find((b) => b.text.startsWith('CLOSEUP -- PAROLE FORM'));
    expect(shot?.type).toBe('description');
  });

  it('volume sanity: dialogue is a first-class citizen', () => {
    expect(ofType('dialogue').length).toBeGreaterThan(40);
    expect(ofType('character').length).toBeGreaterThan(40);
    expect(ofType('scene').length).toBeGreaterThanOrEqual(5);
  });

  it('every cue is followed by speech', () => {
    for (const [i, b] of blocks.entries()) {
      if (b.type !== 'character') continue;
      expect(['dialogue', 'parenthetical']).toContain(blocks[i + 1]?.type);
    }
  });
});

describe('L2 confidence scoring (the referee go/no-go meter)', () => {
  it('layout documents leave (almost) nothing for a referee', () => {
    const positioned = parse(pdfPagesToIndentedText(JSON.parse(fixture('test2-pdf-items.json'))));
    const indented = parse(fixture('shawshank-24pp-indented.txt'));
    const r1 = positioned.filter((b) => b.uncertain).length;
    const r2 = indented.filter((b) => b.uncertain).length;
    // eslint-disable-next-line no-console
    console.info('residue: positioned', r1, 'of', positioned.length, '| indented', r2, 'of', indented.length);
    // Under 5% of blocks, with an allowance of one flag for tiny documents
    // (test2's single flag is its centered title-page line: a correct flag).
    expect(r1).toBeLessThanOrEqual(Math.max(1, positioned.length * 0.05));
    expect(r2).toBeLessThanOrEqual(Math.max(1, indented.length * 0.05));
  });

  it('flat legacy text honestly reports its uncertainty', () => {
    const flat = parse(fixture('shawshank-24pp-flat.txt'));
    const r = flat.filter((b) => b.uncertain).length;
    // eslint-disable-next-line no-console
    console.info('residue: flat', r, 'of', flat.length);
    expect(r).toBeGreaterThan(0); // no layout, no blanks: uncertainty is real
  });
});

describe('L3 invariant repair', () => {
  it('demotes an orphan cue at document end', () => {
    const blocks = repairScriptBlocks([
      { type: 'scene', text: 'INT. HALL - DAY' },
      { type: 'character', text: 'THE END' },
    ]);
    expect(blocks.find((b) => b.type === 'character')).toBeUndefined();
  });

  it('demotes a cue followed by action, and cascades to its stranded dialogue', () => {
    const blocks = repairScriptBlocks([
      { type: 'character', text: 'A SIGN' },
      { type: 'description', text: 'hangs crooked over the door.' },
      { type: 'dialogue', text: 'Nobody said this.' },
    ]);
    expect(blocks.every((b) => b.type === 'description')).toBe(true);
    // The demoted cue and its lowercase continuation merge back into one line.
    expect(blocks[0].text).toBe('A SIGN hangs crooked over the door.');
  });

  it('demotes orphan dialogue at document start', () => {
    const blocks = repairScriptBlocks([
      { type: 'dialogue', text: 'Floating words with no speaker.' },
      { type: 'scene', text: 'INT. HALL - DAY' },
    ]);
    expect(blocks[0].type).toBe('description');
  });

  it('demotes a stray parenthetical outside any speech', () => {
    const blocks = repairScriptBlocks([
      { type: 'scene', text: 'INT. HALL - DAY' },
      { type: 'parenthetical', text: '(wind howls)' },
    ]);
    expect(blocks[1].type).toBe('description');
  });

  it('leaves valid speech groups alone', () => {
    const input: ScriptBlock[] = [
      { type: 'character', text: 'BOB' },
      { type: 'parenthetical', text: '(quietly)' },
      { type: 'dialogue', text: 'Hello.' },
    ];
    expect(repairScriptBlocks(input)).toEqual(input);
  });

  it('peels a leading inline parenthetical out of dialogue (the D.A. case)', () => {
    const blocks = repairScriptBlocks([
      { type: 'character', text: 'D.A.' },
      { type: 'dialogue', text: "(refers to his notes) I'll see you in Hell before I see you in Reno." },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['character', 'parenthetical', 'dialogue']);
    expect(blocks[1].text).toBe('(refers to his notes)');
    expect(blocks[2].text).toBe("I'll see you in Hell before I see you in Reno.");
  });

  it('does not split a parenthetical mid-dialogue', () => {
    const blocks = repairScriptBlocks([
      { type: 'character', text: 'BOB' },
      { type: 'dialogue', text: 'I said (and I quote) no.' },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['character', 'dialogue']);
  });
});

describe('html output', () => {
  it('emits typed paragraphs the editor understands', () => {
    const html = scriptTextToHtml('INT. CABIN - NIGHT\n\nA dark room.\n\n          BOB\n     Hello.');
    expect(html).toContain('data-line-type="scene"');
    expect(html).toContain('data-line-type="description"');
    expect(html).toContain('<p data-line-type="character">BOB</p>');
    expect(html).toContain('<p data-line-type="dialogue">Hello.</p>');
  });
});
