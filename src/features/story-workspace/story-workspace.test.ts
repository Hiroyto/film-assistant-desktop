// Testes do BC-02 — foco na CORREÇÃO DO LOSSY SAVE (tech-debt #1 / BR-MIGRAR-013 /
// RISK-011): editar synopsis/foundation NÃO pode apagar as scenes de um segment.
// `craco test`.
import {
  parseSegments,
  rowToCanonical,
  canonicalToRow,
  updateScalarField,
  updateSegmentOutline,
} from './model/storySerialization';
import { estimateMs, FULL_ESTIMATE_MS } from './model/outlineEstimate';
import { saveStory } from './model/storySave';
import { enqueueMutation } from '../../data/sync-queue';
import { emptySegments, CanonicalStory } from '../../models/story';
import type { StoryRow } from '../../data/local-db/rows';

jest.mock('../../data/sync-queue', () => ({
  enqueueMutation: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../data/local-db/repositories', () => ({
  storyRepo: { upsertStory: jest.fn().mockResolvedValue(undefined) },
  characterRepo: { listByStory: jest.fn().mockResolvedValue([]) },
}));

const NOW = '2026-05-29T12:00:00.000Z';

function storyWithSceneInS5(): CanonicalStory {
  const segments = emptySegments();
  segments.S5 = { S: 'beat 5 outline', scenes: [{ sceneId: 'scene_abc_def123', title: 'Climax', content: 'X' }] };
  return {
    storyId: 'story_1717000000000_ab12cd',
    title: 'My Film',
    BRAINSTORM: 'idea',
    G: 'Drama',
    T: 'loss',
    M: 'noir',
    CQ: 'will he?',
    SUM: 'old synopsis',
    segments,
    characters: [],
    version: 1,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    syncedAt: null,
  };
}

describe('lossy save fix (BR-MIGRAR-013 / RISK-011)', () => {
  it('editar SUM (synopsis, à la Profile.save) NÃO apaga S5.scenes', () => {
    const story = storyWithSceneInS5();
    const updated = updateScalarField(story, 'SUM', 'new synopsis');
    expect(updated.SUM).toBe('new synopsis');
    expect(updated.segments.S5.scenes).toHaveLength(1);
    expect(updated.segments.S5.scenes[0].sceneId).toBe('scene_abc_def123');
  });

  it('round-trip canonical -> row -> canonical preserva scenes', () => {
    const story = storyWithSceneInS5();
    const row: StoryRow = { ...canonicalToRow(story, NOW), user_id: 'u1' };
    const back = rowToCanonical(row, []);
    expect(back.segments.S5.scenes).toHaveLength(1);
    expect(back.segments.S5.S).toBe('beat 5 outline');
    expect(back.SUM).toBe('old synopsis');
  });

  it('atualizar o outline de um segment preserva suas scenes', () => {
    const story = storyWithSceneInS5();
    const updated = updateSegmentOutline(story, 'S5', 'reescrito');
    expect(updated.segments.S5.S).toBe('reescrito');
    expect(updated.segments.S5.scenes).toHaveLength(1);
  });
});

describe('parseSegments coerce polimórfico', () => {
  it('scalar legado vira { S, scenes:[] } e sempre há 9 chaves', () => {
    const segs = parseSegments(JSON.stringify({ S1: 'só texto' }));
    expect(segs.S1).toEqual({ S: 'só texto', scenes: [] });
    expect(Object.keys(segs)).toHaveLength(9);
    expect(segs.S9).toEqual({ S: '', scenes: [] });
  });
  it('JSON inválido => 9 segments vazios (não quebra)', () => {
    const segs = parseSegments('not json');
    expect(Object.keys(segs)).toHaveLength(9);
  });
});

describe('outlineEstimate (BR-MIGRAR-050)', () => {
  it('full = 50500ms (4000 + 6000 + 4500×9)', () => {
    expect(FULL_ESTIMATE_MS).toBe(50_500);
    expect(estimateMs('full')).toBe(50_500);
    expect(estimateMs('preview')).toBe(25_000);
  });
});

describe('saveStory payload (A1 — contrato da Lambda /works)', () => {
  it('enfileira com event:"save" + userId + campos wire, preservando scenes (RISK-011)', async () => {
    (enqueueMutation as jest.Mock).mockClear();
    const story = storyWithSceneInS5();
    await saveStory(story, 'user-42', { forceImmediate: true });

    expect(enqueueMutation).toHaveBeenCalledTimes(1);
    const arg = (enqueueMutation as jest.Mock).mock.calls[0][0];
    expect(arg.entityType).toBe('story');
    expect(arg.entityId).toBe(story.storyId);
    expect(arg.operation).toBe('update');
    expect(arg.payload.event).toBe('save');
    expect(arg.payload.userId).toBe('user-42');
    expect(arg.payload.storyId).toBe(story.storyId);
    expect(arg.payload.SUM).toBe('old synopsis');
    // segment com scenes preservadas no payload (não vira scalar)
    expect(arg.payload.S5).toEqual({
      S: 'beat 5 outline',
      scenes: [{ sceneId: 'scene_abc_def123', title: 'Climax', content: 'X' }],
    });
  });
});
