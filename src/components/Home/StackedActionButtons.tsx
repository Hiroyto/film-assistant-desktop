import React, { useState, useContext, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Button, Flex, Box, Text } from '@radix-ui/themes';
import { FilePlus, LifeBuoy, Menu, Save, SquareChartGantt, Users, X } from 'lucide-react';
import TextArea from '../TextArea';
import { UserContext } from '../../App';
import InternPanel from './InternPanelHome';
import CharacterPanel from '../characters-home/CharacterPanel';
import '../../styles/Home/StackedActionButtons.css';
import Tooltip from '../ui/Tooltip';
import StoryTutorialModal from './StoryTutorialModal';
import ActsPreviewModal from './ActsPreviewModal';
import { exportStoryToPdf } from '../../lib/exportStoryToPdf';
import { useTour } from '../Tour/useTour';
import { createTourSteps } from '../Tour/tourStepsOutline';
import ConfirmModal from '../ui/ConfirmModal';

// In both StackedActionButtons.tsx and InternPanelHome.tsx:
interface StoryData {
  [key: string]: any;
}

interface BaseStackedActionButtonsProps {
  characters: any[];
  onAddCharacter: (character: any) => void;
  onUpdateCharacter: (character: any) => void;
  onDeleteCharacter: (characterId: string) => void;
  onClearAllFields: () => void;
  setNewModel: (model: string) => void;
  onInternToggle: () => void;
  isInternActive: boolean;
  currentModel: string;
  // Make intern-related props optional
  storyData?: StoryData;
  onStoryUpdate?: (newData: StoryData) => void;
  onDeselectAll?: () => void;
  onSelectAll?: () => void;
  selectedFields?: Set<string>;
  isInternSelectionMode?: boolean;
  onInternModeChange?: (isActive: boolean) => void;
  internSelectedFields?: Set<string>;
  onFieldSelectionChange?: React.Dispatch<React.SetStateAction<Set<string>>>;
  // NEW: Callback to notify parent about intern panel state changes
  onInternPanelStateChange?: (isOpen: boolean, width: number) => void;
  // NEW: Force intern panel to open from external trigger
  forceInternOpen?: boolean;
  onNewStory: () => void;
  handleCloseHint: () => void;
}

interface InternStackedActionButtonsProps extends BaseStackedActionButtonsProps {
  // All props are now in the base interface
}

type StackedActionButtonsProps = BaseStackedActionButtonsProps | InternStackedActionButtonsProps;

// Interface for the ref
interface StackedActionButtonsRef {
  openInternPanel: () => void;
  closeInternPanel: () => void;
}

