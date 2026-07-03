/**
 * useSceneCanvasAI Hook
 * 
 * Manages AI operations for Scene Canvas:
 * - Single scene generation (for empty segments or inserting AI-generated scenes)
 * - Transition scene suggestions (between two scenes)
 * - Transition scene generation (from selected suggestion)
 * - Scene improvement suggestions (for selected scenes)
 * - Scene revisions (applying suggestions)
 * - Text selection revisions
 * - Session management
 * - Token balance updates
 * 
 * Uses REST API via axios (matching useCanvasState pattern)
 * 
 * Backend Event Names (match handler switch cases):
 * - generate-scene: Generate a single scene for a segment
 * - scene-transition-suggest: Get suggestions for a transition scene
 * - scene-transition-generate: Generate actual transition scene from suggestion
 * - scene-transition-retry: Retry transition scene generation
 * - scene-suggest: Get improvement suggestions for selected scenes
 * - scene-suggest-regenerate: Regenerate suggestions with different ideas
 * - scene-revise: Apply revision to a scene based on direction
 * - scene-revise-retry: Retry scene revision
 * - scene-revise-direct: Direct revision without prior suggestions
 * - scene-revise-direct-retry: Retry direct revision
 * - scene-text-revise: Revise selected text within a scene
 * - scene-text-revise-retry: Retry text revision
 */

import { useState, useCallback } from 'react';
import axios from 'axios';

// =============================================================================
// API Configuration
// =============================================================================

const API_ENDPOINT = `${process.env.REACT_APP_URL}/scenes`;

// =============================================================================
// Types
// =============================================================================

export interface SceneCanvasStoryData {
  G?: string;
  T?: string;
  CQ?: string;
  M?: string;
  SUM?: string;
  characters?: Record<string, {
    description: string;
    importance: string;
    arc?: {
      goal?: string;
      conflict?: string;
    };
  }>;
  S1?: SegmentData | string;
  S2?: SegmentData | string;
  S3?: SegmentData | string;
  S4?: SegmentData | string;
  S5?: SegmentData | string;
  S6?: SegmentData | string;
  S7?: SegmentData | string;
  S8?: SegmentData | string;
  S9?: SegmentData | string;
}

interface SegmentData {
  S: string;
  scenes: Array<{
    sceneId: string;
    title: string;
    content: string;
  }>;
}

export interface TransitionSuggestion {
  direction: string;
  rationale: string;
}

export interface SceneSuggestion {
  id: string;
  sceneId: string;
  displayId: string;
  content: string;
  isSelected: boolean;
  reasoning?: string;
}

export interface GeneratedScene {
  sceneId: string;
  title: string;
  content: string;
}

export interface SceneRevision {
  sceneId: string;
  title: string;
  content: string;
}

export interface TextRevision {
  replacement: string;
  selectionBounds: { start: number; end: number } | null;
}

// API Response types
interface SingleSceneGenerateResponse {
  scene: GeneratedScene;
  cap?: number;
}

interface TransitionSuggestResponse {
  sessionId: string;
  suggestions: TransitionSuggestion[];
  cap?: number;
}

interface TransitionGenerateResponse {
  sessionId: string;
  scene: GeneratedScene;
  cap?: number;
}

interface TransitionRetryResponse {
  scene: GeneratedScene;
  cap?: number;
}

interface SceneSuggestResponse {
  sessionId: string;
  suggestions: Array<{
    direction: string;
    rationale: string;
  }>;
  cap?: number;
}

interface SceneReviseResponse {
  sessionId: string;
  scene: SceneRevision;
  cap?: number;
}

interface TextReviseResponse {
  sessionId: string;
  replacement: string;
  selectionBounds: { start: number; end: number } | null;
  cap?: number;
}

interface UseSceneCanvasAIProps {
  userId: string;
  storyId: string;
  token?: any;
  onTokenUpdate?: (newBalance: number) => void;
  modelOverride?: string | null;
}

export interface UseSceneCanvasAIReturn {
  isLoading: boolean;
  error: string | null;
  sessionId: string | null;

