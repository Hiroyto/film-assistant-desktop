/**
 * useSceneGeneration.ts
 * =====================
 * Custom hook that orchestrates the 3-step AI scene generation pipeline.
 *
 * CHANGE: Added `onSceneInserted` prop — called immediately after generated
 * content is inserted into the editor so Scripts.tsx can trigger a save.
 * Without this, programmatic insertions (insertSceneInOrder) may not fire
 * the editor.on("update") listener reliably, causing generated scenes to
 * be lost if the user navigates away before the debounce window closes.
 *
 * CHANGE: Enhanced insertSceneInOrder with proper numerical ordering.
 * Scenes are now inserted at the correct position based on their label
 * (1.1, 1.2, 1.3, 2.1, 2.2, etc.) instead of always appending to the end.
 *
 * FIX: Multi-page editor support with DOM-based insertion. For paginated
 * editors, we insert directly into the DOM at the correct visual position
 * rather than trying to map DOM positions to ProseMirror positions.
 *
 * FIX: When inserting after a scene, we now find the LAST paragraph of that
 * scene, not the first one. This prevents splitting scenes in half.
 *
 * The scene generation process uses a "handoff" pattern where each step
 * builds on the previous one's output:
 *
 *   Step 1 (First Handoff):
 *     Input:  Scene description, full story structure, beat sheet
 *     Output: Raw screenplay text in tagged format ([<SC>]:, [<DL>]:, etc.)
 *     → Text is converted to HTML and inserted into the editor
 *
 *   Step 2 (Second Handoff):
 *     Input:  Generated scene content, conversation history from Step 1
 *     Output: Character/metadata analysis
 *     → Analysis is passed forward for character database updates
 *
 *   Step 3 (Third Handoff):
 *     Input:  Metadata analysis, existing character database, conversation history
 *     Output: Final character database updates
 *     → Character database is merged with new information
 *
 * All three steps call the scripts-management-app Lambda endpoint (`/scripts`)
 * with different flags (is_second_handoff, is_third_handoff) to route to the
 * right handler.
 *
 * FIL-295: modelOverride is passed in the first handoff payload to control
 * the writer model in the hybrid pipeline (structure is always GPT-5.1).
 *
 * FIL-302 Step 2d: Pre-AI dirty check. If the target scene has been edited
 * since last extraction, sends needsExtraction flag so the backend extracts
 * synchronously before context assembly.
 *
 * FIL-302 Navigation fix: Calls markSceneExtracted after WF3 inserts content
 * so the navigation trigger doesn't redundantly re-extract a scene that
 * Handoff 2 already extracted.
 * CHANGE LOG:
 * - Added `onSceneInserted` prop for immediate save after insertion
 * - FIL-295: modelOverride for hybrid writer pipeline
 * - FIL-302 2d: Pre-AI dirty check + markSceneExtracted
 * - FIL-315: Overlay dismisses after Handoff 1 (script visible).
 *            Steps 2+3 run in background. Removed updateTokenBalance
 *            from Handoff 3 (tokens deducted in Character Analysis Lambda).
 *
 * Usage:
 *   const {
 *     isGenerating,
 *     handoffStage,
 *     requestLog,
 *     responseLog,
 *     generateScene,
 *   } = useSceneGeneration({ editor, token, storyData, setUser, modelOverride });
 */

