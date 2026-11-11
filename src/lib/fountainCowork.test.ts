// Fountain no cowork: o texto do arquivo vira as MESMAS cenas tipadas que o
// shell monta para um .fdx (FdxPayload), e o motor (lib/fdxSync) as consome sem
// saber do formato. `craco test`.
import { readFileSync } from 'fs';
import { join } from 'path';
import { coworkExt, fountainToScenes, hydrateFountainPayload, isFountainFile } from './fountainCowork';
import { compareWithStore, emptyStore, scenesToPages } from './fdxSync';

const fixture = readFileSync(join(__dirname, '__fixtures__', 'tide-gauge.fountain'), 'utf8');

const payload = (over: Partial<FdxPayload> = {}): FdxPayload => ({
  ok: true, path: 'C:/scripts/tide.fountain', fileName: 'tide.fountain', format: 'fountain', source: fixture,
  sceneCount: 0, paragraphCount: 0, scenes: [], fullText: '', updatedAt: '2026-11-10T12:00:00.000Z', ...over,
});

describe('fountainToScenes (tide-gauge.fountain)', () => {
  const parsed = fountainToScenes(fixture);

  it('uma cena por cabeçalho, na ordem, com o número do arquivo ou a posição', () => {
    expect(parsed.scenes.map((s) => [s.index, s.number, s.heading])).toEqual([
      [0, '1', 'EXT. HARBOUR WALL - DAWN'], // #1#
      [1, '2A', 'THE TIDE GAUGE'], // #2A#, cabeçalho forçado com "."
      [2, '3', 'INT./EXT. NET LOFT - DAY'], // sem número: a posição
      [3, '4', 'I/E. PICKUP TRUCK - NIGHT'],
      [4, '5', 'EST. LIGHTHOUSE - CONTINUOUS'],
    ]);
  });

  it('o corpo de cada cena são parágrafos tipados (sem o cabeçalho)', () => {
    expect(parsed.scenes[0].paragraphs).toEqual([
      { type: 'description', text: 'Gulls wheel over a slate sea. The tide is out and the boats lie in the mud.' },
      { type: 'description', text: 'MARA, 30s, walks the wall with a bucket of bait.' },
      { type: 'character', text: 'BOY (O.S.)' },
      { type: 'parenthetical', text: '(calling)' },
      { type: 'dialogue', text: 'You missed the tide again, Mara!' },
      { type: 'description', text: 'She keeps walking.' },
      { type: 'character', text: 'MARA' },
      { type: 'dialogue', text: 'It missed me.' },
    ]);
    // A transição fecha a cena em que está; a cena cortada pelo boneyard não existe.
    expect(parsed.scenes[1].paragraphs!.map((p) => p.type)).toEqual(['description', 'description', 'description', 'description', 'transition']);
    expect(parsed.scenes.some((s) => /HARBOUR OFFICE/.test(s.heading))).toBe(false);
  });

  it('quem fala em cada cena, sem as extensões do cue', () => {
    expect(parsed.scenes.map((s) => s.characters)).toEqual([
      ['BOY', 'MARA'], [], ['JOÃO', 'MARA', 'McAllister'], ['MARA'], [],
    ]);
  });

  it('snippet e contagem de linhas como no .fdx (o cue não conta)', () => {
    expect(parsed.scenes[0].snippet).toBe('Gulls wheel over a slate sea. The tide is out and the boats lie in the mud.');
    expect(parsed.scenes[0].lineCount).toBe(6);
  });

  it('a página de título dá só o título; texto antes do primeiro cabeçalho fica de fora das cenas', () => {
    expect(parsed.title).toBe('TIDE GAUGE');
    expect(parsed.paragraphCount).toBe(34);
    expect(parsed.fullText.startsWith('EXT. HARBOUR WALL - DAWN\nGulls wheel')).toBe(true);
    expect(parsed.fullText).toContain('\n\nBOY (O.S.)\n(calling)\nYou missed the tide again, Mara!');
    expect(parsed.fullText).not.toContain('FADE IN:');
    expect(parsed.fullText).not.toContain('Written by');
  });

  it('um arquivo sem cabeçalho de cena não tem cenas', () => {
    expect(fountainToScenes('Just some notes.\n\nNothing else.')).toEqual({ scenes: [], paragraphCount: 2, fullText: '' });
  });
});

describe('hydrateFountainPayload', () => {
  it('um .fountain do shell (texto em `source`) sai com as cenas e sem o texto', () => {
    const out = hydrateFountainPayload(payload());
    expect(out).toMatchObject({ ok: true, format: 'fountain', fileName: 'tide.fountain', title: 'TIDE GAUGE', sceneCount: 5, paragraphCount: 34 });
    expect(out.scenes).toHaveLength(5);
    expect(out.source).toBeUndefined();
  });

  it('um .fdx, uma leitura que falhou e null passam como vieram', () => {
    const fdx = payload({ format: 'fdx', source: undefined, fileName: 'pilot.fdx' });
    expect(hydrateFountainPayload(fdx)).toBe(fdx);
    const legacy = payload({ format: undefined, source: undefined, fileName: 'pilot.fdx' });
    expect(hydrateFountainPayload(legacy)).toBe(legacy);
    const failed = payload({ ok: false, source: undefined, error: 'the file is empty (mid-save?)' });
    expect(hydrateFountainPayload(failed)).toBe(failed);
    expect(hydrateFountainPayload(null)).toBeNull();
  });
});

describe('o motor consome as cenas de um .fountain como as de um .fdx', () => {
  const { scenes } = hydrateFountainPayload(payload());

  it('páginas do card no formato do editor: slugline com data-scene-id + parágrafos tipados', () => {
    const pages = scenesToPages('evt_1', [scenes[3]]);
    expect(pages.html).toBe(
      '<p data-scene-id="evt_1" data-line-type="scene">I/E. PICKUP TRUCK - NIGHT</p>'
      + '<p data-line-type="description">Rain. The radio hunts for a station.</p>'
      + '<p data-line-type="character">MARA (V.O.)</p>'
      + '<p data-line-type="dialogue">My father read that gauge every morning for forty years. He wrote the number in a book and never once said what it was for.</p>',
    );
    expect(pages.paragraphs).toBe(3);
  });

  it('board vazio: todas as cenas são novas (o bootstrap manda o roteiro inteiro para a IA)', () => {
    expect(compareWithStore(emptyStore(), scenes)).toMatchObject({ scenes: 5, matched: 0, added: 5, missing: 0 });
  });
});

describe('formato pelo nome do arquivo', () => {
  it('isFountainFile / coworkExt', () => {
    expect(isFountainFile('Tide Gauge.FOUNTAIN')).toBe(true);
    expect(isFountainFile('pilot.fdx')).toBe(false);
    expect(isFountainFile(undefined)).toBe(false);
    expect(coworkExt('tide.fountain')).toBe('.fountain');
    expect(coworkExt('pilot.fdx')).toBe('.fdx');
    expect(coworkExt(null)).toBe('.fdx');
  });
});
