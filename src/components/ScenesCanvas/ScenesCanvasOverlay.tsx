/**
 * ScenesCanvasOverlay
 * 
 * Full-screen overlay for the scenes canvas mode.
 * Renders as a portal at document root level.
 * Orchestrates the main layout: header, sidebar, workspace, detail panel.
 * 
 * Phase 3 Updates:
 * - AI Panel state management (suggestions/revisions modes)
 * - Scene selection mode for multi-select before AI generation
 * - Integration with new SceneDetailPanel flow
 * 
 * Phase 4 Updates:
 * - Text selection action handler from SceneCard
 * - Auto-opens AI panel with selected scene when text selection action triggered
 * - Passes selection context for focused AI operations
 * 
 * Phase 5 Updates:
 * - Real API integration via useSceneCanvasAI hook
 * - Token balance updates after AI operations
 * - Session management and error handling
 */
import { useCommandPalette } from '../../commands/useCommandPalette';
import { CommandPalette } from '../../commands/CommandPalette';
import type { Command } from '../../commands/command';
import { ScenesMinimap } from '../Scenes/ScenesMinimap';
import { CommandLauncher } from '../../commands/CommandLauncher';
import { CommandBar } from '../../commands/CommandBar';

import React, { useState, useEffect, useCallback, useRef, useMemo, useContext } from 'react';
import { createPortal } from 'react-dom';
import { Component1Icon } from '@radix-ui/react-icons';
import {
  ScenesCanvasOverlayProps,
  SegmentWithScenes,
  Scene,
  NoteCard,
  NoteCardScope,
  CanvasTransform,
  Position,
  CANVAS_CONSTANTS,
  SEGMENT_COLORS,
  TextSelectionAction,
  TextSelectionInfo,
} from './types';
import ScenesCanvasSidebar from './ScenesCanvasSidebar';
import ScenesCanvasWorkspace from './ScenesCanvasWorkspace';
import SceneDetailPanel, {
  PanelMode,
  PanelState,
  SelectedSceneInfo,
  Suggestion,
  Revision,
  GlobalNote,
} from './SceneDetailPanel';
import ScenesCanvasToolbar from './ScenesCanvasToolbar';
import { useNoteCards } from './useNoteCards';
import { useAIModel, useSelectedModelId } from '../AIModelContext';
import { ModelSelector } from '../ModelSelector';
import { useSceneCanvasAI, TransitionSuggestion, SceneSuggestion } from './useSceneCanvasAI';
import { buildSceneCanvasStoryData, getSceneInfo, getSegmentForScene, getSceneDisplayId } from './buildSceneCanvasStoryData';
import { animate, AnimatePresence, motion } from 'framer-motion';
import { useCommandUI } from '../../commands/useCommandUI';
import { UserContext } from '../../App';

// =============================================================================
// Types
// =============================================================================

type SidebarViewMode = 'segments' | 'scenes';

// Text selection context for AI operations (Phase 4)
interface TextSelectionContext {
  sceneId: string;
  segmentId: string;
  action: TextSelectionAction;
  selection: TextSelectionInfo;
}

// Story metadata for AI context
interface StoryMetadata {
  genre?: string;
  theme?: string;
  coreQuestion?: string;
  mood?: string;
  summary?: string;
  characters?: Record<string, any>;
}

// Extended props interface with AI requirements
interface ExtendedScenesCanvasOverlayProps extends ScenesCanvasOverlayProps {
  userId: string;
  token?: any;
  onTokenUpdate?: (newBalance: number) => void;
  storyMetadata?: StoryMetadata;
}

// =============================================================================
// Constants
// =============================================================================

const SIDEBAR_WIDTH = 225;
const DETAIL_PANEL_WIDTH = 380;

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: '#1a1a1e',
    display: 'flex',
    flexDirection: 'column',
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

  mainLayout: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },

  workspaceContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },

  segmentBadgeShine: {

  }
};

// =============================================================================
// Animation State
// =============================================================================

type AnimationState = 'entering' | 'active' | 'exiting' | 'exited';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format revised content with highlight markers for new/changed portions
 * Uses a simple diff approach to identify added content
 */
