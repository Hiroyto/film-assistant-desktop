/**
 * CanvasWorkspace
 * 
 * The main workspace area inside the canvas overlay.
 * Contains:
 * - Anchored segment content block (center)
 * - Floating draggable cards (notes/constraints)
 * - Static suggestion cards (docked right of segment block, multi-select)
 * - Selection popup for text interactions
 * - Bottom toolbar
 * 
 * Now includes hasContent prop to disable AI features when canvas is empty.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  CanvasWorkspaceProps,
  CanvasCard,
  LinkedText,
  Position,
  NewCardInput,
  CardType,
} from './types';
import SegmentContentBlock from './SegmentContentBlock';
import DraggableCard from './DraggableCard';
import SelectionPopup from './SelectionPopup';
import CanvasToolbar from './CanvasToolbar';

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  workspace: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
  },
  
  cardsContainer: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  
  cardWrapper: {
    position: 'absolute',
    pointerEvents: 'auto',
  },
};

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CARD_CONTENT: Record<'note' , string> = {
  note: '',
};

// =============================================================================
// Extended Props Interface
// =============================================================================

// Pending revision type (matches useCanvasState)
interface PendingRevisionApproval {
  replacement: string;
  selectionBounds: { start: number; end: number } | null;
  direction: string;
  sessionId: string;
  originalContent: string;
  selectedSuggestionIds: string[];
}

interface ExtendedCanvasWorkspaceProps extends CanvasWorkspaceProps {
  // AI session props
  sessionId?: string | null;
  onRegenerateSuggestions?: () => Promise<void>;
  onApplySelectedSuggestions?: (ids: string[]) => void;
  // Revert props
  canRevert?: boolean;
  onRevert?: () => void;
  historyLength?: number;
  // Apply feedback state
  isApplyingSuggestion?: boolean;
  // Pending revision approval
  pendingRevision?: PendingRevisionApproval | null;
  onAcceptRevision?: () => void;
  onRetryRevision?: () => Promise<void>;
  onDismissRevision?: () => void;
  /**
   * Content check - disables AI features when no content exists.
   * Passed through to CanvasToolbar.
   */
  hasContent?: boolean;
  /**
   * Custom message to show when AI features are disabled.
   * Passed through to CanvasToolbar.
   */
  disabledMessage?: string;
}

// =============================================================================
// Component
// =============================================================================

