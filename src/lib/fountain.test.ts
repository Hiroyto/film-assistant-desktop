// Parser Fountain (lib/fountain): a terceira porta "nativa" do import de
// roteiro. Um fixture realista (tide-gauge.fountain, escrito para o teste) e a
// sintaxe elemento por elemento, incluindo o que NÃO é o caminho feliz.
import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder as NodeTextDecoder } from 'util';
import { decodeScriptBytes, fountainFileToBlocks, fountainToBlocks, stripFountainEmphasis } from './fountain';
import { blocksToIndentedText, type ExportBlock } from './screenplayExport';
import { classifyTypedText, isTypedLayout } from './screenplayParse';

// jsdom não tem TextDecoder; todo browser tem.
Object.assign(globalThis, { TextDecoder: NodeTextDecoder });

const title = (text: string): ExportBlock => ({ type: 'title', text });
const scene = (text: string): ExportBlock => ({ type: 'scene', text });
const action = (text: string): ExportBlock => ({ type: 'description', text });
const cue = (text: string): ExportBlock => ({ type: 'character', text });
const line = (text: string): ExportBlock => ({ type: 'dialogue', text });
const wryly = (text: string): ExportBlock => ({ type: 'parenthetical', text });
const trans = (text: string): ExportBlock => ({ type: 'transition', text });

const fixturePath = join(__dirname, '__fixtures__', 'tide-gauge.fountain');
// O checkout no Windows traz CRLF (core.autocrlf); o teste parte sempre de LF
// e cobre o CRLF de propósito, mais abaixo.
const fixture = readFileSync(fixturePath, 'utf8').replace(/\r\n/g, '\n');

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;

describe('tide-gauge.fountain (fixture realista)', () => {
  const want: ExportBlock[] = [
    // Página de título: só os valores, cabeça na ordem canônica, depois o
    // rodapé; "Format" é metadado do app e não aparece.
    title('TIDE GAUGE'),
    title('Written by'),
    title('A. Writer'),
    title('Based on a true tide table'),
    title('3/14/2026'),
    title('Harbour Lane Pictures'),
    title('writer@example.com'),
    // "# ACT ONE" e a sinopse não são roteiro.
    action('FADE IN:'),
    scene('EXT. HARBOUR WALL - DAWN'), // sem o #1#
    action('Gulls wheel over a slate sea. The tide is out and the boats lie in the mud.'),
    action('MARA, 30s, walks the wall with a bucket of bait.'), // nota [[ ]] fora
    cue('BOY (O.S.)'),
    wryly('(calling)'),
    line('You missed the tide again, Mara!'),
    action('She keeps walking.'),
    cue('MARA'),
    line('It missed me.'), // *me* sem os asteriscos
    // O boneyard levou uma cena inteira (INT. HARBOUR OFFICE).
    scene('THE TIDE GAUGE'), // forçado com ".", sem o #2A#
    action('A brass dial, green with salt. The needle sits a full foot below the line.'),
    action('NOBODY HAS READ IT IN YEARS.'), // "!": maiúsculas que não são cue
    action('The glass is cracked.'),
    action('Someone has scratched a date into the casing.'),
    trans('CUT TO:'),
    scene('INT./EXT. NET LOFT - DAY'),
    action('Nets hang like weather. JOÃO, 60s, mends one without looking up.'),
    cue('JOÃO'),
    line("You're late."),
    cue('MARA'), // diálogo duplo achatado, sem o ^
    line("You're still here."),
    cue('McAllister'), // "@" mantém a caixa
    wryly('(from the door)'),
    line('Oh, the tide comes in, the tide goes out'), // letra (~) dentro da fala
    line('And nobody writes it down'),
    trans('SMASH CUT:'), // forçada com ">"
    scene('I/E. PICKUP TRUCK - NIGHT'),
    action('Rain. The radio hunts for a station.'),
    cue('MARA (V.O.)'),
    line('My father read that gauge every morning for forty years. He wrote the number in a book and never once said what it was for.'),
    // "===" (quebra de página) não vira bloco.
    scene('EST. LIGHTHOUSE - CONTINUOUS'),
    action('The lamp turns once and stops.'),
    action('THE END'), // centralizado vira ação
  ];

  it('vira os blocos tipados do editor, na ordem do roteiro', () => {
    expect(fountainToBlocks(fixture)).toEqual(want);
  });

  it('lê igual com CRLF e com BOM', () => {
    expect(fountainToBlocks('﻿' + fixture.replace(/\n/g, '\r\n'))).toEqual(want);
  });

  it('lê o arquivo do disco de ponta a ponta', () => {
    expect(fountainFileToBlocks(toArrayBuffer(readFileSync(fixturePath)))).toEqual(want);
  });

  // O que o import faz em seguida: o mesmo texto tipado de um .fdx, enviado com
  // layout 'typed' (o .trim() é o do handler do corkboard).
  it('o texto do import relê os mesmos tipos e o mesmo texto', () => {
    const text = blocksToIndentedText(fountainToBlocks(fixture)).trim();
    const shown = want.map((b) => [b.type, ['character', 'scene', 'transition'].includes(b.type) ? b.text.toUpperCase() : b.text]);
    expect(classifyTypedText(text).map((b) => [b.type, b.text])).toEqual(shown);
    expect(isTypedLayout(text)).toBe(true);
  });
});

