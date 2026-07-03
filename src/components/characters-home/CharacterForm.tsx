import React, { useState, useEffect } from 'react';
import './CharacterForm.css'; // We'll need to create this CSS file

// Character interface matching backend structure
interface Character {
  name: string;
  description: string;
  importance: 'major' | 'supporting' | 'minor';
  is_new: boolean;
  locked?: boolean;
  arc: {
    starting_state: string;
    goal: string;
    conflict: string;
    need: string;
    growth: 'static' | 'dynamic';
  };
}

interface CharacterFormProps {
  character?: Character; // undefined for new character
  isOpen: boolean;
  onClose: () => void;
  onSave: (character: Character) => Promise<void>;
  mode: 'add' | 'edit';
}

const CharacterForm: React.FC<CharacterFormProps> = ({ 
  character, 
  isOpen, 
  onClose, 
  onSave, 
  mode 
}) => {
  // Form state
  const [formData, setFormData] = useState<Character>({
    name: '',
    description: '',
    importance: 'supporting',
    is_new: true,
    locked: false,
    arc: {
      starting_state: '',
      goal: '',
      conflict: '',
      need: '',
      growth: 'dynamic'
    }
  });

  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Initialize form data when character prop changes
  useEffect(() => {
    if (character && mode === 'edit') {
      setFormData({
        ...character,
        locked: character.locked || false, // Ensure locked is boolean
      });
      setHasUnsavedChanges(false);
    } else if (mode === 'add') {
      // Reset form for new character
      setFormData({
        name: '',
        description: '',
        importance: 'supporting',
        is_new: true,
        locked: false,
        arc: {
          starting_state: '',
          goal: '',
          conflict: '',
          need: '',
          growth: 'dynamic'
        }
      });
      setHasUnsavedChanges(false);
    }
    // Clear errors when opening
    setErrors({});
  }, [character, mode, isOpen]);

  // Handle input changes
  const handleInputChange = (field: string, value: string | boolean) => {
    if (field.startsWith('arc.')) {
      const arcField = field.replace('arc.', '');
      setFormData(prev => ({
        ...prev,
        arc: {
          ...prev.arc,
          [arcField]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }

    // Mark as having unsaved changes
    setHasUnsavedChanges(true);

    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};

    // Required fields
    if (!formData.name.trim()) {
      newErrors.name = 'Character name is required';
    } else if (formData.name.trim().length > 100) {
      newErrors.name = 'Character name must be 100 characters or less';
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    } else if (formData.description.trim().length > 1000) {
      newErrors.description = 'Description must be 1000 characters or less';
    }

    if (!formData.arc.goal.trim()) {
      newErrors['arc.goal'] = 'Character goal is required';
    } else if (formData.arc.goal.trim().length > 500) {
      newErrors['arc.goal'] = 'Goal must be 500 characters or less';
    }

    if (!formData.arc.need.trim()) {
      newErrors['arc.need'] = 'Character need is required';
    } else if (formData.arc.need.trim().length > 500) {
      newErrors['arc.need'] = 'Need must be 500 characters or less';
    }

    if (!formData.arc.conflict.trim()) {
      newErrors['arc.conflict'] = 'Character conflict is required';
    } else if (formData.arc.conflict.trim().length > 500) {
      newErrors['arc.conflict'] = 'Conflict must be 500 characters or less';
    }

    if (!formData.arc.starting_state.trim()) {
      newErrors['arc.starting_state'] = 'Starting state is required';
    } else if (formData.arc.starting_state.trim().length > 500) {
      newErrors['arc.starting_state'] = 'Starting state must be 500 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // Clean up the form data before saving
      const cleanedData = {
        ...formData,
        name: formData.name.trim(),
        description: formData.description.trim(),
        arc: {
          starting_state: formData.arc.starting_state.trim(),
          goal: formData.arc.goal.trim(),
          conflict: formData.arc.conflict.trim(),
          need: formData.arc.need.trim(),
          growth: formData.arc.growth
        }
      };

      await onSave(cleanedData);
      setHasUnsavedChanges(false);
      onClose();
    } catch (error) {
      console.error('Error saving character:', error);
      setErrors({ submit: 'Failed to save character. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle close with unsaved changes warning
  const handleClose = () => {
    if (hasUnsavedChanges && !isSubmitting) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        setHasUnsavedChanges(false);
        onClose();
      }
    } else if (!isSubmitting) {
      onClose();
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, hasUnsavedChanges, isSubmitting]);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <div className="character-form-overlay" onClick={handleClose}>
      <div className="character-form-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="character-form-header">
          <h2 className="character-form-title">
            {mode === 'add' ? 'Add New Character' : `Edit ${character?.name}`}
            {hasUnsavedChanges && <span className="unsaved-indicator">*</span>}
          </h2>
          <button 
            className="character-form-close" 
            onClick={handleClose}
            disabled={isSubmitting}
            title="Close form (Esc)"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="character-form">
          <div className="character-form-scroll-container">
            {/* Basic Information Section */}
            <div className="character-form-section">
              <h3 className="character-form-section-title">
                <span className="section-icon">👤</span>
                Basic Information
              </h3>
              
              {/* Name */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Character Name <span className="required">*</span>
                </label>
                <input
                  type="text"
                  className={`character-form-input ${errors.name ? 'error' : ''}`}
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="Enter character name"
                  disabled={isSubmitting}
                  maxLength={100}
                />
                {mode === 'edit' && (
                  <div className="character-form-warning">
                    ⚠️ Changing the character name will create a new character. The original will remain.
                  </div>
                )}
                <div className="character-count">
                  {formData.name.length}/100
                </div>
                {errors.name && <span className="character-form-error">{errors.name}</span>}
              </div>

              {/* Description */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Description <span className="required">*</span>
                </label>
                <textarea
                  className={`character-form-textarea ${errors.description ? 'error' : ''}`}
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Describe the character's appearance, personality, background, role in the story..."
                  rows={4}
                  disabled={isSubmitting}
                  maxLength={1000}
                />
                <div className="character-count">
                  {formData.description.length}/1000
                </div>
                {errors.description && <span className="character-form-error">{errors.description}</span>}
              </div>

              {/* Importance */}
              <div className="character-form-group">
                <label className="character-form-label">Importance Level</label>
                <select
                  className="character-form-select"
                  value={formData.importance}
                  onChange={(e) => handleInputChange('importance', e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="major">Major Character - Central to the story</option>
                  <option value="supporting">Supporting Character - Important but not central</option>
                  <option value="minor">Minor Character - Small role or brief appearance</option>
                </select>
                <div className="character-form-help">
                  Choose the character's level of importance to the overall story
                </div>
              </div>
            </div>

            {/* Character Arc Section */}
            <div className="character-form-section">
              <h3 className="character-form-section-title">
                <span className="section-icon">📈</span>
                Character Arc
              </h3>
              <div className="character-form-help">
                Define how your character changes and grows throughout the story
              </div>
              
              {/* Starting State */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Starting State <span className="required">*</span>
                </label>
                <textarea
                  className={`character-form-textarea ${errors['arc.starting_state'] ? 'error' : ''}`}
                  value={formData.arc.starting_state}
                  onChange={(e) => handleInputChange('arc.starting_state', e.target.value)}
                  placeholder="How does the character begin the story? What's their initial situation, mindset, or circumstances?"
                  rows={3}
                  disabled={isSubmitting}
                  maxLength={500}
                />
                <div className="character-count">
                  {formData.arc.starting_state.length}/500
                </div>
                {errors['arc.starting_state'] && (
                  <span className="character-form-error">{errors['arc.starting_state']}</span>
                )}
              </div>

              {/* Goal */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Goal <span className="required">*</span>
                </label>
                <textarea
                  className={`character-form-textarea ${errors['arc.goal'] ? 'error' : ''}`}
                  value={formData.arc.goal}
                  onChange={(e) => handleInputChange('arc.goal', e.target.value)}
                  placeholder="What does the character want to achieve? What are they actively pursuing?"
                  rows={3}
                  disabled={isSubmitting}
                  maxLength={500}
                />
                <div className="character-count">
                  {formData.arc.goal.length}/500
                </div>
                {errors['arc.goal'] && <span className="character-form-error">{errors['arc.goal']}</span>}
              </div>

              {/* Need */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Need <span className="required">*</span>
                </label>
                <textarea
                  className={`character-form-textarea ${errors['arc.need'] ? 'error' : ''}`}
                  value={formData.arc.need}
                  onChange={(e) => handleInputChange('arc.need', e.target.value)}
                  placeholder="What does the character actually need (often different from their goal)? What would truly fulfill them or solve their problems?"
                  rows={3}
                  disabled={isSubmitting}
                  maxLength={500}
                />
                <div className="character-count">
                  {formData.arc.need.length}/500
                </div>
                {errors['arc.need'] && <span className="character-form-error">{errors['arc.need']}</span>}
              </div>

              {/* Conflict */}
              <div className="character-form-group">
                <label className="character-form-label">
                  Conflict <span className="required">*</span>
                </label>
                <textarea
                  className={`character-form-textarea ${errors['arc.conflict'] ? 'error' : ''}`}
                  value={formData.arc.conflict}
                  onChange={(e) => handleInputChange('arc.conflict', e.target.value)}
                  placeholder="What obstacles, challenges, or opposition does the character face? What stands in their way?"
                  rows={3}
                  disabled={isSubmitting}
                  maxLength={500}
                />
                <div className="character-count">
                  {formData.arc.conflict.length}/500
                </div>
                {errors['arc.conflict'] && <span className="character-form-error">{errors['arc.conflict']}</span>}
              </div>

              {/* Growth Type */}
              <div className="character-form-group">
                <label className="character-form-label">Growth Type</label>
                <select
                  className="character-form-select"
                  value={formData.arc.growth}
                  onChange={(e) => handleInputChange('arc.growth', e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="dynamic">Dynamic - Character changes significantly throughout story</option>
                  <option value="static">Static - Character remains largely unchanged</option>
                </select>
                <div className="character-form-help">
                  Dynamic characters undergo internal change; static characters may drive change in others
                </div>
              </div>
            </div>

            {/* Advanced Options */}
            <div className="character-form-section">
              <h3 className="character-form-section-title">
                <span className="section-icon">⚙️</span>
                Options
              </h3>
              
              <div className="character-form-checkbox-group">
                <label className="character-form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.locked || false}
                    onChange={(e) => handleInputChange('locked', e.target.checked)}
                    disabled={isSubmitting}
                  />
                  <span className="character-form-checkbox-custom"></span>
                  <span className="character-form-checkbox-text">
                    <strong>Lock character</strong> - Prevent automatic updates during AI story generation
                  </span>
                </label>
                <div className="character-form-help">
                  When locked, this character will not be modified by AI analysis, preserving your manual edits
                </div>
              </div>
            </div>
          </div>

          {/* Submit Error */}
          {errors.submit && (
            <div className="character-form-submit-error">
              <span className="error-icon">⚠️</span>
              {errors.submit}
            </div>
          )}

          {/* Actions */}
          <div className="character-form-actions">
            <button
              type="button"
              className="character-form-btn character-form-btn-cancel"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="character-form-btn character-form-btn-save"
              disabled={isSubmitting}
            >
              {isSubmitting && <span className="spinner">⏳</span>}
              {isSubmitting ? 'Saving...' : (mode === 'add' ? 'Add Character' : 'Save Changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CharacterForm;