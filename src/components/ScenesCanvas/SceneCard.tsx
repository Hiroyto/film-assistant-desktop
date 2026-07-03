/**
 * SceneCard
 * 
 * A scene card for the ScenesCanvas with inline editing and text selection.
 * 
 * Features:
 * - Display scene title and content
 * - Double-click or pencil to enter inline edit mode
 * - Text transforms to editable textarea in place
 * - Orange border when editing (matches SegmentContentBlock style)
 * - Reports measured height for layout calculations
 * - Hides edit button when in selection mode (AI panel or linking)
 * - TEXT SELECTION (Phase 4): Select text in non-edit mode to trigger AI actions
 * - Floating toolbar appears near selection with Suggest/Revise/Expand/Compress options
 * - EXPAND/COLLAPSE: Long content is truncated with "Show more" button
 * - GENERATE: ⚡ button triggers AI scene generation with skeleton overlay
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  Scene,
  SceneCardProps,
  TextSelectionInfo,
  TextSelectionAction,
} from './types';
import { Trash2 } from 'lucide-react';
import { GenerateIcon } from '../Scenes/SceneCard';

// =============================================================================
// Constants
// =============================================================================

const CARD_WIDTH = 350;

// Maximum content height before truncation (pixels)
const MAX_CONTENT_HEIGHT = 350;

// Minimum characters required for text selection to trigger toolbar
const MIN_SELECTION_LENGTH = 3;

// =============================================================================
// Styles
// =============================================================================

const getCardStyles = (
  segmentColor: string,
  isSelected: boolean,
  isEditing: boolean,
  isExpanded: boolean,
  isGenerating: boolean
): React.CSSProperties => ({
  width: CARD_WIDTH,
  background: 'linear-gradient(135deg, #1a1a1e 0%, #141416 100%)',
  borderRadius: 10,
  border: `1px solid ${isGenerating ? '#3b82f6' : isSelected ? segmentColor : '#2a2a2e'}`,
  boxShadow: isGenerating
    ? '0 8px 32px rgba(0, 0, 0, 0.45), 0 0 20px rgba(59, 130, 246, 0.3)'
    : isExpanded
      ? `0 20px 60px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px ${isSelected ? segmentColor + '40' : 'rgba(255,255,255,0.05)'}`
      : isSelected
        ? `0 12px 40px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px ${segmentColor}40`
        : '0 8px 32px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.3)',
  transition: 'all 0.2s ease',
  overflow: 'visible',
  position: 'relative',
  zIndex: isExpanded ? 50 : 1,
  animation: isGenerating ? 'generatingPulse 1.2s ease-in-out infinite' : 'none',
});

const getBodyStyles = (isEditing: boolean): React.CSSProperties => ({
  padding: '12px 14px',
  position: 'relative',
  minHeight: 60,
  borderRadius: '0 0 8px 8px',
  outline: isEditing ? '2px solid #FF8C00' : 'none',
  outlineOffset: '-2px',
  boxShadow: isEditing ? 'inset 0 0 20px rgba(255, 140, 0, 0.1), 0 0 15px rgba(255, 140, 0, 0.15)' : 'none',
  transition: 'all 0.15s ease',
});

const getContentWrapperStyles = (
  isExpanded: boolean,
  isTruncated: boolean
): React.CSSProperties => ({
  position: 'relative',
  maxHeight: isExpanded ? 'none' : MAX_CONTENT_HEIGHT,
  overflow: 'hidden',
  transition: 'max-height 0.3s ease',
});

const styles: { [key: string]: React.CSSProperties } = {
  header: {
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
  },
  badge: {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    color: 'white',
    letterSpacing: '0.5px',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0e0',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  titleInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0e0',
    background: 'transparent',
    border: 'none',
    padding: 0,
    outline: 'none',
    fontFamily: 'inherit',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    width: 110,
    justifyContent: 'flex-end',
  },
  // editingBadge: {
  //   position: 'absolute',
  //   top: 6,
  //   left: 60,
  //   background: '#ff6b35',
  //   color: 'white',
  //   padding: '2px 6px',
  //   borderRadius: 4,
  //   fontSize: 9,
  //   fontWeight: 600,
  //   textTransform: 'uppercase',
  //   letterSpacing: '0.5px',
  //   pointerEvents: 'none',
  // },
  pencilButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(40, 40, 48, 0.8)',
    color: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  pencilButtonEditing: {
    background: 'rgba(255, 140, 0, 0.15)',
    border: '1px solid rgba(255, 140, 0, 0.3)',
    color: '#FF8C00',
  },
  content: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#a0a0a0',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    cursor: 'text',
    userSelect: 'text',
  },
  contentTextarea: {
    width: '100%',
    minHeight: 60,
    fontSize: 13,
    lineHeight: 1.6,
    color: '#c0c0c0',
    background: 'transparent',
    border: 'none',
    padding: 0,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'none',
    overflow: 'hidden',
  },
  placeholder: {
    fontSize: 13,
    lineHeight: 1.6,
    color: 'rgba(255, 255, 255, 0.3)',
    fontStyle: 'italic',
    cursor: 'text',
  },
  titleTextarea: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0e0',
    background: 'transparent',
    border: 'none',
    padding: 0,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'none',
    overflow: 'hidden',
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },

  // ==========================================================================
  // Fade Gradient & Expand/Collapse Button Styles
  // ==========================================================================

  fadeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    background: 'linear-gradient(to bottom, transparent 0%, #141416 90%)',
    pointerEvents: 'none',
  },

  expandButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '8px 0',
    marginTop: 8,
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  // ==========================================================================
  // Selection Toolbar Styles (Phase 4)
  // ==========================================================================

  selectionToolbar: {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: 4,
    background: 'linear-gradient(135deg, rgba(30, 30, 36, 0.98) 0%, rgba(24, 24, 30, 0.98) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.2)',
    zIndex: 100,
    animation: 'toolbarFadeIn 0.15s ease',
  },

  toolbarButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  },
};

// =============================================================================
// Icons
// =============================================================================

const PencilIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
    <path
      d="M11.854 1.146a.5.5 0 00-.708 0L3.5 8.793V11.5h2.707l7.647-7.646a.5.5 0 000-.708l-2-2z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
);

// Lightning bolt for suggestions
const LightningIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

// Glasses for revisions (infinity-like icon)
const GlassesIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="4" cy="7.5" r="2.5" />
    <circle cx="11" cy="7.5" r="2.5" />
    <path d="M6.5 7.5H8.5" strokeLinecap="round" />
  </svg>
);

// Chevron icons for expand/collapse
const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ChevronUpIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

// =============================================================================
// Helper: Snap selection to word boundaries
// =============================================================================

const snapToWordBoundaries = (
  text: string,
  start: number,
  end: number
): { start: number; end: number } => {
  const isWordChar = (char: string) => /\w/.test(char);

  let snappedStart = start;
  let snappedEnd = end;

  if (start > 0 && isWordChar(text[start - 1]) && isWordChar(text[start])) {
    while (snappedStart > 0 && isWordChar(text[snappedStart - 1])) {
      snappedStart--;
    }
  }

  if (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) {
    while (snappedEnd < text.length && isWordChar(text[snappedEnd])) {
      snappedEnd++;
    }
  }

  return { start: snappedStart, end: snappedEnd };
};

// =============================================================================
// Component
// =============================================================================

const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  segmentId,
  segmentColor,
  displayId,
  isSelected,
  isInSelectionMode = false,
  isEditingDisabled = false,
  onClick,
  onSceneUpdate,
  onMeasured,
  onTextSelectionAction,
  activeSelectionBounds = null,
  activeSelectionColor = 'cyan',
  onDelete,
  onGenerate,
  generatingSceneId = null,
}) => {
  // ===========================================================================
  // State
  // ===========================================================================

  const [editingField, setEditingField] = useState<'title' | 'content' | null>(null);

  const isEditing = editingField !== null;
  const [localTitle, setLocalTitle] = useState(scene.title);
  const [localContent, setLocalContent] = useState(scene.content);
  const [isHovered, setIsHovered] = useState(false);

  // Expand/collapse state
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  // Text selection state (Phase 4)
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState({ x: 0, y: 0 });
  const [currentSelection, setCurrentSelection] = useState<TextSelectionInfo | null>(null);

  // ===========================================================================
  // Refs
  // ===========================================================================

  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // ===========================================================================
  // Sync local state when scene changes
  // ===========================================================================

  useEffect(() => {
    if (!isEditing) {
      setLocalTitle(scene.title);
      setLocalContent(scene.content);
    }
  }, [scene.title, scene.content, isEditing]);

  // ===========================================================================
  // Detect if content is truncated
  // ===========================================================================

  useLayoutEffect(() => {
    if (contentRef.current && !isEditing) {
      const contentHeight = contentRef.current.scrollHeight;
      setIsTruncated(contentHeight > MAX_CONTENT_HEIGHT);
    }
  }, [scene.content, isEditing]);

  // ===========================================================================
  // Report measured height (skip while editing)
  // ===========================================================================

  useLayoutEffect(() => {
    if (cardRef.current && onMeasured && !isEditing) {
      const height = cardRef.current.getBoundingClientRect().height;
      onMeasured(height);
    }
  });

  // ===========================================================================
  // Auto-resize textarea
  // ===========================================================================

  const adjustTextareaHeight = useCallback(() => {
    const ta = contentTextareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(60, ta.scrollHeight)}px`;
    }
  }, []);

  const adjustTitleHeight = useCallback(() => {
    const ta = titleInputRef.current as HTMLTextAreaElement | null;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      setTimeout(adjustTextareaHeight, 0);
    }
  }, [localContent, isEditing, adjustTextareaHeight]);

  // ===========================================================================
  // Refs for click-outside to avoid stale closures
  // ===========================================================================

  const localTitleRef = useRef(localTitle);
  const localContentRef = useRef(localContent);
  const sceneRef = useRef(scene);
  const onSceneUpdateRef = useRef(onSceneUpdate);

  useEffect(() => {
    localTitleRef.current = localTitle;
    localContentRef.current = localContent;
    sceneRef.current = scene;
    onSceneUpdateRef.current = onSceneUpdate;
  }, [localTitle, localContent, scene, onSceneUpdate]);

  // ===========================================================================
  // Click outside to exit edit mode
  // ===========================================================================

  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        const currentTitle = localTitleRef.current;
        const currentContent = localContentRef.current;
        const currentScene = sceneRef.current;

        if (currentTitle !== currentScene.title || currentContent !== currentScene.content) {
          onSceneUpdateRef.current({
            title: currentTitle.trim() || currentScene.title,
            content: currentContent,
          });
        }
        setEditingField(null);;
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isEditing]);

  // ===========================================================================
  // Clear selection toolbar when clicking outside
  // ===========================================================================

  useEffect(() => {
    if (!showSelectionToolbar) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;

      setShowSelectionToolbar(false);
      setCurrentSelection(null);
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside, true);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [showSelectionToolbar]);

  // ===========================================================================
  // Clear selection when entering edit mode or selection mode
  // ===========================================================================

  useEffect(() => {
    if (isEditing || isInSelectionMode) {
      setShowSelectionToolbar(false);
      setCurrentSelection(null);
    }
  }, [isEditing, isInSelectionMode]);

  // ===========================================================================
  // Collapse when deselected or when entering selection mode
  // ===========================================================================

  useEffect(() => {
    if (!isSelected || isInSelectionMode) {
      setIsExpanded(false);
    }
  }, [isSelected, isInSelectionMode]);

  // ===========================================================================
  // Text Selection Handler (Phase 4)
  // ===========================================================================

  const handleContentMouseUp = useCallback((e: React.MouseEvent) => {
    // Temporarily disabled
    if (false as boolean) {
      if (isEditing || isInSelectionMode) return;
      if (!onTextSelectionAction) return;
  
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setShowSelectionToolbar(false);
        setCurrentSelection(null);
        return;
      }
  
      const selectedText = selection.toString().trim();
      if (selectedText.length < MIN_SELECTION_LENGTH) {
        setShowSelectionToolbar(false);
        setCurrentSelection(null);
        return;
      }
  
      const rawStart = localContent.indexOf(selectedText);
      if (rawStart === -1) {
        setShowSelectionToolbar(false);
        setCurrentSelection(null);
        return;
      }
  
      const rawEnd = rawStart + selectedText.length;
      const { start, end } = snapToWordBoundaries(localContent, rawStart, rawEnd);
      const snappedText = localContent.substring(start, end);
  
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const cardRect = cardRef.current?.getBoundingClientRect();
  
      if (!cardRect) return;
  
      const toolbarX = rect.left + rect.width / 2 - cardRect.left;
      const toolbarY = rect.top - cardRect.top - 8;
  
      const selectionInfo: TextSelectionInfo = {
        sceneId: scene.sceneId,
        segmentId,
        selectedText: snappedText,
        fullContent: localContent,
        selectionBounds: { start, end },
      };
  
      setCurrentSelection(selectionInfo);
      setSelectionToolbarPosition({ x: toolbarX, y: toolbarY });
      setShowSelectionToolbar(true);
    }
  }, [isEditing, isInSelectionMode, localContent, scene.sceneId, segmentId, onTextSelectionAction]);

  // ===========================================================================
  // Toolbar Action Handlers
  // ===========================================================================

  const handleToolbarAction = useCallback((action: TextSelectionAction) => {
    if (!currentSelection || !onTextSelectionAction) return;

    onTextSelectionAction(action, currentSelection);

    setShowSelectionToolbar(false);
    setCurrentSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [currentSelection, onTextSelectionAction]);

  // ===========================================================================
  // Edit Mode Handlers
  // ===========================================================================

  const enterTitleEdit = useCallback(() => {
    if (isInSelectionMode || isEditingDisabled) return;

    setEditingField('title');
    setIsExpanded(false);

    setTimeout(() => {
      const ta = titleInputRef.current;
      if (ta) {
        ta.focus();
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
      }
    }, 0);
  }, [isInSelectionMode, isEditingDisabled]);

  const enterContentEdit = useCallback(() => {
    if (isInSelectionMode || isEditingDisabled) return;

    setEditingField('content');
    setIsExpanded(false);

    setTimeout(() => {
      const ta = contentTextareaRef.current;
      if (ta) {
        ta.focus();
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
      }
    }, 0);
  }, [isInSelectionMode, isEditingDisabled]);

  const handleExitEditMode = useCallback(() => {
    setEditingField(null);;
    if (localTitle !== scene.title || localContent !== scene.content) {
      onSceneUpdate({
        title: localTitle.trim() || scene.title,
        content: localContent,
      });
    }
  }, [localTitle, localContent, scene.title, scene.content, onSceneUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setLocalTitle(scene.title);
      setLocalContent(scene.content);
      setEditingField(null);;
    }
  }, [scene.title, scene.content]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (isEditing) {
      e.stopPropagation();
      return;
    }
    onClick();
  }, [isEditing, onClick]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isInSelectionMode || isEditingDisabled) return;

    e.stopPropagation();
    enterTitleEdit();
  }, [isInSelectionMode, isEditingDisabled]);

  // ===========================================================================
  // Expand/Collapse Handler
  // ===========================================================================

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  }, []);

  // ===========================================================================
  // Render Selection Toolbar
  // ===========================================================================

  const renderSelectionToolbar = () => {
    // Temporarily disabled
    if (false as boolean) {
      if (!showSelectionToolbar || !currentSelection) return null;
  
      const toolbarWidth = 180;
      const toolbarHeight = 40;
  
      let x = selectionToolbarPosition.x - toolbarWidth / 2;
      let y = selectionToolbarPosition.y - toolbarHeight;
  
      x = Math.max(8, Math.min(x, CARD_WIDTH - toolbarWidth - 8));
  
      if (y < 8) {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const cardRect = cardRef.current?.getBoundingClientRect();
          if (cardRect) {
            y = rect.bottom - cardRect.top + 8;
          }
        }
      }
  
      return (
        <div
          ref={toolbarRef}
          style={{
            ...styles.selectionToolbar,
            left: x,
            top: y,
            transform: 'translateY(-100%)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ position: 'relative' }}>
            <button
              style={{
                ...styles.toolbarButton,
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                border: 'none',
                color: 'white',
              }}
              onClick={() => handleToolbarAction('revise')}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(14, 165, 233, 0.4)';
                const tooltip = e.currentTarget.parentElement?.querySelector('.tooltip') as HTMLElement;
                if (tooltip) tooltip.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
                const tooltip = e.currentTarget.parentElement?.querySelector('.tooltip') as HTMLElement;
                if (tooltip) tooltip.style.opacity = '0';
              }}
            >
              <GlassesIcon size={14} />
              Revise
            </button>
            <div
              className="tooltip"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 8,
                padding: '6px 10px',
                background: '#1a1a1e',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                fontSize: 11,
                color: '#a0a0a0',
                whiteSpace: 'nowrap',
                opacity: 0,
                transition: 'opacity 0.15s ease',
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                zIndex: 10,
              }}
            >
              Rewrite selected text
            </div>
          </div>
  
          <div style={{ position: 'relative' }}>
            <button
              style={{
                ...styles.toolbarButton,
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                border: 'none',
                color: 'white',
              }}
              onClick={() => handleToolbarAction('suggest')}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.4)';
                const tooltip = e.currentTarget.parentElement?.querySelector('.tooltip') as HTMLElement;
                if (tooltip) tooltip.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
                const tooltip = e.currentTarget.parentElement?.querySelector('.tooltip') as HTMLElement;
                if (tooltip) tooltip.style.opacity = '0';
              }}
            >
              <LightningIcon size={12} />
              Suggest
            </button>
            <div
              className="tooltip"
              style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 8,
                padding: '6px 10px',
                background: '#1a1a1e',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                fontSize: 11,
                color: '#a0a0a0',
                whiteSpace: 'nowrap',
                opacity: 0,
                transition: 'opacity 0.15s ease',
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                zIndex: 10,
              }}
            >
              Get suggestions for selection
            </div>
          </div>
        </div>
      );
    }
    return null;
  };
  const applyHoverStyle = (
    e: React.MouseEvent<HTMLButtonElement>,
    color: string
  ) => {
    e.currentTarget.style.background = `${color}20`;
    e.currentTarget.style.borderColor = `${color}66`;
    e.currentTarget.style.color = color;
  };

  const resetHoverStyle = (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.currentTarget.style.background = 'rgba(40, 40, 48, 0.8)';
    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
  };

  const isGenerating = generatingSceneId === scene.sceneId;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
      <div
        ref={cardRef}
        data-scene-card          // ← ADD THIS
        style={getCardStyles(segmentColor, isSelected, isEditing, isExpanded, isGenerating)}
        onClick={handleCardClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      {/* Keyframes for animations */}
      <style>
        {`
          @keyframes toolbarFadeIn {
            from {
              opacity: 0;
              transform: translateY(-100%) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(-100%) scale(1);
            }
          }
          @keyframes generatingPulse {
            0%, 100% { 
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 0 20px rgba(59, 130, 246, 0.25);
              border-color: #3b82f6;
            }
            50% { 
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 0 35px rgba(59, 130, 246, 0.4);
              border-color: #60a5fa;
            }
          }
          @keyframes skeletonShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      {/* Header */}
      <div style={styles.header}>
        <span
          style={{
            ...styles.badge,
            background: segmentColor,
            boxShadow: isEditing
              ? `0 0 14px ${segmentColor}AA`
              : 'none',
            animation: isEditing ? 'badgeGlowPulse 1.8s ease-in-out infinite' : 'none',
            transition: 'all 0.25s ease',
          }}
        >
          {displayId}
        </span>

        <div style={styles.titleContainer}>
          {editingField === 'title' ? (
            <textarea
              ref={titleInputRef}
              style={styles.titleTextarea}
              value={localTitle}
              onChange={(e) => {
                setLocalTitle(e.target.value);

                const ta = titleInputRef.current;
                if (ta) {
                  ta.style.height = 'auto';
                  ta.style.height = `${ta.scrollHeight}px`;
                }
              }}
              onBlur={() => {
                setEditingField(null);
                if (localTitle !== scene.title) {
                  onSceneUpdate({
                    title: localTitle.trim() || scene.title,
                    content: localContent,
                  });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLocalTitle(scene.title);
                  setEditingField(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Scene title..."
              rows={1}
            />
          ) : (
            <h3
              style={styles.title}
              onDoubleClick={(e) => {
                e.stopPropagation();
                enterTitleEdit();
              }}
            >
              {scene.title || 'Untitled Scene'}
            </h3>
          )}
        </div>

        <div style={styles.headerActions}>
  {!isInSelectionMode && !isEditingDisabled && (
    <>
      <button
        style={{
          ...styles.pencilButton,
          ...(isEditing ? styles.pencilButtonEditing : {}),
        }}
        onClick={enterContentEdit}
        onMouseDown={(e) => e.stopPropagation()}
        title="Edit scene"
      >
        <PencilIcon />
      </button>

      {/* Generate Button */}
      <button
        style={{
          ...styles.pencilButton,
          ...(isGenerating ? {
            border: '1px solid rgba(59, 130, 246, 0.5)',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#60a5fa',
            cursor: 'wait',
          } : {}),
          outline: 'none',
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (onGenerate && !isGenerating) onGenerate();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        title={isGenerating ? "Generating..." : "Generate content"}
        onMouseEnter={(e) => !isGenerating && applyHoverStyle(e, '#FF8C00')}
        onMouseLeave={(e) => !isGenerating && resetHoverStyle(e)}
      >
        {isGenerating ? (
          <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 3">
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="0 7.5 7.5;360 7.5 7.5"
                dur="1s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        ) : (
          <GenerateIcon />
        )}
      </button>

      {/* Delete Button */}
      <button
        style={styles.pencilButton}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Delete scene"
      >
        <Trash2 size={16} />
      </button>
    </>
  )}
</div>
      </div>

      {/* Body */}
      <div style={getBodyStyles(isEditing)}>
        {/* Generating Skeleton Overlay */}
        {isGenerating && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 15, 30, 0.92)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            flexDirection: 'column',
            padding: '14px',
            gap: '10px',
            borderRadius: '0 0 8px 8px',
            zIndex: 10,
            overflow: 'hidden',
          }}>
            {[100, 100, 85, 100, 65, 100, 85, 100, 45, 100, 85, 65].map((width, i) => (
              <div key={i} style={{
                height: 12,
                width: `${width}%`,
                borderRadius: 4,
                background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.25) 50%, rgba(59, 130, 246, 0.1) 100%)',
                backgroundSize: '200% 100%',
                animation: 'skeletonShimmer 1.5s ease-in-out infinite',
              }} />
            ))}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#60a5fa',
              fontSize: 12,
              fontWeight: 500,
              marginTop: 8,
            }}>
              <div style={{
                width: 14,
                height: 14,
                border: '2px solid rgba(59, 130, 246, 0.3)',
                borderTopColor: '#60a5fa',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              Generating...
            </div>
          </div>
        )}

        {isEditing ? (
          <textarea
            ref={contentTextareaRef}
            style={styles.contentTextarea}
            value={localContent}
            onChange={(e) => {
              setLocalContent(e.target.value);

              const ta = contentTextareaRef.current;
              if (ta) {
                ta.style.height = 'auto';
                ta.style.height = `${Math.max(60, ta.scrollHeight)}px`;
              }
            }}
            onBlur={() => {
              setEditingField(null);
              if (localContent !== scene.content) {
                onSceneUpdate({
                  title: localTitle,
                  content: localContent,
                });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setLocalContent(scene.content);
                setEditingField(null);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Describe what happens in this scene..."
          />
        ) : (
          <>
            <div
              ref={contentWrapperRef}
              style={getContentWrapperStyles(isExpanded, isTruncated)}
            >
              {scene.content ? (
                <p
                  ref={contentRef}
                  style={styles.content}
                  onMouseUp={handleContentMouseUp}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    enterContentEdit();
                  }}
                >
                  {activeSelectionBounds ? (
                    <>
                      {scene.content.substring(0, activeSelectionBounds.start)}
                      <span
                        style={{
                          background:
                            activeSelectionColor === 'purple'
                              ? 'rgba(139, 92, 246, 0.25)'
                              : 'rgba(14, 165, 233, 0.25)',
                          borderBottom:
                            activeSelectionColor === 'purple'
                              ? '2px solid #8b5cf6'
                              : '2px solid #0ea5e9',
                          paddingBottom: '1px',
                          borderRadius: '2px',
                        }}
                      >
                        {scene.content.substring(
                          activeSelectionBounds.start,
                          activeSelectionBounds.end
                        )}
                      </span>
                      {scene.content.substring(activeSelectionBounds.end)}
                    </>
                  ) : (
                    scene.content
                  )}
                </p>
              ) : (
                <p
                  style={styles.placeholder}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    enterContentEdit();
                  }}
                >
                  No content yet...
                </p>
              )}

              {isTruncated && !isExpanded && (
                <div style={styles.fadeGradient} />
              )}
            </div>

            {isTruncated && (
              <button
                style={styles.expandButton}
                onClick={handleToggleExpand}
              >
                {isExpanded ? (
                  <>
                    <ChevronUpIcon size={14} />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDownIcon size={14} />
                    Show more
                  </>
                )}
              </button>
            )}

            {renderSelectionToolbar()}
          </>
        )
        }
      </div >
    </div >
  );
};

export default SceneCard;