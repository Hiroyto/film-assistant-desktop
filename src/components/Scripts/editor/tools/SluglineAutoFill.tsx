import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";

const SLUGLINE_OPTIONS: string[] = ["INT.", "EXT.", "INT./EXT.", "EXT./INT."];
const TIME_OPTIONS: string[] = [
  "NIGHT",
  "DAY",
  "MORNING",
  "THAT MOMENT",
  "EVENING",
];

type StageType = "none" | "location" | "time" | "completed";

const SluglineAutoFill = ({ editor }: { editor: Editor | null }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [options, setOptions] = useState<string[]>(SLUGLINE_OPTIONS);
  const [filteredOptions, setFilteredOptions] = useState<string[]>(SLUGLINE_OPTIONS);
  // Use viewport-relative (fixed) coordinates so the dropdown follows the
  // cursor regardless of how many scroll containers exist above the editor.
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentNodePos, setCurrentNodePos] = useState<number | null>(null);
  const [currentStage, setCurrentStage] = useState<StageType>("none");
  const lockRef = useRef(false);
  const [currentFilter, setCurrentFilter] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [previewOption, setPreviewOption] = useState("");
  const [previewPos, setPreviewPos] = useState({ top: 0, left: 0 });
  const [isPositionSet, setIsPositionSet] = useState(false);

  const analyzeNodeContent = (node: any) => {
    if (!node) return { stage: "none" as StageType, filter: "" };

    const text = node.textContent || "";
    const hasFullLocation = SLUGLINE_OPTIONS.some((opt) => text.includes(opt + " "));
    const hasDash = text.includes(" - ");
    const hasTime = TIME_OPTIONS.some((opt) => text.includes(opt));

    if (hasTime) return { stage: "completed" as StageType, filter: "" };
    if (hasFullLocation && hasDash) {
      const afterDash = text.split(" - ")[1] || "";
      return { stage: "time" as StageType, filter: afterDash.trim() };
    }
    if (hasFullLocation) return { stage: "location" as StageType, filter: "" };
    return { stage: "none" as StageType, filter: text.trim() };
  };

  const filterOptions = (allOptions: string[], filter: string) => {
    if (!filter) return allOptions;
    const lowerFilter = filter.toLowerCase();
    return allOptions.filter((option) => option.toLowerCase().startsWith(lowerFilter));
  };

  /**
   * updateDropdownPosition
   *
   * Uses editor.view.coordsAtPos() which returns coordinates in the
   * VIEWPORT coordinate space (same as getBoundingClientRect).
   * We then render the dropdown with position:fixed at those coordinates
   * so it always appears at the cursor regardless of scroll containers.
   */
  const updateDropdownPosition = () => {
    if (!editor) return;

    const { state } = editor.view;
    const { $from } = state.selection;

    try {
      const coords = editor.view.coordsAtPos($from.pos);
      // coords.bottom is the bottom of the current line in viewport px.
      // Add a small gap (4px) so the dropdown sits just below the cursor line.
      setDropdownPos({
        top: coords.bottom + 4,
        left: coords.left,
      });
    } catch {
      // coordsAtPos can throw if the position is out of range
    }
  };

  const updatePreview = () => {
    setShowPreview(false);
  };

  const processNodeState = () => {
    if (!editor || lockRef.current) return;

    const { state } = editor.view;
    const { $from } = state.selection;
    const node = $from.parent;
    const pos = $from.before();

    if (pos !== currentNodePos) {
      setCurrentNodePos(pos);
      const { stage, filter } = analyzeNodeContent(node);
      setCurrentStage(stage);
      setCurrentFilter(filter);
      setShowPreview(false);
    }

    if (node.attrs.lineType !== "scene") {
      setShowDropdown(false);
      setShowPreview(false);
      return;
    }

    const { stage, filter } = analyzeNodeContent(node);

    if (filter !== currentFilter) setCurrentFilter(filter);
    if (stage !== currentStage) {
      setCurrentStage(stage);
      setShowPreview(false);
    }

    switch (stage) {
      case "none": {
        const locationFiltered = filterOptions(SLUGLINE_OPTIONS, filter);
        if (locationFiltered.length > 0) {
          setOptions(SLUGLINE_OPTIONS);
          setFilteredOptions(locationFiltered);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
        } else {
          setShowDropdown(false);
          setShowPreview(false);
        }
        break;
      }
      case "location":
        setShowDropdown(false);
        setShowPreview(false);
        break;

      case "time": {
        const timeFiltered = filterOptions(TIME_OPTIONS, filter);
        if (timeFiltered.length > 0) {
          setOptions(TIME_OPTIONS);
          setFilteredOptions(timeFiltered);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
        } else {
          setShowDropdown(false);
          setShowPreview(false);
        }
        break;
      }
      case "completed":
        setShowDropdown(false);
        setShowPreview(false);
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
  }, [editor, currentNodePos, currentStage, currentFilter]);

  useEffect(() => {
    updatePreview();
  }, [activeIndex, filteredOptions]);

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const { state } = editor.view;
      const { $from } = state.selection;
      const node = $from.parent;

      if (node.attrs.lineType !== "scene") return;

      const { stage } = analyzeNodeContent(node);

      if (stage === "none" && showDropdown && filteredOptions.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        lockRef.current = true;

        if (currentFilter) {
          const endPos = $from.pos;
          const startPos = endPos - currentFilter.length;
          editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
        }

        handleSelect(filteredOptions[activeIndex]);
        setTimeout(() => { setCurrentStage("location"); lockRef.current = false; }, 50);
        return;
      }

      if (stage === "location" && !showDropdown) {
        event.preventDefault();
        event.stopPropagation();
        lockRef.current = true;

        editor.chain().insertContent(" - ").focus().run();

        setTimeout(() => {
          setCurrentStage("time");
          setOptions(TIME_OPTIONS);
          setFilteredOptions(TIME_OPTIONS);
          setActiveIndex(0);
          setShowDropdown(true);
          updateDropdownPosition();
          lockRef.current = false;
        }, 50);
        return;
      }

      if (stage === "time" && showDropdown && filteredOptions.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        lockRef.current = true;

        if (currentFilter) {
          const dashPos = node.textContent.indexOf(" - ") + 3;
          const startPos = $from.start() + dashPos;
          const endPos = startPos + currentFilter.length;
          editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
        }

        handleSelect(filteredOptions[activeIndex]);
        setTimeout(() => { setCurrentStage("completed"); lockRef.current = false; }, 50);
        return;
      }
    };

    editor.view.dom.addEventListener("keydown", handleKeyDown, true);
    return () => editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
  }, [editor, showDropdown, filteredOptions, activeIndex, currentStage, currentFilter]);

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
            lockRef.current = true;

            const { state } = editor.view;
            const { $from } = state.selection;
            const node = $from.parent;

            if (currentFilter && currentStage === "none") {
              const endPos = $from.pos;
              const startPos = endPos - currentFilter.length;
              editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
            } else if (currentFilter && currentStage === "time") {
              const dashPos = node.textContent.indexOf(" - ") + 3;
              const startPos = $from.start() + dashPos;
              const endPos = startPos + currentFilter.length;
              editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
            }

            handleSelect(filteredOptions[activeIndex]);
            setTimeout(() => {
              const nextStage = currentStage === "none" ? "location" : "completed";
              setCurrentStage(nextStage);
              lockRef.current = false;
            }, 50);
          }
          break;
        case "Escape":
          e.preventDefault();
          setShowDropdown(false);
          setShowPreview(false);
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [showDropdown, filteredOptions, activeIndex, editor, currentStage, currentFilter]);

  const handleSelect = (option: string) => {
    if (!editor) return;
    editor.chain().insertContent(option + " ").focus().run();
    setShowDropdown(false);
    setShowPreview(false);
  };

  return (
    <>
      {showDropdown && filteredOptions.length > 0 && (
        <div
          className="slugline-dropdown"
          style={{
            // Fixed positioning uses viewport coordinates directly from
            // coordsAtPos — no container offset calculation needed.
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 99999,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: "4px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            color: "#000000",
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
              onClick={() => {
                if (!editor) return;
                lockRef.current = true;

                const { state } = editor.view;
                const { $from } = state.selection;

                if (currentFilter && currentStage === "none") {
                  const endPos = $from.pos;
                  const startPos = endPos - currentFilter.length;
                  editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
                } else if (currentFilter && currentStage === "time") {
                  const node = $from.parent;
                  const dashPos = node.textContent.indexOf(" - ") + 3;
                  const startPos = $from.start() + dashPos;
                  const endPos = startPos + currentFilter.length;
                  editor.chain().setTextSelection({ from: startPos, to: endPos }).deleteSelection().run();
                }

                handleSelect(option);
                setTimeout(() => {
                  const nextStage = currentStage === "none" ? "location" : "completed";
                  setCurrentStage(nextStage);
                  lockRef.current = false;
                }, 50);
              }}
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