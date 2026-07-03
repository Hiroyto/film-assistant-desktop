/**
 * CanvasToolbar
 * 
 * Fixed bottom toolbar in the canvas workspace.
 * Provides:
 * - Add Note button (creates new note card)
 * - Request AI Suggestions button (Quick or Guided modes)
 * - Undo button (revert last applied suggestion)
 * - Status indicator (draft/saved)
 * 
 * Guided mode transforms the toolbar into a textarea for user input.
 * 
 * Note: AI features are disabled when hasContent=false to prevent
 * broken behavior when there's nothing to analyze.
 */

import React, { useState, useRef, useEffect } from 'react';
import { CanvasToolbarProps, CardType } from './types';

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  toolbar: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: 'rgba(30, 30, 36, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: '0.6rem 1rem',
    backdropFilter: 'blur(12px)',
    zIndex: 100,
    transition: 'all 0.3s ease',
  },
  
  // Guided mode toolbar - expanded textarea view
  toolbarGuidedMode: {
    width: 500,
    padding: '0',
    background: 'rgba(30, 30, 36, 0.98)',
    border: '2px solid rgba(139, 92, 246, 0.5)',
    boxShadow: 'inset 0 0 20px rgba(139, 92, 246, 0.05), 0 0 30px rgba(139, 92, 246, 0.15)',
  },
  
  guidedContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  
  guidedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.6rem 0.75rem',
    borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
  },
  
  guidedTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: 11,
    fontWeight: 600,
    color: '#a78bfa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  closeButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: 'none',
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  
  guidedTextareaWrapper: {
    position: 'relative',
    padding: '0.75rem',
  },
  
  guidedTextarea: {
    width: '100%',
    minHeight: 80,
    padding: '0.5rem',
    paddingBottom: '2.5rem',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
  },
  
  guidedSubmitButton: {
    position: 'absolute',
    bottom: '0.75rem',
    right: '0.75rem',
    padding: '0.4rem 0.75rem',
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    border: 'none',
    borderRadius: 6,
    color: 'white',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    transition: 'all 0.2s ease',
  },
  
  guidedSubmitButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  
  button: {
    padding: '0.5rem 1rem',
    borderRadius: 8,
    border: 'none',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s',
  },
  
  addCardButton: {
    background: 'rgba(255, 255, 255, 0.08)',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  
  aiSuggestButton: {
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    color: 'white',
  },
  
  aiSuggestButtonLoading: {
    background: 'linear-gradient(135deg, #6b5ca0 0%, #5558b8 100%)',
    cursor: 'wait',
  },
  
  aiSuggestButtonDisabled: {
    background: 'rgba(139, 92, 246, 0.3)',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
  
  undoButton: {
    background: 'rgba(245, 158, 11, 0.15)',
    color: '#f59e0b',
    border: '1px solid rgba(245, 158, 11, 0.3)',
  },
  
  divider: {
    width: 1,
    height: 24,
    background: 'rgba(255, 255, 255, 0.1)',
  },
  
  status: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  
  statusDotDraft: {
    background: '#f59e0b',
  },
  
  statusDotSaved: {
    background: '#10b981',
  },
  
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: 'white',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  
  dropdownContainer: {
    position: 'relative',
  },
  
  dropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 8,
    background: 'rgba(30, 30, 36, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    padding: '0.25rem',
    minWidth: 180,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.15s',
    position: 'relative',
  },
  
  // Tooltip on RIGHT (for Suggestions dropdown)
  tooltipRight: {
    position: 'absolute',
    left: '100%',
    top: '50%',
    transform: 'translateY(-50%)',
    marginLeft: 12,
    padding: '0.6rem 0.75rem',
    background: 'rgba(20, 20, 26, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    width: 200,
    lineHeight: 1.5,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'none',
    zIndex: 10,
  },
  
  // Tooltip above button (for disabled state)
  tooltipAbove: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: 8,
    padding: '0.6rem 0.75rem',
    background: 'rgba(20, 20, 26, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    width: 220,
    lineHeight: 1.5,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'none',
    zIndex: 10,
    textAlign: 'center',
  },
  
  tooltipLabel: {
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  },
  
  historyBadge: {
    background: 'rgba(245, 158, 11, 0.3)',
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: 600,
    padding: '0.1rem 0.4rem',
    borderRadius: 10,
    marginLeft: 4,
  },
};

