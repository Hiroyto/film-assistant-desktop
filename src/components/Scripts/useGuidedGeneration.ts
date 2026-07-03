/**
 * useGuidedGeneration.ts
 * ======================
 * Hook for Workflow 2 — Guided Generation (CMD+J)
 *
 * 4-state machine:
 *   idle → loading → pending → resolved (accept | remove)
 *                       ↑          │
 *                       └── retry ──┘
 *
 * Key mechanics:
 *   - Snapshots cursor position BEFORE the API call
 *   - On result, inserts HTML directly into editor at snapshot point
 *   - Measures doc size BEFORE and AFTER insert to get precise range
 *   - Accept = clear decorations + clear state (text already in editor)
 *   - Remove = clear decorations + editor.chain().deleteRange(insertedRange)
 *   - Retry = remove current + re-fire API call
 *
 * Pending highlight integration:
 *   - On insert → markPendingRange(editor, insertAt, insertAt + delta)
 *     sets `pendingGeneration: true` as a node attribute on each paragraph
 *     in the range. This survives PaginatedEditor's page-split round-trip
 *     (DOMSerializer → setContent), so paragraphs that overflow onto the
 *     next page keep their green highlight.
 *   - On accept/remove/dismiss → clearAllDecorations(editor) + clear marks
 *     across every mounted page editor (split paragraphs may live in N+1).
 *
 * FIL-286 · FIL-298 (retry with feedback)
 * FIL-302 Step 2d: Pre-AI dirty check. If the current scene has been
 * edited since last extraction, sends needsExtraction flag + tagged
 * content so the backend extracts synchronously before context assembly.
 *
 * FIL-302 Navigation fix: Calls markSceneExtracted in accept() after
 * the graph write-back fires, so the navigation trigger doesn't
 * redundantly re-extract a scene that was just accepted and extracted.
 */

import { useState, useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import { safeApiCall } from "../../models/apiHelpers";
import { convertTaggedContentToHTML } from "./editorUtils";
import {
  getSceneIdFromSelection,
  getRawSceneContent,
  getSelectedTaggedText,
} from "./InlineAIHelpers";
import { clearAllDecorations } from "./InlineAIDecorationPlugin";

// ─────────────────────────────────────────────
// Pending-generation node-attribute markers
// ─────────────────────────────────────────────
// Sets the `pendingGeneration` schema attribute on every paragraph node
// that intersects [from, to). The attribute renders as
// `data-pending-generation="true"` in the DOM and is parsed back on
// setContent, so it survives PaginatedEditor's serialize→split→reparse.

function markPendingRange(editor: Editor, from: number, to: number): void {
  const { state } = editor;
  const tr = state.tr;
  const safeFrom = Math.max(0, from);
  const safeTo = Math.min(state.doc.content.size, to);
  if (safeFrom >= safeTo) return;

  state.doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
    if (node.type.name !== "paragraph") return;
    if (node.attrs.pendingGeneration) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, pendingGeneration: true });
  });

  if (tr.docChanged) editor.view.dispatch(tr);
}

function clearPendingMarks(editor: Editor): void {
  if (!editor || editor.isDestroyed) return;
  const { state } = editor;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    if (!node.attrs.pendingGeneration) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, pendingGeneration: false });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type GenerationScope = "lines" | "scene";
export type GuidedGenState = "idle" | "loading" | "pending" | "resolved";

interface UseGuidedGenerationParams {
  editor: Editor | null;
  token: any;
  storyData: any;
  storyId: string;
  setUser: (updater: (prev: any) => any) => void;
  /** FIL-302 2d: Check if a scene's content has changed since last extraction */
  isSceneDirty?: (sceneId: string) => boolean;
  /** FIL-302 2d: Get tagged content for a scene (sent to backend for extraction) */
  getSceneTaggedContent?: (sceneId: string) => string | null;
  /** FIL-302: Update baseline hash after accept so navigation trigger doesn't redundantly re-extract */
  markSceneExtracted?: (sceneId: string) => void;
  /**
   * Returns every mounted page editor in PaginatedEditor. Needed so the
   * pending-generation node attribute can be cleared on paragraphs that
   * overflowed onto a subsequent page (and therefore live in a different
   * TipTap instance than `editor`).
   */
  getAllEditors?: () => Editor[];
}

