/**
 * DraggableCard
 * 
 * A single card on the canvas that can be:
 * - Dragged freely around the workspace
 * - Edited inline
 * - Removed
 * - Applied/dismissed (for suggestions)
 * 
 * Card Types:
 * - Note (purple): "Consider this..." - context, references, inspiration
 * - Suggestion (green): AI-generated revision options
 * 
 * PERFORMANCE NOTES:
 * - Uses CSS transform during drag (no React re-renders)
 * - Only commits position to state on mouseup
 * - Uses refs to track drag state
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DraggableCardProps, Position, CardType } from './types';

// =============================================================================
// Styles
// =============================================================================

const getCardStyles = (type: CardType, isDragging: boolean, isEditing: boolean): React.CSSProperties => {
  return {
    width: 260,
    background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.95) 0%, rgba(50, 50, 58, 0.95) 100%)',
    borderRadius: 12,
    backdropFilter: 'blur(8px)',
    cursor: isDragging ? 'grabbing' : isEditing ? 'text' : 'grab',
    transition: isDragging ? 'box-shadow 0.1s' : 'box-shadow 0.2s',
    userSelect: isDragging ? 'none' : 'auto',
    willChange: isDragging ? 'transform' : 'auto',
    boxShadow: isDragging 
      ? '0 12px 40px rgba(0, 0, 0, 0.5)' 
      : '0 4px 16px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
  };
};

const getBodyWrapperStyles = (type: CardType, isEditing: boolean): React.CSSProperties => {
  const getColor = () => {
    if (type === 'note') return isEditing ? 'rgba(139, 92, 246, 0.8)' : 'rgba(139, 92, 246, 0.2)';
    return isEditing ? '#10b981' : 'rgba(16, 185, 129, 0.3)';
  };
  
  const getGlow = () => {
    if (!isEditing) return 'none';
    if (type === 'note') return 'inset 0 0 20px rgba(139, 92, 246, 0.1), 0 0 15px rgba(139, 92, 246, 0.2)';
    return 'inset 0 0 20px rgba(16, 185, 129, 0.1), 0 0 15px rgba(16, 185, 129, 0.2)';
  };
  
  const color = getColor();
  const borderWidth = isEditing ? '2px' : '1px';
  
  return {
    borderTop: `${borderWidth} solid ${color}`,
    borderLeft: `${borderWidth} solid ${color}`,
    borderRight: `${borderWidth} solid ${color}`,
    borderBottom: `${borderWidth} solid ${color}`,
    borderRadius: '0 0 10px 10px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: getGlow(),
    transition: 'all 0.2s ease',
  };
};

const styles: { [key: string]: React.CSSProperties } = {
  header: {
    padding: '0.75rem 1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cardType: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },

  closeButton: {
    width: 20,
    height: 20,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255, 255, 255, 0.4)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    transition: 'all 0.2s',
    padding: 0,
  },

  body: {
    padding: '0.75rem 1rem',
  },

  content: {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'rgba(255, 255, 255, 0.8)',
  },

  contentPreview: {
    fontSize: 12,
    lineHeight: 1.7,
    color: 'rgba(255, 255, 255, 0.85)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    cursor: 'pointer',
    minHeight: 40,
  },
  
  contentPlaceholder: {
    fontSize: 12,
    lineHeight: 1.7,
    color: 'rgba(255, 255, 255, 0.35)',
    fontStyle: 'italic',
    cursor: 'pointer',
    minHeight: 40,
  },

  contentTextarea: {
    width: '100%',
    minHeight: 60,
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 12,
    lineHeight: 1.7,
    color: 'rgba(255, 255, 255, 0.9)',
    resize: 'none',
    outline: 'none',
    fontFamily: "'Courier New', Courier, monospace",
    overflow: 'hidden',
  },

  suggestionOriginal: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    textDecoration: 'line-through',
    marginBottom: '0.5rem',
    paddingBottom: '0.5rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },

  suggestionNew: {
    color: '#10b981',
  },

  actions: {
    padding: '0.5rem 1rem 0.75rem',
    display: 'flex',
    gap: '0.5rem',
  },

  actionButton: {
    flex: 1,
    padding: '0.4rem',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },

  applyButton: {
    background: 'rgba(16, 185, 129, 0.2)',
    color: '#10b981',
  },

  dismissButton: {
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.5)',
  },

  linkedTextIndicator: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.3)',
    marginTop: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
  
  cardTypeLabel: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: '0.35rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
};

// Card type colors
const typeColors: { [key in CardType]: string } = {
  note: '#8b5cf6',
  suggestion: '#10b981',
};

// Placeholder text per card type
const placeholderText: { [key in CardType]: string } = {
  note: 'Add context, references, or ideas for the AI to consider...',
  suggestion: '',
};

// Card type icons
const TypeIcon: React.FC<{ type: CardType }> = ({ type }) => {
  if (type === 'note') {
    return (
      <svg width="10" height="10" viewBox="0 0 15 15" fill="none">
        <rect x="2" y="2" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 5h5M5 7.5h5M5 10h3" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  } else {
    return (
      <svg width="10" height="10" viewBox="0 0 15 15" fill="none">
        <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" fill="currentColor" />
      </svg>
    );
  }
};

// =============================================================================
// Helper: Check if content is empty or just placeholder
// =============================================================================

const isContentEmpty = (content: string, type: CardType): boolean => {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed === 'New note...') return true;
  return false;
};

// =============================================================================
// Component
// =============================================================================

const DraggableCard: React.FC<DraggableCardProps> = ({
  card,
  onMove,
  onUpdate,
  onRemove,
  onApply,
  onDismiss,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [localContent, setLocalContent] = useState(card.content);
  const [isHovered, setIsHovered] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Drag state stored in refs to avoid re-renders during drag
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const initialCardPos = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);

  // Sync local content with prop
  useEffect(() => {
    setLocalContent(card.content);
  }, [card.content]);
  
  // Auto-open editing for new cards with placeholder content
  useEffect(() => {
    if (isContentEmpty(card.content, card.type) && card.type !== 'suggestion') {
      setIsEditing(true);
      setLocalContent(''); // Clear placeholder for editing
    }
  }, []);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(60, ta.scrollHeight)}px`;
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
      // Focus and select all when entering edit mode
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
  }, [isEditing, adjustTextareaHeight]);
  
  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
    }
  }, [localContent, isEditing, adjustTextareaHeight]);

  // ==========================================================================
  // Drag handling
  // ==========================================================================

  const updateTransform = useCallback(() => {
    if (cardRef.current && isDraggingRef.current) {
      cardRef.current.style.transform = `translate(${dragOffset.current.x}px, ${dragOffset.current.y}px) scale(1.02)`;
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('textarea') ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'TEXTAREA' ||
      isEditing
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    
    isDraggingRef.current = true;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { x: 0, y: 0 };
    initialCardPos.current = { x: card.position.x, y: card.position.y };
    
    setIsDragging(true);
    
    if (cardRef.current) {
      cardRef.current.style.transform = 'scale(1.02)';
      cardRef.current.style.zIndex = '100';
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isEditing, card.position.x, card.position.y]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;

    dragOffset.current = {
      x: e.clientX - dragStartPos.current.x,
      y: e.clientY - dragStartPos.current.y,
    };

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }
    rafId.current = requestAnimationFrame(updateTransform);
  }, [updateTransform]);

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    isDraggingRef.current = false;
    
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }

    const finalPosition: Position = {
      x: initialCardPos.current.x + dragOffset.current.x,
      y: initialCardPos.current.y + dragOffset.current.y,
    };

    if (dragOffset.current.x !== 0 || dragOffset.current.y !== 0) {
      onMove(finalPosition);
    }

    requestAnimationFrame(() => {
      if (cardRef.current) {
        cardRef.current.style.transform = '';
        cardRef.current.style.zIndex = '';
      }
    });

    dragOffset.current = { x: 0, y: 0 };
    setIsDragging(false);

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [onMove, handleMouseMove]);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  // ==========================================================================
  // Editing
  // ==========================================================================

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (card.type === 'suggestion') return;
    e.stopPropagation();
    
    // Clear placeholder text when entering edit mode
    if (isContentEmpty(localContent, card.type)) {
      setLocalContent('');
    }
    
    setIsEditing(true);
  }, [card.type, localContent]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalContent(e.target.value);
  }, []);

  const handleContentBlur = useCallback(() => {
    setIsEditing(false);
    const finalContent = localContent.trim() || 'New note...';
    if (finalContent !== card.content) {
      onUpdate({ content: finalContent });
    }
    setLocalContent(finalContent);
  }, [localContent, card.content, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalContent(card.content);
    } else if (e.key === 'Enter' && e.metaKey) {
      handleContentBlur();
    }
  }, [card.content, handleContentBlur]);

  // ==========================================================================
  // Render content based on card type and state
  // ==========================================================================

  const renderContent = () => {
    // Editing mode - show textarea
    if (isEditing) {
      return (
        <textarea
          ref={textareaRef}
          style={styles.contentTextarea}
          value={localContent}
          onChange={(e) => {
            handleContentChange(e);
            adjustTextareaHeight();
          }}
          onBlur={handleContentBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText[card.type]}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      );
    }

    // Suggestion card with linked text
    if (card.type === 'suggestion' && card.linkedText) {
      return (
        <>
          <div style={styles.suggestionOriginal}>
            "{card.linkedText.original}"
          </div>
          <div style={{ ...styles.content, ...styles.suggestionNew }}>
            {localContent}
          </div>
        </>
      );
    }

    // Preview mode - show formatted content or placeholder
    const isEmpty = isContentEmpty(localContent, card.type);
    
    return (
      <div 
        style={isEmpty ? styles.contentPlaceholder : styles.contentPreview} 
        onDoubleClick={handleDoubleClick}
      >
        {isEmpty ? placeholderText[card.type] : localContent}
        {card.linkedText && !isEmpty && (
          <div style={styles.linkedTextIndicator}>
            <svg width="10" height="10" viewBox="0 0 15 15" fill="currentColor">
              <path d="M4.5 6.5L7.5 3.5L10.5 6.5M7.5 3.5V11.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            Linked to text
          </div>
        )}
      </div>
    );
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  const cardStyle = getCardStyles(card.type, isDragging, isEditing);
  const typeColor = typeColors[card.type];

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div style={styles.header}>
        <div style={{ ...styles.cardType, color: typeColor }}>
          <TypeIcon type={card.type} />
          {card.type.charAt(0).toUpperCase() + card.type.slice(1)}
        </div>
        <button
          style={styles.closeButton}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
          }}
        >
          ×
        </button>
      </div>

      {/* Body Wrapper */}
      <div style={getBodyWrapperStyles(card.type, isEditing)}>
        {/* Body */}
        <div style={styles.body}>{renderContent()}</div>

        {/* Actions for suggestions */}
        {card.type === 'suggestion' && card.status === 'active' && onApply && onDismiss && (
          <div style={styles.actions}>
            <button
              style={{ ...styles.actionButton, ...styles.applyButton }}
              onClick={(e) => {
                e.stopPropagation();
                onApply();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
              }}
            >
              ✓ Apply
            </button>
            <button
              style={{ ...styles.actionButton, ...styles.dismissButton }}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Applied indicator */}
        {card.type === 'suggestion' && card.status === 'applied' && (
          <div
            style={{
              padding: '0.5rem 1rem 0.75rem',
              fontSize: 11,
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
              <path
                d="M3 7.5L6.5 11L12 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Applied
          </div>
        )}
      </div>
    </div>
  );
};

export default DraggableCard;