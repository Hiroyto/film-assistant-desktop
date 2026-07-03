// Contexto React que expõe a fixture montada (parity 19D). Componentes-donos de
// sub-views podem ler `useFixture()` para honrar `subview`/`hint` (ex.: abrir a aba
// characters, simular conflito aberto). null fora do modo teste / sem fixture.
import { createContext, useContext } from 'react';
import type { FixtureRequest } from './fixtures/types';

export interface FixtureState {
  request: FixtureRequest;
  /** Sub-view resolvida da tela (screenMap), ex.: 'characters'. */
  subview: string | null;
  /** Estado em memória da fixture (catalog hint), ex.: 'conflict-open'. */
  hint: string | null;
}

const FixtureContext = createContext<FixtureState | null>(null);

export const FixtureProvider = FixtureContext.Provider;

/** Lê a fixture corrente (null se não houver montagem de teste). */
export function useFixture(): FixtureState | null {
  return useContext(FixtureContext);
}
