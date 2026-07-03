/**
 * ScenesCanvas Components
 * 
 * Story-scoped canvas workspace for visualizing and organizing scenes
 * across all segments with AI assistance and note cards.
 * 
 * Usage:
 * 
 * import { ScenesCanvasOverlay } from './ScenesCanvas';
 * 
 * // In your component:
 * const [isCanvasOpen, setIsCanvasOpen] = useState(false);
 * 
 * // Render when canvas is opened:
 * {isCanvasOpen && (
 *   <ScenesCanvasOverlay
 *     storyId={data.storyId}
 *     storyTitle={data.title}
 *     segments={segments}
 *     onClose={() => setIsCanvasOpen(false)}
 *     onScenesUpdate={(updatedSegments) => {
 *       setSegments(updatedSegments);
 *       saveScenesToBackend(updatedSegments);
 *     }}
 *     userCap={user?.cap}
 *   />
 * )}
 */

// Main overlay component - this is what you import to use the canvas
export { default as ScenesCanvasOverlay } from './ScenesCanvasOverlay';

// Sub-components (typically not imported directly)
export { default as ScenesCanvasHeader } from './ScenesCanvasHeader';
export { default as ScenesCanvasSidebar } from './ScenesCanvasSidebar';
export { default as ScenesCanvasWorkspace } from './ScenesCanvasWorkspace';
export { default as SceneCard } from './SceneCard';
export { default as SceneDetailPanel } from './SceneDetailPanel';
export { default as ScenesCanvasToolbar } from './ScenesCanvasToolbar';
export { default as NoteCard } from './NoteCard';

// Hooks
export { useNoteCards } from './useNoteCards';

// Types
export type {
  // Core types
  Scene,
  SegmentWithScenes,
  Position,
  CanvasTransform,
  ViewportBounds,
  
  // Note card types
  NoteCard as NoteCardType,
  NoteCardScope,
  NoteCardStatus,
  NoteCardColor,
  NewNoteCardInput,
  NoteCardProps,
  
  // AI Panel types (Phase 3)
  PanelMode,
  PanelState,
  SelectedSceneInfo,
  Suggestion,
  SuggestionType,
  Revision,
  RevisionStatus,
  
  // State types
  ScenesCanvasState,
  SidebarActGroup,
  SidebarViewMode,
  DetailPanelTab,
  SceneEditState,
  
  // Connection types
  SceneConnection,
  ConnectionNode,
  
  // Component props
  ScenesCanvasOverlayProps,
  ScenesCanvasHeaderProps,
  ScenesCanvasSidebarProps,
  ScenesCanvasWorkspaceProps,
  SceneCardProps,
  SceneDetailPanelProps,
  SceneDetailPanelPropsLegacy,
  ScenesCanvasToolbarProps,
  
  // Hook types
  UseNoteCardsOptions,
  UseNoteCardsReturn,
  UseScenesCanvasStateReturn,
} from './types';

// Constants
export {
  SEGMENT_COLORS,
  SEGMENT_NAMES,
  NOTE_CARD_COLORS,
  AI_PANEL_COLORS,
  NOTE_CARD_WIDTH,
  CANVAS_CONSTANTS,
} from './types';