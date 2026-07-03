/**
 * CharacterAutoFill.tsx
 * =====================
 * Autocomplete dropdown for CHARACTER line types in the screenplay editor.
 *
 * When the user is typing on a CHARACTER line, this component:
 *   1. Collects existing character names from every page editor + the
 *      character DB roster (case-insensitively deduped)
 *   2. Filters them against what the user is typing
 *   3. Shows a dropdown with matching names
 *   4. On selection (Tab/Enter/click), inserts the name and auto-creates
 *      a DIALOGUE line below it
 *
 * The dropdown position uses viewport-relative (fixed) coordinates so it
 * follows the cursor regardless of scroll containers.
 *
 * Suggestion sources:
 *   - getEditors():   walks every paginated page so a name typed on page 1
 *                     still autocompletes on page 4
 *   - rosterNames:    the character DB roster, so canonical characters
 *                     suggest even before they've been used in the script
 *   Both are merged and deduped by uppercase form to avoid showing the
 *   same character twice when casing differs between sources.
 *
 * Persistence: this component does NOT persist new names. The save path
 * is responsible for reconciling script characters with the DB roster.
 *
 * Keyboard shortcuts:
 *   - ArrowDown/ArrowUp: Navigate options
 *   - Tab/Enter: Select highlighted option
 *   - Escape: Dismiss dropdown
 *
 * Imported by: ScriptEditor.tsx
 */

import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";

interface CharacterAutoFillProps {
  /** Active editor — used for selection tracking and content insertion. */
  editor: Editor | null;
  /**
   * Returns every mounted page editor. Used so character names from pages
   * other than the focused one still appear as suggestions. Falls back to
   * just `editor` when not provided (single-page mode).
   */
  getEditors?: () => Editor[];
  /**
   * Character names from the DB roster. Merged into suggestions so roster
   * entries appear even before they've been typed into the script.
   */
  rosterNames?: string[];
}

