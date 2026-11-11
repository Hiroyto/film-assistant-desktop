// src/lib/fountain.ts
//
// Fountain (.fountain) -> blocos tipados. É a terceira porta "nativa" do import
// de roteiro, ao lado de fdxToBlocks e fadeInFileToBlocks (screenplayExport.ts):
// o que sai daqui segue o MESMO caminho de um .fdx — blocksToIndentedText ->
// layout 'typed' -> extract-braindump — então nada é adivinhado pelo layout.
//
// Módulo PURO: sem DOM, sem dependências (só um import de tipo). Segue a
// sintaxe de https://fountain.io/syntax, linha a linha, com uma máquina de
// estados pequena (fora de fala / dentro de fala).
//
// O QUE CADA ELEMENTO VIRA (os blocos são os do editor: title, scene,
// description, character, parenthetical, dialogue, transition):
//
//   Página de título     `title`, um bloco por linha de VALOR (a chave não
//                        aparece). Ordem: Title, Credit, Author(s), Source e
//                        depois Notes / Draft date / Date / Contact /
//                        Copyright / Revision na ordem do arquivo. Qualquer
//                        outra chave (Format, Font, Language…) é metadado do
//                        app de escrita e é ignorada, como a spec manda.
//   Cabeçalho de cena    `scene`: INT / EXT / EST / INT./EXT / INT/EXT / I/E
//                        seguido de ponto ou espaço, ou forçado com `.`.
//                        O número de cena (`#12A#`) é descartado.
//   Ação                 `description`, UM BLOCO POR LINHA: no Fountain toda
//                        quebra de linha é intenção do roteirista, e o bloco
//                        não tem quebra interna. `!` força ação.
//   Personagem           `character`: linha toda em maiúsculas (extensões
//                        entre parênteses podem ser minúsculas) seguida de
//                        outra linha, ou forçado com `@` (mantém a caixa).
//   Parentético          `parenthetical`: linha inteira entre parênteses,
//                        dentro de uma fala.
//   Diálogo              `dialogue`, um bloco por linha. Uma linha só com dois
//                        espaços mantém a fala aberta (não vira bloco).
//   Transição            `transition`: maiúsculas terminando em `TO:`, ou
//                        forçada com `>`.
//
// O QUE NÃO TEM EQUIVALENTE NOS BLOCOS:
//
//   Diálogo duplo (`^`)  achata: a fala da esquerda, depois a da direita (a
//                        mesma decisão do fdxToBlocks). O `^` sai do cue.
//   Letra de música (`~`) dentro de uma fala é `dialogue`; fora, `description`.
//   Texto centralizado   `description`, sem os `>` `<` (o alinhamento se perde).
//   Ênfase (* ** *** _)  os marcadores saem, o texto fica (bloco é texto puro).
//   Notas [[ ]]          descartadas (como as ScriptNotes do .fdx).
//   Boneyard /* */       descartado, inclusive atravessando parágrafos.
//   Seções (#) e sinopses (=)  descartadas: são o outline, não o roteiro.
//   Quebra de página (===)     descartada: quem pagina é o editor.
//   Indentação           ignorada em todo elemento (a spec preserva só na ação).
//
// ONDE É MAIS TOLERANTE QUE A SPEC (um arquivo escrito à mão erra aqui, e para
// o import uma cena perdida custa mais que uma ação promovida):
//   - um cabeçalho de cena ou uma transição valem mesmo sem a linha em branco
//     DEPOIS (a de antes continua obrigatória);
//   - logo depois de um deles, a linha seguinte ainda pode abrir uma fala.

import type { ExportBlock } from './screenplayExport';

// Marca o lugar de onde um boneyard ou uma nota foi tirado. Uma linha que só
// tinha isso SOME (não vira linha em branco): uma nota entre o cue e a fala
// não pode quebrar a fala. (Área de uso privado: nenhum roteiro usa.)
const CUT = '';
// Escapes `\*` e `\_`: guardados enquanto a ênfase é removida.
const ESC_STAR = '';
const ESC_UNDER = '';
const PRIVATE_USE = /[-]/g;
const AROUND_CUT = /[ \t]*[ \t]*/g;

const HEADING = /^(?:(?:int|ext)\.?\s?\/\s?(?:int|ext)|int|ext|est|i\/e)[. ]/i;
const SCENE_NUMBER = /\s*#([A-Za-z0-9.-]+)#\s*$/;

/** Um bloco tipado e, nos cabeçalhos de cena, o número que o roteirista deu
 *  (`#12A#`). O import one-shot não usa o número; o cowork usa, para casar a
 *  cena do arquivo com o card dela entre um save e outro. */
export interface FountainElement extends ExportBlock { sceneNumber?: string }
// Chave da página de título: palavras simples e dois-pontos. Sem ponto, para
// "INT. CASA: DIA" nunca passar por chave.
const KEY_LINE = /^([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9 _-]{0,39}):(.*)$/;

