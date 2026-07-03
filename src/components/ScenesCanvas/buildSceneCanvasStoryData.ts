/**
 * buildSceneCanvasStoryData
 * 
 * Transforms the frontend segment/scene structure into the API format
 * expected by scene-canvas-operations.mjs
 * 
 * This handles:
 * - Converting SegmentWithScenes[] to S1-S9 format
 * - Including story metadata (G, T, CQ, M, SUM)
 * - Including character data
 */

import { SegmentWithScenes } from './types';
import { SceneCanvasStoryData } from './useSceneCanvasAI';

interface StoryMetadata {
  genre?: string;        // G
  theme?: string;        // T
  coreQuestion?: string; // CQ
  mood?: string;         // M
  summary?: string;      // SUM
  characters?: Record<string, {
    description: string;
    importance: string;
    arc?: {
      goal?: string;
      conflict?: string;
      growth?: string;
      need?: string;
      starting_state?: string;
    };
  }>;
}

/**
 * Build the storyData object for API calls
 * 
 * @param segments - Array of segments with scenes from canvas state
 * @param metadata - Story metadata (genre, theme, characters, etc.)
 * @returns SceneCanvasStoryData formatted for API
 */
export function buildSceneCanvasStoryData(
  segments: SegmentWithScenes[],
  metadata: StoryMetadata
): SceneCanvasStoryData {
  const storyData: SceneCanvasStoryData = {};
  
  // Add metadata
  if (metadata.genre) storyData.G = metadata.genre;
  if (metadata.theme) storyData.T = metadata.theme;
  if (metadata.coreQuestion) storyData.CQ = metadata.coreQuestion;
  if (metadata.mood) storyData.M = metadata.mood;
  if (metadata.summary) storyData.SUM = metadata.summary;
  
  // Add characters (simplified for API)
  if (metadata.characters) {
    storyData.characters = {};
    for (const [name, char] of Object.entries(metadata.characters)) {
      storyData.characters[name] = {
        description: char.description,
        importance: char.importance,
        arc: {
          goal: char.arc?.goal,
          conflict: char.arc?.conflict,
        },
      };
    }
  }
  
  // Convert segments to S1-S9 format
  for (const segment of segments) {
    const segmentKey = segment.id as keyof SceneCanvasStoryData;
    
    // Only process S1-S9 keys
    if (!segmentKey.match(/^S[1-9]$/)) continue;
    
    // Build segment data
    const segmentData = {
      S: segment.description || segment.title || '',
      scenes: segment.scenes.map(scene => ({
        sceneId: scene.sceneId,
        title: scene.title,
        content: scene.content,
      })),
    };
    
    // Type-safe assignment
    (storyData as any)[segmentKey] = segmentData;
  }
  
  return storyData;
}

/**
 * Get the display ID for a scene within the story
 * 
 * @param sceneId - The scene's unique ID
 * @param segments - All segments
 * @returns Display ID like "S1.2" or null if not found
 */
export function getSceneDisplayId(
  sceneId: string,
  segments: SegmentWithScenes[]
): string | null {
  for (const segment of segments) {
    const sceneIndex = segment.scenes.findIndex(s => s.sceneId === sceneId);
    if (sceneIndex !== -1) {
      return `${segment.id}.${sceneIndex + 1}`;
    }
  }
  return null;
}

/**
 * Get the segment ID for a scene
 * 
 * @param sceneId - The scene's unique ID
 * @param segments - All segments
 * @returns Segment ID like "S1" or null if not found
 */
export function getSegmentForScene(
  sceneId: string,
  segments: SegmentWithScenes[]
): string | null {
  for (const segment of segments) {
    if (segment.scenes.some(s => s.sceneId === sceneId)) {
      return segment.id;
    }
  }
  return null;
}

/**
 * Get full scene info including segment context
 */
export function getSceneInfo(
  sceneId: string,
  segments: SegmentWithScenes[]
): {
  scene: SegmentWithScenes['scenes'][0];
  segmentId: string;
  displayId: string;
  sceneIndex: number;
} | null {
  for (const segment of segments) {
    const sceneIndex = segment.scenes.findIndex(s => s.sceneId === sceneId);
    if (sceneIndex !== -1) {
      return {
        scene: segment.scenes[sceneIndex],
        segmentId: segment.id,
        displayId: `${segment.id}.${sceneIndex + 1}`,
        sceneIndex,
      };
    }
  }
  return null;
}

export default buildSceneCanvasStoryData;