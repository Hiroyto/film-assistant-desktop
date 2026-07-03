/**
 * ScenesCanvas Types
 * 
 * Type definitions for the scenes canvas feature.
 * This canvas provides a story-scoped visual workspace for
 * viewing and organizing scenes across all segments.
 * 
 * Phase 3 Updates:
 * - AI Panel types (suggestions/revisions modes)
 * - Selection mode types for multi-scene selection
 * - Extended workspace props for AI selection overlay
 * 
 * Phase 4 Updates:
 * - TextSelectionInfo for inline text selection in SceneCards
 * - TextSelectionAction for AI operations on selected text
 * - Extended SceneCardProps with text selection callbacks
 * 
 * Phase 5 Updates:
 * - Extended ScenesCanvasOverlayProps with AI-related props
 * - StoryMetadata interface for AI context
 */

// =============================================================================
// Core Scene Types (matches existing scenes.tsx data model)
// =============================================================================

export interface Scene {
  sceneId: string;
  title: string;
  content: string;
  isExpanded?: boolean;
  metadata?: Record<string, any>;
}

export interface SegmentWithScenes {
  id: string;                 // e.g., 'S1', 'S2', etc.
  title: string;              // e.g., 'Introduction and Stasis'
  content?: string;           // Segment prose content
  scenes: Scene[];
  isSelected?: boolean;
  act: number;                // 1, 2, or 3
  description: string;
}

// =============================================================================
// Canvas Position & Layout
// =============================================================================

export interface Position {
  x: number;
  y: number;
}

export interface CanvasTransform {
  scale: number;
  panX: number;
  panY: number;
}

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// =============================================================================
// Text Selection Types (Phase 4)
// =============================================================================

/**
 * Information about selected text within a scene card.
 * Used to pass selection context to AI operations.
 */
export interface TextSelectionInfo {
  sceneId: string;
  segmentId: string;
  selectedText: string;
  fullContent: string;
  selectionBounds: { start: number; end: number };
}

/**
 * Available actions for selected text.
 * - 'suggest': Get AI suggestions for the selected text
 * - 'revise': Request AI revision of the selected text
 */
export type TextSelectionAction = 'suggest' | 'revise';

// =============================================================================
// Note Card Types
// =============================================================================

/**
 * Note card scope determines what the note applies to:
 * - 'global': Applies to the entire story (all segments/scenes) - shown in right panel only
 * - 'segment': Applies to all scenes within a specific segment
 * - 'scene': Applies to specific tagged scene(s) only - can tag multiple scenes
 */
export type NoteCardScope = 'global' | 'segment' | 'scene';

export type NoteCardStatus = 'active' | 'archived';

export interface NoteCard {
  cardId: string;
  storyId: string;

  // Scope
  scope: NoteCardScope;
  segmentId?: string;         // Set when scope is 'segment' or 'scene'
  sceneIds?: string[];        // Set when scope is 'scene' (can tag multiple scenes)

  // Position on canvas
  position: Position;

  // Content
  title?: string;
  content: string;
  color?: NoteCardColor;

