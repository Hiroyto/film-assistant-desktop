/**
 * InlineAILoadingOverlay.tsx
 * ==========================
 * Shimmer skeleton overlay for inline AI loading states (revise / suggest).
 *
 * Reads the actual bounding rectangles of each decorated text line in the
 * editor and renders opaque skeleton bars that completely cover the text
 * underneath, with a shiny glimmer animation sweeping across.
 *
 * The bars are solid dark fills (matching the editor background) so the
 * original text is fully hidden — replaced by the skeleton + shimmer
 * until the AI response arrives.
 *
 * Two color schemes:
 *   - revise:  cyan/teal (#06b6d4)
 *   - suggest: purple    (#8b5cf6)
 *
 * FIL-315 Item 1 — inline operations loading UX
 */

import React, { useEffect, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InlineAILoadingOverlayProps {
  isVisible: boolean;
  mode: "revise" | "suggest";
  editorElement: HTMLElement | null;
}

// ─── Color palettes ──────────────────────────────────────────────────────────

const PALETTES = {
  revise: {
    barFill: "rgba(6, 182, 212, 0.12)",
    barBorder: "rgba(6, 182, 212, 0.25)",
    // Glimmer: transparent → bright accent → transparent
    glimmerA: "rgba(6, 182, 212, 0.0)",
    glimmerB: "rgba(6, 182, 212, 0.30)",
    glimmerC: "rgba(34, 211, 238, 0.15)",
    glimmerD: "rgba(6, 182, 212, 0.0)",
    statusDot: "#06b6d4",
    statusText: "#22d3ee",
  },
  suggest: {
    barFill: "rgba(139, 92, 246, 0.12)",
    barBorder: "rgba(139, 92, 246, 0.25)",
    glimmerA: "rgba(139, 92, 246, 0.0)",
    glimmerB: "rgba(139, 92, 246, 0.30)",
    glimmerC: "rgba(167, 139, 250, 0.15)",
    glimmerD: "rgba(139, 92, 246, 0.0)",
    statusDot: "#8b5cf6",
    statusText: "#a78bfa",
  },
};

// ─── Rect per visual line ────────────────────────────────────────────────────

interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Keyframes ───────────────────────────────────────────────────────────────

const STYLE_ID = "inline-ai-loading-keyframes";

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes inlineAIGlimmer {
      0%   { transform: translateX(-100%) skewX(-15deg); }
      100% { transform: translateX(250%) skewX(-15deg); }
    }
    @keyframes inlineAIBarIn {
      from { opacity: 0; transform: scaleX(0.7); }
      to   { opacity: 1; transform: scaleX(1); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Measure decorated text rects ────────────────────────────────────────────

function measureDecorationRects(container: HTMLElement): BarRect[] {
  const targets = container.querySelectorAll(
    '[data-ai-decoration="loading-target"]'
  );
  if (targets.length === 0) return [];

  const contentArea =
    (container.closest(".screenplay-content-area") as HTMLElement) || container;
  const parentRect = contentArea.getBoundingClientRect();

  const rects: BarRect[] = [];
  const seen = new Set<string>();

  targets.forEach((el) => {
    const clientRects = el.getClientRects();
    for (let i = 0; i < clientRects.length; i++) {
      const r = clientRects[i];
      if (r.width < 3 || r.height < 3) continue;

      const x = r.left - parentRect.left;
      const y = r.top - parentRect.top;
      const w = r.width;
      const h = r.height;

      const key = `${Math.round(y)},${Math.round(x)},${Math.round(w)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rects.push({ x, y, w, h });
    }
  });

  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  return rects;
}

// ─── Component ───────────────────────────────────────────────────────────────

const InlineAILoadingOverlay: React.FC<InlineAILoadingOverlayProps> = ({
  isVisible,
  mode,
  editorElement,
}) => {
  const [barRects, setBarRects] = useState<BarRect[]>([]);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const measure = useCallback(() => {
    if (!editorElement || !isVisible) {
      setBarRects([]);
      return;
    }
    setBarRects(measureDecorationRects(editorElement));
  }, [editorElement, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setBarRects([]);
      return;
    }

    const t = setTimeout(measure, 30);
    const interval = setInterval(measure, 250);

    const contentArea = editorElement?.closest(".screenplay-content-area");
    const scrollEl =
      contentArea?.querySelector(".paginated-canvas") || contentArea;
    if (scrollEl)
      scrollEl.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      if (scrollEl) scrollEl.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [isVisible, measure, editorElement]);

  if (!isVisible || barRects.length === 0) return null;

  const palette = PALETTES[mode];

  return (
    <>
      {barRects.map((rect, i) => (
        <div
          key={`bar-${i}-${Math.round(rect.y)}`}
          style={{
            position: "absolute",
            left: rect.x - 3,
            top: rect.y - 1,
            width: rect.w + 6,
            height: rect.h + 2,
            borderRadius: 4,
            // Opaque dark fill that covers the text
            background: `linear-gradient(135deg, #131316 0%, #161619 100%)`,
            border: `1px solid ${palette.barBorder}`,
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 80,
            // Entrance animation
            animation: `inlineAIBarIn 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${i * 0.04}s both`,
            transformOrigin: "left center",
          }}
        >
          {/* Tinted fill layer */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: palette.barFill,
            }}
          />

          {/* Glimmer sweep — bright accent band that slides across */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(
                90deg,
                ${palette.glimmerA} 0%,
                ${palette.glimmerB} 35%,
                ${palette.glimmerC} 50%,
                ${palette.glimmerB} 65%,
                ${palette.glimmerD} 100%
              )`,
              animation: `inlineAIGlimmer 2s ease-in-out ${0.6 + i * 0.12}s infinite`,
              willChange: "transform",
            }}
          />
        </div>
      ))}

      {/* Status label below the last bar */}
      {barRects.length > 0 && (() => {
        const last = barRects[barRects.length - 1];
        return (
          <div
            style={{
              position: "absolute",
              top: last.y + last.h + 8,
              left: last.x,
              display: "flex",
              alignItems: "center",
              gap: 5,
              pointerEvents: "none",
              zIndex: 80,
              animation: "inlineAIBarIn 0.3s ease 0.2s both",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.08)",
                borderTopColor: palette.statusDot,
                animation: "railSpin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: palette.statusText,
                fontFamily: "'adobe-thai', -apple-system, sans-serif",
                letterSpacing: 0.3,
                opacity: 0.8,
              }}
            >
              {mode === "revise"
                ? "Generating revision…"
                : "Generating suggestions…"}
            </span>
          </div>
        );
      })()}
    </>
  );
};

export default InlineAILoadingOverlay;