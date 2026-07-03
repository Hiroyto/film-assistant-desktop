import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Editor, EditorContent } from "@tiptap/react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import {
  ScreenwritingParagraph,
  ScreenwritingLineType,
} from "../extensions/Screenwritingline";
import {
  Text,
  Button,
  Flex,
  Badge,
  Box,
  Container,
  ScrollArea,
} from "@radix-ui/themes";
import { AlignLeft, Save, Minimize2, ChevronRight, Info } from "lucide-react";
import { TailSpin } from "react-loading-icons";
import SluglineAutoFill from "./SluglineAutoFill";
import CharacterAutoFill from "./CharacterAutoFill";
import TransitionAutoFill from "./TransitionAutoFill";
import Toolbar from "./toolbar";
import EditorErrorBoundary from "./EditorErrorBoundary";
import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// Copy the SceneTracking extension from your main Scripts component
const SceneTracking = Extension.create({
  name: "sceneTracking",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          "data-scene-id": {
            default: null,
          },
        },
      },
    ];
  },
});

// Copy the KeyboardShortcuts extension from your main Scripts component
const KeyboardShortcuts = Extension.create({
  name: "keyboardShortcuts",
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const pos = $from.before();
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "paragraph") return false;

          editor.view.dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              lineType: "character",
            })
          );
          return true;
        } catch (error) {
          console.warn("Error in Tab handler:", error);
          return false;
        }
      },

      Enter: ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;

          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs
            .lineType as ScreenwritingLineType;

          // For parenthetical, close parenthesis if needed
          if (currentType === "parenthetical") {
            const text = currentNode.textContent;
            if (text.startsWith("(") && !text.endsWith(")")) {
              editor.commands.insertContent(")");
              return true;
            }
          }

          // Determine the appropriate line type for the new paragraph
          let newLineType: ScreenwritingLineType = "description";

          if (currentType === "character") {
            newLineType = "dialogue";
          } else if (currentType === "dialogue") {
            newLineType = "description";
          } else if (currentType === "parenthetical") {
            newLineType = "dialogue";
          } else {
            newLineType = "description";
          }

          // Use TipTap's splitBlock command with custom attributes
          const tr = state.tr;
          const pos = $from.pos;

          // Split the current paragraph at cursor position
          tr.split(pos);

          // Set the line type for the new paragraph
          const newParaPos = tr.doc.resolve(pos + 2); // Position in the new paragraph
          const newParaStart = newParaPos.before();
          const newPara = tr.doc.nodeAt(newParaStart);

          if (newPara) {
            tr.setNodeMarkup(newParaStart, undefined, {
              lineType: newLineType,
              style: "font-family: 'Courier New', monospace; font-size: 12pt;",
            });
          }

          // Set cursor at beginning of new paragraph
          tr.setSelection(TextSelection.create(tr.doc, pos + 2));

          editor.view.dispatch(tr);
          editor.commands.focus();

          return true;
        } catch (error) {
          console.warn("Error in Enter handler:", error);
          return false;
        }
      },
      // Add Shift+Enter for new paragraphs
      "Shift-Enter": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs.lineType;

          let newType = "description";
          if (currentType === "character") newType = "dialogue";
          else if (currentType === "dialogue") newType = "description";
          else if (currentType === "parenthetical") newType = "dialogue";

          const tr = state.tr;
          const pos = $from.after();
          const newNode = state.schema.nodes.paragraph.create({
            lineType: newType,
            style: "font-family: 'Courier New', monospace; font-size: 12pt;",
          });

          tr.insert(pos, newNode);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          editor.view.dispatch(tr);
          editor.commands.focus();
          return true;
        } catch (error) {
          console.warn("Error in Shift-Enter handler:", error);
          return false;
        }
      },
      "Shift-Tab": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const pos = $from.before();
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "paragraph") return false;

          editor.view.dispatch(
            state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              lineType: "dialogue",
            })
          );
          return true;
        } catch (error) {
          console.warn("Error in Shift-Tab handler:", error);
          return false;
        }
      },
    };
  },
});

