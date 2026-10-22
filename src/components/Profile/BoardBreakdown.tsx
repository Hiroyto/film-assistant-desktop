import React, { useState } from 'react';
import type { BoardSummary } from '../../lib/freeformApi';
import {
    CARD_KINDS,
    KIND_COLOR_DARK,
    allocateMosaic,
    boardAriaLabel,
    kindLabel,
} from '../../lib/storyDisplay';

/** Story titles in the stories list: Adobe Thai from the Typekit kit, text in
 *  Instrument Sans from Google Fonts (both linked in public/index.html). */
export const TITLE_FONT = "'adobe-thai', Georgia, serif";
export const UI_FONT = "'Instrument Sans', system-ui, sans-serif";

/** The focus story's board: index-card tiles, one per card up to 15, then 15
 *  in proportion; a legend with the real counts under it. */
export const BoardMosaic: React.FC<{ summary: BoardSummary; animate?: boolean }> = ({ summary, animate = false }) => {
    const tiles = allocateMosaic(summary).flatMap(({ kind, n }) =>
        Array.from({ length: n }, (_, i) => ({ key: `${kind}-${i}`, color: KIND_COLOR_DARK[kind] })),
    );
    return (
        <div role="img" aria-label={boardAriaLabel(summary)} className="flex flex-col gap-3.5 h-full">
            <div aria-hidden="true" className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7d756c]">
                On the board
            </div>
            <div aria-hidden="true" className="grid grid-cols-5 gap-2">
                {tiles.map((t, i) => (
                    <div
                        key={t.key}
                        className={`h-[46px] rounded-[3px] bg-[#2e2925] box-border pt-[9px] px-2${animate ? ' sh-tile' : ''}`}
                        style={{ borderTop: `3px solid ${t.color}`, animationDelay: animate ? `${180 + i * 22}ms` : undefined }}
                    >
                        <div className="h-px bg-[#3d3631]" />
                    </div>
                ))}
            </div>
            <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5 mt-auto text-xs text-[#a8a097]">
                {CARD_KINDS.filter((k) => summary[k] > 0).map((k) => {
                    const [n, ...label] = kindLabel(k, summary[k]).split(' ');
                    return (
                        <span key={k} className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-[2px]" style={{ background: KIND_COLOR_DARK[k] }} />
                            <span>
                                <strong className="font-semibold text-[#f2ede6]">{n}</strong> {label.join(' ')}
                            </span>
                        </span>
                    );
                })}
            </div>
        </div>
    );
};

/** A smaller story's board: one proportional line, real counts, no cap.
 *  Hovering a section shows its count ("9 scenes"). The hover zones are a
 *  taller transparent row laid over the thin bar, so the target is not 6px. */
export const BoardLine: React.FC<{
    summary: BoardSummary;
    colors: Record<keyof BoardSummary, string>;
    className?: string;
    labelled?: boolean;
}> = ({ summary, colors, className = '', labelled = false }) => {
    const [hovered, setHovered] = useState<keyof BoardSummary | null>(null);
    const kinds = CARD_KINDS.filter((k) => summary[k] > 0);
    const total = kinds.reduce((a, k) => a + summary[k], 0);
    // Centre of the hovered section, as a share of the line's width.
    let centre = 0;
    if (hovered) {
        let before = 0;
        for (const k of kinds) {
            if (k === hovered) { centre = (before + summary[k] / 2) / total; break; }
            before += summary[k];
        }
    }
    return (
        <div
            {...(labelled ? { role: 'img', 'aria-label': boardAriaLabel(summary) } : { 'aria-hidden': true })}
            className={`relative ${className}`}
            onMouseLeave={() => setHovered(null)}
        >
            <div className="flex gap-[2px] h-full rounded-[3px] overflow-hidden">
                {kinds.map((k) => (
                    <div
                        key={k}
                        className="transition-opacity"
                        style={{ flex: `${summary[k]} 1 0`, background: colors[k], opacity: hovered && hovered !== k ? 0.45 : 1 }}
                    />
                ))}
            </div>
            <div className="absolute left-0 right-0 -top-2 -bottom-2 flex gap-[2px]">
                {kinds.map((k) => (
                    <div key={k} style={{ flex: `${summary[k]} 1 0` }} onMouseEnter={() => setHovered(k)} />
                ))}
            </div>
            {hovered && (
                <div
                    className="pointer-events-none absolute bottom-full mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#141110] px-2 py-1 text-xs font-medium text-[#f2ede6] shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
                    style={{ left: `${centre * 100}%`, fontFamily: UI_FONT }}
                >
                    <span className="inline-block w-2 h-2 rounded-[2px] mr-1.5 align-[-1px]" style={{ background: colors[hovered] }} />
                    {kindLabel(hovered, summary[hovered])}
                </div>
            )}
        </div>
    );
};

/** Colour key for the lines (Profile). */
export const BoardKey: React.FC = () => (
    <div aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[#a8a097]">
        {CARD_KINDS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-[2px]" style={{ background: KIND_COLOR_DARK[k] }} />
                {k[0].toUpperCase() + k.slice(1)}
            </span>
        ))}
    </div>
);
