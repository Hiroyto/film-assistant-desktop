/**
 * Scripts.tsx
 * ===========
 * Main page component for the screenplay editor feature.
 *
 * FIL-302 Step 2d: Initializes useExtractionTracking hook and wires
 * isSceneDirty/getSceneTaggedContent into both useSceneGeneration
 * (WF3 beat card generation) and ScriptEditor props (for CMD+J guided gen).
 *
 * FIL-302 Trigger 1: Navigation-based background extraction. When the
 * user moves from one scene to another, checks if the previous scene
 * was edited during this session and fires a background extraction to
 * keep Neptune fresh.
 *
 * This is the orchestrator — it doesn't contain business logic itself,
 * but wires together the sub-components and hooks that do:
 *
 *   - ScriptEditor:        TipTap editor setup + rendering
 *   - BeatSidebar:         Story beat navigation panel
 *   - useSceneGeneration:  AI generation pipeline (3-step handoff)
 *   - FullscreenScriptEditor: Fullscreen editing overlay
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ Header                                           │
 *   │ StoryNavigation                                  │
 *   ├──────────────┬───────────────────────────────────┤
 *   │ BeatSidebar  │ ScriptEditor                      │
 *   │ (300px)      │ (flex: 1)                         │
 *   │              │                                   │
 *   │  Beat 1 ▼    │  ┌─────────────────────┬────────┐│
 *   │   S1.1       │  │ Editor Content       │Toolbar ││
 *   │   S1.2       │  │                      │        ││
 *   │  Beat 2 ▼    │  └─────────────────────┴────────┘│
 *   │   ...        │                                   │
 *   ├──────────────┴───────────────────────────────────┤
 *   │ Footer                                           │
 *   └──────────────────────────────────────────────────┘
 *
 * 
 *  * Save Architecture:
 *   - save():               POSTs S1-S9/metadata to /works (event:"save")
 *                           + fires save-screenplay to S3 in parallel
 *   - saveScreenplayToS3(): POSTs HTML to /works (event:"save-screenplay")
 *  *   - loadScreenplayFromS3(): GETs HTML from /works (event:"get-screenplay")
 *   - handleDebouncedSave(): orchestrates debounced (3s) and immediate saves
 *   - localStorage:         primary cache, written on every keystroke,
 *                           visibilitychange, beforeunload and story switch
 * 
 * 
 * 
 * 
 * State Management:
 *   - Beat/scene selection state lives here (shared between sidebar and editor)
 *   - Editor instance is received from ScriptEditor via callback
 *   - Generation state is managed by useSceneGeneration hook
 *   - Theme and fullscreen state are local UI concerns
 *
 * Save Architecture (ported from home.tsx):
 *   - save(): Core function that sends script content to DynamoDB
 *   - mutateSave: React Query mutation wrapping save()
 *   - handleDebouncedSave(data, forceImmediate, useProvidedData):
 *       • forceImmediate=false → debounced 10s (user typing)
 *       • forceImmediate=true  → saves immediately (AI responses, explicit saves)
 *       • useProvidedData=true → passes data directly to save() to avoid stale state
 *
 * Imported by: App.tsx (via router)
 */

import React, {
  useState,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { Editor } from "@tiptap/react";
import { Theme, Flex, Box } from "@radix-ui/themes";
import { toast, Toaster } from "react-hot-toast";
import { useMutation } from "react-query";
import axios from "axios";
import { debounce as lodashDebounce } from "lodash";
import { CheckCircle, Loader } from "lucide-react";
import { mirrorScreenplayToLocal, loadScreenplay, saveScreenplay } from "../../features/scripts/model/screenplayPersistence";
import { isDesktop } from "../../lib/ipcClient";

import Header from "../header";
import Footer from "../footer";
import { UserContext } from "../../App";
import { mockScriptData, fetchScenesForBeat } from "../mockScriptData";
import { safeApiCall } from "../../models/apiHelpers";
import { useAIModel, useSelectedModelId } from '../AIModelContext';

import ScriptEditor from "./ScriptEditor";
import ScriptsPreviewModal from "../Home/ScriptsPreviewModal"
import { useSceneGeneration } from "./useSceneGeneration";
import { useExtractionTracking } from "./useExtractionTracking";
import { compareSceneIds } from "./editorUtils";
import { Scene, ScenePosition } from "./types";
import { useWebSocket } from '../../lib/useWebSocket';
import GenerationLoadingOverlay from "./GenerationLoadingOverlay";

import "./scripts.css";
import StoryNavigationSidebar from "../Home/StoryNavigationTab";
import { useScrollBehavior } from "../useScrollBehavior";
import { ActItem, ActStats, SegmentStats, SegmentWithScenes } from "../../models/acts";
import StoryBreadcrumbHeader from "../Home/StoryBreadcrumbHeader";
import CharacterPanel from "../characters-home/CharacterPanel";

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers
// Cache payload: { html, savedAt } where savedAt is an epoch-ms timestamp
// (server-provided when available, otherwise Date.now() at write time).
// Backward-compat: legacy entries are raw HTML strings — treated as savedAt: 0
// so any real server timestamp will be considered newer on the next revalidate.
// ─────────────────────────────────────────────────────────────────────────────

const SCREENPLAY_KEY = (storyId: string) => `screenplay_${storyId}`;

type ScreenplayCache = { html: string; savedAt: number };

const readScreenplayFromCache = (storyId: string): ScreenplayCache | null => {
  if (!storyId) return null;
  try {
    const raw = localStorage.getItem(SCREENPLAY_KEY(storyId));
    if (!raw) return null;
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.html === "string") {
        return { html: parsed.html, savedAt: Number(parsed.savedAt) || 0 };
      }
      return null;
    }
    return { html: raw, savedAt: 0 };
  } catch {
    return null;
  }
};

const writeScreenplayToCache = (
  storyId: string,
  html: string,
  savedAt: number = Date.now()
) => {
  if (!storyId || !html) return;
  try {
    const payload: ScreenplayCache = { html, savedAt };
    localStorage.setItem(SCREENPLAY_KEY(storyId), JSON.stringify(payload));
    // Desktop local-first mirror: also persist the screenplay HTML to SQLite
    // (no-op on web; legacy localStorage + S3 stay the writers). Best-effort.
    void mirrorScreenplayToLocal(storyId, html).catch(() => {});
  } catch (err) {
    console.warn("Scripts: localStorage write failed:", err);
  }
};

// API Gateway / Lambda proxy responses arrive as { statusCode, headers, body }
// where `body` is a JSON-encoded string. A few legacy paths return `body` as an
// already-parsed object. Same defensive shape used in scenes/useSceneCanvasAI
// and elsewhere.
const parseWorksBody = (res: any): any => {
  const data = res?.data;
  if (!data) return {};
  if (typeof data.body === "string") {
    try { return JSON.parse(data.body); } catch { return {}; }
  }
  if (data.body && typeof data.body === "object") return data.body;
  return data;
};

// ─────────────────────────────────────────────────────────────────────────────

