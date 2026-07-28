/**
 * CharacterAutoFill.tsx
 * =====================
 * Autocomplete dropdown for CHARACTER line types in the screenplay editor.
 *
 * Two modes on a character line:
 *   name mode — typing a name filters existing character names (all pages +
 *               DB roster, deduped, extensions stripped) and, on selection,
 *               inserts the name and auto-creates a DIALOGUE line below.
 *   ext mode  — typing "(" on a character line pops the FD voice-style
 *               extensions ((CONT'D), (V.O.), (O.S.), (O.C.), ...) filtered by
 *               what follows the "(". Selecting completes the extension and
 *               stays on the character line (Enter then advances to dialogue).
 *
 * Extension stripping matters: a cue like "MARCUS (V.O.)" must contribute the
 * name "MARCUS" only — otherwise every voiced line mints a phantom character.
 *
 * The dropdown position uses viewport-relative (fixed) coordinates so it
 * follows the cursor regardless of scroll containers.
 *
 * Imported by: ScriptEditor.tsx, FullscreenScriptEditor.tsx
 */

import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";

// FD character extensions (voice styles). Order = rough frequency.
const CUE_EXTENSIONS: string[] = [
  "(CONT'D)",
  "(V.O.)",
  "(O.S.)",
  "(O.C.)",
  "(PRE-LAP)",
  "(FILTERED)",
  "(ON PHONE)",
  "(SUBTITLED)",
];

/** Strip a trailing "(...)" extension from a cue, leaving the bare name. */
const stripExtension = (raw: string): string =>
  raw.replace(/\s*\([^)]*\)\s*$/, "").trim();

interface CharacterAutoFillProps {
  /** Active editor — used for selection tracking and content insertion. */
  editor: Editor | null;
  /** Returns every mounted page editor (cross-page name suggestions). */
  getEditors?: () => Editor[];
  /** Character names from the DB roster. */
  rosterNames?: string[];
}

type Mode = "name" | "ext";

