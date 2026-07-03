/**
 * editor/extensions/index.ts
 * ==========================
 * Barrel export for all custom TipTap extensions.
 *
 * Import all extensions from this single entry point:
 *   import {
 *     ScreenwritingParagraph,
 *     KeyboardShortcuts,
 *     SafeSelection,
 *   } from "./editor/extensions";
 *
 * Note: SceneTracking is NOT a separate extension — the data-scene-id
 * attribute is already defined on ScreenwritingParagraph in ScreenwritingLine.ts.
 */

export { ScreenwritingParagraph, type ScreenwritingLineType } from "./Screenwritingline";
export { default as KeyboardShortcuts } from "./KeyboardShortcuts";
export { default as SafeSelection } from "./SafeSelection";