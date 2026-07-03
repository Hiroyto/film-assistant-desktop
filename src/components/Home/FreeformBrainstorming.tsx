import React, { useEffect, useState } from 'react';
import { Flex, Text, Button, Box, Tooltip } from '@radix-ui/themes';
import OverwriteConfirmModal from './OverwriteConfirmModal';

interface FreeformBrainstormingProps {
  id: string;
  data: any;
  onChange: (field: string, isInternField?: boolean) => (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onClearField: (field: string) => void;
  customLabels: { [key: string]: string };
  internSelectedFields: Set<string>;
  onFieldSelection: (field: string) => void;
  isInternSelectionMode: boolean;
  onProcess: (mode?: 'preview' | 'full') => void;
  isProcessing: boolean;
  onInternToggle: (field: string) => void;
  onGenerate: (field: string) => void;
  isInternActive: boolean;
  fieldLoadingStates: { [key: string]: boolean };
  expandRequestId?: string | null;
  /**
   * FIL-332: One-at-a-time generation policy flag from Home.tsx.
   * True whenever ANY individual field (G, T, M, CQ, SUM, S1-S9) is
   * currently generating.
   *
   * This flag gates the "Process into Story Preview" and "Process into
   * Full Outline" buttons — you shouldn't be able to kick off a big
   * brainstorm-to-synopsis job while a single-field regeneration is
   * already running, because the full outline would overwrite fields
   * the other generation is also writing to.
   *
   * NOTE: this only covers "field generating → block process buttons."
   * The reverse direction (process button running → block field generate
   * buttons) is already handled by isProcessing flowing up into
   * isProcessingBrainstorm in Home.tsx, but field-level blocking on that
   * signal isn't wired yet. If we want that, it's a separate change —
   * Home needs to include isProcessingBrainstorm in the derived
   * isAnyFieldGenerating flag. Worth a follow-up ticket if it matters.
   */
  isAnyFieldGenerating?: boolean;
}

const BrainIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M3 20.5V5C3 4.45 3.45 4 4 4H16L20 8V20.5C20 21.05 19.55 21.5 19 21.5H4C3.45 21.5 3 21.05 3 20.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M16 4V8H20"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
    <circle cx="7" cy="11" r="1" fill="currentColor" />
    <circle cx="11" cy="13" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
    <path
      d="M7 11C8 10 10 12 11 13"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <path
      d="M11 13C12 14 14 14 15 15"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

const ProcessIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

const FullOutlineIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 3.5C2 3.22386 2.22386 3 2.5 3H12.5C12.7761 3 13 3.22386 13 3.5C13 3.77614 12.7761 4 12.5 4H2.5C2.22386 4 2 3.77614 2 3.5ZM2 6.5C2 6.22386 2.22386 6 2.5 6H12.5C12.7761 6 13 6.22386 13 6.5C13 6.77614 12.7761 7 12.5 7H2.5C2.22386 7 2 6.77614 2 6.5ZM2 9.5C2 9.22386 2.22386 9 2.5 9H12.5C12.7761 9 13 9.22386 13 9.5C13 9.77614 12.7761 10 12.5 10H2.5C2.22386 10 2 9.77614 2 9.5ZM2 12.5C2 12.2239 2.22386 12 2.5 12H8.5C8.77614 12 9 12.2239 9 12.5C9 12.7761 8.77614 13 8.5 13H2.5C2.22386 13 2 12.7761 2 12.5Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
  </svg>
);

// Word count thresholds
const FULL_OUTLINE_MIN_WORDS = 75;
const FULL_OUTLINE_RECOMMENDED_WORDS = 150;

