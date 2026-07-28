/**
 * ScriptEditor.tsx
 * ================
 * Composes the TipTap screenplay editor with all its supporting UI.
 *
 * FIL-302 Step 2d: Accepts isSceneDirty and getSceneTaggedContent props
 * from Scripts.tsx and passes them into useGuidedGeneration and useInlineAI
 * so both CMD+J and inline revise/suggest paths can request pre-AI
 * extraction when the current scene is dirty.
 *
 * FIL-315: Loading shimmer is handled purely via ProseMirror decorations
 * in InlineAIDecorationPlugin (no separate overlay component needed).
 * useInlineAI locks the editor and applies the loadingTarget decoration.
 *
 * MULTI-PAGE SAVE: Exposes getAllHTMLRef so Scripts.tsx can call
 * paginatedEditorRef.getAllHTML() to collect every page's content,
 * instead of only the currently-focused page's editor.getHTML().
 *
 * Imported by: Scripts.tsx
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Editor, Extension } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import SluglineAutoFill from "./editor/tools/SluglineAutoFill";
import CharacterAutoFill from "./editor/tools/CharacterAutoFill";
import TransitionAutoFill from "./editor/tools/TransitionAutoFill";
import Toolbar from "./editor/tools/toolbar";
import GenerationOverlay from "./GenerationOverlay";
import InlineAIRail from "./InlineAIRail";
import SelectionPopup from "./SelectionPopup";
import OverwriteConfirmModal from "../Home/OverwriteConfirmModal";
import { useEditorErrorHandling } from "./useEditorErrorHandling";
import { debounce } from "./editorUtils";
import { ScenePosition } from "./types";
import PaginatedEditor, { PaginatedEditorHandle } from "./PaginatedEditor";
import { useInlineAI } from "./useInlineAI";
import useGuidedGeneration from "./useGuidedGeneration";
import { hasTextSelection, getSelectedTaggedText } from "./InlineAIHelpers";
import { createInlineAIDecorationPlugin, showSelectionTarget, clearAllDecorations } from "./InlineAIDecorationPlugin";
import { snapToWordBoundaries } from "./selectionUtils";

const InlineAIDecorations = Extension.create({
  name: "inlineAIDecorations",
  addProseMirrorPlugins() {
    return [createInlineAIDecorationPlugin()];
  },
});

interface ScriptEditorProps {
  onEditorReady: (editor: Editor) => void;
  editorTheme: "dark" | "light";
  onThemeToggle: () => void;
  isGenerating: boolean;
  isFullscreen: boolean;
  onFullscreen: () => void;
  onMinimize: () => void;
  onScenePositionsUpdate: (positions: ScenePosition[]) => void;
  /** Called when the user explicitly triggers a save (toolbar button / Ctrl+S) */
  onSave?: () => void;
  /**
   * Ref forwarded from Scripts.tsx so it can call getAllHTML() to collect
   * every page's content when saving — not just the active page.
   */
  getAllHTMLRef?: React.MutableRefObject<(() => string) | null>;
  /**
   * Ref forwarded from Scripts.tsx so the extraction tracker can walk every
   * page editor's doc, not just the focused page's. Without this, scenes on
   * pages other than the active one are invisible to the dirty check.
   */
  getAllEditorsRef?: React.MutableRefObject<(() => Editor[]) | null>;
  /**
   * Persisted HTML from a previous session (data.screenplayContent).
   * Passed straight through to PaginatedEditor → SinglePage so the first
   * page is restored instead of starting blank.
   */
  initialContent?: string;
  characters: any[];
  onAddCharacter: (character: any) => void;
  onUpdateCharacter: (character: any) => void;
  onDeleteCharacter: (id: string) => void;
  token: any;
  storyData: any;
  storyId: string;
  setUser: (updater: (prev: any) => any) => void;
  /** FIL-302 2d: Check if a scene's content has changed since last extraction */
  isSceneDirty?: (sceneId: string) => boolean;
  /** FIL-302 2d: Get tagged content for a scene (sent to backend for extraction) */
  getSceneTaggedContent?: (sceneId: string) => string | null;
  onImportExport?: () => void;
  /** FIL-302: Update baseline hash after generation/accept so navigation trigger doesn't redundantly re-extract */
  markSceneExtracted?: (sceneId: string) => void;
  charactersOpen?: () => void;
  /** Freeform host: hide the inline-AI rail + selection popup + CMD+J (the
   *  outline's suggest/revise/generate surface). Default true (outline). */
  showAIRail?: boolean;
  /** Extra TipTap extensions appended to the page editors (freeform host
   *  registers its scene-skeleton attributes here). */
  extraExtensions?: Extension[];
}

