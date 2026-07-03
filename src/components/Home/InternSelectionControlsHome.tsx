import React from 'react';

interface InternSelectionControlsProps {
  selectedFields: Set<string>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRemoveField: (field: string) => void;
  allNonEmptyFieldsSelected: boolean;
  panelWidth: number;
  showSelectedSegments: boolean;
  onToggleShowSegments: (show: boolean) => void;
  shouldShowBreadcrumbs: boolean;
}

const InternSelectionControls: React.FC<InternSelectionControlsProps> = ({
  selectedFields,
  onSelectAll,
  onDeselectAll,
  onRemoveField,
  allNonEmptyFieldsSelected,
  panelWidth,
  showSelectedSegments,
  onToggleShowSegments,
  shouldShowBreadcrumbs,
}) => {
  // Helper function to get field display name
  const getFieldDisplayName = (field: string): string => {
    const fieldNames: { [key: string]: string } = {
      'G': 'Genre',
      'T': 'Theme', 
      'M': 'Mood',
      'CQ': 'Core Question',
      'SUM': 'Summary',
      'S1': 'S1: Introduction',
      'S2': 'S2: Inciting Incident', 
      'S3': 'S3: Commitment',
      'S4': 'S4: First Pinch Point',
      'S5': 'S5: Midpoint',
      'S6': 'S6: Second Pinch Point', 
      'S7': 'S7: Second Plot Point',
      'S8': 'S8: Climax',
      'S9': 'S9: Resolution'
    };
    return fieldNames[field] || field;
  };

  const SelectIcon = () => (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
      <path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"/>
    </svg>
  );

  const DeselectIcon = () => (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="currentColor">
      <path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"/>
    </svg>
  );

  return (
    <div className="intern-selection-section">
      {/* Selection Breadcrumb */}
      {selectedFields.size > 0 && (
        <div className="selection-breadcrumb-container">
          {/* Header with count and toggle button for narrow widths */}
          <div className="selection-header">
            <span className="selection-label">
              Selected: {selectedFields.size}
            </span>
            
            {/* Show toggle button for narrow widths with multiple selections */}
            {panelWidth < 450 && selectedFields.size > 1 && (
              <button
                className="selection-toggle-btn"
                onClick={() => onToggleShowSegments(!showSelectedSegments)}
              >
                {showSelectedSegments ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          
          {/* Breadcrumb chips */}
          {shouldShowBreadcrumbs && (
            <div className="breadcrumb-chips">
              {Array.from(selectedFields).map(field => (
                <div 
                  key={field} 
                  className="breadcrumb-chip"
                  onClick={() => onRemoveField(field)}
                >
                  {getFieldDisplayName(field)}
                  <span className="breadcrumb-remove">×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="selection-action-buttons">
        <button className="selection-action-btn" onClick={onSelectAll}>
          <SelectIcon />
          Select All
        </button>
        <button className="selection-action-btn" onClick={onDeselectAll}>
          <DeselectIcon />
          Deselect All
        </button>
      </div>

      {/* Status Text */}
      <div className="selection-status-text">
        {selectedFields.size === 0 ? (
          'No fields selected. Select fields to modify them.'
        ) : allNonEmptyFieldsSelected ? (
          'All fields selected. Changes will apply to the entire story.'
        ) : (
          'Some fields are selected. Changes will be applied to selected fields.'
        )}
      </div>
    </div>
  );
};

export default InternSelectionControls;