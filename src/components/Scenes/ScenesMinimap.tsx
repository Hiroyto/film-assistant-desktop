import React from 'react';

interface ScenesMinimapProps {
    activeSegmentIndex: number | null; // 0–8
    onSelect: (segmentIndex: number) => void;
}

const SEGMENTS = Array.from({ length: 9 }, (_, i) => `S${i + 1}`);

export const ScenesMinimap: React.FC<ScenesMinimapProps> = ({
    activeSegmentIndex,
    onSelect,
}) => {
    return (
        <div className="
      absolute right-4 bottom-4 z-[120]
      flex flex-col items-center
      gap-2
      rounded-xl
      bg-[rgba(20,20,24,0.85)]
      border border-white/15
      px-3 py-4
      backdrop-blur-md
      shadow-xl
    ">
            {SEGMENTS.map((label, index) => {
                const isActive = index === activeSegmentIndex;

                return (
                    <React.Fragment key={label}>
                        {/* Circle */}
                        <button
                            onClick={() => onSelect(index)}
                            className={`
                            min-w-[30px] h-7 px-2
                            rounded-full
                            flex items-center justify-center
                            text-[10px] font-semibold tracking-wide
                            transition-all duration-200
                            ${isActive
                                    ? 'bg-orange-500 text-white scale-110 shadow-[0_0_0_4px_rgba(255,107,53,0.25)]'
                                    : 'bg-white/15 text-white/70 hover:bg-white/30 hover:text-white'}
                            `}
                            title={label}
                        >
                            {label}
                        </button>

                        {/* Connector line */}
                        {index < SEGMENTS.length - 1 && (
                            <div className="w-px h-4 bg-white/20" />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
};
