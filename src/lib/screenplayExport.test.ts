// Export layout (Final Draft geometry) and the FDX round trip.
import {
  layoutScreenplay,
  courierSafe,
  sentences,
  wrapText,
  blocksToFdx,
  fdxToBlocks,
  blocksToIndentedText,
  osfToBlocks,
  fadeInFileToBlocks,
  type ExportBlock,
} from './screenplayExport';
import { classifyScriptText, repairScriptBlocks, classifyTypedText } from './screenplayParse';
import { readZipEntry } from './zipRead';
import { deflateRawSync, inflateRawSync } from 'zlib';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

// jsdom has no TextDecoder/TextEncoder; every browser does.
Object.assign(globalThis, { TextDecoder: NodeTextDecoder, TextEncoder: NodeTextEncoder });

const scene = (text: string): ExportBlock => ({ type: 'scene', text });
const action = (text: string): ExportBlock => ({ type: 'description', text });
const cue = (text: string): ExportBlock => ({ type: 'character', text });
const line = (text: string): ExportBlock => ({ type: 'dialogue', text });
const wryly = (text: string): ExportBlock => ({ type: 'parenthetical', text });

const texts = (p: ReturnType<typeof layoutScreenplay>['pages'][number]) => p.map((l) => (l ? l.text : ''));

describe('courierSafe', () => {
  it('keeps the dashes and quotes the standard Courier cannot draw', () => {
    expect(courierSafe('Not in reverence — in instruction.')).toBe('Not in reverence -- in instruction.');
    expect(courierSafe('“Traitor,” she’s told…')).toBe('"Traitor," she\'s told...');
    expect(courierSafe('Café')).toBe('Café');
  });
});

describe('wrapText', () => {
  it('wraps on words at the column width', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });
});

