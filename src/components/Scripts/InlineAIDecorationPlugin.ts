// InlineAIDecorationPlugin.ts
//
// ProseMirror plugin for inline AI decoration sets.
// All styles inline — no CSS file.
//
// Uses plain string META_KEY for setMeta/getMeta to work across
// multiple editor instances in PaginatedEditor.
//
// FIL-315: Added loadingTarget decoration — same visual pattern as the
// green pending highlight but using the operation's accent color (cyan
// for revise, purple for suggest), more opaque, with a shimmer sweep.
//
// NOTE: CSS animations don't work in inline `style` attributes — the
// browser ignores `animation:` when set via element.style. So the
// shimmer uses injected CSS classes (.ai-loading-cyan, .ai-loading-purple)
// applied via the decoration's `class` property.

import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

const META_KEY = "aiDeco";

export interface InlineAIDecorationMeta {
  /** Full-range highlight for guided generation pending blocks */
  pendingRange: { from: number; to: number } | null;
  /** Paragraph-level diff highlights for revise/suggest (only changed paragraphs) */
  changedRanges: Array<{ from: number; to: number }>;
  /** Post-acceptance highlights with original text for tooltip */
  acceptedChanges: Array<{ from: number; to: number; originalText: string }>;
  /** Pre-generation selection target highlight */
  selectionTarget: { from: number; to: number; mode: "suggest" | "revise" } | null;
  /** Loading state: colored highlight with shimmer while API call is in flight */
  loadingTarget: { from: number; to: number; mode: "suggest" | "revise" } | null;
}

// ─── Injected CSS for shimmer loading classes ──────────────────

const SHIMMER_STYLE_ID = "ai-deco-shimmer-styles";

