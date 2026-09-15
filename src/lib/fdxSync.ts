// fdxSync — motor HEADLESS do cowork .fdx. Aplica ao corkboard as MESMAS lanes
// do auto-sync do editor de roteiro (freeform-script.tsx), tendo como fonte um
// .fdx observado no disco (Final Draft salva → o shell re-parseia → aqui):
//
//   lane 1 (texto):    card cujo texto mudou → 'save-scene-text' (HTML tipado +
//                      ledger por bloco), como o runSave faz por região suja;
//   lane 2 (extração): card cujo texto mudou → 'enqueue-scene-extraction' —
//                      o "terminei a cena" é o PRÓPRIO save do Final Draft
//                      (chokidar awaitWriteFinish já é o settle; sem grace de 8s);
//   cenas novas:       job 'extract-braindump' (o MESMO da scratch lane e do
//                      import um-shot): a IA minta os cards — eventos com spans,
//                      personagens, locais, informações — encadeados após a
//                      cena anterior (tailSceneId/spliceAnchorId); o motor faz
//                      polling até pousar e adota cada evento pelo span da cena.
//
// A IA decide os cards, não o slugline: um evento pode cobrir VÁRIAS cenas do
// arquivo (INT. X - CONTINUOUS é o caso clássico) — é o modelo do produto
// (sub_events com sluglines). Cena cujo heading cai no span de um evento que
// já tem dona é ANEXADA a ele: o texto dela entra nas páginas daquele card,
// atrás do slugline. Nunca se cria card mecânico; se a IA não produzir cards,
// as cenas esperam (aviso na UI; Sync now re-tenta).
//
// Keep-bias law (do editor): NUNCA deleta card nem texto. Cena que some do
// arquivo vira "missing" (card fica; o roteirista decide keep/trash no painel).
// Uma geração de sync por vez; um save que chega no meio espera a rodada.
//
// Identidade da cena (o problema real do .fdx, que não carrega ids): mapa
// persistido por story em localStorage — `ff-fdx-sync-${storyId}` — com um
// registro por cena do arquivo (matching tolerante a renumeração, heading
// editado e corpo editado, ver matchScenes) e o estado de save/extração por
// EVENTO (um card = a união das cenas que apontam para ele).
//
// O texto fica no servidor; o .fdx no disco É a cópia local-first — qualquer
// rodada pode ser refeita a partir do arquivo de forma idempotente (hashes).
//
// Módulo sem React (a UI assina via subscribeFdxSync). Desktop-only na prática:
// openFdx/onFdxChanged degradam para no-op na web.
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  ackSceneCleared,
  deleteCard,
  enqueueExtractionJob,
  enqueueSceneExtraction,
  listProjectEntities,
  saveSceneText,
  updateCardName,
  type ProjectEntity,
  type SceneLedgerBlock,
} from './freeformApi';
import { openFdx, closeFdx, onFdxChanged } from './fdxClient';
import { pulseExtractionGlobal } from './storySession';

// ---- Helpers puros (exportados para teste) ---------------------------------

