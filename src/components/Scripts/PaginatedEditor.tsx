/**
 * PaginatedEditor
 * ===============
 * UM único editor TipTap/ProseMirror que segura o roteiro inteiro, com as
 * fronteiras de página desenhadas como cromo VISUAL:
 *
 *  - As quebras de página são widget decorations "espaçadoras" injetadas pelo
 *    plugin `PageBreaks` (editor/extensions/PageBreaks.ts). Um documento contínuo
 *    faz a seleção nativa atravessar páginas e o texto refluir sozinho — sem os
 *    hacks multi-editor de antes (Ctrl+A sintético, split push-only, handlers
 *    especiais de delete/cut/copy).
 *  - As "folhas" (816×1056, US Letter @96dpi) são um overlay absoluto ATRÁS do
 *    texto, puramente cosmético (`pointer-events:none`). A quantidade vem do
 *    `onPageCountChange` do plugin; as posições são fixas (o espaçador garante
 *    que o texto se alinhe a cada folha).
 *
 * API pública (`PaginatedEditorHandle`) preservada para os consumidores:
 *   getAllHTML() → editor.getHTML();  getAllEditors() → [editor].
 */

import React, {
    useCallback, useEffect, useImperativeHandle,
    useRef, useState, forwardRef,
} from "react";
import { useEditor, EditorContent, Editor, Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { ScreenwritingParagraph } from "./editor/extensions/Screenwritingline";
import { KeyboardShortcuts, SafeSelection } from "./editor/extensions";
import PageBreaks from "./editor/extensions/PageBreaks";

// ─── Dimensões da página ────────────────────────────────────────────────────
const PAGE_W = 816;
const PAGE_H = 1056;
const MARGIN_H = 96;
const MARGIN_V = 96;
const CONTENT_H = PAGE_H - MARGIN_V * 2; // 864 px
const PAGE_GAP = 40;

const EMPTY_PAGE = `<p data-line-type="description"></p>`;

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface PaginatedEditorProps {
    editorTheme: "dark" | "light";
    onActiveEditorReady?: (editor: Editor) => void;
    extensions?: Extensions;
    initialContent?: string;
}

export interface PaginatedEditorHandle {
    getAllHTML: () => string;
    /**
     * Retorna o editor (único) num array, em ordem. Mantido como array para
     * compatibilidade com consumidores cross-página que iteram o resultado.
     */
    getAllEditors: () => Editor[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PaginatedEditor
// ─────────────────────────────────────────────────────────────────────────────

const PaginatedEditor = forwardRef<PaginatedEditorHandle, PaginatedEditorProps>(
    function PaginatedEditor({ editorTheme, onActiveEditorReady, extensions = [], initialContent }, ref) {
        const isDark = editorTheme === "dark";
        const [pageCount, setPageCount] = useState(1);

        // onActiveEditorReady via ref para não recriar o editor.
        const onReadyRef = useRef(onActiveEditorReady);
        onReadyRef.current = onActiveEditorReady;

        const editor = useEditor({
            extensions: [
                StarterKit.configure({
                    paragraph: false, heading: false, horizontalRule: false,
                    blockquote: false, codeBlock: false, bulletList: false,
                    orderedList: false, listItem: false, hardBreak: false,
                }),
                Underline,
                ScreenwritingParagraph.configure({ HTMLAttributes: { class: "screenplay-line" } }),
                KeyboardShortcuts,
                SafeSelection,
                PageBreaks.configure({
                    pageHeight: PAGE_H,
                    contentHeight: CONTENT_H,
                    marginV: MARGIN_V,
                    pageGap: PAGE_GAP,
                    onPageCountChange: (n) => setPageCount(Math.max(1, n)),
                }),
                ...extensions,
            ],
            editorProps: {
                attributes: {
                    class: "paginated-editor-content",
                    spellcheck: "true",
                    style: [
                        "position: relative",
                        "outline: none",
                        `width: ${PAGE_W}px`,
                        "margin: 0 auto",
                        "box-sizing: border-box",
                        `padding: ${MARGIN_V}px ${MARGIN_H}px`,
                        `min-height: ${CONTENT_H + MARGIN_V * 2}px`,
                        "background: transparent",
                        "font-family: 'Courier New', monospace",
                        "font-size: 12pt",
                        "line-height: 1.5",
                        "white-space: pre-wrap",
                        "word-break: break-word",
                    ].join(";"),
                },
            },
            content: initialContent || EMPTY_PAGE,
            autofocus: false,
            onCreate: ({ editor: e }) => { onReadyRef.current?.(e as Editor); },
        });

        // Conteúdo inicial que chega DEPOIS do mount (load assíncrono do roteiro):
        // aplica uma vez, se o doc ainda estiver vazio. Sem a cascata de retries de
        // antes — um editor só não precisa de reflow cross-página priming.
        const appliedRef = useRef(false);
        useEffect(() => {
            if (!editor || appliedRef.current) return;
            if (!initialContent || initialContent === EMPTY_PAGE) return;
            const cur = editor.getHTML();
            const isEmpty =
                cur === EMPTY_PAGE || cur === "<p></p>" || cur === "" ||
                cur.replace(/<[^>]*>/g, "").trim() === "";
            if (!isEmpty) { appliedRef.current = true; return; }
            appliedRef.current = true;
            editor.commands.setContent(initialContent, false);
        }, [editor, initialContent]);

        useImperativeHandle(ref, () => ({
            getAllHTML: () => editor?.getHTML() ?? "",
            getAllEditors: () => (editor && !editor.isDestroyed ? [editor] : []),
        }), [editor]);

        // Altura total do "papel" (topo + N folhas + N-1 lacunas + rodapé).
        const totalHeight =
            PAGE_GAP + pageCount * PAGE_H + (pageCount - 1) * PAGE_GAP + PAGE_GAP;

        // Clicar na área vazia abaixo da última linha foca o fim do doc.
        const handleLayerClick = useCallback((e: React.MouseEvent) => {
            if (e.target === e.currentTarget && editor && !editor.isDestroyed) {
                editor.commands.focus("end");
            }
        }, [editor]);

        return (
            <div
                className="paginated-canvas"
                style={{
                    position: "relative",
                    width: "100%", height: "100%",
                    overflowY: "auto", overflowX: "auto",
                    background: "transparent", boxSizing: "border-box",
                }}
            >
                {/* Overlay de folhas — cromo visual, ATRÁS do texto. */}
                <div
                    className="paginated-sheets"
                    aria-hidden="true"
                    style={{
                        position: "absolute", top: 0, left: 0,
                        width: "100%", height: totalHeight,
                        zIndex: 0, pointerEvents: "none",
                    }}
                >
                    {Array.from({ length: pageCount }).map((_, i) => (
                        <div
                            key={i}
                            className="paginated-page-sheet"
                            style={{
                                position: "absolute",
                                top: PAGE_GAP + i * (PAGE_H + PAGE_GAP),
                                left: "50%", transform: "translateX(-50%)",
                                width: PAGE_W, height: PAGE_H,
                                background: isDark ? "#1e1e1e" : "#ffffff",
                                boxShadow: isDark
                                    ? "0 4px 24px rgba(0,0,0,0.6)"
                                    : "0 2px 16px rgba(0,0,0,0.18)",
                                borderRadius: 2, boxSizing: "border-box",
                            }}
                        >
                            <div style={{
                                position: "absolute", top: 8, right: 12, fontSize: 10,
                                fontFamily: "monospace", color: isDark ? "#555" : "#bbb",
                                userSelect: "none", pointerEvents: "none",
                            }}>
                                {i + 1}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Editor único (documento contínuo) — na frente das folhas. */}
                <div
                    className="paginated-doc-layer"
                    style={{
                        position: "relative", zIndex: 1,
                        minHeight: totalHeight, paddingTop: PAGE_GAP,
                        boxSizing: "border-box",
                    }}
                    onClick={handleLayerClick}
                >
                    {editor && <EditorContent editor={editor} />}
                </div>
            </div>
        );
    });

export default PaginatedEditor;
