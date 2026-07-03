// Fan-out de sync das scenes (BC-04 / BR-MIGRAR-033). Uma op por segment ALTERADO.
// Segment que ficou vazio gera DELETE explícito (COD-001 — o backend legado mantinha
// scenes órfãs por não receber DELETE). Função PURA (testável).
import type { CanonicalStory, SegmentKey } from '../../../models/story';
import { SEGMENT_KEYS } from '../../../models/story';
import type { Scene } from '../../../models/scene';

export interface SegmentSyncOp {
  segment: SegmentKey;
  kind: 'save' | 'delete';
  scenes: Scene[];
}

function scenesEqual(a: Scene[], b: Scene[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compara prev vs next e retorna as ops de sync por segment alterado.
 * - segment não-vazio alterado -> 'save' (POST /works event=save-scenes).
 * - segment que ficou vazio    -> 'delete' (COD-001).
 * `prev` null = primeira persistência (só os não-vazios viram 'save').
 */
export function computeSegmentSyncOps(prev: CanonicalStory | null, next: CanonicalStory): SegmentSyncOp[] {
  const ops: SegmentSyncOp[] = [];
  for (const key of SEGMENT_KEYS) {
    const nextScenes = next.segments[key].scenes;
    const prevScenes = prev?.segments[key]?.scenes ?? [];
    if (scenesEqual(prevScenes, nextScenes)) continue; // inalterado -> não entra no fan-out
    if (nextScenes.length === 0) {
      // só emite DELETE se ANTES havia scenes (evita DELETE redundante de vazio→vazio).
      if (prevScenes.length > 0) ops.push({ segment: key, kind: 'delete', scenes: [] });
    } else {
      ops.push({ segment: key, kind: 'save', scenes: nextScenes });
    }
  }
  return ops;
}
