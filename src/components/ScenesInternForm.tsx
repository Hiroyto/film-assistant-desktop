import React from 'react';

interface ScenesInternFormProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  selectedScenesCount: number;
}

const ScenesInternForm: React.FC<ScenesInternFormProps> = ({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  selectedScenesCount,
}) => {
  const isDisabled = isLoading || !input.trim() || selectedScenesCount === 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!isDisabled) {
        onSubmit();
      }
    }
  };

  return (
    <div className="scenes-intern-form-section">
      {/* Input Section */}
      <div className="scenes-intern-input-section">
        <label className="scenes-intern-input-label">Scene Instructions</label>
        <textarea
          className="scenes-intern-textarea"
          rows={4}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter instructions for improving your selected scenes... (Cmd/Ctrl + Enter to submit)"
        />
      </div>

      {/* Submit Button */}
      <button
        className={`scenes-intern-submit-btn ${isLoading ? 'loading' : ''}`}
        onClick={onSubmit}
        disabled={isDisabled}
      >
        {isLoading ? (
          <div className="scenes-loading-content">
            <div className="scenes-loading-spinner"></div>
            Processing...
          </div>
        ) : (
          selectedScenesCount === 0 ? 'Select scenes to proceed' : 'Improve Selected Scenes'
        )}
      </button>
    </div>
  );
};

export default ScenesInternForm;