interface Character {
  id?: string;
  name: string;
  description: string;
  importance: "major" | "supporting" | "minor";
  is_new: boolean;
  locked?: boolean;
  arc: {
    starting_state: string;
    goal: string;
    conflict: string;
    need: string;
    growth: "static" | "dynamic";
  };
}
// Add this after your imports and before the Scene interface
//interface Character {
//  id: string;
// name: string;
//description: string;
//}

// Interface for the Scene component props
interface Scene {
  sceneId: string;
  title: string;
  content: string;
  isExpanded?: boolean;
  isEditing?: boolean;
  isGenerating?: boolean;
  metadata?: Record<string, any>;
}

interface Beat {
  id: string;
  title: string;
  description: string;
  scenes: Scene[];
  isSelected?: boolean;
}

interface FullscreenScriptEditorProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  storyData: {
    segments: Beat[];
    story_metadata?: any;
  };
  selectedBeatId: string | null;
  selectedSceneId: string | null;
  loadedScenes: Scene[];
  isExpanded: Record<string, boolean>;
  isGenerating: boolean;
  isSaving: boolean;
  showSavedIndicator: boolean;
  dataTitle?: string;
  onBeatSelect: (beatId: string) => void;
  onToggleExpand: (beatId: string) => void;
  onSceneSelect: (sceneId: string) => void;
  onSceneGenerate: (sceneId: string) => void;
  onScriptSave: () => void;
  compareSceneIds: (a: string, b: string) => number;
  characters?: Character[];
  onAddCharacter?: (character: Omit<Character, "id">) => void;
  onUpdateCharacter?: (id: string, updates: Partial<Character>) => void;
  onDeleteCharacter?: (id: string) => void;
  isLightTheme?: boolean;
  onToggleTheme?: () => void;
}