const calculateScenePositions = (editor: Editor): ScenePosition[] => {
  if (!editor) return [];
  try {
    const positions: ScenePosition[] = [];
    let currentSceneId: string | null = null;
    let startLine = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") {
        const sceneId = node.attrs["data-scene-id"];
        if (sceneId && sceneId !== currentSceneId) {
          if (currentSceneId && startLine >= 0 && pos - 1 > startLine) {
            positions.push({
              id: currentSceneId, startLine, endLine: pos - 1,
              content: safeGetTextBetween(editor, startLine, pos - 1),
            });
          }
          currentSceneId = sceneId;
          startLine = pos;
        }
      }
      return true;
    });

    if (currentSceneId && startLine >= 0) {
      const docSize = editor.state.doc.content.size;
      if (docSize > startLine) {
        positions.push({
          id: currentSceneId, startLine, endLine: docSize,
          content: safeGetTextBetween(editor, startLine, docSize),
        });
      }
    }
    return positions;
  } catch (error) {
    console.error("Error calculating scene positions:", error);
    return [];
  }
};

const safeGetTextBetween = (editor: Editor, start: number, end: number): string => {
  try {
    const docSize = editor.state.doc.content.size;
    const safeStart = Math.max(0, Math.min(start, docSize));
    const safeEnd = Math.max(safeStart, Math.min(end, docSize));
    return safeStart < safeEnd ? editor.state.doc.textBetween(safeStart, safeEnd, " ") : "";
  } catch { return ""; }
};