function ensureShimmerStyles() {
  if (document.getElementById(SHIMMER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    @keyframes aiDecoShimmer {
      0%   { background-position: -800px 0; }
      100% { background-position: 800px 0; }
    }

    /* Suppress browser/ProseMirror selection highlight when loading decorations are active */
    .ProseMirror[contenteditable="false"] ::selection {
      background: transparent !important;
    }
    .ProseMirror[contenteditable="false"] ::-moz-selection {
      background: transparent !important;
    }

    .ai-loading-cyan {
      color: transparent !important;
      background-color: rgba(6, 182, 212, 0.18) !important;
      background-image: linear-gradient(
        90deg,
        transparent 0%,
        rgba(34, 211, 238, 0.22) 40%,
        rgba(34, 211, 238, 0.22) 60%,
        transparent 100%
      ) !important;
      background-size: 600px 100% !important;
      background-repeat: no-repeat !important;
      animation: aiDecoShimmer 3s linear infinite !important;
      border-bottom: 2px solid #06b6d4 !important;
      padding: 1px 2px !important;
      border-radius: 2px !important;
      box-shadow: 0 0 8px rgba(6, 182, 212, 0.35), inset 0 0 4px rgba(6, 182, 212, 0.1) !important;
    }

    .ai-loading-purple {
      color: transparent !important;
      background-color: rgba(139, 92, 246, 0.18) !important;
      background-image: linear-gradient(
        90deg,
        transparent 0%,
        rgba(167, 139, 250, 0.22) 40%,
        rgba(167, 139, 250, 0.22) 60%,
        transparent 100%
      ) !important;
      background-size: 600px 100% !important;
      background-repeat: no-repeat !important;
      animation: aiDecoShimmer 3s linear infinite !important;
      border-bottom: 2px solid #8b5cf6 !important;
      padding: 1px 2px !important;
      border-radius: 2px !important;
      box-shadow: 0 0 8px rgba(139, 92, 246, 0.35), inset 0 0 4px rgba(139, 92, 246, 0.1) !important;
    }
  `;
  document.head.appendChild(style);
}

// ─── Inline styles ─────────────────────────────────────────────

const GREEN_PENDING_INLINE = [
  "background: rgba(16, 185, 129, 0.18)",
  "border-bottom: 2px solid #10b981",
  "padding: 1px 2px",
  "border-radius: 2px",
  "box-shadow: 0 0 8px rgba(16, 185, 129, 0.35), inset 0 0 4px rgba(16, 185, 129, 0.1)",
  "transition: background 0.3s ease",
].join(";");

const GREEN_CHANGED_INLINE = [
  "background: rgba(16, 185, 129, 0.22)",
  "border-bottom: 2px solid #10b981",
  "padding: 1px 2px",
  "border-radius: 2px",
  "box-shadow: 0 0 6px rgba(16, 185, 129, 0.3)",
  "transition: background 0.3s ease",
].join(";");

const GREEN_ACCEPTED_INLINE = [
  "background: rgba(16, 185, 129, 0.12)",
  "border-bottom: 2px solid rgba(16, 185, 129, 0.6)",
  "padding: 1px 2px",
  "border-radius: 2px",
  "box-shadow: 0 0 6px rgba(16, 185, 129, 0.2)",
  "transition: background 0.3s ease",
  "cursor: default",
].join(";");

const PURPLE_INLINE = [
  "background: rgba(139, 92, 246, 0.18)",
  "border-bottom: 2px solid #8b5cf6",
  "padding: 1px 2px",
  "border-radius: 2px",
  "box-shadow: 0 0 8px rgba(139, 92, 246, 0.35)",
].join(";");

const CYAN_INLINE = [
  "background: rgba(6, 182, 212, 0.18)",
  "border-bottom: 2px solid #06b6d4",
  "padding: 1px 2px",
  "border-radius: 2px",
  "box-shadow: 0 0 8px rgba(6, 182, 212, 0.35)",
].join(";");

function buildDecorations(meta: InlineAIDecorationMeta, doc: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = [];

  // Full-range pending (guided generation)
  if (meta.pendingRange) {
    const { from, to } = meta.pendingRange;
    const safeFrom = Math.max(0, from);
    const safeTo = Math.min(doc.content.size, to);
    if (safeFrom < safeTo) {
      doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
        if (node.isTextblock && node.textContent.trim().length > 0) {
          const blockStart = pos + 1;
          const blockEnd = pos + node.nodeSize - 1;
          const decoFrom = Math.max(safeFrom, blockStart);
          const decoTo = Math.min(safeTo, blockEnd);
          if (decoFrom < decoTo) {
            decorations.push(Decoration.inline(decoFrom, decoTo, {
              style: GREEN_PENDING_INLINE, "data-ai-decoration": "pending",
            }));
          }
        }
      });
    }
  }

  // Changed paragraph ranges (revise/suggest diff)
  for (const range of meta.changedRanges || []) {
    const safeFrom = Math.max(0, range.from);
    const safeTo = Math.min(doc.content.size, range.to);
    if (safeFrom < safeTo) {
      decorations.push(Decoration.inline(safeFrom, safeTo, {
        style: GREEN_CHANGED_INLINE, "data-ai-decoration": "changed",
      }));
    }
  }

  // Accepted changes
  for (const change of meta.acceptedChanges || []) {
    const safeFrom = Math.max(0, change.from);
    const safeTo = Math.min(doc.content.size, change.to);
    if (safeFrom < safeTo) {
      decorations.push(Decoration.inline(safeFrom, safeTo, {
        style: GREEN_ACCEPTED_INLINE, "data-ai-decoration": "accepted",
        "data-original": change.originalText,
      }));
    }
  }

  // Selection target
  if (meta.selectionTarget) {
    const { from, to, mode } = meta.selectionTarget;
    const safeFrom = Math.max(0, from);
    const safeTo = Math.min(doc.content.size, to);
    if (safeFrom < safeTo) {
      decorations.push(Decoration.inline(safeFrom, safeTo, {
        style: mode === "suggest" ? PURPLE_INLINE : CYAN_INLINE,
        "data-ai-decoration": mode === "suggest" ? "suggest-target" : "revise-target",
      }));
    }
  }

  // Loading target — accent-colored highlight with shimmer via CSS class
  if (meta.loadingTarget) {
    const { from, to, mode } = meta.loadingTarget;
    const safeFrom = Math.max(0, from);
    const safeTo = Math.min(doc.content.size, to);
    if (safeFrom < safeTo) {
      const className = mode === "suggest" ? "ai-loading-purple" : "ai-loading-cyan";
      doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
        if (node.isTextblock && node.textContent.trim().length > 0) {
          const blockStart = pos + 1;
          const blockEnd = pos + node.nodeSize - 1;
          const decoFrom = Math.max(safeFrom, blockStart);
          const decoTo = Math.min(safeTo, blockEnd);
          if (decoFrom < decoTo) {
            decorations.push(Decoration.inline(decoFrom, decoTo, {
              class: className,
              "data-ai-decoration": "loading-target",
              "data-loading-mode": mode,
            }));
          }
        }
      });
    }
  }

  return decorations;
}

export function createInlineAIDecorationPlugin(): Plugin {
  // Inject shimmer CSS when the plugin is created
  ensureShimmerStyles();

  return new Plugin({
    key: new PluginKey("inlineAIDecoration"),
    state: {
      init(): DecorationSet { return DecorationSet.empty; },
      apply(tr: Transaction, oldSet: DecorationSet, _oldState: EditorState, newState: EditorState): DecorationSet {
        const meta = tr.getMeta(META_KEY) as InlineAIDecorationMeta | undefined;
        if (meta) return DecorationSet.create(newState.doc, buildDecorations(meta, newState.doc));
        if (tr.docChanged) return oldSet.map(tr.mapping, tr.doc);
        return oldSet;
      },
    },
    props: {
      decorations(state: EditorState): DecorationSet { return this.getState(state) as DecorationSet; },
    },
  });
}

// ─── Dispatch Helpers ──────────────────────────────────────────

function dispatch(editor: Editor, meta: InlineAIDecorationMeta): void {
  editor.view.dispatch(editor.state.tr.setMeta(META_KEY, meta));
}

const EMPTY_META: InlineAIDecorationMeta = {
  pendingRange: null, changedRanges: [], acceptedChanges: [], selectionTarget: null, loadingTarget: null,
};

export function showPendingHighlight(editor: Editor, from: number, to: number): void {
  dispatch(editor, { ...EMPTY_META, pendingRange: { from, to } });
}

export function showChangedRanges(editor: Editor, ranges: Array<{ from: number; to: number }>): void {
  dispatch(editor, { ...EMPTY_META, changedRanges: ranges });
}

export function clearAllDecorations(editor: Editor): void {
  dispatch(editor, EMPTY_META);
}

export function showSelectionTarget(editor: Editor, from: number, to: number, mode: "suggest" | "revise"): void {
  dispatch(editor, { ...EMPTY_META, selectionTarget: { from, to, mode } });
}

/** FIL-315: Show loading highlight — accent-colored with CSS shimmer animation */
export function showLoadingTarget(editor: Editor, from: number, to: number, mode: "suggest" | "revise"): void {
  dispatch(editor, { ...EMPTY_META, loadingTarget: { from, to, mode } });
}

export function showAcceptedChanges(editor: Editor, changes: Array<{ from: number; to: number; originalText: string }>): void {
  dispatch(editor, { ...EMPTY_META, acceptedChanges: changes });
}

export function scheduleAcceptedClear(editor: Editor, delayMs: number = 5000): () => void {
  const timeout = setTimeout(() => { if (editor && !editor.isDestroyed) clearAllDecorations(editor); }, delayMs);
  return () => clearTimeout(timeout);
}