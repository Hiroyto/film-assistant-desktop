// Comandos do AGG-Story (BC-02). create/update/delete sobre a Story canônica,
// persistindo local-first via saveStory.
import {
  CanonicalStory,
  generateStoryId,
  emptySegments,
  canCreateStory,
  STORIES_LIMIT,
} from '../../../models/story';
import { storyRepo } from '../../../data/local-db/repositories';
import { enqueueMutation } from '../../../data/sync-queue';
import { saveStory } from './storySave';

/** Cria uma story nova (storyId client-gen DEFINITIVO — BR-MIGRAR-011 / COD-002). */
export async function createStory(userId: string, title: string): Promise<CanonicalStory> {
  const active = await storyRepo.countActiveStories(userId);
  if (!canCreateStory(active)) {
    throw new Error(`Limite de ${STORIES_LIMIT} histórias atingido.`);
  }
  const now = new Date().toISOString();
  const story: CanonicalStory = {
    storyId: generateStoryId(),
    title,
    BRAINSTORM: '',
    G: '',
    T: '',
    M: '',
    CQ: '',
    SUM: '',
    segments: emptySegments(),
    characters: [],
    version: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
  // COD-002: o backend deve respeitar este storyId no primeiro save (não sobrescrever).
  await saveStory(story, userId, { forceImmediate: true, operation: 'create' });
  return story;
}

/** Persiste uma edição. AI response / story switch => forceImmediate. */
export async function persistStory(
  story: CanonicalStory,
  userId: string,
  source: 'user' | 'ai' = 'user',
): Promise<void> {
  await saveStory(story, userId, { forceImmediate: source === 'ai' });
}

/** Soft-delete local + enfileira DELETE para o backend (AD-01). */
export async function deleteStory(storyId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await storyRepo.softDelete(storyId, now);
  await enqueueMutation({ entityType: 'story', entityId: storyId, operation: 'delete', payload: { storyId } });
}
