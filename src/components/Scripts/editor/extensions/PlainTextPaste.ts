/**
 * PlainTextPaste.ts
 * =================
 * Final Draft's two plain-text doors, on the ONE shared editor:
 *
 *   PASTE   A multi-paragraph plain-text paste (a script from Word, a
 *           scene from a note, a Fountain-ish draft) is run through the
 *           import classifier (src/lib/screenplayParse.ts) and lands as
 *           TYPED paragraphs: sluglines, cues, dialogue, parentheticals,
 *           transitions, and at the document head a title page. This is the
 *           FD rule for pasting from another program ("more than one
 *           paragraph: the Paste command attempts to format the text
 *           according to its position"). A single paragraph keeps the
 *           native paste and takes the type of the line it lands in, also
 *           the FD rule. Text copied from OUR OWN editor carries
 *           data-line-type in its HTML and keeps its types natively.
 *
 *   REFORMAT (Cmd+Alt+R, toolbar): re-type the selected paragraphs, or the
 *           whole script when nothing is selected, 1:1 with the same
 *           classifier. FD's Tools > Reformat without the one-paragraph-at-
 *           a-time walk. Text is never changed, only the line types.
 *
 * Both readings are the exact grammar the PDF import runs server-side, so
 * a paste, a Reformat and an import agree on what a line is.
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { classifyScriptText, repairScriptBlocks, classifyParagraphs } from "../../../../lib/screenplayParse";

const SLUG_SHAPE = /^(INT|EXT|EST|I\/E)[.\s]/i;

/** Re-type paragraphs in place. Selection: those paragraphs, cues allowed
 *  without a slugline above. No selection: the whole document, title page
 *  detection on when the document has sluglines. Returns true when handled. */
export const reformatScreenplay = (editor: Editor | null): boolean => {
  if (!editor) return false;
  try {
    const { state } = editor.view;
    const sel = state.selection;
    const whole = sel.empty;
    const from = whole ? 0 : sel.from;
    const to = whole ? state.doc.content.size : sel.to;
    const targets: Array<{ pos: number; node: PMNode }> = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "paragraph") targets.push({ pos, node });
      return false;
    });
    if (!targets.length) return false;
    const hasSlug = targets.some((t) => t.node.attrs.lineType === "scene" || SLUG_SHAPE.test(t.node.textContent.trim()));
    const types = classifyParagraphs(targets.map((t) => t.node.textContent), { inScript: !(whole && hasSlug) });
    let tr = state.tr;
    let changed = 0;
    targets.forEach((t, i) => {
      const ty = types[i];
      if (ty && ty !== t.node.attrs.lineType) {
        tr = tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, lineType: ty });
        changed++;
      }
    });
    if (changed) editor.view.dispatch(tr);
    return true;
  } catch (error) {
    console.warn("Error in reformatScreenplay:", error);
    return false;
  }
};

const PlainTextPaste = Extension.create({
  name: "plainTextPaste",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("plainTextPaste"),
        props: {
          handlePaste(view, event) {
            try {
              const cd = event.clipboardData;
              if (!cd) return false;
              const html = cd.getData("text/html");
              // Our own paragraphs travel with their types: native paste.
              if (html && /data-line-type=/.test(html)) return false;
              const text = (cd.getData("text/plain") || "").replace(/\r\n?/g, "\n");
              const nonBlank = text.split("\n").filter((l) => l.trim()).length;
              // One paragraph takes the type of the line it lands in (FD).
              if (nonBlank < 2) return false;

              const { state } = view;
              const { $from } = state.selection;
              if ($from.depth === 0) return false;
              const cur = $from.parent;
              if (cur.type.name !== "paragraph") return false;

              // Nothing above the cursor: a whole script may be arriving,
              // title page included, and cues wait for its first slugline.
              // Anywhere else the paste sits inside a script.
              const before = $from.before();
              const nothingAbove = state.doc.textBetween(0, before, " ").trim() === "";
              const blocks = repairScriptBlocks(classifyScriptText(text, { inScript: !nothingAbove }));
              if (!blocks.length) return false;

              const para = state.schema.nodes.paragraph;
              const baseAttrs = { ...cur.attrs, "data-scene-id": null, sluglineSelected: false, pendingGeneration: false };
              const nodes = blocks.map((b) =>
                para.create({ ...baseAttrs, lineType: b.type }, b.text ? state.schema.text(b.text) : undefined),
              );
              const frag = Fragment.from(nodes);
              let tr = state.tr;
              if (state.selection.empty && cur.textContent.trim() === "") {
                // An empty line is REPLACED (no stray blank paragraph), and
                // its region tag moves onto the first pasted paragraph so a
                // fresh scene's head keeps its scene id on the freeform surface.
                const after = $from.after();
                tr = tr.replaceWith(before, after, frag);
                const sceneId = cur.attrs["data-scene-id"];
                if (sceneId) {
                  tr = tr.setNodeMarkup(before, undefined, { ...nodes[0].attrs, "data-scene-id": sceneId });
                }
                const end = before + frag.size;
                tr = tr.setSelection(TextSelection.near(tr.doc.resolve(end - 1), -1));
              } else {
                // Pasting at the very start of a scene's head paragraph puts
                // the new paragraphs ABOVE the head; on the freeform surface
                // anything above the first head reads as scratch, so the
                // region tag moves onto the first pasted paragraph (the import
                // lays out a title page the same way).
                const atHead = state.selection.empty && $from.parentOffset === 0 && !!cur.attrs["data-scene-id"];
                tr = tr.replaceSelection(new Slice(frag, 0, 0));
                if (atHead) {
                  const firstNew = tr.doc.nodeAt(before);
                  const oldHead = tr.doc.nodeAt(before + frag.size);
                  if (firstNew) tr = tr.setNodeMarkup(before, undefined, { ...firstNew.attrs, "data-scene-id": cur.attrs["data-scene-id"] });
                  if (oldHead) tr = tr.setNodeMarkup(before + frag.size, undefined, { ...oldHead.attrs, "data-scene-id": null });
                }
              }
              view.dispatch(tr.scrollIntoView());
              return true;
            } catch (error) {
              console.warn("Error in plain-text paste:", error);
              return false;
            }
          },
        },
      }),
    ];
  },
});

export default PlainTextPaste;
