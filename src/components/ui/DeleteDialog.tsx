// DeleteDialog.tsx
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DeleteDialogProps = {
    /** Prop gatilho: quando mudar para true, o modal abre uma vez */
    openTrigger?: boolean;
    onTriggerConsumed?: () => void;

    onConfirm: () => void | Promise<void>;
    title?: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;

    /** Se fornecido, esse elemento abre o modal ao ser clicado */
    children?: React.ReactNode;

    disabled?: boolean;
    className?: string;
};

export default function DeleteDialog({
    openTrigger,
    onTriggerConsumed,
    onConfirm,
    title = "Delete Item",
    description = "Are you sure you want to delete this item? This action cannot be undone.",
    confirmLabel = "Delete",
    cancelLabel = "Cancel",
    children,
    disabled = false,
    className,
}: DeleteDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    /** 🔥 One-shot trigger via prop */
    useEffect(() => {
        if (openTrigger) {
            setInternalOpen(true);
            onTriggerConsumed?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openTrigger]);

    function setOpen(value: boolean) {
        if (disabled) return;
        setInternalOpen(value);
    }

    async function handleConfirm() {
        try {
            setLoading(true);
            await onConfirm();
        } finally {
            setLoading(false);
            setOpen(false);
        }
    }

    /** ESC, focus-trap e bloqueio do scroll */
    useEffect(() => {
        if (!internalOpen) return;

        previouslyFocused.current = document.activeElement as HTMLElement | null;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const el = dialogRef.current;
        el?.focus();

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
            } else if (e.key === "Tab") {
                const focusable = el?.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
                );
                if (!focusable || focusable.length === 0) {
                    e.preventDefault();
                    return;
                }
                const nodes = Array.from(focusable).filter(n => n.offsetParent !== null);
                if (nodes.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = nodes[0];
                const last = nodes[nodes.length - 1];
                if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                } else if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            }
        }

        document.addEventListener("keydown", onKeyDown, true);

        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            document.body.style.overflow = prevOverflow;
            previouslyFocused.current?.focus();
        };
    }, [internalOpen]);

    /** Cria portal root se não existir */
    useEffect(() => {
        let root = document.getElementById("modal-root");
        if (!root) {
            root = document.createElement("div");
            root.id = "modal-root";
            document.body.appendChild(root);
        }
    }, []);

    /** Modal + backdrop */
    const modal = internalOpen
        ? createPortal(
            <div
                aria-modal="true"
                role="dialog"
                aria-label={title}
                className="fixed inset-0 z-[11000] flex items-center justify-center"
            >
                {/* Background dark gradient */}
                <div
                    className="absolute inset-0 bg-gradient-to-br from-[#0f0f0f]/85 to-[#1a1a1a]/85 backdrop-blur-md"
                    onMouseDown={() => setOpen(false)}
                />

                {/* Dialog content */}
                <div
                    ref={dialogRef}
                    tabIndex={-1}
                    className={`
              relative z-[11001] mx-4 w-full max-w-lg transform rounded-xl p-6
              bg-[#ff6b35]/8 backdrop-blur-xl border border-[#ff6b35]/30
              shadow-[0_10px_30px_rgba(0,0,0,0.7)]
              text-white focus:outline-none
              ${className ?? ""}
            `}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ff6b35]/20 border border-[#ff6b35]/40">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-6 w-6 text-[#ff6b35]"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>

                        <div className="flex-1">
                            <h2 className="text-xl font-semibold text-white">{title}</h2>
                            <p className="mt-2 text-sm text-gray-300">{description}</p>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            disabled={loading}
                            className="px-4 py-2 rounded-md bg-white/10 text-gray-200 hover:bg-white/20 duration-150"
                        >
                            {cancelLabel}
                        </button>

                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#ff6b35] hover:bg-[#ff8c42] text-white font-medium disabled:opacity-50 duration-150"
                        >
                            {loading ? (
                                <>
                                    <svg
                                        className="h-4 w-4 animate-spin"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="white"
                                            strokeWidth="4"
                                        ></circle>
                                        <path
                                            className="opacity-75"
                                            fill="white"
                                            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                        ></path>
                                    </svg>
                                    Deleting...
                                </>
                            ) : (
                                confirmLabel
                            )}
                        </button>
                    </div>
                </div>
            </div>,
            document.getElementById("modal-root")!
        )
        : null;

    return (
        <>
            {/* Optional: if children provided, they act as a trigger */}
            {children ? (
                <span
                    onClick={() => setOpen(true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setOpen(true);
                    }}
                >
                    {children}
                </span>
            ) : null}

            {modal}
        </>
    );
}
