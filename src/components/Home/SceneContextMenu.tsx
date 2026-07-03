/**
 * SceneContextMenu.tsx
 * ====================
 * Right-click context menu for scene items in StoryNavigationSidebar.
 *
 * Usage:
 *   <SceneContextMenu
 *     x={pos.x}
 *     y={pos.y}
 *     onGenerate={() => ...}
 *     onNavigate={() => ...}
 *     onClose={() => ...}
 *   />
 */

import React, { useEffect, useRef } from "react";

interface SceneContextMenuProps {
    x: number;
    y: number;
    onGenerate: () => void;
    onNavigate: () => void;
    onClose: () => void;
}

const SceneContextMenu: React.FC<SceneContextMenuProps> = ({
    x,
    y,
    onGenerate,
    onNavigate,
    onClose,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside or Escape
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        // Use capture so we catch the event before it bubbles
        document.addEventListener("mousedown", handleClick, true);
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("mousedown", handleClick, true);
            document.removeEventListener("keydown", handleKey);
        };
    }, [onClose]);

    // Clamp menu to viewport so it never goes off-screen
    const MENU_W = 160;
    const MENU_H = 88;
    const clampedX = Math.min(x, window.innerWidth - MENU_W - 8);
    const clampedY = Math.min(y, window.innerHeight - MENU_H - 8);

    return (
        <div
            ref={menuRef}
            role="menu"
            aria-label="Scene options"
            style={{
                position: "fixed",
                top: clampedY,
                left: clampedX,
                zIndex: 99999,
                width: MENU_W,
                background: "rgba(22,22,28,0.97)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset",
                backdropFilter: "blur(16px)",
                overflow: "hidden",
                padding: "4px 0",
                // Tiny pop-in animation
                animation: "ctxMenuIn 120ms cubic-bezier(.2,.9,.2,1) both",
            }}
        >
            <style>{`
        @keyframes ctxMenuIn {
          from { opacity: 0; transform: scale(0.93) translateY(-4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);     }
        }
      `}</style>

            <ContextMenuItem
                icon={
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <path
                            d="M12 3v9m0 0l-3.5-3.5M12 12l3.5-3.5M3 17v1a3 3 0 003 3h12a3 3 0 003-3v-1"
                            stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round"
                        />
                    </svg>
                }
                label="Generate"
                accent="#ff8c42"
                onClick={() => { onGenerate(); onClose(); }}
            />

            <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "2px 0" }} />

            <ContextMenuItem
                icon={
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <path
                            d="M9 18l6-6-6-6"
                            stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round"
                        />
                    </svg>
                }
                label="Navigate"
                accent="#64b4ff"
                onClick={() => { onNavigate(); onClose(); }}
            />
        </div>
    );
};

// ── Single menu item ──────────────────────────────────────────────────────────

interface ContextMenuItemProps {
    icon: React.ReactNode;
    label: string;
    accent: string;
    onClick: () => void;
}

const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ icon, label, accent, onClick }) => {
    const [hovered, setHovered] = React.useState(false);

    return (
        <button
            role="menuitem"
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "9px 14px",
                border: "none",
                background: hovered ? `${accent}18` : "transparent",
                color: hovered ? accent : "rgba(255,255,255,0.82)",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "Inter, sans-serif",
                cursor: "pointer",
                transition: "background 120ms ease, color 120ms ease",
                textAlign: "left",
            }}
        >
            <span style={{ color: hovered ? accent : "rgba(255,255,255,0.5)", flexShrink: 0, transition: "color 120ms ease" }}>
                {icon}
            </span>
            {label}
        </button>
    );
};

export default SceneContextMenu;