  // Single scene generation
  generateSingleScene: (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneIndex?: number;
  }) => Promise<GeneratedScene | null>;

  // Transition operations
  requestTransitionSuggestions: (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    fromSceneId: string;
    toSceneId: string;
    fromScene: { title: string; content: string; displayId: string };
    toScene: { title: string; content: string; displayId: string };
    guidance?: string;
  }) => Promise<TransitionSuggestion[] | null>;

  generateTransitionScene: (direction: string) => Promise<GeneratedScene | null>;
  retryTransitionScene: () => Promise<GeneratedScene | null>;

  requestSceneSuggestions: (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    targetSceneIds: string[];
    targetScenes: Array<{ sceneId: string; title: string; content: string }>;
    guidance?: string;
  }) => Promise<SceneSuggestion[] | null>;

  regenerateSceneSuggestions: () => Promise<SceneSuggestion[] | null>;

  applySceneSuggestion: (params: {
    sceneId: string;
    direction: string;
  }) => Promise<SceneRevision | null>;

  retrySceneRevision: () => Promise<SceneRevision | null>;

  requestDirectSceneRevision: (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneId: string;
    targetScene: { sceneId: string; title: string; content: string };
    direction: string;
  }) => Promise<SceneRevision | null>;

  retryDirectSceneRevision: () => Promise<SceneRevision | null>;
  regenerateTransitionSuggestions: () => Promise<TransitionSuggestion[] | null>;

  requestTextRevision: (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneId: string;
    fullSceneContent: string;
    selection: string;
    selectionBounds: { start: number; end: number };
    direction: string;
  }) => Promise<TextRevision | null>;

  retryTextRevision: () => Promise<TextRevision | null>;

  clearSession: () => void;
  clearError: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useSceneCanvasAI({
  userId,
  storyId,
  token,
  onTokenUpdate,
  modelOverride = null,
}: UseSceneCanvasAIProps): UseSceneCanvasAIReturn {

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const handleTokenUpdate = useCallback((cap: number | undefined) => {
    if (cap !== undefined && onTokenUpdate) {
      console.log('💰 Scene Canvas: Updating token balance:', cap);
      onTokenUpdate(cap);
    }
  }, [onTokenUpdate]);

  const apiCall = useCallback(async <T>(payload: object): Promise<T> => {
    console.log('🎬 Scene Canvas API call:', {
      endpoint: API_ENDPOINT,
      event: (payload as any).event,
      hasToken: !!token,
      modelOverride: (payload as any).modelOverride || null,
    });

    try {
      const response = await axios.post(API_ENDPOINT, payload, {
        headers: {
          "Authorization": token?.toString() || '',
          "Content-Type": "application/json"
        }
      });

      console.log('✅ Scene Canvas API response:', {
        status: response.status,
        hasData: !!response.data
      });

      if (response.data?.body) {
        if (typeof response.data.body === 'string') {
          return JSON.parse(response.data.body) as T;
        }
        return response.data.body as T;
      }
      return response.data as T;

    } catch (err: any) {
      console.error('❌ Scene Canvas API error:', err);

      const errorMessage = err.response?.data?.error
        || err.response?.data?.body?.error
        || err.message
        || 'API request failed';

      if (errorMessage.toLowerCase().includes('token') ||
        errorMessage.toLowerCase().includes('insufficient')) {
        console.log('💸 Token error detected:', errorMessage);
      }

      throw new Error(errorMessage);
    }
  }, [token]);

  // ==========================================================================
  // Single Scene Generation
  // ==========================================================================

  const generateSingleScene = useCallback(async (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneIndex?: number;
  }): Promise<GeneratedScene | null> => {
    if (isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      console.log('🎬 Generating single scene:', {
        segmentId: params.segmentId,
        sceneIndex: params.sceneIndex,
        modelOverride,
      });

      const result = await apiCall<SingleSceneGenerateResponse>({
        event: 'generate-scene',
        userId,
        storyId,
        segmentId: params.segmentId,
        sceneIndex: params.sceneIndex ?? 0,
        storyData: params.storyData,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);

      if (result.scene) {
        console.log('✨ Single scene generated:', result.scene.title);
        return result.scene;
      }

      return null;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate scene';
      setError(message);
      console.error('Failed to generate single scene:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, storyId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Transition Suggestion Operations
  // ==========================================================================

  const requestTransitionSuggestions = useCallback(async (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    fromSceneId: string;
    toSceneId: string;
    fromScene: { title: string; content: string; displayId: string };
    toScene: { title: string; content: string; displayId: string };
    guidance?: string;
  }): Promise<TransitionSuggestion[] | null> => {
    if (isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TransitionSuggestResponse>({
        event: 'scene-transition-suggest',
        userId,
        storyId,
        segmentId: params.segmentId,
        storyData: params.storyData,
        fromSceneId: params.fromSceneId,
        toSceneId: params.toSceneId,
        fromScene: params.fromScene,
        toScene: params.toScene,
        ...(params.guidance && { guidance: params.guidance }),
        ...(modelOverride && { modelOverride }),
      });

      setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);
      return result.suggestions;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get transition suggestions';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, storyId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const generateTransitionScene = useCallback(async (
    direction: string
  ): Promise<GeneratedScene | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TransitionGenerateResponse>({
        event: 'scene-transition-generate',
        userId,
        sessionId,
        direction,
        ...(modelOverride && { modelOverride }),
      });

      if (result.sessionId) setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate transition scene';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const retryTransitionScene = useCallback(async (): Promise<GeneratedScene | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TransitionRetryResponse>({
        event: 'scene-transition-retry',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry transition scene';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Scene Suggestion Operations
  // ==========================================================================

  const requestSceneSuggestions = useCallback(async (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    targetSceneIds: string[];
    targetScenes: Array<{ sceneId: string; title: string; content: string }>;
    guidance?: string;
  }): Promise<SceneSuggestion[] | null> => {
    if (isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneSuggestResponse>({
        event: 'scene-suggest',
        userId,
        storyId,
        segmentId: params.segmentId,
        storyData: params.storyData,
        targetSceneIds: params.targetSceneIds,
        targetScenes: params.targetScenes,
        ...(params.guidance && { guidance: params.guidance }),
        ...(modelOverride && { modelOverride }),
      });

      setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);

      const uiSuggestions: SceneSuggestion[] = result.suggestions.map((sug, index) => ({
        id: `sug-${Date.now()}-${index}`,
        sceneId: params.targetSceneIds[0] || 'unknown',
        displayId: params.targetScenes[0]?.title?.substring(0, 10) || 'Scene',
        content: sug.direction,
        isSelected: false,
        reasoning: sug.rationale,
      }));

      return uiSuggestions;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get scene suggestions';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, storyId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const regenerateSceneSuggestions = useCallback(async (): Promise<SceneSuggestion[] | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneSuggestResponse>({
        event: 'scene-suggest-regenerate',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);

      const uiSuggestions: SceneSuggestion[] = result.suggestions.map((sug, index) => ({
        id: `sug-${Date.now()}-${index}`,
        sceneId: 'unknown',
        displayId: 'Scene',
        content: sug.direction,
        isSelected: false,
        reasoning: sug.rationale,
      }));

      return uiSuggestions;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate suggestions';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const regenerateTransitionSuggestions = useCallback(async (): Promise<TransitionSuggestion[] | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TransitionSuggestResponse>({
        event: 'scene-transition-suggest-regenerate',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);
      return result.suggestions;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate transition suggestions';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Scene Revision Operations
  // ==========================================================================

  const applySceneSuggestion = useCallback(async (params: {
    sceneId: string;
    direction: string;
  }): Promise<SceneRevision | null> => {
    if (!sessionId) {
      console.warn('No sessionId available for scene revision');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneReviseResponse>({
        event: 'scene-revise',
        userId,
        sessionId,
        sceneId: params.sceneId,
        direction: params.direction,
        ...(modelOverride && { modelOverride }),
      });

      if (result.sessionId) setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply suggestion';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, apiCall, handleTokenUpdate]);

  const retrySceneRevision = useCallback(async (): Promise<SceneRevision | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneReviseResponse>({
        event: 'scene-revise-retry',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry revision';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Direct Scene Revision Operations
  // ==========================================================================

  const requestDirectSceneRevision = useCallback(async (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneId: string;
    targetScene: { sceneId: string; title: string; content: string };
    direction: string;
  }): Promise<SceneRevision | null> => {
    if (isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneReviseResponse>({
        event: 'scene-revise-direct',
        userId,
        storyId,
        segmentId: params.segmentId,
        sceneId: params.sceneId,
        storyData: params.storyData,
        targetScene: params.targetScene,
        direction: params.direction,
        ...(modelOverride && { modelOverride }),
      });

      if (result.sessionId) setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revise scene';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, storyId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const retryDirectSceneRevision = useCallback(async (): Promise<SceneRevision | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<SceneReviseResponse>({
        event: 'scene-revise-direct-retry',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);
      return result.scene;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry revision';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Text Revision Operations
  // ==========================================================================

  const requestTextRevision = useCallback(async (params: {
    segmentId: string;
    storyData: SceneCanvasStoryData;
    sceneId: string;
    fullSceneContent: string;
    selection: string;
    selectionBounds: { start: number; end: number };
    direction: string;
  }): Promise<TextRevision | null> => {
    if (isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TextReviseResponse>({
        event: 'scene-text-revise',
        userId,
        storyId,
        segmentId: params.segmentId,
        storyData: params.storyData,
        sceneId: params.sceneId,
        fullSceneContent: params.fullSceneContent,
        selection: params.selection,
        selectionBounds: params.selectionBounds,
        direction: params.direction,
        ...(modelOverride && { modelOverride }),
      });

      setSessionId(result.sessionId);
      handleTokenUpdate(result.cap);

      return {
        replacement: result.replacement,
        selectionBounds: result.selectionBounds,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get text revision';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, storyId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  const retryTextRevision = useCallback(async (): Promise<TextRevision | null> => {
    if (!sessionId || isLoading) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await apiCall<TextReviseResponse>({
        event: 'scene-text-revise-retry',
        userId,
        sessionId,
        ...(modelOverride && { modelOverride }),
      });

      handleTokenUpdate(result.cap);

      return {
        replacement: result.replacement,
        selectionBounds: result.selectionBounds,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry text revision';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, modelOverride, isLoading, apiCall, handleTokenUpdate]);

  // ==========================================================================
  // Session Management
  // ==========================================================================

  const clearSession = useCallback(() => {
    setSessionId(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    isLoading,
    error,
    sessionId,

    generateSingleScene,

    requestTransitionSuggestions,
    generateTransitionScene,
    retryTransitionScene,

    requestSceneSuggestions,
    regenerateSceneSuggestions,

    applySceneSuggestion,
    retrySceneRevision,

    requestDirectSceneRevision,
    retryDirectSceneRevision,
    regenerateTransitionSuggestions,

    requestTextRevision,
    retryTextRevision,

    clearSession,
    clearError,
  };
}

export default useSceneCanvasAI;