/** Mesmas funções do editor de roteiro (ledger §2a): hash de conteúdo normalizado. */
export const normText = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const strHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return String(h);
};
/** Heading normalizado para matching: caixa, pontuação e espaços não contam. */
export const normHeading = (h: string): string =>
  normText(h).toUpperCase().replace(/[^A-Z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Parágrafos tipados da cena; payloads antigos (sem `paragraphs`) degradam
 *  para o snippet como ação — nunca para "sem texto". */
export function sceneParagraphs(scene: FdxScene): FdxParagraph[] {
  if (scene.paragraphs && scene.paragraphs.length) return scene.paragraphs;
  return scene.snippet ? [{ type: 'description', text: scene.snippet }] : [];
}

/** Hash do CORPO da cena (sem heading): identidade + "mudou". */
export function bodyHashOf(scene: FdxScene): string {
  return strHash(normText(sceneParagraphs(scene).map((p) => p.text).join('\n')));
}

/** Título de um card mecânico (versões antigas do motor): "N. HEADING". */
export const sceneTitleOf = (scene: FdxScene): string => `${scene.number}. ${scene.heading.trim()}`;
const MECHANICAL_TITLE = /^\d+[A-Za-z]?\.\s+/;

/** Blocos tipados de UMA cena: slugline + parágrafos. `tagged` = o slugline
 *  carrega data-scene-id (só a primeira cena de um card). */
function sceneBlocks(eventId: string, scene: FdxScene, tagged: boolean): Array<{ html: string; text: string }> {
  const heading = scene.heading.trim();
  const tag = tagged ? ` data-scene-id="${escapeHtml(eventId)}"` : '';
  return [
    { html: `<p${tag} data-line-type="scene">${escapeHtml(heading)}</p>`, text: heading },
    ...sceneParagraphs(scene).map((p) => ({ html: `<p data-line-type="${p.type}">${escapeHtml(p.text)}</p>`, text: p.text })),
  ];
}

export interface ScenePages { html: string; ledger: SceneLedgerBlock[]; text: string; hash: string; paragraphs: number }

/** Uma ou mais cenas do arquivo → páginas de UM card, no formato do editor de
 *  roteiro: o PRIMEIRO parágrafo é o slugline com data-scene-id (a tag de
 *  região); sluglines seguintes são linhas 'scene' comuns dentro da região.
 *  Ledger = um bloco por parágrafo, ids vazios (o editor minta ao abrir). */
export function scenesToPages(eventId: string, scenes: FdxScene[]): ScenePages {
  const blocks = scenes.flatMap((s, i) => sceneBlocks(eventId, s, i === 0));
  const text = blocks.map((b) => b.text).join('\n');
  return {
    html: blocks.map((b) => b.html).join(''),
    ledger: blocks.map((b) => ({ b: '', h: strHash(normText(b.text)), l: b.text.length })),
    text,
    hash: strHash(normText(text)),
    paragraphs: scenes.reduce((n, s) => n + sceneParagraphs(s).length, 0),
  };
}

/** Compat: páginas de uma cena só. */
export function sceneToHtml(eventId: string, scene: FdxScene): { html: string; ledger: SceneLedgerBlock[]; text: string } {
  const p = scenesToPages(eventId, [scene]);
  return { html: p.html, ledger: p.ledger, text: p.text };
}

// ---- Mapa persistido -------------------------------------------------------

export interface FdxSceneRecord {
  /** Id interno do registro (uma cena do arquivo). Estável entre rodadas. */
  id: string;
  /** Card que esta cena compõe (várias cenas podem apontar para o mesmo). */
  eventId: string;
  number: string;
  heading: string;
  headingNorm: string;
  bodyHash: string;
  lastSeenAt: string;
  /** Setado quando a cena sumiu do .fdx (keep-bias: o card fica). */
  missingSince?: string;
  /** O roteirista escolheu KEEP para a cena sumida: o texto dela sai das
   *  páginas do card (card vira slot não-escrito se era a única cena). Some da
   *  lista de decisões; se a cena voltar ao arquivo, o registro re-casa. */
  decision?: 'kept';
}

/** Estado de sync por CARD (a união das cenas que apontam para ele). */
export interface FdxEventState {
  /** Hash das páginas no último save-scene-text bem-sucedido. */
  savedHash?: string;
  /** Hash das páginas na última extração (por cena ou pelo braindump que mintou o card). */
  extractedHash?: string;
}

export interface FdxSyncStore {
  v: 2;
  filePath?: string;
  fileName?: string;
  /** Auto-sync ligado (default) — o análogo do toggle do editor de roteiro. */
  auto: boolean;
  /** Por id de registro (uma cena do arquivo). */
  scenes: Record<string, FdxSceneRecord>;
  /** Por eventId. */
  events: Record<string, FdxEventState>;
  /** Job de IA em voo (cenas novas aguardando os cards mintados). */
  pending?: PendingJob;
  /** Último job que não pousou — o modo auto espera um cooldown para re-enfileirar. */
  lastAiFailureAt?: string;
}

export const storeKeyFor = (storyId: string): string => `ff-fdx-sync-${storyId}`;

export function emptyStore(): FdxSyncStore {
  return { v: 2, auto: true, scenes: {}, events: {} };
}

let recSeq = 0;
export const newRecordId = (): string => `rec_${Date.now().toString(36)}_${(recSeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** v1 (um registro por eventId, hashes no registro) → v2. */
function migrateStore(parsed: any): FdxSyncStore | null {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.v === 2 && typeof parsed.scenes === 'object') {
    return { ...emptyStore(), ...parsed, scenes: parsed.scenes ?? {}, events: parsed.events ?? {} };
  }
  if (parsed.v === 1 && typeof parsed.scenes === 'object') {
    const out = emptyStore();
    out.filePath = parsed.filePath; out.fileName = parsed.fileName; out.auto = parsed.auto !== false;
    for (const [eventId, r] of Object.entries<any>(parsed.scenes)) {
      out.scenes[eventId] = {
        id: eventId, eventId, number: String(r.number ?? ''), heading: String(r.heading ?? ''),
        headingNorm: String(r.headingNorm ?? normHeading(String(r.heading ?? ''))), bodyHash: String(r.bodyHash ?? ''),
        lastSeenAt: String(r.lastSeenAt ?? ''), missingSince: r.missingSince, decision: r.decision,
      };
      out.events[eventId] = { savedHash: r.savedHash, extractedHash: r.extractedHash };
    }
    out.pending = parsed.pending; out.lastAiFailureAt = parsed.lastAiFailureAt;
    return out;
  }
  return null;
}

function loadStore(storyId: string): FdxSyncStore {
  try {
    const raw = localStorage.getItem(storeKeyFor(storyId));
    if (!raw) return emptyStore();
    return migrateStore(JSON.parse(raw)) ?? emptyStore();
  } catch {
    return emptyStore();
  }
}

function persistStore(storyId: string, store: FdxSyncStore): void {
  try {
    localStorage.setItem(storeKeyFor(storyId), JSON.stringify(store));
  } catch {
    /* quota/privado — o mapa volta a ser reconstruído por matching no próximo sync */
  }
}

// ---- Matching de identidade (puro) -----------------------------------------

export type MatchVia = 'key' | 'body' | 'heading' | 'card' | 'new';

export interface SceneMatch {
  scene: FdxScene;
  headingNorm: string;
  bodyHash: string;
  eventId: string | null;
  via: MatchVia;
  record?: FdxSceneRecord;
}

/** Headings que um card de evento "responde": título (sem prefixo "N. " de
 *  cards mecânicos antigos) e os sluglines dos seus sub_events. */
const cardHeadingNorms = (e: ProjectEntity): string[] => {
  const out = new Set<string>();
  const title = String(e.working_title ?? e.working_name ?? '').trim();
  if (title) {
    out.add(normHeading(title));
    const stripped = title.replace(MECHANICAL_TITLE, '');
    if (stripped !== title) out.add(normHeading(stripped));
  }
  for (const se of e.sub_events ?? []) if (se?.slugline) out.add(normHeading(String(se.slugline)));
  return [...out].filter(Boolean);
};

/**
 * Resolve a identidade de cada cena do .fdx contra (a) os registros do mapa e
 * (b) os cards de evento vivos no board, em passes do mais forte para o mais
 * fraco — cada passe só casa quando é ÚNICO dos dois lados:
 *   key      nº + heading iguais (cena intocada ou só corpo editado);
 *   body     mesmo corpo (renumerada e/ou heading editado);
 *   heading  mesmo heading (corpo editado E renumerada);
 *   card     card do board sem registro cujo título/slugline bate (import
 *            antigo, extração por IA) — adoção, não duplicata;
 *   new      nada casou → vai para a IA (keep-bias: nunca sobrescreve).
 * Registros sem cena correspondente voltam como `missing`.
 */
export function matchScenes(
  store: FdxSyncStore,
  scenes: FdxScene[],
  cards: ProjectEntity[],
): { matches: SceneMatch[]; missing: FdxSceneRecord[] } {
  const records = Object.values(store.scenes);
  const used = new Set<string>(); // ids de registro
  const matches: SceneMatch[] = scenes
    .filter((s) => s.heading && s.heading.trim())
    .map((s) => ({ scene: s, headingNorm: normHeading(s.heading), bodyHash: bodyHashOf(s), eventId: null, via: 'new' as MatchVia }));

  const take = (m: SceneMatch, rec: FdxSceneRecord, via: MatchVia): void => {
    m.eventId = rec.eventId;
    m.record = rec;
    m.via = via;
    used.add(rec.id);
  };
  const free = (r: FdxSceneRecord): boolean => !used.has(r.id);
  const open = (): SceneMatch[] => matches.filter((m) => !m.eventId);
  const uniqueAmong = <T,>(items: T[], key: (t: T) => string, k: string): boolean =>
    items.filter((t) => key(t) === k).length === 1;

  // A — chave (nº + heading)
  for (const m of matches) {
    const rec = records.find((r) => free(r) && r.number === m.scene.number && r.headingNorm === m.headingNorm);
    if (rec) take(m, rec, 'key');
  }
  // B — corpo (só cenas com corpo; único dos dois lados)
  for (const m of open()) {
    if (sceneParagraphs(m.scene).length === 0) continue;
    if (!uniqueAmong(open(), (x) => x.bodyHash, m.bodyHash)) continue;
    const c = records.filter((r) => free(r) && r.bodyHash === m.bodyHash);
    if (c.length === 1) take(m, c[0], 'body');
  }
  // C — heading (único dos dois lados)
  for (const m of open()) {
    if (!uniqueAmong(open(), (x) => x.headingNorm, m.headingNorm)) continue;
    const c = records.filter((r) => free(r) && r.headingNorm === m.headingNorm);
    if (c.length === 1) take(m, c[0], 'heading');
  }
  // D — adoção de card vivo sem registro (import antigo / extração por IA)
  const mapped = new Set(records.map((r) => r.eventId));
  const adoptable = cards.filter((e) => e.type === 'event' && !e.deleted_at && !mapped.has(e.id));
  const adoptedNow = new Set<string>();
  for (const m of open()) {
    if (!uniqueAmong(open(), (x) => x.headingNorm, m.headingNorm)) continue;
    const c = adoptable.filter((e) => !adoptedNow.has(e.id) && cardHeadingNorms(e).includes(m.headingNorm));
    if (c.length === 1) {
      const e = c[0];
      adoptedNow.add(e.id);
      const rec: FdxSceneRecord = {
        id: newRecordId(), eventId: e.id, number: m.scene.number, heading: m.scene.heading.trim(),
        headingNorm: m.headingNorm, bodyHash: '', lastSeenAt: '',
      };
      take(m, rec, 'card');
    }
  }

  const missing = records.filter((r) => !used.has(r.id));
  return { matches, missing };
}

// ---- Braindump por IA (puro) -----------------------------------------------
// Cenas NOVAS não viram card mecânico: vão para um job 'extract-braindump'
// (o mesmo do import um-shot e da scratch lane do editor). A IA minta os
// eventos — e personagens, locais, informações — com spans (src_start/src_end)
// sobre a prose enviada; o motor adota cada evento pela cena cujo heading cai
// no span. Cena que a IA fundiu a outra é ANEXADA ao evento que a cobre.

export interface PendingScene {
  number: string;
  heading: string;
  headingNorm: string;
  /** Offset do heading na prose enviada. */
  offset: number;
  /** Hash do corpo no momento do enqueue (a IA extraiu ESSE texto). */
  bodyHash: string;
}

export interface PendingJob {
  braindumpId: string;
  enqueuedAt: string;
  prose: string;
  scenes: PendingScene[];
  /** Cena mapeada imediatamente anterior ao bloco novo (âncora do splice). */
  tailSceneId?: string;
}

/** Roteiro das cenas no formato do fullText do parser (heading, ação, CUE
 *  precedido de linha em branco) + offset do heading de cada cena na prose. */
export function buildBraindumpProse(scenes: FdxScene[]): { prose: string; offsets: number[] } {
  let prose = '';
  const offsets: number[] = [];
  for (const s of scenes) {
    if (prose.length) prose += '\n\n';
    offsets.push(prose.length);
    prose += s.heading.trim();
    for (const p of sceneParagraphs(s)) {
      prose += (p.type === 'character' ? '\n\n' : '\n') + p.text;
    }
  }
  return { prose, offsets };
}

export interface MintedSpan { id: string; start: number; end: number }

/** Eventos vivos mintados por um braindump, com spans válidos, em ordem de span. */
export function spansOf(entities: ProjectEntity[], braindumpId: string): MintedSpan[] {
  return entities
    .filter((e) => e.type === 'event' && !e.deleted_at && String((e as any).src_braindump ?? '') === braindumpId)
    .map((e) => ({
      id: e.id,
      start: parseInt(String((e as any).src_start ?? ''), 10),
      end: parseInt(String((e as any).src_end ?? ''), 10),
    }))
    .filter((s) => Number.isFinite(s.start))
    .map((s) => ({ ...s, end: Number.isFinite(s.end) && s.end > s.start ? s.end : s.start + 1 }))
    .sort((a, b) => a.start - b.start);
}

export interface SpanAdoption { eventId: string; own: boolean }

/** Cena pendente → evento mintado. `own` = a cena é a dona do card (span
 *  cobre o heading ou começa dentro dela, e ninguém reivindicou antes);
 *  senão a cena é ANEXADA ao evento que a cobre (span contendo o offset), ou
 *  ao último evento que começa antes dela, ou ao primeiro. Com spans vazios
 *  devolve null (nada pousou). */
export function adoptBySpans(pending: PendingScene[], spans: MintedSpan[]): Array<SpanAdoption | null> {
  const claimed = new Set<string>();
  const out: Array<SpanAdoption | null> = [];
  for (let i = 0; i < pending.length; i++) {
    if (spans.length === 0) { out.push(null); continue; }
    const off = pending[i].offset;
    const next = i + 1 < pending.length ? pending[i + 1].offset : Number.POSITIVE_INFINITY;
    const own = spans.find((s) => !claimed.has(s.id) && ((s.start <= off && off < s.end) || (s.start >= off && s.start < next)));
    if (own) { claimed.add(own.id); out.push({ eventId: own.id, own: true }); continue; }
    const covering = spans.find((s) => s.start <= off && off < s.end);
    const preceding = [...spans].reverse().find((s) => s.start <= off);
    out.push({ eventId: (covering ?? preceding ?? spans[0]).id, own: false });
  }
  return out;
}

/** Grupos contíguos de índices (uma inserção no meio do roteiro = um grupo). */
export function contiguousGroups(indices: number[]): number[][] {
  const groups: number[][] = [];
  for (const i of indices) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1] === i - 1) g.push(i);
    else groups.push([i]);
  }
  return groups;
}

// ---- Controlador (singleton) -----------------------------------------------

export type FdxSyncStatus = 'idle' | 'syncing' | 'error';

export interface FdxRunSummary {
  at: string;
  /** Cenas enviadas à IA nesta rodada. */
  enqueuedForAi: number;
  /** Cenas que viraram card próprio da IA (adotadas por span) nesta rodada. */
  adoptedFromAi: number;
  /** Cenas anexadas a um card da IA que cobre mais de um slugline. */
  attached: number;
  /** Cards existentes do board adotados por título/slugline. */
  adopted: number;
  renamed: number;
  saved: number;
  extracted: number;
  missing: number;
  errors: number;
}

export interface FdxSyncSnapshot {
  bound: boolean;
  storyId: string | null;
  active: boolean;
  filePath?: string;
  fileName?: string;
  title?: string;
  auto: boolean;
  status: FdxSyncStatus;
  lastError?: string;
  lastSyncAt?: string;
  lastChangeAt?: string;
  /** O arquivo mudou desde a última rodada (só relevante com auto OFF). */
  dirty: boolean;
  sceneCount: number;
  /** Cenas do arquivo mapeadas a um card. */
  mappedCount: number;
  /** Cards distintos que essas cenas compõem. */
  cardCount: number;
  progress?: { done: number; total: number };
  /** Job de IA em voo: cenas novas aguardando os cards mintados. proseLength
   *  deixa o board decidir o meter (windowed acima de 40k chars). */
  pending?: { count: number; since: string; braindumpId: string; proseLength: number };
  lastRun?: FdxRunSummary;
  /** Cenas sumidas do arquivo ainda SEM decisão (keep/trash). */
  missing: Array<{ recordId: string; eventId: string; heading: string; since: string; sharedCard: boolean }>;
  /** Decisões keep/trash em andamento (UI desabilita os botões). */
  resolvingIds: string[];
}

type Auth = { userId: string; token: string };

const AUTO_DEBOUNCE_MS = 1500;
/** Polling do job de IA: como o pollCarve do editor (20s, 4×15s, depois 30s). */
const POLL_FIRST_MS = 20000;
const POLL_EARLY_MS = 15000;
const POLL_LATE_MS = 30000;
/** Sem eventos legíveis até aqui = a IA não produziu cards; libera as cenas
 *  (continuam sem card, esperando) para o Sync now / o cooldown re-tentar. */
const PENDING_TIMEOUT_MS = 6 * 60 * 1000;
const PENDING_TIMEOUT_BIG_MS = 16 * 60 * 1000; // roteiros > 40k chars (import windowed)
const BIG_PROSE = 40000;
/** Depois de um job que não pousou, o modo auto espera antes de re-enfileirar. */
const AI_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

let storyId: string | null = null;
let boundAuth: Auth | null = null;
let store: FdxSyncStore = emptyStore();
let active = false;
let lastPayload: FdxPayload | null = null;
let status: FdxSyncStatus = 'idle';
let lastError: string | undefined;
let lastSyncAt: string | undefined;
let lastChangeAt: string | undefined;
let dirty = false;
let running = false;
let pendingPayload: FdxPayload | null = null;
let progress: { done: number; total: number } | undefined;
let lastRun: FdxRunSummary | undefined;
let offChanged: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAttempt = 0;
const resolving = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) { try { fn(); } catch { /* UI */ } }
}

export function subscribeFdxSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const liveRecords = (): FdxSceneRecord[] => Object.values(store.scenes).filter((r) => !r.missingSince);

export function getFdxSyncSnapshot(): FdxSyncSnapshot {
  const recs = Object.values(store.scenes);
  const live = liveRecords();
  return {
    bound: !!storyId,
    storyId,
    active,
    filePath: store.filePath,
    fileName: store.fileName,
    title: lastPayload?.title,
    auto: store.auto,
    status,
    lastError,
    lastSyncAt,
    lastChangeAt,
    dirty,
    sceneCount: lastPayload?.ok ? lastPayload.scenes.filter((s) => s.heading && s.heading.trim()).length : 0,
    mappedCount: live.length,
    cardCount: new Set(live.map((r) => r.eventId)).size,
    progress,
    pending: store.pending
      ? { count: store.pending.scenes.length, since: store.pending.enqueuedAt, braindumpId: store.pending.braindumpId, proseLength: store.pending.prose.length }
      : undefined,
    lastRun,
    missing: recs
      .filter((r) => r.missingSince && !r.decision)
      .map((r) => ({
        recordId: r.id,
        eventId: r.eventId,
        heading: `${r.number}. ${r.heading}`,
        since: r.missingSince!,
        sharedCard: live.some((o) => o.eventId === r.eventId),
      })),
    resolvingIds: [...resolving],
  };
}

/** Vincula o motor à story do corkboard aberto. Trocar de story com um watch
 *  ativo encerra o watch anterior (uma fonte, um board). */
export function bindFdxSync(nextStoryId: string, auth: Auth | null): void {
  if (storyId !== nextStoryId) {
    if (active) void stopFdxSync();
    clearPoll();
    storyId = nextStoryId;
    store = loadStore(nextStoryId);
    lastPayload = null;
    lastError = undefined;
    lastSyncAt = undefined;
    lastChangeAt = undefined;
    dirty = false;
    lastRun = undefined;
    progress = undefined;
    status = 'idle';
  }
  if (auth) boundAuth = auth;
  emit();
}

async function freshAuth(): Promise<Auth> {
  try {
    const s = await fetchAuthSession();
    const token = s.tokens?.idToken?.toString();
    const userId = String(s.tokens?.idToken?.payload?.['cognito:username'] ?? '');
    if (token && userId) return { userId, token };
  } catch {
    /* cai no token vinculado */
  }
  if (boundAuth) return boundAuth;
  throw new Error('Not authenticated');
}

function ensureSubscribed(): void {
  if (offChanged) return;
  offChanged = onFdxChanged((payload) => handleChanged(payload));
}

function clearPoll(): void {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  pollAttempt = 0;
}

/** Agenda a próxima checagem do job de IA (re-roda a rodada, que adota o que pousou). */
function schedulePoll(): void {
  if (!active || !store.pending) return;
  if (pollTimer) return;
  const delay = pollAttempt === 0 ? POLL_FIRST_MS : pollAttempt < 5 ? POLL_EARLY_MS : POLL_LATE_MS;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    pollAttempt++;
    if (lastPayload?.ok) void runSync(lastPayload);
  }, delay);
}

function handleChanged(payload: FdxPayload): void {
  if (!active) return;
  lastPayload = payload;
  lastChangeAt = payload.updatedAt;
  if (!payload.ok) {
    // mid-write / parse falhou: o próximo save do FD reenvia. Não é erro de sync.
    lastError = payload.error || 'could not read the .fdx';
    emit();
    return;
  }
  lastError = undefined;
  dirty = true;
  if (store.auto) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSync(payload);
    }, AUTO_DEBOUNCE_MS);
  }
  emit();
}

/** Abre o seletor de .fdx, começa a observar e faz a rodada inicial (bootstrap:
 *  todas as cenas são novas → um braindump com o roteiro inteiro, como o import
 *  um-shot). Retorna false se o usuário cancelou ou não há story vinculada. */
export async function openFdxSync(): Promise<boolean> {
  if (!storyId) return false;
  const payload = await openFdx();
  if (!payload) return false;
  ensureSubscribed();
  active = true;
  store.filePath = payload.path;
  store.fileName = payload.fileName;
  persistStore(storyId, store);
  lastPayload = payload;
  lastChangeAt = payload.updatedAt;
  lastError = payload.ok ? undefined : (payload.error || 'could not read the .fdx');
  emit();
  if (payload.ok) await runSync(payload, { manual: true });
  return true;
}

export async function stopFdxSync(): Promise<void> {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  clearPoll();
  active = false;
  pendingPayload = null;
  try { await closeFdx(); } catch { /* best-effort */ }
  emit();
}

/** "Sync now": roda a rodada com o último snapshot (funciona com auto OFF e
 *  re-tenta um job de IA que falhou, ignorando o cooldown). */
export async function syncFdxNow(): Promise<void> {
  if (!lastPayload || !lastPayload.ok) return;
  await runSync(lastPayload, { manual: true });
}

export function setFdxAuto(auto: boolean): void {
  store.auto = auto;
  if (storyId) persistStore(storyId, store);
  emit();
  if (auto && dirty && lastPayload?.ok) void runSync(lastPayload);
}

/**
 * Decisão do roteirista sobre uma cena que sumiu do .fdx — o MESMO fluxo do
 * editor de roteiro para uma cena cujo texto foi apagado (resolveCleared):
 *   keep  → o texto dela sai das páginas do card. Se era a única cena do card:
 *           páginas limpas (save-scene-text vazio, como o runSave numa deleção
 *           de cena inteira) + ack-scene-cleared → slot não-escrito no spine.
 *           Se o card tem outras cenas: as páginas são re-salvas sem ela.
 *   trash → se era a única cena: delete-card (soft-delete, recuperável pelo
 *           Trash do board). Se o card tem outras cenas: só a cena sai do
 *           mapa (e das páginas); o card fica.
 * Nada disso acontece sozinho: keep-bias, o pipeline nunca decide por ele.
 */
export async function resolveMissingScene(recordId: string, choice: 'keep' | 'trash'): Promise<void> {
  if (!storyId || resolving.has(recordId)) return;
  const sid = storyId;
  const rec = store.scenes[recordId];
  if (!rec || !rec.missingSince) return;
  const siblings = liveRecords().filter((o) => o.eventId === rec.eventId);
  resolving.add(recordId);
  emit();
  try {
    const auth = await freshAuth();
    if (choice === 'keep') {
      if (siblings.length === 0) {
        await saveSceneText({ projectId: sid, eventId: rec.eventId, html: '' }, auth.token);
        await ackSceneCleared({ projectId: sid, eventId: rec.eventId }, auth.token);
        store.events[rec.eventId] = {};
      }
      store.scenes[recordId] = { ...rec, decision: 'kept' };
    } else {
      if (siblings.length === 0) {
        await deleteCard({ cardId: rec.eventId, projectId: sid }, auth.token);
        delete store.events[rec.eventId];
      }
      delete store.scenes[recordId];
    }
    persistStore(sid, store);
    lastError = undefined;
    try {
      window.dispatchEvent(new CustomEvent('ff-fdx-synced', { detail: { storyId: sid, resolved: { recordId, choice } } }));
    } catch { /* ambiente sem window */ }
    // Card compartilhado: re-salva as páginas sem a cena decidida.
    if (siblings.length > 0 && active && lastPayload?.ok) void runSync(lastPayload);
  } catch (e) {
    lastError = `${choice === 'keep' ? 'Keep' : 'Trash'} failed for "${rec.number}. ${rec.heading}": ${(e as Error)?.message || String(e)}`;
    console.warn('[fdx-sync] missing-scene decision failed', { recordId, choice, e });
  } finally {
    resolving.delete(recordId);
    emit();
  }
}

/**
 * Uma rodada de sync. Ordem: matching → (job de IA pendente: adota o que
 * pousou, por span, dona ou anexada) → cards: rename / save / extração →
 * cenas novas: um job de IA para o primeiro grupo contíguo (os demais esperam
 * a próxima rodada) → cenas sumidas ficam marcadas. Uma rodada por vez; um
 * payload que chega no meio é guardado e roda em seguida (o mais novo vence).
 */
async function runSync(payload: FdxPayload, opts?: { manual?: boolean }): Promise<void> {
  if (!storyId) return;
  if (running) { pendingPayload = payload; return; }
  running = true;
  status = 'syncing';
  lastError = undefined;
  const sid = storyId;
  const manual = !!opts?.manual;
  const summary: FdxRunSummary = {
    at: '', enqueuedForAi: 0, adoptedFromAi: 0, attached: 0, adopted: 0, renamed: 0, saved: 0, extracted: 0, missing: 0, errors: 0,
  };
  emit();
  try {
    const auth = await freshAuth();
    const graph = await listProjectEntities({ projectId: sid }, auth.token);
    const cards = graph.entities ?? [];
    const titleOf = new Map(cards.map((e) => [e.id, String(e.working_title ?? e.working_name ?? '')]));
    const matched = matchScenes(store, payload.scenes, cards);
    const matches = matched.matches;
    // Card apagado no board (Trash) → a cena perdeu o card: volta a ser nova e
    // vai para a IA. Registros sumidos cujo card morreu não pedem decisão.
    const alive = new Set(cards.filter((e) => !e.deleted_at).map((e) => e.id));
    for (const m of matches) {
      if (m.eventId && !alive.has(m.eventId)) { m.eventId = null; m.record = undefined; m.via = 'new'; }
    }
    const missing = matched.missing.filter((r) => alive.has(r.eventId));
    const now = new Date().toISOString();
    const keyOf = (number: string, headingNorm: string): string => `${number}|${headingNorm}`;

    // ---- Job de IA pendente: pousou? -------------------------------------
    // "Pousou" = eventos mintados LEGÍVEIS. O vértice do braindump não basta:
    // no backend S3 o blob nasce vazio e é preenchido depois.
    const fromJob = new Map<number, { eventId: string; own: boolean; bodyHash: string }>(); // índice do match →
    const waitingKeys = new Set<string>(); // cenas do job ainda em voo (não re-enfileirar)
    let jobPending = false;
    if (store.pending) {
      const job = store.pending;
      const spans = spansOf(cards, job.braindumpId);
      const age = Date.now() - Date.parse(job.enqueuedAt);
      const timeout = job.prose.length > BIG_PROSE ? PENDING_TIMEOUT_BIG_MS : PENDING_TIMEOUT_MS;
      if (spans.length === 0) {
        if (age > timeout) {
          // A IA não produziu cards a tempo. NADA é criado mecanicamente: as
          // cenas seguem sem card, esperando; o modo auto respeita um cooldown
          // para novos jobs, o Sync now re-enfileira na hora.
          console.warn('[fdx-sync] AI job produced no readable cards in time; releasing', { braindumpId: job.braindumpId, age });
          store.pending = undefined;
          store.lastAiFailureAt = now;
          lastError = `AI extraction produced no cards for ${job.scenes.length} scene(s) in time — they are still waiting; Sync now retries`;
          clearPoll();
        } else {
          jobPending = true;
          for (const ps of job.scenes) waitingKeys.add(keyOf(ps.number, ps.headingNorm));
        }
      } else {
        const adoptions = adoptBySpans(job.scenes, spans);
        job.scenes.forEach((ps, i) => {
          const idx = matches.findIndex((m) => !m.eventId && keyOf(m.scene.number, m.headingNorm) === keyOf(ps.number, ps.headingNorm));
          if (idx < 0) return; // a cena saiu do arquivo enquanto a IA rodava — os cards ficam (keep-bias)
          const a = adoptions[i];
          if (a) fromJob.set(idx, { eventId: a.eventId, own: a.own, bodyHash: ps.bodyHash });
        });
        store.pending = undefined;
        clearPoll();
      }
    }

    // ---- Cenas, em ordem de arquivo: resolve o card de cada uma ------------
    const nextScenes: Record<string, FdxSceneRecord> = {};
    const newIdx: number[] = []; // cenas novas sem job (candidatas ao próximo braindump)
    /** Cenas por card, em ordem de arquivo; `aiHash` = hash do corpo que a IA
     *  já leu (job desta rodada), para carimbar a extração. */
    const byEvent = new Map<string, { scenes: FdxScene[]; aiHashes: Array<string | undefined>; firstIdx: number }>();

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const rec = m.record;
      const job = fromJob.get(i);
      let eventId: string | null = m.eventId;
      let aiHash: string | undefined;
      if (!eventId && job) {
        eventId = job.eventId;
        aiHash = job.bodyHash;
        if (job.own) summary.adoptedFromAi++; else summary.attached++;
      } else if (!eventId) {
        if (waitingKeys.has(keyOf(m.scene.number, m.headingNorm))) continue; // em voo: a próxima rodada adota
        newIdx.push(i);
        continue; // vai para o job de IA desta rodada (ou espera o pendente)
      } else if (m.via === 'card') {
        summary.adopted++;
      }
      m.eventId = eventId;
      const id = rec?.id ?? newRecordId();
      nextScenes[id] = {
        id, eventId, number: m.scene.number, heading: m.scene.heading.trim(), headingNorm: m.headingNorm,
        bodyHash: m.bodyHash, lastSeenAt: now,
      };
      const g = byEvent.get(eventId) ?? { scenes: [], aiHashes: [], firstIdx: i };
      g.scenes.push(m.scene);
      g.aiHashes.push(aiHash);
      byEvent.set(eventId, g);
    }

    // ---- Cards: rename / save / extração -----------------------------------
    // Um card com cena sumida AINDA sem decisão não é re-salvo: keep-bias — o
    // texto dela só sai das páginas quando o roteirista decidir (keep/trash).
    const undecided = new Set(missing.filter((r) => !r.decision).map((r) => r.eventId));
    progress = { done: 0, total: byEvent.size };
    emit();
    let done = 0;
    for (const [eventId, g] of byEvent) {
      try {
        // Título de card MECÂNICO (versões antigas do motor) acompanha renumeração/
        // heading; títulos da IA nunca são tocados.
        const title = titleOf.get(eventId) ?? '';
        if (g.scenes.length === 1 && MECHANICAL_TITLE.test(title) && title !== sceneTitleOf(g.scenes[0])) {
          try {
            await updateCardName({ cardId: eventId, projectId: sid, workingName: sceneTitleOf(g.scenes[0]) }, auth.token);
            summary.renamed++;
          } catch (e) {
            console.warn('[fdx-sync] rename failed', e);
          }
        }
        if (undecided.has(eventId)) continue;

        const pages = scenesToPages(eventId, g.scenes);
        const state: FdxEventState = { ...(store.events[eventId] ?? {}) };
        // A IA já leu exatamente este texto (todas as cenas do card vieram do
        // job desta rodada, sem edição desde o enqueue) → extração carimbada.
        const aiRead = g.aiHashes.length === g.scenes.length && g.aiHashes.every((h, k) => h !== undefined && h === bodyHashOf(g.scenes[k]));
        if (aiRead) state.extractedHash = pages.hash;

        // lane 1 — texto
        if (state.savedHash !== pages.hash) {
          await saveSceneText(
            { projectId: sid, eventId, html: pages.html, ledger: pages.ledger, ...(state.extractedHash === pages.hash ? { stampExtracted: true } : {}) },
            auth.token,
          );
          state.savedHash = pages.hash;
          summary.saved++;
        }
        // lane 2 — extração (só com corpo e só se mudou desde a última extração)
        if (pages.paragraphs > 0 && state.extractedHash !== pages.hash) {
          await enqueueSceneExtraction({ projectId: sid, eventId, userId: auth.userId, sceneText: pages.text, ledger: pages.ledger }, auth.token);
          state.extractedHash = pages.hash;
          summary.extracted++;
          pulseExtractionGlobal(sid);
        }
        store.events[eventId] = state;
      } catch (e) {
        summary.errors++;
        console.warn('[fdx-sync] card failed', eventId, e);
      } finally {
        done++;
        progress = { done, total: byEvent.size };
        emit();
      }
    }

    // ---- Cenas novas → job de IA (primeiro grupo contíguo) -----------------
    if (newIdx.length && !jobPending && !store.pending) {
      const cooldownActive = !manual && !!store.lastAiFailureAt && Date.now() - Date.parse(store.lastAiFailureAt) < AI_FAILURE_COOLDOWN_MS;
      if (cooldownActive) {
        lastError = `AI extraction failed recently — ${newIdx.length} new scene(s) waiting; Sync now retries`;
      } else {
        const group = contiguousGroups(newIdx)[0];
        const scenes = group.map((i) => matches[i].scene);
        const { prose, offsets } = buildBraindumpProse(scenes);
        // Âncora: a última cena MAPEADA antes do grupo (na ordem do arquivo).
        let tailSceneId: string | undefined;
        for (let i = group[0] - 1; i >= 0; i--) {
          const id = matches[i].eventId;
          if (id) { tailSceneId = id; break; }
        }
        const tailGroup = tailSceneId ? byEvent.get(tailSceneId) : undefined;
        const tailText = tailGroup ? scenesToPages(tailSceneId!, tailGroup.scenes).text.slice(-300) : '';
        const braindumpId = `fdx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job: PendingJob = {
          braindumpId,
          enqueuedAt: now,
          prose,
          tailSceneId,
          scenes: group.map((i, j) => ({
            number: matches[i].scene.number,
            heading: matches[i].scene.heading.trim(),
            headingNorm: matches[i].headingNorm,
            offset: offsets[j],
            bodyHash: matches[i].bodyHash,
          })),
        };
        const small = prose.length <= BIG_PROSE;
        await enqueueExtractionJob(
          {
            jobType: 'extract-braindump', projectId: sid, userId: auth.userId, braindumpId,
            prose, sourceFormat: 'screenplay',
            // Card-by-card reveal no board aberto (entity_streamed), como a scratch lane.
            streaming: true,
            // Encadeamento: tailScene → cenas mintadas em ordem de span; e o
            // splice na âncora (não no fim do spine) para inserções no meio.
            ...(small && tailSceneId ? { tailSceneId, spliceAnchorId: tailSceneId } : {}),
            ...(small && tailSceneId ? { tailContext: { sceneTitle: titleOf.get(tailSceneId) ?? '', tailText } } : {}),
          },
          auth.token,
        );
        store.pending = job;
        summary.enqueuedForAi = scenes.length;
        pulseExtractionGlobal(sid);
        clearPoll();
        schedulePoll();
        if (newIdx.length > group.length) {
          console.info('[fdx-sync] more new scenes waiting for the next AI job', { waiting: newIdx.length - group.length });
        }
      }
    } else if (jobPending) {
      schedulePoll();
    }

    // Keep-bias: cenas que sumiram do arquivo ficam no mapa, marcadas.
    for (const r of missing) {
      nextScenes[r.id] = { ...r, missingSince: r.missingSince ?? now };
    }
    summary.missing = missing.filter((r) => !r.decision).length;
    store.scenes = nextScenes;
    // Estado de cards que nenhum registro referencia mais é lixo.
    const referenced = new Set(Object.values(nextScenes).map((r) => r.eventId));
    for (const k of Object.keys(store.events)) if (!referenced.has(k)) delete store.events[k];
    persistStore(sid, store);

    summary.at = new Date().toISOString();
    lastRun = summary;
    lastSyncAt = summary.at;
    dirty = false;
    status = summary.errors > 0 ? 'error' : 'idle';
    if (summary.errors > 0) lastError = `${summary.errors} card(s) failed — the next run retries them`;
    try {
      window.dispatchEvent(new CustomEvent('ff-fdx-synced', { detail: { storyId: sid, summary } }));
    } catch { /* ambiente sem window (teste) */ }
  } catch (e) {
    status = 'error';
    lastError = (e as Error)?.message || String(e);
    console.warn('[fdx-sync] run failed', e);
  } finally {
    progress = undefined;
    running = false;
    emit();
    const next = pendingPayload;
    pendingPayload = null;
    if (next && active && store.auto) void runSync(next);
  }
}

/** Só para testes: zera o estado do módulo. */
export function __resetFdxSyncForTests(): void {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  clearPoll();
  storyId = null; boundAuth = null; store = emptyStore(); active = false; lastPayload = null;
  status = 'idle'; lastError = undefined; lastSyncAt = undefined; lastChangeAt = undefined; dirty = false;
  running = false; pendingPayload = null; progress = undefined; lastRun = undefined;
  resolving.clear();
  if (offChanged) { offChanged(); offChanged = null; }
  listeners.clear();
}
