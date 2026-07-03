import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { Amplify } from 'aws-amplify';
import Header from './header';
import Footer from './footer';
import { useMutation } from "react-query";
import '@aws-amplify/ui-react/styles.css';
import config from '../aws-exports';
import { Theme, Flex, Text, Button, Grid, Box, Container, Dialog, TextField, ScrollArea, Tooltip } from '@radix-ui/themes';
import axios from 'axios';
import { UserContext } from '../App';
import '@radix-ui/themes/styles.css';
import { TailSpin } from 'react-loading-icons';
import { toast, Toaster } from 'react-hot-toast';
import { User } from '../models/user';
import { Plus, Trash, Edit, AlignLeft, Save, ArrowUp, ArrowDown } from 'lucide-react';
import './scenes.css';
import StoryNavigation from './Home/StoryNavigation';
import ScenesActionButtons from './ScenesActionButtons';
import { useWebSocket } from '../lib/useWebSocket';
import { SegmentScenesView } from './Scenes/SegmentScenesView';
import { isDesktop } from '../lib/ipcClient';
import { cacheDataToCanonical } from '../features/story-workspace/model/cacheDataAdapter';
import { saveScenes } from '../features/scenes/model/saveScenes';
import '../styles/Home/StackedActionButtons.css'
import { useScrollBehavior } from './useScrollBehavior';
import { debounce } from 'lodash';
import StoryNavigationSidebar from './Home/StoryNavigationTab';
import type { ActItem, ActStats, SegmentStats } from "../models/acts"
import { ScenesCanvasOverlay } from './ScenesCanvas';

Amplify.configure(config);

// ============================================
// INTERFACES
// ============================================

interface Scene {
  sceneId: string;
  title: string;
  content: string;
  isExpanded?: boolean;
  metadata?: Record<string, any>;
}

interface SegmentWithScenes {
  id: string;
  title: string;
  content?: string;
  scenes: Scene[];
  isSelected?: boolean;
  act: number;
  description: string;
}

interface StoryData {
  M: string;
  T: string;
  G: string;
  CQ: string;
  SUM: string;
  S1: string | any;
  S2: string | any;
  S3: string | any;
  S4: string | any;
  S5: string | any;
  S6: string | any;
  S7: string | any;
  S8: string | any;
  S9: string | any;
  [key: string]: any;
}

interface StoryMetadata {
  M: string;
  T: string;
  G: string;
  CQ: string;
  SUM: string;
}

interface FormattedScene {
  sceneId: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
}

interface FormattedSegment {
  id: string;
  title: string;
  description: string;
  scenes: FormattedScene[];
}

interface FormattedStoryData {
  story_metadata: StoryMetadata;
  segments: FormattedSegment[];
}

interface LambdaLog {
  timestamp: string;
  requestId: string;
  level: 'info' | 'error' | 'warning' | 'debug';
  message: string;
  data?: any;
}

