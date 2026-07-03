// Testes do BC-04 — ops de cena puras + fan-out de sync (BR-MIGRAR-032/033 + COD-001).
import { addScene, updateScene, deleteScene, reorderScenes } from './model/sceneOps';
import { computeSegmentSyncOps } from './model/sceneSync';
import { saveScenes } from './model/saveScenes';
import { enqueueMutation } from '../../data/sync-queue';
import { emptySegments, CanonicalStory } from '../../models/story';

jest.mock('../../data/sync-queue', () => ({
  enqueueMutation: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../data/local-db/repositories', () => ({
  storyRepo: { upsertStory: jest.fn().mockResolvedValue(undefined) },
}));

function baseStory(): CanonicalStory {
  const segments = emptySegments();
  segments.S2 = { S: 'outline 2', scenes: [] };
  return {
    storyId: 'story_1_abc123',
    title: 'T',
    BRAINSTORM: '',
    G: '',
    T: '',
    M: '',
    CQ: '',
    SUM: '',
    segments,
    characters: [],
    version: 1,
    status: 'active',
    createdAt: 'now',
    updatedAt: 'now',
    syncedAt: null,
  };
}

describe('sceneOps (BR-MIGRAR-032) — preserva outline e demais segments', () => {
  it('addScene mantém o outline .S do segment', () => {
    const s = addScene(baseStory(), 'S2', { title: 'Abertura' });
    expect(s.segments.S2.S).toBe('outline 2');
    expect(s.segments.S2.scenes).toHaveLength(1);
    expect(s.segments.S2.scenes[0].sceneId).toMatch(/^scene_/);
    expect(s.segments.S1.scenes).toHaveLength(0); // outros segments intactos
  });
  it('updateScene/deleteScene/reorderScenes operam só no segment alvo', () => {
    let s = addScene(baseStory(), 'S2', { title: 'A' });
    const id = s.segments.S2.scenes[0].sceneId;
    s = updateScene(s, 'S2', id, { title: 'A2' });
    expect(s.segments.S2.scenes[0].title).toBe('A2');
    s = addScene(s, 'S2', { title: 'B' });
    s = reorderScenes(s, 'S2', 0, 1);
    expect(s.segments.S2.scenes.map((x) => x.title)).toEqual(['B', 'A2']);
    s = deleteScene(s, 'S2', id);
    expect(s.segments.S2.scenes.map((x) => x.title)).toEqual(['B']);
  });
});

describe('computeSegmentSyncOps (BR-MIGRAR-033 + COD-001)', () => {
  it('fan-out só nos segments alterados; não-vazio => save', () => {
    const prev = baseStory();
    const next = addScene(prev, 'S2', { title: 'A' });
    const ops = computeSegmentSyncOps(prev, next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ segment: 'S2', kind: 'save' });
    expect(ops[0].scenes).toHaveLength(1);
  });
  it('segment que ficou vazio => DELETE (COD-001)', () => {
    const withScene = addScene(baseStory(), 'S2', { title: 'A' });
    const id = withScene.segments.S2.scenes[0].sceneId;
    const emptied = deleteScene(withScene, 'S2', id);
    const ops = computeSegmentSyncOps(withScene, emptied);
    expect(ops).toEqual([{ segment: 'S2', kind: 'delete', scenes: [] }]);
  });
  it('vazio->vazio não gera DELETE redundante', () => {
    expect(computeSegmentSyncOps(baseStory(), baseStory())).toHaveLength(0);
  });
});

describe('saveScenes payload (A3 — contrato da Lambda /works)', () => {
  it('enfileira save-scenes com userId/title/segmentId (não "segment")', async () => {
    (enqueueMutation as jest.Mock).mockClear();
    const prev = baseStory();
    const next = addScene(prev, 'S2', { title: 'Abertura' });
    await saveScenes(prev, next, 'user-9');

    expect(enqueueMutation).toHaveBeenCalledTimes(1);
    const arg = (enqueueMutation as jest.Mock).mock.calls[0][0];
    expect(arg.entityType).toBe('story');
    expect(arg.payload.event).toBe('save-scenes');
    expect(arg.payload.userId).toBe('user-9');
    expect(arg.payload.title).toBe('T');
    expect(arg.payload.storyId).toBe('story_1_abc123');
    expect(arg.payload.segmentId).toBe('S2');
    expect(arg.payload.scenes).toHaveLength(1);
  });
});
