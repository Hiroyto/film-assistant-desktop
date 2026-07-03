// Save local-first (BC-02 / AD-01 / BR-MIGRAR-014/015). Inverte o 3-layer save:
// escreve PRIMEIRO no SQLite local (verdade) e enfileira o push ao DynamoDB em
// background (debounce 10s ou imediato). O "layer DDB" virou "layer sync queue".
import { storyRepo } from '../../../data/local-db/repositories';
import { enqueueMutation } from '../../../data/sync-queue';
import { canonicalToRow, canonicalToWire } from './storySerialization';
import { clock, TimerHandle } from '../../../lib/clock';
import type { CanonicalStory } from '../../../models/story';
import type { SyncOperation } from '../../../data/local-db/rows';

export const SAVE_DEBOUNCE_MS = 10_000; // BR-MIGRAR-014 (digitação)
export const AUTOSAVE_INTERVAL_MS = 1_800_000; // 30 min — BR-MIGRAR-015

const debounceTimers = new Map<string, TimerHandle>();

function clearTimer(storyId: string): void {
  const t = debounceTimers.get(storyId);
  if (t) {
    clock.clearTimeout(t);
    debounceTimers.delete(storyId);
  }
}

async function enqueuePush(story: CanonicalStory, operation: SyncOperation, userId: string): Promise<void> {
  await enqueueMutation({
    entityType: 'story',
    entityId: story.storyId,
    operation,
    // Contrato da Lambda /works: `event` roteia a operação (save) e `userId`
    // identifica o owner. O push-worker envia este payload verbatim, então os
    // campos têm de bater com o que o backend lê (igual ao save() legado).
    payload: { event: 'save', userId, ...canonicalToWire(story) },
  });
}

export interface SaveOptions {
  /** AI response ou story switch => flush imediato (BR-MIGRAR-014). */
  forceImmediate?: boolean;
  operation?: SyncOperation; // 'update' (default) | 'create'
}

/**
 * Salva a Story. Write local imediato (AD-01); push à fila debounced (10s) ou
 * imediato. A serialização preserva segments+scenes (corrige tech-debt #1).
 */
export async function saveStory(story: CanonicalStory, userId: string, opts: SaveOptions = {}): Promise<void> {
  const now = new Date().toISOString();
  const row = { ...canonicalToRow(story, now), user_id: userId };
  await storyRepo.upsertStory(row); // local-first

  const operation = opts.operation ?? 'update';
  if (opts.forceImmediate) {
    clearTimer(story.storyId);
    await enqueuePush(story, operation, userId);
    return;
  }
  // Debounce 10s: agrupa digitação antes de enfileirar o push.
  clearTimer(story.storyId);
  debounceTimers.set(
    story.storyId,
    clock.setTimeout(() => {
      debounceTimers.delete(story.storyId);
      void enqueuePush(story, operation, userId);
    }, SAVE_DEBOUNCE_MS),
  );
}

/**
 * Auto-save backup (BR-MIGRAR-015): em local-first o save é constante; o timer de
 * 30min dispara um FLUSH da sync queue. Suspende em sleep (o OS pausa o timer).
 */
export function startAutoSave(flushQueue: () => void | Promise<void>): () => void {
  const interval = clock.setInterval(() => void flushQueue(), AUTOSAVE_INTERVAL_MS);
  return () => clock.clearInterval(interval);
}
