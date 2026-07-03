import React, { useState, useEffect } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { Box, Flex } from "@radix-ui/themes";
import "../../styles/Home/StoryNavigation.css"

interface StoryNavigationProps {
  isScrolled?: boolean;
  storyTitle?: string;
  onTitleChange?: (newTitle: string) => void;
  onNewStory?: () => void;
  hasUnsavedChanges?: boolean; // New prop to indicate unsaved changes
}

const StoryNavigation: React.FC<StoryNavigationProps> = ({
  isScrolled = false,
  storyTitle = "Untitled Story",
  onTitleChange,
  onNewStory,
  hasUnsavedChanges = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(storyTitle);
  const [showNewStoryOption, setShowNewStoryOption] = useState(false);
  const location = useLocation();

  // Update editValue when storyTitle changes (for when stories are loaded)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(storyTitle);
    }
  }, [storyTitle, isEditing]);

  const handleTitleClick = () => {
    setIsEditing(true);
    setEditValue(storyTitle);
  };

  const handleSave = () => {
    const trimmedValue = editValue.trim();

    // Validate title
    if (!trimmedValue) {
      // Don't allow empty titles
      setEditValue(storyTitle);
      setIsEditing(false);
      return;
    }

    if (onTitleChange && trimmedValue !== storyTitle) {
      onTitleChange(trimmedValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(storyTitle);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  const handleNewStoryClick = () => {
    if (onNewStory) {
      onNewStory();
    }
    setShowNewStoryOption(false);
  };

  // Get display title - show "Untitled Story" if empty or just whitespace
  const displayTitle =
    storyTitle && storyTitle.trim() ? storyTitle : "Untitled Story";
  const isUntitled =
    !storyTitle || !storyTitle.trim() || storyTitle === "Untitled Story";

  // Check if we're on the dashboard/home page
  const isDashboard = location.pathname === "/dashboard";

  return (
    <Box
      className={`secondary-nav-container ${isScrolled ? "hidden" : ""}`}
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        marginBottom: "2rem",
        marginTop: "100px",
        opacity: isScrolled ? 0 : 1,
        transition: "opacity 0.4s ease",
        pointerEvents: isScrolled ? "none" : "auto",
        position: "relative",
        zIndex: 5, // Lower than header (1000) but higher than content
      }}
    >
      {/* Breadcrumb Navigation */}
      <Box
        className="breadcrumb-navigation"
        style={{
          position: "absolute",
          left: "20px",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          gap: "8px",
          alignItems: "center",
          fontSize: "13px",
          padding: "10px",
          zIndex: 10,
        }}
        onMouseEnter={() => setShowNewStoryOption(true)}
        onMouseLeave={() => setShowNewStoryOption(false)}
      >
        <Link
          to="/dashboard"
          className="breadcrumb-item"
          style={{
            color: "rgba(255, 255, 255, 0.5)",
            transition: "color 0.3s ease",
            cursor: "pointer",
            textDecoration: "none",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)")
          }
        >
          Home
        </Link>
        <span
          className="breadcrumb-separator"
          style={{
            color: "rgba(255, 255, 255, 0.3)",
            fontSize: "11px",
            margin: "0 4px",
          }}
        >
          ›
        </span>

        {!isEditing ? (
          <span
            className="breadcrumb-current"
            onClick={handleTitleClick}
            style={{
              color: isUntitled
                ? "rgba(255, 255, 255, 0.5)"
                : "rgba(255, 255, 255, 0.9)",
              fontWeight: isUntitled ? 400 : 500,
              fontStyle: isUntitled ? "italic" : "normal",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              transition: "all 0.3s ease",
              border: "1px solid transparent",
              position: "relative",
              maxWidth: "200px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
              const icon = e.currentTarget.querySelector(
                ".edit-icon"
              ) as HTMLElement;
              if (icon) icon.style.opacity = "0.6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
              const icon = e.currentTarget.querySelector(
                ".edit-icon"
              ) as HTMLElement;
              if (icon) icon.style.opacity = "0";
            }}
          >
            {/* Unsaved changes indicator */}
            {hasUnsavedChanges && (
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  backgroundColor: "#ff6b35",
                  borderRadius: "50%",
                  marginRight: "6px",
                  display: "inline-block",
                }}
                title="Unsaved changes"
              />
            )}
            {displayTitle}
            <span
              className="edit-icon"
              style={{
                marginLeft: "6px",
                fontSize: "10px",
                opacity: 0,
                transition: "opacity 0.3s ease",
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1464 1.14645L3.71396 8.57889C3.62858 8.66427 3.57144 8.77639 3.55289 8.89779L3.01434 12.0436C2.98974 12.2581 3.08097 12.4704 3.25671 12.6162C3.43245 12.762 3.67336 12.8181 3.90096 12.7656L7.10289 12.2271C7.22429 12.2085 7.33641 12.1514 7.42179 12.066L14.8536 4.63356C15.0488 4.43829 15.0488 4.12171 14.8536 3.92645L11.8536 1.14645ZM4.42289 9.28862L10.8536 2.85788L12.1464 4.14645L5.71568 10.5772L4.42289 9.28862Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          </span>
        ) : (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            className="breadcrumb-input"
            style={{
              background: "rgba(40, 40, 40, 0.9)",
              border: "1px solid #ff6b35",
              borderRadius: "4px",
              padding: "4px 8px",
              color: "white",
              fontSize: "13px",
              fontWeight: 500,
              outline: "none",
              minWidth: "120px",
              maxWidth: "200px",
            }}
            placeholder="Enter story title..."
            maxLength={100} // Prevent extremely long titles
          />
        )}

        {/* New Story Option - appears on hover */}
        {showNewStoryOption && onNewStory && (
          <div
            className="new-story-option"
            onClick={handleNewStoryClick}
            style={{
              position: "absolute",
              top: "100%",
              left: "0",
              background: "rgba(40, 40, 40, 0.95)",
              border: "1px solid rgba(255, 107, 53, 0.4)",
              borderRadius: "6px",
              padding: "8px 12px",
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.8)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
              backdropFilter: "blur(10px)",
              zIndex: 20,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 107, 53, 0.1)";
              e.currentTarget.style.borderColor = "rgba(255, 107, 53, 0.6)";
              e.currentTarget.style.color = "rgba(255, 255, 255, 1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(40, 40, 40, 0.95)";
              e.currentTarget.style.borderColor = "rgba(255, 107, 53, 0.4)";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
            }}
          >
            <span style={{ marginRight: "6px", fontSize: "11px" }}>+</span>
            New Story
          </div>
        )}
      </Box>

      {/* Main Navigation Pills */}
      <Flex
        gap="2"
        className="nav-pills-container"
        style={{
          backgroundColor: "rgba(20, 20, 20, 0.8)",
          backdropFilter: "blur(20px)",
          borderRadius: "16px",
          padding: "0.5rem",
          width: "30rem",
          maxWidth: "90vw",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow:
            "0 4px 12px rgba(0, 0, 0, 0.3), 0 1px 0 rgba(255, 255, 255, 0.05) inset",
          transition: "all 0.4s ease",
        }}
      >
        <NavLink
          to="/home"
          className={({ isActive }) =>
            isActive || isDashboard ? "secondary-nav-link active" : "secondary-nav-link"
          }
          style={({ isActive }) => {
            const shouldBeActive = isActive || isDashboard;
            return {
              flex: 1,
              padding: "0.75rem 1rem",
              textAlign: "center",
              borderRadius: "12px",
              fontWeight: shouldBeActive ? 600 : 500,
              color: shouldBeActive ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
              background: shouldBeActive
                ? "linear-gradient(135deg, rgba(255, 107, 53, 0.8) 0%, rgba(255, 140, 66, 0.8) 100%)"
                : "transparent",
              textDecoration: "none",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: shouldBeActive
                ? "0 4px 12px rgba(255, 107, 53, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2)"
                : "none",
            };
          }}
        >
          Outline
        </NavLink>
        <NavLink
          to="/scenes"
          className={({ isActive }) =>
            isActive ? "secondary-nav-link active" : "secondary-nav-link"
          }
          style={({ isActive }) => ({
            flex: 1,
            padding: "0.75rem 1rem",
            textAlign: "center",
            borderRadius: "12px",
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
            background: isActive
              ? "linear-gradient(135deg, rgba(255, 107, 53, 0.8) 0%, rgba(255, 140, 66, 0.8) 100%)"
              : "transparent",
            textDecoration: "none",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: isActive
              ? "0 4px 12px rgba(255, 107, 53, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2)"
              : "none",
          })}
        >
          Scenes
        </NavLink>
        <NavLink
          to="/scripts"
          className={({ isActive }) =>
            isActive ? "secondary-nav-link active" : "secondary-nav-link"
          }
          style={({ isActive }) => ({
            flex: 1,
            padding: "0.75rem 1rem",
            textAlign: "center",
            borderRadius: "12px",
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
            background: isActive
              ? "linear-gradient(135deg, rgba(255, 107, 53, 0.8) 0%, rgba(255, 140, 66, 0.8) 100%)"
              : "transparent",
            textDecoration: "none",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: isActive
              ? "0 4px 12px rgba(255, 107, 53, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2)"
              : "none",
          })}
        >
          Script
        </NavLink>
      </Flex>
    </Box>
  );
};

export default StoryNavigation;