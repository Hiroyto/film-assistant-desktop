/**
 * editorUtils.ts
 * ==============
 * Pure utility functions for the screenplay editor.
 *
 * This file contains all the helper functions that were previously
 * defined inline in scripts.tsx. They handle:
 *
 *   - Scene ID parsing and ordering (for inserting scenes in correct order)
 *   - Tagged content → HTML conversion (for AI-generated screenplay text)
 *   - Safe editor operations (attribute updates, selection, insertion)
 *
 * None of these functions use React state or hooks — they operate
 * directly on TipTap Editor instances or plain data.
 *
 * Imported by: ScriptEditor.tsx, useSceneGeneration.ts, extensions/KeyboardShortcuts.ts
 */

import { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

// ─────────────────────────────────────────────
// Scene ID Parsing & Ordering
// ─────────────────────────────────────────────

/**
 * Parse a scene ID string into its numeric components.
 *
 * Scene IDs follow the format "S{beat}.{scene}" — e.g., "S2.3" means
 * Beat 2, Scene 3. This function extracts those numbers for sorting.
 *
 * @example
 *   parseSceneId("S2.3") → { beatNumber: 2, sceneNumber: 3 }
 *   parseSceneId("invalid") → { beatNumber: 0, sceneNumber: 0 }
 */
export const parseSceneId = (
  sceneId: string
): { beatNumber: number; sceneNumber: number } => {
  const match = sceneId.match(/S(\d+)\.(\d+)/);
  if (match) {
    return {
      beatNumber: parseInt(match[1], 10),
      sceneNumber: parseInt(match[2], 10),
    };
  }
  return { beatNumber: 0, sceneNumber: 0 };
};

/**
 * Compare two scene IDs for sorting.
 *
 * Sorts first by beat number, then by scene number within the same beat.
 * Returns negative if `a` comes before `b`, positive if after, 0 if equal.
 *
 * @example
 *   compareSceneIds("S1.2", "S1.3") → -1 (S1.2 comes first)
 *   compareSceneIds("S2.1", "S1.5") → 1  (S2.1 comes after S1.5)
 */
export const compareSceneIds = (a: string, b: string): number => {
  const aComponents = parseSceneId(a);
  const bComponents = parseSceneId(b);

  if (aComponents.beatNumber !== bComponents.beatNumber) {
    return aComponents.beatNumber - bComponents.beatNumber;
  }
  return aComponents.sceneNumber - bComponents.sceneNumber;
};

// ─────────────────────────────────────────────
// Content Conversion
// ─────────────────────────────────────────────

/**
 * Convert AI-generated tagged content into TipTap-compatible HTML.
 *
 * The scene generation Lambda returns screenplay text with line-type tags.
 * This function handles multiple output formats from different AI models:
 *
 * Format A (colon, same line — preferred, enforced by one-shot in writer prompt):
 *   [<SC>]: INT. COFFEE SHOP - DAY
 *   [<AC>]: Sarah enters nervously.
 *
 * Format B (no colon, content on next line — Gemini/Sonnet sometimes do this):
 *   [<SC>]
 *   INT. COFFEE SHOP - DAY
 *   [<AC>]
 *   Sarah enters nervously.
 *
 * Format C (no colon, same line):
 *   [<SC>] INT. COFFEE SHOP - DAY
 *
 * Empty lines between tag blocks are stripped — the ScreenwritingParagraph
 * extension handles visual spacing via CSS margins on data-line-type.
 *
 * @param content - Raw tagged content from the AI generation response
 * @returns HTML string ready to insert into the TipTap editor
 */
export const convertTaggedContentToHTML = (content: string): string => {
  /** Map of tag codes to their corresponding screenplay line types */
  const tagToLineType: Record<string, string> = {
    "SC": "scene",
    "AC": "description",
    "CH": "character",
    "DL": "dialogue",
    "PA": "parenthetical",
    "TR": "transition",
  };

  const lines = content.split("\n");
  const convertedLines: string[] = [];
  let pendingTag: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Try to match a tag (with or without colon): [<SC>]: content  OR  [<SC>] content  OR  [<SC>]
    const tagMatch = trimmed.match(/^\[<(\w+)>\]:?\s*(.*)/);

    if (tagMatch) {
      const tag = tagMatch[1];
      const text = tagMatch[2].trim();
      const lineType = tagToLineType[tag] || "description";

      if (text) {
        // Tag and content on the same line — ideal format
        convertedLines.push(
          `<p data-line-type="${lineType}" style="font-family: 'Courier New', monospace; font-size: 12pt;">${text}</p>`
        );
        pendingTag = null;
      } else {
        // Tag alone on this line — content is on the next line
        pendingTag = lineType;
      }
      continue;
    }

    // If we have a pending tag from the previous line, apply it to this line's content
    if (pendingTag !== null) {
      if (trimmed === "") {
        // Empty line after a tag — reset pending, skip the line
        pendingTag = null;
        continue;
      } else {
        convertedLines.push(
          `<p data-line-type="${pendingTag}" style="font-family: 'Courier New', monospace; font-size: 12pt;">${trimmed}</p>`
        );
        pendingTag = null;
      }
      continue;
    }

    // Skip empty lines — the editor handles spacing via line-type CSS styles
    if (trimmed === "") {
      continue;
    }

    // Plain text defaults to description
    convertedLines.push(
      `<p data-line-type="description" style="font-family: 'Courier New', monospace; font-size: 12pt;">${trimmed}</p>`
    );
  }

  // If file ends with a pending tag, flush it as empty
  if (pendingTag !== null) {
    convertedLines.push(
      `<p data-line-type="${pendingTag}" style="font-family: 'Courier New', monospace; font-size: 12pt;"></p>`
    );
  }

  return convertedLines.join("\n");
};

