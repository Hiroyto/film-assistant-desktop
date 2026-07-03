/**
 * OutlineGenerationOverlay.tsx
 * ============================
 * Loading overlay for the outline finish-outline flow.
 *
 * Sibling to components/GenerationLoadingOverlay.tsx (Scripts). Borrows the
 * same visual DNA — watercolor waves, frosted card, shimmer progress bar —
 * but has a different progress model suited to outline generation.
 *
 * KEY DIFFERENCE from the Scripts version:
 *   The Scripts overlay has 3 hardcoded stages on a 24-second timer
 *   (Reading → Structuring → Writing). That's fine for Scripts' single
 *   scene-generation pass, but lies to the user during outline
 *   finish-outline runs that are either much shorter (2 empty segments,
 *   ~10s total) or have a totally different shape (metadata + summary
 *   only, no segments at all).
 *
 *   This overlay is ESTIMATE-DRIVEN: it receives an OutlineEstimate
 *   describing which phases will run and rough duration estimates. Stage
 *   labels show only the phases that are actually running, and during the
 *   segments phase specifically, the label counts through segments
 *   (e.g., "Writing scene 3 of 6...").
 *
 * USAGE:
 *   Two call sites currently:
 *     1. handleStorySubmit — estimate derived from useOutlinePlan(data)
 *        which reflects which fields are empty (backend-matching).
 *     2. handleProcessBrainstorm — estimate hand-built inline based on
 *        mode (preview/full). The brainstorm-to-synopsis backend is an
 *        UNCONDITIONAL overwrite, so a plan derived from field emptiness
 *        would mislabel phases and under-run the progress bar.
 *
 * MESSAGE COPY (FIL-332 follow-up):
 *   Rotating status messages use OUTLINE-LEVEL vocabulary — chart, place,
 *   map, frame, shape, lay out. These are planning verbs. Execution verbs
 *   (drafting, writing, drawing) belong to the Scripts scene editor, not
 *   to outline beat generation. An outline segment is a two-sentence beat
 *   summary, not a drafted scene.
 *
 * WAVE RENDERING:
 *   The wave canvas code is duplicated from GenerationLoadingOverlay.
 *   Deliberate — Ben asked for a sibling component, not a refactor. If a
 *   third overlay ever needs these waves, extract a shared WatercolorWaves
 *   component then. Until then, the ~150 lines of canvas code live in
 *   both files and that's acceptable.
 *
 * PERFORMANCE: 24fps, Path2D, offscreen blur canvas, tab-pause.
 * FONT: adobe-thai (Typekit, already embedded).
 *
 * FIL-332 (orchestrator model default) + FIL-330 (per-phase progress).
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { OutlinePlan, OutlineEstimate } from "./useOutlinePlan";

// ─── Stage messages ──────────────────────────────────────────────────────────
//
// Outline-specific copy — planning verbs, not execution verbs. The scene
// editor gets "drafting" and "writing"; the outline gets "charting,"
// "placing," "framing," "mapping." Keeps the mental model clear for users
// who are using both tools.

const METADATA_MESSAGES = [
  "Sketching the world...",
  "Finding the tone...",
  "Naming the genre...",
  "Setting the stakes...",
];

const SUMMARY_MESSAGES = [
  "Finding the hook...",
  "Shaping the premise...",
  "Framing the story...",
  "Laying out the arc...",
];

const SEGMENT_MESSAGES = [
  "Charting the beat...",
  "Placing the turn...",
  "Building the rise...",
  "Mapping the shift...",
];

// ─── Wave config (duplicated from GenerationLoadingOverlay by design) ────────

interface WaveConfig {
  y: number;
  amp: number;
  freq: number;
  speed: number;
  color: [number, number, number];
  blurRadius: number;
  blurThick: number;
  sharpThick: number;
  centerThick: number;
  phase: number;
  opacity: number;
}

const WAVES: WaveConfig[] = [
  { y: 0.80, amp: 7,  freq: 0.014, speed: 0.004, color: [232, 132, 90],  blurRadius: 5, blurThick: 10, sharpThick: 1.0, centerThick: 2.5, phase: 0,   opacity: 0.65 },
  { y: 0.65, amp: 8,  freq: 0.012, speed: 0.003, color: [232, 184, 75],  blurRadius: 6, blurThick: 11, sharpThick: 1.0, centerThick: 2.8, phase: 1.2, opacity: 0.6 },
  { y: 0.50, amp: 9,  freq: 0.011, speed: 0.003, color: [90, 175, 165],  blurRadius: 8, blurThick: 16, sharpThick: 1.8, centerThick: 4.5, phase: 2.5, opacity: 0.7 },
  { y: 0.37, amp: 7,  freq: 0.013, speed: 0.004, color: [232, 184, 75],  blurRadius: 5, blurThick: 9,  sharpThick: 0.9, centerThick: 2.2, phase: 3.8, opacity: 0.5 },
  { y: 0.25, amp: 6,  freq: 0.014, speed: 0.005, color: [255, 140, 66],  blurRadius: 4, blurThick: 8,  sharpThick: 0.7, centerThick: 1.8, phase: 5.0, opacity: 0.45 },
  { y: 0.15, amp: 4,  freq: 0.015, speed: 0.005, color: [200, 194, 184], blurRadius: 3, blurThick: 6,  sharpThick: 0.5, centerThick: 1.2, phase: 6.2, opacity: 0.25 },
];

const CANVAS_W = 560;
const CANVAS_H = 200;
const FPS = 24;
const FRAME_INTERVAL = 1000 / FPS;

// ─── Shared edge gradient ────────────────────────────────────────────────────

let edgeGradCache: CanvasGradient | null = null;

function getEdgeGrad(ctx: CanvasRenderingContext2D): CanvasGradient {
  if (edgeGradCache) return edgeGradCache;
  const g = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.10, "rgba(255,255,255,1)");
  g.addColorStop(0.90, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  edgeGradCache = g;
  return g;
}

// ─── Wave math ───────────────────────────────────────────────────────────────

function getWaveY(wave: WaveConfig, x: number, t: number): number {
  const baseY = wave.y * CANVAS_H;
  return (
    baseY +
    Math.sin(x * wave.freq + t * wave.speed * 60 + wave.phase) * wave.amp +
    Math.sin(x * wave.freq * 1.8 + t * wave.speed * 40 + wave.phase + 1.5) * wave.amp * 0.4 +
    Math.sin(x * wave.freq * 0.5 + t * wave.speed * 20 + wave.phase + 3.0) * wave.amp * 0.6
  );
}

function buildWavePath(wave: WaveConfig, t: number): Path2D {
  const path = new Path2D();
  path.moveTo(0, getWaveY(wave, 0, t));
  for (let x = 3; x <= CANVAS_W; x += 3) {
    path.lineTo(x, getWaveY(wave, x, t));
  }
  return path;
}

function applyEdgeFade(c: CanvasRenderingContext2D, grad: CanvasGradient) {
  c.save();
  c.globalCompositeOperation = "destination-in";
  c.fillStyle = grad;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  c.restore();
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  offCtx: CanvasRenderingContext2D,
  maskCtx: CanvasRenderingContext2D,
  wave: WaveConfig,
  t: number,
  edgeGrad: CanvasGradient
) {
  const [r, g, b] = wave.color;
  const path = buildWavePath(wave, t);

  // Pass 1: Blurred wash with edge fade
  offCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  offCtx.save();
  offCtx.filter = `blur(${wave.blurRadius}px)`;
  offCtx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
  offCtx.lineWidth = wave.blurThick;
  offCtx.lineCap = "round";
  offCtx.lineJoin = "round";
  offCtx.stroke(path);
  offCtx.restore();
  applyEdgeFade(offCtx, edgeGrad);

  ctx.save();
  ctx.globalAlpha = wave.opacity;
  ctx.drawImage(offCtx.canvas, 0, 0);
  ctx.restore();

  // Pass 2: Sharp line with edge fade
  offCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  offCtx.save();
  offCtx.strokeStyle = `rgba(${r},${g},${b},${wave.opacity * 0.7})`;
  offCtx.lineWidth = wave.sharpThick;
  offCtx.lineCap = "round";
  offCtx.lineJoin = "round";
  offCtx.stroke(path);
  offCtx.restore();
  applyEdgeFade(offCtx, edgeGrad);

  ctx.drawImage(offCtx.canvas, 0, 0);

  // Pass 3: Center-thick overlay (radial + edge fade)
  maskCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  maskCtx.save();
  maskCtx.strokeStyle = `rgba(${r},${g},${b},${wave.opacity * 0.8})`;
  maskCtx.lineWidth = wave.centerThick;
  maskCtx.lineCap = "round";
  maskCtx.lineJoin = "round";
  maskCtx.stroke(path);
  maskCtx.globalCompositeOperation = "destination-in";
  const centerY = wave.y * CANVAS_H;
  const radGrad = maskCtx.createRadialGradient(
    CANVAS_W / 2, centerY, 0,
    CANVAS_W / 2, centerY, CANVAS_W * 0.42
  );
  radGrad.addColorStop(0, "rgba(255,255,255,1)");
  radGrad.addColorStop(0.6, "rgba(255,255,255,0.5)");
  radGrad.addColorStop(1, "rgba(255,255,255,0)");
  maskCtx.fillStyle = radGrad;
  maskCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  maskCtx.restore();

  ctx.drawImage(maskCtx.canvas, 0, 0);
}

// ─── Keyframes ───────────────────────────────────────────────────────────────

const STYLE_ID = "ogo-keyframes";

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes ogoFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes ogoMsgIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes ogoBarShimmer {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Phase tracking ──────────────────────────────────────────────────────────

type PhaseId = 'metadata' | 'summary' | 'segments';

interface ActivePhase {
  id: PhaseId;
  /** 0-based index among phases that will run */
  phaseIndex: number;
  /** For segments phase — which segment is "currently" being written (1-based, for display) */
  segmentCurrent?: number;
  /** For segments phase — total segments to generate */
  segmentTotal?: number;
}

