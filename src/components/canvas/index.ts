/**
 * Canvas Components
 * 
 * Segment canvas mode - a sandbox workspace for iterating on story segments
 * with AI suggestions, constraints, and notes.
 * 
 * Usage:
 * 
 * import { CanvasOverlay } from './Canvas';
 * 
 * // In your component:
 * const [canvasSegment, setCanvasSegment] = useState<string | null>(null);
 * 
 * // Render when a segment is selected:
 * {canvasSegment && (
 *   <CanvasOverlay
 *     storyId={data.storyId}
 *     segmentId={canvasSegment}
 *     segmentTitle={getSegmentTitle(canvasSegment)}
 *     segmentContent={getFieldContent(canvasSegment)}
 *     onClose={() => setCanvasSegment(null)}
 *     onContentChange={(newContent) => {
 *       // Update segment content
 *       const newData = { ...data, [canvasSegment]: newContent };
 *       setData(newData);
 *       handleDebouncedSave(newData, true, true);
 *     }}
 *   />
 * )}
 */

// Main overlay component - this is what you import to use the canvas
export { default as CanvasOverlay } from './CanvasOverlay';

// Sub-components (typically not imported directly)
export { default as CanvasWorkspace } from './CanvasWorkspace';
export { default as SegmentContentBlock } from './SegmentContentBlock';
export { default as DraggableCard } from './DraggableCard';
export { default as SelectionPopup } from './SelectionPopup';
export { default as CanvasToolbar } from './CanvasToolbar';

// Hook
export { useCanvasState } from './useCanvasState';

// Types
export type {
  CardType,
  CardStatus,
  Position,
  LinkedText,
  CanvasCard,
  CanvasState,
  UseCanvasStateReturn,
  NewCardInput,
  CanvasOverlayProps,
  CanvasWorkspaceProps,
  SegmentContentBlockProps,
  DraggableCardProps,
  SelectionPopupProps,
  CanvasToolbarProps,
  RevisionState,
} from './types';