/**
 * SegmentContentBlock
 * 
 * The anchored center block containing the segment prose.
 * Handles:
 * - Text display with editable content
 * - Text selection detection
 * - Highlighting linked text regions (connected to cards)
 * - Highlighting revision target (cyan) and suggestion target (purple)
 * - Integrated revision panel that slides out from the right
 * - Static suggestion cards that appear on the right (multi-select)
 * - Pulsing animation when applying suggestions
 * - Responsive layout for smaller screens
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { SegmentContentBlockProps, CanvasCard, LinkedText, Position } from './types';
import SuggestionCards from './SuggestionCards';

// =============================================================================
// Hooks
// =============================================================================

const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
};

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  // Outer container - just for centering
  outerContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 20,
  },
  
  // Inner wrapper for content block + revision panel (flex row)
  innerWrapper: {
    display: 'flex',
    alignItems: 'flex-start',
    position: 'relative',
  },
  
  // Main content block
  container: {
    width: 700,
    maxHeight: '75vh',
    background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.98) 0%, rgba(50, 50, 58, 0.98) 100%)',
    borderRadius: '12px',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'visible',
    flexShrink: 0,
    zIndex: 2,
    position: 'relative',
  },
  
  header: {
    padding: '1rem 1.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    background: 'transparent',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  
  contentWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    borderTop: '2px solid transparent',
    borderLeft: '2px solid transparent',
    borderRight: '2px solid transparent',
    borderBottom: '2px solid transparent',
    borderRadius: '0 0 10px 10px',
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    position: 'relative',
  },
  
  contentWrapperRevisionMode: {
    borderTop: '2px solid #06b6d4',
    borderLeft: '2px solid #06b6d4',
    borderRight: '2px solid #06b6d4',
    borderBottom: '2px solid #06b6d4',
    boxShadow: 'inset 0 0 20px rgba(6, 182, 212, 0.1), 0 0 15px rgba(6, 182, 212, 0.2)',
  },
  
  contentWrapperSuggestionMode: {
    borderTop: '2px solid #8b5cf6',
    borderLeft: '2px solid #8b5cf6',
    borderRight: '2px solid #8b5cf6',
    borderBottom: '2px solid #8b5cf6',
    boxShadow: 'inset 0 0 20px rgba(139, 92, 246, 0.1), 0 0 15px rgba(139, 92, 246, 0.2)',
  },
  
  contentWrapperEditing: {
    borderTop: '2px solid #FF8C00',
    borderLeft: '2px solid #FF8C00',
    borderRight: '2px solid #FF8C00',
    borderBottom: '2px solid #FF8C00',
    boxShadow: 'inset 0 0 20px rgba(255, 140, 0, 0.1), 0 0 15px rgba(255, 140, 0, 0.2)',
  },
  
  contentWrapperPending: {
    borderTop: '2px solid #06b6d4',
    borderLeft: '2px solid #06b6d4',
    borderRight: '2px solid #06b6d4',
    borderBottom: '2px solid #06b6d4',
    boxShadow: 'inset 0 0 20px rgba(6, 182, 212, 0.1), 0 0 15px rgba(6, 182, 212, 0.2)',
    animation: 'pendingPulse 2s ease-in-out infinite',
  },
  
  contentWrapperSuggestionPending: {
    borderTop: '2px solid #8b5cf6',
    borderLeft: '2px solid #8b5cf6',
    borderRight: '2px solid #8b5cf6',
    borderBottom: '2px solid #8b5cf6',
    boxShadow: 'inset 0 0 20px rgba(139, 92, 246, 0.1), 0 0 15px rgba(139, 92, 246, 0.2)',
    animation: 'suggestionPulse 2s ease-in-out infinite',
  },
  
  // New: Pulsing state when applying a suggestion
  contentWrapperApplying: {
    borderTop: '2px solid #8b5cf6',
    borderLeft: '2px solid #8b5cf6',
    borderRight: '2px solid #8b5cf6',
    borderBottom: '2px solid #8b5cf6',
    boxShadow: 'inset 0 0 20px rgba(139, 92, 246, 0.15), 0 0 25px rgba(139, 92, 246, 0.3)',
    animation: 'applyingPulse 1.2s ease-in-out infinite',
  },
  
  // New: Pulsing state when generating direct revision (cyan)
  contentWrapperGenerating: {
    borderTop: '2px solid #06b6d4',
    borderLeft: '2px solid #06b6d4',
    borderRight: '2px solid #06b6d4',
    borderBottom: '2px solid #06b6d4',
    boxShadow: 'inset 0 0 20px rgba(6, 182, 212, 0.15), 0 0 25px rgba(6, 182, 212, 0.3)',
    animation: 'generatingPulse 1.2s ease-in-out infinite',
  },
  
  pendingBadge: {
    background: 'rgba(6, 182, 212, 0.2)',
    color: '#06b6d4',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  suggestingBadge: {
    background: 'rgba(139, 92, 246, 0.2)',
    color: '#8b5cf6',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  // New: Badge for applying state
  applyingBadge: {
    background: 'rgba(139, 92, 246, 0.3)',
    color: '#a78bfa',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    animation: 'badgePulse 1.2s ease-in-out infinite',
  },
  
  // Pending revision approval badge
  reviewBadge: {
    background: 'rgba(16, 185, 129, 0.2)',
    color: '#10b981',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  // Pending revision approval buttons in header
  approvalButtons: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginLeft: 'auto',
  },
  
  approvalButton: {
    padding: '0.35rem 0.75rem',
    borderRadius: 6,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    transition: 'all 0.2s ease',
  },
  
  acceptButton: {
    background: 'rgba(16, 185, 129, 0.15)',
    color: '#10b981',
    border: '1px solid rgba(16, 185, 129, 0.3)',
  },
  
  retryButton: {
    background: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
    border: '1px solid rgba(139, 92, 246, 0.3)',
  },
  
  dismissButton: {
    background: 'rgba(248, 113, 113, 0.15)',
    color: '#f87171',
    border: '1px solid rgba(248, 113, 113, 0.3)',
  },
  
  // Highlight for pending revision replacement text
  pendingReplacementHighlight: {
    background: 'rgba(16, 185, 129, 0.25)',
    borderBottom: '2px solid #10b981',
    padding: '0 2px',
    borderRadius: 2,
    boxShadow: '0 0 8px rgba(16, 185, 129, 0.3)',
  },
  
  // Content wrapper when showing pending revision
  contentWrapperPendingRevision: {
    borderTop: '2px solid #10b981',
    borderLeft: '2px solid #10b981',
    borderRight: '2px solid #10b981',
    borderBottom: '2px solid #10b981',
    boxShadow: 'inset 0 0 20px rgba(16, 185, 129, 0.1), 0 0 20px rgba(16, 185, 129, 0.2)',
  },
  
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  
  titleText: {
    fontWeight: 600,
    fontSize: 14,
    color: '#fff',
  },
  
  editingBadge: {
    background: '#ff6b35',
    color: 'white',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  revisingBadge: {
    background: '#06b6d4',
    color: 'white',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  headerActions: {
    display: 'flex',
    gap: '0.5rem',
  },
  
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(40, 40, 48, 0.8)',
    color: 'rgba(255, 255, 255, 0.7)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  
  actionButtonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  
  internButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid rgba(6, 182, 212, 0.3)',
    background: 'rgba(6, 182, 212, 0.1)',
    color: '#06b6d4',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  
  internButtonActive: {
    background: 'rgba(6, 182, 212, 0.25)',
    borderColor: 'rgba(6, 182, 212, 0.5)',
    boxShadow: '0 0 12px rgba(6, 182, 212, 0.2)',
  },
  
  content: {
    padding: '1.25rem',
    overflowY: 'auto',
    flex: 1,
    position: 'relative',
  },
  
  proseTextarea: {
    width: '100%',
    minHeight: '100%',
    background: 'transparent',
    border: 'none',
    padding: 0,
    outline: 'none',
    resize: 'none',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 14,
    lineHeight: 1.9,
    color: 'rgba(255, 255, 255, 0.9)',
    overflow: 'hidden',
  },
  
  proseDisplay: {
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 14,
    lineHeight: 1.9,
    color: 'rgba(255, 255, 255, 0.9)',
    whiteSpace: 'pre-wrap',
    cursor: 'text',
  },
  
  // Empty state container
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 2rem',
    textAlign: 'center',
    minHeight: 200,
    cursor: 'pointer',
  },
  
  emptyStateIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(255, 107, 53, 0.15) 0%, rgba(255, 140, 0, 0.1) 100%)',
    border: '1px solid rgba(255, 107, 53, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '1.25rem',
    color: '#ff8c42',
  },
  
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.85)',
    marginBottom: '0.5rem',
  },
  
  emptyStateDescription: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.45)',
    lineHeight: 1.6,
    maxWidth: 320,
    marginBottom: '1.5rem',
  },
  
  emptyStateHint: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: 11,
    color: 'rgba(255, 107, 53, 0.7)',
    padding: '0.5rem 0.75rem',
    background: 'rgba(255, 107, 53, 0.08)',
    borderRadius: 6,
    border: '1px solid rgba(255, 107, 53, 0.15)',
  },
  
  highlightedText: {
    background: 'rgba(59, 130, 246, 0.2)',
    borderBottom: '2px solid rgba(59, 130, 246, 0.6)',
    padding: '0 2px',
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  
  revisionTargetHighlight: {
    background: 'rgba(6, 182, 212, 0.25)',
    borderBottom: '2px solid #06b6d4',
    padding: '0 2px',
    borderRadius: 2,
    boxShadow: '0 0 8px rgba(6, 182, 212, 0.3)',
  },
  
  suggestionTargetHighlight: {
    background: 'rgba(139, 92, 246, 0.25)',
    borderBottom: '2px solid #8b5cf6',
    padding: '0 2px',
    borderRadius: 2,
    boxShadow: '0 0 8px rgba(139, 92, 246, 0.3)',
  },
  
  // Skeleton highlight for loading state on selected text
  suggestionTargetSkeleton: {
    background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.3) 0%, rgba(167, 139, 250, 0.5) 50%, rgba(139, 92, 246, 0.3) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeletonShimmer 1.2s ease-in-out infinite',
    borderBottom: '2px solid #a78bfa',
    padding: '0 2px',
    borderRadius: 2,
    boxShadow: '0 0 12px rgba(139, 92, 246, 0.4)',
    color: 'transparent',
    position: 'relative',
  },
  
  // Green skeleton highlight for Try Again loading state
  pendingRevisionSkeleton: {
    background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.3) 0%, rgba(52, 211, 153, 0.5) 50%, rgba(16, 185, 129, 0.3) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeletonShimmer 1.2s ease-in-out infinite',
    borderBottom: '2px solid #34d399',
    padding: '0 2px',
    borderRadius: 2,
    boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)',
    color: 'transparent',
    position: 'relative',
  },
  
  // ==========================================================================
  // Revision Panel Styles - Independent card with full border
  // ==========================================================================
  
  revisionPanel: {
    width: 0,
    overflow: 'hidden',
    background: 'linear-gradient(180deg, rgba(30, 40, 45, 0.98) 0%, rgba(25, 35, 40, 0.98) 100%)',
    border: 'none',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.3s ease, border 0.3s ease, opacity 0.3s ease',
    zIndex: 1,
    position: 'relative',
    marginLeft: 12,
  },
  
  revisionPanelOpen: {
    width: 340,
    border: '2px solid rgba(6, 182, 212, 0.3)',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px rgba(6, 182, 212, 0.1)',
  },
  
  revisionPanelInner: {
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  
  revisionHeader: {
    padding: '1rem 1.25rem',
    borderBottom: '1px solid rgba(6, 182, 212, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  
  revisionHeaderTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  
  revisionIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
  },
  
  revisionTitleText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
  },
  
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    border: 'none',
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  
  revisionContent: {
    flex: 1,
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
    overflowY: 'auto',
  },
  
  revisionSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  
  revisionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(6, 182, 212, 0.8)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  
  targetBox: {
    padding: '0.75rem',
    background: 'rgba(6, 182, 212, 0.08)',
    border: '1px solid rgba(6, 182, 212, 0.2)',
    borderRadius: 8,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 1.5,
    maxHeight: 80,
    overflowY: 'auto',
  },
  
  targetLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: 13,
    color: '#06b6d4',
    fontWeight: 500,
  },
  
  guidanceTextarea: {
    width: '100%',
    minHeight: 100,
    padding: '0.75rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  
  guidanceTextareaFocused: {
    borderColor: 'rgba(6, 182, 212, 0.5)',
    boxShadow: '0 0 0 3px rgba(6, 182, 212, 0.1)',
  },
  
  hint: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    lineHeight: 1.4,
  },
  
  revisionFooter: {
    padding: '1rem 1.25rem',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
  },
  
  generateButton: {
    width: '100%',
    padding: '0.75rem 1rem',
    background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s ease',
  },
  
  generateButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  
  // Confirm popup
  confirmPopup: {
    position: 'absolute',
    bottom: -60,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px',
    background: 'linear-gradient(135deg, rgba(30, 35, 40, 0.98) 0%, rgba(25, 30, 35, 0.98) 100%)',
    border: '1px solid rgba(6, 182, 212, 0.3)',
    borderRadius: 10,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(6, 182, 212, 0.1)',
    animation: 'fadeInUp 0.2s ease',
  },
  
  confirmButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  
  confirmDivider: {
    width: 1,
    height: 24,
    background: 'rgba(255, 255, 255, 0.1)',
  },
  
  // Skeleton loading overlay
  skeletonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(26, 26, 30, 0.92)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    gap: '0.75rem',
    borderRadius: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  
  // Green skeleton overlay for Try Again state
  skeletonOverlayGreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(20, 30, 26, 0.92)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    gap: '0.75rem',
    borderRadius: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.2) 50%, rgba(139, 92, 246, 0.1) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeletonShimmer 1.5s ease-in-out infinite',
  },
  
  // Green skeleton line for Try Again state
  skeletonLineGreen: {
    height: 14,
    borderRadius: 4,
    background: 'linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.25) 50%, rgba(16, 185, 129, 0.1) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeletonShimmer 1.5s ease-in-out infinite',
  },
  
  skeletonLineLong: {
    width: '100%',
  },
  
  skeletonLineMedium: {
    width: '85%',
  },
  
  skeletonLineShort: {
    width: '65%',
  },
  
  skeletonLineXShort: {
    width: '45%',
  },
  
  skeletonLoadingText: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: 500,
    marginTop: '0.5rem',
  },
  
  // Green loading text for Try Again state
  skeletonLoadingTextGreen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    color: '#34d399',
    fontSize: 13,
    fontWeight: 500,
    marginTop: '0.5rem',
  },
  
  skeletonSpinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(139, 92, 246, 0.3)',
    borderTopColor: '#a78bfa',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  
  // Green spinner for Try Again state
  skeletonSpinnerGreen: {
    width: 14,
    height: 14,
    border: '2px solid rgba(16, 185, 129, 0.3)',
    borderTopColor: '#34d399',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  
  // Cyan skeleton overlay for direct revision state
  skeletonOverlayCyan: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(20, 26, 30, 0.92)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    gap: '0.75rem',
    borderRadius: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  
  // Cyan skeleton line for direct revision state
  skeletonLineCyan: {
    height: 14,
    borderRadius: 4,
    background: 'linear-gradient(90deg, rgba(6, 182, 212, 0.1) 0%, rgba(6, 182, 212, 0.25) 50%, rgba(6, 182, 212, 0.1) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeletonShimmer 1.5s ease-in-out infinite',
  },
  
  // Cyan loading text for direct revision state
  skeletonLoadingTextCyan: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    color: '#22d3ee',
    fontSize: 13,
    fontWeight: 500,
    marginTop: '0.5rem',
  },
  
  // Cyan spinner for direct revision state
  skeletonSpinnerCyan: {
    width: 14,
    height: 14,
    border: '2px solid rgba(6, 182, 212, 0.3)',
    borderTopColor: '#22d3ee',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

// =============================================================================
// Icons
// =============================================================================

const InternIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
    <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const LightningIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

// =============================================================================
// Extended Props Interface
// =============================================================================

// Pending revision type
interface PendingRevisionApproval {
  replacement: string;
  selectionBounds: { start: number; end: number } | null;
  direction: string;
  sessionId: string;
  originalContent: string;
  selectedSuggestionIds: string[];  // Track which suggestions generated this revision
}

interface ExtendedSegmentContentBlockProps extends SegmentContentBlockProps {
  suggestionTarget?: LinkedText | null;
  isSuggesting?: boolean;
  onClearSuggestionTarget?: () => void;
  suggestions?: CanvasCard[];
  showSuggestionCards?: boolean;
  onApplySelectedSuggestions?: (ids: string[]) => void;
  onDismissAllSuggestions?: () => void;
  onRegenerateSuggestions?: () => void;
  onCloseSuggestions?: () => void;
  // Apply feedback state
  isApplyingSuggestion?: boolean;
  // Pending revision approval
  pendingRevision?: PendingRevisionApproval | null;
  onAcceptRevision?: () => void;
  onRetryRevision?: () => Promise<void>;
  onDismissRevision?: () => void;
}

// =============================================================================
// Component
// =============================================================================

const SegmentContentBlock: React.FC<ExtendedSegmentContentBlockProps> = ({
  segmentId,
  segmentTitle,
  content,
  cards,
  onTextSelect,
  onContentChange,
  onGenerateRevision,
  revisionPending = null,
  onApplyRevision,
  onRevertRevision,
  externalRevisionTarget,
  onClearExternalTarget,
  suggestionTarget = null,
  isSuggesting = false,
  onClearSuggestionTarget,
  suggestions = [],
  showSuggestionCards = false,
  onApplySelectedSuggestions,
  onDismissAllSuggestions,
  onRegenerateSuggestions,
  onCloseSuggestions,
  // Apply feedback state
  isApplyingSuggestion = false,
  // Pending revision approval
  pendingRevision = null,
  onAcceptRevision,
  onRetryRevision,
  onDismissRevision,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Responsive layout
  const { width: windowWidth } = useWindowSize();
  const isCompact = windowWidth < 1100;
  
  // Revision panel state (managed internally)
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [revisionTarget, setRevisionTarget] = useState<LinkedText | null>(null);
  const [guidance, setGuidance] = useState('');
  const [isGuidanceFocused, setIsGuidanceFocused] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const guidanceRef = useRef<HTMLTextAreaElement>(null);
  
  // Sync local content with prop
  useEffect(() => {
    setLocalContent(content);
  }, [content]);
  
  // Focus guidance textarea when panel opens
  useEffect(() => {
    if (isPanelOpen && guidanceRef.current) {
      setTimeout(() => {
        guidanceRef.current?.focus();
      }, 300);
    }
  }, [isPanelOpen]);
  
  // Reset guidance when panel closes
  useEffect(() => {
    if (!isPanelOpen) {
      setGuidance('');
    }
  }, [isPanelOpen]);
  
  // Close panel and clear generating state when pendingRevision arrives or request completes
  useEffect(() => {
    if (pendingRevision && isGenerating) {
      setIsGenerating(false);
      setIsPanelOpen(false);
    }
  }, [pendingRevision, isGenerating]);
  
  // Also clear generating state if isApplyingSuggestion goes false (request failed or completed)
  useEffect(() => {
    if (!isApplyingSuggestion && isGenerating) {
      // Request completed (either with pendingRevision or error)
      // pendingRevision case is handled above, this catches errors
      if (!pendingRevision) {
        setIsGenerating(false);
      }
    }
  }, [isApplyingSuggestion, isGenerating, pendingRevision]);
  
  // Respond to external revision target (from SelectionPopup "Revise" button)
  useEffect(() => {
    if (externalRevisionTarget) {
      setRevisionTarget(externalRevisionTarget);
      setIsPanelOpen(true);
      setIsEditing(false);
      if (onClearExternalTarget) {
        onClearExternalTarget();
      }
    }
  }, [externalRevisionTarget, onClearExternalTarget]);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(200, ta.scrollHeight)}px`;
    }
  }, []);

  useEffect(() => {
    if (isEditing) {
      setTimeout(adjustTextareaHeight, 0);
    }
  }, [localContent, isEditing, adjustTextareaHeight]);
  
  // ==========================================================================
  // Revision panel handlers
  // ==========================================================================
  
  const handleOpenPanel = useCallback((targetText: LinkedText | null) => {
    setRevisionTarget(targetText);
    setIsPanelOpen(true);
    setIsEditing(false);
  }, []);
  
  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    setRevisionTarget(null);
  }, []);
  
  const handleGenerate = useCallback(() => {
    if (!guidance.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    if (onGenerateRevision) {
      onGenerateRevision(revisionTarget, guidance);
    }
    
    // Note: isGenerating will be cleared when pendingRevision arrives or on error
    // The panel will close when revision is ready
  }, [guidance, isGenerating, onGenerateRevision, revisionTarget]);
  
  const handleGuidanceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      handleGenerate();
    }
  }, [handleGenerate]);
  
  // ==========================================================================
  // Suggestion handlers
  // ==========================================================================
  
  const handleCloseSuggestions = useCallback(() => {
    if (onCloseSuggestions) {
      onCloseSuggestions();
    }
    if (onClearSuggestionTarget) {
      onClearSuggestionTarget();
    }
  }, [onCloseSuggestions, onClearSuggestionTarget]);
  
  const handleApplySelectedSuggestions = useCallback((ids: string[]) => {
    if (onApplySelectedSuggestions) {
      onApplySelectedSuggestions(ids);
    }
  }, [onApplySelectedSuggestions]);
  
  const handleDismissAllSuggestions = useCallback(() => {
    if (onDismissAllSuggestions) {
      onDismissAllSuggestions();
    }
  }, [onDismissAllSuggestions]);
  
  const handleRegenerateSuggestions = useCallback(() => {
    if (onRegenerateSuggestions) {
      onRegenerateSuggestions();
    }
  }, [onRegenerateSuggestions]);
  
  // Get linked text regions from cards
  const linkedRegions = cards
    .filter((card) => card.linkedText && card.status === 'active')
    .map((card) => card.linkedText!);
  
  // ==========================================================================
  // Text selection handling
  // ==========================================================================
  
  /**
   * Snap selection indices to word boundaries if the selection splits a word.
   * If the selection already starts/ends at word boundaries, leave it unchanged.
   */
  const snapToWordBoundaries = useCallback((text: string, start: number, end: number): { start: number; end: number } => {
    // Helper to check if a character is a word character
    const isWordChar = (char: string) => /\w/.test(char);
    
    let snappedStart = start;
    let snappedEnd = end;
    
    // Check if we're splitting a word at the start
    // (character before start is a word char AND character at start is a word char)
    if (start > 0 && isWordChar(text[start - 1]) && isWordChar(text[start])) {
      // Snap to beginning of the word (go backwards)
      while (snappedStart > 0 && isWordChar(text[snappedStart - 1])) {
        snappedStart--;
      }
    }
    
    // Check if we're splitting a word at the end
    // (character at end-1 is a word char AND character at end is a word char)
    if (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) {
      // Snap to end of the word (go forwards)
      while (snappedEnd < text.length && isWordChar(text[snappedEnd])) {
        snappedEnd++;
      }
    }
    
    return { start: snappedStart, end: snappedEnd };
  }, []);
  
  const handleMouseUp = useCallback(() => {
    if (isEditing && !isPanelOpen) return;
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    
    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // Find the raw start position
    const rawStart = localContent.indexOf(selectedText);
    if (rawStart === -1) return;
    
    const rawEnd = rawStart + selectedText.length;
    
    // Snap to word boundaries if selection splits a word
    const { start, end } = snapToWordBoundaries(localContent, rawStart, rawEnd);
    
    // Get the snapped text
    const snappedText = localContent.substring(start, end);
    
    const linkedText: LinkedText = {
      start,
      end,
      original: snappedText,
    };
    
    if (isPanelOpen) {
      setRevisionTarget(linkedText);
      selection.removeAllRanges();
      return;
    }
    
    const position: Position = {
      x: rect.left,
      y: rect.bottom + 8,
    };
    
    onTextSelect(linkedText, position);
  }, [isEditing, isPanelOpen, localContent, onTextSelect, snapToWordBoundaries]);
  
  // ==========================================================================
  // Editing handlers
  // ==========================================================================
  
  const handleDoubleClick = useCallback(() => {
    if (isPanelOpen || showSuggestionCards || isSuggesting || isApplyingSuggestion) return;
    
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [isPanelOpen, showSuggestionCards, isSuggesting, isApplyingSuggestion]);
  
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalContent(e.target.value);
  }, []);
  
  const handleTextareaBlur = useCallback(() => {
    setIsEditing(false);
    if (localContent !== content) {
      onContentChange(localContent);
    }
  }, [localContent, content, onContentChange]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setLocalContent(content);
    }
  }, [content]);
  
  // ==========================================================================
  // Render content with highlights
  // ==========================================================================
  
  const renderContent = () => {
    const contentToShow = revisionPending ? revisionPending.revisedContent : localContent;
    
    if (isEditing && !revisionPending && !pendingRevision) {
      return (
        <textarea
          ref={textareaRef}
          style={styles.proseTextarea}
          value={localContent}
          placeholder="Start writing your segment here..."
          onChange={(e) => {
            handleTextareaChange(e);
            adjustTextareaHeight();
          }}
          onBlur={(e) => {
            setIsFocused(false);
            handleTextareaBlur();
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />
      );
    }
    
    // If we have a pending revision waiting for approval, show preview with highlighted replacement
    // During Try Again (isApplyingSuggestion), show green shimmer skeleton
    if (pendingRevision) {
      if (pendingRevision.selectionBounds) {
        // Selection-based revision - show replacement highlighted in context
        const before = pendingRevision.originalContent.substring(0, pendingRevision.selectionBounds.start);
        const after = pendingRevision.originalContent.substring(pendingRevision.selectionBounds.end);
        
        // Use skeleton shimmer during Try Again, static highlight otherwise
        const highlightStyle = isApplyingSuggestion
          ? styles.pendingRevisionSkeleton
          : styles.pendingReplacementHighlight;
        
        // During shimmer, show placeholder text preserving whitespace structure
        const displayText = isApplyingSuggestion
          ? pendingRevision.replacement.replace(/[^\s]/g, '█')
          : pendingRevision.replacement;
        
        return (
          <div
            ref={contentRef}
            style={styles.proseDisplay}
          >
            {before}
            <span style={highlightStyle}>{displayText}</span>
            {after}
          </div>
        );
      } else {
        // Full segment revision - show entire replacement highlighted
        const highlightStyle = isApplyingSuggestion
          ? styles.pendingRevisionSkeleton
          : styles.pendingReplacementHighlight;
        
        const displayText = isApplyingSuggestion
          ? pendingRevision.replacement.replace(/[^\s]/g, '█')
          : pendingRevision.replacement;
        
        return (
          <div
            ref={contentRef}
            style={styles.proseDisplay}
          >
            <span style={highlightStyle}>{displayText}</span>
          </div>
        );
      }
    }
    
    // If panel is open and we have a specific revision target, highlight it (cyan)
    if (isPanelOpen && revisionTarget) {
      const before = localContent.substring(0, revisionTarget.start);
      const target = localContent.substring(revisionTarget.start, revisionTarget.end);
      const after = localContent.substring(revisionTarget.end);
      
      return (
        <div
          ref={contentRef}
          style={styles.proseDisplay}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        >
          {before}
          <span style={styles.revisionTargetHighlight}>{target}</span>
          {after}
        </div>
      );
    }
    
    // If we have a suggestion target, highlight it (purple) or show skeleton if applying
    if (suggestionTarget) {
      // Validate bounds to prevent rendering issues
      const contentLength = localContent.length;
      const start = Math.max(0, Math.min(suggestionTarget.start, contentLength));
      const end = Math.max(start, Math.min(suggestionTarget.end, contentLength));
      
      // Only render highlight if bounds are valid
      if (start < end && end <= contentLength) {
        const before = localContent.substring(0, start);
        const target = localContent.substring(start, end);
        const after = localContent.substring(end);
        
        // Use skeleton style only when applying suggestion, regular highlight otherwise
        const highlightStyle = isApplyingSuggestion
          ? styles.suggestionTargetSkeleton 
          : styles.suggestionTargetHighlight;
        
        return (
          <div
            ref={contentRef}
            style={styles.proseDisplay}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          >
            {before}
            <span style={highlightStyle}>{target}</span>
            {after}
          </div>
        );
      }
      // If bounds are invalid, fall through to render without highlight
    }
    
    // If no linked regions, render plain text (or empty state)
    if (linkedRegions.length === 0) {
      // Check if content is empty - show helpful empty state
      if (!contentToShow || contentToShow.trim() === '') {
        return (
          <div
            style={styles.emptyState}
            onClick={handleDoubleClick}
          >
            <div style={styles.emptyStateIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="18" x2="12" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="9" y1="15" x2="15" y2="15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={styles.emptyStateTitle}>This segment is empty</div>
            <div style={styles.emptyStateDescription}>
              Start writing to bring this part of your story to life, or use AI assistance to generate content.
            </div>
            <div style={styles.emptyStateHint}>
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                <path
                  d="M11.854 1.146a.5.5 0 00-.708 0L3.5 8.793V11.5h2.707l7.647-7.646a.5.5 0 000-.708l-2-2z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              Click to start writing
            </div>
          </div>
        );
      }
      
      return (
        <div
          ref={contentRef}
          style={styles.proseDisplay}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        >
          {contentToShow}
        </div>
      );
    }
    
    // Sort regions by start position
    const sortedRegions = [...linkedRegions].sort((a, b) => a.start - b.start);
    
    // Build content with highlights
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    
    sortedRegions.forEach((region, index) => {
      if (region.start > lastEnd) {
        parts.push(
          <span key={`text-${index}`}>
            {localContent.substring(lastEnd, region.start)}
          </span>
        );
      }
      
      parts.push(
        <span
          key={`highlight-${index}`}
          style={styles.highlightedText}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.35)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
          }}
        >
          {localContent.substring(region.start, region.end)}
        </span>
      );
      
      lastEnd = region.end;
    });
    
    if (lastEnd < localContent.length) {
      parts.push(
        <span key="text-end">
          {localContent.substring(lastEnd)}
        </span>
      );
    }
    
    return (
      <div
        ref={contentRef}
        style={styles.proseDisplay}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {parts}
      </div>
    );
  };
  
  // ==========================================================================
  // Determine content wrapper style
  // ==========================================================================
  
  const getContentWrapperStyle = () => {
    // Applying suggestion or generating revision takes priority - show pulsing animation
    if (isApplyingSuggestion) {
      // Use cyan for direct revision (panel open), purple for suggestion
      if (isPanelOpen) {
        return { ...styles.contentWrapper, ...styles.contentWrapperGenerating };
      }
      return { ...styles.contentWrapper, ...styles.contentWrapperApplying };
    }
    // Pending revision approval - green border
    if (pendingRevision) {
      return { ...styles.contentWrapper, ...styles.contentWrapperPendingRevision };
    }
    if (isPanelOpen) {
      return { ...styles.contentWrapper, ...styles.contentWrapperRevisionMode };
    }
    if ((showSuggestionCards || suggestionTarget) && isSuggesting) {
      return { ...styles.contentWrapper, ...styles.contentWrapperSuggestionPending };
    }
    if (showSuggestionCards || suggestionTarget) {
      return { ...styles.contentWrapper, ...styles.contentWrapperSuggestionMode };
    }
    if (revisionPending) {
      return { ...styles.contentWrapper, ...styles.contentWrapperPending };
    }
    if (isEditing) {
      return { ...styles.contentWrapper, ...styles.contentWrapperEditing };
    }
    return styles.contentWrapper;
  };
  
  // ==========================================================================
  // Render
  // ==========================================================================
  
  const displayContent = revisionPending ? revisionPending.revisedContent : localContent;
  const isPending = !!revisionPending;
  const isWholeSegment = !revisionTarget;
  
  // Filter for suggestion cards only
  const suggestionCards = suggestions.filter(card => card.type === 'suggestion' && card.status !== 'dismissed');
  
  // Calculate responsive widths
  const getContainerWidth = () => {
    if (isCompact) {
      return '100%';
    }
    return segmentId === 'SUM' ? 800 : 700;
  };
  
  const getPanelWidth = () => {
    if (isCompact) {
      return '100%';
    }
    return 340;
  };
  

  // Shift left when suggestion cards are showing on the right
  const hasSideContent = showSuggestionCards || isSuggesting || !!pendingRevision;
  const suggestionOffset = hasSideContent && !isPanelOpen && !isCompact ? -168 : 0;

  
  // Build outer container style based on compact mode
  const outerContainerStyle: React.CSSProperties = isCompact
    ? {
        position: 'relative',
        top: 'auto',
        left: 'auto',
        transform: 'none',
        width: '90vw',
        maxWidth: '600px',
        margin: '20px auto',
        padding: 0,
        zIndex: 20,
      }
      : {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: `translate(calc(-50% + ${suggestionOffset}px), -50%)`,
        zIndex: 20,
        transition: 'transform 0.3s ease',
      };
  
  return (
    <div style={outerContainerStyle}>
      {/* Keyframes */}
      <style>
        {`
          @keyframes suggestionPulse {
            0%, 100% { box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.1), 0 0 15px rgba(139, 92, 246, 0.2); }
            50% { box-shadow: inset 0 0 30px rgba(139, 92, 246, 0.15), 0 0 25px rgba(139, 92, 246, 0.3); }
          }
          @keyframes pendingPulse {
            0%, 100% { box-shadow: inset 0 0 20px rgba(6, 182, 212, 0.1), 0 0 15px rgba(6, 182, 212, 0.2); }
            50% { box-shadow: inset 0 0 30px rgba(6, 182, 212, 0.15), 0 0 25px rgba(6, 182, 212, 0.3); }
          }
          @keyframes applyingPulse {
            0%, 100% { 
              box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.15), 0 0 20px rgba(139, 92, 246, 0.25);
              border-color: #8b5cf6;
            }
            50% { 
              box-shadow: inset 0 0 40px rgba(139, 92, 246, 0.25), 0 0 35px rgba(139, 92, 246, 0.4);
              border-color: #a78bfa;
            }
          }
          @keyframes generatingPulse {
            0%, 100% { 
              box-shadow: inset 0 0 20px rgba(6, 182, 212, 0.15), 0 0 20px rgba(6, 182, 212, 0.25);
              border-color: #06b6d4;
            }
            50% { 
              box-shadow: inset 0 0 40px rgba(6, 182, 212, 0.25), 0 0 35px rgba(6, 182, 212, 0.4);
              border-color: #22d3ee;
            }
          }
          @keyframes skeletonShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          @keyframes badgePulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          /* Textarea placeholder styling */
          textarea::placeholder {
            color: rgba(255, 255, 255, 0.3);
            font-style: italic;
          }
        `}
      </style>
      
      {/* Inner wrapper for flex layout */}
      <div style={{
        ...styles.innerWrapper,
        flexDirection: isCompact ? 'column' : 'row',
        alignItems: isCompact ? 'center' : 'flex-start',
      }}>
        {/* Main Content Block */}
        <div style={{
          ...styles.container,
          width: getContainerWidth(),
          maxWidth: isCompact ? '100%' : (segmentId === 'SUM' ? 800 : 700),
          maxHeight: isCompact ? '35vh' : '75vh',
        }}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <span style={styles.titleText}>{segmentTitle || 'Segment Content'}</span>
            {/* Priority: Pending Revision Approval > Applying/Generating > Revising > Suggesting > Editing > Pending */}
            {pendingRevision && !isApplyingSuggestion && (
              <span style={styles.reviewBadge}>Review Changes</span>
            )}
            {isApplyingSuggestion && (
              <span style={styles.applyingBadge}>
                {isPanelOpen ? 'Generating...' : 'Applying...'}
              </span>
            )}
            {!pendingRevision && !isApplyingSuggestion && isPanelOpen && (
              <span style={styles.revisingBadge}>Revising</span>
            )}
            {!pendingRevision && !isApplyingSuggestion && !isPanelOpen && (showSuggestionCards || suggestionTarget) && (
              <span style={styles.suggestingBadge}>
                {isSuggesting ? 'Generating...' : 'Suggestions'}
              </span>
            )}
            {!pendingRevision && !isApplyingSuggestion && !isPanelOpen && !showSuggestionCards && !suggestionTarget && isEditing && !isPending && (
              <span style={styles.editingBadge}>Editing</span>
            )}
            {!pendingRevision && !isApplyingSuggestion && !isPanelOpen && !showSuggestionCards && !suggestionTarget && isPending && (
              <span style={styles.pendingBadge}>Pending Revision</span>
            )}
          </div>
          
          {/* Show approval buttons when pending revision, otherwise show normal actions */}
          {pendingRevision && !isApplyingSuggestion ? (
            <div style={styles.approvalButtons}>
              <button
                style={{ ...styles.approvalButton, ...styles.acceptButton }}
                onClick={onAcceptRevision}
                title="Accept and apply this revision"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                  <path d="M2 7.5L5.5 11L13 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Accept
              </button>
              <button
                style={{ ...styles.approvalButton, ...styles.retryButton }}
                onClick={onRetryRevision}
                title="Try a different revision"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                  <path d="M1.5 7.5C1.5 4.18629 4.18629 1.5 7.5 1.5C10.8137 1.5 13.5 4.18629 13.5 7.5C13.5 10.8137 10.8137 13.5 7.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M4 10.5L1.5 7.5L4 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Try Again
              </button>
              <button
                style={{ ...styles.approvalButton, ...styles.dismissButton }}
                onClick={onDismissRevision}
                title="Dismiss this revision"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(248, 113, 113, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(248, 113, 113, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(248, 113, 113, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(248, 113, 113, 0.3)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                  <path d="M3.5 3.5L11.5 11.5M3.5 11.5L11.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Dismiss
              </button>
            </div>
          ) : (
          <div style={styles.headerActions}>
            {/* Intern/Revision Button */}
            <button
              style={{
                ...styles.internButton,
                ...(isPanelOpen ? styles.internButtonActive : {}),
                ...(isApplyingSuggestion || pendingRevision ? styles.actionButtonDisabled : {}),
              }}
              title={pendingRevision ? "Review pending changes first" : "Open revision panel"}
              onClick={() => !isApplyingSuggestion && !pendingRevision && (isPanelOpen ? handleClosePanel() : handleOpenPanel(null))}
              disabled={isApplyingSuggestion || !!pendingRevision}
              onMouseEnter={(e) => {
                if (!isPanelOpen && !isApplyingSuggestion && !pendingRevision) {
                  e.currentTarget.style.background = 'rgba(6, 182, 212, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(6, 182, 212, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isPanelOpen && !isApplyingSuggestion && !pendingRevision) {
                  e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              <InternIcon />
            </button>
            
            {/* Edit Button */}
            <button
              style={{
                ...styles.actionButton,
                ...(isPanelOpen || showSuggestionCards || isApplyingSuggestion || pendingRevision ? styles.actionButtonDisabled : {}),
              }}
              title={
                isApplyingSuggestion ? "Applying suggestion..." :
                pendingRevision ? "Review pending changes first" :
                isPanelOpen ? "Close revision panel to edit" : 
                showSuggestionCards ? "Close suggestions to edit" : 
                "Edit content"
              }
              onClick={() => !isPanelOpen && !showSuggestionCards && !isApplyingSuggestion && !pendingRevision && setIsEditing(true)}
              disabled={isPanelOpen || showSuggestionCards || isApplyingSuggestion || !!pendingRevision}
              onMouseEnter={(e) => {
                if (!isPanelOpen && !showSuggestionCards && !isApplyingSuggestion && !pendingRevision) {
                  e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)';
                  e.currentTarget.style.color = '#ff8c42';
                }
              }}
              onMouseLeave={(e) => {
                if (!isPanelOpen && !showSuggestionCards && !isApplyingSuggestion && !pendingRevision) {
                  e.currentTarget.style.background = 'rgba(40, 40, 48, 0.8)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                <path
                  d="M11.854 1.146a.5.5 0 00-.708 0L3.5 8.793V11.5h2.707l7.647-7.646a.5.5 0 000-.708l-2-2z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
            </button>
          </div>
          )}
        </div>
        
        {/* Content Wrapper */}
        <div style={getContentWrapperStyle()}>
          <div style={styles.content}>
            {renderContent()}
            
            {/* Skeleton loading overlay when applying suggestion/revision to WHOLE segment (no specific selection, no pending revision) */}
            {isApplyingSuggestion && !suggestionTarget && !pendingRevision && (
              <div style={isPanelOpen ? styles.skeletonOverlayCyan : styles.skeletonOverlay}>
                {/* Skeleton lines mimicking text - cyan for direct revision, purple for suggestion */}
                {isPanelOpen ? (
                  <>
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineShort }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineXShort }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLineCyan, ...styles.skeletonLineShort }} />
                    
                    <div style={styles.skeletonLoadingTextCyan}>
                      <div style={styles.skeletonSpinnerCyan} />
                      Generating revision...
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineShort }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineXShort }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineLong }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineMedium }} />
                    <div style={{ ...styles.skeletonLine, ...styles.skeletonLineShort }} />
                    
                    <div style={styles.skeletonLoadingText}>
                      <div style={styles.skeletonSpinner} />
                      Applying suggestion...
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Static Suggestion Cards - positioned absolutely to the right of container */}
        {/* Always render - cards stay visible during Try Again loading */}
        <SuggestionCards
          isVisible={showSuggestionCards || isSuggesting || !!pendingRevision}
          isLoading={isSuggesting}
          suggestions={suggestionCards}
          targetText={suggestionTarget}
          onApplySelected={handleApplySelectedSuggestions}
          onDismissAll={handleDismissAllSuggestions}
          onRegenerate={handleRegenerateSuggestions}
          onClose={handleCloseSuggestions}
          selectedSuggestionIds={pendingRevision?.selectedSuggestionIds}
          isApplying={isApplyingSuggestion}
          isCompact={isCompact}
        />
      </div>
      
      {/* Revision Panel - Independent card */}
      <div style={{
        ...styles.revisionPanel,
        ...(isPanelOpen ? {
          ...styles.revisionPanelOpen,
          width: getPanelWidth(),
          maxWidth: isCompact ? '100%' : 340,
        } : {}),
        marginLeft: isCompact ? 0 : 12,
        marginTop: isCompact ? 12 : 0,
      }}>
        <div style={{
          ...styles.revisionPanelInner,
          width: isCompact ? '100%' : 340,
        }}>
          {/* Panel Header */}
          <div style={styles.revisionHeader}>
            <div style={styles.revisionHeaderTitle}>
              <div style={styles.revisionIcon}>
                <InternIcon />
              </div>
              <span style={styles.revisionTitleText}>Revision</span>
            </div>
            <button
              style={styles.closeButton}
              onClick={handleClosePanel}
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
          
          {/* Panel Content */}
          <div style={styles.revisionContent}>
            {/* Target Section */}
            <div style={styles.revisionSection}>
              <span style={styles.revisionLabel}>Revising</span>
              <div style={styles.targetBox}>
                <div style={styles.targetLabel}>
                  <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                    <path
                      d={isWholeSegment 
                        ? "M2 3h11M2 7.5h11M2 12h7" 
                        : "M5 2v11M10 2v11M2 5h11M2 10h11"
                      }
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                  {isWholeSegment ? 'Full Segment' : 'Selected Text'}
                </div>
              </div>
            </div>
            
            {/* Guidance Section */}
            <div style={styles.revisionSection}>
              <span style={styles.revisionLabel}>Guidance</span>
              <textarea
                ref={guidanceRef}
                style={{
                  ...styles.guidanceTextarea,
                  ...(isGuidanceFocused ? styles.guidanceTextareaFocused : {}),
                  minHeight: isCompact ? 60 : 100,
                }}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                onFocus={() => setIsGuidanceFocused(true)}
                onBlur={() => setIsGuidanceFocused(false)}
                onKeyDown={handleGuidanceKeyDown}
                placeholder="Describe the changes you want..."
                disabled={isGenerating}
              />
              <span style={styles.hint}>
                Be specific about tone, style, or content. ⌘+Enter to generate.
              </span>
            </div>
          </div>
          
          {/* Panel Footer */}
          <div style={styles.revisionFooter}>
            <button
              style={{
                ...styles.generateButton,
                ...(!guidance.trim() || isGenerating ? styles.generateButtonDisabled : {}),
              }}
              onClick={handleGenerate}
              disabled={!guidance.trim() || isGenerating}
              onMouseEnter={(e) => {
                if (guidance.trim() && !isGenerating) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(6, 182, 212, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {isGenerating ? (
                <>
                  <div style={styles.spinner} />
                  Generating...
                </>
              ) : (
                <>
                  <LightningIcon />
                  Generate Revision
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      
      {/* Pending Revision Confirm Popup - inside innerWrapper for positioning */}
      {isPending && (
        <div style={styles.confirmPopup}>
          {/* Apply Button */}
          <button
            style={{
              ...styles.confirmButton,
              color: '#10b981',
            }}
            onClick={onApplyRevision}
            title="Apply revision"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          
          <div style={styles.confirmDivider} />
          
          {/* Regenerate Button */}
          <button
            style={{
              ...styles.confirmButton,
              color: '#06b6d4',
            }}
            onClick={() => handleOpenPanel(revisionPending?.targetText || null)}
            title="Regenerate"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(6, 182, 212, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          
          <div style={styles.confirmDivider} />
          
          {/* Revert Button */}
          <button
            style={{
              ...styles.confirmButton,
              color: '#f87171',
            }}
            onClick={onRevertRevision}
            title="Revert to original"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(248, 113, 113, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
      </div>
    </div>
  );
};

export default SegmentContentBlock;