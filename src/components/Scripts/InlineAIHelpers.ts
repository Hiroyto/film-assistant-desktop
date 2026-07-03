/**
 * inlineAIHelpers.ts
 * ==================
 * Pure utility functions for extracting selection context from the TipTap editor.
 * Used by useInlineAI and useGuidedGeneration hooks to build API payloads.
 *
 * FIL-315: Fixed nodesBetween boundary checks in getSelectedTaggedText and
 * getSelectedLineType to prevent adjacent paragraphs from bleeding into
 * the selection payload.
 *
 * Imported by: useInlineAI.ts, useGuidedGeneration.ts, ScriptEditor.tsx
 */

import { Editor } from "@tiptap/react";

// ─────────────────────────────────────────────
// Tag Mapping
// ─────────────────────────────────────────────

/** Map internal lineType attr values to the tagged format the backend expects */
const LINE_TYPE_TO_TAG: Record<string, string> = {
  scene: "SC",
  description: "AC",
  character: "CH",
  dialogue: "DL",
  parenthetical: "PA",
  transition: "TR",
};

/**
 * Convert a lineType attribute value to its backend tag string.
 * Falls back to "AC" (action/description) for unknown types.
 */
export const lineTypeToTag = (lineType: string): string => {
  return LINE_TYPE_TO_TAG[lineType] || "AC";
};

// ─────────────────────────────────────────────
// Selection Context Extraction
// ─────────────────────────────────────────────

/**
 * Extract the selected text in tagged format ([<SC>]: ..., [<DL>]: ..., etc.)
 *
 * Walks the ProseMirror document between the selection boundaries,
 * collecting each block node's text with its line type tag prepended.
 *
 * FIL-315: Uses pos parameter to check that each node's content range
 * actually overlaps the selection — nodesBetween can return nodes that
 * merely touch the boundary, which causes adjacent paragraphs to bleed
 * into the payload.
 */
export function getSelectedTaggedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  const lines: string[] = [];

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.textContent) {
      // Content lives between pos+1 (after opening token) and pos+nodeSize-1 (before closing token)
      const contentStart = pos + 1;
      const contentEnd = pos + node.nodeSize - 1;
      // Skip nodes whose content is entirely outside the selection
      if (contentEnd <= from || contentStart >= to) return;

      const lineType = node.attrs.lineType || "description";
      const tag = lineTypeToTag(lineType);
      lines.push(`[<${tag}>]: ${node.textContent}`);
    }
  });

  return lines.join("\n");
}

/**
 * Determine the line type of the current selection.
 *
 * If the selection spans a single line type, returns that type's tag
 * (e.g., "DL", "AC"). If it spans multiple types, returns "mixed".
 *
 * FIL-315: Same boundary check as getSelectedTaggedText.
 */
export function getSelectedLineType(editor: Editor): string {
  const { from, to } = editor.state.selection;
  const types = new Set<string>();

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.textContent) {
      const contentStart = pos + 1;
      const contentEnd = pos + node.nodeSize - 1;
      if (contentEnd <= from || contentStart >= to) return;

      const lineType = node.attrs.lineType || "description";
      types.add(lineTypeToTag(lineType));
    }
  });

  if (types.size === 0) return "AC";
  if (types.size === 1) return Array.from(types)[0];
  return "mixed";
}

/**
 * Find the speaking character for a dialogue selection.
 *
 * Walks backwards from the selection start position, looking for the
 * nearest paragraph with lineType="character". This is how screenplays
 * work: the character name appears above their dialogue.
 *
 * Returns null if no character line is found before the selection.
 */
export function findSpeakingCharacter(
  editor: Editor,
  from: number
): string | null {
  let found: string | null = null;

  editor.state.doc.nodesBetween(0, from, (node) => {
    if (
      node.isBlock &&
      node.attrs.lineType === "character" &&
      node.textContent.trim()
    ) {
      found = node.textContent.trim();
    }
  });

  return found;
}

/**
 * Get the scene ID (data-scene-id) from the paragraph at a given position.
 */
export function getSceneIdAtPosition(
  editor: Editor,
  pos: number
): string | null {
  try {
    const resolved = editor.state.doc.resolve(pos);
    if (resolved.depth === 0) return null;
    const node = resolved.parent;
    return node.attrs["data-scene-id"] || null;
  } catch {
    return null;
  }
}

/**
 * Get the scene ID for the current selection's start position.
 */
export function getSceneIdFromSelection(editor: Editor): string | null {
  const { from } = editor.state.selection;
  return getSceneIdAtPosition(editor, from);
}

/**
 * Collect all content for a given scene ID in tagged format.
 *
 * Walks the entire document, collecting paragraphs whose data-scene-id
 * matches the provided sceneId.
 */
export function getRawSceneContent(
  editor: Editor,
  sceneId: string
): string {
  const lines: string[] = [];

  editor.state.doc.descendants((node) => {
    if (
      node.isBlock &&
      node.attrs["data-scene-id"] === sceneId &&
      node.textContent
    ) {
      const tag = lineTypeToTag(node.attrs.lineType || "description");
      lines.push(`[<${tag}>]: ${node.textContent}`);
    }
  });

  return lines.join("\n");
}

/**
 * Check whether the editor currently has a non-empty text selection.
 */
export function hasTextSelection(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  return from !== to;
}

/**
 * Get viewport-relative coordinates for positioning a floating toolbar
 * near the current selection.
 */
export function getSelectionCoords(
  editor: Editor
): { top: number; left: number; bottom: number } | null {
  try {
    const { from, to } = editor.state.selection;
    if (from === to) return null;

    const startCoords = editor.view.coordsAtPos(from);
    const endCoords = editor.view.coordsAtPos(to);

    return {
      top: startCoords.top,
      left: startCoords.left,
      bottom: endCoords.bottom,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the current selection spans paragraphs with different scene IDs.
 * Used to block revise/suggest operations that would cross scene boundaries,
 * which would corrupt scene ID assignments on the replaced content.
 */
export function selectionSpansMultipleScenes(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;

  const sceneIds = new Set<string>();

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.textContent) {
      const contentStart = pos + 1;
      const contentEnd = pos + node.nodeSize - 1;
      if (contentEnd <= from || contentStart >= to) return;

      const sceneId = node.attrs["data-scene-id"];
      if (sceneId) sceneIds.add(sceneId);
    }
  });

  return sceneIds.size > 1;
}