import React, { useEffect, useState, useRef, useCallback } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { scrollToAndFlash } from "../../lib/domUtils";
import Tooltip from "../ui/Tooltip";
import { ActItem, SegmentItem, SceneItem, SegmentWithScenes } from "../../models/acts";
import { SegmentedControl } from "../ui/SegmentedControl";
import SceneContextMenu from "./SceneContextMenu";

interface StoryNavigationProps {
    segments?: SegmentWithScenes[];
    isScrolled?: boolean;
    storyTitle?: string;
    onTitleChange?: (newTitle: string) => void;
    onNewStory?: () => void;
    hasUnsavedChanges?: boolean;
    initialCollapsed?: boolean;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    children?: React.ReactNode;
    expandedWidth?: number;
    collapsedWidth?: number;
    onExpand?: (targetId: string) => void;
    acts?: ActItem[];
    onSelectSegment?: (segmentId: string) => void;
    viewMode?: 'acts' | 'all';
    onViewModeChange?: (mode: 'acts' | 'all') => void;
    onActsReady?: boolean;
    onAssignSceneToSelection?: (sceneId: string, segmentId: string, sceneIndex: number) => void;
    currentParagraphSceneId?: string | null;
    onGenerateScene?: (sceneId: string, segmentId: string, sceneIndex: number) => void;
    /**
     * onNavigateToScene
     * Called when the user clicks "Navigate" in the scene context menu.
     * @param sceneLabel - The label in format "N.M" (e.g. "1.2" for S1 scene 2)
     *
     * The implementor should scroll the editor to the first paragraph whose
     * data-scene-id attribute matches this label, then apply a brief
     * highlight/shine animation.
     */
    onNavigateToScene?: (sceneLabel: string) => void;
}

// ── Context menu state type ────────────────────────────────────────────────

interface ContextMenuState {
    x: number;
    y: number;
    sceneId: string;
    segmentId: string;
    sceneIndex: number;
    sceneLabel: string;
}

const sectionTitles: Record<string, string> = {
    "/home": "Outline",
    "/scenes": "Scenes",
    "/scripts": "Script"
};

const tabs: Array<{ to: string; label: string; icon: string; targetId?: string }> = [
    { to: "/home", label: "Story Brainstorming", icon: "M3 8.5h9M3 5h9M3 11.5h6", targetId: "storyBrainstorming" },
    { to: "/home", label: "Story Foundation", icon: "M3 8.5h9M3 5h9M3 11.5h6", targetId: "storyFoundation" },
    { to: "/home", label: "Synopsis", icon: "M3 8.5h9M3 5h9M3 11.5h6", targetId: "storySummary" },
    { to: "/scenes", label: "Scenes", icon: "M3 8.5h9M3 5h9M3 11.5h6", targetId: "storySummary" },
    { to: "/scripts", label: "Scripts", icon: "M3 8.5h9M3 5h9M3 11.5h6", targetId: "storySummary" },
];

const defaultActs: ActItem[] = [
    {
        id: "act-1",
        label: "Act I",
        children: [
            { id: "S1", label: "Introduction & Stasis", targetId: "S1" },
            { id: "S2", label: "Inciting Incident", targetId: "S2" },
            { id: "S3", label: "Commitment", targetId: "S3" },
        ],
    },
    {
        id: "act-2",
        label: "Act II",
        children: [
            { id: "S4", label: "First Pinch Point", targetId: "S4" },
            { id: "S5", label: "Midpoint", targetId: "S5" },
            { id: "S6", label: "Second Pinch Point", targetId: "S6" },
        ],
    },
    {
        id: "act-3",
        label: "Act III",
        children: [
            { id: "S7", label: "Second Plot Point", targetId: "S7" },
            { id: "S8", label: "Climax", targetId: "S8" },
            { id: "S9", label: "Resolution", targetId: "S9" },
        ],
    },
];

const comingSoonTabs = [
    { id: "script", label: "Script", subtitle: "Coming soon", icon: "M6 4h12v16H6z" }
];

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="flex-shrink-0"
    >
        <path d={d} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const actRailColors: Record<number, { rail: string; glow: string; badge: string; text: string }> = {
    1: { rail: "#ff6b35", glow: "rgba(255,107,53,0.12)", badge: "rgba(255,107,53,0.15)", text: "#ff8c42" },
    2: { rail: "#64b4ff", glow: "rgba(100,180,255,0.10)", badge: "rgba(100,180,255,0.15)", text: "#64b4ff" },
    3: { rail: "#a78bfa", glow: "rgba(167,139,250,0.10)", badge: "rgba(167,139,250,0.15)", text: "#a78bfa" },
};