// =============================================================================
// Icons
// =============================================================================

const PlusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
    <path
      d="M7.5 1v13M1 7.5h13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const LightningIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const LightningIconSmall: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const PencilIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
    <path
      d="M11.854 1.146a.5.5 0 00-.708 0L3.5 8.793V11.5h2.707l7.647-7.646a.5.5 0 000-.708l-2-2z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
);

const UndoIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

// =============================================================================
// Extended Props Interface
// =============================================================================

interface ExtendedCanvasToolbarProps extends CanvasToolbarProps {
  onAddCardWithType?: (type: CardType) => void;
  onRequestGuidedSuggestions?: (guidance: string) => void;
  // Revert props
  canRevert?: boolean;
  onRevert?: () => void;
  historyLength?: number;
  /**
   * Content check - disables AI features when no content exists.
   * 
   * When false, the "Request Suggestions" button is disabled with a tooltip
   * explaining that content must be added first.
   * 
   * Parent component should compute this based on their content model:
   * - For outline canvas: cards.filter(c => c.type !== 'note' && c.content?.trim()).length > 0
   * - For segment editing: segmentContent?.trim().length > 0
   * 
   * Defaults to true for backwards compatibility.
   */
  hasContent?: boolean;
  /**
   * Custom message to show when AI features are disabled.
   * Defaults to generic "Add content first" message.
   */
  disabledMessage?: string;
}

// =============================================================================
// Component
// =============================================================================