describe('cabeçalho de cena', () => {
  it.each([
    'INT. HOUSE - DAY',
    'EXT. STREET - NIGHT',
    'EST. SKYLINE',
    'INT./EXT. CAR - DAY',
    'INT/EXT CAR - DAY',
    'EXT/INT. PORCH - DUSK',
    'I/E CAR - DAY',
    'int. house - day',
    'INT HOUSE DAY',
  ])('%s', (heading) => {
    expect(fountainToBlocks(`${heading}\n\nRain.`)).toEqual([scene(heading), action('Rain.')]);
  });

  it('forçado com um ponto; reticências continuam ação', () => {
    expect(fountainToBlocks('.SNIPER SCOPE POV\n\nRain.')).toEqual([scene('SNIPER SCOPE POV'), action('Rain.')]);
    expect(fountainToBlocks('...and then nothing.')).toEqual([action('...and then nothing.')]);
  });

  it('o número de cena sai', () => {
    expect(fountainToBlocks('INT. HOUSE - DAY #1A#')).toEqual([scene('INT. HOUSE - DAY')]);
    expect(fountainToBlocks('.THE VAULT #I-1-A#')).toEqual([scene('THE VAULT')]);
  });

  it('precisa de linha em branco antes', () => {
    expect(fountainToBlocks('Bob looks up.\nINT. HOUSE - DAY')).toEqual([action('Bob looks up.'), action('INT. HOUSE - DAY')]);
  });

  it('tolera a falta da linha em branco depois', () => {
    expect(fountainToBlocks('INT. HOUSE - DAY\nBob enters.')).toEqual([scene('INT. HOUSE - DAY'), action('Bob enters.')]);
    expect(fountainToBlocks('INT. HOUSE - DAY\nBOB\nHi.')).toEqual([scene('INT. HOUSE - DAY'), cue('BOB'), line('Hi.')]);
  });

  it('em negrito ainda é cabeçalho', () => {
    expect(fountainToBlocks('**INT. HOUSE - DAY**\n\nRain.')).toEqual([scene('INT. HOUSE - DAY'), action('Rain.')]);
  });

  it('palavras que só começam parecido são ação', () => {
    expect(fountainToBlocks('Interior shots follow.\n\nEsther waits.')).toEqual([action('Interior shots follow.'), action('Esther waits.')]);
  });
});

describe('ação', () => {
  it('cada linha é um bloco: toda quebra de linha é intenção', () => {
    expect(fountainToBlocks('And then a long beat.\nLonger than is funny.\n\nThe men look at each other.')).toEqual([
      action('And then a long beat.'),
      action('Longer than is funny.'),
      action('The men look at each other.'),
    ]);
  });

  it('"!" força ação numa linha em maiúsculas seguida de outra', () => {
    expect(fountainToBlocks('!BLAM!\nThe door flies open.')).toEqual([action('BLAM!'), action('The door flies open.')]);
    // Sem o "!", pela spec, é um cue com a fala embaixo.
    expect(fountainToBlocks('BLAM!\nThe door flies open.')).toEqual([cue('BLAM!'), line('The door flies open.')]);
  });

  it('a indentação é ignorada', () => {
    expect(fountainToBlocks('\t\tBob   waits.\n      He sighs.')).toEqual([action('Bob waits.'), action('He sighs.')]);
  });
});

