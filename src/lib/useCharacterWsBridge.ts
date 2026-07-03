// useCharacterWsBridge (COD-007 / tech-debt #8 / BR-MIGRAR-045). Hook ÚNICO que
// consolida a lógica de merge de characters via WebSocket que o legado reimplementava
// em 3 sites (home, scenes, scripts). Aplica:
//   • dedupe por content-hash `${storyId}_${count}_${sorted names}`, reset em storyId change.
//   • merge respeitando locks (BR-MIGRAR-021 — mergeCharactersWithLocks).
//   • supressão de toasts locais enquanto o WS atualiza (BR-MIGRAR-023).
//   • encaminha o requestId ao controller de refresh (AD-05).
import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { Character, toCanonicalCharacterArray, mergeCharactersWithLocks } from '../models/character';
import { isCharacterWsChannelArmed, syncBridgeState } from './wsTestChannel';

export interface UseCharacterWsBridgeOptions {
  /** Recebe (requestId, characters) quando chega um push — wira no refresh controller. */
  onRefreshResult?: (requestId: string, characters: Character[]) => void;
  /** Característica inicial (ex: do SQLite local). */
  initial?: Character[];
}

export interface CharacterWsBridge {
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
  /** True durante a aplicação de um batch WS — UI suprime toasts locais (BR-023). */
  isWebSocketUpdating: React.MutableRefObject<boolean>;
}

export function useCharacterWsBridge(
  userId: string,
  storyId: string,
  opts: UseCharacterWsBridgeOptions = {},
): CharacterWsBridge {
  const { lastUpdate, isConnected, error, reconnect } = useWebSocket(userId, storyId);
  const [characters, setCharacters] = useState<Character[]>(opts.initial ?? []);
  const dedupeKeyRef = useRef<string | null>(null);
  const isWebSocketUpdating = useRef(false);

  // Reset do dedupe ao trocar de story (BR-MIGRAR-045).
  useEffect(() => {
    dedupeKeyRef.current = null;
  }, [storyId]);

  useEffect(() => {
    if (!lastUpdate || lastUpdate.storyId !== storyId) return;

    const incoming = toCanonicalCharacterArray(lastUpdate.characters);
    const key = `${storyId}_${incoming.length}_${incoming.map((c) => c.name).sort().join(',')}`;
    if (key === dedupeKeyRef.current) return; // duplicate batch — ignora
    dedupeKeyRef.current = key;

    isWebSocketUpdating.current = true; // suprime toasts locais (BR-MIGRAR-023)
    setCharacters((prev) => mergeCharactersWithLocks(prev, incoming)); // locks imunes (BR-MIGRAR-021)
    if (lastUpdate.requestId && opts.onRefreshResult) {
      opts.onRefreshResult(lastUpdate.requestId, incoming);
    }
    isWebSocketUpdating.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdate, storyId]);

  // Parity test (spec 05): expõe a story ativa e o conjunto atual ao canal de teste,
  // para que emitWsCharacters/emitWsRefresh/characterCount operem sobre o bridge real.
  // Inerte em produção (canal não armado).
  useEffect(() => {
    if (!isCharacterWsChannelArmed()) return;
    syncBridgeState(storyId, characters);
  }, [storyId, characters]);

  return { characters, setCharacters, isConnected, error, reconnect, isWebSocketUpdating };
}
