/**
 * HOME.TSX - Main Story Writing Interface Component
 * 
 * This is the core component for the story writing application. It manages:
 * - Story data state (title, storyId, all story segments)
 * - AI-powered story generation (foundation extraction, synopsis, segments)
 * - Character management with WebSocket real-time updates
 * - Save/load functionality with DynamoDB persistence
 * - "Intern" mode for iterative AI improvements
 * - Freeform brainstorming workflow
 * 
 * ARCHITECTURE OVERVIEW:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ HOME COMPONENT                                               │
 * ├─────────────────────────────────────────────────────────────┤
 * │ State Management:                                            │
 * │  - Local: UI state, loading states, expansion states        │
 * │  - Context (App.tsx): Story data, user data, characters     │
 * │  - Cache: Browser cache for quick restore                   │
 * │  - Database: DynamoDB for persistence                       │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Data Flow:                                                   │
 * │  User Input → State Update → Cache Update → Debounced Save →│
 * │  → DynamoDB (via works Lambda)                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │ AI Generation Flow:                                          │
 * │  1. User fills context/brainstorm                           │
 * │  2. Clicks generate button                                  │
 * │  3. Lambda processes with OpenAI                            │
 * │  4. Response updates state immediately                      │
 * │  5. CRITICAL: useProvidedData=true for immediate save       │
 * │     (prevents stale state issues)                           │
 * └─────────────────────────────────────────────────────────────┘
 */

import React, { useState, useContext, useRef, useEffect, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "react-query";
import { Theme, Flex, Text, Button, Grid, Box, Container, Dialog, TextField, Tooltip } from '@radix-ui/themes';
import axios from 'axios';
import { UserContext } from '../../App';
import { TailSpin } from 'react-loading-icons';
import { toast, Toaster } from 'react-hot-toast';
import { throttle, debounce as lodashDebounce } from 'lodash';
import { Amplify } from 'aws-amplify';
import Header from '../../components/header';
import Footer from '../../components/footer';
import { useScrollBehavior } from '../../components/useScrollBehavior';
import FreeformBrainstorming from '../../components/Home/FreeformBrainstorming';
import StackedActionButtons from '../../components/Home/StackedActionButtons';
import StoryNavigation from '../../components/Home/StoryNavigation';
import { CanvasOverlay } from '../../components/canvas'
  ;

import { useAIModel } from '../../components/AIModelContext';
import { ErrorModal } from "../../components/ui/ErrorModal";


import "../../styles/home.css"

import config from '../../aws-exports';

// Import our new components
import StoryFoundation from '../../components/Home/StoryFoundation';
import StoryContext from '../../components/Home/StoryContext';
import StorySummary from '../../components/Home/StorySummary';
import StoryAct from '../../components/Home/StoryAct';
import StoryActions from "../../components/Home/StoryActions";
import OutlineGenerationOverlay from '../../components/Home/OutlineGenerationOverlay';
import { useOutlinePlan, type OutlineEstimate  } from '../../components/Home/useOutlinePlan';


// Import WebSocket hook for real-time character updates
import { useWebSocket } from '../../lib/useWebSocket';
import { CheckCircle, LifeBuoy, Loader, Loader2, Menu } from "lucide-react";
import NewStoryModal from "../../components/Home/NewStoryModal";
import StoryNavigationSidebar from "../../components/Home/StoryNavigationTab";
import StoryBreadcrumbHeader from "../../components/Home/StoryBreadcrumbHeader";

/**
 * TYPE DEFINITIONS
 * These interfaces define the shape of data throughout the component
 */

interface HomeProps {
  attributes?: any;
  user?: any;
  setUser?: any;
  signOut?: any;
  token?: any;
  loading?: boolean;
  data?: any;
  setData?: any;
  debouncedSave?: any;
  zeroLength?: any;
  characters?: any[];
  addCharacter?: any;
  updateCharacter?: any;
  deleteCharacter?: any;
}

interface SegmentState {
  [key: string]: boolean;
}

interface CustomLabels {
  [key: string]: string;
}

/**
 * StoryData Interface
 * Represents the complete story structure
 * 
 * IMPORTANT: Fields can be either:
 * - string: Simple text content
 * - object: { S: string, scenes: any } for segments with scene breakdowns
 * 
 * This dual format supports both legacy simple strings and new scene-based structure
 */
interface StoryData {
  title?: string;
  storyId?: string;
  M?: string | { S: string; scenes: any };
  T?: string | { S: string; scenes: any };
  G?: string | { S: string; scenes: any };
  CQ?: string | { S: string; scenes: any };
  SUM?: string | { S: string; scenes: any };
  S1?: string | { S: string; scenes: any };
  S2?: string | { S: string; scenes: any };
  S3?: string | { S: string; scenes: any };
  S4?: string | { S: string; scenes: any };
  S5?: string | { S: string; scenes: any };
  S6?: string | { S: string; scenes: any };
  S7?: string | { S: string; scenes: any };
  S8?: string | { S: string; scenes: any };
  S9?: string | { S: string; scenes: any };
}

interface CharacterUpdateData {
  characters: any[];
  storyId: string;
  analysisComplete: boolean;
  timestamp?: string;
}

interface Character {
  name: string;
  locked?: boolean;
  importance?: string;
  description?: string;
  arc?: any;
  [key: string]: any;
}

Amplify.configure(config);

/**
 * Custom debounce function
 * Creates a debounced version of a function that delays execution
 * Used for throttling user input to prevent excessive saves
 */
const debounce = (func: (...args: any[]) => void, wait: number) => {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export function Home(props: HomeProps) {
  /**
   * CONTEXT EXTRACTION
   * Pull data and functions from App.tsx UserContext
   * This provides global state shared across the app
   */
  const {
    attributes,
    user,
    setUser,
    signOut,
    token,
    loading,
    data,
    setData,
    debouncedSave,
    zeroLength,
    characters: contextCharacters,
    addCharacter: contextAddCharacter,
    updateCharacter: contextUpdateCharacter,
    deleteCharacter: contextDeleteCharacter,
    saveCharacters: contextSaveCharacters,
    setCharacters: contextSetCharacters,
    setCharacterDatabase: contextSetCharacterDatabase,
    characterDatabaseEnabled,
    isWebSocketUpdating,
    setIsWebSocketUpdating,
    isCharactersLoading,
    setIsCharactersLoading
  } = useContext(UserContext);


  /**
   * WEBSOCKET INTEGRATION
   * Provides real-time character updates from backend processing
   * When story is generated, characters are analyzed asynchronously
   * WebSocket pushes updates when analysis completes
   */
  const { isConnected, lastUpdate, error: wsError } = useWebSocket(
    user?.id || token?.payload['cognito:username'],
    data?.storyId
  );

  // Alternative: Disable WebSocket temporarily for testing
  // const [isConnected, setIsConnected] = useState(false);
  // const [lastUpdate, setLastUpdate] = useState<CharacterUpdateData | null>(null);
  // const [wsError, setWsError] = useState<string | null>('WebSocket infrastructure not deployed yet');

  /**
   * STATE MANAGEMENT
   * Local component state for UI controls and temporary data
   * Organized by category for clarity
   */

  // Story and API state
  const [title, setTitle] = useState("");
  const [apiError, setApiError] = useState(null);
  const [model, setModel] = useState("base");

  // Save/loading indicators
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { getModelForAPI } = useAIModel();

  const formatTime = (date: Date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isSaving) {
        e.preventDefault();
        handleDebouncedSave(data, true);
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSaving]);

  // Character update notifications
  const [showCharacterUpdate, setShowCharacterUpdate] = useState(false);
  const [isProcessingCharacters, setIsProcessingCharacters] = useState(false);

  // UI state
  const isScrolled = useScrollBehavior();
  const [internPanelOpen, setInternPanelOpen] = useState(false);
  const [internPanelWidth, setInternPanelWidth] = useState(380);
  const [forceInternPanelOpen, setForceInternPanelOpen] = useState(false);
  const [showTutorialHint, setShowTutorialHint] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [openNewStory, setOpenNewStory] = useState(false);
  const [canvasSegment, setCanvasSegment] = useState<string | null>(null);
  const SEGMENT_ORDER = ['SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [activePlanSnapshot, setActivePlanSnapshot] =
  useState<ReturnType<typeof useOutlinePlan> | null>(null);

// Live-computed plan — only used at dispatch time to take a snapshot.
const currentOutlinePlan = useOutlinePlan(data);
  // const [isStoryFoundationComplete, setIsStoryFoundationComplete] = useState(false);
  // const [isSynopsisComplete, setIsSynopsisComplete] = useState(false);
// Helper: safely read field content whether it's a string or { S: string } object.
// Inlined here because getFieldContent is defined later in the component;
// this matches the same pattern hasSegmentContent already uses.
const readField = (fieldName: string): string => {
  const fieldData = data[fieldName];
  if (!fieldData) return '';
  if (typeof fieldData === 'string') return fieldData;
  if (typeof fieldData === 'object' && fieldData.S) return fieldData.S;
  return '';
};

const isStoryFoundationComplete =
  ['G', 'T', 'M', 'CQ'].every(field => readField(field).trim() !== '');

const isSynopsisComplete = readField('SUM').trim() !== '';

const isActsReady = isStoryFoundationComplete && isSynopsisComplete;

const hasSegmentContent = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']
  .some(field => readField(field).trim() !== '');

const segmentsAllPopulated = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']
  .every(field => readField(field).trim() !== '');

// Orchestrator gate: any single populated input is enough to generate.
// This matches the backend's "hasAnyInput" check in buildGenerationPlan.
const hasBrainstorm = readField('BRAINSTORM').trim() !== '';

const hasAnyMetadata = ['G', 'T', 'M', 'CQ']
  .some(field => readField(field).trim() !== '');

const canGenerate =
  hasBrainstorm ||
  hasAnyMetadata ||
  isSynopsisComplete ||
  hasSegmentContent;


  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) setHidden(true);
      else setHidden(false);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const hasSeenHint = localStorage.getItem("hasSeenTutorialHint");

    if (!hasSeenHint) {
      setShowTutorialHint(true);
      localStorage.setItem("hasSeenTutorialHint", "true");
    }
  }, []);

  const handleCloseHint = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShowTutorialHint(false);
      setIsClosing(false);
    }, 250);
  };

// Field-specific loading states (for individual generate buttons)
const [fieldLoadingStates, setFieldLoadingStates] = useState<{ [key: string]: boolean }>({});

/**
 * BRAINSTORM WORKFLOW STATE
 * Tracks the brainstorm-to-synopsis mutation (preview or full outline).
 * Hoisted above isAnyFieldGenerating so the useMemo can reference it.
 */
const [isProcessingBrainstorm, setIsProcessingBrainstorm] = useState(false);