describe('personagem', () => {
  it('maiúsculas com ao menos uma letra, seguidas de outra linha', () => {
    expect(fountainToBlocks('R2D2\nBeep.')).toEqual([cue('R2D2'), line('Beep.')]);
    expect(fountainToBlocks('MÃE\nOi.')).toEqual([cue('MÃE'), line('Oi.')]);
    expect(fountainToBlocks('23\nSkidoo.')).toEqual([action('23'), action('Skidoo.')]);
  });

  it('a extensão entre parênteses pode ser minúscula', () => {
    expect(fountainToBlocks('HANS (on the radio)\nHello.')).toEqual([cue('HANS (on the radio)'), line('Hello.')]);
    expect(fountainToBlocks("MARA (V.O.) (CONT'D)\nStill here.")).toEqual([cue("MARA (V.O.) (CONT'D)"), line('Still here.')]);
  });

  it('"@" força o cue e mantém a caixa', () => {
    expect(fountainToBlocks('@McCLANE\nYippee.')).toEqual([cue('McCLANE'), line('Yippee.')]);
  });

  it('um cue nunca fica sozinho: sem fala embaixo é ação', () => {
    expect(fountainToBlocks('THE END\n\nBlack.')).toEqual([action('THE END'), action('Black.')]);
    expect(fountainToBlocks('@McCLANE\n\nBlack.')).toEqual([action('McCLANE'), action('Black.')]);
  });

  it('precisa de linha em branco antes', () => {
    expect(fountainToBlocks('He turns.\nBOB\nHi.')).toEqual([action('He turns.'), action('BOB'), action('Hi.')]);
  });

  it('diálogo duplo achata e o "^" sai do cue', () => {
    expect(fountainToBlocks('BRICK\nScrew retirement.\n\nSTEEL ^\nScrew retirement.')).toEqual([
      cue('BRICK'), line('Screw retirement.'), cue('STEEL'), line('Screw retirement.'),
    ]);
    expect(fountainToBlocks('STEEL^\nYes.')).toEqual([cue('STEEL'), line('Yes.')]);
  });
});

describe('fala', () => {
  it('cada linha da fala é um bloco de diálogo', () => {
    expect(fountainToBlocks('DEALER\nTen.\nFour.\nDealer gets a seven.')).toEqual([
      cue('DEALER'), line('Ten.'), line('Four.'), line('Dealer gets a seven.'),
    ]);
  });

  it('uma linha com dois espaços mantém a fala aberta; uma linha vazia fecha', () => {
    expect(fountainToBlocks('DEALER\nTen.\n  \nFour.\n\nHe wins.')).toEqual([cue('DEALER'), line('Ten.'), line('Four.'), action('He wins.')]);
    expect(fountainToBlocks('DEALER\nTen.\n\nFour.')).toEqual([cue('DEALER'), line('Ten.'), action('Four.')]);
  });

  it('parentético é a linha inteira entre parênteses', () => {
    expect(fountainToBlocks('STEEL\n(starting the engine)\nSo much for retirement!\n(beat) Hang on.')).toEqual([
      cue('STEEL'), wryly('(starting the engine)'), line('So much for retirement!'), line('(beat) Hang on.'),
    ]);
  });

  it('dentro da fala nada é cena, seção ou transição', () => {
    expect(fountainToBlocks('BOB\nINT. is short for interior.\n#1 with a bullet.\n> Like that.')).toEqual([
      cue('BOB'), line('INT. is short for interior.'), line('#1 with a bullet.'), line('> Like that.'),
    ]);
  });

  it('letra de música: diálogo dentro da fala, ação fora', () => {
    expect(fountainToBlocks('OOMPA LOOMPAS\n~Willy Wonka! Willy Wonka!')).toEqual([cue('OOMPA LOOMPAS'), line('Willy Wonka! Willy Wonka!')]);
    expect(fountainToBlocks('~Somewhere a radio sings.')).toEqual([action('Somewhere a radio sings.')]);
  });
});

