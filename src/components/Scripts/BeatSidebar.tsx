/**
 * BeatSidebar.tsx
 * ===============
 * Sidebar component that displays the story's beat structure.
 *
 * This is the left panel in the Scripts page. It shows:
 *   - A list of story beats (narrative units like "Act 1: Setup")
 *   - Expandable beat cards that reveal their child scenes
 *   - Scene cards with "Generate" buttons to trigger AI script generation
 *   - Visual indicators for selected/hovered states
 *
 * The component hierarchy:
 *   BeatSidebar → BeatItem → SceneItem
 *
 * Data Flow:
 *   - Beat/scene data comes from mockScriptData (will be replaced with real API)
 *   - Selection state is managed by the parent Scripts.tsx
 *   - Scene generation is triggered via onSceneGenerate callback
 *
 * Imported by: Scripts.tsx
 */

import React, { useState } from "react";
import {
  Flex,
  Text,
  Button,
  Box,
  ScrollArea,
  Badge,
  Tooltip,
} from "@radix-ui/themes";
import { AlignLeft, Info } from "lucide-react";
import { SceneProps, BeatProps } from "./types";
import { compareSceneIds } from "./editorUtils";

// ─────────────────────────────────────────────
// SceneItem — A single scene card within a beat
// ─────────────────────────────────────────────

/**
 * Displays a scene with its ID badge, title, hover preview, and generate button.
 *
 * On hover: shows a content preview (first 150 chars) and makes the
 * generate button more prominent. On click: selects the scene and
 * scrolls to it in the editor (if it exists).
 */
const SceneItem: React.FC<SceneProps> = ({
  id,
  title,
  content,
  isSelected,
  onSelect,
  onGenerate,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Box
      className={`scene-item ${isSelected ? "selected" : ""}`}
      style={{
        padding: "0.5rem 0.75rem",
        marginBottom: "0.5rem",
        marginLeft: "1rem",
        borderRadius: "0.5rem",
        backgroundColor: isSelected
          ? "rgba(255, 102, 0, 0.1)"
          : "rgba(255, 255, 255, 0.7)",
        border: `1px solid ${isSelected ? "rgba(255, 102, 0, 0.5)" : "rgba(0, 0, 0, 0.1)"
          }`,
        cursor: "pointer",
        position: "relative",
        transition: "all 0.2s ease",
        boxShadow: isHovered ? "0 2px 4px rgba(0, 0, 0, 0.1)" : "none",
        transform: isHovered ? "translateY(-1px)" : "none",
      }}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Flex justify="between" align="start" gap="2">
        <Box style={{ flex: 1 }}>
          <Flex align="center" gap="2">
            <Badge size="1" variant="soft" color="orange">
              {id}
            </Badge>
            <Text weight="medium" size="1">
              {title}
            </Text>
          </Flex>

          {/* Content preview — only visible on hover */}
          {isHovered && (
            <Text
              size="1"
              style={{
                color: "#666",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: "0.75rem",
                marginTop: "0.25rem",
                backgroundColor: "rgba(255, 255, 255, 0.7)",
                padding: "0.25rem",
                borderRadius: "0.25rem",
              }}
            >
              {content.substring(0, 150)}...
            </Text>
          )}
        </Box>
      </Flex>

      {/* Generate button */}
      <Button
        size="1"
        variant="ghost"
        color="orange"
        onClick={(e) => {
          e.stopPropagation(); // Don't trigger scene selection
          onGenerate();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.25rem 0.5rem",
          fontSize: "0.7rem",
          marginTop: isHovered ? "0.25rem" : "0",
          opacity: isHovered ? 1 : 0.5,
          transition: "opacity 0.2s ease",
        }}
      >
        <AlignLeft size={10} />
        Generate
      </Button>
    </Box>
  );
};

// ─────────────────────────────────────────────
// BeatItem — A story beat card with expandable scenes
// ─────────────────────────────────────────────

/**
 * Displays a beat with its title, scene count, and expandable scene list.
 *
 * Clicking a beat selects it and auto-expands to show its scenes.
 * The expand/collapse toggle can also be used independently.
 * Scenes within a beat are automatically sorted by their scene ID.
 */
