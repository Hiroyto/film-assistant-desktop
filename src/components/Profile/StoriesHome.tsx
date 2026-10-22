import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BoardSummary } from '../../lib/freeformApi';
import { KIND_COLOR_DARK, boardTotal, relativeTime, storyRows, type StoryRow } from '../../lib/storyDisplay';
import { BoardLine, BoardMosaic, TITLE_FONT, UI_FONT } from './BoardBreakdown';
import './StoriesHome.css';

const OTHER_STORIES_SHOWN = 7;
// The longest the stories wait for their card counts and title font before
// showing anyway (an older backend, a slow network): past this they appear
// without breakdowns rather than hold the page.
const READY_WAIT_MS = 1200;

/** "Edited yesterday", "Edited 3 days ago", "Edited Oct 9". */
function editedText(iso: string): string {
    const rel = relativeTime(iso);
    return rel === 'Yesterday' || rel === 'Just now' ? rel.toLowerCase() : rel;
}

interface StoriesHomeProps {
    works: Record<string, any> | undefined;
    summaries: Record<string, BoardSummary> | null;
    loading?: boolean;
    /** Stories this writer had last visit, so the skeleton has their shape. */
    expectedCount?: number;
    onOpenStory: (storyId: string) => void;
    onNewStory: () => void;
}

