// Updated Toolbar component for the right margin integration with proper TypeScript types
import React, { useState } from "react";
import {
  Settings,
  AlignLeft,
  Type,
  FileText,
  Save,
  Bold,
  Italic,
  Underline,
  Maximize2, // Add this line
  Minimize2, // Add this line
} from "lucide-react";
import { Button } from "@radix-ui/themes";
import { Editor } from "@tiptap/react";

interface ToolbarProps {
  editor: Editor | null;
  onFullscreen?: () => void; // Add this line
  onMinimize?: () => void; // Add this line
  isFullscreen?: boolean; // Add this line to know which button to show
}

// Import the editor utility function
// This should come from your existing utils or add it inline
const updateParagraphAttribute = (
  editor: Editor | null,
  attributes: Record<string, any>
): boolean => {
  if (!editor) return false;

  try {
    const { state, dispatch } = editor.view;
    const { $from } = state.selection;

    // Safety check - if depth is 0, we're at the document level
    if ($from.depth === 0) {
      return false;
    }

    const pos = $from.before();
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== "paragraph") return false;

    dispatch(
      state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attributes })
    );
    requestAnimationFrame(() => editor.commands.focus());
    return true;
  } catch (error) {
    console.warn("Error in updateParagraphAttribute:", error);
    return false;
  }
};

interface FormatOption {
  type: string;
  label: string;
  icon: React.ReactNode;
}

const Toolbar: React.FC<ToolbarProps> = ({
  editor,
  onFullscreen,
  onMinimize,
  isFullscreen,
}) => {
  const [activeButton, setActiveButton] = useState<string | null>(null);

  if (!editor) return null;

  const formatOptions: FormatOption[] = [
    { type: "scene", label: "Slugline", icon: <FileText size={14} /> },
    { type: "description", label: "Action", icon: <AlignLeft size={14} /> },
    { type: "character", label: "Character", icon: <Type size={14} /> },
    { type: "dialogue", label: "Dialog", icon: <Type size={14} /> },
    { type: "parenthetical", label: "Parenthetical", icon: <Type size={14} /> },
    { type: "transition", label: "Transition", icon: <AlignLeft size={14} /> },
  ];

  const applyFormat = (type: string) => {
    if (!editor) return;

    try {
      const { state } = editor.view;
      const { $from } = state.selection;

      // If we have a document-level selection, reset to first paragraph
      if ($from.depth === 0) {
        editor.commands.setTextSelection(1);
      }

      // Apply the line type change
      const success = updateParagraphAttribute(editor, { lineType: type });

      // For parenthetical, auto-insert opening parenthesis if line is empty
      if (type === "parenthetical" && success) {
        const { state } = editor.view;
        const { $from } = state.selection;

        if ($from.depth > 0) {
          const node = $from.parent;

          // Only insert parenthesis if the line is empty
          if (!node.textContent.trim()) {
            editor.commands.insertContent("(");
          } else if (!node.textContent.startsWith("(")) {
            // If there's content but no opening parenthesis, add one at the beginning
            const currentPos = $from.before() + 1; // Position at start of text
            editor.commands.insertContentAt(currentPos, "(");
          }
        }
      }

      // Force a ProseMirror view update to ensure events trigger
      editor.view.updateState(editor.view.state);

      // Ensure focus after line type change
      requestAnimationFrame(() => editor.commands.focus());

      // Close the format menu after selection
      setActiveButton(null);
    } catch (error) {
      console.warn("Error in toolbar button click:", error);
    }
  };

  const toggleMenu = (buttonName: string) => {
    if (activeButton === buttonName) {
      setActiveButton(null);
    } else {
      setActiveButton(buttonName);
    }
  };

  return (
    <div className="screenplay-toolbar">
      {/* Format Button */}
      <div
        className={`toolbar-button ${
          activeButton === "format" ? "active" : ""
        }`}
        onClick={() => toggleMenu("format")}
        title="Formatting Options"
      >
        <Settings size={18} />

        {/* Format menu dropdown */}
        <div className="format-menu">
          {formatOptions.map(({ type, label, icon }) => (
            <div
              key={type}
              className="format-option"
              onClick={() => applyFormat(type)}
              style={{ color: "#000000" }} // Add this line
            >
              {icon}
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Text Style Button */}
      <div
        className={`toolbar-button ${
          activeButton === "text-style" ? "active" : ""
        }`}
        onClick={() => toggleMenu("text-style")}
        title="Text Styles"
      >
        <Type size={18} />

        {/* Text style menu dropdown */}
        <div className="format-menu">
          <div className="format-option" style={{ color: "#000000" }}>
            <Bold size={14} />
            Bold
          </div>
          <div className="format-option" style={{ color: "#000000" }}>
            <Italic size={14} />
            Italic
          </div>
          <div className="format-option" style={{ color: "#000000" }}>
            <Underline size={14} />
            Underline
          </div>
        </div>
      </div>

      <div className="toolbar-divider"></div>

      {/* Fullscreen Button - ADD THIS ENTIRE BLOCK */}
      {/*}
      {onFullscreen && (
        <div
          className="toolbar-button"
          onClick={onFullscreen}
          title="Enter Fullscreen"
        >
          <Maximize2 size={18} />
        </div>
      )}
      */}
      {/* Fullscreen/Minimize Button */}
      {isFullscreen
        ? onMinimize && (
            <div
              className="toolbar-button"
              onClick={onMinimize}
              title="Exit Fullscreen"
            >
              <Minimize2 size={18} />
            </div>
          )
        : onFullscreen && (
            <div
              className="toolbar-button"
              onClick={onFullscreen}
              title="Enter Fullscreen"
            >
              <Maximize2 size={18} />
            </div>
          )}

      {/* Save Button */}
      <div
        className="toolbar-button"
        onClick={() => {
          // Trigger save function
          console.log("Save script");
        }}
        title="Save Script"
      >
        <Save size={18} />
      </div>
    </div>
  );
};

export default Toolbar;
