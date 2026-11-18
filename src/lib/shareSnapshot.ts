// shareSnapshot — o RETRATO de um link compartilhado: do grafo da história para
// o formato enxuto que o preview mostra. Só funções puras, sem rede e sem DOM.
//
// Roda em dois lugares, com o mesmo código:
//   - no app do dono, quando ele cria um link de retrato (lib/shareLinks);
//   - na Lambda de share, a cada abertura de um link AO VIVO. O arquivo
//     `backend/share-links/snapshot.mjs` é GERADO a partir deste e das funções
//     de ordem/layout do board (`npm run share:lambda`), para os dois nunca
//     divergirem. Por isso este módulo só importa o que o gerador sabe levar:
//     as três funções de `corkboard/connectors` e tipos.
//
// O retrato leva só o que o preview mostra (título, resumo, elenco, local,
// posições, texto do roteiro) e deixa de fora o que é ferramenta do roteirista
// (perguntas do Peer, tensões abertas, citações de evidência, notas) e o que
// não está na história (lixeira, sandbox, cartas ainda não aceitas, backstory).
// No link ao vivo esse filtro É a fronteira de privacidade: roda no servidor, e
// o grafo cru nunca chega ao navegador de quem abre o link.
import { computeAutoLayout, orderSpineUnits, toldOrderEvents } from '../components/Freeform/corkboard/connectors';
import type { ProjectEdges, ProjectEntity } from './freeformApi';

export type ShareScope = 'board' | 'script' | 'both';

export interface SharedScene {
  id: string;
  /** Número da cena na ordem contada (1…n). */
  number: number;
  title: string;
  summary: string;
  characters: string[];
  location?: string;
  color?: string;
  /** INT/EXT e os sub-eventos (beats) da cena: o que o card aberto mostra. */
  intExt?: string;
  beats?: string[];
}
/** Um card no palco: cena, sequência sem cenas (card) ou personagem (pílula). */
export interface SharedCanvasCard { id: string; kind: 'scene' | 'sequence' | 'character'; x: number; y: number }
/** O board mestre como o roteirista o arrumou (2026-11-18): as posições dos
 *  cards (as salvas, ou as do auto-layout para quem nunca foi movido), o fio da
 *  ordem contada, as caixas de sequência e os laços. Links antigos não têm. */
export interface SharedCanvas {
  cards: SharedCanvasCard[];
  /** Flechas da ordem contada: [de, para], entre cenas e/ou sequências. */
  thread: Array<[string, string]>;
  /** Sequência com cenas: a caixa em volta delas (título e resumo vêm da seção de mesmo id). */
  boxes: Array<{ id: string; color?: string; members: string[] }>;
  /** [cena, personagem]. */
  involves: Array<[string, string]>;
  /** Relações entre personagens, com o rótulo ("mentor", "married to"). */
  bonds: Array<{ a: string; b: string; kind: string }>;
}
/** De onde vêm as posições: os layouts salvos do dono e a largura da janela dele
 *  (o auto-layout do board depende dela; no servidor é fixa). */
export interface BoardLayoutInput { stored?: Record<string, { x: number; y: number }>; boardWidth?: number }
/** Uma sequência com as suas cenas, ou um trecho de cenas soltas (`title` vazio). */
export interface SharedSection { id: string; title: string; summary?: string; scenes: SharedScene[] }
export interface SharedBoard {
  sections: SharedSection[];
  characters: Array<{ id?: string; name: string; description: string; scenes: number }>;
  locations: Array<{ name: string; description: string }>;
  canvas?: SharedCanvas;
}
export interface SharedBlock { type: string; text: string }
/** As páginas de uma cena. `number` é o SC da cena na ordem contada (o mesmo do
 *  board) e `sequence` o título da sequência que a contém: o que o painel de
 *  navegação do roteiro mostra. Links antigos não trazem os dois. */
export interface SharedScriptScene { id: string; title: string; blocks: SharedBlock[]; number?: number; sequence?: string }
export interface SharedScript { scenes: SharedScriptScene[] }
export interface SharedSnapshot { v: 1; board?: SharedBoard; script?: SharedScript }

