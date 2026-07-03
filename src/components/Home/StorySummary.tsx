import React, { useState, useRef, useEffect } from 'react';
import { Flex, Text, Box, Tooltip } from '@radix-ui/themes';
import ConfirmModal from '../ui/ConfirmModal';

interface StorySummaryProps {
  id: string;
  data: any;
  onChange: (field: string, isInternField?: boolean) => (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onClearField: (field: string) => void;
  customLabels: { [key: string]: string };
  internSelectedFields: Set<string>;
  onFieldSelection: (field: string) => void;
  isInternSelectionMode: boolean;
  onInternToggle: (field: string) => void;
  onGenerate: (field: string) => void;
  isInternActive: boolean;
  fieldLoadingStates: { [key: string]: boolean };
  // Canvas mode props
  onOpenCanvas?: (field: string) => void;
  /**
   * FIL-332: One-at-a-time generation policy flag from Home.tsx.
   * True whenever ANY field (anywhere in the form) is currently generating.
   * Used alongside the existing local derivation to gate the generate,
   * canvas, and clear buttons on this summary field.
   */
  isAnyFieldGenerating?: boolean;
}

const StorySummary: React.FC<StorySummaryProps> = ({
  id,
  data,
  onChange,
  onClearField,
  internSelectedFields,
  onFieldSelection,
  isInternSelectionMode,
  onInternToggle,
  onGenerate,
  isInternActive = false,
  fieldLoadingStates,
  onOpenCanvas,
  isAnyFieldGenerating = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showTextarea, setShowTextarea] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // FIL-332: Authoritative source is the prop from Home.tsx, but we OR with
  // the local derivation as a safety net. Both compute the same thing — if
  // Home ever stops passing the prop, the local version still works.
  const isAnyFieldLoadingLocal = Object.values(fieldLoadingStates).some(Boolean);
  const anythingGenerating = isAnyFieldGenerating || isAnyFieldLoadingLocal;

  const getFieldContent = (field: string): string => {
    const fieldData = data[field];

    if (!fieldData) return '';

    if (typeof fieldData === 'string') {
      return fieldData;
    } else if (typeof fieldData === 'object' && 'S' in fieldData && typeof fieldData.S === 'string') {
      return fieldData.S;
    }

    return '';
  };

  const value = getFieldContent('SUM');
  const isLoading = fieldLoadingStates['SUM'] || false;
  const isHighlighted = internSelectedFields.has('SUM');
  const isEmpty = !value.trim();
  // FIL-332: Swapped from the old local-only derivation to the combined flag.
  // Buttons disable whether "something is generating" comes from this
  // component's sibling field or from another section entirely.
  const isButtonsDisabled = anythingGenerating || isInternSelectionMode;
  const [openDeleteModal, setOpenDeleteModal] = useState(false);


  // Show textarea immediately if there's content
  useEffect(() => {
    if (!isEmpty) {
      setShowTextarea(true);
    }
  }, [isEmpty]);

  // Auto-resize textarea
  const adjustHeight = () => {
    const ta = textAreaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(300, ta.scrollHeight)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isInternSelectionMode) {
      e.preventDefault();
      return;
    }
    // FIL-332: Defensive guard behind the textarea's readOnly attribute.
    // readOnly should prevent typing, but paste/drag-drop/autofill can still
    // fire change events in some browsers. Drop any change when this field
    // is actively being generated — the generation response will overwrite
    // whatever the user types.
    if (isLoading) {
      return;
    }
    onChange('SUM')(e);
  };

  const handleClick = () => {
    if (isInternSelectionMode && onFieldSelection) {
      onFieldSelection('SUM');
    }
  };

