// Boot driver do roteamento de fixtures (parity 19D). Lê a query string, semeia o
// banco local + usuário e navega para a rota da tela. Chamado uma vez no mount do
// App em modo teste. Sem efeito quando a URL não pede fixture.
import type { User } from '../../models/user';
import type { FixtureState } from '../fixtureContext';
import { parseFixtureRequest, hasFixtureRequest } from './parseRequest';
import { resolveScreen } from './screenMap';
import { resolveFixtureSpec } from './catalog';
import { buildSeedPlan } from './seedPlan';
import { applySeedPlan } from './applySeed';
import { emit as emitSyncEvent } from '../../data/sync-agent/events';

export interface FixtureBootDeps {
  /** window.location.search no momento do boot. */
  search: string;
  navigate: (path: string) => void;
  applyUser: (patch: Partial<User>) => void;
}

/** Executa o boot. Retorna o estado para o FixtureProvider, ou null se sem fixture. */
export async function runFixtureBoot(deps: FixtureBootDeps): Promise<FixtureState | null> {
  const request = parseFixtureRequest(deps.search);
  if (!hasFixtureRequest(request)) return null;

  const screenSpec = resolveScreen(request.screen);
  const fixtureSpec = resolveFixtureSpec(request.fixture);
  const plan = buildSeedPlan(fixtureSpec);

  try {
    await applySeedPlan(plan);
  } catch (e) {
    console.error('[fixtureBoot] falha ao semear o banco local', e);
  }

  // Reflete a fila semeada na sync-status-bar (SCR-0028): mutations pendentes = 'syncing N'
  // (offline se a fixture assim indicar). Sem fila pendente, mantém o default 'online'.
  if (plan.queueDepth > 0) {
    emitSyncEvent('sync.queue.depth', { n: plan.queueDepth });
    emitSyncEvent('sync.state', { state: plan.hint === 'offline' ? 'offline' : 'syncing' });
  }

  if (Object.keys(plan.user).length > 0) deps.applyUser(plan.user);
  deps.navigate(screenSpec.route);

  return { request, subview: screenSpec.subview ?? null, hint: plan.hint };
}
