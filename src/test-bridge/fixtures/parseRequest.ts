// Parser puro da query string de fixtures (parity 19D). Sem efeitos colaterais.
import type { FixtureRequest } from './types';

/** Lê `?screen=…&fixture=…&segment=…` de uma search string. */
export function parseFixtureRequest(search: string): FixtureRequest {
  const params = new URLSearchParams(search || '');
  const norm = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    screen: norm(params.get('screen')),
    fixture: norm(params.get('fixture')),
    segment: norm(params.get('segment')),
  };
}

/** True se a URL pede alguma montagem de fixture (screen ou fixture presente). */
export function hasFixtureRequest(req: FixtureRequest): boolean {
  return req.screen !== null || req.fixture !== null;
}
