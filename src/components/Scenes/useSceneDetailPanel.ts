/**
 * useSceneDetailPanel
 * 
 * Shared hook for managing the SceneDetailPanel state and logic.
 * Used by both SegmentScenesView (acts view) and ScenesCanvasOverlay (canvas view).
 */

import { useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import type { Scene, SegmentWithScenes } from '../../models/acts';

// =============================================================================
// Types
// =============================================================================

export type PanelMode = 'suggestions' | 'revisions' | 'global-notes';
export type PanelState = 'selecting' | 'generating' | 'results' | 'reviewing';

export interface SelectedSceneInfo {
  sceneId: string;
  segmentId: string;
  displayId: string;
  title: string;
  content?: string;
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

export interface UseSceneDetailPanelOptions {
    segments: SegmentWithScenes[];
    onScenesUpdate: (segments: SegmentWithScenes[]) => void;
    userId: string;
    token: any;
    storyId?: string;
    storyMetadata?: {
      genre?: string;
      theme?: string;
      coreQuestion?: string;
      mood?: string;
      summary?: string;
      characters?: Record<string, any>;
    };
    getSceneDisplayId: (segmentId: string, index: number) => string;
  }

export interface UseSceneDetailPanelReturn {
  // Panel visibility
  isPanelOpen: boolean;
  openPanel: (mode: PanelMode) => void;
  closePanel: () => void;
  
  // Panel state
  panelMode: PanelMode;
  panelState: PanelState;
  
  // Scene selection
  selectedScenes: SelectedSceneInfo[];
  addSceneToSelection: (scene: Scene, segmentId: string) => void;
  removeSceneFromSelection: (sceneId: string) => void;
  clearSelection: () => void;
  isSceneSelected: (sceneId: string) => boolean;
  
  // Guidance
  guidance: string;
  setGuidance: (guidance: string) => void;
  
  // Results
  suggestions: Suggestion[];
  revisions: Revision[];
  
  // Actions
  handleGenerate: () => Promise<void>;
  
  // Suggestion actions
  toggleSuggestion: (suggestionId: string) => void;
  applySuggestions: () => Promise<void>;
  regenerateSuggestions: () => void;
  dismissAllSuggestions: () => void;
  
  // Revision actions
  acceptRevision: (revisionId: string) => void;
  dismissRevision: (revisionId: string) => void;
  retryRevision: (revisionId: string) => void;
  
  // Review state (after applying suggestions)
  reviewingScenesCount: number;
  acceptCheckedCount: number;
  acceptChanges: () => void;
  toggleRevisionStatus: (revisionId: string) => void;
  tryAgain: () => void;
  dismissChanges: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useSceneDetailPanel({
    segments,
    onScenesUpdate,
    userId,
    token,
    storyId,
    storyMetadata,
    getSceneDisplayId,
  }: UseSceneDetailPanelOptions): UseSceneDetailPanelReturn {
  
  // Panel visibility and mode
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('suggestions');
  const [panelState, setPanelState] = useState<PanelState>('selecting');
  
  // Selected scenes for processing
  const [selectedScenes, setSelectedScenes] = useState<SelectedSceneInfo[]>([]);
  
  // Guidance text
  const [guidance, setGuidance] = useState('');
  
  // Results
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Review state
  const [reviewingScenesCount, setReviewingScenesCount] = useState(0);
  const [acceptCheckedCount, setAcceptCheckedCount] = useState(0);
  
  // ==========================================================================
  // Panel Control
  // ==========================================================================
  
  const openPanel = useCallback((mode: PanelMode) => {
    setPanelMode(mode);
    setPanelState('selecting');
    setSelectedScenes([]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setSessionId(null);
    setIsPanelOpen(true);
  }, []);
  
  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    setPanelState('selecting');
    setSelectedScenes([]);
    setGuidance('');
    setSuggestions([]);
    setRevisions([]);
    setSessionId(null);
  }, []);
  
  // ==========================================================================
  // Scene Selection
  // ==========================================================================
  
  const addSceneToSelection = useCallback((scene: Scene, segmentId: string) => {
    // Find the scene index within its segment
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) return;
    
    const sceneIndex = segment.scenes.findIndex(s => s.sceneId === scene.sceneId);
    if (sceneIndex === -1) return;
    
    const displayId = getSceneDisplayId(segmentId, sceneIndex);
    
    setSelectedScenes(prev => {
      // Don't add duplicates
      if (prev.some(s => s.sceneId === scene.sceneId)) {
        return prev;
      }
      
      return [...prev, {
        sceneId: scene.sceneId,
        segmentId,
        displayId,
        title: scene.title || 'Untitled Scene',
        content: scene.content,
      }];
    });
  }, [segments, getSceneDisplayId]);
  
  const removeSceneFromSelection = useCallback((sceneId: string) => {
    setSelectedScenes(prev => prev.filter(s => s.sceneId !== sceneId));
  }, []);
  
  const clearSelection = useCallback(() => {
    setSelectedScenes([]);
  }, []);
  
  const isSceneSelected = useCallback((sceneId: string) => {
    return selectedScenes.some(s => s.sceneId === sceneId);
  }, [selectedScenes]);
  
  // ==========================================================================
  // Generate (Suggestions or Revisions)
  // ==========================================================================
  
  const handleGenerate = useCallback(async () => {
    if (selectedScenes.length === 0) {
      toast.error('Please select at least one scene');
      return;
    }
    
    setPanelState('generating');
    
    try {
      const endpoint = `${process.env.REACT_APP_URL}/scenes`;
      
      const storyData = {
        G: storyMetadata?.genre || '',
        T: storyMetadata?.theme || '',
        CQ: storyMetadata?.coreQuestion || '',
        M: storyMetadata?.mood || '',
        SUM: storyMetadata?.summary || '',
        characters: storyMetadata?.characters || {},
      };
      
      if (panelMode === 'suggestions') {
        // ── SUGGESTIONS FLOW ──
        const payload = {
          event: 'scene-suggest',
          userId,
          storyId,
          segmentId: selectedScenes[0]?.segmentId,
          targetSceneIds: selectedScenes.map(s => s.sceneId),
          targetScenes: selectedScenes.map(s => ({
            sceneId: s.sceneId,
            title: s.title,
            content: s.content || '',
          })),
          guidance,
          storyData,
        };
        
        console.log(`📤 Requesting suggestions:`, payload);
        
        const response = await axios.post(endpoint, payload, {
          headers: {
            'Authorization': token?.toString() || '',
            'Content-Type': 'application/json',
          },
        });
        
        console.log(`📥 Suggestions response:`, response.data);
        
        const data = response.data?.body
          ? (typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body)
          : response.data;
        
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
        
        const suggestionResults: Suggestion[] = (data.suggestions || []).map(
          (s: any, index: number) => ({
            id: `suggestion_${Date.now()}_${index}`,
            sceneId: selectedScenes[0]?.sceneId,
            displayId: selectedScenes[0]?.displayId,
            content: s.direction || s.content || s.suggestion || '',
            isSelected: false,
            reasoning: s.rationale || s.reasoning,
          })
        );
        
        setSuggestions(suggestionResults);
        setPanelState('results');
        
      } else {
        // ── REVISIONS FLOW ── call scene-revise-direct per selected scene
        const revisionResults: Revision[] = [];
        
        for (const scene of selectedScenes) {
          const payload = {
            event: 'scene-revise-direct',
            userId,
            storyId,
            segmentId: scene.segmentId,
            sceneId: scene.sceneId,
            targetScene: {
              sceneId: scene.sceneId,
              title: scene.title,
              content: scene.content || '',
            },
            direction: guidance,
            storyData,
          };
          
          console.log(`📤 Revising scene ${scene.displayId} (${scene.sceneId}):`, payload);
          
          const response = await axios.post(endpoint, payload, {
            headers: {
              'Authorization': token?.toString() || '',
              'Content-Type': 'application/json',
            },
          });
          
          console.log(`📥 Revision response for ${scene.displayId}:`, response.data);
          
          const data = response.data?.body
            ? (typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body)
            : response.data;
          
          if (data.sessionId) {
            setSessionId(data.sessionId);
          }
          
          if (data.scene) {
            revisionResults.push({
              id: `revision_${Date.now()}_${revisionResults.length}`,
              sceneId: data.scene.sceneId || scene.sceneId,
              displayId: scene.displayId,
              sceneTitle: data.scene.title || scene.title,
              originalText: scene.content || '',
              revisedText: data.scene.content || '',
              status: 'pending' as const,
            });
          }
        }
        
        if (revisionResults.length > 0) {
          setRevisions(revisionResults);
          setPanelState('reviewing');
          setReviewingScenesCount(revisionResults.length);
          setAcceptCheckedCount(revisionResults.length);
        } else {
          toast.error('No revisions were generated');
          setPanelState('selecting');
        }
      }
      
    } catch (error: any) {
      console.error(`❌ ${panelMode} generation failed:`, error);
      toast.error(error.response?.data?.message || `Failed to generate ${panelMode}`);
      setPanelState('selecting');
    }
  }, [panelMode, selectedScenes, guidance, userId, storyId, token, storyMetadata]);
  
  // ==========================================================================
  // Suggestion Actions
  // ==========================================================================
  
  const toggleSuggestion = useCallback((suggestionId: string) => {
    setSuggestions(prev =>
      prev.map(s =>
        s.id === suggestionId ? { ...s, isSelected: !s.isSelected } : s
      )
    );
  }, []);
  const applySuggestions = useCallback(async () => {
    const selected = suggestions.filter(s => s.isSelected);
    if (selected.length === 0) {
      toast.error('Please select at least one suggestion');
      return;
    }
  
    if (!sessionId) {
      toast.error('Session expired — please regenerate suggestions');
      return;
    }
  
    setPanelState('generating');
  
    try {
      const results: Revision[] = [];
      
      // Combine all selected suggestion directions into one
      const combinedDirection = selected.map(s => s.content).join('\n');
  
      // Call scene-revise for EACH selected scene
      for (const scene of selectedScenes) {
        const endpoint = `${process.env.REACT_APP_URL}/scenes`;
  
        const payload = {
          event: 'scene-revise',
          userId,
          sessionId,
          sceneId: scene.sceneId,
          direction: combinedDirection,
        };
  
        console.log(`📤 Revising scene ${scene.displayId} (${scene.sceneId}):`, payload);
  
        const response = await axios.post(endpoint, payload, {
          headers: {
            'Authorization': token?.toString() || '',
            'Content-Type': 'application/json',
          },
        });
  
        const data = response.data?.body
          ? (typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body)
          : response.data;
  
        console.log(`📥 Revision for ${scene.displayId}:`, data);
  
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
  
        if (data.scene) {
          results.push({
            id: `revision_${Date.now()}_${results.length}`,
            sceneId: data.scene.sceneId || scene.sceneId,
            displayId: scene.displayId,
            sceneTitle: data.scene.title || scene.title,
            originalText: scene.content || '',
            revisedText: data.scene.content || '',
            status: 'pending' as const,
          });
        }
      }
  
      if (results.length > 0) {
        setRevisions(results);
        setPanelState('reviewing');
        setReviewingScenesCount(results.length);
        setAcceptCheckedCount(results.length);
      } else {
        toast.error('No revisions were generated');
        setPanelState('results');
      }
  
    } catch (error: any) {
      console.error('❌ Apply suggestions failed:', error);
      toast.error(error.response?.data?.message || 'Failed to apply suggestions');
      setPanelState('results');
    }
  }, [suggestions, selectedScenes, sessionId, userId, token]);
  
  const regenerateSuggestions = useCallback(() => {
    setSuggestions([]);
    setPanelState('selecting');
  }, []);
  
  const dismissAllSuggestions = useCallback(() => {
    setSuggestions([]);
    setPanelState('selecting');
    toast('Suggestions dismissed');
  }, []);
  
  // ==========================================================================
  // Revision Actions
  // ==========================================================================
  
  const acceptRevision = useCallback((revisionId: string) => {
    const revision = revisions.find(r => r.id === revisionId);
    if (!revision) return;
    
    // Find and update the scene
    const updatedSegments = segments.map(segment => ({
      ...segment,
      scenes: segment.scenes.map(scene => {
        if (scene.sceneId === revision.sceneId) {
          return { ...scene, content: revision.revisedText };
        }
        return scene;
      }),
    }));
    
    onScenesUpdate(updatedSegments);
    
    setRevisions(prev =>
      prev.map(r =>
        r.id === revisionId ? { ...r, status: 'accepted' as const } : r
      )
    );
    
    toast.success('Revision accepted');
  }, [revisions, segments, onScenesUpdate]);
  
  const dismissRevision = useCallback((revisionId: string) => {
    setRevisions(prev =>
      prev.map(r =>
        r.id === revisionId ? { ...r, status: 'dismissed' as const } : r
      )
    );
    toast('Revision dismissed');
  }, []);
  
  const retryRevision = useCallback((revisionId: string) => {
    // Remove the revision and go back to selection with that scene
    const revision = revisions.find(r => r.id === revisionId);
    if (revision) {
      setRevisions(prev => prev.filter(r => r.id !== revisionId));
      // Scene stays in selection for retry
    }
    
    if (revisions.filter(r => r.status === 'pending').length <= 1) {
      setPanelState('selecting');
    }
  }, [revisions]);
  
  // ==========================================================================
  // Review Actions (after applying suggestions)
  // ==========================================================================

  const toggleRevisionStatus = useCallback((revisionId: string) => {
    setRevisions(prev => prev.map(r => 
      r.id === revisionId 
        ? { ...r, status: r.status === 'pending' ? 'dismissed' : 'pending' as const }
        : r
    ));
  }, []);
  
  const acceptChanges = useCallback(() => {
    const pendingRevisions = revisions.filter(r => r.status === 'pending');
    const dismissedRevisions = revisions.filter(r => r.status === 'dismissed');
  
    if (pendingRevisions.length === 0) {
      toast.error('No revisions selected');
      return;
    }
  
    // Apply pending revisions to segments
    const updatedSegments = segments.map(segment => ({
      ...segment,
      scenes: segment.scenes.map(scene => {
        const revision = pendingRevisions.find(r => r.sceneId === scene.sceneId);
        if (revision) {
          return { 
            ...scene, 
            content: revision.revisedText, 
            title: revision.sceneTitle || scene.title 
          };
        }
        return scene;
      }),
    }));
  
    onScenesUpdate(updatedSegments);
    toast.success(`Accepted ${pendingRevisions.length} revision(s)`);
  
    // If there are dismissed revisions remaining, keep them in focus mode
    // and re-select them for further action
    if (dismissedRevisions.length > 0) {
      setRevisions(
        dismissedRevisions.map(r => ({ ...r, status: 'pending' as const }))
      );
      setReviewingScenesCount(dismissedRevisions.length);
      setAcceptCheckedCount(dismissedRevisions.length);
    } else {
      // All revisions handled, close panel
      closePanel();
    }
  }, [revisions, segments, onScenesUpdate, closePanel]);
  
  const tryAgain = useCallback(async () => {
    const remainingRevisions = revisions.filter(r => r.status === 'pending');
    
    if (remainingRevisions.length === 0) {
      toast.error('No revisions to retry');
      return;
    }
  
    // If we're in suggestions mode, go back to suggestion results
    if (panelMode === 'suggestions') {
      const remainingSceneIds = new Set(remainingRevisions.map(r => r.sceneId));
      setSelectedScenes(prev => prev.filter(s => remainingSceneIds.has(s.sceneId)));
      setSuggestions(prev => prev.map(s => ({ ...s, isSelected: false })));
      setRevisions([]);
      setPanelState('results');
      return;
    }
  
    // For direct revisions — re-run with context of what was rejected
    setPanelState('generating');
  
    try {
      const endpoint = `${process.env.REACT_APP_URL}/scenes`;
  
      const storyData = {
        G: storyMetadata?.genre || '',
        T: storyMetadata?.theme || '',
        CQ: storyMetadata?.coreQuestion || '',
        M: storyMetadata?.mood || '',
        SUM: storyMetadata?.summary || '',
        characters: storyMetadata?.characters || {},
      };
  
      const newRevisionResults: Revision[] = [];
  
      for (const revision of remainingRevisions) {
        const originalScene = selectedScenes.find(s => s.sceneId === revision.sceneId);
  
        // Build direction that includes context of the rejected revision
        const retryDirection = [
          guidance,
          `\n\nThe following revision was rejected — try a different approach while keeping the same intent:`,
          `\nRejected version: "${revision.revisedText.substring(0, 300)}${revision.revisedText.length > 300 ? '...' : ''}"`,
        ].join('');
  
        const payload = {
          event: 'scene-revise-direct',
          userId,
          storyId,
          segmentId: originalScene?.segmentId,
          sceneId: revision.sceneId,
          targetScene: {
            sceneId: revision.sceneId,
            title: revision.sceneTitle,
            content: revision.originalText,
          },
          direction: retryDirection,
          storyData,
        };
  
        console.log(`🔄 Retrying revision for ${revision.displayId}:`, payload);
  
        const response = await axios.post(endpoint, payload, {
          headers: {
            'Authorization': token?.toString() || '',
            'Content-Type': 'application/json',
          },
        });
  
        const data = response.data?.body
          ? (typeof response.data.body === 'string' ? JSON.parse(response.data.body) : response.data.body)
          : response.data;
  
        if (data.sessionId) {
          setSessionId(data.sessionId);
        }
  
        if (data.scene) {
          newRevisionResults.push({
            id: `revision_${Date.now()}_${newRevisionResults.length}`,
            sceneId: data.scene.sceneId || revision.sceneId,
            displayId: revision.displayId,
            sceneTitle: data.scene.title || revision.sceneTitle,
            originalText: revision.originalText,
            revisedText: data.scene.content || '',
            status: 'pending' as const,
          });
        }
      }
  
      if (newRevisionResults.length > 0) {
        setRevisions(newRevisionResults);
        setPanelState('reviewing');
        setReviewingScenesCount(newRevisionResults.length);
        setAcceptCheckedCount(newRevisionResults.length);
      } else {
        toast.error('No revisions were generated');
        setPanelState('selecting');
      }
  
    } catch (error: any) {
      console.error('❌ Retry revision failed:', error);
      toast.error(error.response?.data?.message || 'Failed to retry revision');
      setPanelState('reviewing');
    }
  }, [revisions, panelMode, selectedScenes, guidance, userId, storyId, token, storyMetadata]);

  const dismissChanges = useCallback(() => {
    setRevisions([]);
    setSuggestions(prev => prev.map(s => ({ ...s, isSelected: false })));
    setPanelState('results');
    toast('Changes dismissed');
  }, []);
  
  // ==========================================================================
  // Return
  // ==========================================================================
  
  return {
    // Panel visibility
    isPanelOpen,
    openPanel,
    closePanel,
    
    // Panel state
    panelMode,
    panelState,
    
    // Scene selection
    selectedScenes,
    addSceneToSelection,
    removeSceneFromSelection,
    clearSelection,
    isSceneSelected,
    
    // Guidance
    guidance,
    setGuidance,
    
    // Results
    suggestions,
    revisions,
    
    // Actions
    handleGenerate,
    
    // Suggestion actions
    toggleSuggestion,
    applySuggestions,
    regenerateSuggestions,
    dismissAllSuggestions,
    
    // Revision actions
    acceptRevision,
    dismissRevision,
    retryRevision,
    
    // Review state
    reviewingScenesCount,
    acceptCheckedCount,
    toggleRevisionStatus,
    acceptChanges,
    tryAgain,
    dismissChanges,
  };
}