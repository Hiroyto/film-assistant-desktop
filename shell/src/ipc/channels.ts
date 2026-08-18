// Contrato de canais IPC (compartilhado main <-> preload). Single source of truth.
// O preload (renderer-facing) e o bridge (main) referenciam estes nomes.

export const IPC = {
  // invoke (renderer -> main, com retorno)
  OPEN_EXTERNAL: 'shell:openExternal',
  DB_QUERY: 'db:query', // { sql, params, mode: 'run'|'all'|'get' } -> resultado
  DB_BATCH: 'db:batch', // { ops: {sql,params}[] } em uma transação -> void
  UPDATE_INSTALL: 'shell:updateInstall', // invoke: relaunch p/ instalar update (AD-09)
  FDX_OPEN: 'fdx:open', // invoke: dialog + inicia watch de um .fdx -> FdxPayload | null
  FDX_CLOSE: 'fdx:close', // invoke: para o watch atual -> void

  // send (main -> renderer, push)
  DEEP_LINK: 'shell:deepLink', // payload: DeepLinkPayload
  OS_EVENT: 'shell:osEvent', // payload: { event: 'resumed' | 'before-quit' }
  UPDATE: 'shell:update', // payload: { type: 'available' | 'downloaded', version?: string }
  MENU: 'shell:menu', // payload: { event: string } — item do menu nativo acionado (SCR-0027)
  FDX_CHANGED: 'fdx:changed', // payload: FdxPayload — o .fdx observado mudou no disco
} as const;

/** Uma cena extraída do .fdx (heading + corpo até a próxima cena). */
export interface FdxScene {
  index: number;
  number: string; // nº da cena (SceneProperties/Paragraph Number, ou sequencial)
  heading: string;
  snippet: string; // primeira linha de ação/diálogo (preview do card)
  lineCount: number; // parágrafos no corpo da cena
}

/** Snapshot parseado de um arquivo .fdx observado. */
export interface FdxPayload {
  path: string;
  fileName: string;
  ok: boolean; // parse bem-sucedido (false = mid-write / não é fdx / erro)
  title?: string;
  sceneCount: number;
  paragraphCount: number;
  scenes: FdxScene[];
  updatedAt: string; // ISO do momento da leitura
  error?: string;
}

/** Eventos emitidos pelos itens do menu nativo (SCR-0027). */
export type MenuEvent =
  | 'story.new'
  | 'story.save'
  | 'commands.cmdk.open'
  | 'tour.open'
  | 'help.about.open'
  | 'updater.check'
  | 'fdx.open';

export interface DeepLinkPayload {
  scheme: string;
  host: string;
  path: string;
  query: Record<string, string>;
}

export type OsEvent = 'resumed' | 'before-quit' | 'online' | 'offline';
export type UpdatePayload = { type: 'available' | 'downloaded'; version?: string };

/** Scheme do protocolo de deep link registrado no OS. */
export const DEEP_LINK_SCHEME = 'filmassistant';

/** Parse de uma URL filmassistant://host/path?query em DeepLinkPayload. */
export function parseDeepLink(url: string): DeepLinkPayload | null {
  try {
    const u = new URL(url);
    const scheme = u.protocol.replace(/:$/, '');
    if (scheme !== DEEP_LINK_SCHEME) return null;
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    return { scheme, host: u.hostname, path: u.pathname, query };
  } catch {
    return null;
  }
}
