import React, { useState, useContext, useEffect, useCallback } from 'react';
import { useMutation } from "react-query";
import axios from 'axios';
import { UserContext } from '../App';
import { User as UserType } from '../models/user';
import ScenesInternSelectionControls from './ScenesInternSelectionControls';
import ScenesInternForm from './ScenesInternForm';
import ScenesInternResponse from './ScenesInternResponse';
import './ScenesInternPanel.css';

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

interface ScenesInternPanelProps {
  isOpen: boolean;
  onClose: () => void;
  segments: SegmentWithScenes[];
  onSegmentsUpdate: (segments: SegmentWithScenes[]) => void;
  selectedScenes: Set<string>;
  onSelectedScenesChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onPanelStateChange?: (isOpen: boolean, width: number) => void;
}

const ScenesInternPanel: React.FC<ScenesInternPanelProps> = ({
  isOpen,
  onClose,
  segments,
  onSegmentsUpdate,
  selectedScenes,
  onSelectedScenesChange,
  onPanelStateChange,
}) => {
  const { user, setUser, token } = useContext(UserContext);
  
  const [internInput, setInternInput] = useState('');
  const [internOutput, setInternOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSelectedScenes, setShowSelectedScenes] = useState(false);
  
  // Resize state for intern panel
  const [internPanelSize, setInternPanelSize] = useState<{
    width: number;
    height: number | 'auto';
  }>({
    width: 380,
    height: 'auto'
  });
  const [isResizing, setIsResizing] = useState<'width' | 'height' | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 400, height: 0 });

  // Get all scenes with metadata
  const getAllScenes = () => {
    const allScenes: (Scene & { segmentId: string; segmentTitle: string; actNumber: number })[] = [];
    
    segments.forEach(segment => {
      segment.scenes.forEach(scene => {
        allScenes.push({
          ...scene,
          segmentId: segment.id,
          segmentTitle: segment.title,
          actNumber: segment.act
        });
      });
    });
    
    return allScenes;
  };

  // Helper functions for scene selection
  const handleSelectAll = () => {
    const allSceneIds = getAllScenes().map(scene => scene.sceneId);
    onSelectedScenesChange(new Set(allSceneIds));
  };
  
  const handleDeselectAll = () => {
    onSelectedScenesChange(new Set());
  };

  const removeSceneFromSelection = (sceneToRemove: string) => {
    onSelectedScenesChange(prev => {
      const newSet = new Set(prev);
      newSet.delete(sceneToRemove);
      return newSet;
    });
  };

  // Determine if we should show breadcrumb chips based on width and selection count
  const shouldShowBreadcrumbs = () => {
    const selectedCount = selectedScenes.size;
    const isNarrow = internPanelSize.width < 450;
    
    // Always show if only 1 item selected
    if (selectedCount === 1) return true;
    
    // Show all if width is sufficient
    if (!isNarrow) return true;
    
    // For narrow width with multiple selections, show based on toggle
    return showSelectedScenes;
  };

  // Resize handlers for intern panel
  const handleResizeStart = (type: 'width' | 'height', e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(type);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: internPanelSize.width,
      height: typeof internPanelSize.height === 'number' ? internPanelSize.height : 600
    });
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;
    
    if (isResizing === 'width') {
      const newWidth = Math.max(320, Math.min(800, resizeStart.width - deltaX));
      setInternPanelSize(prev => ({ ...prev, width: newWidth }));
    } else if (isResizing === 'height') {
      const newHeight = Math.max(400, Math.min(window.innerHeight - 200, resizeStart.height + deltaY));
      setInternPanelSize(prev => ({ ...prev, height: newHeight }));
    }
  }, [isResizing, resizeStart]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(null);
  }, []);

  // FIXED: Only notify parent when panel state actually changes, not on every render
  useEffect(() => {
    if (onPanelStateChange && isOpen) {
      onPanelStateChange(isOpen, internPanelSize.width);
    }
  }, [isOpen]); // CRITICAL: Only depend on isOpen, not onPanelStateChange or width

  // FIXED: Only notify width changes when width actually changes
  useEffect(() => {
    if (onPanelStateChange && isOpen) {
      onPanelStateChange(isOpen, internPanelSize.width);
    }
  }, [internPanelSize.width]); // Only when width changes

  // Add mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = isResizing === 'width' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, resizeStart, handleResizeMove, handleResizeEnd]);

  // Handle the intern API mutation for scenes
  const mutateIntern = useMutation({
    mutationFn: async () => {
      const selectedScenesData = getAllScenes().filter(scene => selectedScenes.has(scene.sceneId));
      
      return await axios.post(`${process.env.REACT_APP_URL}/summary`, {
        "event": 'scenes-intern',
        "userId": token?.payload['cognito:username'],
        "user_request": internInput,
        "selected_scenes": selectedScenesData.map(scene => ({
          sceneId: scene.sceneId,
          title: scene.title,
          content: scene.content,
          segment_id: scene.segmentId,
          segment_title: scene.segmentTitle,
          act_number: scene.actNumber
        })),
        "segments_context": segments.map(seg => ({
          id: seg.id,
          title: seg.title,
          description: seg.description,
          act: seg.act
        }))
      },
      { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any) => {
      if (res.data.statusCode == 200) {
        setUser((user: UserType) => ({...user, cap: res.data.body.cap}));
        const { updated_scenes, explanation } = res.data.body;
        
        if (updated_scenes && Object.keys(updated_scenes).length > 0) {
          // Update the scenes based on the response
          const updatedSegments = segments.map(segment => {
            const updatedSegmentScenes = segment.scenes.map(scene => {
              if (selectedScenes.has(scene.sceneId) && updated_scenes[scene.sceneId]) {
                return {
                  ...scene,
                  content: updated_scenes[scene.sceneId].content || scene.content,
                  title: updated_scenes[scene.sceneId].title || scene.title,
                  metadata: {
                    ...scene.metadata,
                    lastUpdated: new Date().toISOString(),
                    internModified: true
                  }
                };
              }
              return scene;
            });
            
            return { ...segment, scenes: updatedSegmentScenes };
          });
          
          onSegmentsUpdate(updatedSegments);
        }
        
        setInternOutput(explanation || 'Scenes have been updated successfully.');
        setIsLoading(false);
      } else if (res.data.statusCode == 400) {
        setInternOutput(res.data.body.error);
        setIsLoading(false);
      } else {
        setInternOutput("Error processing request");
        setIsLoading(false);
      }
    },
    onError: (error: any) => {
      setInternOutput('Error processing request. Please try again.');
      setIsLoading(false);
    },
  });

  // Handle the intern submission
  const handleIntern = async () => {
    if (!internInput.trim()) return;
    setIsLoading(true);
    mutateIntern.mutateAsync();
  };

  if (!isOpen) return null;

  return (
    <div className="scenes-intern-panel-container">
      {/* Width Resize Handle */}
      <div
        className="scenes-resize-handle scenes-resize-handle-width"
        onMouseDown={(e) => handleResizeStart('width', e)}
      >
        <div className="scenes-resize-indicator scenes-resize-indicator-width" />
      </div>

      {/* Height Resize Handle */}
      <div
        className="scenes-resize-handle scenes-resize-handle-height"
        onMouseDown={(e) => handleResizeStart('height', e)}
      >
        <div className="scenes-resize-indicator scenes-resize-indicator-height" />
      </div>

      <div 
        className="scenes-intern-panel"
        style={{
          width: `${internPanelSize.width}px`,
          height: typeof internPanelSize.height === 'number' ? `${internPanelSize.height}px` : 'auto',
          maxHeight: typeof internPanelSize.height === 'number' ? 'none' : '80vh',
        }}
      >
        {/* Header */}
        <div className="scenes-intern-panel-header">
          <div className="scenes-intern-panel-title">Scenes Assistant</div>
          <button 
            className="scenes-intern-panel-close"
            onClick={onClose}
            title="Close scenes assistant"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div 
          className="scenes-intern-panel-content"
          style={{
            height: typeof internPanelSize.height === 'number' ? 'calc(100% - 65px)' : 'auto',
            overflowY: typeof internPanelSize.height === 'number' ? 'auto' : 'visible'
          }}
        >
          <ScenesInternSelectionControls
            selectedScenes={selectedScenes}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onRemoveScene={removeSceneFromSelection}
            allScenes={getAllScenes()}
            panelWidth={internPanelSize.width}
            showSelectedScenes={showSelectedScenes}
            onToggleShowScenes={setShowSelectedScenes}
            shouldShowBreadcrumbs={shouldShowBreadcrumbs()}
          />

          <ScenesInternForm
            input={internInput}
            onInputChange={setInternInput}
            onSubmit={handleIntern}
            isLoading={isLoading}
            selectedScenesCount={selectedScenes.size}
          />

          <ScenesInternResponse
            output={internOutput}
            maxHeight={typeof internPanelSize.height === 'number' ? 150 : 200}
          />
        </div>
      </div>
    </div>
  );
};

export default ScenesInternPanel;