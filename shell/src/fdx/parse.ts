// parse.ts — parser PURO de .fdx (Final Draft XML) -> cenas. Sem dependências de
// electron/fs (só fast-xml-parser), para ser testável e reusável. Agrupa cada
// cena (Scene Heading + parágrafos do corpo até a próxima cena).
//
// XXE: fast-xml-parser NÃO processa DTD/entidades externas — só as 5 entidades
// XML padrão. Não há superfície de XXE aqui.
import { XMLParser } from 'fast-xml-parser';
import type { FdxScene } from '../ipc/channels';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  // trimValues:false de propósito: o Final Draft grava um <Text> como VÁRIOS runs
  // (ex.: "CAPTAIN OWENS" -> ["CAPTAIN"," OWENS"]). Com trim, o espaço da junção
  // some e vira "CAPTAINOWENS". Sem trim, os runs preservam o espaço; o clean()
  // abaixo colapsa/trima no fim.
  trimValues: false,
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Extrai texto de um nó <Text> que pode ser string, objeto {#text} ou array de runs. */
function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') return textOf((node as Record<string, unknown>)['#text']);
  return '';
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Limpa um cue de personagem: "RED (V.O.)" / "D.A. (CONT'D)" -> "RED" / "D.A." */
const cleanCharacterName = (s: string): string =>
  clean(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

export interface FdxParseResult {
  title?: string;
  scenes: FdxScene[];
  paragraphCount: number;
  /** Nomes únicos de personagens que falam no roteiro (dos cues de Character). */
  characters: string[];
  /** Roteiro reconstruído como texto (slugline/ação/CUE/diálogo) — entrada da
   *  extração por IA (runBraindumpExtraction, sourceFormat 'screenplay'). */
  fullText: string;
}

/** Parseia o XML de um .fdx. Lança se o XML for inválido (caller trata retry). */
export function parseFdx(xml: string): FdxParseResult {
  const doc = parser.parse(xml) as Record<string, any>;
  const fd = doc?.FinalDraft;
  if (!fd) return { scenes: [], paragraphCount: 0, characters: [], fullText: '' };

  // O corpo do roteiro é o 1º <Content> (a TitlePage tem o seu, à parte).
  const content = Array.isArray(fd.Content) ? fd.Content[0] : fd.Content;
  const paras = asArray<Record<string, any>>(content?.Paragraph);

  const scenes: FdxScene[] = [];
  const allChars = new Set<string>();
  const ftLines: string[] = []; // roteiro reconstruído p/ a extração por IA
  let cur: FdxScene | null = null;
  let body: string[] = [];
  let idx = 0;
  const flush = (): void => {
    if (!cur) return;
    cur.lineCount = body.length;
    cur.snippet = (body.find((l) => l.length > 0) || '').slice(0, 120);
    scenes.push(cur);
  };
  for (const p of paras) {
    const type = String(p?.['@_Type'] ?? '');
    const text = clean(textOf(p?.Text));
    if (/scene heading/i.test(type)) {
      flush();
      const num = p?.['@_Number'] ?? p?.SceneProperties?.['@_Number'];
      cur = {
        index: idx,
        number: num != null && String(num).length ? String(num) : String(idx + 1),
        heading: text,
        snippet: '',
        lineCount: 0,
        characters: [],
      };
      idx++;
      body = [];
      if (text) ftLines.push('', text);
    } else if (cur) {
      if (/^character$/i.test(type)) {
        const name = cleanCharacterName(text);
        if (name) {
          if (!cur.characters.includes(name)) cur.characters.push(name);
          allChars.add(name);
        }
        if (text) ftLines.push('', text);
      } else if (text) {
        body.push(text);
        ftLines.push(text);
      }
    }
  }
  flush();

  // Título: 1º <Text> da TitlePage.
  let title: string | undefined;
  const tp = fd.TitlePage?.Content;
  const tpParas = asArray<Record<string, any>>((Array.isArray(tp) ? tp[0] : tp)?.Paragraph);
  if (tpParas.length) {
    const t = clean(textOf(tpParas[0]?.Text));
    if (t) title = t;
  }

  return { title, scenes, paragraphCount: paras.length, characters: [...allChars], fullText: ftLines.join('\n').trim() };
}
