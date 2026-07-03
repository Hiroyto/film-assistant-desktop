/**
 * useExtractionTracking.ts
 * ========================
 * Session baseline hash system for Neptune extraction staleness tracking.
 * FIL-302 Step 2b.
 *
 * On editor load, hashes the tagged content of every scene that has beat
 * structure (data-scene-id). Stores these hashes in sessionStorage as
 * the session baseline. During the session, compares current content
 * against the baseline to determine if a scene is "dirty" (needs
 * re-extraction to Neptune).
 *
 * This hook does NOT talk to Neptune or call any APIs. It's a pure
 * bookkeeper that answers one question: "did this scene's content change
 * since we last looked at it?"
 *
 * Imported by: Scripts.tsx (or ScriptEditor.tsx)
 *
 * Usage:
 *   const { isSceneDirty, markSceneExtracted, getSceneTaggedContent } =
 *     useExtractionTracking({ editor: editorRef.current });
 */

import { useCallback, useEffect, useRef } from "react";
import { Editor } from "@tiptap/react";

// ============================================
// TYPES
// ============================================

interface UseExtractionTrackingParams {
  /**
   * Returns every currently-mounted page editor. Pagination splits a script
   * across multiple TipTap editor instances (one per page), and a single
   * scene's content can live on any one of them — so dirty checks and
   * content collection must walk all of them, not just the focused page.
   */
  getEditors: () => Editor[];
  /**
   * The currently-focused editor. Used only as a "editor system is mounted"
   * signal that triggers the one-time baseline snapshot. All actual content
   * reads go through getEditors().
   */
  editor: Editor | null;
  /** Story ID — used as namespace in sessionStorage keys to avoid cross-story collisions. */
  storyId: string | null;
}

interface UseExtractionTrackingReturn {
  /** Check if a scene's content has changed since the baseline (or last extraction). */
  isSceneDirty: (sceneId: string) => boolean;
  /** Update the baseline hash after a successful extraction. Call this when the extraction Lambda confirms success. */
  markSceneExtracted: (sceneId: string) => void;
  /** Get the tagged screenplay text for a scene. Used to send content to the extraction Lambda. */
  getSceneTaggedContent: (sceneId: string) => string | null;
  /** Snapshot all scenes' content as the session baseline. Called on editor load. */
  snapshotBaseline: () => void;
  /** Check if the baseline has been initialized for this session. */
  isBaselineReady: boolean;
}

// ============================================
// CONSTANTS
// ============================================

/** Prefix for sessionStorage keys. Format: extraction:{storyId}:{sceneId} */
const STORAGE_PREFIX = "extraction";

/** Map TipTap lineType attribute to tagged screenplay format */
const LINE_TYPE_TO_TAG: Record<string, string> = {
  scene: "SC",
  description: "AC",
  character: "CH",
  dialogue: "DL",
  parenthetical: "PA",
  transition: "TR",
};

// ============================================
// HASHING
// ============================================