// FIL-332 / FIL-334: One-at-a-time generation policy. True whenever ANY
// generation is in flight — either an individual field (fieldLoadingStates)
// or the brainstorm-to-synopsis mutation (isProcessingBrainstorm). Passed
// down to child components so their generate buttons disable across the
// board, preventing stacked concurrent generations that would race on
// the same backend endpoints and clobber each other's writes.
//
// Note: this does NOT reflect the full-story mutation (mutateStory). That
// case is handled by OutlineGenerationOverlay covering the whole form.
const isAnyFieldGenerating = useMemo(
  () => isProcessingBrainstorm || Object.values(fieldLoadingStates).some(v => v === true),
  [isProcessingBrainstorm, fieldLoadingStates]
);
// Brainstorm-to-synopsis overlay estimate. Separate from activePlanSnapshot
// because the brainstorm backend is an unconditional overwrite — useOutlinePlan
// (which derives from field emptiness) would mislabel phases for this flow.
// Hand-built literal captured in handleProcessBrainstorm based on mode.
const [brainstormEstimate, setBrainstormEstimate] =
  useState<OutlineEstimate | null>(null);

  // WebSocket message deduplication
  const [lastProcessedMessageId, setLastProcessedMessageId] = useState<string | null>(null);

  /**
   * BRAINSTORM WORKFLOW STATE
   * New multi-step workflow for story creation:
   * 1. User writes free-form brainstorm
   * 2. Click "Process into Structure"
   * 3. Foundation extracted (logline + metadata)
   * 4. User reviews/edits logline in modal
   * 5. Click "Continue to Synopsis"
   * 6. Synopsis generated and saved to SUM field
   */


  /**
   * CHARACTER MANAGEMENT STATE
   * Supports both context-based (global) and local character state
   * Provides fallback if context is not available
   */
  const [localCharacters, setLocalCharacters] = useState<any[]>([]);
  const effectiveCharacters = contextCharacters || localCharacters;

  const effectiveAddCharacter = contextAddCharacter || ((character: any) => {
    setLocalCharacters((prev: any[]) => [...prev, character]);
  });

  const effectiveUpdateCharacter = contextUpdateCharacter || ((updatedCharacter: any) => {
    setLocalCharacters((prev: any[]) =>
      prev.map(char => char.id === updatedCharacter.id ? updatedCharacter : char)
    );
  });

  const effectiveDeleteCharacter = contextDeleteCharacter || ((characterId: string) => {
    setLocalCharacters((prev: any[]) => prev.filter(char => char.id !== characterId));
  });

  const effectiveSaveCharacters = contextSaveCharacters || ((characters: any[]) => {
    console.log('Local character save fallback:', characters);
    setLocalCharacters(characters);
    return Promise.resolve();
  });

  /**
   * WEBSOCKET CHARACTER UPDATE HANDLER
   * Processes real-time character updates from backend
   * 
   * CRITICAL FEATURES:
   * - Deduplication: Prevents processing same update twice
   * - Lock protection: Preserves user-locked characters
   * - Batch operations: Uses direct state setters to avoid individual function calls
   * - Immediate save: Forces database save after update
   */
  useEffect(() => {
    if (lastUpdate && lastUpdate.analysisComplete && !isProcessingCharacters) {
      console.log('📡 WebSocket lastUpdate changed, triggering character update:', {
        hasCharacters: !!lastUpdate.characters,
        characterCount: lastUpdate.characters?.length,
        timestamp: lastUpdate.timestamp,
        storyId: lastUpdate.storyId
      });

      handleCharacterUpdate(lastUpdate.characters);
    }
  }, [lastUpdate]);

  const clearProcessedMessages = useCallback(() => {
    console.log('🧹 Clearing processed message history');
    setLastProcessedMessageId(null);
  }, []);

  // Clear processed messages when story changes
  useEffect(() => {
    if (data?.storyId) {
      console.log('📖 Story ID changed, clearing processed message history');
      setLastProcessedMessageId(null);
    }
  }, [data?.storyId]);


  /**
   * handleCharacterUpdate
   * Processes character updates from WebSocket
   * 
   * IMPORTANT PATTERN: This function avoids calling individual add/update/delete
   * functions because those would trigger individual saves. Instead, it:
   * 1. Merges characters in memory
   * 2. Updates state directly with setCharacters
   * 3. Calls saveCharacters ONCE with the complete merged array
   * 
   * This prevents the "save loop" issue where each character triggers a save
   */
  const handleCharacterUpdate = async (newCharacters: Character[]) => {
    // Create unique ID based on content, not timestamp
    const contentId = `${data.storyId}_${newCharacters.length}_${newCharacters.map(c => c.name).sort().join('_')}`;

    // Deduplication check
    if (lastProcessedMessageId === contentId) {
      console.log('🚫 Duplicate WebSocket message detected, skipping:', contentId);
      return;
    }

    // Prevent concurrent updates
    if (isWebSocketUpdating) {
      console.log('🚫 Character update already in progress, skipping');
      return;
    }

    setLastProcessedMessageId(contentId);
    setIsWebSocketUpdating(true);
    setIsProcessingCharacters(true);

    try {
      console.log('🎭 Processing NEW character update via WebSocket:', {
        contentId,
        newCharacterCount: newCharacters.length,
        newCharacterNames: newCharacters.map(c => c.name),
        existingCharacterCount: effectiveCharacters.length,
        existingCharacterNames: effectiveCharacters.map((c: Character) => c.name)
      });

      // Merge with lock protection (returns new array, doesn't call functions)
      const mergedCharacters = mergeCharactersWithLocks(effectiveCharacters, newCharacters);

      console.log('🔄 Character merge completed:', {
        totalCharacters: mergedCharacters.length,
        lockedCharacters: mergedCharacters.filter(c => c.locked).length,
        newCharacters: mergedCharacters.filter(c => c.is_new).length
      });

      /**
       * BATCH UPDATE PATTERN
       * Use direct state setters instead of individual function calls
       * This is critical for preventing save loops
       */
      if (contextCharacters && contextSetCharacters) {
        console.log('📝 Using context setters for batch update');

        // Direct state updates - NO individual add/update/delete calls
        contextSetCharacters(mergedCharacters);

        // Update character database
        const newCharacterDatabase = mergedCharacters.reduce((acc, char) => {
          acc[char.name] = char;
          return acc;
        }, {} as any);
        contextSetCharacterDatabase(newCharacterDatabase);

        // CRITICAL: Also update data.characters to keep in sync
        setData((prevData: any) => ({
          ...prevData,
          characters: newCharacterDatabase
        }));

        console.log('📊 Synced character database to data.characters after WebSocket update');

      } else {
        console.log('📝 Using local state for batch update');
        setLocalCharacters(mergedCharacters);

        // Still update data.characters for local state scenario
        const newCharacterDatabase = mergedCharacters.reduce((acc, char) => {
          acc[char.name] = char;
          return acc;
        }, {} as any);

        setData((prevData: any) => ({
          ...prevData,
          characters: newCharacterDatabase
        }));
      }

      // SINGLE SAVE: One save operation only
      console.log('💾 Saving characters to database immediately');
      await contextSaveCharacters(mergedCharacters);

      // Show success notification
      setShowCharacterUpdate(true);
      setTimeout(() => setShowCharacterUpdate(false), 3000);

      console.log('✅ Character update processed successfully via WebSocket');

    } catch (error) {
      console.error('💥 Failed to process character update:', error);
      toast.error('Failed to update characters');
      // Reset on error for retry
      setLastProcessedMessageId(null);
    } finally {
      setIsProcessingCharacters(false);
      setIsWebSocketUpdating(false);

      // Clear the refresh loading state (for manual refresh via CharacterPanel)
      if (setIsCharactersLoading) {
        setIsCharactersLoading(false);
      }
    }
  };

  /**
   * mergeCharactersWithLocks
   * Merges incoming characters with existing ones, respecting lock status
   * 
   * LOCK PROTECTION RULES:
   * - Locked characters: Keep existing data completely unchanged
   * - Unlocked existing: Update with new data from AI
   * - New characters: Add with unlocked status
   * - Missing locked: Preserve (don't delete locked characters)
   * 
   * IMPORTANT: This function only returns a merged array - it does NOT
   * call any add/update/delete functions. This prevents save loops.
   */
  const mergeCharactersWithLocks = (existing: Character[], incoming: Character[]): Character[] => {
    console.log('🔀 Starting character merge:', {
      existingCount: existing.length,
      incomingCount: incoming.length
    });

    // Create map for O(1) lookup
    const existingMap = new Map<string, Character>(
      existing.map((char: Character) => [char.name, char])
    );

    console.log('🗂️ Existing characters map:', {
      names: Array.from(existingMap.keys()),
      lockedCount: existing.filter(c => c.locked).length
    });

    // Process incoming characters
    const merged: Character[] = incoming.map((incomingChar: Character) => {
      const existingChar = existingMap.get(incomingChar.name);

      if (existingChar?.locked) {
        // LOCKED: Keep existing character completely unchanged
        console.log(`🔒 Preserving locked character: ${existingChar.name}`);
        return {
          ...existingChar,
          is_new: false
        };
      } else if (existingChar) {
        // UNLOCKED EXISTING: Update with new data
        console.log(`🔓 Updating unlocked character: ${existingChar.name}`);
        return {
          ...existingChar,
          ...incomingChar,
          locked: existingChar.locked || false,
          is_new: false
        };
      } else {
        // NEW CHARACTER: Add with unlocked status
        console.log(`✨ Adding new character: ${incomingChar.name}`);
        return {
          ...incomingChar,
          locked: false,
          is_new: true
        };
      }
    });

    // Preserve locked characters not in update
    existing.forEach((char: Character) => {
      if (char.locked && !merged.find((m: Character) => m.name === char.name)) {
        console.log(`🔐 Preserving locked character not in update: ${char.name}`);
        merged.push({
          ...char,
          is_new: false
        });
      }
    });

    console.log('🔀 Character merge completed:', {
      totalMerged: merged.length,
      lockedPreserved: merged.filter(c => c.locked).length,
      newCharacters: merged.filter(c => c.is_new).length,
      updatedCharacters: merged.filter(c => !c.is_new && !c.locked).length
    });

    // CRITICAL: Just return the array - NO function calls!
    return merged;
  };

  /**
   * INTERN SELECTION MODE STATE
   * "Intern" is an AI assistant that can iterate on selected fields
   * Users select fields, then intern analyzes and improves them
   */
  const [isInternSelectionMode, setIsInternSelectionMode] = useState(false);
  const [internSelectedFields, setInternSelectedFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (internPanelOpen) {
      setSidebarCollapsed(true);
    }
  }, [internPanelOpen]);

  /**
   * ACT EXPANSION STATE
   * Controls whether each act's segments are expanded or collapsed
   */
  const [actIExpanded, setActIExpanded] = useState(false);
  const [actIIExpanded, setActIIExpanded] = useState(false);
  const [actIIIExpanded, setActIIIExpanded] = useState(false);

  /**
   * SEGMENT STATE
   * Controls expansion and hover states for individual story segments (S1-S9)
   */
  const [segmentExpanded, setSegmentExpanded] = useState<SegmentState>({
    S1: false, S2: false, S3: false,
    S4: false, S5: false, S6: false,
    S7: false, S8: false, S9: false
  });

  const [segmentHovered, setSegmentHovered] = useState<SegmentState>({
    S1: false, S2: false, S3: false,
    S4: false, S5: false, S6: false,
    S7: false, S8: false, S9: false
  });

  /**
   * SCROLL AND LAYOUT STATE
   * Manages floating elements and responsive layout
   */
  const [hasScrolled, setHasScrolled] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [maxScrollPosition, setMaxScrollPosition] = useState(0);
  const [wrapperTopPosition, setWrapperTopPosition] = useState(0);
  const [wrapperWidth, setWrapperWidth] = useState(0);
  const [drawerExpanded, setDrawerExpanded] = useState(false);

  const mainContentRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /**
   * DEBOUNCED DATABASE SAVE REF
   * Stores the debounced save function to prevent recreation
   * This is important for the throttle-prevention pattern
   */
  const debouncedDatabaseSaveRef = useRef<any>(null);

  /**
   * CUSTOM LABELS
   * User-friendly names for story segments
   * Based on Save the Cat beat sheet structure
   */
  const [customLabels, setCustomLabels] = useState<CustomLabels>({
    SUM: 'Story Preview',
    S1: 'Introduction and Stasis',
    S2: 'Inciting Incident',
    S3: 'Commitment',
    S4: 'First Pinch Point',
    S5: 'Midpoint',
    S6: 'Second Pinch Point',
    S7: 'Second Plot Point',
    S8: 'Climax',
    S9: 'Resolution'
  });

  /**
   * SEGMENT TOOLTIPS
   * Educational descriptions of each story beat
   */
  const segmentTooltips = {
    "S1": "The opening scene or sequence that establishes the protagonist's everyday life, grounding the story before any major conflict arises.",
    "S2": "The event that disrupts the protagonist's life, setting the story's main conflict in motion and drawing the protagonist into action.",
    "S3": "A pivotal moment where the protagonist makes a decision or takes an action that commits them to the story's central journey, closing off the option to return to their former life.",
    "S4": "A pressure point that intensifies the conflict, often by revealing new information or escalating tension, reminding the protagonist of the stakes involved.",
    "S5": "A major turning point where the protagonist experiences a significant realization, shift in perspective, or confrontation that deepens their commitment to the goal or conflict.",
    "S6": "A critical challenge or obstacle that raises the stakes even higher, often bringing the protagonist to a low point or forcing them to confront their fears.",
    "S7": "The story's darkest moment, where all seems lost for the protagonist, intensifying the drama before the final push toward resolution.",
    "S8": "The peak of the story's action, where the main conflict reaches its most intense point and the protagonist faces their greatest challenge or decision.",
    "S9": "The story's conclusion, showing the outcome of the protagonist's journey and resolving any lingering questions or themes."
  };

  /**
   * ACT CONFIGURATIONS
   * Defines the three-act structure with associated segments
   * Maps segments (S1-S9) to acts (I, II, III)
   */
  const acts = [
    {
      id: "act-1",
      number: 1,
      title: "Act I",
      subtitle: "Establishing the world and characters",
      segments: [
        { id: 'S1', number: 1, title: 'Introduction and Stasis', tooltip: segmentTooltips.S1 },
        { id: 'S2', number: 2, title: 'Inciting Incident', tooltip: segmentTooltips.S2 },
        { id: 'S3', number: 3, title: 'Commitment', tooltip: segmentTooltips.S3 }
      ],
      isExpanded: actIExpanded,
      setExpanded: setActIExpanded
    },
    {
      id: "act-2",
      number: 2,
      title: "Act II",
      subtitle: "Rising action and complications",
      segments: [
        { id: 'S4', number: 4, title: 'First Pinch Point', tooltip: segmentTooltips.S4 },
        { id: 'S5', number: 5, title: 'Midpoint', tooltip: segmentTooltips.S5 },
        { id: 'S6', number: 6, title: 'Second Pinch Point', tooltip: segmentTooltips.S6 }
      ],
      isExpanded: actIIExpanded,
      setExpanded: setActIIExpanded
    },
    {
      id: "act-3",
      number: 3,
      title: "Act III",
      subtitle: "Climax and conclusion",
      segments: [
        { id: 'S7', number: 7, title: 'Second Plot Point', tooltip: segmentTooltips.S7 },
        { id: 'S8', number: 8, title: 'Climax', tooltip: segmentTooltips.S8 },
        { id: 'S9', number: 9, title: 'Resolution', tooltip: segmentTooltips.S9 }
      ],
      isExpanded: actIIIExpanded,
      setExpanded: setActIIIExpanded
    }
  ];

  /**
   * EFFECTS SECTION
   * Side effects for layout, scroll handling, and UI updates
   */

  // Update wrapper position for floating elements
  useEffect(() => {
    const updateWrapperPosition = () => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setWrapperTopPosition(rect.top + window.scrollY);
      }
    };

    updateWrapperPosition();
    window.addEventListener('resize', updateWrapperPosition);
    return () => window.removeEventListener('resize', updateWrapperPosition);
  }, []);

  // Throttled scroll handler for performance
  const handleScroll = useCallback(
    throttle(() => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const newScrollPosition = Math.max(0, window.scrollY - rect.top);
        setHasScrolled(window.scrollY > rect.top);
        setScrollPosition(newScrollPosition);
      }
    }, 100),
    []
  );

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Enhanced scroll handler with max position calculation
  useEffect(() => {
    const handleScroll = () => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const newScrollPosition = Math.max(0, window.scrollY - rect.top);
        setHasScrolled(window.scrollY > rect.top);
        setScrollPosition(newScrollPosition);

        const parentHeight = wrapperRef.current.clientHeight;
        const floatingBoxHeight = 200;
        const bufferHeight = parentHeight * 0.15;
        const newMaxScrollPosition = parentHeight - floatingBoxHeight - bufferHeight;
        setMaxScrollPosition(newMaxScrollPosition);
      }
    };

    const updateWrapperDimensions = () => {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setWrapperWidth(rect.width);
      }
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', updateWrapperDimensions);

    updateWrapperDimensions();
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateWrapperDimensions);
    };
  }, []);

  // Handle forced panel opening
  useEffect(() => {
    if (forceInternPanelOpen) {
      setInternPanelOpen(true);
      setTimeout(() => {
        setForceInternPanelOpen(false);
      }, 200);
    }
  }, [forceInternPanelOpen]);

  // Clear selected fields when intern mode is turned off
  useEffect(() => {
    console.log(`🔧 useEffect: isInternSelectionMode changed to:`, isInternSelectionMode);
    if (!isInternSelectionMode) {
      console.log(`🔧 useEffect: Clearing intern selected fields`);
      setInternSelectedFields(new Set());
    }
  }, [isInternSelectionMode]);


  /**
   * getFieldContent
   * Helper function to extract content from fields
   * 
   * IMPORTANT: Supports both formats:
   * - string: "content" (simple format)
   * - object: { S: "content", scenes: {} } (structured format)
   * 
   * Can optionally accept a data source for explicit data passing
   * This is critical for the save architecture - when we have fresh data
   * from an API response, we pass it explicitly instead of reading from state
   */
  const getFieldContent = (field: string, dataSource?: any): string => {
    const source = dataSource || data;
    const fieldData = source[field];

    if (!fieldData) return '';

    if (typeof fieldData === 'string') {
      return fieldData;
    } else if (typeof fieldData === 'object' && 'S' in fieldData && typeof fieldData.S === 'string') {
      return fieldData.S;
    }

    return '';
  };

  // Check for unsaved changes (simple check based on save indicators)
  const hasUnsavedChanges = useMemo(() => {
    return isSaving || showSavedIndicator;
  }, [isSaving, showSavedIndicator]);

  const getFieldWithScenes = (field: string, dataSource?: any): any => {
    const source = dataSource || data;
    const fieldData = source[field];

    if (!fieldData) return '';

    // If it's an object with scenes, send the full object
    if (typeof fieldData === 'object' && fieldData !== null && fieldData.scenes) {
      return {
        S: fieldData.S || '',
        scenes: fieldData.scenes
      };
    }

    // Otherwise return the string content
    if (typeof fieldData === 'string') return fieldData;
    if (typeof fieldData === 'object' && 'S' in fieldData) return fieldData.S;

    return '';
  };


  const updateSegmentContent = (currentData: any, segmentId: string, newContent: string): any => {
    const existing = currentData[segmentId];

    if (typeof existing === 'object' && existing !== null && existing.scenes &&
      (Array.isArray(existing.scenes) ? existing.scenes.length > 0 : Object.keys(existing.scenes).length > 0)) {
      return {
        ...existing,
        S: newContent
      };
    }

    return newContent;
  };
  /**
   * ============================================================================
   * SAVE ARCHITECTURE
   * ============================================================================
   * 
   * This is a critical section that handles ALL data persistence.
   * 
   * PROBLEM WE'RE SOLVING:
   * When AI generates new content (e.g., synopsis), we need to save it immediately.
   * But React state updates are async, so if we just do:
   *   setData(newData)
   *   save()
   * The save() might read the OLD state before setData finishes.
   * 
   * SOLUTION:
   * We use an explicit data-passing pattern with a useProvidedData flag:
   * 
   * 1. For TYPING (debounced):
   *    - User types → handleChange → setData → handleDebouncedSave(data, false, false)
   *    - After 10 seconds, save() reads from current state
   *    - This works because 10 seconds is plenty of time for state to update
   * 
   * 2. For API RESPONSES (immediate):
   *    - API returns → create newData → setData(newData) → handleDebouncedSave(newData, true, true)
   *    - save() receives newData directly, doesn't read from state
   *    - Prevents stale state issues
   * 
   * WHY THIS PATTERN EXISTS:
   * Originally, we had issues with DynamoDB throttling because each generate
   * button would trigger multiple saves. The debounced save with explicit
   * data passing solves both problems:
   * - Throttle prevention: Debounced for typing
   * - Correctness: Explicit data for API responses
   * 
   * ============================================================================
   */

  /**
   * save()
   * Core save function that sends data to DynamoDB via works Lambda
   * 
   * @param title - Story title
   * @param storyId - Unique story identifier
   * @param fullData - Optional: Complete data object to save
   * 
   * If fullData is provided, uses it directly (for API responses)
   * If not provided, reads from current state (for debounced saves)
   */
  const save = async (title: string, storyId?: string, fullData?: any) => {
    const dataSource = fullData || data;

    console.log('💾 save() called with:', {
      title,
      storyId,
      hasFullData: !!fullData,
      dataSource: fullData ? 'provided' : 'state'
    });

    const payload: any = {
      "event": "save",
      "title": title,
      "userId": token?.payload['cognito:username'],
      "M": getFieldContent('M', dataSource),
      "T": getFieldContent('T', dataSource),
      "G": getFieldContent('G', dataSource),
      "CQ": getFieldContent('CQ', dataSource),
      "SUM": getFieldContent('SUM', dataSource),
      "BRAINSTORM": getFieldContent('BRAINSTORM', dataSource),
      "S1": getFieldWithScenes('S1', dataSource),
      "S2": getFieldWithScenes('S2', dataSource),
      "S3": getFieldWithScenes('S3', dataSource),
      "S4": getFieldWithScenes('S4', dataSource),
      "S5": getFieldWithScenes('S5', dataSource),
      "S6": getFieldWithScenes('S6', dataSource),
      "S7": getFieldWithScenes('S7', dataSource),
      "S8": getFieldWithScenes('S8', dataSource),
      "S9": getFieldWithScenes('S9', dataSource),
    };

    if (storyId || dataSource.storyId) {
      payload.storyId = storyId || dataSource.storyId;
    }

    console.log('save() sending payload:', payload);
    console.log('save() SUM preview:', payload.SUM?.substring(0, 100) + '...');
    console.log('save() BRAINSTORM preview:', payload.BRAINSTORM?.substring(0, 100) + '...');
    console.log('save() URL:', `${process.env.REACT_APP_URL}/works`);

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/works`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('save() response:', response);
      return response;
    } catch (error) {
      console.error('save() axios error:', error);
      throw error;
    }
  };

  /**
   * mutateSave
   * React Query mutation for save operations
   * Handles success/error states and user feedback
   */
  const mutateSave = useMutation({
    mutationFn: (saveData: { title: string; storyId?: string; fullData?: any }) => {
      console.log('mutateSave called with:', {
        title: saveData.title,
        storyId: saveData.storyId,
        hasFullData: !!saveData.fullData
      });
      return save(saveData.title, saveData.storyId, saveData.fullData);
    },
    onSuccess: (res: any) => {
      console.log('mutateSave onSuccess - full response:', res);
      console.log('mutateSave onSuccess - response data:', res.data);
      console.log('mutateSave onSuccess - status code:', res.data.statusCode);
      console.log('mutateSave onSuccess - body:', res.data.body);

      if (res.data.statusCode == 200) {
        console.log("✅ Title change saved successfully!");

        // Update user works if response includes updated works
        if (res.data.body && res.data.body.works) {
          console.log('📦 Updating user.works with:', Object.keys(res.data.body.works).length, 'stories');
          setUser((prevUser: any) => {
            if (!prevUser) return prevUser;
            return {
              ...prevUser,
              works: res.data.body.works
            };
          });
        } else {
          console.warn('⚠️ No works in response body');
        }

        // Update local data with storyId if we didn't have one
        if (res.data.body && res.data.body.storyId && !data.storyId) {
          console.log('🆔 Updating local data with storyId:', res.data.body.storyId);
          const newData = {
            ...data,
            storyId: res.data.body.storyId
          };
          setData(newData);
        }
      } else if (res.data.statusCode === 400) {
        console.error('❌ Save error 400:', res.data.body?.error || res.data.body);
        toast.error(res.data.body?.error || "Bad request error");
        setErrorOpen(true);
      } else {
        console.error('❌ Save error other status:', res.data.statusCode, res.data);
        toast.error("Error saving");
      }
    },
    onError: (error: any) => {
      console.error('❌ mutateSave onError:', error);
      toast.error("Error saving");
    },
  });

  /**
   * handleDebouncedSave
   * Orchestrates the save process with support for both debounced and immediate saves
   * 
   * @param newData - The data to save
   * @param forceImmediate - If true, save immediately; if false, debounce
   * @param useProvidedData - If true, pass newData to save(); if false, let save() read from state
   * 
   * USAGE PATTERNS:
   * - User typing: handleDebouncedSave(data, false, false)
   * - API response: handleDebouncedSave(newData, true, true)
   * 
   * This dual-mode approach solves both throttling and stale-state issues
   */
  const handleDebouncedSave = useCallback((newData: any, forceImmediate: boolean = false, useProvidedData: boolean = false) => {
    console.log('🔄 handleDebouncedSave called with data:', {
      title: newData.title,
      storyId: newData.storyId,
      hasContent: Object.values(newData).some(val => typeof val === 'string' && val.trim() !== ''),
      forceImmediate,
      useProvidedData,
      timestamp: new Date().toISOString()
    });

    setIsSaving(true);

    // Update cache immediately for responsive UI
    try {
      const cacheKey = newData.title || "Untitled";
      debouncedSave(newData);
      console.log('💾 Updated cache for:', cacheKey);
    } catch (error) {
      console.error('Cache save error:', error);
    }

    // Database save function
    const saveToDatabase = async (dataToSave: any) => {
      try {
        console.log('🚀 Saving to database...', {
          timestamp: new Date().toISOString(),
          title: dataToSave.title,
          storyId: dataToSave.storyId,
          useProvidedData
        });

        // Handle new/untitled stories - auto-generate storyId and title if needed
        let finalData = { ...dataToSave };

        if (!finalData.storyId) {
          finalData.storyId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          console.log('🆕 Generated new storyId:', finalData.storyId);
        }

        if (!finalData.title || finalData.title.trim() === '' || finalData.title === 'Untitled Story') {
          const timestamp = new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }).replace(/:/g, '-');
          finalData.title = `Story ${timestamp}`;
          console.log('📝 Generated new title:', finalData.title);
        }

        console.log('📤 About to call mutateSave.mutateAsync with:', {
          title: finalData.title,
          storyId: finalData.storyId,
          willPassFullData: useProvidedData
        });

        /**
         * CRITICAL CONDITIONAL LOGIC
         * This is where we decide whether to pass fullData or not
         */
        const savePayload: any = {
          title: finalData.title,
          storyId: finalData.storyId
        };

        if (useProvidedData) {
          savePayload.fullData = finalData;
          console.log('📦 Including fullData in save payload');
          console.log('📦 fullData SUM preview:', finalData.SUM?.substring(0, 100));
          console.log('📦 fullData BRAINSTORM preview:', finalData.BRAINSTORM?.substring(0, 100));
        } else {
          console.log('📋 Using state-based save (no fullData passed)');
        }

        const result = await mutateSave.mutateAsync(savePayload);

        console.log('📥 mutateSave.mutateAsync result:', result);

        // Update local state with generated IDs if needed
        if (finalData.storyId !== dataToSave.storyId || finalData.title !== dataToSave.title) {
          console.log('🔄 Updating local state with generated IDs');
          setData(finalData);
        }

        console.log('✅ Database save successful');
        setLastSaved(new Date());
        setIsSaving(false);

        // Show saved indicator
        setTimeout(() => {
          setShowSavedIndicator(true);
          setTimeout(() => {
            setShowSavedIndicator(false);
          }, 1000);
        }, 200);

        return result;

      } catch (error: any) {
        console.error('💥 Database save error:', error);
        setIsSaving(false);
        toast.error("Error saving to database");
        throw error;
      }
    };

    if (forceImmediate) {
      // Immediate save for critical events (API responses)
      console.log('⚡ Force immediate save triggered');
      return saveToDatabase(newData);
    } else {
      // Debounced save for regular typing
      console.log('⏰ Scheduling debounced save for 10 seconds');

      if (!debouncedDatabaseSaveRef.current) {
        debouncedDatabaseSaveRef.current = lodashDebounce(saveToDatabase, 10000);
      }

      return debouncedDatabaseSaveRef.current(newData);
    }

  }, [debouncedSave, mutateSave, setData]);

  /**
   * END OF SAVE ARCHITECTURE SECTION
   */

  /**
   * FIELD MANAGEMENT FUNCTIONS
   * Simple helpers for clearing individual or all fields
   */

  const clearField = (segmentId: string) => {
    const newData = {
      ...data,
      [segmentId]: updateSegmentContent(data, segmentId, "")
    };
    setData(newData);
    return handleDebouncedSave(newData);
  };

  const clearAllFields = () => {
    const newData = {
      ...data,
      M: "", T: "", G: "", CQ: "", SUM: "", BRAINSTORM: "",
      S1: updateSegmentContent(data, 'S1', ""),
      S2: updateSegmentContent(data, 'S2', ""),
      S3: updateSegmentContent(data, 'S3', ""),
      S4: updateSegmentContent(data, 'S4', ""),
      S5: updateSegmentContent(data, 'S5', ""),
      S6: updateSegmentContent(data, 'S6', ""),
      S7: updateSegmentContent(data, 'S7', ""),
      S8: updateSegmentContent(data, 'S8', ""),
      S9: updateSegmentContent(data, 'S9', ""),
    };
    setData(newData);
    return handleDebouncedSave(newData);
  };


  /**
 * handleCanvasMode
 * Opens a segment in canvas mode
 */
  const handleCanvasMode = useCallback((segmentId: string) => {
    console.log('🎨 Opening canvas mode for segment:', segmentId);
    setCanvasSegment(segmentId);
  }, []);

  /**
   * handleCanvasClose
   * Closes canvas mode
   */
  const handleCanvasClose = useCallback(() => {
    console.log('🎨 Closing canvas mode');
    setCanvasSegment(null);
  }, []);

  /**
   * handleCanvasContentChange
   * Updates segment content from canvas changes
   */
  const handleCanvasContentChange = useCallback((newContent: string) => {
    if (!canvasSegment) return;
    const newData = {
      ...data,
      [canvasSegment]: updateSegmentContent(data, canvasSegment, newContent),
    };
    setData(newData);
    handleDebouncedSave(newData, true, true);
  }, [canvasSegment, data, setData, handleDebouncedSave]);

  const handleCanvasNavigatePrev = useCallback(() => {
    if (!canvasSegment) return;

    const currentIndex = SEGMENT_ORDER.indexOf(canvasSegment);
    if (currentIndex > 0) {
      const prevSegment = SEGMENT_ORDER[currentIndex - 1];
      setCanvasSegment(prevSegment);
    }
  }, [canvasSegment]);

  const handleCanvasNavigateNext = useCallback(() => {
    if (!canvasSegment) return;

    const currentIndex = SEGMENT_ORDER.indexOf(canvasSegment);
    if (currentIndex < SEGMENT_ORDER.length - 1) {
      const nextSegment = SEGMENT_ORDER[currentIndex + 1];
      setCanvasSegment(nextSegment);
    }
  }, [canvasSegment]);

  const canvasHasPrev = canvasSegment ? SEGMENT_ORDER.indexOf(canvasSegment) > 0 : false;
  const canvasHasNext = canvasSegment ? SEGMENT_ORDER.indexOf(canvasSegment) < SEGMENT_ORDER.length - 1 : false;

  /**
   * handleNewStory
   * Creates a fresh story with auto-generated title and storyId
   */

  type FormStoryData = {
    title: string;
    primaryGenre: string;
    secondaryGenre?: string;
    theme: string;
  };

  const handleNewStory = useCallback((form: FormStoryData) => {
    // ✅ CHECK STORY LIMIT BEFORE CREATING
    const currentCount = user?.works ? Object.keys(user.works).length : 0;
    if (currentCount >= 5) {
      toast.error("You've reached the maximum of 5 stories. Please delete one first.");
      return;
    }
  
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).replace(/:/g, '-');

    const newStoryId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const combinedGenre =
      form.secondaryGenre && form.secondaryGenre.trim() !== ""
        ? `${form.primaryGenre}/${form.secondaryGenre}`
        : form.primaryGenre;

    const newData = {
      title: form.title || `Untitled Story ${timestamp}`,
      storyId: newStoryId,

      G: combinedGenre,

      M: "",
      T: form.theme || "",

      CQ: "", SUM: "",
      S1: "", S2: "", S3: "", S4: "", S5: "",
      S6: "", S7: "", S8: "", S9: ""
    };

    setData(newData);

    mutateSave.mutate({
      title: newData.title,
      storyId: newStoryId,
      fullData: newData
    });

    toast.success(`Created new story: ${newData.title}`);
  }, [setData, mutateSave, user?.works]);



  /**
   * handleTitleChange
   * Updates story title with validation and error handling
   */
  const handleTitleChange = useCallback(async (newTitle: string) => {
    const trimmedTitle = newTitle.trim();

    console.log('handleTitleChange called with:', newTitle);
    console.log('Current data.title:', data.title);
    console.log('Current data.storyId:', data.storyId);

    // Validation
    if (!trimmedTitle) {
      toast.error("Title cannot be empty");
      return;
    }

    if (trimmedTitle === data.title) {
      console.log('Title unchanged, no save needed');
      return;
    }

    if (!data.storyId) {
      toast.error("Error: Story has no storyId");
      return;
    }

    try {
      // Update local state immediately for responsive UI
      const updatedData = {
        ...data,
        title: trimmedTitle
      };
      setData(updatedData);

      console.log('Attempting to save with storyId:', data.storyId);

      const result = await mutateSave.mutateAsync({
        title: trimmedTitle,
        storyId: data.storyId
      });

      console.log('Save result:', result);
      toast.success(`Story renamed to: ${trimmedTitle}`);

    } catch (error) {
      console.error('Error saving title change:', error);
      toast.error("Error saving title change");

      // Revert title on error
      setData(data);
    }
  }, [data, setData, mutateSave]);

  /**
   * UI CONTROL FUNCTIONS
   * Handlers for various UI interactions
   */

  const toggleModel = (newModel: string) => {
    setModel(newModel);
  };

  const toggleSegmentExpansion = (segmentId: string) => {
    setSegmentExpanded(prev => ({
      ...prev,
      [segmentId]: !prev[segmentId]
    }));
  };

  const expandAllSegmentsInAct = (actSegments: string[]) => {
    setSegmentExpanded(prev => {
      const newState = { ...prev };
      actSegments.forEach(segmentId => {
        newState[segmentId] = true;
      });
      return newState;
    });
  };

  const collapseAllSegmentsInAct = (actSegments: string[]) => {
    setSegmentExpanded(prev => {
      const newState = { ...prev };
      actSegments.forEach(segmentId => {
        newState[segmentId] = false;
      });
      return newState;
    });
  };

  /**
   * INTERN MODE HANDLERS
   * Functions for managing the intern AI assistant selection mode
   */

  const handleFieldSelection = (field: string) => {
    if (!isInternSelectionMode) return;

    setInternSelectedFields((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(field)) {
        newSet.delete(field);
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  };

  const handleChange = (field: string, isInternField: boolean = false) => (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    if (isInternSelectionMode && !isInternField) return;
  
    // FIL-332: Defensive guard — even with readOnly on the textarea, some
    // browser behaviors (paste, drag-drop, autofill) can fire change events.
    // Dropping changes to a loading field prevents the user's typed content
    // from being silently overwritten when the generation response lands.
    if (fieldLoadingStates[field] === true) return;
  
    const currentValue = data[field];
    let newFieldValue: any;
  
    // If field is currently an object with scenes, preserve the structure
    if (typeof currentValue === 'object' && currentValue !== null && currentValue.scenes) {
      newFieldValue = {
        ...currentValue,
        S: event.target.value
      };
    } else {
      newFieldValue = event.target.value;
    }
  
    const newData = {
      ...data,
      [field]: newFieldValue
    };
    setData(newData);
    handleDebouncedSave(newData);
  };

  const stackedActionButtonsRef = useRef<any>(null);

  const handleInternClose = () => {
    console.log('🔧 Home: Closing intern panel and selection mode');
    setIsInternSelectionMode(false);
    setInternSelectedFields(new Set());

    if (stackedActionButtonsRef.current && stackedActionButtonsRef.current.closeInternPanel) {
      stackedActionButtonsRef.current.closeInternPanel();
    }
  };

  const handleInternToggle = (field: string) => {
    console.log(`🔧 TOGGLE DEBUG - Field: ${field}`);
    console.log(`🔧 Current internPanelOpen: ${internPanelOpen}`);

    if (internPanelOpen) {
      console.log(`🔧 -> CLOSING intern panel`);
      handleInternClose();
    } else {
      console.log(`🔧 -> OPENING intern panel`);

      if (stackedActionButtonsRef.current && stackedActionButtonsRef.current.openInternPanel) {
        console.log('🔧 Opening panel via ref for field:', field);
        stackedActionButtonsRef.current.openInternPanel();
      }

      setTimeout(() => {
        console.log(`🔧 Setting up selection for field: ${field}`);
        setIsInternSelectionMode(true);

        setInternSelectedFields(prev => {
          const newSet = new Set(prev);
          newSet.add(field);
          console.log(`🔧 Auto-selected field: ${field}`);
          return newSet;
        });

        // Auto-expand segments if needed
        if (field.startsWith('S')) {
          const actNumber = getActForSegment(field);
          console.log(`🔧 Auto-expanding act ${actNumber} for segment ${field}`);
          if (actNumber === 1) setActIExpanded(true);
          if (actNumber === 2) setActIIExpanded(true);
          if (actNumber === 3) setActIIIExpanded(true);

          setSegmentExpanded(prev => ({
            ...prev,
            [field]: true
          }));
        }
      }, 150);
    }
  };

  const getActForSegment = (segmentId: string) => {
    if (['S1', 'S2', 'S3'].includes(segmentId)) return 1;
    if (['S4', 'S5', 'S6'].includes(segmentId)) return 2;
    if (['S7', 'S8', 'S9'].includes(segmentId)) return 3;
    return 1;
  };

  /**
   * STORY CONTEXT HELPERS
   * Utilities for checking story state
   */

  const isStoryContextEmpty = () => {
    const contextFields = ['M', 'T', 'G', 'SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

    return contextFields.every(field => {
      const content = getFieldContent(field);
      return !content || content.trim() === '';
    });
  };

  /**
   * Parameter definitions for random generation (no context scenario)
   */
  const HOOK_PATTERN_OPTIONS = [
    "ironic_reversal",
    "contradictory_fusion",
    "necessary_fear"
  ];

  const CONFLICT_CATALYST_OPTIONS = [
    "new_arrival", "unexpected_departure", "economic_pressure",
    "generational_handoff", "external_threat", "internal_scandal",
    "technology_disruption", "policy_change", "natural_event",
    "anniversary_return", "health_crisis", "property_dispute",
    "cultural_misunderstanding", "resource_scarcity", "competition_arrival",
    "identity_emergence", "unresolved_past", "connection_crisis",
    "life_stage_pressure", "moral_awakening", "existential_questioning",
    "relationship_transition", "guilt_reckoning"
  ];

  const SETTING_TYPE_OPTIONS = [
    "professional_environment", "overlooked_community", "intergenerational_setting",
    "community_in_change", "intimate_setting", "urban_village", "behind_the_scenes",
    "cultural_crossroads", "hobby_subculture", "familiar_place_with_twist",
    "transitional_period", "border_space", "overlooked_profession",
    "night_shift_world", "seasonal_workplace", "forgotten_institution",
    "speculative_future", "warfare_zone", "historical_period",
    "adventure_frontier", "fantasy_realm", "isolated_compound"
  ];

  const TONE_OPTIONS = [
    "intimate_drama", "gentle_comedy", "quiet_reflection", "tense_character_study",
    "warm_community_portrait", "bittersweet_transition", "moral_complexity",
    "dry_observational_humor", "slow_burn_tension", "working_class_realism",
    "understated_hope", "social_satire", "melancholic_beauty", "resilient_optimism",
    "fish_out_of_water", "ensemble_character_piece", "generational_saga",
    "economic_anxiety_drama"
  ];

  const EMOTIONAL_CORE_OPTIONS = [
    "reconciliation", "responsibility", "identity", "belonging", "loss",
    "resilience", "moral_compromise", "hidden_connection", "transformation",
    "second_chances", "unspoken_truth", "generational_divide", "quiet_rebellion",
    "dignity_in_struggle", "unexpected_mentorship", "community_solidarity",
    "personal_reinvention", "inherited_burden", "found_family",
    "economic_survival", "breaking_cycles"
  ];

  const generateRandomSummaryParameters = () => {
    return {
      hook_pattern: HOOK_PATTERN_OPTIONS[Math.floor(Math.random() * HOOK_PATTERN_OPTIONS.length)],
      emotional_core: EMOTIONAL_CORE_OPTIONS[Math.floor(Math.random() * EMOTIONAL_CORE_OPTIONS.length)],
      setting_type: SETTING_TYPE_OPTIONS[Math.floor(Math.random() * SETTING_TYPE_OPTIONS.length)]
    };
  };

  /**
   * RANDOM GENERATOR FOR GROUNDED SETTINGS
   * Generates random but grounded story parameters
   * Used when user generates content without existing context
   */
  const generateRandomGroundedSetting = () => {
    const enums = {
      setting_type: [
        "professional_environment", "overlooked_community", "familiar_place_with_twist",
        "transitional_period", "border_space", "overlooked_profession",
        "intergenerational_setting", "community_in_change", "seasonal_workplace",
        "night_shift_world", "weekend_warriors", "hobby_subculture", "small_town_secrets",
        "urban_village", "forgotten_institution", "behind_the_scenes", "mobile_community",
        "underground_scene", "cultural_crossroads", "economic_pressure_point", "random"
      ],
      emotional_core: [
        "reconciliation", "responsibility", "identity", "belonging", "loss", "resilience",
        "moral_compromise", "hidden_connection", "transformation", "second_chances",
        "unspoken_truth", "generational_divide", "quiet_rebellion", "dignity_in_struggle",
        "unexpected_mentorship", "community_solidarity", "personal_reinvention",
        "inherited_burden", "found_family", "economic_survival", "cultural_preservation",
        "breaking_cycles", "random"
      ],
      tone: [
        "intimate_drama", "gentle_comedy", "quiet_reflection", "tense_character_study",
        "warm_community_portrait", "bittersweet_transition", "moral_complexity",
        "dry_observational_humor", "slow_burn_tension", "working_class_realism",
        "multicultural_tapestry", "understated_hope", "social_satire", "melancholic_beauty",
        "resilient_optimism", "fish_out_of_water", "ensemble_character_piece",
        "generational_saga", "cultural_clash_comedy", "economic_anxiety_drama", "random"
      ],
      time_frame: [
        "single_day_intensity", "weekend_compressed", "one_week_crisis", "monthly_cycles",
        "seasonal_change", "yearly_progression", "election_period", "holiday_season",
        "summer_job_timeframe", "school_year_arc", "harvest_season", "training_period",
        "countdown_to_deadline", "random"
      ],
      conflict_catalyst: [
        "new_arrival", "unexpected_departure", "economic_pressure", "generational_handoff",
        "external_threat", "internal_scandal", "technology_disruption", "policy_change",
        "natural_event", "anniversary_return", "health_crisis", "property_dispute",
        "cultural_misunderstanding", "resource_scarcity", "competition_arrival", "random"
      ],
      core_question_category: [
        "ethical_dilemma", "identity_question", "social_conflict", "random"
      ],
      first_word: [
        "CAN", "IS", "SHOULD", "WHAT"
      ]
    };

    const getRandomFromEnum = (enumArray: string[]) => {
      return enumArray[Math.floor(Math.random() * enumArray.length)];
    };

    const setting = {
      setting_type: getRandomFromEnum(enums.setting_type),
      emotional_core: getRandomFromEnum(enums.emotional_core),
      tone: getRandomFromEnum(enums.tone),
      time_frame: getRandomFromEnum(enums.time_frame),
      conflict_catalyst: getRandomFromEnum(enums.conflict_catalyst),
      core_question_category: getRandomFromEnum(enums.core_question_category),
      first_word: getRandomFromEnum(enums.first_word)
    };

    // Re-roll "random" selections
    Object.keys(setting).forEach(key => {
      if (setting[key as keyof typeof setting] === "random") {
        const enumValues = enums[key as keyof typeof enums].filter(val => val !== "random");
        setting[key as keyof typeof setting] = getRandomFromEnum(enumValues);
      }
    });

    return setting;
  };

  /**
   * ============================================================================
   * AI GENERATION MUTATIONS
   * ============================================================================
   * 
   * These mutations handle communication with the AI backend.
   * Each follows a similar pattern:
   * 
   * 1. mutationFn: Calls the appropriate API function
   * 2. onSuccess: Processes response, updates state, triggers immediate save
   * 3. onError: Handles errors, shows user feedback
   * 4. onSettled: Cleans up loading states
   * 
   * CRITICAL PATTERN:
   * After AI generates content, we ALWAYS call:
   *   handleDebouncedSave(newData, true, true)
   * 
   * The (true, true) parameters mean:
   * - true: forceImmediate (save now, don't debounce)
   * - true: useProvidedData (pass newData explicitly, don't read from state)
   * 
   * This prevents stale state issues where save() might read old data
   * ============================================================================
   */

  /**
   * CORE QUESTION GENERATION
   * Generates a philosophical/thematic question for the story
   * Can work with or without existing story context
   */

  const generateCoreQuestionWithContext = async () => {
    console.log('🎯 Generating Core Question with story context');

    const payload = {
      "event": "core_question_with_context",
      "userId": token?.payload['cognito:username'],
      "M": getFieldContent('M'),
      "T": getFieldContent('T'),
      "G": getFieldContent('G'),
      "CQ": getFieldContent('CQ'),
      "SUM": getFieldContent('SUM'),
      "BRAINSTORM": getFieldContent('BRAINSTORM'),
      "S1": getFieldContent('S1'),
      "S2": getFieldContent('S2'),
      "S3": getFieldContent('S3'),
      "S4": getFieldContent('S4'),
      "S5": getFieldContent('S5'),
      "S6": getFieldContent('S6'),
      "S7": getFieldContent('S7'),
      "S8": getFieldContent('S8'),
      "S9": getFieldContent('S9')
    };

    console.log('🚀 CQ with context payload:', {
      event: payload.event,
      userId: payload.userId,
      hasContext: !!(payload.M || payload.T || payload.G || payload.SUM)
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 CQ with context response:', response);
      return response;
    } catch (error) {
      console.error('🚀 CQ with context axios error:', error);
      throw error;
    }
  };

  const generateCoreQuestionDirect = async () => {
    console.log('🎯 Generating Core Question direct (no context)');

    const groundedSetting = generateRandomGroundedSetting();
    console.log('🎲 Generated random grounded setting:', groundedSetting);

    const payload = {
      "event": "core_question_direct",
      "userId": token?.payload['cognito:username'],
      "grounded_setting": groundedSetting
    };

    console.log('🚀 CQ direct payload:', {
      event: payload.event,
      userId: payload.userId,
      groundedSetting: payload.grounded_setting
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 CQ direct response:', response);
      return response;
    } catch (error) {
      console.error('🚀 CQ direct axios error:', error);
      throw error;
    }
  };

  const mutateCoreQuestion = useMutation({
    mutationFn: (cqData: { isEmpty: boolean }) => {
      console.log('🚀 mutateCoreQuestion: Calling CQ generation with isEmpty:', cqData.isEmpty);

      if (cqData.isEmpty) {
        return generateCoreQuestionDirect();
      } else {
        return generateCoreQuestionWithContext();
      }
    },
    onSuccess: (res: any) => {
      console.log('🎯 mutateCoreQuestion onSuccess: Raw response received');
      console.log('🎯 mutateCoreQuestion onSuccess: Full response object:', res);

      if (res.status === 200) {
        console.log('✅ mutateCoreQuestion: HTTP Success status confirmed');

        // Update token balance
        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateCoreQuestion: Updated token balance to:', res.data.cap);
        }

        // Process Core Question generation response
        if (res.data.output && res.data.output.CQ) {
          console.log('🤖 mutateCoreQuestion: Processing CQ generation response');
          console.log('🤖 mutateCoreQuestion: Generated CQ:', res.data.output.CQ);

          const coreQuestion = res.data.output.CQ;

          const newData = {
            ...data,
            CQ: coreQuestion
          };

          console.log('🤖 mutateCoreQuestion: Updating CQ field');
          setData(newData);

          /**
           * CRITICAL: Force immediate save after API response
           * Parameters: (newData, true, true)
           * - true: forceImmediate
           * - true: useProvidedData
           */
          console.log('🤖 OpenAI CQ API response - triggering immediate save');
          handleDebouncedSave(newData, true, true);

          toast.success('Core Question generated successfully!');

        } else if (res.data.error) {
          console.log('❌ mutateCoreQuestion: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateCoreQuestion: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateCoreQuestion: HTTP Error status:', res.status);

        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any) => {
      console.log('💥 mutateCoreQuestion onError: Request failed');

      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`Core Question generation failed: ${error.message}`);
      } else {
        toast.error("Core Question generation failed");
      }
    },
    onSettled: (data, error, variables) => {
      console.log('🔄 mutateCoreQuestion onSettled: Clearing loading state for CQ');
      setFieldLoadingStates(prev => ({
        ...prev,
        CQ: false
      }));
    }
  });

  /**
   * METADATA GENERATION (Genre, Theme, Mood & Setting)
   * Generates the G, T, M fields
   * Similar pattern to Core Question generation
   */

  const generateMetadataWithContext = async (requestedField: string) => {
    console.log('🎯 Generating Metadata with story context for field:', requestedField);

    const payload = {
      "event": "metadata_with_context",
      "userId": token?.payload['cognito:username'],
      "requested_field": requestedField,
      "M": getFieldContent('M'),
      "T": getFieldContent('T'),
      "G": getFieldContent('G'),
      "CQ": getFieldContent('CQ'),
      "SUM": getFieldContent('SUM'),
      "BRAINSTORM": getFieldContent('BRAINSTORM'),
      "S1": getFieldContent('S1'),
      "S2": getFieldContent('S2'),
      "S3": getFieldContent('S3'),
      "S4": getFieldContent('S4'),
      "S5": getFieldContent('S5'),
      "S6": getFieldContent('S6'),
      "S7": getFieldContent('S7'),
      "S8": getFieldContent('S8'),
      "S9": getFieldContent('S9')
    };

    console.log('🚀 Metadata with context payload:', {
      event: payload.event,
      userId: payload.userId,
      requestedField: payload.requested_field,
      hasContext: !!(payload.M || payload.T || payload.G || payload.SUM)
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Metadata with context response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Metadata with context axios error:', error);
      throw error;
    }
  };

  const generateMetadataDirect = async (requestedField: string) => {
    console.log('🎯 Generating Metadata direct (no context) for field:', requestedField);

    const groundedSetting = generateRandomGroundedSetting();
    console.log('🎲 Generated random grounded setting:', groundedSetting);

    // Remove CQ-specific properties
    const { core_question_category, first_word, ...metadataGroundedSetting } = groundedSetting;

    const payload = {
      "event": "metadata_direct",
      "userId": token?.payload['cognito:username'],
      "requested_field": requestedField,
      "grounded_setting": metadataGroundedSetting
    };

    console.log('🚀 Metadata direct payload:', {
      event: payload.event,
      userId: payload.userId,
      requestedField: payload.requested_field,
      groundedSetting: payload.grounded_setting
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Metadata direct response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Metadata direct axios error:', error);
      throw error;
    }
  };

  const mutateMetadata = useMutation({
    mutationFn: (metadataData: { field: string; isEmpty: boolean }) => {
      console.log('🚀 mutateMetadata: Calling Metadata generation with field:', metadataData.field, 'isEmpty:', metadataData.isEmpty);

      if (metadataData.isEmpty) {
        return generateMetadataDirect(metadataData.field);
      } else {
        return generateMetadataWithContext(metadataData.field);
      }
    },
    onSuccess: (res: any, variables) => {
      console.log('🎯 mutateMetadata onSuccess: Raw response received');

      if (res.status === 200) {
        console.log('✅ mutateMetadata: HTTP Success status confirmed');

        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateMetadata: Updated token balance to:', res.data.cap);
        }

        if (res.data.output && res.data.output[variables.field]) {
          console.log('🤖 mutateMetadata: Processing Metadata generation response');

          const fieldContent = res.data.output[variables.field];

          const newData = {
            ...data,
            [variables.field]: fieldContent
          };

          console.log('🤖 mutateMetadata: Updating field:', variables.field);
          setData(newData);

          /**
           * CRITICAL: Force immediate save after API response
           */
          console.log('🤖 OpenAI Metadata API response - triggering immediate save');
          handleDebouncedSave(newData, true, true);

          const fieldNames = { G: 'Genre', T: 'Theme', M: 'Mood & Setting' };
          toast.success(`${fieldNames[variables.field as keyof typeof fieldNames]} generated successfully!`);

        } else if (res.data.error) {
          console.log('❌ mutateMetadata: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateMetadata: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateMetadata: HTTP Error status:', res.status);

        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any, variables) => {
      console.log('💥 mutateMetadata onError: Request failed for field:', variables.field);

      const fieldNames = { G: 'Genre', T: 'Theme', M: 'Mood & Setting' };
      const fieldName = fieldNames[variables.field as keyof typeof fieldNames] || variables.field;

      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`${fieldName} generation failed: ${error.message}`);
      } else {
        toast.error(`${fieldName} generation failed`);
      }
    },
    onSettled: (data, error, variables) => {
      console.log('🔄 mutateMetadata onSettled: Clearing loading state for:', variables.field);
      setFieldLoadingStates(prev => ({
        ...prev,
        [variables.field]: false
      }));
    }
  });

  /**
   * mutateSummaryGeneration
   * Handles summary generation for both context and no-context scenarios
   */
  const mutateSummaryGeneration = useMutation({
    mutationFn: () => {
      console.log('🚀 mutateSummaryGeneration: Calling summary generation');
      return generateSummary();
    },
    onSuccess: (res: any) => {
      console.log('🎯 mutateSummaryGeneration onSuccess: Raw response received');

      if (res.status === 200) {
        console.log('✅ mutateSummaryGeneration: HTTP Success status confirmed');

        // Update token balance
        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateSummaryGeneration: Updated token balance to:', res.data.cap);
        }

        // Process summary generation response
        if (res.data.SUM) {
          console.log('🤖 mutateSummaryGeneration: Processing summary response');
          console.log('🤖 mutateSummaryGeneration: Generated summary length:', res.data.SUM.length);

          const summary = res.data.SUM;

          const newData = {
            ...data,
            SUM: summary
          };

          console.log('🤖 mutateSummaryGeneration: Updating SUM field');
          setData(newData);

          // CRITICAL: Force immediate save after API response
          console.log('🤖 Summary generated - triggering immediate save');
          handleDebouncedSave(newData, true, true);

          toast.success('Summary generated successfully!');

          // Scroll to the Summary field
          setTimeout(() => {
            const summaryElement = document.querySelector('[data-field="SUM"]')
              || document.getElementById('summary-field')
              || document.querySelector('.story-summary');

            if (summaryElement) {
              summaryElement.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              console.log('📜 Scrolled to summary field');
            }
          }, 500);

        } else if (res.data.error) {
          console.log('❌ mutateSummaryGeneration: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateSummaryGeneration: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateSummaryGeneration: HTTP Error status:', res.status);

        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any) => {
      console.log('💥 mutateSummaryGeneration onError: Request failed');

      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`Summary generation failed: ${error.message}`);
      } else {
        toast.error("Summary generation failed");
      }
    },
    onSettled: () => {
      console.log('🔄 mutateSummaryGeneration onSettled: Clearing loading state');
      setFieldLoadingStates(prev => ({
        ...prev,
        SUM: false
      }));
    }
  });
  /**
  * generateSummary()
  * Generates summary - handles both context and no-context scenarios
  */
  const generateSummary = async () => {
    console.log('🎯 Generating summary');

    // Check if any story context exists
    const hasContext = !!(
      getFieldContent('G') || getFieldContent('T') || getFieldContent('M') ||
      getFieldContent('CQ') || getFieldContent('S1') || getFieldContent('S2') ||
      getFieldContent('S3') || getFieldContent('S4') || getFieldContent('S5') ||
      getFieldContent('S6') || getFieldContent('S7') || getFieldContent('S8') ||
      getFieldContent('S9')
    );

    console.log('🔍 Has story context:', hasContext);
    console.log('🔍 Model override:', getModelForAPI());

    let payload: any = {
      "event": "one_click_summary",
      "userId": token?.payload['cognito:username'],
      "content": model,  // "short" or "base"
      "modelOverride": getModelForAPI()  // ✨ Multi-provider support
    };

    if (hasContext) {
      // Context scenario: Send all story fields, backend will generate parameters
      console.log('📍 Using context-based summary generation');
      payload = {
        ...payload,
        "G": getFieldContent('G'),
        "T": getFieldContent('T'),
        "M": getFieldContent('M'),
        "CQ": getFieldContent('CQ'),
        "BRAINSTORM": getFieldContent('BRAINSTORM'),
        "S1": getFieldContent('S1'),
        "S2": getFieldContent('S2'),
        "S3": getFieldContent('S3'),
        "S4": getFieldContent('S4'),
        "S5": getFieldContent('S5'),
        "S6": getFieldContent('S6'),
        "S7": getFieldContent('S7'),
        "S8": getFieldContent('S8'),
        "S9": getFieldContent('S9')
      };
    } else {
      // No-context scenario: Frontend generates random parameters
      console.log('📍 Using random parameter summary generation (no context)');
      const randomParameters = generateRandomSummaryParameters();
      console.log('🎲 Generated random parameters:', randomParameters);
      payload.parameters = randomParameters;
    }

    console.log('🚀 Summary payload:', {
      event: payload.event,
      userId: payload.userId,
      content: payload.content,
      modelOverride: payload.modelOverride,  // ✨ Log model override
      hasContext,
      hasParameters: !!payload.parameters
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Summary response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Summary axios error:', error);
      throw error;
    }
  };

  /**
   * handleGenerate
   * Unified handler for all generate buttons
   * Routes to appropriate generation function based on field
   */
  const handleGenerate = async (field: string) => {
    console.log(`🎯 Generate clicked for field: ${field}`);

    // Handle Summary generation
    if (field === 'SUM') {
      console.log('🎯 Summary generation requested');

      try {
        setFieldLoadingStates(prev => ({
          ...prev,
          SUM: true
        }));

        // Clear SUM field before generation
        console.log('🧹 Clearing SUM field before generation');
        const clearedData = {
          ...data,
          [field]: updateSegmentContent(data, field, "")
        };
        setData(clearedData);

        console.log('🚀 Calling summary generation');
        toast('Generating summary...');

        await mutateSummaryGeneration.mutateAsync();

      } catch (error) {
        console.error(`💥 Error generating summary:`, error);
      }

      return;
    }

    // Handle Core Question generation
    if (field === 'CQ') {
      console.log('🎯 Core Question generation requested');

      try {
        setFieldLoadingStates(prev => ({
          ...prev,
          CQ: true
        }));

        // Clear field before generation
        console.log('🧹 Clearing CQ field before generation');
        const clearedData = {
          ...data,
          CQ: ""
        };
        setData(clearedData);

        const isEmpty = isStoryContextEmpty();
        console.log('🔍 Story context empty:', isEmpty);

        if (isEmpty) {
          console.log('📍 Using direct CQ generation (no context)');
          toast('Generating Core Question from random parameters...');
        } else {
          console.log('📍 Using context-aware CQ generation');
          toast('Generating Core Question from story context...');
        }

        console.log('🚀 Calling Core Question generation');
        await mutateCoreQuestion.mutateAsync({ isEmpty });

      } catch (error) {
        console.error(`💥 Error generating CQ:`, error);
      }

      return;
    }

    // Handle Metadata field generation (G, T, M)
    if (['G', 'T', 'M'].includes(field)) {
      console.log('🎯 Metadata generation requested for field:', field);

      try {
        setFieldLoadingStates(prev => ({
          ...prev,
          [field]: true
        }));

        console.log('🧹 Clearing field before generation:', field);
        const clearedData = {
          ...data,
          [field]: ""
        };
        setData(clearedData);

        const isEmpty = isStoryContextEmpty();
        console.log('🔍 Story context empty:', isEmpty);

        const fieldNames = { G: 'Genre', T: 'Theme', M: 'Mood & Setting' };
        const fieldName = fieldNames[field as keyof typeof fieldNames];

        if (isEmpty) {
          console.log('📍 Using direct Metadata generation (no context)');
          toast(`Generating ${fieldName} from random parameters...`);
        } else {
          console.log('📍 Using context-aware Metadata generation');
          toast(`Generating ${fieldName} from story context...`);
        }

        console.log('🚀 Calling Metadata generation for field:', field);
        await mutateMetadata.mutateAsync({ field, isEmpty });

      } catch (error) {
        console.error(`💥 Error generating ${field}:`, error);
      }

      return;
    }

    // Handle S1-S9 segments
    if (!field.match(/^S[1-9]$/)) {
      console.log(`⚠️ Field ${field} is not a segment (S1-S9), CQ, SUM, or metadata (G, T, M), skipping generation`);
      toast.error("Individual generation is currently only available for Summary (SUM), Core Question (CQ), Metadata (G, T, M), and story segments (S1-S9)");
      return;
    }

    try {
      setFieldLoadingStates(prev => ({
        ...prev,
        [field]: true
      }));

      console.log(`🧹 Clearing field ${field} before generation`);
      const clearedData = {
        ...data,
        [field]: ""
      };
      setData(clearedData);

      console.log(`🚀 Calling segment generation for: ${field}`);
      await mutateSegment.mutateAsync({ segmentId: field });

    } catch (error) {
      console.error(`💥 Error generating ${field}:`, error);
    }
  };

  /**
   * ============================================================================
   * BRAINSTORM WORKFLOW HANDLERS
   * ============================================================================
   * 
   * New multi-step workflow for story creation:
   * 1. User writes freeform brainstorm (BRAINSTORM field)
   * 2. Click "Process into Structure"
   * 3. Foundation extracted (logline + metadata) - shown in modal
   * 4. User reviews/edits logline
   * 5. Click "Continue to Synopsis" or "Regenerate"
   * 6. Synopsis generated and saved to SUM field
   * 7. Modal closes automatically
   * 
   * CRITICAL: BRAINSTORM is saved BEFORE foundation extraction
   * This ensures the raw ideas are preserved in the database
   * ============================================================================
   */

  /**
   * handleProcessBrainstorm
   * Step 1: Save brainstorm, then extract foundation (logline)
   */
  const handleProcessBrainstorm = async (mode: 'preview' | 'full' = 'preview') => {
    console.log('🎯 Process brainstorm clicked with mode:', mode);

    // Validate brainstorm has content
    const brainstormContent = getFieldContent('BRAINSTORM').trim();
    if (!brainstormContent || brainstormContent.length < 50) {
      toast.error('Please write at least 50 characters before processing');
      return;
    }

    // Hand-build the overlay estimate based on mode. Preview runs a
    // multi-handoff pipeline on the backend (~25s real-world). Full
    // outline is metadata + summary + all 9 segments (~50s).
    // Not derived from useOutlinePlan because brainstorm-to-synopsis
    // is an UNCONDITIONAL overwrite — the backend writes these fields
    // regardless of their current state.
    const estimate: OutlineEstimate = mode === 'preview'
      ? {
          totalMs: 25_000,
          phases: [{ id: 'summary', ms: 25_000 }],
        }
      : {
          totalMs: 4_000 + 6_000 + (4_500 * 9),
          phases: [
            { id: 'metadata', ms: 4_000 },
            { id: 'summary',  ms: 6_000 },
            { id: 'segments', ms: 4_500 * 9, segmentCount: 9 },
          ],
        };
    setBrainstormEstimate(estimate);

    try {
      /**
       * CRITICAL: Save BRAINSTORM to database BEFORE processing
       * Parameters: (data, true, true)
       * - true: forceImmediate (save now, don't wait)
       * - true: useProvidedData (use current data, not state)
       */
      console.log('💾 Saving brainstorm to database before processing');
      await handleDebouncedSave(data, true, true);
      console.log('✅ Brainstorm saved to database');

      // Set loading state
      console.log('🔄 Setting loading state for synopsis generation');
      setIsProcessingBrainstorm(true);

      // Call the combined brainstorm-to-synopsis API
      console.log('🚀 Calling brainstorm to synopsis generation with mode:', mode);
      await mutateBrainstormToSynopsis.mutateAsync({ mode });

    } catch (error) {
      console.error(`💥 Error processing brainstorm:`, error);
    }
  };


  /**
   * generateBrainstormToSynopsis()
   * Single API call that handles complete workflow
   * Backend chains foundation extraction + synopsis generation
   */
  /**
   * generateBrainstormToSynopsis()
   * Single API call that handles complete workflow
   * Backend chains foundation extraction + synopsis generation
   */
  const generateBrainstormToSynopsis = async (mode: 'preview' | 'full' = 'preview') => {
    console.log('🎯 Generating synopsis from brainstorm (combined flow) with mode:', mode);

    /**
     * HOOK PATTERN SELECTION
     * Randomly select one of three patterns to guide the AI
     */
    const hookPatterns = [
      'contradictory_fusion',
      'ironic_reversal',
      'necessary_fear'
    ];
    const randomHookPattern = hookPatterns[Math.floor(Math.random() * hookPatterns.length)];

    console.log('🎲 Randomly selected hook pattern:', randomHookPattern);
    console.log('🔍 Model override:', getModelForAPI());

    const brainstormContent = getFieldContent('BRAINSTORM');

    // Append hook pattern instruction to brainstorm
    const enhancedInput = `${brainstormContent}\n\nhook_pattern: "${randomHookPattern}"`;

    // Get existing story metadata if populated
    const storyMetadata = {
      M: getFieldContent('M'),   // Mood & Setting
      G: getFieldContent('G'),   // Genre
      T: getFieldContent('T'),   // Theme
      CQ: getFieldContent('CQ')  // Core Question
    };

    const payload = {
      "event": "brainstorm_to_synopsis",
      "userId": token?.payload['cognito:username'],
      "raw_plot_input": enhancedInput,
      "story_metadata": storyMetadata,
      "modelOverride": getModelForAPI(),
      "mode": mode,
      "storyId": data?.storyId,
      "character_database": data.characters || {},
      "character_database_enabled": characterDatabaseEnabled
    };

    console.log('🚀 Brainstorm to synopsis payload:', {
      event: payload.event,
      userId: payload.userId,
      inputLength: payload.raw_plot_input.length,
      selectedHookPattern: randomHookPattern,
      modelOverride: payload.modelOverride,
      mode: payload.mode,  // ✨ Log mode
      hasMetadata: Object.values(storyMetadata).some(v => v && v.trim())
    });
    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Brainstorm to synopsis response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Brainstorm to synopsis axios error:', error);
      throw error;
    }
  };
  /**
   * END OF BRAINSTORM WORKFLOW HANDLERS
   */

  /**
   * LEGACY RANDOM GENERATORS
   * Used for generating random defaults when fields are empty
   */

  const randomGenre = () => {
    const genres = ['Drama/Comedy', 'Drama/Thriller', 'Drama/War', 'Drama/Mystery', 'Drama/Arthouse'];
    return genres[Math.floor(Math.random() * genres.length)];
  };

  const randomSetting = () => {
    const settings = [
      "Present-day New York City, in a midtown office building",
      "Small coastal town in Maine, recovering from a recent storm",
      "Present-day rural Appalachia, in an isolated mountain community",
      "Suburban neighborhood in Ohio, centered around two adjacent homes",
      "Modern-day Detroit, in a working-class neighborhood with abandoned factories",
    ];
    return settings[Math.floor(Math.random() * settings.length)];
  };

  /**
   * mutateSummary
   * Legacy summary generation (being phased out in favor of brainstorm workflow)
   */
  const mutateSummary = useMutation({
    mutationFn: (formData: FormData) => {
      return summary(formData);
    },
    onSuccess: (res: any) => {
      if (res.data.statusCode == 200) {
        const newData = {
          ...data,
          SUM: res.data.body.SUM
        };
        setData(newData);

        /**
         * CRITICAL: Immediate save after summary generation
         */
        console.log('🤖 Summary generated - triggering immediate save');
        handleDebouncedSave(newData, true, true);

        setUser((user: any) => ({ ...user, cap: res.data.body.cap }));
        toast.success('Summary generated and saved!');
      } else if (res.data.statusCode == 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
    },
  });

  const summary = async (formData: FormData) => {
    let genre = getFieldContent('G');
    if (genre.length == 0) {
      genre = randomGenre();
    }
    let setting = getFieldContent('M');
    if (setting.length == 0) {
      setting = randomSetting()
    }
    return await axios.post(`${process.env.REACT_APP_URL}/summary`,
      {
        "event": "summary",
        "content": model,
        "userId": token?.payload['cognito:username'],
        "M": setting,
        "T": getFieldContent('T'),
        "G": genre,
        "CQ": getFieldContent('CQ'),
      },
      { headers: { "Authorization": token.toString() } }
    );
  };

  /**
   * mutateStory
   * Generates the complete story (all segments S1-S9)
   * This is a more expensive operation that generates all beats at once
   */
  const mutateStory = useMutation({
    mutationFn: (formData: FormData) => {
      console.log('🚀 mutateStory: Calling story() function');
      return story(formData);
    },
    onSuccess: (res: any) => {
      console.log('🎯 mutateStory onSuccess: Raw response received');
  
      if (res.status === 200) {
        console.log('✅ mutateStory: HTTP Success status confirmed');
  
        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateStory: Updated token balance to:', res.data.cap);
        }
  
        if (res.data.output) {
          console.log('🤖 mutateStory: Processing story generation response');
          console.log('🔍 Full output structure:', JSON.stringify(res.data.output, null, 2));
          console.log('🔍 S1 direct:', res.data.output.S1);
          console.log('🔍 S1.S:', res.data.output.S1?.S);
          console.log('🔍 segments?:', res.data.output.segments);
  
          /**
           * IMPORTANT: Extract .S property for segments
           * Backend returns segments as objects: { S: "content", scenes: {} }
           * We extract .S for simple string storage
           */
          const newData = {
            ...data,
            G: res.data.output.G || data.G,
            T: res.data.output.T || data.T,
            CQ: res.data.output.CQ || data.CQ,
            M: res.data.output.M || data.M,
            SUM: res.data.output.SUM || data.SUM,
            S1: updateSegmentContent(data, 'S1', res.data.output.S1?.S || res.data.output.S1 || getFieldContent('S1')),
            S2: updateSegmentContent(data, 'S2', res.data.output.S2?.S || res.data.output.S2 || getFieldContent('S2')),
            S3: updateSegmentContent(data, 'S3', res.data.output.S3?.S || res.data.output.S3 || getFieldContent('S3')),
            S4: updateSegmentContent(data, 'S4', res.data.output.S4?.S || res.data.output.S4 || getFieldContent('S4')),
            S5: updateSegmentContent(data, 'S5', res.data.output.S5?.S || res.data.output.S5 || getFieldContent('S5')),
            S6: updateSegmentContent(data, 'S6', res.data.output.S6?.S || res.data.output.S6 || getFieldContent('S6')),
            S7: updateSegmentContent(data, 'S7', res.data.output.S7?.S || res.data.output.S7 || getFieldContent('S7')),
            S8: updateSegmentContent(data, 'S8', res.data.output.S8?.S || res.data.output.S8 || getFieldContent('S8')),
            S9: updateSegmentContent(data, 'S9', res.data.output.S9?.S || res.data.output.S9 || getFieldContent('S9')),
          };
  
          console.log('🤖 mutateStory: Constructed newData object');
          setData(newData);
  
          /**
           * CRITICAL: Immediate save after full story generation
           */
          console.log('🤖 Full story generated - triggering immediate save');
          handleDebouncedSave(newData, true, true);
  
          toast.success("Story generated and saved!");
  
        } else if (res.data.error) {
          console.log('❌ mutateStory: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateStory: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateStory: HTTP Error status:', res.status);
        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any) => {
      console.log('💥 mutateStory onError: Request failed');
      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`Story generation failed: ${error.message}`);
      } else {
        toast.error("Story generation failed");
      }
    },
    onSettled: () => {
      // FIL-332: Clear the plan snapshot so OutlineGenerationOverlay
      // unmounts cleanly after generation completes (success or error).
      // Runs after both onSuccess and onError.
      console.log('🔄 mutateStory onSettled: Clearing plan snapshot');
      setActivePlanSnapshot(null);
    },
  });

  /**
   * mutateSegment
   * Generates a single story segment (S1-S9)
   * Allows users to regenerate individual beats
   */
  const mutateSegment = useMutation({
    mutationFn: (segmentData: { segmentId: string }) => {
      console.log('🚀 mutateSegment: Calling generateSegment() function for:', segmentData.segmentId);
      return generateSegment(segmentData.segmentId);
    },
    onSuccess: (res: any) => {
      console.log('🎯 mutateSegment onSuccess: Raw response received');

      if (res.status === 200) {
        console.log('✅ mutateSegment: HTTP Success status confirmed');

        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateSegment: Updated token balance to:', res.data.cap);
        }

        if (res.data.output && res.data.output.segment_id && res.data.output.summary) {
          console.log('🤖 mutateSegment: Processing segment generation response');

          const segmentId = res.data.output.segment_id;
          const content = res.data.output.summary;

          const newData = {
            ...data,
            [segmentId]: updateSegmentContent(data, segmentId, content)
          };

          console.log('🤖 mutateSegment: Updating field:', segmentId);
          setData(newData);

          /**
           * CRITICAL: Immediate save after segment generation
           */
          console.log('🤖 OpenAI Segment API response - triggering immediate save');
          handleDebouncedSave(newData, true, true);

          toast.success(`${segmentId} generated successfully!`);

        } else if (res.data.error) {
          console.log('❌ mutateSegment: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateSegment: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateSegment: HTTP Error status:', res.status);

        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any) => {
      console.log('💥 mutateSegment onError: Request failed');

      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`Segment generation failed: ${error.message}`);
      } else {
        toast.error("Segment generation failed");
      }
    },
    onSettled: (data, error, variables) => {
      const segmentId = variables.segmentId;
      console.log('🔄 mutateSegment onSettled: Clearing loading state for:', segmentId);
      setFieldLoadingStates(prev => ({
        ...prev,
        [segmentId]: false
      }));
    }
  });

  const mutateBrainstormToSynopsis = useMutation({
    mutationFn: ({ mode }: { mode: 'preview' | 'full' }) => {
      console.log('🚀 mutateBrainstormToSynopsis: Calling combined generation with mode:', mode);
      return generateBrainstormToSynopsis(mode);
    },
    onSuccess: (res: any) => {
      console.log('🎯 mutateBrainstormToSynopsis onSuccess: Raw response received');

      if (res.status === 200) {
        console.log('✅ mutateBrainstormToSynopsis: HTTP Success status confirmed');

        if (res.data.cap !== undefined) {
          setUser((user: any) => ({ ...user, cap: res.data.cap }));
          console.log('💰 mutateBrainstormToSynopsis: Updated token balance to:', res.data.cap);
        }

        if (res.data.segments || res.data.synopsis) {
          console.log('🤖 mutateBrainstormToSynopsis: Processing response');
          console.log('🤖 mutateBrainstormToSynopsis: Has segments:', !!res.data.segments);
          console.log('🤖 mutateBrainstormToSynopsis: Has synopsis:', !!res.data.synopsis);

          let newData = { ...data };

          if (res.data.segments) {
            // Full outline mode - update all segments
            console.log('🤖 Full outline mode - updating all segments');

            // Update story_summary (goes to SUM field)
            if (res.data.story_summary) {
              newData.SUM = res.data.story_summary;
            }

            // Update metadata if provided
            if (res.data.story_metadata) {
              if (res.data.story_metadata.genre) newData.G = res.data.story_metadata.genre;
              if (res.data.story_metadata.theme) newData.T = res.data.story_metadata.theme;
              if (res.data.story_metadata.mood_setting) newData.M = res.data.story_metadata.mood_setting;
              if (res.data.story_metadata.core_question) newData.CQ = res.data.story_metadata.core_question;
            }

            // Update segments S1-S9
            const segments = res.data.segments;
            if (segments.S1?.summary) newData.S1 = updateSegmentContent(newData, 'S1', segments.S1.summary);
            if (segments.S2?.summary) newData.S2 = updateSegmentContent(newData, 'S2', segments.S2.summary);
            if (segments.S3?.summary) newData.S3 = updateSegmentContent(newData, 'S3', segments.S3.summary);
            if (segments.S4?.summary) newData.S4 = updateSegmentContent(newData, 'S4', segments.S4.summary);
            if (segments.S5?.summary) newData.S5 = updateSegmentContent(newData, 'S5', segments.S5.summary);
            if (segments.S6?.summary) newData.S6 = updateSegmentContent(newData, 'S6', segments.S6.summary);
            if (segments.S7?.summary) newData.S7 = updateSegmentContent(newData, 'S7', segments.S7.summary);
            if (segments.S8?.summary) newData.S8 = updateSegmentContent(newData, 'S8', segments.S8.summary);
            if (segments.S9?.summary) newData.S9 = updateSegmentContent(newData, 'S9', segments.S9.summary);

            console.log('🤖 Updated segments:', Object.keys(segments));

          } else {
            // Preview mode - just update SUM
            console.log('🤖 Preview mode - updating SUM only');
            newData.SUM = res.data.synopsis;
          }

          console.log('🤖 mutateBrainstormToSynopsis: Updating SUM field');
          setData(newData);

          /**
           * CRITICAL: Force immediate save after synopsis generation
           * Parameters: (newData, true, true)
           */
          console.log('🤖 Synopsis generated - triggering immediate save');
          handleDebouncedSave(newData, true, true);

          toast.success('Synopsis generated and saved!');

          /**
           * Scroll to the Summary field to show the generated synopsis
           */
          setTimeout(() => {
            const summaryElement = document.querySelector('[data-field="SUM"]')
              || document.getElementById('summary-field')
              || document.querySelector('.story-summary');

            if (summaryElement) {
              summaryElement.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });
              console.log('📜 Scrolled to synopsis field');
            } else {
              console.warn('⚠️ Could not find summary element to scroll to');
            }
          }, 500); // Small delay to ensure DOM is updated

        } else if (res.data.error) {
          console.log('❌ mutateBrainstormToSynopsis: Error in response data');
          toast.error(res.data.error);
        } else {
          console.log('📝 mutateBrainstormToSynopsis: Unexpected response structure');
          toast.error("Unexpected response format");
        }
      } else {
        console.log('❌ mutateBrainstormToSynopsis: HTTP Error status:', res.status);

        if (res.data.error) {
          toast.error(res.data.error);
        } else {
          toast.error(`Request failed with status ${res.status}`);
        }
      }
    },
    onError: (error: any) => {
      console.log('💥 mutateBrainstormToSynopsis onError: Request failed');

      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else if (error.message) {
        toast.error(`Synopsis generation failed: ${error.message}`);
      } else {
        toast.error("Synopsis generation failed");
      }
    },
    onSettled: () => {
      console.log('🔄 mutateBrainstormToSynopsis onSettled: Clearing loading state');
      setIsProcessingBrainstorm(false);
      setBrainstormEstimate(null);
    }
  });
  /**
   * ============================================================================
   * API CALL FUNCTIONS
   * ============================================================================
   * 
   * These functions construct payloads and make the actual HTTP requests
   * to the backend Lambda functions.
   * 
   * IMPORTANT PATTERNS:
   * 
   * 1. Character Database Integration:
   *    All story generation requests include:
   *    - character_database: The actual character data
   *    - character_database_enabled: Toggle state (NOT derived from character existence)
   *    - use_character_database: Compatibility flag
   * 
   *    This allows AI to reference characters even when the database is empty,
   *    or to ignore characters when the toggle is off.
   * 
   * 2. Story Context:
   *    Most requests include ALL story fields (M, T, G, CQ, SUM, S1-S9)
   *    This gives the AI maximum context for generation
   * 
   * 3. Story ID:
   *    Always include storyId for tracking and persistence
   * 
   * ============================================================================
   */

  /**
   * story()
   * Generates complete story (all segments S1-S9)
   * 
   * CRITICAL: Uses characterDatabaseEnabled toggle state, not character count
   * This allows the AI to work with character constraints even when no
   * characters exist yet (e.g., "write with 3 characters")
   */
  const story = async (formData: FormData) => {
    console.log('🎭 Full story generation - checking characters:', {
      hasCharacters: !!(data.characters && Object.keys(data.characters).length > 0),
      characterCount: data.characters ? Object.keys(data.characters).length : 0,
      characterNames: data.characters ? Object.keys(data.characters) : [],
      characterDatabaseEnabled: characterDatabaseEnabled
    });

    return await axios.post(`${process.env.REACT_APP_URL}/story`, {
      "event": "story",
      "content": model,
      "userId": token?.payload['cognito:username'],

      /**
       * CHARACTER DATABASE INTEGRATION
       * CRITICAL: Use the toggle state, not character existence
       * This allows AI to work with character mode even with 0 characters
       */
      "character_database": data.characters || {},
      "character_database_enabled": characterDatabaseEnabled,
      "use_character_database": characterDatabaseEnabled,

      // Story fields
      "M": getFieldContent('M'),
      "T": getFieldContent('T'),
      "G": getFieldContent('G'),
      "CQ": getFieldContent('CQ'),
      "SUM": getFieldContent('SUM'),
      "BRAINSTORM": getFieldContent('BRAINSTORM'),
      "S1": getFieldContent('S1'),
      "S2": getFieldContent('S2'),
      "S3": getFieldContent('S3'),
      "S4": getFieldContent('S4'),
      "S5": getFieldContent('S5'),
      "S6": getFieldContent('S6'),
      "S7": getFieldContent('S7'),
      "S8": getFieldContent('S8'),
      "S9": getFieldContent('S9'),

      // Story ID
      "storyId": data?.storyId
    },
      { headers: { "Authorization": token.toString() } }
    );
  };

  /**
   * generateSegment()
   * Generates a single story segment (S1-S9)
   * 
   * IMPORTANT: Includes all story context for consistency
   * Character database integration follows same pattern as story()
   */
  const generateSegment = async (segmentId: string) => {
    console.log('generateSegment called for:', segmentId);
    console.log('🚀 generateSegment: Current data context:', {
      M: getFieldContent('M')?.substring(0, 50) + '...',
      T: getFieldContent('T')?.substring(0, 50) + '...',
      G: getFieldContent('G'),
      CQ: getFieldContent('CQ')?.substring(0, 50) + '...',
      SUM: getFieldContent('SUM')?.substring(0, 50) + '...',
      hasCharacters: !!(data.characters && Object.keys(data.characters).length > 0),
      characterCount: data.characters ? Object.keys(data.characters).length : 0,
      characterNames: data.characters ? Object.keys(data.characters) : [],
      characterDatabaseEnabled: characterDatabaseEnabled,
      modelOverride: getModelForAPI()  // ✨ Log the model override
    });

    const payload = {
      "event": "segment",
      "content": model,
      "userId": token?.payload['cognito:username'],
      "requested_segment": segmentId,

      // ✨ Multi-provider support - pass model override
      "modelOverride": getModelForAPI(),

      /**
       * CHARACTER DATABASE INTEGRATION
       * Same pattern as story() - use toggle state
       */
      "character_database": data.characters || {},
      "character_database_enabled": characterDatabaseEnabled,
      "use_character_database": characterDatabaseEnabled,

      // Include ALL story context for consistency
      "M": getFieldContent('M'),
      "T": getFieldContent('T'),
      "G": getFieldContent('G'),
      "CQ": getFieldContent('CQ'),
      "SUM": getFieldContent('SUM'),
      "BRAINSTORM": getFieldContent('BRAINSTORM'),
      "S1": getFieldContent('S1'),
      "S2": getFieldContent('S2'),
      "S3": getFieldContent('S3'),
      "S4": getFieldContent('S4'),
      "S5": getFieldContent('S5'),
      "S6": getFieldContent('S6'),
      "S7": getFieldContent('S7'),
      "S8": getFieldContent('S8'),
      "S9": getFieldContent('S9'),

      // Story ID for tracking
      "storyId": data?.storyId
    };

    console.log('🚀 generateSegment FULL payload:', payload);
    console.log('📊 Payload details:', {
      event: payload.event,
      requested_segment: payload.requested_segment,
      userId: payload.userId,
      model: payload.content,
      modelOverride: payload.modelOverride,  // ✨ Log model override
      storyId: payload.storyId,

      // Character database check
      hasCharacterDatabase: Object.keys(payload.character_database).length > 0,
      characterDatabaseEnabled: payload.character_database_enabled,
      useCharacterDatabase: payload.use_character_database,
      characterCount: Object.keys(payload.character_database).length,
      characterNames: Object.keys(payload.character_database),

      // Payload size
      payloadSize: JSON.stringify(payload).length + ' bytes'
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 generateSegment response received');
      return response;

    } catch (error: any) {
      console.error(' generateSegment axios error:', error);
      throw error;
    }
  };

  /**
   * generateFoundation()
   * Extracts foundation (logline) from brainstorm
   * 
   * IMPORTANT: Randomly selects a hook pattern and appends it
   * to the brainstorm content. This guides the AI to create
   * more compelling loglines.
   */
  const generateFoundation = async () => {
    console.log('🎯 Generating foundation from brainstorm');

    /**
     * HOOK PATTERN SELECTION
     * Randomly select one of three patterns:
     * - contradictory_fusion: Opposite concepts merged
     * - ironic_reversal: Situation opposite of expectation
     * - necessary_fear: Must face what they fear most
     */
    const hookPatterns = [
      'contradictory_fusion',
      'ironic_reversal',
      'necessary_fear'
    ];
    const randomHookPattern = hookPatterns[Math.floor(Math.random() * hookPatterns.length)];

    console.log('🎲 Randomly selected hook pattern:', randomHookPattern);

    const brainstormContent = getFieldContent('BRAINSTORM');

    // Append hook pattern instruction to brainstorm
    const enhancedInput = `${brainstormContent}\n\nhook_pattern: "${randomHookPattern}"`;

    const payload = {
      "event": "foundation_extraction",
      "userId": token?.payload['cognito:username'],
      "raw_plot_input": enhancedInput
    };

    console.log('🚀 Foundation extraction payload:', {
      event: payload.event,
      userId: payload.userId,
      inputLength: payload.raw_plot_input.length,
      selectedHookPattern: randomHookPattern
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Foundation extraction response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Foundation extraction axios error:', error);
      throw error;
    }
  };

  /**
   * generateSynopsisFromFoundation()
   * Expands foundation (logline) into full synopsis
   */
  /**
   * generateSynopsisFromFoundation()
   * Expands foundation (logline) into full synopsis
   * Now includes raw brainstorm and story metadata for richer context
   */
  const generateSynopsisFromFoundation = async (foundationData: any) => {
    console.log('🎯 Generating synopsis from foundation');

    // Get the raw brainstorm content for additional context
    const brainstormContent = getFieldContent('BRAINSTORM');

    // Get existing story metadata if populated
    const storyMetadata = {
      M: getFieldContent('M'),   // Mood & Setting
      G: getFieldContent('G'),   // Genre
      T: getFieldContent('T'),   // Theme
      CQ: getFieldContent('CQ')  // Core Question
    };

    const payload = {
      "event": "synopsis_expansion",
      "userId": token?.payload['cognito:username'],
      "foundation": foundationData,
      "raw_plot_input": brainstormContent,
      "story_metadata": storyMetadata
    };

    console.log('🚀 Synopsis expansion payload:', {
      event: payload.event,
      userId: payload.userId,
      foundation: payload.foundation,
      rawInputLength: payload.raw_plot_input?.length || 0,
      hasMetadata: Object.values(storyMetadata).some(v => v && v.trim())
    });

    try {
      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, payload, {
        headers: { "Authorization": token.toString() }
      });

      console.log('🚀 Synopsis expansion response:', response);
      return response;
    } catch (error) {
      console.error('🚀 Synopsis expansion axios error:', error);
      throw error;
    }
  };
  /**
   * END OF API CALL FUNCTIONS
   */

  /**
   * LEGACY HANDLERS
   * These are older patterns being phased out
   */

  const handleSummarySubmit = () => {
    clearField('SUM');
    mutateSummary.mutate(new FormData());
  };

  const handleStorySubmit = () => {
    if (!canGenerate) {
      toast.error("Add a brainstorm, summary, or at least one field to generate your story.");
      return;
    }
    // Snapshot the plan BEFORE dispatching — overlay uses this frozen copy
    // so progress doesn't shift when the response comes back and data updates.
    setActivePlanSnapshot(currentOutlinePlan);
    mutateStory.mutate(new FormData());
  };

  const handleSave = (title: string) => {
    if (title.length == 0) {
      toast.error("Please enter a title");
    } else if (title == data.title) {
      toast.error("Please enter a new title");
    } else {
      mutateSave.mutate({ title: title, storyId: data.storyId });
    }
  };

  const [expandRequestId, setExpandRequestId] = useState<string | null>(null);

  const handleExpand = (targetId: string) => {
    expandSegment(targetId)
    console.log("targetId:", targetId);
    setExpandRequestId(null);
    setTimeout(() => setExpandRequestId(targetId), 0);
  };

  const expandSegment = (segmentId: string) => {
    if (segmentId === "act-1") {
      setActIExpanded(true);
      return;
    }
    if (segmentId === "act-2") {
      setActIIExpanded(true);
      return;
    }
    if (segmentId === "act-3") {
      setActIIIExpanded(true);
      return;
    }
    setSegmentExpanded(prev => ({
      ...prev,
      [segmentId]: true
    }));

    const id = segmentId.toLowerCase();

    if (["s1", "s2", "s3"].includes(id)) {
      setActIExpanded(true);
    } else if (["s4", "s5", "s6"].includes(id)) {
      setActIIExpanded(true);
    } else if (["s7", "s8", "s9"].includes(id)) {
      setActIIIExpanded(true);
    }
  };

  /**
   * LOADING STATE CHECK
   * Show spinner while user data is loading
   */
  if (loading == false) {
    return (
      <div style={{
        position: 'relative',
        left: '50%',
        top: '300px',
      }}>
        <TailSpin stroke="#FFA500" speed="1.3" />
      </div>
    );
  }

  /**
   * ============================================================================
   * RENDER SECTION
   * ============================================================================
   * 
   * Component structure:
   * 
   * Theme (Radix UI wrapper)
   *   └── Toaster (notifications)
   *   └── Header (nav bar)
   *   └── StoryNavigation (floating story selector)
   *   └── StackedActionButtons (right sidebar with character management)
   *   └── Main content area
   *       └── WebSocket status indicator
   *       └── Selection mode indicator (when intern mode active)
   *       └── Saved indicator
   *       └── FreeformBrainstorming (BRAINSTORM field + workflow)
   *       └── StoryFoundation (M, T, G, CQ fields)
   *       └── StoryContext (metadata context)
   *       └── StorySummary (SUM field)
   *       └── Acts (StoryAct components)
   *           └── Segments (S1-S9)
   *       └── StoryActions (Generate Story, Save buttons)
   *   └── Footer
   * 
   * ============================================================================
   */

  return (
    <Theme>
      {/* Toast notifications */}
      <Toaster position="top-center" reverseOrder={false} />
      {activePlanSnapshot && (
        <OutlineGenerationOverlay
          isVisible={mutateStory.isLoading}
          plan={activePlanSnapshot.plan}
          estimated={activePlanSnapshot.estimated}
        />
      )}
      {brainstormEstimate && (
        <OutlineGenerationOverlay
          isVisible={isProcessingBrainstorm}
          estimated={brainstormEstimate}
        />
      )}
      <div className="fixed top-[74px] left-[20px] flex items-center gap-1 text-white font-inter bg-[linear-gradient(135deg,rgba(255,107,53,0.8)_0%,rgba(255,140,66,0.8)_100%)] shadow px-4 py-1 rounded-b-lg text-xs font-thin z-[1999] ">
        {isSaving ? (
          <>
            {/* OPTION: animate-spin */}
            <Loader className="w-3 h-3" />
            <span>Saving...</span>
          </>
        ) : lastSaved ? (
          <>
            <CheckCircle className="w-3 h-3" />
            <span>Saved at {formatTime(lastSaved)}</span>
          </>
        ) : null}
      </div>

      {/* Fixed header */}
      <Header signOut={signOut} isScrolled={isScrolled} />

      {/* Floating story navigation */}
      {/* <StoryNavigation
        isScrolled={isScrolled}
        storyTitle={data.title || "Untitled Story"}
        onTitleChange={handleTitleChange}
        onNewStory={() => setOpenNewStory(true)}
        hasUnsavedChanges={hasUnsavedChanges}
      /> */}

      <NewStoryModal
        isOpen={openNewStory}
        onClose={() => setOpenNewStory(false)}
        onSubmit={handleNewStory}
      />

      {
        showTutorialHint && (
          <>
            <div
              className={`
              fixed inset-0 bg-black/40 backdrop-blur-[1px] z-[9990]
              ${isClosing ? "animate-fadeOut" : "animate-fadeIn"}
            `}
            // onClick={handleCloseHint}
            />
            <div className="absolute right-[82px] top-[48px] z-[9998]">
              <div
                className={`relative px-4 py-4 rounded-lg bg-[rgba(255,108,53,0.15)] border border-[#ff6b35]
              text-[#ff8c42] text-sm font-medium shadow-[0_0_12px_rgba(255,108,53,0.6)] backdrop-blur-md flex flex-col items-start
                ${isClosing ? "animate-fadeOut" : "animate-fadeIn"}
              `}
              >
                <span className="inline-flex flex-wrap items-center gap-1 leading-relaxed">
                  Hi, {token?.payload?.preferred_username}, we noticed you're new here!
                </span>

                <span className="inline-flex flex-wrap items-center gap-1 leading-relaxed mt-1">
                  If you'd like some guidance, you can find it by opening the menu
                  <Menu className="w-4 h-4 inline-block" />
                  and choosing “Help”
                  <LifeBuoy className="w-4 h-4 inline-block" />.
                </span>

                <button
                  className="mt-3 px-3 py-1 rounded-lg bg-[#ff6b35] text-black font-semibold hover:bg-[#ff8c42] transition shadow-[0_0_6px_rgba(255,108,53,0.6)]"
                  onClick={handleCloseHint}
                >
                  Close
                </button>

                <div
                  className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-0 h-0 
                border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[10px] border-l-[#ff6b35]"
                />
              </div>
            </div>
          </>
        )
      }

      {/* Right sidebar with character management and tools */}
      <StackedActionButtons
        ref={stackedActionButtonsRef}
        characters={effectiveCharacters}
        onAddCharacter={effectiveAddCharacter}
        onUpdateCharacter={effectiveUpdateCharacter}
        onDeleteCharacter={effectiveDeleteCharacter}
        onClearAllFields={clearAllFields}
        setNewModel={toggleModel}
        onInternToggle={() => {
          console.log('🔧 Home: Main intern button clicked, current panel open:', internPanelOpen);
          if (internPanelOpen) {
            handleInternClose();
          } else {
            setIsInternSelectionMode(true);
            if (stackedActionButtonsRef.current && stackedActionButtonsRef.current.openInternPanel) {
              stackedActionButtonsRef.current.openInternPanel();
            }
          }
        }}
        isInternActive={isInternSelectionMode || forceInternPanelOpen}
        currentModel={model}

        /**
         * Enhanced storyData with character database
         * Includes all fields needed for intern AI iteration
         */
        storyData={{
          ...data,
          storyId: data.storyId,
          character_database: data.characters || {},
          character_database_enabled: !!(data.characters && Object.keys(data.characters).length > 0)
        }}

        /**
         * Intern response handler
         * Receives updated fields from intern AI and saves them
         * 
         * CRITICAL: This handler ensures immediate save after intern updates
         * Uses the explicit data-passing pattern to avoid stale state
         */
        onStoryUpdate={(internResponse: any) => {
          console.log('🔧 Intern response received:', internResponse);
          console.log('🔧 Full intern response structure:', JSON.stringify(internResponse, null, 2));

          const updatedFields = internResponse.story || {};

          if (!updatedFields || Object.keys(updatedFields).length === 0) {
            console.warn('⚠️ No fields to update from intern response');
            return;
          }

          // Safety check for field mapping
          if (updatedFields.story_summary !== undefined && updatedFields.SUM === undefined) {
            console.log('📝 Safety check: Mapping story_summary to SUM');
            updatedFields.SUM = updatedFields.story_summary;
            delete updatedFields.story_summary;
          }

          console.log('📝 Fields to update:', {
            fields: Object.keys(updatedFields),
            fieldCount: Object.keys(updatedFields).length,
            hasSUM: 'SUM' in updatedFields,
            SUMContent: updatedFields.SUM ? `${updatedFields.SUM.substring(0, 50)}...` : null
          });

          console.log('📝 Current data state before merge:', {
            hasStoryId: !!data.storyId,
            storyId: data.storyId,
            hasTitle: !!data.title,
            title: data.title,
            currentSUM: data.SUM ? `${data.SUM.substring(0, 30)}...` : 'EMPTY'
          });

          // Merge updated fields with existing data
          const newData = {
            ...data,
            ...updatedFields
          };

          console.log('📝 New data state after merge:', {
            hasStoryId: !!newData.storyId,
            storyId: newData.storyId,
            hasSUM: !!newData.SUM,
            SUMLength: newData.SUM ? newData.SUM.length : 0,
            SUMPreview: newData.SUM ? `${newData.SUM.substring(0, 50)}...` : 'EMPTY',
            modifiedFields: Object.keys(updatedFields)
          });

          // Update local state
          setData(newData);

          /**
           * CRITICAL: Force immediate database save
           * Uses explicit data passing to avoid stale state
           */
          console.log('💾 === FORCING IMMEDIATE DATABASE SAVE ===');
          console.log('💾 Saving with storyId:', newData.storyId);
          console.log('💾 Saving with title:', newData.title);
          console.log('💾 Modified fields:', Object.keys(updatedFields));

          const savePromise = handleDebouncedSave(newData, true);

          if (savePromise && typeof savePromise.then === 'function') {
            savePromise
              .then((result: any) => {
                console.log('✅ Intern changes saved successfully to database:', result);

                if (result?.data?.statusCode === 200) {
                  console.log('✅ Database confirmed save with status 200');
                }
              })
              .catch((error: any) => {
                console.error('❌ Failed to save intern changes to database:', error);
                toast.error('Failed to save intern changes to database');
              });
          } else {
            console.log('💾 Save initiated (no promise returned)');
          }

          // Update token balance if provided
          if (internResponse.cap !== undefined) {
            console.log('💰 Updating token balance from intern:', internResponse.cap);
            setUser((user: any) => ({ ...user, cap: internResponse.cap }));
          }

          // Show explanation if available
          if (internResponse.comments || internResponse.explanation) {
            console.log('💬 Intern explanation:', internResponse.comments || internResponse.explanation);
          }

          // Show success notification
          setTimeout(() => {
            toast.success('Intern changes applied and saved!');
          }, 500);

          /**
           * Safety check fallback
           * Verifies save completed after 3 seconds
           * Attempts direct save if changes weren't persisted
           */
          setTimeout(() => {
            console.log('🔒 Safety check: Verifying data was saved');

            if (data.storyId && Object.keys(updatedFields).length > 0) {
              const currentData = data;

              const changesPresent = Object.keys(updatedFields).every(field => {
                return currentData[field] === updatedFields[field];
              });

              if (!changesPresent) {
                console.warn('⚠️ Changes may not have been saved, attempting direct save');

                if (mutateSave && mutateSave.mutate) {
                  mutateSave.mutate({
                    title: currentData.title || 'Untitled Story',
                    storyId: currentData.storyId
                  });
                }
              } else {
                console.log('✅ Safety check passed: Changes are present in data');
              }
            }
          }, 3000);
        }}

        onDeselectAll={() => setInternSelectedFields(new Set())}
        onSelectAll={() => {
          const allFields = ['G', 'T', 'M', 'CQ', 'SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
          setInternSelectedFields(new Set(allFields));
        }}
        selectedFields={internSelectedFields}
        isInternSelectionMode={isInternSelectionMode}
        onInternModeChange={(newMode: boolean) => {
          console.log(`🔧 StackedActionButtons wants to change intern mode to: ${newMode}`);
          setIsInternSelectionMode(newMode);
        }}
        internSelectedFields={internSelectedFields}
        onFieldSelectionChange={setInternSelectedFields}
        onInternPanelStateChange={(isOpen: boolean, width: number) => {
          console.log(`🔧 Panel state change - isOpen: ${isOpen}, width: ${width}`);
          setInternPanelOpen(isOpen);
          setInternPanelWidth(width);

          // Clear fields when panel closes
          if (!isOpen && isInternSelectionMode && internPanelOpen) {
            console.log(`🔧 Panel actually closed, clearing selection`);
            setIsInternSelectionMode(false);
            setInternSelectedFields(new Set());
          }
        }}
        forceInternOpen={forceInternPanelOpen}
        onNewStory={() => setOpenNewStory(true)}
        handleCloseHint={handleCloseHint}
      />

      <StoryNavigationSidebar
        isScrolled={isScrolled}
        storyTitle={data.title || "Untitled Story"}
        onTitleChange={handleTitleChange}
        onNewStory={() => setOpenNewStory(true)}
        hasUnsavedChanges={hasUnsavedChanges}
        onExpand={handleExpand}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onActsReady={isActsReady}
      >
        {/* Main content container with dynamic margin for sidebar */}
        <div
          className="app-container"
          style={{
            paddingBottom: '5rem',
            marginLeft: '40px',
            marginRight: internPanelOpen ? `${internPanelWidth + 100}px` : '40px',
            transition: 'margin-right 0.3s ease',
            minWidth: internPanelOpen ? `calc(100vw - ${internPanelWidth + 200}px)` : 'auto'
          }}
        >
          <div className="gradient-background"></div>

          {/* <Box
            style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              background: isConnected ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              zIndex: 1003,
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: wsError ? 1 : 0.7
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isConnected ? '#10b981' : '#ef4444'
              }}
            />
            {isConnected ? 'Connected' : 'Disconnected'}
            {wsError && <span style={{ fontSize: '10px' }}>({wsError})</span>}
          </Box> */}

          {/* Character Update Notification */}
          {showCharacterUpdate && (
            <Box
              style={{
                position: 'fixed',
                top: '80px',
                right: '20px',
                background: 'rgba(34, 197, 94, 0.95)',
                color: 'white',
                padding: '0.75rem 1.5rem',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                zIndex: 1003,
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                animation: 'slideInFromRight 0.3s ease-out',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              Characters updated!
            </Box>
          )}

          {/* Selection Mode Indicator (shows when intern mode is active) */}
          {isInternSelectionMode && (
            <Box
              style={{
                position: 'fixed',
                top: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(59, 130, 246, 0.9)',
                color: 'white',
                padding: '0.5rem 1.5rem',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: '600',
                zIndex: 1002,
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                animation: 'slideInFromTop 0.3s ease-out',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              Selection Mode - Click fields to select for iteration
              <button
                onClick={handleInternClose}
                style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '12px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
                title="Close Intern Selection Mode"
              >
                ×
              </button>
            </Box>
          )}

          <Flex direction="column" justify="center" align="center" style={{ flexGrow: 1, position: 'relative' }}>
            {/* Saved indicator */}
            <Box
              className="saved-indicator"
              style={{
                opacity: showSavedIndicator ? 1 : 0,
                pointerEvents: 'none',
              }}
            >
              {isSaving ? 'Saving...' : 'Saved'}
            </Box>

            <Flex style={{
              width: '100%',
              justifyContent: 'center',
              position: 'relative',
              paddingTop: '0rem'
            }}>
              <Flex
                className="main-content-wrapper"
                style={{
                  width: '100%',
                  maxWidth: '80rem',
                  margin: '0 auto',
                  transition: 'all 0.3s ease-in-out',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'row'
                }}
              >
                <Flex
                  direction="column"
                  width="100%"
                  align="center"
                  className="text-areas-background"
                  ref={wrapperRef}
                  style={{
                    flexShrink: 0,
                    position: 'relative',
                    transition: 'all 0.3s ease-in-out'
                  }}
                >
                  {/* <Box
                  className="white-container"
                  style={{
                    position: 'relative',
                    bottom: '1.25rem',
                    width: '100%',
                    margin: '1.5625rem 0',
                    zIndex: 2,
                    display: 'flex',
                    justifyContent: 'space-between',
                    transition: 'all 0.3s ease-in-out',
                  }}
                > */}
                  <Flex
                    direction="column"
                    style={{
                      width: '100%',
                      transition: 'all 0.3s ease-in-out',
                      position: 'relative',
                      zIndex: 2,
                      marginTop: '-0.625rem',
                    }}
                  >
                    <StoryBreadcrumbHeader
                      storyTitle={data.title || "Untitled Story"}
                      onTitleChange={handleTitleChange}
                      onNewStory={() => setOpenNewStory(true)}
                      hasUnsavedChanges={hasUnsavedChanges}
                    />
                    {/* 
                      FREEFORM BRAINSTORMING COMPONENT
                      New workflow: User writes brainstorm, processes into structure
                      Includes modal for foundation review
                    */}
                    <FreeformBrainstorming
                      id="storyBrainstorming"
                      data={data}
                      onChange={handleChange}
                      onClearField={clearField}
                      customLabels={customLabels}
                      internSelectedFields={internSelectedFields}
                      onFieldSelection={handleFieldSelection}
                      isInternSelectionMode={isInternSelectionMode}
                      onProcess={handleProcessBrainstorm}
                      isProcessing={isProcessingBrainstorm}
                      onInternToggle={handleInternToggle}
                      onGenerate={handleGenerate}
                      isInternActive={internPanelOpen}
                      fieldLoadingStates={fieldLoadingStates}
                      expandRequestId={expandRequestId}
                      isAnyFieldGenerating={isAnyFieldGenerating}
                    />
                    {/* Story metadata fields (M, T, G, CQ) */}
                    <StoryFoundation
                      id="storyFoundation"
                      data={data}
                      onChange={handleChange}
                      onClearField={clearField}
                      customLabels={customLabels}
                      internSelectedFields={internSelectedFields}
                      onFieldSelection={handleFieldSelection}
                      isInternSelectionMode={isInternSelectionMode}
                      onInternToggle={handleInternToggle}
                      onGenerate={handleGenerate}
                      fieldLoadingStates={fieldLoadingStates}
                      isInternActive={internPanelOpen}
                      isAnyFieldGenerating={isAnyFieldGenerating}
                    />

                    <Box data-field="SUM">
                      <StorySummary
                        id="storySummary"
                        data={data}
                        onChange={handleChange}
                        onClearField={clearField}
                        customLabels={customLabels}
                        internSelectedFields={internSelectedFields}
                        onFieldSelection={handleFieldSelection}
                        isInternSelectionMode={isInternSelectionMode}
                        onInternToggle={handleInternToggle}
                        onGenerate={handleGenerate}
                        fieldLoadingStates={fieldLoadingStates}
                        isInternActive={internPanelOpen}
                        onOpenCanvas={(field) => setCanvasSegment(field)}
                        isAnyFieldGenerating={isAnyFieldGenerating}
                      />
                    </Box>


                    {/* Story structure: Acts and Segments */}
                    <Box style={{ backgroundColor: 'transparent', width: '100%', marginBottom: '12px' }}>
                      {acts.map(act => (
                        <StoryAct
                          id={act.id}
                          key={act.number}
                          actNumber={act.number}
                          actTitle={act.title}
                          actSubtitle={act.subtitle}
                          segments={act.segments}
                          isExpanded={act.isExpanded}
                          onToggleAct={() => act.setExpanded(!act.isExpanded)}
                          onExpandAllSegments={() => expandAllSegmentsInAct(act.segments.map(s => s.id))}
                          onCollapseAllSegments={() => collapseAllSegmentsInAct(act.segments.map(s => s.id))}
                          allSegmentsExpanded={act.segments.every(seg => segmentExpanded[seg.id])}
                          data={data}
                          customLabels={customLabels}
                          segmentExpanded={segmentExpanded}
                          segmentHovered={segmentHovered}
                          onToggleSegmentExpansion={toggleSegmentExpansion}
                          onSegmentMouseEnter={(segmentId) => setSegmentHovered(prev => ({ ...prev, [segmentId]: true }))}
                          onSegmentMouseLeave={(segmentId) => setSegmentHovered(prev => ({ ...prev, [segmentId]: false }))}
                          onChange={handleChange}
                          onClearField={clearField}
                          fieldLoadingStates={fieldLoadingStates}
                          internSelectedFields={internSelectedFields}
                          onFieldSelection={handleFieldSelection}
                          isInternSelectionMode={isInternSelectionMode}
                          onInternToggle={handleInternToggle}
                          onGenerate={handleGenerate}
                          isInternActive={internPanelOpen}
                          onCanvasMode={handleCanvasMode}
                          isAnyFieldGenerating={isAnyFieldGenerating}
                        />
                      ))}
                    </Box>

                    {/* Action buttons (Save, Generate Story) */}
                    <StoryActions
                      onSave={handleSave}
                      onGenerateStory={handleStorySubmit}
                      isGenerating={mutateStory.isLoading}
                      currentTitle={data.title || ""}
                      canGenerate={canGenerate}
                      actsReady={isActsReady}
                      hasSegmentContent={hasSegmentContent}
                      segmentsAllPopulated={segmentsAllPopulated}
                    />
                  </Flex>
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        </div>
      </StoryNavigationSidebar>
      <ErrorModal
        open={errorOpen}
        onClose={() => setErrorOpen(false)}
        title="Storage limit reached"
        message={
          <>
            <span className="font-medium text-white">
              Ran out of space.
            </span>{" "}
            Please delete a saved work.
          </>
        }
      />

      {canvasSegment && (
        <CanvasOverlay
          storyId={data.storyId}
          segmentId={canvasSegment}
          segmentTitle={customLabels[canvasSegment] || canvasSegment}
          segmentContent={getFieldContent(canvasSegment)}
          onClose={handleCanvasClose}
          onContentChange={handleCanvasContentChange}
          onNavigatePrev={handleCanvasNavigatePrev}
          onNavigateNext={handleCanvasNavigateNext}
          hasPrev={canvasHasPrev}
          hasNext={canvasHasNext}
          storyData={{
            brainstorm: getFieldContent('BRAINSTORM'),
            synopsis: getFieldContent('SUM'),
            segment1: getFieldContent('S1'),
            segment2: getFieldContent('S2'),
            segment3: getFieldContent('S3'),
            segment4: getFieldContent('S4'),
            segment5: getFieldContent('S5'),
            segment6: getFieldContent('S6'),
            segment7: getFieldContent('S7'),
            segment8: getFieldContent('S8'),
            segment9: getFieldContent('S9'),
          }}
        />
      )}
      {/*<Footer />*/}
    </Theme >
  );
}

export default Home;