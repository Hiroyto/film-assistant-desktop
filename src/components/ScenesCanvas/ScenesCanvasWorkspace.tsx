/**
 * ScenesCanvasWorkspace
 * 
 * Main canvas area for the scenes canvas.
 * Handles:
 * - Pan and zoom interactions
 * - Scene cards arranged in segment rows (fixed position)
 * - Note cards (draggable)
 * - Connection lines between scenes
 * - Connection nodes for insert/bridge actions
 * - AI Selection mode (Phase 3) - purple/cyan rings for multi-select
 * - Text selection actions (Phase 4) - passthrough to SceneCard
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  ScenesCanvasWorkspaceProps,
  CanvasTransform,
  Position,
  SEGMENT_COLORS,
  CANVAS_CONSTANTS,
  NOTE_CARD_COLORS,
  TextSelectionAction,
  TextSelectionInfo,
} from './types';
import SceneCard from './SceneCard';
import NoteCard from './NoteCard';
import ConfirmModal from '../ui/ConfirmModal';

// =============================================================================
// Constants
// =============================================================================

const ZIGZAG_OFFSET_X = 550;  // Horizontal distance between left and right columns
const ZIGZAG_OFFSET_Y = 50;   // Vertical gap between rows (reduced)
const ROW_STAGGER_Y = 80;     // Vertical offset for right column cards (creates zigzag)

// Use the constant from types.ts for consistency
const CARD_WIDTH = CANVAS_CONSTANTS.SCENE_CARD_WIDTH;

// =============================================================================
// Extended Props Interface (Phase 3 + Phase 4)
// =============================================================================

export interface ScenesCanvasWorkspacePropsExtended extends ScenesCanvasWorkspaceProps {
  // AI Selection Mode
  isInSelectionMode?: boolean;
  selectionModeColor?: string;
  aiSelectedSceneIds?: string[];
  // Text selection handler (Phase 4)
  onTextSelectionAction?: (
    sceneId: string,
    segmentId: string,
    action: TextSelectionAction,
    selection: TextSelectionInfo
  ) => void;
  // Active text selection state (Phase 4) - for persistent highlight
  activeTextSelectionSceneId?: string | null;
  activeTextSelectionBounds?: { start: number; end: number } | null;
  activeTextSelectionColor?: 'purple' | 'cyan';
  // Disable editing when text selection is active
  isEditingDisabled?: boolean;
  // Active transition connection (for pulsing indicator)
  activeTransitionConnection?: { fromSceneId: string; toSceneId: string } | null;
  // Disable connection nodes (when panel is open)
  isConnectionNodesDisabled?: boolean;
  onGenerateScene?: (sceneId: string, segmentId: string) => void;
  generatingSceneId?: string | null;
  segmentRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  deleteScene: (sceneId: string) => void;
}

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  workspace: {
    position: 'absolute',
    inset: 0,
    background: '#0a0a0b',
    overflow: 'hidden',
    cursor: 'grab',
  },

  workspaceGrabbing: {
    cursor: 'grabbing',
  },

  workspaceSelecting: {
    cursor: 'crosshair',
  },

  canvas: {
    position: 'absolute',
    transformOrigin: '0 0',
    willChange: 'transform',
  },

  gridPattern: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      radial-gradient(circle, rgba(255, 107, 53, 0.18) 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
  },

  // Desk lamp lighting effect - soft glow from top-left
  ambientLight: {
    position: 'absolute',
    inset: 0,
    background: `
      radial-gradient(
        ellipse 80% 60% at 15% 20%,
        rgba(255, 147, 30, 0.035) 0%,
        rgba(255, 107, 53, 0.015) 30%,
        transparent 70%
      )
    `,
    pointerEvents: 'none',
  },

  // Centered radial vignette - lighter center, darker edges (matches Synopsis canvas)
  centerVignette: {
    position: 'absolute',
    inset: 0,
    background: `
      radial-gradient(
        ellipse 70% 60% at 50% 45%,
        rgba(255, 255, 255, 0.03) 0%,
        rgba(255, 255, 255, 0.015) 25%,
        transparent 55%
      ),
      radial-gradient(
        ellipse 100% 100% at 50% 50%,
        transparent 40%,
        rgba(0, 0, 0, 0.4) 100%
      )
    `,
    pointerEvents: 'none',
  },

  segmentRow: {
    position: 'absolute',
    display: 'flex',
    alignItems: 'flex-start',
    gap: `${CANVAS_CONSTANTS.CARD_GAP_X - CANVAS_CONSTANTS.SCENE_CARD_WIDTH}px`,
  },

  segmentLabel: {
    position: 'absolute',
    left: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: 'rgba(0, 0, 0, 0.6)',
    borderRadius: '6px',
    backdropFilter: 'blur(8px)',
  },

  segmentDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },

  segmentLabelText: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#e0e0e0',
    whiteSpace: 'nowrap' as const,
  },

  connectionLine: {
    position: 'absolute',
    pointerEvents: 'none',
    overflow: 'visible',
  },

  connectionNode: {
    position: 'absolute',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: '#1a1a1e',
    border: '2px solid #3a3a3e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    zIndex: 10,
  },

  connectionNodeHover: {
    background: '#ff6b35',
    borderColor: '#ff6b35',
    transform: 'scale(1.1)',
    boxShadow: '0 0 10px rgba(255, 107, 53, 0.5)',
  },

  emptyState: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
    color: '#666',
  },

  emptyStateTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#888',
  },

  emptyStateText: {
    fontSize: '14px',
    color: '#666',
  },

  segmentTransition: {
    position: 'absolute',
    left: CANVAS_CONSTANTS.START_X,
    right: 0,
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },

  segmentHeader: {
    position: 'absolute',
    left: 0,
    display: 'flex',
    alignItems: 'center',
    height: '36px',
    paddingLeft: '20px',
    paddingRight: '40px',
  },

  segmentHeaderLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent 0%, #3a3a3e 5%, #3a3a3e 95%, transparent 100%)',
  },

  segmentHeaderBadge: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 16px',
    background: '#111114',
    borderRadius: '8px',
    border: '1px solid #2a2a2e',
    zIndex: 1,
  },

  segmentHeaderDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },

  segmentHeaderId: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#888',
  },

  segmentHeaderTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e0e0e0',
  },

  transitionLine: {
    flex: 1,
    height: '2px',
    background: 'linear-gradient(90deg, transparent, #3a3a3e, transparent)',
    maxWidth: '200px',
  },

  transitionBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    background: 'rgba(26, 26, 30, 0.95)',
    border: '1px solid #3a3a3e',
    borderRadius: '20px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },

  transitionBadgeHover: {
    borderColor: '#ff6b35',
    background: 'rgba(255, 107, 53, 0.1)',
  },

  transitionArrow: {
    color: '#666',
    fontSize: '14px',
  },

  transitionLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },

  transitionDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },

  // Note card container
  noteCardContainer: {
    position: 'absolute',
    zIndex: 20, // Above scene cards but below popovers
  },

  // AI Selection overlay
  selectionOverlay: {
    position: 'absolute',
    inset: -3,
    borderRadius: 14,
    pointerEvents: 'none',
    transition: 'all 0.2s ease',
  },

  // Selection checkbox indicator
  selectionCheckbox: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
    transition: 'all 0.15s ease',
    cursor: 'pointer',
  },
};

// =============================================================================
// Helper: Estimate card height based on content
// =============================================================================

const estimateCardHeight = (content: string | undefined): number => {
  const MIN_HEIGHT = 100;
  const HEADER_HEIGHT = 42;
  const BODY_PADDING = 20;
  const LINE_HEIGHT = 18;
  const CHARS_PER_LINE = 55;

  if (!content || content.length === 0) {
    return MIN_HEIGHT;
  }

  const lines = Math.ceil(content.length / CHARS_PER_LINE);
  const contentHeight = lines * LINE_HEIGHT;

  return Math.max(MIN_HEIGHT, HEADER_HEIGHT + BODY_PADDING + contentHeight);
};

// =============================================================================
// Helper: Calculate scene positions (Zig-Zag Snake Layout)
// =============================================================================

interface ScenePosition {
  sceneId: string;
  segmentId: string;
  x: number;
  y: number;
  estimatedHeight: number;
  sceneIndex: number;
  globalIndex: number;
  isLeftColumn: boolean;
}

interface SegmentHeader {
  id: string;
  segmentId: string;
  title: string;
  color: string;
  y: number;
}

const calculateScenePositions = (
  segments: ScenesCanvasWorkspacePropsExtended['segments'],
  measuredHeights: Record<string, number> = {}
): { positions: ScenePosition[]; segmentHeaders: SegmentHeader[] } => {
  const positions: ScenePosition[] = [];
  const segmentHeaders: SegmentHeader[] = [];

  let globalIndex = 0;
  let currentY = CANVAS_CONSTANTS.START_Y;

  segments.forEach((segment) => {
    // Skip segments with no scenes
    // if (segment.scenes.length === 0) return;

    // Add segment header
    segmentHeaders.push({
      id: `header-${segment.id}`,
      segmentId: segment.id,
      title: segment.title,
      color: SEGMENT_COLORS[segment.id] || '#888',
      y: currentY,
    });

    // Space after header
    currentY += 60;

    // Track the row's base Y position
    let rowBaseY = currentY;

    // Process scenes in pairs (rows)
    for (let i = 0; i < segment.scenes.length; i++) {
      const scene = segment.scenes[i];
      const isLeftColumn = i % 2 === 0;

      const x = isLeftColumn
        ? CANVAS_CONSTANTS.START_X
        : CANVAS_CONSTANTS.START_X + ZIGZAG_OFFSET_X;

      // Right column cards are staggered down
      const y = isLeftColumn ? rowBaseY : rowBaseY + ROW_STAGGER_Y;

      // Use measured height if available, otherwise estimate
      const actualHeight = measuredHeights[scene.sceneId] || estimateCardHeight(scene.content);

      positions.push({
        sceneId: scene.sceneId,
        segmentId: segment.id,
        x,
        y,
        estimatedHeight: actualHeight,
        sceneIndex: i,
        globalIndex,
        isLeftColumn,
      });

      globalIndex++;

      // After right column card (or last card if odd), move to next row
      if (!isLeftColumn || i === segment.scenes.length - 1) {
        // Get heights for this row
        const leftCardIndex = isLeftColumn ? i : i - 1;
        const leftCard = positions.find(p =>
          p.segmentId === segment.id && p.sceneIndex === leftCardIndex
        );
        const rightCard = isLeftColumn ? null : positions.find(p =>
          p.segmentId === segment.id && p.sceneIndex === i
        );

        // Calculate where the bottom of this row is
        const leftBottom = leftCard ? leftCard.y + leftCard.estimatedHeight : 0;
        const rightBottom = rightCard ? rightCard.y + rightCard.estimatedHeight : 0;
        const rowBottom = Math.max(leftBottom, rightBottom);

        rowBaseY = rowBottom + ZIGZAG_OFFSET_Y;
      }
    }

    // If segment is empty, reserve vertical space
    if (segment.scenes.length === 0) {
      rowBaseY = currentY + 120; // espaço visual do botão
    }
    // Update currentY for next segment
    currentY = rowBaseY + 40;
  });

  return { positions, segmentHeaders };
};

// =============================================================================
// Helper: Calculate connection lines between scenes (Zig-Zag Snake)
// =============================================================================

interface ConnectionLine {
  id: string;
  fromSceneId: string;
  toSceneId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isCrossSegment: boolean;
  midX: number;
  midY: number;
  direction: 'down-right' | 'down-left';
}

const calculateConnectionLines = (
  positions: ScenePosition[],
  segmentHeaders: SegmentHeader[],
  segments: ScenesCanvasWorkspacePropsExtended['segments']
): ConnectionLine[] => {

  const lines: ConnectionLine[] = [];

  // ============================================================
  // 1️⃣ INTRA-SEGMENTO (snake original)
  // ============================================================

  const sortedPositions = [...positions].sort(
    (a, b) => a.globalIndex - b.globalIndex
  );

  for (let i = 0; i < sortedPositions.length - 1; i++) {
    const from = sortedPositions[i];
    const to = sortedPositions[i + 1];

    if (from.segmentId !== to.segmentId) continue;

    let fromX: number;
    let fromY: number;
    let toX: number;
    let toY: number;
    let direction: ConnectionLine["direction"];

    if (from.isLeftColumn && !to.isLeftColumn) {
      fromX = from.x + CARD_WIDTH;
      fromY = from.y + from.estimatedHeight * 0.6;
      toX = to.x;
      toY = to.y + to.estimatedHeight * 0.4;
      direction = "down-right";
    } else if (!from.isLeftColumn && to.isLeftColumn) {
      fromX = from.x + CARD_WIDTH * 0.2;
      fromY = from.y + from.estimatedHeight;
      toX = to.x + CARD_WIDTH;
      toY = to.y + 10;
      direction = "down-left";
    } else {
      fromX = from.x + CARD_WIDTH * 0.5;
      fromY = from.y + from.estimatedHeight;
      toX = to.x + CARD_WIDTH * 0.5;
      toY = to.y;
      direction = from.isLeftColumn ? "down-right" : "down-left";
    }

    lines.push({
      id: `${from.sceneId}-${to.sceneId}`,
      fromSceneId: from.sceneId,
      toSceneId: to.sceneId,
      fromX,
      fromY,
      toX,
      toY,
      isCrossSegment: false,
      midX: (fromX + toX) / 2,
      midY: (fromY + toY) / 2,
      direction,
    });
  }

  // ============================================================
  // 2️⃣ INTER-SEGMENTO (segment based)
  // ============================================================

  const positionMap = new Map(
    positions.map(p => [p.sceneId, p])
  );

  for (let i = 0; i < segments.length - 1; i++) {
    const currentSegment = segments[i];
    const nextSegment = segments[i + 1];

    if (!currentSegment.scenes.length) continue;

    const lastSceneId =
      currentSegment.scenes[currentSegment.scenes.length - 1].sceneId;

    const from = positionMap.get(lastSceneId);
    if (!from) continue;

    const fromX = from.x + CARD_WIDTH * 0.2;
    const fromY = from.y + from.estimatedHeight;

    let toX: number;
    let toY: number;

    if (nextSegment.scenes.length > 0) {
      const firstSceneId = nextSegment.scenes[0].sceneId;
      const to = positionMap.get(firstSceneId);
      if (!to) continue;

      toX = to.x + CARD_WIDTH * 0.5;
      toY = to.y;
    } else {
      const header = segmentHeaders.find(
        h => h.segmentId === nextSegment.id
      );
      if (!header) continue;

      const headerVisualTop = header.y - 50;
      const badgeHeight = 40;

      toX = CANVAS_CONSTANTS.START_X + 90;
      toY = headerVisualTop + badgeHeight / 2;
    }

    lines.push({
      id: `cross-${currentSegment.id}-${nextSegment.id}`,
      fromSceneId: lastSceneId,
      toSceneId:
        nextSegment.scenes[0]?.sceneId || `badge-${nextSegment.id}`,
      fromX,
      fromY,
      toX,
      toY,
      isCrossSegment: true,
      midX: (fromX + toX) / 2,
      midY: (fromY + toY) / 2,
      direction: "down-left",
    });
  }

  return lines;
};

// =============================================================================
// Component
// =============================================================================

const ScenesCanvasWorkspace: React.FC<ScenesCanvasWorkspacePropsExtended> = ({
  segments,
  segmentRefs,
  noteCards,
  selectedSceneId,
  selectedSegmentId,
  transform,
  linkingNoteId,
  linkingSceneIds,
  // AI Selection Mode props
  isInSelectionMode = false,
  selectionModeColor = '#8b5cf6',
  aiSelectedSceneIds = [],
  // Text selection handler (Phase 4)
  onTextSelectionAction,
  // Active text selection state (Phase 4)
  activeTextSelectionSceneId = null,
  activeTextSelectionBounds = null,
  activeTextSelectionColor = 'cyan',
  // Editing disabled state
  isEditingDisabled = false,
  // Active transition connection
  activeTransitionConnection = null,
  // Connection nodes disabled
  isConnectionNodesDisabled = false,
  onTransformChange,
  onSceneSelect,
  onSceneUpdate,
  onSceneToggleLink,
  onGenerateScene,
  generatingSceneId = null,
  onNoteCardMove,
  onNoteCardUpdate,
  onNoteCardRemove,
  onNoteCardSelect,
  onNoteStartLinking,
  onNoteFinishLinking,
  onNoteCancelLinking,
  onConnectionClick,
  deleteScene,
}) => {
  // ===========================================================================
  // Refs
  // ===========================================================================

  const workspaceRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef<Position>({ x: 0, y: 0 });


  // Store transform in ref for wheel handler to avoid stale closure
  const transformRef = useRef<CanvasTransform>(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // ===========================================================================
  // State
  // ===========================================================================

  const [isPanning, setIsPanning] = useState(false);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [sceneToDelete, setSceneToDelete] = useState<string | null>(null);

  // Callback for SceneCard to report its actual height
  const handleCardMeasured = useCallback((sceneId: string, height: number) => {
    setMeasuredHeights(prev => {
      if (prev[sceneId] === height) return prev; // No change
      return { ...prev, [sceneId]: height };
    });
  }, []);

  // Track which note is being dragged (to hide its connection lines)
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);

  // ===========================================================================
  // Calculate positions and connections
  // ===========================================================================

  // Calculate positions with measured heights where available
  const { positions: scenePositions, segmentHeaders } = React.useMemo(() => {
    return calculateScenePositions(segments, measuredHeights);
  }, [segments, measuredHeights]);

  const segmentMap = React.useMemo(() => {
    return new Map(segments.map(s => [s.id, s]));
  }, [segments]);

  const connectionLines = calculateConnectionLines(
    scenePositions,
    segmentHeaders,
    segments
  );
  // Filter note cards to only show segment and scene-scoped (global notes go in right panel)
  const canvasNoteCards = React.useMemo(() => {
    return noteCards.filter(note => note.scope !== 'global' && note.status === 'active');
  }, [noteCards]);

  // Calculate canvas bounds from scene positions for SVG sizing
  const canvasBounds = React.useMemo(() => {
    // Include note card positions in bounds calculation
    const noteBounds = canvasNoteCards.reduce(
      (bounds, note) => ({
        maxX: Math.max(bounds.maxX, note.position.x + CANVAS_CONSTANTS.NOTE_CARD_WIDTH + 100),
        maxY: Math.max(bounds.maxY, note.position.y + 200), // Estimate note height
      }),
      { maxX: 0, maxY: 0 }
    );

    const sceneBounds = scenePositions.reduce(
      (bounds, pos) => ({
        maxX: Math.max(bounds.maxX, pos.x + CARD_WIDTH + 300),
        maxY: Math.max(bounds.maxY, pos.y + pos.estimatedHeight + 300),
      }),
      { maxX: 2000, maxY: 2000 }
    );

    return {
      maxX: Math.max(sceneBounds.maxX, noteBounds.maxX),
      maxY: Math.max(sceneBounds.maxY, noteBounds.maxY),
    };
  }, [scenePositions, canvasNoteCards]);

  // ===========================================================================
  // Pan Handlers
  // ===========================================================================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    
    const target = e.target as HTMLElement;
    
    // Don't pan when interacting with scene cards, note cards, or connection nodes
    if (target.closest('[data-scene-card]')) return;
    if (target.closest('[data-note-card]')) return;
    if (target.closest('[data-connection-node]')) return;
  
    // Don't pan when clicking inside any input/textarea (editing mode)
    if (target.closest('textarea') || target.closest('input')) return;
  
    // Don't start panning if in selection mode
    if (isInSelectionMode) return;
  
    isPanningRef.current = true;
    lastPanPointRef.current = { x: e.clientX, y: e.clientY };
    setIsPanning(true);
  
    e.preventDefault();
  }, [isInSelectionMode]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanningRef.current) return;

    const dx = e.clientX - lastPanPointRef.current.x;
    const dy = e.clientY - lastPanPointRef.current.y;

    lastPanPointRef.current = { x: e.clientX, y: e.clientY };

    onTransformChange({
      ...transform,
      panX: transform.panX + dx,
      panY: transform.panY + dy,
    });
  }, [transform, onTransformChange]);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  // ===========================================================================
  // Wheel Handler (Scroll/Pan) - using native event for passive: false
  // ===========================================================================

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const currentTransform = transformRef.current;

    // Scroll wheel pans the canvas (hold Cmd/Ctrl for zoom)
    if (e.metaKey || e.ctrlKey) {
      // Zoom with Cmd/Ctrl + scroll
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomDelta = e.deltaY > 0 ? -CANVAS_CONSTANTS.ZOOM_STEP : CANVAS_CONSTANTS.ZOOM_STEP;
      const newScale = Math.max(
        CANVAS_CONSTANTS.MIN_ZOOM,
        Math.min(CANVAS_CONSTANTS.MAX_ZOOM, currentTransform.scale + zoomDelta)
      );

      if (newScale === currentTransform.scale) return;

      const scaleRatio = newScale / currentTransform.scale;
      const newPanX = mouseX - (mouseX - currentTransform.panX) * scaleRatio;
      const newPanY = mouseY - (mouseY - currentTransform.panY) * scaleRatio;

      onTransformChange({
        scale: newScale,
        panX: newPanX,
        panY: newPanY,
      });
    } else {
      // Normal scroll = pan
      // Multiply by a factor for comfortable scroll speed
      const scrollSpeed = 1;
      const deltaX = e.deltaX * scrollSpeed;
      const deltaY = e.deltaY * scrollSpeed;

      onTransformChange({
        ...currentTransform,
        panX: currentTransform.panX - deltaX,
        panY: currentTransform.panY - deltaY,
      });
    }
  }, [onTransformChange]);

  // ===========================================================================
  // Global mouse listeners for panning + wheel listener with passive: false
  // ===========================================================================

  useEffect(() => {
    const workspace = workspaceRef.current;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // Add wheel listener with passive: false to allow preventDefault
    if (workspace) {
      workspace.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (workspace) {
        workspace.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleMouseMove, handleMouseUp, handleWheel]);

  // ===========================================================================
  // Connection node click handler
  // ===========================================================================

  const handleConnectionNodeClick = useCallback((
    line: ConnectionLine,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    onConnectionClick(line.fromSceneId, line.toSceneId, { x: line.midX, y: line.midY });
  }, [onConnectionClick]);

  // ===========================================================================
  // Note card handlers
  // ===========================================================================

  const handleNoteCardMove = useCallback((cardId: string, position: Position) => {
    // Adjust position based on transform scale
    // The drag offset is in screen coordinates, but position is in canvas coordinates
    onNoteCardMove(cardId, position);
  }, [onNoteCardMove]);

  // ===========================================================================
  // Text Selection Action Handler (Phase 4)
  // ===========================================================================

  const handleTextSelectionAction = useCallback((
    sceneId: string,
    segmentId: string,
    action: TextSelectionAction,
    selection: TextSelectionInfo
  ) => {
    if (onTextSelectionAction) {
      onTextSelectionAction(sceneId, segmentId, action, selection);
    }
  }, [onTextSelectionAction]);

  // ===========================================================================
  // Render connection SVG path (Zig-Zag curves)
  // ===========================================================================

  const renderConnectionPath = (line: ConnectionLine) => {
    const deltaX = line.toX - line.fromX;
    const deltaY = line.toY - line.fromY;

    if (line.direction === 'down-right') {
      // Left → Right: smooth curve going across and slightly down
      // Control points pull the curve horizontally
      const cpOffset = Math.abs(deltaX) * 0.4;
      return `M ${line.fromX} ${line.fromY}
              C ${line.fromX + cpOffset} ${line.fromY},
                ${line.toX - cpOffset} ${line.toY},
                ${line.toX} ${line.toY}`;
    } else {
      // Right → Left: smooth S-curve going down then left
      // First control point: straight down from start
      // Second control point: straight up from end
      const midY = (line.fromY + line.toY) / 2;
      return `M ${line.fromX} ${line.fromY}
              C ${line.fromX} ${midY + deltaY * 0.1},
                ${line.toX} ${midY - deltaY * 0.1},
                ${line.toX} ${line.toY}`;
    }
  };

  // ===========================================================================
  // Check if canvas has any scenes
  // ===========================================================================

  const hasScenes = segments.some(s => s.scenes.length > 0);

  // ===========================================================================
  // Helper: Check if scene is in any selection state
  // ===========================================================================

  const isLinkingActive = linkingNoteId !== null;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      ref={workspaceRef}
      style={{
        ...styles.workspace,
        ...(isPanning ? styles.workspaceGrabbing : {}),
        ...(isInSelectionMode ? styles.workspaceSelecting : {}),
      }}
      onMouseDown={handleMouseDown}
    // Note: wheel handler is attached via useEffect with { passive: false }
    >
      {/* Grid Pattern */}
      <div
        style={{
          ...styles.gridPattern,
          backgroundPosition: `${transform.panX}px ${transform.panY}px`,
          backgroundSize: `${40 * transform.scale}px ${40 * transform.scale}px`,
        }}
      />

      {/* Ambient Light - Desk lamp effect */}
      <div style={styles.ambientLight} />

      {/* Center Vignette - lighter center, darker edges */}
      <div style={styles.centerVignette} />

      {/* Canvas Content */}
      <div
        style={{
          ...styles.canvas,
          transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`,
          // Explicit dimensions to ensure children render properly
          width: canvasBounds.maxX,
          height: canvasBounds.maxY,
        }}
      >
        {/* Connection Lines SVG - Rendered FIRST (behind cards) */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            overflow: 'visible',
          }}
          width={canvasBounds.maxX}
          height={canvasBounds.maxY}
          viewBox={`0 0 ${canvasBounds.maxX} ${canvasBounds.maxY}`}
        >
          {/* Define subtle glow filter */}
          <defs>
            <filter id="subtleGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {connectionLines.map(line => {
            const isHovered = hoveredConnectionId === line.id;
            const isCrossSegment = line.isCrossSegment;
            const baseColor = isCrossSegment ? '#8b5cf6' : '#ff6b35';

            return (
              <g key={line.id}>
                {/* Subtle outer glow */}
                <path
                  d={renderConnectionPath(line)}
                  fill="none"
                  stroke={baseColor}
                  strokeWidth={isHovered ? 8 : 5}
                  strokeOpacity={isHovered ? 0.2 : 0.12}
                  strokeLinecap="round"
                  strokeDasharray={isCrossSegment ? '8 4' : 'none'}
                />
                {/* Main line */}
                <path
                  d={renderConnectionPath(line)}
                  fill="none"
                  stroke={baseColor}
                  strokeWidth={isHovered ? 2.5 : 2}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                  filter="url(#subtleGlow)"
                  strokeDasharray={isCrossSegment ? '8 4' : 'none'}
                />
              </g>
            );
          })}

          {/* Note-to-Scene Connection Lines (only for scene-linked notes, hide while dragging) */}
          {canvasNoteCards
            .filter(note =>
              note.scope === 'scene' &&
              note.sceneIds &&
              note.sceneIds.length > 0 &&
              note.cardId !== draggingNoteId  // Hide lines for note being dragged
            )
            .map(note => {
              const noteColor = NOTE_CARD_COLORS[note.color || 'purple'];
              const noteCenterX = note.position.x + CANVAS_CONSTANTS.NOTE_CARD_WIDTH / 2;
              const noteCenterY = note.position.y + 60; // Approximate center

              return note.sceneIds!.map(sceneId => {
                const scenePos = scenePositions.find(p => p.sceneId === sceneId);
                if (!scenePos) return null;

                const sceneCenterX = scenePos.x + CARD_WIDTH / 2;
                const sceneCenterY = scenePos.y + scenePos.estimatedHeight / 2;

                // Calculate control points for a nice curve
                const midX = (noteCenterX + sceneCenterX) / 2;
                const midY = (noteCenterY + sceneCenterY) / 2;

                const path = `M ${noteCenterX} ${noteCenterY} Q ${midX} ${noteCenterY}, ${sceneCenterX} ${sceneCenterY}`;

                return (
                  <path
                    key={`note-${note.cardId}-scene-${sceneId}`}
                    d={path}
                    fill="none"
                    stroke={noteColor}
                    strokeWidth={1.5}
                    strokeOpacity={0.5}
                    strokeLinecap="round"
                    strokeDasharray="4 4"
                  />
                );
              });
            })}
        </svg>

        {/* Segment Headers - Full Width */}
        {segmentHeaders.map(header => (
          <React.Fragment key={header.id}>
            <div
              ref={el => {
                segmentRefs.current[header.segmentId] = el;
              }}
              data-segment-anchor={header.segmentId}
              style={{
                position: 'absolute',
                top: header.y,
                left: 0,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: header.y - 50,
                width: canvasBounds.maxX,
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: '20px',
              }}
            >
              {/* Full-width horizontal line */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  height: '1px',
                  background: `linear-gradient(90deg, transparent 0%, ${header.color}40 2%, ${header.color}30 50%, ${header.color}40 98%, transparent 100%)`,
                }}
              />

              {/* Badge */}
              <div
                data-segment-badge={header.segmentId}
                style={{
                  '--segment-color': header.color,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 16px',
                  background: '#111114',
                  borderRadius: '8px',
                  border: `1px solid ${header.color}50`,
                  zIndex: 1,
                } as React.CSSProperties}
              >

                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: header.color,
                  boxShadow: `0 0 8px ${header.color}80`,
                }} />
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: header.color
                }}>
                  {header.segmentId}
                </span>
                <span style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#e0e0e0'
                }}>
                  {header.title}
                </span>
              </div>
            </div>
          </React.Fragment>
        ))}

        {/* Empty Segment Add Button */}
        {segments.map(segment => {
          if (segment.scenes.length > 0) return null;

          const header = segmentHeaders.find(
            h => h.segmentId === segment.id
          );

          if (!header) return null;

          const buttonTop = header.y + 60;

          return (
            <div
              key={`empty-${segment.id}`}
              style={{
                position: 'absolute',
                top: buttonTop,
                left: CANVAS_CONSTANTS.START_X,
                width: CARD_WIDTH,
                height: 80,
                borderRadius: 12,
                border: `1px dashed ${SEGMENT_COLORS[segment.id] || '#666'}`,
                background: 'rgba(255,255,255,0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => {
                const header = segmentHeaders.find(h => h.segmentId === segment.id);
                if (!header) return;

                const x = CANVAS_CONSTANTS.START_X + CARD_WIDTH / 2;
                const y = header.y + 100;

                onConnectionClick(
                  `empty-${segment.id}`,
                  `empty-${segment.id}`,
                  { x, y }
                );
              }}
            >
              <span style={{
                fontSize: 13,
                fontWeight: 600,
                color: SEGMENT_COLORS[segment.id] || '#888',
                letterSpacing: 0.5
              }}>
                + Add Scene
              </span>
            </div>
          );
        })}

        {/* Connection Nodes (clickable) - Hide in selection mode, disabled when panel is open */}
        {!isInSelectionMode && connectionLines.map(line => {
          const isHovered = hoveredConnectionId === line.id;
          const isActiveTransition = activeTransitionConnection &&
            activeTransitionConnection.fromSceneId === line.fromSceneId &&
            activeTransitionConnection.toSceneId === line.toSceneId;

          // When connection nodes are disabled, only show the active transition one
          if (isConnectionNodesDisabled && !isActiveTransition) {
            return null;
          }

          return (
            <div
              key={`node-${line.id}`}
              data-connection-node
              style={{
                ...styles.connectionNode,
                ...(isHovered && !isConnectionNodesDisabled ? styles.connectionNodeHover : {}),
                ...(isActiveTransition ? {
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  border: '2px solid rgba(139, 92, 246, 0.6)',
                  boxShadow: '0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 20px rgba(139, 92, 246, 0.5)',
                  animation: 'pulseTransition 2s ease-in-out infinite',
                } : {}),
                left: line.midX - 11,
                top: line.midY - 11,
                pointerEvents: isConnectionNodesDisabled && !isActiveTransition ? 'none' : 'auto',
                opacity: isConnectionNodesDisabled && !isActiveTransition ? 0.3 : 1,
              }}
              onClick={(e) => !isConnectionNodesDisabled && handleConnectionNodeClick(line, e)}
              onMouseEnter={() => !isConnectionNodesDisabled && setHoveredConnectionId(line.id)}
              onMouseLeave={() => setHoveredConnectionId(null)}
              title={isConnectionNodesDisabled ? undefined : (line.isCrossSegment ? "Review segment transition" : "Review scene transition")}
            >
              {isActiveTransition ? (
                <svg width="10" height="10" viewBox="0 0 15 15" fill="#fff">
                  <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke={isHovered ? '#fff' : '#888'}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
          );
        })}

        {/* Scene Cards */}
        {scenePositions.map(pos => {
          const segment = segments.find(s => s.id === pos.segmentId);
          const scene = segment?.scenes.find(s => s.sceneId === pos.sceneId);

          if (!scene || !segment) return null;

          const displayId = `${pos.segmentId}.${pos.sceneIndex + 1}`;

          // Determine selection states
          const isLinkedToCurrentNote = linkingSceneIds.includes(pos.sceneId);
          const isAiSelected = aiSelectedSceneIds.includes(pos.sceneId);
          const isHovered = hoveredSceneId === pos.sceneId;

          // Determine which overlay to show
          const showLinkingOverlay = isLinkingActive;
          const showSelectionOverlay = isInSelectionMode && !isLinkingActive;

          return (
            <div
              data-scene-id={pos.sceneId}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                '--segment-color': SEGMENT_COLORS[pos.segmentId] || '#888',
                cursor: (isLinkingActive || isInSelectionMode) ? 'pointer' : 'default',
              } as React.CSSProperties}
              onClick={() => {
                if (isLinkingActive) {
                  onSceneToggleLink(pos.sceneId);
                } else {
                  onSceneSelect(pos.sceneId, pos.segmentId);
                }
              }}
              onMouseEnter={() => setHoveredSceneId(pos.sceneId)}
              onMouseLeave={() => setHoveredSceneId(null)}
            >
              {/* Linking mode overlay */}
              {showLinkingOverlay && (
                <>
                  <div
                    style={{
                      ...styles.selectionOverlay,
                      border: isLinkedToCurrentNote
                        ? '2px solid #8b5cf6'
                        : '2px solid transparent',
                      boxShadow: isLinkedToCurrentNote
                        ? '0 0 0 2px rgba(139, 92, 246, 0.5), 0 0 20px rgba(139, 92, 246, 0.3)'
                        : isHovered
                          ? '0 0 0 1px rgba(139, 92, 246, 0.5), 0 0 15px rgba(139, 92, 246, 0.2)'
                          : '0 0 0 1px rgba(139, 92, 246, 0.3)',
                    }}
                  />
                  <div
                    style={{
                      ...styles.selectionCheckbox,
                      border: '2px solid #8b5cf6',
                      background: isLinkedToCurrentNote ? '#8b5cf6' : 'rgba(20, 20, 24, 0.9)',
                    }}
                  >
                    {isLinkedToCurrentNote && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </div>
                </>
              )}

              {/* AI Selection mode overlay */}
              {showSelectionOverlay && (
                <>
                  <div
                    style={{
                      ...styles.selectionOverlay,
                      border: isAiSelected
                        ? `2px solid ${selectionModeColor}`
                        : '2px solid transparent',
                      boxShadow: isAiSelected
                        ? `0 0 0 2px ${selectionModeColor}80, 0 0 20px ${selectionModeColor}50`
                        : isHovered
                          ? `0 0 0 1px ${selectionModeColor}80, 0 0 15px ${selectionModeColor}30`
                          : `0 0 0 1px ${selectionModeColor}40`,
                    }}
                  />
                  <div
                    style={{
                      ...styles.selectionCheckbox,
                      border: `2px solid ${selectionModeColor}`,
                      background: isAiSelected ? selectionModeColor : 'rgba(20, 20, 24, 0.9)',
                    }}
                  >
                    {isAiSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                  </div>
                </>
              )}

              <SceneCard
                scene={scene}
                segmentId={pos.segmentId}
                segmentColor={SEGMENT_COLORS[pos.segmentId] || '#888'}
                displayId={displayId}
                isSelected={selectedSceneId === pos.sceneId && !isInSelectionMode && !isLinkingActive}
                isInSelectionMode={isInSelectionMode || isLinkingActive}
                isEditingDisabled={isEditingDisabled}
                onClick={() => {
                  if (!isLinkingActive && !isInSelectionMode) {
                    onSceneSelect(pos.sceneId, pos.segmentId);
                  }
                }}
                onSceneUpdate={(updates) => onSceneUpdate(pos.sceneId, pos.segmentId, updates)}
                onMeasured={(height) => handleCardMeasured(scene.sceneId, height)}
                // Phase 4: Pass text selection handler
                onTextSelectionAction={
                  onTextSelectionAction
                    ? (action, selection) => handleTextSelectionAction(
                      pos.sceneId,
                      pos.segmentId,
                      action,
                      selection
                    )
                    : undefined
                }
                // Phase 4: Pass active selection for persistent highlight
                activeSelectionBounds={
                  activeTextSelectionSceneId === pos.sceneId
                    ? activeTextSelectionBounds
                    : null
                }
                activeSelectionColor={activeTextSelectionColor}
                onDelete={() => {
                  setSceneToDelete(pos.sceneId);
                  setOpenDeleteModal(true);
                }}
                onGenerate={() => onGenerateScene?.(pos.sceneId, pos.segmentId)}
                generatingSceneId={generatingSceneId}
              />
            </div>
          );
        })}

        {/* Note Cards (draggable) */}
        {canvasNoteCards.map(note => {
          const isThisNoteLinking = linkingNoteId === note.cardId;

          // Detect which segment this note is in based on position
          // Find the segment whose header is closest above the note position
          let detectedSegmentId = segments[0]?.id || 'S1';

          // Sort headers by Y position and find which segment range the note falls into
          const sortedHeaders = [...segmentHeaders].sort((a, b) => a.y - b.y);
          for (let i = 0; i < sortedHeaders.length; i++) {
            const header = sortedHeaders[i];
            const nextHeader = sortedHeaders[i + 1];

            // Note is in this segment if it's at or below this header's Y
            // and either there's no next header or it's above the next header's Y
            if (note.position.y >= header.y - 100) {
              if (!nextHeader || note.position.y < nextHeader.y - 100) {
                detectedSegmentId = header.segmentId;
                break;
              }
              // Otherwise keep checking - note might be in a later segment
              detectedSegmentId = header.segmentId;
            }
          }

          return (
            <div
              key={note.cardId}
              data-note-card
              style={{
                ...styles.noteCardContainer,
                left: note.position.x,
                top: note.position.y,
                zIndex: isThisNoteLinking ? 100 : 20, // Bring linking note to front
              }}
            >
              <NoteCard
                note={note}
                segments={segments}
                canvasScale={transform.scale}
                isLinkingMode={isThisNoteLinking}
                linkedSceneIds={isThisNoteLinking ? linkingSceneIds : (note.sceneIds || [])}
                detectedSegmentId={note.segmentId || detectedSegmentId}
                onMove={(position) => handleNoteCardMove(note.cardId, position)}
                onUpdate={(updates) => onNoteCardUpdate(note.cardId, updates)}
                onRemove={() => onNoteCardRemove(note.cardId)}
                onStartLinking={() => onNoteStartLinking(note.cardId)}
                onFinishLinking={(scope, segmentId, sceneIds) => onNoteFinishLinking(note.cardId, scope, segmentId, sceneIds)}
                onCancelLinking={() => onNoteCancelLinking(note.cardId)}
                onDragStateChange={(isDragging) => setDraggingNoteId(isDragging ? note.cardId : null)}
              />
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {/* {!hasScenes && (
        <div style={styles.emptyState}>
          <div style={styles.emptyStateTitle}>No scenes yet</div>
          <div style={styles.emptyStateText}>
            Add scenes to your segments to see them on the canvas
          </div>
        </div>
      )} */}

      {/* CSS for pulsing animation */}
      <style>
        {`
          @keyframes pulseTransition {
            0%, 100% {
              box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.3), 0 0 20px rgba(139, 92, 246, 0.5);
              transform: scale(1);
            }
            50% {
              box-shadow: 0 0 0 8px rgba(139, 92, 246, 0.2), 0 0 30px rgba(139, 92, 246, 0.6);
              transform: scale(1.1);
            }
          }
        `}
      </style>
      <ConfirmModal
        open={openDeleteModal}
        title="Delete Scene"
        description="This scene will be permanently deleted."
        confirmLabel="Delete"
        onCancel={() => {
          setOpenDeleteModal(false);
          setSceneToDelete(null);
        }}
        onConfirm={() => {
          if (sceneToDelete) {
            deleteScene(sceneToDelete);
          }
          setOpenDeleteModal(false);
          setSceneToDelete(null);
        }}
      />
    </div>
  );
};

export default ScenesCanvasWorkspace;