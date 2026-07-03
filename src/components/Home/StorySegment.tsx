import React, { useState, useRef, useEffect } from 'react';
import { Flex, Text, Box, Tooltip } from '@radix-ui/themes';
import ConfirmModal from '../ui/ConfirmModal';

interface StorySegmentProps {
  id: string;
  segmentId?: string;
  segmentNumber: number;
  segmentTitle: string;
  data: any;
  customLabels: { [key: string]: string };
  isExpanded: boolean;
  isHovered: boolean;
  onToggleExpansion: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onChange: (field: string, isInternField?: boolean) => (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onClearField: (field: string) => void;
  internSelectedFields: Set<string>;
  onFieldSelection: (field: string) => void;
  isInternSelectionMode: boolean;
  tooltip: string;
  onInternToggle?: (field: string) => void;
  onGenerate?: (field: string) => void;
  isInternActive?: boolean;
  fieldLoadingStates?: { [key: string]: boolean };
  onCanvasMode?: (field: string) => void;
  /**
   * FIL-332: One-at-a-time generation policy.
   * True whenever ANY field (anywhere in the form) is currently generating
   * via individual generate button. Used to disable THIS field's generate
   * button even though THIS field isn't the one loading — prevents the user
   * from stacking up concurrent generations.
   *
   * Derived at the parent level from Object.values(fieldLoadingStates).some(...).
   */
  isAnyFieldGenerating?: boolean;
}

const StorySegment: React.FC<StorySegmentProps> = ({
  id,
  segmentId,
  segmentNumber,
  segmentTitle,
  data,
  customLabels,
  isExpanded,
  isHovered,
  onToggleExpansion,
  onMouseEnter,
  onMouseLeave,
  onChange,
  onClearField,
  internSelectedFields,
  onFieldSelection,
  isInternSelectionMode,
  tooltip,
  onInternToggle,
  onGenerate,
  isInternActive = false,
  fieldLoadingStates = {},
  onCanvasMode,
  isAnyFieldGenerating = false,
}) => {
  // Use id as the field identifier (segmentId is deprecated)
  const fieldId = segmentId || id;
  const [isFocused, setIsFocused] = useState(false);
  const [isTextareaHovered, setIsTextareaHovered] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // LOCAL loading state for immediate feedback
  const [localLoading, setLocalLoading] = useState(false);

  // Helper function to extract content from potentially complex data
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

  const content = getFieldContent(fieldId);

  // Combine parent loading state with local loading state
  const parentLoading = fieldLoadingStates[fieldId] || false;
  const isLoading = localLoading || parentLoading;

  // FIL-332: Generate button disables if THIS field is loading OR any other
  // field is. isLoading alone covers only this field; isAnyFieldGenerating
  // catches the case where the user has fired S3 regeneration and is now
  // hovering over S5's generate button.
  const isGenerateBlocked = isLoading || isAnyFieldGenerating;

  const isHighlighted = internSelectedFields.has(fieldId);
  const isEmpty = !content.trim();
  const preview = content ? `${content.substring(0, 100)}...` : '';
  const [openDeleteModal, setOpenDeleteModal] = useState(false);


  // Reset local loading ONLY when new content actually arrives
  useEffect(() => {
    if (localLoading) {
      const currentLength = content?.trim().length || 0;

      // Only stop loading if we have substantial content (more than just a few chars)
      // This prevents false positives from partial state updates
      if (currentLength > 50) {
        console.log(`✅ [${fieldId}] New content arrived (${currentLength} chars), stopping loading`);
        setLocalLoading(false);
      }
    }
  }, [content, localLoading, fieldId]);

  // Sync with parent loading state - if parent says done AND we have content, stop
  useEffect(() => {
    if (parentLoading === false && localLoading) {
      const currentLength = content?.trim().length || 0;
      if (currentLength > 50) {
        console.log(`✅ [${fieldId}] Parent done and content arrived (${currentLength} chars), stopping loading`);
        setLocalLoading(false);
      }
    }
  }, [parentLoading, localLoading, content, fieldId]);

  // Auto-resize textarea
  const adjustHeight = () => {
    const ta = textAreaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(150, ta.scrollHeight)}px`;
    }
  };

  useEffect(() => {
    if (isExpanded) {
      adjustHeight();
    }
  }, [content, isExpanded]);

  // Track previous expansion state to only focus on NEW expansions
  const wasExpandedRef = useRef(isExpanded);

  // Focus textarea when expanded (only on NEW expansion, not when intern mode changes)
  useEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    wasExpandedRef.current = isExpanded;

    // Only focus if segment is NEWLY expanded (wasn't expanded before, is now)
    // Don't focus if it was already expanded and intern mode just turned off
    if (isExpanded && !wasExpanded && textAreaRef.current && !isInternSelectionMode) {
      setTimeout(() => {
        textAreaRef.current?.focus();
      }, 100);
    }
  }, [isExpanded, isInternSelectionMode]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isInternSelectionMode) {
      e.preventDefault();
      return;
    }
    // FIL-332: Defensive guard behind the textarea's readOnly attribute.
    // The textarea is already readOnly when isLoading, so this change handler
    // shouldn't fire — but if browser behavior ever lets it through (paste,
    // drag-and-drop, autofill), we silently drop the change rather than
    // letting typed content get overwritten when the generation response lands.
    if (isLoading) {
      console.log(`🚫 [${fieldId}] Change blocked — field is generating`);
      return;
    }
    onChange(fieldId)(e);
  };

  const handleTextareaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInternSelectionMode && onFieldSelection) {
      onFieldSelection(fieldId);
    }
  };

  const handleHeaderClick = () => {
    if (isInternSelectionMode) {
      // In intern mode: if collapsed, expand first; if expanded, toggle selection
      if (!isExpanded) {
        // Collapsed: just expand it, don't select yet
        onToggleExpansion();
      } else {
        // Expanded: toggle selection
        if (onFieldSelection) {
          onFieldSelection(fieldId);
        }
      }
    } else {
      // Normal mode: toggle expansion
      onToggleExpansion();
    }
  };

  // Handle generate click with immediate local feedback
  const handleGenerateClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isGenerateBlocked || isInternSelectionMode) return;

    console.log(`🚀 [${fieldId}] Generate clicked, starting loading state`);

    // Set local loading immediately for instant feedback
    setLocalLoading(true);

    // Call parent handler
    onGenerate?.(fieldId);
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

  const ChevronIcon = () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease'
      }}
    >
      <path
        d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  const getTextAreaStyles = (): React.CSSProperties => {
    const blueColor = '#54bfdb';
    const blueShadow = `0 0 0.625rem ${blueColor}40, 0 0 1.25rem ${blueColor}20, 0 0 1.875rem ${blueColor}10`;

    const orangeColor = '#FF8C00';
    const orangeShadow = `inset 0 0 20px rgba(255, 140, 0, 0.1)`;

    let styles: React.CSSProperties = {
      width: '100%',
      fontFamily: "'Courier', monospace",
      fontSize: '14px',
      lineHeight: '1.7',
      minHeight: '150px',
      background: 'linear-gradient(135deg, rgba(60, 60, 68, 0.8) 0%, rgba(70, 70, 78, 0.8) 100%)',
      padding: '1.5rem',
      margin: 0,
      border: '1px solid rgba(255, 107, 53, 0.3)',
      borderTop: 'none',
      borderRadius: '0 0 12px 12px',
      color: '#ffffff',
      resize: 'none',
      outline: 'none',
      overflow: 'hidden',
      cursor: isInternSelectionMode ? 'pointer' : isLoading ? 'wait' : 'text',
      opacity: isInternSelectionMode && !isHighlighted ? 0.6 : 1,
      transition: 'all 0.3s ease',
      display: 'block',
    };

    // Blue highlight when selected in intern mode
    if (isHighlighted) {
      styles.border = `2px solid ${blueColor}`;
      styles.borderTop = 'none';
      styles.boxShadow = blueShadow;
      styles.background = 'rgba(59, 130, 246, 0.08)';
    }
    // Blue dashed border when in selection mode but not selected
    else if (isInternSelectionMode) {
      styles.border = '2px dashed rgba(59, 130, 246, 0.5)';
      styles.borderTop = 'none';
      styles.background = 'rgba(59, 130, 246, 0.02)';
      if (isTextareaHovered) {
        styles.boxShadow = `0 0 0.3rem ${blueColor}20, 0 0 0.6rem ${blueColor}10`;
      }
    }
    // Orange glow on focus (normal mode)
    else if (isFocused && !isLoading) {
      styles.border = '2px solid #FF8C00';
      styles.borderTop = 'none';
      styles.boxShadow = orangeShadow;
      styles.background = 'linear-gradient(135deg, rgba(70, 70, 78, 0.9) 0%, rgba(80, 80, 88, 0.9) 100%)';
    }

    return styles;
  };

  return (
    <Box
      id={fieldId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: isExpanded
          ? 'transparent'
          : 'linear-gradient(135deg, rgba(60, 60, 68, 0.5) 0%, rgba(70, 70, 78, 0.5) 100%)',
        border: isExpanded
          ? 'none'
          : '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        margin: '0.75rem 1rem',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header */}
      <Flex
        align="center"
        justify="between"
        onClick={handleHeaderClick}
        style={{
          padding: '1rem 1.25rem',
          cursor: 'pointer',
          borderBottom: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
          background: isExpanded
            ? 'linear-gradient(135deg, rgba(60, 60, 68, 0.5) 0%, rgba(70, 70, 78, 0.5) 100%)'
            : isHovered
              ? 'linear-gradient(135deg, rgba(255, 107, 53, 0.08) 0%, rgba(255, 140, 66, 0.04) 100%)'
              : 'transparent',
          borderRadius: isExpanded ? '12px 12px 0 0' : '12px',
          border: isExpanded ? '1px solid rgba(255, 107, 53, 0.3)' : 'none',
          borderBottomLeftRadius: isExpanded ? 0 : '12px',
          borderBottomRightRadius: isExpanded ? 0 : '12px',
          borderBottomColor: isExpanded ? 'transparent' : undefined,
          transition: 'background 0.2s ease',
        }}
      >
        {/* Left side: Number, Title, Tooltip, Badge */}
        <Flex align="center" gap="3">
          {/* Segment Number Badge */}
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: '600',
              fontSize: '14px',
              flexShrink: 0,
            }}
          >
            {segmentNumber}
          </div>

          {/* Title */}
          <Text
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#ffffff',
              margin: 0,
            }}
          >
            {segmentTitle}
          </Text>

          {/* Tooltip Icon */}
          <Tooltip
            content={tooltip}
            side="right"
            align="center"
            style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
          >
            <Box
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'help',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 107, 53, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: 'rgba(255, 255, 255, 0.7)' }}
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

          {/* EDITING Badge */}
          {isExpanded && !isLoading && (
            <span
              style={{
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              EDITING
            </span>
          )}

          {/* Loading indicator in header when generating */}
          {isLoading && (
            <span
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                color: 'white',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                animation: 'pulse 2s ease-in-out infinite',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="3 3">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    values="0 7.5 7.5;360 7.5 7.5"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              </svg>
              GENERATING
            </span>
          )}

          {/* Intern Selection Mode Indicator */}
          {isInternSelectionMode && (
            <Text
              size="1"
              style={{
                color: isHighlighted ? '#3b82f6' : '#6b7280',
                fontWeight: '500',
                fontSize: '11px',
              }}
            >
              {isHighlighted ? '✓ SELECTED' : 'Click to select'}
            </Text>
          )}

          {/* Hover hint when collapsed */}
          {isHovered && !isExpanded && !isInternSelectionMode && !isLoading && (
            <Text
              style={{
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '12px',
                fontStyle: 'italic',
              }}
            >
              Click to edit
            </Text>
          )}
        </Flex>

        {/* Right side: Action buttons (when expanded) + Chevron */}
        <Flex align="center" gap="2">
          {/* Action buttons - only show when expanded */}
          {isExpanded && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ display: 'flex', gap: '8px' }}
            >
              {/* Canvas Mode Button */}
              {onCanvasMode && (
                <Tooltip content="Open Canvas Mode" side="bottom">
                  <button
                    type="button"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: '1px solid rgba(139, 92, 246, 0.4)',
                      backgroundColor: 'rgba(139, 92, 246, 0.15)',
                      color: '#a78bfa',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                      opacity: isInternSelectionMode ? 0.5 : 1,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!isInternSelectionMode) {
                        onCanvasMode(fieldId);
                      }
                    }}
                    disabled={isInternSelectionMode}
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
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: isInternActive ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: isInternActive ? '#3b82f6' : '#2a2a2a',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    boxShadow: isInternActive
                      ? 'inset 0 1px 2px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.15), 0 0 12px rgba(59, 130, 246, 0.4)'
                      : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isInternActive) {
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
                    onInternToggle?.(fieldId);
                  }}
                >
                  <InternIcon />
                </button>
              </Tooltip>

              {/*
                FIL-332: Generate button.
                Disabled when this field is loading (existing behavior) OR when
                any OTHER field is currently generating (new one-at-a-time policy).
                Tooltip copy distinguishes the two cases so the user knows WHY
                the button is dimmed.
              */}
              <Tooltip
                content={
                  isLoading
                    ? "Generating..."
                    : isAnyFieldGenerating
                      ? "Another field is generating"
                      : "Generate Content"
                }
                side="bottom"
              >
                <button
                  type="button"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: isLoading ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: isLoading ? '#3b82f6' : '#2a2a2a',
                    color: '#ffffff',
                    cursor: isLoading ? 'wait' : isGenerateBlocked ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    boxShadow: isLoading
                      ? '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)'
                      : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                    // Dim the button when blocked for a non-loading reason
                    // (i.e., another field is generating). Loading state already
                    // has its own blue visual treatment.
                    opacity: isInternSelectionMode
                      ? 0.5
                      : (isAnyFieldGenerating && !isLoading)
                        ? 0.45
                        : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isGenerateBlocked && !isInternSelectionMode) {
                      e.currentTarget.style.backgroundColor = '#FF8C00';
                      e.currentTarget.style.border = '1px solid rgba(255, 140, 0, 0.5)';
                      e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 140, 0, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLoading) {
                      e.currentTarget.style.backgroundColor = '#2a2a2a';
                      e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                    }
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log(`🖱️ [${fieldId}] Generate button mousedown`);
                    if (!isGenerateBlocked && !isInternSelectionMode) {
                      console.log(`🚀 [${fieldId}] Generate triggered via mousedown`);
                      setLocalLoading(true);
                      onGenerate?.(fieldId);
                    } else if (isAnyFieldGenerating && !isLoading) {
                      console.log(`🚫 [${fieldId}] Generate blocked — another field is generating`);
                    }
                  }}
                  disabled={isGenerateBlocked || isInternSelectionMode}
                >
                  <GenerateIcon />
                </button>
              </Tooltip>

              <Tooltip content="Clear Field" side="bottom">
                <button
                  type="button"
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: '#2a2a2a',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                    opacity: isInternSelectionMode ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isInternSelectionMode) {
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
                    if (!isInternSelectionMode) {
                      setOpenDeleteModal(true);
                    }
                  }}
                  disabled={isInternSelectionMode}
                >
                  <ClearIcon />
                </button>
              </Tooltip>
            </div>
          )}

          {/* Chevron */}
          <div
            style={{
              color: '#ff6b35',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: isExpanded ? '0.5rem' : 0,
            }}
          >
            <ChevronIcon />
          </div>
        </Flex>
      </Flex>

      {/* Content Area */}
      {isExpanded ? (
        /*
          FIL-332: Wrap textarea in a relative container so we can overlay
          a shimmer when isLoading. The shimmer conveys "generation in
          progress" at the field level — complements the GENERATING badge
          in the header. Shimmer is pointer-events:none so it doesn't
          interfere with any stray interactions.
        */
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textAreaRef}
            value={content}
            onChange={handleInput}
            onClick={handleTextareaClick}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onMouseEnter={() => setIsTextareaHovered(true)}
            onMouseLeave={() => setIsTextareaHovered(false)}
            /*
              FIL-332: readOnly during generation so typed content doesn't
              get overwritten when the response lands. Also kept for intern
              selection mode (existing behavior). handleInput has a defensive
              guard behind this in case the browser lets a change slip
              through (paste, autofill, drag-and-drop).
            */
            readOnly={isInternSelectionMode || isLoading}
            placeholder={isLoading ? "Generating content..." : "Start writing this segment, or click Generate to create content..."}
            style={getTextAreaStyles()}
          />

          {/*
            Shimmer overlay — visible only when isLoading. Uses the brand
            palette gradient animating across the textarea. Matches the
            shimmer treatment in the overlay components (progress bar) for
            visual consistency.
          */}
          {isLoading && (
            <div
              className="segment-shimmer-overlay"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '0 0 12px 12px',
                pointerEvents: 'none',
                background: 'linear-gradient(90deg, transparent 0%, rgba(90, 175, 165, 0.08) 25%, rgba(232, 184, 75, 0.10) 50%, rgba(255, 140, 66, 0.08) 75%, transparent 100%)',
                backgroundSize: '200% 100%',
                animation: 'segmentShimmer 2.4s linear infinite',
                mixBlendMode: 'screen',
              }}
            />
          )}
        </div>
      ) : (
        /* Preview when collapsed */
        !isEmpty && (
          <div
            style={{
              padding: '0.75rem 1.25rem 1rem 1.25rem',
              paddingLeft: 'calc(1.25rem + 32px + 12px)', // Align with title (past the number badge)
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '13px',
              lineHeight: '1.5',
              fontStyle: 'italic',
            }}
          >
            {preview}
          </div>
        )
      )}

      {/* CSS for pulse animation + FIL-332 shimmer */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes segmentShimmer {
          0%   { background-position: -100% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      {/*
        FIL-341: Scope-accurate ConfirmModal copy with irreversibility warning.
        
        The segment case is genuinely destructive: clearing wipes typed or
        generated content from state and fires a save to DynamoDB. There is
        no undo stack. "Rewrite or regenerate" doesn't give the user back
        their specific words if they spent real effort on the prose.
        
        Copy choices:
          - Title: "Clear segment" — matches the action verb the user clicked
          - Description: names the specific segment being cleared, followed
            by a bolded "This cannot be undone" line so the warning reads as
            a distinct beat rather than getting buried in explanatory prose
          - Confirm label: "Clear" — mirrors the title and action
          - danger: true — swaps the button from orange gradient to red
            gradient, the correct visual signal for destructive actions
            that can't be reversed
      */}
      <ConfirmModal
        open={openDeleteModal}
        title="Clear segment"
        description={
          <>
            Clear content from <strong className="text-white">{segmentTitle}</strong>?
            <br />
            <strong className="text-white">This cannot be undone.</strong>
          </>
        }
        confirmLabel="Clear"
        danger={true}
        onCancel={() => setOpenDeleteModal(false)}
        onConfirm={() => onClearField(fieldId)}
      />
    </Box>
  );
};

export default React.memo(StorySegment);