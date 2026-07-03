/**
 * SceneDetailPanel
 * 
 * Right-side panel for AI-powered scene suggestions and revisions.
 * 
 * UX FLOW:
 * - Panel opens via toolbar buttons: "Request Suggestions" or "Request Revisions"
 * - Panel starts in "selection mode" - user clicks scenes on canvas to select them
 * - User can optionally add guidance text
 * - Click "Generate" to run AI
 * - Results display with toggle selection (suggestions) or accept/dismiss (revisions)
 * 
 * Phase 4 Updates:
 * - hasActiveTextSelection prop to lock focus mode when text is selected
 * - Hide "Exit Focus View" button when text selection is active
 */

import React, { useState, useCallback } from 'react';
import {
  Scene,
  SegmentWithScenes,
  SEGMENT_COLORS,
  NoteCard,
  NoteCardColor,
} from './types';

// =============================================================================
// Types
// =============================================================================

export type PanelMode = 'suggestions' | 'revisions' | 'global-notes';
export type PanelState = 'selecting' | 'generating' | 'results' | 'reviewing';

export interface GlobalNote {
  cardId: string;
  content: string;
  color: NoteCardColor;
  createdAt?: string;
}

export interface SelectedSceneInfo {
  sceneId: string;
  segmentId: string;
  displayId: string;
  title: string;
}

export interface Suggestion {
  id: string;
  sceneId: string;
  displayId: string;
  content: string;
  isSelected: boolean;
  reasoning?: string;
}

export interface Revision {
  id: string;
  sceneId: string;
  displayId: string;
  sceneTitle: string;
  originalText: string;
  revisedText: string;
  status: 'pending' | 'accepted' | 'dismissed';
}

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
  // Focus mode
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  // Text selection mode (Phase 4) - locks focus mode
  hasActiveTextSelection?: boolean;
  // Transition suggestion mode (Phase 4)
  transitionContext?: {
    fromScene: { title: string; content: string; displayId: string };
    toScene: { title: string; content: string; displayId: string };
  } | null;
  onApplyTransitionSuggestion?: () => void;
  // Suggestions-specific
  onToggleSuggestion: (suggestionId: string) => void;
  onApplySuggestions: () => void;
  onRegenerateSuggestions: () => void;
  onDismissAllSuggestions: () => void;
  // Review changes (after applying suggestions)
  reviewingScenesCount?: number;
  acceptCheckedCount?: number;
  onAcceptChanges?: () => void;
  onTryAgain?: () => void;
  onDismissChanges?: () => void;
  // Revisions-specific
  onAcceptRevision: (revisionId: string) => void;
  onDismissRevision: (revisionId: string) => void;
  onRetryRevision: (revisionId: string) => void;
  // Global notes-specific
  globalNotes?: GlobalNote[];
  onAddGlobalNote?: () => void;
  onEditGlobalNote?: (noteId: string, content: string) => void;
  onDeleteGlobalNote?: (noteId: string) => void;
}

// =============================================================================
// Constants
// =============================================================================

const PANEL_WIDTH = 380;
const PURPLE = '#8b5cf6';
const CYAN = '#06b6d4';
const ORANGE = '#f97316';

const SUGGESTION_PLACEHOLDERS = [
  'What if we started in the middle?',
  'There\'s more to explore here...',
  'What\'s the version that scares me?',
  'How else could this land?',
  'What am I not seeing?',
  'Push this further...',
  'Where\'s the unexpected angle?',
  'What would surprise me here?',
  'Is there a quieter way in?',
  'What\'s underneath this moment?',
];

const REVISION_PLACEHOLDERS = [
  'Show, don\'t tell...',
  'Let\'s slow things down...',
  'I want this to end on a hanging question...',
  'Less dialogue, more tension...',
  'Make me feel the silence...',
  'This moment needs to breathe...',
  'Cut to the bone...',
  'Let the subtext do the work...',
  'Something\'s missing here...',
  'The pacing feels rushed...',
  'Trust the audience more...',
];