describe('layoutScreenplay', () => {
  it('a blank line separates action paragraphs (Paul, 2026-09-23)', () => {
    const { pages } = layoutScreenplay([scene('EXT. HARBOUR - DAWN'), action('Gulls wheel.'), action('Mara walks.')]);
    expect(texts(pages[0])).toEqual(['EXT. HARBOUR - DAWN', '', 'Gulls wheel.', '', 'Mara walks.']);
  });

  it('speech sits in its columns with no gap under the cue', () => {
    const { pages } = layoutScreenplay([action('She turns.'), cue('Mara'), wryly('(quiet)'), line('Not today.')]);
    const p = pages[0];
    expect(texts(p)).toEqual(['She turns.', '', 'MARA', '(quiet)', 'Not today.']);
    expect(p[2]!.x).toBe(3.7);
    expect(p[3]!.x).toBe(3.1);
    expect(p[4]!.x).toBe(2.5);
  });

  it('dialogue wraps at 35 characters, action at 60', () => {
    const long = 'word '.repeat(40).trim();
    const { pages } = layoutScreenplay([action(long), cue('A'), line(long)]);
    const p = pages[0].filter(Boolean);
    expect(Math.max(...p.filter((l) => l!.x === 1.5).map((l) => l!.text.length))).toBeLessThanOrEqual(60);
    expect(Math.max(...p.filter((l) => l!.x === 2.5).map((l) => l!.text.length))).toBeLessThanOrEqual(35);
  });

  it('54 lines a page', () => {
    const blocks = Array.from({ length: 60 }, (_, i) => action(`Beat ${i}.`));
    const { pages } = layoutScreenplay(blocks);
    expect(pages.every((p) => p.length <= 54)).toBe(true);
    expect(pages.length).toBe(3); // 60 one-line paragraphs + 59 blanks
  });

  it('a slugline is never the last thing on a page', () => {
    const filler = Array.from({ length: 26 }, (_, i) => action(`Beat ${i}.`)); // 51 lines
    const { pages } = layoutScreenplay([...filler, scene('INT. KITCHEN - NIGHT'), action('Quiet.')]);
    const last = pages[0].filter(Boolean).pop()!;
    expect(last.text).not.toBe('INT. KITCHEN - NIGHT');
    expect(texts(pages[1])[0]).toBe('INT. KITCHEN - NIGHT');
  });

  it('a speech split across pages carries (MORE) and (CONT\'D)', () => {
    const filler = Array.from({ length: 24 }, (_, i) => action(`Beat ${i}.`)); // 47 lines
    const speech = Array(8).fill('Thirty characters in this one.').join(' '); // one sentence a line
    const { pages } = layoutScreenplay([...filler, cue('Mara (V.O.)'), line(speech)]);
    const p0 = texts(pages[0]);
    expect(p0[p0.length - 1]).toBe('(MORE)');
    expect(texts(pages[1])[0]).toBe("MARA (V.O.) (CONT'D)");
    // The page breaks after a sentence, never mid-sentence.
    expect(p0[p0.length - 2]).toMatch(/[.!?]$/);
    expect(pages[0].length).toBeLessThanOrEqual(54);
  });

  it('a page break inside a speech lands on a sentence end mid-line and rewraps', () => {
    const filler = Array.from({ length: 24 }, (_, i) => action(`Beat ${i}.`)); // 47 lines
    const speech = 'My father read that gauge every morning for forty years. He wrote the number in a book. He never once said what it was for. I think he just wanted something to be true at the same time every day.';
    const { pages } = layoutScreenplay([...filler, cue('Mara'), line(speech)]);
    const p0 = texts(pages[0]);
    expect(p0[p0.length - 1]).toBe('(MORE)');
    expect(p0[p0.length - 2]).toMatch(/[.!?]$/);
    const p1 = texts(pages[1]);
    expect(p1[0]).toBe("MARA (CONT'D)");
    expect(p1[1]).toMatch(/^[A-Z]/); // a fresh sentence, not the tail of one
    // Nothing lost or duplicated across the break.
    const words = (xs: string[]) => xs.filter((t) => t && t !== '(MORE)' && !/^MARA/.test(t)).join(' ').split(/\s+/);
    expect([...words(p0.slice(p0.indexOf('MARA'))), ...words(p1)].join(' ')).toBe(speech);
  });

  it('sentences do not break after an abbreviation or an initial', () => {
    expect(sentences('Mr. Hale waits. J. R. arrives late.')).toEqual(['Mr. Hale waits.', 'J. R. arrives late.']);
  });

  it('title lines go to their own page, not the body', () => {
    const layout = layoutScreenplay([
      { type: 'title', text: 'TIDE GAUGE' },
      { type: 'title', text: 'Written by' },
      { type: 'title', text: 'A. Writer' },
      { type: 'title', text: 'writer@example.com' },
      scene('EXT. HARBOUR - DAWN'),
    ]);
    expect(layout.titlePage!.map((t) => t.line.text)).toEqual(['TIDE GAUGE', 'Written by', 'A. Writer', 'writer@example.com']);
    const contact = layout.titlePage!.find((t) => t.line.text.includes('@'))!;
    expect(contact.line.x).toBe(1.5);
    expect(texts(layout.pages[0])[0]).toBe('EXT. HARBOUR - DAWN');
  });
});

