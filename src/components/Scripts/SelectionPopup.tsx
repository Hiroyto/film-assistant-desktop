/**
 * SelectionPopup.tsx
 * ==================
 * Floating popup on text selection with Revise (cyan) and Suggest (purple).
 * Solid filled buttons matching the canvas SegmentContentBlock popup style.
 *
 * Imported by: ScriptEditor.tsx
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { snapToWordBoundaries } from "./selectionUtils";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SelectionPopupProps {
  editor: Editor | null;
  panelOpen: boolean;
  onRevise: (from: number, to: number) => void;
  onSuggest: (from: number, to: number) => void;
}

interface PopupPosition {
  top: number;
  left: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getSelectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

const SelectionPopup: React.FC<SelectionPopupProps> = ({
  editor,
  panelOpen,
  onRevise,
  onSuggest,
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<PopupPosition>({ top: 0, left: 0 });
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback(() => {
    if (!editor || panelOpen) {
      setVisible(false);
      return;
    }

    const { selection } = editor.state;
    const hasSelection = !selection.empty && selection.from !== selection.to;

    if (!hasSelection) {
      hideTimeoutRef.current = setTimeout(() => setVisible(false), 150);
      return;
    }

    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const selectedText = editor.state.doc.textBetween(selection.from, selection.to, " ");
    if (selectedText.trim().length < 3) {
      setVisible(false);
      return;
    }

    const rect = getSelectionRect();
    if (!rect) {
      setVisible(false);
      return;
    }

    const popupWidth = 200;
    const top = rect.bottom + 8;
    const left = rect.left + rect.width / 2 - popupWidth / 2;

    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
    const clampedTop = Math.min(top, window.innerHeight - 60);

    setPosition({ top: clampedTop, left: clampedLeft });
    setVisible(true);
  }, [editor, panelOpen]);

  useEffect(() => {
    if (!editor) return;

    const onSelectionUpdate = () => updatePosition();
    const onBlur = () => {
      hideTimeoutRef.current = setTimeout(() => setVisible(false), 200);
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    editor.on("blur", onBlur);

    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
      editor.off("blur", onBlur);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [editor, updatePosition]);

  useEffect(() => {
    if (panelOpen) setVisible(false);
  }, [panelOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleAction = useCallback(
    (action: "revise" | "suggest") => {
      if (!editor) return;

      const { from, to } = editor.state.selection;
      if (from === to) return;

      const snapped = snapToWordBoundaries(editor, from, to);

      const tr = editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, snapped.from, snapped.to)
      );
      editor.view.dispatch(tr);

      setVisible(false);

      if (action === "revise") {
        onRevise(snapped.from, snapped.to);
      } else {
        onSuggest(snapped.from, snapped.to);
      }
    },
    [editor, onRevise, onSuggest]
  );

  const handleRevise = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleAction("revise");
    },
    [handleAction]
  );

  const handleSuggest = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleAction("suggest");
    },
    [handleAction]
  );

  if (!visible) return null;

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        background: "linear-gradient(135deg, rgba(20, 22, 28, 0.98) 0%, rgba(16, 18, 24, 0.98) 100%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1)",
        animation: "selectionPopupIn 0.15s ease-out",
        pointerEvents: "auto",
      }}
    >
      <style>
        {`
          @keyframes selectionPopupIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>

      {/* Revise — solid cyan fill */}
      <button
        onClick={handleRevise}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          background: "linear-gradient(135deg, #15c4d9 0%, #06b6d4 100%)",
          border: "none",
          borderRadius: 8,
          color: "#ffffff",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.12s ease",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = "brightness(1.15)";
          e.currentTarget.style.boxShadow = "0 0 14px rgba(6, 182, 212, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = "brightness(1)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.2">
          <circle cx="4" cy="7.5" r="2.5" fill="none" />
          <circle cx="11" cy="7.5" r="2.5" fill="none" />
          <path d="M6.5 7.5H8.5" strokeLinecap="round" />
        </svg>
        Revise
      </button>

      {/* Suggest — solid purple fill with lightbulb */}
      <button
        onClick={handleSuggest}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          background: "linear-gradient(135deg, #9b87f5 0%, #8b5cf6 100%)",
          border: "none",
          borderRadius: 8,
          color: "#ffffff",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.12s ease",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = "brightness(1.15)";
          e.currentTarget.style.boxShadow = "0 0 14px rgba(139, 92, 246, 0.4)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = "brightness(1)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M7.5 3C5.567 3 4 4.567 4 6.5C4 7.753 4.5 8.5 5.25 9.25C5.75 9.75 6 10.25 6 11V11.5C6 11.776 6.224 12 6.5 12H8.5C8.776 12 9 11.776 9 11.5V11C9 10.25 9.25 9.75 9.75 9.25C10.5 8.5 11 7.753 11 6.5C11 4.567 9.433 3 7.5 3Z" fill="none" />
          <path d="M6 13.5H9" strokeLinecap="round" />
        </svg>
        Suggest
      </button>
    </div>
  );
};

export default SelectionPopup;