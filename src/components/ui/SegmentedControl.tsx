type ViewMode = "acts" | "all";

interface SegmentedControlProps {
    value: ViewMode;
    onChange: (value: ViewMode) => void;
}

export function SegmentedControl({
    value,
    onChange,
}: SegmentedControlProps) {
    const options: { label: string; value: ViewMode }[] = [
        { label: "Acts", value: "acts" },
        { label: "All", value: "all" },
    ];

    const activeIndex = options.findIndex(o => o.value === value);

    return (
        <div
            className="relative flex rounded-md overflow-hidden"
            style={{
                background: "rgba(255,255,255,0.08)",
                height: 32,
            }}
        >
            {/* SLIDER */}
            <div
                className="absolute top-1 bottom-1 rounded-md transition-transform duration-300 ease-out"
                style={{
                    width: `calc(100% / ${options.length})`,
                    transform: `translateX(${activeIndex * 100}%)`,
                    background: "linear-gradient(135deg, #ff6b35, #ff8c42)",
                }}
            />

            {/* BUTTONS */}
            {options.map(option => (
                <button
                    key={option.value}
                    onClick={() => onChange(option.value)}
                    className="relative z-10 flex-1 text-xs font-semibold transition-colors"
                    style={{
                        color:
                            value === option.value
                                ? "#fff"
                                : "rgba(255,255,255,0.6)",
                    }}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
