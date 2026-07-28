/**
 * SluglineAutoFill.tsx
 * ====================
 * Staged autocomplete for SCENE HEADING (slugline) lines.
 *
 * A slugline is filled in three stages, Tab/Enter advancing each:
 *   none      → INT. / EXT. / INT./EXT. / EXT./INT.
 *   location  → locations already used in the script (+ optional graph list),
 *               then Tab inserts " - " and moves to time
 *   time      → DAY / NIGHT / CONTINUOUS / MOMENTS LATER / ... (expanded)
 *   completed → nothing
 *
 * Stage detection is END-ANCHORED against the text after " - " so multi-word
 * times ("THE NEXT DAY", "MOMENTS LATER") no longer false-trip completion the
 * way a naive `includes("DAY")` did.
 *
 * Imported by: ScriptEditor.tsx, FullscreenScriptEditor.tsx
 */

import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";

const SLUGLINE_OPTIONS: string[] = ["INT.", "EXT.", "INT./EXT.", "EXT./INT."];

// Time-of-day options (expanded to industry-standard set). DAY/NIGHT first —
// the two most common. Kept UPPERCASE; matching is case-insensitive.
const TIME_OPTIONS: string[] = [
  "DAY",
  "NIGHT",
  "CONTINUOUS",
  "LATER",
  "MOMENTS LATER",
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "DUSK",
  "DAWN",
  "SUNRISE",
  "SUNSET",
  "MAGIC HOUR",
  "SAME TIME",
  "THAT MOMENT",
  "THE NEXT DAY",
];

// Prefixes we recognise when peeling a location out of an existing slugline,
// longest first so "INT./EXT." wins over "INT.".
const PREFIX_MATCHERS = ["INT./EXT.", "EXT./INT.", "INT.", "EXT.", "EST.", "I/E", "INT", "EXT"].sort(
  (a, b) => b.length - a.length
);

type StageType = "none" | "location" | "time" | "completed";

interface SluglineAutoFillProps {
  editor: Editor | null;
  /** Returns every page editor so locations from any page suggest everywhere. */
  getEditors?: () => Editor[];
  /** Optional location names from the story graph (suggest before first use). */
  locationNames?: string[];
}

