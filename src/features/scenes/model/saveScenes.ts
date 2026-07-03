// Save de scenes (BC-04 / AD-01). Write local-first da Story + fan-out de sync por
// segment (BR-MIGRAR-033 + COD-001). Substitui o `debouncedSceneSave` no-op da vista
// "All Scenes" (tech-debt #2) — agora chama a mesma helper canônica.
import { storyRepo } from '../../../data/local-db/repositories';
import { canonicalToRow } from '../../story-workspace/model/storySerialization';
import { enqueueMutation } from '../../../data/sync-queue';
import { computeSegmentSyncOps, SegmentSyncOp } from './sceneSync';
import type { CanonicalStory } from '../../../models/story';

/**
 * Persiste alterações de scenes. Write local imediato (verdade) + fan-out por segment.
 * @returns as ops de sync enfileiradas (para feedback/telemetria).
 */
export async function saveScenes(
  prev: CanonicalStory | null,
  next: CanonicalStory,
  userId: string,
): Promise<SegmentSyncOp[]> {
  const now = new Date().toISOString();
  await storyRepo.upsertStory({ ...canonicalToRow(next, now), user_id: userId }); // local-first

  const ops = computeSegmentSyncOps(prev, next);
  for (const op of ops) {
    await enqueueMutation({
      entityType: 'story',
      entityId: `${next.storyId}:${op.segment}`, // dedupe por segment
      operation: op.kind === 'delete' ? 'delete' : 'update',
      // Contrato da Lambda /works (igual ao save-scenes legado): event roteia, userId
      // identifica o owner, `segmentId` (não `segment`) é o nome de campo que o backend
      // lê, e title acompanha o save. delete-scenes é o caminho novo (COD-001).
      payload: {
        event: op.kind === 'delete' ? 'delete-scenes' : 'save-scenes',
        userId,
        title: next.title,
        storyId: next.storyId,
        segmentId: op.segment,
        scenes: op.scenes,
      },
    });
  }
  return ops;
}
