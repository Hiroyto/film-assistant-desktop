/**
 * Canvas Types
 * 
 * Data contract for the segment canvas feature.
 * These types define the shape of cards, canvas state,
 * and the hook interface for managing canvas data.
 */

// =============================================================================
// Card Types
// =============================================================================

export type CardType = 'note' | 'suggestion';

export type CardStatus = 'active' | 'applied' | 'dismissed';

export interface Position {
  x: number;
  y: number;
}

/**
 * LinkedText
 * 
 * When a card (usually a suggestion) is tied to a specific
 * text selection in the segment content.
 * 
 * start/end are character indices in the segment text.
 * original stores the text at creation time for display.
 */
export interface LinkedText {
  start: number;
  end: number;
  original: string;
}

/**
 * CanvasCard
 * 
 * A single card on the canvas. Can be:
 * - constraint: User-defined rule/guardrail for the segment
 * - note: Freeform user thought or reminder
 * - suggestion: AI-generated revision option
 */
export interface CanvasCard {
  id: string;
  type: CardType;
  content: string;
  position: Position;
  linkedText: LinkedText | null;
  status: CardStatus;
  createdAt: string;
}

// =============================================================================
// Story Data (for AI context)
// =============================================================================

/**
 * StoryData
 * 
 * Full story context passed to Canvas for AI suggestions.
 * All fields optional since stories may be incomplete.
 */
export interface StoryData {
  synopsis?: string;
  segment1?: string;
  segment2?: string;
  segment3?: string;
  segment4?: string;
  segment5?: string;
  segment6?: string;
  segment7?: string;
  segment8?: string;
  segment9?: string;
}

// =============================================================================
// Canvas State
// =============================================================================

/**
 * CanvasState
 * 
 * The complete state for a single segment's canvas.
 * This is what gets persisted to DynamoDB.
 */
export interface CanvasState {
  storyId: string;
  segmentId: string;
  userId: string;
  cards: CanvasCard[];
  updatedAt: string;
  createdAt: string;
}

// =============================================================================
// Hook Interface
// =============================================================================

/**
 * UseCanvasStateReturn
 * 
 * The interface returned by useCanvasState hook.
 * Provides state and operations for managing canvas.
 */
export interface UseCanvasStateReturn {
  // State
  cards: CanvasCard[];
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;

  // Card CRUD
  addCard: (card: NewCardInput) => void;
  updateCard: (id: string, updates: Partial<CanvasCard>) => void;
  removeCard: (id: string) => void;
  moveCard: (id: string, position: Position) => void;

  // Suggestion-specific
  applySuggestion: (id: string) => string; // Returns the new content to apply
  dismissSuggestion: (id: string) => void;

  // Persistence
  saveCanvas: () => Promise<void>;
  clearCanvas: () => void;

  // AI
  requestSuggestions: (selectedText?: LinkedText, guidance?: string) => Promise<void>;
  isRequestingSuggestions: boolean;
  
  // Extended AI (returned by hook but optional in interface for backwards compat)
  sessionId?: string | null;
  regenerateSuggestions?: () => Promise<void>;
  applySelectedSuggestions?: (ids: string[], onContentChange: (content: string) => void) => Promise<void>;
}

/**
 * NewCardInput
 * 
 * Input for creating a new card.
 * id and createdAt are generated automatically.
 */
export interface NewCardInput {
  type: CardType;
  content: string;
  position: Position;
  linkedText?: LinkedText | null;
  status?: CardStatus;
}

// =============================================================================
// Component Props
// =============================================================================

export interface CanvasOverlayProps {
  storyId: string;
  segmentId: string;
  segmentTitle: string;
  segmentContent: string;
  onClose: () => void;
  onContentChange: (newContent: string) => void;
  // Navigation
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  // Story context for AI
  storyData?: StoryData;
}

export interface CanvasWorkspaceProps {
  segmentId: string;
  segmentTitle: string;
  segmentContent: string;
  cards: CanvasCard[];
  onAddCard: (card: NewCardInput) => void;
  onUpdateCard: (id: string, updates: Partial<CanvasCard>) => void;
  onRemoveCard: (id: string) => void;
  onMoveCard: (id: string, position: Position) => void;
  onApplySuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  onRequestSuggestions: (selectedText?: LinkedText, guidance?: string) => void;
  onContentChange: (newContent: string) => void;
  isRequestingSuggestions: boolean;
  // Revision - updated to include guidance parameter
  onGenerateRevision: (targetText: LinkedText | null, guidance: string) => void;
  onTriggerRevisionPanel: (targetText: LinkedText | null) => void;
  revisionPending?: {
    originalContent: string;
    revisedContent: string;
    targetText: LinkedText | null;
  } | null;
  onApplyRevision?: () => void;
  onRevertRevision?: () => void;
  // External trigger to open panel with a specific target
  externalRevisionTarget?: LinkedText | null;
  onClearExternalTarget?: () => void;
  // AI session (optional - for real API integration)
  sessionId?: string | null;
  onRegenerateSuggestions?: () => Promise<void>;
  onApplySelectedSuggestions?: (ids: string[]) => void;
}

export interface SegmentContentBlockProps {
  segmentId: string;
  segmentTitle: string;
  content: string;
  cards: CanvasCard[];
  onTextSelect: (linkedText: LinkedText, position: Position) => void;
  onContentChange: (newContent: string) => void;
  // Revision - updated to include guidance parameter
  onGenerateRevision: (targetText: LinkedText | null, guidance: string) => void;
  revisionPending?: {
    originalContent: string;
    revisedContent: string;
    targetText: LinkedText | null;
  } | null;
  onApplyRevision?: () => void;
  onRevertRevision?: () => void;
  // External trigger to open panel with a specific target
  externalRevisionTarget?: LinkedText | null;
  onClearExternalTarget?: () => void;
}

export interface DraggableCardProps {
  card: CanvasCard;
  onMove: (position: Position) => void;
  onUpdate: (updates: Partial<CanvasCard>) => void;
  onRemove: () => void;
  onApply?: () => void;    // For suggestions
  onDismiss?: () => void;  // For suggestions
}

export interface SelectionPopupProps {
  position: Position;
  selectedText: LinkedText;
  onRevise: () => void;
  onPin: () => void;
  onClose: () => void;
}

export interface CanvasToolbarProps {
  onAddCard: () => void;
  onRequestSuggestions: () => void;
  isRequestingSuggestions: boolean;
  isDirty: boolean;
}

// =============================================================================
// Revision Types
// =============================================================================

export interface RevisionState {
  isOpen: boolean;
  targetText: LinkedText | null; // null means whole segment
  originalContent: string;
  revisedContent: string | null;
  guidance: string;
  isGenerating: boolean;
  isPending: boolean; // true when revision is shown but not yet applied
}