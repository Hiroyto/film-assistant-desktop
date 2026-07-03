// Testes da resolução de conflitos (AD-02). `craco test`.
import {
  isLargeDivergence,
  lastWriteWins,
  decideConflict,
  LARGE_DIVERGENCE_GAP_MS,
} from './conflict-resolution';

const T0 = '2026-05-29T12:00:00.000Z';
const T0_PLUS_2H = '2026-05-29T14:00:00.000Z';
const T0_PLUS_1MIN = '2026-05-29T12:01:00.000Z';

describe('isLargeDivergence (AD-02)', () => {
  it('gap > 1h => grande', () => {
    expect(isLargeDivergence(T0, T0_PLUS_2H, 'a', 'a')).toBe(true);
  });
  it('diff de conteúdo > 500 chars => grande', () => {
    expect(isLargeDivergence(T0, T0_PLUS_1MIN, 'a', 'a'.repeat(600))).toBe(true);
  });
  it('gap pequeno + conteúdo similar => não grande', () => {
    expect(isLargeDivergence(T0, T0_PLUS_1MIN, 'abc', 'abd')).toBe(false);
  });
  it('limite de gap respeita LARGE_DIVERGENCE_GAP_MS', () => {
    const justUnder = new Date(Date.parse(T0) + LARGE_DIVERGENCE_GAP_MS - 1000).toISOString();
    expect(isLargeDivergence(T0, justUnder, 'a', 'a')).toBe(false);
  });
});

describe('lastWriteWins', () => {
  it('remoto mais novo vence', () => expect(lastWriteWins(T0, T0_PLUS_2H)).toBe('remote'));
  it('local mais novo vence', () => expect(lastWriteWins(T0_PLUS_2H, T0)).toBe('local'));
});

describe('decideConflict', () => {
  it('divergência grande exige prompt', () => {
    const r = decideConflict({
      localUpdatedAt: T0,
      remoteUpdatedAt: T0_PLUS_2H,
      localContent: 'a',
      remoteContent: 'a',
    });
    expect(r.requiresPrompt).toBe(true);
    expect(r.winner).toBe('remote');
    expect(r.reason).toBe('large_divergence');
  });
  it('divergência pequena => LWW silencioso', () => {
    const r = decideConflict({
      localUpdatedAt: T0_PLUS_1MIN,
      remoteUpdatedAt: T0,
      localContent: 'abc',
      remoteContent: 'abd',
    });
    expect(r.requiresPrompt).toBe(false);
    expect(r.winner).toBe('local');
    expect(r.reason).toBe('last_write_wins');
  });
});
