/**
 * KeyboardShortcuts.ts
 * ====================
 * TipTap extension that defines all screenplay-specific keyboard shortcuts,
 * modelled on Final Draft / WriterDuet industry conventions.
 *
 * SHARED WRAPPER NOTE: this extension is baked into PaginatedEditor's
 * extension array, so it drives BOTH renderings that mount ScriptEditor —
 * the outline workflow's Scripts view AND the freeform script surface. Edit
 * with both in mind. It runs its keymap BEFORE the ScreenwritingParagraph
 * node's own Enter/Shift-Enter (TipTap reverses then priority-sorts, so a
 * later array position wins at equal priority), which makes the node's
 * splitBlock Enter a dead fallback — this file is authoritative for Enter.
 * On the freeform surface a sceneBoundaryGuard plugin (registered at runtime)
 * intercepts Backspace/Delete at scene-head boundaries BEFORE this keymap and
 * returns false otherwise, so our Backspace handler never collides with it.
 *
 * Shortcut reference (FD-style):
 *   Tab            → next element by context (see TAB_NEXT)
 *   Shift+Tab      → previous element by context (see TAB_PREV)
 *   Cmd/Ctrl+1..6  → set element directly (FD order):
 *                      1 scene · 2 action · 3 character
 *                      4 parenthetical · 5 dialogue · 6 transition
 *   Enter          → split with contextual next-element (see ENTER_NEXT) plus
 *                      FD "double-Enter": an EMPTY action line promotes to
 *                      Character; an empty character/dialogue reverts to Action;
 *                      an empty parenthetical drops to Dialogue.
 *                      A parenthetical auto-closes ")" then splits to Dialogue
 *                      in a single keystroke.
 *   Typing INT./EXT./EST./I/E at the start of an Action line auto-converts it
 *                      to a Scene Heading (input rule).
 *   Scene/Character/Transition text is force-UPPERCASED as stored (not just
 *                      displayed), so the parser, PDF export and extraction all
 *                      see canonical caps.
 *   Cmd+A          → safe select-all
 *   Backspace      → empty-line deletion, keeps a minimum of one line
 *
 * Cmd+P (Print) and Cmd+Shift+S (Save As) are deliberately NOT bound — the
 * old parenthetical/scene shortcuts on those keys shadowed browser/FD defaults.
 * Use Cmd+4 / Cmd+1 instead.
 *
 * Dependencies:
 *   - editorUtils.ts: updateParagraphAttribute(), safeSelect()
 *   - ScreenwritingParagraph: provides the `lineType` attribute on paragraphs
 */

import { Extension, InputRule } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { updateParagraphAttribute } from "../../editorUtils";
import { ScreenwritingLineType } from "../../types";

const PARA_STYLE = "font-family: 'Courier New', monospace; font-size: 12pt;";

// Elements whose STORED text is uppercased as typed (FD SmartType caps).
const CAPS_LINES = new Set<ScreenwritingLineType>([
  "scene",
  "character",
  "transition",
]);

// Tab advances to the next element by context (FD/WriterDuet table).
const TAB_NEXT: Record<string, ScreenwritingLineType> = {
  scene: "description",
  description: "character",
  character: "parenthetical",
  parenthetical: "dialogue",
  dialogue: "parenthetical",
  transition: "scene",
};

// Shift+Tab steps back down the ladder toward action/scene.
const TAB_PREV: Record<string, ScreenwritingLineType> = {
  scene: "transition",
  description: "scene",
  character: "description",
  parenthetical: "character",
  dialogue: "character",
  transition: "dialogue",
};

// Enter on a NON-empty line splits and gives the new line this type.
const ENTER_NEXT: Record<string, ScreenwritingLineType> = {
  scene: "description",
  description: "description",
  character: "dialogue",
  dialogue: "description",
  parenthetical: "dialogue",
  transition: "scene",
};

// Enter on an EMPTY line converts it in place (FD double-Enter behaviour).
//   empty action    → character  (the double-Enter-to-cue)
//   empty character → action     (bail an accidental cue)
//   empty dialogue  → action
//   empty parenthetical → dialogue
const ENTER_EMPTY: Record<string, ScreenwritingLineType> = {
  description: "character",
  character: "description",
  dialogue: "description",
  parenthetical: "dialogue",
};

// FD element numbers → line types (1-based, matches the Cmd+K palette order).
const NUMBER_ELEMENT: Record<string, ScreenwritingLineType> = {
  "1": "scene",
  "2": "description",
  "3": "character",
  "4": "parenthetical",
  "5": "dialogue",
  "6": "transition",
};

// Slugline prefixes that auto-convert an Action line to a Scene Heading.
const SLUG_PREFIX = /^(int\.?\/ext\.?|int|ext|est|i\/e)([ .])$/i;

/**
 * Set the current line's type in place (no split). For parenthetical, seed an
 * opening "(" the way Final Draft does.
 */