/**
 * Fast, non-cryptographic string hash (djb2 variant).
 * Produces a consistent numeric hash for any string input.
 * We don't need cryptographic security — just a fast way to detect
 * whether content changed.
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // Convert to unsigned hex string for readability in sessionStorage
  return (hash >>> 0).toString(16);
}

// ============================================
// HOOK
// ============================================

export function useExtractionTracking({
  editor,
  getEditors,
  storyId,
}: UseExtractionTrackingParams): UseExtractionTrackingReturn {
  const baselineReadyRef = useRef(false);

  // ── sessionStorage key helpers ────────────────────────────

  const storageKey = useCallback(
    (sceneId: string): string => {
      return `${STORAGE_PREFIX}:${storyId || "unknown"}:${sceneId}`;
    },
    [storyId]
  );

  const getStoredHash = useCallback(
    (sceneId: string): string | null => {
      try {
        return sessionStorage.getItem(storageKey(sceneId));
      } catch {
        // sessionStorage might be unavailable (private browsing, storage full)
        return null;
      }
    },
    [storageKey]
  );

  const setStoredHash = useCallback(
    (sceneId: string, hash: string): void => {
      try {
        sessionStorage.setItem(storageKey(sceneId), hash);
      } catch {
        // Silently fail — extraction will just run every time
        console.warn(
          `[ExtractionTracking] Failed to write sessionStorage for ${sceneId}`
        );
      }
    },
    [storageKey]
  );

  // ── Content extraction from TipTap ────────────────────────

  /**
   * Walk the ProseMirror doc tree and extract tagged content for a specific
   * scene ID. Returns the content in the same tagged format the backend
   * expects: [<SC>]: INT. KITCHEN - DAY
   *
   * Returns null if the scene ID doesn't exist in the document or has no content.
   */
  const getSceneTaggedContent = useCallback(
    (sceneId: string): string | null => {
      const editors = getEditors();
      if (editors.length === 0) return null;

      const lines: string[] = [];

      // Walk every page editor in order; a scene that spans a page break
      // contributes lines from each page it touches.
      for (const ed of editors) {
        ed.state.doc.descendants((node) => {
          if (
            node.isBlock &&
            node.attrs["data-scene-id"] === sceneId &&
            node.textContent
          ) {
            const lineType = node.attrs.lineType || "description";
            const tag = LINE_TYPE_TO_TAG[lineType] || "AC";
            lines.push(`[<${tag}>]: ${node.textContent}`);
          }
        });
      }

      return lines.length > 0 ? lines.join("\n") : null;
    },
    [getEditors]
  );

  /**
   * Get all unique scene IDs currently in the editor document.
   * Only returns IDs that have actual content (at least one non-empty paragraph).
   */
  const getAllSceneIds = useCallback((): string[] => {
    const editors = getEditors();
    if (editors.length === 0) return [];

    const sceneIds = new Set<string>();

    for (const ed of editors) {
      ed.state.doc.descendants((node) => {
        if (node.isBlock && node.attrs["data-scene-id"] && node.textContent) {
          sceneIds.add(node.attrs["data-scene-id"]);
        }
      });
    }

    return Array.from(sceneIds);
  }, [getEditors]);

  // ── Core API ──────────────────────────────────────────────

  /**
   * Snapshot all scenes' content as the session baseline.
   * Called once on editor load. After this, any edit the user makes
   * will cause the hash to diverge from the baseline.
   */
  const snapshotBaseline = useCallback((): void => {
    if (!storyId || getEditors().length === 0) return;

    const sceneIds = getAllSceneIds();

    for (const sceneId of sceneIds) {
      const content = getSceneTaggedContent(sceneId);
      if (content) {
        const hash = hashString(content);
        setStoredHash(sceneId, hash);
      }
    }

    baselineReadyRef.current = true;

    console.log(
      `[ExtractionTracking] Baseline snapshot: ${sceneIds.length} scenes hashed for story ${storyId}`
    );
  }, [storyId, getEditors, getAllSceneIds, getSceneTaggedContent, setStoredHash]);

  /**
   * Check if a scene's content has changed since the baseline (or last extraction).
   *
   * Returns true if:
   * - The scene has no stored hash (never baselined — first time seeing this scene)
   * - The current content hash doesn't match the stored hash (content changed)
   *
   * Returns false if:
   * - The hashes match (content unchanged since baseline or last extraction)
   * - The editor isn't available (can't check, assume clean)
   * - The scene has no content (nothing to extract)
   */
  const isSceneDirty = useCallback(
    (sceneId: string): boolean => {
      if (getEditors().length === 0) return false;

      const content = getSceneTaggedContent(sceneId);
      if (!content) return false; // No content = nothing to extract

      const currentHash = hashString(content);
      const storedHash = getStoredHash(sceneId);

      if (storedHash === null) {
        // No baseline exists — this scene has never been seen.
        // This happens for scenes added after baseline snapshot.
        // Treat as dirty so it gets extracted on first trigger.
        return true;
      }

      return currentHash !== storedHash;
    },
    [getEditors, getSceneTaggedContent, getStoredHash]
  );

  /**
   * Update the baseline hash after a successful extraction.
   * Call this when the extraction Lambda confirms it processed the scene.
   *
   * This re-hashes the current content (not a stored copy) because the
   * user might have continued editing while extraction was in-flight.
   * If they did, the hash won't match next time and the scene will
   * correctly appear dirty again.
   */
  const markSceneExtracted = useCallback(
    (sceneId: string): void => {
      if (getEditors().length === 0) return;

      const content = getSceneTaggedContent(sceneId);
      if (content) {
        const hash = hashString(content);
        setStoredHash(sceneId, hash);
      }
    },
    [getEditors, getSceneTaggedContent, setStoredHash]
  );

  // ── Auto-snapshot on editor ready ─────────────────────────

  /**
   * When the editor becomes available and has content, take the baseline
   * snapshot. This runs once per session (or once per page refresh within
   * the same session — sessionStorage persists across refreshes, but
   * we re-snapshot to capture any changes that might have happened
   * outside the editor, like backend-generated content).
   */
  useEffect(() => {
    if (!editor || !storyId) return;

    // Small delay to ensure editor content is fully hydrated.
    // TipTap might still be processing setContent() when the
    // editor instance first becomes available.
    const timer = setTimeout(() => {
      snapshotBaseline();
    }, 500);

    return () => clearTimeout(timer);
  }, [editor, storyId]); // intentionally not including snapshotBaseline to avoid re-runs

  return {
    isSceneDirty,
    markSceneExtracted,
    getSceneTaggedContent,
    snapshotBaseline,
    isBaselineReady: baselineReadyRef.current,
  };
}