const SluglineAutoFill = ({ editor, getEditors, locationNames }: SluglineAutoFillProps) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>(SLUGLINE_OPTIONS);
  // Use viewport-relative (fixed) coordinates so the dropdown follows the
  // cursor regardless of how many scroll containers exist above the editor.
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentNodePos, setCurrentNodePos] = useState<number | null>(null);
  const [currentStage, setCurrentStage] = useState<StageType>("none");
  const lockRef = useRef(false);
  const [currentFilter, setCurrentFilter] = useState("");

  // Refs so event handlers read the freshest sources without re-binding.
  const getEditorsRef = useRef<typeof getEditors>(getEditors);
  useEffect(() => {
    getEditorsRef.current = getEditors;
  }, [getEditors]);
  const locationNamesRef = useRef<string[]>(locationNames ?? []);
  useEffect(() => {
    locationNamesRef.current = locationNames ?? [];
  }, [locationNames]);

  /** Peel the location substring out of a slugline's text, if any. */
  const locationFromSlug = (text: string): string | null => {
    const up = text.toUpperCase();
    let rest = text;
    for (const p of PREFIX_MATCHERS) {
      if (up.startsWith(p)) {
        rest = text.slice(p.length);
        break;
      }
    }
    rest = rest.replace(/^[\s.\-]+/, "");
    const loc = rest.split(" - ")[0].trim();
    return loc || null;
  };

  /** Collect location names from every page's sluglines + the graph list. */
  const findLocationNames = (): string[] => {
    const locations = new Set<string>();
    const editors = getEditorsRef.current?.() ?? (editor ? [editor] : []);
    for (const ed of editors) {
      ed.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.attrs.lineType === "scene") {
          const loc = locationFromSlug(node.textContent);
          if (loc) locations.add(loc.toUpperCase());
        }
        return true;
      });
    }
    for (const l of locationNamesRef.current) {
      const trimmed = l?.trim();
      if (trimmed) locations.add(trimmed.toUpperCase());
    }
    return Array.from(locations).sort();
  };

  const analyzeNodeContent = (node: any): { stage: StageType; filter: string } => {
    if (!node) return { stage: "none", filter: "" };
    const text = node.textContent || "";
    const up = text.toUpperCase();

    // Which slug prefix (if any) does the line start with?
    const prefix = SLUGLINE_OPTIONS.find((opt) => up.startsWith(opt));
    if (!prefix) return { stage: "none", filter: text.trim() };

    const rest = text.slice(prefix.length);
    if (rest.includes(" - ")) {
      // TIME stage: everything after the FIRST " - " is the time filter.
      const afterDash = rest.slice(rest.indexOf(" - ") + 3);
      const done = TIME_OPTIONS.some(
        (o) => o.toLowerCase() === afterDash.trim().toLowerCase()
      );
      return done
        ? { stage: "completed", filter: "" }
        : { stage: "time", filter: afterDash.replace(/^\s+/, "") };
    }

    // LOCATION stage: the text between the prefix and any " - ".
    return { stage: "location", filter: rest.replace(/^\s+/, "") };
  };

  const filterOptions = (allOptions: string[], filter: string) => {
    if (!filter) return allOptions;
    const lowerFilter = filter.toLowerCase();
    return allOptions.filter(
      (option) =>
        option.toLowerCase().startsWith(lowerFilter) &&
        option.toLowerCase() !== lowerFilter
    );
  };

  /**
   * updateDropdownPosition
   *
   * Uses editor.view.coordsAtPos() (viewport coordinate space) and renders the
   * dropdown position:fixed at those coordinates so it always sits at the
   * cursor regardless of scroll containers.
   */
  const updateDropdownPosition = () => {
    if (!editor) return;
    const { state } = editor.view;
    const { $from } = state.selection;
    try {
      const coords = editor.view.coordsAtPos($from.pos);
      setDropdownPos({ top: coords.bottom + 4, left: coords.left });
    } catch {
      // coordsAtPos can throw if the position is out of range
    }
  };

  const processNodeState = () => {
    if (!editor || lockRef.current) return;

    const { state } = editor.view;
    const { $from } = state.selection;
    const node = $from.parent;
    const pos = $from.before();

    if (pos !== currentNodePos) {
      setCurrentNodePos(pos);
    }

    if (node.attrs.lineType !== "scene") {
      setShowDropdown(false);
      return;
    }

    const { stage, filter } = analyzeNodeContent(node);
    if (filter !== currentFilter) setCurrentFilter(filter);
    if (stage !== currentStage) setCurrentStage(stage);

    switch (stage) {
      case "none": {
        const locationFiltered = filterOptions(SLUGLINE_OPTIONS, filter);
        // Show INT./EXT. options while nothing (or a prefix fragment) is typed.
        const opts = filter ? locationFiltered : SLUGLINE_OPTIONS;
        if (opts.length > 0) {
          setFilteredOptions(opts);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
        } else {
          setShowDropdown(false);
        }
        break;
      }

      case "location": {
        const locFiltered = filterOptions(findLocationNames(), filter);
        if (locFiltered.length > 0) {
          setFilteredOptions(locFiltered);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
        } else {
          setShowDropdown(false);
        }
        break;
      }

      case "time": {
        const timeFiltered = filter
          ? filterOptions(TIME_OPTIONS, filter)
          : TIME_OPTIONS;
        if (timeFiltered.length > 0) {
          setFilteredOptions(timeFiltered);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
        } else {
          setShowDropdown(false);
        }
        break;
      }

      case "completed":
        setShowDropdown(false);
        break;
    }
  };

  useEffect(() => {
    if (!editor) return;
    const updateHandler = () => {
      processNodeState();
      updateDropdownPosition();
    };
    editor.on("update", updateHandler);
    editor.on("selectionUpdate", updateHandler);
    processNodeState();
    return () => {
      editor.off("update", updateHandler);
      editor.off("selectionUpdate", updateHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentNodePos, currentStage, currentFilter]);

  // Replace the currently-typed filter text with a chosen option.
  const replaceFilter = (option: string) => {
    if (!editor) return;
    const { state } = editor.view;
    const { $from } = state.selection;
    const node = $from.parent;

    if (currentStage === "none" && currentFilter) {
      const endPos = $from.pos;
      const startPos = endPos - currentFilter.length;
      editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
    } else if (currentStage === "location" && currentFilter) {
      const endPos = $from.pos;
      const startPos = endPos - currentFilter.length;
      editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
    } else if (currentStage === "time" && currentFilter) {
      const dashPos = node.textContent.indexOf(" - ") + 3;
      const startPos = $from.start() + dashPos;
      const endPos = startPos + currentFilter.length;
      editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
    }
  };

  // Commit an option for the current stage and advance the stage machine.
  const commitOption = (option: string) => {
    if (!editor) return;
    lockRef.current = true;
    replaceFilter(option);

    if (currentStage === "none") {
      // Insert "INT. " and move to location.
      editor.chain().insertContent(option + " ").focus().run();
      setShowDropdown(false);
      setTimeout(() => {
        setCurrentStage("location");
        lockRef.current = false;
      }, 50);
    } else if (currentStage === "location") {
      // Insert the location then " - " and move to time.
      editor.chain().insertContent(option + " - ").focus().run();
      setShowDropdown(false);
      setTimeout(() => {
        setCurrentStage("time");
        setFilteredOptions(TIME_OPTIONS);
        setActiveIndex(0);
        setShowDropdown(true);
        updateDropdownPosition();
        lockRef.current = false;
      }, 50);
    } else {
      // Time: complete the slugline.
      editor.chain().insertContent(option + " ").focus().run();
      setShowDropdown(false);
      setTimeout(() => {
        setCurrentStage("completed");
        lockRef.current = false;
      }, 50);
    }
  };

  // Tab drives the stage machine even when no dropdown is showing (e.g. the
  // location stage with a typed-in name and no suggestion → still inserts " - ").
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const { state } = editor.view;
      const { $from } = state.selection;
      const node = $from.parent;
      if (node.attrs.lineType !== "scene") return;

      const { stage } = analyzeNodeContent(node);

      // none / location / time WITH a dropdown suggestion → pick it + advance.
      if (
        (stage === "none" || stage === "location" || stage === "time") &&
        showDropdown &&
        filteredOptions.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        commitOption(filteredOptions[activeIndex]);
        return;
      }

      // location stage, no suggestion → insert " - " and go to time.
      if (stage === "location" && !showDropdown) {
        event.preventDefault();
        event.stopPropagation();
        lockRef.current = true;
        editor.chain().insertContent(" - ").focus().run();
        setTimeout(() => {
          setCurrentStage("time");
          setFilteredOptions(TIME_OPTIONS);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
          lockRef.current = false;
        }, 50);
        return;
      }
    };

    editor.view.dom.addEventListener("keydown", handleKeyDown, true);
    return () => editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, showDropdown, filteredOptions, activeIndex, currentStage, currentFilter]);

  // Arrow/Enter/Escape while the dropdown is open.
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
        case "Enter":
          if (showDropdown && filteredOptions.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            commitOption(filteredOptions[activeIndex]);
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
  }, [showDropdown, filteredOptions, activeIndex, editor, currentStage, currentFilter]);

  return (
    <>
      {showDropdown && filteredOptions.length > 0 && (
        <div
          className="slugline-dropdown"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 99999,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: "4px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            color: "#000000",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {filteredOptions.map((option, index) => (
            <div
              key={option}
              className={`slugline-option ${index === activeIndex ? "active" : ""}`}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                backgroundColor: index === activeIndex ? "#e6f7ff" : "transparent",
                fontFamily: "Courier, monospace",
                color: "#000000",
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commitOption(option)}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default SluglineAutoFill;
