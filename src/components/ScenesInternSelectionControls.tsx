import React from 'react';

interface Scene {
  sceneId: string;
  title: string;
  content: string;
  segmentId: string;
  segmentTitle: string;
  actNumber: number;
}

interface ScenesInternSelectionControlsProps {
  selectedScenes: Set<string>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRemoveScene: (sceneId: string) => void;
  allScenes: Scene[];
  panelWidth: number;
  showSelectedScenes: boolean;
  onToggleShowScenes: (show: boolean) => void;
  shouldShowBreadcrumbs: boolean;
}

const ScenesInternSelectionControls: React.FC<ScenesInternSelectionControlsProps> = ({
  selectedScenes,
  onSelectAll,
  onDeselectAll,
  onRemoveScene,
  allScenes,
  panelWidth,
  showSelectedScenes,
  onToggleShowScenes,
  shouldShowBreadcrumbs,
}) => {
  // Helper function to get scene display name
  // We derive display ID from the scene's position info
  const getSceneDisplayName = (scene: Scene): string => {
    // Find the index of this scene in allScenes to derive display number
    const segmentScenes = allScenes.filter(s => s.segmentId === scene.segmentId);
    const indexInSegment = segmentScenes.findIndex(s => s.sceneId === scene.sceneId);
    const displayId = `${scene.segmentId}.${indexInSegment + 1}`;
    return `${displayId}: ${scene.title || 'Untitled Scene'}`;
  };

  const SelectIcon = () => (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
      <path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"/>
    </svg>
  );

  const DeselectIcon = () => (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
      <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"/>
    </svg>
  );

  return (
    <div className="scenes-intern-selection-section">
      {/* Scene Selection Breadcrumb */}
      {selectedScenes.size > 0 && (
        <div className="scenes-selection-breadcrumb-container">
          <div className="scenes-selection-header">
            <span className="scenes-selection-label">
              Selected Scenes: {selectedScenes.size}
            </span>
            
            {/* Show toggle button for narrow widths with multiple selections */}
            {panelWidth < 450 && selectedScenes.size > 1 && (
              <button
                className="scenes-selection-toggle-btn"
                onClick={() => onToggleShowScenes(!showSelectedScenes)}
              >
                {showSelectedScenes ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          
          {/* Breadcrumb chips */}
          {shouldShowBreadcrumbs && (
            <div className="scenes-breadcrumb-chips">
              {Array.from(selectedScenes).map(sceneId => {
                const scene = allScenes.find(s => s.sceneId === sceneId);
                if (!scene) return null;
                
                return (
                  <div 
                    key={sceneId} 
                    className="scenes-breadcrumb-chip"
                    onClick={() => onRemoveScene(sceneId)}
                  >
                    {getSceneDisplayName(scene)}
                    <span className="scenes-breadcrumb-remove">×</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="scenes-selection-action-buttons">
        <button className="scenes-selection-action-btn" onClick={onSelectAll}>
          <SelectIcon />
          Select All Scenes
        </button>
        <button className="scenes-selection-action-btn" onClick={onDeselectAll}>
          <DeselectIcon />
          Deselect All
        </button>
      </div>

      {/* Status Text */}
      <div className="scenes-selection-status-text">
        {selectedScenes.size === 0 ? (
          'No scenes selected. Select scenes from the timeline to modify them.'
        ) : selectedScenes.size === allScenes.length ? (
          'All scenes selected. Changes will apply to your entire story.'
        ) : (
          `${selectedScenes.size} scenes selected. Changes will be applied to selected scenes only.`
        )}
      </div>
    </div>
  );
};

export default ScenesInternSelectionControls;