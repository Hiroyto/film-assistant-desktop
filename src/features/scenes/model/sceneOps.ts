// Operações de cena (BC-04). Scenes é o ÚNICO módulo que escreve `{ S, scenes }`
// (BR-MIGRAR-032). Funções PURAS sobre a Story canônica — sempre preservam o outline
// (.S) do segment e os demais segments. Usam o Scene canônico (BR-MIGRAR-052).
import type { CanonicalStory, SegmentKey } from '../../../models/story';
import { Scene, createScene } from '../../../models/scene';

function setSegmentScenes(story: CanonicalStory, key: SegmentKey, scenes: Scene[]): CanonicalStory {
  return {
    ...story,
    segments: { ...story.segments, [key]: { S: story.segments[key].S, scenes } },
  };
}

export function addScene(story: CanonicalStory, key: SegmentKey, partial: Partial<Scene> = {}): CanonicalStory {
  return setSegmentScenes(story, key, [...story.segments[key].scenes, createScene(partial)]);
}

export function updateScene(
  story: CanonicalStory,
  key: SegmentKey,
  sceneId: string,
  patch: Partial<Omit<Scene, 'sceneId'>>,
): CanonicalStory {
  const scenes = story.segments[key].scenes.map((s) => (s.sceneId === sceneId ? { ...s, ...patch } : s));
  return setSegmentScenes(story, key, scenes);
}

export function deleteScene(story: CanonicalStory, key: SegmentKey, sceneId: string): CanonicalStory {
  return setSegmentScenes(
    story,
    key,
    story.segments[key].scenes.filter((s) => s.sceneId !== sceneId),
  );
}

export function reorderScenes(story: CanonicalStory, key: SegmentKey, from: number, to: number): CanonicalStory {
  const scenes = [...story.segments[key].scenes];
  if (from < 0 || from >= scenes.length || to < 0 || to >= scenes.length) return story;
  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  return setSegmentScenes(story, key, scenes);
}

/** Substitui todas as scenes de um segment (ex: aplicar resultado de AI). */
export function replaceSegmentScenes(story: CanonicalStory, key: SegmentKey, scenes: Scene[]): CanonicalStory {
  return setSegmentScenes(story, key, scenes.map((s) => createScene(s)));
}
