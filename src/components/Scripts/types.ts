/**
 * types.ts
 * ========
 * Shared TypeScript interfaces for the Scripts feature.
 *
 * These types define the data structures used across the screenplay editor,
 * beat sidebar, scene generation pipeline, and fullscreen mode.
 *
 * Imported by: Scripts.tsx, ScriptEditor.tsx, BeatSidebar.tsx,
 *              useSceneGeneration.ts, and various editor components.
 */

// ─────────────────────────────────────────────
// Scene & Beat Data Models
// ─────────────────────────────────────────────

/**
 * Represents a single scene within a beat.
 *
 * Scenes are the atomic unit of screenplay content. Each scene maps to
 * a slugline (e.g., "INT. COFFEE SHOP - DAY") and its associated
 * action, dialogue, and transitions.
 *
 * The `id` follows the format "S{beat}.{scene}" (e.g., "S1.2" = Beat 1, Scene 2).
 */
export interface Scene {
  sceneId: string;
  /** Short display title (e.g., "The Return") */
  title: string;
  /** Full scene description — this is the primary content field */
  content: string;
  /** Optional brief summary for sidebar previews */
  shortDescription?: string;
  /** Optional extended description (not needed if using `content`) */
  fullDescription?: string;
  /** UI state: whether the scene card is expanded in the sidebar */
  isExpanded?: boolean;
  /** UI state: whether the scene is in edit mode */
  isEditing?: boolean;
  /** UI state: whether AI generation is in progress for this scene */
  isGenerating?: boolean;
  /** Arbitrary metadata attached to the scene (e.g., location, time of day) */
  metadata?: Record<string, any>;
}

/**
 * Tracks a scene's position within the TipTap editor document.
 *
 * Used to enable "click scene in sidebar → scroll to it in editor" behavior
 * and to track which scenes have been generated.
 */
export interface ScenePosition {
  /** Scene ID (e.g., "S1.1") */
  id: string;
  /** ProseMirror document position where the scene starts */
  startLine: number;
  /** ProseMirror document position where the scene ends */
  endLine: number;
  /** The scene's text content (for reference/search) */
  content: string;
}

/**
 * Represents a story beat — a narrative unit containing one or more scenes.
 *
 * Beats are the organizational layer above scenes. In the sidebar,
 * users expand a beat to see its scenes, then generate scripts per-scene.
 */
export interface Beat {
  id: string;
  title: string;
  description: string;
  scenes: Scene[];
  /** UI state: whether this beat is currently selected in the sidebar */
  isSelected?: boolean;
}

// ─────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────

/**
 * Props for the SceneItem component in the sidebar.
 */
export interface SceneProps {
  id: string;
  title: string;
  content: string;
  isSelected: boolean;
  onSelect: () => void;
  onGenerate: () => void;
}

/**
 * Props for the BeatItem component in the sidebar.
 */
export interface BeatProps {
  id: string;
  title: string;
  description: string;
  scenes: Scene[];
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onSceneSelect: (sceneId: string) => void;
  onSceneGenerate: (sceneId: string) => void;
  selectedSceneId: string | null;
}

// ─────────────────────────────────────────────
// AI Generation / Handoff Types
// ─────────────────────────────────────────────

/**
 * A single message in the handoff conversation history.
 *
 * The scene generation pipeline uses a multi-step "handoff" pattern:
 *   1st handoff → generates raw screenplay text
 *   2nd handoff → analyzes characters/metadata
 *   3rd handoff → finalizes character database updates
 *
 * The conversation history is passed between handoffs to maintain context.
 */
export interface ConversationMessage {
  role: string;
  content?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

/**
 * Response shape from the scene generation Lambda endpoint.
 *
 * The `body` contains different fields depending on which handoff stage
 * returned the response. All three stages share the same response wrapper.
 */
export interface HandoffResponse {
  statusCode: number;
  body: {
    success: boolean;
    beat_id: string;
    handoff_id: string;
    /** Generated screenplay text (1st handoff) */
    scene_text?: string;
    /** Conversation history for passing to next handoff */
    conversation_history?: ConversationMessage[];
    /** Updated token balance after generation */
    cap?: number;
    /** Debug logs from Lambda */
    logs?: any[];
    /** Error message if generation failed */
    error?: string;
    /** Character/metadata analysis (2nd handoff) */
    metadata_analysis?: any;
    /** Character info extracted from scene (2nd handoff) */
    character_info?: any;
    /** Status of 2nd handoff completion */
    second_handoff_status?: string;
    /** Type of analysis performed */
    analysis_type?: string;
    /** Whether a 3rd handoff is needed */
    requires_third_handoff?: boolean;
    /** Final character database updates (3rd handoff) */
    final_character_updates?: any;
    /** Status of 3rd handoff completion */
    third_handoff_status?: string;
    /** Review status of the generated content */
    review_status?: string;
  };
}

// ─────────────────────────────────────────────
// Editor Types
// ─────────────────────────────────────────────

/**
 * Supported screenplay line types.
 *
 * Each paragraph in the TipTap editor has a `lineType` attribute
 * that determines its formatting (margins, color, text-transform).
 *
 * Re-exported here for convenience — the canonical definition
 * lives in editor/extensions/ScreenwritingParagraph.ts
 */
// AFTER — single source of truth
export type { ScreenwritingLineType } from "./editor/extensions/Screenwritingline";