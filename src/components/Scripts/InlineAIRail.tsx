/**
 * InlineAIRail.tsx
 * ================
 * Expandable vertical button rail on the right edge of the screenplay editor.
 *
 * Three panel modes:
 *   - suggest (purple) — suggestion cards, selecting one applies inline
 *   - revise  (cyan)   — direction input, result applies inline automatically
 *   - generate (orange) — guided generation at cursor
 *
 * Suggest and Revise share a "pending" state: after AI text is inserted
 * inline into the editor, the panel shows Accept / Retry / Reject buttons
 * (same pattern as the generate panel's pending state).
 *
 * FIL-315: Retry with feedback — InlinePendingPanel now has an expandable
 * textarea for the user to provide direction on what they want differently,
 * matching the guided generation retry pattern.
 *
 * Imported by: ScriptEditor.tsx
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { InlineAIMode } from "./useInlineAI";
import CharacterPanel from "../characters-home/CharacterPanel";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Suggestion {
  text: string;
  rationale: string;
}

export type GenerationScope = "lines" | "scene";
export type GenerateState = "idle" | "loading" | "pending" | "resolved";

export interface InlineAIRailProps {
  activePanel: "suggest" | "revise" | "generate" | "characters" | null;
  onToggleSuggest: () => void;
  onToggleRevise: () => void;
  onToggleGenerate: () => void;
  onToggleCharacters: () => void;
  onImportExport: () => void;
  hasSelection?: boolean;
  // ── Inline AI (suggest / revise / pending) ──
  inlineAIMode: InlineAIMode;
  isLoading: boolean;
  error: string | null;
  suggestions: Suggestion[] | null;
  onSuggest: (direction?: string) => void;
  onApplySuggestion: (index: number) => void;
  revisionResult: string | null;
  onRevise: (direction: string) => void;
  onApplyRevision: () => void;
  onRetry: (retryDirection?: string) => void;
  onAcceptPending: () => void;
  onRejectPending: () => void;
  onDismiss: () => void;
  selectedText?: string;
  // ── Generate ──
  generateState: GenerateState;
  generateResultText: string | null;
  generateError: string | null;
  onGenerate: (scope: GenerationScope, direction?: string) => Promise<void>;
  onGenerateAccept: () => void;
  onGenerateRemove: () => void;
  onGenerateRetry: (retryDirection?: string) => Promise<void>;
  onGenerateDismiss: () => void;
  currentSceneId: string | null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const RAIL_W = 44;
const EXPANDED_W = 330;
const TOOLBAR_H = 38;

const SUGGEST_PLACEHOLDERS = [
  "What if we started in the middle?",
  "What's the version that scares me?",
  "How else could this land?",
  "Where's the unexpected angle?",
  "Is there a quieter way in?",
];

const REVISE_PLACEHOLDERS = [
  "Show, don't tell...",
  "Less dialogue, more tension...",
  "Make me feel the silence...",
  "Cut to the bone...",
  "Let the subtext do the work...",
];

const GENERATE_PLACEHOLDERS = [
  "A beat of silence before she speaks...",
  "Something snaps between them here...",
  "He says the thing he can't take back...",
  "The room shifts after this line...",
  "She finally asks the real question...",
];

const RETRY_PLACEHOLDERS = [
  "More tension in the subtext…",
  "Shorter, punchier lines…",
  "Let the silence do more work…",
  "Make her angrier but quieter…",
  "Less on-the-nose…",
];

const LOADING_HINTS_LINES = [
  "Drafting alternatives…",
  "Weighing the options…",
  "Almost there…",
];

const LOADING_HINTS_SCENE = [
  "Building the scene structure…",
  "Assembling character context…",
  "Writing the scene…",
  "Polishing the draft…",
];

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

// ─────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────

const P = {
  bg0: "#0e0e10",
  bg1: "#141416",
  bg2: "#1a1a1e",
  bg3: "#222226",

  border0: "rgba(255,255,255,0.06)",
  border1: "rgba(255,255,255,0.10)",
  border2: "rgba(255,255,255,0.14)",

  text0: "#e8e8ec",
  text1: "#a0a0a8",
  text2: "#606068",
  text3: "#404048",

  suggest: { main: "#8b5cf6", light: "#a78bfa", dim: "rgba(139,92,246,0.15)", glow: "rgba(139,92,246,0.35)" },
  revise: { main: "#06b6d4", light: "#22d3ee", dim: "rgba(6,182,212,0.15)", glow: "rgba(6,182,212,0.35)" },
  generate: { main: "#f97316", light: "#fb923c", dim: "rgba(249,115,22,0.12)", glow: "rgba(249,115,22,0.35)" },
  green: { main: "#10b981", light: "#34d399" },
  orange: { main: "#ff6b35", light: "#ff8c55" },
  gray: { main: "#6b7280", light: "#8b919a" },
  error: "#ef4444",
};

interface BtnDef {
  id: string;
  label: string;
  accent: string;
  gradient: string;
  glow: string;
  glowStrong: string;
  tooltipColor: string;
}

const BTNS: BtnDef[] = [
  { id: "suggest", label: "Suggest", accent: P.suggest.main, gradient: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)", glow: P.suggest.glow, glowStrong: "0 0 22px rgba(139,92,246,0.55), 0 0 8px rgba(139,92,246,0.35)", tooltipColor: P.suggest.main },
  { id: "revise", label: "Revise", accent: P.revise.main, gradient: "linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)", glow: P.revise.glow, glowStrong: "0 0 22px rgba(6,182,212,0.55), 0 0 8px rgba(6,182,212,0.35)", tooltipColor: P.revise.main },
  { id: "divider", label: "", accent: "", gradient: "", glow: "", glowStrong: "", tooltipColor: "" },
  { id: "generate", label: "Generate", accent: P.generate.main, gradient: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)", glow: P.generate.glow, glowStrong: "0 0 22px rgba(249,115,22,0.55), 0 0 8px rgba(249,115,22,0.35)", tooltipColor: P.generate.main },
  { id: "divider2", label: "", accent: "", gradient: "", glow: "", glowStrong: "", tooltipColor: "" },
  { id: "characters", label: "Characters", accent: P.orange.main, gradient: "linear-gradient(135deg, #ff7e3a 0%, #f06315 100%)", glow: "rgba(255,107,53,0.35)", glowStrong: "0 0 22px rgba(255,107,53,0.55), 0 0 8px rgba(255,107,53,0.35)", tooltipColor: P.orange.main },
  { id: "importexport", label: "Export", accent: P.gray.main, gradient: "linear-gradient(135deg, #8b919a 0%, #6b7280 100%)", glow: "rgba(107,114,128,0.25)", glowStrong: "0 0 16px rgba(107,114,128,0.45)", tooltipColor: P.gray.main },
];

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

const icons: Record<string, React.FC> = {
  suggest: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M7.5 3C5.567 3 4 4.567 4 6.5C4 7.753 4.5 8.5 5.25 9.25C5.75 9.75 6 10.25 6 11V11.5C6 11.776 6.224 12 6.5 12H8.5C8.776 12 9 11.776 9 11.5V11C9 10.25 9.25 9.75 9.75 9.25C10.5 8.5 11 7.753 11 6.5C11 4.567 9.433 3 7.5 3Z" fill="none" />
      <path d="M6 13.5H9" strokeLinecap="round" />
      <path d="M7.5 0.5V1.5" strokeLinecap="round" />
      <path d="M12 2.5L11.25 3.25" strokeLinecap="round" />
      <path d="M3 2.5L3.75 3.25" strokeLinecap="round" />
    </svg>
  ),
  revise: () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1">
      <circle cx="4" cy="7.5" r="2.5" />
      <circle cx="11" cy="7.5" r="2.5" />
      <path d="M6.5 7.5H8.5" strokeLinecap="round" />
      <path d="M0.5 7.5H1.5" strokeLinecap="round" />
      <path d="M13.5 7.5H14.5" strokeLinecap="round" />
    </svg>
  ),
  generate: () => (
    <svg width="13" height="13" viewBox="0 0 15 15" fill="currentColor">
      <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
    </svg>
  ),
  characters: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  importexport: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  bolt: () => (
    <svg width="11" height="11" viewBox="0 0 15 15" fill="currentColor">
      <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
    </svg>
  ),
};

// ─────────────────────────────────────────────
// Circular Rail Button
// ─────────────────────────────────────────────

const RailBtn: React.FC<{
  def: BtnDef;
  isOn?: boolean;
  dimmed?: boolean;
  subdued?: boolean;
  onClick: () => void;
  showTip?: boolean;
}> = ({ def, isOn = false, dimmed = false, subdued = false, onClick, showTip = true }) => {
  const [hov, setHov] = useState(false);
  const active = isOn || hov;
  const Icon = icons[def.id];

  const effectiveOpacity = dimmed ? 0.25 : subdued ? (hov ? 1 : 0.5) : 1;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          width: 32, height: 32, borderRadius: "50%", padding: 0,
          border: `1px solid ${active ? def.accent : "rgba(255,255,255,0.1)"}`,
          background: active ? def.gradient : "transparent",
          color: active ? "#ffffff" : "rgba(255,255,255,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: dimmed ? "default" : "pointer",
          transition: "all 0.15s ease",
          boxShadow: isOn ? def.glowStrong : hov ? `0 0 14px ${def.glow}` : "none",
          opacity: effectiveOpacity,
          pointerEvents: dimmed ? "none" : "auto",
          flexShrink: 0,
        }}
      >
        {Icon && <Icon />}
      </button>

      {hov && showTip && !dimmed && (
        <div style={{
          position: "absolute", right: 40, top: "50%", transform: "translateY(-50%)",
          background: def.tooltipColor, color: "#ffffff", fontSize: 11, fontWeight: 600,
          padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap",
          pointerEvents: "none", zIndex: 10,
          boxShadow: `0 0 14px ${def.glow}`,
        }}>
          {def.label}
          <div style={{
            position: "absolute", right: -4, top: "50%",
            transform: "translateY(-50%) rotate(45deg)",
            width: 8, height: 8, background: def.tooltipColor,
          }} />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Panel Info Tooltips
// ─────────────────────────────────────────────

const PANEL_TOOLTIPS: Record<string, { title: string; body: string }> = {
  suggest: {
    title: "Suggest alternatives",
    body: "Select text to get alternative takes, or place your cursor to get suggestions for what comes next. Add optional guidance to steer the direction.",
  },
  revise: {
    title: "Revise selection",
    body: "Select the text you want to rework, then describe how it should change. The AI rewrites your selection in place while preserving the surrounding context.",
  },
  generate: {
    title: "Generate from cursor",
    body: "Place your cursor where you want new content. Choose 'lines' for a few beats of action or dialogue, or 'scene' to write through to the end of the current scene.",
  },
};

const PanelInfoTip: React.FC<{ panelId: string; accentColor: string }> = ({ panelId, accentColor }) => {
  const [show, setShow] = useState(false);
  const tip = PANEL_TOOLTIPS[panelId];
  if (!tip) return null;

  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div style={{
        width: 14, height: 14, borderRadius: "50%",
        border: `1px solid ${P.border1}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, fontWeight: 700, color: P.text2, cursor: "default",
        transition: "all 0.15s",
        ...(show ? { borderColor: accentColor, color: accentColor } : {}),
      }}>
        i
      </div>

      {show && (
        <div style={{
          position: "absolute",
          top: 22,
          left: 0,
          width: 220,
          padding: "10px 12px",
          background: "rgba(10, 10, 14, 0.96)",
          border: `1px solid ${accentColor}44`,
          borderRadius: 10,
          boxShadow: `0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px ${accentColor}15`,
          zIndex: 20,
          pointerEvents: "none",
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: accentColor,
            marginBottom: 5, letterSpacing: 0.2,
          }}>
            {tip.title}
          </div>
          <div style={{
            fontSize: 11, color: "rgba(255,255,255,0.6)",
            lineHeight: 1.55,
          }}>
            {tip.body}
          </div>
          {/* Caret pointing up */}
          <div style={{
            position: "absolute",
            top: -5,
            left: 4,
            transform: "rotate(45deg)",
            width: 8, height: 8,
            background: "rgba(10, 10, 14, 0.96)",
            borderLeft: `1px solid ${accentColor}44`,
            borderTop: `1px solid ${accentColor}44`,
          }} />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Suggestion Card