describe('FDX', () => {
  const script: ExportBlock[] = [
    { type: 'title', text: 'TIDE GAUGE' },
    { type: 'title', text: 'Written by' },
    { type: 'title', text: 'A. Writer' },
    scene('EXT. HARBOUR WALL - DAWN'),
    action('Gulls wheel over a slate sea. The tide is out & the boats lie in the mud.'),
    action('MARA, 30s, walks the wall with a bucket of bait.'),
    cue('BOY'),
    wryly('(calling)'),
    line('You missed the tide again — Mara!'),
    action('She keeps walking.'),
    cue('MARA'),
    line('It missed me.'),
    { type: 'transition', text: 'CUT TO:' },
    scene('INT. NET LOFT - DAY'),
    action('Nets hang like weather.'),
  ];

  it('round-trips through Final Draft XML with types and text intact', () => {
    expect(fdxToBlocks(blocksToFdx(script))).toEqual(script);
  });

  it('reads Final Draft structure: multiple Text runs, dual dialogue, notes skipped', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. LOFT - </Text><Text Style="Bold">NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><ScriptNote><Paragraph><Text>a private note</Text></Paragraph></ScriptNote><Text>Rain.</Text></Paragraph>
    <Paragraph Type="Shot"><Text>CLOSE ON THE GAUGE</Text></Paragraph>
    <Paragraph><DualDialogue>
      <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Now.</Text></Paragraph>
      <Paragraph Type="Character"><Text>BOY</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Now!</Text></Paragraph>
    </DualDialogue></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content>
</FinalDraft>`;
    expect(fdxToBlocks(xml)).toEqual([
      scene('INT. LOFT - NIGHT'),
      action('Rain.'),
      action('CLOSE ON THE GAUGE'),
      cue('MARA'), line('Now.'), cue('BOY'), line('Now!'),
    ]);
  });

  it('rejects a file that is not Final Draft', () => {
    expect(() => fdxToBlocks('<html><body/></html>')).toThrow();
  });

  it('the import text reads back to the same script, typed and exact', () => {
    const shown = script.map((b) => [b.type, ['character', 'scene', 'transition'].includes(b.type) ? b.text.toUpperCase() : b.text]);
    expect(classifyTypedText(blocksToIndentedText(script)).map((b) => [b.type, b.text])).toEqual(shown);
  });

  it('a layout reader (no typed flag) still reads the import text', () => {
    const parsed = repairScriptBlocks(classifyScriptText(blocksToIndentedText(script)));
    expect(parsed.map((b) => b.type)).toEqual(script.map((b) => b.type));
  });
});

// Fade In's native file: a zip holding document.xml in Open Screenplay
// Format. Fixture built to the OSF spec (no .fadein file on hand).
describe('Fade In (.fadein)', () => {
  const osf = (attr: string) => `<?xml version="1.0" encoding="UTF-8"?>
<document type="Open Screenplay Format document" version="40">
  <info uuid="x" pagecount="1"/>
  <titlepage>
    <para><style basestyle="Action"/><text>TIDE GAUGE</text></para>
    <para><style basestyle="Action"/><text>Written by</text></para>
    <para><style basestyle="Action"/><text></text></para>
  </titlepage>
  <paragraphs>
    <para><style ${attr}="Scene Heading"/><text>Ext. harbour wall - </text><text bold="1">dawn</text></para>
    <para><style ${attr}="Action"/><text>Gulls wheel.</text></para>
    <para><style ${attr}="Character"/><text>Mara</text></para>
    <para><style ${attr}="Parenthetical"/><text>(quiet)</text></para>
    <para><style ${attr}="Dialogue"/><text>Not today.</text></para>
    <para><style ${attr}="Transition"/><text>CUT TO:</text></para>
    <para><style ${attr}="Shot"/><text>CLOSE ON THE GAUGE</text></para>
  </paragraphs>
</document>`;
  const want = [
    { type: 'title', text: 'TIDE GAUGE' },
    { type: 'title', text: 'Written by' },
    scene('Ext. harbour wall - dawn'),
    action('Gulls wheel.'),
    cue('Mara'), wryly('(quiet)'), line('Not today.'),
    { type: 'transition', text: 'CUT TO:' },
    action('CLOSE ON THE GAUGE'),
  ];

  it.each(['basestyle', 'baseStyleName', 'basestylename'])('reads the paragraph types (%s, every OSF version)', (attr) => {
    expect(osfToBlocks(osf(attr))).toEqual(want);
  });

  // A minimal zip: one entry, deflated (method 8) or stored (method 0).
  const zip = (name: string, content: string, method: 0 | 8) => {
    const raw = Buffer.from(content, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(0, 42);
    const cdOff = 30 + nm.length + data.length;
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(cdOff, 16);
    const all = Buffer.concat([local, nm, data, cen, nm, end]);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
  };

  it('unzips a deflated document.xml', async () => {
    const bytes = await readZipEntry(zip('document.xml', osf('basestyle'), 8), 'document.xml', async (d) => new Uint8Array(inflateRawSync(d)));
    expect(osfToBlocks(new TextDecoder().decode(bytes!))).toEqual(want);
  });

  it('reads a whole .fadein file end to end', async () => {
    expect(await fadeInFileToBlocks(zip('document.xml', osf('basestyle'), 0))).toEqual(want);
  });

  it('a file that is not a zip says so plainly', async () => {
    await expect(fadeInFileToBlocks(new TextEncoder().encode('hello').buffer as ArrayBuffer)).rejects.toThrow('not a Fade In document');
  });

  it('reads back to the same types through the typed import text', () => {
    expect(classifyTypedText(blocksToIndentedText(osfToBlocks(osf('basestyle')))).map((b) => b.type)).toEqual(want.map((b) => b.type));
  });
});