const getRandomPlaceholder = (list: string[]) =>
  list[Math.floor(Math.random() * list.length)];

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  panel: {
    width: PANEL_WIDTH,
    minWidth: PANEL_WIDTH,
    height: '100%',
    background: 'linear-gradient(180deg, #141416 0%, #0f0f11 100%)',
    borderLeft: '1px solid #2a2a2e',
    display: 'flex',
    flexDirection: 'column',
    animation: 'slideInFromRight 0.3s ease',
  },
  
  // Header
  header: {
    padding: '16px 20px',
    margin: '12px 12px 0 12px',
    borderRadius: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  
  headerSuggestions: {
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
  },
  
  headerRevisions: {
    background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
  },
  
  headerGlobalNotes: {
    background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  },
  
  headerLeft: {
    flex: 1,
  },
  
  headerTitle: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#fff',
  },
  
  headerSubtitle: {
    fontSize: '13px',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  
  closeButton: {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 255, 255, 0.15)',
    border: 'none',
    borderRadius: '6px',
    color: 'rgba(255, 255, 255, 0.8)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    flexShrink: 0,
    marginLeft: '12px',
  },
  
  // Content
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px',
  },
  
  // Selection Prompt (empty state)
  selectionPrompt: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 24px',
    textAlign: 'center' as const,
  },
  
  selectionIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  
  selectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#fff',
    marginBottom: '8px',
  },
  
  selectionDesc: {
    fontSize: '14px',
    color: '#666',
    lineHeight: 1.5,
  },
  
  // Selected Scenes List
  selectedScenes: {
    marginBottom: '20px',
  },
  
  selectedLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#666',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  
  selectedCount: {
    background: '#2a2a2e',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    color: '#888',
  },
  
  selectedSceneItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    background: '#1a1a1e',
    borderRadius: '8px',
    marginBottom: '8px',
    border: '1px solid #2a2a2e',
  },
  
  sceneBadge: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '3px 6px',
    borderRadius: '4px',
    color: 'white',
  },
  
  sceneTitle: {
    flex: 1,
    fontSize: '13px',
    color: '#e0e0e0',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  
  removeBtn: {
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    border: 'none',
    background: 'transparent',
    color: '#666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    transition: 'all 0.15s ease',
  },
  
  // Guidance Input
  guidanceSection: {
    marginBottom: '20px',
  },
  
  guidanceLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#666',
    marginBottom: '8px',
    display: 'block',
  },
  
  guidanceTextarea: {
    width: '100%',
    padding: '12px',
    background: '#1a1a1e',
    border: '1px solid #2a2a2e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '13px',
    lineHeight: 1.5,
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  },
  
  // Focus Mode Button
  focusModeBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'transparent',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.15s ease',
    marginBottom: '12px',
  },
  
  // Generate Button
  generateBtn: {
    width: '100%',
    padding: '14px 16px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.15s ease',
  },
  
  // Loading State
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 24px',
    textAlign: 'center' as const,
  },
  
  loadingSpinner: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid #2a2a2e',
    marginBottom: '16px',
    animation: 'spin 1s linear infinite',
  },
  
  loadingText: {
    fontSize: '14px',
    color: '#888',
  },
  
  loadingSubtext: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  
  // Action Buttons Row (Regenerate / Dismiss All)
  actionButtonsRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  
  actionBtn: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  
  regenerateBtn: {
    background: 'transparent',
    border: '1px solid #8b5cf6',
    color: '#8b5cf6',
  },
  
  dismissAllBtn: {
    background: '#2a2a2e',
    border: '1px solid #2a2a2e',
    color: '#888',
  },
  
  // Apply Suggestions Button (green, full width)
  applyBtn: {
    width: '100%',
    padding: '14px 16px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    fontSize: '14px',
    fontWeight: 600,
    color: 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.15s ease',
    marginBottom: '16px',
  },
  
  // Review Changes State
  reviewActionsRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  
  reviewAcceptBtn: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  },
  
  reviewTryAgainBtn: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #8b5cf6',
    background: 'transparent',
    fontSize: '13px',
    fontWeight: 600,
    color: '#8b5cf6',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  
  reviewDismissBtn: {
    flex: 1,
    padding: '10px 12px',
    borderRadius: '8px',
    border: 'none',
    background: 'rgba(239, 68, 68, 0.15)',
    fontSize: '13px',
    fontWeight: 600,
    color: '#ef4444',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  
  reviewBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: '6px',
    background: 'rgba(16, 185, 129, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    color: '#10b981',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginLeft: '10px',
  },
  
  // Suggestion Card
  suggestionCard: {
    background: '#1a1a1e',
    border: '1px solid #2a2a2e',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  suggestionCardSelected: {
    borderColor: PURPLE,
    background: 'rgba(139, 92, 246, 0.08)',
  },
  
  suggestionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },
  
  suggestionIconBadge: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: PURPLE,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  
  suggestionLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: PURPLE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  
  suggestionHeaderRight: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  
  whyButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    background: 'transparent',
    border: '1px solid #3a3a3e',
    borderRadius: '6px',
    color: '#888',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  // Toggle Switch
  toggleSwitch: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    background: '#3a3a3e',
    position: 'relative' as const,
    cursor: 'pointer',
    transition: 'background 0.2s ease',
  },
  
  toggleSwitchActive: {
    background: PURPLE,
  },
  
  toggleKnob: {
    position: 'absolute' as const,
    top: '2px',
    left: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    background: '#fff',
    transition: 'transform 0.2s ease',
  },
  
  toggleKnobActive: {
    transform: 'translateX(20px)',
  },
  
  suggestionContent: {
    fontSize: '14px',
    color: '#e0e0e0',
    lineHeight: 1.6,
  },
  
  // Why Expanded
  whyContent: {
    marginTop: '12px',
    padding: '12px',
    background: 'rgba(139, 92, 246, 0.1)',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#a0a0a0',
    lineHeight: 1.5,
  },
  
  // Footer hint
  footerHint: {
    padding: '16px 20px',
    textAlign: 'center' as const,
    fontSize: '13px',
    color: '#666',
    borderTop: '1px solid #2a2a2e',
  },
  
  // Revision Card
  revisionCard: {
    background: '#1a1a1e',
    border: '1px solid #2a2a2e',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
  },
  
  revisionCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },
  
  revisionOriginal: {
    background: '#141416',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '10px',
    borderLeft: '3px solid #3a3a3e',
  },
  
  revisionLabel: {
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#666',
    marginBottom: '6px',
  },
  
  revisionText: {
    fontSize: '13px',
    color: '#888',
    lineHeight: 1.5,
  },
  
  revisionNew: {
    background: 'rgba(6, 182, 212, 0.08)',
    borderRadius: '8px',
    padding: '12px',
    borderLeft: `3px solid ${CYAN}`,
  },
  
  revisionNewText: {
    fontSize: '13px',
    color: '#e0e0e0',
    lineHeight: 1.5,
  },
  
  revisionActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '12px',
  },
  
  revisionActionBtn: {
    padding: '8px 14px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  revisionAcceptBtn: {
    background: CYAN,
    color: 'white',
  },
  
  revisionRetryBtn: {
    background: '#2a2a2e',
    color: '#e0e0e0',
  },
  
  revisionDismissBtn: {
    background: 'transparent',
    color: '#666',
    marginLeft: 'auto',
  },
  
  // Global Notes styles
  globalNotesEmpty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 24px',
    textAlign: 'center' as const,
  },
  
  globalNotesEmptyIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    background: 'rgba(249, 115, 22, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  
  globalNotesEmptyTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#fff',
    marginBottom: '8px',
  },
  
  globalNotesEmptyDesc: {
    fontSize: '14px',
    color: '#666',
    lineHeight: 1.5,
    marginBottom: '20px',
  },
  
  addGlobalNoteBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  globalNoteCard: {
    background: '#1a1a1e',
    border: '1px solid #2a2a2e',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '12px',
    position: 'relative' as const,
  },
  
  globalNoteHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  
  globalNoteBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    color: ORANGE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  
  globalNoteActions: {
    display: 'flex',
    gap: '4px',
  },
  
  globalNoteActionBtn: {
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: '#666',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  globalNoteContent: {
    fontSize: '14px',
    color: '#e0e0e0',
    lineHeight: 1.6,
  },
  
  globalNoteTextarea: {
    width: '100%',
    padding: '12px',
    background: '#141416',
    border: '1px solid #3a3a3e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '14px',
    lineHeight: 1.6,
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  
  globalNotesListHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  
  globalNotesCount: {
    fontSize: '13px',
    color: '#888',
  },
  
  addNoteSmallBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    background: 'rgba(249, 115, 22, 0.15)',
    border: '1px solid rgba(249, 115, 22, 0.3)',
    borderRadius: '6px',
    color: ORANGE,
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
};

// =============================================================================
// Icons
// =============================================================================

const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const LightningIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill={color}>
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const GlassesIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="12" r="4" />
    <circle cx="18" cy="12" r="4" />
    <path d="M10 12h4" />
  </svg>
);

const RefreshIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const ChevronDownIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const LightbulbIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.9V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.1A7 7 0 0 0 12 2z" />
  </svg>
);

const GlobeIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const TrashIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const FocusIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M3 12h3M18 12h3M12 3v3M12 18v3" />
    <path d="M5 5l2.5 2.5M16.5 16.5L19 19M5 19l2.5-2.5M16.5 7.5L19 5" />
  </svg>
);

const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// =============================================================================
// Helper: Get segment color
// =============================================================================

const getSegmentColor = (segmentId: string): string => {
  return SEGMENT_COLORS[segmentId] || '#888';
};

// =============================================================================
// Sub-components
// =============================================================================

interface SelectionModeContentProps {
  mode: PanelMode;
  selectedScenes: SelectedSceneInfo[];
  guidance: string;
  onGuidanceChange: (guidance: string) => void;
  onRemoveScene: (sceneId: string) => void;
  onGenerate: () => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  hasActiveTextSelection?: boolean;
  transitionContext?: {
    fromScene: { title: string; content: string; displayId: string };
    toScene: { title: string; content: string; displayId: string };
  } | null;
}

const SelectionModeContent: React.FC<SelectionModeContentProps> = ({
  mode,
  selectedScenes,
  guidance,
  onGuidanceChange,
  onRemoveScene,
  onGenerate,
  isFocusMode = false,
  onToggleFocusMode,
  hasActiveTextSelection = false,
  transitionContext = null,
}) => {
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [placeholder] = useState(() =>
    mode === 'suggestions'
      ? getRandomPlaceholder(SUGGESTION_PLACEHOLDERS)
      : getRandomPlaceholder(REVISION_PLACEHOLDERS)
  );
  const isPurple = mode === 'suggestions';
  const accentColor = isPurple ? PURPLE : CYAN;
  
  // Transition suggestion mode - show context scenes instead of selected scenes
  if (transitionContext) {
    return (
      <>
        {/* Context: Between these scenes */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 11,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
            color: '#666',
            marginBottom: 12,
          }}>
            Suggest a scene between
          </div>
          
          {/* From Scene */}
          <div style={{
            background: '#1a1a1e',
            border: '1px solid #2a2a2e',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 6px',
                borderRadius: 4,
                background: '#ff6b35',
                color: 'white',
              }}>
                {transitionContext.fromScene.displayId}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
                {transitionContext.fromScene.title || 'Untitled Scene'}
              </span>
            </div>
            <p style={{
              fontSize: 12,
              color: '#888',
              margin: 0,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {transitionContext.fromScene.content || 'No content'}
            </p>
          </div>
          
          {/* Arrow */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            padding: '4px 0',
            color: '#666',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>
          
          {/* To Scene */}
          <div style={{
            background: '#1a1a1e',
            border: '1px solid #2a2a2e',
            borderRadius: 8,
            padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 6px',
                borderRadius: 4,
                background: '#ff6b35',
                color: 'white',
              }}>
                {transitionContext.toScene.displayId}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
                {transitionContext.toScene.title || 'Untitled Scene'}
              </span>
            </div>
            <p style={{
              fontSize: 12,
              color: '#888',
              margin: 0,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {transitionContext.toScene.content || 'No content'}
            </p>
          </div>
        </div>
        
        {/* Guidance */}
        <div style={styles.guidanceSection}>
          <label style={styles.guidanceLabel}>
            What should happen between these scenes?
          </label>
          <textarea
            style={{
              ...styles.guidanceTextarea,
              borderColor: textareaFocused ? PURPLE : '#2a2a2e',
            }}
            value={guidance}
            onChange={(e) => onGuidanceChange(e.target.value)}
            onFocus={() => setTextareaFocused(true)}
            onBlur={() => setTextareaFocused(false)}
            placeholder="e.g., Add tension, show the journey, reveal new information..."
          />
        </div>
        
        {/* Generate Button */}
        <button
          style={{
            ...styles.generateBtn,
            background: PURPLE,
            color: 'white',
          }}
          onClick={onGenerate}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.filter = 'brightness(1.1)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.filter = 'brightness(1)';
          }}
        >
          <LightningIcon size={16} color="white" />
          Generate Scene Ideas
        </button>
      </>
    );
  }
  
  if (selectedScenes.length === 0) {
    return (
      <div style={styles.selectionPrompt}>
        <div 
          style={{
            ...styles.selectionIcon,
            background: isPurple ? 'rgba(139, 92, 246, 0.15)' : 'rgba(6, 182, 212, 0.15)',
          }}
        >
          {isPurple ? (
            <LightningIcon size={24} color={accentColor} />
          ) : (
            <GlassesIcon size={24} color={accentColor} />
          )}
        </div>
        <div style={styles.selectionTitle}>Select Scenes</div>
        <div style={styles.selectionDesc}>
          Click on scenes in the canvas to add them for {mode}
        </div>
      </div>
    );
  }
  
  return (
    <>
      <div style={styles.selectedScenes}>
        <div style={styles.selectedLabel}>
          Selected Scenes
          <span style={styles.selectedCount}>{selectedScenes.length}</span>
        </div>
        {selectedScenes.map(scene => (
          <div key={scene.sceneId} style={styles.selectedSceneItem}>
            <span 
              style={{
                ...styles.sceneBadge,
                background: getSegmentColor(scene.segmentId),
              }}
            >
              {scene.displayId}
            </span>
            <span style={styles.sceneTitle}>{scene.title || 'Untitled Scene'}</span>
            {/* Hide remove button when text selection is active */}
            {!hasActiveTextSelection && (
              <button
                style={styles.removeBtn}
                onClick={() => onRemoveScene(scene.sceneId)}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.color = '#ff6b6b';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.color = '#666';
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      
      <div style={styles.guidanceSection}>
        <label style={styles.guidanceLabel}>
          {mode === 'suggestions' ? 'Guidance (optional)' : 'Revision guidance'}
        </label>
        <textarea
          style={{
            ...styles.guidanceTextarea,
            borderColor: textareaFocused ? accentColor : '#2a2a2e',
          }}
          value={guidance}
          onChange={(e) => onGuidanceChange(e.target.value)}
          onFocus={() => setTextareaFocused(true)}
          onBlur={() => setTextareaFocused(false)}
          placeholder={placeholder}
        />
      </div>
      
      {/* Focus Mode Toggle Button - hide when text selection is active (already in focus mode) */}
      {onToggleFocusMode && !hasActiveTextSelection && (
        <button
          style={{
            ...styles.focusModeBtn,
            borderColor: isFocusMode ? accentColor : 'rgba(255, 255, 255, 0.1)',
            color: isFocusMode ? accentColor : 'rgba(255, 255, 255, 0.6)',
            background: isFocusMode ? `${accentColor}15` : 'transparent',
          }}
          onClick={onToggleFocusMode}
          onMouseEnter={(e) => {
            if (!isFocusMode) {
              (e.target as HTMLButtonElement).style.borderColor = accentColor;
              (e.target as HTMLButtonElement).style.color = accentColor;
            }
          }}
          onMouseLeave={(e) => {
            if (!isFocusMode) {
              (e.target as HTMLButtonElement).style.borderColor = 'rgba(255, 255, 255, 0.1)';
              (e.target as HTMLButtonElement).style.color = 'rgba(255, 255, 255, 0.6)';
            }
          }}
        >
          <FocusIcon size={16} />
          {isFocusMode ? 'Exit Focus View' : 'Focus View'}
        </button>
      )}
      
      <button
        style={{
          ...styles.generateBtn,
          background: accentColor,
          color: 'white',
        }}
        onClick={onGenerate}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.filter = 'brightness(1.1)';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.filter = 'brightness(1)';
        }}
      >
        {isPurple ? <LightningIcon size={16} color="white" /> : <GlassesIcon size={16} color="white" />}
        Generate {mode === 'suggestions' ? 'Suggestions' : 'Revisions'}
      </button>
    </>
  );
};

interface LoadingContentProps {
  mode: PanelMode;
}

const LoadingContent: React.FC<LoadingContentProps> = ({ mode }) => {
  const isPurple = mode === 'suggestions';
  const accentColor = isPurple ? PURPLE : CYAN;
  
  return (
    <div style={styles.loadingState}>
      <div 
        style={{
          ...styles.loadingSpinner,
          borderTopColor: accentColor,
        }}
      />
      <div style={styles.loadingText}>
        {isPurple ? 'Analyzing scenes...' : 'Generating revisions...'}
      </div>
      <div style={styles.loadingSubtext}>This may take a moment</div>
    </div>
  );
};

interface SuggestionCardProps {
  suggestion: Suggestion;
  index: number;
  onToggle: () => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  index,
  onToggle,
}) => {
  const [showWhy, setShowWhy] = useState(false);
  const [whyHovered, setWhyHovered] = useState(false);
  
  return (
    <div
      style={{
        ...styles.suggestionCard,
        ...(suggestion.isSelected ? styles.suggestionCardSelected : {}),
      }}
      onClick={onToggle}
    >
      <div style={styles.suggestionHeader}>
        <div style={styles.suggestionIconBadge}>
          <LightningIcon size={16} color="white" />
        </div>
        <span style={styles.suggestionLabel}>Suggestion {index + 1}</span>
        
        <div style={styles.suggestionHeaderRight}>
          <button
            style={{
              ...styles.whyButton,
              ...(whyHovered ? { borderColor: PURPLE, color: PURPLE } : {}),
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowWhy(!showWhy);
            }}
            onMouseEnter={() => setWhyHovered(true)}
            onMouseLeave={() => setWhyHovered(false)}
          >
            <LightbulbIcon />
            Why
            <ChevronDownIcon />
          </button>
          
          <div
            style={{
              ...styles.toggleSwitch,
              ...(suggestion.isSelected ? styles.toggleSwitchActive : {}),
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <div
              style={{
                ...styles.toggleKnob,
                ...(suggestion.isSelected ? styles.toggleKnobActive : {}),
              }}
            />
          </div>
        </div>
      </div>
      
      <div style={styles.suggestionContent}>
        {suggestion.content}
      </div>
      
      {showWhy && suggestion.reasoning && (
        <div style={styles.whyContent}>
          {suggestion.reasoning}
        </div>
      )}
    </div>
  );
};

interface SuggestionsResultsProps {
  suggestions: Suggestion[];
  onToggleSuggestion: (suggestionId: string) => void;
  onApplySuggestions: () => void;
  onRegenerateSuggestions: () => void;
  onDismissAllSuggestions: () => void;
  isTransitionMode?: boolean;
  onApplyTransitionSuggestion?: () => void;
}

const SuggestionsResults: React.FC<SuggestionsResultsProps> = ({
  suggestions,
  onToggleSuggestion,
  onApplySuggestions,
  onRegenerateSuggestions,
  onDismissAllSuggestions,
  isTransitionMode = false,
  onApplyTransitionSuggestion,
}) => {
  const [regenerateHovered, setRegenerateHovered] = useState(false);
  const [dismissHovered, setDismissHovered] = useState(false);
  const [applyHovered, setApplyHovered] = useState(false);
  
  const selectedCount = suggestions.filter(s => s.isSelected).length;
  const hasSelection = selectedCount > 0;
  
  // For transition mode, only allow selecting ONE suggestion
  const handleApply = isTransitionMode && onApplyTransitionSuggestion 
    ? onApplyTransitionSuggestion 
    : onApplySuggestions;
  
  return (
    <>
      {/* Show Apply button when suggestions are selected */}
      {hasSelection ? (
        <button
          style={{
            ...styles.applyBtn,
            ...(applyHovered ? { filter: 'brightness(1.1)' } : {}),
          }}
          onClick={handleApply}
          onMouseEnter={() => setApplyHovered(true)}
          onMouseLeave={() => setApplyHovered(false)}
        >
          {isTransitionMode ? (
            <>
              <LightningIcon size={16} color="white" />
              Generate Scene
            </>
          ) : (
            <>
              <CheckIcon size={16} />
              Apply {selectedCount} Suggestion{selectedCount !== 1 ? 's' : ''}
            </>
          )}
        </button>
      ) : (
        <div style={styles.actionButtonsRow}>
          <button
            style={{
              ...styles.actionBtn,
              ...styles.regenerateBtn,
              ...(regenerateHovered ? { background: 'rgba(139, 92, 246, 0.1)' } : {}),
            }}
            onClick={onRegenerateSuggestions}
            onMouseEnter={() => setRegenerateHovered(true)}
            onMouseLeave={() => setRegenerateHovered(false)}
          >
            <RefreshIcon />
            Regenerate
          </button>
          <button
            style={{
              ...styles.actionBtn,
              ...styles.dismissAllBtn,
              ...(dismissHovered ? { background: '#3a3a3e', color: '#e0e0e0' } : {}),
            }}
            onClick={onDismissAllSuggestions}
            onMouseEnter={() => setDismissHovered(true)}
            onMouseLeave={() => setDismissHovered(false)}
          >
            Dismiss All
          </button>
        </div>
      )}
      
      <div>
        {suggestions.map((suggestion, index) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            index={index}
            onToggle={() => onToggleSuggestion(suggestion.id)}
          />
        ))}
      </div>
    </>
  );
};

// =============================================================================
// Review Changes Content (after applying suggestions)
// =============================================================================

interface ReviewChangesContentProps {
    totalScenesCount: number;
    checkedScenesCount: number;
    revisions: Revision[];
    onAccept: () => void;
    onTryAgain: () => void;
    onDismiss: () => void;
  }
  
  const ReviewChangesContent: React.FC<ReviewChangesContentProps> = ({
    totalScenesCount,
    checkedScenesCount,
    revisions,
    onAccept,
    onTryAgain,
    onDismiss,
  }) => {
    const [acceptHovered, setAcceptHovered] = useState(false);
    const [tryAgainHovered, setTryAgainHovered] = useState(false);
    const [dismissHovered, setDismissHovered] = useState(false);
  
    const pendingRevisions = revisions.filter(r => r.status === 'pending');
    const hasRevisions = pendingRevisions.length > 0;
  
    return (
      <>
        {/* Action Buttons */}
        <div style={styles.reviewActionsRow}>
          <button
            style={{
              ...styles.reviewAcceptBtn,
              ...(acceptHovered && hasRevisions ? { filter: 'brightness(1.1)' } : {}),
              ...(!hasRevisions ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onClick={hasRevisions ? onAccept : undefined}
            onMouseEnter={() => setAcceptHovered(true)}
            onMouseLeave={() => setAcceptHovered(false)}
            disabled={!hasRevisions}
          >
            <CheckIcon size={14} />
            {pendingRevisions.length === 1
              ? 'Accept'
              : `Accept All (${pendingRevisions.length})`}
          </button>
          <button
            style={{
              ...styles.reviewTryAgainBtn,
              ...(tryAgainHovered ? { background: 'rgba(139, 92, 246, 0.1)' } : {}),
            }}
            onClick={onTryAgain}
            onMouseEnter={() => setTryAgainHovered(true)}
            onMouseLeave={() => setTryAgainHovered(false)}
          >
            <RefreshIcon />
            Try Again
          </button>
          <button
            style={{
              ...styles.reviewDismissBtn,
              ...(dismissHovered ? { background: 'rgba(239, 68, 68, 0.25)' } : {}),
            }}
            onClick={onDismiss}
            onMouseEnter={() => setDismissHovered(true)}
            onMouseLeave={() => setDismissHovered(false)}
          >
            <CloseIcon size={12} />
            Dismiss
          </button>
        </div>
  
        {/* Revision Diffs */}
        {pendingRevisions.map((revision, index) => (
          <div key={revision.id} style={styles.revisionCard}>
            <div style={styles.revisionCardHeader}>
              <span style={{
                ...styles.sceneBadge,
                background: PURPLE,
              }}>
                {revision.displayId}
              </span>
              <span style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#e0e0e0',
              }}>
                {revision.sceneTitle}
              </span>
            </div>
  
            <div style={styles.revisionOriginal}>
              <div style={styles.revisionLabel}>Original</div>
              <div style={styles.revisionText}>
                {revision.originalText.length > 300
                  ? revision.originalText.slice(0, 300) + '…'
                  : revision.originalText}
              </div>
            </div>
  
            <div style={styles.revisionNew}>
              <div style={styles.revisionLabel}>Revised</div>
              <div style={styles.revisionNewText}>{revision.revisedText}</div>
            </div>
          </div>
        ))}
      </>
    );
  };

interface RevisionsResultsProps {
  revisions: Revision[];
  onAcceptRevision: (revisionId: string) => void;
  onDismissRevision: (revisionId: string) => void;
  onRetryRevision: (revisionId: string) => void;
}

const RevisionsResults: React.FC<RevisionsResultsProps> = ({
  revisions,
  onAcceptRevision,
  onDismissRevision,
  onRetryRevision,
}) => {
  const pendingRevisions = revisions.filter(r => r.status === 'pending');
  
  if (pendingRevisions.length === 0) {
    return (
      <div style={styles.selectionPrompt}>
        <div style={styles.selectionTitle}>All Done!</div>
        <div style={styles.selectionDesc}>
          All revisions have been processed.
        </div>
      </div>
    );
  }
  
  return (
    <div>
      {pendingRevisions.map((revision, index) => (
        <div key={revision.id} style={styles.revisionCard}>
          <div style={styles.revisionCardHeader}>
            <div style={{ ...styles.suggestionIconBadge, background: CYAN }}>
              <GlassesIcon size={16} color="white" />
            </div>
            <span style={{ ...styles.suggestionLabel, color: CYAN }}>
              Revision {index + 1}
            </span>
          </div>
          
          <div style={styles.revisionOriginal}>
            <div style={styles.revisionLabel}>Original</div>
            <div style={styles.revisionText}>{revision.originalText}</div>
          </div>
          
          <div style={styles.revisionNew}>
            <div style={styles.revisionLabel}>Revised</div>
            <div style={styles.revisionNewText}>{revision.revisedText}</div>
          </div>
          
          <div style={styles.revisionActions}>
            <button
              style={{
                ...styles.revisionActionBtn,
                ...styles.revisionAcceptBtn,
              }}
              onClick={() => onAcceptRevision(revision.id)}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.background = '#00acc1';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.background = CYAN;
              }}
            >
              Accept
            </button>
            <button
              style={{
                ...styles.revisionActionBtn,
                ...styles.revisionRetryBtn,
              }}
              onClick={() => onRetryRevision(revision.id)}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.background = '#3a3a3e';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.background = '#2a2a2e';
              }}
            >
              Try Again
            </button>
            <button
              style={{
                ...styles.revisionActionBtn,
                ...styles.revisionDismissBtn,
              }}
              onClick={() => onDismissRevision(revision.id)}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.color = '#ff6b6b';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.color = '#666';
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// Global Notes Content
// =============================================================================

interface GlobalNotesContentProps {
  globalNotes: GlobalNote[];
  onAddGlobalNote: () => void;
  onEditGlobalNote: (noteId: string, content: string) => void;
  onDeleteGlobalNote: (noteId: string) => void;
}

const GlobalNotesContent: React.FC<GlobalNotesContentProps> = ({
  globalNotes,
  onAddGlobalNote,
  onEditGlobalNote,
  onDeleteGlobalNote,
}) => {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  
  const handleStartEdit = (note: GlobalNote) => {
    setEditingNoteId(note.cardId);
    setEditContent(note.content);
  };
  
  const handleSaveEdit = () => {
    if (editingNoteId) {
      onEditGlobalNote(editingNoteId, editContent);
      setEditingNoteId(null);
      setEditContent('');
    }
  };
  
  const handleCancelEdit = () => {
    setEditingNoteId(null);
    setEditContent('');
  };
  
  if (globalNotes.length === 0) {
    return (
      <div style={styles.globalNotesEmpty}>
        <div style={styles.globalNotesEmptyIcon}>
          <GlobeIcon size={24} color={ORANGE} />
        </div>
        <div style={styles.globalNotesEmptyTitle}>No Global Notes</div>
        <div style={styles.globalNotesEmptyDesc}>
          Global notes apply across all scenes. Use them for overarching themes, tone guidelines, or world-building details.
        </div>
        <button
          style={styles.addGlobalNoteBtn}
          onClick={onAddGlobalNote}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(249, 115, 22, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <PlusIcon />
          Add Global Note
        </button>
      </div>
    );
  }
  
  return (
    <>
      <div style={styles.globalNotesListHeader}>
        <span style={styles.globalNotesCount}>
          {globalNotes.length} global {globalNotes.length === 1 ? 'note' : 'notes'}
        </span>
        <button
          style={styles.addNoteSmallBtn}
          onClick={onAddGlobalNote}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(249, 115, 22, 0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(249, 115, 22, 0.15)';
          }}
        >
          <PlusIcon size={12} />
          Add
        </button>
      </div>
      
      {globalNotes.map((note, index) => (
        <div key={note.cardId} style={styles.globalNoteCard}>
          <div style={styles.globalNoteHeader}>
            <div style={styles.globalNoteBadge}>
              <GlobeIcon size={14} color={ORANGE} />
              Global Note {index + 1}
            </div>
            <div style={styles.globalNoteActions}>
              {editingNoteId !== note.cardId && (
                <>
                  <button
                    style={styles.globalNoteActionBtn}
                    onClick={() => handleStartEdit(note)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.color = '#e0e0e0';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <GlassesIcon size={14} />
                  </button>
                  <button
                    style={styles.globalNoteActionBtn}
                    onClick={() => onDeleteGlobalNote(note.cardId)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                      e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#666';
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
          
          {editingNoteId === note.cardId ? (
            <div>
              <textarea
                style={styles.globalNoteTextarea}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.metaKey) {
                    handleSaveEdit();
                  } else if (e.key === 'Escape') {
                    handleCancelEdit();
                  }
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  style={{
                    ...styles.revisionActionBtn,
                    background: ORANGE,
                    color: 'white',
                  }}
                  onClick={handleSaveEdit}
                >
                  Save
                </button>
                <button
                  style={{
                    ...styles.revisionActionBtn,
                    ...styles.revisionRetryBtn,
                  }}
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.globalNoteContent}>
              {note.content || <span style={{ color: '#666', fontStyle: 'italic' }}>Empty note</span>}
            </div>
          )}
        </div>
      ))}
    </>
  );
};

// =============================================================================
// Main Component
// =============================================================================

const SceneDetailPanel: React.FC<SceneDetailPanelProps> = ({
  mode,
  panelState,
  selectedScenes,
  suggestions,
  revisions,
  guidance,
  onGuidanceChange,
  onRemoveScene,
  onGenerate,
  onClose,
  isFocusMode = false,
  onToggleFocusMode,
  hasActiveTextSelection = false,
  transitionContext = null,
  onApplyTransitionSuggestion,
  onToggleSuggestion,
  onApplySuggestions,
  onRegenerateSuggestions,
  onDismissAllSuggestions,
  reviewingScenesCount = 0,
  acceptCheckedCount = 0,
  onAcceptChanges,
  onTryAgain,
  onDismissChanges,
  onAcceptRevision,
  onDismissRevision,
  onRetryRevision,
  globalNotes = [],
  onAddGlobalNote,
  onEditGlobalNote,
  onDeleteGlobalNote,
}) => {
  const isPurple = mode === 'suggestions';
  const isGlobalNotes = mode === 'global-notes';
  const isReviewing = panelState === 'reviewing';
  const isTransitionMode = transitionContext !== null;
  const accentColor = isPurple ? PURPLE : CYAN;
  
  const [closeHovered, setCloseHovered] = useState(false);
  
  const getHeaderStyle = () => {
    if (isGlobalNotes) return styles.headerGlobalNotes;
    if (isPurple) return styles.headerSuggestions;
    return styles.headerRevisions;
  };
  
  const renderHeader = () => (
    <div style={{ 
      ...styles.header, 
      ...getHeaderStyle(),
    }}>
      <div style={styles.headerLeft}>
        <div style={styles.headerTitle}>
          {isGlobalNotes ? (
            <>
              <GlobeIcon size={18} color="#fff" />
              Global Notes
            </>
          ) : isTransitionMode ? (
            <>
              <LightningIcon size={18} color="#fff" />
              Suggest New Scene
            </>
          ) : isPurple ? (
            <>
              <LightningIcon size={18} color="#fff" />
              Request Suggestions
            </>
          ) : (
            <>
              <GlassesIcon size={18} color="#fff" />
              Request Revisions
            </>
          )}
        </div>
        <div style={styles.headerSubtitle}>
          {isGlobalNotes 
            ? 'Notes that apply across all scenes'
            : isTransitionMode
              ? panelState === 'selecting'
                ? 'What should happen between scenes?'
                : panelState === 'generating'
                  ? 'Generating...'
                  : panelState === 'reviewing'
                    ? 'Review and confirm new scene'
                    : `${suggestions.length} ideas`
              : panelState === 'selecting' 
                ? hasActiveTextSelection
                  ? 'Revising selected text'
                  : 'Select scenes on the canvas'
                : panelState === 'generating' 
                  ? 'Generating...'
                  : panelState === 'reviewing'
                    ? 'Review and confirm changes'
                    : `${isPurple ? suggestions.length : revisions.length} results`
          }
        </div>
      </div>
      <button
        style={{
          ...styles.closeButton,
          ...(closeHovered ? { background: 'rgba(255, 255, 255, 0.25)' } : {}),
        }}
        onClick={onClose}
        onMouseEnter={() => setCloseHovered(true)}
        onMouseLeave={() => setCloseHovered(false)}
        aria-label="Close panel"
      >
        <CloseIcon />
      </button>
    </div>
  );
  
  const renderContent = () => {
    // Global notes mode - always show notes list
    if (isGlobalNotes) {
      return (
        <GlobalNotesContent
          globalNotes={globalNotes}
          onAddGlobalNote={onAddGlobalNote || (() => {})}
          onEditGlobalNote={onEditGlobalNote || (() => {})}
          onDeleteGlobalNote={onDeleteGlobalNote || (() => {})}
        />
      );
    }
    
    switch (panelState) {
      case 'selecting':
        return (
          <SelectionModeContent
            mode={mode}
            selectedScenes={selectedScenes}
            guidance={guidance}
            onGuidanceChange={onGuidanceChange}
            onRemoveScene={onRemoveScene}
            onGenerate={onGenerate}
            isFocusMode={isFocusMode}
            onToggleFocusMode={onToggleFocusMode}
            hasActiveTextSelection={hasActiveTextSelection}
            transitionContext={transitionContext}
          />
        );
      
      case 'generating':
        return <LoadingContent mode={mode} />;
      
      case 'results':
        if (mode === 'suggestions') {
          return (
            <SuggestionsResults
              suggestions={suggestions}
              onToggleSuggestion={onToggleSuggestion}
              onApplySuggestions={onApplySuggestions}
              onRegenerateSuggestions={onRegenerateSuggestions}
              onDismissAllSuggestions={onDismissAllSuggestions}
              isTransitionMode={isTransitionMode}
              onApplyTransitionSuggestion={onApplyTransitionSuggestion}
            />
          );
        } else {
          return (
            <RevisionsResults
              revisions={revisions}
              onAcceptRevision={onAcceptRevision}
              onDismissRevision={onDismissRevision}
              onRetryRevision={onRetryRevision}
            />
          );
        }
      
        case 'reviewing':
            // If this is a transition suggestion review, show minimal content
            if (isTransitionMode) {
              return (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 24px',
                  textAlign: 'center' as const,
                }}>
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <div style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#fff',
                    marginBottom: 8,
                  }}>
                    Review New Scene
                  </div>
                  <div style={{
                    fontSize: 14,
                    color: '#666',
                    lineHeight: 1.5,
                  }}>
                    Use the buttons above the scene card to accept, retry, or dismiss the new scene.
                  </div>
                </div>
              );
            }
            
            // If this is a text selection revision review, show minimal content
            if (hasActiveTextSelection) {
              return (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '40px 24px',
                  textAlign: 'center' as const,
                }}>
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <div style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#fff',
                    marginBottom: 8,
                  }}>
                    Review Changes
                  </div>
                  <div style={{
                    fontSize: 14,
                    color: '#666',
                    lineHeight: 1.5,
                  }}>
                    Use the buttons above the scene card to accept, retry, or dismiss the revision.
                  </div>
                </div>
              );
            }
            
            // Acts view - overlay shows the content, panel shows the action buttons
            return (
              <div style={{ padding: '0' }}>
                {/* Action Buttons */}
                <div style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 20,
                }}>
                    <button
                    onClick={onAcceptChanges || (() => {})}
                    style={{
                        flex: 1,
                        padding: '12px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                    }}
                    >
                    ✓ Accept ({revisions.filter((r: any) => r.status === 'pending').length})
                    </button>
                  <button
                    onClick={onTryAgain || (() => {})}
                    style={{
                      flex: 1,
                      padding: '12px 12px',
                      borderRadius: 8,
                      border: '1px solid #8b5cf6',
                      background: 'transparent',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#8b5cf6',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    ↻ Try Again
                  </button>
                  <button
                    onClick={onDismissChanges || (() => {})}
                    style={{
                      flex: 1,
                      padding: '12px 12px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'rgba(239, 68, 68, 0.15)',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#ef4444',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    ✕ Dismiss
                  </button>
                </div>
          
                {/* Minimal info */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '24px',
                  textAlign: 'center' as const,
                }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'rgba(16, 185, 129, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                    Review Changes
                  </div>
                  <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5 }}>
                    Review the proposed changes on the left.
                  </div>
                </div>
              </div>
            );
      
      default:
        return null;
    }
  };
  
  const renderFooter = () => {
    if (panelState === 'results' && mode === 'suggestions') {
      return (
        <div style={styles.footerHint}>
          Click cards to select suggestions
        </div>
      );
    }
    return null;
  };
  
  return (
    <div style={styles.panel}>
      {renderHeader()}
      <div style={styles.content}>
        {renderContent()}
      </div>
      {renderFooter()}
      
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes slideInFromRight {
            from { 
              opacity: 0;
              transform: translateX(20px);
            }
            to { 
              opacity: 1;
              transform: translateX(0);
            }
          }
        `}
      </style>
    </div>
  );
};

export default SceneDetailPanel;