const setLineTypeInPlace = (
  editor: any,
  type: ScreenwritingLineType
): boolean => {
  const ok = updateParagraphAttribute(editor, { lineType: type });
  if (ok && type === "parenthetical") {
    const { $from } = editor.view.state.selection;
    const node = editor.view.state.doc.nodeAt($from.before());
    if (node && !node.textContent.trim()) {
      editor.commands.insertContent("(");
    } else if (node && !node.textContent.startsWith("(")) {
      editor.commands.insertContentAt($from.before() + 1, "(");
    }
  }
  return ok;
};

/**
 * Cmd+1 (scene). Preserves the legacy "S1.2" scene-ID-from-text extraction
 * that used to live on Cmd+Shift+S: if the line contains an id pattern, lift
 * it into data-scene-id and strip it from the visible text.
 */
const setSceneWithIdExtraction = (editor: any): boolean => {
  const { $from } = editor.view.state.selection;
  if ($from.depth === 0) return false;
  const node = $from.parent;
  const text = node.textContent;

  const sceneIdMatch = text.match(/\b([sS]\d+\.\d+)\b/);
  const attributes: Record<string, any> = { lineType: "scene" };
  let cleanText = text;
  if (sceneIdMatch) {
    attributes["data-scene-id"] = sceneIdMatch[1].toLowerCase();
    cleanText = text.replace(/\s*\b[sS]\d+\.\d+\b\s*/, "").trim();
  }

  const ok = updateParagraphAttribute(editor, attributes);
  if (ok && sceneIdMatch && cleanText !== text) {
    setTimeout(() => {
      const pos = $from.before() + 1;
      const nodeSize = node.nodeSize - 2;
      editor.commands.deleteRange({ from: pos, to: pos + nodeSize });
      editor.commands.insertContentAt(pos, cleanText);
    }, 50);
  }
  return ok;
};

/**
 * Split the current paragraph at the cursor and stamp the new (second) half
 * with `newType`. Shared by the Enter handler.
 */
const splitWithType = (editor: any, newType: ScreenwritingLineType): boolean => {
  const { state } = editor.view;
  const { $from } = state.selection;
  const pos = $from.pos;

  const tr = state.tr;
  tr.split(pos);

  const newParaStart = tr.doc.resolve(pos + 2).before();
  const newPara = tr.doc.nodeAt(newParaStart);
  if (newPara) {
    tr.setNodeMarkup(newParaStart, undefined, {
      ...newPara.attrs,
      lineType: newType,
      "data-scene-id": null,
      style: PARA_STYLE,
    });
  }
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));

  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
};

