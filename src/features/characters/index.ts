// BC-05 Characters — API pública. UI legada (components/characters-home) preservada.
// O hook WS compartilhado vive em lib/ (shared) — COD-007.
export * from './model/characterCommands';
export * from './model/refresh';
export { useCharacterWsBridge } from '../../lib/useCharacterWsBridge';
export type { CharacterWsBridge, UseCharacterWsBridgeOptions } from '../../lib/useCharacterWsBridge';