  // Status
  status: NoteCardStatus;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Predefined note card colors for visual categorization
 */
export type NoteCardColor =
  | 'purple'    // Default - general notes
  | 'blue'      // Character-related
  | 'green'     // Plot/structure
  | 'orange'    // Tone/style
  | 'pink'      // Themes
  | 'yellow';   // Ideas/brainstorm

export interface NewNoteCardInput {
  scope: NoteCardScope;
  segmentId?: string;
  sceneIds?: string[];
  position: Position;
  title?: string;
  content?: string;
  color?: NoteCardColor;
}

// =============================================================================
// AI Panel Types (Phase 3)
// =============================================================================

/**
 * Panel mode determines the type of operation:
 * - 'suggestions': Generate suggestions for selected scenes
 * - 'revisions': Generate revised versions of selected scenes
 * - 'global-notes': View and manage global notes
 */
export type PanelMode = 'suggestions' | 'revisions' | 'global-notes';

/**
 * Panel state tracks the current step in the AI workflow:
 * - 'selecting': User is selecting scenes on canvas
 * - 'generating': AI is processing the request
 * - 'results': AI results are ready for review
 * - 'reviewing': User is reviewing applied changes before confirming
 */
export type PanelState = 'selecting' | 'generating' | 'results' | 'reviewing';

/**
 * Information about a selected scene for display in the panel
 */
export interface SelectedSceneInfo {
  sceneId: string;
  segmentId: string;
  displayId: string;    // e.g., 'S1.1', 'S2.3'
  title: string;
}

/**
 * AI-generated suggestion for a scene
 */
export interface Suggestion {
  id: string;
  sceneId: string;
  displayId: string;
  type: SuggestionType;
  content: string;
  isSelected: boolean;
  reasoning?: string;
}

export type SuggestionType =
  | 'character'   // Character development
  | 'tension'     // Conflict/tension
  | 'dialogue'    // Dialogue improvement
  | 'pacing'      // Pacing adjustment
  | 'visual'      // Visual/cinematic
  | 'theme';      // Thematic element

/**
 * AI-generated revision for a scene
 */
export interface Revision {
  id: string;
  sceneId: string;
  displayId: string;
  sceneTitle: string;
  originalText: string;
  revisedText: string;
  status: RevisionStatus;
}

export type RevisionStatus = 'pending' | 'accepted' | 'dismissed';

// =============================================================================
// Story Metadata Types (Phase 5 - AI Context)
// =============================================================================

/**
 * Story metadata for AI context
 * Used to provide story-level information to AI operations
 */
export interface StoryMetadata {
  genre?: string;        // G - Story genre
  theme?: string;        // T - Central theme
  coreQuestion?: string; // CQ - Core dramatic question
  mood?: string;         // M - Overall mood/tone
  summary?: string;      // SUM - Story summary
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

// =============================================================================
// Canvas State
// =============================================================================

export interface ScenesCanvasState {
  // Data
  segments: SegmentWithScenes[];
  noteCards: NoteCard[];

  // Selection
  selectedSceneId: string | null;
  selectedSegmentId: string | null;
  selectedNoteCardId: string | null;

  // View state
  transform: CanvasTransform;

