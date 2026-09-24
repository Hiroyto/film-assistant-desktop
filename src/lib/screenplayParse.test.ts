// Eval for the screenplay import parser (Layers 0+1). Two fixtures:
//   - test2-pdf-items.json: REAL positioned pdf.js items from
//     ~/Downloads/test_2_screenplay.pdf (a filmassistant export: standard
//     Courier columns + a title page). Exercises the layout path end to end.
//   - shawshank-24pp-flat.txt: the flat (layout-stripped) prose of Ben's
//     2026-07-24 Shawshank import — the exact document whose mis-parse
//     (caps intro -> cue, shredded action, page numbers as content) motivated
//     the rebuild. Exercises the no-layout grammar path.
//   - shawshank-24pp-indented.txt: the live re-import's canonical text.
//   - pilot-scene1-indented.txt: scene one of Paul's pilot as the import
//     sweep cut it (title page with a flush-left contact block, cold open,
//     a curly-quoted cue). The 2026-09-15 all-action regression.
//   - tide-gauge-flat.txt: Ben's scene as the editor's carve sends it (every
//     paragraph double-spaced). The speech-group blank-line rule.
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyScriptText,
  repairScriptBlocks,
  pdfPagesToIndentedText,
  scriptTextToHtml,
  classifyParagraphs,
  documentRoles,
  type PdfPageItems,
  type ScriptBlock,
} from './screenplayParse';

// The full pipeline the app runs: classify then invariant-repair (L3).
const parse = (t: string) => repairScriptBlocks(classifyScriptText(t));

