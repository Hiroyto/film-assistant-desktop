/**
 * KeyboardShortcuts.ts
 * ====================
 * TipTap extension that defines all screenplay-specific keyboard shortcuts.
 *
 * This extension handles the core screenwriting workflow where pressing
 * specific keys changes the current line's type and creates new lines
 * with the appropriate type for what typically comes next.
 *
 * Shortcut Reference:
 *   Tab           → Convert current line to CHARACTER
 *   Shift+Tab     → Convert current line to DIALOGUE
 *   Cmd+Shift+S   → Convert current line to SCENE HEADING (with auto scene ID extraction)
 *   Cmd+P         → Convert current line to PARENTHETICAL (auto-adds opening paren)
 *   Enter         → Split paragraph with smart line type transitions:
 *                      character → dialogue
 *                      dialogue → description
 *                      parenthetical → dialogue (auto-closes paren first)
 *                      everything else → description
 *   Shift+Enter   → Same transitions as Enter, but inserts new paragraph after current
 *   Backspace     → Handles empty line deletion, maintains minimum one line
 *   Cmd+A         → Safe select-all that avoids document boundary errors
 *
 * Dependencies:
 *   - editorUtils.ts: updateParagraphAttribute(), safeSelect()
 *   - ScreenwritingParagraph: provides the `lineType` attribute on paragraphs
 */

import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { updateParagraphAttribute, safeSelect } from "../../editorUtils";
import { ScreenwritingLineType } from "../../types";

