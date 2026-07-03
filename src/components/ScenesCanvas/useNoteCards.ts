/**
 * useNoteCards
 * 
 * Hook for managing note card state within the ScenesCanvas.
 * Handles CRUD operations, position updates, and filtering by scope.
 * 
 * Phase 5: Now includes backend persistence via scene-canvas-operations Lambda.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  NoteCard,
  NoteCardScope,
  NoteCardColor,
  Position,
  NewNoteCardInput,
} from './types';

// =============================================================================
// API Configuration (matches useSceneCanvasAI)
// =============================================================================

const API_ENDPOINT = `${process.env.REACT_APP_URL}/scenes`;

// =============================================================================
// Types
// =============================================================================

interface UseNoteCardsReturn {
  // State
  noteCards: NoteCard[];
  isLoading: boolean;
  
  // CRUD operations
  addNoteCard: (input: NewNoteCardInput) => NoteCard;
  updateNoteCard: (cardId: string, updates: Partial<NoteCard>) => void;
  removeNoteCard: (cardId: string) => void;
  moveNoteCard: (cardId: string, position: Position) => void;
  
  // Filtering helpers
  getGlobalNotes: () => NoteCard[];
  getSegmentNotes: (segmentId: string) => NoteCard[];
  getSceneNotes: (sceneId: string) => NoteCard[];
  getNotesForDetailPanel: (sceneId: string, segmentId: string) => {
    globalNotes: NoteCard[];
    segmentNotes: NoteCard[];
    sceneNotes: NoteCard[];
  };
  
  // Canvas notes (excludes global - those go in right panel)
  getCanvasNotes: () => NoteCard[];
}

interface UseNoteCardsOptions {
  storyId: string;
  userId: string;
  token?: any;
  initialNotes?: NoteCard[];
}

// =============================================================================
// Helper: Generate UUID
// =============================================================================

const generateId = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// =============================================================================
// Hook
// =============================================================================

export const useNoteCards = ({
  storyId,
  userId,
  token,
  initialNotes = [],
}: UseNoteCardsOptions): UseNoteCardsReturn => {
  const [noteCards, setNoteCards] = useState<NoteCard[]>(initialNotes);
  const [isLoading, setIsLoading] = useState(false);
  
  // Track pending saves to debounce rapid updates
  const pendingSaves = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // ===========================================================================
  // API Call Helper (matches useSceneCanvasAI pattern)
  // ===========================================================================
  
  const apiCall = useCallback(async <T>(payload: object): Promise<T | null> => {
    try {
      const response = await axios.post(API_ENDPOINT, payload, {
        headers: { 
          "Authorization": token?.toString() || '',
          "Content-Type": "application/json"
        }
      });

      // Handle nested body structure
      if (response.data?.body) {
        if (typeof response.data.body === 'string') {
          return JSON.parse(response.data.body) as T;
        }
        return response.data.body as T;
      }
      return response.data as T;

    } catch (err: any) {
      console.error('❌ Notes API error:', err);
      return null;
    }
  }, [token]);
  
  // ===========================================================================
  // Load notes on mount
  // ===========================================================================
  
  useEffect(() => {
    const loadNotes = async () => {
      if (!storyId || !userId) return;
      
      setIsLoading(true);
      try {
        console.log('📝 Loading notes for story:', storyId);
        
        const result = await apiCall<{ notes: any[] }>({
          event: 'scene-notes-get',
          userId,
          storyId,
        });
        
        if (result?.notes && Array.isArray(result.notes)) {
          // Map backend noteId to frontend cardId for consistency
          const mappedNotes: NoteCard[] = result.notes.map((note: any) => ({
            cardId: note.noteId || note.cardId,
            storyId: note.storyId,
            scope: note.scope,
            segmentId: note.segmentId,
            sceneIds: note.sceneIds,
            position: note.position,
            title: note.title,
            content: note.content,
            color: note.color,
            status: note.status || 'active',
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }));
          
          console.log('✅ Loaded notes:', mappedNotes.length);
          setNoteCards(mappedNotes);
        }
      } catch (error) {
        console.error('Failed to load notes:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadNotes();
  }, [storyId, userId, apiCall]);
  
  // ===========================================================================
  // Persist note to backend (debounced)
  // ===========================================================================
  
  const persistNote = useCallback((note: NoteCard, immediate = false) => {
    // Clear any pending save for this note
    const existingTimeout = pendingSaves.current.get(note.cardId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    const doSave = async () => {
      try {
        console.log('💾 Saving note:', note.cardId);
        
        await apiCall({
          event: 'scene-note-save',
          userId,
          storyId,
          note: {
            noteId: note.cardId,
            scope: note.scope,
            segmentId: note.segmentId || null,
            sceneIds: note.sceneIds || null,
            position: note.position,
            title: note.title || null,
            content: note.content,
            color: note.color || null,
            status: note.status || 'active',
          },
        });
        
        console.log('✅ Note saved:', note.cardId);
      } catch (error) {
        console.error('Failed to save note:', error);
      } finally {
        pendingSaves.current.delete(note.cardId);
      }
    };
    
    if (immediate) {
      doSave();
    } else {
      // Debounce saves by 500ms to avoid hammering the API during rapid edits
      const timeout = setTimeout(doSave, 500);
      pendingSaves.current.set(note.cardId, timeout);
    }
  }, [userId, storyId, apiCall]);
  
  // ===========================================================================
  // Delete note from backend
  // ===========================================================================
  
  const deleteNote = useCallback(async (cardId: string) => {
    // Clear any pending save
    const existingTimeout = pendingSaves.current.get(cardId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingSaves.current.delete(cardId);
    }
    
    try {
      console.log('🗑️ Deleting note:', cardId);
      
      await apiCall({
        event: 'scene-note-delete',
        userId,
        storyId,
        noteId: cardId,
      });
      
      console.log('✅ Note deleted:', cardId);
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  }, [userId, storyId, apiCall]);
  
  // ===========================================================================
  // CRUD Operations
  // ===========================================================================
  
  const addNoteCard = useCallback((input: NewNoteCardInput): NoteCard => {
    const now = new Date().toISOString();
    
    const newCard: NoteCard = {
      cardId: generateId(),
      storyId,
      scope: input.scope,
      segmentId: input.segmentId,
      sceneIds: input.sceneIds,
      position: input.position,
      title: input.title,
      content: input.content || '',
      color: input.color || 'purple',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    
    setNoteCards(prev => [...prev, newCard]);
    
    // Persist immediately for new notes
    persistNote(newCard, true);
    
    return newCard;
  }, [storyId, persistNote]);
  
  const updateNoteCard = useCallback((cardId: string, updates: Partial<NoteCard>) => {
    setNoteCards(prev => {
      const updated = prev.map(card => {
        if (card.cardId !== cardId) return card;
        
        const updatedCard = {
          ...card,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        
        // Persist with debounce
        persistNote(updatedCard);
        
        return updatedCard;
      });
      return updated;
    });
  }, [persistNote]);
  
  const removeNoteCard = useCallback((cardId: string) => {
    setNoteCards(prev => prev.filter(card => card.cardId !== cardId));
    
    // Delete from backend
    deleteNote(cardId);
  }, [deleteNote]);
  
  const moveNoteCard = useCallback((cardId: string, position: Position) => {
    setNoteCards(prev => {
      const updated = prev.map(card => {
        if (card.cardId !== cardId) return card;
        
        const updatedCard = {
          ...card,
          position,
          updatedAt: new Date().toISOString(),
        };
        
        // Persist with debounce (moves happen rapidly during drag)
        persistNote(updatedCard);
        
        return updatedCard;
      });
      return updated;
    });
  }, [persistNote]);
  
  // ===========================================================================
  // Filtering
  // ===========================================================================
  
  const getGlobalNotes = useCallback((): NoteCard[] => {
    return noteCards.filter(card => 
      card.scope === 'global' && card.status === 'active'
    );
  }, [noteCards]);
  
  const getSegmentNotes = useCallback((segmentId: string): NoteCard[] => {
    return noteCards.filter(card => 
      card.scope === 'segment' && 
      card.segmentId === segmentId && 
      card.status === 'active'
    );
  }, [noteCards]);
  
  const getSceneNotes = useCallback((sceneId: string): NoteCard[] => {
    return noteCards.filter(card => 
      card.scope === 'scene' && 
      card.sceneIds?.includes(sceneId) && 
      card.status === 'active'
    );
  }, [noteCards]);
  
  const getNotesForDetailPanel = useCallback((sceneId: string, segmentId: string) => {
    return {
      globalNotes: getGlobalNotes(),
      segmentNotes: getSegmentNotes(segmentId),
      sceneNotes: getSceneNotes(sceneId),
    };
  }, [getGlobalNotes, getSegmentNotes, getSceneNotes]);
  
  const getCanvasNotes = useCallback((): NoteCard[] => {
    // Canvas shows segment and scene-scoped notes only
    // Global notes live in the right panel
    return noteCards.filter(card => 
      card.scope !== 'global' && card.status === 'active'
    );
  }, [noteCards]);
  
  // ===========================================================================
  // Cleanup pending saves on unmount
  // ===========================================================================
  
  useEffect(() => {
    return () => {
      pendingSaves.current.forEach(timeout => clearTimeout(timeout));
      pendingSaves.current.clear();
    };
  }, []);
  
  // ===========================================================================
  // Return
  // ===========================================================================
  
  return {
    noteCards,
    isLoading,
    addNoteCard,
    updateNoteCard,
    removeNoteCard,
    moveNoteCard,
    getGlobalNotes,
    getSegmentNotes,
    getSceneNotes,
    getNotesForDetailPanel,
    getCanvasNotes,
  };
};

export default useNoteCards;