export function Scripts(props: any) {
  const {
    user,
    token,
    loading,
    data,
    setData,
    debouncedSave,
    setUser,
    Characters,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    // FIL-315: WebSocket character update support
    characters: contextCharacters,
    setCharacters: contextSetCharacters,
    setCharacterDatabase: contextSetCharacterDatabase,
    saveCharacters: contextSaveCharacters,
    isWebSocketUpdating,
    setIsWebSocketUpdating,
    isCharactersLoading,
    setIsCharactersLoading,
  } = useContext(UserContext);



  type ActComputedStats = {
    actId: string;
    actStats: ActStats;
    segmentStats: Record<string, SegmentStats>;
  };

  const { isConnected: wsConnected, lastUpdate: wsLastUpdate, error: wsError } = useWebSocket(
    user?.id || token?.payload['cognito:username'],
    data?.storyId
  );

  const [lastProcessedMessageId, setLastProcessedMessageId] = useState<string | null>(null);
  const [isProcessingCharacters, setIsProcessingCharacters] = useState(false);

  // Clear dedup state when story changes
  useEffect(() => {
    if (data?.storyId) setLastProcessedMessageId(null);
  }, [data?.storyId]);

  // Trigger character processing when WebSocket delivers an update
  useEffect(() => {
    if (wsLastUpdate && wsLastUpdate.analysisComplete && !isProcessingCharacters) {
      console.log('📡 [Scripts] WebSocket character update received:', {
        characterCount: wsLastUpdate.characters?.length,
        trigger: wsLastUpdate.trigger,
      });
      handleScriptCharacterUpdate(wsLastUpdate.characters);
    }
  }, [wsLastUpdate]);

  const handleScriptCharacterUpdate = async (newCharacters: any[]) => {
    if (!newCharacters || newCharacters.length === 0) return;

    const contentId = `${data.storyId}_${newCharacters.length}_${newCharacters.map((c: any) => c.name).sort().join('_')}`;
    if (lastProcessedMessageId === contentId) {
      console.log('🚫 [Scripts] Duplicate character update, skipping');
      return;
    }
    if (isWebSocketUpdating) {
      console.log('🚫 [Scripts] Update already in progress, skipping');
      return;
    }

    setLastProcessedMessageId(contentId);
    setIsWebSocketUpdating(true);
    setIsProcessingCharacters(true);

    try {
      const existing = contextCharacters || [];
      const merged = mergeScriptCharactersWithLocks(existing, newCharacters);

      console.log('🔄 [Scripts] Character merge:', {
        incoming: newCharacters.map((c: any) => c.name),
        total: merged.length,
        new: merged.filter((c: any) => c.is_new).length,
      });

      if (contextSetCharacters) {
        contextSetCharacters(merged);
        const db = merged.reduce((acc: any, char: any) => { acc[char.name] = char; return acc; }, {});
        if (contextSetCharacterDatabase) contextSetCharacterDatabase(db);
        setData((prev: any) => ({ ...prev, characters: db, character_database: db }));
      }

      if (contextSaveCharacters) {
        await contextSaveCharacters(merged);
        console.log('💾 [Scripts] Characters saved to DynamoDB');
      }

      if (wsLastUpdate?.tokenInfo?.newBalance !== undefined) {
        setUser((prev: any) => prev ? { ...prev, cap: wsLastUpdate?.tokenInfo?.newBalance } : prev);
      }

      console.log('✅ [Scripts] Character update complete');
    } catch (error) {
      console.error('💥 [Scripts] Character update failed:', error);
      setLastProcessedMessageId(null);
    } finally {
      setIsProcessingCharacters(false);
      setIsWebSocketUpdating(false);
      if (setIsCharactersLoading) setIsCharactersLoading(false);
    }
  };

  const mergeScriptCharactersWithLocks = (existing: any[], incoming: any[]): any[] => {
    const existingMap = new Map(existing.map((c: any) => [c.name, c]));

    // Start with ALL existing characters — none are removed
    const merged = [...existing];

    // Only add characters that don't already exist in the roster
    for (const inc of incoming) {
      if (!existingMap.has(inc.name)) {
        console.log(`✨ [Scripts] New character discovered: ${inc.name}`);
        merged.push({
          ...inc,
          locked: false,
          is_new: true,
        });
      } else {
        console.log(`⏭️ [Scripts] Character "${inc.name}" already in roster, skipping update`);
      }
    }

    return merged;
  };

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [editorTheme, setEditorTheme] = useState<"dark" | "light">("dark");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scriptPreviewOpen, setScriptPreviewOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const isScrolled = useScrollBehavior();

  // ─── Save state ────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const debouncedDatabaseSaveRef = useRef<any>(null);

  // ─── Editor / scene state ──────────────────────────────────────────────────
  const editorRef = useRef<Editor | null>(null);

  // Refs so event-listener callbacks always read the latest values
  // without needing to re-register on every render.
  const storyIdRef = useRef<string | undefined>(data.storyId);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { storyIdRef.current = data.storyId; }, [data.storyId]);

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [loadedScenes, setLoadedScenes] = useState<Scene[]>([]);
  const [isExpanded, setIsExpanded] = useState<Record<string, boolean>>({});
  const [scenePositions, setScenePositions] = useState<ScenePosition[]>([]);
  const [segments, setSegments] = useState<SegmentWithScenes[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SegmentWithScenes | null>(null);
  const [currentParagraphSceneId, setCurrentParagraphSceneId] = useState<string | null>(null);

  // ── Model selector state ──────────────────────────────────────────────────
  // Controls the writer model for WF3 hybrid pipeline (Phase 1b).
  // Structure (Phase 1a) is always GPT-5.1 regardless of this value.
  // 'default' = Gemini 3 Flash (set in scene-generation.mjs HYBRID_MODELS)
  const { getModelForAPI } = useAIModel();

  // ─── Resolved initial content ──────────────────────────────────────────────
  // Priority:
  //   1. data.screenplayContent  (if App.tsx ever populates it from backend)
  //   2. localStorage cache      (written synchronously on every keystroke)
  //   3. empty string
  //
  // Intentionally depends only on data.storyId so subsequent App.tsx reloads
  // (which arrive with screenplayContent:"") don't wipe the editor.
  const initialScreenplayContent = (() => {
    if (data.storyId) {
      const cached = readScreenplayFromCache(data.storyId);
      if (cached?.html) return cached.html;
    }

    if (data.screenplayContent) {
      return data.screenplayContent;
    }

    return "";
  })();

  const actISegments = segments.filter((s) => s.act === 1);
  const actIISegments = segments.filter((s) => s.act === 2);
  const actIIISegments = segments.filter((s) => s.act === 3);

  const storyData = {
    storyId: data.storyId,
    story_metadata: {
      M: data.M || "", T: data.T || "", G: data.G || "",
      CQ: data.CQ || "", SUM: data.SUM || "",
    },
    segments: segments.map((seg) => ({
      id: seg.id, title: seg.title,
      description: seg.description || seg.content || "",
      scenes: seg.scenes.map((scene) => ({
        sceneId: scene.sceneId, title: scene.title || "", content: scene.content || "",
      })),
    })),
  };

  const onSceneInsertedRef = useRef<(() => void) | null>(null);

  // Populated by ScriptEditor. Returns every mounted page editor so the
  // extraction tracker can find scenes that live on pages other than the
  // currently focused one (otherwise the dirty check runs against the wrong
  // editor and scenes look unchanged when they actually need extraction).
  const getAllEditorsRef = useRef<(() => Editor[]) | null>(null);
  const getEditorsForExtraction = useCallback((): Editor[] => {
    const fromRef = getAllEditorsRef.current?.();
    if (fromRef && fromRef.length > 0) return fromRef;
    return editorRef.current ? [editorRef.current] : [];
  }, []);

  const {
    isSceneDirty,
    markSceneExtracted,
    getSceneTaggedContent,
  } = useExtractionTracking({
    editor: editorRef.current,
    getEditors: getEditorsForExtraction,
    storyId: data.storyId,
  });

  const { isGenerating, handoffStage, generateScene } = useSceneGeneration({
    editor: editorRef.current,
    token,
    storyData,
    setUser,
    modelOverride: getModelForAPI() ?? undefined,
    onUpdatePositions: () => { },
    onSceneInserted: () => onSceneInsertedRef.current?.(),
    isSceneDirty,
    getSceneTaggedContent,
    markSceneExtracted,
  });

  // ── FIL-302 Trigger 1: Background extraction on scene navigation ──────
  // When the user moves from one scene to another, check if the previous
  // scene was edited during this session. If so, fire a background
  // extraction so Neptune has fresh data before the next AI operation.

  const fireBackgroundExtraction = useCallback(
    async (sceneId: string, content: string) => {
      if (!token || !data.storyId) return;
      const userId = token.payload?.["cognito:username"] || token.payload?.sub;
      try {
        await safeApiCall(
          "scripts",
          {
            event: "extract-scene-to-graph",
            userId,
            storyId: data.storyId,
            sceneId,
            sceneContent: content,
          },
          token.toString()
        );
        console.log(`[ExtractionTracking] Background extraction succeeded for ${sceneId}`);
      } catch (err) {
        console.warn("[ExtractionTracking] Background extraction failed:", err);
      }
    },
    [token, data.storyId]
  );

  const previousSceneIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prevId = previousSceneIdRef.current;
    previousSceneIdRef.current = currentParagraphSceneId;

    // Only fire when transitioning FROM a scene (prevId exists and changed)
    if (prevId && prevId !== currentParagraphSceneId && isSceneDirty(prevId)) {
      const content = getSceneTaggedContent(prevId);
      if (content) {
        console.log(`[ExtractionTracking] Scene ${prevId} is dirty — firing background extraction`);
        fireBackgroundExtraction(prevId, content)
          .then(() => markSceneExtracted(prevId))
          .catch((err) =>
            console.warn("[ExtractionTracking] Background extraction failed:", err)
          );
      }
    }
  }, [currentParagraphSceneId, isSceneDirty, getSceneTaggedContent, fireBackgroundExtraction, markSceneExtracted]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════════════════

  // Ref wired to ScriptEditor → PaginatedEditor.getAllHTML().
  // Returns the concatenated HTML of ALL pages, not just the active one.
  const getAllHTMLRef = useRef<(() => string) | null>(null);

  const getScriptContent = useCallback((): string => {
    // Prefer the multi-page collector when available; fall back to the
    // single active editor for backwards-compat during component init.
    if (getAllHTMLRef.current) return getAllHTMLRef.current();
    return editorRef.current?.getHTML() ?? "";
  }, []);

  // ─── S3 helpers ───────────────────────────────────────────────────────────

  /**
   * saveScreenplayToS3
   * Fires event "save-screenplay" → Lambda:
   *   1. Uploads HTML to S3 at screenplayS3Key
   *   2. Updates screenplayLastModified / wordCount / pageCount in DynamoDB
   *
   * Called in parallel with the story save — failures are non-fatal because
   * localStorage already has the content.
   */
  const saveScreenplayToS3 = useCallback(
    async (storyId: string, html: string) => {
      if (!storyId || !html || !token) return;
      try {
        const res = await axios.post(
          `${process.env.REACT_APP_URL}/works`,
          {
            event: "save-screenplay",
            userId: token?.payload["cognito:username"],
            storyId,
            screenplayContent: html,
          },
          { headers: { Authorization: token.toString() } }
        );
        if (res?.data?.statusCode === 200) {
          // Defensive parse: Lambda response is { statusCode, body: "<json>" }.
          const body = parseWorksBody(res);
          // Stamp the cache with the server timestamp when provided so the next
          // SWR revalidate has a precise reference. Falls back to Date.now().
          const serverSavedAt =
            Date.parse(body.screenplayLastModified || body.lastModified || "") ||
            Date.now();
          writeScreenplayToCache(storyId, html, serverSavedAt);
          if (body.works)
            setUser((prev: any) => (prev ? { ...prev, works: body.works } : prev));
        } else {
          console.warn("Scripts: save-screenplay returned non-200:", res?.data?.statusCode);
        }
      } catch (err) {
        console.error("Scripts: save-screenplay failed (non-fatal):", err);
      }
    },
    [token, setUser]
  );

  /**
   * loadScreenplayFromS3
   * Fires event "get-screenplay" → Lambda fetches HTML + screenplayLastModified.
   * Falls back to localStorage when S3 is empty or the request fails.
   *
   * NOTE: the SWR effect below issues its own get-screenplay request so it can
   * compare against the freshly-hydrated value in closure. This helper is kept
   * for any external callers that want a one-shot fetch.
   */
  const loadScreenplayFromS3 = useCallback(
    async (storyId: string): Promise<string> => {
      if (!storyId || !token) return "";
      try {
        const res = await axios.post(
          `${process.env.REACT_APP_URL}/works`,
          {
            event: "get-screenplay",
            userId: token?.payload["cognito:username"],
            storyId,
          },
          { headers: { Authorization: token.toString() } }
        );
        if (res?.data?.statusCode === 200) {
          const body = parseWorksBody(res);
          if (!body.isEmpty) {
            const html = body.screenplayContent || body.html || "";
            const remoteSavedAt =
              Date.parse(body.screenplayLastModified || body.lastModified || "") ||
              Date.now();
            if (html) writeScreenplayToCache(storyId, html, remoteSavedAt);
            return html;
          }
        }
      } catch (err) {
        console.error("Scripts: get-screenplay failed, using localStorage:", err);
      }
      return readScreenplayFromCache(storyId)?.html ?? "";
    },
    [token]
  );

  // ─── Core save ─────────────────────────────────────────────────────────────

  const save = useCallback(
    async (title: string, storyId?: string, fullData?: any) => {
      const dataSource = fullData || data;
      const resolvedStoryId = storyId || dataSource.storyId;
      const editorHTML = getScriptContent();

      console.log("💾 Scripts save() called:", { title, storyId, hasFullData: !!fullData });

      // Request 1 — standard story save (S1-S9, metadata)
      const storyPayload: any = {
        event: "save", title,
        userId: token?.payload["cognito:username"],
        M: dataSource.M || "", T: dataSource.T || "", G: dataSource.G || "",
        CQ: dataSource.CQ || "", SUM: dataSource.SUM || "",
        S1: dataSource.S1 || "", S2: dataSource.S2 || "", S3: dataSource.S3 || "",
        S4: dataSource.S4 || "", S5: dataSource.S5 || "", S6: dataSource.S6 || "",
        S7: dataSource.S7 || "", S8: dataSource.S8 || "", S9: dataSource.S9 || "",
      };
      if (resolvedStoryId) storyPayload.storyId = resolvedStoryId;

      console.log("📤 Scripts save() payload:", {
        storyId: storyPayload.storyId,
        editorHTMLLength: editorHTML.length,
        screenplayContentPreview: editorHTML.substring(0, 80) + "…",
      });

      // Request 2 — screenplay persistence.
      //  • Desktop (local-first, A4): grava SQLite + enfileira na sync_queue; o
      //    push-worker (BC-08) envia ao /works com retry/backoff e X-Request-Id.
      //    Atualiza também o cache localStorage p/ a lógica de timestamp do SWR
      //    abaixo seguir coerente (writeScreenplayToCache já espelha no SQLite).
      //  • Web: mantém o POST direto ao S3 (fire-and-forget), inalterado.
      if (resolvedStoryId && editorHTML) {
        if (isDesktop()) {
          writeScreenplayToCache(resolvedStoryId, editorHTML);
          void saveScreenplay(
            resolvedStoryId,
            editorHTML,
            token?.payload["cognito:username"] as string
          ).catch((e) =>
            console.error("Scripts: local-first save-screenplay falhou", e)
          );
        } else {
          saveScreenplayToS3(resolvedStoryId, editorHTML);
        }
      }

      try {
        const response = await axios.post(
          `${process.env.REACT_APP_URL}/works`,
          storyPayload,
          { headers: { Authorization: token.toString() } }
        );
        console.log("📥 Scripts save() response status:", response?.data?.statusCode);
        return response;
      } catch (error) {
        console.error("💥 Scripts save() error:", error);
        throw error;
      }
    },
    [data, token, getScriptContent, saveScreenplayToS3]
  );

  const [screenplayLoaded, setScreenplayLoaded] = useState(false);

  useEffect(() => {
    setScreenplayLoaded(false);
  }, [data.storyId]);

  useEffect(() => {
    if (!data.storyId || !token || screenplayLoaded) return;
    const storyId = data.storyId;
    let cancelled = false;

    const init = async () => {
      setScreenplayLoaded(true);

      // ── A. Hydrate immediately. Desktop (local-first, B3): SQLite > localStorage
      //     > data.screenplayContent. Web: localStorage > data (inalterado).
      const cached = readScreenplayFromCache(storyId);
      let hydratedHtml =
        cached?.html ||
        (typeof data.screenplayContent === "string" ? data.screenplayContent : "");

      if (isDesktop()) {
        try {
          // loadScreenplay resolve SQLite > stateHtml; passamos o conteúdo do
          // localStorage/state como fallback. S3 segue como revalidação (passo B).
          const localFirst = await loadScreenplay(storyId, { stateHtml: hydratedHtml || null });
          if (localFirst) hydratedHtml = localFirst;
        } catch (e) {
          console.error("Scripts: local-first screenplay load falhou (segue p/ localStorage)", e);
        }
      }

      console.log("📦 SWR hydrate:", {
        storyId,
        dataScreenplayContent: data.screenplayContent?.length ?? 0,
        localStorage: cached?.html.length ?? 0,
        cachedSavedAt: cached?.savedAt ?? 0,
      });

      if (hydratedHtml) {
        if (!data.screenplayContent || data.screenplayContent.length < hydratedHtml.length) {
          console.log("📝 Hydrating data.screenplayContent (local-first/localStorage)");
          setData((prev: any) => ({ ...prev, screenplayContent: hydratedHtml }));
        }
      }

      // ── B. Revalidate against S3 in the background ─────────────────────────
      try {
        const res = await axios.post(
          `${process.env.REACT_APP_URL}/works`,
          {
            event: "get-screenplay",
            userId: token?.payload["cognito:username"],
            storyId,
          },
          { headers: { Authorization: token.toString() } }
        );
        if (cancelled || storyId !== data.storyId) return;

        // Defensive parse: API Gateway / Lambda proxy returns
        // { statusCode, headers, body: "<json>" } where body is stringified.
        const body = parseWorksBody(res);
        const remoteHtml: string =
          body.screenplayContent || body.html || "";
        const remoteEmpty: boolean = !!body.isEmpty || !remoteHtml;
        // Fallback: if the Lambda doesn't yet include screenplayLastModified,
        // accept the story-level `lastModified` (already returned by the
        // backend), and finally Date.now() so the response is treated as
        // "just now" on first divergence and the local cache picks up a real
        // timestamp going forward.
        const remoteSavedAt =
          Date.parse(body.screenplayLastModified || body.lastModified || "") ||
          Date.now();
        const localSavedAt = cached?.savedAt ?? 0;

        if (remoteEmpty) {
          // S3 vazio: o próximo save sincroniza. Nada a fazer.
          return;
        }
        if (remoteHtml === hydratedHtml) {
          // Já em paridade — apenas re-stampa o cache com o timestamp do servidor
          // para que comparações futuras sejam estáveis (não atualiza o editor).
          writeScreenplayToCache(storyId, remoteHtml, remoteSavedAt);
          return;
        }
        if (localSavedAt && remoteSavedAt && remoteSavedAt <= localSavedAt) {
          // Cache local é igual ou mais novo que o S3 — não revalida.
          return;
        }

        // Guard-rails: não sobrescreve trabalho em andamento.
        // O guard só faz sentido quando havia conteúdo real hidratado — se
        // hidratamos vazio (caso típico no Tauri, com localStorage isolado),
        // o editor terá apenas o placeholder do TipTap (`<p></p>`) e adotar
        // o S3 é exatamente o que queremos. Sem essa salvaguarda, o diff
        // `<p></p>` !== "" disparava o guard como falso-positivo.
        const hydratedHasContent =
          hydratedHtml.replace(/<[^>]*>/g, "").trim().length > 0;
        const currentEditorHtml = editorRef.current?.getHTML() ?? hydratedHtml;
        const userEditedSinceHydrate =
          hydratedHasContent && currentEditorHtml !== hydratedHtml;
        if (isSaving || userEditedSinceHydrate) {
          console.log("🔁 SWR: remote diverges but save/edit is in flight — skipping merge");
          return;
        }

        console.log("☁️ SWR: adopting S3 version (newer than localStorage)");
        writeScreenplayToCache(storyId, remoteHtml, remoteSavedAt);
        setData((prev: any) => ({ ...prev, screenplayContent: remoteHtml }));
      } catch (err) {
        console.error("Scripts: SWR revalidate failed (keeping localStorage):", err);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [data.storyId, token]);

  // ─── mutateSave ────────────────────────────────────────────────────────────

  const mutateSave = useMutation({
    mutationFn: (saveData: { title: string; storyId?: string; fullData?: any }) => {
      console.log("🚀 Scripts mutateSave called:", {
        title: saveData.title, storyId: saveData.storyId, hasFullData: !!saveData.fullData,
      });
      return save(saveData.title, saveData.storyId, saveData.fullData);
    },

    onSuccess: (res: any) => {
      console.log("✅ Scripts mutateSave onSuccess:", res?.data?.statusCode);
      if (res?.data?.statusCode === 200) {
        // Defensive parse: Lambda response body is a JSON-encoded string.
        const body = parseWorksBody(res);
        // Mirror to localStorage so the next page load can restore the content.
        // Stamp with the server timestamp when the Lambda provides one; falls
        // back to Date.now() until the backend rolls out screenplayLastModified.
        const storyId = body.storyId || data.storyId;
        const html = getScriptContent();
        const serverSavedAt =
          Date.parse(body.screenplayLastModified || body.lastModified || "") ||
          Date.now();
        if (storyId && html) writeScreenplayToCache(storyId, html, serverSavedAt);
        if (body.works)
          setUser((prev: any) => (prev ? { ...prev, works: body.works } : prev));
        if (body.storyId && !data.storyId)
          setData((prev: any) => ({ ...prev, storyId: body.storyId }));
      } else if (res?.data?.statusCode === 400) {
        toast.error(res.data.body?.error || "Bad request error");
      } else {
        toast.error("Error saving script");
      }
    },

    onError: (error: any) => {
      console.error("❌ Scripts mutateSave onError:", error);
      toast.error("Error saving script");
    },
  });

  // ─── handleDebouncedSave ──────────────────────────────────────────────────

  const handleDebouncedSave = useCallback(
    (newData: any, forceImmediate = false, useProvidedData = false) => {

      setIsSaving(true);

      // Write screenplay to localStorage immediately — safety net before DB
      const html = getScriptContent();
      if (newData.storyId && html) writeScreenplayToCache(newData.storyId, html);

      // Also update App.tsx Amplify Cache / localStorage story blob
      try {
        const cacheKey = newData.title || "Untitled";
        debouncedSave(newData);
      } catch (err) { console.error("Scripts: cache save error:", err); }

      const saveToDatabase = async (dataToSave: any) => {
        try {
          let finalData = { ...dataToSave };

          if (!finalData.storyId) {
            finalData.storyId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          }
          if (!finalData.title || finalData.title.trim() === "" || finalData.title === "Untitled Story") {
            const ts = new Date()
              .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
              .replace(/:/g, "-");
            finalData.title = `Story ${ts}`;
          }

          const savePayload: any = { title: finalData.title, storyId: finalData.storyId };
          if (useProvidedData) {
            savePayload.fullData = { ...finalData, scriptContent: getScriptContent() };
          }

          await mutateSave.mutateAsync(savePayload);

          if (finalData.storyId !== dataToSave.storyId || finalData.title !== dataToSave.title)
            setData(finalData);

          setLastSaved(new Date());
          setIsSaving(false);
          setTimeout(() => {
            setShowSavedIndicator(true);
            setTimeout(() => setShowSavedIndicator(false), 1000);
          }, 200);
        } catch (err: any) {
          setIsSaving(false);
          toast.error("Error saving script to database");
          throw err;
        }
      };

      if (forceImmediate) {
        return saveToDatabase(newData);
      } else {
        if (!debouncedDatabaseSaveRef.current)
          debouncedDatabaseSaveRef.current = lodashDebounce(saveToDatabase, 3_000);
        return debouncedDatabaseSaveRef.current(newData);
      }
    },
    [debouncedSave, mutateSave, setData, getScriptContent]
  );

  // Wire up the onSceneInserted callback now that handleDebouncedSave is defined.
  // This runs after every render but the ref update is cheap and always correct.
  useEffect(() => {
    onSceneInsertedRef.current = () => {
      // Read the latest HTML from the editor directly (avoids stale closure).
      const html = editorRef.current?.getHTML() ?? "";
      const storyId = storyIdRef.current;

      // 1. Write to localStorage immediately so content survives a reload
      //    even if the DB save below fails.
      if (storyId && html) writeScreenplayToCache(storyId, html);

      // 2. Trigger an immediate DB save with the freshest data.
      //    We pass forceImmediate=true so the content isn't lost to the
      //    3-second debounce window.
      handleDebouncedSave({ ...dataRef.current }, true, false);
    };
  });

  // ─── beforeunload: flush to localStorage + trigger save if in-flight ───────
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const editor = editorRef.current;
      const storyId = storyIdRef.current;

      // Always flush the latest HTML to localStorage on tab close
      if (editor && storyId) {
        const html = editor.getHTML();
        const hasText = html.replace(/<[^>]*>/g, "").trim().length > 0;
        if (hasText) {
          try {
            const raw = localStorage.getItem(`story_${storyId}`);
            const existing = raw ? JSON.parse(raw) : {};
            localStorage.setItem(`story_${storyId}`, JSON.stringify({
              ...existing, ...dataRef.current, screenplayContent: html, _cachedAt: Date.now(),
            }));
            localStorage.setItem("active_story_id", storyId);
          } catch { /* silent */ }
        }
      }

      if (isSaving) {
        e.preventDefault();
        handleDebouncedSave(
          { ...dataRef.current, screenplayContent: editorRef.current?.getHTML() ?? "" },
          true
        );
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSaving, handleDebouncedSave]);

  // ─── Explicit save (toolbar button / Ctrl+S) ──────────────────────────────
  const handleScriptSave = useCallback(() => {
    if (!editorRef.current) return;
    handleDebouncedSave({ ...data, screenplayContent: getScriptContent() }, true, true);
  }, [data, getScriptContent, handleDebouncedSave]);

  // ─── Auto-save on editor change ───────────────────────────────────────────
  const handleEditorChange = useCallback(() => {
    const savePayload = { ...dataRef.current, screenplayContent: getScriptContent() };
    handleDebouncedSave(savePayload, false, false);
  }, [handleDebouncedSave, getScriptContent]);

  // Re-register the TipTap update listener when handleEditorChange changes
  const editorChangeListenerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editorChangeListenerRef.current) editor.off("update", editorChangeListenerRef.current);
    editor.on("update", handleEditorChange);
    editorChangeListenerRef.current = handleEditorChange;
  }, [handleEditorChange]);

  // ─── visibilitychange: persist to localStorage when tab hides ─────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      console.log("👁 visibilityState:", document.visibilityState, "| storyId:", storyIdRef.current);
      if (document.visibilityState !== "hidden") return;
      const editor = editorRef.current;
      const storyId = storyIdRef.current;
      if (!editor || !storyId) return;
      const html = editor.getHTML();
      console.log("📝 html to save length:", html?.length, "| isEmpty:", !html || html === "<p></p>");
      if (!html || html === "<p></p>") return;
      try {
        const raw = localStorage.getItem(`story_${storyId}`);
        const existing = raw ? JSON.parse(raw) : {};
        const updated = { ...existing, ...dataRef.current, screenplayContent: html, _cachedAt: Date.now() };
        localStorage.setItem(`story_${storyId}`, JSON.stringify(updated));
        localStorage.setItem("active_story_id", storyId);
        console.log("✅ visibilitychange: saved", html.length, "chars to story_" + storyId);
      } catch (e) { console.error("visibilitychange save failed:", e); }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // ─── Story switch: save previous story before loading the new one ──────────
  const prevStoryIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prevId = prevStoryIdRef.current;
    const newId = data.storyId;

    if (prevId && prevId !== newId && editorRef.current) {
      const html = editorRef.current.getHTML();
      const hasText = html.replace(/<[^>]*>/g, "").trim().length > 0;
      if (hasText) {
        try {
          const raw = localStorage.getItem(`story_${prevId}`);
          const existing = raw ? JSON.parse(raw) : {};
          localStorage.setItem(`story_${prevId}`, JSON.stringify({
            ...existing, screenplayContent: html, _cachedAt: Date.now(),
          }));
          console.log("💾 story switch: saved prev story", prevId);
        } catch { /* silent */ }
      }
    }

    prevStoryIdRef.current = newId;
    storyIdRef.current = newId;

    // Reset the cache-restore flag so that when a new story loads its
    // page-1 editor is correctly restored from localStorage.
    if (prevId !== newId) cacheRestoredRef.current = false;
  }, [data.storyId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITOR CALLBACKS
  // ═══════════════════════════════════════════════════════════════════════════

  const cacheRestoredRef = useRef(false);

  // Pagination swaps the active editor every time focus moves to a different
  // page. Track the selectionUpdate handler we attached so we can detach it
  // from the prior editor — otherwise stale listeners on old pages keep
  // overwriting currentParagraphSceneId after focus has already moved.
  const selectionListenerRef = useRef<{ editor: Editor; fn: () => void } | null>(null);

  const handleEditorReady = useCallback((editor: Editor) => {
    const prev = selectionListenerRef.current;
    if (prev && prev.editor === editor) {
      editorRef.current = editor;
      return;
    }
    if (prev && !prev.editor.isDestroyed) {
      prev.editor.off("selectionUpdate", prev.fn);
    }

    editorRef.current = editor;

    const onSelectionUpdate = () => {
      const { $from } = editor.view.state.selection;
      if ($from.depth === 0) { setCurrentParagraphSceneId(null); return; }
      const pos = $from.before();
      const node = editor.view.state.doc.nodeAt(pos);
      setCurrentParagraphSceneId(node?.attrs["data-scene-id"] ?? null);
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    editor.on("update", handleEditorChange);
    selectionListenerRef.current = { editor, fn: onSelectionUpdate };
  }, [handleEditorChange]);

  const handleScenePositionsUpdate = useCallback((positions: ScenePosition[]) => {
    setScenePositions(positions);
  }, []);

  const handleBeatSelect = useCallback(
    (beatId: string) => {
      if (beatId !== selectedBeatId) { setSelectedSceneId(null); setLoadedScenes([]); }
      setSelectedBeatId(beatId);
      setTimeout(() => {
        const result = fetchScenesForBeat(beatId);
        if (result.success && result.scenes) {
          const sortedScenes: Scene[] = result.scenes
            .map((scene: any) => ({
              sceneId: scene.sceneId || scene.id,
              title: scene.title || "", content: scene.content || "",
              metadata: scene.metadata || {},
            }))
            .sort((a, b) => compareSceneIds(a.sceneId, b.sceneId));
          setLoadedScenes(sortedScenes);
          setIsExpanded((prev) => ({ ...prev, [beatId]: true }));
          if (sortedScenes.length > 0) setSelectedSceneId(sortedScenes[0].sceneId);
        } else {
          toast.error(result.error || "Failed to load scenes");
        }
      }, 1000);
    },
    [selectedBeatId]
  );

  const handleToggleExpand = useCallback((beatId: string) => {
    setIsExpanded((prev) => ({ ...prev, [beatId]: !prev[beatId] }));
  }, []);

  const handleSceneSelect = useCallback(
    (sceneId: string) => {
      setSelectedSceneId(sceneId);
      const editor = editorRef.current;
      const scenePosition = scenePositions.find((pos) => pos.id === sceneId);
      if (scenePosition && editor) {
        editor.chain().focus().setTextSelection(scenePosition.startLine).run();
        setTimeout(() => {
          document
            .querySelector(`.screenplay-source [data-scene-id="${sceneId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
    },
    [scenePositions]
  );


  /*
   * @param sceneLabel - format "N.M" matching data-scene-id on paragraphs
   */

  const handleNavigateToScene = useCallback((sceneLabel: string) => {
    // ─── Inject shine styles ──────────────────────────────────────────────
    if (!document.getElementById("scene-navigate-shine-style")) {
      const style = document.createElement("style");
      style.id = "scene-navigate-shine-style";
      style.textContent = `
      @keyframes sceneShine {
        0% {
          box-shadow: 0 0 0 0 rgba(100, 180, 255, 0) !important;
          background: rgba(100, 180, 255, 0) !important;
        }
        25% {
          box-shadow: 0 0 0 12px rgba(100, 180, 255, 0.55) !important;
          background: rgba(100, 180, 255, 0.25) !important;
        }
        50% {
          box-shadow: 0 0 0 10px rgba(100, 180, 255, 0.45) !important;
          background: rgba(100, 180, 255, 0.20) !important;
        }
        75% {
          box-shadow: 0 0 0 6px rgba(100, 180, 255, 0.30) !important;
          background: rgba(100, 180, 255, 0.12) !important;
        }
        100% {
          box-shadow: 0 0 0 0 rgba(100, 180, 255, 0) !important;
          background: rgba(100, 180, 255, 0) !important;
        }
      }
      
      .ProseMirror p.scene-navigate-shine {
        animation: sceneShine 2000ms cubic-bezier(0.2, 0.9, 0.2, 1) both !important;
        border-radius: 6px !important;
        outline: none !important;
        transition: all 0.3s ease !important;
        position: relative !important;
        z-index: 100 !important;
        padding: 4px 8px !important;
        margin-left: -8px !important;
        margin-right: -8px !important;
      }
      
      .screenplay-content-area.dark-theme .ProseMirror p[data-line-type="scene"].scene-navigate-shine {
        color: #60a5fa !important;
      }
      
      .ProseMirror p[data-line-type="scene"].scene-navigate-shine::after {
        position: relative !important;
        z-index: 101 !important;
      }
    `;
      document.head.appendChild(style);
    }

    const SHINE_CLASS = "scene-navigate-shine";

    const applyShine = (el: HTMLElement) => {
      el.classList.remove(SHINE_CLASS);
      void el.offsetWidth;
      el.classList.add(SHINE_CLASS);
      setTimeout(() => el.classList.remove(SHINE_CLASS), 2100);
    };

    const findFirstSceneHeading = (sceneLabel: string): HTMLElement | null => {
      const selector = `.paginated-canvas .ProseMirror [data-scene-id="${sceneLabel}"]`;
      const allParagraphs = Array.from(document.querySelectorAll(selector)) as HTMLElement[];

      for (const p of allParagraphs) {
        const lineType = p.getAttribute("data-line-type");
        if (lineType === "scene" || lineType === "slugline") {
          return p;
        }
      }

      return allParagraphs[0] || null;
    };

    // ─── Main logic ───────────────────────────────────────────────────────
    const targetElement = findFirstSceneHeading(sceneLabel);

    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(() => applyShine(targetElement), 900);

    setTimeout(() => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;

      let targetPos: number | null = null;

      editor.state.doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        const nodeSceneId = node.attrs?.["data-scene-id"];
        const nodeLineType = node.attrs?.["data-line-type"];

        if (nodeSceneId === sceneLabel && (nodeLineType === "scene" || nodeLineType === "slugline")) {
          targetPos = pos;
          return false;
        }
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
      }
    }, 1000);
  }, []);

  const handleAssignSceneToSelection = useCallback(
    (sceneId: string, segmentId: string, sceneIndex: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      const { state } = editor.view;
      const { $from } = state.selection;
      if ($from.depth === 0) return;
      const pos = $from.before();
      const node = state.doc.nodeAt(pos);
      if (!node || node.type.name !== "paragraph") return;
      const segNum = segmentId.replace("S", "");
      const sceneLabel = `${segNum}.${sceneIndex + 1}`;
      editor.view.dispatch(
        state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, "data-scene-id": sceneLabel })
      );
      toast.success(`Parágrafo vinculado à cena ${sceneLabel}`);
    },
    []
  );

  const handleGenerateScene = useCallback(
    (sceneId: string, segmentId?: string, sceneIndex?: number) => {
      generateScene(sceneId, segmentId, sceneIndex);
    },
    [generateScene]
  );

  const handleFullscreen = useCallback(() => setIsFullscreen(true), []);
  const handleMinimize = useCallback(() => setIsFullscreen(false), []);

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isFullscreen]);

  useEffect(() => {
    if (storyData.segments.length > 0 && !selectedBeatId) {
      const firstBeatId = storyData.segments[0].id;
      setSelectedBeatId(firstBeatId);
      handleBeatSelect(firstBeatId);
    }
  }, []);

  useEffect(() => {
    const header = document.querySelector("header") as HTMLElement;
    const sidebar = document.querySelector("[data-sidebar='main']") as HTMLElement;
    const footer = document.querySelector("footer") as HTMLElement;
    if (header) header.style.display = isFullscreen ? "none" : "";
    if (sidebar) sidebar.style.display = isFullscreen ? "none" : "";
    if (footer) footer.style.display = isFullscreen ? "none" : "";
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isFullscreen]);

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA → SEGMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  const parseScenesFromData = (segmentData: any): Scene[] => {
    if (!segmentData?.scenes) return [];
    if (Array.isArray(segmentData.scenes)) {
      return segmentData.scenes.map((scene: any) => ({
        sceneId: scene.sceneId || scene.id, title: scene.title || "",
        content: scene.description || scene.content || "",
        isExpanded: false, metadata: scene.metadata || {},
      }));
    }
    return Object.entries(segmentData.scenes).map(
      ([sceneId, scene]: [string, any]) => ({
        sceneId, title: scene.title || "",
        content: scene.description || scene.content || "",
        isExpanded: false, metadata: scene.metadata || {},
      })
    );
  };

  const segmentDescriptions: Record<string, string> = {
    S1: "The opening scene or sequence that establishes the protagonist's everyday life, grounding the story before any major conflict arises.",
    S2: "The event that disrupts the protagonist's life, setting the story's main conflict in motion and drawing the protagonist into action.",
    S3: "A pivotal moment where the protagonist makes a decision or takes an action that commits them to the story's central journey, closing off the option to return to their former life.",
    S4: "A pressure point that intensifies the conflict, often by revealing new information or escalating tension, reminding the protagonist of the stakes involved.",
    S5: "A major turning point where the protagonist experiences a significant realization, shift in perspective, or confrontation that deepens their commitment to the goal or conflict.",
    S6: "A critical challenge or obstacle that raises the stakes even higher, often bringing the protagonist to a low point or forcing them to confront their fears.",
    S7: "The story's darkest moment, where all seems lost for the protagonist, intensifying the drama before the final push toward resolution.",
    S8: "The peak of the story's action, where the main conflict reaches its most intense point and the protagonist faces their greatest challenge or decision.",
    S9: "The story's conclusion, showing the outcome of the protagonist's journey and resolving any lingering questions or themes.",
  };

  useEffect(() => {
    if (!data) return;
    const previouslySelectedId = selectedSegment?.id;
    const segmentsFromData: SegmentWithScenes[] = [
      { id: "S1", title: "Introduction and Stasis", content: typeof data.S1 === "string" ? data.S1 : data.S1?.S || "", scenes: parseScenesFromData(data.S1), act: 1, description: segmentDescriptions.S1, isSelected: false },
      { id: "S2", title: "Inciting Incident", content: typeof data.S2 === "string" ? data.S2 : data.S2?.S || "", scenes: parseScenesFromData(data.S2), act: 1, description: segmentDescriptions.S2, isSelected: false },
      { id: "S3", title: "Commitment", content: typeof data.S3 === "string" ? data.S3 : data.S3?.S || "", scenes: parseScenesFromData(data.S3), act: 1, description: segmentDescriptions.S3, isSelected: false },
      { id: "S4", title: "First Pinch Point", content: typeof data.S4 === "string" ? data.S4 : data.S4?.S || "", scenes: parseScenesFromData(data.S4), act: 2, description: segmentDescriptions.S4, isSelected: false },
      { id: "S5", title: "Midpoint", content: typeof data.S5 === "string" ? data.S5 : data.S5?.S || "", scenes: parseScenesFromData(data.S5), act: 2, description: segmentDescriptions.S5, isSelected: false },
      { id: "S6", title: "Second Pinch Point", content: typeof data.S6 === "string" ? data.S6 : data.S6?.S || "", scenes: parseScenesFromData(data.S6), act: 2, description: segmentDescriptions.S6, isSelected: false },
      { id: "S7", title: "Second Plot Point", content: typeof data.S7 === "string" ? data.S7 : data.S7?.S || "", scenes: parseScenesFromData(data.S7), act: 3, description: segmentDescriptions.S7, isSelected: false },
      { id: "S8", title: "Climax", content: typeof data.S8 === "string" ? data.S8 : data.S8?.S || "", scenes: parseScenesFromData(data.S8), act: 3, description: segmentDescriptions.S8, isSelected: false },
      { id: "S9", title: "Resolution", content: typeof data.S9 === "string" ? data.S9 : data.S9?.S || "", scenes: parseScenesFromData(data.S9), act: 3, description: segmentDescriptions.S9, isSelected: false },
    ];
    const segmentToSelect =
      segmentsFromData.find((s) => s.id === previouslySelectedId) ?? segmentsFromData[0];
    setSegments(segmentsFromData.map((seg) => ({ ...seg, isSelected: seg.id === segmentToSelect.id })));
    setSelectedSegment(segmentToSelect);
  }, [data]);

  useEffect(() => {
    const header = document.querySelector("header") as HTMLElement;
    const storyNav = document.querySelector(".secondary-nav-container") as HTMLElement;
    const appContainer = document.querySelector(".app-container.scripts-page") as HTMLElement;
    if (!header || !storyNav || !appContainer) return;
    const headerHeight = header.getBoundingClientRect().height;
    const storyNavBottomPosition = (() => {
      const rect = storyNav.getBoundingClientRect();
      return window.scrollY + rect.top + rect.height;
    })();
    const handleScroll = () => {
      if (window.scrollY >= storyNavBottomPosition - headerHeight) {
        appContainer.style.position = "sticky";
        appContainer.style.top = `${headerHeight}px`;
        appContainer.style.left = "0";
        appContainer.style.right = "0";
        appContainer.style.width = "100%";
        appContainer.style.zIndex = "50";
      } else {
        appContainer.style.position = "static";
        appContainer.style.top = "";
        appContainer.style.left = "";
        appContainer.style.right = "";
        appContainer.style.width = "";
      }
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // SIDEBAR ACTS
  // ═══════════════════════════════════════════════════════════════════════════

  const getActsStats = (
    actsSegments: Record<string, SegmentWithScenes[]>
  ): Record<string, ActComputedStats> => {
    return Object.entries(actsSegments).reduce((acc, [actId, segs]) => {
      const segmentStats: Record<string, SegmentStats> = {};
      let totalScenes = 0, completedSegments = 0;
      segs.forEach((segment) => {
        const scenesCount = segment.scenes.length;
        segmentStats[segment.id] = { scenesCount };
        totalScenes += scenesCount;
        if (scenesCount > 0) completedSegments++;
      });
      acc[actId] = {
        actId,
        actStats: {
          totalScenes,
          progressPercentage: Math.round((completedSegments / segs.length) * 100),
        },
        segmentStats,
      };
      return acc;
    }, {} as Record<string, ActComputedStats>);
  };

  const actsStats = getActsStats({
    "act-1": actISegments,
    "act-2": actIISegments,
    "act-3": actIIISegments,
  });

  const sidebarActs: ActItem[] = [
    {
      id: "act-1", label: "Act I", stats: actsStats["act-1"].actStats,
      children: actISegments.map((s) => ({ id: s.id, label: s.title, targetId: s.id, stats: actsStats["act-1"].segmentStats[s.id] })),
    },
    {
      id: "act-2", label: "Act II", stats: actsStats["act-2"].actStats,
      children: actIISegments.map((s) => ({ id: s.id, label: s.title, targetId: s.id, stats: actsStats["act-2"].segmentStats[s.id] })),
    },
    {
      id: "act-3", label: "Act III", stats: actsStats["act-3"].actStats,
      children: actIIISegments.map((s) => ({ id: s.id, label: s.title, targetId: s.id, stats: actsStats["act-3"].segmentStats[s.id] })),
    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <Theme>
      <Toaster position="top-center" reverseOrder={false} />
      <Header />

      {/* Save status pill */}
      <div className="fixed top-[74px] left-[20px] flex items-center gap-1 text-white font-inter bg-[linear-gradient(135deg,rgba(255,107,53,0.8)_0%,rgba(255,140,66,0.8)_100%)] shadow px-4 py-1 rounded-b-lg text-xs font-thin z-[1999]">
        {isSaving ? (
          <><Loader className="w-3 h-3 animate-spin" /><span>Saving…</span></>
        ) : lastSaved ? (
          <><CheckCircle className="w-3 h-3" /><span>Saved at {formatTime(lastSaved)}</span></>
        ) : null}
      </div>

      <StoryNavigationSidebar
        segments={segments}
        isScrolled={isScrolled}
        storyTitle={data.title || "Untitled Story"}
        acts={sidebarActs}
        onAssignSceneToSelection={handleAssignSceneToSelection}
        currentParagraphSceneId={currentParagraphSceneId}
        onGenerateScene={(sceneId, segmentId, index) => handleGenerateScene(sceneId, segmentId, index)}
        onNavigateToScene={handleNavigateToScene}
      >
        <div
          className="app-container scripts-page"
          style={{ paddingBottom: "3rem", marginLeft: "40px", marginRight: "40px", marginTop: "30px" }}
        >
          <div className="gradient-background" />
          {/* Orange ambient glow */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "radial-gradient(ellipse at 50% 45%, rgba(255, 140, 0, 0.06) 0%, transparent 30%)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          {/* Dotted grid */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundImage: "radial-gradient(circle, rgba(255, 140, 0, 0.22) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          {/* Vignette */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.25) 100%)",
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          <Flex direction="column" justify="center" style={{ flexGrow: 1, position: "relative", height: "calc(100vh - 153px)", minHeight: 0 }}>
            {/* <StoryBreadcrumbHeader storyTitle={data.title || "Untitled Story"} /> */}
            <Box
              style={{
                position: "fixed", top: "20px", right: "20px", zIndex: 1000,
                padding: "8px 16px", borderRadius: "4px",
                backgroundColor: "rgba(0,0,0,0.7)", color: "white",
                transition: "opacity 0.3s ease",
                opacity: showSavedIndicator ? 1 : 0, pointerEvents: "none",
              }}
            >
              {isSaving ? "Saving…" : "Saved"}
            </Box>

            <div style={{ width: "100%", maxWidth: "100vw", paddingLeft: "0.5rem", paddingRight: "0.5rem", margin: "0 auto", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <Flex style={{ width: "100%", flex: 1, display: "flex", minHeight: 0 }} justify="center" align="stretch">
                <div
                  style={{
                    position: isFullscreen ? "fixed" : "relative",
                    inset: isFullscreen ? 0 : "auto",
                    zIndex: isFullscreen ? 9999 : "auto",
                    backgroundColor: "transparent",
                    display: "flex", flexDirection: "column",
                    width: isFullscreen ? "100vw" : "100%",
                    height: isFullscreen ? "100vh" : "100%",
                    flex: 1,
                    overflow: isFullscreen ? "hidden" : "visible",
                  }}
                >
                  <div style={{
                    display: "flex", width: "100%", height: "100%",
                    flex: 1, minHeight: 0
                  }}>
                    {/*
                      key={data.storyId} forces a full ScriptEditor remount when the story
                      changes, so PaginatedEditor re-initialises with the correct initialContent.
                    */}
                    <ScriptEditor
                      getAllHTMLRef={getAllHTMLRef}
                      getAllEditorsRef={getAllEditorsRef}
                      onImportExport={() => setScriptPreviewOpen(true)}
                      charactersOpen={() => setCharactersOpen(true)}
                      onEditorReady={handleEditorReady}
                      editorTheme={editorTheme}
                      onThemeToggle={() => setEditorTheme(editorTheme === "dark" ? "light" : "dark")}
                      isGenerating={isGenerating}
                      isFullscreen={isFullscreen}
                      onFullscreen={handleFullscreen}
                      onMinimize={handleMinimize}
                      onScenePositionsUpdate={handleScenePositionsUpdate}
                      onSave={handleScriptSave}
                      initialContent={initialScreenplayContent}
                      characters={Characters || []}
                      onAddCharacter={addCharacter}
                      onUpdateCharacter={updateCharacter}
                      onDeleteCharacter={deleteCharacter}
                      token={token}
                      storyData={storyData}
                      storyId={data.storyId}
                      setUser={setUser}
                      isSceneDirty={isSceneDirty}
                      getSceneTaggedContent={getSceneTaggedContent}
                      markSceneExtracted={markSceneExtracted}
                    />
                  </div>
                  <GenerationLoadingOverlay
                    isVisible={isGenerating}
                    handoffStage={handoffStage}
                  />
                </div>
              </Flex>
            </div>
          </Flex>
        </div>
      </StoryNavigationSidebar>

      {/*<Footer />*/}

      <ScriptsPreviewModal
        isOpen={scriptPreviewOpen}
        onClose={() => setScriptPreviewOpen(false)}
        screenplayHTML={getAllHTMLRef.current?.() ?? ""}
        storyTitle={data.title || "Untitled Story"}
      />

      < CharacterPanel
        isOpen={charactersOpen}
        onClose={() => setCharactersOpen(false)}
      />
    </Theme>
  );
}

export default Scripts;