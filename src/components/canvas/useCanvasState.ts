/**
 * useCanvasState Hook
 * 
 * Manages all state for a segment's canvas including:
 * - Loading/saving canvas state
 * - Card CRUD operations
 * - localStorage draft persistence
 * - AI suggestion requests (real API)
 * - Revert functionality for applied suggestions
 * - Token management integration
 * - Multi-provider model override support
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  CanvasCard,
  CanvasState,
  UseCanvasStateReturn,
  NewCardInput,
  Position,
  LinkedText,
} from './types';

// =============================================================================
// Utility Functions
// =============================================================================

const generateId = (): string => {
  return `card_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
};

const getLocalStorageKey = (storyId: string, segmentId: string): string => {
  return `canvas-draft-${storyId}-${segmentId}`;
};

// =============================================================================
// API Configuration
// =============================================================================

const API_ENDPOINT = `${process.env.REACT_APP_URL}/story`;

// =============================================================================
// Types
// =============================================================================

interface StoryData {
  brainstorm?: string;
  synopsis?: string;
  segment1?: string;
  segment2?: string;
  segment3?: string;
  segment4?: string;
  segment5?: string;
  segment6?: string;
  segment7?: string;
  segment8?: string;
  segment9?: string;
}

interface SuggestParams {
  userId: string;
  storyId: string;
  segmentType: number;
  storyData: StoryData;
  selection: string | null;
  selectionBounds: { start: number; end: number } | null;
  notes: string[];
  guidance: string | null;
  modelOverride?: string | null;  // ✨ Multi-provider support
}

interface SuggestResponse {
  sessionId: string;
  suggestions: Array<{
    direction: string;
    rationale: string;
  }>;
  cap?: number;  // Token balance after operation
}

interface RegenerateResponse {
  suggestions: Array<{
    direction: string;
    rationale: string;
  }>;
  cap?: number;  // Token balance after operation
}

interface ReviseResponse {
  replacement: string;
  selectionBounds: { start: number; end: number };
  cap?: number;  // Token balance after operation
}

interface CardsResponse {
  cards: CanvasCard[];
}

// History entry for revert functionality
interface HistoryEntry {
  content: string;
  timestamp: string;
  appliedSuggestion?: string;
}

// Pending revision waiting for user approval
export interface PendingRevision {
  replacement: string;
  selectionBounds: { start: number; end: number } | null;
  direction: string;
  sessionId: string;
  originalContent: string;  // The segment content before revision, for preview/revert
  selectedSuggestionIds: string[];  // Which suggestion cards are currently selected
}

// =============================================================================
// Helper: Convert segment ID to segment type number
// =============================================================================

function getSegmentType(segmentId: string): number {
  if (segmentId === 'SUM' || segmentId === 'synopsis') return 0;
  const match = segmentId.match(/S?(\d+)/i);
  if (match) return parseInt(match[1], 10);
  return 0;
}

// =============================================================================
// Hook Implementation
// =============================================================================

interface UseCanvasStateProps {
  storyId: string;
  segmentId: string;
  userId: string;
  segmentContent: string;
  storyData?: StoryData;
  token?: any;
  onTokenUpdate?: (newBalance: number) => void;  // Callback to update global token balance
  modelOverride?: string | null;  // ✨ Multi-provider model override
}

export function useCanvasState({
  storyId,
  segmentId,
  userId,
  segmentContent,
  storyData = {},
  token,
  onTokenUpdate,
  modelOverride = null,  // ✨ Default to null (use fine-tuned models)
}: UseCanvasStateProps): UseCanvasStateReturn & {
  // Extended return for AI operations
  sessionId: string | null;
  regenerateSuggestions: () => Promise<void>;
  applySelectedSuggestions: (ids: string[], onContentChange: (content: string) => void) => Promise<void>;
  // Revert functionality
  canRevert: boolean;
  revertLastChange: (onContentChange: (content: string) => void) => void;
  historyLength: number;
  // Apply feedback state
  isApplyingSuggestion: boolean;
  // Pending revision approval
  pendingRevision: PendingRevision | null;
  acceptRevision: (onContentChange: (content: string) => void) => void;
  retryRevision: () => Promise<void>;
  dismissRevision: () => void;
  // Direct revision (intern flow)
  generateDirectRevision: (guidance: string, targetText: LinkedText | null, onContentChange: (content: string) => void) => Promise<void>;
} {
  // Core state
  const [cards, setCards] = useState<CanvasCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRequestingSuggestions, setIsRequestingSuggestions] = useState(false);
  const [isApplyingSuggestion, setIsApplyingSuggestion] = useState(false);
  
  // AI session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSelection, setCurrentSelection] = useState<LinkedText | null>(null);
  
  // Pending revision state (for approval flow)
  const [pendingRevision, setPendingRevision] = useState<PendingRevision | null>(null);
  
  // History state for revert functionality
  const [contentHistory, setContentHistory] = useState<HistoryEntry[]>([]);
  const MAX_HISTORY_LENGTH = 10;
  
  // Track if initial load is complete
  const initialLoadComplete = useRef(false);

  // ==========================================================================
  // Token Balance Update Helper
  // ==========================================================================
  
  const handleTokenUpdate = useCallback((cap: number | undefined) => {
    if (cap !== undefined && onTokenUpdate) {
      console.log('💰 Updating token balance:', cap);
      onTokenUpdate(cap);
    }
  }, [onTokenUpdate]);

  // ==========================================================================
  // API Functions (using axios with auth token, matching Home.tsx pattern)
  // ==========================================================================

  const apiCall = useCallback(async <T>(payload: object): Promise<T> => {
    console.log('🚀 Canvas API call:', {
      endpoint: API_ENDPOINT,
      event: (payload as any).event,
      hasToken: !!token,
      modelOverride: (payload as any).modelOverride || null
    });

    try {
      const response = await axios.post(API_ENDPOINT, payload, {
        headers: { 
          "Authorization": token?.toString() || '',
          "Content-Type": "application/json"
        }
      });

      console.log('✅ Canvas API response:', {
        status: response.status,
        hasData: !!response.data
      });

      if (response.data?.body) {
        return response.data.body as T;
      }
      return response.data as T;

    } catch (err: any) {
      console.error('❌ Canvas API error:', err);
      
      // Extract error message from response
      const errorMessage = err.response?.data?.error 
        || err.response?.data?.body?.error
        || err.message 
        || 'API request failed';
      
      // Check for token-related errors and log specifically
      if (errorMessage.toLowerCase().includes('token') || 
          errorMessage.toLowerCase().includes('insufficient')) {
        console.log('💸 Token error detected:', errorMessage);
      }
      
      throw new Error(errorMessage);
    }
  }, [token]);

  const canvasSuggest = useCallback(async (params: SuggestParams): Promise<SuggestResponse> => {
    const result = await apiCall<SuggestResponse>({
      event: 'canvas-suggest',
      ...params,
    });
    handleTokenUpdate(result.cap);
    return result;
  }, [apiCall, handleTokenUpdate]);

  const canvasRegenerate = useCallback(async (
    userIdParam: string, 
    sessionIdParam: string,
    modelOverrideParam?: string | null  // ✨ Multi-provider support
  ): Promise<RegenerateResponse> => {
    const result = await apiCall<RegenerateResponse>({
      event: 'canvas-regenerate',
      userId: userIdParam,
      sessionId: sessionIdParam,
      ...(modelOverrideParam && { modelOverride: modelOverrideParam }),
    });
    handleTokenUpdate(result.cap);
    return result;
  }, [apiCall, handleTokenUpdate]);

  const canvasRevise = useCallback(async (
    userIdParam: string, 
    sessionIdParam: string, 
    direction: string,
    modelOverrideParam?: string | null  // ✨ Multi-provider support
  ): Promise<ReviseResponse> => {
    const result = await apiCall<ReviseResponse>({
      event: 'canvas-revise',
      userId: userIdParam,
      sessionId: sessionIdParam,
      direction,
      ...(modelOverrideParam && { modelOverride: modelOverrideParam }),
    });
    handleTokenUpdate(result.cap);
    return result;
  }, [apiCall, handleTokenUpdate]);

  const canvasRetryRevise = useCallback(async (
    userIdParam: string, 
    sessionIdParam: string,
    modelOverrideParam?: string | null  // ✨ Multi-provider support
  ): Promise<ReviseResponse> => {
    const result = await apiCall<ReviseResponse>({
      event: 'canvas-retry-revise',
      userId: userIdParam,
      sessionId: sessionIdParam,
      ...(modelOverrideParam && { modelOverride: modelOverrideParam }),
    });
    handleTokenUpdate(result.cap);
    return result;
  }, [apiCall, handleTokenUpdate]);

  const canvasGetCards = useCallback(async (
    userIdParam: string, 
    storyIdParam: string, 
    segmentIdParam: string
  ): Promise<CardsResponse> => {
    return apiCall<CardsResponse>({
      event: 'canvas-cards-get',
      userId: userIdParam,
      storyId: storyIdParam,
      segmentId: segmentIdParam,
    });
  }, [apiCall]);

  const canvasSaveCard = useCallback(async (
    userIdParam: string,
    storyIdParam: string,
    segmentIdParam: string,
    card: Partial<CanvasCard>
  ): Promise<{ card: CanvasCard }> => {
    // Transform frontend 'id' to backend 'cardId'
    const apiCard = {
      ...card,
      cardId: card.id,
    };
    return apiCall<{ card: CanvasCard }>({
      event: 'canvas-cards-save',
      userId: userIdParam,
      storyId: storyIdParam,
      segmentId: segmentIdParam,
      card: apiCard,
    });
  }, [apiCall]);

  const canvasDeleteCard = useCallback(async (
    userIdParam: string,
    storyIdParam: string,
    segmentIdParam: string,
    cardId: string
  ): Promise<{ success: boolean }> => {
    return apiCall<{ success: boolean }>({
      event: 'canvas-cards-delete',
      userId: userIdParam,
      storyId: storyIdParam,
      segmentId: segmentIdParam,
      cardId,
    });
  }, [apiCall]);

  // ==========================================================================
  // History Management (for revert functionality)
  // ==========================================================================

  const pushToHistory = useCallback((content: string, appliedSuggestion?: string) => {
    setContentHistory((prev) => {
      const newEntry: HistoryEntry = {
        content,
        timestamp: new Date().toISOString(),
        appliedSuggestion,
      };
      
      // Add to history, keeping max length
      const newHistory = [newEntry, ...prev].slice(0, MAX_HISTORY_LENGTH);
      
      console.log('📜 Pushed to history:', {
        historyLength: newHistory.length,
        contentPreview: content.substring(0, 50) + '...',
      });
      
      return newHistory;
    });
  }, []);

  const revertLastChange = useCallback((onContentChange: (content: string) => void) => {
    if (contentHistory.length === 0) {
      console.log('⚠️ No history to revert to');
      return;
    }

    // Get the most recent history entry (the content BEFORE the last change)
    const previousEntry = contentHistory[0];
    
    console.log('⏪ Reverting to previous content:', {
      timestamp: previousEntry.timestamp,
      contentPreview: previousEntry.content.substring(0, 50) + '...',
    });

    // Apply the previous content
    onContentChange(previousEntry.content);

    // Remove the used history entry
    setContentHistory((prev) => prev.slice(1));

    // Clear any applied suggestion status
    setCards((prev) =>
      prev.map((card) =>
        card.status === 'applied' ? { ...card, status: 'active' as const } : card
      )
    );

    console.log('✅ Reverted successfully');
  }, [contentHistory]);
  
  // ==========================================================================
  // Load canvas state on mount
  // ==========================================================================
  
  useEffect(() => {
    const loadCanvas = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const localStorageKey = getLocalStorageKey(storyId, segmentId);
        const draftJson = localStorage.getItem(localStorageKey);
        
        // Try to load cards from API
        let savedCards: CanvasCard[] = [];
        try {
          const result = await canvasGetCards(userId, storyId, segmentId);
          // Transform API response: map cardId to id for frontend compatibility
          savedCards = (result.cards || []).map((card: any) => ({
            id: card.cardId || card.id,  // Use cardId from API, fallback to id
            type: card.type,
            content: card.content,
            position: card.position,
            linkedText: card.linkedText,
            status: card.status || 'active',
            createdAt: card.createdAt,
          }));
        } catch (err) {
          console.log('No saved cards found, starting fresh');
        }
        
        if (draftJson) {
          const draft = JSON.parse(draftJson);
          
          if (savedCards.length > 0) {
            const draftTime = new Date(draft.timestamp).getTime();
            const savedTime = savedCards.reduce((latest, card) => {
              const cardTime = new Date(card.createdAt).getTime();
              return cardTime > latest ? cardTime : latest;
            }, 0);
            
            if (draftTime > savedTime) {
              console.log('📝 Using local draft (newer than saved)');
              setCards(draft.cards);
              setIsDirty(true);
            } else {
              setCards(savedCards);
              localStorage.removeItem(localStorageKey);
            }
          } else {
            console.log('📝 Restoring local draft');
            setCards(draft.cards);
            setIsDirty(true);
          }
        } else if (savedCards.length > 0) {
          setCards(savedCards);
        } else {
          setCards([]);
        }
        
        initialLoadComplete.current = true;
      } catch (err) {
        console.error('Failed to load canvas:', err);
        setError('Failed to load canvas state');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadCanvas();
  }, [storyId, segmentId, userId, canvasGetCards]);

  // Clear history when segment changes
  useEffect(() => {
    setContentHistory([]);
  }, [storyId, segmentId]);
  
  // ==========================================================================
  // Save draft to localStorage on every change
  // ==========================================================================
  
  useEffect(() => {
    if (!initialLoadComplete.current) return;
    if (!isDirty) return;
    
    const localStorageKey = getLocalStorageKey(storyId, segmentId);
    const draft = {
      cards,
      timestamp: new Date().toISOString(),
    };
    
    localStorage.setItem(localStorageKey, JSON.stringify(draft));
    console.log('💾 Draft saved to localStorage');
  }, [cards, isDirty, storyId, segmentId]);
  
  // ==========================================================================
  // Card CRUD Operations
  // ==========================================================================
  
  const addCard = useCallback((input: NewCardInput) => {
    const newCard: CanvasCard = {
      id: generateId(),
      type: input.type,
      content: input.content,
      position: input.position,
      linkedText: input.linkedText || null,
      status: input.status || 'active',
      createdAt: new Date().toISOString(),
    };
    
    setCards((prev) => [...prev, newCard]);
    setIsDirty(true);
  }, []);
  
  const updateCard = useCallback((id: string, updates: Partial<CanvasCard>) => {
    setCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, ...updates } : card
      )
    );
    setIsDirty(true);
  }, []);
  
  const removeCard = useCallback(async (id: string) => {
    setCards((prev) => prev.filter((card) => card.id !== id));
    setIsDirty(true);
    
    // Also delete from backend
    try {
      await canvasDeleteCard(userId, storyId, segmentId, id);
      console.log('🗑️ Card deleted from backend:', id);
    } catch (err) {
      console.error('Failed to delete card from backend:', err);
      // Card is already removed from local state - don't re-add it
    }
  }, [userId, storyId, segmentId, canvasDeleteCard]);
  
  const moveCard = useCallback((id: string, position: Position) => {
    setCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, position } : card
      )
    );
    setIsDirty(true);
  }, []);
  
  // ==========================================================================
  // AI Suggestion Operations
  // ==========================================================================
  
  const requestSuggestions = useCallback(async (selectedText?: LinkedText, guidance?: string) => {
    if (isRequestingSuggestions) return;
    
    setIsRequestingSuggestions(true);
    setError(null);
    setCurrentSelection(selectedText || null);
    
    try {
      const noteContents = cards
        .filter((c) => c.type === 'note' && c.status === 'active')
        .map((c) => c.content);
      
      console.log('🎯 Requesting suggestions:', {
        userId,
        storyId,
        segmentType: getSegmentType(segmentId),
        hasSelection: !!selectedText,
        selectionLength: selectedText?.original?.length,
        noteCount: noteContents.length,
        hasGuidance: !!guidance,
        modelOverride
      });

      const result = await canvasSuggest({
        userId,
        storyId,
        segmentType: getSegmentType(segmentId),
        storyData,
        selection: selectedText?.original || segmentContent,
        selectionBounds: selectedText 
          ? { start: selectedText.start, end: selectedText.end }
          : null,
        notes: noteContents,
        guidance: guidance || null,
        modelOverride,  // ✨ Pass model override
      });
      
      setSessionId(result.sessionId);
      
      const suggestionCards: CanvasCard[] = result.suggestions.map((suggestion, index) => ({
        id: generateId(),
        type: 'suggestion' as const,
        content: JSON.stringify(suggestion),
        position: { x: window.innerWidth - 380, y: 200 + (index * 220) },
        linkedText: selectedText || null,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      }));
      
      setCards((prev) => [
        ...prev.filter((c) => c.type !== 'suggestion'),
        ...suggestionCards,
      ]);
      setIsDirty(true);
      
      console.log('✨ Received suggestions:', result.suggestions.length);
    } catch (err) {
      console.error('Failed to get suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to get AI suggestions');
    } finally {
      setIsRequestingSuggestions(false);
    }
  }, [userId, storyId, segmentId, storyData, segmentContent, cards, isRequestingSuggestions, canvasSuggest, modelOverride]);
  
  const regenerateSuggestions = useCallback(async () => {
    if (!sessionId || isRequestingSuggestions) return;
    
    setIsRequestingSuggestions(true);
    setError(null);
    
    try {
      console.log('🔄 Regenerating suggestions:', { userId, sessionId, modelOverride });

      const result = await canvasRegenerate(userId, sessionId, modelOverride);
      
      const suggestionCards: CanvasCard[] = result.suggestions.map((suggestion, index) => ({
        id: generateId(),
        type: 'suggestion' as const,
        content: JSON.stringify(suggestion),
        position: { x: window.innerWidth - 380, y: 200 + (index * 220) },
        linkedText: currentSelection,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      }));
      
      setCards((prev) => [
        ...prev.filter((c) => c.type !== 'suggestion'),
        ...suggestionCards,
      ]);
      setIsDirty(true);
      
      console.log('🔄 Regenerated suggestions:', result.suggestions.length);
    } catch (err) {
      console.error('Failed to regenerate suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate suggestions');
    } finally {
      setIsRequestingSuggestions(false);
    }
  }, [userId, sessionId, currentSelection, isRequestingSuggestions, canvasRegenerate, modelOverride]);
  
  const applySelectedSuggestions = useCallback(async (
    ids: string[],
    onContentChange: (content: string) => void
  ) => {
    if (!sessionId || ids.length === 0) return;
    
    // Find ALL selected suggestion cards
    const selectedCards = cards.filter((c) => ids.includes(c.id) && c.type === 'suggestion');
    if (selectedCards.length === 0) return;
    
    // Set applying state immediately - this triggers the pulsing outline
    setIsApplyingSuggestion(true);
    
    // Note: We no longer dismiss suggestion cards here - they stay visible
    // so user can switch to a different suggestion if they don't like the revision
    
    try {
      // Parse directions from all selected suggestions
      const directions: string[] = [];
      selectedCards.forEach((card) => {
        try {
          const parsed = JSON.parse(card.content);
          directions.push(parsed.direction || card.content);
        } catch {
          directions.push(card.content);
        }
      });
      
      // Combine multiple directions into one instruction
      let combinedDirection: string;
      if (directions.length === 1) {
        combinedDirection = directions[0];
      } else {
        combinedDirection = `Apply ALL of the following changes together:\n\n${directions.map((d, i) => `${i + 1}. ${d}`).join('\n\n')}`;
      }
      
      console.log('✏️ Requesting revision:', { 
        userId, 
        sessionId, 
        numSuggestions: selectedCards.length,
        directionLength: combinedDirection.length,
        modelOverride
      });

      const result = await canvasRevise(userId, sessionId, combinedDirection, modelOverride);
      
      // Set pending revision for user approval instead of immediately applying
      // Keep sessionId so we can chain "Try Again" requests
      setPendingRevision({
        replacement: result.replacement,
        selectionBounds: result.selectionBounds,
        direction: combinedDirection,
        sessionId,
        originalContent: segmentContent,  // Store original for preview/revert
        selectedSuggestionIds: selectedCards.map(c => c.id),  // Track all selected suggestions
      });
      
      // Don't remove suggestion cards - user might want to switch suggestions
      setIsDirty(true);
      
      console.log('📝 Pending revision ready for approval:', {
        replacementLength: result.replacement.length,
        hasSelectionBounds: !!result.selectionBounds,
        numSuggestionsApplied: selectedCards.length
      });
    } catch (err) {
      console.error('Failed to get revision:', err);
      setError(err instanceof Error ? err.message : 'Failed to get revision');
    } finally {
      setIsApplyingSuggestion(false);
    }
  }, [userId, sessionId, cards, segmentContent, canvasRevise, modelOverride]);
  
  // ==========================================================================
  // Pending Revision Approval Handlers
  // ==========================================================================
  
  const acceptRevision = useCallback((onContentChange: (content: string) => void) => {
    if (!pendingRevision) return;
    
    // Save original content to history before applying
    const directionLabel = pendingRevision.direction?.substring(0, 50) || '';
    pushToHistory(pendingRevision.originalContent, directionLabel);
    
    // Apply the revision to the original content
    let newContent: string;
    if (pendingRevision.selectionBounds) {
      newContent =
        pendingRevision.originalContent.substring(0, pendingRevision.selectionBounds.start) +
        pendingRevision.replacement +
        pendingRevision.originalContent.substring(pendingRevision.selectionBounds.end);
    } else {
      newContent = pendingRevision.replacement;
    }
    
    onContentChange(newContent);
    
    // Clear everything - pending revision, session, selection, AND suggestion cards
    setPendingRevision(null);
    setSessionId(null);
    setCurrentSelection(null);
    setCards((prev) => prev.filter((card) => card.type !== 'suggestion'));
    
    console.log('✅ Revision accepted and applied');
  }, [pendingRevision, pushToHistory]);
  
  const retryRevision = useCallback(async () => {
    // Get current pendingRevision from state at call time
    const currentPendingRevision = pendingRevision;
    if (!currentPendingRevision) {
      console.log('⚠️ No pending revision to retry');
      return;
    }
    
    setIsApplyingSuggestion(true);
    
    try {
      console.log('🔄 Retrying revision:', {
        sessionId: currentPendingRevision.sessionId,
        modelOverride
      });
      
      // Call retry-revise endpoint which chains the conversation with "Try Again"
      const result = await canvasRetryRevise(userId, currentPendingRevision.sessionId, modelOverride);
      
      console.log('📝 New revision received:', {
        replacementLength: result.replacement.length,
        replacement: result.replacement.substring(0, 100)
      });
      
      // Update pending revision with new replacement, keeping originalContent
      setPendingRevision({
        ...currentPendingRevision,
        replacement: result.replacement,
        selectionBounds: result.selectionBounds,
      });
      
      console.log('✅ Pending revision updated with new replacement');
    } catch (err) {
      console.error('❌ Failed to retry revision:', err);
      setError(err instanceof Error ? err.message : 'Failed to retry revision');
    } finally {
      setIsApplyingSuggestion(false);
    }
  }, [userId, pendingRevision, canvasRetryRevise, modelOverride]);
  
  const dismissRevision = useCallback(() => {
    // Only clear the pending revision - keep session and selection
    // so user can switch to a different suggestion
    setPendingRevision(null);
    console.log('❌ Revision dismissed - suggestions still available');
  }, []);
  
  // ==========================================================================
  // Direct Revision (Intern Flow) - User types guidance directly
  // ==========================================================================
  
  const generateDirectRevision = useCallback(async (
    guidance: string,
    targetText: LinkedText | null,
    onContentChange: (content: string) => void
  ) => {
    if (!guidance.trim()) {
      console.log('⚠️ No guidance provided for direct revision');
      return;
    }
    
    setIsApplyingSuggestion(true);
    setError(null);  // Clear any previous errors
    
    try {
      const segmentType = getSegmentType(segmentId);
      
      // Determine selection bounds based on targetText
      const selectionBounds = targetText 
        ? { start: targetText.start, end: targetText.end }
        : null;
      
      // The selection text (either highlighted text or full segment)
      const selectionText = targetText 
        ? targetText.original 
        : segmentContent;
      
      console.log('🎯 Generating direct revision:', {
        segmentType,
        hasTarget: !!targetText,
        guidanceLength: guidance.length,
        modelOverride
      });
      
      // Step 1: Create a session via canvas-suggest
      // We pass the guidance as the guidance param, and notes empty
      const suggestResult = await canvasSuggest({
        userId,
        storyId,
        segmentType,
        storyData,
        selection: selectionText,
        selectionBounds,
        notes: [],
        guidance,
        modelOverride,  // ✨ Pass model override
      });
      
      const newSessionId = suggestResult.sessionId;
      setSessionId(newSessionId);
      
      console.log('📋 Session created for direct revision:', { newSessionId });
      
      // Step 2: Immediately call canvas-revise with the guidance as direction
      const reviseResult = await canvasRevise(userId, newSessionId, guidance, modelOverride);
      
      // Step 3: Set pending revision for approval
      setPendingRevision({
        replacement: reviseResult.replacement,
        selectionBounds: reviseResult.selectionBounds || selectionBounds,
        direction: guidance,
        sessionId: newSessionId,
        originalContent: segmentContent,
        selectedSuggestionIds: [],  // No suggestion cards involved
      });
      
      setIsDirty(true);
      
      console.log('📝 Direct revision ready for approval:', {
        replacementLength: reviseResult.replacement.length,
        hasSelectionBounds: !!reviseResult.selectionBounds,
      });
    } catch (err) {
      console.error('Failed to generate direct revision:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate revision');
    } finally {
      setIsApplyingSuggestion(false);
    }
  }, [userId, storyId, segmentId, segmentContent, storyData, canvasSuggest, canvasRevise, modelOverride]);
  
  // ==========================================================================
  // Legacy suggestion operations (for compatibility)
  // ==========================================================================
  
  const applySuggestion = useCallback((id: string): string => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.type !== 'suggestion') {
      return segmentContent;
    }
    
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status: 'applied' as const } : c
      )
    );
    setIsDirty(true);
    
    return segmentContent;
  }, [cards, segmentContent]);
  
  const dismissSuggestion = useCallback((id: string) => {
    setCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, status: 'dismissed' as const } : card
      )
    );
    setIsDirty(true);
  }, []);
  
  // ==========================================================================
  // Persistence
  // ==========================================================================
  
  const saveCanvas = useCallback(async () => {
    if (isSaving) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      const noteCards = cards.filter((c) => c.type === 'note');
      
      for (const card of noteCards) {
        await canvasSaveCard(userId, storyId, segmentId, {
          id: card.id,
          type: card.type,
          content: card.content,
          position: card.position,
          linkedText: card.linkedText,
        });
      }
      
      const localStorageKey = getLocalStorageKey(storyId, segmentId);
      localStorage.removeItem(localStorageKey);
      
      setIsDirty(false);
      console.log('✅ Canvas saved successfully');
    } catch (err) {
      console.error('Failed to save canvas:', err);
      setError('Failed to save canvas');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [storyId, segmentId, userId, cards, isSaving, canvasSaveCard]);
  
  const clearCanvas = useCallback(() => {
    setCards([]);
    setSessionId(null);
    setCurrentSelection(null);
    setPendingRevision(null);
    setContentHistory([]);
    setIsDirty(true);
  }, []);
  
  // ==========================================================================
  // Return
  // ==========================================================================
  
  return {
    // State
    cards,
    isLoading,
    isSaving,
    isDirty,
    error,
    
    // Card CRUD
    addCard,
    updateCard,
    removeCard,
    moveCard,
    
    // Suggestions
    applySuggestion,
    dismissSuggestion,
    
    // Persistence
    saveCanvas,
    clearCanvas,
    
    // AI
    requestSuggestions,
    isRequestingSuggestions,
    
    // Extended AI operations
    sessionId,
    regenerateSuggestions,
    applySelectedSuggestions,
    
    // Revert functionality
    canRevert: contentHistory.length > 0,
    revertLastChange,
    historyLength: contentHistory.length,
    
    // Apply feedback state
    isApplyingSuggestion,
    
    // Pending revision approval
    pendingRevision,
    acceptRevision,
    retryRevision,
    dismissRevision,
    
    // Direct revision (intern flow)
    generateDirectRevision,
  };
}

export default useCanvasState;