export type ShareGraph = { entities: ProjectEntity[]; edges?: Partial<ProjectEdges> | null };
export type ShareSceneText = { eventId: string; html: string };
/** Como o HTML salvo de uma cena vira blocos tipados. */
export type BlockParser = (html: string) => SharedBlock[];

const SCRATCH = '__scratch__';
const nameOf = (e: ProjectEntity): string => String(e.working_title || e.working_name || '').trim();
const textOf = (e: ProjectEntity): string => String(e.summary || e.description || '').trim();
/** Os sub-eventos de uma cena, uma linha cada (no máximo 12). */
const beatsOf = (e: ProjectEntity): string[] =>
  (Array.isArray(e.sub_events) ? e.sub_events : [])
    .map((b) => [b?.slugline, b?.description].map((x) => String(x ?? '').trim()).filter(Boolean).join(': '))
    .filter(Boolean)
    .slice(0, 12);
/** No board do roteirista: viva, aceita na história (não `staged`) e fora da
 *  sandbox (cartas estacionadas não estão na história). A régua do `aliveEntities`
 *  do corkboard. */
const onBoard = (e: ProjectEntity): boolean => !e.deleted_at && e.staged !== '1' && e.state !== 'parked';
/** Cena contada: no board e não é backstory (a mesma régua da página de roteiro). */
const isTold = (e: ProjectEntity): boolean => e.type === 'event' && onBoard(e) && e.narrative_status !== 'backstory';

// As entidades que um texto de roteiro pode trazer: as do HTML básico, o Latin-1
// inteiro (acentos) e a pontuação tipográfica. O editor grava só &amp; &lt; &gt;
// e &nbsp;; as outras aparecem em texto importado. Uma entidade fora desta lista
// fica como veio.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  bull: '\u2022', hellip: '\u2026', euro: '\u20ac', trade: '\u2122',
};
LATIN1.split(' ').forEach((name, i) => { ENTITIES[name] = String.fromCharCode(160 + i); });
/** O texto de um trecho de HTML: sem as tags, com as entidades resolvidas. */
function htmlText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole;
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}
/** O HTML do editor de roteiro (`<p data-line-type="scene">…</p>`) em blocos,
 *  sem DOM: é o que o servidor usa. Mesmo resultado do `blocksFromScreenplayHtml`
 *  do app (que lê pelo DOM) para o que o editor grava. */
export function blocksFromHtmlText(html: string): SharedBlock[] {
  const out: SharedBlock[] = [];
  if (!html) return out;
  const paragraph = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi;
  for (let m = paragraph.exec(html); m; m = paragraph.exec(html)) {
    const kind = /\bdata-line-type\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);
    const text = htmlText(m[2]).trim();
    if (text) out.push({ type: (kind?.[1] ?? kind?.[2]) || 'description', text });
  }
  return out;
}

function spineInputs(graph: ShareGraph) {
  const entities = (graph.entities ?? []).filter((e) => onBoard(e) && !(e.type === 'event' && e.narrative_status === 'backstory'));
  const edges = graph.edges ?? {};
  return {
    entities,
    precedes: edges.precedes ?? [],
    contains: edges.contains ?? [],
    sequencePrecedes: edges.sequence_precedes ?? [],
    crossPrecedes: edges.cross_precedes ?? [],
  };
}

/** O palco: onde cada card está e o que os liga. As posições são as que o dono
 *  vê: a salva, ou a do auto-layout do board (`computeAutoLayout`, o mesmo do
 *  corkboard, com o mesmo conjunto de cartas vivas). Pura. */
