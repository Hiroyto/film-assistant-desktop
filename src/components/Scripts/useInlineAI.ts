/**
 * useInlineAI.ts
 * ==============
 * Custom hook for inline revision and suggestion workflows.
 *
 * State machine:
 *   idle → revise (loading → auto-apply inline) → pending → idle
 *   idle → suggest (loading → cards in rail) → pick card → revise (loading) → pending → idle
 *
 * Suggestions are editorial notes (not screenplay text). When the user
 * selects a suggestion card, it fires a revision call using the
 * suggestion text as the direction. The revision result applies inline
 * with paragraph-level diff highlighting.
 *
 * FIL-285
 * FIL-302 Step 2d: Pre-AI dirty check. If the current scene has been
 * edited since last extraction, sends needsExtraction flag + tagged
 * content so the backend extracts synchronously before context assembly.
 *
 * FIL-315: Editor lock + loading overlay during revise/suggest.
 * - Sets editor.setEditable(false) during API calls
 * - Shows loadingTarget decoration for shimmer overlay positioning
 * - Restores editable state on completion/error
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Editor } from "@tiptap/react";
import { safeApiCall } from "../../models/apiHelpers";
import { createAiLockWatchdog, AiLockWatchdog } from "../../features/scripts/model/aiLockWatchdog";
import { convertTaggedContentToHTML } from "./editorUtils";
import {
  getSelectedTaggedText,
  getSelectedLineType,
  findSpeakingCharacter,
  getSceneIdFromSelection,
  getRawSceneContent,
  lineTypeToTag,
  selectionSpansMultipleScenes,
} from "./InlineAIHelpers";
import {
  showChangedRanges,
  clearAllDecorations,
  showLoadingTarget,
  showSelectionTarget,
} from "./InlineAIDecorationPlugin";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type InlineAIMode = "idle" | "revise" | "suggest" | "pending";

interface Suggestion {
  text: string;
  rationale: string;
}

interface UseInlineAIProps {
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
  /** Called when user tries to revise/suggest across scene boundaries */
  onCrossSceneWarning?: () => void;
}

interface InsertedRange {
  from: number;
  to: number;
}

export interface UseInlineAIReturn {
  mode: InlineAIMode;
  isLoading: boolean;
  error: string | null;
  revisionResult: string | null;
  suggestions: Suggestion[] | null;
  /** The mode used for the current/last loading operation (for overlay color) */
  loadingMode: "revise" | "suggest" | null;
  revise: (direction: string) => Promise<void>;
  suggest: (direction?: string) => Promise<void>;
  retry: (retryDirection?: string) => Promise<void>;
  applyRevision: () => void;
  applySuggestion: (index: number) => void;
  acceptPending: () => void;
  rejectPending: () => void;
  dismiss: () => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const parseResponseBody = (data: any): any => {
  try {
    if (typeof data?.body === "string") return JSON.parse(data.body);
    return data?.body || data || {};
  } catch {
    return data?.body || data || {};
  }
};

function collectParagraphs(
  editor: Editor,
  from: number,
  to: number
): Array<{ text: string; from: number; to: number }> {
  const paragraphs: Array<{ text: string; from: number; to: number }> = [];
  const doc = editor.state.doc;
  const safeFrom = Math.max(0, from);
  const safeTo = Math.min(doc.content.size, to);

  doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
    if (node.isTextblock) {
      const blockStart = pos + 1;
      const blockEnd = pos + node.nodeSize - 1;
      const decoFrom = Math.max(safeFrom, blockStart);
      const decoTo = Math.min(safeTo, blockEnd);
      if (decoFrom < decoTo && node.textContent.trim().length > 0) {
        paragraphs.push({ text: node.textContent.trim(), from: decoFrom, to: decoTo });
      }
    }
  });

  return paragraphs;
}

