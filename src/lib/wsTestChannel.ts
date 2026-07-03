// Canal de teste para personagens via WebSocket (parity spec 05). Permite que os
// hooks emitWsCharacters/emitWsRefresh injetem mensagens que percorrem o MESMO
// caminho do WS real (useWebSocket.setLastUpdate → useCharacterWsBridge merge →
// refresh.notifyWsResult), sem um socket vivo. INERTE até ser armado pelo seam:
// enquanto `armed` for false, subscribe/publish/record são no-ops (custo ~zero em
// produção). Nada aqui altera o caminho de produção do WebSocket.

type WsListener = (data: Record<string, unknown>) => void;

let armed = false;
const listeners = new Set<WsListener>();
let activeStoryId = '';
let lastRefreshRequestId: string | null = null;
let currentChars: Array<{ name: string }> = [];

/** Ativa o canal (chamado só em modo teste pelo seam). */
export function armCharacterWsChannel(): void {
  armed = true;
  listeners.clear();
  activeStoryId = '';
  lastRefreshRequestId = null;
  currentChars = [];
}

export function isCharacterWsChannelArmed(): boolean {
  return armed;
}

/** useWebSocket assina (só quando armado) para receber as injeções de teste. */
export function subscribeTestWs(fn: WsListener): () => void {
  if (!armed) return () => undefined;
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Publica uma mensagem `character-update` para todos os useWebSocket montados. */
export function publishTestWs(data: Record<string, unknown>): void {
  if (!armed) return;
  for (const l of [...listeners]) l(data);
}

/** O bridge informa qual story está ativa e qual o conjunto atual de personagens. */
export function syncBridgeState(storyId: string, chars: Array<{ name: string }>): void {
  if (!armed) return;
  activeStoryId = storyId;
  currentChars = chars.map((c) => ({ name: c.name }));
}

export function getActiveWsStory(): string {
  return activeStoryId;
}

export function getCurrentChars(): Array<{ name: string }> {
  return [...currentChars];
}

/** O refresh controller registra o requestId ativo (para emitWsRefresh() sem arg). */
export function recordActiveRefresh(requestId: string): void {
  if (!armed) return;
  lastRefreshRequestId = requestId;
}

export function getActiveRefresh(): string | null {
  return lastRefreshRequestId;
}
