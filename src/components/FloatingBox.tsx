import React from 'react';
import { Flex } from '@radix-ui/themes';
import { SegmentedControl } from '@radix-ui/themes';
import './FloatingBox.css';

interface FloatingBoxProps {
  onClearAllFields: () => void;
  setNewModel: (model: string) => void;
  onInternToggle: () => void;
  isInternActive: boolean;
}

const FloatingBox: React.FC<FloatingBoxProps> = ({
  onClearAllFields,
  setNewModel,
  onInternToggle,
  isInternActive,
}) => {
  // Handlers
  const handleClearAllFields = React.useCallback(() => {
    onClearAllFields();
  }, [onClearAllFields]);

  const handleInternToggle = React.useCallback(() => {
    onInternToggle();
  }, [onInternToggle]);

  // Button classes (no scrolling logic)
  const buttonClass = 'button';

  // Intern icon
  const InternIcon = () => (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.5 0.875C5.49797 0.875 3.875 2.49797 3.875 4.5C3.875 6.15288 4.98124 7.54738 6.49373 7.98351C5.2997 8.12901 4.27557 8.55134 3.50407 9.31167C2.52216 10.2794 2.02502 11.72 2.02502 13.5999C2.02502 13.8623 2.23769 14.0749 2.50002 14.0749C2.76236 14.0749 2.97502 13.8623 2.97502 13.5999C2.97502 11.8799 3.42786 10.7206 4.17091 9.9883C4.91536 9.25463 6.02674 8.87499 7.49995 8.87499C8.97317 8.87499 10.0846 9.25463 10.8291 9.98831C11.5721 10.7206 12.025 11.8799 12.025 13.5999C12.025 13.8623 12.2376 14.0749 12.5 14.0749C12.7623 14.0749 12.975 13.8623 12.975 13.6C12.975 11.72 12.4778 10.2794 11.4959 9.31166C10.7244 8.55135 9.70025 8.12903 8.50625 7.98352C10.0187 7.5474 11.125 6.15289 11.125 4.5C11.125 2.49797 9.50203 0.875 7.5 0.875ZM4.825 4.5C4.825 3.02264 6.02264 1.825 7.5 1.825C8.97736 1.825 10.175 3.02264 10.175 4.5C10.175 5.97736 8.97736 7.175 7.5 7.175C6.02264 7.175 4.825 5.97736 4.825 4.5Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  // Return a static bar (no floating)
  return (
    <div className="box">
      {/* This is a static top bar. Place <FloatingBox /> at the top of your layout. */}
      <Flex direction="row" justify="between" align="center" gap="0">
        <button onClick={handleClearAllFields} className={buttonClass}>
          <span className="svg-container">
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <span className="text">Clear All</span>
        </button>

        <SegmentedControl.Root
          defaultValue="base"
          radius="full"
          size="3"
          onValueChange={(newValue) => setNewModel(newValue)}
          className="rt-SegmentedControlRoot"
        >
          <SegmentedControl.Item value="base">
            <span className="desktop-text">Feature</span>
            <span className="mobile-text">F</span>
          </SegmentedControl.Item>
          <SegmentedControl.Item value="short">
            <span className="desktop-text">Short</span>
            <span className="mobile-text">S</span>
          </SegmentedControl.Item>
        </SegmentedControl.Root>

        <button className={buttonClass} onClick={handleInternToggle}>
          <span className="svg-container">
            <InternIcon />
          </span>
          <span className="text">Intern {isInternActive ? '(Active)' : ''}</span>
        </button>

      </Flex>
    </div>
  );
};

export default FloatingBox;
