/**
 * useEditorErrorHandling.ts
 * =========================
 * Custom hook that adds robust error handling to the TipTap editor.
 *
 * The ProseMirror editor can throw errors in several situations:
 *   - "There is no position before the top-level node" (bad selection)
 *   - Transaction dispatch failures during rapid edits
 *   - Unhandled promise rejections from async editor operations
 *
 * This hook patches the editor at three levels:
 *
 *   1. **Dispatch patching** — Wraps editor.view.dispatch() in a try/catch
 *      so transaction errors don't crash the page. If the specific
 *      "top-level node" error occurs, it resets the selection.
 *
 *   2. **Global error listeners** — Catches window-level errors and
 *      unhandled rejections that originate from ProseMirror/TipTap,
 *      preventing them from propagating to the browser's error UI.
 *
 *   3. **State recovery** — Stores a reference to the last known good
 *      editor state so it can be restored after a crash.
 *
 * Usage:
 *   const editor = useEditor({ ... });
 *   useEditorErrorHandling(editor);
 *
 * All cleanup (removing event listeners, restoring original dispatch)
 * is handled automatically when the component unmounts or the editor changes.
 */

import { useEffect } from "react";
import { Editor } from "@tiptap/react";

export function useEditorErrorHandling(editor: Editor | null): void {
  // ── Level 1: Dispatch patching + global error handler ──────────
  useEffect(() => {
    if (!editor) return;

    try {
      // Wrap the editor's dispatch to catch transaction errors
      const originalDispatch = editor.view.dispatch;

      editor.view.dispatch = function safeDispatch(tr: any) {
        try {
          return originalDispatch.call(this, tr);
        } catch (error) {
          console.warn("Caught error in dispatch:", error);

          // Handle the specific "top-level node" error by resetting selection
          if (
            error instanceof RangeError &&
            error.message.includes(
              "There is no position before the top-level node"
            )
          ) {
            setTimeout(() => {
              editor.commands.setTextSelection(1);
            }, 0);
          }
          return false;
        }
      };

      // Catch editor-related errors at the window level
      const handleEditorError = (event: ErrorEvent) => {
        const isEditorError =
          event.message.includes("ProseMirror") ||
          event.message.includes("tiptap") ||
          event.filename?.includes("tiptap");

        if (isEditorError) {
          console.error("Editor error caught:", event.message);
          event.preventDefault();

          // Try to restore focus after the error
          try {
            editor.commands.focus();
          } catch (focusError) {
            console.warn("Failed to restore focus after error:", focusError);
          }
        }
      };

      window.addEventListener("error", handleEditorError);

      return () => {
        // Restore original dispatch on cleanup
        if (editor && editor.view) {
          editor.view.dispatch = originalDispatch;
        }
        window.removeEventListener("error", handleEditorError);
      };
    } catch (error) {
      // If the setup itself fails, install a minimal fallback handler
      console.error("Error setting up editor dispatch handler:", error);

      const fallbackErrorHandler = (event: ErrorEvent) => {
        if (
          event.message.includes("editor") ||
          event.message.includes("ProseMirror")
        ) {
          console.warn(
            "Editor error caught by fallback handler:",
            event.message
          );
          event.preventDefault();
        }
      };

      window.addEventListener("error", fallbackErrorHandler);

      return () => {
        window.removeEventListener("error", fallbackErrorHandler);
      };
    }
  }, [editor]);

  // ── Level 2: State recovery + promise rejection handler ────────
  useEffect(() => {
    if (!editor) return;

    try {
      // Store a reference to the last known good state for crash recovery
      const storeOriginalState = () => {
        try {
          (editor as any)._originalState = editor.view.state;
        } catch (error) {
          console.error("Error storing original state:", error);
        }
      };

      // Capture initial state
      storeOriginalState();

      // Provide a safe update wrapper that auto-recovers on failure
      (editor as any)._safeUpdate = (fn: Function) => {
        try {
          fn();
          storeOriginalState(); // Update stored state after success
        } catch (error) {
          console.error("Editor update error:", error);

          // Attempt recovery from stored state
          setTimeout(() => {
            try {
              if ((editor as any)._originalState) {
                editor.view.updateState((editor as any)._originalState);
              }
              editor.commands.focus();
            } catch (innerError) {
              console.error("Immediate recovery failed:", innerError);
            }
          }, 0);
        }
      };

      // Catch ProseMirror errors that surface as window errors
      const handleProseMirrorError = (event: ErrorEvent) => {
        if (
          event.message?.includes("ProseMirror") ||
          event.message?.includes("tiptap")
        ) {
          console.error("ProseMirror error caught:", event);
          event.preventDefault();
        }
      };

      // Catch ProseMirror errors that surface as unhandled promise rejections
      const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
        if (
          event.reason &&
          typeof event.reason.message === "string" &&
          (event.reason.message.includes("ProseMirror") ||
            event.reason.message.includes("tiptap"))
        ) {
          console.error("ProseMirror promise rejection caught:", event.reason);
          event.preventDefault();
        }
      };

      window.addEventListener("error", handleProseMirrorError);
      window.addEventListener("unhandledrejection", handleUnhandledRejection);

      return () => {
        window.removeEventListener("error", handleProseMirrorError);
        window.removeEventListener(
          "unhandledrejection",
          handleUnhandledRejection
        );
      };
    } catch (setupError) {
      console.error("Error setting up editor error handling:", setupError);
    }
  }, [editor]);
}

export default useEditorErrorHandling;