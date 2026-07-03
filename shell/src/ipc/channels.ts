// Contrato de canais IPC (compartilhado main <-> preload). Single source of truth.
// O preload (renderer-facing) e o bridge (main) referenciam estes nomes.

export const IPC = {
  // invoke (renderer -> main, com retorno)
  OPEN_EXTERNAL: 'shell:openExternal',
  DB_QUERY: 'db:query', // { sql, params, mode: 'run'|'all'|'get' } -> resultado
  DB_BATCH: 'db:batch', // { ops: {sql,params}[] } em uma transação -> void
  UPDATE_INSTALL: 'shell:updateInstall', // invoke: relaunch p/ instalar update (AD-09)

  // send (main -> renderer, push)
  DEEP_LINK: 'shell:deepLink', // payload: DeepLinkPayload
  OS_EVENT: 'shell:osEvent', // payload: { event: 'resumed' | 'before-quit' }
  UPDATE: 'shell:update', // payload: { type: 'available' | 'downloaded', version?: string }
  MENU: 'shell:menu', // payload: { event: string } — item do menu nativo acionado (SCR-0027)
} as const;

/** Eventos emitidos pelos itens do menu nativo (SCR-0027). */
export type MenuEvent =
  | 'story.new'
  | 'story.save'
  | 'commands.cmdk.open'
  | 'tour.open'
  | 'help.about.open'
  | 'updater.check';

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
