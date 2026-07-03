import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';

// Define transition options as a simple string array
const TRANSITION_OPTIONS = [
  "FADE IN:",
  "FADE OUT:",
  "FADE TO BLACK.",
  "CUT TO:",
  "FLASHBACK:",
  "TIME CUT:"
];

const TransitionAutoFill = ({ editor }: { editor: Editor | null }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>(TRANSITION_OPTIONS);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentNodePos, setCurrentNodePos] = useState<number | null>(null);
  const [currentFilter, setCurrentFilter] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewOption, setPreviewOption] = useState('');
  const [previewPos, setPreviewPos] = useState({ top: 0, left: 0 });
  const lockRef = useRef(false);

  const updateDropdownPosition = () => {
    if (!editor) return;

    const { state } = editor.view;
    const { $from } = state.selection;

    try {
      const coords = editor.view.coordsAtPos($from.pos);
      setDropdownPos({
        top: coords.bottom + 4,
        left: coords.left,
      });

      setPreviewPos({
        top: coords.top - 5,
        left: coords.left
      });
    } catch {
    }
  };

  const updatePreview = () => {
    if (!showDropdown || filteredOptions.length === 0) {
      setShowPreview(false);
      return;
    }

    setPreviewOption(filteredOptions[activeIndex]);
    setShowPreview(true);
    updateDropdownPosition();
  };

  // Filter options based on user input
  const filterOptions = (filter: string) => {
    if (!filter) return TRANSITION_OPTIONS;

    const lowerFilter = filter.toLowerCase();
    return TRANSITION_OPTIONS.filter(option =>
      option.toLowerCase().includes(lowerFilter)
    );
  };

  // Process node state changes - core function
  const processNodeState = () => {
    if (!editor || lockRef.current) return;

    const { state } = editor.view;
    const { selection } = state;

    // Check if selection is at the document level (likely Select All)
    if (selection.empty && selection.$from.depth === 0) {
      // Hide dropdown for document-level selections (like Cmd+A)
      setShowDropdown(false);
      setShowPreview(false);
      return;
    }

    const { $from } = selection;
    const node = $from.parent;

    // Safety check - ensure we have a valid position and parent node
    if (!node || $from.depth === 0) {
      setShowDropdown(false);
      setShowPreview(false);
      return;
    }

    // Get node position safely
    let pos = null;
    try {
      pos = $from.before();
      setCurrentNodePos(pos);
    } catch (e) {
      // If there's an error getting position, hide dropdown and exit
      setShowDropdown(false);
      setShowPreview(false);
      return;
    }

    // If not a transition line, hide dropdown and exit
    if (node.attrs.lineType !== 'transition') {
      setShowDropdown(false);
      setShowPreview(false);
      return;
    }

    // Current text is the filter
    const filter = node.textContent.trim();

    // Only update the filter if it has changed
    if (filter !== currentFilter) {
      setCurrentFilter(filter);
    }

    // Filter and show dropdown if we have matches
    const filtered = filterOptions(filter);
    if (filtered.length > 0) {
      setFilteredOptions(filtered);
      setActiveIndex(0);
      setShowDropdown(true);
      updateDropdownPosition();
    } else {
      setShowDropdown(false);
      setShowPreview(false);
    }
  };

  // Set up editor event listeners
  useEffect(() => {
    if (!editor) return;

    const updateHandler = () => {
      try {
        processNodeState();
        updateDropdownPosition();
      } catch (error) {
        // Catch any errors and hide dropdown as a fallback
        setShowDropdown(false);
        setShowPreview(false);
        console.log('Error in TransitionAutoFill:', error);
      }
    };

    // Update on editor changes and selection changes
    editor.on('update', updateHandler);
    editor.on('selectionUpdate', updateHandler);

    // Initial state check
    processNodeState();

    return () => {
      editor.off('update', updateHandler);
      editor.off('selectionUpdate', updateHandler);
    };
  }, [editor, currentNodePos, currentFilter]);

  // Update preview when active index changes
  useEffect(() => {
    updatePreview();
  }, [activeIndex, filteredOptions]);

  // Handle keyboard navigation in dropdown
  useEffect(() => {
    if (!editor || !showDropdown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex(prev => (prev + 1) % filteredOptions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
          break;
        case 'Tab':
        case 'Enter':
          if (showDropdown && filteredOptions.length > 0) {
            e.preventDefault();
            lockRef.current = true;

            // Clear the entire content of the node before inserting selection
            try {
              const { state } = editor.view;
              const { $from } = state.selection;

              if ($from.depth > 0) { // Safety check
                editor.chain()
                  .setTextSelection({ from: $from.start(), to: $from.end() })
                  .deleteSelection()
                  .run();
              }

              // Then insert the selected transition
              handleSelect(filteredOptions[activeIndex]);
            } catch (error) {
              console.log('Error handling selection:', error);
            }

            setTimeout(() => {
              lockRef.current = false;
            }, 50);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setShowDropdown(false);
          setShowPreview(false);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showDropdown, filteredOptions, activeIndex, editor, currentFilter]);

  // Handle selection from dropdown
  const handleSelect = (transition: string) => {
    if (!editor) return;

    // Insert the transition
    editor.chain().insertContent(transition).focus().run();

    // Hide the dropdown and preview
    setShowDropdown(false);
    setShowPreview(false);

    // After inserting a transition, auto-advance to a new description line
    setTimeout(() => {
      try {
        // Create a new description line
        const { state } = editor.view;
        const { $from } = state.selection;

        if ($from.depth > 0) { // Safety check
          const pos = $from.after();
          editor.chain()
            .insertContentAt(pos, { type: 'paragraph', attrs: { lineType: 'description' } })
            .focus()
            .run();
        }
      } catch (error) {
        console.log('Error creating new line:', error);
      }
    }, 10);
  };

  return (
    <>
      {/* {showPreview && (
        <div
          className="transition-preview"
          style={{
            position: 'fixed',
            top: previewPos.top,
            left: previewPos.left,
            fontFamily: 'Courier, monospace',
            color: 'rgba(0, 0, 0, 0.4)',
            pointerEvents: 'none',
            zIndex: 99998,
            fontSize: '16px',
            ...(currentFilter.length > 0
              ? { paddingLeft: `${currentFilter.length * 0.6}em` }
              : {})
          }}
        >
          {previewOption}
        </div>
      )} */}

      {showDropdown && filteredOptions.length > 0 && (
        <div
          className="transition-dropdown"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 99999,
            background: 'white',
            border: '1px solid #ccc',
            color: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            minWidth: '150px',
          }}
        >
          {filteredOptions.map((option, index) => (
            <div
              key={option}
              className={`transition-option ${index === activeIndex ? 'active' : ''}`}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                backgroundColor: index === activeIndex ? '#e6f7ff' : 'transparent',
                fontFamily: 'Courier, monospace',
              }}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              onClick={() => {
                if (!editor) return;

                lockRef.current = true;

                try {
                  // Clear the entire content of the node before inserting
                  const { state } = editor.view;
                  const { $from } = state.selection;

                  if ($from.depth > 0) { // Safety check
                    editor.chain()
                      .setTextSelection({ from: $from.start(), to: $from.end() })
                      .deleteSelection()
                      .run();
                  }

                  handleSelect(option);
                } catch (error) {
                  console.log('Error in click handler:', error);
                }

                setTimeout(() => {
                  lockRef.current = false;
                }, 50);
              }}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default TransitionAutoFill;