function formatRevisedContent(original: string, revised: string): string {
  // If content is very different, just wrap the whole thing as highlighted
  if (!original || original.length === 0) {
    return `[[highlight]]${revised}[[/highlight]]`;
  }

  // Simple approach: find common prefix and suffix, highlight the middle
  const originalWords = original.split(/\s+/);
  const revisedWords = revised.split(/\s+/);

  // Find common prefix length (in words)
  let prefixLen = 0;
  while (prefixLen < originalWords.length &&
    prefixLen < revisedWords.length &&
    originalWords[prefixLen] === revisedWords[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix length (in words)
  let suffixLen = 0;
  while (suffixLen < originalWords.length - prefixLen &&
    suffixLen < revisedWords.length - prefixLen &&
    originalWords[originalWords.length - 1 - suffixLen] === revisedWords[revisedWords.length - 1 - suffixLen]) {
    suffixLen++;
  }

  // If very similar (>80% same), find and highlight the different middle part
  if (prefixLen + suffixLen > revisedWords.length * 0.5) {
    const prefix = revisedWords.slice(0, prefixLen).join(' ');
    const middle = revisedWords.slice(prefixLen, revisedWords.length - suffixLen || undefined).join(' ');
    const suffix = suffixLen > 0 ? revisedWords.slice(-suffixLen).join(' ') : '';

    if (middle) {
      return `${prefix ? prefix + ' ' : ''}[[highlight]]${middle}[[/highlight]]${suffix ? ' ' + suffix : ''}`;
    }
  }

  // If significantly different, highlight the entire revised content
  return `[[highlight]]${revised}[[/highlight]]`;
}

// =============================================================================
// Component
// =============================================================================

const ScenesCanvasOverlay: React.FC<ExtendedScenesCanvasOverlayProps> = ({
  storyId,
  storyTitle,
  segments: initialSegments,
  onClose,
  onScenesUpdate,
  userCap,
  // New AI-related props
  userId,
  token,
  onTokenUpdate,
  storyMetadata,
  deleteScene,
}) => {
  // ===========================================================================
  // AI Model Hooks
  // ===========================================================================

  const { setModelOverride } = useAIModel();
  const selectedModelId = useSelectedModelId();

  const handleModelChange = useCallback((modelId: string) => {
    setModelOverride(modelId === 'default' ? null : modelId);
  }, [setModelOverride]);

  // ===========================================================================
  // AI Operations Hook
  // ===========================================================================

  const {
    isLoading: isAILoading,
    error: aiError,
    sessionId: aiSessionId,
    requestTransitionSuggestions,
    generateTransitionScene,
    retryTransitionScene,
    regenerateTransitionSuggestions,
    requestSceneSuggestions,
    generateSingleScene,
    regenerateSceneSuggestions,
    applySceneSuggestion,
    retrySceneRevision,
    requestDirectSceneRevision,
    retryDirectSceneRevision,
    requestTextRevision,
    retryTextRevision,
    clearSession,
    clearError,
  } = useSceneCanvasAI({
    userId,
    storyId,
    token,
    onTokenUpdate,
    modelOverride: selectedModelId === 'default' ? null : selectedModelId,
  });

  // ===========================================================================
  // Refs
  // ===========================================================================

  const workspaceContainerRef = useRef<HTMLDivElement>(null);

  // ===========================================================================
  // Animation State
  // ===========================================================================

  const [animationState, setAnimationState] = useState<AnimationState>('entering');

  // ===========================================================================
  // Core Data State
  // ===========================================================================

  const [segments, setSegments] = useState<SegmentWithScenes[]>(initialSegments);

  // Note cards managed by hook
  const {
    noteCards,
    isLoading: notesLoading,
    addNoteCard,
    updateNoteCard,
    removeNoteCard,
    moveNoteCard,
    getNotesForDetailPanel,
    getCanvasNotes,
  } = useNoteCards({
    storyId,
    userId,      // Pass userId from props
    token,       // Pass token from props  
    initialNotes: [],
  });

  // ===========================================================================
  // Selection State (for normal canvas interaction)
  // ===========================================================================

  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedNoteCardId, setSelectedNoteCardId] = useState<string | null>(null);

  // ===========================================================================
  // UI State
  // ===========================================================================

  const { user } = useContext(UserContext);
  const [sidebarViewMode, setSidebarViewMode] = useState<SidebarViewMode>('segments');
  const [showMinimap, setShowMinimap] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const prevCapRef = React.useRef<number | undefined>(undefined);
  const [showTokenPopup, setShowTokenPopup] = useState(false);
  const [displayedCap, setDisplayedCap] = useState(user?.cap ?? 0);
  const [tokenDiff, setTokenDiff] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tokenHistory, setTokenHistory] = useState<
    { diff: number; time: string }[]
  >([]);

  // ===========================================================================
  // AI Panel State (Phase 3)
  // ===========================================================================

  const [showAIPanel, setShowAIPanel] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('suggestions');
  const [panelState, setPanelState] = useState<PanelState>('selecting');
  const [aiSelectedSceneIds, setAiSelectedSceneIds] = useState<string[]>([]);
  const [guidance, setGuidance] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Text selection context (Phase 4)
  const [textSelectionContext, setTextSelectionContext] = useState<TextSelectionContext | null>(null);

  // Active text selection for persistent highlight (Phase 4)
  const [activeTextSelectionSceneId, setActiveTextSelectionSceneId] = useState<string | null>(null);
  const [activeTextSelectionBounds, setActiveTextSelectionBounds] = useState<{ start: number; end: number } | null>(null);
  const [activeTextSelectionColor, setActiveTextSelectionColor] = useState<'purple' | 'cyan'>('cyan');

  // Pending text revision (Phase 4) - after generating revision for selected text
  const [pendingTextRevision, setPendingTextRevision] = useState<{
    sceneId: string;
    originalBounds: { start: number; end: number };
    originalText: string;
    revisedText: string;
  } | null>(null);

  // Connection popover state (Phase 4 - Transition Suggestions)
  const [connectionPopover, setConnectionPopover] = useState<{
    fromSceneId: string;
    toSceneId: string;
    position: Position;
    isCrossSegment: boolean;
    fromSegmentId: string;
    toSegmentId: string;
    showSegmentChoice?: boolean;
  } | null>(null);

  // Transition suggestion state (Phase 4)
  const [transitionContext, setTransitionContext] = useState<{
    fromSceneId: string;
    toSceneId: string;
    fromScene: { title: string; content: string; displayId: string };
    toScene: { title: string; content: string; displayId: string };
  } | null>(null);

  // Pending new scene from transition suggestion
  const [pendingNewScene, setPendingNewScene] = useState<{
    title: string;
    content: string;
    insertAfterSceneId: string;
    segmentId: string;
  } | null>(null);

  // Reviewing state (after applying suggestions)
  const [reviewingScenes, setReviewingScenes] = useState<Map<string, { original: string; revised: string }>>(new Map());
  const [acceptCheckedSceneIds, setAcceptCheckedSceneIds] = useState<string[]>([]);

  // ===========================================================================
  // Linking Mode State (for note cards)
  // ===========================================================================

  const [linkingNoteId, setLinkingNoteId] = useState<string | null>(null);
  const [linkingSceneIds, setLinkingSceneIds] = useState<string[]>([]);

  // ===========================================================================
  // Canvas Transform State
  // ===========================================================================

  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    panX: 0,
    panY: 0,
  });

  const [prePanelTransform, setPrePanelTransform] = useState<CanvasTransform | null>(null);

  // ===========================================================================
  // Derived State
  // ===========================================================================

  const isInSelectionMode = showAIPanel && panelState === 'selecting' && panelMode !== 'global-notes' && !activeTextSelectionSceneId && !transitionContext;
  const selectionModeColor = panelMode === 'suggestions' ? '#8b5cf6' : '#06b6d4';

  const selectedScenesInfo: SelectedSceneInfo[] = React.useMemo(() => {
    return aiSelectedSceneIds.map(sceneId => {
      for (const segment of segments) {
        const sceneIndex = segment.scenes.findIndex(s => s.sceneId === sceneId);
        if (sceneIndex !== -1) {
          const scene = segment.scenes[sceneIndex];
          return {
            sceneId: scene.sceneId,
            segmentId: segment.id,
            displayId: `${segment.id}.${sceneIndex + 1}`,
            title: scene.title,
          };
        }
      }
      return {
        sceneId,
        segmentId: 'S1',
        displayId: 'S1.1',
        title: 'Unknown Scene',
      };
    });
  }, [aiSelectedSceneIds, segments]);

  // ===========================================================================
  // Sync segments with parent
  // ===========================================================================

  useEffect(() => {
    setSegments(initialSegments);
  }, [initialSegments]);

  // ===========================================================================
  // Animation Handling
  // ===========================================================================

  useEffect(() => {
    const enterTimer = setTimeout(() => {
      setAnimationState('active');
    }, 50);
    return () => clearTimeout(enterTimer);
  }, []);

  const handleExit = useCallback(() => {
    onScenesUpdate(segments);
    setAnimationState('exiting');
    setTimeout(() => {
      setAnimationState('exited');
      onClose();
    }, 400);
  }, [segments, onScenesUpdate, onClose]);
  // ===========================================================================
  // Keyboard Handling
  // ===========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (linkingNoteId) {
          setLinkingNoteId(null);
          setLinkingSceneIds([]);
        } else if (showAIPanel) {
          handleCloseAIPanel();
        } else {
          handleExit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExit, showAIPanel, linkingNoteId]);

  // ===========================================================================
  // AI Panel Handlers
  // ===========================================================================

  const handleRequestSuggestions = useCallback(() => {
    if (showAIPanel && panelMode === 'suggestions') {
      handleCloseAIPanel();
      return;
    }
    if (!showAIPanel) {
      setPrePanelTransform(transform);
      setTransform(prev => {
        const newScale = Math.max(CANVAS_CONSTANTS.MIN_ZOOM, Math.min(prev.scale * 0.85, 0.9));
        const panXAdjustment = -DETAIL_PANEL_WIDTH / 4;
        return { ...prev, scale: newScale, panX: prev.panX + panXAdjustment };
      });
    }
    setShowAIPanel(true);
    setPanelMode('suggestions');
    setPanelState('selecting');
    setAiSelectedSceneIds([]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setSelectedSceneId(null);
    setTextSelectionContext(null);
  }, [showAIPanel, panelMode, transform]);

  const handleRequestRevisions = useCallback(() => {
    if (showAIPanel && panelMode === 'revisions') {
      handleCloseAIPanel();
      return;
    }
    if (!showAIPanel) {
      setPrePanelTransform(transform);
      setTransform(prev => {
        const newScale = Math.max(CANVAS_CONSTANTS.MIN_ZOOM, Math.min(prev.scale * 0.85, 0.9));
        const panXAdjustment = -DETAIL_PANEL_WIDTH / 4;
        return { ...prev, scale: newScale, panX: prev.panX + panXAdjustment };
      });
    }
    setShowAIPanel(true);
    setPanelMode('revisions');
    setPanelState('selecting');
    setAiSelectedSceneIds([]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setSelectedSceneId(null);
    setTextSelectionContext(null);
  }, [showAIPanel, panelMode, transform]);

  const handleToggleGlobalNotes = useCallback(() => {
    if (showAIPanel && panelMode === 'global-notes') {
      handleCloseAIPanel();
      return;
    }
    if (!showAIPanel) {
      setPrePanelTransform(transform);
      setTransform(prev => {
        const newScale = Math.max(CANVAS_CONSTANTS.MIN_ZOOM, Math.min(prev.scale * 0.85, 0.9));
        const panXAdjustment = -DETAIL_PANEL_WIDTH / 4;
        return { ...prev, scale: newScale, panX: prev.panX + panXAdjustment };
      });
    }
    setShowAIPanel(true);
    setPanelMode('global-notes');
    setPanelState('selecting');
    setAiSelectedSceneIds([]);
    setSelectedSceneId(null);
    setTextSelectionContext(null);
  }, [showAIPanel, panelMode, transform]);

  const handleCloseAIPanel = useCallback(() => {
    if (prePanelTransform) {
      setTransform(prePanelTransform);
      setPrePanelTransform(null);
    } else {
      setTransform(prev => ({ ...prev, panX: prev.panX + DETAIL_PANEL_WIDTH / 2 }));
    }
    setShowAIPanel(false);
    setPanelState('selecting');
    setAiSelectedSceneIds([]);
    setGuidance('');
    setIsFocusMode(false);
    setTextSelectionContext(null);
    setActiveTextSelectionSceneId(null);
    setActiveTextSelectionBounds(null);
    setTransitionContext(null);
    setPendingNewScene(null);
    clearSession();
  }, [prePanelTransform, clearSession]);

  const handleToggleFocusMode = useCallback(() => {
    if (activeTextSelectionSceneId && isFocusMode) return;
    setIsFocusMode(prev => !prev);
  }, [activeTextSelectionSceneId, isFocusMode]);

  const handleRemoveSceneFromSelection = useCallback((sceneId: string) => {
    setAiSelectedSceneIds(prev => prev.filter(id => id !== sceneId));
  }, []);

  // ===========================================================================
  // AI Generation Handler (with real API)
  // ===========================================================================

  const handleGenerate = useCallback(async () => {
    const isTransitionMode = transitionContext !== null;
    if (!isTransitionMode && aiSelectedSceneIds.length === 0) return;
    if (isTransitionMode) {
      setPanelState('generating');

      const segmentId = getSegmentForScene(transitionContext.fromSceneId, segments) || 'S1';
      const storyData = buildSceneCanvasStoryData(segments, storyMetadata || {});

      const result = await requestTransitionSuggestions({
        segmentId,
        storyData,
        fromSceneId: transitionContext.fromSceneId,
        toSceneId: transitionContext.toSceneId,
        fromScene: transitionContext.fromScene,
        toScene: transitionContext.toScene,
        guidance: guidance || undefined,
      });

      if (result) {
        const uiSuggestions: Suggestion[] = result.map((sug, index) => ({
          id: `trans-sug-${Date.now()}-${index}`,
          sceneId: 'transition',
          displayId: 'NEW',
          content: sug.direction,
          isSelected: false,
          reasoning: sug.rationale,
        }));

        setSuggestions(uiSuggestions);
        setPanelState('results');
      } else {
        setPanelState('selecting');
      }
      return;
    }

    setIsFocusMode(true);
    setPanelState('generating');

    const storyData = buildSceneCanvasStoryData(segments, storyMetadata || {});
    const targetScenes = aiSelectedSceneIds.map(sceneId => {
      const info = getSceneInfo(sceneId, segments);
      return info ? { sceneId, title: info.scene.title, content: info.scene.content } : null;
    }).filter(Boolean) as Array<{ sceneId: string; title: string; content: string }>;

    const segmentId = getSegmentForScene(aiSelectedSceneIds[0], segments) || 'S1';

    if (panelMode === 'suggestions') {
      const result = await requestSceneSuggestions({
        segmentId,
        storyData,
        targetSceneIds: aiSelectedSceneIds,
        targetScenes,
        guidance: guidance || undefined,
      });

      if (result) {
        const uiSuggestions: Suggestion[] = result.map((sug, index) => ({
          id: sug.id,
          sceneId: aiSelectedSceneIds[index % aiSelectedSceneIds.length],
          displayId: getSceneDisplayId(aiSelectedSceneIds[index % aiSelectedSceneIds.length], segments) || 'Scene',
          content: sug.content,
          isSelected: false,
          reasoning: sug.reasoning,
        }));
        setSuggestions(uiSuggestions);
        setPanelState('results');
      } else {
        setPanelState('selecting');
      }
    } else {
      // Revisions mode - directly revise scenes based on guidance
      // Uses scene-revise-direct endpoint (no prior suggestions needed)

      if (!guidance || guidance.trim() === '') {
        // Require guidance for direct revisions
        setPanelState('selecting');
        return;
      }

      const newReviewingScenes = new Map<string, { original: string; revised: string }>();

      for (let i = 0; i < aiSelectedSceneIds.length; i++) {
        const sceneId = aiSelectedSceneIds[i];
        const scene = segments.flatMap(seg => seg.scenes).find(s => s.sceneId === sceneId);
        if (!scene) continue;

        // Add small delay between calls to avoid overwhelming the API
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        try {
          const revisedScene = await requestDirectSceneRevision({
            segmentId,
            storyData,
            sceneId,
            targetScene: {
              sceneId: scene.sceneId,
              title: scene.title,
              content: scene.content,
            },
            direction: guidance,
          });

          if (revisedScene) {
            const revisedContent = formatRevisedContent(scene.content, revisedScene.content);
            newReviewingScenes.set(sceneId, {
              original: scene.content,
              revised: revisedContent,
            });
          }
        } catch (err) {
          console.error(`Error revising scene ${sceneId}:`, err);
        }
      }

      if (newReviewingScenes.size > 0) {
        setReviewingScenes(newReviewingScenes);
        setAcceptCheckedSceneIds([...newReviewingScenes.keys()]);
        setPanelState('reviewing');
      } else {
        // All revisions failed - stay on selecting so user can try again
        console.error('All direct scene revisions failed - staying on selecting state');
        setPanelState('selecting');
      }
    }
  }, [
    aiSelectedSceneIds,
    panelMode,
    segments,
    storyMetadata,
    guidance,
    transitionContext,
    requestTransitionSuggestions,
    requestSceneSuggestions,
    requestDirectSceneRevision
  ]);
  // ===========================================================================
  // Text Selection Action Handler (Phase 4)
  // ===========================================================================

  const handleTextSelectionAction = useCallback((
    sceneId: string,
    segmentId: string,
    action: TextSelectionAction,
    selection: TextSelectionInfo
  ) => {
    console.log('Text selection action:', { sceneId, segmentId, action, selection });
    setTextSelectionContext({ sceneId, segmentId, action, selection });
    setActiveTextSelectionSceneId(sceneId);
    setActiveTextSelectionBounds(selection.selectionBounds);
    setActiveTextSelectionColor(action === 'suggest' ? 'purple' : 'cyan');

    const targetMode: PanelMode = action === 'suggest' ? 'suggestions' : 'revisions';

    if (!showAIPanel) {
      setPrePanelTransform(transform);
      setTransform(prev => {
        const newScale = Math.max(CANVAS_CONSTANTS.MIN_ZOOM, Math.min(prev.scale * 0.85, 0.9));
        const panXAdjustment = -DETAIL_PANEL_WIDTH / 4;
        return { ...prev, scale: newScale, panX: prev.panX + panXAdjustment };
      });
    }

    setShowAIPanel(true);
    setPanelMode(targetMode);
    setPanelState('selecting');
    setAiSelectedSceneIds([sceneId]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setSelectedSceneId(null);
    setIsFocusMode(true);
  }, [showAIPanel, transform]);

  // ===========================================================================
  // Text Revision Handlers (Phase 4)
  // ===========================================================================

  const handleAcceptTextRevision = useCallback(() => {
    if (!pendingTextRevision || !textSelectionContext) return;
    const { sceneId, originalBounds, revisedText } = pendingTextRevision;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => ({
        ...segment,
        scenes: segment.scenes.map(scene => {
          if (scene.sceneId === sceneId) {
            const originalContent = scene.content;
            const newContent = originalContent.substring(0, originalBounds.start) + revisedText + originalContent.substring(originalBounds.end);
            return { ...scene, content: newContent };
          }
          return scene;
        }),
      }));
      onScenesUpdate(newSegments);
      return newSegments;
    });

    setPendingTextRevision(null);
    setTextSelectionContext(null);
    setActiveTextSelectionSceneId(null);
    setActiveTextSelectionBounds(null);
    handleCloseAIPanel();
  }, [pendingTextRevision, textSelectionContext, onScenesUpdate, handleCloseAIPanel]);

  const handleTryAgainTextRevision = useCallback(() => {
    setPendingTextRevision(null);
    setPanelState('selecting');
  }, []);

  const handleDismissTextRevision = useCallback(() => {
    setPendingTextRevision(null);
    setTextSelectionContext(null);
    setActiveTextSelectionSceneId(null);
    setActiveTextSelectionBounds(null);
    handleCloseAIPanel();
  }, [handleCloseAIPanel]);
  // ===========================================================================
  // Suggestion Handlers
  // ===========================================================================

  const handleToggleSuggestion = useCallback((suggestionId: string) => {
    setSuggestions(prev => prev.map(s =>
      s.id === suggestionId ? { ...s, isSelected: !s.isSelected } : s
    ));
  }, []);

  const handleApplySuggestions = useCallback(async () => {
    const selectedSuggestions = suggestions.filter(s => s.isSelected);
    if (selectedSuggestions.length === 0) return;

    // Enter generating state
    setPanelState('generating');
    setIsFocusMode(true);

    const newReviewingScenes = new Map<string, { original: string; revised: string }>();

    // Group suggestions by scene
    const suggestionsByScene = new Map<string, string[]>();
    selectedSuggestions.forEach(sug => {
      const existing = suggestionsByScene.get(sug.sceneId) || [];
      existing.push(sug.content);
      suggestionsByScene.set(sug.sceneId, existing);
    });

    // Process scenes one at a time with small delays to allow state updates
    for (let i = 0; i < aiSelectedSceneIds.length; i++) {
      const sceneId = aiSelectedSceneIds[i];
      const scene = segments.flatMap(seg => seg.scenes).find(s => s.sceneId === sceneId);
      if (!scene) continue;

      // Get suggestions for this scene, or use all selected suggestions as general direction
      const directionsForScene = suggestionsByScene.get(sceneId) ||
        selectedSuggestions.map(s => s.content);

      // Combine all directions into one
      const combinedDirection = directionsForScene.join('\n\n');

      try {
        // Small delay between calls to ensure React state has updated
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Call the API to revise this scene
        const revisedScene = await applySceneSuggestion({
          sceneId,
          direction: combinedDirection,
        });

        if (revisedScene) {
          // Format the revised content with highlight markers for new content
          const revisedContent = formatRevisedContent(scene.content, revisedScene.content);
          newReviewingScenes.set(sceneId, {
            original: scene.content,
            revised: revisedContent
          });
        } else {
          // If API returned null (possibly due to loading state), 
          // show a message but don't fail silently
          console.warn(`Scene revision returned null for ${sceneId} - may be rate limited or session issue`);
        }
      } catch (err) {
        console.error(`Error revising scene ${sceneId}:`, err);
        // Continue with other scenes even if one fails
      }
    }

    if (newReviewingScenes.size > 0) {
      setReviewingScenes(newReviewingScenes);
      setAcceptCheckedSceneIds([...newReviewingScenes.keys()]);
      setPanelState('reviewing');
    } else {
      // All revisions failed - go back to results to show suggestions again
      console.error('All scene revisions failed - returning to suggestions');
      setPanelState('results');
    }
  }, [suggestions, segments, aiSelectedSceneIds, applySceneSuggestion]);

  // ===========================================================================
  // Transition Suggestion Handler (with real API)
  // ===========================================================================

  const handleApplyTransitionSuggestion = useCallback(async () => {
    if (!transitionContext) return;

    const selectedSuggestion = suggestions.find(s => s.isSelected);
    if (!selectedSuggestion) return;

    setPanelState('generating');

    const scene = await generateTransitionScene(selectedSuggestion.content);

    if (scene) {
      const fromSceneSegment = segments.find(seg =>
        seg.scenes.some(s => s.sceneId === transitionContext.fromSceneId)
      );

      if (!fromSceneSegment) return;

      setPendingNewScene({
        title: scene.title,
        content: scene.content,
        insertAfterSceneId: transitionContext.fromSceneId,
        segmentId: fromSceneSegment.id,
      });

      setIsFocusMode(true);
      setPanelState('reviewing');
    } else {
      setPanelState('results');
    }
  }, [transitionContext, suggestions, segments, generateTransitionScene]);

  const handleAcceptNewScene = useCallback(() => {
    if (!pendingNewScene) return;

    const newSceneId = `scene-${Date.now()}`;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => {
        if (segment.id !== pendingNewScene.segmentId) return segment;

        const insertIndex = segment.scenes.findIndex(s => s.sceneId === pendingNewScene.insertAfterSceneId);
        if (insertIndex === -1) return segment;

        const newScene = { sceneId: newSceneId, title: pendingNewScene.title, content: pendingNewScene.content };
        const newScenes = [...segment.scenes];
        newScenes.splice(insertIndex + 1, 0, newScene);

        return { ...segment, scenes: newScenes };
      });

      onScenesUpdate(newSegments);
      return newSegments;
    });

    setPendingNewScene(null);
    setTransitionContext(null);
    handleCloseAIPanel();
  }, [pendingNewScene, onScenesUpdate, handleCloseAIPanel]);

  // ===========================================================================
  // Try Again Handler (with real API)
  // ===========================================================================

  const handleTryAgainNewScene = useCallback(async () => {
    if (!transitionContext) {
      setPendingNewScene(null);
      setIsFocusMode(false);
      setPanelState('results');
      return;
    }

    setPanelState('generating');

    const scene = await retryTransitionScene();

    if (scene) {
      const fromSceneSegment = segments.find(seg =>
        seg.scenes.some(s => s.sceneId === transitionContext.fromSceneId)
      );

      if (fromSceneSegment) {
        setPendingNewScene({
          title: scene.title,
          content: scene.content,
          insertAfterSceneId: transitionContext.fromSceneId,
          segmentId: fromSceneSegment.id,
        });
      }
      setPanelState('reviewing');
    } else {
      setPanelState('results');
    }
  }, [transitionContext, segments, retryTransitionScene]);

  const handleDismissNewScene = useCallback(() => {
    setPendingNewScene(null);
    setTransitionContext(null);
    handleCloseAIPanel();
  }, [handleCloseAIPanel]);

  const handleToggleAcceptScene = useCallback((sceneId: string) => {
    setAcceptCheckedSceneIds(prev =>
      prev.includes(sceneId) ? prev.filter(id => id !== sceneId) : [...prev, sceneId]
    );
  }, []);

  const renderHighlightedContent = (content: string): React.ReactNode => {
    const parts = content.split(/(\[\[highlight\]\].*?\[\[\/highlight\]\])/g);

    return parts.map((part, index) => {
      if (part.startsWith('[[highlight]]') && part.endsWith('[[/highlight]]')) {
        const highlightedText = part.replace('[[highlight]]', '').replace('[[/highlight]]', '');
        return (
          <span key={index} style={{
            color: '#10b981',
            textDecoration: 'underline',
            textDecorationColor: 'rgba(16, 185, 129, 0.5)',
            textUnderlineOffset: '3px',
            background: 'rgba(16, 185, 129, 0.1)',
            padding: '2px 0',
          }}>
            {highlightedText}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const handleAcceptChanges = useCallback(() => {
    if (reviewingScenes.size === 0 || acceptCheckedSceneIds.length === 0) return;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => ({
        ...segment,
        scenes: segment.scenes.map(scene => {
          if (acceptCheckedSceneIds.includes(scene.sceneId)) {
            const reviewData = reviewingScenes.get(scene.sceneId);
            if (reviewData) {
              const cleanContent = reviewData.revised
                .replace(/\[\[highlight\]\]/g, '')
                .replace(/\[\[\/highlight\]\]/g, '');
              return { ...scene, content: cleanContent };
            }
          }
          return scene;
        }),
      }));
      onScenesUpdate(newSegments);
      return newSegments;
    });

    const remainingScenes = new Map(reviewingScenes);
    acceptCheckedSceneIds.forEach(id => remainingScenes.delete(id));

    if (remainingScenes.size === 0) {
      setReviewingScenes(new Map());
      setAcceptCheckedSceneIds([]);
      handleCloseAIPanel();
    } else {
      setReviewingScenes(remainingScenes);
      setAcceptCheckedSceneIds([]);
      setAiSelectedSceneIds([...remainingScenes.keys()]);
    }
  }, [reviewingScenes, acceptCheckedSceneIds, onScenesUpdate, handleCloseAIPanel]);

  const handleTryAgain = useCallback(async () => {
    if (!aiSessionId) {
      // No session - fall back appropriately
      console.warn('No session for retry');
      setReviewingScenes(new Map());
      setAcceptCheckedSceneIds([]);
      if (panelMode === 'suggestions') {
        setPanelState('results');
      } else {
        setPanelState('selecting');
      }
      return;
    }

    setPanelState('generating');

    const newReviewingScenes = new Map<string, { original: string; revised: string }>();

    // Get the scenes we were reviewing
    const scenesToRetry = [...reviewingScenes.keys()];

    for (let i = 0; i < scenesToRetry.length; i++) {
      const sceneId = scenesToRetry[i];
      const originalData = reviewingScenes.get(sceneId);
      if (!originalData) continue;

      // Add small delay between calls
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      try {
        let revisedScene;

        if (panelMode === 'suggestions') {
          // For suggestions mode, use retrySceneRevision (session-based)
          revisedScene = await retrySceneRevision();
        } else {
          // For revisions mode, use retryDirectSceneRevision
          revisedScene = await retryDirectSceneRevision();
        }

        if (revisedScene) {
          const revisedContent = formatRevisedContent(originalData.original, revisedScene.content);
          newReviewingScenes.set(sceneId, {
            original: originalData.original,
            revised: revisedContent,
          });
        }
      } catch (err) {
        console.error(`Error retrying revision for scene ${sceneId}:`, err);
      }
    }

    if (newReviewingScenes.size > 0) {
      setReviewingScenes(newReviewingScenes);
      setAcceptCheckedSceneIds([...newReviewingScenes.keys()]);
      setPanelState('reviewing');
    } else {
      // All retries failed - fall back appropriately
      console.error('All retry revisions failed');
      setReviewingScenes(new Map());
      setAcceptCheckedSceneIds([]);
      if (panelMode === 'suggestions') {
        setPanelState('results');
      } else {
        setPanelState('selecting');
      }
    }
  }, [panelMode, aiSessionId, reviewingScenes, retrySceneRevision, retryDirectSceneRevision]);

  const handleDismissChanges = useCallback(() => {
    setReviewingScenes(new Map());
    setAcceptCheckedSceneIds([]);
    handleCloseAIPanel();
  }, [handleCloseAIPanel]);

  const handleRegenerateSuggestions = useCallback(async () => {
    // Check if we're in transition mode
    if (transitionContext) {
      // Regenerate transition suggestions via API
      setPanelState('generating');

      const result = await regenerateTransitionSuggestions();

      if (result) {
        const uiSuggestions: Suggestion[] = result.map((sug, index) => ({
          id: `trans-sug-${Date.now()}-${index}`,
          sceneId: 'transition',
          displayId: 'NEW',
          content: sug.direction,
          isSelected: false,
          reasoning: sug.rationale,
        }));

        setSuggestions(uiSuggestions);
        setPanelState('results');
      } else {
        // Failed - stay on results with existing suggestions
        setPanelState('results');
      }
    } else {
      // Regular scene suggestions - regenerate via API
      setPanelState('generating');

      const result = await regenerateSceneSuggestions();

      if (result) {
        setSuggestions(result.map((sug, index) => ({
          ...sug,
          sceneId: aiSelectedSceneIds[index % aiSelectedSceneIds.length] || sug.sceneId,
          displayId: getSceneDisplayId(aiSelectedSceneIds[index % aiSelectedSceneIds.length], segments) || sug.displayId,
        })));
        setPanelState('results');
      } else {
        // Failed - go back to selecting
        setPanelState('selecting');
        setSuggestions([]);
      }
    }
  }, [transitionContext, regenerateTransitionSuggestions, regenerateSceneSuggestions, aiSelectedSceneIds, segments]);

  const handleDismissAllSuggestions = useCallback(() => {
    handleCloseAIPanel();
  }, [handleCloseAIPanel]);

  // ===========================================================================
  // Revision Handlers
  // ===========================================================================

  const handleAcceptRevision = useCallback((revisionId: string) => {
    const revision = revisions.find(r => r.id === revisionId);
    if (!revision) return;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => ({
        ...segment,
        scenes: segment.scenes.map(scene =>
          scene.sceneId === revision.sceneId ? { ...scene, content: revision.revisedText } : scene
        ),
      }));
      onScenesUpdate(newSegments);
      return newSegments;
    });

    setRevisions(prev => prev.map(r =>
      r.id === revisionId ? { ...r, status: 'accepted' as const } : r
    ));
  }, [revisions, onScenesUpdate]);

  const handleDismissRevision = useCallback((revisionId: string) => {
    setRevisions(prev => prev.map(r =>
      r.id === revisionId ? { ...r, status: 'dismissed' as const } : r
    ));
  }, []);

  const handleRetryRevision = useCallback((revisionId: string) => {
    console.log('Retrying revision:', revisionId);
  }, []);

  // ===========================================================================
  // Global Notes Handlers
  // ===========================================================================

  const globalNotes: GlobalNote[] = React.useMemo(() => {
    return noteCards.filter(note => note.scope === 'global').map(note => ({
      cardId: note.cardId,
      content: note.content,
      color: note.color || 'orange',
      createdAt: note.createdAt,
    }));
  }, [noteCards]);

  const handleAddGlobalNote = useCallback(() => {
    addNoteCard({ scope: 'global', position: { x: 0, y: 0 }, content: '', color: 'orange' });
  }, [addNoteCard]);

  const handleEditGlobalNote = useCallback((noteId: string, content: string) => {
    updateNoteCard(noteId, { content });
  }, [updateNoteCard]);

  const handleDeleteGlobalNote = useCallback((noteId: string) => {
    removeNoteCard(noteId);
  }, [removeNoteCard]);
  // ===========================================================================
  // Scene Selection
  // ===========================================================================

  const handleSceneSelect = useCallback((sceneId: string, segmentId: string) => {
    if (activeTextSelectionSceneId) return;

    if (isInSelectionMode) {
      setAiSelectedSceneIds(prev =>
        prev.includes(sceneId) ? prev.filter(id => id !== sceneId) : [...prev, sceneId]
      );
      return;
    }

    setSelectedSceneId(sceneId);
    setSelectedSegmentId(segmentId);
    setSelectedNoteCardId(null);
  }, [isInSelectionMode, activeTextSelectionSceneId]);

  const handleSegmentSelect = useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
    setSelectedSceneId(null);
    setSelectedNoteCardId(null);
  }, []);

  // ===========================================================================
  // Scene Operations
  // ===========================================================================

  const handleSceneUpdate = useCallback((sceneId: string, updates: Partial<Scene>) => {
    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => ({
        ...segment,
        scenes: segment.scenes.map(scene =>
          scene.sceneId === sceneId ? { ...scene, ...updates } : scene
        ),
      }));
      onScenesUpdate(newSegments);
      return newSegments;
    });
  }, [onScenesUpdate]);

  const handleWorkspaceSceneUpdate = useCallback((sceneId: string, _segmentId: string, updates: Partial<Scene>) => {
    handleSceneUpdate(sceneId, updates);
  }, [handleSceneUpdate]);

  const handleSceneReorder = useCallback((segmentId: string, fromIndex: number, toIndex: number) => {
    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => {
        if (segment.id !== segmentId) return segment;
        const newScenes = [...segment.scenes];
        const [movedScene] = newScenes.splice(fromIndex, 1);
        newScenes.splice(toIndex, 0, movedScene);
        return { ...segment, scenes: newScenes };
      });
      onScenesUpdate(newSegments);
      return newSegments;
    });
  }, [onScenesUpdate]);

  const handleSceneMoveToSegment = useCallback((sceneId: string, fromSegmentId: string, toSegmentId: string) => {
    setSegments(prevSegments => {
      let movedScene: Scene | null = null;

      const withoutScene = prevSegments.map(segment => {
        if (segment.id !== fromSegmentId) return segment;
        const sceneIndex = segment.scenes.findIndex(s => s.sceneId === sceneId);
        if (sceneIndex === -1) return segment;
        movedScene = segment.scenes[sceneIndex];
        return { ...segment, scenes: segment.scenes.filter(s => s.sceneId !== sceneId) };
      });

      if (!movedScene) return prevSegments;

      const newSegments = withoutScene.map(segment => {
        if (segment.id !== toSegmentId) return segment;
        return { ...segment, scenes: [...segment.scenes, movedScene!] };
      });

      onScenesUpdate(newSegments);
      return newSegments;
    });
  }, [onScenesUpdate]);

  // ===========================================================================
  // Note Card Operations
  // ===========================================================================

  const handleNoteCardMove = useCallback((cardId: string, position: Position) => {
    moveNoteCard(cardId, position);
  }, [moveNoteCard]);

  const handleNoteCardUpdate = useCallback((cardId: string, updates: Partial<NoteCard>) => {
    updateNoteCard(cardId, updates);
  }, [updateNoteCard]);

  const handleNoteCardRemove = useCallback((cardId: string) => {
    removeNoteCard(cardId);
  }, [removeNoteCard]);

  const handleNoteCardSelect = useCallback((cardId: string | null) => {
    setSelectedNoteCardId(cardId);
    if (cardId) setSelectedSceneId(null);
  }, []);

  // ===========================================================================
  // Linking Mode Operations
  // ===========================================================================

  const handleSceneToggleLink = useCallback((sceneId: string) => {
    setLinkingSceneIds(prev =>
      prev.includes(sceneId) ? prev.filter(id => id !== sceneId) : [...prev, sceneId]
    );
  }, []);

  const handleNoteStartLinking = useCallback((cardId: string) => {
    const note = noteCards.find(n => n.cardId === cardId);
    setLinkingNoteId(cardId);
    setLinkingSceneIds(note?.sceneIds || []);
  }, [noteCards]);

  const handleNoteFinishLinking = useCallback((
    cardId: string,
    scope: 'global' | 'segment' | 'scene',
    segmentId?: string,
    sceneIds?: string[]
  ) => {
    updateNoteCard(cardId, { scope, segmentId, sceneIds });
    setLinkingNoteId(null);
    setLinkingSceneIds([]);
  }, [updateNoteCard]);

  const handleNoteCancelLinking = useCallback((cardId: string) => {
    setLinkingNoteId(null);
    setLinkingSceneIds([]);
  }, []);

  // ===========================================================================
  // Canvas Transform Operations
  // ===========================================================================

  const clampPan = useCallback((panX: number, panY: number, scale: number) => {
    const topLimit = -CANVAS_CONSTANTS.START_Y * scale;

    return {
      panX,
      panY: Math.min(panY, topLimit),
    };
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.min(prev.scale + CANVAS_CONSTANTS.ZOOM_STEP, CANVAS_CONSTANTS.MAX_ZOOM),
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(prev.scale - CANVAS_CONSTANTS.ZOOM_STEP, CANVAS_CONSTANTS.MIN_ZOOM),
    }));
  }, []);

  const handleZoomReset = useCallback(() => {
    setTransform({ scale: 1, panX: 0, panY: 0 });
  }, []);

  const handleAddNote = useCallback(() => {
    const container = workspaceContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const centerX = (rect.width / 2 - transform.panX) / transform.scale;
    const centerY = (rect.height / 2 - transform.panY) / transform.scale;
    const noteX = centerX - 140;
    const noteY = centerY - 60;

    let closestSegmentId = segments[0]?.id || 'S1';
    let accumulatedY = CANVAS_CONSTANTS.START_Y;

    for (const segment of segments) {
      const sceneCount = segment.scenes.length || 1;
      const estimatedSegmentHeight = Math.max(300, sceneCount * 200 + 100);
      if (noteY < accumulatedY + estimatedSegmentHeight) {
        closestSegmentId = segment.id;
        break;
      }
      accumulatedY += estimatedSegmentHeight;
      closestSegmentId = segment.id;
    }

    addNoteCard({
      scope: 'scene',
      segmentId: closestSegmentId,
      sceneIds: [],
      position: { x: noteX, y: noteY },
      content: '',
      color: 'purple',
    });

    // Removed: no longer auto-entering linking mode
    // setLinkingNoteId(newNote.cardId);
    // setLinkingSceneIds([]);
  }, [transform, segments, addNoteCard]);

  const handleConnectionClick = useCallback((fromSceneId: string, toSceneId: string, position: Position) => {
    console.log('Connection clicked:', fromSceneId, '->', toSceneId);

    let fromSegmentId = '';
    let toSegmentId = '';

    for (const segment of segments) {
      if (segment.scenes.some(s => s.sceneId === fromSceneId)) fromSegmentId = segment.id;
      if (segment.scenes.some(s => s.sceneId === toSceneId)) toSegmentId = segment.id;
    }

    const isCrossSegment = fromSegmentId !== toSegmentId;

    setConnectionPopover({
      fromSceneId, toSceneId, position, isCrossSegment, fromSegmentId, toSegmentId, showSegmentChoice: false
    });
  }, [segments]);

  const handleCloseConnectionPopover = useCallback(() => {
    setConnectionPopover(null);
  }, []);

  const insertNewSceneIntoSegment = useCallback((targetSegmentId: string, insertPosition: 'start' | 'end') => {
    if (!connectionPopover) return;

    const newSceneId = `scene-${Date.now()}`;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => {
        if (segment.id !== targetSegmentId) return segment;
        const newScene = { sceneId: newSceneId, title: 'New Scene', content: '' };
        const newScenes = [...segment.scenes];
        if (insertPosition === 'start') newScenes.unshift(newScene);
        else newScenes.push(newScene);
        return { ...segment, scenes: newScenes };
      });
      onScenesUpdate(newSegments);
      return newSegments;
    });

    setSelectedSceneId(newSceneId);
    setSelectedSegmentId(targetSegmentId);
    setConnectionPopover(null);
  }, [connectionPopover, onScenesUpdate]);

  const handleAddSceneFromConnection = useCallback(() => {
    if (!connectionPopover) return;

    if (connectionPopover.isCrossSegment && !connectionPopover.showSegmentChoice) {
      setConnectionPopover(prev =>
        prev ? { ...prev, showSegmentChoice: true } : null
      );
      return;
    }

    const { fromSceneId } = connectionPopover;

    let targetSegmentId: string | null = null;
    let insertAfterSceneId: string | null = null;

    // ============================================================
    // 1️⃣ Caso normal (veio de uma cena existente)
    // ============================================================

    const fromSceneData = segments
      .flatMap(s =>
        s.scenes.map((sc, idx) => ({
          ...sc,
          segmentId: s.id,
          sceneIndex: idx,
        }))
      )
      .find(s => s.sceneId === fromSceneId);

    if (fromSceneData) {
      targetSegmentId = fromSceneData.segmentId;
      insertAfterSceneId = fromSceneId;
    }

    // ============================================================
    // 2️⃣ Caso segmento vazio (empty-S2 ou badge-S2)
    // ============================================================

    if (!fromSceneData) {
      if (fromSceneId.startsWith("empty-")) {
        targetSegmentId = fromSceneId.replace("empty-", "");
      } else if (fromSceneId.startsWith("badge-")) {
        targetSegmentId = fromSceneId.replace("badge-", "");
      }
    }

    if (!targetSegmentId) return;

    const newSceneId = `scene-${Date.now()}`;

    setSegments(prevSegments => {
      const newSegments = prevSegments.map(segment => {
        if (segment.id !== targetSegmentId) return segment;

        const newScene = {
          sceneId: newSceneId,
          title: "New Scene",
          content: "",
        };

        if (segment.scenes.length === 0) {
          return {
            ...segment,
            scenes: [newScene],
          };
        }

        // 🔥 Caso normal → insere após a cena clicada
        if (insertAfterSceneId) {
          const insertIndex = segment.scenes.findIndex(
            s => s.sceneId === insertAfterSceneId
          );

          if (insertIndex !== -1) {
            const newScenes = [...segment.scenes];
            newScenes.splice(insertIndex + 1, 0, newScene);

            return {
              ...segment,
              scenes: newScenes,
            };
          }
        }

        return segment;
      });

      onScenesUpdate(newSegments);
      return newSegments;
    });

    setSelectedSceneId(newSceneId);
    setSelectedSegmentId(targetSegmentId);

    setConnectionPopover(null);
  }, [connectionPopover, segments, onScenesUpdate]);

  // ===========================================================================
  // Single Scene Content Generation (from SceneCard ⚡ button)
  // ===========================================================================

  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);

  const handleGenerateSceneContent = useCallback(async (sceneId: string, segmentId: string) => {
    if (isAILoading || generatingSceneId) return;

    setGeneratingSceneId(sceneId);

    try {
      const storyData = buildSceneCanvasStoryData(segments, storyMetadata || {});

      // Find the scene's index within its segment
      const segment = segments.find(s => s.id === segmentId);
      const sceneIndex = segment?.scenes.findIndex(s => s.sceneId === sceneId) ?? 0;

      const generatedScene = await generateSingleScene({
        segmentId,
        storyData,
        sceneIndex,
      });

      if (generatedScene) {
        // Update the existing scene's content (and title if it was default)
        setSegments(prevSegments => {
          const newSegments = prevSegments.map(seg => ({
            ...seg,
            scenes: seg.scenes.map(scene => {
              if (scene.sceneId !== sceneId) return scene;
              return {
                ...scene,
                title: scene.title === 'New Scene' || scene.title === 'Untitled Scene' || !scene.title
                  ? generatedScene.title
                  : scene.title,
                content: generatedScene.content,
              };
            }),
          }));
          onScenesUpdate(newSegments);
          return newSegments;
        });
      }
    } catch (err) {
      console.error('Failed to generate scene content:', err);
    } finally {
      setGeneratingSceneId(null);
    }
  }, [isAILoading, generatingSceneId, segments, storyMetadata, generateSingleScene, onScenesUpdate]);

  // ===========================================================================
  // Transition Suggestion from Connection (with real API)
  // ===========================================================================

  const handleSuggestSceneFromConnection = useCallback(() => {
    if (!connectionPopover) return;

    const fromSceneInfo = getSceneInfo(connectionPopover.fromSceneId, segments);
    const toSceneInfo = getSceneInfo(connectionPopover.toSceneId, segments);

    if (!fromSceneInfo || !toSceneInfo) {
      console.error('Could not find scene info for connection');
      return;
    }

    // Set up transition context (but don't call API yet)
    setTransitionContext({
      fromSceneId: connectionPopover.fromSceneId,
      toSceneId: connectionPopover.toSceneId,
      fromScene: {
        title: fromSceneInfo.scene.title,
        content: fromSceneInfo.scene.content,
        displayId: fromSceneInfo.displayId,
      },
      toScene: {
        title: toSceneInfo.scene.title,
        content: toSceneInfo.scene.content,
        displayId: toSceneInfo.displayId,
      },
    });

    // Open panel in selecting state (so user can add guidance)
    if (!showAIPanel) {
      setPrePanelTransform(transform);
      setTransform(prev => {
        const newScale = Math.max(CANVAS_CONSTANTS.MIN_ZOOM, Math.min(prev.scale * 0.85, 0.9));
        const panXAdjustment = -DETAIL_PANEL_WIDTH / 4;
        return { ...prev, scale: newScale, panX: prev.panX + panXAdjustment };
      });
    }

    setShowAIPanel(true);
    setPanelMode('suggestions');
    setPanelState('selecting');  // <-- Start in selecting, not generating
    setAiSelectedSceneIds([]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setConnectionPopover(null);
  }, [connectionPopover, segments, showAIPanel, transform]);

  const handleGenerateSceneFromConnection = useCallback(async () => {
    if (!connectionPopover) return;

    const { fromSceneId } = connectionPopover;
    let targetSegmentId: string | null = null;
    let sceneIndex = 0;

    // Empty segment case
    if (fromSceneId.startsWith('empty-') || fromSceneId.startsWith('badge-')) {
      targetSegmentId = fromSceneId.replace('empty-', '').replace('badge-', '');
      sceneIndex = 0;
    } else {
      // Normal case — insert after the clicked scene
      for (const segment of segments) {
        const idx = segment.scenes.findIndex(s => s.sceneId === fromSceneId);
        if (idx !== -1) {
          targetSegmentId = segment.id;
          sceneIndex = idx + 1;
          break;
        }
      }
    }

    if (!targetSegmentId) return;

    // Close popover immediately
    setConnectionPopover(null);

    // Call API
    const storyData = buildSceneCanvasStoryData(segments, storyMetadata || {});

    const generatedScene = await generateSingleScene({
      segmentId: targetSegmentId,
      storyData,
      sceneIndex,
    });

    if (generatedScene) {
      const finalSegmentId = targetSegmentId;

      setSegments(prevSegments => {
        const newSegments = prevSegments.map(segment => {
          if (segment.id !== finalSegmentId) return segment;

          const newScene = {
            sceneId: generatedScene.sceneId,
            title: generatedScene.title,
            content: generatedScene.content,
          };

          if (segment.scenes.length === 0) {
            return { ...segment, scenes: [newScene] };
          }

          const newScenes = [...segment.scenes];
          newScenes.splice(sceneIndex, 0, newScene);
          return { ...segment, scenes: newScenes };
        });

        onScenesUpdate(newSegments);
        return newSegments;
      });

      setSelectedSceneId(generatedScene.sceneId);
      setSelectedSegmentId(finalSegmentId);
    }
  }, [connectionPopover, segments, storyMetadata, generateSingleScene, onScenesUpdate]);

  // ===========================================================================
  // Get Selected Scene and Segment
  // ===========================================================================

  const selectedSegment = segments.find(s => s.id === selectedSegmentId) || null;
  const selectedScene = selectedSegment?.scenes.find(s => s.sceneId === selectedSceneId) || null;

  const detailPanelNotes = selectedSceneId && selectedSegmentId
    ? getNotesForDetailPanel(selectedSceneId, selectedSegmentId)
    : { globalNotes: [], segmentNotes: [], sceneNotes: [] };

  // ===========================================================================
  // Focus
  // ===========================================================================
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const panTo = useCallback((worldY: number) => {
    const viewportCenterY = window.innerHeight / 2;

    setTransform(prev => {
      const newPanY = viewportCenterY - worldY * prev.scale;
      const clamped = clampPan(prev.panX, newPanY, prev.scale);

      return {
        ...prev,
        ...clamped,
      };
    });
  }, []);

  const focusSegment = useCallback((segmentId: string) => {
    const el = segmentRefs.current[segmentId];
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportCenterY = window.innerHeight / 2;

    const worldY = (rect.top - transform.panY) / transform.scale;

    const targetPanY = viewportCenterY - worldY * transform.scale;

    const startPanY = transform.panY;
    const delta = targetPanY - startPanY;

    const duration = 450;
    const startTime = performance.now();

    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const animatePan = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = ease(progress);

      let nextPanY = startPanY + delta * eased;

      const HEADER_VISUAL_OFFSET = 150;

      const topLimit =
        -(CANVAS_CONSTANTS.START_Y - HEADER_VISUAL_OFFSET) *
        transform.scale;

      nextPanY = Math.min(nextPanY, topLimit);

      setTransform(prev => ({
        ...prev,
        panY: nextPanY,
      }));

      if (progress < 1) {
        requestAnimationFrame(animatePan);
      }
    };

    requestAnimationFrame(animatePan);

    setSelectedSegmentId(segmentId);
    setSelectedSceneId(null);

    const badgeEl = document.querySelector(
      `[data-segment-badge="${segmentId}"]`
    ) as HTMLElement | null;

    if (badgeEl) {
      badgeEl.classList.add("segment-badge-shine");
      setTimeout(() => {
        badgeEl.classList.remove("segment-badge-shine");
      }, 1200);
    }
  }, [segmentRefs, transform]);

  const focusScene = useCallback((sceneId: string, segmentId: string) => {
    const el = document.querySelector(
      `[data-scene-id="${sceneId}"]`
    ) as HTMLElement | null;

    if (!el) return;

    el.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });

    setSelectedSegmentId(segmentId);
    setSelectedSceneId(sceneId);

    el.classList.add('scene-card-shine');
    setTimeout(() => {
      el.classList.remove('scene-card-shine');
    }, 1200);
  }, []);



  const zoomToFitAll = useCallback(() => {
    if (!segments.length) return;

    // Altura total do conteúdo
    let contentHeight = CANVAS_CONSTANTS.START_Y;

    segments.forEach(segment => {
      const sceneCount = Math.max(1, segment.scenes.length);

      contentHeight +=
        sceneCount * CANVAS_CONSTANTS.SCENE_CARD_HEIGHT +
        (sceneCount - 1) * CANVAS_CONSTANTS.ROW_GAP_Y +
        CANVAS_CONSTANTS.CANVAS_PADDING * 2;
    });

    const viewportHeight = window.innerHeight;

    // Zoom necessário para caber tudo
    const scale = Math.min(
      CANVAS_CONSTANTS.MAX_ZOOM,
      Math.max(
        CANVAS_CONSTANTS.MIN_ZOOM,
        viewportHeight / contentHeight
      )
    );

    // Centraliza verticalmente
    const targetPanY = (viewportHeight - contentHeight * scale) / 2;

    setSelectedSceneId(null);
    setSelectedSegmentId(null);

    setTransform({
      scale,
      panX: 0,
      panY: targetPanY,
    });

    animate(transform.scale, scale, {
      duration: 0.4,
      onUpdate: latest =>
        setTransform(prev => ({ ...prev, scale: latest })),
    });
  }, [segments]);


  // ===========================================================================
  // Command Pallete
  // ===========================================================================

  const { setMode } = useCommandUI();
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // ===== Navigation: Segments =====
    segments.forEach(segment => {
      cmds.push({
        id: `segment-${segment.id}`,
        label: `Go to ${segment.id} – ${segment.title}`,
        keywords: [segment.id.toLowerCase(), segment.title.toLowerCase()],
        group: 'Navigation',
        run: () => {
          focusSegment(segment.id); //
        },
      });

      segment.scenes.forEach((scene, index) => {
        cmds.push({
          id: `scene-${scene.sceneId}`,
          label: `Go to ${segment.id}.${index + 1} – ${scene.title || 'Untitled'}`,
          keywords: ['scene', segment.id.toLowerCase(), scene.title?.toLowerCase() || ''],
          group: 'Scenes',
          run: () => {
            focusScene(scene.sceneId, segment.id);
          },
        });
      });
    });

    // ===== Canvas =====
    cmds.push(
      {
        id: 'reset-zoom',
        label: 'Reset zoom',
        group: 'Canvas',
        run: () => setTransform({ scale: 1, panX: 0, panY: 0 }),
      },
      {
        id: 'zoom-fit',
        label: 'Zoom to fit all scenes',
        group: 'Canvas',
        run: () => zoomToFitAll(), // helper simples
      }
    );

    cmds.push({
      id: 'ui-command-bar',
      label: 'Switch to command bar',
      group: 'Command UI',
      keywords: ['command', 'bar', 'inline'],
      run: () => {
        setMode('bar');
      },
    },
      {
        id: 'ui-command-palette',
        label: 'Switch to command palette',
        group: 'Command UI',
        keywords: ['command', 'palette', 'modal'],
        run: () => {
          setMode('palette');
        },
      },
      {
        id: 'ui-command-docked',
        label: 'Dock command palette',
        group: 'Command UI',
        keywords: ['command', 'dock'],
        run: () => {
          setMode('docked');
        },
      },)

    // ===== AI =====
    cmds.push({
      id: 'open-ai',
      label: 'Open AI Panel',
      group: 'AI',
      run: () => handleRequestSuggestions(),
    });

    return cmds;
  }, [segments]);

  const {
    open: isCommandPaletteOpen,
    setOpen: setCommandPaletteOpen,
    query,
    setQuery,
    commands: filteredCommands,
  } = useCommandPalette(commands);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const preventCanvasKeys = (e: KeyboardEvent) => {
      e.stopPropagation();
    };

    window.addEventListener('keydown', preventCanvasKeys, true);
    return () => window.removeEventListener('keydown', preventCanvasKeys, true);
  }, [isCommandPaletteOpen]);

  // ===========================================================================
  // Tokens update
  // ===========================================================================

  useEffect(() => {
    if (user?.cap === undefined) return;

    const prev = prevCapRef.current;

    if (prev !== undefined && prev !== user.cap) {
      const diff = user.cap - prev;
      setTokenDiff(diff);

      const duration = 500;
      const start = prev;
      const end = user.cap;
      const startTime = performance.now();

      const animate = (time: number) => {
        const progress = Math.min((time - startTime) / duration, 1);
        const value = Math.floor(start + (end - start) * progress);
        setDisplayedCap(value);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      if (diff !== 0) {
        const now = new Date();
        const time = now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        setTokenHistory(prev => [
          { diff, time },
          ...prev.slice(0, 4)
        ]);
      }

      requestAnimationFrame(animate);

      setTimeout(() => {
        setTokenDiff(null);
      }, 2000);
    } else {
      setDisplayedCap(user.cap);
    }

    prevCapRef.current = user.cap;
  }, [user?.cap]);


  // ===========================================================================
  // Minimap
  // ===========================================================================

  const activeSegmentIndex = useMemo(() => {
    if (!selectedSegmentId) return null;
    return segments.findIndex(s => s.id === selectedSegmentId);
  }, [segments, selectedSegmentId]);

  const TOTAL_CANVAS_HEIGHT = useMemo(() => {
    let height = CANVAS_CONSTANTS.START_Y;

    segments.forEach(segment => {
      const sceneCount = Math.max(1, segment.scenes.length);

      height +=
        sceneCount * CANVAS_CONSTANTS.SCENE_CARD_HEIGHT +
        (sceneCount - 1) * CANVAS_CONSTANTS.ROW_GAP_Y +
        CANVAS_CONSTANTS.CANVAS_PADDING * 2;
    });

    return height;
  }, [segments]);

  const viewport = useMemo(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }), []);

  // ===========================================================================
  // Render
  // ===========================================================================

  const overlayContent = (
    <div
      style={{
        ...styles.overlay,
        ...(animationState === 'entering' ? styles.overlayEntering : {}),
        ...(animationState === 'active' ? styles.overlayActive : {}),
        ...(animationState === 'exiting' ? styles.overlayExiting : {}),
      }}
    >
      <div style={styles.mainLayout}>
        {/* <ScenesCanvasSidebar
          segments={segments}
          selectedSceneId={selectedSceneId}
          selectedSegmentId={selectedSegmentId}
          viewMode={sidebarViewMode}
          onViewModeChange={setSidebarViewMode}
          onSceneSelect={handleSceneSelect}
          onSegmentSelect={handleSegmentSelect}
          onSceneReorder={handleSceneReorder}
          onSceneMoveToSegment={handleSceneMoveToSegment}
        /> */}

        <div
          ref={workspaceContainerRef}
          style={styles.workspaceContainer}
          onClick={() => { if (connectionPopover) setConnectionPopover(null); }}
        >
          {/* Left Button Group - Exit button */}
          <div style={{ position: 'absolute', top: 20, left: 20, display: 'flex', alignItems: 'center', gap: '0.5rem', zIndex: 100 }}>
            <button
              onClick={handleExit}
              style={{
                padding: '0.6rem 1rem', background: 'rgba(30, 30, 36, 0.9)', border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'background 0.2s, border-color 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)'; e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(30, 30, 36, 0.9)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M11.7 4.3L4.3 11.7M4.3 4.3l7.4 7.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Back
            </button>
          </div>

          {/* Right Button Group - Model selector + Tokens */}
          <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', alignItems: 'center', gap: '0.75rem', zIndex: 100 }}>
            <ModelSelector selectedModel={selectedModelId} onModelChange={handleModelChange} />
            <div style={{ width: 1, height: 28, background: 'rgba(255, 255, 255, 0.1)' }} />
            <div
              className="token-counter"
              onMouseEnter={() => setShowHistory(true)}
              onMouseLeave={() => setShowHistory(false)}
            >
              <span className="token-count">
                <Component1Icon />
                <motion.span
                  key={displayedCap}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  {displayedCap}
                </motion.span>
                <AnimatePresence>
                  {tokenDiff !== null && (
                    <motion.div
                      initial={{ y: 0, opacity: 0 }}
                      animate={{ y: -20, opacity: 1 }}
                      exit={{ y: -30, opacity: 0 }}
                      transition={{ duration: 0.6 }}
                      className={`token-float ${tokenDiff > 0 ? 'positive' : 'negative'
                        }`}
                    >
                      {tokenDiff > 0 ? `+${tokenDiff}` : tokenDiff}
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {showHistory && tokenHistory.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="token-history-dropdown"
                    >
                      {tokenHistory.map((entry, index) => (
                        <div key={index} className="history-row">
                          <span
                            className={
                              entry.diff > 0 ? 'positive' : 'negative'
                            }
                          >
                            {entry.diff > 0 ? `+${entry.diff}` : entry.diff}
                          </span>
                          <span className="history-time">
                            {entry.time}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </span>
              <span className="token-label">
                Tokens Remaining
              </span>
            </div>
          </div>
          {!showAIPanel && !isFocusMode && (
            <>
              <CommandLauncher
                onOpen={() => {
                  setCommandPaletteOpen(true);
                  setQuery('');
                }}
              />
              <CommandPalette
                open={isCommandPaletteOpen}
                query={query}
                onQueryChange={setQuery}
                commands={filteredCommands}
                onClose={() => setCommandPaletteOpen(false)}
              />
              <ScenesMinimap
                activeSegmentIndex={activeSegmentIndex}
                onSelect={(index) => {
                  const segment = segments[index];
                  if (segment) {
                    focusSegment(segment.id);
                    console.log("segment.id:", segment.id);
                  }
                }}
              />
            </>
          )}


          <ScenesCanvasWorkspace
            segments={segments} segmentRefs={segmentRefs} noteCards={noteCards} selectedSceneId={selectedSceneId} selectedSegmentId={selectedSegmentId}
            transform={transform} linkingNoteId={linkingNoteId} linkingSceneIds={linkingSceneIds}
            isInSelectionMode={isInSelectionMode} selectionModeColor={selectionModeColor} aiSelectedSceneIds={aiSelectedSceneIds}
            onTransformChange={(next) => {
              const HEADER_VISUAL_OFFSET = 150;

              const topLimit =
                -(CANVAS_CONSTANTS.START_Y - HEADER_VISUAL_OFFSET) * next.scale;

              const clampedPanY = Math.min(next.panY, topLimit);

              setTransform({
                ...next,
                panY: clampedPanY,
              });
            }} onSceneSelect={handleSceneSelect} onSceneUpdate={handleWorkspaceSceneUpdate}
            onSceneToggleLink={handleSceneToggleLink} onNoteCardMove={handleNoteCardMove} onNoteCardUpdate={handleNoteCardUpdate}
            onNoteCardRemove={handleNoteCardRemove} onNoteCardSelect={handleNoteCardSelect} onNoteStartLinking={handleNoteStartLinking}
            onNoteFinishLinking={handleNoteFinishLinking} onNoteCancelLinking={handleNoteCancelLinking} onConnectionClick={handleConnectionClick}
            onTextSelectionAction={handleTextSelectionAction} activeTextSelectionSceneId={activeTextSelectionSceneId}
            activeTextSelectionBounds={activeTextSelectionBounds} activeTextSelectionColor={activeTextSelectionColor}
            isEditingDisabled={!!activeTextSelectionSceneId || showAIPanel}
            activeTransitionConnection={transitionContext ? { fromSceneId: transitionContext.fromSceneId, toSceneId: transitionContext.toSceneId } : null}
            isConnectionNodesDisabled={showAIPanel} deleteScene={deleteScene}
            onGenerateScene={handleGenerateSceneContent}
            generatingSceneId={generatingSceneId}
          />

          {/* AI Error Display */}
          {aiError && (
            <div style={{ position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)', background: 'rgba(239, 68, 68, 0.9)', border: '1px solid rgba(239, 68, 68, 0.5)', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', zIndex: 100 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              <span style={{ fontSize: 13, color: 'white' }}>{aiError}</span>
              <button onClick={clearError} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          {/* Focus Mode Overlay */}
          {isFocusMode && (aiSelectedSceneIds.length > 0 || pendingNewScene) && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10, 10, 14, 0.85)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 40, paddingBottom: 100, overflow: 'auto', zIndex: 50 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 420, padding: '0 20px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: panelState === 'reviewing' ? 'rgba(16, 185, 129, 0.2)' : panelMode === 'suggestions' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(6, 182, 212, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {panelState === 'reviewing' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      ) : panelMode === 'suggestions' ? (
                        <svg width="16" height="16" viewBox="0 0 15 15" fill="#8b5cf6"><path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" /></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="12" r="4" /><circle cx="18" cy="12" r="4" /><path d="M10 12h4" /></svg>
                      )}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
                      {(panelState === 'generating' || isAILoading) ? 'Generating...' : panelState === 'reviewing' ? (pendingNewScene ? 'Review New Scene' : 'Review Changes') : aiSelectedSceneIds.length > 0 ? `${aiSelectedSceneIds.length} Scene${aiSelectedSceneIds.length !== 1 ? 's' : ''} Selected` : 'New Scene'}
                    </span>
                    {panelState === 'reviewing' && <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Review Changes</span>}
                    {textSelectionContext && panelState === 'selecting' && <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.3)', color: '#a78bfa', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Text Selected</span>}
                  </div>
                  {panelState === 'selecting' && !activeTextSelectionSceneId && (
                    <button onClick={handleToggleFocusMode} style={{ padding: '6px 12px', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: 6, color: 'rgba(255, 255, 255, 0.7)', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease' }}>Exit Focus</button>
                  )}
                </div>

                {/* Action Buttons for Text Revision Review */}
                {pendingTextRevision && panelState === 'reviewing' && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <button onClick={handleAcceptTextRevision} style={{ flex: 1, padding: '10px 16px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>Accept
                    </button>
                    <button onClick={handleTryAgainTextRevision} style={{ flex: 1, padding: '10px 16px', background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: 8, color: 'rgba(255, 255, 255, 0.8)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>Try Again
                    </button>
                    <button onClick={handleDismissTextRevision} style={{ flex: 1, padding: '10px 16px', background: 'rgba(239, 68, 68, 0.15)', border: 'none', borderRadius: 8, color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>Dismiss
                    </button>
                  </div>
                )}

                {/* Action Buttons for Pending New Scene Review */}
                {pendingNewScene && panelState === 'reviewing' && (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <button onClick={handleAcceptNewScene} style={{ flex: 1, padding: '10px 16px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease', whiteSpace: 'nowrap' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>Insert Scene
                    </button>
                    <button onClick={handleTryAgainNewScene} disabled={isAILoading} style={{ flex: 1, padding: '10px 16px', background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: 8, color: 'rgba(255, 255, 255, 0.8)', fontSize: 13, fontWeight: 600, cursor: isAILoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease', whiteSpace: 'nowrap', opacity: isAILoading ? 0.5 : 1 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>{isAILoading ? 'Generating...' : 'Try Again'}
                    </button>
                    <button onClick={handleDismissNewScene} style={{ flex: 1, padding: '10px 16px', background: 'rgba(239, 68, 68, 0.15)', border: 'none', borderRadius: 8, color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s ease', whiteSpace: 'nowrap' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>Dismiss
                    </button>
                  </div>
                )}

                {/* Pending New Scene Card */}
                {pendingNewScene && panelState === 'reviewing' && (
                  <div style={{ background: 'linear-gradient(135deg, #1a1a1e 0%, #141416 100%)', borderRadius: 12, border: '1px solid rgba(16, 185, 129, 0.5)', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(16, 185, 129, 0.3)', overflow: 'hidden', animation: 'fadeSlideIn 0.3s ease both', marginBottom: 16 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: 'white', letterSpacing: '0.5px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>NEW</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', flex: 1 }}>{pendingNewScene.title}</span>
                    </div>
                    <div style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: 13, lineHeight: 1.6, color: '#10b981', margin: 0, whiteSpace: 'pre-wrap', textDecoration: 'underline', textDecorationColor: 'rgba(16, 185, 129, 0.4)', textUnderlineOffset: '3px' }}>{pendingNewScene.content}</p>
                    </div>
                  </div>
                )}

                {/* Scene Cards */}
                {!pendingNewScene && [...selectedScenesInfo]
                  .sort((a, b) => {
                    const parseId = (id: string) => { const match = id.match(/S(\d+)\.(\d+)/); return match ? { segment: parseInt(match[1]), scene: parseInt(match[2]) } : { segment: 0, scene: 0 }; };
                    const aId = parseId(a.displayId); const bId = parseId(b.displayId);
                    return aId.segment !== bId.segment ? aId.segment - bId.segment : aId.scene - bId.scene;
                  })
                  .map((sceneInfo, index) => {
                    const fullScene = segments.flatMap(s => s.scenes).find(s => s.sceneId === sceneInfo.sceneId);
                    const segmentColor = SEGMENT_COLORS[sceneInfo.segmentId] || '#888';
                    const hasPendingRevision = pendingTextRevision && pendingTextRevision.sceneId === sceneInfo.sceneId;

                    return (
                      <div key={sceneInfo.sceneId} style={{
                        background: 'linear-gradient(135deg, #1a1a1e 0%, #141416 100%)', borderRadius: 12,
                        border: hasPendingRevision ? '1px solid rgba(16, 185, 129, 0.5)' : panelState === 'reviewing' && reviewingScenes.has(sceneInfo.sceneId) ? (acceptCheckedSceneIds.includes(sceneInfo.sceneId) ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255, 255, 255, 0.2)') : `1px solid ${segmentColor}40`,
                        boxShadow: hasPendingRevision ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(16, 185, 129, 0.3)' : `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px ${segmentColor}20`,
                        overflow: 'hidden', animation: `fadeSlideIn 0.3s ease ${index * 0.1}s both`,
                        opacity: panelState === 'reviewing' && reviewingScenes.has(sceneInfo.sceneId) && !acceptCheckedSceneIds.includes(sceneInfo.sceneId) ? 0.6 : 1, transition: 'all 0.2s ease',
                      }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: 'white', letterSpacing: '0.5px', background: segmentColor }}>{sceneInfo.displayId}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sceneInfo.title || 'Untitled Scene'}</span>
                          {panelState === 'reviewing' && reviewingScenes.has(sceneInfo.sceneId) && (
                            <button onClick={(e) => { e.stopPropagation(); handleToggleAcceptScene(sceneInfo.sceneId); }} style={{ width: 24, height: 24, borderRadius: 6, border: acceptCheckedSceneIds.includes(sceneInfo.sceneId) ? '2px solid #10b981' : '2px solid rgba(255, 255, 255, 0.3)', background: acceptCheckedSceneIds.includes(sceneInfo.sceneId) ? '#10b981' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease', flexShrink: 0 }}>
                              {acceptCheckedSceneIds.includes(sceneInfo.sceneId) && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                            </button>
                          )}
                        </div>
                        <div style={{ padding: '14px 16px' }}>
                          {panelState === 'reviewing' && reviewingScenes.has(sceneInfo.sceneId) ? (
                            <div style={{ fontSize: 13, lineHeight: 1.8, color: '#c0c0c0', margin: 0 }}>{renderHighlightedContent(reviewingScenes.get(sceneInfo.sceneId)?.revised || '')}</div>
                          ) : (
                            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#a0a0a0', margin: 0, whiteSpace: 'pre-wrap' }}>
                              {pendingTextRevision && pendingTextRevision.sceneId === sceneInfo.sceneId && fullScene?.content ? (
                                <>{fullScene.content.substring(0, pendingTextRevision.originalBounds.start)}<span style={{ background: 'rgba(16, 185, 129, 0.2)', borderBottom: '2px solid #10b981', paddingBottom: '1px', borderRadius: '2px', color: '#e0e0e0' }}>{pendingTextRevision.revisedText}</span>{fullScene.content.substring(pendingTextRevision.originalBounds.end)}</>
                              ) : activeTextSelectionSceneId === sceneInfo.sceneId && activeTextSelectionBounds && fullScene?.content ? (
                                <>{fullScene.content.substring(0, activeTextSelectionBounds.start)}<span style={{ background: activeTextSelectionColor === 'purple' ? 'rgba(139, 92, 246, 0.25)' : 'rgba(14, 165, 233, 0.25)', borderBottom: activeTextSelectionColor === 'purple' ? '2px solid #8b5cf6' : '2px solid #0ea5e9', paddingBottom: '1px', borderRadius: '2px' }}>{fullScene.content.substring(activeTextSelectionBounds.start, activeTextSelectionBounds.end)}</span>{fullScene.content.substring(activeTextSelectionBounds.end)}</>
                              ) : (fullScene?.content || 'No content yet...')}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Connection Popover */}
          {connectionPopover && !connectionPopover.showSegmentChoice && (() => {
            const isEmptySegmentPopover = connectionPopover.fromSceneId === connectionPopover.toSceneId;
            return (
              <div style={{ position: 'absolute', left: connectionPopover.position.x * transform.scale + transform.panX, top: connectionPopover.position.y * transform.scale + transform.panY - 24, transform: 'translateX(-50%)', background: 'rgba(20, 20, 24, 0.95)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 10, padding: 5, display: 'flex', gap: 6, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)', zIndex: 200 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={handleAddSceneFromConnection} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)', border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>Add</span>
                </button>
                <button onClick={handleGenerateSceneFromConnection} disabled={isAILoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: 'none', borderRadius: 8, cursor: isAILoading ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap', opacity: isAILoading ? 0.5 : 1 }}>
                  {isAILoading ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="white"><path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" /></svg>
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>{isAILoading ? 'Generating...' : 'Generate'}</span>
                </button>
                {!isEmptySegmentPopover && (
                  <button onClick={handleSuggestSceneFromConnection} disabled={isAILoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: 'none', borderRadius: 8, cursor: isAILoading ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease', whiteSpace: 'nowrap', opacity: isAILoading ? 0.5 : 1 }}>
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="white"><path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" /></svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>Suggest</span>
                  </button>
                )}
              </div>
            );
          })()}

          {/* Cross-Segment Choice Popover */}
          {connectionPopover && connectionPopover.showSegmentChoice && (
            <div style={{ position: 'absolute', left: connectionPopover.position.x * transform.scale + transform.panX, top: connectionPopover.position.y * transform.scale + transform.panY - 24, transform: 'translateX(-50%)', background: 'rgba(20, 20, 24, 0.95)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)', zIndex: 200, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', paddingBottom: 4, borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>Add scene to which segment?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => insertNewSceneIntoSegment(connectionPopover.fromSegmentId, 'end')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: SEGMENT_COLORS[connectionPopover.fromSegmentId] || '#ff6b35' }} />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>{segments.find(s => s.id === connectionPopover.fromSegmentId)?.title || connectionPopover.fromSegmentId}</div><div style={{ fontSize: 10, color: '#888' }}>End of segment</div></div>
                </button>
                <button onClick={() => insertNewSceneIntoSegment(connectionPopover.toSegmentId, 'start')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: SEGMENT_COLORS[connectionPopover.toSegmentId] || '#8b5cf6' }} />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>{segments.find(s => s.id === connectionPopover.toSegmentId)?.title || connectionPopover.toSegmentId}</div><div style={{ fontSize: 10, color: '#888' }}>Start of segment</div></div>
                </button>
              </div>
              <button onClick={() => setConnectionPopover(prev => prev ? { ...prev, showSegmentChoice: false } : null)} style={{ padding: '6px 10px', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#888', transition: 'all 0.15s ease' }}>← Back</button>
            </div>
          )}

          {/* Linking Mode Indicator */}
          {linkingNoteId && (
            <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30, 30, 36, 0.95)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', zIndex: 100 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>Click scenes to link them to this note</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>Press Esc to cancel</span>
            </div>
          )}

          {/* Selection Mode Indicator */}
          {isInSelectionMode && (
            <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30, 30, 36, 0.95)', border: `1px solid ${selectionModeColor}40`, borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', zIndex: 100 }}>
              {panelMode === 'suggestions' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={selectionModeColor} strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={selectionModeColor} strokeWidth="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>}
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{textSelectionContext ? `Text selected - click Generate or select more scenes` : `Click scenes to select them for ${panelMode}`}</span>
              <span style={{ fontSize: 11, color: selectionModeColor, marginLeft: 8, fontWeight: 600 }}>{aiSelectedSceneIds.length} selected</span>
            </div>
          )}

          <ScenesCanvasToolbar transform={transform} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onZoomReset={handleZoomReset} onAddNote={handleAddNote} showMinimap={showAIPanel && panelMode === 'global-notes'} onToggleMinimap={handleToggleGlobalNotes} onRequestSuggestions={handleRequestSuggestions} onRequestRevisions={handleRequestRevisions} isPanelOpen={showAIPanel} panelMode={showAIPanel ? panelMode : null} />
        </div>

        {showAIPanel && (
          <SceneDetailPanel mode={panelMode} panelState={panelState} selectedScenes={selectedScenesInfo} suggestions={suggestions} revisions={revisions} guidance={guidance} onGuidanceChange={setGuidance} onRemoveScene={handleRemoveSceneFromSelection} onGenerate={handleGenerate} onClose={handleCloseAIPanel} isFocusMode={isFocusMode} onToggleFocusMode={handleToggleFocusMode} hasActiveTextSelection={!!activeTextSelectionSceneId} transitionContext={transitionContext} onApplyTransitionSuggestion={handleApplyTransitionSuggestion} onToggleSuggestion={handleToggleSuggestion} onApplySuggestions={handleApplySuggestions} onRegenerateSuggestions={handleRegenerateSuggestions} onDismissAllSuggestions={handleDismissAllSuggestions} reviewingScenesCount={reviewingScenes.size} acceptCheckedCount={acceptCheckedSceneIds.length} onAcceptChanges={handleAcceptChanges} onTryAgain={handleTryAgain} onDismissChanges={handleDismissChanges} onAcceptRevision={handleAcceptRevision} onDismissRevision={handleDismissRevision} onRetryRevision={handleRetryRevision} globalNotes={globalNotes} onAddGlobalNote={handleAddGlobalNote} onEditGlobalNote={handleEditGlobalNote} onDeleteGlobalNote={handleDeleteGlobalNote} />
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideInFromLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInFromRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {showTokenPopup && tokenDiff !== null && (
        <div
          className={`token-popup ${tokenDiff > 0 ? 'positive' : 'negative'}`}
        >
          {tokenDiff > 0 ? `+${tokenDiff}` : tokenDiff}
        </div>
      )}
    </div>
  );

  return createPortal(overlayContent, document.body);
};

export default ScenesCanvasOverlay;