const PHASE_LABELS: Record<PhaseId, string> = {
  metadata: 'Foundation',
  summary: 'Summary',
  segments: 'Segments',
};

const PHASE_MESSAGES: Record<PhaseId, string[]> = {
  metadata: METADATA_MESSAGES,
  summary: SUMMARY_MESSAGES,
  segments: SEGMENT_MESSAGES,
};

// ─── Component ───────────────────────────────────────────────────────────────

interface OutlineGenerationOverlayProps {
  isVisible: boolean;
  /**
   * Estimate describing which phases will run and rough per-phase duration.
   * Drives the stage label, message cycling, and progress bar pacing.
   *
   * Capture at dispatch time (either via useOutlinePlan(data).estimated for
   * the finish-outline flow, or as a hand-built literal for brainstorm
   * flows where the backend is an unconditional overwrite).
   */
  estimated: OutlineEstimate;
  /**
   * Optional plan metadata. Currently unused inside the component, but
   * callers may still pass it from useOutlinePlan() for logging or future
   * progress integrations. Kept optional so brainstorm dispatch sites
   * don't need to fabricate a plan object.
   */
  plan?: OutlinePlan;
}

export default function OutlineGenerationOverlay({
  isVisible,
  estimated,
}: OutlineGenerationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);
  const lastFrameRef = useRef(0);

  const [activePhase, setActivePhase] = useState<ActivePhase | null>(null);
  const [message, setMessage] = useState<string>('');
  const [progressPct, setProgressPct] = useState(0);
  const messageIndexRef = useRef(0);

  useEffect(() => { ensureKeyframes(); }, []);

  // Create offscreen canvases
  useEffect(() => {
    if (!offCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = CANVAS_W; c.height = CANVAS_H;
      offCanvasRef.current = c;
    }
    if (!maskCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = CANVAS_W; c.height = CANVAS_H;
      maskCanvasRef.current = c;
    }
  }, []);

  // ─── Phase scheduling ──────────────────────────────────────────────────────
  //
  // We know the plan up front (which phases run, how long each is estimated
  // to take). We schedule timeouts to advance through the phases in order.
  // Within the segments phase, we additionally advance through segment count
  // labels (1 of 6, 2 of 6, etc.) based on per-segment duration.
  //
  // Cleanup clears all scheduled timeouts — important because the overlay
  // can be dismissed mid-generation (e.g., error) and leftover timeouts
  // would update state on an unmounted component.
  useEffect(() => {
    if (!isVisible || estimated.phases.length === 0) {
      setActivePhase(null);
      setProgressPct(0);
      return;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let elapsedMs = 0;

    // Initialize first phase immediately
    const first = estimated.phases[0];
    setActivePhase({
      id: first.id,
      phaseIndex: 0,
      ...(first.id === 'segments' && first.segmentCount
        ? { segmentCurrent: 1, segmentTotal: first.segmentCount }
        : {}),
    });

    // Schedule segment sub-steps for the segments phase
    estimated.phases.forEach((phase, phaseIdx) => {
      const phaseStartMs = elapsedMs;

      if (phase.id === 'segments' && phase.segmentCount) {
        const perSegmentMs = phase.ms / phase.segmentCount;
        for (let i = 1; i < phase.segmentCount; i++) {
          const tickAt = phaseStartMs + i * perSegmentMs;
          timeouts.push(
            setTimeout(() => {
              setActivePhase({
                id: 'segments',
                phaseIndex: phaseIdx,
                segmentCurrent: i + 1,
                segmentTotal: phase.segmentCount,
              });
            }, tickAt)
          );
        }
      }

      // Schedule transition to the next phase (if any)
      if (phaseIdx < estimated.phases.length - 1) {
        const nextPhase = estimated.phases[phaseIdx + 1];
        const transitionAt = phaseStartMs + phase.ms;
        timeouts.push(
          setTimeout(() => {
            setActivePhase({
              id: nextPhase.id,
              phaseIndex: phaseIdx + 1,
              ...(nextPhase.id === 'segments' && nextPhase.segmentCount
                ? { segmentCurrent: 1, segmentTotal: nextPhase.segmentCount }
                : {}),
            });
          }, transitionAt)
        );
      }

      elapsedMs += phase.ms;
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [isVisible, estimated]);

  // ─── Progress bar animation ────────────────────────────────────────────────
  //
  // Smooth interpolation over totalMs, driven by a 100ms tick. We cap at 95%
  // rather than 100% because the estimate is rough — if actual generation
  // takes longer than estimated, we don't want the bar to sit at 100% for
  // several seconds before the real response arrives. 95% reads as "almost
  // done" which is honest even when we've slightly under-estimated.
  //
  // When isVisible drops to false (generation complete), the overlay
  // unmounts — no need to animate to 100% explicitly.
  useEffect(() => {
    if (!isVisible || estimated.totalMs === 0) {
      setProgressPct(0);
      return;
    }

    const startTime = Date.now();
    const TICK_MS = 100;
    const CAP = 95;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(CAP, (elapsed / estimated.totalMs) * 100);
      setProgressPct(pct);
      if (pct >= CAP) clearInterval(interval);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isVisible, estimated.totalMs]);

  // ─── Message cycling ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !activePhase) {
      setMessage('');
      return;
    }

    const msgs = PHASE_MESSAGES[activePhase.id];
    messageIndexRef.current = 0;
    setMessage(msgs[0]);

    const interval = setInterval(() => {
      messageIndexRef.current = (messageIndexRef.current + 1) % msgs.length;
      setMessage(msgs[messageIndexRef.current]);
    }, 3200);

    return () => clearInterval(interval);
  }, [isVisible, activePhase?.id]);

  // ─── Canvas render loop ────────────────────────────────────────────────────
  const render = useCallback((timestamp: number) => {
    rafRef.current = requestAnimationFrame(render);
    if (timestamp - lastFrameRef.current < FRAME_INTERVAL) return;
    lastFrameRef.current = timestamp;

    const canvas = canvasRef.current;
    const off = offCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!canvas || !off || !mask) return;
    const ctx = canvas.getContext("2d");
    const offCtx = off.getContext("2d");
    const maskCtx = mask.getContext("2d");
    if (!ctx || !offCtx || !maskCtx) return;

    const edgeGrad = getEdgeGrad(offCtx);
    tRef.current += 1;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = WAVES.length - 1; i >= 0; i--) {
      drawWave(ctx, offCtx, maskCtx, WAVES[i], tRef.current, edgeGrad);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    edgeGradCache = null;
    rafRef.current = requestAnimationFrame(render);
    const handleVis = () => {
      if (document.visibilityState === "hidden") cancelAnimationFrame(rafRef.current);
      else { lastFrameRef.current = 0; rafRef.current = requestAnimationFrame(render); }
    };
    document.addEventListener("visibilitychange", handleVis);
    return () => { cancelAnimationFrame(rafRef.current); document.removeEventListener("visibilitychange", handleVis); };
  }, [isVisible, render]);

  if (!isVisible) return null;

  // ─── Stage label text ──────────────────────────────────────────────────────
  //
  // Segments phase shows count progress; metadata and summary show just the
  // phase name. Kept terse — the rotating message below carries the
  // personality, the stage label is the signpost.
  const stageLabel = (() => {
    if (!activePhase) return 'Preparing';
    if (activePhase.id === 'segments' && activePhase.segmentTotal) {
      return `Segments  ${activePhase.segmentCurrent} of ${activePhase.segmentTotal}`;
    }
    return PHASE_LABELS[activePhase.id];
  })();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Blur everything beneath
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "all",
        animation: "ogoFadeIn 0.5s ease forwards",
      }}
    >
      {/* Card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "36px 48px 32px",
          borderRadius: 16,
          background: "rgba(14, 14, 17, 0.92)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.05) inset",
        }}
      >
        {/* Waves */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            width: "min(70%, 340px)",
            height: "auto",
            marginBottom: 24,
          }}
        />

        {/* Status message */}
        <div
          key={message}
          style={{
            fontFamily: "'adobe-thai', serif",
            fontSize: 16,
            fontWeight: 300,
            fontStyle: "italic",
            color: "rgba(190, 185, 175, 0.85)",
            textAlign: "center",
            minHeight: 24,
            letterSpacing: 0.3,
            animation: "ogoMsgIn 0.6s ease forwards",
          }}
        >
          {message || 'Getting started...'}
        </div>

        {/* Stage label */}
        <div
          style={{
            fontFamily: "'adobe-thai', sans-serif",
            fontSize: 9,
            letterSpacing: 3,
            textTransform: "uppercase" as const,
            color: "rgba(140, 135, 125, 0.6)",
            marginTop: 12,
          }}
        >
          {stageLabel}
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: "min(60%, 160px)",
            height: 2,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 1,
            marginTop: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              borderRadius: 1,
              background: "linear-gradient(90deg, #5AAFA5, #E8B84B, #ff8c42, #5AAFA5)",
              backgroundSize: "200% 100%",
              animation: "ogoBarShimmer 4s linear infinite",
              transition: "width 120ms linear",
            }}
          />
        </div>
      </div>
    </div>
  );
}