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
/** Escape text before interpolating it into HTML. Model output is untrusted:
 *  `<img onerror>` in a generated line would otherwise execute when the HTML is
 *  parsed (even into a detached div), with full access to window.electronAPI. */
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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
          `<p data-line-type="${lineType}" style="font-family: 'Courier New', monospace; font-size: 12pt;">${escapeHtml(text)}</p>`
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
          `<p data-line-type="${pendingTag}" style="font-family: 'Courier New', monospace; font-size: 12pt;">${escapeHtml(trimmed)}</p>`
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
      `<p data-line-type="description" style="font-family: 'Courier New', monospace; font-size: 12pt;">${escapeHtml(trimmed)}</p>`
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

    // Merge new attributes with existing ones and apply. LEAVING A
    // PARENTHETICAL (Ben, 2026-09-12): the type is applied with a seeded
    // "(" and the Enter handler closes it with ")", so a line demoted back
    // to dialogue or action kept its parentheses. Strip a leading "(" and a
    // trailing ")" in the same transaction whenever the type changes away
    // from parenthetical; text that never got wrapped is left alone.
    const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attributes });
    const leaving = node.attrs.lineType === "parenthetical"
      && "lineType" in attributes && attributes.lineType !== "parenthetical";
    if (leaving) {
      const text = node.textContent;
      if (text.startsWith("(")) {
        const start = pos + 1;
        if (text.length > 1 && text.endsWith(")")) tr.delete(start + text.length - 1, start + text.length);
        tr.delete(start, start + 1);
      }
    }
    dispatch(
      tr
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

// ---------------------------------------------------------------------------
// ELEMENT APPLICATION, FINAL DRAFT SEMANTICS (Ben, 2026-09-12; verified
// against the FD10 manual). FD has two different operations:
//   - Cmd+number "adds a [X] paragraph": a NEW paragraph of that element.
//   - Cmd+Option+number "reformats the current paragraph": converts in place.
// Tab "supplements the Return key" and lands on the alternate element; on a
// blank paragraph it converts that paragraph (the manual writes Action to
// Character as "Return + Tab": Return makes a blank Action, Tab turns it into
// Character). So 'add' converts a blank line in place and otherwise inserts
// the new paragraph AFTER the current one, never splitting it at the cursor.
// ---------------------------------------------------------------------------

export const PARA_STYLE = "font-family: 'Courier New', monospace; font-size: 12pt;";

/** Seed the opening "(" on a parenthetical the way Final Draft does. */
const seedParenthetical = (editor: Editor) => {
  const { $from } = editor.view.state.selection;
  if ($from.depth === 0) return;
  const node = $from.parent;
  if (!node.textContent.trim()) {
    editor.commands.insertContent("(");
  } else if (!node.textContent.startsWith("(")) {
    editor.commands.insertContentAt($from.before() + 1, "(");
  }
};

export const applyElement = (
  editor: Editor | null,
  type: string,
  mode: "add" | "reformat",
  extraAttrs: Record<string, any> = {},
): boolean => {
  if (!editor) return false;
  try {
    const { state } = editor.view;
    const { $from } = state.selection;
    if ($from.depth === 0) return false;
    const node = $from.parent;
    const blank = node.textContent.trim() === "";

    if (mode === "reformat" || blank) {
      const ok = updateParagraphAttribute(editor, { lineType: type, ...extraAttrs });
      if (ok && type === "parenthetical") seedParenthetical(editor);
      return ok;
    }

    // Leaving a character cue for a new line beneath it: continueds first,
    // so the cue text is final before the new paragraph is placed after it.
    if (node.attrs?.lineType === "character") maybeAppendContd(editor);
    const st2 = editor.view.state;
    const $f2 = st2.selection.$from;
    const node2 = $f2.parent;
    // Add: a fresh paragraph of the element after this one, cursor inside it.
    const after = $f2.after();
    const para = st2.schema.nodes.paragraph.create({
      ...node2.attrs,
      lineType: type,
      "data-scene-id": null,
      style: PARA_STYLE,
      ...extraAttrs,
    });
    const tr = st2.tr.insert(after, para);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    editor.view.dispatch(tr.scrollIntoView());
    if (type === "parenthetical") editor.commands.insertContent("(");
    requestAnimationFrame(() => editor.commands.focus());
    return true;
  } catch (error) {
    console.warn("Error in applyElement:", error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// AUTOMATIC CHARACTER CONTINUEDS (Ben, 2026-09-12; FD10 manual, "Automatic
// Character Continueds"): the (CONT'D) text "will be placed after the
// character's name when the character's dialogue within a scene is
// interrupted by an element that is not another character's dialogue (i.e.
// an Action or General element). The character continued text is not
// inserted if a character's speech is continued from one scene to the next."
// Enabled by default in FD. Runs when the writer LEAVES a character line
// (Enter, Tab, toolbar, autofill accept): walk back from the cue; dialogue
// and parentheticals are transparent, action / general / shot / transition
// count as the interruption, a scene heading ends the search, and the first
// earlier cue decides: same name after an interruption gets (CONT'D).
// ---------------------------------------------------------------------------

const CONTD = "(CONT'D)";

/** The cue's base name: "NELL (V.O.) (CONT'D)" -> "NELL". */
const cueBaseName = (text: string): string =>
  text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

export const maybeAppendContd = (editor: Editor | null): boolean => {
  if (!editor) return false;
  try {
    const { state } = editor.view;
    const { $from } = state.selection;
    if ($from.depth === 0) return false;
    const cue = $from.parent;
    if (cue.attrs?.lineType !== "character") return false;
    const text = cue.textContent;
    if (!text.trim() || /\(\s*CONT'?D\s*\)/i.test(text)) return false;
    const me = cueBaseName(text);
    if (!me) return false;

    // Walk the document's top-level paragraphs backwards from the cue.
    const cueStart = $from.before();
    let interrupted = false;
    let verdict = false;
    const before: any[] = [];
    state.doc.forEach((node, offset) => { if (offset < cueStart) before.push(node); });
    for (let i = before.length - 1; i >= 0; i--) {
      const n = before[i];
      if (n.type.name !== "paragraph") continue;
      const lt = String(n.attrs?.lineType ?? "");
      const blank = n.textContent.trim() === "";
      if (blank) continue;
      if (lt === "scene") break;
      if (lt === "character") {
        verdict = interrupted && cueBaseName(n.textContent) === me;
        break;
      }
      if (lt === "dialogue" || lt === "parenthetical") continue;
      interrupted = true; // description, general, shot, transition
    }
    if (!verdict) return false;
    const end = $from.end();
    const sep = /\s$/.test(text) ? "" : " ";
    editor.view.dispatch(state.tr.insertText(sep + CONTD, end, end));
    return true;
  } catch (error) {
    console.warn("Error in maybeAppendContd:", error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// TITLE PAGE (element 7, 2026-09-15). Final Draft keeps the title page as a
// separate document; here it is the run of `title` paragraphs at the top of
// the script, laid out on its own sheet. So element 7 is not "add a title
// line here": it GOES to the title page, creating an empty one at the top
// when the script has none. Cmd+Alt+7 still converts the current line in
// place, for editing lines already on the page.
//
// Freeform surface: paragraphs above the first scene's head paragraph read
// as scratch, so a title page inserted at the top takes over that head's
// region tag (the import writes its title lines the same way).
// ---------------------------------------------------------------------------

export const openTitlePage = (editor: Editor | null): boolean => {
  if (!editor) return false;
  try {
    const { state } = editor.view;
    const first = state.doc.firstChild;
    if (!first) return false;
    if (first.attrs?.lineType === "title") {
      // Jump to the end of the last title line.
      let end = 0;
      let pos = 0;
      for (let i = 0; i < state.doc.childCount; i++) {
        const n = state.doc.child(i);
        if (n.attrs?.lineType !== "title") break;
        end = pos + n.nodeSize - 1;
        pos += n.nodeSize;
      }
      const tr = state.tr.setSelection(TextSelection.create(state.doc, end));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
      requestAnimationFrame(() => editor.commands.focus());
      return true;
    }
    const para = state.schema.nodes.paragraph.create({
      ...first.attrs,
      lineType: "title",
      sluglineSelected: false,
      pendingGeneration: false,
      style: PARA_STYLE,
    });
    let tr = state.tr.insert(0, para);
    if (first.attrs?.["data-scene-id"]) {
      tr = tr.setNodeMarkup(para.nodeSize, undefined, { ...first.attrs, "data-scene-id": null });
    }
    tr = tr.setSelection(TextSelection.create(tr.doc, 1));
    editor.view.dispatch(tr.scrollIntoView());
    // The toolbar click took focus; give it straight back so the writer can
    // type the title without a second click.
    editor.view.focus();
    requestAnimationFrame(() => editor.commands.focus());
    return true;
  } catch (error) {
    console.warn("Error in openTitlePage:", error);
    return false;
  }
};
