import React, { useState } from 'react';
import { Flex, Button, Dialog, Text, TextField } from '@radix-ui/themes';
import { useNavigate } from 'react-router-dom';
import ConfirmModal from '../ui/ConfirmModal';

interface StoryActionsProps {
  onSave: (title: string) => void;
  onGenerateStory: () => void;
  isGenerating: boolean;
  currentTitle: string;
  canGenerate: boolean;           // NEW: orchestrator-era gate (any input present)
  actsReady?: boolean;             // kept for any other uses; no longer the gate
  hasSegmentContent?: boolean;     // true if any S1-S9 has content
  segmentsAllPopulated?: boolean;  // true if ALL of S1-S9 have content
}

const SummaryIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

const StoryActions: React.FC<StoryActionsProps> = ({
  onSave,
  onGenerateStory,
  isGenerating,
  currentTitle,
  canGenerate,
  actsReady,
  hasSegmentContent = false,
  segmentsAllPopulated = false,
}) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [openClear, setOpenClear] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showScenesTooltip, setShowScenesTooltip] = useState(false);
  const navigate = useNavigate();

  const isDisabled = isGenerating || !canGenerate || segmentsAllPopulated;

  // Button config: label, tooltip (always shown on hover), confirm description.
  // Order matters: isGenerating wins over completion state (a stale
  // segmentsAllPopulated flag during the final write shouldn't prematurely
  // flip the label). segmentsAllPopulated then wins over canGenerate so the
  // "nothing to do" state reads correctly.
  const getButtonConfig = () => {
    if (isGenerating) {
      return {
        label: 'Generating...',
        tooltip: 'Generating your story...',
        confirmDescription: '',
      };
    }

    if (segmentsAllPopulated) {
      return {
        label: 'Outline Complete',
        tooltip: 'All 9 segments are filled. Clear a segment to regenerate it, or use Develop Scenes to continue.',
        confirmDescription: '',
      };
    }

    if (!canGenerate) {
      return {
        label: hasSegmentContent ? 'Finish Outline' : 'Generate Outline',
        tooltip: 'Add a brainstorm, summary, or at least one field (genre, theme, mood, or a segment) to generate your story.',
        confirmDescription: '',
      };
    }

    if (hasSegmentContent) {
      return {
        label: 'Finish Outline',
        tooltip: 'Completes empty fields in your outline. Already-filled fields are preserved.',
        confirmDescription: 'Any blank sections will be generated using your existing context. Already-filled fields will not be changed.',
      };
    }

    return {
      label: 'Generate Outline',
      tooltip: 'Completes empty fields in your outline. Already-filled fields are preserved.',
      confirmDescription: 'Empty fields will be generated using your existing context. Already-filled fields will not be changed.',
    };
  };

  const { label, tooltip, confirmDescription } = getButtonConfig();

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    if (title.length === 0) {
      return;
    } else if (title === currentTitle) {
      return;
    } else {
      onSave(title);
      setOpen(false);
      setTitle("");
    }
  };

  const handleButtonClick = () => {
    // Defensive: button should be disabled, but if somehow reached while disabled, no-op
    if (isDisabled) return;
    setOpenClear(true);
  };

  const buttonElement = (
    <Button
      id='generateStory'
      onClick={handleButtonClick}
      name="generate_story"
      style={{
        background: '#ffffff',
        color: 'black',
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
        border: 'none',
        fontWeight: '500',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 12px rgba(255, 140, 0, 0.2)',
        cursor: !isDisabled ? 'pointer' : 'not-allowed',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginRight: '32px',
        opacity: !isDisabled ? 1 : 0.5,
      }}
      onMouseEnter={e => {
        if (!isDisabled) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.25)';
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 140, 0, 0.2)';
      }}
      disabled={isDisabled}
    >
      <SummaryIcon />
      {label}
    </Button>
  );

  return (
    <>
      <Flex justify="end" align="center" gap="3">
        {/* Develop Scenes button — only shows when segments have content */}
        {hasSegmentContent && (
          <div
            style={{ position: 'relative', display: 'inline-flex' }}
            onMouseEnter={() => setShowScenesTooltip(true)}
            onMouseLeave={() => setShowScenesTooltip(false)}
          >
            <Button
              onClick={() => navigate('/scenes')}
              style={{
                background: 'transparent',
                color: '#ff8c42',
                padding: '0.75rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(255, 107, 53, 0.3)',
                fontWeight: '500',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(255, 140, 0, 0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.5)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.2)';
                e.currentTarget.style.background = 'rgba(255, 107, 53, 0.08)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.3)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(255, 140, 0, 0.1)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3h11M2 6.5h7M2 10h9M2 13.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Develop Scenes
            </Button>

            {showScenesTooltip && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 10px)',
                  right: '0',
                  maxWidth: '260px',
                  padding: '10px 14px',
                  background: 'linear-gradient(135deg, rgba(26, 26, 30, 0.95) 0%, rgba(20, 20, 24, 0.95) 100%)',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                  borderRadius: '10px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(255, 107, 53, 0.1)',
                  backdropFilter: 'blur(12px)',
                  color: 'rgba(255, 255, 255, 0.85)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  zIndex: 1000,
                  pointerEvents: 'none',
                  animation: 'tooltipFadeIn 0.2s ease-out',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '40px',
                    width: '12px',
                    height: '12px',
                    background: 'linear-gradient(135deg, rgba(26, 26, 30, 0.95) 0%, rgba(20, 20, 24, 0.95) 100%)',
                    border: '1px solid rgba(255, 107, 53, 0.3)',
                    borderRight: 'none',
                    borderBottom: 'none',
                    transform: 'rotate(45deg)',
                  }}
                />
                Jump to Scene Editor to flesh out the story beats for your Outline
              </div>
            )}
          </div>
        )}

        {/*
          Generate / Finish Outline button.

          The wrapper div is the hover target — disabled buttons don't reliably
          fire mouseenter/mouseleave in all browsers, so we attach the hover
          handlers to the wrapper. This makes the tooltip appear when hovering
          over a disabled button, which is exactly when the user most needs an
          explanation of why they can't click.
        */}
        <div
          style={{ position: 'relative', display: 'inline-flex' }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {buttonElement}

          {/*
            Tooltip is shown whenever there's a tooltip message AND the user is
            hovering. Previous gate was (tooltip && actsReady && showTooltip
            && !isGenerating), which hid the tooltip exactly when the button
            was disabled — the opposite of what helps users.
          */}
          {tooltip && showTooltip && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 10px)',
                right: '32px',
                maxWidth: '280px',
                padding: '10px 14px',
                background: 'linear-gradient(135deg, rgba(26, 26, 30, 0.95) 0%, rgba(20, 20, 24, 0.95) 100%)',
                border: '1px solid rgba(255, 107, 53, 0.3)',
                borderRadius: '10px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(255, 107, 53, 0.1)',
                backdropFilter: 'blur(12px)',
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '13px',
                lineHeight: 1.5,
                zIndex: 1000,
                pointerEvents: 'none',
                animation: 'tooltipFadeIn 0.2s ease-out',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '40px',
                  width: '12px',
                  height: '12px',
                  background: 'linear-gradient(135deg, rgba(26, 26, 30, 0.95) 0%, rgba(20, 20, 24, 0.95) 100%)',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                  borderRight: 'none',
                  borderBottom: 'none',
                  transform: 'rotate(45deg)',
                }}
              />
              {tooltip}
            </div>
          )}
        </div>
      </Flex>

      <style>{`
        @keyframes tooltipFadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <ConfirmModal
        open={openClear}
        title={hasSegmentContent ? 'Finish Outline' : 'Generate Outline'}
        description={confirmDescription}
        confirmLabel="Generate"
        onCancel={() => setOpenClear(false)}
        onConfirm={() => {
          onGenerateStory();
          setOpenClear(false);
        }}
      />
    </>
  );
};

export default StoryActions;