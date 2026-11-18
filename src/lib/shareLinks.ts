// shareLinks — links compartilháveis de uma história: um PREVIEW somente
// leitura, que não toca a história original.
//
// Como funciona: todas as Lambdas checam que a história pertence a quem chama,
// então um link não pode apontar para o board do dono. Aqui o app do dono monta
// um RETRATO do que foi escolhido (board, roteiro ou os dois), a Lambda
// `backend/share-links` guarda o retrato sob um token aleatório, e a página do
// link (pages/app/shared-story) lê só o retrato. Editar a história depois não
// muda um link já criado; criar outro link gera um retrato novo.
//
// O retrato é um formato próprio e enxuto, não o grafo cru: leva só o que o
// preview mostra (título, resumo, elenco, local, texto do roteiro) e deixa de
// fora o que é ferramenta do roteirista (perguntas do Peer, tensões abertas,
// citações de evidência, notas).
import axios from 'axios';
import { safeApiCall } from '../models/apiHelpers';
import { isDesktop } from './ipcClient';
import { blocksFromScreenplayHtml } from './screenplayExport';
import {
  buildSharedScript as buildScript, buildShareSnapshot as buildSnapshot,
  type BoardLayoutInput, type ShareGraph, type ShareSceneText, type ShareScope, type SharedScript, type SharedSnapshot,
} from './shareSnapshot';

export type {
  BoardLayoutInput, ShareScope, SharedBlock, SharedBoard, SharedCanvas, SharedCanvasCard, SharedScene, SharedScript, SharedScriptScene, SharedSection, SharedSnapshot,
} from './shareSnapshot';
export { buildSharedBoard, isEmptySnapshot } from './shareSnapshot';

export const SHARE_SCOPES: Array<{ id: ShareScope; label: string; blurb: string }> = [
  { id: 'board', label: 'Board only', blurb: 'Your board as you arranged it, with the cast and locations.' },
  { id: 'both', label: 'Script and board', blurb: 'The board, plus the screenplay pages.' },
  { id: 'script', label: 'Script only', blurb: 'The screenplay pages, nothing else.' },
];
export const scopeLabel = (scope: ShareScope): string => SHARE_SCOPES.find((s) => s.id === scope)?.label ?? scope;

/** Retrato ou ao vivo. Retrato: a história como estava quando o link foi criado,
 *  guardada com o link. Ao vivo: nada é guardado; a cada abertura o serviço lê a
 *  história e monta o retrato na hora, com o mesmo filtro. */
export type ShareMode = 'snapshot' | 'live';
export const SHARE_MODES: Array<{ id: ShareMode; label: string; blurb: string }> = [
  { id: 'snapshot', label: 'Snapshot', blurb: 'The story as it is right now. Later changes need a new link.' },
  { id: 'live', label: 'Live', blurb: 'Always the current story. Readers see your changes as you make them, unfinished ones too.' },
];

export interface ShareLink { token: string; storyId: string; scope: ShareScope; title: string; createdAt: string; mode?: ShareMode }
/** O que a página do link recebe. Num link ao vivo, `asOf` é quando a história foi lida. */
export interface SharedStory { token: string; scope: ShareScope; title: string; createdAt: string; snapshot: SharedSnapshot; mode?: ShareMode; asOf?: string }

/** As páginas do roteiro, lidas pelo DOM (o app tem um): o caminho de sempre do editor. */
export function buildSharedScript(graph: ShareGraph, sceneTexts: ShareSceneText[]): SharedScript {
  return buildScript(graph, sceneTexts, blocksFromScreenplayHtml);
}

/** O retrato de um link: só o que o escopo pede. */
export function buildShareSnapshot(scope: ShareScope, graph: ShareGraph, sceneTexts: ShareSceneText[] = [], layout?: BoardLayoutInput): SharedSnapshot {
  return buildSnapshot(scope, graph, sceneTexts, layout, blocksFromScreenplayHtml);
}

// ---- Endereço do link -------------------------------------------------------
const DEFAULT_SHARE_BASE = 'https://filmassistant.io';
/** O link que o roteirista copia. Na web é a própria origem; no desktop (file://)
 *  é o site. `REACT_APP_SHARE_BASE_URL` sobrepõe os dois. */
export function shareUrl(token: string): string {
  const fromEnv = (process.env.REACT_APP_SHARE_BASE_URL || '').trim().replace(/\/+$/, '');
  let base = fromEnv;
  if (!base) {
    const origin = typeof window !== 'undefined' ? window.location?.origin ?? '' : '';
    base = !isDesktop() && /^https?:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin) ? origin : DEFAULT_SHARE_BASE;
  }
  return `${base}/share/${token}`;
}

// ---- API (backend/share-links) ----------------------------------------------
const bodyOf = (data: any): any => {
  const b = data?.body ?? data;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  return b ?? {};
};

async function ownerCall(payload: Record<string, unknown>, token: string): Promise<any> {
  const result = await safeApiCall('share', payload, token, { noRetry: true });
  if (!result.success) throw new Error(result.originalError?.response?.data?.error || result.error || 'The share service is not available.');
  return bodyOf(result.data);
}

/** Cria um link. Retrato: vai o `snapshot`. Ao vivo (`mode: 'live'`): não vai nada da
 *  história; o serviço confere que ela é de quem pede e passa a lê-la a cada abertura. */
export async function createShareLink(
  req: { storyId: string; scope: ShareScope; title: string; snapshot?: SharedSnapshot; mode?: ShareMode },
  token: string,
): Promise<ShareLink> {
  return (await ownerCall({ event: 'create', ...req }, token)) as ShareLink;
}

export async function listShareLinks(req: { storyId: string }, token: string): Promise<ShareLink[]> {
  const body = await ownerCall({ event: 'list', ...req }, token);
  return Array.isArray(body?.links) ? (body.links as ShareLink[]) : [];
}

export async function revokeShareLink(req: { token: string }, token: string): Promise<void> {
  await ownerCall({ event: 'revoke', ...req }, token);
}

export class SharedStoryError extends Error {
  constructor(public readonly kind: 'not-found' | 'sign-in' | 'failed', message: string) {
    super(message);
  }
}

/** Abre um link. `authToken` vai junto quando há sessão (links só para logados). */
export async function fetchSharedStory(shareToken: string, authToken?: string | null): Promise<SharedStory> {
  try {
    const res = await axios.post(
      `${process.env.REACT_APP_URL}/shared`,
      { event: 'get', token: shareToken },
      { headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: authToken } : {}) }, timeout: 30000 },
    );
    const body = bodyOf(res.data);
    if (!body?.snapshot) throw new SharedStoryError('not-found', 'This link is not available.');
    return body as SharedStory;
  } catch (err: any) {
    if (err instanceof SharedStoryError) throw err;
    const status = err?.response?.status;
    if (status === 404) throw new SharedStoryError('not-found', 'This link is not available.');
    if (status === 401 || status === 403) throw new SharedStoryError('sign-in', 'Sign in to open this link.');
    throw new SharedStoryError('failed', 'Could not open this link. Check your connection and try again.');
  }
}