function buildCanvas(graph: ShareGraph, sections: SharedSection[], layout: BoardLayoutInput): SharedCanvas {
  const edges = graph.edges ?? {};
  const seen = new Set<string>();
  const alive = (graph.entities ?? []).filter((e) => {
    if (!onBoard(e) || (e.type === 'arc' && String(e.character_id ?? '') !== '') || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const live = <T extends { from: string; to: string }>(list?: T[]): T[] => (list ?? []).filter((x) => seen.has(x.from) && seen.has(x.to));
  const auto = computeAutoLayout(alive, live(edges.precedes), layout.boardWidth || 1400, live(edges.contains), live(edges.sequence_precedes), live(edges.cross_precedes));
  const at = (id: string): { x: number; y: number } => {
    const saved = layout.stored?.[id];
    const p = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : auto[id] ?? { x: 0, y: 0 };
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };

  const sceneIds = new Set(sections.flatMap((s) => s.scenes.map((x) => x.id)));
  const byId = new Map(alive.map((e) => [e.id, e]));
  const cards: SharedCanvasCard[] = [];
  const boxes: SharedCanvas['boxes'] = [];
  const onStage = new Set<string>();
  for (const s of sections) {
    for (const scene of s.scenes) { cards.push({ id: scene.id, kind: 'scene', ...at(scene.id) }); onStage.add(scene.id); }
    const seq = byId.get(s.id);
    if (!seq || seq.type !== 'sequence') continue;
    onStage.add(s.id);
    const color = String(seq.color ?? '').trim();
    if (s.scenes.length) boxes.push({ id: s.id, ...(color ? { color } : {}), members: s.scenes.map((x) => x.id) });
    else cards.push({ id: s.id, kind: 'sequence', ...at(s.id) });
  }
  const idByName = new Map<string, string>();
  for (const e of alive) {
    if (e.type !== 'character' || !nameOf(e)) continue;
    cards.push({ id: e.id, kind: 'character', ...at(e.id) });
    onStage.add(e.id);
    idByName.set(nameOf(e).toLowerCase(), e.id);
  }

  const pair = (x: { from: string; to: string }): [string, string] => [x.from, x.to];
  const thread = [...live(edges.precedes), ...live(edges.sequence_precedes), ...live(edges.cross_precedes)]
    .filter((x) => onStage.has(x.from) && onStage.has(x.to) && byId.get(x.from)?.type !== 'character' && byId.get(x.to)?.type !== 'character')
    .map(pair);
  const involves = live(edges.involves)
    .filter((x) => sceneIds.has(x.from) && byId.get(x.to)?.type === 'character' && onStage.has(x.to))
    .map(pair);
  const bonds: SharedCanvas['bonds'] = [];
  for (const e of alive) {
    if (e.type !== 'relationship') continue;
    const a = idByName.get(String(e.character_a ?? '').trim().toLowerCase());
    const b = idByName.get(String(e.character_b ?? '').trim().toLowerCase());
    if (a && b && a !== b) bonds.push({ a, b, kind: String(e.kind ?? '').replace(/_/g, ' ').trim() });
  }
  return { cards, thread, boxes, involves, bonds };
}

/** O board como preview: seções em ordem de história, elenco e locais; com
 *  `layout`, também o palco (`canvas`). Pura. */
export function buildSharedBoard(graph: ShareGraph, layout?: BoardLayoutInput): SharedBoard {
  const { entities, precedes, contains, sequencePrecedes, crossPrecedes } = spineInputs(graph);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const edges = graph.edges ?? {};
  const castOf = new Map<string, string[]>();
  const sceneCount = new Map<string, number>();
  for (const inv of edges.involves ?? []) {
    const scene = byId.get(inv.from);
    const who = byId.get(inv.to);
    if (!scene || !isTold(scene) || !who || who.type !== 'character') continue;
    const name = nameOf(who);
    if (!name) continue;
    const list = castOf.get(scene.id) ?? [];
    if (!list.includes(name)) { list.push(name); sceneCount.set(who.id, (sceneCount.get(who.id) ?? 0) + 1); }
    castOf.set(scene.id, list);
  }
  const placeOf = new Map<string, string>();
  for (const occ of edges.occurs_in ?? []) {
    const where = byId.get(occ.to);
    if (where && where.type === 'location' && nameOf(where) && !placeOf.has(occ.from)) placeOf.set(occ.from, nameOf(where));
  }

  const { units, membersOrdered } = orderSpineUnits(entities, precedes, contains, sequencePrecedes, crossPrecedes);
  const sections: SharedSection[] = [];
  let n = 0;
  let loose: SharedSection | null = null;
  const toScene = (e: ProjectEntity): SharedScene => ({
    id: e.id,
    number: ++n,
    title: nameOf(e) || 'Untitled scene',
    summary: textOf(e),
    characters: castOf.get(e.id) ?? [],
    ...(placeOf.get(e.id) ? { location: placeOf.get(e.id) } : {}),
    ...(typeof e.card_color === 'string' && e.card_color ? { color: e.card_color } : {}),
    ...(typeof e.int_ext === 'string' && e.int_ext.trim() ? { intExt: e.int_ext.trim() } : {}),
    ...(beatsOf(e).length ? { beats: beatsOf(e) } : {}),
  });
  for (const u of units) {
    if (u.type === 'sequence') {
      const members = (membersOrdered.get(u.id) ?? []).filter(isTold);
      loose = null;
      sections.push({ id: u.id, title: nameOf(u) || 'Untitled sequence', ...(textOf(u) ? { summary: textOf(u) } : {}), scenes: members.map(toScene) });
    } else if (isTold(u)) {
      if (!loose) { loose = { id: `loose_${sections.length}`, title: '', scenes: [] }; sections.push(loose); }
      loose.scenes.push(toScene(u));
    }
  }

  const characters = entities
    .filter((e) => e.type === 'character' && nameOf(e))
    .map((e) => ({ id: e.id, name: nameOf(e), description: textOf(e), scenes: sceneCount.get(e.id) ?? 0 }))
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));
  const locations = entities
    .filter((e) => e.type === 'location' && nameOf(e))
    .map((e) => ({ name: nameOf(e), description: textOf(e) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = sections.filter((s) => s.title || s.scenes.length);
  return { sections: shown, characters, locations, ...(layout ? { canvas: buildCanvas(graph, shown, layout) } : {}) };
}

/** O roteiro como preview: as páginas de cada cena em ordem de história, e por
 *  último o texto ainda não ligado a nenhuma cena (o scratch). Pura. */
export function buildSharedScript(graph: ShareGraph, sceneTexts: ShareSceneText[], toBlocks: BlockParser = blocksFromHtmlText): SharedScript {
  const { entities, precedes, contains, sequencePrecedes, crossPrecedes } = spineInputs(graph);
  const htmlBy = new Map(sceneTexts.map((s) => [s.eventId, s.html]));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const sequenceOf = new Map<string, string>();
  for (const c of contains) {
    const seq = byId.get(c.from);
    if (seq && seq.type === 'sequence' && nameOf(seq) && !sequenceOf.has(c.to)) sequenceOf.set(c.to, nameOf(seq));
  }
  const scenes: SharedScriptScene[] = [];
  let n = 0;
  for (const e of toldOrderEvents(entities, precedes, contains, sequencePrecedes, crossPrecedes)) {
    if (!isTold(e)) continue;
    n += 1; // a cena conta mesmo sem páginas: o número é o do board
    const blocks = toBlocks(htmlBy.get(e.id) ?? '');
    const sequence = sequenceOf.get(e.id);
    if (blocks.length) scenes.push({ id: e.id, title: nameOf(e) || 'Untitled scene', blocks, number: n, ...(sequence ? { sequence } : {}) });
  }
  const tail = toBlocks(htmlBy.get(SCRATCH) ?? '');
  if (tail.length) scenes.push({ id: SCRATCH, title: '', blocks: tail });
  return { scenes };
}

/** O retrato de um link: só o que o escopo pede. Pura. */
export function buildShareSnapshot(
  scope: ShareScope, graph: ShareGraph, sceneTexts: ShareSceneText[] = [], layout?: BoardLayoutInput, toBlocks: BlockParser = blocksFromHtmlText,
): SharedSnapshot {
  return {
    v: 1,
    ...(scope !== 'script' ? { board: buildSharedBoard(graph, layout) } : {}),
    ...(scope !== 'board' ? { script: buildSharedScript(graph, sceneTexts, toBlocks) } : {}),
  };
}

/** Um retrato sem nada para mostrar (board sem cenas, roteiro sem páginas). */
export function isEmptySnapshot(snapshot: SharedSnapshot): boolean {
  const boardEmpty = !snapshot.board || snapshot.board.sections.every((s) => s.scenes.length === 0);
  const scriptEmpty = !snapshot.script || snapshot.script.scenes.length === 0;
  return boardEmpty && scriptEmpty;
}