// ─────────────────────────────────────────────

const SuggestionCard: React.FC<{
  s: Suggestion; i: number; on: boolean; toggle: () => void;
}> = ({ s, i, on, toggle }) => {
  const [why, setWhy] = useState(false);
  const accent = P.suggest.main;

  return (
    <div
      onClick={toggle}
      style={{
        background: on ? P.suggest.dim : P.bg2,
        border: `1px solid ${on ? accent + "55" : P.border0}`,
        borderRadius: 8, padding: "12px 14px", marginBottom: 8,
        cursor: "pointer", transition: "all 0.12s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 5, background: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, color: "#fff", fontWeight: 700, flexShrink: 0,
        }}>
          {i + 1}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Option {i + 1}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setWhy(!why); }}
          style={{
            marginLeft: "auto", padding: "2px 6px", background: "transparent",
            border: `1px solid ${P.border1}`, borderRadius: 3,
            color: P.text2, fontSize: 10, cursor: "pointer",
          }}
        >
          why
        </button>
        <div
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          style={{
            width: 30, height: 16, borderRadius: 8,
            background: on ? accent : P.bg3, position: "relative",
            cursor: "pointer", transition: "background 0.15s", flexShrink: 0,
          }}
        >
          <div style={{
            position: "absolute", top: 2, left: on ? 16 : 2,
            width: 12, height: 12, borderRadius: 6, background: "#fff",
            transition: "left 0.15s",
          }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: P.text1, lineHeight: 1.45, fontFamily: "inherit" }}>
        {s.text}
      </div>
      {why && s.rationale && (
        <div style={{
          marginTop: 6, padding: 8, background: P.suggest.dim,
          borderRadius: 5, fontSize: 12, color: P.text1, lineHeight: 1.5, fontStyle: "italic",
        }}>
          {s.rationale}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Inline Pending Panel
// Shared by suggest + revise when AI text has
// been inserted inline into the editor.
// Shows Accept / Retry (with expandable feedback) / Reject
// FIL-315: Added retry with feedback textarea
// ─────────────────────────────────────────────

const InlinePendingPanel: React.FC<{
  vis: boolean;
  accent: typeof P.suggest;
  label: string;
  onAccept: () => void;
  onRetry: (retryDirection?: string) => void;
  onReject: () => void;
}> = ({ vis, accent, label, onAccept, onRetry, onReject }) => {
  const [retryExpanded, setRetryExpanded] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState("");
  const retryRef = useRef<HTMLTextAreaElement>(null);
  const [ph] = useState(() => pick(RETRY_PLACEHOLDERS));

  useEffect(() => {
    if (retryExpanded && retryRef.current) {
      setTimeout(() => retryRef.current?.focus(), 100);
    }
  }, [retryExpanded]);

  const handleRetryClick = useCallback(() => {
    if (!retryExpanded) {
      setRetryExpanded(true);
      return;
    }
    onRetry(retryFeedback.trim() || undefined);
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [retryExpanded, retryFeedback, onRetry]);

  const handleAccept = useCallback(() => {
    onAccept();
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [onAccept]);

  const handleReject = useCallback(() => {
    onReject();
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [onReject]);

  return (
    <div style={{
      opacity: vis ? 1 : 0,
      transform: vis ? "none" : "translateY(4px)",
      transition: "opacity 0.18s ease, transform 0.18s ease",
      pointerEvents: vis ? "auto" : "none",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Status row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: P.green.main, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: P.green.light, flex: 1 }}>
            {label} applied inline
          </span>
        </div>

        <div style={{ fontSize: 10, color: P.text2, lineHeight: 1.4 }}>
          Review the changes in the editor. Accept to keep, or reject to restore the original.
        </div>

        {/* Accept button */}
        <button onClick={handleAccept} style={{
          width: "100%", padding: "9px 0", borderRadius: 6, border: "none",
          background: P.green.main, fontSize: 12, fontWeight: 600, color: "#fff",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }}>
          ✓ Accept <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>⌘↵</span>
        </button>

        {/* Retry feedback textarea (expandable) */}
        {retryExpanded && (
          <textarea
            ref={retryRef}
            value={retryFeedback}
            onChange={(e) => setRetryFeedback(e.target.value)}
            placeholder={ph}
            rows={2}
            style={{
              width: "100%", padding: "6px 8px", background: P.bg0,
              border: `1px solid ${accent.main}66`, borderRadius: 5,
              color: P.text0, fontSize: 10, fontFamily: "inherit", resize: "none",
              outline: "none", boxSizing: "border-box", lineHeight: 1.5,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleRetryClick();
              }
            }}
          />
        )}

        {/* Retry + Reject */}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={handleRetryClick} style={{
            flex: retryExpanded ? 2 : 1, padding: "7px 0", borderRadius: 5,
            border: `1px solid ${accent.main}55`, background: "transparent",
            fontSize: 10, fontWeight: 600, color: accent.light, cursor: "pointer",
          }}>
            {retryExpanded ? "Send retry" : "Retry ▾"}
          </button>
          <button onClick={handleReject} style={{
            flex: 1, padding: "7px 0", borderRadius: 5,
            border: "1px solid rgba(239,68,68,0.3)", background: "transparent",
            fontSize: 10, fontWeight: 600, color: "#f87171", cursor: "pointer",
          }}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Panel Body — Suggest / Revise
// Now handles 3 sub-states:
//   1. Input (direction textarea + generate button)
//   2. Loading
//   3. Results (suggestion cards OR auto-applied inline)
// The "pending" state is handled by InlinePendingPanel above.
// ─────────────────────────────────────────────

const PanelBody: React.FC<{
  mode: "suggest" | "revise";
  vis: boolean;
  inlineAIMode: InlineAIMode;
  isLoading: boolean;
  error: string | null;
  suggestions: Suggestion[] | null;
  onSuggest: (d?: string) => void;
  onApplySuggestion: (i: number) => void;
  revisionResult: string | null;
  onRevise: (d: string) => void;
  onRetry: (retryDirection?: string) => void;
  onAcceptPending: () => void;
  onRejectPending: () => void;
  onDismiss: () => void;
  hasSel: boolean;
  selText?: string;
}> = ({
  mode, vis, inlineAIMode, isLoading, error, suggestions, onSuggest, onApplySuggestion,
  revisionResult, onRevise, onRetry, onAcceptPending, onRejectPending, onDismiss, hasSel, selText,
}) => {
    const [dir, setDir] = useState("");
    const [sel, setSel] = useState<Set<number>>(new Set());
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [ph] = useState(() => pick(mode === "suggest" ? SUGGEST_PLACEHOLDERS : REVISE_PLACEHOLDERS));

    const accent = mode === "suggest" ? P.suggest : P.revise;

    // For suggest: results means we have suggestion cards to show
    // For revise: results means revision was auto-applied inline (pending state)
    const hasSuggestionCards = mode === "suggest" && !!suggestions;
    const isPending = inlineAIMode === "pending";

    useEffect(() => {
      if (vis && taRef.current && !hasSuggestionCards && !isPending && !isLoading) {
        setTimeout(() => taRef.current?.focus(), 300);
      }
    }, [vis, hasSuggestionCards, isPending, isLoading]);

    useEffect(() => { if (suggestions) setSel(new Set()); }, [suggestions]);

    const generate = useCallback(() => {
      if (mode === "suggest") onSuggest(dir.trim() || undefined);
      else { if (dir.trim()) onRevise(dir.trim()); }
    }, [mode, dir, onSuggest, onRevise]);

    const onKey = useCallback((e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
    }, [generate]);

    const reset = useCallback(() => { onDismiss(); setDir(""); setSel(new Set()); }, [onDismiss]);

    const applySelected = useCallback(() => {
      const s = Array.from(sel);
      if (s.length === 1) onApplySuggestion(s[0]);
    }, [sel, onApplySuggestion]);

    const needsSel = mode === "revise" && !hasSel;
    const canGenerate = mode === "suggest" || (mode === "revise" && dir.trim().length > 0);

    // ── If we're in pending state, show the inline pending panel ──
    if (isPending) {
      return (
        <InlinePendingPanel
          vis={vis}
          accent={accent}
          label={mode === "revise" ? "Revision" : "Suggestion"}
          onAccept={onAcceptPending}
          onRetry={onRetry}
          onReject={onRejectPending}
        />
      );
    }

    return (
      <div style={{
        opacity: vis ? 1 : 0,
        transform: vis ? "none" : "translateY(4px)",
        transition: "opacity 0.18s ease, transform 0.18s ease",
        pointerEvents: vis ? "auto" : "none",
      }}>
        {/* Input state — show when no results and not loading */}
        {!hasSuggestionCards && !isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 9, color: needsSel ? P.error : P.text2, display: "flex", alignItems: "center", gap: 4 }}>
              {needsSel ? "⚠ Select text to revise"
                : hasSel ? `✓ ${mode === "suggest" ? "Will suggest from selection" : "Ready to revise"}`
                  : "Will suggest from cursor position"}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.2, color: P.text1, marginBottom: 5 }}>
                {mode === "suggest" ? "Guidance" : "Direction"}
                {mode === "suggest" && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> — optional</span>}
              </div>
              <textarea ref={taRef} value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={onKey}
                placeholder={ph}
                style={{
                  width: "100%", padding: "7px 9px", background: P.bg0, border: `1px solid ${P.border1}`,
                  borderRadius: 6, color: P.text0, fontSize: 11, fontFamily: "inherit", resize: "vertical",
                  minHeight: 52, outline: "none", boxSizing: "border-box", lineHeight: 1.5, transition: "border-color 0.12s",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = accent.main; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = P.border1; }}
              />
              <div style={{ fontSize: 8, color: P.text3, marginTop: 3 }}>⌘↵ generate</div>
            </div>
            <button disabled={!canGenerate || needsSel} onClick={generate}
              style={{
                width: "100%", padding: "8px 0", borderRadius: 8, border: "none",
                background: mode === "suggest"
                  ? "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)"
                  : "linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)",
                fontSize: 11, fontWeight: 600, color: "#fff",
                cursor: canGenerate && !needsSel ? "pointer" : "not-allowed",
                opacity: canGenerate && !needsSel ? 1 : 0.4,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.2s ease",
              }}
            >
              <span style={{ display: "flex" }}>{icons.bolt({})}</span>
              Generate {mode === "suggest" ? "suggestions" : "revision"}
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 0", gap: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              border: `2.5px solid ${P.border1}`, borderTopColor: accent.main,
              animation: "railSpin 0.8s linear infinite",
            }} />
            <div style={{ fontSize: 12, color: P.text2 }}>
              {mode === "suggest" ? "Generating alternatives…" : "Generating revision…"}
            </div>
          </div>
        )}

        {/* Suggestion cards — user picks one to apply inline */}
        {mode === "suggest" && suggestions && !isLoading && (
          <div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {sel.size > 0 ? (
                <button onClick={applySelected} style={{
                  flex: 1, padding: "8px 0", borderRadius: 5, border: "none",
                  background: P.green.main, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>Apply selected</button>
              ) : (
                <>
                  <button onClick={() => onRetry()} style={{
                    flex: 1, padding: "8px 0", borderRadius: 5,
                    border: `1px solid ${accent.main}44`, background: "transparent",
                    color: accent.light, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>New set</button>
                  <button onClick={reset} style={{
                    flex: 1, padding: "8px 0", borderRadius: 5,
                    border: `1px solid ${P.border0}`, background: P.bg2,
                    color: P.text2, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>Dismiss</button>
                </>
              )}
            </div>
            {suggestions.map((s, i) => (
              <SuggestionCard key={i} s={s} i={i} on={sel.has(i)} toggle={() => {
                setSel(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
              }} />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div style={{
            padding: "8px 10px", background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.18)", borderRadius: 5,
            color: P.error, fontSize: 12, marginTop: 6,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>{error}</span>
            <button onClick={reset} style={{
              padding: "1px 5px", background: "transparent", border: "none",
              color: P.error, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Dismiss</button>
          </div>
        )}
      </div>
    );
  };

// ─────────────────────────────────────────────
// Generate Panel Body (FIL-286) — unchanged
// ─────────────────────────────────────────────

const GeneratePanel: React.FC<{
  vis: boolean;
  state: GenerateState;
  resultText: string | null;
  error: string | null;
  onGenerate: (scope: GenerationScope, direction?: string) => Promise<void>;
  onAccept: () => void;
  onRemove: () => void;
  onRetry: (retryDirection?: string) => Promise<void>;
  onDismiss: () => void;
  sceneId: string | null;
}> = ({ vis, state, resultText, error, onGenerate, onAccept, onRemove, onRetry, onDismiss, sceneId }) => {
  const [scope, setScope] = useState<GenerationScope>("lines");
  const [direction, setDirection] = useState("");
  const [retryExpanded, setRetryExpanded] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState("");
  const [loadingHint, setLoadingHint] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const retryRef = useRef<HTMLTextAreaElement>(null);
  const [ph] = useState(() => pick(GENERATE_PLACEHOLDERS));

  const accent = P.generate;

  useEffect(() => {
    if (vis && state === "idle" && taRef.current) {
      setTimeout(() => taRef.current?.focus(), 300);
    }
  }, [vis, state]);

  useEffect(() => {
    if (retryExpanded && retryRef.current) {
      setTimeout(() => retryRef.current?.focus(), 100);
    }
  }, [retryExpanded]);

  useEffect(() => {
    if (state !== "loading") { setLoadingHint(0); return; }
    const hints = scope === "scene" ? LOADING_HINTS_SCENE : LOADING_HINTS_LINES;
    const interval = setInterval(() => {
      setLoadingHint(prev => (prev + 1) % hints.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [state, scope]);

  const handleGenerate = useCallback(() => {
    onGenerate(scope, direction.trim() || undefined);
  }, [onGenerate, scope, direction]);

  const handleRetryClick = useCallback(() => {
    if (!retryExpanded) { setRetryExpanded(true); return; }
    onRetry(retryFeedback.trim() || undefined);
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [retryExpanded, retryFeedback, onRetry]);

  const handleAccept = useCallback(() => {
    onAccept();
    setDirection("");
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [onAccept]);

  const handleRemove = useCallback(() => {
    onRemove();
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [onRemove]);

  const handleDismiss = useCallback(() => {
    onDismiss();
    setDirection("");
    setScope("lines");
    setRetryExpanded(false);
    setRetryFeedback("");
  }, [onDismiss]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (state === "idle") handleGenerate();
      else if (state === "pending") handleAccept();
    }
  }, [state, handleGenerate, handleAccept]);

  const hints = scope === "scene" ? LOADING_HINTS_SCENE : LOADING_HINTS_LINES;

  return (
    <div style={{
      opacity: vis ? 1 : 0,
      transform: vis ? "none" : "translateY(4px)",
      transition: "opacity 0.18s ease, transform 0.18s ease",
      pointerEvents: vis ? "auto" : "none",
    }}>
      {state === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sceneId && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 6px", background: P.bg2, border: `1px solid ${P.border0}`,
              borderRadius: 3, fontSize: 9, color: P.text3, fontFamily: "'Courier New', monospace",
              alignSelf: "flex-start",
            }}>
              {sceneId.replace(/^scene_/, "").slice(0, 12)}
            </div>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            {(["lines", "scene"] as GenerationScope[]).map(s => {
              const active = scope === s;
              return (
                <button key={s} onClick={() => setScope(s)}
                  style={{
                    padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    border: `1px solid ${active ? accent.main + "66" : P.border1}`,
                    background: active ? accent.dim : "transparent",
                    color: active ? accent.light : P.text3,
                    cursor: "pointer", transition: "all 0.12s",
                  }}
                >{s}</button>
              );
            })}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: P.text2, marginBottom: 3 }}>
              Direction <span style={{ fontWeight: 400, color: P.text3 }}>— optional</span>
            </div>
            <textarea ref={taRef} value={direction} onChange={(e) => setDirection(e.target.value)} onKeyDown={onKey}
              placeholder={ph} rows={3}
              style={{
                width: "100%", padding: "7px 9px", background: P.bg0,
                border: `1px solid ${P.border1}`, borderRadius: 6,
                color: P.text0, fontSize: 11, fontFamily: "inherit", resize: "vertical",
                minHeight: 48, outline: "none", boxSizing: "border-box", lineHeight: 1.5,
                transition: "border-color 0.12s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = accent.main; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = P.border1; }}
            />
            <div style={{ fontSize: 8, color: P.text3, marginTop: 2 }}>⌘↵ generate</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={handleDismiss} style={{
              flex: 1, padding: "8px 0", borderRadius: 6,
              border: `1px solid ${P.border1}`, background: "transparent",
              fontSize: 11, fontWeight: 600, color: P.text2, cursor: "pointer",
            }}>Cancel</button>
            <button onClick={handleGenerate} style={{
              flex: 2, padding: "8px 0", borderRadius: 6, border: "none",
              background: accent.main, fontSize: 11, fontWeight: 600, color: "#fff",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>
              <span style={{ display: "flex" }}>{icons.bolt({})}</span>
              Generate
            </button>
          </div>
        </div>
      )}

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 0", gap: 10 }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            border: `2.5px solid ${P.border1}`, borderTopColor: accent.main,
            animation: "railSpin 0.8s linear infinite",
          }} />
          <div style={{ fontSize: 12, color: P.text2, textAlign: "center", transition: "opacity 0.3s" }}>
            {hints[loadingHint]}
          </div>
          <div style={{ fontSize: 9, color: P.text3, textAlign: "center" }}>
            {scope} · {scope === "scene" ? "~35s" : "~3s"}
          </div>
        </div>
      )}

      {state === "pending" && resultText && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent.main, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: accent.light, flex: 1 }}>Ready</span>
            <div style={{
              padding: "2px 6px", background: P.bg2, border: `1px solid ${P.border0}`,
              borderRadius: 3, fontSize: 9, color: P.text3, fontFamily: "'Courier New', monospace",
            }}>{scope}</div>
          </div>
          {direction && (
            <div style={{
              fontSize: 10, color: P.text3, fontStyle: "italic",
              borderLeft: `2px solid ${P.bg3}`, paddingLeft: 8, lineHeight: 1.5,
            }}>
              "{direction}"
            </div>
          )}
          <button onClick={handleAccept} onKeyDown={onKey} style={{
            width: "100%", padding: "9px 0", borderRadius: 6, border: "none",
            background: P.green.main, fontSize: 12, fontWeight: 600, color: "#fff",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}>
            ✓ Accept <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>⌘↵</span>
          </button>
          {retryExpanded && (
            <textarea ref={retryRef} value={retryFeedback}
              onChange={(e) => setRetryFeedback(e.target.value)}
              placeholder="More tension in the pause…"
              rows={2}
              style={{
                width: "100%", padding: "6px 8px", background: P.bg0,
                border: `1px solid ${accent.main}66`, borderRadius: 5,
                color: P.text0, fontSize: 10, fontFamily: "inherit", resize: "none",
                outline: "none", boxSizing: "border-box", lineHeight: 1.5,
              }}
            />
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={handleRetryClick} style={{
              flex: retryExpanded ? 2 : 1, padding: "7px 0", borderRadius: 5,
              border: `1px solid ${accent.main}55`, background: "transparent",
              fontSize: 10, fontWeight: 600, color: accent.light, cursor: "pointer",
            }}>
              {retryExpanded ? "Send retry" : "Retry ▾"}
            </button>
            <button onClick={handleRemove} style={{
              flex: 1, padding: "7px 0", borderRadius: 5,
              border: "1px solid rgba(239,68,68,0.3)", background: "transparent",
              fontSize: 10, fontWeight: 600, color: "#f87171", cursor: "pointer",
            }}>Remove</button>
          </div>
        </div>
      )}

      {state === "idle" && error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            padding: "8px 10px", background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.18)", borderRadius: 5,
            color: P.error, fontSize: 11, lineHeight: 1.5,
          }}>
            {error}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

const InlineAIRail: React.FC<InlineAIRailProps> = ({
  activePanel, onToggleSuggest, onToggleRevise, onToggleGenerate,
  onToggleCharacters, onImportExport, hasSelection = false,
  inlineAIMode, isLoading, error, suggestions, onSuggest, onApplySuggestion,
  revisionResult, onRevise, onRetry, onAcceptPending, onRejectPending, onDismiss, selectedText,
  generateState, generateResultText, generateError,
  onGenerate, onGenerateAccept, onGenerateRemove, onGenerateRetry, onGenerateDismiss,
  currentSceneId,
}) => {
  // Apenas expande para suggest, revise e generate - não para characters
  const expanded = activePanel === "suggest" || activePanel === "revise" || activePanel === "generate";
  const [vis, setVis] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(true);

  useEffect(() => {
    if (expanded) { const t = setTimeout(() => setVis(true), 160); return () => clearTimeout(t); }
    else setVis(false);
  }, [expanded]);

  const close = useCallback(() => {
    setVis(false);
    setTimeout(() => {
      if (activePanel === "suggest") onToggleSuggest();
      else if (activePanel === "revise") onToggleRevise();
      else if (activePanel === "generate") onToggleGenerate();
      onDismiss();
      onGenerateDismiss();
    }, 100);
  }, [activePanel, onToggleSuggest, onToggleRevise, onToggleGenerate, onDismiss, onGenerateDismiss]);

  const handleWrenchToggle = useCallback(() => {
    setToolsVisible(v => {
      if (v && activePanel) {
        if (activePanel === "suggest") onToggleSuggest();
        else if (activePanel === "revise") onToggleRevise();
        else if (activePanel === "generate") onToggleGenerate();
        onDismiss();
        onGenerateDismiss();
      }
      return !v;
    });
  }, [activePanel, onToggleSuggest, onToggleRevise, onToggleGenerate, onToggleCharacters, onDismiss, onGenerateDismiss]);

  const accentMap = {
    suggest: P.suggest,
    revise: P.revise,
    generate: P.generate,
    characters: { main: P.orange.main, light: P.orange.light, dim: "rgba(255,107,53,0.15)", glow: "rgba(255,107,53,0.35)" },
  };
  const accent = activePanel ? accentMap[activePanel] : P.suggest;

  const clickMap: Record<string, () => void> = {
    suggest: onToggleSuggest, revise: onToggleRevise, generate: onToggleGenerate,
    characters: onToggleCharacters, importexport: onImportExport,
  };

  return (
    <div style={{
      width: expanded ? EXPANDED_W : RAIL_W,
      flexShrink: 0, display: "flex", flexDirection: "column",
      transition: "width 0.2s cubic-bezier(0.22, 0.61, 0.36, 1)",
      overflowX: "visible",
      overflowY: "hidden",
    }}>
      <style>{`
        @keyframes railSpin { to { transform: rotate(360deg); } }
        @keyframes railFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .ai-rail-body { scrollbar-width: none; -ms-overflow-style: none; }
        .ai-rail-body::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{
        height: TOOLBAR_H, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <button onClick={handleWrenchToggle}
          style={{
            width: 28, height: 28, borderRadius: 6, padding: 0,
            background: "transparent", border: `1px solid ${P.border1}`,
            color: toolsVisible ? P.text1 : P.text3, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = P.border2; e.currentTarget.style.color = P.text0; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.border1; e.currentTarget.style.color = toolsVisible ? P.text1 : P.text3; }}
          title={toolsVisible ? "Hide tools" : "Show tools"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={{ transform: toolsVisible ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s ease" }}
          >
            <path d="M2 4L6 8L10 4" />
          </svg>
        </button>
      </div>

      <div className="ai-rail-body" style={{
        flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
        overflowY: "auto", overflowX: "visible",
      }}>
        {toolsVisible && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: expanded ? "stretch" : "center",
            gap: expanded ? 0 : 5, padding: "8px 6px",
            borderLeft: `1px solid ${P.border2}`,
            animation: "railFadeIn 0.2s ease",
          }}>
            {BTNS.map((btn) => {
              if (btn.id.startsWith("divider")) {
                return (
                  <div key={btn.id} style={{
                    width: 18, height: 1, background: P.border0,
                    margin: expanded ? "3px 0 3px 13px" : "1px 0",
                    alignSelf: expanded ? "flex-start" : "center",
                    opacity: expanded ? 0.3 : 1, transition: "opacity 0.15s",
                  }} />
                );
              }

              const isActive = btn.id === activePanel;
              const isSwappable = btn.id === "suggest" || btn.id === "revise" || btn.id === "generate";
              const isDimmed = expanded && !isActive && !isSwappable;
              const isSubdued = expanded && !isActive && isSwappable;

              return (
                <React.Fragment key={btn.id}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: expanded ? "3px 0 3px 7px" : "0",
                    justifyContent: expanded ? "flex-start" : "center",
                  }}>
                    <RailBtn def={btn} isOn={isActive} dimmed={isDimmed} subdued={isSubdued}
                      onClick={clickMap[btn.id] || (() => { })}
                      showTip={!isActive || !expanded}
                    />
                    {isActive && expanded && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: accent.light,
                        letterSpacing: 0.3, opacity: vis ? 1 : 0, transition: "opacity 0.12s ease", flex: 1,
                        display: "flex", alignItems: "center", gap: 5,
                      }}>
                        {btn.label}
                        <PanelInfoTip panelId={btn.id} accentColor={accent.main} />
                      </span>
                    )}
                    {isActive && expanded && (
                      <button onClick={close}
                        style={{
                          width: 18, height: 18, borderRadius: 3,
                          background: "transparent", border: `1px solid ${P.border0}`,
                          color: P.text2, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, flexShrink: 0, marginRight: 7, transition: "all 0.1s", opacity: vis ? 1 : 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = P.border2; e.currentTarget.style.color = P.text1; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.border0; e.currentTarget.style.color = P.text2; }}
                      >×</button>
                    )}
                  </div>

                  {isActive && expanded && (
                    <div style={{
                      margin: "4px 6px 8px 6px", padding: 14,
                      background: P.bg1,
                      border: `1px solid ${accent.main}25`,
                      borderTop: `2px solid ${accent.main}`,
                      borderRadius: "0 0 8px 8px",
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 13,
                      opacity: vis ? 1 : 0,
                      transform: vis ? "translateY(0)" : "translateY(4px)",
                      transition: "opacity 0.15s ease, transform 0.15s ease",
                    }}>
                      {(activePanel === "suggest" || activePanel === "revise") && (
                        <PanelBody
                          mode={activePanel}
                          vis={vis}
                          inlineAIMode={inlineAIMode}
                          isLoading={isLoading}
                          error={error}
                          suggestions={suggestions}
                          onSuggest={onSuggest}
                          onApplySuggestion={onApplySuggestion}
                          revisionResult={revisionResult}
                          onRevise={onRevise}
                          onRetry={onRetry}
                          onAcceptPending={onAcceptPending}
                          onRejectPending={onRejectPending}
                          onDismiss={onDismiss}
                          hasSel={hasSelection}
                          selText={selectedText}
                        />
                      )}

                      {activePanel === "generate" && (
                        <GeneratePanel
                          vis={vis}
                          state={generateState}
                          resultText={generateResultText}
                          error={generateError}
                          onGenerate={onGenerate}
                          onAccept={onGenerateAccept}
                          onRemove={onGenerateRemove}
                          onRetry={onGenerateRetry}
                          onDismiss={onGenerateDismiss}
                          sceneId={currentSceneId}
                        />
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      {activePanel === "characters" && (
        <CharacterPanel
          isOpen={true}
          onClose={onToggleCharacters}
        />
      )}
    </div>
  );
};

export default InlineAIRail;