import React, { useEffect } from 'react';
import { Flex, Text, Grid, Box, Tooltip } from '@radix-ui/themes';
import TextArea from '../TextArea';

interface StoryFoundationProps {
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
  /**
   * FIL-332: One-at-a-time generation policy flag from Home.tsx.
   * True whenever ANY field (anywhere in the form, not just within this
   * component) is currently generating. Used to disable generate buttons
   * on the 4 foundation fields.
   *
   * Note: this component already derived a local equivalent from
   * fieldLoadingStates before the FIL-332 work. The prop version is
   * authoritative now (Home is the single source of truth), but we OR
   * them together as a safety net — if either flag says "something is
   * generating," the buttons disable.
   */
  isAnyFieldGenerating?: boolean;
}

const StoryFoundation: React.FC<StoryFoundationProps> = ({
  id,
  data,
  onChange,
  onClearField,
  customLabels,
  internSelectedFields,
  onFieldSelection,
  isInternSelectionMode,
  onInternToggle,
  onGenerate,
  isInternActive = false,
  fieldLoadingStates,
  isAnyFieldGenerating = false,
}) => {
  // Local derivation — kept as a safety net so this component still behaves
  // correctly even if the parent ever forgets to pass the prop. The OR below
  // means either source of truth can gate the buttons.
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

  const renderTextArea = (field: string, rows: number = 1) => (
    <TextArea
      field={field}
      rows={rows}
      width="100%"
      value={getFieldContent(field)}
      onChange={onChange(field)}
      onClearField={onClearField}
      customLabels={customLabels}
      isHighlighted={internSelectedFields.has(field)}
      onToggleHighlight={() => onFieldSelection(field)}
      isHighlightable={isInternSelectionMode}
      isInternField={false}
      onInternToggle={onInternToggle}
      onGenerate={onGenerate}
      isInternActive={isInternActive}
      isLoading={fieldLoadingStates[field] || false}
      // FIL-332: isDisabled now incorporates the cross-form generation flag.
      // Previously this was local-only; now it also gates on any generation
      // happening elsewhere (e.g., user hits generate on S3, all 4 foundation
      // generate buttons dim too).
      isDisabled={isInternSelectionMode || anythingGenerating}
    />
  );

  return (
    <Box id={id} className="white-container" style={{ width: '100%' }}>
      <Flex align="center" gap="2" style={{ marginBottom: '1.5rem' }}>
        <Text
          weight="medium"
          className="field-label"
          style={{
            display: 'block',
            fontSize: '1.5rem',
            fontWeight: '600',
            color: '#ffffff',
            margin: 0
          }}
        >
          Story Foundation
        </Text>
        <Tooltip
          content="The essential elements that define your story: genre and theme establish what kind of story this is, while mood and core question capture the atmosphere and central philosophical exploration"
          side="right"
          align="center"
          style={{ maxWidth: '300px', whiteSpace: 'normal', wordWrap: 'break-word' }}
        >
          <Box
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'help',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 107, 53, 0.2)';
              e.currentTarget.style.color = '#ff6b35';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
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
      </Flex>

      {/* All 4 fields in a 2x2 grid */}
      <Grid columns="2" gap="4" style={{ width: '100%' }}>
        {renderTextArea('G', 2)}
        {renderTextArea('T', 3)}
        {renderTextArea('M', 3)}
        {renderTextArea('CQ', 3)}
      </Grid>
    </Box>
  );
};

export default StoryFoundation;