interface LogDisplayProps {
  logs: LambdaLog[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique scene ID
 */
function generateSceneId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `scene_${timestamp}_${random}`;
}

/**
 * Parse scenes from either array or object format (for backward compatibility)
 */
const parseScenesFromData = (segmentData: any): Scene[] => {
  if (!segmentData?.scenes) return [];

  // New array format
  if (Array.isArray(segmentData.scenes)) {
    return segmentData.scenes.map((scene: any) => ({
      sceneId: scene.sceneId,
      title: scene.title || '',
      content: scene.description || scene.content || '',
      isExpanded: false,
      metadata: scene.metadata || {}
    }));
  }

  // Legacy object format support
  return Object.entries(segmentData.scenes).map(([id, scene]: [string, any]) => ({
    sceneId: id,
    title: scene.title || '',
    content: scene.description || scene.content || '',
    isExpanded: false,
    metadata: scene.metadata || {}
  }));
};

// ============================================
// LOG DISPLAY COMPONENT
// ============================================

const LogDisplay = ({ logs }: LogDisplayProps) => {
  if (!logs || logs.length === 0) return null;

  return (
    <Box style={{
      marginTop: '1rem',
      padding: '1rem',
      backgroundColor: '#1a1a1a',
      border: '1px solid #3a3a3a',
      borderRadius: '0.5rem',
      maxHeight: '500px',
      overflow: 'auto'
    }}>
      <Text size="3" weight="bold" style={{ marginBottom: '0.75rem', color: '#e0e0e0' }}>Lambda Execution Logs</Text>

      {logs.map((log: LambdaLog, index: number) => (
        <Box
          key={index}
          style={{
            padding: '0.5rem',
            margin: '0.25rem 0',
            backgroundColor: log.level === 'error' ? 'rgba(255, 100, 100, 0.2)' : 'rgba(60, 60, 60, 0.5)',
            borderRadius: '0.25rem',
            borderLeft: `3px solid ${log.level === 'error' ? '#ff6b6b' : log.level === 'warning' ? '#ffd166' : '#4dabf7'}`,
            fontSize: '0.85rem'
          }}
        >
          <Flex justify="between" align="center" style={{ marginBottom: '0.25rem' }}>
            <Text size="1" style={{ color: '#a0a0a0' }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </Text>
            <Text
              size="1"
              style={{
                textTransform: 'uppercase',
                backgroundColor: log.level === 'error' ? '#5a2a2a' : log.level === 'warning' ? '#5a4a2a' : '#2a3a5a',
                color: log.level === 'error' ? '#ffcccc' : log.level === 'warning' ? '#fff3cd' : '#cce7ff',
                padding: '0.1rem 0.4rem',
                borderRadius: '0.25rem',
                fontWeight: 'bold'
              }}
            >
              {log.level}
            </Text>
          </Flex>

          <Text size="2" style={{ color: '#d0d0d0' }}>
            {log.message}
          </Text>

          {log.data && (
            <Box
              style={{
                marginTop: '0.25rem',
                padding: '0.4rem',
                backgroundColor: '#323232',
                borderRadius: '0.25rem',
                maxHeight: '200px',
                overflow: 'auto',
                border: '1px solid #4a4a4a'
              }}
            >
              <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', color: '#c0c0c0' }}>
                {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
              </pre>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================

export function Scenes(props: any) {
  const {
    user, token, loading, data, setData, debouncedSave, setUser,
    characters, addCharacter, updateCharacter, deleteCharacter,
    characters: contextCharacters,
    saveCharacters: contextSaveCharacters,
    setCharacters: contextSetCharacters,
    setCharacterDatabase: contextSetCharacterDatabase,
    characterDatabaseEnabled,
    isWebSocketUpdating,
    setIsWebSocketUpdating,
    isCharactersLoading,
    setIsCharactersLoading
  } = useContext(UserContext);

  // All state declarations
  const [segments, setSegments] = useState<SegmentWithScenes[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SegmentWithScenes | null>(null);
  const [newSceneContent, setNewSceneContent] = useState("");
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const [generatingScenes, setGeneratingScenes] = useState(false);
  const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);
  const [requestLog, setRequestLog] = useState<string | null>(null);
  const [responseLog, setResponseLog] = useState<string | null>(null);
  const [expandedAct, setExpandedAct] = useState<number>(1);
  const [viewMode, setViewMode] = useState<'acts' | 'all'>('acts');
  const [reorganizeMode, setReorganizeMode] = useState(false);
  const [draggedScene, setDraggedScene] = useState<Scene | null>(null);
  const [dropZone, setDropZone] = useState<{ type: 'same' | 'next', segmentId: string, position: number } | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);
  const [showScenesCanvas, setShowScenesCanvas] = useState(false);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [isProcessingCharacters, setIsProcessingCharacters] = useState(false);
  const [lastProcessedMessageId, setLastProcessedMessageId] = useState<string | null>(null);
  const [showCharacterUpdate, setShowCharacterUpdate] = useState(false);
  const [localCharacters, setLocalCharacters] = useState<any[]>([]);
  const effectiveCharacters = contextCharacters || localCharacters;

  const handlePanelStateChange = useCallback((isOpen: boolean) => {
    setIsDetailPanelOpen(isOpen);
  }, []);

  // Ref to access panel toggle handlers from SegmentScenesView
  const stackedButtonCallbacksRef = useRef<{
    handleStackedSuggest: () => void;
    handleStackedRevise: () => void;
    isSuggestActive: boolean;
    isReviseActive: boolean;
  } | null>(null);

  // ============================================
  // WEBSOCKET CHARACTER UPDATES
  // ============================================
  const { isConnected, lastUpdate, error: wsError } = useWebSocket(
    user?.id || token?.payload['cognito:username'],
    data?.storyId
  );
  // Clear dedup on story change
  useEffect(() => {
    if (data?.storyId) setLastProcessedMessageId(null);
  }, [data?.storyId]);

  // Process WebSocket character updates
  useEffect(() => {
    if (lastUpdate && lastUpdate.analysisComplete && !isProcessingCharacters) {
      handleCharacterUpdate(lastUpdate.characters);
    }
  }, [lastUpdate]);

  const handleCharacterUpdate = async (newCharacters: any[]) => {
    const contentId = `${data.storyId}_${newCharacters.length}_${newCharacters.map((c: any) => c.name).sort().join('_')}`;
    if (lastProcessedMessageId === contentId) return;
    if (isWebSocketUpdating) return;

    setLastProcessedMessageId(contentId);
    setIsWebSocketUpdating(true);
    setIsProcessingCharacters(true);

    try {
      const mergedCharacters = mergeCharactersWithLocks(effectiveCharacters, newCharacters);

      if (contextCharacters && contextSetCharacters) {
        contextSetCharacters(mergedCharacters);
        const newCharacterDatabase = mergedCharacters.reduce((acc: any, char: any) => {
          acc[char.name] = char;
          return acc;
        }, {});
        contextSetCharacterDatabase(newCharacterDatabase);
        setData((prevData: any) => ({ ...prevData, characters: newCharacterDatabase }));
      } else {
        setLocalCharacters(mergedCharacters);
        const newCharacterDatabase = mergedCharacters.reduce((acc: any, char: any) => {
          acc[char.name] = char;
          return acc;
        }, {});
        setData((prevData: any) => ({ ...prevData, characters: newCharacterDatabase }));
      }

      await contextSaveCharacters(mergedCharacters);
      setShowCharacterUpdate(true);
      setTimeout(() => setShowCharacterUpdate(false), 3000);
      console.log('✅ Character update processed via WebSocket (scenes view)');
    } catch (error) {
      console.error('💥 Failed to process character update:', error);
      setLastProcessedMessageId(null);
    } finally {
      setIsProcessingCharacters(false);
      setIsWebSocketUpdating(false);
      if (setIsCharactersLoading) setIsCharactersLoading(false);
    }
  };

  const mergeCharactersWithLocks = (existing: any[], incoming: any[]): any[] => {
    const existingMap = new Map(existing.map((char: any) => [char.name, char]));

    const merged = incoming.map((incomingChar: any) => {
      const existingChar = existingMap.get(incomingChar.name);
      if (existingChar?.locked) {
        return { ...existingChar, is_new: false };
      } else if (existingChar) {
        return { ...existingChar, ...incomingChar, locked: existingChar.locked || false, is_new: false };
      } else {
        return { ...incomingChar, locked: false, is_new: true };
      }
    });

    existing.forEach((char: any) => {
      if (char.locked && !merged.find((m: any) => m.name === char.name)) {
        merged.push({ ...char, is_new: false });
      }
    });

    return merged;
  };


  const isScrolled = useScrollBehavior();

  const segmentDescriptions: Record<string, string> = {
    'S1': 'The opening scene or sequence that establishes the protagonist\'s everyday life, grounding the story before any major conflict arises.',
    'S2': 'The event that disrupts the protagonist\'s life, setting the story\'s main conflict in motion and drawing the protagonist into action.',
    'S3': 'A pivotal moment where the protagonist makes a decision or takes an action that commits them to the story\'s central journey, closing off the option to return to their former life.',
    'S4': 'A pressure point that intensifies the conflict, often by revealing new information or escalating tension, reminding the protagonist of the stakes involved.',
    'S5': 'A major turning point where the protagonist experiences a significant realization, shift in perspective, or confrontation that deepens their commitment to the goal or conflict.',
    'S6': 'A critical challenge or obstacle that raises the stakes even higher, often bringing the protagonist to a low point or forcing them to confront their fears.',
    'S7': 'The story\'s darkest moment, where all seems lost for the protagonist, intensifying the drama before the final push toward resolution.',
    'S8': 'The peak of the story\'s action, where the main conflict reaches its most intense point and the protagonist faces their greatest challenge or decision.',
    'S9': 'The story\'s conclusion, showing the outcome of the protagonist\'s journey and resolving any lingering questions or themes.'
  };

  // ============================================
  // SCENE HELPERS
  // ============================================

  const getAllScenesFlat = () => {
    const allScenes: (Scene & { segmentId: string; segmentTitle: string; actNumber: number; displayIndex: number })[] = [];

    segments.forEach(segment => {
      segment.scenes.forEach((scene, index) => {
        allScenes.push({
          ...scene,
          segmentId: segment.id,
          segmentTitle: segment.title,
          actNumber: segment.act,
          displayIndex: index
        });
      });
    });

    return allScenes;
  };

  const selectSceneInAllView = (scene: Scene & { segmentId: string; segmentTitle: string; actNumber: number }) => {
    const parentSegment = segments.find(seg => seg.id === scene.segmentId);
    if (parentSegment) {
      selectSegment(parentSegment);
    }
  };

  /**
   * Get display ID for a scene (e.g., "S1.1", "S2.3")
   */
  const getSceneDisplayId = (segmentId: string, index: number): string => {
    return `${segmentId}.${index + 1}`;
  };

  // ============================================
  // DRAG AND DROP
  // ============================================

  const handleDragEnd = (e: React.DragEvent) => {
    setTimeout(() => {
      if (draggedScene) {
        setDraggedScene(null);
        setDropZone(null);
        setHoveredSegment(null);
        setExpandedSegment(null);
      }
    }, 50);
  };

  const handleDragStart = (e: React.DragEvent, scene: Scene) => {
    if (!reorganizeMode) return;
    setDraggedScene(scene);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, segmentId: string, position: number, isNextSegment: boolean = false) => {
    if (!reorganizeMode || !draggedScene) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    setDropZone({
      type: isNextSegment ? 'next' : 'same',
      segmentId,
      position
    });
  };

  const handleSegmentDragOver = (e: React.DragEvent, segmentId: string) => {
    if (!reorganizeMode || !draggedScene) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    setHoveredSegment(segmentId);
    setExpandedSegment(segmentId);
  };

  const handleSegmentDragLeave = (e: React.DragEvent, segmentId: string) => {
    if (!reorganizeMode || !draggedScene) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setHoveredSegment(null);
      setExpandedSegment(null);
    }
  };

  const handleSegmentDrop = (e: React.DragEvent, segmentId: string) => {
    e.preventDefault();
    if (!reorganizeMode || !draggedScene) return;

    const targetSegment = segments.find(seg => seg.id === segmentId);
    if (targetSegment) {
      handleSceneMove(segmentId, targetSegment.scenes.length);
    }

    setHoveredSegment(null);
    setExpandedSegment(null);
  };

  const [lastMoveTime, setLastMoveTime] = useState(0);

  const handleSceneMove = (targetSegmentId: string, position: number) => {
    const now = Date.now();

    if (now - lastMoveTime < 200) {
      console.log('🟡 Debouncing rapid call to handleSceneMove');
      return;
    }

    setLastMoveTime(now);

    if (!draggedScene) return;

    const currentDraggedScene = draggedScene;

    setDraggedScene(null);
    setDropZone(null);
    setHoveredSegment(null);
    setExpandedSegment(null);

    const sourceSegment = segments.find(seg =>
      seg.scenes.some(scene => scene.sceneId === currentDraggedScene.sceneId)
    );

    if (!sourceSegment) return;

    const targetSegment = segments.find(seg => seg.id === targetSegmentId);
    if (!targetSegment) return;

    const currentPosition = sourceSegment.scenes.findIndex(scene => scene.sceneId === currentDraggedScene.sceneId);

    // INTRA-SEGMENT MOVEMENT
    if (sourceSegment.id === targetSegmentId) {
      if (currentPosition === position || currentPosition + 1 === position) return;

      const updatedScenes = [...sourceSegment.scenes];
      const [movedScene] = updatedScenes.splice(currentPosition, 1);

      let insertPosition = position;
      if (currentPosition < position) {
        insertPosition = position - 1;
      }

      updatedScenes.splice(insertPosition, 0, movedScene);

      const updatedSegments = segments.map(segment =>
        segment.id === sourceSegment.id
          ? { ...segment, scenes: updatedScenes }
          : segment
      );

      setSegments(updatedSegments);

      if (selectedSegment?.id === sourceSegment.id) {
        setSelectedSegment({ ...sourceSegment, scenes: updatedScenes });
      }

      saveScenesToBackend(updatedSegments);
      toast.success(`Scene reordered within ${sourceSegment.title}`);
      return;
    }

    // INTER-SEGMENT MOVEMENT
    const sourceScenes = sourceSegment.scenes.filter(scene => scene.sceneId !== currentDraggedScene.sceneId);
    const targetScenes = [...targetSegment.scenes];
    const newScene = { ...currentDraggedScene };

    targetScenes.splice(position, 0, newScene);

    const updatedSegments = segments.map(segment => {
      if (segment.id === sourceSegment.id) {
        return { ...segment, scenes: sourceScenes };
      }
      if (segment.id === targetSegmentId) {
        return { ...segment, scenes: targetScenes };
      }
      return segment;
    });

    setSegments(updatedSegments);

    if (selectedSegment?.id === sourceSegment.id) {
      setSelectedSegment({ ...sourceSegment, scenes: sourceScenes });
    } else if (selectedSegment?.id === targetSegmentId) {
      setSelectedSegment({ ...targetSegment, scenes: targetScenes });
    }

    saveScenesToBackend(updatedSegments);
    toast.success(`Scene moved from ${sourceSegment.title} to ${targetSegment.title}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!reorganizeMode || !draggedScene || !dropZone) return;

    handleSceneMove(dropZone.segmentId, dropZone.position);
    setDraggedScene(null);
    setDropZone(null);
    setHoveredSegment(null);
    setExpandedSegment(null);
  };

  // ============================================
  // SCENE CRUD OPERATIONS
  // ============================================

  const addSceneAtPosition = (segmentId: string, position: number) => {
    const targetSegment = segments.find(seg => seg.id === segmentId);
    if (!targetSegment) return;

    const newScene: Scene = {
      sceneId: generateSceneId(),
      title: "New Scene",
      content: "",
      isExpanded: true
    };

    const updatedScenes = [...targetSegment.scenes];
    updatedScenes.splice(position, 0, newScene);

    const updatedSegment = { ...targetSegment, scenes: updatedScenes };

    const updatedSegments = segments.map(segment =>
      segment.id === updatedSegment.id ? updatedSegment : segment
    );

    setSegments(updatedSegments);
    if (selectedSegment?.id === targetSegment.id) {
      setSelectedSegment(updatedSegment);
    }

    saveScenesToBackend(updatedSegments);
    toast.success(`New scene added to ${targetSegment.title}`);

    if (reorganizeMode) {
      setReorganizeMode(false);
    }
  };

  // ============================================
  // DATA LOADING
  // ============================================

  useEffect(() => {
    if (!data) return;

    const previouslySelectedId = selectedSegment?.id;

    const segmentsFromData: SegmentWithScenes[] = [
      {
        id: 'S1',
        title: 'Introduction and Stasis',
        content: typeof data.S1 === 'string' ? data.S1 : data.S1?.S || "",
        scenes: parseScenesFromData(data.S1),
        act: 1,
        description: segmentDescriptions.S1,
        isSelected: false
      },
      {
        id: 'S2',
        title: 'Inciting Incident',
        content: typeof data.S2 === 'string' ? data.S2 : data.S2?.S || "",
        scenes: parseScenesFromData(data.S2),
        act: 1,
        description: segmentDescriptions.S2,
        isSelected: false
      },
      {
        id: 'S3',
        title: 'Commitment',
        content: typeof data.S3 === 'string' ? data.S3 : data.S3?.S || "",
        scenes: parseScenesFromData(data.S3),
        act: 1,
        description: segmentDescriptions.S3,
        isSelected: false
      },
      {
        id: 'S4',
        title: 'First Pinch Point',
        content: typeof data.S4 === 'string' ? data.S4 : data.S4?.S || "",
        scenes: parseScenesFromData(data.S4),
        act: 2,
        description: segmentDescriptions.S4,
        isSelected: false
      },
      {
        id: 'S5',
        title: 'Midpoint',
        content: typeof data.S5 === 'string' ? data.S5 : data.S5?.S || "",
        scenes: parseScenesFromData(data.S5),
        act: 2,
        description: segmentDescriptions.S5,
        isSelected: false
      },
      {
        id: 'S6',
        title: 'Second Pinch Point',
        content: typeof data.S6 === 'string' ? data.S6 : data.S6?.S || "",
        scenes: parseScenesFromData(data.S6),
        act: 2,
        description: segmentDescriptions.S6,
        isSelected: false
      },
      {
        id: 'S7',
        title: 'Second Plot Point',
        content: typeof data.S7 === 'string' ? data.S7 : data.S7?.S || "",
        scenes: parseScenesFromData(data.S7),
        act: 3,
        description: segmentDescriptions.S7,
        isSelected: false
      },
      {
        id: 'S8',
        title: 'Climax',
        content: typeof data.S8 === 'string' ? data.S8 : data.S8?.S || "",
        scenes: parseScenesFromData(data.S8),
        act: 3,
        description: segmentDescriptions.S8,
        isSelected: false
      },
      {
        id: 'S9',
        title: 'Resolution',
        content: typeof data.S9 === 'string' ? data.S9 : data.S9?.S || "",
        scenes: parseScenesFromData(data.S9),
        act: 3,
        description: segmentDescriptions.S9,
        isSelected: false
      }
    ];

    const segmentToSelect =
      segmentsFromData.find(s => s.id === previouslySelectedId) ??
      segmentsFromData[0];

    const updatedSegments = segmentsFromData.map(seg => ({
      ...seg,
      isSelected: seg.id === segmentToSelect.id
    }));

    setSegments(updatedSegments);
    setSelectedSegment(segmentToSelect);
  }, [data]);


  // ============================================
  // SEGMENT SELECTION
  // ============================================

  const selectSegment = (segment: SegmentWithScenes) => {
    const updatedSegments = segments.map(seg => ({
      ...seg,
      isSelected: seg.id === segment.id
    }));

    setSegments(updatedSegments);
    setSelectedSegment(segment);

    if (viewMode === 'all') {
      setTimeout(() => {
        const segmentElement = document.getElementById(`segment-container-${segment.id}`);
        if (segmentElement) {
          segmentElement.style.scrollMarginTop = '180px';

          segmentElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });

          segmentElement.classList.add('segment-highlighted');
          setTimeout(() => {
            segmentElement.classList.remove('segment-highlighted');
          }, 2000);
        }
      }, 100);
    }
  };

  // ============================================
  // SCENE UPDATES
  // ============================================
  const handleSelectSegmentFromSidebar = (segmentId: string) => {
    const segment = segments.find(seg => seg.id === segmentId);
    if (!segment) return;

    selectSegment(segment);
  };

  const toggleSceneExpansion = (sceneId: string) => {
    if (!selectedSegment) return;

    const updatedScenes = selectedSegment.scenes.map(scene =>
      scene.sceneId === sceneId ? { ...scene, isExpanded: !scene.isExpanded } : scene
    );

    const updatedSegment = { ...selectedSegment, scenes: updatedScenes };
    updateSegment(updatedSegment);
  };

  const saveScenesToBackend = useCallback((currentSegments?: SegmentWithScenes[]) => {
    const segmentsToSave = currentSegments || segments;

    const updatedData = { ...data };

    if (!updatedData.storyId) {
      updatedData.storyId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      setTimeout(() => {
        debouncedSave(updatedData);
      }, 100);
    }

    // Convert ALL segments to new array format
    segmentsToSave.forEach(segment => {
      let segmentContent = segment.content || '';
      if (!segmentContent && data[segment.id]) {
        if (typeof data[segment.id] === 'string') {
          segmentContent = data[segment.id];
        } else if (data[segment.id]?.S) {
          segmentContent = data[segment.id].S;
        }
      }

      // Use array format for scenes
      updatedData[segment.id] = {
        S: segmentContent,
        scenes: segment.scenes.map(scene => ({
          sceneId: scene.sceneId,
          title: scene.title,
          content: scene.content,
          metadata: scene.metadata || {}
        }))
      };
    });

    setData(updatedData);

    // A3 (local-first / AD-01): no desktop, grava a Story (com scenes) no SQLite +
    // fan-out de sync por segment alterado (save-scenes / delete-scenes COD-001).
    // Substitui o mirror + o POST por-segment. A serialização preserva segments+scenes
    // (RISK-011). Web: mantém o POST por-segment ao /works (inalterado).
    if (isDesktop()) {
      const uid = (user?.id || token?.payload?.['cognito:username']) as string | undefined;
      if (uid && updatedData.storyId) {
        const prev = cacheDataToCanonical(data);
        const next = cacheDataToCanonical(updatedData);
        void saveScenes(prev, next, uid).catch((e) =>
          console.error('[A3] saveScenes local-first falhou', e),
        );
      }
    } else {
      setTimeout(() => {
        const segmentsWithScenes = segmentsToSave.filter(segment => segment.scenes.length > 0);

        if (segmentsWithScenes.length === 0) return;

        for (const segment of segmentsWithScenes) {
          const payload = {
            event: 'save-scenes',
            userId: user?.id || token?.payload['cognito:username'],
            title: updatedData.title || "Untitled Story",
            storyId: updatedData.storyId,
            segmentId: segment.id,
            scenes: segment.scenes.map(scene => ({
              sceneId: scene.sceneId,
              title: scene.title,
              content: scene.content,
              metadata: scene.metadata || {}
            }))
          };

          axios.post(
            `${process.env.REACT_APP_URL}/works`,
            payload,
            {
              headers: {
                "Authorization": token.toString(),
                "Content-Type": "application/json"
              }
            }
          )
            .then(response => {
              console.log(`✅ Save successful for ${segment.id}`);
            })
            .catch(error => {
              console.error(`❌ Backend save failed for ${segment.id}:`, error.message);
            });
        }
      }, 0);
    }

  }, [segments, data, setData, user, token, debouncedSave]);

  const debouncedSceneSave = React.useCallback(
    debounce((sceneId: string, field: 'title' | 'content', value: string) => {
      console.log(`Auto-saving ${field} for scene ${sceneId}:`, value);
    }, 1000),
    []
  );

  const updateSceneTitle = (sceneId: string, title: string) => {
    if (!selectedSegment) return;

    const updatedScenes = selectedSegment.scenes.map(scene =>
      scene.sceneId === sceneId ? { ...scene, title } : scene
    );

    const updatedSegment = { ...selectedSegment, scenes: updatedScenes };

    const updatedSegments = segments.map(segment =>
      segment.id === updatedSegment.id ? updatedSegment : segment
    );

    setSegments(updatedSegments);
    setSelectedSegment(updatedSegment);

    saveScenesToBackend(updatedSegments);
  };

  const updateSceneContent = (sceneId: string, content: string) => {
    if (!selectedSegment) return;

    const updatedScenes = selectedSegment.scenes.map(scene =>
      scene.sceneId === sceneId ? { ...scene, content } : scene
    );

    const updatedSegment = { ...selectedSegment, scenes: updatedScenes };

    const updatedSegments = segments.map(segment =>
      segment.id === updatedSegment.id ? updatedSegment : segment
    );

    setSegments(updatedSegments);
    setSelectedSegment(updatedSegment);

    saveScenesToBackend(updatedSegments);
  };

  // Global scene update functions for All Scenes view
  const updateAnySceneTitle = (sceneId: string, title: string) => {
    const updatedSegments = segments.map(segment => ({
      ...segment,
      scenes: segment.scenes.map(scene =>
        scene.sceneId === sceneId ? { ...scene, title } : scene
      )
    }));

    setSegments(updatedSegments);

    if (selectedSegment) {
      const updatedSelectedSegment = updatedSegments.find(seg => seg.id === selectedSegment.id);
      if (updatedSelectedSegment) {
        setSelectedSegment(updatedSelectedSegment);
      }
    }

    debouncedSceneSave(sceneId, 'title', title);
  };

  const updateAnySceneContent = (sceneId: string, content: string) => {
    const updatedSegments = segments.map(segment => ({
      ...segment,
      scenes: segment.scenes.map(scene =>
        scene.sceneId === sceneId ? { ...scene, content } : scene
      )
    }));

    setSegments(updatedSegments);

    if (selectedSegment) {
      const updatedSelectedSegment = updatedSegments.find(seg => seg.id === selectedSegment.id);
      if (updatedSelectedSegment) {
        setSelectedSegment(updatedSelectedSegment);
      }
    }

    debouncedSceneSave(sceneId, 'content', content);
  };

  const toggleAnySceneExpansion = (sceneId: string) => {
    const updatedSegments = segments.map(segment => ({
      ...segment,
      scenes: segment.scenes.map(scene =>
        scene.sceneId === sceneId ? { ...scene, isExpanded: !scene.isExpanded } : scene
      )
    }));

    setSegments(updatedSegments);

    if (selectedSegment) {
      const updatedSelectedSegment = updatedSegments.find(seg => seg.id === selectedSegment.id);
      if (updatedSelectedSegment) {
        setSelectedSegment(updatedSelectedSegment);
      }
    }
  };

  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());

  const deleteScene = (sceneId: string) => {
    console.log("Deleting scene:", sceneId);

    let deletedFromSegmentId: string | null = null;

    const updatedSegments = segments.map(segment => {
      const sceneIndex = segment.scenes.findIndex(
        scene => scene.sceneId === sceneId
      );

      if (sceneIndex === -1) return segment;

      deletedFromSegmentId = segment.id;

      const updatedScenes = [...segment.scenes];
      updatedScenes.splice(sceneIndex, 1);

      return {
        ...segment,
        scenes: updatedScenes,
      };
    });

    if (!deletedFromSegmentId) {
      console.log("Scene not found in any segment");
      return;
    }

    setSegments(updatedSegments);

    if (selectedSegment?.id === deletedFromSegmentId) {
      const updatedSelected = updatedSegments.find(
        seg => seg.id === deletedFromSegmentId
      );
      if (updatedSelected) {
        setSelectedSegment(updatedSelected);
      }
    }

    setSelectedScenes(prev => {
      const newSet = new Set(prev);
      newSet.delete(sceneId);
      return newSet;
    });

    saveScenesToBackend(updatedSegments);

    toast.success("Scene deleted!");
  };

  const updateSegment = (updatedSegment: SegmentWithScenes) => {
    const updatedSegments = segments.map(segment =>
      segment.id === updatedSegment.id ? updatedSegment : segment
    );

    setSegments(updatedSegments);
    setSelectedSegment(updatedSegment);
  };

  const addNewScene = (mode: 'before' | 'after' | 'end', index?: number) => {
    if (!selectedSegment) return;

    let insertIndex: number;
    let updatedScenes: Scene[];

    if (mode === 'end' || index === undefined) {
      insertIndex = selectedSegment.scenes.length;
    } else if (mode === 'before') {
      insertIndex = index;
    } else {
      insertIndex = index + 1;
    }

    const newScene: Scene = {
      sceneId: generateSceneId(),
      title: `New Scene`,
      content: "",
      isExpanded: true
    };

    updatedScenes = [...selectedSegment.scenes];
    updatedScenes.splice(insertIndex, 0, newScene);

    const updatedSegment = { ...selectedSegment, scenes: updatedScenes };

    const updatedSegments = segments.map(segment =>
      segment.id === updatedSegment.id ? updatedSegment : segment
    );

    setSegments(updatedSegments);
    setSelectedSegment(updatedSegment);

    saveScenesToBackend(updatedSegments);

    toast.success("New blank scene added!");
  };

  // ============================================
  // SCENE GENERATION
  // ============================================

  const generateSingleScene = async (sceneId: string) => {

    // 🔎 1. Encontrar o segmento que contém a cena
    let foundSegment: any = null;
    let sceneIndex = -1;

    for (const segment of segments) {
      const index = segment.scenes.findIndex(s => s.sceneId === sceneId);
      if (index !== -1) {
        foundSegment = segment;
        sceneIndex = index;
        break;
      }
    }

    if (!foundSegment) {
      toast.error("Scene not found in any segment");
      return;
    }

    const segmentId = foundSegment.id;

    setGeneratingSceneId(sceneId);

    try {

      if (!foundSegment.content || foundSegment.content.trim() === '') {
        toast.error("This segment needs content before generating a scene");
        return;
      }

      const requestObj = {
        event: 'generate-scene',
        userId: token?.payload['cognito:username'],
        storyId: data?.storyId || '',
        segmentId,
        sceneIndex,
        segmentTitle: foundSegment.title,
        segmentContent: foundSegment.content,

        G: data.G,
        T: data.T,
        M: data.M,
        CQ: data.CQ,
        SUM: data.SUM,
        title: data.title || "Untitled",

        storyData: {
          G: data.G,
          T: data.T,
          CQ: data.CQ,
          M: data.M,
          SUM: data.SUM,
          characters: data.characters || {},
          ...segments.reduce((acc, seg) => {
            acc[seg.id] = {
              S: seg.content || '',
              scenes: seg.scenes.map(s => ({
                sceneId: s.sceneId,
                title: s.title,
                content: s.content || '',
              })),
            };
            return acc;
          }, {} as Record<string, any>),
        },
      };

      const response = await axios.post(
        `${process.env.REACT_APP_URL}/scenes`,
        requestObj,
        {
          headers: {
            Authorization: token.toString(),
            "Content-Type": "application/json"
          }
        }
      );

      const responseData = response.data?.body
        ? (typeof response.data.body === 'string'
          ? JSON.parse(response.data.body)
          : response.data.body)
        : response.data;

      if (responseData?.scene) {
        const { scene, cap } = responseData;

        if (cap !== undefined) {
          setUser((prev: any) => ({ ...prev, cap }));
        }

        const updatedSegments = segments.map(seg => {
          if (seg.id !== segmentId) return seg;

          return {
            ...seg,
            scenes: seg.scenes.map(s =>
              s.sceneId === sceneId
                ? {
                  ...s,
                  title: scene.title || s.title,
                  content: scene.content || scene.description || '',
                  metadata: scene.metadata || s.metadata || {},
                }
                : s
            ),
          };
        });

        setSegments(updatedSegments);

        if (selectedSegment?.id === segmentId) {
          const updatedSelected = updatedSegments.find(s => s.id === segmentId);
          if (updatedSelected) setSelectedSegment(updatedSelected);
        }

        saveScenesToBackend(updatedSegments);
        toast.success(`Generated: ${scene.title || 'Scene'}`);
      } else if (responseData?.error) {
        toast.error(responseData.error);
      } else {
        toast.error('Unexpected response from server');
      }

    } catch (error: any) {
      console.error('❌ Generate single scene failed:', error);
      toast.error("Failed to generate scene");
    } finally {
      setGeneratingSceneId(null);
    }
  };

  const generateScenes = async () => {
    if (!selectedSegment) {
      toast.error('Please select a segment first');
      return;
    }

    setGeneratingScenes(true);
    setRequestLog(null);
    setResponseLog(null);

    try {
      if (!selectedSegment.content || selectedSegment.content.trim() === '') {
        toast.error("This segment needs content before generating scenes");
        setGeneratingScenes(false);
        return;
      }

      const requestObj = {
        event: 'generate-scenes',
        userId: token?.payload['cognito:username'],
        segmentId: selectedSegment.id,
        segmentTitle: selectedSegment.title,
        segmentContent: selectedSegment.content,

        G: data.G,
        T: data.T,
        M: data.M,
        CQ: data.CQ,
        SUM: data.SUM,
        [selectedSegment.id]: selectedSegment.content,
        title: data.title || "Untitled",
        content: data.content || 'feature',

        storyData: {
          story_metadata: {
            title: data.title || "Untitled",
            genre: data.G,
            theme: data.T,
            core_question: data.CQ,
            setting: data.M
          },
          story_summary: data.SUM,
          segments: segments.reduce((acc, segment) => {
            acc[segment.id] = {
              content: segment.content || '',
              scenes: segment.scenes.map(scene => ({
                sceneId: scene.sceneId,
                title: scene.title,
                content: scene.content
              }))
            };
            return acc;
          }, {} as Record<string, any>)
        }
      };

      setRequestLog(JSON.stringify(requestObj, null, 2));

      const response = await axios.post(
        `${process.env.REACT_APP_URL}/scenes`,
        requestObj,
        {
          headers: {
            "Authorization": token.toString(),
            "Content-Type": "application/json"
          }
        }
      );

      const responseData = response.data;
      setResponseLog(JSON.stringify(responseData, null, 2));

      if (responseData && responseData.scenes && responseData.cap !== undefined) {
        const { scenes, cap } = responseData;

        setUser((prev: any) => ({ ...prev, cap }));

        const updatedScenes = scenes.map((scene: any) => ({
          sceneId: scene.sceneId,
          title: scene.title || 'Untitled Scene',
          content: scene.content || scene.description || '',
          isExpanded: false,
          metadata: scene.metadata || {}
        }));

        const updatedSegment = {
          ...selectedSegment,
          scenes: updatedScenes
        };

        const updatedSegments = segments.map(segment =>
          segment.id === updatedSegment.id ? updatedSegment : segment
        );

        setSegments(updatedSegments);
        setSelectedSegment(updatedSegment);
        saveScenesToBackend(updatedSegments);

        toast.success(`Generated ${scenes.length} scenes!`);
      } else if (responseData && responseData.error) {
        toast.error(responseData.error || "Failed to generate scenes");
      } else {
        toast.error("Unexpected response from server");
      }
    } catch (error: any) {
      if (error.response) {
        setResponseLog(JSON.stringify({
          error: error.message,
          status: error.response.status,
          data: error.response.data,
        }, null, 2));

        const errorMessage = error.response.data?.body?.error ||
          error.response.data?.error ||
          error.response.data?.message ||
          `Failed to generate scenes (${error.response.status})`;
        toast.error(errorMessage);
      } else if (error.request) {
        toast.error("Network error - no response from server");
      } else {
        toast.error("Failed to send request");
      }
    } finally {
      setGeneratingScenes(false);
    }
  };

  // ============================================
  // STATS AND UI HELPERS
  // ============================================

  const totalScenes = segments.reduce((acc, segment) => acc + segment.scenes.length, 0);
  const completedSegments = segments.filter(segment => segment.scenes.length > 0).length;
  const progressPercentage = Math.round((completedSegments / segments.length) * 100);

  const actISegments = segments.filter(s => s.act === 1);
  const actIISegments = segments.filter(s => s.act === 2);
  const actIIISegments = segments.filter(s => s.act === 3);

  const toggleAct = (actNumber: number) => {
    if (expandedAct !== actNumber) {
      setExpandedAct(actNumber);
    }
  };

  type ActComputedStats = {
    actId: string;
    actStats: ActStats;
    segmentStats: Record<string, SegmentStats>;
  };

  const getActsStats = (
    actsSegments: Record<string, SegmentWithScenes[]>
  ): Record<string, ActComputedStats> => {
    return Object.entries(actsSegments).reduce(
      (acc, [actId, segments]) => {
        const segmentStats: Record<string, SegmentStats> = {};
        let totalScenes = 0;
        let completedSegments = 0;

        segments.forEach(segment => {
          const scenesCount = segment.scenes.length;
          segmentStats[segment.id] = { scenesCount };

          totalScenes += scenesCount;
          if (scenesCount > 0) completedSegments++;
        });

        acc[actId] = {
          actId,
          actStats: {
            totalScenes,
            progressPercentage: Math.round(
              (completedSegments / segments.length) * 100
            ),
          },
          segmentStats,
        };

        return acc;
      },
      {} as Record<string, ActComputedStats>
    );
  };

  const actsStats = getActsStats({
    "act-1": actISegments,
    "act-2": actIISegments,
    "act-3": actIIISegments,
  });

  const sidebarActs: ActItem[] = [
    {
      id: "act-1",
      label: "Act I",
      stats: actsStats["act-1"].actStats,
      children: actISegments.map(segment => ({
        id: segment.id,
        label: segment.title,
        targetId: segment.id,
        stats: actsStats["act-1"].segmentStats[segment.id],
      })),
    },
    {
      id: "act-2",
      label: "Act II",
      stats: actsStats["act-2"].actStats,
      children: actIISegments.map(segment => ({
        id: segment.id,
        label: segment.title,
        targetId: segment.id,
        stats: actsStats["act-2"].segmentStats[segment.id],
      })),
    },
    {
      id: "act-3",
      label: "Act III",
      stats: actsStats["act-3"].actStats,
      children: actIIISegments.map(segment => ({
        id: segment.id,
        label: segment.title,
        targetId: segment.id,
        stats: actsStats["act-3"].segmentStats[segment.id],
      })),
    },
  ];

  // ============================================
  // RENDER
  // ============================================

  if (loading === false) {
    return (
      <>
        <div
          style={{
            position: 'relative',
            left: '50%',
            top: '18.75rem',
          }}
        >
          <TailSpin stroke="#FFA500" speed="1.3" />
        </div>
      </>
    );
  } else {
    return (
      <>
        <Theme appearance="dark" accentColor="orange">
          <Toaster position="top-center" reverseOrder={false} />
          <Header />
          <div className="gradient-background"></div>

          {!isDetailPanelOpen && (
            <ScenesActionButtons
              onToggleSuggestions={() => stackedButtonCallbacksRef.current?.handleStackedSuggest()}
              onToggleRevisions={() => stackedButtonCallbacksRef.current?.handleStackedRevise()}
              isSuggestActive={stackedButtonCallbacksRef.current?.isSuggestActive ?? false}
              isReviseActive={stackedButtonCallbacksRef.current?.isReviseActive ?? false}
              addNewScene={addNewScene}
              storyData={{
                ...data,
                storyId: data.storyId,
                character_database: data.characters || {},
                character_database_enabled: !!(data.characters && Object.keys(data.characters).length > 0)
              }}
            />
          )}

          <StoryNavigationSidebar
            isScrolled={isScrolled}
            storyTitle={data.title || "Untitled Story"}
            onTitleChange={(newTitle) => {
              const newData = { ...data, title: newTitle };
              setData(newData);
              debouncedSave(newData);
            }}
            acts={sidebarActs}
            onSelectSegment={handleSelectSegmentFromSidebar}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          >
            <div className="main-container">
              <div
                className={`main-workspace ${isDetailPanelOpen ? 'full-width' : ''}`}
                style={{
                  ...(isDetailPanelOpen ? {
                    paddingRight: '15px',
                    maxWidth: 'none'
                  } : {
                    paddingRight: '120px',
                    maxWidth: 'calc(100% - 120px)'
                  })
                }}
              >
                {viewMode === 'acts' && selectedSegment && (
                  <>
                    <SegmentScenesView
                      selectedSegment={selectedSegment}
                      segments={segments}
                      setSegments={setSegments}
                      setSelectedSegment={setSelectedSegment}
                      onPanelStateChange={handlePanelStateChange}
                      reorganizeMode={reorganizeMode}
                      setReorganizeMode={setReorganizeMode}
                      addNewScene={addNewScene}
                      addSceneAtPosition={addSceneAtPosition}
                      updateSceneTitle={updateSceneTitle}
                      updateSceneContent={updateSceneContent}
                      deleteScene={deleteScene}
                      generateScenes={generateScenes}
                      generateSingleScene={generateSingleScene}
                      generatingSceneId={generatingSceneId}
                      generatingScenes={generatingScenes}
                      draggedScene={draggedScene}
                      handleDragStart={handleDragStart}
                      handleDragEnd={handleDragEnd}
                      handleDragOver={handleDragOver}
                      handleSceneMove={handleSceneMove}
                      getSceneDisplayId={getSceneDisplayId}
                      userId={user?.id || token?.payload['cognito:username'] || ''}
                      token={token}
                      storyId={data?.storyId || ''}
                      storyMetadata={{
                        genre: data.G,
                        theme: data.T,
                        coreQuestion: data.CQ,
                        mood: data.M,
                        summary: data.SUM,
                        characters: data.characters || {},
                      }}
                      saveScenesToBackend={saveScenesToBackend}
                      stackedButtonCallbacksRef={stackedButtonCallbacksRef}
                    />
                  </>
                )}

                {viewMode === 'all' && (
                  <ScenesCanvasOverlay
                    storyId={data.storyId || ''}
                    storyTitle={data.title || 'Untitled Story'}
                    segments={segments}
                    onClose={() => {
                      setShowScenesCanvas(false);
                      setViewMode("acts");
                    }}
                    onScenesUpdate={(updatedSegments) => {
                      setSegments(updatedSegments);
                      saveScenesToBackend(updatedSegments);
                    }}
                    userCap={user?.cap}
                    userId={user?.id || token?.payload['cognito:username'] || ''}
                    token={token}
                    onTokenUpdate={(newBalance: number) => {
                      if (user) {
                        setUser({ ...user, cap: newBalance });
                      }
                    }}
                    storyMetadata={{
                      genre: data.G,
                      theme: data.T,
                      coreQuestion: data.CQ,
                      mood: data.M,
                      summary: data.SUM,
                      characters: data.characters,
                    }}
                    deleteScene={deleteScene}
                    onGenerate={generateSingleScene}
                    generatingSceneId={generatingSceneId}
                  />
                )}
              </div>
            </div>
          </StoryNavigationSidebar>
          <Footer />
        </Theme>
      </>
    );
  }
}

export default Scenes;