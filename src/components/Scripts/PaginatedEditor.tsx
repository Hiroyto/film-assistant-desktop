import React, {
    useCallback, useEffect, useImperativeHandle,
    useRef, useState, forwardRef,
} from "react";
import { useEditor, EditorContent, Editor, Extensions } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import { TextSelection, AllSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { ScreenwritingParagraph } from "./editor/extensions/Screenwritingline";
import { KeyboardShortcuts, SafeSelection } from "./editor/extensions";

// ─── Page dimensions ──────────────────────────────────────────────────────────
const PAGE_W = 816;
const PAGE_H = 1056;
const MARGIN_H = 96;
const MARGIN_V = 96;
const CONTENT_H = PAGE_H - MARGIN_V * 2; // 864 px
const PAGE_GAP = 40;

const EMPTY_PAGE = `<p data-line-type="description"></p>`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageData {
    id: string;
    initialHTML: string;
}

interface PaginatedEditorProps {
    editorTheme: "dark" | "light";
    onActiveEditorReady?: (editor: Editor) => void;
    extensions?: Extensions;
    initialContent?: string;
}

export interface PaginatedEditorHandle {
    getAllHTML: () => string;
    /**
     * Returns every currently-mounted page editor in page order. Used by
     * cross-page consumers (e.g. extraction tracking) that need to walk
     * content across all pages, not just the focused one.
     */
    getAllEditors: () => Editor[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _pageCounter = 0;
const newPageId = () => `page-${++_pageCounter}-${Date.now()}`;

const focusStart = (editor: Editor) => { editor.commands.focus("start"); };
const focusEnd = (editor: Editor) => { editor.commands.focus("end"); };

/**
 * serializeNodesToHTML
 * Converts a ProseMirror slice to HTML preserving all node attributes.
 */
const serializeNodesToHTML = (editor: Editor, from: number, to: number): string => {
    try {
        const { state } = editor;
        const slice = state.doc.slice(from, to);
        const serializer = DOMSerializer.fromSchema(state.schema);
        const fragment = serializer.serializeFragment(slice.content);
        const div = document.createElement("div");
        div.appendChild(fragment);
        return div.innerHTML;
    } catch (err) {
        console.error("serializeNodesToHTML failed:", err);
        try {
            return `<p data-line-type="description">${editor.state.doc.textBetween(from, to, "\n")}</p>`;
        } catch {
            return EMPTY_PAGE;
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SinglePage
// ─────────────────────────────────────────────────────────────────────────────

interface SinglePageProps {
    pageId: string;
    pageNumber: number;
    editorTheme: "dark" | "light";
    extensions?: Extensions;
    initialHTML: string;
    onEditorReady: (editor: Editor) => void;
    onFocus: (editor: Editor) => void;
    onOverflow: (editor: Editor, trailingHTML: string, shouldMoveCursor: boolean) => void;
    onDeletePage: () => void;
    registerRef: (editor: Editor | null) => void;
    lastCheckTimesRef: React.MutableRefObject<Map<string, number>>;
    cursorBeforeEnterRef: React.MutableRefObject<Map<string, number>>;
}

const SinglePage: React.FC<SinglePageProps> = ({
    pageId,
    pageNumber,
    editorTheme,
    extensions = [],
    initialHTML,
    onEditorReady,
    onFocus,
    onOverflow,
    onDeletePage,
    registerRef,
    lastCheckTimesRef,
    cursorBeforeEnterRef,
}) => {
    const overflowRef = useRef(onOverflow);
    overflowRef.current = onOverflow;
    const deletePageRef = useRef(onDeletePage);
    deletePageRef.current = onDeletePage;
    const editorInstanceRef = useRef<Editor | null>(null);

    // Ref para detectar quando foi Enter key (para overflow imediato sem debounce)
    const lastKeyPressRef = useRef<string | null>(null);

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
            ...extensions,
        ],
        editorProps: {
            attributes: {
                class: "paginated-editor-content",
                spellcheck: "true",
                style: [
                    "outline: none", "min-height: 100%",
                    "font-family: 'Courier New', monospace", "font-size: 12pt",
                    "line-height: 1.5", "white-space: pre-wrap", "word-break: break-word",
                ].join(";"),
            },
            handleKeyDown(view, event) {
                // Rastrear tecla pressionada para overflow imediato
                if (event.key === "Enter") {
                    lastKeyPressRef.current = "Enter";
                    // Salvar posição do cursor ANTES do Enter ser processado
                    const cursorPos = view.state.selection.from;
                    cursorBeforeEnterRef.current.set(pageId, cursorPos);
                    console.log('⌨️ Enter pressionado na página', pageId, '- cursor em:', cursorPos);
                    console.log('✅ Map atualizado:', {
                        mapSize: cursorBeforeEnterRef.current.size,
                        mapContents: Array.from(cursorBeforeEnterRef.current.entries())
                    });
                }

                if (event.key === "Backspace" && pageNumber > 1) {
                    const { doc, selection } = view.state;
                    const isEmpty =
                        selection.empty && selection.from === 1 &&
                        doc.childCount === 1 && doc.firstChild?.textContent === "";
                    if (isEmpty) {
                        event.preventDefault();
                        deletePageRef.current();
                        return true;
                    }
                }
                return false;
            },
        },
        content: initialHTML || EMPTY_PAGE,
        autofocus: false,
        onFocus: ({ editor: e }) => onFocus(e as Editor),
        onCreate: ({ editor: e }) => {
            editorInstanceRef.current = e as Editor;
            onEditorReady(e as Editor);
            registerRef(e as Editor);
        },
        onDestroy: () => {
            editorInstanceRef.current = null;
            // Limpar cursor salvo desta página quando o editor é destruído
            if (cursorBeforeEnterRef.current.has(pageId)) {
                console.log('🧹 Limpando cursor salvo da página destruída', pageId);
                cursorBeforeEnterRef.current.delete(pageId);
            }
            registerRef(null);
        },
    });

    // ── Overflow detection ────────────────────────────────────────────────────
    // Single unified path for all overflow triggers: typing, AI insertion,
    // and initial mount. Uses a ref-based lock so only one split fires at a time.
    const splitInProgressRef = useRef(false);
    const checkOverflowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isReceivingContentRef = useRef(false); // Flag para conteúdo recebido de outra página

    const checkOverflow = useCallback(() => {
        const callStack = new Error().stack;
        console.log('🔍 checkOverflow INICIADO', {
            splitInProgress: splitInProgressRef.current,
            timestamp: Date.now(),
            pageId,
            calledFrom: callStack?.split('\n')[2]?.trim() || 'unknown'
        });

        if (splitInProgressRef.current) {
            console.log('⏭️ Split já em progresso, ignorando');
            return;
        }

        const now = Date.now();
        const lastCheck = lastCheckTimesRef.current.get(pageId) ?? 0;

        if (lastCheck > 0) {
            const timeSinceLastCheck = now - lastCheck;
            console.log('⏱️ Tempo desde último check (página', pageId + '):', timeSinceLastCheck + 'ms');

            if (timeSinceLastCheck < 200) {
                console.log('⏭️ Ignorando check duplicado (< 200ms desde último)');
                return;
            }
        } else {
            console.log('⏱️ Primeira execução do checkOverflow (página', pageId + ')');
        }

        lastCheckTimesRef.current.set(pageId, now);

        const ed = editorInstanceRef.current;
        if (!ed) return;

        const dom = ed.view.dom as HTMLElement;
        if (!dom) return;

        isReceivingContentRef.current = dom.dataset.receivingContent === 'true';

        // Check if the last child exceeds the page content height
        const children = Array.from(dom.children) as HTMLElement[];
        console.log('👶 Children count em', pageId, ':', children.length);

        if (children.length === 0) {
            console.log('❌ Sem children em', pageId, '- retornando');
            return;
        }

        let splitDOMIndex = -1;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childBottom = child.offsetTop + child.offsetHeight;

            if (childBottom > CONTENT_H) {
                splitDOMIndex = i;
                break;
            }
        }

        if (splitDOMIndex < 0) {
            console.log('⏹️ Sem overflow detectado em', pageId, '- retornando');
            return;
        }

        console.log('🔥 OVERFLOW DETECTADO em', pageId, '- splitDOMIndex:', splitDOMIndex);

        splitInProgressRef.current = true;
        console.log('🔒 Split em progresso marcado como TRUE em', pageId);

        const { state } = ed;
        const cursorPos = state.selection.from;

        // Map DOM index → ProseMirror position
        let pmPos = 0;
        let nodeIndex = 0;
        state.doc.forEach((_, offset) => {
            if (nodeIndex === splitDOMIndex && pmPos === 0) pmPos = offset;
            nodeIndex++;
        });

        if (pmPos <= 0) {
            console.log('⚠️ pmPos inválido em', pageId, '- pmPos:', pmPos);
            splitInProgressRef.current = false;
            return;
        }

        const docSize = state.doc.content.size;
        const safeEnd = docSize - 1;
        const splitPos = Math.max(2, Math.min(pmPos, safeEnd - 1));

        let shouldMoveCursor = false;


        let cursorBeforeEnter: number | null = null;
        let cursorOriginPageId: string | null = null;

        console.log('🗺️ Map de cursores:', {
            currentPageId: pageId,
            mapSize: cursorBeforeEnterRef.current.size,
            mapEntries: Array.from(cursorBeforeEnterRef.current.entries())
        });

        for (const [savedPageId, savedCursor] of cursorBeforeEnterRef.current.entries()) {
            cursorBeforeEnter = savedCursor;
            cursorOriginPageId = savedPageId;
            console.log('📍 Cursor salvo da página', savedPageId, ':', savedCursor);

            if (savedPageId !== pageId) {
                console.log('🗑️ Deletando cursor (página destino leu)');
                cursorBeforeEnterRef.current.delete(savedPageId);
            } else {
                console.log('⏭️ Mantendo cursor (ainda é a página origem)');
            }
            break;
        }

        const relevantCursorPos = cursorBeforeEnter ?? cursorPos;

        // Encontrar em qual nó o cursor estava
        let cursorNodeIndex = -1;
        let currentIndex = 0;
        state.doc.forEach((node, offset) => {
            if (relevantCursorPos >= offset && relevantCursorPos <= offset + node.nodeSize) {
                cursorNodeIndex = currentIndex;
            }
            currentIndex++;
        });

        // DEBUG: Log para entender o comportamento
        console.log('🔍 Cursor detection:', {
            pageId,
            cursorPos,
            cursorBeforeEnter,
            relevantCursorPos,
            splitPos,
        });
        console.log('📊 Node indices:', {
            cursorNodeIndex,
            splitDOMIndex,
            totalNodes: currentIndex,
            isEqual: cursorNodeIndex === splitDOMIndex
        });

        const wasInSplitNode = cursorNodeIndex === splitDOMIndex;
        const wasBeforeSplitNode = cursorNodeIndex === splitDOMIndex - 1;

        shouldMoveCursor =
            (wasInSplitNode || wasBeforeSplitNode) &&
            !isReceivingContentRef.current;

        console.log('🎯 shouldMoveCursor:', shouldMoveCursor, {
            wasInSplitNode,
            wasBeforeSplitNode,
            isReceivingContent: isReceivingContentRef.current
        });

        const trailingHTML = serializeNodesToHTML(ed, splitPos, safeEnd);
        ed.view.dispatch(state.tr.delete(splitPos, safeEnd));

        // Passar a flag para o handleOverflow
        overflowRef.current(ed, trailingHTML, shouldMoveCursor);

        // Unlock after enough time for the new page to mount and stabilize
        setTimeout(() => { splitInProgressRef.current = false; }, 300);
    }, [pageId]);

    const debouncedCheckOverflow = useCallback(() => {
        // Se foi Enter key, executar com delay mínimo para o TipTap criar a linha
        if (lastKeyPressRef.current === "Enter") {
            lastKeyPressRef.current = null; // Reset

            // Cancelar qualquer check pendente
            if (checkOverflowTimeoutRef.current !== null) {
                clearTimeout(checkOverflowTimeoutRef.current);
                checkOverflowTimeoutRef.current = null;
            }

            // Aguardar 1 frame para o TipTap criar a linha ANTES de checar overflow
            setTimeout(() => {
                requestAnimationFrame(checkOverflow);
            }, 16);
            return;
        }

        // Para outras teclas, usar debounce normal
        if (checkOverflowTimeoutRef.current !== null) {
            clearTimeout(checkOverflowTimeoutRef.current);
        }

        checkOverflowTimeoutRef.current = setTimeout(() => {
            checkOverflowTimeoutRef.current = null;
            checkOverflow();
        }, 150);
    }, [checkOverflow]);

    useEffect(() => {
        if (!editor) return;

        const handleUpdate = () => debouncedCheckOverflow();
        editor.on("update", handleUpdate);

        // ── On mount: check after layout is ready ────────────────────────────
        // Three attempts with increasing delays to handle:
        //   50ms  — content already painted, fonts from cache
        //   200ms — typical web font load
        //   600ms — slow connections / first load without font cache
        const t1 = setTimeout(() => requestAnimationFrame(checkOverflow), 50);
        const t2 = setTimeout(() => requestAnimationFrame(checkOverflow), 200);
        const t3 = setTimeout(() => requestAnimationFrame(checkOverflow), 600);

        return () => {
            editor.off("update", handleUpdate);
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            if (checkOverflowTimeoutRef.current !== null) {
                clearTimeout(checkOverflowTimeoutRef.current);
            }
        };
    }, [editor, debouncedCheckOverflow, checkOverflow]);

    const isDark = editorTheme === "dark";

    return (
        <div
            className="paginated-page-card"
            style={{
                position: "relative", width: PAGE_W, minHeight: PAGE_H,
                flexShrink: 0,
                background: isDark ? "#1e1e1e" : "#ffffff",
                boxShadow: isDark ? "0 4px 24px rgba(0,0,0,0.6)" : "0 2px 16px rgba(0,0,0,0.18)",
                borderRadius: 2, cursor: "text", boxSizing: "border-box",
                paddingTop: MARGIN_V, paddingBottom: MARGIN_V,
                paddingLeft: MARGIN_H, paddingRight: MARGIN_H,
            }}
            onClick={() => editor?.commands.focus()}
        >
            <div style={{
                position: "absolute", top: 8, right: 12, fontSize: 10,
                fontFamily: "monospace", color: isDark ? "#555" : "#bbb",
                userSelect: "none", pointerEvents: "none",
            }}>
                {pageNumber}
            </div>
            {editor && <EditorContent editor={editor} />}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// PaginatedEditor
// ─────────────────────────────────────────────────────────────────────────────

const PaginatedEditor = forwardRef<PaginatedEditorHandle, PaginatedEditorProps>(
    function PaginatedEditor({ editorTheme, onActiveEditorReady, extensions = [], initialContent }, ref) {

        const [pages, setPages] = useState<PageData[]>(() => {
            const initial = initialContent || EMPTY_PAGE;
            return [{
                id: newPageId(),
                initialHTML: initial,
            }];
        });

        const editorsRef = useRef<Map<string, Editor>>(new Map());
        const activeEditorRef = useRef<Editor | null>(null);
        const isSelectingAllRef = useRef(false);

        // Map compartilhado de timestamps para evitar checks duplicados
        // Key = pageId, Value = timestamp do último check
        const lastCheckTimesRef = useRef<Map<string, number>>(new Map());

        // Map compartilhado de cursor positions antes do Enter
        // Key = pageId, Value = cursor position antes do Enter ser processado
        const cursorBeforeEnterRef = useRef<Map<string, number>>(new Map());

        // Track if we've already loaded the initial content to avoid re-applying
        // it every time initialContent changes (which could happen from parent re-renders)
        const initialContentAppliedRef = useRef(false);
        const appliedContentRef = useRef<string>("");

        // When initialContent changes, update the first page if it's still empty
        useEffect(() => {

            if (!initialContent || initialContent === EMPTY_PAGE) {
                return;
            }

            // If we've already applied this exact content, skip
            if (appliedContentRef.current === initialContent) {
                return;
            }

            setPages(prev => {

                const isStillEmpty =
                    prev.length === 1 &&
                    (prev[0].initialHTML === EMPTY_PAGE ||
                        prev[0].initialHTML === "<p></p>" ||
                        prev[0].initialHTML === "");

                if (!isStillEmpty) {
                    return prev;
                }
                appliedContentRef.current = initialContent;
                return [{ id: prev[0].id, initialHTML: initialContent }];
            });
        }, [initialContent]);

        // When page 1's initialHTML is updated via setPages above, push the new
        // content into the already-mounted editor so it re-renders and the
        // overflow check fires MULTIPLE TIMES to handle multi-page content.
        const prevInitialContentRef = useRef(initialContent);
        useEffect(() => {
            if (initialContent === prevInitialContentRef.current) {
                return;
            }

            prevInitialContentRef.current = initialContent;

            if (!initialContent || initialContent === EMPTY_PAGE) {
                return;
            }

            const firstPage = pages[0];
            if (!firstPage) {
                return;
            }

            const firstEditor = editorsRef.current.get(firstPage.id);
            if (!firstEditor) {
                return;
            }

            const currentHTML = firstEditor.getHTML();


            const isEmpty =
                currentHTML === EMPTY_PAGE ||
                currentHTML === "<p></p>" ||
                currentHTML === "" ||
                currentHTML.replace(/<[^>]*>/g, "").trim() === "";

            if (!isEmpty) {
                return;
            }

            // setContent with emitUpdate=true so checkOverflow fires.
            // Use a small delay to ensure DOM is ready for measurement.
            setTimeout(() => {
                if (!firstEditor || firstEditor.isDestroyed) {
                    return;
                }

                firstEditor.commands.setContent(initialContent, true);

                setTimeout(() => requestAnimationFrame(() => {
                    if (firstEditor && !firstEditor.isDestroyed) {
                        firstEditor.view.updateState(firstEditor.view.state);
                    }
                }), 100);

                setTimeout(() => requestAnimationFrame(() => {
                    if (firstEditor && !firstEditor.isDestroyed) {
                        firstEditor.view.updateState(firstEditor.view.state);
                    }
                }), 300);

                setTimeout(() => requestAnimationFrame(() => {
                    if (firstEditor && !firstEditor.isDestroyed) {
                        firstEditor.view.updateState(firstEditor.view.state);
                    }
                }), 700);

                setTimeout(() => requestAnimationFrame(() => {
                    if (firstEditor && !firstEditor.isDestroyed) {
                        firstEditor.view.updateState(firstEditor.view.state);
                    }
                }), 1200);
            }, 10);
        }, [initialContent, pages]);

        useImperativeHandle(ref, () => ({
            getAllHTML: () => {
                const allHTML = pages
                    .map((p, idx) => {
                        const editor = editorsRef.current.get(p.id);
                        const html = editor?.getHTML() ?? "";
                        return html;
                    })
                    .filter(Boolean)
                    .join("");
                return allHTML;
            },
            getAllEditors: () => pages
                .map(p => editorsRef.current.get(p.id))
                .filter((e): e is Editor => !!e && !e.isDestroyed),
        }), [pages]);

        const registerEditor = useCallback((pageId: string, editor: Editor | null) => {
            if (editor) editorsRef.current.set(pageId, editor);
            else editorsRef.current.delete(pageId);
        }, []);

        const handleDeletePage = useCallback((pageId: string, pageIndex: number) => {
            setPages(prev => prev.length <= 1 ? prev : prev.filter(p => p.id !== pageId));
            setTimeout(() => {
                const prevPage = pages[pageIndex - 1];
                if (!prevPage) return;
                const prevEditor = editorsRef.current.get(prevPage.id);
                if (!prevEditor) return;
                focusEnd(prevEditor);
                onActiveEditorReady?.(prevEditor);
            }, 30);
        }, [pages, onActiveEditorReady]);

        const handleOverflow = useCallback((
            fromEditor: Editor,
            trailingHTML: string,
            fromIndex: number,
            shouldMoveCursor: boolean = false,
        ) => {
            console.log('⚡ handleOverflow chamado:', {
                fromIndex,
                shouldMoveCursor,
                totalPages: pages.length,
                pageIds: pages.map(p => p.id)
            });

            // Verificar se já existe uma próxima página
            const nextPage = pages[fromIndex + 1];

            if (nextPage) {
                const nextEditor = editorsRef.current.get(nextPage.id);

                if (nextEditor && !nextEditor.isDestroyed) {
                    // Pegar o conteúdo atual da página 2
                    const currentContent = nextEditor.getHTML();

                    // Adicionar o novo conteúdo NO INÍCIO
                    const combinedHTML = trailingHTML + currentContent;

                    const nextEditorDOM = nextEditor.view.dom as HTMLElement;
                    nextEditorDOM.dataset.receivingContent = 'true';

                    // Atualizar a página 2 com o conteúdo combinado
                    nextEditor.commands.setContent(combinedHTML, true);

                    // Remover a flag após o conteúdo ser processado
                    setTimeout(() => {
                        delete nextEditorDOM.dataset.receivingContent;
                    }, 200);

                    console.log('🎯 handleOverflow - shouldMoveCursor:', shouldMoveCursor);

                    if (shouldMoveCursor) {
                        console.log('✨ Movendo cursor para página', nextPage.id);
                        setTimeout(() => {
                            if (nextEditor && !nextEditor.isDestroyed) {
                                console.log('👉 Executando focus(start) na página', nextPage.id);
                                nextEditor.commands.focus('start');
                                onActiveEditorReady?.(nextEditor);
                            } else {
                                console.log('❌ Editor destruído ou null ao tentar mover cursor');
                            }
                        }, 50);
                    } else {
                        console.log('⏭️ Cursor NÃO deve mover (shouldMoveCursor = false)');
                    }
                    return;
                }
            }

            console.log('🆕 Criando nova página - shouldMoveCursor:', shouldMoveCursor);

            const newId = newPageId();
            setPages(prev => {
                const next = [...prev];
                next.splice(fromIndex + 1, 0, { id: newId, initialHTML: trailingHTML });
                console.log('📄 Nova página criada:', newId, 'na posição', fromIndex + 1);
                return next;
            });

            setTimeout(() => {
                const newEditor = editorsRef.current.get(newId);
                console.log('🔍 Buscando editor da nova página:', newId, '- encontrado:', !!newEditor);

                if (!newEditor) {
                    console.log('❌ Editor da nova página ainda não montou');
                    return;
                }

                if (shouldMoveCursor) {
                    console.log('✨ Movendo cursor para nova página', newId);
                    focusStart(newEditor);
                    onActiveEditorReady?.(newEditor);
                } else {
                    console.log('⏭️ Cursor NÃO deve mover (shouldMoveCursor = false)');
                }
            }, 60);
        }, [pages, onActiveEditorReady]);

        // ── Global keyboard handlers for multi-page operations ───────────────
        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                // ── Ctrl+A: Select all pages ─────────────────────────────────
                if ((e.ctrlKey || e.metaKey) && e.key === "a") {
                    e.preventDefault();
                    e.stopPropagation();

                    isSelectingAllRef.current = true;

                    try {
                        const allEditors = pages
                            .map(p => editorsRef.current.get(p.id))
                            .filter((ed): ed is Editor => ed !== undefined && !ed.isDestroyed);

                        if (allEditors.length === 0) return;

                        // Temporarily disable editors
                        allEditors.forEach(editor => {
                            editor.setOptions({ editable: false });
                        });

                        // Use native browser selection
                        requestAnimationFrame(() => {
                            const selection = window.getSelection();
                            if (!selection) return;

                            selection.removeAllRanges();
                            const range = document.createRange();

                            const firstEditorDOM = allEditors[0].view.dom;
                            const lastEditorDOM = allEditors[allEditors.length - 1].view.dom;

                            const firstContent = firstEditorDOM.querySelector('.screenplay-line') || firstEditorDOM;
                            const lastContent = lastEditorDOM.querySelector('.screenplay-line:last-child') || lastEditorDOM;

                            try {
                                range.setStartBefore(firstContent.firstChild || firstContent);
                                range.setEndAfter(lastContent.lastChild || lastContent);
                                selection.addRange(range);
                            } catch (err) {
                                console.error("Range error:", err);
                                const container = firstEditorDOM.parentElement?.parentElement;
                                if (container) {
                                    range.selectNodeContents(container);
                                    selection.addRange(range);
                                }
                            }

                            // Re-enable editors after a delay
                            // Keep isSelectingAllRef true so Delete/Backspace/Cut can detect it
                            setTimeout(() => {
                                allEditors.forEach(editor => {
                                    if (!editor.isDestroyed) {
                                        editor.setOptions({ editable: true });
                                    }
                                });
                                // Don't reset isSelectingAllRef here - let other handlers reset it
                                // isSelectingAllRef.current = false;
                            }, 100);
                        });
                    } catch (err) {
                        console.error("Error selecting all:", err);
                        isSelectingAllRef.current = false;
                        const allEditors = pages
                            .map(p => editorsRef.current.get(p.id))
                            .filter((ed): ed is Editor => ed !== undefined && !ed.isDestroyed);
                        allEditors.forEach(editor => {
                            if (!editor.isDestroyed) {
                                editor.setOptions({ editable: true });
                            }
                        });
                    }
                    return;
                }

                // ── Delete/Backspace: Delete all content when multi-page selected ─
                if ((e.key === "Delete" || e.key === "Backspace") && isSelectingAllRef.current) {
                    e.preventDefault();
                    e.stopPropagation();

                    const allEditors = pages
                        .map(p => editorsRef.current.get(p.id))
                        .filter((ed): ed is Editor => ed !== undefined && !ed.isDestroyed);

                    if (allEditors.length === 0) return;

                    // Clear all editors except the first
                    allEditors.forEach((editor, index) => {
                        if (index === 0) {
                            // First editor: clear content
                            editor.commands.setContent(EMPTY_PAGE);
                        }
                    });

                    // Remove all pages except the first
                    setPages(prev => [prev[0]]);

                    // Focus the first editor
                    setTimeout(() => {
                        const firstEditor = allEditors[0];
                        if (firstEditor && !firstEditor.isDestroyed) {
                            firstEditor.commands.focus("start");
                        }
                    }, 50);

                    isSelectingAllRef.current = false;
                    window.getSelection()?.removeAllRanges();
                    return;
                }

                // ── Ctrl+X: Cut all content when multi-page selected ─────────
                if ((e.ctrlKey || e.metaKey) && e.key === "x" && isSelectingAllRef.current) {
                    e.preventDefault();
                    e.stopPropagation();

                    const allEditors = pages
                        .map(p => editorsRef.current.get(p.id))
                        .filter((ed): ed is Editor => ed !== undefined && !ed.isDestroyed);

                    if (allEditors.length === 0) return;

                    // Collect all HTML content
                    const allHTML = allEditors
                        .map(editor => editor.getHTML())
                        .join("");

                    // Copy to clipboard
                    try {
                        // Try using the Clipboard API first
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            // Create a temporary div to convert HTML to plain text
                            const tempDiv = document.createElement("div");
                            tempDiv.innerHTML = allHTML;
                            const plainText = tempDiv.textContent || tempDiv.innerText || "";

                            navigator.clipboard.writeText(plainText).then(() => {
                                console.log("Content copied to clipboard");
                            }).catch(err => {
                                console.error("Clipboard write failed:", err);
                            });
                        } else {
                            // Fallback: use document.execCommand
                            const tempTextarea = document.createElement("textarea");
                            const tempDiv = document.createElement("div");
                            tempDiv.innerHTML = allHTML;
                            tempTextarea.value = tempDiv.textContent || tempDiv.innerText || "";
                            document.body.appendChild(tempTextarea);
                            tempTextarea.select();
                            document.execCommand("copy");
                            document.body.removeChild(tempTextarea);
                        }
                    } catch (err) {
                        console.error("Failed to copy:", err);
                    }

                    // Clear all editors except the first
                    allEditors.forEach((editor, index) => {
                        if (index === 0) {
                            editor.commands.setContent(EMPTY_PAGE);
                        }
                    });

                    // Remove all pages except the first
                    setPages(prev => [prev[0]]);

                    // Focus the first editor
                    setTimeout(() => {
                        const firstEditor = allEditors[0];
                        if (firstEditor && !firstEditor.isDestroyed) {
                            firstEditor.commands.focus("start");
                        }
                    }, 50);

                    isSelectingAllRef.current = false;
                    window.getSelection()?.removeAllRanges();
                    return;
                }

                // ── Ctrl+C: Copy all content when multi-page selected ────────
                if ((e.ctrlKey || e.metaKey) && e.key === "c" && isSelectingAllRef.current) {
                    // Let the browser handle the native copy
                    // The native selection already has the content selected
                    return;
                }

                // ── Any printable key: Replace all content when multi-page selected ──
                if (isSelectingAllRef.current) {
                    // Check if it's a printable character or Enter
                    const isPrintable = e.key.length === 1 || e.key === "Enter";
                    const isModifierOnly = e.ctrlKey || e.metaKey || e.altKey;

                    if (isPrintable && !isModifierOnly) {
                        e.preventDefault();
                        e.stopPropagation();

                        const allEditors = pages
                            .map(p => editorsRef.current.get(p.id))
                            .filter((ed): ed is Editor => ed !== undefined && !ed.isDestroyed);

                        if (allEditors.length === 0) return;

                        // Clear all editors except the first
                        const firstEditor = allEditors[0];

                        // Remove all pages except the first
                        setPages(prev => [prev[0]]);

                        // Clear and insert the typed character
                        setTimeout(() => {
                            if (firstEditor && !firstEditor.isDestroyed) {
                                firstEditor.commands.setContent(EMPTY_PAGE);
                                firstEditor.commands.focus("start");

                                // Insert the character that was typed
                                if (e.key === "Enter") {
                                    // Don't insert anything for Enter, just leave empty
                                } else {
                                    firstEditor.commands.insertContent(e.key);
                                }
                            }
                        }, 10);

                        isSelectingAllRef.current = false;
                        window.getSelection()?.removeAllRanges();
                        return;
                    }
                }
            };

            window.addEventListener("keydown", handleKeyDown, true);

            // Reset flag when user clicks anywhere (loses selection)
            const handleClick = () => {
                if (isSelectingAllRef.current) {
                    const selection = window.getSelection();
                    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                        isSelectingAllRef.current = false;
                    }
                }
            };

            // Reset flag when selection changes (user clicks somewhere)
            const handleSelectionChange = () => {
                if (isSelectingAllRef.current) {
                    const selection = window.getSelection();
                    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                        isSelectingAllRef.current = false;
                    }
                }
            };

            document.addEventListener("click", handleClick);
            document.addEventListener("selectionchange", handleSelectionChange);

            return () => {
                window.removeEventListener("keydown", handleKeyDown, true);
                document.removeEventListener("click", handleClick);
                document.removeEventListener("selectionchange", handleSelectionChange);
            };
        }, [pages]);

        // ── Track active editor ───────────────────────────────────────────────
        const handleActiveEditorUpdate = useCallback((editor: Editor) => {
            activeEditorRef.current = editor;
            onActiveEditorReady?.(editor);
        }, [onActiveEditorReady]);

        return (
            <div
                className="paginated-canvas"
                style={{
                    width: "100%", height: "100%",
                    overflowY: "auto", overflowX: "auto",
                    background: "transparent",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    paddingTop: PAGE_GAP, paddingBottom: PAGE_GAP * 3,
                    boxSizing: "border-box", gap: PAGE_GAP,
                }}
            >
                {pages.map((page, index) => (
                    <SinglePage
                        key={page.id}
                        pageId={page.id}
                        pageNumber={index + 1}
                        editorTheme={editorTheme}
                        extensions={extensions}
                        initialHTML={page.initialHTML}
                        lastCheckTimesRef={lastCheckTimesRef}
                        cursorBeforeEnterRef={cursorBeforeEnterRef}
                        onEditorReady={editor => {
                            registerEditor(page.id, editor);
                            if (index === 0) handleActiveEditorUpdate(editor);
                        }}
                        onFocus={handleActiveEditorUpdate}
                        onOverflow={(editor, trailing, shouldMove) => handleOverflow(editor, trailing, index, shouldMove)}
                        onDeletePage={() => handleDeletePage(page.id, index)}
                        registerRef={editor => registerEditor(page.id, editor)}
                    />
                ))}
            </div>
        );
    });

export default PaginatedEditor;