const CharacterAutoFill = ({ editor, getEditors, rosterNames }: CharacterAutoFillProps) => {
  // ── Dropdown State ──────────────────────────────────────────
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("name");

  // ── Options ─────────────────────────────────────────────────
  const [filteredOptions, setFilteredOptions] = useState<string[]>([]);
  const [currentFilter, setCurrentFilter] = useState("");

  // ── Editor Tracking ─────────────────────────────────────────
  const [currentNodePos, setCurrentNodePos] = useState<number | null>(null);
  /** Prevents re-entrant processing during selection insertion */
  const lockRef = useRef(false);

  // Live refs so handlers read fresh sources without re-binding listeners.
  const rosterNamesRef = useRef<string[]>(rosterNames ?? []);
  useEffect(() => {
    rosterNamesRef.current = rosterNames ?? [];
  }, [rosterNames]);
  const getEditorsRef = useRef<typeof getEditors>(getEditors);
  useEffect(() => {
    getEditorsRef.current = getEditors;
  }, [getEditors]);
  // Mode read inside document-level handlers.
  const modeRef = useRef<Mode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /**
   * Collect character names from every page editor and the DB roster, deduped
   * by uppercase form with any (extension) stripped.
   */
  const findCharacterNames = (): string[] => {
    const characters = new Set<string>();
    const editors = getEditorsRef.current?.() ?? (editor ? [editor] : []);
    for (const ed of editors) {
      ed.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.attrs.lineType === "character") {
          const name = stripExtension(node.textContent);
          if (name) characters.add(name.toUpperCase());
        }
        return true;
      });
    }
    for (const r of rosterNamesRef.current) {
      const trimmed = stripExtension(r ?? "");
      if (trimmed) characters.add(trimmed.toUpperCase());
    }
    return Array.from(characters).sort();
  };

  /** Prefix filter, excluding exact matches. */
  const filterNames = (allNames: string[], filter: string): string[] => {
    if (!filter) return allNames;
    const lowerFilter = filter.toLowerCase();
    return allNames.filter((name) => {
      const lowerName = name.toLowerCase();
      return lowerName.startsWith(lowerFilter) && lowerName !== lowerFilter;
    });
  };

  /** Filter cue extensions by the text typed after "(" (match inner text). */
  const filterExtensions = (filter: string): string[] => {
    if (!filter) return CUE_EXTENSIONS;
    const lower = filter.toLowerCase();
    return CUE_EXTENSIONS.filter((opt) =>
      opt.slice(1).toLowerCase().startsWith(lower)
    );
  };

  const updateDropdownPosition = () => {
    if (!editor) return;
    const { state } = editor.view;
    const { $from } = state.selection;
    try {
      const coords = editor.view.coordsAtPos($from.pos);
      setDropdownPos({ top: coords.bottom + 5, left: coords.left });
    } catch {
      /* coordsAtPos can throw if out of range */
    }
  };

  /** Detect an unclosed "(" at the tail of the line → extension mode. */
  const openExtension = (text: string): { open: boolean; filter: string } => {
    const openIdx = text.lastIndexOf("(");
    if (openIdx < 0) return { open: false, filter: "" };
    if (text.indexOf(")", openIdx) !== -1) return { open: false, filter: "" };
    return { open: true, filter: text.slice(openIdx + 1) };
  };

  const processNodeState = () => {
    if (!editor || lockRef.current) return;

    const { state } = editor.view;
    const { selection } = state;

    if (selection.empty && selection.$from.depth === 0) {
      setShowDropdown(false);
      return;
    }

    const { $from } = selection;
    const node = $from.parent;
    if (!node || $from.depth === 0) {
      setShowDropdown(false);
      return;
    }

    let pos: number | null = null;
    try {
      pos = $from.before();
    } catch {
      setShowDropdown(false);
      return;
    }
    if (pos !== currentNodePos) setCurrentNodePos(pos);

    if (node.attrs.lineType !== "character") {
      setShowDropdown(false);
      return;
    }

    const text = node.textContent;
    const ext = openExtension(text);

    if (ext.open) {
      // Extension mode: pop the voice styles.
      if (ext.filter === currentFilter && mode === "ext" && showDropdown) return;
      setMode("ext");
      setCurrentFilter(ext.filter);
      const opts = filterExtensions(ext.filter);
      if (opts.length > 0) {
        setFilteredOptions(opts);
        setActiveIndex(0);
        setShowDropdown(true);
        updateDropdownPosition();
      } else {
        setShowDropdown(false);
      }
      return;
    }

    // Name mode.
    const filter = text.trim();
    if (filter === currentFilter && mode === "name") return;
    setMode("name");
    setCurrentFilter(filter);
    const filtered = filterNames(findCharacterNames(), filter);
    if (filtered.length > 0) {
      setFilteredOptions(filtered);
      setActiveIndex(0);
      setShowDropdown(true);
      updateDropdownPosition();
    } else {
      setShowDropdown(false);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentNodePos, currentFilter, mode]);

  useEffect(() => {
    if (!editor || !showDropdown) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % filteredOptions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
          break;
        case "Tab":
        case "Enter":
          if (filteredOptions.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            if (modeRef.current === "ext") selectExtension(filteredOptions[activeIndex]);
            else selectName(filteredOptions[activeIndex]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown, filteredOptions, activeIndex, editor]);

  /** Insert a character name and auto-create a DIALOGUE line below. */
  const selectName = (name: string) => {
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
      editor.chain().insertContent(name).focus().run();
      setShowDropdown(false);
      setTimeout(() => {
        try {
          const { $from: $f } = editor.view.state.selection;
          if ($f.depth > 0) {
            const pos = $f.after();
            editor
              .chain()
              .insertContentAt(pos, { type: "paragraph", attrs: { lineType: "dialogue" } })
              .focus()
              .run();
          }
        } catch (error) {
          console.log("Error creating dialogue line:", error);
        }
      }, 10);
    } catch (error) {
      console.log("Error in selectName:", error);
    }
    setTimeout(() => {
      lockRef.current = false;
    }, 50);
  };

  /** Complete a voice-style extension, staying on the character line. */
  const selectExtension = (option: string) => {
    if (!editor) return;
    lockRef.current = true;
    try {
      const { $from } = editor.view.state.selection;
      const node = $from.parent;
      const text = node.textContent;
      const openIdx = text.lastIndexOf("(");
      if (openIdx >= 0) {
        const start = $from.start() + openIdx;
        const end = $from.start() + text.length;
        // Ensure a single space separates the name and the extension.
        const needsSpace = openIdx > 0 && text[openIdx - 1] !== " ";
        editor
          .chain()
          .setTextSelection({ from: start, to: end })
          .deleteSelection()
          .insertContent((needsSpace ? " " : "") + option + " ")
          .focus()
          .run();
      }
      setShowDropdown(false);
    } catch (error) {
      console.log("Error in selectExtension:", error);
    }
    setTimeout(() => {
      lockRef.current = false;
    }, 50);
  };

  // ── Render ──────────────────────────────────────────────────
  if (!showDropdown || filteredOptions.length === 0) return null;

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
        maxHeight: "220px",
        overflowY: "auto",
        fontFamily: "Courier New, monospace",
        fontSize: "12pt",
      }}
    >
      {filteredOptions.map((option, index) => (
        <div
          key={option}
          className={`character-option ${index === activeIndex ? "active" : ""}`}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            backgroundColor: index === activeIndex ? "rgba(255, 102, 0, 0.1)" : "transparent",
            fontFamily: "Courier New, monospace",
            fontSize: "12pt",
            borderBottom: index < filteredOptions.length - 1 ? "1px solid #eee" : "none",
            color: "#000000",
          }}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => (mode === "ext" ? selectExtension(option) : selectName(option))}
        >
          {option}
        </div>
      ))}
    </div>
  );
};

export default CharacterAutoFill;