const ScriptEditor: React.FC<ScriptEditorProps> = ({
  onEditorReady, editorTheme, onThemeToggle, isGenerating, isFullscreen,
  onFullscreen, onMinimize, onScenePositionsUpdate, characters,
  onAddCharacter, onUpdateCharacter, onDeleteCharacter,
  token, storyData, storyId, setUser, onSave, initialContent, isSceneDirty, getSceneTaggedContent, markSceneExtracted, getAllHTMLRef, getAllEditorsRef, onImportExport, charactersOpen,
  showAIRail = true, extraExtensions
}) => {
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [, setEditorVersion] = useState(0);
  const [activePanel, setActivePanel] = useState<"suggest" | "revise" | "generate" | "characters" | null>(null);
  const [editorHasSelection, setEditorHasSelection] = useState(false);
  const [showCrossSceneWarning, setShowCrossSceneWarning] = useState(false);

  // ── Ref to PaginatedEditor for multi-page content collection ─────────────
  const paginatedEditorRef = useRef<PaginatedEditorHandle>(null);

  // Keep the parent-supplied getAllHTMLRef in sync every render so Scripts.tsx
  // can always call it and get the latest multi-page HTML.
  useEffect(() => {
    if (getAllHTMLRef) {
      getAllHTMLRef.current = () =>
        paginatedEditorRef.current?.getAllHTML() ?? activeEditor?.getHTML() ?? "";
    }
    if (getAllEditorsRef) {
      getAllEditorsRef.current = () =>
        paginatedEditorRef.current?.getAllEditors() ?? (activeEditor ? [activeEditor] : []);
    }
  });

  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;

  const editorExtensions = useMemo(
    () => [InlineAIDecorations, ...(extraExtensions ?? [])],
    [extraExtensions],
  );

  // ── Cross-page autofill sources ──────────────────────────────────────────
  // CharacterAutoFill needs to see character names from every page, not just
  // the focused one, and from the DB roster so canonical characters surface
  // before they've been used in the script. Memoise rosterNames so the
  // autofill component doesn't see a new array reference on every render.
  const getAllEditorsForAutofill = useCallback(
    () => paginatedEditorRef.current?.getAllEditors() ?? (activeEditor ? [activeEditor] : []),
    [activeEditor]
  );
  const rosterNames = useMemo(
    () => (characters ?? []).map((c: any) => c?.name).filter(Boolean) as string[],
    [characters]
  );

  // FIL-302 2d: Pass isSceneDirty, getSceneTaggedContent, and markSceneExtracted into inline AI
  const inlineAI = useInlineAI({
    editor: activeEditor, token, storyData, storyId, setUser,
    isSceneDirty, getSceneTaggedContent, markSceneExtracted,
    onCrossSceneWarning: () => setShowCrossSceneWarning(true),
  });

  const inlineAIModeRef = useRef(inlineAI.mode);
  inlineAIModeRef.current = inlineAI.mode;

  // ── Selection tracking ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeEditor) return;

    const onSelectionUpdate = () => {
      setEditorVersion(v => v + 1);
      setEditorHasSelection(hasTextSelection(activeEditor));
    };

    const onUpdate = () => {
      setEditorVersion(v => v + 1);
      setEditorHasSelection(hasTextSelection(activeEditor));
    };

    activeEditor.on("selectionUpdate", onSelectionUpdate);
    activeEditor.on("update", onUpdate);
    return () => {
      activeEditor.off("selectionUpdate", onSelectionUpdate);
      activeEditor.off("update", onUpdate);
    };
  }, [activeEditor]);

  // ── Mouseup: snap selection + apply decoration after drag ends ───────────
  useEffect(() => {
    if (!activeEditor) return;

    const editorDom = activeEditor.view.dom;

    const handleMouseUp = () => {
      const panel = activePanelRef.current;
      const aiMode = inlineAIModeRef.current;

      if (
        (panel === "suggest" || panel === "revise") &&
        aiMode !== "pending" &&
        aiMode !== "revise"
      ) {
        // FIL-315: Don't allow re-selection while suggestion cards are displayed
        // or while loading. The editor is locked (non-editable) in those states
        // anyway, but guard the decoration update too.
        if (inlineAI.isLoading || inlineAI.suggestions) return;
        setTimeout(() => {
          if (!activeEditor || activeEditor.isDestroyed) return;

          const { from, to } = activeEditor.state.selection;
          if (from === to) return;

          const snapped = snapToWordBoundaries(activeEditor, from, to);

          if (snapped.from !== from || snapped.to !== to) {
            const tr = activeEditor.state.tr.setSelection(
              TextSelection.create(activeEditor.state.doc, snapped.from, snapped.to)
            );
            activeEditor.view.dispatch(tr);
          }

          showSelectionTarget(
            activeEditor,
            snapped.from,
            snapped.to,
            panel as "suggest" | "revise"
          );
        }, 10);
      }
    };

    editorDom.addEventListener("mouseup", handleMouseUp);
    return () => editorDom.removeEventListener("mouseup", handleMouseUp);
  }, [activeEditor]);

  useEditorErrorHandling(activeEditor);

  // FIL-302 2d: Pass isSceneDirty and getSceneTaggedContent into guided gen
  // getAllEditors is forwarded so guided-gen can clear the green pending
  // mark on paragraphs that overflowed onto a subsequent page editor.
  const guidedGen = useGuidedGeneration({
    editor: activeEditor, token, storyData, storyId, setUser,
    isSceneDirty, getSceneTaggedContent, markSceneExtracted,
    getAllEditors: () => paginatedEditorRef.current?.getAllEditors() ?? [],
  });

  useEffect(() => {
    if (!showAIRail) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setActivePanel(prev => prev === "generate" ? null : "generate");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAIRail]);

  const cleanupPanel = useCallback(
    (prev: "suggest" | "revise" | "generate" | "characters" | null) => {
      if (prev === "generate") {
        if (guidedGen.state === "pending") guidedGen.remove();
        guidedGen.dismiss();
      }
      if (prev && prev !== "generate" && prev !== "characters") {
        if (inlineAI.mode === "pending") inlineAI.rejectPending();
        else inlineAI.dismiss();
      }
      if (activeEditor) clearAllDecorations(activeEditor);
    },
    [guidedGen, inlineAI, activeEditor]
  );

  const handlePopupRevise = useCallback(
    (from: number, to: number) => {
      setActivePanel(prev => { if (prev) cleanupPanel(prev); return "revise"; });
      if (activeEditor) showSelectionTarget(activeEditor, from, to, "revise");
    },
    [activeEditor, cleanupPanel]
  );

  const handlePopupSuggest = useCallback(
    (from: number, to: number) => {
      setActivePanel(prev => { if (prev) cleanupPanel(prev); return "suggest"; });
      if (activeEditor) showSelectionTarget(activeEditor, from, to, "suggest");
    },
    [activeEditor, cleanupPanel]
  );

  const handleToggleSuggest = useCallback(() => {
    setActivePanel(prev => {
      if (prev === "suggest") {
        if (activeEditor) clearAllDecorations(activeEditor);
        if (inlineAI.mode === "pending") inlineAI.rejectPending();
        else inlineAI.dismiss();
        return null;
      }
      if (prev) cleanupPanel(prev);
      if (activeEditor && hasTextSelection(activeEditor)) {
        const { from, to } = activeEditor.state.selection;
        const snapped = snapToWordBoundaries(activeEditor, from, to);
        showSelectionTarget(activeEditor, snapped.from, snapped.to, "suggest");
      }
      return "suggest";
    });
  }, [inlineAI, activeEditor, cleanupPanel]);

  const handleToggleRevise = useCallback(() => {
    setActivePanel(prev => {
      if (prev === "revise") {
        if (activeEditor) clearAllDecorations(activeEditor);
        if (inlineAI.mode === "pending") inlineAI.rejectPending();
        else inlineAI.dismiss();
        return null;
      }
      if (prev) cleanupPanel(prev);
      if (activeEditor && hasTextSelection(activeEditor)) {
        const { from, to } = activeEditor.state.selection;
        const snapped = snapToWordBoundaries(activeEditor, from, to);
        showSelectionTarget(activeEditor, snapped.from, snapped.to, "revise");
      }
      return "revise";
    });
  }, [inlineAI, activeEditor, cleanupPanel]);

  const handleToggleGenerate = useCallback(() => {
    setActivePanel(prev => {
      if (prev === "generate") {
        if (guidedGen.state === "pending") guidedGen.remove();
        guidedGen.dismiss();
        return null;
      }
      if (prev) cleanupPanel(prev);
      return "generate";
    });
  }, [guidedGen, cleanupPanel]);

  const handleToggleCharacters = useCallback(() => {
    setActivePanel(prev => {
      if (prev === "characters") {
        return null;
      }
      if (prev) cleanupPanel(prev);
      return "characters";
    });
  }, [cleanupPanel]);

  const handleImportExport = useCallback(() => { onImportExport?.(); }, [onImportExport]);

  const handleDismiss = useCallback(() => {
    if (inlineAI.mode === "pending") inlineAI.rejectPending();
    else inlineAI.dismiss();
    if (activeEditor) clearAllDecorations(activeEditor);
  }, [inlineAI, activeEditor]);

  // FIL-315: Accept and auto-close panel
  const handleAcceptPending = useCallback(() => {
    inlineAI.acceptPending();
    setActivePanel(null);
  }, [inlineAI]);

  const debouncedUpdatePositions = useCallback(
    debounce((editor: Editor) => {
      try {
        const positions = calculateScenePositions(editor);
        onScenePositionsUpdate(positions);
      } catch (error) {
        console.error("Error in debounced scene position update:", error);
      }
    }, 300),
    [onScenePositionsUpdate]
  );

  const handleActiveEditorReady = useCallback(
    (editor: Editor) => {
      setActiveEditor(editor);
      onEditorReady(editor);
      debouncedUpdatePositions(editor);
    },
    [onEditorReady, debouncedUpdatePositions]
  );

  // ── Ctrl+S / Cmd+S ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!onSave) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); onSave(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  // ── Sync active editor on fullscreen transitions ─────────────────────────
  useEffect(() => {
    if (!activeEditor) return;
    const timer = setTimeout(() => {
      try { activeEditor.view.updateState(activeEditor.view.state); }
      catch (error) { console.error("Editor sync error:", error); }
    }, 100);
    return () => clearTimeout(timer);
  }, [isFullscreen, activeEditor]);

  useEffect(() => {
    if (!isFullscreen && activeEditor) {
      const timer = setTimeout(() => {
        try {
          const tr = activeEditor.view.state.tr.setMeta("exitFullscreen", true);
          activeEditor.view.dispatch(tr);
          activeEditor.commands.focus();
        } catch (error) { console.error("Focus restore error:", error); }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isFullscreen, activeEditor]);

  const themeClass = editorTheme === "light" ? "light-theme" : "dark-theme";

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minHeight: 0 }}>
      <style>{`
        .screenplay-content-area,
        .screenplay-content-area .paginated-canvas {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .screenplay-content-area::-webkit-scrollbar,
        .screenplay-content-area .paginated-canvas::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, height: "100%" }}>
        <div className="screenplay-toolbar-area" style={{ flexShrink: 0, minWidth: 0, overflow: "hidden" }}>
          <div style={{ width: "100%", overflow: "hidden" }}>
            <Toolbar
              editor={activeEditor} onFullscreen={onFullscreen} onMinimize={onMinimize}
              isFullscreen={isFullscreen} editorTheme={editorTheme} onThemeToggle={onThemeToggle}
              characters={characters} onAddCharacter={onAddCharacter}
              onUpdateCharacter={onUpdateCharacter} onDeleteCharacter={onDeleteCharacter} onSave={onSave}
            />
          </div>
        </div>

        <div className={`screenplay-content-area ${themeClass}`} style={{ flex: 1, minHeight: 0 }}>
          {activeEditor && (
            <SluglineAutoFill
              editor={activeEditor}
              getEditors={getAllEditorsForAutofill}
            />
          )}
          {activeEditor && (
            <CharacterAutoFill
              editor={activeEditor}
              getEditors={getAllEditorsForAutofill}
              rosterNames={rosterNames}
            />
          )}
          {activeEditor && <TransitionAutoFill editor={activeEditor} />}

          {/* ref={paginatedEditorRef} exposes getAllHTML() for multi-page saves */}
          <PaginatedEditor
            key={storyId}
            ref={paginatedEditorRef}
            editorTheme={editorTheme}
            onActiveEditorReady={handleActiveEditorReady}
            initialContent={initialContent}
            extensions={editorExtensions}
          />

          {showAIRail && (
            <SelectionPopup
              editor={activeEditor}
              panelOpen={activePanel !== null}
              onRevise={handlePopupRevise}
              onSuggest={handlePopupSuggest}
            />
          )}
        </div>
      </div>

      {showAIRail && (
      <div
        style={{
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          height: "100vh",
          maxHeight: "100vh",
          display: "flex",
          flexDirection: "row",
          zIndex: 90,
        }}
      >
        <InlineAIRail
          activePanel={activePanel}
          onToggleSuggest={handleToggleSuggest}
          onToggleRevise={handleToggleRevise}
          onToggleGenerate={handleToggleGenerate}
          onToggleCharacters={handleToggleCharacters}
          onImportExport={handleImportExport}
          hasSelection={editorHasSelection}
          inlineAIMode={inlineAI.mode}
          isLoading={inlineAI.isLoading}
          error={inlineAI.error}
          suggestions={inlineAI.suggestions}
          onSuggest={inlineAI.suggest}
          onApplySuggestion={inlineAI.applySuggestion}
          revisionResult={inlineAI.revisionResult}
          onRevise={inlineAI.revise}
          onApplyRevision={inlineAI.applyRevision}
          onRetry={inlineAI.retry}
          onAcceptPending={handleAcceptPending}
          onRejectPending={inlineAI.rejectPending}
          onDismiss={handleDismiss}
          selectedText={
            activeEditor && editorHasSelection
              ? getSelectedTaggedText(activeEditor).replace(/^\[<\w+>\]:\s*/gm, "")
              : undefined
          }
          generateState={guidedGen.state}
          generateResultText={guidedGen.resultText}
          generateError={guidedGen.error}
          onGenerate={guidedGen.generate}
          onGenerateAccept={guidedGen.accept}
          onGenerateRemove={guidedGen.remove}
          onGenerateRetry={guidedGen.retry}
          onGenerateDismiss={guidedGen.dismiss}
          currentSceneId={guidedGen.currentSceneId}
        />
      </div>
      )}

      <OverwriteConfirmModal
        isOpen={showCrossSceneWarning}
        onClose={() => setShowCrossSceneWarning(false)}
        onConfirm={() => { }}
        title="Cross-Scene Selection"
        message="Your selection spans multiple scenes. AI revisions and suggestions work within a single scene at a time. Please adjust your selection to stay within one scene."
        confirmLabel="Got it"
        showCancel={false}
      />
    </div>
  );
};

export default ScriptEditor;