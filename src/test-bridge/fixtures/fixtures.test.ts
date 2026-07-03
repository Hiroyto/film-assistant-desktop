// Testes do subsistema de roteamento de fixtures (parity 19D). Cobre o núcleo
// verificável (parser + completude screen/catalog vs. os specs + seed plan + apply
// com deps mockadas). A montagem real no App é exercida em runtime Electron.
import { parseFixtureRequest, hasFixtureRequest } from './parseRequest';
import { SCREEN_MAP, resolveScreen } from './screenMap';
import { FIXTURES, resolveFixtureSpec } from './catalog';
import { buildSeedPlan } from './seedPlan';
import { applySeedPlan, type SeedDeps } from './applySeed';

// Nomes que os parity specs (parity/specs/*.spec.ts) realmente referenciam.
const SPEC_SCREENS = [
  'action-preview', 'characters', 'confirm-code', 'error', 'forgot', 'foundation',
  'home', 'login', 'outline', 'pricing', 'profile', 'scenes', 'scenes-canvas',
  'scripts', 'segment', 'segment-canvas', 'signup', 'summary', 'terms', 'tour', 'privacy',
];
const SPEC_FIXTURES = [
  '20-pending-offline', '3-pending', '90-pages', 'active-story', 'ai-unresponsive',
  'alice-locked-bob', 'cap-100', 'conflict-open', 'conflict-resolved-keep-mine',
  'conflict-v6-local-v7-remote', 'dirty-scene', 'dirty-segment', 'five-stories', 'free',
  'generating', 'handoff-in-flight', 'local-vs-s3', 'member', 'model-claude', 'offline-dirty',
  'offline-edit-s5', 'retry-same-request', 'two-scenes', 'webhook-arrived-no-deeplink',
  'ws-exhausted', 'ws-updating',
];

describe('parseFixtureRequest', () => {
  it('decodifica screen/fixture/segment', () => {
    expect(parseFixtureRequest('?screen=characters&fixture=alice-locked-bob&segment=S5')).toEqual({
      screen: 'characters',
      fixture: 'alice-locked-bob',
      segment: 'S5',
    });
  });
  it('campos ausentes viram null e hasFixtureRequest reflete', () => {
    const empty = parseFixtureRequest('');
    expect(empty).toEqual({ screen: null, fixture: null, segment: null });
    expect(hasFixtureRequest(empty)).toBe(false);
    expect(hasFixtureRequest(parseFixtureRequest('?fixture=member'))).toBe(true);
  });
});

describe('completude do contrato (screens/fixtures dos specs)', () => {
  it('toda tela referenciada nos specs existe no SCREEN_MAP', () => {
    const missing = SPEC_SCREENS.filter((s) => !SCREEN_MAP[s]);
    expect(missing).toEqual([]);
  });
  it('toda fixture referenciada nos specs existe no catálogo', () => {
    const missing = SPEC_FIXTURES.filter((f) => !FIXTURES[f]);
    expect(missing).toEqual([]);
  });
  it('resolveScreen mapeia rota e default conservador', () => {
    expect(resolveScreen('pricing').route).toBe('/prices');
    expect(resolveScreen('characters')).toEqual({ route: '/home', requiresAuth: true, subview: 'characters' });
    expect(resolveScreen('desconhecida')).toEqual({ route: '/home', requiresAuth: true });
  });
});

describe('buildSeedPlan', () => {
  it('alice-locked-bob: 1 story ativa + 2 personagens, Alice locked', () => {
    const plan = buildSeedPlan(resolveFixtureSpec('alice-locked-bob'));
    expect(plan.stories).toHaveLength(1);
    expect(plan.activeStoryId).toBe('story-active');
    expect(plan.characters.map((c) => c.name).sort()).toEqual(['Alice', 'Bob']);
    expect(plan.characters.find((c) => c.name === 'Alice')?.locked).toBe(1);
  });
  it('3-pending: queueDepth 3, sem stories', () => {
    const plan = buildSeedPlan(resolveFixtureSpec('3-pending'));
    expect(plan.queueDepth).toBe(3);
    expect(plan.stories).toHaveLength(0);
  });
  it('member: patch de usuário com subscription', () => {
    expect(buildSeedPlan(resolveFixtureSpec('member')).user).toEqual({ subscription: 'member', cap: 250 });
  });
  it('fixture nula → plano vazio', () => {
    expect(buildSeedPlan(null)).toEqual({
      user: {}, stories: [], characters: [], queueDepth: 0, activeStoryId: null, hint: null,
    });
  });
});

describe('applySeedPlan (deps mockadas)', () => {
  it('escreve stories/characters e enfileira queueDepth mutations', async () => {
    const calls = { users: 0, stories: 0, characters: 0, snapshots: 0, enqueue: 0 };
    const deps: SeedDeps = {
      upsertUser: async () => { calls.users++; },
      upsertStory: async () => { calls.stories++; },
      upsertCharacter: async () => { calls.characters++; },
      createSnapshot: async () => { calls.snapshots++; },
      enqueue: async () => { calls.enqueue++; },
    };
    const plan = buildSeedPlan(resolveFixtureSpec('alice-locked-bob'));
    await applySeedPlan({ ...plan, queueDepth: 2 }, deps);
    // 1 user (dono das stories, FK), 1 story, 2 chars, 0 snapshots, 2 enqueues
    expect(calls).toEqual({ users: 1, stories: 1, characters: 2, snapshots: 0, enqueue: 2 });
  });
});