const KeyboardShortcuts = Extension.create({
  name: "keyboardShortcuts",

  // ── Input-rule conversions ─────────────────────────────────────────────────
  // NOTE: input-rule handlers MUST mutate the shared `state.tr` (TipTap only
  // dispatches when that transaction gains steps) and MUST insert the
  // triggering character themselves — a matched rule suppresses the default
  // text insert. `newText` reconstructs the char(s) the rule swallowed.
  addInputRules() {
    return [
      // INT./EXT./EST./I/E typed at an Action line's start → Scene Heading.
      new InputRule({
        find: SLUG_PREFIX,
        handler: ({ state, range, match }) => {
          const $from = state.selection.$from;
          if ($from.depth === 0) return null;
          if ($from.parent.attrs.lineType !== "description") return null;
          // Only fire when the prefix is the whole line so far (line start).
          if (range.from !== $from.before() + 1) return null;
          const pos = $from.before();
          const newText = match[0].slice(range.to - range.from);
          if (newText) state.tr.insertText(newText, range.to);
          state.tr.setNodeMarkup(pos, undefined, {
            ...$from.parent.attrs,
            lineType: "scene",
          });
        },
      }),
      // "(" typed at the START of a Dialogue line → Parenthetical (the "("
      // stays as the opening paren). The ^\( anchor means a "(" typed
      // mid-dialogue (an inline wryly) is left as literal text.
      new InputRule({
        find: /^\($/,
        handler: ({ state, range, match }) => {
          const $from = state.selection.$from;
          if ($from.depth === 0) return null;
          if ($from.parent.attrs.lineType !== "dialogue") return null;
          const pos = $from.before();
          const newText = match[0].slice(range.to - range.from);
          if (newText) state.tr.insertText(newText, range.to);
          state.tr.setNodeMarkup(pos, undefined, {
            ...$from.parent.attrs,
            lineType: "parenthetical",
          });
        },
      }),
    ];
  },

  // ── Force UPPERCASE for scene/character/transition in STORED text ──────────
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("screenplayUppercase"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr: any = null;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "paragraph") return;
            if (!CAPS_LINES.has(node.attrs.lineType)) return;
            node.descendants((child, offset) => {
              if (!child.isText || !child.text) return;
              const up = child.text.toUpperCase();
              // Same-length only: uppercasing keeps positions stable for Latin,
              // and skipping the rare length-changing char (ß→SS) is safe.
              if (up === child.text || up.length !== child.text.length) return;
              const from = pos + 1 + offset;
              tr = (tr || newState.tr).insertText(up, from, from + child.text.length);
            });
          });
          return tr;
        },
      }),
    ];
  },

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

      // ── Cmd/Ctrl+1..6 → set element directly (FD order) ────────
      "Mod-1": ({ editor }) => {
        try {
          if (editor.view.state.selection.$from.depth === 0) return false;
          return setSceneWithIdExtraction(editor);
        } catch (error) {
          console.warn("Error in Mod-1 handler:", error);
          return false;
        }
      },
      "Mod-2": ({ editor }) => setLineTypeInPlace(editor, "description"),
      "Mod-3": ({ editor }) => setLineTypeInPlace(editor, "character"),
      "Mod-4": ({ editor }) => setLineTypeInPlace(editor, "parenthetical"),
      "Mod-5": ({ editor }) => setLineTypeInPlace(editor, "dialogue"),
      "Mod-6": ({ editor }) => setLineTypeInPlace(editor, "transition"),

      // ── Tab → next element by context ──────────────────────────
      // (Autofill dropdowns intercept Tab at the DOM capture phase while open;
      //  this keymap only fires when no dropdown is consuming the key.)
      Tab: ({ editor }) => {
        try {
          const { $from } = editor.view.state.selection;
          if ($from.depth === 0) return false;
          const type = $from.parent.attrs.lineType as string;
          const next = TAB_NEXT[type] ?? "character";
          return setLineTypeInPlace(editor, next);
        } catch (error) {
          console.warn("Error in Tab handler:", error);
          return false;
        }
      },

      // ── Shift+Tab → previous element by context ────────────────
      "Shift-Tab": ({ editor }) => {
        try {
          const { $from } = editor.view.state.selection;
          if ($from.depth === 0) return false;
          const type = $from.parent.attrs.lineType as string;
          const prev = TAB_PREV[type] ?? "description";
          return setLineTypeInPlace(editor, prev);
        } catch (error) {
          console.warn("Error in Shift-Tab handler:", error);
          return false;
        }
      },

      // ── Enter → contextual split + FD double-Enter behaviour ───
      Enter: ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs.lineType as ScreenwritingLineType;
          const isEmpty = currentNode.textContent.trim() === "";

          // Empty line: convert in place per the FD hierarchy (double-Enter).
          if (isEmpty) {
            const to = ENTER_EMPTY[currentType];
            if (to) {
              // A lone "(" on an empty parenthetical shouldn't survive the demote.
              if (currentType === "parenthetical" && currentNode.textContent) {
                const start = $from.before() + 1;
                editor
                  .chain()
                  .setTextSelection({
                    from: start,
                    to: start + currentNode.textContent.length,
                  })
                  .deleteSelection()
                  .run();
              }
              updateParagraphAttribute(editor, { lineType: to });
              return true;
            }
            // scene/transition empty → fall through to a normal split.
          }

          // Auto-close an open parenthetical before splitting, so one Enter
          // closes the ")" AND advances to dialogue.
          if (currentType === "parenthetical") {
            const text = currentNode.textContent;
            if (text.startsWith("(") && !text.endsWith(")")) {
              editor.commands.insertContent(")");
            }
          }

          const newType = ENTER_NEXT[currentType] ?? "description";
          return splitWithType(editor, newType);
        } catch (error) {
          console.warn("Error in Enter handler:", error);
          return false;
        }
      },

      // ── Shift+Enter → insert a new line after, same transition map ──
      "Shift-Enter": ({ editor }) => {
        try {
          const { state } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const currentNode = $from.parent;
          const currentType = currentNode.attrs.lineType as ScreenwritingLineType;

          if (currentType === "parenthetical") {
            const text = currentNode.textContent;
            if (text.startsWith("(") && !text.endsWith(")")) {
              editor.commands.insertContent(")");
            }
          }

          const newType = ENTER_NEXT[currentType] ?? "description";

          const tr = editor.view.state.tr;
          const pos = editor.view.state.selection.$from.after();
          const newNode = state.schema.nodes.paragraph.create({
            lineType: newType,
            style: PARA_STYLE,
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

      // ── Backspace → handle empty line deletion ─────────────────
      Backspace: ({ editor }) => {
        try {
          const { state, dispatch } = editor.view;
          const { $from } = state.selection;
          if ($from.depth === 0) return false;

          const node = $from.parent;
          const docSize = state.doc.content.childCount;

          if (docSize === 1 && node.textContent.trim() === "") {
            editor.commands.setContent(
              `<p data-line-type="description" style="${PARA_STYLE}"></p>`
            );
            return true;
          }

          if (node.textContent.trim() === "") {
            if ($from.pos <= 1) return false;
            const pos = $from.before();
            dispatch(state.tr.delete(pos, pos + node.nodeSize));
            editor.commands.focus();
            return true;
          }

          return false; // let default backspace handle non-empty lines
        } catch (error) {
          console.warn("Error in Backspace handler:", error);
          return false;
        }
      },
    };
  },
});

export default KeyboardShortcuts;