  const handleStartWriting = () => {
    setShowTextarea(true);
    // Wait for the component to render the textarea, then focus it
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
      }
    }, 100);
  };

  const handleOpenCanvasMode = () => {
    if (onOpenCanvas) {
      onOpenCanvas('SUM');
    }
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

  const CanvasIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="9" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="2" y="9" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="9" y="9" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );

  const GenerateIcon = () => {
    if (isLoading) {
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

  const getTextAreaStyles = () => {
    const blueColor = '#54bfdb';
    const blueShadow = `0 0 0.625rem ${blueColor}40, 0 0 1.25rem ${blueColor}20, 0 0 1.875rem ${blueColor}10`;

    const orangeColor = '#FF8C00';
    const orangeShadow = `inset 0 0 0 2px #FF8C00, inset 0 0 20px rgba(255, 140, 0, 0.1)`;

    let styles: React.CSSProperties = {
      fontFamily: "'Courier', monospace",
      fontSize: '15px',
      lineHeight: '1.8',
      minHeight: '300px',
      background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.8) 0%, rgba(70, 70, 78, 0.8) 100%)',
      padding: '2rem 1.5rem',
      margin: 0,
      borderRadius: '0 0 12px 12px',
      // FIL-332: wait cursor during loading, even though readOnly blocks edits
      cursor: isInternSelectionMode ? 'pointer' : isLoading ? 'wait' : 'text',
      pointerEvents: isInternSelectionMode ? 'auto' : 'auto',
      opacity: isButtonsDisabled ? 0.5 : 1,
    };

    // Blue highlight when selected in intern mode
    if (isHighlighted) {
      styles.boxShadow = `inset 0 0 0 2px ${blueColor}, ${blueShadow}`;
      styles.background = 'rgba(59, 130, 246, 0.08)';
    }
    // Blue dashed border when in selection mode but not selected
    else if (isInternSelectionMode) {
      styles.border = '2px dashed rgba(59, 130, 246, 0.5)';
      styles.background = 'rgba(59, 130, 246, 0.02)';
      if (isHovered) {
        styles.boxShadow = `0 0 0.3rem ${blueColor}20, 0 0 0.6rem ${blueColor}10`;
      }
    }
    // Orange glow on focus (normal mode) — suppressed during loading so the
    // user doesn't see a "ready to type" visual on a field they can't edit
    else if (isFocused && !isLoading) {
      styles.boxShadow = orangeShadow;
      styles.background = 'linear-gradient(135deg, rgba(70, 70, 78, 0.9) 0%, rgba(80, 80, 88, 0.9) 100%)';
    }

    return styles;
  };

  return (
    <Box
      id={id}
      ref={containerRef}
      className="w-full rounded-xl mb-8"
      style={{
        background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.5) 0%, rgba(70, 70, 78, 0.5) 100%)',
        border: '1px solid rgba(255, 107, 53, 0.2)',
        overflow: 'hidden'
      }}
    >
      {/* Header - integrated into container */}
      <Flex
        align="center"
        justify="between"
        className="px-6 py-5 border-b"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.08)'
        }}
      >
        <Flex align="center" gap="2">
          <Text className="text-2xl font-semibold text-white m-0">
            Story Preview
          </Text>
          <Tooltip
            content="A narrative preview of your story from setup to midpoint. The foundation for generating your full outline"
            side="right"
            align="center"
            style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
          >
            <Box className="w-4 h-4 rounded-full bg-white/15 flex items-center justify-center cursor-help transition-all duration-200 hover:bg-[#ff6b35]/20 hover:text-[#ff6b35]"
              style={{
                display: 'inline-flex',
                verticalAlign: 'middle'
              }}
            >
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current"
                style={{
                  display: 'block'
                }}
              >
                <path
                  d="M7.5 1.75C4.26472 1.75 1.75 4.26472 1.75 7.5C1.75 10.7353 4.26472 13.25 7.5 13.25C10.7353 13.25 13.25 10.7353 13.25 7.5C13.25 4.26472 10.7353 1.75 7.5 1.75ZM0.25 7.5C0.25 3.43629 3.43629 0.25 7.5 0.25C11.5637 0.25 14.75 3.43629 14.75 7.5C14.75 11.5637 11.5637 14.75 7.5 14.75C3.43629 14.75 0.25 11.5637 0.25 7.5Z M7 4.75C7 4.33579 7.33579 4 7.75 4C8.16421 4 8.5 4.33579 8.5 4.75C8.5 5.16421 8.16421 5.5 7.75 5.5C7.33579 5.5 7 5.16421 7 4.75ZM7 6.5C7 6.22386 7.22386 6 7.5 6C7.77614 6 8 6.22386 8 6.5V10.5C8 10.7761 7.77614 11 7.5 11C7.22386 11 7 10.7761 7 10.5V6.5Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
            </Box>
          </Tooltip>

          {isInternSelectionMode && (
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

        {/* Action buttons in header - using div with stopPropagation for reliable event handling */}
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ display: 'flex', gap: '8px' }}
        >
          {/* Canvas Mode Button */}
          {onOpenCanvas && (
            <Tooltip content="Open Canvas Mode" side="bottom">
              <button
                id='canvasButton'
                type="button"
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: '1px solid rgba(139, 92, 246, 0.4)',
                  backgroundColor: 'rgba(139, 92, 246, 0.15)',
                  color: '#a78bfa',
                  cursor: isButtonsDisabled ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                  opacity: isButtonsDisabled ? 0.5 : 1,
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!isButtonsDisabled) {
                    handleOpenCanvasMode();
                  }
                }}
                disabled={isButtonsDisabled}
                onMouseEnter={(e) => {
                  if (!isInternSelectionMode) {
                    e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.3)';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.6)';
                    e.currentTarget.style.color = '#c4b5fd';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                  e.currentTarget.style.color = '#a78bfa';
                }}
              >
                <CanvasIcon />
              </button>
            </Tooltip>
          )}

          <Tooltip content="Toggle Intern Panel" side="bottom">
            <button
              type="button"
              className="w-9 h-9 rounded-full border text-white cursor-pointer flex items-center justify-center transition-all duration-200"
              disabled={isButtonsDisabled}
              style={{
                opacity: isButtonsDisabled ? 0.5 : 1,
                cursor: isButtonsDisabled ? 'not-allowed' : 'pointer',
                backgroundColor: isInternActive ? '#3b82f6' : '#2a2a2a',
                borderColor: isInternActive ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255, 255, 255, 0.1)',
                boxShadow: isInternActive
                  ? 'inset 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.15), 0 0 12px rgba(59, 130, 246, 0.4)'
                  : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)'
              }}
              onMouseEnter={(e) => {
                if (!isInternActive) {
                  e.currentTarget.style.backgroundColor = '#3b82f6';
                  e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isInternActive) {
                  e.currentTarget.style.backgroundColor = '#2a2a2a';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                }
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                // Always allow toggle - if intern is active, this will close it
                onInternToggle('SUM');
              }}
            >
              <InternIcon />
            </button>
          </Tooltip>

          {/*
            FIL-332: Generate tooltip copy distinguishes the two blocked cases:
            - this field is generating ("Generating story preview...")
            - another field is generating ("Another field is generating")
            - available to click otherwise
          */}
          <Tooltip
            content={
              isLoading
                ? "Generating story preview..."
                : (anythingGenerating && !isLoading)
                  ? "Another field is generating"
                  : "Generate Story Preview"
            }
            side="bottom"
          >
            <button
              id='generateButton'
              type="button"
              className="w-9 h-9 rounded-full border text-white cursor-pointer flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: isLoading ? '#3b82f6' : '#2a2a2a',
                borderColor: isLoading ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255, 255, 255, 0.1)',
                cursor: isLoading
                  ? 'wait'
                  : isButtonsDisabled
                    ? 'not-allowed'
                    : 'pointer',
                boxShadow: isLoading
                  ? '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)'
                  : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                opacity: isButtonsDisabled ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isLoading && !isButtonsDisabled) {
                  e.currentTarget.style.backgroundColor = '#FF8C00';
                  e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 140, 0, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor = '#2a2a2a';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                }
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log(`🖱️ [SUM] Generate button mousedown`);
                if (!isButtonsDisabled) {
                  onGenerate('SUM');
                }
              }}
              disabled={isButtonsDisabled}
            >
              <GenerateIcon />
            </button>
          </Tooltip>

          <Tooltip content="Clear Field" side="bottom">
            <button
              type="button"
              className="w-9 h-9 rounded-full border border-white/10 bg-[#2a2a2a] text-white cursor-pointer flex items-center justify-center transition-all duration-200"
              style={{
                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                opacity: isButtonsDisabled ? 0.5 : 1,
                cursor: isButtonsDisabled ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isInternSelectionMode) {
                  e.currentTarget.style.backgroundColor = '#dc2626';
                  e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.5)';
                  e.currentTarget.style.boxShadow = '0 0 12px rgba(220, 38, 38, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#2a2a2a';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!isButtonsDisabled) {
                  setOpenDeleteModal(true);
                }
              }}
              disabled={isButtonsDisabled}
            >
              <ClearIcon />
            </button>
          </Tooltip>
        </div>
      </Flex>

      {isEmpty && !showTextarea ? (
        <div className="flex flex-col items-center justify-center text-center py-20 px-10"
          style={{
            minHeight: '300px',
            background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.3) 0%, rgba(70, 70, 78, 0.3) 100%)',
            borderRadius: '0 0 12px 12px'
          }}
        >
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: '1.5rem', opacity: 0.3 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="10 9 9 9 8 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>

          <div className="text-lg font-semibold mb-3 text-white/90">Create Your Story Preview</div>
          <div className="text-sm text-white/50 mb-8 leading-relaxed max-w-md">
            Write your own Story Preview from scratch or click Generate for a spark
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              className="py-3 px-6 rounded-lg border border-white/20 bg-[#2a2a2a]/80 text-white cursor-pointer text-sm font-medium transition-all duration-200 hover:bg-[#3a3a3a]/90 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleStartWriting();
              }}
            >
              Start Writing →
            </button>

            <button
              type="button"
              className="py-3 px-6 rounded-lg border-none text-white cursor-pointer text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff8c00 100%)'
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!isButtonsDisabled) {
                  onGenerate('SUM');
                }
              }}
              disabled={isButtonsDisabled}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #ff7f4d 0%, #ffa500 100%)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #ff6b35 0%, #ff8c00 100%)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
              </svg>
              {isLoading ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      ) : (
        /*
          FIL-332: Wrap textarea so we can overlay a shimmer during loading,
          matching the StorySegment pattern. Consistent visual treatment
          across all loading fields. pointer-events:none on the overlay so
          it doesn't interfere with any stray interactions.
        */
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textAreaRef}
            className="w-full text-white resize-none border-none outline-none overflow-hidden block"
            style={{
              ...getTextAreaStyles(),
              transition: 'all 0.5s ease-in-out',
            }}
            value={value}
            onChange={handleInput}
            onClick={handleClick}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            /*
              FIL-332: readOnly during generation prevents the user from typing
              into content that's about to be overwritten. handleInput has a
              defensive guard behind this for paste/drag-drop/autofill edge
              cases that can bypass readOnly in some browsers.
            */
            readOnly={isInternSelectionMode || isLoading}
            placeholder={isLoading
              ? "Generating story preview..."
              : "Start writing your story preview, or click Generate to create one based on your story foundation..."
            }
          />

          {/*
            Shimmer overlay — visible only while this SUM field is actively
            generating. Brand-palette gradient matching StorySegment's
            treatment so the visual language is consistent across loading
            fields. Keyframe is scoped via a unique class name to avoid
            colliding with StorySegment's copy.
          */}
          {isLoading && (
            <div
              className="summary-shimmer-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '0 0 12px 12px',
                pointerEvents: 'none',
                background: 'linear-gradient(90deg, transparent 0%, rgba(90, 175, 165, 0.08) 25%, rgba(232, 184, 75, 0.10) 50%, rgba(255, 140, 66, 0.08) 75%, transparent 100%)',
                backgroundSize: '200% 100%',
                animation: 'summaryShimmer 2.4s linear infinite',
                mixBlendMode: 'screen',
              }}
            />
          )}

          <style>{`
            @keyframes summaryShimmer {
              0%   { background-position: -100% 0; }
              100% { background-position: 200% 0; }
            }
          `}</style>
        </div>
      )}
      <ConfirmModal
        open={openDeleteModal}
        title="Delete Content"
        description="All content will be cleared from this story."
        confirmLabel="Delete"
        onCancel={() => setOpenDeleteModal(false)}
        onConfirm={() => onClearField('SUM')}
      />
    </Box>
  );
};

export default StorySummary;