const CanvasWorkspace: React.FC<ExtendedCanvasWorkspaceProps> = ({
  segmentId,
  segmentTitle,
  segmentContent,
  cards,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
  onMoveCard,
  onApplySuggestion,
  onDismissSuggestion,
  onRequestSuggestions,
  onContentChange,
  isRequestingSuggestions,
  onGenerateRevision,
  onTriggerRevisionPanel,
  revisionPending = null,
  onApplyRevision,
  onRevertRevision,
  externalRevisionTarget,
  onClearExternalTarget,
  // New AI props
  sessionId = null,
  onRegenerateSuggestions,
  onApplySelectedSuggestions,
  // Revert props
  canRevert = false,
  onRevert,
  historyLength = 0,
  // Apply feedback state
  isApplyingSuggestion = false,
  // Pending revision approval
  pendingRevision = null,
  onAcceptRevision,
  onRetryRevision,
  onDismissRevision,
  // Content check props - pass through to toolbar
  hasContent = true,
  disabledMessage,
}) => {
  // ============================================================================
  // Selection state (for text selection popup)
  // ============================================================================
  
  const [selectedText, setSelectedText] = useState<LinkedText | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<Position | null>(null);
  
  // ============================================================================
  // Suggestion state
  // ============================================================================
  
  const [suggestionTarget, setSuggestionTarget] = useState<LinkedText | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [showSuggestionCards, setShowSuggestionCards] = useState(false);
  const [suggestionGuidance, setSuggestionGuidance] = useState<string | null>(null);
  
  // ============================================================================
  // Other state
  // ============================================================================
  
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [newCardType, setNewCardType] = useState<'note' | null>(null);
  
  // Workspace ref for positioning
  const workspaceRef = useRef<HTMLDivElement>(null);
  
  // ============================================================================
  // Filter cards by type
  // ============================================================================
  
  // Draggable cards (notes and constraints only)
  const visibleCards = cards.filter(
    (card) => card.status !== 'dismissed' && card.type !== 'suggestion'
  );
  
  // Suggestion cards (static, shown in SegmentContentBlock)
  const suggestionCards = cards.filter(
    (card) => card.type === 'suggestion' && card.status !== 'dismissed'
  );
  
  // ============================================================================
  // Wrapped accept handler - clears suggestion target after accepting
  // ============================================================================
  
  const handleAcceptRevision = useCallback(() => {
    if (onAcceptRevision) {
      onAcceptRevision();
    }
    // Clear suggestion UI after accepting
    setSuggestionTarget(null);
    setSuggestionGuidance(null);
    setShowSuggestionCards(false);
  }, [onAcceptRevision]);

  // ============================================================================
  // Effect: Sync with parent's isRequestingSuggestions
  // ============================================================================
  
  useEffect(() => {
    // When parent indicates suggestions are done loading, update local state
    if (!isRequestingSuggestions && isSuggesting) {
      setIsSuggesting(false);
    }
  }, [isRequestingSuggestions, isSuggesting]);
  
  // ============================================================================
  // Effect: Show suggestion cards when we have suggestions
  // ============================================================================
  
  useEffect(() => {
    // When suggestions arrive, show the cards
    if (suggestionCards.length > 0 && !showSuggestionCards && !isRequestingSuggestions) {
      setShowSuggestionCards(true);
    }
  }, [suggestionCards.length, showSuggestionCards, isRequestingSuggestions]);
  
  // ============================================================================
  // Effect: Hide suggestion cards when applying suggestion
  // ============================================================================
  
  // Track previous applying state to detect when apply completes
  const prevIsApplyingRef = useRef(isApplyingSuggestion);
  // Store the suggestion target when apply starts so it persists through re-renders
  const applyingTargetRef = useRef<LinkedText | null>(null);
  
  useEffect(() => {
    // When we start applying, capture the current suggestion target
    // But DON'T hide suggestion cards - user can switch suggestions during review
    if (isApplyingSuggestion && !prevIsApplyingRef.current) {
      applyingTargetRef.current = suggestionTarget;
      // Note: We no longer hide cards here - they stay visible for switching
    }
    
    // When apply completes (was true, now false), check if we should clear
    // Only clear if there's no pending revision (meaning accept was called)
    if (prevIsApplyingRef.current && !isApplyingSuggestion && !pendingRevision) {
      setSuggestionTarget(null);
      setSuggestionGuidance(null);
      applyingTargetRef.current = null;
      setShowSuggestionCards(false);
    }
    
    prevIsApplyingRef.current = isApplyingSuggestion;
  }, [isApplyingSuggestion, suggestionTarget, pendingRevision]);
  
  
  // ============================================================================
  // Text selection handling
  // ============================================================================
  
  const handleTextSelect = useCallback((linkedText: LinkedText, position: Position) => {
    setSelectedText(linkedText);
    setSelectionPosition(position);
  }, []);
  
  const handleClosePopup = useCallback(() => {
    setSelectedText(null);
    setSelectionPosition(null);
  }, []);
  
  // ============================================================================
  // Suggestion target handlers
  // ============================================================================
  
  const handleSetSuggestionTarget = useCallback((linkedText: LinkedText | null) => {
    setSuggestionTarget(linkedText);
  }, []);
  
  const handleClearSuggestionTarget = useCallback(() => {
    setSuggestionTarget(null);
  }, []);
  
  // ============================================================================
  // Popup actions
  // ============================================================================
  
  const handleRevise = useCallback(() => {
    if (selectedText) {
      onTriggerRevisionPanel(selectedText);
      handleClosePopup();
    }
  }, [selectedText, onTriggerRevisionPanel, handleClosePopup]);
  
  const handlePin = useCallback(() => {
    if (selectedText) {
      const newCard: NewCardInput = {
        type: 'note',
        content: `Regarding: "${selectedText.original}"`,
        position: {
          x: 100,
          y: 200 + cards.length * 20,
        },
        linkedText: selectedText,
      };
      onAddCard(newCard);
      handleClosePopup();
    }
  }, [selectedText, cards.length, onAddCard, handleClosePopup]);
  
  // ============================================================================
  // Suggestion handlers (from SelectionPopup)
  // ============================================================================
  
  const handleQuickSuggest = useCallback((linkedText: LinkedText) => {
    // Set target for purple highlighting
    setSuggestionTarget(linkedText);
    setIsSuggesting(true);
    setShowSuggestionCards(true);
    setSuggestionGuidance(null);
    
    // Call parent suggestion handler with the linked text
    onRequestSuggestions(linkedText);
    
    // Close popup but keep highlight
    handleClosePopup();
  }, [onRequestSuggestions, handleClosePopup]);
  
  const handleGuidedSuggest = useCallback((linkedText: LinkedText, guidance: string) => {
    // Set target for purple highlighting
    setSuggestionTarget(linkedText);
    setIsSuggesting(true);
    setShowSuggestionCards(true);
    setSuggestionGuidance(guidance);
    
    // Call parent suggestion handler with linked text and guidance
    onRequestSuggestions(linkedText, guidance);
    
    // Close popup but keep highlight
    handleClosePopup();
  }, [onRequestSuggestions, handleClosePopup]);
  
  // ============================================================================
  // Toolbar actions
  // ============================================================================
  
  const handleAddCard = useCallback((type: CardType = 'note') => {
    // Position cards to the left of the centered segment block
    // Synopsis (SUM) is 800px wide, other segments are 700px wide
    const segmentBlockWidth = segmentId === 'SUM' ? 800 : 700;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const segmentBlockLeft = (viewportWidth / 2) - (segmentBlockWidth / 2);
    
    // Stack cards vertically with offset for each new card
    const cardOffset = cards.filter(c => c.type !== 'suggestion').length;
    
    const newCard: NewCardInput = {
      type,
      content: DEFAULT_CARD_CONTENT[type as 'note' ] || '',
      position: {
        x: Math.max(20, segmentBlockLeft - 340), // 300px card width + 40px gap
        y: (viewportHeight / 2) - 150 + (cardOffset * 40), // Start near vertical center
      },
    };
    onAddCard(newCard);
  }, [cards, onAddCard, segmentId]);
  
  const handleRequestSuggestions = useCallback(() => {
    // Request general suggestions (whole segment, no specific target)
    setSuggestionTarget(null);
    setIsSuggesting(true);
    setShowSuggestionCards(true);
    setSuggestionGuidance(null);
    
    // Call without arguments for whole segment
    onRequestSuggestions();
  }, [onRequestSuggestions]);
  
  const handleRequestGuidedSuggestions = useCallback((guidance: string) => {
    // Request guided suggestions for whole segment
    setSuggestionTarget(null);
    setIsSuggesting(true);
    setShowSuggestionCards(true);
    setSuggestionGuidance(guidance);
    
    // Call with undefined for linkedText, but pass guidance
    onRequestSuggestions(undefined, guidance);
  }, [onRequestSuggestions]);
  
  // ============================================================================
  // Suggestion card handlers
  // ============================================================================
  
  const handleCloseSuggestions = useCallback(() => {
    setShowSuggestionCards(false);
    setIsSuggesting(false);
    setSuggestionTarget(null);
    setSuggestionGuidance(null);
  }, []);
  
  /**
   * Handle batch apply of selected suggestions
   * This receives an array of suggestion IDs that the user selected
   * Note: We don't call handleCloseSuggestions here - the suggestionTarget needs to persist
   * while isApplyingSuggestion is true so the inline skeleton shows on the selected text.
   * The suggestions will be cleared after the apply completes in useCanvasState.
   */
  const handleApplySelectedSuggestions = useCallback((ids: string[]) => {
    console.log('Applying selected suggestions:', ids);
    
    // Use the real API handler if available
    if (onApplySelectedSuggestions) {
      onApplySelectedSuggestions(ids);
      // Don't clear suggestions yet - wait for apply to complete
      // The suggestion cards are already hidden via isApplyingSuggestion
      setShowSuggestionCards(false);
      setIsSuggesting(false);
      return;
    }
    
    // Fallback to legacy behavior (individual applies)
    ids.forEach(id => {
      onApplySuggestion(id);
    });
    
    handleCloseSuggestions();
  }, [onApplySelectedSuggestions, onApplySuggestion, handleCloseSuggestions]);
  
  /**
   * Handle dismiss all suggestions
   */
  const handleDismissAllSuggestions = useCallback(() => {
    // Dismiss all suggestion cards
    suggestionCards.forEach(card => {
      onDismissSuggestion(card.id);
    });
    
    // Close suggestion cards
    handleCloseSuggestions();
  }, [suggestionCards, onDismissSuggestion, handleCloseSuggestions]);
  
  /**
   * Handle regenerate suggestions - use existing session if available
   */
  const handleRegenerateSuggestions = useCallback(async () => {
    // Use the real API regenerate if available and we have a session
    if (onRegenerateSuggestions && sessionId) {
      // Dismiss current suggestions first
      suggestionCards.forEach(card => {
        onDismissSuggestion(card.id);
      });
      
      setIsSuggesting(true);
      
      try {
        await onRegenerateSuggestions();
      } catch (err) {
        console.error('Failed to regenerate suggestions:', err);
        setIsSuggesting(false);
      }
      return;
    }
    
    // Fallback: dismiss current and request fresh suggestions
    suggestionCards.forEach(card => {
      onDismissSuggestion(card.id);
    });
    
    setIsSuggesting(true);
    
    // Request new suggestions with the current target (if any)
    if (suggestionTarget) {
      onRequestSuggestions(suggestionTarget, suggestionGuidance || undefined);
    } else {
      onRequestSuggestions(undefined, suggestionGuidance || undefined);
    }
  }, [
    onRegenerateSuggestions,
    sessionId,
    suggestionCards,
    onDismissSuggestion,
    onRequestSuggestions,
    suggestionTarget,
    suggestionGuidance,
  ]);
  
  // ============================================================================
  // Draggable card handlers (notes and constraints)
  // ============================================================================
  
  const handleCardMove = useCallback((id: string, position: Position) => {
    onMoveCard(id, position);
  }, [onMoveCard]);
  
  const handleCardUpdate = useCallback((id: string, updates: Partial<CanvasCard>) => {
    onUpdateCard(id, updates);
  }, [onUpdateCard]);
  
  const handleCardRemove = useCallback((id: string) => {
    onRemoveCard(id);
  }, [onRemoveCard]);
  
  // ============================================================================
  // Render
  // ============================================================================
  
  return (
    <div ref={workspaceRef} style={styles.workspace}>
      {/* Anchored segment content block with suggestion cards */}
      <SegmentContentBlock
        segmentId={segmentId}
        segmentTitle={segmentTitle}
        content={segmentContent}
        cards={cards}
        onTextSelect={handleTextSelect}
        onContentChange={onContentChange}
        onGenerateRevision={onGenerateRevision}
        revisionPending={revisionPending}
        onApplyRevision={onApplyRevision}
        onRevertRevision={onRevertRevision}
        externalRevisionTarget={externalRevisionTarget}
        onClearExternalTarget={onClearExternalTarget}
        // Suggestion props - use ref value when applying to prevent race conditions
        suggestionTarget={isApplyingSuggestion ? applyingTargetRef.current : suggestionTarget}
        isSuggesting={isSuggesting || isRequestingSuggestions}
        onClearSuggestionTarget={handleClearSuggestionTarget}
        suggestions={suggestionCards}
        showSuggestionCards={showSuggestionCards}
        onApplySelectedSuggestions={handleApplySelectedSuggestions}
        onDismissAllSuggestions={handleDismissAllSuggestions}
        onRegenerateSuggestions={handleRegenerateSuggestions}
        onCloseSuggestions={handleCloseSuggestions}
        // Apply feedback state
        isApplyingSuggestion={isApplyingSuggestion}
        // Pending revision approval
        pendingRevision={pendingRevision}
        onAcceptRevision={handleAcceptRevision}
        onRetryRevision={onRetryRevision}
        onDismissRevision={onDismissRevision}
      />
      
      {/* Floating cards container (notes and constraints only) */}
      <div style={styles.cardsContainer}>
        {visibleCards.map((card) => (
          <div
            key={card.id}
            style={{
              ...styles.cardWrapper,
              left: card.position.x,
              top: card.position.y,
              zIndex: 5,
            }}
          >
            <DraggableCard
              card={card}
              onMove={(position) => handleCardMove(card.id, position)}
              onUpdate={(updates) => handleCardUpdate(card.id, updates)}
              onRemove={() => handleCardRemove(card.id)}
            />
          </div>
        ))}
      </div>
      
      {/* Selection popup */}
      {selectedText && selectionPosition && (
        <SelectionPopup
          position={selectionPosition}
          selectedText={selectedText}
          linkedText={selectedText}
          onRevise={handleRevise}
          onPin={handlePin}
          onClose={handleClosePopup}
          // Suggestion handlers
          onSetSuggestionTarget={handleSetSuggestionTarget}
          onQuickSuggest={handleQuickSuggest}
          onGuidedSuggest={handleGuidedSuggest}
          isRequestingSuggestions={isRequestingSuggestions || isSuggesting}
        />
      )}
      
      {/* Bottom toolbar - now with hasContent prop */}
      <CanvasToolbar
        onAddCard={() => handleAddCard('note')}
        onAddCardWithType={handleAddCard}
        onRequestSuggestions={handleRequestSuggestions}
        onRequestGuidedSuggestions={handleRequestGuidedSuggestions}
        isRequestingSuggestions={isRequestingSuggestions || isSuggesting}
        isDirty={false}
        // Revert props
        canRevert={canRevert}
        onRevert={onRevert}
        historyLength={historyLength}
        // ✨ Content check props - disable AI when no content
        hasContent={hasContent}
        disabledMessage={disabledMessage}
      />
    </div>
  );
};

export default CanvasWorkspace;