describe('transição', () => {
  it('maiúsculas terminando em TO:', () => {
    expect(fountainToBlocks('Rain.\n\nCUT TO:\n\nINT. HOUSE - DAY')).toEqual([action('Rain.'), trans('CUT TO:'), scene('INT. HOUSE - DAY')]);
    expect(fountainToBlocks('Rain.\n\nSMASH CUT TO:\n\nBlack.')).toEqual([action('Rain.'), trans('SMASH CUT TO:'), action('Black.')]);
  });

  it('forçada com ">"', () => {
    expect(fountainToBlocks('> Burn to white.')).toEqual([trans('Burn to white.')]);
    expect(fountainToBlocks('>FADE OUT.')).toEqual([trans('FADE OUT.')]);
  });

  it('um espaço depois dos dois-pontos, minúsculas ou outro final: ação', () => {
    expect(fountainToBlocks('CUT TO: \n\nBlack.')).toEqual([action('CUT TO:'), action('Black.')]);
    expect(fountainToBlocks('Cut to:\n\nBlack.')).toEqual([action('Cut to:'), action('Black.')]);
    expect(fountainToBlocks('FADE OUT.\n\nBlack.')).toEqual([action('FADE OUT.'), action('Black.')]);
  });

  it('tolera a falta da linha em branco depois', () => {
    expect(fountainToBlocks('CUT TO:\nINT. HOUSE - DAY\n\nRain.')).toEqual([trans('CUT TO:'), scene('INT. HOUSE - DAY'), action('Rain.')]);
  });
});

describe('texto centralizado', () => {
  it('vira ação, sem os marcadores', () => {
    expect(fountainToBlocks('> THE END <')).toEqual([action('THE END')]);
    expect(fountainToBlocks('>_BRICK & STEEL_<\n> FULL RETIRED <')).toEqual([action('BRICK & STEEL'), action('FULL RETIRED')]);
  });
});