  // UI state
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // AI Panel state (Phase 3)
  showAIPanel: boolean;
  panelMode: PanelMode;
  panelState: PanelState;
  aiSelectedSceneIds: string[];
  guidance: string;
  suggestions: Suggestion[];
  revisions: Revision[];
}

// =============================================================================
// Sidebar Types
// =============================================================================

export interface SidebarActGroup {
  actNumber: number;
  label: string;              // 'Act I', 'Act II', 'Act III'
  segments: SegmentWithScenes[];
  isExpanded: boolean;
  totalScenes: number;
}

export type SidebarViewMode = 'segments' | 'scenes';

// =============================================================================
// Detail Panel Types (Legacy - kept for backwards compatibility)
// =============================================================================

export type DetailPanelTab = 'edit' | 'suggestions' | 'notes';

export interface SceneEditState {
  title: string;
  content: string;
  isDirty: boolean;
}

// =============================================================================
// Connection Types (for visual flow between scenes)
// =============================================================================

export interface SceneConnection {
  fromSceneId: string;
  toSceneId: string;
  isCrossSegment: boolean;    // Different visual style for cross-segment connections
}

export interface ConnectionNode {
  position: Position;
  fromSceneId: string;
  toSceneId: string;
  isCrossSegment: boolean;
}

// =============================================================================
// Component Props
// =============================================================================

/**
 * Base props for ScenesCanvasOverlay
 */
export interface ScenesCanvasOverlayProps {
  storyId: string;
  storyTitle: string;
  segments: SegmentWithScenes[];
  onClose: () => void;
  onScenesUpdate: (segments: SegmentWithScenes[]) => void;
  // Optional - for token display
  userCap?: number;
  // NEW: AI-related props (Phase 5)
  userId: string;
  token?: any;
  onTokenUpdate?: (newBalance: number) => void;
  storyMetadata?: StoryMetadata;
  deleteScene: (sceneId: string) => void;
  onGenerate: (sceneId: string) => void;
  generatingSceneId?: string | null;
}

export interface ScenesCanvasHeaderProps {
  storyTitle: string;
  onClose: () => void;
  userCap?: number;
  isSaving?: boolean;
}

export interface ScenesCanvasSidebarProps {
  segments: SegmentWithScenes[];
  selectedSceneId: string | null;
  selectedSegmentId: string | null;
  viewMode: SidebarViewMode;
  onViewModeChange: (mode: SidebarViewMode) => void;
  onSceneSelect: (sceneId: string, segmentId: string) => void;
  onSegmentSelect: (segmentId: string) => void;
  onSceneReorder: (segmentId: string, fromIndex: number, toIndex: number) => void;
  onSceneMoveToSegment: (sceneId: string, fromSegmentId: string, toSegmentId: string) => void;
}

export interface ScenesCanvasWorkspaceProps {
  segments: SegmentWithScenes[];
  noteCards: NoteCard[];
  selectedSceneId: string | null;
  selectedSegmentId: string | null;
  transform: CanvasTransform;
  // Linking mode state (for note cards)
  linkingNoteId: string | null;
  linkingSceneIds: string[];
  // AI Selection mode state (Phase 3)
  isInSelectionMode?: boolean;
  selectionModeColor?: string;
  aiSelectedSceneIds?: string[];
  // Handlers
  onTransformChange: (transform: CanvasTransform) => void;
  onSceneSelect: (sceneId: string, segmentId: string) => void;
  onSceneUpdate: (sceneId: string, segmentId: string, updates: Partial<Scene>) => void;
  onSceneToggleLink: (sceneId: string) => void;
  onNoteCardMove: (cardId: string, position: Position) => void;
  onNoteCardUpdate: (cardId: string, updates: Partial<NoteCard>) => void;
  onNoteCardRemove: (cardId: string) => void;
  onNoteCardSelect: (cardId: string | null) => void;
  onNoteStartLinking: (cardId: string) => void;
  onNoteFinishLinking: (cardId: string, scope: NoteCardScope, segmentId?: string, sceneIds?: string[]) => void;
  onNoteCancelLinking: (cardId: string) => void;
  onConnectionClick: (fromSceneId: string, toSceneId: string, position: Position) => void;
  // Text selection handler (Phase 4)
  onTextSelectionAction?: (
    sceneId: string,
    segmentId: string,
    action: TextSelectionAction,
    selection: TextSelectionInfo
  ) => void;
  generatingSceneId?: string | null;
}

export interface SceneCardProps {
  scene: Scene;
  segmentId: string;
  segmentColor: string;
  displayId: string;          // e.g., 'S1.1', 'S2.3'
  isSelected: boolean;
  isInSelectionMode?: boolean; // Hide edit button when in selection mode
  isEditingDisabled?: boolean; // Disable editing (e.g., when text selection is active)
  onClick: () => void;
  onSceneUpdate: (updates: Partial<Scene>) => void;
  onMeasured?: (height: number) => void;
  onDelete: () => void;
  // Text selection callback (Phase 4)
  onTextSelectionAction?: (
    action: TextSelectionAction,
    selection: TextSelectionInfo
  ) => void;
  // Active selection highlight (Phase 4) - persists when panel is open
  activeSelectionBounds?: { start: number; end: number } | null;
  activeSelectionColor?: 'purple' | 'cyan';
  generatingSceneId?: string | null;
  onGenerate?: () => void;
}

export interface NoteCardProps {
  note: NoteCard;
  segments: SegmentWithScenes[];
  canvasScale: number;
  isLinkingMode: boolean;
  linkedSceneIds: string[];
  detectedSegmentId: string;
  onMove: (position: Position) => void;
  onUpdate: (updates: Partial<NoteCard>) => void;
  onRemove: () => void;
  onStartLinking: () => void;
  onFinishLinking: (scope: NoteCardScope, segmentId?: string, sceneIds?: string[]) => void;
  onCancelLinking: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

/**
 * NEW: SceneDetailPanel props for AI suggestions/revisions workflow
 */
export interface SceneDetailPanelProps {
  mode: PanelMode;
  panelState: PanelState;
  selectedScenes: SelectedSceneInfo[];
  suggestions: Suggestion[];
  revisions: Revision[];
  guidance: string;
  onGuidanceChange: (guidance: string) => void;
  onRemoveScene: (sceneId: string) => void;
  onGenerate: () => void;
  onClose: () => void;
  // Suggestions handlers
  onToggleSuggestion: (suggestionId: string) => void;
  onApplySuggestions: () => void;
  onRegenerateSuggestions: () => void;
  // Revisions handlers
  onAcceptRevision: (revisionId: string) => void;
  onDismissRevision: (revisionId: string) => void;
  onRetryRevision: (revisionId: string) => void;
}

/**
 * Legacy SceneDetailPanel props (for backwards compatibility)
 */
export interface SceneDetailPanelPropsLegacy {
  scene: Scene | null;
  segment: SegmentWithScenes | null;
  activeTab: DetailPanelTab;
  onTabChange: (tab: DetailPanelTab) => void;
  onSceneUpdate: (sceneId: string, updates: Partial<Scene>) => void;
  onClose: () => void;
  globalNotes: NoteCard[];
  segmentNotes: NoteCard[];
  sceneNotes: NoteCard[];
}

export interface ScenesCanvasToolbarProps {
  transform: CanvasTransform;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onAddNote: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  // AI Panel controls (Phase 3)
  onRequestSuggestions?: () => void;
  onRequestRevisions?: () => void;
  isPanelOpen?: boolean;
  panelMode?: PanelMode | null;
  isSaved?: boolean;
}

// =============================================================================
// Hook Return Types
// =============================================================================

export interface UseNoteCardsOptions {
  storyId: string;
  initialNotes?: NoteCard[];
}

export interface UseNoteCardsReturn {
  // State
  noteCards: NoteCard[];