// Desktop: on Windows the fixtures are checked out with CRLF (core.autocrlf) and
// the paragraph-split assertions below use '\n\n'. Normalize so the tests read
// the same bytes the author's LF checkout does.
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8').replace(/\r\n/g, '\n');

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
      expect(['title', 'description']).toContain(b.type);
    }
  });

  it('the title page is typed title, one block per line', () => {
    expect(blocks[0].type).toBe('title');
    expect(blocks[0].text).toBe('TEST 2');
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

  it('a cue with stacked extensions speaks: WOMAN (O.S.) (CONT’D)', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'WOMAN (O.S.) (CONT’D)');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toMatch(/^Oh god\.\.\.that's sooo good/);
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


describe('title page (the head of the front matter)', () => {
  it('Shawshank: six title lines, then the slugline', () => {
    const b = parse(fixture('shawshank-24pp-indented.txt'));
    expect(b.slice(0, 6).map((x) => x.type)).toEqual(['title', 'title', 'title', 'title', 'title', 'title']);
    expect(b[0].text).toBe('THE SHAWSHANK REDEMPTION');
    expect(b[5].text).toBe('by Stephen King');
    expect(b[6].type).toBe('scene');
    expect(parse(fixture('shawshank-24pp-flat.txt')).filter((x) => x.type === 'title').length).toBe(6);
  });

  it('a cold open with no byline is not a title page', () => {
    const b = parse('OVER BLACK.\nA diesel engine strains.\n\n     EXT. ROAD - DAY\n     A truck.');
    expect(b.filter((x) => x.type === 'title').length).toBe(0);
    expect(b[0].type).toBe('description');
  });

  it('an epigraph ends the title page and stays in the cold open', () => {
    const b = parse('THE EI8HT\n"WHAT SURVIVES"\nWritten by\nA Writer\n\n"Until they become conscious they will never rebel."\n- George Orwell\n\nOVER BLACK.\n\nEXT. FARM - DAWN\nRows.');
    expect(b.filter((x) => x.type === 'title').length).toBe(4);
    expect(b[4].type).toBe('description');
    expect(b[4].text).toMatch(/^"Until/);
  });

  it('inScript disables title detection', () => {
    const b = repairScriptBlocks(classifyScriptText('THE TITLE\nWritten by\nSomeone\n\nINT. ROOM - DAY', { inScript: true }));
    expect(b.filter((x) => x.type === 'title').length).toBe(0);
  });
});

describe("Paul's pilot, scene one as swept (the 2026-09-15 regression)", () => {
  const blocks = parse(fixture('pilot-scene1-indented.txt'));
  const ofType = (t: string) => blocks.filter((b) => b.type === t);

  it('the flush-left contact block does not hijack the action column', () => {
    // Before: 44 description, 0 cues, 38 of 46 uncertain.
    expect(ofType('character').length).toBeGreaterThanOrEqual(13);
    expect(ofType('dialogue').length).toBeGreaterThanOrEqual(13);
    expect(blocks.filter((b) => b.uncertain).length).toBeLessThanOrEqual(2);
  });

  it('eight title lines, contact block included, then OVER BLACK as action', () => {
    expect(ofType('title').length).toBe(8);
    expect(blocks[7].text).toBe('All rights reserved.');
    expect(blocks[8].type).toBe('description');
    expect(blocks[8].text).toMatch(/^OVER BLACK/);
  });

  it('NICK speaks', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'NICK');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(blocks[i + 1].type).toBe('dialogue');
    expect(blocks[i + 1].text).toMatch(/^Contact high left/);
  });

  it('a curly-quoted cue is a cue', () => {
    expect(blocks.find((b) => b.type === 'character' && /HAYES/.test(b.text))).toBeDefined();
  });
});

describe('double-spaced flat text keeps its speech groups (the carve / paste shape)', () => {
  const blocks = parse(fixture('tide-gauge-flat.txt'));
  const ofType = (t: string) => blocks.filter((b) => b.type === t);

  it('19 cues, 19 dialogue, 3 parentheticals (was all action)', () => {
    expect(ofType('character').length).toBe(19);
    expect(ofType('dialogue').length).toBe(19);
    expect(ofType('parenthetical').length).toBe(3);
  });

  it('NELL / (into the landline) / dialogue across blank lines', () => {
    const i = blocks.findIndex((b) => b.type === 'character' && b.text === 'NELL');
    expect(blocks[i + 1].type).toBe('parenthetical');
    expect(blocks[i + 2].type).toBe('dialogue');
  });

  it('action after a dialogue line is action', () => {
    expect(blocks.find((b) => /^She waits/.test(b.text))?.type).toBe('description');
  });

  it('a second double-spaced speech paragraph falls to action (the known ambiguity)', () => {
    const b = parse('INT. ROOM - DAY\n\nBOB\n\nHello there.\n\nThis is the second paragraph of his speech.\n\nShe leaves.');
    expect(b.map((x) => x.type)).toEqual(['scene', 'character', 'dialogue', 'description', 'description']);
  });
});

describe('classifyParagraphs (Reformat): one type per paragraph', () => {
  it('types every paragraph and preserves the count', () => {
    const paras = fixture('tide-gauge-flat.txt').split('\n\n').map((s) => s.trim());
    const types = classifyParagraphs(paras);
    expect(types.length).toBe(paras.length);
    expect(types.every((t) => t !== null)).toBe(true);
    expect(types.slice(2, 5)).toEqual(['character', 'parenthetical', 'dialogue']);
  });

  it('a mid-script selection needs no slugline for cues', () => {
    expect(classifyParagraphs(['NELL', 'They were. Twice more.', 'She turns the sheet over.'])).toEqual(['character', 'dialogue', 'description']);
  });

  it('blank paragraphs come back null; artifact-shaped ones keep a slot', () => {
    expect(classifyParagraphs(['BOB', '', 'Hi.'])).toEqual(['character', null, 'dialogue']);
    expect(classifyParagraphs(['BOB', '12.', 'Hi.']).length).toBe(3);
  });
});


describe('Layer 0: paragraph gaps in a dialogue-heavy PDF (the "crushed action" report)', () => {
  // A page shaped like Paul's pilot: one-line action, cue, one-line speech,
  // repeat. Line pitch 12pt, a blank line (24pt) between paragraphs, so MORE
  // than half of the vertical gaps are paragraph gaps. The old median-based
  // line pitch read 24 and never emitted a blank line: the whole page became
  // one action block.
  const H = 792; const X = 108;
  const items: Array<{ str: string; x: number; y: number; w: number }> = [];
  let y = 700;
  const put = (str: string, x = X) => { items.push({ str, x, y, w: str.length * 7.2 }); y -= 12; };
  put('INT. ROOM - DAY'); y -= 12;
  for (let i = 0; i < 6; i++) {
    put(`Nick moves to the door, number ${i}.`); y -= 12;
    put('NICK', X + 187); put('Contact high left.'); y -= 12;
    put('Ash looks back at him.'); y -= 12;
  }
  // The page number, stamped twice at the same spot in the top band.
  items.push({ str: '2.', x: 520, y: 760, w: 14 }, { str: '2.', x: 520, y: 760, w: 14 });
  const pages: PdfPageItems[] = [{ width: 612, height: H, items }];
  const text = pdfPagesToIndentedText(pages);
  const blocks = parse(text);

  it('emits a blank line at every paragraph gap', () => {
    expect(text.split('\n').filter((l) => !l.trim()).length).toBeGreaterThanOrEqual(18);
  });

  it('keeps every action paragraph separate', () => {
    expect(blocks.filter((b) => b.type === 'description').length).toBe(12);
    expect(blocks.filter((b) => b.type === 'character').length).toBe(6);
    expect(blocks.filter((b) => b.type === 'dialogue').length).toBe(6);
  });

  it('a page number stamped twice never reaches the text', () => {
    expect(text).not.toMatch(/2\.2\./);
    expect(parse('INT. A - DAY\n\n2.2.\n\nAction.').some((b) => /^2\.2\./.test(b.text))).toBe(false);
  });
});

describe('document columns handed to a short slice (the Reckless Roger sound-direction cue)', () => {
  const roles = documentRoles(fixture('shawshank-24pp-indented.txt'));
  const slice = "EXT. THE FARM, LEAH'S GRAVE - SUNSET\n\nMUSIC CARRIES OVER (1:18)\n\nRoger stands at the foot of the tree holding Mabel. Her arms\nare wrapped around his neck with her head on his shoulder.\n\nThe air is quiet as their new reality sinks in.\n\nThen, the sound of a distant explosion turns their attention.";

  it('documentRoles finds the columns, front matter excluded', () => {
    expect(roles?.action).toBeDefined();
    expect(roles?.character).toBeDefined();
    expect(roles?.dialogue).toBeDefined();
  });

  it('with the document columns the sound direction is action (was a cue)', () => {
    const b = repairScriptBlocks(classifyScriptText(slice, { roles }));
    expect(b.filter((x) => x.type === 'character').length).toBe(0);
    expect(b.filter((x) => x.type === 'description').length).toBe(4);
  });

  it('even flat: a cue extension never carries digits or a colon', () => {
    expect(parse(slice).filter((x) => x.type === 'character').length).toBe(0);
  });

  it('BEGIN MONTAGE / END MONTAGE / FLASHBACK never cue', () => {
    const b = parse('INT. ROOM - DAY\n\nBEGIN MONTAGE\n\nRoger and Mabel share a life on the farm.\n\nEND MONTAGE\n\nFLASHBACK\n\nThe barn.');
    expect(b.filter((x) => x.type === 'character').length).toBe(0);
  });

  it('OVER BLACK / FADE IN never cue', () => {
    const b = parse('INT. ROOM - DAY\n\nOVER BLACK.\n\nA DIESEL ENGINE strains.\n\nFADE IN:\n\nThe room.');
    expect(b.filter((x) => x.type === 'character').length).toBe(0);
  });

  it('two trimmed sluglines at indent 0 do not steal the action column (a re-import window)', () => {
    const w2 = ['EXT. SITE - LATER'].concat(Array.from({ length: 12 }, (_, i) => ['     Men sit on upturned crates outside the cabin, number ' + i + '.', '', '                          NICK', '               Contact high left, number ' + i + '!', '', '     Six rifles swing as one.', ''].join('\n')), ['INT. FLAT - NIGHT', '     Nick opens the door.', '', '                          ASH', '               Hello?']).join('\n');
    const r = documentRoles(w2);
    expect(r?.action?.[0]).toBeLessThanOrEqual(5);
    expect(r?.action?.[1]).toBeGreaterThanOrEqual(5);
    const b = parse(w2);
    expect(b.filter((x) => x.type === 'character').length).toBe(13);
    expect(b.filter((x) => x.type === 'dialogue').length).toBe(13);
    expect(b.filter((x) => x.uncertain).length).toBe(0);
  });

  it('a real cue in the cue column still speaks under handed-in roles', () => {
    const b = repairScriptBlocks(classifyScriptText('INT. ROOM - DAY\n\n                    BOB (V.O.)\n          Hello there.', { roles }));
    expect(b.map((x) => x.type)).toEqual(['scene', 'character', 'dialogue']);
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
