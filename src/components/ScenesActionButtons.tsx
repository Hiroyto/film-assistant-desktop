import React, { useState } from 'react';
import { Button } from '@radix-ui/themes';
import './ScenesActionButtons.css';
import { FilePlus, LifeBuoy, SquareChartGantt, Users } from 'lucide-react';
import Tooltip from './ui/Tooltip';
import ScenesPreviewModal from './Home/ScenesPreviewModal';
import CharacterPanel from './characters-home/CharacterPanel';
import { useTour } from '../components/Tour/useTour';
import { tourSteps } from './Tour/tourStepsScenes';

interface StoryData {
  [key: string]: any;
}

interface ScenesActionButtonsProps {
  onToggleSuggestions: () => void;
  onToggleRevisions: () => void;
  isSuggestActive: boolean;
  isReviseActive: boolean;
  addNewScene: (mode: 'before' | 'after' | 'end', index?: number) => void;
  storyData?: StoryData;
  onStoryUpdate?: (newData: StoryData) => void;
}

const SuggestIcon = () => (
  <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7.5 3C5.567 3 4 4.567 4 6.5C4 7.753 4.5 8.5 5.25 9.25C5.75 9.75 6 10.25 6 11V11.5C6 11.7761 6.22386 12 6.5 12H8.5C8.77614 12 9 11.7761 9 11.5V11C9 10.25 9.25 9.75 9.75 9.25C10.5 8.5 11 7.753 11 6.5C11 4.567 9.433 3 7.5 3Z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <path d="M6 13.5H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M7.5 0.5V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M12 2.5L11.25 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M3 2.5L3.75 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M13.5 6.5H12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M2.5 6.5H1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ReviseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const ScenesActionButtons: React.FC<ScenesActionButtonsProps> = ({
  onToggleSuggestions,
  onToggleRevisions,
  isSuggestActive,
  isReviseActive,
  addNewScene,
  storyData,
  onStoryUpdate,
}) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const { startTour } = useTour();

  const handleCharactersToggle = () => {
    setCharactersOpen(!charactersOpen);
    // Close intern panel if open
    // if (!charactersOpen && internOpen) {
    //   setInternOpen(false);
    //   if (onInternModeChange) {
    //     onInternModeChange(false);
    //   }
    //   // Notify parent about intern panel closing
    //   if (onInternPanelStateChange) {
    //     onInternPanelStateChange(false, 380);
    //   }
    // }
  };

  return (
    <><div className="scenes-action-buttons-container">
      <Tooltip
        description='Help'
        position='left'
      >
        <Button
          id='actsPreview'
          className="stacked-action-button help-button"
          // onClick={() => {
          //   setOpenTutorial(true);
          //   handleCloseHint()
          // }}
          onClick={() => startTour(tourSteps)}
        >
          <LifeBuoy />
        </Button>
      </Tooltip>
      {/* Suggest Button */}
      <Tooltip
        description='Suggest'
        position='left'
      >
        <Button
          className="scenes-action-button"
          onClick={onToggleSuggestions}
          data-active={isSuggestActive}
          style={isSuggestActive ? {
            borderColor: 'rgba(139, 92, 246, 0.6)',
            backgroundColor: 'rgba(139, 92, 246, 0.15)',
            color: '#c4b5fd',
            boxShadow: '0 0 16px rgba(139, 92, 246, 0.3)',
          } : undefined}
        >
          <SuggestIcon />
        </Button>
      </Tooltip>

      {/* Revise Button */}
      <Tooltip
        description='Revise'
        position='left'
      >
        <Button
          className="scenes-action-button"
          onClick={onToggleRevisions}
          data-active={isReviseActive}
          style={isReviseActive ? {
            borderColor: 'rgba(6, 182, 212, 0.6)',
            backgroundColor: 'rgba(6, 182, 212, 0.15)',
            color: '#67e8f9',
            boxShadow: '0 0 16px rgba(6, 182, 212, 0.3)',
          } : undefined}
        >
          <ReviseIcon />
        </Button>
      </Tooltip>

      {/* Add Scene Button */}
      <Tooltip
        description='Add Scene'
        position='left'
      >
        <Button
          className="scenes-action-button"
          onClick={() => addNewScene('end')}
        >
          <FilePlus size={18} />
        </Button>
      </Tooltip>

      <Tooltip
        description='Characters'
        position='left'
      >
        <Button
          className="stacked-action-button"
          onClick={handleCharactersToggle}
          data-active={charactersOpen}
        >
          <Users size={20} />
        </Button>
      </Tooltip>

      <Tooltip
        description='Scenes Preview'
        position='left'
      >
        <Button
          className="stacked-action-button"
          onClick={() => setPreviewOpen(true)}
        >
          <SquareChartGantt />
        </Button>
      </Tooltip>
    </div>
      <ScenesPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        story={storyData ?? {}}
      />
      <CharacterPanel
        isOpen={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />
    </>

  );
};

ScenesActionButtons.displayName = 'ScenesActionButtons';

export default ScenesActionButtons;