const StackedActionButtons = forwardRef<StackedActionButtonsRef, StackedActionButtonsProps>((props, ref) => {
  // Destructure props without defaults first to check what was actually passed
  const {
    characters,
    onClearAllFields,
    setNewModel,
    onInternToggle,
    isInternActive,
    currentModel,
    storyData,
    onStoryUpdate,
    onDeselectAll,
    onSelectAll,
    selectedFields,
    isInternSelectionMode,
    onInternModeChange,
    internSelectedFields,
    onFieldSelectionChange,
    onInternPanelStateChange,
    forceInternOpen = false,
    onNewStory,
    handleCloseHint
  } = props;

  // Provide defaults only for internal use
  const normalizeStory = (data: any) => {
    const segments = [
      'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'
    ];

    const result: any = {
      M: '', T: '', G: '', CQ: '', SUM: ''
    };

    segments.forEach(key => {
      const value = data?.[key];
      result[key] = typeof value === "string" ? value : '';
    });

    return result;
  };

  const safeStoryData = normalizeStory(storyData);
  const safeInternSelectedFields = internSelectedFields || new Set();
  const safeOnStoryUpdate = onStoryUpdate || (() => { });
  const safeOnFieldSelectionChange = onFieldSelectionChange || (() => { });

  // Get UserContext data (including character functions)
  const { attributes, user, setUser, signOut, token, loading, data, setData, debouncedSave } = useContext(UserContext);

  const [charactersOpen, setCharactersOpen] = useState(false);
  const [internOpen, setInternOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openTutorial, setOpenTutorial] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [openDeleteModal, setOpenDeleteModal] = useState(false);

  const { startTour } = useTour();

  const handleClosePanels = () => {
    if (charactersOpen || internOpen) {
      setInternOpen(false);
      setCharactersOpen(false);
    }
  }


  // Expose the openInternPanel and closeInternPanel functions via ref
  useImperativeHandle(ref, () => ({
    openInternPanel: () => {
      console.log('🔧 StackedActionButtons: openInternPanel called via ref');
      if (!internOpen) {
        console.log('🔧 StackedActionButtons: Opening intern panel via ref');
        setInternOpen(true);
        if (onInternPanelStateChange) {
          onInternPanelStateChange(true, 380);
        }
        if (onInternModeChange) {
          onInternModeChange(true);
        }
        if (charactersOpen) {
          setCharactersOpen(false);
        }
      } else {
        console.log('🔧 StackedActionButtons: Panel already open');
      }
    },
    closeInternPanel: () => {
      console.log('🔧 StackedActionButtons: closeInternPanel called via ref');
      if (internOpen) {
        console.log('🔧 StackedActionButtons: Closing intern panel via ref');
        setInternOpen(false);
        if (onInternPanelStateChange) {
          onInternPanelStateChange(false, 380);
        }
        if (onInternModeChange) {
          onInternModeChange(false);
        }
      } else {
        console.log('🔧 StackedActionButtons: Panel already closed');
      }
    }
  }));

  // Effect to handle window event approach (keeping as backup)
  useEffect(() => {
    const handleForceOpen = (event: any) => {
      console.log('🔧 StackedActionButtons: Received forceOpenInternPanel event', event.detail);
      if (!internOpen) {
        console.log('🔧 StackedActionButtons: Opening intern panel via custom event');
        setInternOpen(true);

        // Notify parent about panel state change
        if (onInternPanelStateChange) {
          onInternPanelStateChange(true, 380);
        }

        // Close characters panel if opening intern
        if (charactersOpen) {
          setCharactersOpen(false);
        }
      }
    };

    window.addEventListener('forceOpenInternPanel', handleForceOpen);

    return () => {
      window.removeEventListener('forceOpenInternPanel', handleForceOpen);
    };
  }, [internOpen, charactersOpen, onInternPanelStateChange]);

  // Effect to handle forced intern panel opening via prop
  useEffect(() => {
    if (forceInternOpen && !internOpen) {
      console.log('🔧 StackedActionButtons: Force opening intern panel via prop');
      setInternOpen(true);

      // Notify parent about panel state change
      if (onInternPanelStateChange) {
        onInternPanelStateChange(true, 380);
      }

      // Close characters panel if opening intern
      if (charactersOpen) {
        setCharactersOpen(false);
      }
    }
  }, [forceInternOpen, internOpen, charactersOpen, onInternPanelStateChange]);

  const handleModelToggle = () => {
    const newModel = currentModel === 'base' ? 'short' : 'base';
    setNewModel(newModel);
  };

  // Handle intern toggle - SIMPLE toggle without prevention logic
  const handleInternToggle = () => {
    const newInternOpen = !internOpen;
    console.log('🔧 StackedActionButtons: Manual intern toggle to:', newInternOpen);

    // Always allow the toggle - remove the prevention logic
    setInternOpen(newInternOpen);

    // Notify parent about intern panel state change
    if (onInternPanelStateChange) {
      onInternPanelStateChange(newInternOpen, 380);
    }

    if (onInternModeChange) {
      onInternModeChange(newInternOpen);
    }

    // Close characters panel if opening intern
    if (newInternOpen && charactersOpen) {
      setCharactersOpen(false);
    }
  };

  // Handle characters toggle - close intern panel if open
  const handleCharactersToggle = () => {
    setCharactersOpen(!charactersOpen);
    // Close intern panel if open
    if (!charactersOpen && internOpen) {
      setInternOpen(false);
      if (onInternModeChange) {
        onInternModeChange(false);
      }
      // Notify parent about intern panel closing
      if (onInternPanelStateChange) {
        onInternPanelStateChange(false, 380);
      }
    }
  };

  // Icons
  const InternIcon = () => (
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left lens */}
      <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Right lens */}
      <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      {/* Bridge */}
      <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      {/* Left temple */}
      <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      {/* Right temple */}
      <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      {/* Left temple arm */}
      <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      {/* Right temple arm */}
      <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );

  const ClearIcon = () => (
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  const handleStartTour = () => {
    setMenuOpen(!menuOpen)
    startTour(
      createTourSteps({
        setMenuOpen
      })
    );
  };

  return (
    <>
      <div className="stacked-menu-wrapper">

        <button
          className={`stacked-menu-toggle ${menuOpen ? "open" : ""}`}
          onClick={() => {
            setMenuOpen(!menuOpen)
            handleClosePanels()
          }}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div className={`stacked-buttons-collapsible ${menuOpen ? "open" : ""}`}>
          <div className="stacked-buttons-container">
            <Tooltip
              description='Help'
              position='left'
            >
              <Button
                className="stacked-action-button help-button"
                // onClick={() => {
                //   setOpenTutorial(true);
                //   handleCloseHint()
                // }}
                onClick={handleStartTour}
              >
                <LifeBuoy />
              </Button>
            </Tooltip>

            <Tooltip
              description='Acts Preview'
              position='left'
            >
              <Button
                id='actsPreview'
                className="stacked-action-button"
                onClick={() => setPreviewOpen(true)}
              >
                <SquareChartGantt />
              </Button>
            </Tooltip>

            {/* Characters Button */}
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

            {/* Clear All Button */}
            <Tooltip
              description='Clear All'
              position='left'
            >
              <Button
                className="stacked-action-button clear-button"
                onClick={() => setOpenDeleteModal(true)}
              >
                <ClearIcon />
              </Button>
            </Tooltip>

            {/* Model Toggle Button */}
            {/* <Tooltip
              description='Model Toggle'
              position='left'
            >
              <Button
                className="stacked-action-button model-button"
                onClick={handleModelToggle}
                data-model={currentModel}
              >
                <Text size="2" weight="bold">
                  {currentModel === 'base' ? 'F' : 'S'}
                </Text>
              </Button>
            </Tooltip> */}

            {/* Intern Toggle Button */}
            <Tooltip
              description='Intern'
              position='left'
            >
              <Button
                className="stacked-action-button intern-button"
                onClick={handleInternToggle}
                data-active={internOpen}
                style={internOpen ? {
                  background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                  backgroundColor: '#3b82f6',
                  borderColor: 'rgba(59, 130, 246, 0.5)',
                  boxShadow: '0 0 12px rgba(59, 130, 246, 0.4), 0 6px 20px rgba(59, 130, 246, 0.3)',
                  color: '#ffffff',
                } : undefined}
              >
                <InternIcon />
              </Button>
            </Tooltip>

            <Tooltip
              description='New Story'
              position='left'
            >
              <Button
                className="stacked-action-button"
                onClick={onNewStory}
              >
                <FilePlus />
              </Button>
            </Tooltip>
          </div>
        </div>

      </div>

      <StoryTutorialModal
        isOpen={openTutorial}
        onClose={() => setOpenTutorial(false)}
      />

      < CharacterPanel
        isOpen={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />

      {/* Intern Panel */}
      <InternPanel
        isOpen={internOpen}
        onClose={() => {
          console.log('🔧 StackedActionButtons: Intern panel closing');
          setInternOpen(false);
          // Notify parent about panel closing
          if (onInternPanelStateChange) {
            onInternPanelStateChange(false, 380);
          }
        }}
        storyData={safeStoryData}
        onStoryUpdate={safeOnStoryUpdate}
        internSelectedFields={safeInternSelectedFields}
        onFieldSelectionChange={safeOnFieldSelectionChange}
        onPanelStateChange={onInternPanelStateChange}
      />

      <ActsPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        story={storyData ?? {}}
      />
      <ConfirmModal
        open={openDeleteModal}
        title="Delete Content"
        description="All content will be cleared from this story."
        confirmLabel="Delete"
        onCancel={() => setOpenDeleteModal(false)}
        onConfirm={onClearAllFields}
      />
    </>
  );
});

StackedActionButtons.displayName = 'StackedActionButtons';

export default StackedActionButtons;