// Chaves que vão para a página de título. As da cabeça saem centralizadas e
// nesta ordem; as do rodapé (contato, data…) saem na ordem do arquivo.
const HEAD_KEYS = ['title', 'credit', 'author', 'authors', 'source'];
const FOOT_KEYS = ['notes', 'draft date', 'date', 'contact', 'copyright', 'revision'];

/** Tem ao menos uma letra e nenhuma minúscula. `23` não passa; `R2D2` e `JOÃO` passam. */
const isUpper = (s: string): boolean => s === s.toUpperCase() && s !== s.toLowerCase();
const isAlnum = (ch: string | undefined): boolean =>
  !!ch && (/[0-9]/.test(ch) || ch.toLowerCase() !== ch.toUpperCase());

/** Tira os marcadores de ênfase e deixa o texto. Um delimitador com espaço do
 *  lado do texto não é ênfase (`2 * 3 * 4` fica como está); o sublinhado só
 *  vale em borda de palavra (`snake_case_name` fica como está). */
export function stripFountainEmphasis(s: string): string {
  let t = s.replace(/\\\*/g, ESC_STAR).replace(/\\_/g, ESC_UNDER);
  // Marcadores aninhados (`_**TÍTULO**_`) saem uma camada por passada.
  for (let pass = 0; pass < 4; pass++) {
    const before = t;
    t = t
      .replace(/\*\*\*(\S(?:.*?\S)?)\*\*\*/g, '$1')
      .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '$1')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/g, '$1$2');
    if (t === before) break;
  }
  return t.split(ESC_STAR).join('*').split(ESC_UNDER).join('_');
}

const clean = (s: string): string => stripFountainEmphasis(s).replace(/\s+/g, ' ').trim();

/** Linhas do arquivo, já sem boneyard e sem notas. */
function visibleLines(source: string): string[] {
  const text = source
    .replace(/^﻿/, '')
    .replace(PRIVATE_USE, '')
    .replace(/\r\n?/g, '\n')
    // O boneyard é o único elemento que atravessa linhas em branco.
    .replace(/\/\*[\s\S]*?\*\//g, CUT)
    // Uma nota pode ter várias linhas, mas uma linha VAZIA encerra a busca
    // pelo `]]` (a spec pede dois espaços para uma linha em branco na nota).
    .replace(/\[\[(?:(?!\]\]|\n\n)[\s\S])*\]\]/g, CUT);
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw.indexOf(CUT) === -1) { lines.push(raw); continue; }
    const rest = raw.replace(AROUND_CUT, ' ').trim();
    if (rest) lines.push(rest);
  }
  return lines;
}

/** A página de título: o primeiro bloco do arquivo, se for `Chave: valor`.
 *  Devolve os blocos `title` e o índice da primeira linha do roteiro. */
function readTitlePage(lines: string[]): { blocks: ExportBlock[]; next: number } {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const start = i;
  const entries: Array<{ key: string; values: string[] }> = [];
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) break;
    const indented = /^[ \t]/.test(raw);
    const m = indented ? null : KEY_LINE.exec(raw);
    if (m) {
      const key = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const value = m[2].trim();
      const known = HEAD_KEYS.includes(key) || FOOT_KEYS.includes(key);
      // "FADE IN:" e "CUT TO:" têm a forma de uma chave sem valor, mas são o
      // roteiro começando: a página de título acaba aqui.
      if (!known && !value && m[1] === m[1].toUpperCase()) break;
      entries.push({ key, values: value ? [value] : [] });
    } else if (indented && entries.length) {
      // Linha indentada: mais um valor da chave de cima (Contact: endereço).
      entries[entries.length - 1].values.push(raw.trim());
    } else {
      break; // faltou a linha em branco depois da página de título
    }
  }
  // Só é página de título se alguma chave for das conhecidas; senão o arquivo
  // abre direto no roteiro ("NARRADOR: Era uma vez…").
  if (!entries.some((e) => HEAD_KEYS.includes(e.key) || FOOT_KEYS.includes(e.key))) {
    return { blocks: [], next: start };
  }
  const blocks: ExportBlock[] = [];
  const emit = (e: { values: string[] }) => {
    for (const v of e.values) {
      const text = clean(v);
      if (text) blocks.push({ type: 'title', text });
    }
  };
  for (const key of HEAD_KEYS) entries.filter((e) => e.key === key).forEach(emit);
  entries.filter((e) => FOOT_KEYS.includes(e.key)).forEach(emit);
  return { blocks, next: i };
}

/** O cue sem o `^` do diálogo duplo. */
const cueText = (s: string): string => s.replace(/\s*\^\s*$/, '');

