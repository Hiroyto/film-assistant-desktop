/**
 * CanvasOverlay
 * 
 * Full-screen overlay for segment canvas mode.
 * Renders as a portal at document root level.
 * Handles zoom in/out animations on enter/exit.
 * 
 * ✨ Now computes hasContent to disable AI features when canvas is empty.
 */

import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Component1Icon } from '@radix-ui/react-icons';
import { CanvasOverlayProps, LinkedText } from './types';
import { useCanvasState } from './useCanvasState';
import CanvasWorkspace from './CanvasWorkspace';
import { UserContext } from '../../App';
import { useAIModel, useSelectedModelId } from '../AIModelContext';
import { ModelSelector } from '../ModelSelector';

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: '#1a1a1e',
    transition: 'opacity 0.4s ease',
  },
  
  overlayEntering: {
    opacity: 0,
  },
  
  overlayActive: {
    opacity: 1,
  },
  
  overlayExiting: {
    opacity: 0,
  },
  
  dottedGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'radial-gradient(circle, rgba(255, 140, 0, 0.15) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
    pointerEvents: 'none',
    opacity: 0,
    transition: 'opacity 0.6s ease 0.2s',
  },
  
  dottedGridActive: {
    opacity: 1,
  },
  
  vignette: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.4) 100%)',
    pointerEvents: 'none',
  },
  
  floatingHeader: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%) translateY(-20px)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    background: 'rgba(30, 30, 36, 0.9)',
    border: '1px solid rgba(255, 107, 53, 0.3)',
    borderRadius: 12,
    padding: '0.75rem 1.25rem',
    backdropFilter: 'blur(12px)',
    zIndex: 100,
    opacity: 0,
    transition: 'opacity 0.3s ease 0.3s, transform 0.3s ease 0.3s',
  },
  
  floatingHeaderActive: {
    opacity: 1,
    transform: 'translateX(-50%) translateY(0)',
  },
  
  segmentBadge: {
    background: '#ff6b35',
    color: 'white',
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 13,
  },
  
  segmentTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#fff',
  },
  
  focusBadge: {
    background: 'rgba(139, 92, 246, 0.2)',
    color: '#a78bfa',
    padding: '0.2rem 0.6rem',
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  navArrowsContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginLeft: '0.75rem',
  },
  
  navArrowButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    padding: 0,
  },
  
  navArrowButtonDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },

  leftButtonGroup: {
    position: 'absolute',
    top: 20,
    left: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    zIndex: 100,
    opacity: 0,
    transform: 'translateY(-10px)',
    transition: 'opacity 0.3s ease 0.3s, transform 0.3s ease 0.3s',
  },
  
  leftButtonGroupActive: {
    opacity: 1,
    transform: 'translateY(0)',
  },

  exitButton: {
    padding: '0.6rem 1rem',
    background: 'rgba(30, 30, 36, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'background 0.2s, border-color 0.2s',
  },
  
  discardButton: {
    padding: '0.6rem 1rem',
    background: 'rgba(30, 30, 36, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'background 0.2s, border-color 0.2s, color 0.2s',
  },
  
  rightButtonGroup: {
    position: 'absolute',
    top: 20,
    right: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    zIndex: 100,
    opacity: 0,
    transform: 'translateY(-10px)',
    transition: 'opacity 0.3s ease 0.3s, transform 0.3s ease 0.3s',
  },
  
  rightButtonGroupActive: {
    opacity: 1,
    transform: 'translateY(0)',
  },
  
  divider: {
    width: 1,
    height: 28,
    background: 'rgba(255, 255, 255, 0.1)',
  },
  
  tokenCounter: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)',
    padding: '0.6rem 1.2rem',
    borderRadius: 20,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'default',
  },
  
  tokenCount: {
    color: '#ff6b35',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  
  tokenLabel: {
    color: '#b0b0b0',
    fontSize: '0.8rem',
    fontWeight: 400,
    letterSpacing: '0.02em',
  },
  
  savingIndicator: {
    position: 'absolute',
    top: 24,
    left: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    zIndex: 100,
  },
  
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255, 255, 255, 0.2)',
    borderTopColor: '#ff6b35',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// =============================================================================
// Extended Props Interface
// =============================================================================

