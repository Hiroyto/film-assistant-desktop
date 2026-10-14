// Testes da sessão local da story ativa (contas diferentes no mesmo PC). `craco test`.
import {
  ACTIVE_STORY_KEY,
  clearLocalStorySession,
  isForeignStoryRow,
  reconcileActiveStoryOwner,
  type StorageLike,
} from './localStorySession';

/** Storage em memória com a mesma semântica de índices do localStorage. */
function fakeStorage(entries: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

const ANA = 'ana-uuid';
const BIA = 'bia-uuid';

describe('clearLocalStorySession (signout)', () => {
  it('remove o id ativo e todos os caches story_*, e deixa o resto', () => {
    const s = fakeStorage({
      [ACTIVE_STORY_KEY]: 'story_1',
      story_story_1: '{"title":"A"}',
      story_story_2: '{"title":"B"}',
      'ff-theme': 'light',
      'ff-story-workflows': '{"story_1":"freeform"}',
    });
    expect(clearLocalStorySession(s)).toBe(3);
    expect(s.dump()).toEqual({ 'ff-theme': 'light', 'ff-story-workflows': '{"story_1":"freeform"}' });
  });

  it('sem nada para limpar devolve 0; storage ausente é no-op', () => {
    expect(clearLocalStorySession(fakeStorage({ 'ff-theme': 'dark' }))).toBe(0);
    expect(clearLocalStorySession(null)).toBe(0);
  });

  it('storage que lança não derruba o signout', () => {
    const broken: StorageLike = {
      length: 1,
      key: () => { throw new Error('denied'); },
      getItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => clearLocalStorySession(broken)).not.toThrow();
  });

  it('usa o localStorage real por padrão (jsdom)', () => {
    localStorage.setItem(ACTIVE_STORY_KEY, 'story_9');
    localStorage.setItem('story_story_9', '{}');
    localStorage.setItem('ff-theme', 'dark');
    expect(clearLocalStorySession()).toBe(2);
    expect(localStorage.getItem(ACTIVE_STORY_KEY)).toBe(null);
    expect(localStorage.getItem('story_story_9')).toBe(null);
    expect(localStorage.getItem('ff-theme')).toBe('dark');
    localStorage.clear();
  });
});

describe('isForeignStoryRow', () => {
  it('só é "de outro" quando há linha com dono gravado e diferente', () => {
    expect(isForeignStoryRow({ story_id: 's', user_id: BIA }, ANA)).toBe(true);
    expect(isForeignStoryRow({ story_id: 's', user_id: ANA }, ANA)).toBe(false);
    expect(isForeignStoryRow({ story_id: 's', user_id: ` ${ANA} ` }, ANA)).toBe(false);
    expect(isForeignStoryRow({ story_id: 's', user_id: '' }, ANA)).toBe(false);
    expect(isForeignStoryRow({ story_id: 's', user_id: null }, ANA)).toBe(false);
    expect(isForeignStoryRow({ story_id: 's', user_id: undefined }, ANA)).toBe(false);
    expect(isForeignStoryRow(null, ANA)).toBe(false);
    expect(isForeignStoryRow(undefined, ANA)).toBe(false);
  });
});

describe('reconcileActiveStoryOwner (login de outra conta no mesmo PC)', () => {
  it('story da conta anterior: reset, esquece o id ativo e o cache DELA, mantém os outros', () => {
    const s = fakeStorage({ [ACTIVE_STORY_KEY]: 'story_1', story_story_1: '{"title":"A"}', story_story_2: '{"title":"mine"}' });
    expect(reconcileActiveStoryOwner({ story_id: 'story_1', user_id: ANA }, BIA, s)).toBe('reset');
    expect(s.dump()).toEqual({ story_story_2: '{"title":"mine"}' });
  });

  it('id ativo apontando para OUTRA story não é tocado no reset', () => {
    const s = fakeStorage({ [ACTIVE_STORY_KEY]: 'story_2', story_story_1: '{}' });
    expect(reconcileActiveStoryOwner({ story_id: 'story_1', user_id: ANA }, BIA, s)).toBe('reset');
    expect(s.dump()).toEqual({ [ACTIVE_STORY_KEY]: 'story_2' });
  });

  it('story do próprio usuário: keep, nada removido', () => {
    const s = fakeStorage({ [ACTIVE_STORY_KEY]: 'story_1', story_story_1: '{}' });
    expect(reconcileActiveStoryOwner({ story_id: 'story_1', user_id: ANA }, ANA, s)).toBe('keep');
    expect(s.dump()).toEqual({ [ACTIVE_STORY_KEY]: 'story_1', story_story_1: '{}' });
  });

  it('sem linha no SQLite (story nova, ainda não salva) ou sem dono gravado: keep', () => {
    const s = fakeStorage({ [ACTIVE_STORY_KEY]: 'story_1' });
    expect(reconcileActiveStoryOwner(null, ANA, s)).toBe('keep');
    expect(reconcileActiveStoryOwner({ story_id: 'story_1', user_id: '' }, ANA, s)).toBe('keep');
    expect(s.dump()).toEqual({ [ACTIVE_STORY_KEY]: 'story_1' });
  });

  it('storage ausente ou quebrado: ainda devolve reset (o estado em memória é o que importa)', () => {
    expect(reconcileActiveStoryOwner({ story_id: 's', user_id: ANA }, BIA, null)).toBe('reset');
    const broken: StorageLike = {
      length: 0,
      key: () => null,
      getItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(reconcileActiveStoryOwner({ story_id: 's', user_id: ANA }, BIA, broken)).toBe('reset');
  });
});