describe('ênfase', () => {
  it('os marcadores saem, o texto fica', () => {
    expect(stripFountainEmphasis('*italic* **bold** ***both*** _under_')).toBe('italic bold both under');
    expect(stripFountainEmphasis('_**BRICK & STEEL**_')).toBe('BRICK & STEEL');
    expect(stripFountainEmphasis('From what seems like only INCHES AWAY. _His face FILLS the *Leupold Mark 4* scope_.')).toBe(
      'From what seems like only INCHES AWAY. His face FILLS the Leupold Mark 4 scope.',
    );
  });

  it('o escape mantém o caractere', () => {
    expect(stripFountainEmphasis('Steel enters the code: **\\*9765\\***')).toBe('Steel enters the code: *9765*');
    expect(stripFountainEmphasis('file\\_name')).toBe('file_name');
  });

  it('asterisco com espaço do lado do texto e sublinhado no meio da palavra não são ênfase', () => {
    expect(stripFountainEmphasis('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(stripFountainEmphasis('He dialed *69 and then *23.')).toBe('He dialed *69 and then *23.');
    expect(stripFountainEmphasis('snake_case_name')).toBe('snake_case_name');
  });
});

describe('notas e boneyard', () => {
  it('a nota some do meio da linha', () => {
    expect(fountainToBlocks('Bob [[the hero]] enters.')).toEqual([action('Bob enters.')]);
  });

  it('uma linha que era só nota não quebra a fala', () => {
    expect(fountainToBlocks('BOB\n[[angry]]\nHello.')).toEqual([cue('BOB'), line('Hello.')]);
  });

  it('nota de várias linhas (com a linha de dois espaços) some inteira', () => {
    expect(fountainToBlocks('Rain.\n\n[[First.\n  \nSecond.]]\n\nBlack.')).toEqual([action('Rain.'), action('Black.')]);
  });

  it('uma linha vazia encerra a busca pelo fecho: não era nota', () => {
    expect(fountainToBlocks('[[open\n\nclosed]]')).toEqual([action('[[open'), action('closed]]')]);
  });

  it('o boneyard atravessa parágrafos e some do meio da linha', () => {
    expect(fountainToBlocks('Rain.\n\n/*\nINT. CUT SCENE - DAY\n\nGone.\n*/\n\nBlack.')).toEqual([action('Rain.'), action('Black.')]);
    expect(fountainToBlocks('Bob /* slowly */ enters.')).toEqual([action('Bob enters.')]);
  });

  it('um boneyard sem fecho fica como texto', () => {
    expect(fountainToBlocks('/* never closed')).toEqual([action('/* never closed')]);
  });
});

describe('seções, sinopses e quebras de página', () => {
  it('não são roteiro, e coladas num cabeçalho não o escondem', () => {
    expect(fountainToBlocks('# Act One\n## Sequence\n= Bob comes home.\nINT. HOUSE - DAY\n= He is late.\n\nRain.')).toEqual([
      scene('INT. HOUSE - DAY'), action('Rain.'),
    ]);
  });

  it('a quebra de página some e fecha a fala', () => {
    expect(fountainToBlocks('Rain.\n\n===\n\nBlack.')).toEqual([action('Rain.'), action('Black.')]);
    expect(fountainToBlocks('BOB\nHi.\n=====\nBlack.')).toEqual([cue('BOB'), line('Hi.'), action('Black.')]);
  });
});

describe('página de título', () => {
  it('só os valores das chaves conhecidas, cabeça na ordem canônica', () => {
    const src = 'Author: B. Writer\nTitle: A\nContact:\n\tStudio\n\t555-0100\nCopyright: (c) 2026\nWatermark: DRAFT\n\nINT. X - DAY';
    expect(fountainToBlocks(src)).toEqual([
      title('A'), title('B. Writer'), title('Studio'), title('555-0100'), title('(c) 2026'), scene('INT. X - DAY'),
    ]);
  });

  it('valores em várias linhas indentadas, com ênfase', () => {
    const src = '\nTitle:\n    _**BRICK & STEEL**_\n    _**FULL RETIRED**_\nCredit: Written by\nAuthors: A & B\n\nFADE IN:';
    expect(fountainToBlocks(src)).toEqual([
      title('BRICK & STEEL'), title('FULL RETIRED'), title('Written by'), title('A & B'), action('FADE IN:'),
    ]);
  });

  it('um roteiro que abre em "FADE IN:" ou numa linha com dois-pontos não tem página de título', () => {
    expect(fountainToBlocks('FADE IN:\n\nINT. X - DAY')).toEqual([action('FADE IN:'), scene('INT. X - DAY')]);
    expect(fountainToBlocks('NARRATOR: Once upon a time.\n\nINT. X - DAY')).toEqual([action('NARRATOR: Once upon a time.'), scene('INT. X - DAY')]);
  });

  it('sem a linha em branco depois, o roteiro começa na primeira linha que não é chave', () => {
    expect(fountainToBlocks('Title: A\nINT. HOUSE - DAY\n\nRain.')).toEqual([title('A'), scene('INT. HOUSE - DAY'), action('Rain.')]);
    expect(fountainToBlocks('Title: A\nFADE IN:\n\nRain.')).toEqual([title('A'), action('FADE IN:'), action('Rain.')]);
  });
});

describe('bytes do arquivo', () => {
  const src = 'JOÃO\nOlá, mãe.';
  const want = [cue('JOÃO'), line('Olá, mãe.')];

  it('UTF-8, com e sem BOM', () => {
    expect(fountainFileToBlocks(toArrayBuffer(Buffer.from(src, 'utf8')))).toEqual(want);
    expect(fountainFileToBlocks(toArrayBuffer(Buffer.from('﻿' + src, 'utf8')))).toEqual(want);
  });

  it('UTF-16 com BOM (o "Unicode" do Bloco de Notas)', () => {
    expect(fountainFileToBlocks(toArrayBuffer(Buffer.from('﻿' + src, 'utf16le')))).toEqual(want);
  });

  it('Windows-1252 quando não é UTF-8 válido', () => {
    expect(decodeScriptBytes(toArrayBuffer(Buffer.from(src, 'latin1')))).toBe(src);
    expect(fountainFileToBlocks(toArrayBuffer(Buffer.from(src, 'latin1')))).toEqual(want);
  });
});
