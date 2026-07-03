/**
 * GenerationLoadingOverlay.tsx
 * ============================
 * Compact loading card for screenplay generation.
 * Single-file, all inline styles, no CSS import needed.
 *
 * DESIGN: Instead of a full-screen dark veil, renders a compact card
 * centered over the editor. The card has a frosted glass background
 * with backdrop blur that softens the text behind it. The surrounding
 * grid/vignette background stays fully visible.
 *
 * Waves float inside the card with feathered edges. Status text and
 * progress bar sit below.
 *
 * STAGES: Auto-advances through 3 visual stages on a timer:
 *   0-8s:  Reading    (30% bar)
 *   8-16s: Structuring (62% bar)
 *   16s+:  Writing    (92% bar)
 *
 * PERFORMANCE: 24fps, Path2D, offscreen blur canvas, tab-pause.
 * FONT: adobe-thai (Typekit, already embedded).
 *
 * FIL-315
 */

import React, { useRef, useEffect, useState, useCallback } from "react";

// ─── Stage messages ──────────────────────────────────────────────────────────

const STAGE_MESSAGES: Record<number, string[]> = {
  1: [
    "Taking it all in...",
    "Reading between the lines...",
    "Feeling out the tone...",
    "Finding the thread...",
  ],
  2: [
    "Shaping the structure...",
    "Planning the beats...",
    "Mapping the tension...",
    "Thinking it through...",
  ],
  3: [
    "Putting pen to paper...",
    "Drafting the scene...",
    "Writing the words...",
    "Almost there...",
  ],
};

const STAGE_LABELS: Record<number, string> = {
  1: "Reading",
  2: "Structuring",
  3: "Writing",
};

// ─── Wave config ─────────────────────────────────────────────────────────────

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

const STYLE_ID = "glo-keyframes";

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes gloFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes gloMsgIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes gloBarShimmer {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───────────────────────────────────────────────────────────────

interface GenerationLoadingOverlayProps {
  isVisible: boolean;
  handoffStage: number;
}

export default function GenerationLoadingOverlay({
  isVisible,
  handoffStage,
}: GenerationLoadingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);
  const lastFrameRef = useRef(0);
  const [message, setMessage] = useState(STAGE_MESSAGES[1][0]);
  const messageIndexRef = useRef(0);
  const [visualStage, setVisualStage] = useState(1);

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

  // Auto-advance visual stages
  useEffect(() => {
    if (!isVisible) { setVisualStage(1); return; }
    setVisualStage(1);
    const t1 = setTimeout(() => setVisualStage(2), 8000);
    const t2 = setTimeout(() => setVisualStage(3), 16000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isVisible]);

  // Cycle messages
  useEffect(() => {
    if (!isVisible) return;
    messageIndexRef.current = 0;
    setMessage(STAGE_MESSAGES[visualStage]?.[0] || "Working...");
    const interval = setInterval(() => {
      const msgs = STAGE_MESSAGES[visualStage] || STAGE_MESSAGES[1];
      messageIndexRef.current = (messageIndexRef.current + 1) % msgs.length;
      setMessage(msgs[messageIndexRef.current]);
    }, 3200);
    return () => clearInterval(interval);
  }, [isVisible, visualStage]);

  // Render loop
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

  const progressWidth = visualStage === 1 ? "30%" : visualStage === 2 ? "62%" : "92%";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Offset to center over the editor area (right of sidebar)
        // rather than the full viewport
        paddingLeft: 200,
        // Blur everything beneath
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "all",
        animation: "gloFadeIn 0.5s ease forwards",
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
            animation: "gloMsgIn 0.6s ease forwards",
          }}
        >
          {message}
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
          {STAGE_LABELS[visualStage] || "Working"}
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
              width: progressWidth,
              borderRadius: 1,
              background: "linear-gradient(90deg, #5AAFA5, #E8B84B, #ff8c42, #5AAFA5)",
              backgroundSize: "200% 100%",
              animation: "gloBarShimmer 4s linear infinite",
              transition: "width 2s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            }}
          />
        </div>
      </div>
    </div>
  );
}