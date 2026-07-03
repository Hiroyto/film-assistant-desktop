// Seam de teste de personagens via WebSocket (parity spec 05 — AD-05 / COD-007 /
// BR-MIGRAR-018..025,045,046). Expõe os hooks que o spec chama via window.__TEST__:
//   • emitWsCharacters(names) — injeta um batch WS com esses nomes (is_new) → o
//     bridge real faz o merge respeitando locks (BR-021).
//   • emitWsRefresh(reqId?)   — injeta um push de refresh; sem arg casa o requestId
//     ativo do refresh controller (→ 'completed'); com id stale é ignorado (AD-05).
//   • characterCount()        — conta atual de personagens no bridge montado.
// As mensagens percorrem o caminho real (useWebSocket → bridge → notifyWsResult).
// INERTE fora do modo teste: armCharacterWsTestSeam() faz early-return.
import { registerTestHook, isTestMode } from '../test-bridge/registry';
import {
  armCharacterWsChannel,
  publishTestWs,
  getActiveWsStory,
  getCurrentChars,
  getActiveRefresh,
} from './wsTestChannel';

export function armCharacterWsTestSeam(): void {
  if (!isTestMode()) return;
  armCharacterWsChannel();

  registerTestHook('emitWsCharacters', (names: string[]) => {
    publishTestWs({
      storyId: getActiveWsStory(),
      characters: (names ?? []).map((name) => ({ name, is_new: true })),
      analysisComplete: true,
    });
  });

  registerTestHook('emitWsRefresh', (requestId?: string) => {
    publishTestWs({
      storyId: getActiveWsStory(),
      // Sem nomes explícitos: reenvia o conjunto atual (merge estável; só resolve o
      // refresh pendente quando o requestId casa). Um id stale é ignorado pelo controller.
      characters: getCurrentChars(),
      requestId: requestId ?? getActiveRefresh() ?? '',
      analysisComplete: true,
    });
  });

  registerTestHook('characterCount', () => getCurrentChars().length);
}