// ─────────────────────────────────────────────
// Editor Attribute Updates
// ─────────────────────────────────────────────

/**
 * Safely update attributes on the paragraph node at the current cursor position.
 *
 * This is the core function behind keyboard shortcuts like Tab (→ character),
 * Shift+Tab (→ dialogue), and Cmd+Shift+S (→ scene heading). It modifies
 * the ProseMirror node markup without disrupting the document structure.
 *
 * @param editor - TipTap editor instance
 * @param attributes - Key-value pairs to merge into the paragraph's attributes
 * @returns true if the update succeeded, false if it couldn't be applied
 *
 * @example
 *   // Convert current line to a character name
 *   updateParagraphAttribute(editor, { lineType: "character" });
 */
export const updateParagraphAttribute = (
  editor: Editor | null,
  attributes: Record<string, any>
): boolean => {
  if (!editor) return false;

  try {
    const { state, dispatch } = editor.view;
    const { $from } = state.selection;

    // Safety: depth 0 means we're at the document root, not inside a paragraph
    if ($from.depth === 0) {
      return false;
    }

    const pos = $from.before();
    const node = state.doc.nodeAt(pos);

    // Only apply to paragraph nodes — prevents corrupting other node types
    if (!node || node.type.name !== "paragraph") {
      console.warn(
        `Cannot apply paragraph attributes to node type: ${
          node?.type.name || "unknown"
        }`
      );
      return false;
    }

    // Merge new attributes with existing ones and apply
    dispatch(
      state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attributes })
    );

    // Re-focus after attribute change to keep cursor in place
    requestAnimationFrame(() => editor.commands.focus());
    return true;
  } catch (error) {
    console.warn("Error in updateParagraphAttribute:", error);
    return false;
  }
};

// ─────────────────────────────────────────────
// Safe Selection & Navigation
// ─────────────────────────────────────────────

/**
 * Select all content in the editor without hitting document-level errors.
 *
 * The default ProseMirror selectAll can throw "no position before top-level node"
 * errors. This version safely selects from position 1 to end-1, avoiding
 * the document boundaries.
 *
 * Used by: Cmd+A keyboard shortcut, SafeSelection extension
 */