function replaceAndMeasure(
  editor: Editor,
  from: number,
  to: number,
  html: string
): InsertedRange {
  const sizeBefore = editor.state.doc.content.size;

  // Clamp range to valid doc positions
  const docSize = editor.state.doc.content.size;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(safeFrom, Math.min(to, docSize));

  // Use deleteRange + insertContentAt as separate steps to ensure
  // the delete actually happens before the insert
  editor.chain().focus().deleteRange({ from: safeFrom, to: safeTo }).run();

  // After delete, insert at the (now-collapsed) position
  editor.chain().insertContentAt(safeFrom, html, {
    parseOptions: { preserveWhitespace: false },
  }).run();

  const sizeAfter = editor.state.doc.content.size;
  const originalLength = safeTo - safeFrom;
  const delta = sizeAfter - sizeBefore;
  const newLength = originalLength + delta;

  return { from: safeFrom, to: safeFrom + newLength };
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export function useInlineAI({
  editor,
  token,
  storyData,
  storyId,
  setUser,
  isSceneDirty,
  getSceneTaggedContent,
  markSceneExtracted,
  onCrossSceneWarning,
}: UseInlineAIProps): UseInlineAIReturn {
  const [mode, setMode] = useState<InlineAIMode>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisionResult, setRevisionResult] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [loadingMode, setLoadingMode] = useState<"revise" | "suggest" | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const lastModeRef = useRef<InlineAIMode>("idle");
  /** Tracks whether user initiated from suggest or revise panel — used for loading color */
  const panelModeRef = useRef<"revise" | "suggest">("revise");
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null);
  const selectionSceneIdRef = useRef<string | null>(null);

  // Pending state refs
  const pendingRangeRef = useRef<InsertedRange | null>(null);
  const originalTaggedTextRef = useRef<string | null>(null);
  const originalParagraphsRef = useRef<string[]>([]);
  const originalRangeRef = useRef<{ from: number; to: number } | null>(null);

  // FIL-315: Track whether we locked the editor so we restore correctly
  const editorWasLockedRef = useRef(false);

  // FIL-315 / COD-004: AI-lock watchdog. If the unlock path is lost (e.g. an
  // unhandled error during the AI call), force-unlocks the editor after 120s +
  // grace so the user is never stuck. Adopted WITHOUT touching the editor logic
  // (RISK-002 canary).
  const unlockEditorRef = useRef<() => void>(() => {});
  const watchdogRef = useRef<AiLockWatchdog | null>(null);
  if (!watchdogRef.current) {
    watchdogRef.current = createAiLockWatchdog((op) => {
      console.warn(`[useInlineAI] AI lock watchdog fired (op=${op}) — forcing unlock (FIL-315)`);
      unlockEditorRef.current();
    });
  }

  // ── FIL-315: Editor lock helpers ─────────────────────────────
  const lockEditor = useCallback((loadMode: "revise" | "suggest") => {
    if (!editor || editor.isDestroyed) return;
    editorWasLockedRef.current = true;
    setLoadingMode(loadMode);

    // Snapshot the original tagged text NOW while the selection is still valid.
    // After locking + clearing selection, getSelectedTaggedText will return empty.
    const range = selectionRangeRef.current;
    if (range) {
      try {
        const origTagged = getSelectedTaggedText(editor);
        originalTaggedTextRef.current = origTagged;
        originalRangeRef.current = { from: range.from, to: range.to };

        // Snapshot original paragraphs for diff comparison later
        const origParagraphs = collectParagraphs(editor, range.from, range.to);
        originalParagraphsRef.current = origParagraphs.map(p => p.text);
      } catch (err) {
        console.warn("[useInlineAI] Failed to snapshot selection:", err);
      }

      showLoadingTarget(editor, range.from, range.to, loadMode);
    }

    // Lock the editor AFTER applying the decoration
    editor.setEditable(false);

    // Clear the browser's native selection so it doesn't overlay
    // our decoration with the default blue highlight
    window.getSelection()?.removeAllRanges();

    // FIL-315: arm the watchdog so a lost unlock path can't strand the editor.
    watchdogRef.current?.start(loadMode);
  }, [editor]);

  const unlockEditor = useCallback(() => {
    watchdogRef.current?.clear(); // FIL-315: normal unlock path — disarm the watchdog
    if (!editor || editor.isDestroyed) return;
    if (editorWasLockedRef.current) {
      editor.setEditable(true);
      editorWasLockedRef.current = false;
    }
    setLoadingMode(null);
  }, [editor]);

  // Keep the watchdog's forced-unlock pointing at the latest unlockEditor; clear on unmount.
  useEffect(() => {
    unlockEditorRef.current = unlockEditor;
  }, [unlockEditor]);
  useEffect(() => () => watchdogRef.current?.clear(), []);

  // ── Token balance ────────────────────────────────────────────
  const updateTokenBalance = useCallback(
    (body: any) => {
      const balance = body?.remaining_balance ?? body?.cap;
      if (balance != null) {
        setUser((prev: any) => ({ ...prev, tokenBalance: balance }));
      }
    },
    [setUser]
  );

  // ── FIL-302 2d: Pre-AI dirty check helper ────────────────────
  const getDirtyExtractionFields = useCallback(
    (sceneId: string | null): Record<string, any> => {
      if (!sceneId || sceneId === "unknown" || !isSceneDirty || !getSceneTaggedContent) {
        return {};
      }
      if (!isSceneDirty(sceneId)) {
        return {};
      }
      const content = getSceneTaggedContent(sceneId) || undefined;
      console.log(`[useInlineAI] Scene ${sceneId} is dirty — requesting pre-AI extraction`);
      return {
        needsExtraction: true,
        scene_content_for_extraction: content,
      };
    },
    [isSceneDirty, getSceneTaggedContent]
  );

  // ── Payload builder ──────────────────────────────────────────
  const buildPayload = useCallback(
    (eventType: string, extras: Record<string, any> = {}) => {
      if (!editor || !token) return null;

      const { from, to } = editor.state.selection;
      const selectedText = getSelectedTaggedText(editor);
      const selectedLineType = getSelectedLineType(editor);
      const sceneId = getSceneIdFromSelection(editor);
      const speakingCharacter =
        selectedLineType === "DL"
          ? findSpeakingCharacter(editor, from)
          : null;
      const rawSceneContent = sceneId
        ? getRawSceneContent(editor, sceneId)
        : "";

      selectionRangeRef.current = { from, to };
      selectionSceneIdRef.current = sceneId;

      // When there's no selection (cursor-only), capture the content before
      // and after the cursor within the current scene so the backend knows
      // where in the scene to generate continuation suggestions from.
      let cursorContext: Record<string, string> = {};
      if (from === to && sceneId && rawSceneContent) {
        try {
          const beforeLines: string[] = [];
          const afterLines: string[] = [];
          let hitCursor = false;

          editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos) => {
            if (!node.isTextblock) return;
            if (node.attrs["data-scene-id"] !== sceneId) return;
            const contentEnd = pos + node.nodeSize;
            if (contentEnd <= from) {
              const lt = node.attrs.lineType || "description";
              const tag = lineTypeToTag(lt);
              if (node.textContent.trim()) beforeLines.push(`[<${tag}>]: ${node.textContent}`);
            } else if (pos >= from) {
              if (!hitCursor) hitCursor = true;
              const lt = node.attrs.lineType || "description";
              const tag = lineTypeToTag(lt);
              if (node.textContent.trim()) afterLines.push(`[<${tag}>]: ${node.textContent}`);
            }
          });

          cursorContext = {
            content_before_cursor: beforeLines.join("\n"),
            content_after_cursor: afterLines.join("\n"),
          };
        } catch (err) {
          console.warn("[useInlineAI] Failed to capture cursor context:", err);
        }
      }

      const payload = {
        event: eventType,
        userId: token.payload?.["cognito:username"] || token.payload?.sub,
        storyId,
        scene_id: sceneId || "unknown",
        selected_text: selectedText,
        selected_line_type: selectedLineType,
        speaking_character: speakingCharacter,
        raw_current_scene_content: rawSceneContent,
        story_metadata: storyData?.story_metadata || undefined,
        ...cursorContext,
        ...getDirtyExtractionFields(sceneId),
        ...extras,
      };

      console.log(`[useInlineAI] buildPayload (${eventType}):`, {
        sceneId,
        hasSelection: from !== to,
        selectedTextLength: selectedText.length,
        rawSceneContentLength: rawSceneContent.length,
        hasCursorContext: !!cursorContext.content_before_cursor,
        contentBeforeCursorLength: cursorContext.content_before_cursor?.length || 0,
      });

      return payload;
    },
    [editor, token, storyData, storyId, getDirtyExtractionFields]
  );

  /**
   * Build a revision payload using stored selection state.
   * Uses pos parameter from nodesBetween to filter out nodes
   * that only partially overlap the selection boundary.
   */
  const buildRevisionPayloadFromRefs = useCallback(
    (direction: string) => {
      if (!editor || !token || !selectionRangeRef.current) return null;

      const { from, to } = selectionRangeRef.current;
      const sceneId = selectionSceneIdRef.current || "unknown";

      let selectedText = "";
      try {
        editor.state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isTextblock) {
            // Only include nodes whose content start is within the selection range.
            // nodesBetween can return nodes that merely touch the boundary —
            // the content starts at pos+1 (after the opening token).
            const contentStart = pos + 1;
            const contentEnd = pos + node.nodeSize - 1;
            // Skip if the node's content is entirely outside our selection
            if (contentEnd <= from || contentStart >= to) return;

            const lineType = node.attrs.lineType || "description";
            const tag = lineTypeToTag(lineType);
            const text = node.textContent.trim();
            if (text) selectedText += `[<${tag}>]: ${text}\n`;
          }
        });
      } catch {
        selectedText = "(selection unavailable)";
      }

      const rawSceneContent = sceneId !== "unknown"
        ? getRawSceneContent(editor, sceneId)
        : "";

      return {
        event: "inline-revise",
        userId: token.payload?.["cognito:username"] || token.payload?.sub,
        storyId,
        scene_id: sceneId,
        selected_text: selectedText.trim(),
        selected_line_type: null,
        speaking_character: null,
        raw_current_scene_content: rawSceneContent,
        story_metadata: storyData?.story_metadata || undefined,
        user_direction: direction,
        ...getDirtyExtractionFields(sceneId),
      };
    },
    [editor, token, storyId, storyData, getDirtyExtractionFields]
  );

  // ── Graph write-back ─────────────────────────────────────────
  const writeBackToGraph = useCallback(
    async (sceneId: string, sceneContent: string) => {
      if (!token || !storyId) return;
      try {
        await safeApiCall(
          "scripts",
          {
            event: "extract-scene-to-graph",
            userId: token.payload?.["cognito:username"] || token.payload?.sub,
            storyId,
            sceneId,
            sceneContent,
          },
          token.toString()
        );
      } catch (err) {
        console.warn("Graph write-back failed:", err);
      }
    },
    [token, storyId]
  );

  // ── Full reset ───────────────────────────────────────────────
  const dismiss = useCallback(() => {
    if (editor && !editor.isDestroyed) clearAllDecorations(editor);
    unlockEditor();
    setMode("idle");
    setIsLoading(false);
    setError(null);
    setRevisionResult(null);
    setSuggestions(null);
    setLoadingMode(null);
    sessionIdRef.current = null;
    lastModeRef.current = "idle";
    selectionRangeRef.current = null;
    selectionSceneIdRef.current = null;
    pendingRangeRef.current = null;
    originalTaggedTextRef.current = null;
    originalParagraphsRef.current = [];
    originalRangeRef.current = null;
  }, [editor, unlockEditor]);

  // ─────────────────────────────────────────
  // Apply text inline with paragraph-level diff
  // ─────────────────────────────────────────

  const applyTextInline = useCallback(
    (taggedText: string) => {
      if (!editor || !selectionRangeRef.current) return;

      const { from, to } = selectionRangeRef.current;
      const sceneId = selectionSceneIdRef.current || "unknown";

      // FIL-315: Clear loading decorations first (while still non-editable
      // is fine — decoration dispatches are view-level, not content-level),
      // then unlock editor before modifying content.
      clearAllDecorations(editor);
      unlockEditor();

      // Verify the range is still valid after unlock
      const docSize = editor.state.doc.content.size;
      const safeFrom = Math.min(from, docSize);
      const safeTo = Math.min(to, docSize);

      console.log("[useInlineAI] applyTextInline:", {
        from: safeFrom, to: safeTo, docSize,
        rangeText: editor.state.doc.textBetween(safeFrom, safeTo, " ").substring(0, 80),
      });

      // Original tagged text and paragraphs were already snapshotted
      // in lockEditor() while the selection was still valid.
      // If lockEditor wasn't called (e.g. retry path), snapshot now as fallback.
      if (!originalTaggedTextRef.current) {
        try {
          originalTaggedTextRef.current = getSelectedTaggedText(editor);
          originalRangeRef.current = { from: safeFrom, to: safeTo };
          const origParagraphs = collectParagraphs(editor, safeFrom, safeTo);
          originalParagraphsRef.current = origParagraphs.map(p => p.text);
        } catch {
          console.warn("[useInlineAI] Fallback snapshot failed");
        }
      }

      // Convert and stamp
      const html = convertTaggedContentToHTML(taggedText);
      const htmlWithSceneId = html.replace(
        /<p([^>]*data-line-type="[^"]+")([^>]*)>/g,
        `<p$1 data-scene-id="${sceneId}"$2>`
      );

      // Replace and measure
      const range = replaceAndMeasure(editor, safeFrom, safeTo, htmlWithSceneId);
      pendingRangeRef.current = range;

      // Paragraph-level diff
      const newParagraphs = collectParagraphs(editor, range.from, range.to);
      const origTextSet = new Set(originalParagraphsRef.current);

      const changedRanges: Array<{ from: number; to: number }> = [];
      for (const para of newParagraphs) {
        if (!origTextSet.has(para.text)) {
          changedRanges.push({ from: para.from, to: para.to });
        }
      }

      if (changedRanges.length > 0) {
        showChangedRanges(editor, changedRanges);
      }

      setMode("pending");
    },
    [editor, unlockEditor]
  );

  // ─────────────────────────────────────────
  // Revision
  // ─────────────────────────────────────────

  const revise = useCallback(
    async (direction: string) => {
      if (!editor || !token) return;

      // Block operations that span multiple scenes
      if (selectionSpansMultipleScenes(editor)) {
        onCrossSceneWarning?.();
        return;
      }

      const payload = buildPayload("inline-revise", {
        user_direction: direction,
      });
      if (!payload) return;

      console.log("── Inline Revise Payload ──", payload);

      setMode("revise");
      lastModeRef.current = "revise";
      panelModeRef.current = "revise";
      setIsLoading(true);
      setError(null);
      setRevisionResult(null);

      // FIL-315: Lock editor and show loading overlay
      lockEditor("revise");

      try {
        const result = await safeApiCall(
          "scripts",
          payload,
          token.toString(),
          { timeout: 30000 }
        );

        if (!result.success || !result.data) {
          throw new Error(result.error || "Revision failed");
        }

        const body = parseResponseBody(result.data);
        console.log("── Inline Revise Response ──", body);

        updateTokenBalance(body);

        const replacement =
          body.replacement ||
          body.revised_text ||
          body.scene_text ||
          body.text;
        if (!replacement) {
          console.warn("Response body keys:", Object.keys(body));
          throw new Error("No revision returned");
        }

        sessionIdRef.current = body.sessionId || body.session_id || null;
        setRevisionResult(replacement);

        // Auto-apply inline (this also unlocks the editor)
        applyTextInline(replacement);
      } catch (err: any) {
        console.error("Inline revision error:", err);
        setError(err.message || "Revision failed");
        // FIL-315: Unlock on error
        unlockEditor();
        if (editor && !editor.isDestroyed) clearAllDecorations(editor);
      } finally {
        setIsLoading(false);
      }
    },
    [editor, token, buildPayload, updateTokenBalance, applyTextInline, lockEditor, unlockEditor]
  );

  // ─────────────────────────────────────────
  // Suggestion
  // ─────────────────────────────────────────

  const suggest = useCallback(
    async (direction?: string) => {
      if (!editor || !token) return;

      // Block operations that span multiple scenes
      if (selectionSpansMultipleScenes(editor)) {
        onCrossSceneWarning?.();
        return;
      }

      const extras: Record<string, any> = {};
      if (direction) extras.user_direction = direction;

      const payload = buildPayload("inline-suggest", extras);
      if (!payload) return;

      console.log("── Inline Suggest Payload ──", payload);

      setMode("suggest");
      lastModeRef.current = "suggest";
      panelModeRef.current = "suggest";
      setIsLoading(true);
      setError(null);
      setSuggestions(null);

      // FIL-315: Lock editor and show loading overlay
      lockEditor("suggest");

      try {
        const result = await safeApiCall(
          "scripts",
          payload,
          token.toString(),
          { timeout: 30000 }
        );

        if (!result.success || !result.data) {
          throw new Error(result.error || "Suggestion failed");
        }

        const body = parseResponseBody(result.data);
        console.log("── Inline Suggest Response ──", body);

        updateTokenBalance(body);

        if (!body.suggestions || !Array.isArray(body.suggestions)) {
          console.warn("Response body keys:", Object.keys(body));
          throw new Error("No suggestions returned");
        }

        sessionIdRef.current = body.sessionId || body.session_id || null;
        setSuggestions(body.suggestions);

        // FIL-315: Replace shimmer with selection target highlight so user
        // can see what text the suggestions apply to. Keep editor locked.
        if (editor && !editor.isDestroyed && selectionRangeRef.current) {
          showSelectionTarget(
            editor,
            selectionRangeRef.current.from,
            selectionRangeRef.current.to,
            "suggest"
          );
        }
      } catch (err: any) {
        console.error("Inline suggestion error:", err);
        setError(err.message || "Suggestion failed");
        // FIL-315: Unlock on error
        unlockEditor();
        if (editor && !editor.isDestroyed) clearAllDecorations(editor);
      } finally {
        setIsLoading(false);
      }
    },
    [editor, token, buildPayload, updateTokenBalance, lockEditor, unlockEditor]
  );

  // ─────────────────────────────────────────
  // Retry
  // ─────────────────────────────────────────

  const retry = useCallback(async (retryDirection?: string) => {
    if (!token || !sessionIdRef.current) return;

    // If in pending state, undo inline replacement first
    if (mode === "pending" && editor) {
      clearAllDecorations(editor);
      const pending = pendingRangeRef.current;
      const original = originalTaggedTextRef.current;
      const origRange = originalRangeRef.current;
      if (pending && original != null && origRange) {
        const sceneId = selectionSceneIdRef.current || "unknown";
        const origHtml = convertTaggedContentToHTML(original);
        const origHtmlWithScene = origHtml.replace(
          /<p([^>]*data-line-type="[^"]+")([^>]*)>/g,
          `<p$1 data-scene-id="${sceneId}"$2>`
        );

        // Clamp to current doc size to avoid Position out of range
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.max(0, Math.min(pending.from, docSize));
        const safeTo = Math.max(safeFrom, Math.min(pending.to, docSize));

        // Measure doc size before undo to calculate the re-inserted range
        const sizeBeforeUndo = editor.state.doc.content.size;

        // Split delete and insert into separate operations
        editor.chain().focus().deleteRange({ from: safeFrom, to: safeTo }).run();
        editor.chain().insertContentAt(safeFrom, origHtmlWithScene, {
          parseOptions: { preserveWhitespace: false },
        }).run();

        // Measure actual range after undo instead of using stale origRange
        const sizeAfterUndo = editor.state.doc.content.size;
        const deletedLength = safeTo - safeFrom;
        const undoDelta = sizeAfterUndo - sizeBeforeUndo;
        const restoredLength = deletedLength + undoDelta;
        selectionRangeRef.current = { from: safeFrom, to: safeFrom + restoredLength };

        // Re-snapshot the original text for the next apply cycle
        try {
          const restoredParagraphs = collectParagraphs(editor, safeFrom, safeFrom + restoredLength);
          originalParagraphsRef.current = restoredParagraphs.map(p => p.text);

          let restoredTagged = "";
          editor.state.doc.nodesBetween(safeFrom, safeFrom + restoredLength, (node, pos) => {
            if (node.isTextblock) {
              const contentStart = pos + 1;
              const contentEnd = pos + node.nodeSize - 1;
              if (contentEnd <= safeFrom || contentStart >= safeFrom + restoredLength) return;
              const lt = node.attrs.lineType || "description";
              const tag = lineTypeToTag(lt);
              const text = node.textContent.trim();
              if (text) restoredTagged += `[<${tag}>]: ${text}\n`;
            }
          });
          originalTaggedTextRef.current = restoredTagged.trim();
          originalRangeRef.current = { from: safeFrom, to: safeFrom + restoredLength };
        } catch (err) {
          console.warn("[useInlineAI] Failed to re-snapshot after undo:", err);
        }
      } else {
        pendingRangeRef.current = null;
        originalTaggedTextRef.current = null;
        originalParagraphsRef.current = [];
        originalRangeRef.current = null;
      }
    }

    const retryEvent =
      lastModeRef.current === "revise"
        ? "inline-revise-retry"
        : "inline-suggest-retry";

    setMode(lastModeRef.current === "idle" ? "revise" : lastModeRef.current);
    setIsLoading(true);
    setError(null);

    // FIL-315: Lock editor during retry — use panelModeRef for visual color
    lockEditor(panelModeRef.current);

    try {
      const result = await safeApiCall(
        "scripts",
        {
          event: retryEvent,
          userId: token.payload?.["cognito:username"] || token.payload?.sub,
          sessionId: sessionIdRef.current,
          retry_direction: retryDirection || undefined,
        },
        token.toString(),
        { timeout: 30000 }
      );

      if (!result.success || !result.data) {
        throw new Error(result.error || "Retry failed");
      }

      const body = parseResponseBody(result.data);
      console.log("── Inline Retry Response ──", body);

      updateTokenBalance(body);
      sessionIdRef.current =
        body.sessionId || body.session_id || sessionIdRef.current;

      if (lastModeRef.current === "revise") {
        const replacement =
          body.replacement ||
          body.revised_text ||
          body.scene_text ||
          body.text;
        if (!replacement) throw new Error("No revision returned");
        setRevisionResult(replacement);
        applyTextInline(replacement);
      } else {
        if (!body.suggestions) throw new Error("No suggestions returned");
        setSuggestions(body.suggestions);
        setMode("suggest");
        // Show selection highlight while cards are displayed
        if (editor && !editor.isDestroyed && selectionRangeRef.current) {
          showSelectionTarget(
            editor,
            selectionRangeRef.current.from,
            selectionRangeRef.current.to,
            "suggest"
          );
        }
      }
    } catch (err: any) {
      console.error("Retry error:", err);
      setError(err.message || "Retry failed");
      unlockEditor();
      if (editor && !editor.isDestroyed) clearAllDecorations(editor);
    } finally {
      setIsLoading(false);
    }
  }, [token, mode, editor, updateTokenBalance, applyTextInline, lockEditor, unlockEditor]);

  // ─────────────────────────────────────────
  // Apply revision (manual trigger if needed)
  // ─────────────────────────────────────────

  const applyRevision = useCallback(() => {
    if (!revisionResult) return;
    applyTextInline(revisionResult);
  }, [revisionResult, applyTextInline]);

  // ─────────────────────────────────────────
  // Apply suggestion — fires a REVISION using
  // the suggestion text as direction.
  // ─────────────────────────────────────────

  const applySuggestion = useCallback(
    async (index: number) => {
      if (!suggestions || !suggestions[index] || !editor || !token) return;

      const suggestionDirection = suggestions[index].text;

      console.log("── Applying suggestion as revision direction ──", {
        index,
        direction: suggestionDirection,
      });

      const payload = buildRevisionPayloadFromRefs(suggestionDirection);
      if (!payload) return;

      console.log("── Suggestion → Revision Payload ──", payload);

      setMode("revise");
      lastModeRef.current = "revise";
      setIsLoading(true);
      setError(null);
      setRevisionResult(null);

      // FIL-315: Lock editor during suggestion→revision (purple, since user is in suggest flow)
      lockEditor("suggest");

      try {
        const result = await safeApiCall(
          "scripts",
          payload,
          token.toString(),
          { timeout: 30000 }
        );

        if (!result.success || !result.data) {
          throw new Error(result.error || "Revision from suggestion failed");
        }

        const body = parseResponseBody(result.data);
        console.log("── Suggestion → Revision Response ──", body);

        updateTokenBalance(body);

        const replacement =
          body.replacement ||
          body.revised_text ||
          body.scene_text ||
          body.text;
        if (!replacement) {
          console.warn("Response body keys:", Object.keys(body));
          throw new Error("No revision returned from suggestion");
        }

        sessionIdRef.current = body.sessionId || body.session_id || null;
        setRevisionResult(replacement);

        // Apply inline with diff (unlocks editor)
        applyTextInline(replacement);
      } catch (err: any) {
        console.error("Suggestion → revision error:", err);
        setError(err.message || "Failed to apply suggestion");
        setMode("suggest"); // Go back to cards so user can try another
        unlockEditor();
        if (editor && !editor.isDestroyed) clearAllDecorations(editor);
      } finally {
        setIsLoading(false);
      }
    },
    [suggestions, editor, token, buildRevisionPayloadFromRefs, updateTokenBalance, applyTextInline, lockEditor, unlockEditor]
  );

  // ─────────────────────────────────────────
  // Accept pending
  // ─────────────────────────────────────────

  const acceptPending = useCallback(() => {
    if (!editor || mode !== "pending") return;

    clearAllDecorations(editor);

    const sceneId = selectionSceneIdRef.current;
    if (sceneId && sceneId !== "unknown") {
      const updatedContent = getRawSceneContent(editor, sceneId);
      writeBackToGraph(sceneId, updatedContent);

      if (markSceneExtracted) {
        markSceneExtracted(sceneId);
        console.log(`[useInlineAI] Baseline hash synced for ${sceneId} — navigation trigger will skip`);
      }
    }

    setMode("idle");
    setRevisionResult(null);
    setSuggestions(null);
    setError(null);
    setIsLoading(false);
    setLoadingMode(null);
    pendingRangeRef.current = null;
    originalTaggedTextRef.current = null;
    originalParagraphsRef.current = [];
    originalRangeRef.current = null;
    sessionIdRef.current = null;
    selectionRangeRef.current = null;
    selectionSceneIdRef.current = null;
    lastModeRef.current = "idle";
  }, [editor, mode, writeBackToGraph, markSceneExtracted]);

  // ─────────────────────────────────────────
  // Reject pending
  // ─────────────────────────────────────────

  const rejectPending = useCallback(() => {
    if (!editor || mode !== "pending") return;

    clearAllDecorations(editor);

    const pending = pendingRangeRef.current;
    const original = originalTaggedTextRef.current;
    const origRange = originalRangeRef.current;

    if (pending && original != null && origRange) {
      const sceneId = selectionSceneIdRef.current || "unknown";
      const origHtml = convertTaggedContentToHTML(original);
      const origHtmlWithScene = origHtml.replace(
        /<p([^>]*data-line-type="[^"]+")([^>]*)>/g,
        `<p$1 data-scene-id="${sceneId}"$2>`
      );

      // Clamp to current doc size to avoid Position out of range
      const docSize = editor.state.doc.content.size;
      const safeFrom = Math.max(0, Math.min(pending.from, docSize));
      const safeTo = Math.max(safeFrom, Math.min(pending.to, docSize));

      editor.chain().focus().deleteRange({ from: safeFrom, to: safeTo }).run();
      editor.chain().insertContentAt(safeFrom, origHtmlWithScene, {
        parseOptions: { preserveWhitespace: false },
      }).run();
    }

    setMode("idle");
    setRevisionResult(null);
    setSuggestions(null);
    setError(null);
    setIsLoading(false);
    setLoadingMode(null);
    pendingRangeRef.current = null;
    originalTaggedTextRef.current = null;
    originalParagraphsRef.current = [];
    originalRangeRef.current = null;
    sessionIdRef.current = null;
    selectionRangeRef.current = null;
    selectionSceneIdRef.current = null;
    lastModeRef.current = "idle";
  }, [editor, mode]);

  // ─────────────────────────────────────────
  // Expose
  // ─────────────────────────────────────────

  return {
    mode,
    isLoading,
    error,
    revisionResult,
    suggestions,
    loadingMode,
    revise,
    suggest,
    retry,
    applyRevision,
    applySuggestion,
    acceptPending,
    rejectPending,
    dismiss,
  };
}

export default useInlineAI;