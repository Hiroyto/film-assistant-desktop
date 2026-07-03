import React from "react";

interface ErrorModalProps {
    open: boolean;
    onClose: () => void;

    title?: string;
    message: string | React.ReactNode;

    actions?: React.ReactNode;
}

export function ErrorModal({
    open,
    onClose,
    title = "Error",
    message,
    actions,
}: ErrorModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div
                className="
          relative z-10 w-full max-w-md rounded-2xl p-6
          bg-gradient-to-br from-[#0f0f0f] via-[#161616] to-[#0a0a0a]
          border border-[#ff6b35]/40
        "
                role="alertdialog"
                aria-modal="true"
            >
                {/* Header */}
                <div className="mb-4 flex items-center gap-3">
                    <div
                        className="
              flex h-10 w-10 items-center justify-center rounded-full
              bg-[#ff6b35]/15
              text-[#ff6b35] font-bold
            "
                    >
                        !
                    </div>

                    <h2 className="text-lg font-semibold text-[#ff8c42]">
                        {title}
                    </h2>
                </div>

                {/* Message */}
                <div className="mb-6 text-sm leading-relaxed text-neutral-300">
                    {message}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    {actions ?? (
                        <button
                            onClick={onClose}
                            className="
                rounded-lg px-4 py-2 text-sm font-medium
                bg-[#ff6b35] text-black
                hover:bg-[#ff8c42]
                transition-colors
              "
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
