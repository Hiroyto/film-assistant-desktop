/**
 * SelectionPopup
 * 
 * A small popup that appears when the user selects text in the segment content.
 * Provides two actions:
 * - Revise: Open revision panel for surgical AI editing
 * - Suggest: Request AI suggestions for the selected text (Quick or Guided)
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { SelectionPopupProps, LinkedText } from './types';

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  popup: {
    position: 'fixed',
    background: 'rgba(30, 30, 36, 0.95)',
    border: '1px solid rgba(6, 182, 212, 0.5)',
    borderRadius: 10,
    padding: '0.4rem',
    display: 'flex',
    gap: '0.4rem',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(12px)',
    zIndex: 200,
    animation: 'popIn 0.15s ease-out',
  },
  
  // Guided mode popup - expanded textarea view
  popupGuidedMode: {
    flexDirection: 'column',
    width: 340,
    padding: 0,
    border: '2px solid rgba(139, 92, 246, 0.5)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(139, 92, 246, 0.15)',
  },
  
  button: {
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  
  reviseButton: {
    background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    color: 'white',
  },
  
  suggestButton: {
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    color: 'white',
    position: 'relative',
  },
  
  // Dropdown for suggest options - BELOW
  suggestDropdown: {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: 8,
    background: 'rgba(30, 30, 36, 0.98)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: 8,
    padding: '0.25rem',
    minWidth: 140,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    zIndex: 210,
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
    fontSize: 11,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.15s',
    position: 'relative',
  },
  
  tooltip: {
    position: 'absolute',
    left: '100%',
    top: '50%',
    transform: 'translateY(-50%)',
    marginLeft: 12,
    padding: '0.6rem 0.75rem',
    background: 'rgba(20, 20, 26, 0.98)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: 8,
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    width: 180,
    lineHeight: 1.5,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'none',
    zIndex: 220,
  },
  
  tooltipLabel: {
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
    color: '#8b5cf6',
  },
  
  // Guided mode styles
  guidedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
  },
  
  guidedTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: 10,
    fontWeight: 600,
    color: '#a78bfa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  closeButton: {
    width: 20,
    height: 20,
    borderRadius: 4,
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
    padding: '0.5rem',
  },
  
  guidedTextarea: {
    width: '100%',
    minHeight: 60,
    padding: '0.5rem',
    paddingBottom: '2rem',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    resize: 'none',
    outline: 'none',
  },
  
  guidedSubmitButton: {
    position: 'absolute',
    bottom: '0.5rem',
    right: '0.5rem',
    padding: '0.35rem 0.6rem',
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    border: 'none',
    borderRadius: 5,
    color: 'white',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    transition: 'all 0.2s ease',
  },
  
  guidedSubmitButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  
  spinner: {
    width: 10,
    height: 10,
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// =============================================================================
// Icons
// =============================================================================

const InternIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
    <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const LightningIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const LightningIconSmall: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const PencilIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 15 15" fill="none">
    <path
      d="M11.854 1.146a.5.5 0 00-.708 0L3.5 8.793V11.5h2.707l7.647-7.646a.5.5 0 000-.708l-2-2z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
);

// =============================================================================
// Extended Props Interface
// =============================================================================

interface ExtendedSelectionPopupProps extends SelectionPopupProps {
  linkedText: LinkedText; // The actual LinkedText object for highlighting
  onQuickSuggest?: (linkedText: LinkedText) => void;
  onGuidedSuggest?: (linkedText: LinkedText, guidance: string) => void;
  onSetSuggestionTarget?: (linkedText: LinkedText | null) => void;
  isRequestingSuggestions?: boolean;
}

// =============================================================================
// Component
// =============================================================================

const SelectionPopup: React.FC<ExtendedSelectionPopupProps> = ({
  position,
  selectedText,
  linkedText,
  onRevise,
  onPin,
  onClose,
  onQuickSuggest,
  onGuidedSuggest,
  onSetSuggestionTarget,
  isRequestingSuggestions = false,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const [showSuggestDropdown, setShowSuggestDropdown] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<'quick' | 'guided' | null>(null);
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [guidanceText, setGuidanceText] = useState('');
  
  // ==========================================================================
  // Focus textarea when entering guided mode
  // ==========================================================================
  
  useEffect(() => {
    if (isGuidedMode && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isGuidedMode]);
  
  // ==========================================================================
  // Click outside to close
  // ==========================================================================
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        // Clear suggestion target when closing
        if (onSetSuggestionTarget) {
          onSetSuggestionTarget(null);
        }
        onClose();
      }
    };
    
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, onSetSuggestionTarget]);
  
  // ==========================================================================
  // Escape to close
  // ==========================================================================
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isGuidedMode) {
          setIsGuidedMode(false);
          setGuidanceText('');
          // Clear suggestion target when exiting guided mode
          if (onSetSuggestionTarget) {
            onSetSuggestionTarget(null);
          }
        } else {
          // Clear suggestion target when closing
          if (onSetSuggestionTarget) {
            onSetSuggestionTarget(null);
          }
          onClose();
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isGuidedMode, onSetSuggestionTarget]);
  
  // ==========================================================================
  // Position adjustment to stay in viewport
  // ==========================================================================
  
  const getAdjustedPosition = useCallback(() => {
    const padding = 16;
    const popupWidth = isGuidedMode ? 340 : 200;
    const popupHeight = isGuidedMode ? 140 : 44;
    
    let x = position.x;
    let y = position.y;
    
    if (x + popupWidth > window.innerWidth - padding) {
      x = window.innerWidth - popupWidth - padding;
    }
    if (x < padding) {
      x = padding;
    }
    
    if (y + popupHeight > window.innerHeight - padding) {
      y = position.y - popupHeight - 16;
    }
    
    return { x, y };
  }, [position, isGuidedMode]);
  
  const adjustedPosition = getAdjustedPosition();
  
  // ==========================================================================
  // Handlers
  // ==========================================================================
  
  const handleRevise = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRevise();
  }, [onRevise]);
  
  const handleSuggestClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSuggestDropdown(!showSuggestDropdown);
  }, [showSuggestDropdown]);
  
  const handleQuickSuggest = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Set the suggestion target for highlighting
    if (onSetSuggestionTarget) {
      onSetSuggestionTarget(linkedText);
    }
    if (onQuickSuggest) {
      onQuickSuggest(linkedText);
    } else {
      onPin();
    }
    setShowSuggestDropdown(false);
  }, [onPin, onQuickSuggest, linkedText, onSetSuggestionTarget]);
  
  const handleOpenGuidedMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Set the suggestion target for highlighting IMMEDIATELY when entering guided mode
    if (onSetSuggestionTarget) {
      onSetSuggestionTarget(linkedText);
    }
    setIsGuidedMode(true);
    setShowSuggestDropdown(false);
  }, [linkedText, onSetSuggestionTarget]);
  
  const handleCloseGuidedMode = useCallback(() => {
    setIsGuidedMode(false);
    setGuidanceText('');
    // Clear suggestion target when closing guided mode
    if (onSetSuggestionTarget) {
      onSetSuggestionTarget(null);
    }
  }, [onSetSuggestionTarget]);
  
  const handleSubmitGuidedSuggestion = useCallback(() => {
    if (!guidanceText.trim() || isRequestingSuggestions) return;
    
    if (onGuidedSuggest) {
      onGuidedSuggest(linkedText, guidanceText.trim());
    } else {
      onPin();
    }
    // Don't clear suggestion target - keep it highlighted while loading
    onClose();
  }, [guidanceText, isRequestingSuggestions, onGuidedSuggest, linkedText, onPin, onClose]);
  
  const handleGuidanceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      handleSubmitGuidedSuggestion();
    }
  }, [handleSubmitGuidedSuggestion]);
  
  // ==========================================================================
  // Render - Guided Mode
  // ==========================================================================
  
  if (isGuidedMode) {
    return (
      <>
        <style>
          {`
            @keyframes popIn {
              from {
                opacity: 0;
                transform: translateY(4px) scale(0.95);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}
        </style>
        
        <div
          ref={popupRef}
          style={{
            ...styles.popup,
            ...styles.popupGuidedMode,
            left: adjustedPosition.x,
            top: adjustedPosition.y,
          }}
        >
          {/* Header */}
          <div style={styles.guidedHeader}>
            <div style={styles.guidedTitle}>
              <LightningIconSmall />
              Guided Suggestion
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
              <svg width="10" height="10" viewBox="0 0 15 15" fill="none">
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
              placeholder="What kind of suggestions do you want for this text?"
              disabled={isRequestingSuggestions}
            />
            
            <button
              style={{
                ...styles.guidedSubmitButton,
                ...(!guidanceText.trim() || isRequestingSuggestions ? styles.guidedSubmitButtonDisabled : {}),
              }}
              onClick={handleSubmitGuidedSuggestion}
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
                  <div style={styles.spinner} />
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
          @keyframes popIn {
            from {
              opacity: 0;
              transform: translateY(4px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
        `}
      </style>
      
      <div
        ref={popupRef}
        style={{
          ...styles.popup,
          left: adjustedPosition.x,
          top: adjustedPosition.y,
        }}
      >
        {/* Revise button */}
        <button
          style={{ ...styles.button, ...styles.reviseButton }}
          onClick={handleRevise}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(6, 182, 212, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
          title="Open revision panel for this text"
        >
          <InternIcon />
          Revise
        </button>
        
        {/* Suggest button with dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            style={{ ...styles.button, ...styles.suggestButton }}
            onClick={handleSuggestClick}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            title="Get AI suggestions for this text"
          >
            <LightningIcon />
            Suggest
          </button>
          
          {/* Suggest Dropdown - BELOW the button */}
          {showSuggestDropdown && (
            <div style={styles.suggestDropdown}>
              {/* Quick Option */}
              <button
                style={styles.dropdownItem}
                onClick={handleQuickSuggest}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                  setHoveredItem('quick');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  setHoveredItem(null);
                }}
              >
                <span style={{ color: '#8b5cf6' }}>
                  <LightningIconSmall />
                </span>
                Quick
                
                {hoveredItem === 'quick' && (
                  <div style={styles.tooltip}>
                    <span style={styles.tooltipLabel}>Instant analysis</span>
                    AI suggests improvements for this text automatically.
                  </div>
                )}
              </button>
              
              {/* Guided Option */}
              <button
                style={styles.dropdownItem}
                onClick={handleOpenGuidedMode}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                  setHoveredItem('guided');
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  setHoveredItem(null);
                }}
              >
                <span style={{ color: '#a78bfa' }}>
                  <PencilIcon />
                </span>
                Guided
                
                {hoveredItem === 'guided' && (
                  <div style={{ ...styles.tooltip, borderColor: 'rgba(167, 139, 250, 0.3)' }}>
                    <span style={{ ...styles.tooltipLabel, color: '#a78bfa' }}>Tell the AI what you need</span>
                    Describe what kind of suggestions you want.
                  </div>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SelectionPopup;