// Scene component for the fullscreen sidebar
const Scene: React.FC<{
  id: string;
  title: string;
  content: string;
  isSelected: boolean;
  onSelect: () => void;
  onGenerate: () => void;
}> = ({ id, title, content, isSelected, onSelect, onGenerate }) => {
  const [isHovered, setIsHovered] = React.useState(false);

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

          {/* Content preview only shown on hover */}
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

      <Button
        size="1"
        variant="ghost"
        color="orange"
        onClick={(e) => {
          e.stopPropagation();
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

// Beat component for the fullscreen sidebar
const Beat: React.FC<{
  id: string;
  title: string;
  description: string;
  scenes: Scene[];
  isSelected: boolean;
  isExpanded: boolean;
  selectedSceneId: string | null;
  onSelect: () => void;
  onToggleExpand: () => void;
  onSceneSelect: (sceneId: string) => void;
  onSceneGenerate: (sceneId: string) => void;
  compareSceneIds: (a: string, b: string) => number;
}> = ({
  id,
  title,
  description,
  scenes,
  isSelected,
  isExpanded,
  selectedSceneId,
  onSelect,
  onToggleExpand,
  onSceneSelect,
  onSceneGenerate,
  compareSceneIds,
}) => {
    const [isHovered, setIsHovered] = React.useState(false);

    // Sort scenes by ID
    const sortedScenes = [...scenes].sort((a, b) => compareSceneIds(a.sceneId, b.sceneId));

    return (
      <Box className="beat-container">
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
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              {isExpanded ? "▲" : "▼"}
            </Button>
          </Flex>
        </Box>

        {isExpanded && sortedScenes.length > 0 && (
          <Box className="scenes-list" style={{ marginBottom: "1rem" }}>
            {sortedScenes.map((scene) => (
              <Scene
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
const FullscreenScriptEditor: React.FC<FullscreenScriptEditorProps> = ({
  isOpen,
  onClose,
  editor, // ← usamos diretamente, sem criar fullscreenEditor
  isGenerating,
  isSaving,
  showSavedIndicator,
  characters,
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  isLightTheme = false,
  onToggleTheme,
}) => {
  const [localCharacters, setLocalCharacters] = useState<Character[]>(characters || []);

  const handleAddCharacter = (character: Character) => {
    const newCharacter = { ...character, id: Date.now().toString() };
    setLocalCharacters((prev) => [...prev, newCharacter]);
    onAddCharacter?.(character);
  };

  const handleUpdateCharacter = (updatedCharacter: Character) => {
    setLocalCharacters((prev) =>
      prev.map((c) => (c.name === updatedCharacter.name ? updatedCharacter : c))
    );
    onUpdateCharacter?.(updatedCharacter.id || "", updatedCharacter);
  };

  const handleDeleteCharacter = (name: string) => {
    setLocalCharacters((prev) => prev.filter((c) => c.name !== name));
    onDeleteCharacter?.(name);
  };

  const handleToggleCharacterLock = (name: string) => {
    setLocalCharacters((prev) =>
      prev.map((c) => (c.name === name ? { ...c, locked: !c.locked } : c))
    );
  };

  useEffect(() => {
    if (characters) setLocalCharacters(characters);
  }, [characters]);

  // Foca o editor ao abrir
  useEffect(() => {
    if (isOpen && editor) {
      setTimeout(() => editor.commands.focus(), 100);
    }
  }, [isOpen, editor]);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="fullscreen-script-overlay"
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: isLightTheme ? "white" : "#2d3748",
        zIndex: 9999,
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* Editor area — mesma estrutura de classes do ScriptEditor principal */}
      <div
        className={`screenplay-source screenplay-editor-root ${isLightTheme ? "light-theme" : "screenplay-content"}`}
        style={{
          flex: 1,
          height: "100%",
          overflow: "auto",
          position: "relative",
          backgroundColor: isLightTheme ? "white" : "#2d3748",
          color: isLightTheme ? "black" : "white",
          scrollbarWidth: "thin",
          scrollbarColor: isLightTheme ? "#ccc #f5f5f5" : "#4a5568 #2d3748",
        }}
      >
        {editor && <SluglineAutoFill editor={editor} />}
        {editor && <CharacterAutoFill editor={editor} />}
        {editor && <TransitionAutoFill editor={editor} />}

        <EditorErrorBoundary>
          {editor && (
            <EditorContent
              editor={editor}
              key="fullscreen-shared-editor"
            />
          )}
        </EditorErrorBoundary>

        {isGenerating && (
          <div
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              zIndex: 100,
            }}
          >
            <TailSpin stroke="#ff6600" width={40} height={40} />
            <Text size="3" weight="medium" style={{ marginTop: "1rem" }}>
              Generating Script...
            </Text>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div
        className="screenplay-toolbar-area"
        style={{
          flexShrink: 0,
          backgroundColor: isLightTheme ? "#f5f5f5" : "#4a5568",
          borderLeft: `1px solid ${isLightTheme ? "#ddd" : "#718096"}`,
        }}
      >
        {editor && (
          <Toolbar
            editor={editor}
            onMinimize={onClose}
            isFullscreen={true}
            characters={localCharacters}
            onAddCharacter={handleAddCharacter}
            onUpdateCharacter={handleUpdateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onToggleCharacterLock={handleToggleCharacterLock}
            editorTheme={isLightTheme ? "light" : "dark"}
            onThemeToggle={onToggleTheme}
          />
        )}
      </div>

      <style>{`
        .fullscreen-script-overlay .screenplay-content-area::-webkit-scrollbar { width: 12px; }
        .fullscreen-script-overlay .screenplay-content-area::-webkit-scrollbar-track { background: ${isLightTheme ? "#f5f5f5" : "#2d3748"}; }
        .fullscreen-script-overlay .screenplay-content-area::-webkit-scrollbar-thumb { background-color: ${isLightTheme ? "#ccc" : "#4a5568"}; border-radius: 6px; border: 2px solid ${isLightTheme ? "#f5f5f5" : "#2d3748"}; }
        .fullscreen-script-overlay .screenplay-content-area::-webkit-scrollbar-thumb:hover { background-color: ${isLightTheme ? "#999" : "#718096"}; }
      `}</style>
    </div>,
    document.body
  );
};

export default FullscreenScriptEditor;
