import React, { useState, useContext, useEffect, useCallback } from 'react';
import { useMutation } from "react-query";
import axios from 'axios';
import { UserContext } from '../../App';
import { User as UserType } from '../../models/user';
import InternSelectionControls from './InternSelectionControlsHome';
import InternForm from './InternFormHome';
import InternResponse from './InternResponseHome';
import './InternPanelHome.css';

// Define the structure of story data
interface StoryData {
  [key: string]: any; // This allows any structure
}

interface InternPanelProps {
  isOpen: boolean;
  onClose: () => void;
  storyData: StoryData;
  onStoryUpdate: (response: any) => void; // Changed to accept full response
  internSelectedFields: Set<string>;
  onFieldSelectionChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onPanelStateChange?: (isOpen: boolean, width: number) => void;
}

const InternPanel: React.FC<InternPanelProps> = ({
  isOpen,
  onClose,
  storyData,
  onStoryUpdate,
  internSelectedFields,
  onFieldSelectionChange,
  onPanelStateChange,
}) => {
  // ✅ FIX: Read `data` from context directly instead of relying on storyData prop
  // The storyData prop can be stale in useMutation closures because React Query
  // captures the closure at creation time, not at call time.
  // Context is always current.
  const { user, setUser, token, data: contextData } = useContext(UserContext);
  
  const [internInput, setInternInput] = useState('');
  const [internOutput, setInternOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSelectedSegments, setShowSelectedSegments] = useState(false);
  
  // Resize state for intern panel
  const [internPanelSize, setInternPanelSize] = useState<{
    width: number;
    height: number | 'auto';
  }>({
    width: 380,
    height: 'auto'
  });
  const [isResizing, setIsResizing] = useState<'width' | 'height' | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 380, height: 0 });

  // Define all possible fields
  const allFields = ['G', 'T', 'M', 'CQ', 'SUM', 'BRAINSTORM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];

  // Clear Icon Component (matching StackedActionButtons)
  const ClearIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H5H10H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4L3.5 4C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );

  // ✅ FIX: Helper reads from contextData (always current) instead of storyData (potentially stale)
  const getFieldContent = (field: string): string => {
    const fieldData = contextData?.[field];
    
    if (!fieldData) return '';
    
    if (typeof fieldData === 'string') {
      return fieldData;
    } else if (typeof fieldData === 'object' && 'S' in fieldData && typeof fieldData.S === 'string') {
      return fieldData.S;
    }
    
    return '';
  };

  const getNonEmptyFields = (): string[] => {
    return allFields.filter(field => {
      const content = getFieldContent(field);
      return content.trim().length > 0;
    });
  };

  // Calculate field selection status
  const nonEmptyFields = getNonEmptyFields();
  const allNonEmptyFieldsSelected = nonEmptyFields.length > 0 && 
    nonEmptyFields.every(field => internSelectedFields.has(field));

  // Helper functions for field selection
  const handleSelectAll = () => {
    onFieldSelectionChange(new Set(['G', 'T', 'M', 'CQ', 'SUM', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']));
  };
  
  const handleDeselectAll = () => {
    onFieldSelectionChange(new Set());
  };

  // Helper function to remove field from selection
  const removeFieldFromSelection = (fieldToRemove: string) => {
    onFieldSelectionChange(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldToRemove);
      return newSet;
    });
  };

  // Helper function to clear input
  const handleClearInput = () => {
    setInternInput('');
    console.log('🧹 InternPanel: Input cleared manually by user');
  };

  // Determine if we should show breadcrumb chips based on width and selection count
  const shouldShowBreadcrumbs = () => {
    const selectedCount = internSelectedFields.size;
    const isNarrow = internPanelSize.width < 450;
    
    // Always show if only 1 item selected
    if (selectedCount === 1) return true;
    
    // Show all if width is sufficient
    if (!isNarrow) return true;
    
    // For narrow width with multiple selections, show based on toggle
    return showSelectedSegments;
  };

  // Resize handlers for intern panel
  const handleResizeStart = (type: 'width' | 'height', e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(type);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: internPanelSize.width,
      height: typeof internPanelSize.height === 'number' ? internPanelSize.height : 600
    });
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;
    
    if (isResizing === 'width') {
      const newWidth = Math.max(320, Math.min(800, resizeStart.width - deltaX));
      setInternPanelSize(prev => ({ ...prev, width: newWidth }));
      
      // Notify parent about width change
      if (onPanelStateChange) {
        onPanelStateChange(true, newWidth);
      }
    } else if (isResizing === 'height') {
      const newHeight = Math.max(400, Math.min(window.innerHeight - 200, resizeStart.height + deltaY));
      setInternPanelSize(prev => ({ ...prev, height: newHeight }));
    }
  }, [isResizing, resizeStart, onPanelStateChange]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(null);
  }, []);

  // Notify parent when panel opens/closes
  useEffect(() => {
    if (onPanelStateChange) {
      onPanelStateChange(isOpen, internPanelSize.width);
    }
  }, [isOpen, onPanelStateChange, internPanelSize.width]);

  // Add mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = isResizing === 'width' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, resizeStart, handleResizeMove, handleResizeEnd]);

  // Handle the intern API mutation
  // ✅ FIX: Uses contextData (from UserContext) instead of storyData prop
  // This prevents the stale closure issue where mutationFn captures empty storyData
  const mutateIntern = useMutation({
    mutationFn: async () => {
      console.log('🚀 InternPanel: Preparing intern request');
      
      // ✅ FIX: Read current data from context, not from stale storyData prop
      const currentData = contextData || {};
      
      console.log('🔍 INTERN DEBUG - contextData at send time:', {
        SUM: typeof currentData.SUM === 'string' ? currentData.SUM?.substring(0, 80) : JSON.stringify(currentData.SUM)?.substring(0, 80),
        BRAINSTORM: typeof currentData.BRAINSTORM === 'string' ? currentData.BRAINSTORM?.substring(0, 80) : JSON.stringify(currentData.BRAINSTORM)?.substring(0, 80),
        S1: typeof currentData.S1 === 'string' ? currentData.S1?.substring(0, 80) : JSON.stringify(currentData.S1)?.substring(0, 80),
        storyId: currentData.storyId || '[MISSING]',
        nonEmptyFields: allFields.filter(f => {
          const fd = currentData[f];
          if (!fd) return false;
          if (typeof fd === 'string') return fd.trim().length > 0;
          if (typeof fd === 'object' && fd?.S) return fd.S.trim().length > 0;
          return false;
        }),
      });
      
      // Build the request data for the new backend architecture
      const requestData: any = {
        "event": 'intern',
        "userId": token?.payload['cognito:username'],
        "internInput": internInput,
        "selectedFields": Array.from(internSelectedFields),
        
        // ✅ FIX: Read character database from storyData prop (still valid for these)
        // since they're set explicitly in home.tsx and not subject to the same stale issue
        "character_database": storyData.character_database || {},
        "character_database_enabled": storyData.character_database_enabled || false,
        
        // ✅ FIX: Read storyId from context (always current)
        "storyId": currentData.storyId || storyData.storyId
      };
      
      // ✅ FIX: Add all story fields from CONTEXT, not from storyData prop
      allFields.forEach(field => {
        const fieldData = currentData[field];
        let content = '';
        if (typeof fieldData === 'string') {
          content = fieldData;
        } else if (typeof fieldData === 'object' && fieldData !== null && 'S' in fieldData && typeof fieldData.S === 'string') {
          content = fieldData.S;
        }
        requestData[field] = content;
      });
      
      console.log('📤 InternPanel: Sending request with:', {
        selectedFields: requestData.selectedFields,
        hasCharacterDatabase: Object.keys(requestData.character_database).length > 0,
        storyId: requestData.storyId,
        nonEmptyFields: allFields.filter(f => requestData[f]?.trim?.()),
        fieldStatuses: requestData.selectedFields.map((field: string) => ({
          field,
          hasContent: !!requestData[field],
          contentLength: requestData[field]?.length || 0,
          mode: requestData[field] ? 'edit' : 'generate'
        }))
      });
      
      // Use the correct endpoint - should be /story not /summary
      return await axios.post(`${process.env.REACT_APP_URL}/story`, requestData,
        { headers: { "Authorization": token.toString()} }
      );
    },
    onSuccess: (res: any) => {
      console.log('✅ InternPanel: Response received:', res);
      
      if (res.data.statusCode == 200 || res.status == 200) {
        // The new backend returns: { story: {...}, comments: "...", cap: number }
        const responseBody = res.data.body || res.data;
        
        console.log('📦 InternPanel: Processing response body:', {
          hasStory: !!responseBody.story,
          hasComments: !!responseBody.comments,
          hasCap: responseBody.cap !== undefined,
          storyFields: responseBody.story ? Object.keys(responseBody.story) : []
        });
        
        // Pass the entire response to the parent to handle
        // This lets the Home component manage the token update and data merge
        onStoryUpdate({
          story: responseBody.story || {},
          comments: responseBody.comments || responseBody.explanation || '',
          cap: responseBody.cap
        });
        
        // Display the intern's comments/explanation in the panel
        setInternOutput(responseBody.comments || responseBody.explanation || 'Changes applied successfully.');
        setIsLoading(false);
        
        // Clear the input field after successful request
        setInternInput('');
        console.log('🧹 InternPanel: Input field cleared for next instruction');
        
      } else if (res.data.statusCode == 400) {
        console.error('❌ InternPanel: Error 400:', res.data.body);
        setInternOutput(res.data.body?.error || 'Request failed');
        setIsLoading(false);
      } else {
        console.error('❌ InternPanel: Unexpected status:', res.data.statusCode);
        setInternOutput("An error occurred");
        setIsLoading(false);
      }
    },
    onError: (error: any) => {
      console.error('💥 InternPanel: Request failed:', error);
      setInternOutput(error.response?.data?.error || 'Error processing request. Please try again.');
      setIsLoading(false);
    },
  });

  // Handle the intern submission
  const handleIntern = async () => {
    if (!internInput.trim()) {
      setInternOutput('Please enter instructions for the intern.');
      return;
    }
    
    if (internSelectedFields.size === 0) {
      setInternOutput('Please select at least one field to modify.');
      return;
    }
    
    setIsLoading(true);
    setInternOutput(''); // Clear previous output
    mutateIntern.mutateAsync();
  };

  if (!isOpen) return null;

  return (
    <div className="intern-panel-container">
      {/* Width Resize Handle */}
      <div
        className="resize-handle resize-handle-width"
        onMouseDown={(e) => handleResizeStart('width', e)}
      >
        <div className="resize-indicator resize-indicator-width" />
      </div>

      {/* Height Resize Handle */}
      <div
        className="resize-handle resize-handle-height"
        onMouseDown={(e) => handleResizeStart('height', e)}
      >
        <div className="resize-indicator resize-indicator-height" />
      </div>

      <div 
        className="intern-panel"
        style={{
          width: `${internPanelSize.width}px`,
          height: typeof internPanelSize.height === 'number' ? `${internPanelSize.height}px` : 'auto',
          maxHeight: typeof internPanelSize.height === 'number' ? 'none' : '80vh',
        }}
      >
        {/* Header */}
        <div className="intern-panel-header">
          <div className="intern-panel-title">Intern Assistant</div>
        </div>

        {/* Content */}
        <div 
          className="intern-panel-content"
          style={{
            height: typeof internPanelSize.height === 'number' ? 'calc(100% - 65px)' : 'auto',
            overflowY: typeof internPanelSize.height === 'number' ? 'auto' : 'visible'
          }}
        >
          <InternSelectionControls
            selectedFields={internSelectedFields}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onRemoveField={removeFieldFromSelection}
            allNonEmptyFieldsSelected={allNonEmptyFieldsSelected}
            panelWidth={internPanelSize.width}
            showSelectedSegments={showSelectedSegments}
            onToggleShowSegments={setShowSelectedSegments}
            shouldShowBreadcrumbs={shouldShowBreadcrumbs()}
          />

          {/* Modified InternForm section with Clear button */}
          <div className="intern-form-section">
            <div className="intern-input-section">
              <div className="intern-input-header">
                <label className="intern-input-label">
                  Your Request
                </label>
                {/* Clear button in top-right corner */}
                <button
                  className="intern-clear-btn-corner"
                  onClick={handleClearInput}
                  disabled={isLoading || !internInput.trim()}
                  title="Clear input"
                  type="button"
                >
                  <ClearIcon />
                </button>
              </div>
              <textarea
                className="intern-textarea"
                value={internInput}
                onChange={(e) => setInternInput(e.target.value)}
                placeholder="Describe the changes you want to make..."
                rows={4}
                disabled={isLoading}
              />
            </div>

            {/* Submit button only */}
            <button
              className={`intern-submit-btn ${isLoading ? 'loading' : ''}`}
              onClick={handleIntern}
              disabled={isLoading || !internInput.trim() || internSelectedFields.size === 0}
            >
              {isLoading ? (
                <span className="loading-content">
                  <span className="loading-spinner"></span>
                  Processing...
                </span>
              ) : (
                'Submit'
              )}
            </button>
          </div>

          <InternResponse
            output={internOutput}
            maxHeight={typeof internPanelSize.height === 'number' ? 150 : 200}
          />
        </div>
      </div>
    </div>
  );
};

export default InternPanel;