  // CRUD operations
  addNoteCard: (input: NewNoteCardInput) => NoteCard;
  updateNoteCard: (cardId: string, updates: Partial<NoteCard>) => void;
  removeNoteCard: (cardId: string) => void;
  moveNoteCard: (cardId: string, position: Position) => void;

  // Filtering helpers
  getGlobalNotes: () => NoteCard[];
  getSegmentNotes: (segmentId: string) => NoteCard[];
  getSceneNotes: (sceneId: string) => NoteCard[];
  getNotesForDetailPanel: (sceneId: string, segmentId: string) => {
    globalNotes: NoteCard[];
    segmentNotes: NoteCard[];
    sceneNotes: NoteCard[];
  };

  // Canvas notes (excludes global - those go in right panel)
  getCanvasNotes: () => NoteCard[];
}

export interface UseScenesCanvasStateReturn {
  // State
  segments: SegmentWithScenes[];
  noteCards: NoteCard[];
  selectedSceneId: string | null;
  selectedSegmentId: string | null;
  selectedNoteCardId: string | null;
  transform: CanvasTransform;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // AI Panel state (Phase 3)
  showAIPanel: boolean;
  panelMode: PanelMode;
  panelState: PanelState;
  aiSelectedSceneIds: string[];
  guidance: string;
  suggestions: Suggestion[];
  revisions: Revision[];

