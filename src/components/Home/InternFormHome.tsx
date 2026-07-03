import React from 'react';

interface InternFormProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  selectedFieldsCount: number;
}

const InternForm: React.FC<InternFormProps> = ({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  selectedFieldsCount,
}) => {
  const isDisabled = isLoading || !input.trim() || selectedFieldsCount === 0;

  return (
    <div className="intern-form-section">
      {/* Input Section */}
      <div className="intern-input-section">
        <label className="intern-input-label">Your Notes</label>
        <textarea
          className="intern-textarea"
          rows={4}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Enter your instructions for the intern..."
        />
      </div>

      {/* Submit Button */}
      <button
        className={`intern-submit-btn ${isLoading ? 'loading' : ''}`}
        onClick={onSubmit}
        disabled={isDisabled}
      >
        {isLoading ? (
          <div className="loading-content">
            <div className="loading-spinner"></div>
            Processing...
          </div>
        ) : (
          selectedFieldsCount === 0 ? 'Select fields to proceed' : 'Submit Request'
        )}
      </button>
    </div>
  );
};

export default InternForm;