/** Uma linha é cue quando o nome (fora dos parênteses) é todo maiúsculo e tem
 *  ao menos uma letra: "HANS (on the radio)" é; "(beat)" e "23" não são. */
function isCue(plain: string): boolean {
  const core = cueText(plain).replace(/\([^)]*\)/g, '').trim();
  return core.length > 0 && isUpper(core);
}

function readBody(lines: string[], from: number): FountainElement[] {
  const out: FountainElement[] = [];
  const push = (type: ExportBlock['type'], raw: string) => {
    const text = clean(raw);
    if (text) out.push({ type, text });
  };
  const pushScene = (raw: string) => {
    const number = SCENE_NUMBER.exec(raw)?.[1];
    const text = clean(raw.replace(SCENE_NUMBER, ''));
    if (text) out.push({ type: 'scene', text, ...(number ? { sceneNumber: number } : {}) });
  };
  // Dentro de uma fala (do cue até a próxima linha em branco) tudo é diálogo
  // ou parentético. Fora dela, os elementos de uma linha só (cena, transição,
  // cue) só são reconhecidos no começo de um parágrafo.
  let inSpeech = false;
  let paragraphStart = true;

  for (let i = from; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) {
      // Dois espaços numa linha "em branco" mantêm a fala aberta.
      if (inSpeech && /^ {2,}$/.test(raw)) continue;
      inSpeech = false;
      paragraphStart = true;
      continue;
    }
    if (/^={3,}$/.test(t)) { // quebra de página
      inSpeech = false;
      paragraphStart = true;
      continue;
    }

    if (inSpeech) {
      if (/^\(.*\)$/.test(t)) push('parenthetical', t);
      else push('dialogue', t.replace(/^~/, '')); // letra cantada pelo personagem
      continue;
    }

    const first = t[0];
    // Seções e sinopses são o outline: transparentes (não abrem nem fecham
    // parágrafo, então "# ATO UM" colado num cabeçalho não o esconde).
    if (first === '#' || first === '=') continue;

    if (first === '!') { push('description', t.slice(1)); paragraphStart = false; continue; }
    if (first === '~') { push('description', t.slice(1)); paragraphStart = false; continue; }
    if (first === '>') {
      if (t.length > 1 && t.endsWith('<')) {
        push('description', t.slice(1, -1)); // texto centralizado
        paragraphStart = false;
      } else {
        push('transition', t.slice(1));
        paragraphStart = true;
      }
      continue;
    }

    if (paragraphStart) {
      const plain = stripFountainEmphasis(t);
      const forcedHeading = first === '.' && isAlnum(t[1]); // "...e então" continua ação
      if (forcedHeading || HEADING.test(plain)) {
        pushScene(forcedHeading ? t.slice(1) : plain);
        continue; // paragraphStart fica: a linha seguinte ainda pode abrir uma fala
      }
      // Um espaço depois dos dois-pontos ("CUT TO: ") é como a spec manda
      // dizer "isto é ação": o teste olha a linha sem aparar a direita.
      if (/TO:$/.test(raw) && isUpper(plain)) {
        push('transition', plain);
        continue;
      }
      const next = lines[i + 1];
      const speaks = next !== undefined && next.trim().length > 0; // um cue nunca fica sozinho
      if (first === '@') {
        push(speaks ? 'character' : 'description', cueText(t.slice(1)));
        inSpeech = speaks;
        paragraphStart = false;
        continue;
      }
      if (speaks && isCue(plain)) {
        push('character', cueText(plain));
        inSpeech = true;
        paragraphStart = false;
        continue;
      }
    }

    push('description', t);
    paragraphStart = false;
  }
  return out;
}

/** Texto Fountain -> elementos: a página de título primeiro (`title`), depois
 *  o roteiro, com o número de cena nos cabeçalhos que têm um. Qualquer texto é
 *  Fountain válido; o que não casa com nenhum elemento é ação. */
export function fountainToElements(source: string): FountainElement[] {
  const lines = visibleLines(source);
  const title = readTitlePage(lines);
  return [...title.blocks, ...readBody(lines, title.next)];
}

/** Texto Fountain -> blocos tipados (só tipo e texto), a forma do import. */
export function fountainToBlocks(source: string): ExportBlock[] {
  return fountainToElements(source).map(({ type, text }) => ({ type, text }));
}

/** Bytes de um arquivo de texto -> string. Fountain é UTF-8, mas um arquivo
 *  salvo pelo Bloco de Notas como "Unicode" é UTF-16 com BOM, e um editor
 *  antigo grava Windows-1252: ler como UTF-8 trocaria todo acento por "?". */
export function decodeScriptBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Um arquivo .fountain inteiro -> blocos tipados. */
export function fountainFileToBlocks(buf: ArrayBuffer): ExportBlock[] {
  return fountainToBlocks(decodeScriptBytes(buf));
}