  // Scene operations
  selectScene: (sceneId: string, segmentId: string) => void;
  selectSegment: (segmentId: string) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  reorderScene: (segmentId: string, fromIndex: number, toIndex: number) => void;
  moveSceneToSegment: (sceneId: string, fromSegmentId: string, toSegmentId: string) => void;

  // Note card operations
  addNoteCard: (input: NewNoteCardInput) => void;
  updateNoteCard: (cardId: string, updates: Partial<NoteCard>) => void;
  removeNoteCard: (cardId: string) => void;
  moveNoteCard: (cardId: string, position: Position) => void;
  selectNoteCard: (cardId: string | null) => void;

  // Canvas operations
  setTransform: (transform: CanvasTransform) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  panTo: (position: Position) => void;

  // AI Panel operations (Phase 3)
  openSuggestionsPanel: () => void;
  openRevisionsPanel: () => void;
  closeAIPanel: () => void;
  toggleSceneSelection: (sceneId: string) => void;
  setGuidance: (guidance: string) => void;
  generateAI: () => Promise<void>;

  // Persistence
  saveChanges: () => Promise<void>;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Segment colors for visual identification
 * Matches the HTML mockup color scheme
 */
export const SEGMENT_COLORS: Record<string, string> = {
  S1: '#ff6b35',  // Orange
  S2: '#8b5cf6',  // Purple
  S3: '#06b6d4',  // Cyan
  S4: '#10b981',  // Green
  S5: '#f59e0b',  // Amber
  S6: '#ec4899',  // Pink
  S7: '#6366f1',  // Indigo
  S8: '#84cc16',  // Lime
  S9: '#f43f5e',  // Rose
};

/**
 * Segment display names
 */
export const SEGMENT_NAMES: Record<string, string> = {
  S1: 'Introduction & Stasis',
  S2: 'Inciting Incident',
  S3: 'Commitment',
  S4: 'First Pinch Point',
  S5: 'Midpoint',
  S6: 'Second Pinch Point',
  S7: 'Second Plot Point',
  S8: 'Climax',
  S9: 'Resolution',
};

/**
 * Note card color values
 */
export const NOTE_CARD_COLORS: Record<NoteCardColor, string> = {
  purple: '#8b5cf6',  // Default - general notes
  blue: '#3b82f6',    // Character-related
  green: '#10b981',   // Plot/structure
  orange: '#f59e0b',  // Tone/style
  pink: '#ec4899',    // Themes
  yellow: '#eab308',  // Ideas/brainstorm
};

/**
 * AI Panel color scheme
 */
export const AI_PANEL_COLORS = {
  suggestions: '#8b5cf6',   // Purple
  revisions: '#06b6d4',     // Cyan
};

/**
 * Text selection toolbar colors (Phase 4)
 * Maps actions to their respective colors
 */
export const TEXT_SELECTION_ACTION_COLORS: Record<TextSelectionAction, string> = {
  suggest: '#8b5cf6',   // Purple - matches suggestions
  revise: '#06b6d4',    // Cyan - matches revisions
};

/**
 * Note card width constant
 */
export const NOTE_CARD_WIDTH = 280;

/**
 * Canvas layout constants
 */
export const CANVAS_CONSTANTS = {
  // Scene card dimensions
  SCENE_CARD_WIDTH: 350,
  SCENE_CARD_HEIGHT: 140,     // Not used - cards auto-size

  // Note card dimensions
  NOTE_CARD_WIDTH: 280,

  // Spacing
  CARD_GAP_X: 280,            // Horizontal gap between scene cards
  ROW_GAP_Y: 180,             // Vertical gap between segment rows
  CANVAS_PADDING: 100,        // Padding from canvas edges

  // Zoom limits
  MIN_ZOOM: 0.4,
  MAX_ZOOM: 1.5,
  ZOOM_STEP: 0.1,

  // Starting position for scene cards
  START_X: 250,
  START_Y: 100,
};