import React from 'react';
import { Flex, Text, Button, Box } from '@radix-ui/themes';
import StorySegment from './StorySegment';

interface StoryActProps {
  id: string;
  actNumber: number;
  actTitle: string;
  actSubtitle: string;
  segments: Array<{ id: string; number: number; title: string; tooltip: string }>;
  isExpanded: boolean;
  onToggleAct: () => void;
  onExpandAllSegments: () => void;
  onCollapseAllSegments: () => void;
  allSegmentsExpanded: boolean;
  data: any;
  customLabels: { [key: string]: string };
  segmentExpanded: { [key: string]: boolean };
  segmentHovered: { [key: string]: boolean };
  onToggleSegmentExpansion: (segmentId: string) => void;
  onSegmentMouseEnter: (segmentId: string) => void;
  onSegmentMouseLeave: (segmentId: string) => void;
  onChange: (field: string, isInternField?: boolean) => (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onClearField: (field: string) => void;
  internSelectedFields: Set<string>;
  onFieldSelection: (field: string) => void;
  isInternSelectionMode: boolean;
  onInternToggle: (field: string) => void;
  onGenerate: (field: string) => void;
  isInternActive: boolean;
  fieldLoadingStates: { [key: string]: boolean };
  onCanvasMode?: (segmentId: string) => void;
  /**
   * FIL-332: One-at-a-time generation policy flag. Threaded from Home.tsx
   * down to StorySegment where the generate button lives. StoryAct itself
   * doesn't consume it — this is a pass-through.
   */
  isAnyFieldGenerating?: boolean;
}

const StoryAct: React.FC<StoryActProps> = ({
  id,
  actNumber,
  actTitle,
  actSubtitle,
  segments,
  isExpanded,
  onToggleAct,
  onExpandAllSegments,
  onCollapseAllSegments,
  allSegmentsExpanded,
  data,
  customLabels,
  segmentExpanded,
  segmentHovered,
  onToggleSegmentExpansion,
  onSegmentMouseEnter,
  onSegmentMouseLeave,
  onChange,
  onClearField,
  internSelectedFields,
  onFieldSelection,
  isInternSelectionMode,
  onInternToggle,
  onGenerate,
  isInternActive = false,
  fieldLoadingStates,
  onCanvasMode,
  isAnyFieldGenerating = false,
}) => {
  return (
    <Box
      id={id}
      style={{
        width: '100%',
        backgroundColor: 'rgba(30, 30, 40, 0.95)',
        borderRadius: '16px',
        marginBottom: '1.5rem',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
        backdropFilter: 'blur(20px)',
        transition: 'all 0.3s ease'
      }}
    >
      <Box
        style={{
          padding: '1.5rem 2rem',
          cursor: 'pointer',
          background: 'linear-gradient(135deg, rgba(255, 107, 53, 0.05) 0%, rgba(255, 140, 66, 0.02) 100%)',
          borderBottom: isExpanded ? '1px solid rgba(255, 107, 53, 0.2)' : 'none',
          transition: 'all 0.3s ease',
          position: 'relative',
          overflow: 'hidden'
        }}
        onClick={onToggleAct}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 107, 53, 0.12) 0%, rgba(255, 140, 66, 0.08) 100%)';
          const glimmer = e.currentTarget.querySelector('.glimmer-overlay') as HTMLElement;
          if (glimmer) {
            glimmer.style.animation = 'shimmer 0.4s ease-out';
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 107, 53, 0.05) 0%, rgba(255, 140, 66, 0.02) 100%)';
          const glimmer = e.currentTarget.querySelector('.glimmer-overlay') as HTMLElement;
          if (glimmer) {
            glimmer.style.animation = 'none';
          }
        }}
      >
        {/* Hover glimmer effect */}
        <Box
          className="glimmer-overlay"
          style={{
            position: 'absolute',
            top: 0,
            left: '-100%',
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255, 140, 0, 0.15), transparent)',
            zIndex: 1,
            pointerEvents: 'none'
          }}
        />

        <Flex justify="between" align="center" style={{ position: 'relative', zIndex: 2 }}>
          <Box>
            <Text
              style={{
                color: '#ffffff',
                fontSize: '2rem',
                fontWeight: '700',
                marginBottom: '0.75rem',
                letterSpacing: '-0.02em',
                lineHeight: '1.2',
                display: 'block'
              }}
            >
              {actTitle}
            </Text>
            <Text
              size="2"
              style={{
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '1rem',
                fontStyle: 'italic',
                display: 'block'
              }}
            >
              {actSubtitle}
            </Text>
          </Box>
          <Flex align="center" gap="4">
            {isExpanded && (
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
                  e.preventDefault();
                  e.stopPropagation();
                  if (allSegmentsExpanded) {
                    onCollapseAllSegments();
                  } else {
                    onExpandAllSegments();
                  }
                }}
              >
                {allSegmentsExpanded ? 'Collapse All' : 'Expand All'}
              </Button>
            )}
            <Box
              style={{
                color: '#ff6b35',
                fontSize: '1.25rem',
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'all 0.3s ease',
                filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))'
              }}
            >
              ▼
            </Box>
          </Flex>
        </Flex>
      </Box>

      <Box
        style={{
          maxHeight: isExpanded ? '2000px' : '0',
          overflow: 'hidden',
          transition: 'max-height 0.4s ease'
        }}
      >
        {segments.map(segment => (
          <StorySegment
            key={segment.id}
            id={segment.id}
            segmentNumber={segment.number}
            segmentTitle={segment.title}
            data={data}
            customLabels={customLabels}
            isExpanded={segmentExpanded[segment.id]}
            isHovered={segmentHovered[segment.id]}
            onToggleExpansion={() => onToggleSegmentExpansion(segment.id)}
            onMouseEnter={() => onSegmentMouseEnter(segment.id)}
            onMouseLeave={() => onSegmentMouseLeave(segment.id)}
            onChange={onChange}
            onClearField={onClearField}
            internSelectedFields={internSelectedFields}
            onFieldSelection={onFieldSelection}
            isInternSelectionMode={isInternSelectionMode}
            tooltip={segment.tooltip}
            onInternToggle={onInternToggle}
            onGenerate={onGenerate}
            isInternActive={isInternActive}
            fieldLoadingStates={fieldLoadingStates}
            onCanvasMode={onCanvasMode}
            isAnyFieldGenerating={isAnyFieldGenerating}
          />
        ))}
      </Box>
    </Box>
  );
};

export default React.memo(StoryAct);