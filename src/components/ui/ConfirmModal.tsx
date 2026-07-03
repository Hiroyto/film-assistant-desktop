import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ConfirmModalProps {
    open: boolean;
    title?: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    loading?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

/**
 * ConfirmModal — generic yes/no confirmation dialog.
 *
 * FIL-341: Portal rendering.
 *   Previously, this component rendered inline where it was placed in the
 *   JSX tree. That broke when any ancestor had `backdrop-filter`, `filter`,
 *   `transform`, `perspective`, or `will-change` set — those CSS properties
 *   create a containing block that captures `position: fixed` descendants.
 *   Result: the modal centered inside the ancestor's bounding box instead
 *   of the viewport. In the StorySegment case, an Act container had
 *   `backdropFilter: blur(20px)` and the delete modal was centering inside
 *   the Act instead of over the whole page.
 *
 *   Portaling to document.body escapes all ancestor containing blocks so
 *   `fixed inset-0` reliably anchors to the viewport.
 *
 * FIL-341: description accepts ReactNode.
 *   Call sites may want to emphasize the specific thing being cleared
 *   (e.g. <strong>Introduction and Stasis</strong>), so description is
 *   typed as ReactNode rather than string. Plain strings still work.
 */
export default function ConfirmModal({
    open,
    title = "Confirm action",
    description = "Are you sure you want to proceed?",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {

    const [isClosing, setIsClosing] = useState(false);

    const handleClose = React.useCallback(() => {
        setIsClosing(true);

        setTimeout(() => {
            setIsClosing(false);
            onCancel();
        }, 160);
    }, [onCancel]);

    useEffect(() => {
        if (!open) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose();
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, handleClose]);

    if (!open && !isClosing) return null;

    // SSR / test-env guard: if document isn't available yet, skip rendering
    // rather than throwing. In a normal browser session this is always truthy.
    if (typeof document === "undefined") return null;

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">

            <div
                onClick={handleClose}
                className={`
                    absolute inset-0
                    bg-gradient-to-br from-black/40 via-black/30 to-black/50
                    backdrop-blur-sm
                    ${isClosing ? "animate-fadeOut" : "animate-fadeIn"}
                `}
            />

            <div
                className={`
                relative w-full max-w-md rounded-2xl
                border border-[#ff6b35]/25
                bg-gradient-to-br from-[#0f0f0f] to-[#1a1a1a]
                p-6 shadow-xl
                ${isClosing ? "animate-fadeOut" : "animate-fadeIn"}
                `}
            >

                <h2 className="text-lg font-semibold text-[#ff6b35]">
                    {title}
                </h2>

                <div className="mt-2 text-sm text-white/70 leading-relaxed">
                    {description}
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={handleClose}
                        disabled={loading}
                        className="
              px-4 py-2 text-sm rounded-md
              text-white/70 hover:text-white
              transition disabled:opacity-50
            "
                    >
                        {cancelLabel}
                    </button>

                    <button
                        onClick={async () => {
                            await onConfirm();
                            handleClose();
                        }}
                        disabled={loading}
                        className={`
    px-4 py-2 text-sm font-medium rounded-md transition
    disabled:opacity-50 disabled:cursor-not-allowed
    ${danger
                                ? "bg-gradient-to-r from-red-600 to-red-500 text-white"
                                : "bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white/75 hover:text-white hover:opacity-90 hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)] transition"
                            }
  `}
                    >
                        {loading ? "Processing..." : confirmLabel}
                    </button>

                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}