const StoryNavigationSidebar: React.FC<StoryNavigationProps> = ({
    segments,
    isScrolled = false,
    storyTitle = "Untitled Story",
    onTitleChange,
    onNewStory,
    hasUnsavedChanges = false,
    initialCollapsed = false,
    collapsed: collapsedControlled,
    onCollapsedChange,
    children,
    expandedWidth = 255,
    collapsedWidth = 56,
    onExpand,
    acts: actsProp,
    onSelectSegment,
    viewMode,
    onViewModeChange,
    onActsReady,
    onAssignSceneToSelection,
    currentParagraphSceneId,
    onGenerateScene,
    onNavigateToScene,
}) => {
    const location = useLocation();
    const [internalCollapsed, setInternalCollapsed] = useState<boolean>(initialCollapsed);
    const collapsed = typeof collapsedControlled === "boolean" ? collapsedControlled : internalCollapsed;
    const actsToRender = actsProp ?? defaultActs;

    // ── Context menu state ──────────────────────────────────────────────────
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const handleSceneContextMenu = useCallback(
        (
            e: React.MouseEvent,
            sceneId: string,
            segmentId: string,
            sceneIndex: number,
            sceneLabel: string,
        ) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, sceneId, segmentId, sceneIndex, sceneLabel });
        },
        []
    );

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const [reduceMotion, setReduceMotion] = useState(false);
    useEffect(() => {
        try {
            const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
            setReduceMotion(mq.matches);
            const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
            if (mq.addEventListener) mq.addEventListener("change", handler);
            else mq.addListener(handler);
            return () => {
                if (mq.removeEventListener) mq.removeEventListener("change", handler);
                else mq.removeListener(handler);
            };
        } catch {
            setReduceMotion(false);
        }
    }, []);

    useEffect(() => {
        if (typeof collapsedControlled === "boolean") {
            setInternalCollapsed(collapsedControlled);
        }
    }, [collapsedControlled]);

    const toggleCollapsed = () => {
        const next = !collapsed;
        if (onCollapsedChange) onCollapsedChange(next);
        if (typeof collapsedControlled !== "boolean") setInternalCollapsed(next);
    };

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(storyTitle);
    const [showNewStoryOption, setShowNewStoryOption] = useState(false);

    useEffect(() => {
        if (!isEditing) setEditValue(storyTitle);
    }, [storyTitle, isEditing]);

    const handleSave = () => {
        const trimmed = editValue.trim();
        if (!trimmed) { setEditValue(storyTitle); setIsEditing(false); return; }
        if (onTitleChange && trimmed !== storyTitle) onTitleChange(trimmed);
        setIsEditing(false);
    };
    const handleCancel = () => { setEditValue(storyTitle); setIsEditing(false); };
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") handleCancel();
    };
    const handleNewStoryClick = () => { if (onNewStory) onNewStory(); setShowNewStoryOption(false); };

    useEffect(() => {
        if (location.pathname !== "/home" && location.pathname !== "/dashboard") {
            setExpandedActs({});
        }
    }, [location.pathname]);

    const displayTitle = storyTitle && storyTitle.trim() ? storyTitle : "Untitled Story";
    const isUntitled = !storyTitle || !storyTitle.trim() || storyTitle === "Untitled Story";
    const isDashboard = location.pathname === "/dashboard";
    const isHomeActive = location.pathname === "/home" || location.pathname === "/dashboard";
    const isScenesActive = location.pathname === "/scenes";
    const isScriptsActive = location.pathname === "/scripts";
    const sidebarWidthPx = collapsed ? collapsedWidth : expandedWidth;
    const widthDuration = "340ms";
    const easing = "cubic-bezier(.2,.9,.2,1)";
    const contentFadeDuration = "220ms";
    const contentFadeDelay = collapsed ? "0ms" : "40ms";

    const groupedTabs = tabs.reduce<Record<string, Array<typeof tabs[0]>>>((acc, tab) => {
        const key = tab.to || "/";
        if (!acc[key]) acc[key] = [];
        acc[key].push(tab);
        return acc;
    }, {});

    const homeTabs = groupedTabs["/home"] ?? [];
    const sceneTabs = groupedTabs["/scenes"] ?? [];
    const scriptTabs = groupedTabs["/scripts"] ?? [];

    const actsContext = isScenesActive
        ? { indent: 2, color: "rgba(100,180,255,0.8)" }
        : isHomeActive
            ? { indent: 6, color: "rgba(255,107,53,0.8)" }
            : null;

    const [expandedActs, setExpandedActs] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        actsToRender.forEach((a) => (initial[a.id] = false));
        return initial;
    });

    const [expandedActsScripts, setExpandedActsScripts] = useState<Record<number, boolean>>({});
    const [expandedSegments, setExpandedSegments] = useState<Record<string, boolean>>({});

    const renderTabGroup = (path: string, groupTabs: typeof tabs) => {
        if (!groupTabs.length) return null;
        const sectionLabel = sectionTitles[path] ?? path;
        const groupActive =
            path === "/home"
                ? isDashboard || location.pathname === "/home"
                : location.pathname === path;

        return (
            <div key={path} className="mb-2">
                <NavLink
                    to={path}
                    end
                    className="group relative overflow-hidden flex items-center justify-between px-2 py-1 rounded-md"
                    style={{
                        display: collapsed ? "none" : "flex",
                        textDecoration: "none",
                        color: groupActive ? "#fff" : "rgba(255,255,255,0.6)",
                        background: groupActive
                            ? "linear-gradient(135deg, rgba(255,107,53,0.85) 0%, rgba(255,140,66,0.85) 100%)"
                            : "transparent",
                        borderRadius: 8,
                        transition: "color 180ms ease",
                    }}
                >
                    {!groupActive && (
                        <span
                            className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                            style={{
                                transition: "opacity 220ms ease",
                                background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.06))",
                                boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
                            }}
                        />
                    )}
                    <span className="relative z-10 text-xs font-semibold">{sectionLabel}</span>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="relative z-10">
                        <path d="M9 6l6 6-6 6" stroke={groupActive ? "#fff" : "rgba(255,255,255,0.6)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </NavLink>

                <div style={{ maxHeight: groupActive ? 500 : 0, opacity: groupActive ? 1 : 0, overflow: "hidden", transition: "max-height 260ms ease, opacity 180ms ease" }}>
                    <div className="flex flex-col gap-2 mt-1">
                        {groupTabs
                            .filter((t) => !(path === "/scenes" && location.pathname === "/scenes"))
                            .map((t) => {
                                const isScrollOnly = !!t.targetId;
                                const childActive =
                                    !isScrollOnly &&
                                    (t.to === "/home"
                                        ? isDashboard || location.pathname === "/home"
                                        : location.pathname === t.to);

                                const navLinkStyle: React.CSSProperties = {
                                    position: "relative", display: "flex", alignItems: "center",
                                    justifyContent: collapsed ? "center" : "flex-start",
                                    gap: collapsed ? 0 : 12,
                                    padding: collapsed ? "8px 6px" : "10px 12px",
                                    borderRadius: 8, cursor: "pointer",
                                    background: !isScrollOnly && childActive
                                        ? "linear-gradient(135deg, rgba(255,107,53,0.85), rgba(255,140,66,0.85))"
                                        : "rgba(255,255,255,0.02)",
                                    color: childActive ? "#fff" : "rgba(255,255,255,0.85)",
                                    transition: "background 180ms ease, box-shadow 180ms ease, transform 120ms ease",
                                };

                                const labelStyle: React.CSSProperties = {
                                    overflow: "hidden", whiteSpace: "nowrap", display: "inline-block",
                                    maxWidth: collapsed ? 0 : 9999, width: collapsed ? 0 : "auto",
                                    opacity: collapsed ? 0 : 1,
                                    transform: collapsed ? "translateX(-6px)" : "translateX(0)",
                                    transition: `width ${contentFadeDuration} ${easing} ${contentFadeDelay}, opacity ${contentFadeDuration} ${easing} ${contentFadeDelay}, transform ${contentFadeDuration} ${easing} ${contentFadeDelay}`,
                                    pointerEvents: collapsed ? "none" : "auto",
                                    fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: 14,
                                    color: "rgba(255,255,255,0.9)",
                                };

                                const navItem = isScrollOnly ? (
                                    <button type="button"
                                        onClick={() => { scrollToAndFlash(t.targetId!, { block: "center", durationMs: 1300 }); onExpand?.(t.targetId!); }}
                                        className="w-full text-left"
                                        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                                        aria-label={t.label}
                                    >
                                        <div className="group relative overflow-hidden flex items-center w-full"
                                            style={{ padding: collapsed ? "8px 6px" : "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
                                            <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                                style={{ transition: "opacity 220ms ease", background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.06) 100%)", boxShadow: "0 6px 16px rgba(0,0,0,0.35)" }} />
                                            <div style={{ width: 24, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, color: "rgba(255,255,255,0.9)" }}>
                                                <Icon d={t.icon} size={16} />
                                            </div>
                                            <span className="text-sm truncate" style={{ ...labelStyle, position: "relative", zIndex: 1 }}>{t.label}</span>
                                        </div>
                                    </button>
                                ) : (
                                    <NavLink to={t.to} end className="group relative overflow-hidden" style={navLinkStyle}>
                                        <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                            style={{ transition: "opacity 220ms ease", background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.06))", boxShadow: "0 6px 16px rgba(0,0,0,0.35)" }} />
                                        <Icon d={t.icon} size={16} />
                                        {!collapsed && <span>{t.label}</span>}
                                    </NavLink>
                                );

                                return collapsed ? (
                                    <Tooltip key={t.label} description={t.label} position="right">{navItem}</Tooltip>
                                ) : (
                                    <React.Fragment key={t.label}>{navItem}</React.Fragment>
                                );
                            })}
                    </div>
                </div>
            </div>
        );
    };

    const renderActs = () => {
        const isHome = location.pathname === "/home" || location.pathname === "/scenes" || location.pathname === "/scripts";
        if (!isHome || !actsToRender.length) return null;

        return (
            <div className="mb-2">
                {!collapsed && (
                    <div className="px-2 py-1 text-xs text-white/60 font-semibold" style={{ fontFamily: "Inter, sans-serif" }}>
                        Acts
                    </div>
                )}
                <div className="flex flex-col gap-2 mt-1">
                    {actsToRender.map((act) => {
                        const actExpanded = !!expandedActs[act.id];
                        const stats = act.stats;
                        return (
                            <div key={act.id}>
                                {collapsed ? (
                                    <Tooltip description={stats ? `${act.label} · ${stats.totalScenes} scenes · ${stats.progressPercentage}%` : act.label} position="right">
                                        <div role="button" tabIndex={0} onClick={() => onExpand?.(act.id)}
                                            className="group relative overflow-hidden flex items-center justify-center rounded-md"
                                            style={{ padding: "8px 6px", background: "rgba(255,255,255,0.02)", cursor: "pointer", color: "rgba(255,255,255,0.9)" }}>
                                            <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
                                                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                            </svg>
                                        </div>
                                    </Tooltip>
                                ) : (
                                    <div role="button" tabIndex={0} aria-expanded={actExpanded}
                                        onClick={() => setExpandedActs((prev) => ({ ...prev, [act.id]: !prev[act.id] }))}
                                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedActs((prev) => ({ ...prev, [act.id]: !prev[act.id] })); }}
                                        className="group relative overflow-hidden flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer"
                                        style={{ background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.9)" }}>
                                        <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                            style={{ transition: "opacity 220ms ease", background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.06))", boxShadow: "0 6px 16px rgba(0,0,0,0.35)" }} />
                                        <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
                                            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                        </svg>
                                        <span className="text-sm font-semibold">{act.label}</span>
                                        {stats && (
                                            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                                                    {stats.totalScenes} scenes · {stats.progressPercentage}%
                                                </span>
                                                <div style={{ width: 72, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                                                    <div style={{ width: `${stats.progressPercentage}%`, height: "100%", background: "linear-gradient(90deg, #ff6b35, #ff8c42)", transition: "width 240ms ease" }} />
                                                </div>
                                            </div>
                                        )}
                                        <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden style={{ transform: actExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 180ms ease" }}>
                                            <path d="M9 6l6 6-6 6" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                )}

                                {!collapsed && actExpanded && (
                                    <div className="ml-6 mt-2 flex flex-col gap-1">
                                        {act.children.map((child) => (
                                            <div key={child.id} role="button" tabIndex={0}
                                                onClick={() => { if (isScenesActive) onSelectSegment?.(child.id); if (child.targetId) onExpand?.(child.targetId); }}
                                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { if (child.targetId) onExpand?.(child.targetId); } }}
                                                className="group relative overflow-hidden flex items-center gap-3 rounded-md px-2 py-1 cursor-pointer"
                                                style={{ background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.75)" }}>
                                                <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                                    style={{ transition: "opacity 180ms ease", background: "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.05))" }} />
                                                <svg width={8} height={8} viewBox="0 0 10 10" aria-hidden>
                                                    <circle cx="5" cy="5" r="4" fill={child.stats?.scenesCount ? "#ff6b35" : "rgba(255,255,255,0.25)"} />
                                                </svg>
                                                <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{child.label}</span>
                                                {child.stats && (
                                                    <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{child.stats.scenesCount}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    /* ────────────────────────────────────────────────────────────
       renderSegments — "Vertical Rail" design for Scripts view
       Right-click on a scene row opens the context menu with
       Generate and Navigate actions.
       ──────────────────────────────────────────────────────────── */
    const renderSegments = () => {
        if (location.pathname !== "/scripts") return null;
        if (!segments?.length) return null;
        if (collapsed) return null;

        const segmentsByAct = segments.reduce<Record<number, SegmentWithScenes[]>>(
            (acc, segment) => {
                if (!acc[segment.act]) acc[segment.act] = [];
                acc[segment.act].push(segment);
                return acc;
            },
            {}
        );

        const actNumbers = Object.keys(segmentsByAct).sort();

        return (
            <div className="mb-2">
                {!collapsed && (
                    <div className="px-2 py-1 text-xs text-white/60 font-semibold" style={{ fontFamily: "Inter, sans-serif" }}>
                        Script Structure
                    </div>
                )}

                <div className="flex flex-col mt-1">
                    {actNumbers.map((actNumber) => {
                        const act = Number(actNumber);
                        const c = actRailColors[act] ?? actRailColors[1];
                        const actSegments = segmentsByAct[act];

                        return (
                            <div key={act} style={{ marginBottom: 4 }}>
                                {!collapsed && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 6px 6px" }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: c.text, opacity: 0.7 }}>
                                            Act {act}
                                        </span>
                                        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${c.rail}33, transparent)` }} />
                                    </div>
                                )}

                                <div style={{ position: "relative", marginLeft: 5 }}>
                                    <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 2, borderRadius: 2, background: `linear-gradient(180deg, ${c.rail}66, ${c.rail}22)` }} />

                                    {actSegments.map((segment) => {
                                        const segExpanded = expandedSegments[segment.id];
                                        const segNum = segment.id.replace("S", "");

                                        return (
                                            <div key={segment.id} style={{ position: "relative", marginBottom: 2 }}>
                                                {/* Node dot on rail */}
                                                <div style={{
                                                    position: "absolute", left: 2, top: 12,
                                                    width: 10, height: 10, borderRadius: "50%",
                                                    background: segExpanded ? c.rail : "rgba(255,255,255,0.15)",
                                                    border: `2px solid ${segExpanded ? c.rail : "rgba(255,255,255,0.2)"}`,
                                                    boxShadow: segExpanded ? `0 0 8px ${c.rail}66` : "none",
                                                    transition: "all 200ms ease", zIndex: 2,
                                                }} />

                                                {/* Segment header */}
                                                <div
                                                    role="button" tabIndex={0}
                                                    onClick={() => setExpandedSegments((prev) => ({ ...prev, [segment.id]: !prev[segment.id] }))}
                                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedSegments((prev) => ({ ...prev, [segment.id]: !prev[segment.id] })); }}
                                                    className="group"
                                                    style={{
                                                        marginLeft: 15, padding: "8px 0px", paddingLeft: "6px", borderRadius: 8,
                                                        cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                                                        background: segExpanded ? c.glow : "transparent",
                                                        transition: "background 200ms ease",
                                                    }}
                                                >
                                                    <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                                        style={{ transition: "opacity 180ms ease", background: "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.05))" }} />
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: c.badge, color: c.text, letterSpacing: "0.04em", flexShrink: 0 }}>
                                                        {segment.id}
                                                    </span>
                                                    <span style={{ fontSize: 12.5, fontWeight: 500, color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                                                        {segment.title}
                                                    </span>
                                                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
                                                        {segment.scenes?.length ?? 0}
                                                    </span>
                                                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden
                                                        style={{ transform: segExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 180ms ease", flexShrink: 0 }}>
                                                        <path d="M9 6l6 6-6 6" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" />
                                                    </svg>
                                                </div>

                                                {/* Scenes — compact rows with right-click context menu */}
                                                {segExpanded && segment.scenes?.length > 0 && (
                                                    <div style={{ marginLeft: 22, paddingLeft: 12, paddingTop: 2, paddingBottom: 4, display: "flex", flexDirection: "column", gap: 1 }}>
                                                        {segment.scenes.map((scene, index) => {
                                                            const sceneLabel = `${segNum}.${index + 1}`;
                                                            const isCurrentScene = sceneLabel === currentParagraphSceneId;

                                                            return (
                                                                <div
                                                                    key={scene.sceneId}
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    // Left-click: assign scene to current selection (existing behaviour)
                                                                    onClick={() => onNavigateToScene?.(sceneLabel)}
                                                                    // Right-click: open context menu
                                                                    // onContextMenu={(e) => handleSceneContextMenu(e, scene.sceneId, segment.id, index, sceneLabel)}
                                                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onExpand?.(scene.sceneId); }}
                                                                    className="group relative overflow-hidden rounded-md cursor-pointer"
                                                                    style={{
                                                                        padding: "5px 8px", borderRadius: 6,
                                                                        color: "rgba(255,255,255,0.65)",
                                                                        display: "grid",
                                                                        gridTemplateRows: "1fr 0fr",
                                                                        transition: "grid-template-rows 200ms ease",
                                                                        background: isCurrentScene ? "rgba(255,107,53,0.08)" : undefined,
                                                                        borderLeft: isCurrentScene ? "2px solid #ff6b35" : "2px solid transparent",
                                                                    }}
                                                                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.gridTemplateRows = "1fr 1fr"; }}
                                                                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.gridTemplateRows = "1fr 0fr"; }}
                                                                >
                                                                    <span className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100"
                                                                        style={{ transition: "opacity 150ms ease", background: "rgba(255,255,255,0.04)" }} />

                                                                    {/* Main row: badge + title */}
                                                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                        <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: "rgba(255,107,53,0.12)", color: "#ff8c42", flexShrink: 0 }}>
                                                                            {sceneLabel}
                                                                        </span>
                                                                        <span style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                                                                            {scene.title || scene.sceneId}
                                                                        </span>
                                                                    </div>

                                                                    {/* Expandable area: Generate button (hover) */}
                                                                    <div style={{ overflow: "hidden" }}>
                                                                        <div style={{ paddingTop: 6, paddingBottom: 2, display: "flex", gap: "5px" }}>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => { e.stopPropagation(); onGenerateScene?.(scene.sceneId, segment.id, index); }}
                                                                                style={{
                                                                                    position: "relative", zIndex: 1, width: "75px",
                                                                                    fontSize: 10, fontWeight: 600, padding: "4px 0", borderRadius: 4,
                                                                                    border: "1px solid rgba(255,107,53,0.35)",
                                                                                    background: "rgba(255,107,53,0.12)", color: "#ff8c42",
                                                                                    cursor: "pointer", letterSpacing: "0.04em",
                                                                                    transition: "background 150ms ease",
                                                                                }}
                                                                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,53,0.25)"; }}
                                                                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,53,0.12)"; }}
                                                                            >
                                                                                Generate
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => { e.stopPropagation(); onAssignSceneToSelection?.(scene.sceneId, segment.id, index); }}
                                                                                style={{
                                                                                    position: "relative", zIndex: 1, width: "75px",
                                                                                    fontSize: 10, fontWeight: 600, padding: "4px 0", borderRadius: 4,
                                                                                    border: "1px solid rgba(255,107,53,0.35)",
                                                                                    background: "rgba(255,107,53,0.12)", color: "#ff8c42",
                                                                                    cursor: "pointer", letterSpacing: "0.04em",
                                                                                    transition: "background 150ms ease",
                                                                                }}
                                                                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,53,0.25)"; }}
                                                                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,53,0.12)"; }}
                                                                            >
                                                                                Assign
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderContextualActs = () => {
        if (!actsContext) return null;
        if (collapsed) return renderActs();
        return (
            <div style={{ position: "relative", marginLeft: actsContext.indent, paddingLeft: actsContext.indent + 6 }}>
                <span aria-hidden className={onActsReady ? "acts-glow-pulse" : undefined}
                    style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 2, borderRadius: 2, background: actsContext.color, "--acts-color": actsContext.color } as React.CSSProperties} />
                {renderActs()}
            </div>
        );
    };

    return (
        <>
            {/* ── Context Menu (rendered at document root via portal-like fixed positioning) ── */}
            {contextMenu && (
                <SceneContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onGenerate={() => onGenerateScene?.(contextMenu.sceneId, contextMenu.segmentId, contextMenu.sceneIndex)}
                    onNavigate={() => onNavigateToScene?.(contextMenu.sceneLabel)}
                    onClose={closeContextMenu}
                />
            )}

            <div className="flex flex-col lg:flex-row">
                <div className="flex-shrink-0" style={{ width: sidebarWidthPx, transition: `width ${widthDuration} ${easing}, min-width ${widthDuration} ${easing}` }}>
                    <div
                        data-sidebar="main"
                        className="hidden lg:flex flex-col sidebar-scroll"
                        style={{
                            position: "fixed", left: 0, top: "75px", bottom: 0,
                            width: sidebarWidthPx,
                            paddingTop: 50, paddingLeft: 6, paddingRight: 6, paddingBottom: 10,
                            minWidth: collapsed ? `${collapsedWidth}px` : `${expandedWidth}px`,
                            borderRight: collapsed ? "none" : "1px solid rgba(255,255,255,0.06)",
                            boxShadow: collapsed ? "none" : "0 8px 24px rgba(0,0,0,0.4)",
                            backdropFilter: collapsed ? undefined : "blur(10px)",
                            overflowY: "auto", WebkitOverflowScrolling: "touch" as any,
                            transitionProperty: "background, box-shadow, border-right, min-width",
                            transitionDuration: widthDuration, transitionTimingFunction: easing,
                            background: "transparent", zIndex: 99,
                        }}
                    >
                        <div className="flex items-center justify-between mb-10 px-1">
                            <button
                                aria-expanded={!collapsed}
                                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                                onClick={toggleCollapsed}
                                className="rounded-md focus:outline-none flex items-center justify-center"
                                style={{
                                    width: 36, height: 36,
                                    background: collapsed ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                                    color: "white",
                                    border: collapsed ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(255,255,255,0.02)",
                                    transition: `transform ${widthDuration} ${easing}, background ${widthDuration} ${easing}`,
                                }}
                                title={collapsed ? "Expand" : "Collapse"}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                    style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: `transform ${widthDuration} ${easing}` }}>
                                    <path d="M8 5l8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                            {!collapsed && (
                                <div className="flex-1 flex items-center justify-center text-xs text-white/60" style={{ fontFamily: "Inter, sans-serif" }}>
                                    <span>Story Workflow</span>
                                </div>
                            )}
                        </div>

                        <nav className="flex-1 flex flex-col gap-4">
                            {renderTabGroup("/home", homeTabs)}
                            {isHomeActive && renderContextualActs()}
                            {renderTabGroup("/scenes", sceneTabs)}
                            {isScenesActive && !collapsed && (
                                <div className="px-2">
                                    <SegmentedControl value={viewMode ?? "acts"} onChange={(mode) => onViewModeChange?.(mode)} />
                                </div>
                            )}
                            {isScenesActive && renderContextualActs()}
                            {renderTabGroup("/scripts", scriptTabs)}
                            {isScriptsActive && renderSegments()}
                        </nav>

                        <div style={{ opacity: collapsed ? 0 : 1, transform: collapsed ? "translateY(6px)" : "translateY(0)", transition: `opacity ${contentFadeDuration} ${easing}, transform ${contentFadeDuration} ${easing}` }} />
                    </div>
                </div>

                <main className="flex-1 transition-all duration-300" style={{ paddingTop: 75, minHeight: "auto" }}>
                    <div>{children}</div>
                </main>

                <div className="lg:hidden w-full" />
            </div>
        </>
    );
};

export default StoryNavigationSidebar;