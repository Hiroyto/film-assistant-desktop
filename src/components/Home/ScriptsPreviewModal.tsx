import React, { useEffect, useRef, useState } from "react";
import { exportScreenplayToPdf } from "../../lib/exportScreenplayToPdf";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScriptsPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Raw HTML from PaginatedEditor.getAllHTML() */
    screenplayHTML: string;
    storyTitle?: string;
}

// ─── Letter page constants (96 dpi) ──────────────────────────────────────────
const PAGE_W_PX = 816;   // 8.5in × 96dpi
const PAGE_H_PX = 1056;  // 11in  × 96dpi
const MARGIN_PX = 96;    // 1in margins

// ─── Screenplay CSS (mirrors scripts.css, scoped to preview) ─────────────────
const SCREENPLAY_CSS = `
  .sp-page {
    width: ${PAGE_W_PX}px;
    min-height: ${PAGE_H_PX}px;
    padding: ${MARGIN_PX}px;
    box-sizing: border-box;
    background: #fff;
    position: relative;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    break-after: page;
  }
  .sp-page p {
    margin: 0; padding: 0;
    min-height: 1.5em;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
  }
  .sp-page p + p { margin-top: 1em; }

  .sp-page p[data-line-type="scene"] {
    margin-left: 0; margin-right: 0;
    max-width: 6in;
    font-weight: bold;
    text-transform: uppercase;
    margin-top: 3em;
    margin-bottom: 1em;
  }
  .sp-page p[data-line-type="scene"]::after {
    content: attr(data-scene-id);
    display: inline-block;
    font-size: 10pt;
    color: rgba(255,102,0,0.8);
    background: rgba(255,102,0,0.1);
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 8px;
    font-weight: normal;
    text-transform: none;
  }
  .sp-page p[data-line-type="description"] {
    margin-left: 0; margin-right: 0; max-width: 6in;
  }
  .sp-page p[data-line-type="character"] {
    margin-left: 2.7in; text-transform: uppercase; margin-top: 1.2em;
  }
  .sp-page p[data-line-type="dialogue"] {
    margin-left: 1.4in; margin-right: 1.3in; max-width: 3.5in; margin-top: 0;
  }
  .sp-page p[data-line-type="parenthetical"] {
    margin-left: 2.1in; margin-right: 1.9in; width: 2.3in; margin-top: 0;
  }
  .sp-page p[data-line-type="transition"] {
    margin-left: 4.5in; text-align: right;
    text-transform: uppercase; margin-top: 2em; margin-bottom: 2em;
  }
  .sp-page p[data-line-type="dialogue"]
    + p:not([data-line-type="dialogue"]):not([data-line-type="parenthetical"]) {
    margin-top: 1.8em;
  }
  .sp-page-number {
    position: absolute;
    top: 0.5in; right: 0.5in;
    font-family: 'Courier New', monospace;
    font-size: 10pt;
    color: #999;
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split a flat list of <p> nodes into page buckets.
 * Uses getBoundingClientRect on a temporarily-mounted hidden container
 * that has the same CSS as the real pages.
 */
function paginateNodes(paragraphs: HTMLElement[]): HTMLElement[][] {
    if (paragraphs.length === 0) return [];

    const CONTENT_H = PAGE_H_PX - MARGIN_PX * 2; // 864 px

    const measureClass = `__sp_measure_${Date.now()}`;
    const style = document.createElement("style");
    style.textContent = SCREENPLAY_CSS.replace(/\.sp-page/g, `.${measureClass}`);
    document.head.appendChild(style);

    const container = document.createElement("div");
    container.className = measureClass;
    container.style.cssText = `
        position: absolute;
        top: -9999px; left: -9999px;
        width: ${PAGE_W_PX - MARGIN_PX * 2}px;
        visibility: hidden;
    `;
    document.body.appendChild(container);
    paragraphs.forEach(p => container.appendChild(p.cloneNode(true)));
    void container.offsetHeight;

    const children = Array.from(container.children) as HTMLElement[];
    const rects = children.map(c => c.getBoundingClientRect());
    const pageTopY = rects[0]?.top ?? 0;

    const pages: HTMLElement[][] = [];
    let bucket: number[] = [];
    let bucketTopY = pageTopY;

    for (let i = 0; i < paragraphs.length; i++) {
        const bottom = rects[i].bottom;
        const usedOnPage = bottom - bucketTopY;

        if (bucket.length > 0 && usedOnPage > CONTENT_H) {
            pages.push(bucket.map(idx => paragraphs[idx]));
            bucket = [i];
            bucketTopY = rects[i].top;
        } else {
            bucket.push(i);
        }
    }
    if (bucket.length > 0) pages.push(bucket.map(idx => paragraphs[idx]));

    document.body.removeChild(container);
    document.head.removeChild(style);

    return pages;
}

/** Parse raw HTML string into an array of <p> elements */
function parseHTML(html: string): HTMLElement[] {
    if (!html) return [];
    const div = document.createElement("div");
    div.innerHTML = html;
    return Array.from(div.querySelectorAll("p")) as HTMLElement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const ScriptsPreviewModal: React.FC<ScriptsPreviewModalProps> = ({
    isOpen,
    onClose,
    screenplayHTML,
    storyTitle = "Untitled",
}) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [pages, setPages] = useState<HTMLElement[][]>([]);
    const [isReady, setIsReady] = useState(false);

    // ── Paginate HTML when the modal opens ───────────────────────────────────
    useEffect(() => {
        if (!isOpen || !screenplayHTML) { setPages([]); return; }

        setIsReady(false);
        // Allow one paint before measuring so fonts are loaded
        requestAnimationFrame(() => {
            setTimeout(() => {
                const paragraphs = parseHTML(screenplayHTML);
                const pageBuckets = paginateNodes(paragraphs);
                setPages(pageBuckets);
                setIsReady(true);
            }, 100);
        });
    }, [isOpen, screenplayHTML]);

    // ── Lock scroll when fullscreen ──────────────────────────────────────────
    useEffect(() => {
        if (!isFullscreen) return;
        const prev = document.body.style.overflow;
        const prevPR = document.body.style.paddingRight;
        document.body.style.overflow = "hidden";
        document.body.style.paddingRight = `${window.innerWidth - document.documentElement.clientWidth}px`;
        return () => {
            document.body.style.overflow = prev;
            document.body.style.paddingRight = prevPR;
        };
    }, [isFullscreen]);

    // ── Export to PDF via jsPDF ──────────────────────────────────────────────
    const handleExport = () => {
        exportScreenplayToPdf(screenplayHTML, storyTitle);
    };

    if (!isOpen) return null;

    const isDistractionFree = isFullscreen;

    return (
        <>
            {/* ── Modal shell ──────────────────────────────────────────────── */}
            <div className="sp-preview-shell fixed inset-0 z-[9999] flex items-center justify-center">
                {!isDistractionFree && (
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={onClose}
                    />
                )}

                <div
                    className={`
                        relative overflow-hidden
                        bg-gradient-to-br from-[#0f0f0f] to-[#1a1a1a]
                        transition-all duration-300
                        ${isFullscreen
                            ? "w-screen h-screen"
                            : "w-full max-w-5xl max-h-[90vh] rounded-xl border border-[#ff6b35]/30 shadow-2xl"
                        }
                    `}
                >
                    {/* Header */}
                    {!isDistractionFree && (
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ff6b35]/20">
                            <h2 className="text-lg font-semibold text-[#ff8c42]"
                                style={{ fontFamily: "'Courier New', monospace" }}>
                                Script Preview
                                {storyTitle && (
                                    <span className="ml-2 text-white/40 text-sm font-normal">
                                        — {storyTitle}
                                    </span>
                                )}
                            </h2>

                            <div className="flex items-center gap-3">
                                <span className="text-white/30 text-xs">
                                    {pages.length} {pages.length === 1 ? "page" : "pages"}
                                </span>
                                <button
                                    onClick={() => setIsFullscreen(true)}
                                    className="text-white/60 hover:text-white transition text-sm"
                                    title="Fullscreen"
                                >
                                    ⛶
                                </button>
                                <button
                                    onClick={onClose}
                                    className="text-white/60 hover:text-white transition"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Script pages */}
                    <div
                        className={`
                            overflow-y-auto sidebar-scroll
                            ${isDistractionFree ? "h-screen py-10" : "max-h-[70vh]"}
                        `}
                        style={{ background: "#1a1a1a" }}
                    >
                        {!isReady ? (
                            <div className="flex items-center justify-center py-24 text-white/40 text-sm">
                                <svg className="animate-spin w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                                </svg>
                                Laying out pages…
                            </div>
                        ) : pages.length === 0 ? (
                            <p className="text-sm text-white/40 italic text-center py-20">
                                No script content found.
                            </p>
                        ) : (
                            <div
                                className="flex flex-col items-center gap-8 py-8 px-4"
                            >
                                <style dangerouslySetInnerHTML={{ __html: SCREENPLAY_CSS }} />
                                {pages.map((pageParagraphs, pi) => (
                                    <div key={pi} className="sp-page shadow-2xl">
                                        <div className="sp-page-number">{pi + 1}</div>
                                        {pageParagraphs.map((p, pIdx) => (
                                            <div
                                                key={pIdx}
                                                dangerouslySetInnerHTML={{ __html: p.outerHTML }}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {!isDistractionFree && (
                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ff6b35]/20">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm rounded-md
                                    text-white/70 hover:text-white
                                    border border-white/10 hover:border-white/20 transition"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleExport}
                                disabled={!isReady || pages.length === 0}
                                className="px-4 py-2 text-sm rounded-md font-medium
                                    bg-[#ff6b35] hover:bg-[#ff8c42]
                                    text-black transition shadow-lg
                                    disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Export to PDF
                            </button>
                        </div>
                    )}

                    {/* Fullscreen exit */}
                    {isDistractionFree && (
                        <div className="fixed top-4 right-8 flex items-center gap-4">
                            <button
                                onClick={handleExport}
                                disabled={!isReady || pages.length === 0}
                                className="px-3 py-1.5 text-xs rounded-md font-medium
                                    bg-[#ff6b35] hover:bg-[#ff8c42]
                                    text-black transition shadow-lg
                                    disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Export PDF
                            </button>
                            <button
                                onClick={() => setIsFullscreen(false)}
                                className="text-white/40 hover:text-white transition"
                                title="Exit fullscreen"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default ScriptsPreviewModal;