const KeyboardShortcuts = Extension.create({
  name: "keyboardShortcuts",

  addKeyboardShortcuts() {
    return {
      // ── Select All (safe version) ──────────────────────────────
      "Mod-a": ({ editor }) => {
        try {
          const { state } = editor.view;
          const firstPos = 1;
          const lastPos = state.doc.content.size - 1;

          if (firstPos < lastPos) {
            editor.commands.setTextSelection({ from: firstPos, to: lastPos });
          }
          return true;
        } catch (error) {
          console.warn("Error in Mod-a handler:", error);
          return false;
        }
      },

      // ── Tab → CHARACTER line type ──────────────────────────────
      Tab: ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;
          updateParagraphAttribute(editor, { lineType: "character" });
          return true;
        } catch (error) {
          console.warn("Error in Tab handler:", error);
          return false;
        }
      },

      // ── Shift+Tab → DIALOGUE line type ─────────────────────────
      "Shift-Tab": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;
          updateParagraphAttribute(editor, { lineType: "dialogue" });
          return true;
        } catch (error) {
          console.warn("Error in Shift-Tab handler:", error);
          return false;
        }
      },

      // ── Cmd+Shift+S → SCENE HEADING with auto scene ID extraction ─
      // If the line contains text like "S1.2", it extracts the ID,
      // stores it as a data attribute, and removes it from the visible text.
      "Mod-Shift-s": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const node = $from.parent;
          const text = node.textContent;

          // Look for a scene ID pattern like "S1.2" or "s3.1"
          const sceneIdMatch = text.match(/\b([sS]\d+\.\d+)\b/);
          let sceneId = null;
          let cleanText = text;

          if (sceneIdMatch) {
            sceneId = sceneIdMatch[1].toLowerCase();
            cleanText = text.replace(/\s*\b[sS]\d+\.\d+\b\s*/, "").trim();
          }

          const attributes: Record<string, any> = { lineType: "scene" };
          if (sceneId) {
            attributes["data-scene-id"] = sceneId;
          }

          updateParagraphAttribute(editor, attributes);

          // Remove the scene ID from visible text if it was extracted
          if (sceneId && cleanText !== text) {
            setTimeout(() => {
              const pos = $from.before() + 1;
              const nodeSize = node.nodeSize - 2;
              editor.commands.deleteRange({ from: pos, to: pos + nodeSize });
              editor.commands.insertContentAt(pos, cleanText);
            }, 50);
          }

          return true;
        } catch (error) {
          console.warn("Error in scene format handler:", error);
          return false;
        }
      },

      // ── Cmd+P → PARENTHETICAL (auto-adds opening paren) ───────
      "Mod-p": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const success = updateParagraphAttribute(editor, {
            lineType: "parenthetical",
          });

          // Auto-insert opening parenthesis if line is empty or doesn't start with one
          if (success) {
            const updatedState = editor.view.state;
            const updatedNode = updatedState.doc.nodeAt($from.before());

            if (updatedNode && !updatedNode.textContent.trim()) {
              editor.commands.insertContent("(");
            } else if (
              updatedNode &&
              !updatedNode.textContent.startsWith("(")
            ) {
              const currentPos = $from.before() + 1;
              editor.commands.insertContentAt(currentPos, "(");
            }
          }

          return true;
        } catch (error) {
          console.warn("Error in Mod-p handler:", error);
          return false;
        }
      },

      // ── Enter → Split paragraph with smart type transitions ────
      Enter: ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;

          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs
            .lineType as ScreenwritingLineType;

          // Auto-close parenthetical if needed
          if (currentType === "parenthetical") {
            const text = currentNode.textContent;
            if (text.startsWith("(") && !text.endsWith(")")) {
              editor.commands.insertContent(")");
              return true;
            }
          }

          // Determine the line type for the new paragraph
          // This follows standard screenplay typing flow:
          //   character → dialogue (you type the name, then the words)
          //   dialogue → description (dialogue ends, back to action)
          //   parenthetical → dialogue (direction ends, back to words)
          let newLineType: ScreenwritingLineType = "description";
          if (currentType === "character") {
            newLineType = "dialogue";
          } else if (currentType === "dialogue") {
            newLineType = "description";
          } else if (currentType === "parenthetical") {
            newLineType = "dialogue";
          }

          // Split the current paragraph at cursor position
          const tr = state.tr;
          const pos = $from.pos;
          tr.split(pos);

          // Apply the new line type to the newly created paragraph
          const newParaPos = tr.doc.resolve(pos + 2);
          const newParaStart = newParaPos.before();
          const newPara = tr.doc.nodeAt(newParaStart);

          if (newPara) {
            tr.setNodeMarkup(newParaStart, undefined, {
              lineType: newLineType,
              style: "font-family: 'Courier New', monospace; font-size: 12pt;",
            });
          }

          // Place cursor at the beginning of the new paragraph
          tr.setSelection(TextSelection.create(tr.doc, pos + 2));

          editor.view.dispatch(tr);
          editor.commands.focus();

          return true;
        } catch (error) {
          console.warn("Error in Enter handler:", error);
          return false;
        }
      },

      // ── Shift+Enter → Insert new paragraph after current line ──
      "Shift-Enter": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;

          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs
            .lineType as ScreenwritingLineType;

          // Same type transition logic as Enter
          let newType: ScreenwritingLineType = "description";
          if (currentType === "character") newType = "dialogue";
          else if (currentType === "dialogue") newType = "description";
          else if (currentType === "parenthetical") newType = "dialogue";

          // Auto-close parenthetical
          if (currentType === "parenthetical") {
            const text = currentNode.textContent;
            if (text.startsWith("(") && !text.endsWith(")")) {
              editor.commands.insertContent(")");
            }
          }

          // Create and insert a new paragraph node after the current one
          const tr = state.tr;
          const pos = $from.after();

          const newNode = state.schema.nodes.paragraph.create({
            lineType: newType,
            style: "font-family: 'Courier New', monospace; font-size: 12pt;",
          });

          tr.insert(pos, newNode);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));

          editor.view.dispatch(tr);
          editor.commands.focus();

          return true;
        } catch (error) {
          console.warn("Error in Shift-Enter handler:", error);
          return false;
        }
      },

      // ── Backspace → Handle empty line deletion ─────────────────
      Backspace: ({ editor }) => {
        try {
          const { state, dispatch } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const node = $from.parent;
          const docSize = state.doc.content.childCount;

          // Always maintain at least one line in the document
          if (docSize === 1 && node.textContent.trim() === "") {
            editor.commands.setContent(
              '<p data-line-type="description" style="font-family: \'Courier New\', monospace; font-size: 12pt;"></p>'
            );
            return true;
          }

          // Delete empty lines (let default backspace handle lines with content)
          if (node.textContent.trim() === "") {
            if ($from.pos <= 1) return false;
            const pos = $from.before();
            dispatch(state.tr.delete(pos, pos + node.nodeSize));
            editor.commands.focus();
            return true;
          }

          return false; // Let default backspace behavior handle non-empty lines
        } catch (error) {
          console.warn("Error in Backspace handler:", error);
          return false;
        }
      },
    };
  },
});

export default KeyboardShortcuts;