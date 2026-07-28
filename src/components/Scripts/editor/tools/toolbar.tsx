import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  AlignLeft,
  Type,
  Save,
  Maximize2,
  Minimize2,
  Sun,
  Moon,
} from "lucide-react";
import { Editor } from "@tiptap/react";
import CharacterPanel from "../../../characters-home/CharacterPanel";

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

interface ToolbarProps {
  editor: Editor | null;
  onFullscreen?: () => void;
  onMinimize?: () => void;
  isFullscreen?: boolean;
  editorTheme?: "dark" | "light";
  onThemeToggle?: () => void;
  /** Called when the user clicks Save or presses Ctrl+S */
  onSave?: () => void;
  characters?: Character[];
  onAddCharacter?: (character: Character) => void;
  onUpdateCharacter?: (character: Character) => void;
  onDeleteCharacter?: (name: string) => void;
  onToggleCharacterLock?: (name: string) => void;
}

const updateParagraphAttribute = (
  editor: Editor | null,
  attributes: Record<string, any>
): boolean => {
  if (!editor) return false;
  try {
    const { state, dispatch } = editor.view;
    const { $from } = state.selection;
    if ($from.depth === 0) return false;
    const pos = $from.before();
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== "paragraph") return false;
    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attributes }));
    requestAnimationFrame(() => editor.commands.focus());
    return true;
  } catch (error) {
    console.warn("Error in updateParagraphAttribute:", error);
    return false;
  }
};