const CharacterAutoFill = ({ editor, getEditors, rosterNames }: CharacterAutoFillProps) => {
  // ── Dropdown State ──────────────────────────────────────────
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);

  // ── Character Data ──────────────────────────────────────────
  const [characterNames, setCharacterNames] = useState<string[]>([]);
  const [filteredNames, setFilteredNames] = useState<string[]>([]);
  const [currentFilter, setCurrentFilter] = useState("");

  // ── Editor Tracking ─────────────────────────────────────────
  const [currentNodePos, setCurrentNodePos] = useState<number | null>(null);
  /** Prevents re-entrant processing during selection insertion */
  const lockRef = useRef(false);

  // ── Helpers ─────────────────────────────────────────────────

  // Roster + getEditors held in refs so we can read the freshest values
  // inside event handlers without re-binding TipTap listeners on every
  // render. Updating refs is harmless; updating useEffect deps would churn.
  const rosterNamesRef = useRef<string[]>(rosterNames ?? []);
  useEffect(() => {
    rosterNamesRef.current = rosterNames ?? [];
  }, [rosterNames]);

  const getEditorsRef = useRef<typeof getEditors>(getEditors);
  useEffect(() => {
    getEditorsRef.current = getEditors;
  }, [getEditors]);

  /**
   * Collect character names from every page editor and the DB roster,
   * deduped by uppercase form. Names are returned uppercased so the
   * dropdown displays them in screenplay-conventional casing regardless
   * of how the roster stored them.
   */
  const findCharacterNames = (): string[] => {
    const characters = new Set<string>();

    const editors = getEditorsRef.current?.() ?? (editor ? [editor] : []);
    for (const ed of editors) {
      ed.state.doc.descendants((node) => {
        if (
          node.type.name === "paragraph" &&
          node.attrs.lineType === "character"
        ) {
          const name = node.textContent.trim();
          if (name) characters.add(name.toUpperCase());
        }
        return true;
      });
    }

    for (const r of rosterNamesRef.current) {
      const trimmed = r?.trim();
      if (trimmed) characters.add(trimmed.toUpperCase());
    }

    return Array.from(characters).sort();
  };

  /**
   * Filter character names by prefix match, excluding exact matches
   * (no point suggesting what the user already typed in full).
   */
  const filterNames = (allNames: string[], filter: string): string[] => {
    if (!filter) return allNames;

    const lowerFilter = filter.toLowerCase();
    return allNames.filter((name) => {
      const lowerName = name.toLowerCase();
      return lowerName.startsWith(lowerFilter) && lowerName !== lowerFilter;
    });
  };

  const updateDropdownPosition = () => {
    if (!editor) return;

    const { state } = editor.view;
    const { $from } = state.selection;

    try {
      const coords = editor.view.coordsAtPos($from.pos);
      setDropdownPos({
        top: coords.bottom + 5,
        left: coords.left,
      });
    } catch {
    }
  };

  // ── Core Logic ──────────────────────────────────────────────

  /**
   * Main update handler — called on every editor update and selection change.
   *
   * Determines whether we're on a CHARACTER line, extracts the current
   * text as a filter, and shows/hides the dropdown accordingly.
   */
  const processNodeState = () => {
    if (!editor || lockRef.current) return;

    const { state } = editor.view;
    const { selection } = state;

    // Document-level selection (e.g. Cmd+A) — hide dropdown
    if (selection.empty && selection.$from.depth === 0) {
      setShowDropdown(false);
      return;
    }

    const { $from } = selection;
    const node = $from.parent;

    // Safety: ensure valid position and parent node
    if (!node || $from.depth === 0) {
      setShowDropdown(false);
      return;
    }

    // Get node position safely
    let pos: number | null = null;
    try {
      pos = $from.before();
    } catch {
      setShowDropdown(false);
      return;
    }

    // Moved to a different node — reset tracking state
    if (pos !== currentNodePos) {
      setCurrentNodePos(pos);
      setCurrentFilter("");
      setCharacterNames(findCharacterNames());
    }

    // Not a character line — nothing to autocomplete
    if (node.attrs.lineType !== "character") {
      setShowDropdown(false);
      return;
    }

    // Use current text as filter
    const filter = node.textContent.trim();
    if (filter === currentFilter) return;
    setCurrentFilter(filter);

    // Refresh and filter names
    const names = findCharacterNames();
    setCharacterNames(names);
    const filtered = filterNames(names, filter);

    if (filtered.length > 0) {
      setFilteredNames(filtered);
      setActiveIndex(0);
      setShowDropdown(true);
      updateDropdownPosition();
    } else {
      setShowDropdown(false);
    }
  };

  // ── Effects ─────────────────────────────────────────────────

  /** Subscribe to editor updates and selection changes */
  useEffect(() => {
    if (!editor) return;

    const updateHandler = () => {
      try {
        processNodeState();
        updateDropdownPosition();
      } catch (error) {
        setShowDropdown(false);
        console.log("Error in CharacterAutoFill:", error);
      }
    };

    editor.on("update", updateHandler);
    editor.on("selectionUpdate", updateHandler);
    processNodeState();

    return () => {
      editor.off("update", updateHandler);
      editor.off("selectionUpdate", updateHandler);
    };
  }, [editor, currentNodePos, currentFilter]);

  /** Keyboard navigation when dropdown is visible */
  useEffect(() => {
    if (!editor || !showDropdown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % filteredNames.length);
          break;

        case "ArrowUp":
          e.preventDefault();
          setActiveIndex(
            (prev) => (prev - 1 + filteredNames.length) % filteredNames.length
          );
          break;

        case "Tab":
        case "Enter":
          if (filteredNames.length > 0) {
            e.preventDefault();
            lockRef.current = true;

            try {
              const { $from } = editor.view.state.selection;
              if ($from.depth > 0) {
                editor
                  .chain()
                  .setTextSelection({ from: $from.start(), to: $from.end() })
                  .deleteSelection()
                  .run();
              }
              handleSelect(filteredNames[activeIndex]);
            } catch (error) {
              console.log("Error handling selection:", error);
            }

            setTimeout(() => {
              lockRef.current = false;
            }, 50);
          }
          break;

        case "Escape":
          e.preventDefault();
          setShowDropdown(false);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [showDropdown, filteredNames, activeIndex, editor]);

  // ── Selection Handler ───────────────────────────────────────

  /**
   * Insert the selected character name and auto-create a DIALOGUE line below.
   *
   * Flow: clear current text → insert name → wait 10ms → insert dialogue paragraph
   */
  const handleSelect = (name: string) => {
    if (!editor) return;

    editor.chain().insertContent(name).focus().run();
    setShowDropdown(false);

    // Auto-advance to dialogue line after character name insertion
    setTimeout(() => {
      try {
        const { $from } = editor.view.state.selection;
        if ($from.depth > 0) {
          const pos = $from.after();
          editor
            .chain()
            .insertContentAt(pos, {
              type: "paragraph",
              attrs: { lineType: "dialogue" },
            })
            .focus()
            .run();
        }
      } catch (error) {
        console.log("Error creating dialogue line:", error);
      }
    }, 10);
  };

  // ── Render ──────────────────────────────────────────────────

  if (!showDropdown || filteredNames.length === 0) return null;

  return (
    <div
      className="character-dropdown"
      style={{
        position: "fixed",
        top: dropdownPos.top,
        left: dropdownPos.left,
        zIndex: 99999,
        background: "white",
        border: "1px solid #ccc",
        borderRadius: "4px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        minWidth: "200px",
        maxHeight: "200px",
        overflowY: "auto",
        fontFamily: "Courier New, monospace",
        fontSize: "12pt",
      }}
    >
      {filteredNames.map((name, index) => (
        <div
          key={name}
          className={`character-option ${index === activeIndex ? "active" : ""}`}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            backgroundColor:
              index === activeIndex
                ? "rgba(255, 102, 0, 0.1)"
                : "transparent",
            fontFamily: "Courier New, monospace",
            fontSize: "12pt",
            borderBottom:
              index < filteredNames.length - 1 ? "1px solid #eee" : "none",
            color: "#000000",
          }}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => {
            if (!editor) return;
            lockRef.current = true;

            try {
              const { $from } = editor.view.state.selection;
              if ($from.depth > 0) {
                editor
                  .chain()
                  .setTextSelection({ from: $from.start(), to: $from.end() })
                  .deleteSelection()
                  .run();
              }
              handleSelect(name);
            } catch (error) {
              console.log("Error in click handler:", error);
            }

            setTimeout(() => {
              lockRef.current = false;
            }, 50);
          }}
        >
          {name}
        </div>
      ))}
    </div>
  );
};

export default CharacterAutoFill;