const BeatItem: React.FC<BeatProps> = ({
  id,
  title,
  description,
  scenes,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onSceneSelect,
  onSceneGenerate,
  selectedSceneId,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Sort scenes by their ID (S1.1 before S1.2, etc.)
  const sortedScenes = [...scenes].sort((a, b) => compareSceneIds(a.sceneId, b.sceneId));

  return (
    <Box className="beat-container">
      {/* Beat header card */}
      <Box
        className={`beat-item ${isSelected ? "selected" : ""}`}
        style={{
          padding: "0.75rem",
          marginBottom: "0.5rem",
          borderRadius: "0.5rem",
          backgroundColor: isSelected ? "rgba(255, 102, 0, 0.1)" : "white",
          border: `1px solid ${isSelected ? "rgba(255, 102, 0, 0.5)" : "rgba(0, 0, 0, 0.1)"
            }`,
          cursor: "pointer",
          position: "relative",
          transition: "all 0.2s ease",
          boxShadow: isHovered ? "0 4px 8px rgba(0, 0, 0, 0.1)" : "none",
        }}
        onClick={() => {
          onSelect();
          if (!isExpanded) {
            onToggleExpand();
          }
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Flex justify="between" align="center">
          <Box>
            <Flex align="center" gap="2">
              <Badge size="1" variant="soft" color="gray">
                {id}
              </Badge>
              <Text weight="bold" size="2">
                {title}
              </Text>
              <Badge size="1" variant="soft" color="gray">
                {scenes.length} {scenes.length === 1 ? "Scene" : "Scenes"}
              </Badge>
            </Flex>
          </Box>
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={(e) => {
              e.stopPropagation(); // Don't trigger beat selection
              onToggleExpand();
            }}
          >
            {isExpanded ? "▲" : "▼"}
          </Button>
        </Flex>
      </Box>

      {/* Expanded scene list */}
      {isExpanded && sortedScenes.length > 0 && (
        <Box className="scenes-list" style={{ marginBottom: "1rem" }}>
          {sortedScenes.map((scene) => (
            <SceneItem
              key={scene.sceneId}
              id={scene.sceneId}
              title={scene.title}
              content={scene.content}
              isSelected={selectedSceneId === scene.sceneId}
              onSelect={() => onSceneSelect(scene.sceneId)}
              onGenerate={() => onSceneGenerate(scene.sceneId)}
            />
          ))}
        </Box>
      )}

      {/* Empty state when beat has no scenes */}
      {isExpanded && scenes.length === 0 && (
        <Box
          style={{
            padding: "0.5rem",
            marginBottom: "1rem",
            marginLeft: "1rem",
            borderRadius: "0.5rem",
            backgroundColor: "rgba(0, 0, 0, 0.05)",
            textAlign: "center",
            fontSize: "0.8rem",
            color: "#666",
          }}
        >
          No scenes available
        </Box>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────
// BeatSidebar — Full sidebar container
// ─────────────────────────────────────────────

/**
 * Props for the BeatSidebar component.
 */
interface BeatSidebarProps {
  /** Story structure data containing segments (beats) */
  storyData: any;
  /** Currently selected beat ID */
  selectedBeatId: string | null;
  /** Currently selected scene ID */
  selectedSceneId: string | null;
  /** Scenes loaded for the currently selected beat */
  loadedScenes: any[];
  /** Map of beat IDs to their expanded state */
  isExpanded: Record<string, boolean>;
  /** Called when a beat is selected */
  onBeatSelect: (beatId: string) => void;
  /** Called when a beat's expand/collapse is toggled */
  onToggleExpand: (beatId: string) => void;
  /** Called when a scene is selected */
  onSceneSelect: (sceneId: string) => void;
  /** Called when scene generation is requested */
  onSceneGenerate: (sceneId: string) => void;
}

/**
 * The full sidebar panel containing the beat list, scene info tooltip,
 * and scrollable beat/scene cards.
 */
const BeatSidebar: React.FC<BeatSidebarProps> = ({
  storyData,
  selectedBeatId,
  selectedSceneId,
  loadedScenes,
  isExpanded,
  onBeatSelect,
  onToggleExpand,
  onSceneSelect,
  onSceneGenerate,
}) => {
  return (
    <Box
      className="beat-sidebar"
      style={{
        width: "300px",
        flexShrink: 0,
        marginLeft: "1rem",
      }}
    >
      {/* Header section */}
      <Box
        className="white-container"
        style={{
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <Flex justify="between" align="center" mb="2">
          <Text weight="bold" size="3">
            Story Beats
          </Text>
          <Badge size="1" variant="soft" color="gray">
            {storyData.segments.length} Beats
          </Badge>
        </Flex>
        <Text size="1" color="gray" mb="3">
          Select a beat to create a scene based on it.
        </Text>

        <Tooltip content="Scene identifiers follow the format S1.1, S1.2, etc., where the first number indicates the beat and the second number indicates the scene within that beat.">
          <Flex
            align="center"
            gap="1"
            style={{ fontSize: "0.75rem", color: "#666" }}
          >
            <Info size={12} />
            <Text size="1">Scene ID format: S1.1, S1.2, etc.</Text>
          </Flex>
        </Tooltip>
      </Box>

      {/* Scrollable beat list */}
      <ScrollArea
        style={{
          height: "560px",
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          borderRadius: "0.75rem",
          backdropFilter: "blur(8px)",
          padding: "1rem",
          boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
        }}
      >
        {storyData.segments.map((segment: any) => (
          <BeatItem
            key={segment.id}
            id={segment.id}
            title={segment.title}
            description={segment.description}
            scenes={segment.id === selectedBeatId ? loadedScenes : []}
            isSelected={segment.id === selectedBeatId}
            isExpanded={isExpanded[segment.id] || false}
            onSelect={() => onBeatSelect(segment.id)}
            onToggleExpand={() => onToggleExpand(segment.id)}
            onSceneSelect={onSceneSelect}
            onSceneGenerate={onSceneGenerate}
            selectedSceneId={selectedSceneId}
          />
        ))}
      </ScrollArea>
    </Box>
  );
};

export default BeatSidebar;