/**
 * editor/index.ts
 * ===============
 * Barrel export for the editor module.
 *
 * Re-exports extensions so they can be imported as:
 *   import { ScreenwritingParagraph, KeyboardShortcuts, SafeSelection } from "./editor";
 */

export {
    ScreenwritingParagraph,
    KeyboardShortcuts,
    SafeSelection,
    type ScreenwritingLineType,
  } from "./extensions";