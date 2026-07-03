/**
 * NoteCard
 * 
 * A draggable note card for the ScenesCanvas with linking mode.
 * 
 * Features:
 * - Drag to reposition
 * - Linking mode: click scenes on canvas to link them
 * - Quick-apply buttons for segment or global scope
 * - Color picker
 * - Inline content editing
 * - Delete confirmation
 * 
 * Connection lines are rendered by the parent (ScenesCanvasWorkspace)
 * only for scene-linked notes.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  NoteCard as NoteCardType,
  NoteCardColor,
  NoteCardScope,
  Position,
  NOTE_CARD_COLORS,
  SEGMENT_COLORS,
  SegmentWithScenes,
} from './types';

// =============================================================================
// Types
// =============================================================================

export interface NoteCardProps {
  note: NoteCardType;
  segments: SegmentWithScenes[];
  canvasScale: number;
  isLinkingMode: boolean;
  linkedSceneIds: string[]; // Scenes currently linked (for display during linking)
  detectedSegmentId: string; // Segment detected from drop position
  onMove: (position: Position) => void;
  onUpdate: (updates: Partial<NoteCardType>) => void;
  onRemove: () => void;
  onStartLinking: () => void;
  onFinishLinking: (scope: NoteCardScope, segmentId?: string, sceneIds?: string[]) => void;
  onCancelLinking: () => void;
  onDragStateChange?: (isDragging: boolean) => void; // For hiding connection lines during drag
}

// =============================================================================
// Constants
// =============================================================================

const CARD_WIDTH = 280;
const COLOR_OPTIONS: NoteCardColor[] = ['purple', 'blue', 'green', 'orange', 'pink', 'yellow'];

// =============================================================================
// Styles
// =============================================================================

const getCardStyles = (
  color: NoteCardColor,
  isDragging: boolean,
  isLinkingMode: boolean
): React.CSSProperties => {
  const accentColor = NOTE_CARD_COLORS[color];
  
  if (isLinkingMode) {
    return {
      width: CARD_WIDTH,
      background: 'linear-gradient(135deg, rgba(45, 45, 52, 0.97) 0%, rgba(35, 35, 42, 0.97) 100%)',
      borderRadius: 10,
      border: '1px solid #8b5cf6',
      boxShadow: isDragging
        ? '0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(139, 92, 246, 0.6)'
        : '0 4px 24px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.4)',
      cursor: isDragging ? 'grabbing' : 'grab',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      userSelect: isDragging ? 'none' : 'auto',
      willChange: isDragging ? 'transform' : 'auto',
      overflow: 'visible',
      position: 'relative' as const,
      animation: isDragging ? 'none' : 'pulse-border 2s ease-in-out infinite',
    };
  }
  
  return {
    width: CARD_WIDTH,
    background: 'linear-gradient(135deg, rgba(45, 45, 52, 0.97) 0%, rgba(35, 35, 42, 0.97) 100%)',
    borderRadius: 10,
    border: `1px solid rgba(255, 255, 255, 0.08)`,
    boxShadow: isDragging
      ? `0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px ${accentColor}40`
      : `0 4px 16px rgba(0, 0, 0, 0.3)`,
    cursor: isDragging ? 'grabbing' : 'grab',
    transition: 'box-shadow 0.15s, border-color 0.15s',
    userSelect: isDragging ? 'none' : 'auto',
    willChange: isDragging ? 'transform' : 'auto',
    overflow: 'visible',
    position: 'relative' as const,
  };
};

const styles: { [key: string]: React.CSSProperties } = {
  // === Normal Mode Header ===
  header: {
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  scopeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  headerSpacer: {
    flex: 1,
  },
  linkButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255, 255, 255, 0.4)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    cursor: 'pointer',
    border: '2px solid rgba(255, 255, 255, 0.2)',
    transition: 'all 0.15s',
  },
  closeButton: {
    width: 20,
    height: 20,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255, 255, 255, 0.3)',
    cursor: 'pointer',
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },
  
  // === Linking Mode Header ===
  linkingHeader: {
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid rgba(139, 92, 246, 0.2)',
    background: 'rgba(139, 92, 246, 0.05)',
  },
  linkingIcon: {
    color: '#8b5cf6',
  },
  linkingTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b5cf6',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  doneButton: {
    padding: '5px 12px',
    borderRadius: 6,
    border: 'none',
    background: '#8b5cf6',
    color: 'white',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  
  // === Linking Mode Body ===
  linkingBody: {
    padding: 12,
  },
  linkingInstruction: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  linkedFeedback: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    marginBottom: 12,
  },
  linkedFeedbackLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 4,
  },
  linkedFeedbackScenes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  linkedSceneTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 4,
    background: 'rgba(139, 92, 246, 0.2)',
    fontSize: 11,
    fontWeight: 600,
    color: '#a78bfa',
  },
  linkedSceneTagRemove: {
    cursor: 'pointer',
    opacity: 0.6,
    transition: 'opacity 0.15s',
    background: 'none',
    border: 'none',
    color: 'inherit',
    padding: 0,
    fontSize: 12,
    lineHeight: 1,
  },
  noScenesYet: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
  },
  linkingDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '12px 0',
  },
  linkingDividerLine: {
    flex: 1,
    height: 1,
    background: 'rgba(255, 255, 255, 0.08)',
  },
  linkingDividerText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  linkingOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  linkingOptionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 6,
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: 'inherit',
  },
  
  // === Normal Mode Body ===
  body: {
    padding: '10px 12px 12px',
  },
  contentPreview: {
    fontSize: 12,
    lineHeight: 1.65,
    color: 'rgba(255, 255, 255, 0.8)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    cursor: 'text',
    minHeight: 36,
  },
  contentPlaceholder: {
    fontSize: 12,
    lineHeight: 1.65,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
    cursor: 'text',
    minHeight: 36,
  },
  contentTextarea: {
    width: '100%',
    minHeight: 60,
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 12,
    lineHeight: 1.65,
    color: 'rgba(255, 255, 255, 0.9)',
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    overflow: 'hidden',
  },
  
  // === Color Picker ===
  colorPickerPopover: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    background: 'rgba(30, 30, 36, 0.98)',
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    padding: 8,
  },
  colorPickerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 6,
  },
  colorOption: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'transform 0.15s',
    border: '2px solid transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  // === Delete Confirmation ===
  deleteConfirm: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(20, 20, 24, 0.95)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
    zIndex: 10,
  },
  deleteConfirmText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  deleteConfirmButtons: {
    display: 'flex',
    gap: 8,
  },
  deleteConfirmButton: {
    padding: '6px 16px',
    borderRadius: 6,
    border: 'none',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};

// =============================================================================
// Helpers
// =============================================================================

const formatScopeBadge = (
  scope: NoteCardScope,
  segmentId?: string,
  sceneIds?: string[],
  segments?: SegmentWithScenes[]
): string => {
  if (scope === 'global') return 'Global Note';
  if (scope === 'segment' && segmentId) return `${segmentId} - All Scenes`;
  if (scope === 'scene' && sceneIds && sceneIds.length > 0 && segments) {
    const displayIds: string[] = [];
    for (const sceneId of sceneIds) {
      for (const seg of segments) {
        const idx = seg.scenes.findIndex(s => s.sceneId === sceneId);
        if (idx !== -1) {
          displayIds.push(`${seg.id}.${idx + 1}`);
          break;
        }
      }
    }
    if (displayIds.length === 1) return displayIds[0];
    if (displayIds.length > 1) return `${displayIds[0]} +${displayIds.length - 1}`;
  }
  return 'Unlinked';
};

const getSceneDisplayId = (sceneId: string, segments: SegmentWithScenes[]): string => {
  for (const seg of segments) {
    const idx = seg.scenes.findIndex(s => s.sceneId === sceneId);
    if (idx !== -1) return `${seg.id}.${idx + 1}`;
  }
  return sceneId;
};

const getScopeBadgeStyles = (scope: NoteCardScope, segmentId?: string): React.CSSProperties => {
  if (scope === 'global') {
    return {
      ...styles.scopeBadge,
      background: 'rgba(255, 255, 255, 0.1)',
      color: 'rgba(255, 255, 255, 0.6)',
    };
  }
  if (scope === 'segment' && segmentId && SEGMENT_COLORS[segmentId]) {
    return {
      ...styles.scopeBadge,
      background: `${SEGMENT_COLORS[segmentId]}30`,
      color: SEGMENT_COLORS[segmentId],
    };
  }
  return {
    ...styles.scopeBadge,
    background: 'rgba(139, 92, 246, 0.2)',
    color: '#8b5cf6',
  };
};

// =============================================================================
// Sub-components
// =============================================================================

const ColorPicker: React.FC<{
  currentColor: NoteCardColor;
  onSelect: (color: NoteCardColor) => void;
  onClose: () => void;
}> = ({ currentColor, onSelect, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  return (
    <div ref={ref} style={styles.colorPickerPopover} onMouseDown={e => e.stopPropagation()}>
      <div style={styles.colorPickerGrid}>
        {COLOR_OPTIONS.map(color => (
          <div
            key={color}
            style={{
              ...styles.colorOption,
              background: NOTE_CARD_COLORS[color],
              borderColor: color === currentColor ? 'white' : 'transparent',
              transform: color === currentColor ? 'scale(1.1)' : 'scale(1)',
            }}
            onClick={() => { onSelect(color); onClose(); }}
          />
        ))}
      </div>
    </div>
  );
};

const DeleteConfirm: React.FC<{
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ onConfirm, onCancel }) => (
  <div style={styles.deleteConfirm} onMouseDown={e => e.stopPropagation()}>
    <div style={styles.deleteConfirmText}>Delete this note?</div>
    <div style={styles.deleteConfirmButtons}>
      <button
        style={{ ...styles.deleteConfirmButton, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        style={{ ...styles.deleteConfirmButton, background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}
        onClick={onConfirm}
      >
        Delete
      </button>
    </div>
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

const NoteCard: React.FC<NoteCardProps> = ({
  note,
  segments,
  canvasScale,
  isLinkingMode,
  linkedSceneIds,
  detectedSegmentId,
  onMove,
  onUpdate,
  onRemove,
  onStartLinking,
  onFinishLinking,
  onCancelLinking,
  onDragStateChange,
}) => {
  // State
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [localContent, setLocalContent] = useState(note.content);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Refs
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const initialCardPos = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  
  const color = note.color || 'purple';
  
  // Sync content
  useEffect(() => {
    setLocalContent(note.content);
  }, [note.content]);
  
  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(60, textareaRef.current.scrollHeight)}px`;
    }
  }, []);
  
  useEffect(() => {
    if (isEditing) {
      adjustTextareaHeight();
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isEditing, adjustTextareaHeight]);
  
  useEffect(() => {
    if (isEditing) adjustTextareaHeight();
  }, [localContent, isEditing, adjustTextareaHeight]);
  
  // === Drag Handlers ===
  // Use refs to store latest values to avoid stale closures
  const canvasScaleRef = useRef(canvasScale);
  const onMoveRef = useRef(onMove);
  const onDragStateChangeRef = useRef(onDragStateChange);
  
  useEffect(() => {
    canvasScaleRef.current = canvasScale;
    onMoveRef.current = onMove;
    onDragStateChangeRef.current = onDragStateChange;
  }, [canvasScale, onMove, onDragStateChange]);
  
  const updateTransform = useCallback(() => {
    if (cardRef.current && isDraggingRef.current) {
      const adjustedX = dragOffset.current.x / canvasScaleRef.current;
      const adjustedY = dragOffset.current.y / canvasScaleRef.current;
      cardRef.current.style.transform = `translate(${adjustedX}px, ${adjustedY}px) scale(1.02)`;
    }
  }, []);
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    dragOffset.current = {
      x: e.clientX - dragStartPos.current.x,
      y: e.clientY - dragStartPos.current.y,
    };
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(updateTransform);
  }, [updateTransform]);
  
  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    const deltaX = dragOffset.current.x / canvasScaleRef.current;
    const deltaY = dragOffset.current.y / canvasScaleRef.current;
    if (cardRef.current) {
      cardRef.current.style.transform = '';
      cardRef.current.style.zIndex = '';
    }
    if (Math.abs(dragOffset.current.x) > 2 || Math.abs(dragOffset.current.y) > 2) {
      onMoveRef.current({
        x: initialCardPos.current.x + deltaX,
        y: initialCardPos.current.y + deltaY,
      });
    }
    dragOffset.current = { x: 0, y: 0 };
    setIsDragging(false);
    onDragStateChangeRef.current?.(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Allow dragging in linking mode, but not from buttons/textareas
    if (target.closest('button') || target.closest('textarea') || target.closest('[data-popover]')) return;
    
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { x: 0, y: 0 };
    initialCardPos.current = { x: note.position.x, y: note.position.y };
    setIsDragging(true);
    onDragStateChangeRef.current?.(true);
    if (cardRef.current) cardRef.current.style.zIndex = '100';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [note.position.x, note.position.y, handleMouseMove, handleMouseUp]);
  
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [handleMouseMove, handleMouseUp]);
  
  // === Content Editing ===
  const handleContentBlur = useCallback(() => {
    setIsEditing(false);
    const finalContent = localContent.trim() || '';
    if (finalContent !== note.content) {
      onUpdate({ content: finalContent });
    }
  }, [localContent, note.content, onUpdate]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalContent(note.content);
    } else if (e.key === 'Enter' && e.metaKey) {
      handleContentBlur();
    }
  }, [note.content, handleContentBlur]);
  
  // === Linking Actions ===
  const handleDone = useCallback(() => {
    if (linkedSceneIds.length > 0) {
      // Determine segmentId from first linked scene
      let segId = detectedSegmentId;
      for (const seg of segments) {
        if (seg.scenes.some(s => linkedSceneIds.includes(s.sceneId))) {
          segId = seg.id;
          break;
        }
      }
      onFinishLinking('scene', segId, linkedSceneIds);
    } else {
      // No scenes linked - cancel or keep as is
      onCancelLinking();
    }
  }, [linkedSceneIds, detectedSegmentId, segments, onFinishLinking, onCancelLinking]);
  
  const handleApplyToSegment = useCallback(() => {
    onFinishLinking('segment', detectedSegmentId, undefined);
  }, [detectedSegmentId, onFinishLinking]);
  
  const handleSaveAsGlobal = useCallback(() => {
    onFinishLinking('global', undefined, undefined);
  }, [onFinishLinking]);
  
  // === Render ===
  const isEmpty = !localContent || localContent.trim() === '';
  
  // Linking Mode UI
  if (isLinkingMode) {
    return (
      <div ref={cardRef} style={getCardStyles(color, isDragging, true)} onMouseDown={handleMouseDown}>
        <style>{`
          @keyframes pulse-border {
            0%, 100% { box-shadow: 0 4px 24px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.4); }
            50% { box-shadow: 0 4px 32px rgba(139, 92, 246, 0.4), 0 0 0 2px rgba(139, 92, 246, 0.6); }
          }
        `}</style>
        
        {/* Linking Header */}
        <div style={styles.linkingHeader}>
          <svg style={styles.linkingIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span style={styles.linkingTitle}>Link Note</span>
          <div style={styles.headerSpacer} />
          <button
            style={styles.doneButton}
            onClick={handleDone}
            onMouseEnter={e => { e.currentTarget.style.background = '#a78bfa'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#8b5cf6'; }}
          >
            Done
          </button>
        </div>
        
        {/* Linking Body */}
        <div style={styles.linkingBody}>
          <div style={styles.linkingInstruction}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Click scenes on the canvas to link them
          </div>
          
          {/* Linked Scenes Feedback */}
          <div style={styles.linkedFeedback}>
            <div style={styles.linkedFeedbackLabel}>Linked Scenes</div>
            {linkedSceneIds.length === 0 ? (
              <div style={styles.noScenesYet}>No scenes linked yet</div>
            ) : (
              <div style={styles.linkedFeedbackScenes}>
                {linkedSceneIds.map(sceneId => (
                  <span key={sceneId} style={styles.linkedSceneTag}>
                    {getSceneDisplayId(sceneId, segments)}
                    <button
                      style={styles.linkedSceneTagRemove}
                      onClick={() => onUpdate({ sceneIds: linkedSceneIds.filter(id => id !== sceneId) })}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          
          {/* Divider */}
          <div style={styles.linkingDivider}>
            <div style={styles.linkingDividerLine} />
            <span style={styles.linkingDividerText}>or quick apply</span>
            <div style={styles.linkingDividerLine} />
          </div>
          
          {/* Quick Apply Buttons */}
          <div style={styles.linkingOptions}>
            <button
              style={{
                ...styles.linkingOptionBtn,
                borderColor: 'rgba(255, 107, 53, 0.3)',
              }}
              onClick={handleApplyToSegment}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 107, 53, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.5)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.3)';
              }}
            >
              Apply to all of <strong style={{ color: '#ff6b35', marginLeft: 4 }}>{detectedSegmentId}</strong>
            </button>
            <button
              style={styles.linkingOptionBtn}
              onClick={handleSaveAsGlobal}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
              }}
            >
              Save as <strong style={{ color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>Global Note</strong>
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // Normal Mode UI
  return (
    <div ref={cardRef} style={getCardStyles(color, isDragging, false)} onMouseDown={handleMouseDown}>
      {showDeleteConfirm && <DeleteConfirm onConfirm={onRemove} onCancel={() => setShowDeleteConfirm(false)} />}
      
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerLabel}>Note</span>
        <div
          style={getScopeBadgeStyles(note.scope, note.segmentId)}
          onClick={onStartLinking}
        >
          {formatScopeBadge(note.scope, note.segmentId, note.sceneIds, segments)}
        </div>
        <div style={styles.headerSpacer} />
        
        {/* Link Button */}
        <button
          style={styles.linkButton}
          onClick={onStartLinking}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
        
        {/* Color Dot */}
        <div style={{ position: 'relative' }}>
          <div
            style={{ ...styles.colorDot, background: NOTE_CARD_COLORS[color] }}
            onClick={() => setShowColorPicker(!showColorPicker)}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
          />
          {showColorPicker && (
            <ColorPicker
              currentColor={color}
              onSelect={c => onUpdate({ color: c })}
              onClose={() => setShowColorPicker(false)}
            />
          )}
        </div>
        
        {/* Close */}
        <button
          style={styles.closeButton}
          onClick={() => isEmpty ? onRemove() : setShowDeleteConfirm(true)}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
        >
          ×
        </button>
      </div>
      
      {/* Body */}
      <div style={styles.body}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            style={styles.contentTextarea}
            value={localContent}
            onChange={e => setLocalContent(e.target.value)}
            onBlur={handleContentBlur}
            onKeyDown={handleKeyDown}
            placeholder="Add a note..."
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          />
        ) : (
          <div
            style={isEmpty ? styles.contentPlaceholder : styles.contentPreview}
            onClick={() => setIsEditing(true)}
          >
            {isEmpty ? 'Add a note...' : localContent}
          </div>
        )}
      </div>
    </div>
  );
};

export default NoteCard;