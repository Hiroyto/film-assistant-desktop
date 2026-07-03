import React, { useEffect, useState } from "react";
import { exportStoryToPdf } from "../../lib/exportStoryToPdf";

import { normalizeStoryForPdf } from "../../lib/normalizeStoryForPdf";

type SegmentKey =
    | "S1" | "S2" | "S3"
    | "S4" | "S5" | "S6"
    | "S7" | "S8" | "S9";

interface SegmentObject {
    S?: string;
    scenes?: any[];
}

type StorySegments = Partial<
    Record<SegmentKey, string | SegmentObject>
> & {
    SUM?: string | SegmentObject;
    M?: string;
    T?: string;
    G?: string;
    CQ?: string;
};

interface ActsPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    story: StorySegments & { title?: string };
}

const acts = [
    { title: "Act I", segments: ["S1", "S2", "S3"] as SegmentKey[] },
    { title: "Act II", segments: ["S4", "S5", "S6"] as SegmentKey[] },
    { title: "Act III", segments: ["S7", "S8", "S9"] as SegmentKey[] },
];

const ActsPreviewModal: React.FC<ActsPreviewModalProps> = ({
    isOpen,
    onClose,
    story,
}) => {
    const [isFullscreen, setIsFullscreen] = useState(false);

    /**
     * Safely extracts text from a segment.
     * Supports both legacy format (string)
     * and new format ({ S: string, scenes: [] }).
     */
    const getSegmentText = (key: SegmentKey): string => {
        const segment = story?.[key];

        if (typeof segment === "string") {
            return segment.trim();
        }

        if (
            segment &&
            typeof segment === "object" &&
            typeof (segment as any).S === "string"
        ) {
            return (segment as any).S.trim();
        }

        return "";
    };

    /**
     * Prevents background scrolling while in fullscreen mode.
     */
    useEffect(() => {
        if (!isFullscreen) return;

        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;

        const scrollbarWidth =
            window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = "hidden";
        document.body.style.paddingRight = `${scrollbarWidth}px`;

        return () => {
            document.body.style.overflow = originalOverflow;
            document.body.style.paddingRight = originalPaddingRight;
        };
    }, [isFullscreen]);

    if (!isOpen) return null;

    const isDistractionFree = isFullscreen;

    const handleExportPdf = () => {
        const normalized = normalizeStoryForPdf(story, "acts");
        exportStoryToPdf(normalized, "acts");
    };

    /**
     * Checks if any segment across all acts contains content.
     */
    const hasAnyContent = acts.some(act =>
        act.segments.some(key => getSegmentText(key))
    );

    /**
 * Extracts the synopsis (SUM field).
 */
    const getSynopsis = (): string => {
        const value = story?.SUM;

        if (typeof value === "string") {
            return value.trim();
        }

        if (
            value &&
            typeof value === "object" &&
            typeof value.S === "string"
        ) {
            return value.S.trim();
        }

        return "";
    };

    const synopsis = getSynopsis();

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
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
                        : "w-full max-w-4xl max-h-[85vh] rounded-xl border border-[#ff6b35]/30 shadow-2xl"
                    }
        `}
            >
                {!isDistractionFree && (
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[#ff6b35]/20">
                        <h2 className="text-lg font-semibold text-[#ff8c42]">
                            Story Preview
                        </h2>

                        <div className="flex items-center gap-3">
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

                <div
                    className={`
            overflow-y-auto sidebar-scroll
            ${isDistractionFree
                            ? "h-screen px-6 py-10"
                            : "p-6 max-h-[65vh]"
                        }
          `}
                >
                    <div
                        className={`
              space-y-16
              font-["Courier_New","Courier",monospace]
              ${isDistractionFree
                                ? "max-w-[70ch] mx-auto"
                                : "rounded-lg p-5 bg-[#ff6b35]/10 border border-[#ff6b35]/20"
                            }
            `}
                    >
                        {synopsis && (
                            <div>
                                <h3
                                    className={`
                mb-6 text-center font-semibold
                ${isDistractionFree
                                            ? "text-lg text-[#ff8c42]"
                                            : "text-base text-[#ff8c42]"
                                        }
            `}
                                >
                                    Synopsis
                                </h3>

                                <p
                                    className={`
                whitespace-pre-wrap
                ${isDistractionFree
                                            ? "text-base text-white/90 leading-loose"
                                            : "text-sm text-white/80 leading-relaxed"
                                        }
            `}
                                >
                                    {synopsis}
                                </p>
                            </div>
                        )}
                        {acts.map(act => {
                            const text = act.segments
                                .map(getSegmentText)
                                .filter(Boolean)
                                .join("\n\n");

                            if (!text) return null;

                            return (
                                <div key={act.title}>
                                    <h3
                                        className={`
                      mb-6 text-center font-semibold
                      ${isDistractionFree
                                                ? "text-lg text-[#ff8c42]"
                                                : "text-base text-[#ff8c42]"
                                            }
                    `}
                                    >
                                        {act.title}
                                    </h3>

                                    <p
                                        className={`
                      whitespace-pre-wrap
                      ${isDistractionFree
                                                ? "text-base text-white/90 leading-loose"
                                                : "text-sm text-white/80 leading-relaxed"
                                            }
                    `}
                                    >
                                        {text}
                                    </p>
                                </div>
                            );
                        })}

                        {!hasAnyContent && (
                            <p className="text-sm text-white/50 italic text-center">
                                No content available.
                            </p>
                        )}
                    </div>
                </div>

                {!isDistractionFree && (
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ff6b35]/20">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded-md
              text-white/70 hover:text-white
              border border-white/10 hover:border-white/20
              transition"
                        >
                            Close
                        </button>

                        <button
                            onClick={handleExportPdf}
                            className="px-4 py-2 text-sm rounded-md font-medium
              bg-[#ff6b35] hover:bg-[#ff8c42]
              text-black transition shadow-lg"
                        >
                            Export to PDF
                        </button>
                    </div>
                )}

                {isDistractionFree && (
                    <button
                        onClick={() => setIsFullscreen(false)}
                        className="fixed top-4 right-8 text-white/40 hover:text-white transition"
                        title="Exit fullscreen"
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
};

export default ActsPreviewModal;