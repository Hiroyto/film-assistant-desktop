/**
 * SafeSelection.ts
 * ================
 * TipTap extension that overrides the default selectAll command.
 *
 * ProseMirror's built-in selectAll can throw a RangeError:
 *   "There is no position before the top-level node"
 *
 * This happens when the selection tries to include document-level
 * boundaries. This extension replaces selectAll with a safe version
 * that selects from position 1 to (docSize - 1), staying within
 * the content area.
 *
 * Works in conjunction with the Cmd+A handler in KeyboardShortcuts.ts
 * and the DOM keydown interceptor in ScriptEditor.tsx.
 */

import { Extension } from "@tiptap/core";
import { safeSelect } from "../../editorUtils";

const SafeSelection = Extension.create({
  name: "safeSelection",

  addCommands() {
    return {
      selectAll:
        () =>
        ({ editor }) => {
          safeSelect(editor);
          return true;
        },
    };
  },
});

export default SafeSelection;