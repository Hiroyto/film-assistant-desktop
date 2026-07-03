// selectionUtils.ts
//
// Shared text selection utilities for the screenplay editor.
// Used by SelectionPopup.tsx and ScriptEditor.tsx.

import { Editor } from "@tiptap/react";

/**
 * Snap selection boundaries to full word edges.
 *
 * If the selection starts or ends in the middle of a word,
 * expand outward to include the full word. Also trims
 * leading/trailing whitespace from the selection.
 *
 * Lifted from SegmentContentBlock's snapToWordBoundaries,
 * adapted for ProseMirror doc positions.
 */
export function snapToWordBoundaries(
  editor: Editor,
  from: number,
  to: number
): { from: number; to: number } {
  const doc = editor.state.doc;
  const docSize = doc.content.size;
  const isWordChar = (char: string) => /\w/.test(char);

  const getCharAt = (pos: number): string => {
    if (pos < 0 || pos >= docSize) return "";
    try {
      return doc.textBetween(pos, Math.min(pos + 1, docSize)) || "";
    } catch {
      return "";
    }
  };

  let snappedFrom = from;
  let snappedTo = to;

  // Snap start: if splitting a word, walk backward
  const charBeforeFrom = getCharAt(snappedFrom - 1);
  const charAtFrom = getCharAt(snappedFrom);
  if (charBeforeFrom && charAtFrom && isWordChar(charBeforeFrom) && isWordChar(charAtFrom)) {
    while (snappedFrom > 0 && isWordChar(getCharAt(snappedFrom - 1))) {
      snappedFrom--;
    }
  }

  // Snap end: if splitting a word, walk forward
  const charBeforeTo = getCharAt(snappedTo - 1);
  const charAtTo = getCharAt(snappedTo);
  if (charBeforeTo && charAtTo && isWordChar(charBeforeTo) && isWordChar(charAtTo)) {
    while (snappedTo < docSize && isWordChar(getCharAt(snappedTo))) {
      snappedTo++;
    }
  }

  // Trim leading whitespace
  while (snappedFrom < snappedTo) {
    const ch = getCharAt(snappedFrom);
    if (ch === " " || ch === "\n" || ch === "\t") snappedFrom++;
    else break;
  }

  // Trim trailing whitespace
  while (snappedTo > snappedFrom) {
    const ch = getCharAt(snappedTo - 1);
    if (ch === " " || ch === "\n" || ch === "\t") snappedTo--;
    else break;
  }

  return { from: snappedFrom, to: snappedTo };
}