// Fields to check for full outline overwrite
const OUTLINE_FIELDS = ['SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

const FreeformBrainstorming: React.FC<FreeformBrainstormingProps> = ({
  id,
  data,
  onChange,
  onClearField,
  customLabels,
  internSelectedFields,
  onFieldSelection,
  isInternSelectionMode,
  onProcess,
  isProcessing,
  onInternToggle,
  onGenerate,
  isInternActive,
  fieldLoadingStates,
  expandRequestId,
  isAnyFieldGenerating = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [processingMode, setProcessingMode] = useState<'preview' | 'full' | null>(null);

  // Overwrite confirmation modal state
  const [showOverwriteModal, setShowOverwriteModal] = useState(false);
  const [pendingMode, setPendingMode] = useState<'preview' | 'full' | null>(null);

  useEffect(() => {
    if (expandRequestId === 'storyBrainstorming') {
      setIsExpanded(true);
    }
  }, [expandRequestId, id]);

  const [isFocused, setIsFocused] = useState(false);

  // Helper function to get content from field (handling new data structure)
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

  // Check if a field has content
  const hasFieldContent = (field: string): boolean => {
    const content = getFieldContent(field);
    return content.trim().length > 0;
  };

  // Check if SUM field has content (for preview mode)
  const hasSummaryContent = (): boolean => {
    return hasFieldContent('SUM');
  };

  // Check if any outline fields have content (for full outline mode)
  const hasOutlineContent = (): boolean => {
    return OUTLINE_FIELDS.some(field => hasFieldContent(field));
  };

  // Get list of populated fields for the modal message
  const getPopulatedOutlineFields = (): string[] => {
    return OUTLINE_FIELDS.filter(field => hasFieldContent(field));
  };

  const thoughtsContent = getFieldContent('BRAINSTORM');
  const hasContent = thoughtsContent.trim().length > 0;
  const wordCount = thoughtsContent.trim().split(/\s+/).filter(word => word.length > 0).length;

  // Determine which options to show based on word count
  const showFullOutlineOption = wordCount >= FULL_OUTLINE_MIN_WORDS;
  const isFullOutlineRecommended = wordCount >= FULL_OUTLINE_RECOMMENDED_WORDS;

  // FIL-332: Composite "can't process right now" flag. True when:
  //   - The brainstorm-to-synopsis job is already running (isProcessing), OR
  //   - Any individual field is currently regenerating (isAnyFieldGenerating)
  //
  // The visual treatment already existed for isProcessing — we just widen
  // the condition to also catch cross-form generation. Buttons show their
  // existing dim+disabled state in either case; tooltip copy distinguishes
  // the two so users know why they can't click.
  const isProcessBlocked = isProcessing || isAnyFieldGenerating;

  const handleClearField = () => {
    onClearField('BRAINSTORM');
  };

  // Handle process with overwrite check
  const handleProcess = (mode: 'preview' | 'full') => {
    // FIL-332: Defensive guard. Buttons are disabled when blocked, but if
    // something bypasses that (keyboard activation, programmatic click),
    // drop the request rather than letting it stack.
    if (isProcessBlocked) return;

    // Check for existing content based on mode
    if (mode === 'preview') {
      if (hasSummaryContent()) {
        // Show confirmation modal for preview
        setPendingMode('preview');
        setShowOverwriteModal(true);
        return;
      }
    } else if (mode === 'full') {
      if (hasOutlineContent()) {
        // Show confirmation modal for full outline
        setPendingMode('full');
        setShowOverwriteModal(true);
        return;
      }
    }

    // No existing content, proceed directly
    proceedWithProcess(mode);
  };

  // Actually execute the process after confirmation (or if no content exists)
  const proceedWithProcess = (mode: 'preview' | 'full') => {
    setProcessingMode(mode);
    onProcess(mode);
  };

  // Handle modal confirmation
  const handleOverwriteConfirm = () => {
    if (pendingMode) {
      proceedWithProcess(pendingMode);
    }
    setPendingMode(null);
  };

  // Handle modal close/cancel
  const handleOverwriteCancel = () => {
    setShowOverwriteModal(false);
    setPendingMode(null);
  };

  // Generate modal message based on mode
  const getOverwriteModalMessage = (): string => {
    if (pendingMode === 'preview') {
      return 'Your Summary field already has content. Generating a new story preview will replace it. Do you want to continue?';
    } else if (pendingMode === 'full') {
      const populatedFields = getPopulatedOutlineFields();
      const fieldNames = populatedFields.map(f => {
        if (f === 'SUM') return 'Summary';
        return customLabels[f] || f;
      });

      let baseMessage = '';
      if (fieldNames.length === 1) {
        baseMessage = `Your ${fieldNames[0]} field already has content. Generating a full outline will replace it.`;
      } else if (fieldNames.length <= 3) {
        baseMessage = `Your ${fieldNames.join(', ')} fields already have content. Generating a full outline will replace them.`;
      } else {
        baseMessage = `You have ${fieldNames.length} fields with existing content (${fieldNames.slice(0, 2).join(', ')}, and ${fieldNames.length - 2} more). Generating a full outline will replace all of them.`;
      }

      return baseMessage;
    }
    return '';
  };

  // Get additional warning for full outline mode
  const getFullOutlineWarning = (): string | null => {
    if (pendingMode === 'full') {
      return 'Full outline generation is more token-intensive and may take up to 2 minutes to complete.';
    }
    return null;
  };

  // Reset processing mode when processing completes
  useEffect(() => {
    if (!isProcessing) {
      setProcessingMode(null);
    }
  }, [isProcessing]);

  // FIL-332: Tooltip copy for process buttons — distinguishes why we're
  // blocked so the user knows what to do about it.
  const getProcessTooltip = (defaultText: string): string => {
    if (isProcessing) return "Generating...";
    if (isAnyFieldGenerating) return "Another field is generating";
    return defaultText;
  };

  return (
    <Box
      id={id}
      style={{
        background: isExpanded
          ? 'transparent'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.01) 100%)',
        border: isExpanded
          ? '1px solid rgba(255, 107, 53, 0.3)'
          : '1px dashed rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-xl)',
        padding: isExpanded ? '0' : 'var(--spacing-lg)',
        marginBottom: 'var(--spacing-lg)',
        cursor: isExpanded ? 'default' : 'pointer',
        transition: 'all 0.4s ease',
        opacity: isExpanded ? 1 : 0.75,
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        minHeight: isExpanded ? '500px' : 'auto',
        boxShadow: isExpanded
          ? '0 0 25px rgba(255, 107, 53, 0.15), 0 0 50px rgba(255, 107, 53, 0.08), 0 0 75px rgba(255, 107, 53, 0.04)'
          : '0 0 20px rgba(255, 107, 53, 0.1), 0 0 40px rgba(255, 107, 53, 0.05)'
      }}
      onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
      onMouseEnter={e => {
        if (!isExpanded) {
          e.currentTarget.style.opacity = '0.9';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.4)';
          e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 107, 53, 0.2), 0 0 50px rgba(255, 107, 53, 0.1), 0 4px 20px rgba(0, 0, 0, 0.2)';
        }
      }}
      onMouseLeave={e => {
        if (!isExpanded) {
          e.currentTarget.style.opacity = '0.75';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 107, 53, 0.1), 0 0 40px rgba(255, 107, 53, 0.05)';
        }
      }}
    >
      {/* Overwrite Confirmation Modal */}
      <OverwriteConfirmModal
        isOpen={showOverwriteModal}
        onClose={handleOverwriteCancel}
        onConfirm={handleOverwriteConfirm}
        title={pendingMode === 'preview' ? 'Overwrite Summary?' : 'Overwrite Outline?'}
        message={getOverwriteModalMessage()}
        warning={getFullOutlineWarning()}
        confirmLabel="Yes, Continue"
        cancelLabel="Cancel"
      />

      {/* Header - always outside textarea */}
      <Flex
        align="center"
        justify="between"
        style={{
          marginBottom: isExpanded ? '0' : '0',
          padding: isExpanded ? '1rem 1.5rem' : '0',
          background: isExpanded ? 'rgba(30, 30, 40, 0.95)' : 'transparent',
          backdropFilter: isExpanded ? 'blur(10px)' : 'none',
          borderBottom: isExpanded ? '1px solid rgba(255, 107, 53, 0.2)' : 'none',
          borderRadius: isExpanded ? 'var(--radius-xl) var(--radius-xl) 0 0' : '0',
          position: isExpanded ? 'relative' : 'relative',
          zIndex: 10,
          transition: 'all 0.4s ease'
        }}
      >
        <Flex align="center" gap="2">
          <BrainIcon />
          <Text
            weight="medium"
            className="field-label"
            style={{
              fontSize: isExpanded ? '1.25rem' : '1.1rem',
              fontWeight: '600',
              color: isExpanded ? '#ffffff' : 'rgba(255, 255, 255, 0.7)',
              margin: 0,
              transition: 'all 0.3s ease'
            }}
          >
            Story Brainstorming
          </Text>
          <Tooltip
            content="A free-writing space for unstructured story ideas, character thoughts, plot inspirations, and creative brainstorming. Click 'Story Preview' for a quick synopsis, or 'Full Outline' for a complete story structure."
            side="right"
            align="center"
            style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
          >
            <Box
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: isExpanded
                  ? 'rgba(255, 255, 255, 0.15)'
                  : 'rgba(255, 107, 53, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'help',
                transition: 'all 0.2s ease'
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 107, 53, 0.3)';
                e.currentTarget.style.color = '#ff6b35';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = isExpanded
                  ? 'rgba(255, 255, 255, 0.15)'
                  : 'rgba(255, 107, 53, 0.2)';
                e.currentTarget.style.color = 'currentColor';
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: 'currentColor' }}
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
          {!isExpanded && hasContent && (
            <Text
              size="1"
              style={{
                color: 'rgba(255, 107, 53, 0.8)',
                fontSize: '0.8rem',
                fontStyle: 'italic'
              }}
            >
              {wordCount} words
            </Text>
          )}
        </Flex>

        <Flex align="center" gap="2">
          {!isExpanded && (
            <Text
              size="1"
              style={{
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: '0.8rem',
                fontStyle: 'italic'
              }}
            >
              Click to expand
            </Text>
          )}

          {isExpanded && (
            <>
              {/* Word count indicator in header when expanded */}
              {hasContent && (
                <Text
                  size="1"
                  style={{
                    color: isFullOutlineRecommended
                      ? 'rgba(100, 200, 100, 0.9)'
                      : showFullOutlineOption
                        ? 'rgba(255, 200, 100, 0.9)'
                        : 'rgba(255, 107, 53, 0.8)',
                    fontSize: '0.8rem',
                    fontWeight: '500',
                    marginRight: '0.5rem'
                  }}
                >
                  {wordCount} words
                </Text>
              )}

              {/* Clear button - only in expanded header */}
              {hasContent && !isInternSelectionMode && (
                <Button
                  type="button"
                  size="2"
                  variant="soft"
                  onClick={handleClearField}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    fontSize: '0.8rem',
                    borderRadius: '8px',
                    padding: '0.5rem 1rem'
                  }}
                >
                  Clear
                </Button>
              )}

              <Button
                type="button"
                size="2"
                variant="soft"
                style={{
                  background: 'rgba(255, 107, 53, 0.15)',
                  color: 'rgba(255, 255, 255, 0.9)',
                  border: '1px solid rgba(255, 107, 53, 0.3)',
                  fontSize: '0.8rem',
                  fontWeight: '500',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
              >
                Collapse
              </Button>
            </>
          )}

          {!isExpanded && (
            <Box
              style={{
                color: 'rgba(255, 107, 53, 0.7)',
                fontSize: '1rem',
                transition: 'all 0.3s ease',
                filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))'
              }}
            >
              ▼
            </Box>
          )}
        </Flex>
      </Flex>

      {/* Content area */}
      {!isExpanded ? (
        // Collapsed preview
        hasContent && (
          <Text
            size="2"
            style={{
              color: 'rgba(255, 255, 255, 0.6)',
              fontStyle: 'italic',
              display: 'block',
              marginTop: '0.75rem',
              lineHeight: '1.4'
            }}
          >
            {thoughtsContent.substring(0, 150)}...
          </Text>
        )
      ) : (
        // Expanded textarea
        <Box style={{ position: 'relative', height: 'calc(500px - 60px)' }}>
          {/*
            FIL-332 note: the brainstorm textarea stays EDITABLE during
            individual field generation (isAnyFieldGenerating). If a user
            is regenerating S3, they should still be able to refine their
            brainstorm in parallel — these are independent workflows.
            The textarea is still disabled during the brainstorm's OWN
            processing (isProcessing), because that read would be reading
            from it mid-job.
          */}
          <textarea
            value={thoughtsContent}
            onChange={onChange('BRAINSTORM')}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="This is a space to write freely about your story. Characters, scenes, conflicts, vibes, anything goes. Then structure it from there..."
            disabled={isInternSelectionMode || isProcessing}
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--bg-input)',
              border: isFocused ? '2px solid #FF8C00' : '1px solid var(--border-input)',
              borderRadius: '0 0 var(--radius-xl) var(--radius-xl)',
              padding: '2rem',
              paddingBottom: '5rem', // Extra space for floating buttons
              color: 'var(--text-primary)',
              fontSize: '15px',
              lineHeight: '1.7',
              resize: 'none',
              transition: 'all 0.3s ease-in-out',
              fontFamily: 'inherit',
              outline: 'none',
              opacity: (isInternSelectionMode || isProcessing) ? 0.6 : 1,
              boxShadow: isFocused
                ? '0 0 0.625rem rgba(255, 140, 0, 0.4), 0 0 25px rgba(255, 140, 0, 0.2), 0 0 50px rgba(255, 140, 0, 0.1)'
                : '0 0 15px rgba(255, 107, 53, 0.1), 0 0 30px rgba(255, 107, 53, 0.05)',
              backgroundColor: isFocused ? 'rgba(255, 140, 0, 0.02)' : 'transparent'
            }}
          />

          {/* Floating action buttons */}
          {hasContent && !isInternSelectionMode && (
            <Flex
              gap="3"
              align="end"
              style={{
                position: 'absolute',
                bottom: '1.5rem',
                right: '1.5rem',
                zIndex: 10
              }}
            >
              {/* Full Outline button - only shows at 75+ words */}
              {/* {showFullOutlineOption && (
                <Tooltip
                  content={getProcessTooltip(
                    isFullOutlineRecommended
                      ? "Your detailed input is perfect for a complete outline. Generate all 9 story segments in one click."
                      : `Add ${FULL_OUTLINE_RECOMMENDED_WORDS - wordCount} more words for best results, or generate now.`
                  )}
                  side="top"
                >
                  <Box
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      transition: 'transform 0.2s ease'
                    }}
                    onMouseEnter={e => {
                      if (!isProcessBlocked) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isProcessBlocked) {
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    {isFullOutlineRecommended && (
                      <Box
                        style={{
                          position: 'absolute',
                          top: '-14px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          background: 'linear-gradient(135deg, #4CAF50 0%, #66BB6A 100%)',
                          color: 'white',
                          fontSize: '0.65rem',
                          fontWeight: '600',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '10px',
                          boxShadow: '0 2px 8px rgba(76, 175, 80, 0.4)',
                          zIndex: 11,
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.5px',
                          textTransform: 'uppercase'
                        }}
                      >
                        Recommended
                      </Box>
                    )}
                    <Button
                      onClick={() => handleProcess('full')}
                      type="button"
                      disabled={isProcessBlocked}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        background: isFullOutlineRecommended
                          ? 'linear-gradient(135deg, #4CAF50 0%, #66BB6A 100%)'
                          : 'linear-gradient(135deg, #7c5ce0 0%, #9575cd 100%)',
                        border: isFullOutlineRecommended
                          ? '2px solid rgba(100, 200, 100, 0.5)'
                          : 'none',
                        borderRadius: '12px',
                        padding: '0.75rem 1.25rem',
                        color: 'white',
                        cursor: isProcessBlocked ? 'not-allowed' : 'pointer',
                        transition: 'box-shadow 0.2s ease',
                        boxShadow: isFullOutlineRecommended
                          ? '0 4px 12px rgba(76, 175, 80, 0.4), 0 0 20px rgba(76, 175, 80, 0.2)'
                          : '0 4px 12px rgba(124, 92, 224, 0.3)',
                        // FIL-332: when blocked by a non-processing reason
                        // (a sibling field is generating), dim slightly more
                        // than the in-flight processing state.
                        opacity: isProcessing && processingMode !== 'full'
                          ? 0.6
                          : (isAnyFieldGenerating && !isProcessing)
                            ? 0.45
                            : 1
                      }}
                      onMouseEnter={e => {
                        if (!isProcessBlocked) {
                          e.currentTarget.style.boxShadow = isFullOutlineRecommended
                            ? '0 6px 16px rgba(76, 175, 80, 0.5), 0 0 30px rgba(76, 175, 80, 0.3)'
                            : '0 6px 16px rgba(124, 92, 224, 0.4)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isProcessBlocked) {
                          e.currentTarget.style.boxShadow = isFullOutlineRecommended
                            ? '0 4px 12px rgba(76, 175, 80, 0.4), 0 0 20px rgba(76, 175, 80, 0.2)'
                            : '0 4px 12px rgba(124, 92, 224, 0.3)';
                        }
                      }}
                    >
                      <FullOutlineIcon />
                      {isProcessing && processingMode === 'full' ? 'Generating...' : 'Process into Full Outline'}
                    </Button>
                  </Box>
                </Tooltip>
              )} */}

              {/* Story Hook & Preview button - always available */}
              <Tooltip
                content={getProcessTooltip(
                  "Generate a story preview that cuts at the midpoint. Perfect for quick iterations."
                )}
                side="top"
              >
                <Button
                  onClick={() => handleProcess('preview')}
                  type="button"
                  disabled={isProcessBlocked}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    background: isFullOutlineRecommended
                      ? 'linear-gradient(135deg, rgba(255, 107, 53, 0.8) 0%, rgba(255, 140, 66, 0.8) 100%)'
                      : 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '0.75rem 1.25rem',
                    color: 'white',
                    cursor: isProcessBlocked ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 12px rgba(255, 107, 53, 0.3)',
                    // FIL-332: same dimming logic as full-outline button above
                    opacity: isProcessing && processingMode !== 'preview'
                      ? 0.6
                      : (isAnyFieldGenerating && !isProcessing)
                        ? 0.45
                        : 1
                  }}
                  onMouseEnter={e => {
                    if (!isProcessBlocked) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 107, 53, 0.4)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isProcessBlocked) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 107, 53, 0.3)';
                    }
                  }}
                >
                  <ProcessIcon />
                  {isProcessing && processingMode === 'preview' ? 'Processing...' : 'Process into Story Preview'}
                </Button>
              </Tooltip>
            </Flex>
          )}
        </Box>
      )}
    </Box>
  );
};

export default FreeformBrainstorming;