interface CommandLauncherProps {
    onOpen: () => void;
}

export function CommandLauncher({ onOpen }: CommandLauncherProps) {
    return (
        <button
            onClick={onOpen}
            className="
        fixed top-4 left-1/2 -translate-x-1/2 z-[120]
        flex items-center gap-3
        w-[420px] max-w-[90vw]
        px-4 py-2.5
        rounded-xl
        bg-zinc-900/80 backdrop-blur-md
        border border-white/10
        text-sm text-zinc-300
        shadow-lg
        hover:border-white/20
        hover:bg-zinc-900/90
        transition
      "
        >
            {/* Ícone */}
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                className="text-zinc-400"
            >
                <path
                    d="M21 21l-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
            </svg>

            {/* Placeholder */}
            <span className="flex-1 text-left text-zinc-400">
                Search commands…
            </span>

            {/* Shortcut hint */}
            <kbd
                className="
          flex items-center gap-1
          rounded-md
          bg-white/5
          border border-white/10
          px-2 py-0.5
          text-[11px] font-medium
          text-zinc-400
        "
            >
                <span>Ctrl</span>
                <span>K</span>
            </kbd>
        </button>
    );
}