const getActiveLineType = (editor: Editor | null): string | null => {
  if (!editor) return null;
  try {
    const { $from } = editor.state.selection;
    if ($from.depth === 0) return null;
    const node = $from.parent;
    if (node.type.name !== "paragraph") return null;
    return node.attrs?.lineType ?? node.attrs?.["data-line-type"] ?? null;
  } catch {
    return null;
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
  editorTheme = "dark",
  onThemeToggle,
  onSave,
  characters = [],
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onToggleCharacterLock,
}) => {
  const [showCharacterPanel, setShowCharacterPanel] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement>(null);

  const activeLineType = getActiveLineType(editor);

  // FD element order — matches the Cmd/Ctrl+1..6 direct shortcuts:
  //   1 slugline · 2 action · 3 character · 4 parenthetical · 5 dialogue · 6 transition
  const formatOptions: FormatOption[] = [
    { type: "scene", label: "slugline", icon: <FileText size={14} /> },
    { type: "description", label: "action", icon: <AlignLeft size={14} /> },
    { type: "character", label: "character", icon: <Type size={14} /> },
    { type: "parenthetical", label: "parenthetical", icon: <Type size={14} /> },
    { type: "dialogue", label: "dialogue", icon: <Type size={14} /> },
    { type: "transition", label: "transition", icon: <AlignLeft size={14} /> },
  ];

  const applyFormat = (type: string) => {
    if (!editor) return;
    try {
      const { $from } = editor.view.state.selection;
      if ($from.depth === 0) editor.commands.setTextSelection(1);

      const success = updateParagraphAttribute(editor, { lineType: type });

      if (type === "parenthetical" && success) {
        const { $from: $f } = editor.view.state.selection;
        if ($f.depth > 0) {
          const node = $f.parent;
          if (!node.textContent.trim()) {
            editor.commands.insertContent("(");
          } else if (!node.textContent.startsWith("(")) {
            editor.commands.insertContentAt($f.before() + 1, "(");
          }
        }
      }

      editor.view.updateState(editor.view.state);
      requestAnimationFrame(() => editor.commands.focus());
    } catch (error) {
      console.warn("Error in toolbar button click:", error);
    }
  };

  // ── Ctrl+K opens palette; number keys 1–6 apply format; Escape closes ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        return;
      }

      if (!paletteOpen) return;

      if (e.key === "Escape") {
        setPaletteOpen(false);
        editor?.commands.focus();
        return;
      }

      const index = parseInt(e.key, 10);
      if (!isNaN(index) && index >= 1 && index <= formatOptions.length) {
        e.preventDefault();
        applyFormat(formatOptions[index - 1].type);
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen, editor]);

  // Close palette on outside click
  useEffect(() => {
    if (!paletteOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setPaletteOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [paletteOpen]);

  // ── Early return AFTER all hooks ─────────────────────────────────────────
  if (!editor) return null;

  return (
    <>
      <div className="screenplay-toolbar">
        <div className="toolbar-group">
          {formatOptions.map(({ type, label }, index) => {
            const isActive = activeLineType === type;
            return (
              <div
                key={type}
                className={`toolbar-button${isActive ? " active" : ""}`}
                onClick={() => applyFormat(type)}
                title={`${label} (Ctrl+K, ${index + 1})`}
                style={isActive ? { opacity: 1, fontWeight: 600 } : { opacity: 0.6 }}
              >
                <span style={{ fontSize: 12 }}>{label}</span>
              </div>
            );
          })}

          {/* Ctrl+K hint badge */}
          <div
            className="toolbar-button"
            onClick={() => setPaletteOpen(p => !p)}
            title="Format palette (Ctrl+K)"
            style={{ opacity: 0.4, fontSize: 11, letterSpacing: "0.05em" }}
          >
            <span style={{ fontSize: 11 }}>⌘K</span>
          </div>
        </div>

        <div className="toolbar-group-end">
          <div
            className={`toolbar-button${editorTheme === "light" ? " active" : ""}`}
            onClick={onThemeToggle}
            title={`Switch to ${editorTheme === "dark" ? "Light" : "Dark"} Theme`}
          >
            {editorTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </div>

          {isFullscreen
            ? onMinimize && (
              <div className="toolbar-button" onClick={onMinimize} title="Exit Fullscreen">
                <Minimize2 size={18} />
              </div>
            )
            : onFullscreen && (
              <div className="toolbar-button" onClick={onFullscreen} title="Enter Fullscreen">
                <Maximize2 size={18} />
              </div>
            )}

          <div
            className="toolbar-button"
            onClick={onSave}
            title="Save Script (Ctrl+S)"
          >
            <Save size={18} />
          </div>
        </div>
      </div>

      {/* ── Format Palette (Ctrl+K) ── */}
      {paletteOpen && (
        <div
          ref={paletteRef}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1000,
            background: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "8px 0",
            minWidth: 260,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{
            padding: "4px 16px 10px",
            fontSize: 11,
            color: "rgba(255,255,255,0.35)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            marginBottom: 4,
          }}>
            Format — press number to apply
          </div>

          {formatOptions.map(({ type, label, icon }, index) => {
            const isActive = activeLineType === type;
            return (
              <div
                key={type}
                onClick={() => { applyFormat(type); setPaletteOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 16px",
                  cursor: "pointer",
                  background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.65)",
                  transition: "background 0.1s",
                  fontSize: 13,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = isActive ? "rgba(255,255,255,0.08)" : "transparent")}
              >
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.1)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  flexShrink: 0,
                }}>
                  {index + 1}
                </span>
                <span style={{ opacity: 0.5, flexShrink: 0 }}>{icon}</span>
                <span style={{ flex: 1, fontFamily: "'Courier New', monospace" }}>
                  {label}
                </span>
                {isActive && (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                    active
                  </span>
                )}
              </div>
            );
          })}

          <div style={{
            padding: "8px 16px 4px",
            fontSize: 11,
            color: "rgba(255,255,255,0.2)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            marginTop: 4,
          }}>
            Esc to close · Ctrl+K to toggle
          </div>
        </div>
      )}

      <CharacterPanel
        isOpen={showCharacterPanel}
        onClose={() => setShowCharacterPanel(false)}
      />
    </>
  );
};

export default Toolbar;