export const safeSelect = (editor: Editor | null): void => {
  if (!editor) return;

  try {
    const { state } = editor.view;
    const firstPos = 1;
    const lastPos = state.doc.content.size - 1;
    editor.commands.setTextSelection({ from: firstPos, to: lastPos });
  } catch (error) {
    console.warn("Error in safeSelect:", error);
  }
};

/**
 * Safely move focus to a specific position in the editor.
 *
 * Clamps the position to valid document bounds and uses a slight delay
 * to ensure the DOM has updated before focusing.
 *
 * @param editor - TipTap editor instance
 * @param pos - Desired cursor position (will be clamped to valid range)
 * @returns true if focus was initiated, false on error
 */
export const safeFocus = (editor: Editor, pos: number): boolean => {
  try {
    if (!editor) return false;

    const docSize = editor.state.doc.content.size;
    const safePos = Math.max(0, Math.min(pos, docSize));

    setTimeout(() => {
      try {
        editor.chain().focus().setTextSelection(safePos).run();
      } catch (focusError) {
        console.error("Error in delayed focus:", focusError);
      }
    }, 50);

    return true;
  } catch (error) {
    console.error("Error in safeFocus:", error);
    return false;
  }
};

// ─────────────────────────────────────────────
// Safe Content Insertion & Replacement
// ─────────────────────────────────────────────

/**
 * Safely insert HTML content at a specific position in the editor.
 *
 * Clamps the position to valid document bounds before inserting.
 *
 * @param editor - TipTap editor instance
 * @param pos - Position to insert at (will be clamped)
 * @param content - HTML string to insert
 * @returns true if insertion succeeded
 */
export const safeInsertContent = (
  editor: Editor,
  pos: number,
  content: string
): boolean => {
  try {
    if (!editor) return false;

    const docSize = editor.state.doc.content.size;
    const safePos = Math.max(0, Math.min(pos, docSize));

    editor.chain().focus().insertContentAt(safePos, content).run();
    return true;
  } catch (error) {
    console.error("Error in safeInsertContent:", error);
    return false;
  }
};

/**
 * Safely replace content between two positions in the editor.
 *
 * Clamps both positions to valid document bounds, deletes the range,
 * then inserts new content at the start position.
 *
 * @param editor - TipTap editor instance
 * @param from - Start of range to replace (will be clamped)
 * @param to - End of range to replace (will be clamped)
 * @param content - HTML string to insert as replacement
 * @returns true if replacement succeeded
 */
export const safeReplaceContent = (
  editor: Editor,
  from: number,
  to: number,
  content: string
): boolean => {
  try {
    if (!editor) return false;

    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.max(0, Math.min(from, docSize));
    const safeTo = Math.max(safeFrom, Math.min(to, docSize));

    editor
      .chain()
      .deleteRange({ from: safeFrom, to: safeTo })
      .insertContentAt(safeFrom, content)
      .run();

    return true;
  } catch (error) {
    console.error("Error in safeReplaceContent:", error);
    return false;
  }
};

// ─────────────────────────────────────────────
// Scene Position & Ordering in the Document
// ─────────────────────────────────────────────

/**
 * Find the correct document position to insert a new scene, maintaining order.
 *
 * Walks through the editor document looking for existing scene markers
 * (paragraphs with `data-scene-id` attributes). Compares the new scene's ID
 * against existing ones to find where it should be inserted.
 *
 * If no existing scene has a higher ID, the new scene goes at the end.
 *
 * @param editor - TipTap editor instance
 * @param newSceneId - ID of the scene to insert (e.g., "S1.2")
 * @returns Document position where the scene should be inserted
 *
 * @example
 *   // Document has S1.1 and S1.3 — find where to put S1.2
 *   const pos = findCorrectInsertionPosition(editor, "S1.2");
 *   // Returns the position just before S1.3
 */
