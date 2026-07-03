// Canonical Scene (resolve drift de 3 shapes — BR-MIGRAR-052 / tech-debt #6).
//
// Fonte: target_domain_model.md (Entidades: Scene; Value object: SceneId).
// Substitui os 3 shapes legados que coexistiam (scenes.tsx, Scripts/types.ts,
// ScenesCanvas/types.ts). View-models por módulo devem DERIVAR deste shape.

/** Cena canônica. `title` vazio é válido. */
export interface Scene {
  /** Formato canônico `scene_<base36-ts>_<base36-rand6>`. */
  sceneId: string;
  title: string;
  content: string;
  shortDescription?: string;
  fullDescription?: string;
  metadata?: Record<string, unknown>;
}

// --- Value Object: SceneId --------------------------------------------------

/** Regex do SceneId canônico (BR-MIGRAR-052). */
export const SCENE_ID_REGEX = /^scene_[a-z0-9]+_[a-z0-9]{6}$/;

export function isValidSceneId(id: string): boolean {
  return SCENE_ID_REGEX.test(id);
}

function randomBase36(len: number): string {
  let out = '';
  while (out.length < len) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, len);
}

/**
 * Gera um SceneId canônico `scene_<base36-ts>_<base36-rand6>`.
 * Usado apenas em criação client-side nova; IDs vindos do backend são preservados
 * como estão (não reescritos — evita quebrar refs; ver data_migration_plan.md T-03).
 */
export function generateSceneId(now: number = Date.now()): string {
  return `scene_${now.toString(36)}_${randomBase36(6)}`;
}

/** Cria uma Scene canônica com defaults. */
export function createScene(partial: Partial<Scene> = {}): Scene {
  return {
    sceneId: partial.sceneId && isValidSceneId(partial.sceneId) ? partial.sceneId : generateSceneId(),
    title: partial.title ?? '',
    content: partial.content ?? '',
    ...(partial.shortDescription !== undefined ? { shortDescription: partial.shortDescription } : {}),
    ...(partial.fullDescription !== undefined ? { fullDescription: partial.fullDescription } : {}),
    ...(partial.metadata !== undefined ? { metadata: partial.metadata } : {}),
  };
}