interface InsertedRange {
  from: number;
  to: number;
}

// ─────────────────────────────────────────────
// Response body parser
// ─────────────────────────────────────────────

const parseResponseBody = (data: any): any => {
  try {
    if (typeof data?.body === "string") return JSON.parse(data.body);
    return data?.body || data || {};
  } catch {
    return data?.body || data || {};
  }
};

// ─────────────────────────────────────────────
// Token balance updater
// ─────────────────────────────────────────────

function updateTokenBalance(body: any, setUser: (fn: (prev: any) => any) => void) {
  const balance = body?.remaining_balance ?? body?.cap;
  if (balance != null) {
    setUser((prev: any) => ({
      ...prev,
      tokenBalance: balance,
    }));
  }
}

// ─────────────────────────────────────────────
// Helper: Get content before cursor
// ─────────────────────────────────────────────

const getContentBeforeCursor = (editor: Editor): string => {
  const { state } = editor;
  const { from } = state.selection;
  const sceneId = getSceneIdFromSelection(editor);
  if (!sceneId) return "";

  const lines: string[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    if (node.attrs["data-scene-id"] !== sceneId) return;
    if (pos >= from) return;

    const lineType = node.attrs["data-line-type"] || "AC";
    const text = node.textContent.trim();
    if (text) lines.push(`[<${lineType}>]: ${text}`);
  });

  return lines.join("\n");
};

// ─────────────────────────────────────────────
// Helper: Insert content and return precise
// inserted range by measuring doc size delta.
// ─────────────────────────────────────────────

