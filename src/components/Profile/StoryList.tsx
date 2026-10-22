import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary } from '../../lib/freeformApi';
import { KIND_COLOR_DARK, boardTotal, relativeTime, storyRows } from '../../lib/storyDisplay';
import DeleteDialog from '../ui/DeleteDialog';
import { BoardKey, BoardLine, TITLE_FONT } from './BoardBreakdown';

type SortKey = 'edited' | 'title';

const SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'edited', label: 'Last edited' },
    { key: 'title', label: 'Title' },
];

/** Sort control in the list's own look (the native select drew the OS menu).
 *  Same shape as the corkboard's KindPicker: a button that opens a listbox;
 *  outside click and Escape close it, arrow keys move between options. */
function SortPicker({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (!open) return undefined;
        optionRefs.current[Math.max(0, SORTS.findIndex((o) => o.key === value))]?.focus();
        const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
        };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', esc, true);
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
    }, [open, value]);

    const move = (from: number, by: number) => {
        optionRefs.current[(from + by + SORTS.length) % SORTS.length]?.focus();
    };
    const current = SORTS.find((o) => o.key === value)?.label ?? '';

    return (
        <div ref={ref} className="relative">
            <button
                ref={buttonRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Sort stories: ${current}`}
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 h-11 px-3.5 rounded-[10px] border border-[#3a332c] bg-[#1b1816] text-sm hover:border-[#5a5048] transition-colors"
            >
                <span className="text-[#a8a097]">Sort</span>
                <span className="text-[#f2ede6]">{current}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a8a097" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"
                    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-label="Sort stories"
                    className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[180px] p-1.5 rounded-[10px] border border-[#3a332c] bg-[#1b1816] shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
                >
                    {SORTS.map((o, i) => {
                        const selected = o.key === value;
                        return (
                            <button
                                key={o.key}
                                ref={(el) => { optionRefs.current[i] = el; }}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => { onChange(o.key); setOpen(false); buttonRef.current?.focus(); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
                                    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
                                }}
                                className={`flex w-full items-center justify-between gap-3 px-3 py-2 rounded-md text-left text-sm hover:bg-[#2a2420] focus:bg-[#2a2420] outline-none ${selected ? 'text-[#ffa27e]' : 'text-[#f2ede6]'}`}
                            >
                                {o.label}
                                {selected && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

interface StoryListProps {
    works: Record<string, any> | undefined;
    summaries: Record<string, BoardSummary> | null;
    loading?: boolean;
    deleting?: Set<string>;
    onOpenStory: (storyId: string) => void;
    onDeleteStory: (storyId: string) => void;
}

const COLS = 'md:grid-cols-[minmax(0,1fr)_180px_130px_96px]';

/** Profile's stories: a managed list with sort, search and delete. */
const StoryList: React.FC<StoryListProps> = ({ works, summaries, loading = false, deleting, onOpenStory, onDeleteStory }) => {
    const navigate = useNavigate();
    const [sort, setSort] = useState<SortKey>('edited');
    const [query, setQuery] = useState('');
    const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
    const [deleteTrigger, setDeleteTrigger] = useState(false);

    const rows = useMemo(() => {
        const all = storyRows(works, summaries);
        const q = query.trim().toLowerCase();
        const hit = q ? all.filter((r) => r.title.toLowerCase().includes(q) || r.logline.toLowerCase().includes(q)) : all;
        return sort === 'title' ? [...hit].sort((a, b) => a.title.localeCompare(b.title)) : hit;
    }, [works, summaries, query, sort]);
    const total = Object.keys(works ?? {}).length;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 className="m-0 text-[30px] md:text-[34px] font-normal text-[#fbf7f1]" style={{ fontFamily: TITLE_FONT }}>My stories</h2>
                <div className="flex flex-wrap items-center gap-2.5">
                    <SortPicker value={sort} onChange={setSort} />
                    <label className="flex items-center gap-2 h-11 px-3.5 rounded-[10px] border border-[#3a332c] bg-[#1b1816] text-[#a8a097] text-sm w-full sm:w-[240px] box-border">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                        <input
                            type="search"
                            aria-label="Search my stories"
                            placeholder="Search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="flex-1 min-w-0 border-0 bg-transparent text-[#f2ede6] outline-none placeholder:text-[#7d756c]"
                        />
                    </label>
                </div>
            </div>

            {loading && total === 0 ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {[0, 1, 2].map((i) => <div key={i} className="h-[72px] rounded-lg bg-[#1b1816] animate-pulse" />)}
                </div>
            ) : total === 0 ? (
                <p className="text-sm text-[#a8a097] py-8 text-center">No stories yet.</p>
            ) : (
                <div role="table" aria-label="My stories" className="flex flex-col">
                    <div role="row" className={`hidden md:grid ${COLS} gap-[18px] px-2 pb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-[#7d756c] border-b border-[#2c2722]`}>
                        <span role="columnheader">Story</span>
                        <span role="columnheader">On the board</span>
                        <span role="columnheader">Last edited</span>
                        <span role="columnheader" className="sr-only">Actions</span>
                    </div>
                    {rows.length === 0 && (
                        <p className="text-sm text-[#a8a097] py-8 text-center">No stories match "{query}".</p>
                    )}
                    {rows.map((s) => {
                        const summary = summaries?.[s.storyId];
                        const hasBoard = !!summary && boardTotal(summary) > 0;
                        const isDeleting = deleting?.has(s.storyId);
                        return (
                            <div
                                key={s.storyId}
                                role="row"
                                className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-x-[18px] gap-y-2 items-center px-2 py-3.5 border-b border-[#2c2722] ${isDeleting ? 'opacity-50' : ''}`}
                            >
                                <div role="cell" className="flex flex-col gap-1 min-w-0">
                                    <button
                                        type="button"
                                        // Corkboards open on the board directly (see storyRows).
                                        onClick={() => (s.isCorkboard ? navigate(`/freeform/${s.storyId}`) : onOpenStory(s.storyId))}
                                        className="text-left text-xl font-normal text-[#fbf7f1] hover:text-[#ffb08f] transition-colors"
                                    >
                                        {/* The font sits on a span: a global button rule forces the system font. */}
                                        <span style={{ fontFamily: TITLE_FONT }}>{s.title}</span>
                                    </button>
                                    {s.logline && (
                                        <span className="text-sm text-[#a8a097] truncate">{s.logline}</span>
                                    )}
                                </div>
                                <div role="cell" className="hidden md:block">
                                    {hasBoard ? (
                                        <BoardLine summary={summary!} colors={KIND_COLOR_DARK} className="h-2 w-[160px]" labelled />
                                    ) : s.isCorkboard && summaries ? (
                                        <span className="text-sm text-[#7d756c]">Empty</span>
                                    ) : null}
                                </div>
                                <div role="cell" className="hidden md:block text-sm text-[#c9c1b7]">{relativeTime(s.lastModified)}</div>
                                <div role="cell" className="flex justify-end">
                                    <button
                                        type="button"
                                        disabled={isDeleting}
                                        onClick={() => { setPendingDelete({ id: s.storyId, title: s.title }); setDeleteTrigger(true); }}
                                        aria-label={`Delete ${s.title}`}
                                        className="h-10 px-3.5 rounded-lg border border-[#5a2a24] bg-transparent text-[#f19b8b] text-sm hover:bg-[rgba(241,155,139,0.08)] transition-colors disabled:cursor-not-allowed"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {total > 0 && (
                <div className="px-2"><BoardKey /></div>
            )}

            <DeleteDialog
                openTrigger={deleteTrigger}
                onTriggerConsumed={() => setDeleteTrigger(false)}
                title="Delete this story?"
                description={pendingDelete ? `"${pendingDelete.title}" will be deleted. This cannot be undone.` : undefined}
                onConfirm={() => { if (pendingDelete) onDeleteStory(pendingDelete.id); }}
            />
        </div>
    );
};

export default StoryList;
