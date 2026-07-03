// Testes dos modelos canônicos de domínio (VOs + invariantes). Roda via `craco test`.
// Cobre as BR-MIGRAR mapeadas em target_domain_model.md §Regras de domínio.

import {
  STORY_ID_REGEX,
  isValidStoryId,
  generateStoryId,
  canBuildStory,
  canCreateStory,
  STORIES_LIMIT,
  actOfBeat,
  segmentKeyOfBeat,
  emptySegments,
  SEGMENT_KEYS,
} from './story';
import { SCENE_ID_REGEX, isValidSceneId, generateSceneId, createScene } from './scene';
import {
  isValidCharacterName,
  normalizeImportance,
  normalizeGrowth,
  toCanonicalCharacterArray,
  mergeCharactersWithLocks,
  Character,
} from './character';
import {
  isMember,
  normalizeCap,
  capDelta,
  isValidConfirmationCode,
  STORY_LIMIT,
} from './user';
import {
  REFILL_PRICE,
  MEMBER_PRICE,
  BASE_PRICE,
  canPurchaseRefill,
  isCurrentPlan,
  products,
} from './products';

describe('StoryId (BR-MIGRAR-011)', () => {
  it('gera no formato story_<unix-ms>_<rand6>', () => {
    const id = generateStoryId(1717000000000);
    expect(id).toMatch(STORY_ID_REGEX);
    expect(id.startsWith('story_1717000000000_')).toBe(true);
  });
  it('valida/rejeita', () => {
    expect(isValidStoryId('story_1717000000000_ab12cd')).toBe(true);
    expect(isValidStoryId('story_x_ab')).toBe(false);
  });
});

describe('SceneId (BR-MIGRAR-052)', () => {
  it('gera no formato scene_<base36-ts>_<rand6>', () => {
    expect(generateSceneId(1717000000000)).toMatch(SCENE_ID_REGEX);
  });
  it('createScene preserva ID válido e gera quando inválido', () => {
    expect(createScene({ sceneId: 'scene_abc_def123' }).sceneId).toBe('scene_abc_def123');
    expect(createScene({ sceneId: 'bad' }).sceneId).toMatch(SCENE_ID_REGEX);
    expect(createScene().title).toBe('');
  });
});

describe('Story invariantes', () => {
  it('canBuildStory exige 50 chars (BR-MIGRAR-010)', () => {
    expect(canBuildStory('a'.repeat(49))).toBe(false);
    expect(canBuildStory('a'.repeat(50))).toBe(true);
  });
  it('canCreateStory respeita STORIES_LIMIT=5 (BR-MIGRAR-009)', () => {
    expect(STORIES_LIMIT).toBe(5);
    expect(canCreateStory(4)).toBe(true);
    expect(canCreateStory(5)).toBe(false);
  });
  it('mapeamento de atos S1-3=I, S4-6=II, S7-9=III (BR-MIGRAR-012)', () => {
    expect(actOfBeat(1)).toBe(1);
    expect(actOfBeat(4)).toBe(2);
    expect(actOfBeat(9)).toBe(3);
    expect(segmentKeyOfBeat(5)).toBe('S5');
  });
  it('emptySegments cria as 9 chaves vazias', () => {
    const segs = emptySegments();
    expect(Object.keys(segs)).toEqual(SEGMENT_KEYS);
    expect(segs.S1).toEqual({ S: '', scenes: [] });
  });
});

describe('Character (BR-MIGRAR-018/024/025)', () => {
  it('name válido/ inválido', () => {
    expect(isValidCharacterName('Hero')).toBe(true);
    expect(isValidCharacterName('  ')).toBe(false);
    expect(isValidCharacterName('x'.repeat(101))).toBe(false);
  });
  it('defaults importance=minor, growth=static', () => {
    expect(normalizeImportance('bogus')).toBe('minor');
    expect(normalizeGrowth(undefined)).toBe('static');
    expect(normalizeImportance('major')).toBe('major');
  });
  it('canonical array aceita map e array, descarta sem name', () => {
    const fromArray = toCanonicalCharacterArray([{ name: 'A' }, { description: 'no-name' }]);
    const fromMap = toCanonicalCharacterArray({ A: { name: 'A' } });
    expect(fromArray).toHaveLength(1);
    expect(fromMap).toHaveLength(1);
    expect(fromArray[0].importance).toBe('minor');
  });
});

describe('mergeCharactersWithLocks (BR-MIGRAR-021)', () => {
  const mk = (name: string, locked: boolean, desc: string): Character => ({
    name,
    description: desc,
    importance: 'minor',
    locked,
    is_new: false,
    user_touched: false,
    arc: { growth: 'static' },
  });
  it('locked local é imune a sobrescrita do batch', () => {
    const current = [mk('Hero', true, 'local')];
    const incoming = [mk('Hero', false, 'remote')];
    const merged = mergeCharactersWithLocks(current, incoming);
    expect(merged.find((c) => c.name === 'Hero')?.description).toBe('local');
  });
  it('locked local sobrevive mesmo se o batch o omite', () => {
    const current = [mk('Hero', true, 'local')];
    const incoming = [mk('Villain', false, 'new')];
    const merged = mergeCharactersWithLocks(current, incoming);
    expect(merged.map((c) => c.name).sort()).toEqual(['Hero', 'Villain']);
  });
  it('unlocked é sobrescrito pelo batch', () => {
    const current = [mk('Hero', false, 'local')];
    const incoming = [mk('Hero', false, 'remote')];
    expect(mergeCharactersWithLocks(current, incoming)[0].description).toBe('remote');
  });
});

describe('User / Subscription gating (BR-MIGRAR-031/027/028)', () => {
  it('isMember só para "member"', () => {
    expect(isMember('member')).toBe(true);
    expect(isMember('base')).toBe(false);
    expect(isMember(null)).toBe(false);
  });
  it('STORY_LIMIT=5 (DEC-009)', () => expect(STORY_LIMIT).toBe(5));
  it('refill é member-gated', () => {
    expect(canPurchaseRefill('member')).toBe(true);
    expect(canPurchaseRefill('base')).toBe(false);
  });
  it('Current Plan só no card member quando já member', () => {
    expect(isCurrentPlan('member', 'member')).toBe(true);
    expect(isCurrentPlan('member', null)).toBe(false);
    expect(isCurrentPlan('base', 'member')).toBe(false);
  });
  it('normalizeCap e capDelta (BR-MIGRAR-044/030)', () => {
    expect(normalizeCap(-5)).toBe(0);
    expect(normalizeCap('10')).toBe(10);
    expect(capDelta(100, 90)).toEqual({ oldCap: 100, newCap: 90, delta: -10 });
  });
  it('confirmation code 6 dígitos (BR-MIGRAR-004)', () => {
    expect(isValidConfirmationCode('123456')).toBe(true);
    expect(isValidConfirmationCode('12345')).toBe(false);
    expect(isValidConfirmationCode('abcdef')).toBe(false);
  });
});

describe('Produtos (BR-MIGRAR-026 / DEC-011)', () => {
  it('preços canônicos $8 / $12 / $4.50', () => {
    expect(MEMBER_PRICE).toBe('8.00');
    expect(BASE_PRICE).toBe('12.00');
    expect(REFILL_PRICE).toBe('4.50');
  });
  it('o catálogo bate com os preços canônicos (sem drift $5.00)', () => {
    expect(products.find((p) => p.title === 'Member')?.price).toBe(MEMBER_PRICE);
    expect(products.find((p) => p.title === 'Member Token Refill')?.price).toBe(REFILL_PRICE);
  });
});