function insertAndMeasure(
  editor: Editor,
  insertAt: number,
  html: string
): InsertedRange {
  const sizeBefore = editor.state.doc.content.size;

  editor.chain().focus().insertContentAt(insertAt, html, {
    parseOptions: { preserveWhitespace: false },
  }).run();

  const sizeAfter = editor.state.doc.content.size;
  const delta = sizeAfter - sizeBefore;

  return { from: insertAt, to: insertAt + delta };
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export function useGuidedGeneration({
  editor,
  token,
  storyData,
  storyId,
  setUser,
  isSceneDirty,
  getSceneTaggedContent,
  markSceneExtracted,
  getAllEditors,
}: UseGuidedGenerationParams) {

  // Clears the pending-generation node attribute everywhere it could have
  // landed: the source editor and any subsequent page editor that received
  // overflowed paragraphs from PaginatedEditor's split.
  const clearPendingMarksEverywhere = useCallback(() => {
    const editors = getAllEditors?.() ?? (editor ? [editor] : []);
    for (const ed of editors) clearPendingMarks(ed);
  }, [editor, getAllEditors]);
  const [state, setState] = useState<GuidedGenState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const insertionPointRef = useRef<number | null>(null);
  const insertedRangeRef = useRef<InsertedRange | null>(null);
  const insertionSceneIdRef = useRef<string | null>(null);
  const scopeRef = useRef<GenerationScope>("lines");
  const directionRef = useRef<string>("");

  // ─────────────────────────────────────────
  // Generate
  // ─────────────────────────────────────────

  const generate = useCallback(
    async (scope: GenerationScope, direction?: string) => {
      if (!editor || !token) return;

      const sceneId = getSceneIdFromSelection(editor) || "unknown";
      const { from } = editor.state.selection;
      insertionPointRef.current = from;
      insertionSceneIdRef.current = sceneId;
      scopeRef.current = scope;
      directionRef.current = direction || "";

      setError(null);
      setResultText(null);
      insertedRangeRef.current = null;
      setState("loading");

      const userId = token.payload?.["cognito:username"] || token.payload?.sub;
      const rawSceneContent = getRawSceneContent(editor, sceneId);
      const existingContent = getContentBeforeCursor(editor);
      const cursorPosition = from;
      const timeout = scope === "scene" ? 1200000 : 30000;

      // ── FIL-302 2d: Pre-AI dirty check ─────────────────────
      // If the current scene has been edited since last extraction,
      // tell the backend to extract synchronously before context assembly.
      let needsExtraction = false;
      let sceneContentForExtraction: string | undefined;

      if (sceneId !== "unknown" && isSceneDirty && getSceneTaggedContent) {
        if (isSceneDirty(sceneId)) {
          needsExtraction = true;
          sceneContentForExtraction = getSceneTaggedContent(sceneId) || undefined;
          console.log(`[useGuidedGeneration] Scene ${sceneId} is dirty — requesting pre-AI extraction`);
        }
      }

      try {
        const res = await safeApiCall(
          "scripts",
          {
            event: "guided-generate",
            userId,
            storyId,
            scene_id: sceneId,
            scope_selection: scope,
            direction: direction || undefined,
            raw_current_scene_content: rawSceneContent,
            existing_scene_content: existingContent,
            cursor_position: cursorPosition,
            story_metadata: storyData?.story_metadata || {},
            segments: storyData?.segments,
            // FIL-302 2d: Pre-AI extraction flag
            ...(needsExtraction && {
              needsExtraction: true,
              scene_content_for_extraction: sceneContentForExtraction,
            }),
          },
          token.toString(),
          { timeout }
        );

        if (!res.success || !res.data) {
          throw new Error(res.error || "Generation failed");
        }

        const body = parseResponseBody(res.data);
        console.log("── Guided Generate Response ──", body);

        updateTokenBalance(body, setUser);

        const text =
          body.generated_text ||
          body.scene_text ||
          body.text ||
          body.content ||
          body.replacement;

        if (!text) {
          console.warn("Response body keys:", Object.keys(body));
          throw new Error("No content returned — check console for response shape");
        }

        sessionIdRef.current = body.sessionId || body.session_id || null;

        const html = convertTaggedContentToHTML(text);
        const insertAt = insertionPointRef.current ?? from;

        const htmlWithSceneId = html.replace(
          /<p([^>]*data-line-type="[^"]+")([^>]*)>/g,
          `<p$1 data-scene-id="${sceneId}"$2>`
        );

        // ── Insert and measure precise range ──
        const range = insertAndMeasure(editor, insertAt, htmlWithSceneId);
        insertedRangeRef.current = range;

        // ── Mark the inserted paragraphs at the schema level so the green
        //    highlight survives PaginatedEditor's overflow split ──
        markPendingRange(editor, range.from, range.to);

        setResultText(text);
        setState("pending");
      } catch (err: any) {
        console.error("[useGuidedGeneration] generate error:", err);
        setError(err?.message || "Generation failed. Please try again.");
        setState("idle");
      }
    },
    [editor, token, storyId, storyData, setUser, isSceneDirty, getSceneTaggedContent]
  );

// ─────────────────────────────────────────
  // Accept
  // FIL-315: Added storyMetadata and existingCharacterDatabase to the
  // extract-scene-to-graph payload so the Character Analysis Lambda has
  // full context for character extraction and roster merging.
  // ─────────────────────────────────────────

  const accept = useCallback(() => {
    if (!editor || state !== "pending") return;

    clearAllDecorations(editor);
    clearPendingMarksEverywhere();

    const sceneId = insertionSceneIdRef.current;

    if (sceneId && sceneId !== "unknown" && token && storyId) {
      const updatedContent = getRawSceneContent(editor, sceneId);
      const userId = token.payload?.["cognito:username"] || token.payload?.sub;
      safeApiCall(
        "scripts",
        {
          event: "extract-scene-to-graph",
          userId,
          storyId,
          sceneId,
          sceneContent: updatedContent,
          // FIL-315: Context for character analysis
          storyMetadata: storyData?.story_metadata || {},
          existingCharacterDatabase: storyData?.character_database || {},
        },
        token.toString()
      ).catch((err) => console.warn("[useGuidedGeneration] graph write-back failed:", err));

      // ── FIL-302: Sync baseline hash after accept ────────────
      if (markSceneExtracted) {
        markSceneExtracted(sceneId);
        console.log(`[useGuidedGeneration] Baseline hash synced for ${sceneId} — navigation trigger will skip`);
      }
    }

    setState("resolved");
    setTimeout(() => {
      dismiss();
    }, 150);
  }, [editor, state, token, storyId, storyData, markSceneExtracted, clearPendingMarksEverywhere]);

  // ─────────────────────────────────────────
  // Remove
  // ─────────────────────────────────────────

  const remove = useCallback(() => {
    if (!editor || state !== "pending") return;

    clearAllDecorations(editor);
    clearPendingMarksEverywhere();

    const range = insertedRangeRef.current;
    if (range) {
      editor.chain().focus().deleteRange(range).run();
    }

    setState("resolved");
    setTimeout(() => {
      dismiss();
    }, 150);
  }, [editor, state, clearPendingMarksEverywhere]);

  // ─────────────────────────────────────────
  // Retry
  // ─────────────────────────────────────────

  const retry = useCallback(
    async (retryDirection?: string) => {
      if (!editor || !token) return;

      clearAllDecorations(editor);
      clearPendingMarksEverywhere();

      const range = insertedRangeRef.current;
      if (range) {
        editor.chain().focus().deleteRange(range).run();
      }
      insertedRangeRef.current = null;
      setResultText(null);
      setState("loading");

      const userId = token.payload?.["cognito:username"] || token.payload?.sub;
      const timeout = scopeRef.current === "scene" ? 60000 : 30000;

      try {
        let res: any;

        if (sessionIdRef.current) {
          res = await safeApiCall(
            "scripts",
            {
              event: "guided-generate-retry",
              userId,
              sessionId: sessionIdRef.current,
              retry_direction: retryDirection || undefined,
            },
            token.toString(),
            { timeout }
          );
        } else {
          res = await safeApiCall(
            "scripts",
            {
              event: "guided-generate",
              userId,
              storyId,
              scene_id: insertionSceneIdRef.current || "unknown",
              scope_selection: scopeRef.current,
              direction: retryDirection || directionRef.current || undefined,
              raw_current_scene_content: getRawSceneContent(
                editor,
                insertionSceneIdRef.current || "unknown"
              ),
              existing_scene_content: getContentBeforeCursor(editor),
              cursor_position: insertionPointRef.current ?? 0,
              story_metadata: storyData?.story_metadata || {},
              segments: storyData?.segments,
            },
            token.toString(),
            { timeout }
          );
        }

        if (!res.success || !res.data) {
          throw new Error(res.error || "Retry failed");
        }

        const body = parseResponseBody(res.data);
        console.log("── Guided Generate Retry Response ──", body);

        updateTokenBalance(body, setUser);

        const text =
          body.generated_text ||
          body.scene_text ||
          body.text ||
          body.content ||
          body.replacement;

        if (!text) {
          console.warn("Retry response body keys:", Object.keys(body));
          throw new Error("No content returned on retry");
        }

        sessionIdRef.current = body.sessionId || body.session_id || sessionIdRef.current;

        const html = convertTaggedContentToHTML(text);
        const sceneId = insertionSceneIdRef.current || "unknown";
        const insertAt = insertionPointRef.current ?? editor.state.selection.from;

        const htmlWithSceneId = html.replace(
          /<p([^>]*data-line-type="[^"]+")([^>]*)>/g,
          `<p$1 data-scene-id="${sceneId}"$2>`
        );

        // ── Insert and measure precise range ──
        const newRange = insertAndMeasure(editor, insertAt, htmlWithSceneId);
        insertedRangeRef.current = newRange;

        // ── Mark the inserted paragraphs at the schema level so the green
        //    highlight survives PaginatedEditor's overflow split ──
        markPendingRange(editor, newRange.from, newRange.to);

        setResultText(text);
        setState("pending");
      } catch (err: any) {
        console.error("[useGuidedGeneration] retry error:", err);
        setError(err?.message || "Retry failed.");
        setState("idle");
      }
    },
    [editor, token, storyId, storyData, setUser, clearPendingMarksEverywhere]
  );

  // ─────────────────────────────────────────
  // Dismiss
  // ─────────────────────────────────────────

  const dismiss = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      clearAllDecorations(editor);
    }
    clearPendingMarksEverywhere();

    setState("idle");
    setResultText(null);
    setError(null);
    sessionIdRef.current = null;
    insertionPointRef.current = null;
    insertedRangeRef.current = null;
    insertionSceneIdRef.current = null;
  }, [editor, clearPendingMarksEverywhere]);

  // ─────────────────────────────────────────
  // Expose
  // ─────────────────────────────────────────

  const currentSceneId = editor ? getSceneIdFromSelection(editor) : null;

  return {
    state,
    error,
    resultText,
    generate,
    accept,
    remove,
    retry,
    dismiss,
    currentSceneId,
    scope: scopeRef.current,
    direction: directionRef.current,
  };
}

export default useGuidedGeneration;