interface StoryData {
  brainstorm?: string;
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

interface ExtendedCanvasOverlayProps extends CanvasOverlayProps {
  storyData?: StoryData;
}

// =============================================================================
// Component
// =============================================================================

type AnimationState = 'entering' | 'active' | 'exiting' | 'exited';

const CanvasOverlay: React.FC<ExtendedCanvasOverlayProps> = ({
  storyId,
  segmentId,
  segmentTitle,
  segmentContent,
  onClose,
  onContentChange,
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
  storyData = {},
}) => {
  const { user, token, setUser } = useContext(UserContext);
  const { getModelForAPI, setModelOverride } = useAIModel();
  const selectedModelId = useSelectedModelId();
  const [animationState, setAnimationState] = useState<AnimationState>('entering');
  const [localContent, setLocalContent] = useState(segmentContent);
  
  // Revision state
  const [revisionPending, setRevisionPending] = useState<{
    originalContent: string;
    revisedContent: string;
    targetText: LinkedText | null;
  } | null>(null);
  
  const [externalRevisionTarget, setExternalRevisionTarget] = useState<LinkedText | null>(null);
  
  // Sync localContent when segment changes
  useEffect(() => {
    setLocalContent(segmentContent);
    setRevisionPending(null);
    setExternalRevisionTarget(null);
  }, [segmentId, segmentContent]);
  
  const segmentBadgeText = segmentId === 'SUM' ? 'S' : segmentId.replace('S', '');
  const displayTitle = segmentId === 'SUM' ? 'Story Preview' : segmentTitle;
  
  // Token update callback - updates global user.cap
  const handleTokenUpdate = useCallback((newBalance: number) => {
    console.log('💰 Canvas updating token balance:', newBalance);
    if (setUser) {
      setUser((prevUser: any) => ({ ...prevUser, cap: newBalance }));
    }
  }, [setUser]);
  
  // Model change handler
  const handleModelChange = useCallback((modelId: string) => {
    setModelOverride(modelId === 'default' ? null : modelId);
  }, [setModelOverride]);
  
  // Canvas state hook with token update callback and model override
  const {
    cards,
    isLoading,
    isSaving,
    isDirty,
    error,
    addCard,
    updateCard,
    removeCard,
    moveCard,
    applySuggestion,
    dismissSuggestion,
    saveCanvas,
    clearCanvas,
    requestSuggestions,
    isRequestingSuggestions,
    sessionId,
    regenerateSuggestions,
    applySelectedSuggestions,
    // Revert functionality
    canRevert,
    revertLastChange,
    historyLength,
    // Apply feedback state
    isApplyingSuggestion,
    // Pending revision approval
    pendingRevision,
    acceptRevision,
    retryRevision,
    dismissRevision,
    // Direct revision (intern flow)
    generateDirectRevision,
  } = useCanvasState({
    storyId,
    segmentId,
    userId: token?.payload?.['cognito:username'] as string || 'anonymous',
    segmentContent: localContent,
    storyData,
    token,
    onTokenUpdate: handleTokenUpdate,
    modelOverride: getModelForAPI(),
  });
  
  // ==========================================================================
  // ✨ NEW: Compute hasContent for AI feature gating
  // ==========================================================================
  
  /**
   * Determines if there's enough content for AI features to work with.
   * 
   * Content is considered present if:
   * 1. There are non-note cards with actual content, OR
   * 2. The segment content itself has meaningful text
   * 
   * This prevents broken AI calls when the canvas is empty.
   */
  const hasContent = useMemo(() => {
    // Check if there are any non-note cards with content
    const hasCardContent = cards.some(card => {
      // Skip note cards - they're for user reference, not AI input
      if (card.type === 'note') return false;
      
      // Check if card has meaningful content
      const content = card.content || '';
      return content.trim().length > 0;
    });
    
    // Check if the segment content itself has content
    const hasSegmentContent = (localContent?.trim().length || 0) > 0;
    
    // Either source of content is sufficient
    return hasCardContent || hasSegmentContent;
  }, [cards, localContent]);
  
  /**
   * Custom message for the disabled state based on context
   */
  const disabledMessage = useMemo(() => {
    if (segmentId === 'SUM') {
      return 'Write some synopsis content or add outline cards before requesting AI suggestions.';
    }
    return 'Add content to this segment before requesting AI suggestions. The AI needs something to analyze and improve.';
  }, [segmentId]);
  
  // ==========================================================================
  // Content change handler
  // ==========================================================================
  
  const handleContentChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
  }, []);
  
  // ==========================================================================
  // Revert handler
  // ==========================================================================
  
  const handleRevert = useCallback(() => {
    revertLastChange((previousContent) => {
      setLocalContent(previousContent);
      onContentChange(previousContent);
    });
  }, [revertLastChange, onContentChange]);
  
  // ==========================================================================
  // Revision handlers
  // ==========================================================================
  
  const handleOpenRevisionPanel = useCallback((targetText: LinkedText | null) => {
    setExternalRevisionTarget(targetText);
  }, []);
  
  const handleClearExternalTarget = useCallback(() => {
    setExternalRevisionTarget(null);
  }, []);
  
  const handleGenerateRevision = useCallback(async (targetText: LinkedText | null, guidance: string) => {
    // Call the real API via generateDirectRevision
    await generateDirectRevision(guidance, targetText, handleContentChange);
  }, [generateDirectRevision, handleContentChange]);
  
  // Legacy handlers for old revisionPending flow - can be removed once fully migrated
  const handleApplyRevision = useCallback(() => {
    if (revisionPending) {
      setLocalContent(revisionPending.revisedContent);
      onContentChange(revisionPending.revisedContent);
      setRevisionPending(null);
    }
  }, [revisionPending, onContentChange]);
  
  const handleRevertRevision = useCallback(() => {
    setRevisionPending(null);
  }, []);
  
  // ==========================================================================
  // Suggestion handlers
  // ==========================================================================
  
  const handleApplySuggestion = useCallback((id: string) => {
    const newContent = applySuggestion(id);
    if (newContent !== localContent) {
      setLocalContent(newContent);
    }
  }, [applySuggestion, localContent]);
  
  const handleApplySelectedSuggestions = useCallback((ids: string[]) => {
    applySelectedSuggestions(ids, (newContent) => {
      setLocalContent(newContent);
      onContentChange(newContent);
    });
  }, [applySelectedSuggestions, onContentChange]);
  
  // ==========================================================================
  // Pending revision approval handlers
  // ==========================================================================
  
  const handleAcceptRevision = useCallback(() => {
    acceptRevision((newContent) => {
      setLocalContent(newContent);
      onContentChange(newContent);
    });
  }, [acceptRevision, onContentChange]);
  
  const handleRetryRevision = useCallback(async () => {
    await retryRevision();
  }, [retryRevision]);
  
  const handleDismissRevision = useCallback(() => {
    dismissRevision();
  }, [dismissRevision]);
  
  // ==========================================================================
  // Animation handling
  // ==========================================================================
  
  useEffect(() => {
    const enterTimer = setTimeout(() => {
      setAnimationState('active');
    }, 50);
    
    return () => clearTimeout(enterTimer);
  }, []);
  
  const handleExit = useCallback(async (save: boolean = true) => {
    if (revisionPending) {
      setRevisionPending(null);
    }
    
    if (save && isDirty) {
      try {
        await saveCanvas();
      } catch (err) {
        const confirmExit = window.confirm(
          'Failed to save changes. Exit anyway? Your changes will be preserved locally.'
        );
        if (!confirmExit) return;
      }
    }
    
    if (localContent !== segmentContent) {
      onContentChange(localContent);
    }
    
    setAnimationState('exiting');
    
    setTimeout(() => {
      setAnimationState('exited');
      onClose();
    }, 400);
  }, [isDirty, saveCanvas, localContent, segmentContent, onContentChange, onClose, revisionPending]);
  
  const handleDiscard = useCallback(() => {
    const confirmDiscard = window.confirm(
      'Discard all changes to this canvas? This cannot be undone.'
    );
    if (confirmDiscard) {
      handleExit(false);
    }
  }, [handleExit]);
  
  // ==========================================================================
  // Keyboard handling
  // ==========================================================================
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit(true);
      }
      // Ctrl/Cmd + Z for revert
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && canRevert) {
        e.preventDefault();
        handleRevert();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExit, canRevert, handleRevert]);
  
  // ==========================================================================
  // Render
  // ==========================================================================
  
  const isActive = animationState === 'active';
  
  const overlayContent = (
    <div
      style={{
        ...styles.overlay,
        ...(animationState === 'entering' ? styles.overlayEntering : {}),
        ...(animationState === 'active' ? styles.overlayActive : {}),
        ...(animationState === 'exiting' ? styles.overlayExiting : {}),
      }}
    >
      {/* Dotted grid background */}
      <div
        style={{
          ...styles.dottedGrid,
          ...(isActive ? styles.dottedGridActive : {}),
        }}
      />
      <div style={styles.vignette} />
      
      {/* Floating header */}
      <div
        style={{
          ...styles.floatingHeader,
          ...(isActive ? styles.floatingHeaderActive : {}),
        }}
      >
        <div style={styles.segmentBadge}>{segmentBadgeText}</div>
        <span style={styles.segmentTitle}>{displayTitle}</span>
        <span style={styles.focusBadge}>Canvas Mode</span>
        
        {/* Navigation Arrows */}
        <div style={styles.navArrowsContainer}>
          <button
            style={{
              ...styles.navArrowButton,
              ...(hasPrev ? {} : styles.navArrowButtonDisabled),
            }}
            onClick={() => hasPrev && onNavigatePrev?.()}
            disabled={!hasPrev}
            title="Previous segment"
            onMouseEnter={(e) => {
              if (hasPrev) {
                e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)';
                e.currentTarget.style.color = '#ff8c42';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path d="M9.5 3.5L5.5 7.5L9.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            style={{
              ...styles.navArrowButton,
              ...(hasNext ? {} : styles.navArrowButtonDisabled),
            }}
            onClick={() => hasNext && onNavigateNext?.()}
            disabled={!hasNext}
            title="Next segment"
            onMouseEnter={(e) => {
              if (hasNext) {
                e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)';
                e.currentTarget.style.color = '#ff8c42';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path d="M5.5 3.5L9.5 7.5L5.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Right button group - Model selector + Token counter */}
      <div
        style={{
          ...styles.rightButtonGroup,
          ...(isActive ? styles.rightButtonGroupActive : {}),
        }}
      >
        <ModelSelector
          selectedModel={selectedModelId}
          onModelChange={handleModelChange}
        />
        
        <div style={styles.divider} />
        
        <div style={styles.tokenCounter}>
          <span style={styles.tokenCount}>
            <Component1Icon />
            {user?.cap ?? 0}
          </span>
          <span style={styles.tokenLabel}>
            Tokens Remaining
          </span>
        </div>
      </div>
      
      {/* Left button group - Save/Exit + Discard + Revert */}
      <div
        style={{
          ...styles.leftButtonGroup,
          ...(isActive ? styles.leftButtonGroupActive : {}),
        }}
      >
        {/* Exit/Save button */}
        <button
          style={styles.exitButton}
          onClick={() => handleExit(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)';
            e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(30, 30, 36, 0.9)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
          }}
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
            <path
              d="M11.7 4.3L4.3 11.7M4.3 4.3l7.4 7.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {isDirty ? 'Save & Exit' : 'Exit'}
        </button>
        
        {/* Revert button - only when there's history */}
        {canRevert && (
          <button
            style={{
              ...styles.discardButton,
              color: '#f59e0b',
              borderColor: 'rgba(245, 158, 11, 0.3)',
            }}
            onClick={handleRevert}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)';
              e.currentTarget.style.color = '#fbbf24';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(30, 30, 36, 0.9)';
              e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)';
              e.currentTarget.style.color = '#f59e0b';
            }}
            title={`Undo last change (${historyLength} in history) - Ctrl+Z`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Undo
          </button>
        )}
        
        {/* Discard button - only when dirty */}
        {isDirty && (
          <button
            style={styles.discardButton}
            onClick={handleDiscard}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
              e.currentTarget.style.color = '#f87171';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(30, 30, 36, 0.9)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            }}
          >
            Discard
          </button>
        )}
        
        {/* Saving indicator */}
        {isSaving && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
            <div style={styles.spinner} />
            <span>Saving...</span>
          </div>
        )}
      </div>
      
      {/* Main workspace - now with hasContent prop */}
      {!isLoading && (
        <CanvasWorkspace
          segmentId={segmentId}
          segmentTitle={segmentTitle}
          segmentContent={localContent}
          cards={cards}
          onAddCard={addCard}
          onUpdateCard={updateCard}
          onRemoveCard={removeCard}
          onMoveCard={moveCard}
          onApplySuggestion={handleApplySuggestion}
          onDismissSuggestion={dismissSuggestion}
          onRequestSuggestions={requestSuggestions}
          onContentChange={handleContentChange}
          isRequestingSuggestions={isRequestingSuggestions}
          onGenerateRevision={handleGenerateRevision}
          onTriggerRevisionPanel={handleOpenRevisionPanel}
          revisionPending={revisionPending}
          onApplyRevision={handleApplyRevision}
          onRevertRevision={handleRevertRevision}
          externalRevisionTarget={externalRevisionTarget}
          onClearExternalTarget={handleClearExternalTarget}
          // AI props
          sessionId={sessionId}
          onRegenerateSuggestions={regenerateSuggestions}
          onApplySelectedSuggestions={handleApplySelectedSuggestions}
          // Revert props
          canRevert={canRevert}
          onRevert={handleRevert}
          historyLength={historyLength}
          // Apply feedback state
          isApplyingSuggestion={isApplyingSuggestion}
          // Pending revision approval
          pendingRevision={pendingRevision}
          onAcceptRevision={handleAcceptRevision}
          onRetryRevision={handleRetryRevision}
          onDismissRevision={handleDismissRevision}
          // ✨ Content check props - disable AI when no content
          hasContent={hasContent}
          disabledMessage={disabledMessage}
        />
      )}
      
      {/* Loading state - Skeleton UI */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          {/* Skeleton Content Block */}
          <div
            style={{
              width: segmentId === 'SUM' ? 800 : 700,
              background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.6) 0%, rgba(50, 50, 58, 0.6) 100%)',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Skeleton Header */}
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              {/* Title skeleton */}
              <div
                style={{
                  width: 120,
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 107, 53, 0.15) 0%, rgba(255, 107, 53, 0.25) 50%, rgba(255, 107, 53, 0.15) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                }}
              />
            </div>
            
            {/* Skeleton Content Area */}
            <div style={{ padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Skeleton text lines */}
              <div
                style={{
                  width: '100%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                }}
              />
              <div
                style={{
                  width: '92%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.1s',
                }}
              />
              <div
                style={{
                  width: '85%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.2s',
                }}
              />
              <div
                style={{
                  width: '96%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.3s',
                }}
              />
              <div
                style={{
                  width: '78%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.4s',
                }}
              />
              <div
                style={{
                  width: '88%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.5s',
                }}
              />
              <div
                style={{
                  width: '65%',
                  height: 14,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: '0.6s',
                }}
              />
              
              {/* Loading indicator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  marginTop: '1.5rem',
                  paddingTop: '1.5rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    border: '2px solid rgba(255, 107, 53, 0.2)',
                    borderTopColor: '#ff6b35',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 13, fontWeight: 500 }}>
                  Loading canvas...
                </span>
              </div>
            </div>
          </div>
          
          {/* Skeleton Toolbar */}
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: 'rgba(30, 30, 36, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '0.6rem 1rem',
            }}
          >
            {/* Skeleton buttons */}
            <div
              style={{
                width: 90,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.05) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s ease-in-out infinite',
              }}
            />
            <div style={{ width: 1, height: 24, background: 'rgba(255, 255, 255, 0.08)' }} />
            <div
              style={{
                width: 140,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.2) 50%, rgba(139, 92, 246, 0.1) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s ease-in-out infinite',
                animationDelay: '0.2s',
              }}
            />
            <div style={{ width: 1, height: 24, background: 'rgba(255, 255, 255, 0.08)' }} />
            <div
              style={{
                width: 50,
                height: 14,
                borderRadius: 4,
                background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.06) 50%, rgba(255, 255, 255, 0.03) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s ease-in-out infinite',
                animationDelay: '0.4s',
              }}
            />
          </div>
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(239, 68, 68, 0.9)',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      
      {/* Keyframes for animations */}
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes pendingPulse {
            0%, 100% { box-shadow: inset 0 0 20px rgba(6, 182, 212, 0.1), 0 0 15px rgba(6, 182, 212, 0.2); }
            50% { box-shadow: inset 0 0 30px rgba(6, 182, 212, 0.15), 0 0 25px rgba(6, 182, 212, 0.3); }
          }
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
  
  return createPortal(overlayContent, document.body);
};

export default CanvasOverlay;