/** Home's stories: the last-edited story up top, the rest as index cards. */
const StoriesHome: React.FC<StoriesHomeProps> = ({ works, summaries, loading = false, expectedCount, onOpenStory, onNewStory }) => {
    const navigate = useNavigate();
    const rows = storyRows(works, summaries);

    // Reveal once: the list, its card counts and the title font all in, so
    // the hero lands in its final shape (board panel, buttons) instead of
    // growing into it. Never goes back to the skeleton on a later refetch.
    const haveList = rows.length > 0 || !loading;
    const [fontReady, setFontReady] = useState(() => !document.fonts || document.fonts.check(`400 21px ${TITLE_FONT}`));
    const [waitOver, setWaitOver] = useState(false);
    const [revealed, setRevealed] = useState(false);
    useEffect(() => {
        if (fontReady || !document.fonts) return;
        let live = true;
        document.fonts.load(`400 21px ${TITLE_FONT}`).finally(() => { if (live) setFontReady(true); });
        return () => { live = false; };
    }, [fontReady]);
    useEffect(() => {
        if (!haveList || revealed) return undefined;
        const t = setTimeout(() => setWaitOver(true), READY_WAIT_MS);
        return () => clearTimeout(t);
    }, [haveList, revealed]);
    useEffect(() => {
        if (!revealed && haveList && ((summaries !== null && fontReady) || waitOver)) setRevealed(true);
    }, [revealed, haveList, summaries, fontReady, waitOver]);

    if (!revealed) {
        if (haveList && rows.length === 0) return null;
        return <StoriesSkeleton count={rows.length || expectedCount || 0} />;
    }
    if (rows.length === 0) return null;

    // Corkboards open on the board directly: the outline loader trusts the
    // record's workflow field, which can wrongly say 'outline'.
    const open = (s: StoryRow) => (s.isCorkboard ? navigate(`/freeform/${s.storyId}`) : onOpenStory(s.storyId));
    const [focus, ...others] = rows;
    const shown = others.slice(0, OTHER_STORIES_SHOWN);
    const focusSummary = summaries?.[focus.storyId];

    return (
        <div className="w-full max-w-[1136px] mx-auto flex flex-col gap-9 text-[#f2ede6]" style={{ fontFamily: UI_FONT }}>
            <section aria-labelledby="resume-h" className="flex flex-col gap-3.5 sh-rise">
                <h2 id="resume-h" className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#a8a097]">
                    Pick up where you left off
                </h2>
                <div className={`grid grid-cols-1 ${focus.isCorkboard ? 'md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : ''} rounded-[14px] overflow-hidden border border-[#2c2722] bg-[#1b1816]`}>
                    <div className="p-6 md:px-9 md:py-8 flex flex-col gap-3.5">
                        <div className="flex items-center gap-2.5 text-[13px] text-[#a8a097]">
                            {focus.genre && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#2a201a] text-[#ffa27e] font-medium">{focus.genre}</span>
                            )}
                            <span>Edited {editedText(focus.lastModified)}</span>
                        </div>
                        <h3 className="m-0 text-[32px] md:text-[40px] font-normal leading-[1.05] text-[#fbf7f1]" style={{ fontFamily: TITLE_FONT }}>
                            {focus.title}
                        </h3>
                        {focus.logline && (
                            <p className="m-0 text-base leading-[1.5] text-[#c9c1b7] max-w-[500px]">{focus.logline}</p>
                        )}
                        <div className="flex flex-wrap gap-2.5 mt-auto pt-2.5">
                            {/* Same button as Build Your Story (btn-build-story, HomePage.css). */}
                            <button
                                type="button"
                                onClick={() => open(focus)}
                                className="btn-build-story"
                                style={{ height: 48, padding: '0 1.5rem', fontSize: 15 }}
                            >
                                <span className="btn-story-text">{focus.isCorkboard ? 'Open the board' : 'Open the story'}</span>
                            </button>
                            {focus.isCorkboard && (
                                <button
                                    type="button"
                                    onClick={() => navigate(`/freeform/${focus.storyId}/script`)}
                                    className="inline-flex items-center h-12 px-5 rounded-[12px] border border-[#3a332c] text-[#f2ede6] font-medium text-[15px] hover:border-[#5a5048] transition-colors"
                                >
                                    Open the script
                                </button>
                            )}
                        </div>
                    </div>
                    {focus.isCorkboard && (
                        <div className="bg-[#1f1b18] border-t md:border-t-0 md:border-l border-[#2c2722] px-[30px] py-[26px] min-h-[220px]">
                            {focusSummary && boardTotal(focusSummary) > 0 ? (
                                <BoardMosaic summary={focusSummary} animate />
                            ) : summaries ? (
                                <div className="h-full flex items-center justify-center text-sm text-[#7d756c]">Nothing on the board yet</div>
                            ) : null}
                        </div>
                    )}
                </div>
            </section>

            {shown.length > 0 && (
                <section aria-labelledby="others-h" className="flex flex-col gap-3.5 sh-rise" style={{ animationDelay: '90ms' }}>
                    <div className="flex items-baseline justify-between">
                        <h2 id="others-h" className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#a8a097]">
                            Your other stories
                        </h2>
                        <Link to="/profile" className="text-sm text-[#ff8a5c] hover:text-[#ffb08f] no-underline">
                            Manage stories
                        </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[18px]">
                        {shown.map((s, i) => (
                            <div key={s.storyId} className="sh-rise" style={{ animationDelay: `${140 + i * 45}ms` }}>
                                <IndexCard story={s} summary={summaries?.[s.storyId]} known={!!summaries} onOpen={() => open(s)} />
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={onNewStory}
                            style={{ animationDelay: `${140 + shown.length * 45}ms` }}
                            className="sh-rise flex flex-col items-center justify-center gap-2 h-[196px] rounded-[10px] border-[1.5px] border-dashed border-[#4a4038] text-[#c9c1b7] text-[15px] font-medium hover:border-[#6a5d52] hover:text-[#f2ede6] transition-colors"
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                            New story
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
};

const IndexCard: React.FC<{ story: StoryRow; summary?: BoardSummary; known: boolean; onOpen: () => void }> = ({ story, summary, known, onOpen }) => {
    const hasBoard = !!summary && boardTotal(summary) > 0;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="relative flex flex-col gap-2 w-full h-[196px] box-border px-[18px] py-4 rounded-[10px] border border-[#2c2722] bg-[#1b1816] text-[#f2ede6] text-left hover:border-[#3a332c] hover:-translate-y-0.5 transition-[transform,border-color]"
        >
            {/* The index card's ruled line, kept from the paper version. */}
            <span aria-hidden="true" className="absolute left-0 right-0 top-10 h-px bg-[rgba(255,138,92,0.35)]" />
            <span className="h-4 text-xs font-medium text-[#a8a097] flex justify-between w-full">
                <span>{story.genre}</span>
                <span>{relativeTime(story.lastModified)}</span>
            </span>
            <span className="text-[21px] font-normal leading-[1.15] mt-3 text-[#fbf7f1]" style={{ fontFamily: TITLE_FONT }}>{story.title}</span>
            {story.logline && (
                <span className="text-[13px] leading-[1.45] text-[#c9c1b7] line-clamp-2">{story.logline}</span>
            )}
            {story.isCorkboard && hasBoard && (
                <BoardLine summary={summary!} colors={KIND_COLOR_DARK} className="mt-auto h-1.5 w-full" />
            )}
            {story.isCorkboard && known && !hasBoard && (
                <span className="mt-auto text-xs text-[#6f675e]">Empty board</span>
            )}
        </button>
    );
};

/** The stories' shape while they load: same hero card and board panel, and
 *  one ghost per index card the writer had last time, so nothing moves when
 *  the real ones arrive. */
const StoriesSkeleton: React.FC<{ count: number }> = ({ count }) => {
    const cards = Math.min(Math.max(count - 1, 0), OTHER_STORIES_SHOWN);
    const bar = 'rounded bg-[#2a2522]';
    return (
        <div aria-busy="true" aria-label="Loading your stories" className="w-full max-w-[1136px] mx-auto flex flex-col gap-9">
            <div className="flex flex-col gap-3.5">
                <div className={`${bar} h-3 w-44 sh-ghost`} />
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] rounded-[14px] overflow-hidden border border-[#2c2722] bg-[#1b1816]">
                    <div className="p-6 md:px-9 md:py-8 flex flex-col gap-3.5 sh-ghost">
                        <div className={`${bar} h-3 w-32`} />
                        <div className={`${bar} h-9 w-3/4`} />
                        <div className={`${bar} h-3 w-2/3`} />
                        <div className="flex gap-2.5 mt-auto pt-2.5">
                            <div className="h-12 w-40 rounded-[12px] bg-[#2a2522]" />
                            <div className="h-12 w-36 rounded-[12px] bg-[#2a2522]" />
                        </div>
                    </div>
                    <div className="bg-[#1f1b18] border-t md:border-t-0 md:border-l border-[#2c2722] px-[30px] py-[26px] min-h-[220px] flex flex-col gap-3.5 sh-ghost">
                        <div className={`${bar} h-3 w-24`} />
                        <div className="grid grid-cols-5 gap-2">
                            {Array.from({ length: 15 }, (_, i) => <div key={i} className="h-[46px] rounded-[3px] bg-[#26221f]" />)}
                        </div>
                    </div>
                </div>
            </div>
            {cards > 0 && (
                <div className="flex flex-col gap-3.5">
                    <div className={`${bar} h-3 w-36 sh-ghost`} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[18px]">
                        {Array.from({ length: cards + 1 }, (_, i) => (
                            <div key={i} className="h-[196px] rounded-[10px] border border-[#2c2722] bg-[#1b1816] sh-ghost" style={{ animationDelay: `${i * 80}ms` }} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoriesHome;