export const findCorrectInsertionPosition = (
  editor: Editor,
  newSceneId: string
): number => {
  if (!editor) return 0;

  let insertPosition = editor.state.doc.content.size; // Default: end of document
  let foundCorrectPosition = false;

  editor.state.doc.descendants((node, pos) => {
    if (foundCorrectPosition) return false; // Stop once we've found it

    if (node.type.name === "paragraph" && node.attrs["data-scene-id"]) {
      const existingSceneId = node.attrs["data-scene-id"];
      const comparison = compareSceneIds(newSceneId, existingSceneId);

      if (comparison < 0) {
        // New scene should come before this existing scene
        insertPosition = pos;
        foundCorrectPosition = true;
        return false;
      }
    }
    return true; // Keep looking
  });

  return insertPosition;
};

/**
 * Insert generated scene content at the correct ordered position in the editor.
 *
 * This is the main function called after scene generation completes.
 * It finds the right position (using findCorrectInsertionPosition),
 * inserts the content, adds spacing if needed, and updates scene tracking.
 *
 * @param editor - TipTap editor instance
 * @param content - HTML content to insert (already converted from tagged format)
 * @param sceneId - Scene ID for ordering (e.g., "S2.1")
 * @param onUpdatePositions - Callback to refresh scene position tracking after insertion
 */
export const insertSceneInOrder = (
  editor: Editor | null,
  content: string,
  sceneId: string,
  onUpdatePositions?: (editor: Editor) => void
): void => {
  if (!editor) return;

  try {
    const insertPosition = findCorrectInsertionPosition(editor, sceneId);

    console.log(`Inserting scene ${sceneId} at position:`, insertPosition);

    // Insert the content at the calculated position
    editor.commands.insertContentAt(insertPosition, content);

    // Add spacing after inserted content (if not at document end)
    setTimeout(() => {
      try {
        const currentDocSize = editor.state.doc.content.size;

        if (insertPosition < currentDocSize - content.length) {
          const endPosition = Math.min(
            insertPosition + content.length,
            currentDocSize - 1
          );

          editor.commands.insertContentAt(endPosition, {
            type: "paragraph",
            attrs: {
              lineType: "description",
              style:
                "font-family: 'Courier New', monospace; font-size: 12pt;",
            },
          });
        }
      } catch (spacingError) {
        // Non-critical — just log and continue
        console.warn(
          "Could not add spacing after scene insertion:",
          spacingError
        );
      }
    }, 200);

    console.log(`Scene ${sceneId} inserted successfully`);

    // Refresh scene position tracking
    if (onUpdatePositions) {
      setTimeout(() => {
        try {
          onUpdatePositions(editor);
        } catch (posError) {
          console.error("Error updating scene positions:", posError);
        }
      }, 400);
    }
  } catch (error) {
    console.error("Error in insertSceneInOrder:", error);
  }
};

// ─────────────────────────────────────────────
// Scene Content Extraction
// ─────────────────────────────────────────────

/**
 * Extract text content from a range of positions in the editor document.
 *
 * Used by scene position tracking to store a reference copy of each
 * scene's content. Clamps positions to valid document bounds.
 *
 * @param editor - TipTap editor instance
 * @param start - Start position in the document
 * @param end - End position in the document
 * @returns Plain text content between the two positions
 */
export const getSceneContent = (
  editor: Editor,
  start: number,
  end: number
): string => {
  try {
    const { state } = editor.view;
    const safeStart = Math.max(0, Math.min(start, state.doc.content.size));
    const safeEnd = Math.max(safeStart, Math.min(end, state.doc.content.size));

    if (safeStart < safeEnd) {
      return state.doc.textBetween(safeStart, safeEnd, " ");
    }
    return "";
  } catch (error) {
    console.error("Error in getSceneContent:", error);
    return "";
  }
};

// ─────────────────────────────────────────────
// General Utilities
// ─────────────────────────────────────────────

/**
 * Create a debounced version of a function.
 *
 * Used to prevent excessive scene position recalculations during rapid
 * typing. The debounced function will only execute after the specified
 * delay has passed since the last invocation.
 *
 * @param func - Function to debounce
 * @param waitFor - Delay in milliseconds
 * @returns Debounced version of the function
 */
export const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
): ((...args: Parameters<F>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<F>): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };
};