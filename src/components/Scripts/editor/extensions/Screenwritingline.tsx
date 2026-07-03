import { Node, mergeAttributes } from "@tiptap/core";
//screenwriting line type each line can only be one of these types
export type ScreenwritingLineType =
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

  renderHTML({ HTMLAttributes }) {
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