import { useState, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { toast } from "react-hot-toast";
import { safeApiCall } from "../../models/apiHelpers";
import { convertTaggedContentToHTML } from "./editorUtils";
import { Scene, ConversationMessage } from "./types";
// Seam de teste (specs 04/10): captura o conversation_history de cada handoff.
// Inerte em produção — no-op até a ponte de teste armar o recorder.
import {
  resetHandoffRecorder,
  recordHandoffHistory,
} from "../../features/scripts/model/handoffRecorder";

interface UseSceneGenerationProps {
  editor: Editor | null;
  token: any;
  storyData: any;
  setUser: (updater: (prev: any) => any) => void;
  onUpdatePositions?: (editor: Editor) => void;
  modelOverride?: string;
  onSceneInserted?: () => void;
  isSceneDirty?: (sceneId: string) => boolean;
  getSceneTaggedContent?: (sceneId: string) => string | null;
  markSceneExtracted?: (sceneId: string) => void;
}

interface UseSceneGenerationReturn {
  isGenerating: boolean;
  handoffStage: number;
  requestLog: string | null;
  responseLog: string | null;
  generateScene: (sceneId: string, segmentId?: string, sceneIndex?: number) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Compare scene labels numerically
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare two scene labels numerically.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 * 
 * Examples:
 *   compareSceneLabels("1.1", "1.2") → -1
 *   compareSceneLabels("1.3", "1.2") → 1
 *   compareSceneLabels("2.1", "1.9") → 1
 *   compareSceneLabels("1.2", "1.2") → 0
 */
function compareSceneLabels(a: string, b: string): number {
  const [segA, sceneA] = a.split(".").map(Number);
  const [segB, sceneB] = b.split(".").map(Number);

  if (segA !== segB) return segA - segB;
  return sceneA - sceneB;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Find all scenes in DOM
// ─────────────────────────────────────────────────────────────────────────────

interface SceneInfo {
  label: string;
  firstElement: Element;
  lastElement: Element;
  pageIndex: number;
}

/**
 * Find all scenes by scanning the DOM across all ProseMirror instances.
 * Returns scenes with BOTH first and last paragraph elements.
 */
function findAllScenesInDOM(): SceneInfo[] {
  const scenesMap = new Map<string, SceneInfo>();

  const allProseMirrors = document.querySelectorAll('.paginated-canvas .ProseMirror');

  console.log(`🔍 Scanning ${allProseMirrors.length} ProseMirror instance(s) for scenes`);

  allProseMirrors.forEach((proseMirror, pageIndex) => {
    const paragraphs = proseMirror.querySelectorAll('[data-scene-id]');

    paragraphs.forEach((p) => {
      const sceneId = p.getAttribute('data-scene-id');
      if (!sceneId) return;

      if (!scenesMap.has(sceneId)) {
        // First paragraph of this scene
        scenesMap.set(sceneId, {
          label: sceneId,
          firstElement: p,
          lastElement: p,
          pageIndex,
        });
      } else {
        // Update last paragraph of this scene
        const scene = scenesMap.get(sceneId)!;
        scene.lastElement = p;
      }
    });
  });

  const scenes = Array.from(scenesMap.values());
  console.log(`📌 Found ${scenes.length} scene(s):`, scenes.map(s => s.label).join(", "));

  return scenes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Delete an existing scene from DOM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete all paragraphs with the given scene label from the DOM.
 */
function deleteExistingSceneFromDOM(sceneLabel: string): void {
  console.log(`🔍 Looking for existing scene ${sceneLabel} to delete`);

  const allProseMirrors = document.querySelectorAll('.paginated-canvas .ProseMirror');
  let totalDeleted = 0;

  allProseMirrors.forEach((proseMirror) => {
    const paragraphs = proseMirror.querySelectorAll(`[data-scene-id="${sceneLabel}"]`);

    if (paragraphs.length > 0) {
      paragraphs.forEach((p) => {
        p.remove();
        totalDeleted++;
      });
    }
  });

  if (totalDeleted > 0) {
    console.log(`✅ Deleted ${totalDeleted} paragraphs from scene ${sceneLabel}`);
  } else {
    console.log(`ℹ️ No existing paragraphs found for scene ${sceneLabel}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Insert scene content at correct position in DOM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert scene HTML at the correct position in the DOM based on scene ordering.
 * 
 * Strategy:
 * 1. Find all existing scenes in DOM (with first AND last paragraph)
 * 2. Determine where the new scene should go numerically
 * 3. Insert BEFORE the first paragraph of the next scene, OR
 *    AFTER the last paragraph of the previous scene
 * 4. Let TipTap sync its state from the DOM
 */
function insertSceneInDOM(
  htmlContent: string,
  sceneLabel: string
): void {
  console.log("📝 insertSceneInDOM called:", {
    sceneLabel,
    contentLength: htmlContent.length,
  });

  // 1. Delete any existing scene with this label
  deleteExistingSceneFromDOM(sceneLabel);

  // 2. Find all existing scenes
  const existingScenes = findAllScenesInDOM();

  console.log("📍 Finding insertion position for scene:", sceneLabel);
  console.log("   Existing scenes:", existingScenes.map(s => s.label).join(", "));

  // Parse the HTML to insert
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  const paragraphs = Array.from(tempDiv.children);

  if (existingScenes.length === 0) {
    // No scenes exist - insert at the start of the first ProseMirror
    console.log("   → No existing scenes, inserting at start of first page");
    const targetProseMirror = document.querySelector('.paginated-canvas .ProseMirror');

    if (targetProseMirror) {
      // Insert at the beginning
      const firstChild = targetProseMirror.firstChild;
      paragraphs.forEach((p) => {
        if (firstChild) {
          targetProseMirror.insertBefore(p, firstChild);
        } else {
          targetProseMirror.appendChild(p);
        }
      });
    }
  } else {
    // Find where to insert based on scene ordering
    let insertBeforeElement: Element | null = null;
    let insertAfterElement: Element | null = null;

    for (const scene of existingScenes) {
      const comparison = compareSceneLabels(sceneLabel, scene.label);

      if (comparison < 0) {
        // New scene should come BEFORE this one
        console.log(`   → Inserting before scene ${scene.label}`);
        insertBeforeElement = scene.firstElement;
        break;
      }
    }

    if (!insertBeforeElement) {
      // New scene should go AFTER all existing scenes
      const lastScene = existingScenes[existingScenes.length - 1];
      console.log(`   → Inserting after last scene ${lastScene.label}`);
      insertAfterElement = lastScene.lastElement;
    }

    // Insert the paragraphs
    if (insertBeforeElement) {
      // Insert BEFORE the found element
      paragraphs.forEach((p) => {
        insertBeforeElement!.parentNode!.insertBefore(p, insertBeforeElement);
      });
    } else if (insertAfterElement) {
      // Insert AFTER the last paragraph of the previous scene
      const parent = insertAfterElement.parentNode!;
      const nextSibling = insertAfterElement.nextSibling;

      paragraphs.forEach((p) => {
        if (nextSibling) {
          parent.insertBefore(p, nextSibling);
        } else {
          parent.appendChild(p);
        }
      });
    }
  }

  console.log(`✅ Scene ${sceneLabel} inserted into DOM`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Parse response body consistently
// ─────────────────────────────────────────────────────────────────────────────

const parseResponseBody = (data: any): any => {
  try {
    if (typeof data?.body === "string") return JSON.parse(data.body);
    if (data?.body && typeof data.body === "object") return data.body;
    if (data?.scene_text || data?.success !== undefined) return data;
    return data?.body || {};
  } catch (parseError) {
    console.error("[parseResponseBody] Error:", parseError);
    return data?.body || data || {};
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSceneGeneration({
  editor,
  token,
  storyData,
  setUser,
  onUpdatePositions,
  modelOverride,
  onSceneInserted,
  isSceneDirty,
  getSceneTaggedContent,
  markSceneExtracted,
}: UseSceneGenerationProps): UseSceneGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [handoffStage, setHandoffStage] = useState(0);
  const [requestLog, setRequestLog] = useState<string | null>(null);
  const [responseLog, setResponseLog] = useState<string | null>(null);
  const [handoffId, setHandoffId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [characterDatabase, setCharacterDatabase] = useState<Record<string, any>>({});

  const resetPipeline = useCallback(() => {
    setHandoffStage(0);
    setIsGenerating(false);
    setHandoffId(null);
    setConversationHistory([]);
  }, []);

  const updateTokenBalance = useCallback(
    (responseBody: any) => {
      if (responseBody.cap !== undefined) {
        setUser((prevUser: any) => ({ ...prevUser, cap: responseBody.cap }));
      }
    },
    [setUser]
  );

  const executeFirstHandoff = useCallback(
    async (
      sceneId: string,
      beatDescription: string,
      enhancedData: any
    ): Promise<{ success: boolean; responseBody?: any }> => {
      let needsExtraction = false;
      let sceneContentForExtraction: string | undefined;

      if (isSceneDirty && getSceneTaggedContent) {
        if (isSceneDirty(sceneId)) {
          needsExtraction = true;
          sceneContentForExtraction = getSceneTaggedContent(sceneId) || undefined;
          console.log(`[useSceneGeneration] Scene ${sceneId} is dirty — requesting pre-AI extraction`);
        }
      }

      const requestObj = {
        event: "generate-with-efficient-handoff",
        userId: token?.payload["cognito:username"],
        beat_id: sceneId,
        beat_description: beatDescription,
        storyId: storyData?.storyId || undefined,
        modelOverride: modelOverride || "default",
        full_structure: enhancedData.segments
          .map((s: any) => `${s.id}: ${s.description || s.summary}`)
          .join("\n"),
        full_beat_sheet: enhancedData.segments
          .flatMap((segment: any) =>
            segment.scenes.map(
              (scene: any) => `${scene.sceneId}: ${scene.content || scene.title}`
            )
          )
          .join("\n"),
        style_preferences: { pacing: "balanced", storytelling_method: "balanced" },
        story_metadata: enhancedData.story_metadata || { M: "", T: "", G: "", CQ: "", SUM: "" },
        story_summary: enhancedData.story_metadata?.SUM || "",
        segments: enhancedData.segments,
        current_scene: enhancedData.current_scene,
        existing_character_database: storyData?.character_database || characterDatabase || {},
        sequencePosition: enhancedData.segments
          .flatMap((segment: any) => segment.scenes.map((scene: any) => scene.sceneId))
          .indexOf(sceneId) + 1,

        // FIL-302 2d: Pre-AI extraction flag
        ...(needsExtraction && {
          needsExtraction: true,
          scene_content_for_extraction: sceneContentForExtraction,
        }),
      };

      setRequestLog(JSON.stringify(requestObj, null, 2));
      const result = await safeApiCall("scripts", requestObj, token.toString(), { timeout: 120000 });
      if (!result.success || !result.data) throw new Error(result.error || "First handoff failed");

      console.log("=== RAW FIRST HANDOFF RESPONSE ===");
      console.log("result.data keys:", Object.keys(result.data));

      setResponseLog(JSON.stringify(result.data, null, 2));
      const responseBody = parseResponseBody(result.data);

      console.log("=== PARSED RESPONSE BODY ===");
      console.log("responseBody.scene_text exists?", !!responseBody.scene_text);
      console.log("responseBody.scene_text length:", responseBody.scene_text?.length || 0);

      return { success: true, responseBody };
    },
    [token, storyData, modelOverride, characterDatabase, isSceneDirty, getSceneTaggedContent]
  );

  const executeSecondHandoff = useCallback(
    async (sceneId: string, beatDescription: string, currentHandoffId: string, sceneContent: string, currentHistory: any[]) => {
      const requestObj = {
        event: "generate-with-efficient-handoff",
        userId: token?.payload["cognito:username"],
        is_second_handoff: true,
        beat_id: sceneId,
        beat_description: beatDescription,
        handoff_id: currentHandoffId,
        scene_content: sceneContent,
        conversation_history: currentHistory,
        storyId: storyData?.storyId || undefined,
        sequencePosition: storyData.segments
          .flatMap((segment: any) => segment.scenes.map((scene: any) => scene.sceneId))
          .indexOf(sceneId) + 1,
      };
      setRequestLog(JSON.stringify(requestObj, null, 2));
      const result = await safeApiCall("scripts", requestObj, token.toString());
      if (!result.success || !result.data) throw new Error(result.error || "Second handoff failed");
      setResponseLog(JSON.stringify(result.data, null, 2));
      return { success: true, responseBody: parseResponseBody(result.data) };
    },
    [token, storyData]
  );

  const executeThirdHandoff = useCallback(
    async (sceneId: string, beatDescription: string, currentHandoffId: string, metadataAnalysis: any, currentHistory: any[], sceneContent: string) => {
      const requestObj = {
        event: "generate-with-efficient-handoff",
        userId: token?.payload["cognito:username"],
        is_third_handoff: true,
        beat_id: sceneId,
        handoff_id: currentHandoffId,
        metadata_analysis: metadataAnalysis,
        existing_character_database: storyData?.character_database || characterDatabase || {},
        conversation_history: currentHistory,
        storyId: storyData?.storyId || undefined,
        scene_content: sceneContent,
        story_metadata: storyData?.story_metadata || {},
      };
      setRequestLog(JSON.stringify(requestObj, null, 2));
      const result = await safeApiCall("scripts", requestObj, token.toString());
      if (!result.success || !result.data) throw new Error(result.error || "Third handoff failed");
      setResponseLog(JSON.stringify(result.data, null, 2));
      return { success: true, responseBody: parseResponseBody(result.data) };
    },
    [token, storyData, characterDatabase]
  );

  const generateScene = useCallback(async (sceneId: string, segmentId?: string, sceneIndex?: number) => {
    if (!editor) return;

    resetHandoffRecorder(); // novo run: zera as 3 posições (no-op em produção)
    setRequestLog(null);
    setResponseLog(null);
    setIsGenerating(true);
    setHandoffStage(1);

    const beatId = segmentId ?? sceneId.split(".")[0];
    const currentBeat = storyData.segments.find((s: any) => s.id === beatId);

    if (!currentBeat) {
      console.log(beatId, currentBeat);
      toast.error("Beat information not found");
      resetPipeline();
      return;
    }

    const mockScene = currentBeat.scenes.find((s: any) => s.sceneId === sceneId);

    if (!mockScene) {
      console.log("=== SCENE NOT FOUND DEBUG ===");
      console.log("beatId:", beatId, "sceneId:", sceneId);
      console.log("Available scenes:", currentBeat.scenes.map((s: any) => s.sceneId));
      toast.error("Scene information not found");
      resetPipeline();
      return;
    }

    const beatDescription = currentBeat.description || currentBeat.content || "";
    const sceneDescription = mockScene.content || mockScene.title || `Scene ${sceneId}`;

    try {
      const enhancedData = JSON.parse(JSON.stringify(storyData));
      enhancedData.current_scene = { id: sceneId, description: sceneDescription };

      // ── STEP 1: Generate screenplay text ───────────────────────────────────
      const firstResult = await executeFirstHandoff(sceneId, beatDescription, enhancedData);
      const firstBody = firstResult.responseBody;
      updateTokenBalance(firstBody);

      const currentHandoffId = firstBody.handoff_id;
      setHandoffId(currentHandoffId);
      setConversationHistory(firstBody.conversation_history || []);
      recordHandoffHistory(0, firstBody.conversation_history || []);

      let sceneContent = firstBody.scene_text;
      if (!sceneContent && firstBody.conversation_history) {
        const sceneMessage = firstBody.conversation_history.find(
          (msg: any) => msg.role === "assistant" && msg.content && msg.content.includes("[<SC>]:")
        );
        if (sceneMessage) {
          sceneContent = sceneMessage.content;
          console.log("Found scene content in conversation history");
        }
      }

      if (!sceneContent) {
        console.error("=== NO SCENE CONTENT FOUND ===");
        toast.error("No script content received");
        resetPipeline();
        return;
      }

      const htmlContent = convertTaggedContentToHTML(sceneContent);
      const segNum = beatId.replace("S", "");
      const sceneLabel = sceneIndex !== undefined ? `${segNum}.${sceneIndex + 1}` : sceneId;

      const modifiedContent = htmlContent
        .replace(/<p([^>]*data-line-type="[^"]+")([^>]*)>/g, `<p$1 data-scene-id="${sceneLabel}"$2>`)
        .replace(/<p>/g, `<p data-scene-id="${sceneLabel}">`)
        .replace(/<p(?![^>]*data-scene-id)(?![^>]*data-line-type)([^>]*)>/g, `<p data-scene-id="${sceneLabel}"$1>`);

      // ── Insert scene at the correct position based on label ordering ───
      // For multi-page editors, we insert directly into the DOM and let
      // TipTap sync its state from the DOM changes.
      // CRITICAL: We insert AFTER the LAST paragraph of the previous scene,
      // not after the first one, to avoid splitting scenes in half.
      insertSceneInDOM(modifiedContent, sceneLabel);

      // ── Persist generated content immediately ──────────────────────────
      // Programmatic insertions (insertSceneInDOM) may not reliably fire
      // the editor.on("update") listener that Scripts.tsx uses for auto-save.
      // Calling onSceneInserted here guarantees the content is written to
      // localStorage and queued for DB save right after insertion.
      onSceneInserted?.();

      // ── FIL-302: Sync baseline hash after WF3 insertion ────────────────
      // Handoff 2 already extracts this content to Neptune, so update
      // the baseline hash to match. This prevents the navigation trigger
      // from redundantly re-extracting when the user clicks away.
      if (markSceneExtracted) {
        markSceneExtracted(sceneLabel);
        console.log(`[useSceneGeneration] Baseline hash synced for ${sceneLabel} — navigation trigger will skip`);
      }

      toast.success(`Generated initial script for scene ${sceneId}`);
      setIsGenerating(false);

      // ── STEP 2: Analyze characters ─────────────────────────────────────
      setHandoffStage(2);
      try {
        const secondResult = await executeSecondHandoff(
          sceneId, beatDescription, currentHandoffId, modifiedContent, firstBody.conversation_history || []
        );
        const secondBody = secondResult.responseBody;
        updateTokenBalance(secondBody);
        setConversationHistory(secondBody.conversation_history || []);
        recordHandoffHistory(1, secondBody.conversation_history || []);

        // ── STEP 3: Finalize character updates ───────────────────────────
        setHandoffStage(3);
        try {
          const thirdResult = await executeThirdHandoff(
            sceneId, beatDescription,
            secondBody.handoff_id || currentHandoffId,
            secondBody.metadata_analysis || secondBody.character_info,
            secondBody.conversation_history || [],
            sceneContent
          );
          const thirdBody = thirdResult.responseBody;
          // hist[2]: histórico do 3º handoff. FIL-315 não faz model call, então
          // o response pode não trazer conversation_history; cai para o histórico
          // de ENTRADA (o do 2º handoff), que é ⊇ hist[0] (specs 04/10 @ordem).
          recordHandoffHistory(
            2,
            thirdBody?.conversation_history?.length
              ? thirdBody.conversation_history
              : secondBody.conversation_history || []
          );
          // FIL-315: Do NOT call updateTokenBalance(thirdBody) —
          // Handoff 3 no longer makes a model call. Token deduction
          // happens asynchronously in the Character Analysis Lambda.

          console.log(`[useSceneGeneration] Background pipeline complete for ${sceneId}`);

          if (editor && onUpdatePositions) {
            setTimeout(() => {
              try { onUpdatePositions(editor); }
              catch (posError) { console.error("Error updating scene positions:", posError); }
            }, 500);
          }
        } catch (thirdError) {
          console.error("Error in third handoff (background):", thirdError);
        }
      } catch (secondError) {
        console.error("Error in second handoff (background):", secondError);
      }

      // Clean up remaining state (handoffId, conversationHistory)
      setHandoffId(null);
      setConversationHistory([]);

    } catch (error: any) {
      console.error("Error in scene generation:", error);
      if (error.code === "ECONNABORTED") {
        toast.error("Request timed out. Please try again.");
      } else if (error.code === "ERR_NETWORK") {
        toast.error("Network error. Please check your connection.");
      } else {
        toast.error(error.message || "An error occurred during scene generation");
      }
      resetPipeline();
    }
  }, [
    editor, token, storyData,
    executeFirstHandoff, executeSecondHandoff, executeThirdHandoff,
    updateTokenBalance, onUpdatePositions, onSceneInserted, resetPipeline,
    markSceneExtracted,
  ]);

  return { isGenerating, handoffStage, requestLog, responseLog, generateScene };
}

export default useSceneGeneration;