import React, { useState, useRef, useEffect } from 'react';
import { Flex, Text, TextArea as RadixTextArea, Tooltip } from '@radix-ui/themes';
import './TextArea.css';
import ConfirmModal from './ui/ConfirmModal';

interface TextAreaProps {
  field: string;
  rows?: number;
  width?: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onClearField: (field: string) => void;
  customLabels: { [key: string]: string };
  isHighlighted?: boolean;
  onToggleHighlight?: () => void;
  isHighlightable?: boolean;
  isDisabled?: boolean;
  isInternField?: boolean;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  onInternToggle?: (field: string) => void;
  onGenerate?: (field: string) => void;
  isInternActive?: boolean;
  fieldLoadingStates?: { [key: string]: boolean };
  isLoading?: boolean;
}

const TextArea: React.FC<TextAreaProps> = ({
  field,
  rows = 1,
  width = '100%',
  value,
  onChange,
  onClearField,
  customLabels,
  isHighlighted = false,
  onToggleHighlight,
  isHighlightable = false,
  isDisabled = false,
  isInternField = false,
  onInternToggle,
  onGenerate,
  isInternActive = false,
  fieldLoadingStates = {},
  isLoading = false
}) => {
  // Collapsible fields: G, T, M, CQ
  const isCollapsibleField = ['G', 'T', 'M', 'CQ'].includes(field);
  const [isExpanded, setIsExpanded] = useState(!isCollapsibleField);

  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const isFieldLoading = isLoading || fieldLoadingStates[field] || false;
  const isGenerateEnabled = (field.match(/^S[1-9]$/) || field === 'CQ' || field === 'SUM' || ['G', 'T', 'M'].includes(field)) && !isDisabled && !isHighlightable;

  const [openDeleteModal, setOpenDeleteModal] = useState(false);


  // Helper text for collapsed fields
  const helperTexts: { [key: string]: string } = {
    'G': 'Type of story (e.g., Crime Drama, Psychological Thriller)',
    'T': 'The universal truth beneath the plot (e.g., Redemption, Identity)',
    'M': 'Atmosphere and place of your story',
    'CQ': 'Open-ended question your story explores (e.g., Can love survive betrayal?)'
  };

  // Auto-resize functionality - ALWAYS show full content, no scrolling
  const adjustHeight = () => {
    const ta = textAreaRef.current;
    if (ta) {
      // Reset height to recalculate
      ta.style.height = 'auto';
      // Set to scrollHeight to show all content
      ta.style.height = `${ta.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value, isExpanded]);

  // Adjust height on window resize
  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isHighlightable && !isInternField) {
      e.preventDefault();
      return;
    }
    onChange(e);
  };

  const tooltipContent = {
    "G": "A brief label indicating the type of story (e.g., Drama, Mystery, Sci-Fi), providing context for the story's style, tone, and conventions.",
    "SUM": "A concise description of the story's central plot and key events, capturing the core narrative in a few sentences.",
    "T": "The underlying message or idea explored in the story, such as love, redemption, or the struggle against corruption.",
    "CQ": "The primary question driving the story, often related to the protagonist's journey or conflict, e.g., \"Can one truly escape the past?\"",
    "M": "The emotional atmosphere of the story, setting expectations for how it feels to experience the narrative (e.g., tense, melancholic, hopeful).",
    "S1": "The opening scene or sequence that establishes the protagonist's everyday life, grounding the story before any major conflict arises.",
    "S2": "The event that disrupts the protagonist's life, setting the story's main conflict in motion and drawing the protagonist into action.",
    "S3": "A pivotal moment where the protagonist makes a decision or takes an action that commits them to the story's central journey, closing off the option to return to their former life.",
    "S4": "A pressure point that intensifies the conflict, often by revealing new information or escalating tension, reminding the protagonist of the stakes involved.",
    "S5": "A major turning point where the protagonist experiences a significant realization, shift in perspective, or confrontation that deepens their commitment to the goal or conflict.",
    "S6": "A critical challenge or obstacle that raises the stakes even higher, often bringing the protagonist to a low point or forcing them to confront their fears.",
    "S7": "The story's darkest moment, where all seems lost for the protagonist, intensifying the drama before the final push toward resolution.",
    "S8": "The peak of the story's action, where the main conflict reaches its most intense point and the protagonist faces their greatest challenge or decision.",
    "S9": "The story's conclusion, showing the outcome of the protagonist's journey and resolving any lingering questions or themes.",
    "Your Notes": "This is your intern, leave notes to make changes to your story. Change the name of a character, or add more detail to a segment, or re-work the narrative. It's up to you."
  } as const;

  const handleMouseMove = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setMousePosition({ x, y });
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isHighlightable && onToggleHighlight) {
      e.preventDefault();
      e.stopPropagation();
      onToggleHighlight();
    }
  };

  const handleCollapsedClick = () => {
    if (isCollapsibleField && !isExpanded) {
      setIsExpanded(true);
      setTimeout(() => {
        textAreaRef.current?.focus();
        adjustHeight();
      }, 100);
    }
  };

  const handleCollapseClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (textAreaRef.current) {
      textAreaRef.current.blur();
    }
    setIsFocused(false);
    setIsExpanded(false);
  };

  const getTextAreaStyle = () => {
    const baseStyle: React.CSSProperties = {
      width: '100%',
      border: '0.125rem solid rgba(0, 0, 0, 0.2)',
      borderRadius: '0.5rem',
      transition: 'all 0.3s ease-in-out',
      outline: 'none',
      WebkitTapHighlightColor: 'transparent',
      fontFamily: "'Courier', monospace",
      boxShadow: 'none',
      position: 'relative',
      zIndex: 2,
      cursor: isHighlightable ? 'pointer' : 'text',
      background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.8) 0%, rgba(70, 70, 78, 0.8) 100%)',
      pointerEvents: isHighlightable ? 'none' : 'auto',
      opacity: 1,
      resize: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
      padding: '0.75rem',
      paddingRight: '3rem',
      color: '#ffffff',
      minHeight: 'auto',
      // Larger, more readable font for Summary field
      fontSize: field === 'SUM' ? '15px' : '13px',
      lineHeight: field === 'SUM' ? '1.8' : '1.5',
    };

    const orangeColor = '#FF8C00';
    const orangeShadow = `0 0 0.625rem ${orangeColor}40, 0 0 1.25rem ${orangeColor}20, 0 0 1.875rem ${orangeColor}10`;

    const blueColor = '#54bfdb';
    const blueShadow = `0 0 0.625rem ${blueColor}40, 0 0 1.25rem ${blueColor}20, 0 0 1.875rem ${blueColor}10`;

    if (isHovered || isFocused) {
      const { x, y } = mousePosition;
      const width = 300;
      const height = 150;

      const distanceX = Math.max(0, width - x);
      const distanceY = Math.max(0, height - y);

      const angle = Math.atan2(distanceY, distanceX);

      const shadowDistance = Math.min(Math.sqrt(distanceX * distanceX + distanceY * distanceY), 20);
      const shadowX = Math.cos(angle) * shadowDistance;
      const shadowY = Math.sin(angle) * shadowDistance;

      if (!isHighlighted) {
        baseStyle.boxShadow = `
          ${shadowX}px ${shadowY}px 0.625rem rgba(0, 0, 0, 0.1),
          ${shadowX * 1.5}px ${shadowY * 1.5}px 1.25rem rgba(0, 0, 0, 0.05),
          ${shadowX * 2}px ${shadowY * 2}px 1.875rem rgba(0, 0, 0, 0.025)
        `;
      }
    }

    if (isFocused && !isDisabled && !isHighlightable) {
      baseStyle.border = `0.125rem solid ${orangeColor}`;
      baseStyle.boxShadow = `${baseStyle.boxShadow || ''}, ${orangeShadow}`;
      baseStyle.background = 'linear-gradient(135deg, rgba(70, 70, 78, 0.9) 0%, rgba(80, 80, 88, 0.9) 100%)';
    }

    if (isHighlighted) {
      baseStyle.border = `0.125rem solid ${blueColor}`;
      baseStyle.backgroundColor = 'rgba(59, 130, 246, 0.08)';
      baseStyle.boxShadow = blueShadow;
    }

    if (isHighlightable && !isHighlighted) {
      baseStyle.border = '0.125rem dashed rgba(59, 130, 246, 0.5)';
      baseStyle.backgroundColor = 'rgba(59, 130, 246, 0.02)';

      if (isHovered) {
        baseStyle.boxShadow = `0 0 0.3rem ${blueColor}20, 0 0 0.6rem ${blueColor}10`;
      }
    }

    return baseStyle;
  };

  // Icons
  const InternIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );

  const GenerateIcon = () => {
    if (isFieldLoading) {
      return (
        <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 3">
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="0 7.5 7.5;360 7.5 7.5"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      );
    }

    return (
      <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      </svg>
    );
  };

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

  const CollapseIcon = () => (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.84182 3.13514C9.04327 3.32401 9.05348 3.64042 8.86462 3.84188L5.43521 7.49991L8.86462 11.1579C9.05348 11.3594 9.04327 11.6758 8.84182 11.8647C8.64036 12.0535 8.32394 12.0433 8.13508 11.8419L4.38508 7.84188C4.20477 7.64955 4.20477 7.35027 4.38508 7.15794L8.13508 3.15794C8.32394 2.95648 8.64036 2.94628 8.84182 3.13514Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );

  const getGenerateButtonStyle = () => {
    const baseStyle: React.CSSProperties = {
      minWidth: '36px',
      height: '36px',
      padding: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      transition: 'all 0.2s ease',
      cursor: 'pointer',
      backgroundColor: '#2a2a2a',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#ffffff',
      boxShadow:
        'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)'
    };

    if (!isGenerateEnabled) {
      baseStyle.opacity = 0.5;
      baseStyle.cursor = 'not-allowed';
    }

    if (isFieldLoading) {
      baseStyle.backgroundColor = '#3b82f6';
      baseStyle.border = '1px solid rgba(59, 130, 246, 0.5)';
      baseStyle.boxShadow =
        '0 0 8px rgba(59, 130, 246, 0.3), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
      baseStyle.cursor = 'wait';
    }

    return baseStyle;
  };

  const getGenerateTooltipText = () => {
    if (!isGenerateEnabled) {
      return "Individual generation available for story segments (S1-S9)";
    } else if (isFieldLoading) {
      return "Generating content...";
    } else {
      return "Generate Content";
    }
  };

  // Render collapsed state for G, T, M, CQ
  if (isCollapsibleField && !isExpanded) {
    return (
      <div className="textarea-collapsed-container" style={{ width }}>
        <Flex align="center" gap="2" style={{ marginBottom: '0.375rem' }}>
          <Text as="label" style={{ fontFamily: "'Helvetica Neue', Arial", fontWeight: '500', fontSize: '13px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {field === 'G' ? 'Genre' :
              field === 'T' ? 'Theme' :
                field === 'M' ? 'Mood & Setting' :
                  field === 'CQ' ? 'Core Question' : field}
          </Text>
          <Tooltip
            content={tooltipContent[field as keyof typeof tooltipContent]}
            side="right"
            align="center"
            style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
          >
            <div className="textarea-tooltip-icon">
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M7.5 1.75C4.26472 1.75 1.75 4.26472 1.75 7.5C1.75 10.7353 4.26472 13.25 7.5 13.25C10.7353 13.25 13.25 10.7353 13.25 7.5C13.25 4.26472 10.7353 1.75 7.5 1.75ZM0.25 7.5C0.25 3.43629 3.43629 0.25 7.5 0.25C11.5637 0.25 14.75 3.43629 14.75 7.5C14.75 11.5637 11.5637 14.75 7.5 14.75C3.43629 14.75 0.25 11.5637 0.25 7.5Z M7 4.75C7 4.33579 7.33579 4 7.75 4C8.16421 4 8.5 4.33579 8.5 4.75C8.5 5.16421 8.16421 5.5 7.75 5.5C7.33579 5.5 7 5.16421 7 4.75ZM7 6.5C7 6.22386 7.22386 6 7.5 6C7.77614 6 8 6.22386 8 6.5V10.5C8 10.7761 7.77614 11 7.5 11C7.22386 11 7 10.7761 7 10.5V6.5Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </Tooltip>
        </Flex>

        <div
          className={`textarea-collapsed ${value.trim() ? 'has-content' : ''}`}
          onClick={handleCollapsedClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="textarea-collapsed-content">
            {value.trim() ? (
              <div className="textarea-collapsed-value">{value}</div>
            ) : (
              <div className="textarea-collapsed-helper">{helperTexts[field]}</div>
            )}
          </div>
          <div className="textarea-collapsed-arrow">→</div>
        </div>
      </div>
    );
  }

  // Render expanded state (normal textarea with buttons)
  return (
    <Flex
      direction="row"
      className="textarea-container"
      style={{ width }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Flex direction="column" className="textarea-content" style={{ flex: 1 }}>
        <Flex align="center" gap="2">
          <Text as="label" htmlFor={field} style={{ fontFamily: "'Helvetica Neue', Arial", fontWeight: '500', color: 'rgba(255, 255, 255, 0.9)' }}>
            {field.startsWith('S') ? customLabels[field] :
              (field === 'G' ? 'Genre' :
                field === 'T' ? 'Theme' :
                  field === 'M' ? 'Mood & Setting' :
                    field === 'CQ' ? 'Core Question' :
                      field === 'SUM' ? 'Summary' :
                        field)}
          </Text>
          <Tooltip
            content={tooltipContent[field as keyof typeof tooltipContent]}
            side="right"
            align="center"
            style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
          >
            <div className="textarea-tooltip-icon">
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M7.5 1.75C4.26472 1.75 1.75 4.26472 1.75 7.5C1.75 10.7353 4.26472 13.25 7.5 13.25C10.7353 13.25 13.25 10.7353 13.25 7.5C13.25 4.26472 10.7353 1.75 7.5 1.75ZM0.25 7.5C0.25 3.43629 3.43629 0.25 7.5 0.25C11.5637 0.25 14.75 3.43629 14.75 7.5C14.75 11.5637 11.5637 14.75 7.5 14.75C3.43629 14.75 0.25 11.5637 0.25 7.5Z M7 4.75C7 4.33579 7.33579 4 7.75 4C8.16421 4 8.5 4.33579 8.5 4.75C8.5 5.16421 8.16421 5.5 7.75 5.5C7.33579 5.5 7 5.16421 7 4.75ZM7 6.5C7 6.22386 7.22386 6 7.5 6C7.77614 6 8 6.22386 8 6.5V10.5C8 10.7761 7.77614 11 7.5 11C7.22386 11 7 10.7761 7 10.5V6.5Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </Tooltip>

          {isHighlightable && (
            <Text
              size="1"
              style={{
                color: isHighlighted ? '#3b82f6' : '#6b7280',
                fontWeight: '500',
                fontSize: '11px'
              }}
            >
              {isHighlighted ? '✓ SELECTED' : 'Click to select'}
            </Text>
          )}
        </Flex>
        <div style={{ position: 'relative' }}>
          <RadixTextArea
            ref={textAreaRef}
            name={field}
            value={value}
            onChange={handleInput}
            style={getTextAreaStyle()}
            onMouseMove={handleMouseMove}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={isHighlightable && !isInternField}
          />

          {/* Collapse button inside textarea (only for collapsible fields) */}
          {isCollapsibleField && (
            <button
              type="button"
              className="textarea-collapse-button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (textAreaRef.current) {
                  textAreaRef.current.blur();
                }
                setIsFocused(false);
                setIsExpanded(false);
              }}
              title="Collapse field"
            >
              <CollapseIcon />
            </button>
          )}
        </div>
      </Flex>

      {/* Stacked Button Group (only visible when expanded) */}
      <div
        className="textarea-button-stack"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {onInternToggle && (
          <Tooltip content="Toggle Intern Panel" side="left">
            <button
              type="button"
              className="textarea-button textarea-intern-button"
              style={{
                backgroundColor: isInternActive ? '#3b82f6' : '#2a2a2a',
                border: isInternActive ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: isInternActive
                  ? 'inset 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.15), 0 0 12px rgba(59, 130, 246, 0.4)'
                  : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)'
              }}
              onMouseEnter={(e) => {
                if (!isInternActive && !isDisabled) {
                  e.currentTarget.style.backgroundColor = '#3b82f6';
                  e.currentTarget.style.border = '1px solid rgba(59, 130, 246, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isInternActive) {
                  e.currentTarget.style.backgroundColor = '#2a2a2a';
                  e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                }
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                // Always allow toggle - if intern is active, this will close it
                if (!isDisabled && onInternToggle) {
                  onInternToggle(field);
                }
              }}
              disabled={isDisabled}
            >
              <InternIcon />
            </button>
          </Tooltip>
        )}

        {onGenerate && (
          <Tooltip content={getGenerateTooltipText()} side="left">
            <button
              type="button"
              className="textarea-button textarea-generate-button"
              style={getGenerateButtonStyle()}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log(`🖱️ [${field}] Generate button mousedown`);
                if (isGenerateEnabled && !isFieldLoading && onGenerate) {
                  console.log(`🚀 [${field}] Generate triggered`);
                  onGenerate(field);
                }
              }}
              disabled={!isGenerateEnabled || isFieldLoading}
            >
              <GenerateIcon />
            </button>
          </Tooltip>
        )}

        <Tooltip content="Clear Field" side="left">
          <button
            type="button"
            className="textarea-button textarea-clear-button"
            onMouseEnter={(e) => {
              if (!isDisabled && !isHighlightable) {
                e.currentTarget.style.backgroundColor = '#dc2626';
                e.currentTarget.style.border = '1px solid rgba(220, 38, 38, 0.5)';
                e.currentTarget.style.boxShadow = '0 0 12px rgba(220, 38, 38, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#2a2a2a';
              e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!isDisabled && !isHighlightable) {
                setOpenDeleteModal(true);
              }
            }}
            disabled={isDisabled || isHighlightable}
          >
            <ClearIcon />
          </button>
        </Tooltip>
      </div>
      <ConfirmModal
        open={openDeleteModal}
        title="Delete Content"
        description="All content will be cleared from this story."
        confirmLabel="Delete"
        onCancel={() => setOpenDeleteModal(false)}
        onConfirm={() => onClearField(field)}
      />
    </Flex>
  );
};

export default TextArea;