import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

export interface StoryBreadcrumbHeaderProps {
  storyTitle?: string;
  onTitleChange?: (newTitle: string) => void;
  onNewStory?: () => void;
  hasUnsavedChanges?: boolean;
  className?: string; // optional wrapper class
  /** color used for the unsaved-dot and input border */
  accentColor?: string; // default "#ff6b35"
}

/**
 * Small breadcrumb + inline editable title + hover "New Story" button.
 * - Click title to edit
 * - Save on Enter or blur
 * - Cancel on Escape
 */
const StoryBreadcrumbHeader: React.FC<StoryBreadcrumbHeaderProps> = ({
  storyTitle = "Untitled Story",
  onTitleChange,
  onNewStory,
  hasUnsavedChanges = false,
  className,
  accentColor = "#ff6b35",
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState<string>(storyTitle ?? "");
  const [showNew, setShowNew] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) setEditValue(storyTitle ?? "");
  }, [storyTitle, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      const val = inputRef.current.value;
      inputRef.current.setSelectionRange(val.length, val.length);
    }
  }, [isEditing]);

  const displayTitle = (storyTitle ?? "").trim() ? storyTitle! : "Untitled Story";
  const isUntitled = !storyTitle || !storyTitle.trim() || storyTitle === "Untitled Story";

  const save = () => {
    const trimmed = (editValue ?? "").trim();
    if (!trimmed) {
      // revert if empty
      setEditValue(storyTitle ?? "");
      setIsEditing(false);
      return;
    }
    if (onTitleChange && trimmed !== storyTitle) onTitleChange(trimmed);
    setIsEditing(false);
  };

  const cancel = () => {
    setEditValue(storyTitle ?? "");
    setIsEditing(false);
  };

  const onKeyDownInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  const handleNewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onNewStory) onNewStory();
    setShowNew(false);
  };

  return (

    <div
      className={className}
      onMouseEnter={() => setShowNew(true)}
      onMouseLeave={() => setShowNew(false)}
      style={{ fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", gap: 8, marginTop: "36px", marginBottom: "20px" }}
    >
      <NavLink to="/dashboard" className="text-sm" style={{ color: "rgba(255,255,255,0.65)", textDecoration: "none" }}>
        Home
      </NavLink>

      <span className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
        ›
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 text-sm w-full text-left"
            title={isUntitled ? "Click to rename story" : "Click to edit story title"}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: isUntitled ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.95)",
              fontStyle: isUntitled ? "italic" : "normal",
              fontWeight: isUntitled ? 400 : 600,
              display: "flex",
              alignItems: "center",
              width: "100%",
              textAlign: "left",
            }}
            aria-label="Edit story title"
          >
            {hasUnsavedChanges && (
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: accentColor,
                  display: "inline-block",
                  marginRight: 6,
                  flexShrink: 0,
                }}
              />
            )}
            <span className="truncate" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayTitle}
            </span>
          </button>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDownInput}
            placeholder="Enter story title..."
            className="text-sm"
            style={{
              width: "100%",
              borderRadius: 6,
              padding: "6px 8px",
              background: "rgba(40,40,40,0.95)",
              border: `1px solid ${accentColor}`,
              color: "white",
              outline: "none",
            }}
            aria-label="Story title input"
          />
        )}
      </div>
    </div>
  );
};

export default StoryBreadcrumbHeader;
