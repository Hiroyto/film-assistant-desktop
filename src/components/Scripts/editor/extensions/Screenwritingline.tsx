import { Node, mergeAttributes } from "@tiptap/core";
//screenwriting line type each line can only be one of these types
export type ScreenwritingLineType =
  | "title"
  | "scene"
  | "description"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition";

// Extend the commands with our custom ones
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    screenwriting: {
      setLineType: (lineType: ScreenwritingLineType) => ReturnType;
      toggleSluglineSelected: (value: boolean) => ReturnType;
    };
  }
}

// Title-page line roles (mirror the classifier's TITLE_MARKER vocabulary).
const TITLE_CREDIT = /^(written|screenplay|teleplay|story|created|original screenplay|an original screenplay|adapted|directed|based)\b/i;
// Contact block: email, phone, URL, rights, draft / revision / registration
// lines, and a draft date. Every such line is contact so the block's push
// (freeform-script.tsx) lands once, on the first of them.
const TITLE_CONTACT = /@|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\brights reserved\b|copyright|©|\bwga\b|\bdraft\b|\brevision\b|\bregistered\b|\b[a-z0-9-]+\.(com|net|org|io|co|uk|me|tv|film)\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}$|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/i;

// Create the custom paragraph node for screenwriting
export const ScreenwritingParagraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "text*",

  addAttributes() {
    return {
      lineType: {
        default: "description",
        parseHTML: (element) =>
          element.getAttribute("data-line-type") || "description",
        renderHTML: (attributes) => ({
          "data-line-type": attributes.lineType,
          class: `screenplay-line ${attributes.lineType}`,
        }),
      },
      sluglineSelected: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-slugline-selected") === "true",
        renderHTML: (attributes) => ({
          "data-slugline-selected": attributes.sluglineSelected,
        }),
      },
      "data-scene-id": {
        default: null,
        parseHTML: (element) => element.getAttribute("data-scene-id"),
        renderHTML: (attributes) => {
          if (attributes["data-scene-id"]) {
            return { "data-scene-id": attributes["data-scene-id"] };
          }
          return {};
        },
      },
      // Schema-level attribute so the green "pending generation" highlight
      // travels with the paragraph node when PaginatedEditor splits content
      // between pages (DOMSerializer round-trip preserves it).
      pendingGeneration: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-pending-generation") === "true",
        renderHTML: (attributes) => {
          if (attributes.pendingGeneration) {
            return { "data-pending-generation": "true" };
          }
          return {};
        },
      },
    };
  },
  /*addAttributes() {
    return {
      lineType: {
        default: "description",
        parseHTML: (element) =>
          element.getAttribute("data-line-type") || "description",
        renderHTML: (attributes) => ({
          "data-line-type": attributes.lineType,
          class: `screenplay-line ${attributes.lineType}`,
          style: "position: relative; min-height: 1em;",
        }),
      },
      sluglineSelected: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-slugline-selected") === "true",
        renderHTML: (attributes) => ({
          "data-slugline-selected": attributes.sluglineSelected,
        }),
      },
    };
  },
*/
  parseHTML() {
    return [{ tag: "p[data-line-type]" }];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        return editor.commands.splitBlock()
      },
      "Shift-Enter": () => {
        return true
      },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    // TITLE PAGE ROLES (2026-09-15): a title line's role rides as a class so
    // the stylesheet can lay the page out the Final Draft way (title a third
    // of the way down, a gap before each credit line, contact block
    // bottom-left) without a second data model. Derived from the text, never
    // stored.
    if (node.attrs.lineType === "title") {
      const t = node.textContent.trim();
      const role = TITLE_CONTACT.test(t) ? "ff-title-contact" : TITLE_CREDIT.test(t) ? "ff-title-credit" : "";
      if (role) return ["p", mergeAttributes(HTMLAttributes, { class: role }), 0];
    }
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setLineType:
        (lineType: ScreenwritingLineType) =>
          ({ commands }) => {
            return commands.updateAttributes("paragraph", { lineType });
          },
      toggleSluglineSelected:
        (value: boolean) =>
          ({ commands }) => {
            return commands.updateAttributes("paragraph", {
              sluglineSelected: value,
            });
          },
    };
  },
  pageBreak: {
    default: false,

    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-page-break") === "true",

    renderHTML: (attributes: Record<string, any>) => {

      if (!attributes.pageBreak) return {}

      return {
        "data-page-break": "true",
        class: `${attributes.class ?? ""} page-break`
      }
    }
  }
});