const CanvasToolbar: React.FC<ExtendedCanvasToolbarProps> = ({
  onAddCard,
  onAddCardWithType,
  onRequestSuggestions,
  onRequestGuidedSuggestions,
  isRequestingSuggestions,
  isDirty,
  // Revert props
  canRevert = false,
  onRevert,
  historyLength = 0,
  // Content check - default to true for backwards compatibility
  hasContent = true,
  // Custom disabled message
  disabledMessage,
}) => {
  const [showSuggestDropdown, setShowSuggestDropdown] = useState(false);
  const [hoveredSuggestItem, setHoveredSuggestItem] = useState<'quick' | 'guided' | null>(null);
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [guidanceText, setGuidanceText] = useState('');
  const [showNoteTooltip, setShowNoteTooltip] = useState(false);
  const [showDisabledTooltip, setShowDisabledTooltip] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Determine if AI features should be disabled
  const isAIDisabled = !hasContent;
  
  // Focus textarea when entering guided mode
  useEffect(() => {
    if (isGuidedMode && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isGuidedMode]);
  
  // Reset guidance text when exiting guided mode
  useEffect(() => {
    if (!isGuidedMode) {
      setGuidanceText('');
    }
  }, [isGuidedMode]);
  
  // ==========================================================================
  // Handlers
  // ==========================================================================
  
  const handleAddNote = () => {
    if (onAddCardWithType) {
      onAddCardWithType('note');
    } else {
      onAddCard();
    }
  };
  
  const handleQuickSuggestions = () => {
    if (!isRequestingSuggestions && !isAIDisabled) {
      onRequestSuggestions();
    }
    setShowSuggestDropdown(false);
  };
  
  const handleOpenGuidedMode = () => {
    if (!isAIDisabled) {
      setIsGuidedMode(true);
      setShowSuggestDropdown(false);
    }
  };
  
  const handleCloseGuidedMode = () => {
    setIsGuidedMode(false);
  };
  
  const handleSubmitGuidedSuggestions = () => {
    if (!guidanceText.trim() || isRequestingSuggestions || isAIDisabled) return;
    
    if (onRequestGuidedSuggestions) {
      onRequestGuidedSuggestions(guidanceText.trim());
    } else {
      onRequestSuggestions();
    }
    setIsGuidedMode(false);
  };
  
  const handleGuidanceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      handleSubmitGuidedSuggestions();
    } else if (e.key === 'Escape') {
      handleCloseGuidedMode();
    }
  };
  
  const handleSuggestButtonClick = () => {
    if (isAIDisabled) {
      // Don't open dropdown, just show tooltip on hover
      return;
    }
    if (!isRequestingSuggestions) {
      setShowSuggestDropdown(!showSuggestDropdown);
    }
  };
  
  // ==========================================================================
  // Render - Guided Mode
  // ==========================================================================
  
  if (isGuidedMode) {
    return (
      <>
        <style>
          {`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}
        </style>
        
        <div style={{ ...styles.toolbar, ...styles.toolbarGuidedMode }}>
          <div style={styles.guidedContainer}>
            {/* Header */}
            <div style={styles.guidedHeader}>
              <div style={styles.guidedTitle}>
                <LightningIconSmall />
                Guided Suggestions
              </div>
              <button
                style={styles.closeButton}
                onClick={handleCloseGuidedMode}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                  <path
                    d="M11.7 4.3L4.3 11.7M4.3 4.3l7.4 7.4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            
            {/* Textarea with submit button */}
            <div style={styles.guidedTextareaWrapper}>
              <textarea
                ref={textareaRef}
                style={styles.guidedTextarea}
                value={guidanceText}
                onChange={(e) => setGuidanceText(e.target.value)}
                onKeyDown={handleGuidanceKeyDown}
                placeholder="What kind of suggestions are you looking for?"
                disabled={isRequestingSuggestions}
              />
              
              <button
                style={{
                  ...styles.guidedSubmitButton,
                  ...(!guidanceText.trim() || isRequestingSuggestions ? styles.guidedSubmitButtonDisabled : {}),
                }}
                onClick={handleSubmitGuidedSuggestions}
                disabled={!guidanceText.trim() || isRequestingSuggestions}
                onMouseEnter={(e) => {
                  if (guidanceText.trim() && !isRequestingSuggestions) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {isRequestingSuggestions ? (
                  <>
                    <div style={{ ...styles.spinner, width: 12, height: 12 }} />
                    Thinking...
                  </>
                ) : (
                  <>
                    <LightningIconSmall />
                    Request
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }
  
  // ==========================================================================
  // Render - Normal Mode
  // ==========================================================================
  
  return (
    <>
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      
      <div style={styles.toolbar}>
        {/* Add Note Button with Tooltip */}
        <div style={{ position: 'relative' }}>
          <button
            style={{ ...styles.button, ...styles.addCardButton }}
            onClick={handleAddNote}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = '#fff';
              setShowNoteTooltip(true);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              setShowNoteTooltip(false);
            }}
          >
            <PlusIcon />
            Add Note
          </button>
          
          {/* Note Tooltip */}
          {showNoteTooltip && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: 8,
              padding: '0.6rem 0.75rem',
              background: 'rgba(20, 20, 26, 0.98)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: 8,
              fontSize: 11,
              color: 'rgba(255, 255, 255, 0.7)',
              width: 200,
              lineHeight: 1.5,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              pointerEvents: 'none',
              zIndex: 10,
            }}>
              <span style={{ fontWeight: 600, marginBottom: 4, display: 'block', color: '#8b5cf6' }}>Consider this...</span>
              Context, references, or constraints for the AI to consider. Tonal anchors, thematic notes, inspiration.
            </div>
          )}
        </div>
        
        <div style={styles.divider} />
        
        {/* Request Suggestions Button with Dropdown */}
        <div style={styles.dropdownContainer as React.CSSProperties}>
          <button
            style={{
              ...styles.button,
              ...styles.aiSuggestButton,
              ...(isRequestingSuggestions ? styles.aiSuggestButtonLoading : {}),
              ...(isAIDisabled ? styles.aiSuggestButtonDisabled : {}),
            }}
            onClick={handleSuggestButtonClick}
            disabled={isRequestingSuggestions}
            onMouseEnter={(e) => {
              if (isAIDisabled) {
                setShowDisabledTooltip(true);
              } else if (!isRequestingSuggestions) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              setShowDisabledTooltip(false);
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {isRequestingSuggestions ? (
              <>
                <div style={styles.spinner} />
                Thinking...
              </>
            ) : (
              <>
                <LightningIcon />
                Request Suggestions
              </>
            )}
          </button>
          
          {/* Disabled State Tooltip */}
          {showDisabledTooltip && isAIDisabled && (
            <div style={styles.tooltipAbove}>
              <span style={{ ...styles.tooltipLabel, color: '#f59e0b' }}>Add content first</span>
              {disabledMessage || 'Create some outline cards before requesting AI suggestions. The AI needs something to analyze and improve.'}
            </div>
          )}
          
          {/* Suggestions Dropdown */}
          {showSuggestDropdown && !isAIDisabled && (
            <div style={styles.dropdown}>
              {/* Quick Option */}
              <button
                style={styles.dropdownItem}
                onClick={handleQuickSuggestions}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                  setHoveredSuggestItem('quick');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  setHoveredSuggestItem(null);
                }}
              >
                <span style={{ color: '#8b5cf6' }}>
                  <LightningIconSmall />
                </span>
                Quick
                
                {hoveredSuggestItem === 'quick' && (
                  <div style={{ ...styles.tooltipRight, borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                    <span style={{ ...styles.tooltipLabel, color: '#8b5cf6' }}>Instant analysis</span>
                    AI analyzes your segment and suggests improvements automatically.
                  </div>
                )}
              </button>
              
              {/* Guided Option */}
              <button
                style={styles.dropdownItem}
                onClick={handleOpenGuidedMode}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                  setHoveredSuggestItem('guided');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  setHoveredSuggestItem(null);
                }}
              >
                <span style={{ color: '#a78bfa' }}>
                  <PencilIcon />
                </span>
                Guided
                
                {hoveredSuggestItem === 'guided' && (
                  <div style={{ ...styles.tooltipRight, borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                    <span style={{ ...styles.tooltipLabel, color: '#a78bfa' }}>Tell the AI what you need</span>
                    Describe the kind of suggestions you're looking for in your own words.
                  </div>
                )}
              </button>
            </div>
          )}
        </div>
        
        {/* Undo Button - Only show when there's history */}
        {canRevert && onRevert && (
          <>
            <div style={styles.divider} />
            <button
              style={{ ...styles.button, ...styles.undoButton }}
              onClick={onRevert}
              title={`Undo last change (${historyLength} in history) - Ctrl+Z`}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(245, 158, 11, 0.25)';
                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.5)';
                e.currentTarget.style.color = '#fbbf24';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                e.currentTarget.style.color = '#f59e0b';
              }}
            >
              <UndoIcon />
              Undo
              {historyLength > 1 && (
                <span style={styles.historyBadge}>{historyLength}</span>
              )}
            </button>
          </>
        )}
        
        <div style={styles.divider} />
        
        {/* Status Indicator */}
        <div style={styles.status}>
          <div
            style={{
              ...styles.statusDot,
              ...(isDirty ? styles.statusDotDraft : styles.statusDotSaved),
            }}
          />
          {isDirty ? 'Draft' : 'Saved'}
        </div>
      </div>
      
      {/* Click outside to close dropdown */}
      {showSuggestDropdown && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99,
          }}
          onClick={() => {
            setShowSuggestDropdown(false);
          }}
        />
      )}
    </>
  );
};

export default CanvasToolbar;