// Testes das transformações de dados (T-01..T-08) e da reconciliação de versão.
// Roda via `craco test` (jest do CRA) após `npm install`. Cobre os casos do
// data_migration_plan.md §Transformações e §Validação de qualidade.

import {
  normalizeTimestamp,
  normalizeScene,
  normalizeSegmentValue,
  normalizeSegmentsJson,
  normalizeCharacters,
  deriveMfaConfigured,
  mapStoryToRow,
} from './transforms';
import { decidePullAction, isPullConflict } from './version-reconcile';
import { backoffMs, nextAttemptAt, shouldGiveUp, MAX_ATTEMPTS } from './idempotency';

const NOW = '2026-05-29T12:00:00.000Z';

describe('T-08 normalizeTimestamp', () => {
  it('mantém ISO-8601', () => {
    expect(normalizeTimestamp('2026-01-02T03:04:05.000Z', NOW)).toBe('2026-01-02T03:04:05.000Z');
  });
  it('converte Unix ms (number e string)', () => {
    expect(normalizeTimestamp(0, NOW)).toBe('1970-01-01T00:00:00.000Z');
    expect(normalizeTimestamp('0', NOW)).toBe('1970-01-01T00:00:00.000Z');
  });
  it('usa now em ausente/inválido', () => {
    expect(normalizeTimestamp(null, NOW)).toBe(NOW);
    expect(normalizeTimestamp('not-a-date', NOW)).toBe(NOW);
  });
});

describe('T-01 normalizeSegmentValue', () => {
  it('string vira { S, scenes:[] }', () => {
    expect(normalizeSegmentValue('outline')).toEqual({ S: 'outline', scenes: [] });
  });
  it('null vira default', () => {
    expect(normalizeSegmentValue(null)).toEqual({ S: '', scenes: [] });
  });
  it('objeto polimórfico é preservado e scenes normalizadas', () => {
    const r = normalizeSegmentValue({ S: 'x', scenes: [{ sceneId: 's1', title: 'T', content: 'C' }] });
    expect(r.S).toBe('x');
    expect(r.scenes[0]).toMatchObject({ sceneId: 's1', title: 'T', content: 'C' });
  });
});

describe('T-01 normalizeSegmentsJson', () => {
  it('sempre retorna S1..S9', () => {
    const json = JSON.parse(normalizeSegmentsJson({ S1: 'a' }));
    expect(Object.keys(json)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
    expect(json.S1).toEqual({ S: 'a', scenes: [] });
    expect(json.S9).toEqual({ S: '', scenes: [] });
  });
});

describe('T-03 normalizeScene', () => {
  it('mantém ID original', () => {
    expect(normalizeScene({ sceneId: 'scene_abc', title: 'A', content: 'B' }).sceneId).toBe('scene_abc');
  });
  it('gera ID quando ausente', () => {
    expect(normalizeScene({ title: 'A' }).sceneId).toMatch(/^scene_/);
  });
  it('title vazio é válido', () => {
    expect(normalizeScene({ sceneId: 'x' }).title).toBe('');
  });
});

describe('T-02 normalizeCharacters', () => {
  it('aceita array e map', () => {
    const arr = normalizeCharacters([{ name: 'A' }], 'story_1', NOW);
    const map = normalizeCharacters({ A: { name: 'A' } }, 'story_1', NOW);
    expect(arr.rows).toHaveLength(1);
    expect(map.rows).toHaveLength(1);
  });
  it('descarta character sem name (com contagem)', () => {
    const r = normalizeCharacters([{ description: 'no name' }, { name: 'Ok' }], 'story_1', NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
  it('aplica defaults importance=minor, arc_growth=static', () => {
    const r = normalizeCharacters([{ name: 'A', importance: 'bogus' }], 'story_1', NOW);
    expect(r.rows[0].importance).toBe('minor');
    expect(r.rows[0].arc_growth).toBe('static');
  });
  it('booleans viram 0|1', () => {
    const r = normalizeCharacters([{ name: 'A', locked: true, isNew: 1 }], 'story_1', NOW);
    expect(r.rows[0].locked).toBe(1);
    expect(r.rows[0].is_new).toBe(1);
    expect(r.rows[0].user_touched).toBe(0);
  });
});

describe('T-04 deriveMfaConfigured (DEC-007 dormente)', () => {
  it('OFF sem config', () => expect(deriveMfaConfigured(null, true)).toBe('OFF'));
  it('OFF se OPTIONAL mas sem TOTP', () => expect(deriveMfaConfigured('OPTIONAL', false)).toBe('OFF'));
  it('OPTIONAL se OPTIONAL e TOTP enrolled', () =>
    expect(deriveMfaConfigured('OPTIONAL', true)).toBe('OPTIONAL'));
});

describe('mapStoryToRow', () => {
  it('aceita storyId/story_id/id e campos legados S/G/T', () => {
    const row = mapStoryToRow(
      { story_id: 'story_1', G: 'Drama', SUM: 'sin', S1: 'beat1' },
      { userId: 'u1', now: NOW },
    );
    expect(row.story_id).toBe('story_1');
    expect(row.genre).toBe('Drama');
    expect(row.synopsis).toBe('sin');
    expect(JSON.parse(row.segments_json).S1).toEqual({ S: 'beat1', scenes: [] });
  });
  it('lança se faltar storyId', () => {
    expect(() => mapStoryToRow({ title: 'x' }, { userId: 'u1', now: NOW })).toThrow();
  });
});

describe('version-reconcile (ongoing pull)', () => {
  const base = { version: 2, updated_at: NOW, synced_at: NOW };
  it('entidade nova -> apply_remote', () => {
    expect(decidePullAction(null, base)).toBe('apply_remote');
  });
  it('remoto mais novo -> apply_remote', () => {
    expect(decidePullAction({ ...base, version: 1 }, base)).toBe('apply_remote');
  });
  it('local à frente -> ignore_local_pending', () => {
    expect(decidePullAction({ ...base, version: 3 }, base)).toBe('ignore_local_pending');
  });
  it('iguais sem divergência -> skip', () => {
    expect(decidePullAction(base, base, false)).toBe('skip');
  });
  it('conflito multi-device: edição local pendente + remoto avançou', () => {
    const local = { version: 1, updated_at: '2026-05-29T13:00:00Z', synced_at: '2026-05-29T11:00:00Z' };
    expect(isPullConflict(local, { ...base, version: 2 })).toBe(true);
  });
});

describe('idempotency backoff', () => {
  it('sequência 1,2,4,8,16,30s', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });
  it('cap em 30s para tentativas além do array', () => {
    expect(backoffMs(99)).toBe(30000);
  });
  it('desiste após MAX_ATTEMPTS', () => {
    expect(shouldGiveUp(MAX_ATTEMPTS)).toBe(true);
    expect(shouldGiveUp(MAX_ATTEMPTS - 1)).toBe(false);
  });
  it('nextAttemptAt soma o backoff', () => {
    expect(nextAttemptAt(0, Date.parse(NOW))).toBe('2026-05-29T12:00:01.000Z');
  });
});
