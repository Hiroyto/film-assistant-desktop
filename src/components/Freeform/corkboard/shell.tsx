// components/Freeform/corkboard/shell.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useRef, useState } from 'react';
import { hexToRgba } from '../../../components/Freeform/entityColors';
import { useThemeMode } from './theme';

const METER_ORANGE = '#ff6b35';

// One staged line in the braindump meter: done (check) / active (spinner) / pending.
function MeterStep({ done, active, label, hint }: { done: boolean; active: boolean; label: string; hint?: string }) {
  const color = done ? '#34d399' : active ? '#ff8c42' : 'rgba(255,255,255,0.4)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9, fontSize: 12.5, color: done ? 'rgba(255,255,255,0.82)' : color }}>
      <span style={{ width: 15, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
        {done ? (
          <span style={{ color: '#34d399', fontWeight: 800 }}>✓</span>
        ) : active ? (
          <span style={{ width: 11, height: 11, borderRadius: 999, border: '2px solid rgba(255,140,66,0.35)', borderTopColor: '#ff8c42', display: 'inline-block', animation: 'cb-spin 0.7s linear infinite' }} />
        ) : (
          <span style={{ width: 5, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.3)', display: 'inline-block' }} />
        )}
      </span>
      <span>{label}{hint && <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>{hint}</span>}</span>
    </div>
  );
}

export type WinPhase = 'reading' | 'structuring' | 'processing' | 'wiring';
const WIN_ORDER: Record<WinPhase, number> = { reading: 0, structuring: 1, processing: 2, wiring: 3 };
const fmtElapsed = (ms?: number) => {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Braindump status meter — the staged "pulled N cards → wiring connections"
// progress card shown while ANY braindump extracts (not just the wow). Draggable
// so the writer can move it out of the way; defaults to bottom-center.
//
// For a WINDOWED (large-screenplay) import it shows the real backend phases —
// reading → mapping structure → building cards (part N/M) → wiring the
// throughline — driven by phase pings when the socket delivers them and by the
// FE's elapsed/poll estimate when it does not (the socket dies on a long run).
export function BraindumpMeter({
  aliveCount, edgeCount, winPhase, winProg, elapsedMs, weaving,
}: {
  aliveCount: number; edgeCount: number;
  winPhase?: WinPhase | null;
  winProg?: { window?: number; total?: number };
  elapsedMs?: number;
  /** Tail-generation counts (extraction_progress): what the model is writing
   *  during the no-new-cards stretch. Keeps the wiring step honest instead of
   *  "a few seconds…" through a two-minute import. */
  weaving?: { information: number; relationships: number; knowledge_edges: number } | null;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const draggingRef = useRef(false);
  const onMouseDown = (e: React.MouseEvent) => {
    const start = { x: e.clientX, y: e.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const off = { dx: start.x - rect.left, dy: start.y - rect.top };
    draggingRef.current = false;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      draggingRef.current = true;
      const left = Math.max(8, Math.min(ev.clientX - off.dx, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(ev.clientY - off.dy, window.innerHeight - rect.height - 8));
      setPos({ left, top });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const placed: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { bottom: 28, left: '50%', transform: 'translateX(-50%)' };
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'fixed', zIndex: 9994, cursor: 'grab', userSelect: 'none',
        padding: '14px 20px', borderRadius: 14, minWidth: 280,
        background: 'rgba(20,21,26,0.94)', border: `1px solid ${METER_ORANGE}44`,
        boxShadow: `0 0 18px ${METER_ORANGE}22, 0 10px 30px rgba(0,0,0,0.45)`,
        color: '#fff', fontFamily: 'system-ui, sans-serif', ...placed,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 700 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: METER_ORANGE, boxShadow: `0 0 10px ${METER_ORANGE}`, animation: 'cb-blink 1s ease-in-out infinite' }} />
        Building your outline…
        {winPhase && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtElapsed(elapsedMs)}
          </span>
        )}
      </div>
      {winPhase ? (() => {
        const idx = WIN_ORDER[winPhase];
        const part = winProg?.window && (winProg.total ?? 0) > 1 ? `part ${winProg.window}/${winProg.total}` : undefined;
        return (
          <>
            <MeterStep done={idx > 0} active={idx === 0} label="Reading the script" />
            <MeterStep done={idx > 1} active={idx === 1} label="Mapping the structure: scenes & sequences" />
            <MeterStep
              done={idx > 2}
              active={idx === 2}
              label="Building your cards"
              hint={idx === 2 ? (part ?? 'a few minutes for a full script') : part}
            />
            <MeterStep
              done={false}
              active={idx === 3}
              label="Wiring the throughline & connections"
              hint={idx === 3 ? 'almost there…' : undefined}
            />
          </>
        );
      })() : (
        <>
          <MeterStep
            done={aliveCount > 0}
            active={aliveCount === 0}
            label={aliveCount > 0 ? `Pulled ${aliveCount} card${aliveCount === 1 ? '' : 's'} from your prose` : 'Reading your idea'}
          />
          {(() => {
            // With live tail counts, the wiring step stays ACTIVE and ticks the
            // real numbers (optimistic spine edges land early, so edgeCount>0
            // alone no longer means the wiring is done). Without counts (small
            // braindumps, lossy WS) the old shape holds.
            const w = weaving && (weaving.information + weaving.relationships + weaving.knowledge_edges) > 0 ? weaving : null;
            const wHint = w
              ? `${w.information} fact${w.information === 1 ? '' : 's'} · ${w.relationships} relationship${w.relationships === 1 ? '' : 's'} · ${w.knowledge_edges} knowledge tie${w.knowledge_edges === 1 ? '' : 's'} so far…`
              : undefined;
            return (
              <MeterStep
                done={edgeCount > 0 && !w}
                active={aliveCount > 0 && (edgeCount === 0 || !!w)}
                label="Wiring up connections, the throughline & metadata"
                hint={wHint ?? (aliveCount > 0 && edgeCount === 0 ? 'a few seconds…' : undefined)}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}

// Demo project tabs — adding/removing here drives the tab strip in Shell.
// Both projectIds must start with `demo_` for the server-side clear-project
// safety gate to allow Reset. Add more demos by appending to this list.
export const DEMO_TABS: Array<{ projectId: string; label: string; subtitle?: string }> = [
  { projectId: 'demo_project_affair', label: 'Affair Demo', subtitle: 'Populated' },
  { projectId: 'demo_project_fresh', label: 'Fresh Start', subtitle: 'Empty — braindump in' },
];

export function Shell({
  storyId,
  title,
  canRename,
  onRename,
  children,
}: {
  storyId?: string;
  /** The story's title from the user's works record; falls back to "Corkboard". */
  title?: string;
  /** Real freeform stories can be renamed inline; demo/wow can't. */
  canRename?: boolean;
  onRename?: (newTitle: string) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const dark = useThemeMode() === 'dark';
  const isDemo = !!storyId?.startsWith('demo_');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const startTitleEdit = () => { if (!canRename) return; setTitleDraft(title ?? ''); setEditingTitle(true); };
  const commitTitle = () => {
    setEditingTitle(false);
    const v = titleDraft.trim();
    if (v && v !== (title ?? '')) onRename?.(v);
  };
  return (
    <div
      style={{
        padding: '20px 24px',
        fontFamily: 'system-ui, sans-serif',
        minHeight: '100vh',
        // Dark (default): the ScenesCanvas stage GLOBALLY — near-black base
        // with the desk-lamp ambient glow + center vignette as viewport-fixed
        // layers across the whole page (toolbar, margins, board alike). The
        // board only adds the dot grid on top. Light: warm cream/white wash,
        // also viewport-anchored, so either mode feels identical at any
        // scroll depth.
        backgroundColor: dark ? '#0a0a0b' : undefined,
        backgroundImage: dark
          ? [
              'radial-gradient(ellipse 80% 60% at 15% 20%, rgba(255,147,30,0.05) 0%, rgba(255,107,53,0.02) 30%, transparent 70%)',
              'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 25%, transparent 55%)',
              'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0,0,0,0.45) 100%)',
            ].join(', ')
          : 'linear-gradient(170deg, #ffffff 0%, #fffefb 55%, #faf4e9 100%)',
        backgroundAttachment: 'fixed',
        color: dark ? '#e8e8ec' : '#1d2230',
        // Native form controls (selects, inputs) + scrollbars follow the theme.
        colorScheme: dark ? 'dark' : 'light',
      }}
    >
      {/* (Dark-mode lamp + vignette gradients live on the board surface itself
          — see the canvas div — so they match ScenesCanvasWorkspace exactly.) */}
      <style>{`
        html { scrollbar-gutter: stable; }
        @keyframes cb-q-popin {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cb-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        @keyframes cb-spin { to { transform: rotate(360deg); } }
        @keyframes cb-glow-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.92); }
          50%      { opacity: 0.7;  transform: scale(1.06); }
        }
        /* Card entrance — cards settle in (fade + slight rise/scale) the first
           time they mount: on board load and as cascade extraction lands new
           ones. Plays once per card; existing cards stay put on re-render. */
        @keyframes cb-card-in {
          from { opacity: 0; transform: translateY(7px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* Streaming caret blink for the peer's prose. */
        @keyframes cb-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        /* Soft fade-in for things that fill in after a card lands: connector
           edges and the card metadata row (counts, links). */
        @keyframes cb-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* Opacity-only fade for SVG connector edges (no transform, so the lines
           don't shift while fading in). */
        @keyframes cb-edge-in { from { opacity: 0; } to { opacity: 1; } }
        /* Sequence container box appearing (e.g. a member-less sequence becoming a
           container on drop). Scales up from the top-left so it reads as expanding
           out of the card's spot, not popping in. */
        @keyframes cb-seqbox-in {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        /* "Still processing" cue: a card is on the board but its edges / metadata
           are still being generated. A soft accent-colored ring pulses around it
           (--cb-sheen carries the card's accent as an rgba). Reads as "working on
           it" without moving the card. Stops the moment edges land. */
        @keyframes cb-shimmer {
          0%, 100% { box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 0 0 0 var(--cb-sheen, rgba(255,140,66,0)); }
          50%      { box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 0 0 2px var(--cb-sheen, rgba(255,140,66,0.5)), 0 0 18px 1px var(--cb-sheen, rgba(255,140,66,0.45)); }
        }
        /* The SVG-line sibling of cb-shimmer: a provisional STREAMED edge
           (optimistic spine, mid-extraction) pulses its glow underlay on the
           same cadence as the streaming cards' ring. Stops when the
           authoritative refetch replaces the optimistic edges. */
        @keyframes cb-edge-shimmer {
          0%, 100% { opacity: 0.06; }
          50%      { opacity: 0.45; }
        }
        /* Board text isn't selectable (so dragging cards never highlights their
           prose), but editable fields stay selectable so you can still type and
           select inside them. */
        .cb-noselect input, .cb-noselect textarea,
        .cb-noselect [contenteditable="true"], .cb-noselect [contenteditable=""] {
          user-select: text;
          -webkit-user-select: text;
        }
        /* Quiet scrollbars for inner scroll panels (peer columns, panel
           sections) — the native track reads as a chunky gray gutter on the
           dark surfaces and steals visual width. Thin thumb, no track. */
        .cb-scroll { scrollbar-width: thin; scrollbar-color: ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.18)'} transparent; }
        .cb-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .cb-scroll::-webkit-scrollbar-track { background: transparent; }
        .cb-scroll::-webkit-scrollbar-corner { background: transparent; }
        .cb-scroll::-webkit-scrollbar-thumb {
          background: ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.18)'};
          border-radius: 3px;
        }
        .cb-scroll::-webkit-scrollbar-thumb:hover {
          background: ${dark ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.3)'};
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <a
          href="/dashboard"
          title="Back to your stories"
          style={{
            fontSize: 12,
            fontWeight: 600,
            textDecoration: 'none',
            color: dark ? '#787882' : '#9a9aa4',
          }}
        >
          ← Stories
        </a>
        {canRename && editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              else if (e.key === 'Escape') setEditingTitle(false);
            }}
            style={{
              fontSize: 20, fontWeight: 'normal', letterSpacing: -0.2, margin: 0,
              padding: '0 4px', minWidth: 160, maxWidth: 520,
              background: dark ? '#1a1a1e' : '#fff',
              color: dark ? '#ededf1' : '#1d2230',
              border: `1px solid ${dark ? '#3a3a42' : '#cbd5e1'}`,
              borderRadius: 6, outline: 'none', fontFamily: 'inherit',
            }}
          />
        ) : (
          <h1
            onClick={startTitleEdit}
            title={canRename ? 'Rename story' : undefined}
            style={{
              fontSize: 20, margin: 0, color: dark ? '#ededf1' : '#1d2230', letterSpacing: -0.2,
              cursor: canRename ? 'text' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {title ?? 'Corkboard'}
            {canRename && (
              <span style={{ fontSize: 12, opacity: 0.45 }} aria-hidden>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </span>
            )}
          </h1>
        )}
      </div>
      {/* Demo tab strip only on demo projects — real stories don't see it.
          PRE-PROD: remove the /freeform-demo route + DEMO_TABS entirely. */}
      {isDemo && <DemoTabStrip activeProjectId={storyId} />}
      {children}
    </div>
  );
}

export function DemoTabStrip({ activeProjectId }: { activeProjectId?: string }) {
  const dark = useThemeMode() === 'dark';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      {DEMO_TABS.map((t) => {
        const active = t.projectId === activeProjectId;
        return (
          <a
            key={t.projectId}
            href={`/freeform/${t.projectId}`}
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              padding: '5px 12px',
              fontSize: 11.5,
              borderRadius: 7,
              border: `1px solid ${active ? '#ea580c' : dark ? '#2a2a30' : '#e6dfd2'}`,
              background: active ? '#ea580c' : dark ? '#1a1a1e' : '#fff',
              color: active ? '#fff' : dark ? '#b4b4be' : '#4a4f5c',
              textDecoration: 'none',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.3,
              boxShadow: active
                ? '0 1px 6px rgba(234,88,12,0.4)'
                : dark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 2px rgba(120,90,40,0.05)',
            }}
            title={`Switch to ${t.label} (${t.projectId})`}
          >
            <span style={{ fontWeight: 500 }}>{t.label}</span>
            {t.subtitle && (
              <span
                style={{
                  fontSize: 9,
                  color: active ? 'rgba(255,255,255,0.75)' : '#999',
                  letterSpacing: 0.2,
                }}
              >
                {t.subtitle}
              </span>
            )}
          </a>
        );
      })}
      {activeProjectId && (
        <code
          style={{
            fontSize: 10.5,
            color: dark ? '#7a7a84' : '#a89f8e',
            marginLeft: 8,
            padding: '2px 7px',
            background: dark ? 'rgba(255,107,53,0.08)' : 'rgba(234,88,12,0.06)',
            border: dark ? '1px solid rgba(255,107,53,0.2)' : '1px solid rgba(234,88,12,0.14)',
            borderRadius: 5,
          }}
        >
          {activeProjectId}
        </code>
      )}
    </div>
  );
}

// CorkboardLoading — the board's loading state. A centered brain mark inside a
// spinning accent ring + a soft pulsing glow, on the dark stage. Replaces the
// bare "Loading corkboard…" text node.
export function CorkboardLoading() {
  const dark = useThemeMode() === 'dark';
  const accent = '#ff6b35';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        minHeight: '60vh',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ position: 'relative', width: 66, height: 66, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Soft glow behind the mark. */}
        <div
          style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${hexToRgba(accent, 0.4)} 0%, transparent 68%)`,
            filter: 'blur(6px)',
            animation: 'cb-glow-pulse 1.9s ease-in-out infinite',
          }}
        />
        {/* Spinning accent ring. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `2px solid ${hexToRgba(accent, dark ? 0.16 : 0.2)}`,
            borderTopColor: accent,
            animation: 'cb-spin 0.95s linear infinite',
          }}
        />
        {/* Brain mark. */}
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', position: 'relative' }}
        >
          <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
          <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
          <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
          <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
          <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
          <path d="M6 18a4 4 0 0 1-1.967-.516" />
          <path d="M19.967 17.484A4 4 0 0 1 18 18" />
        </svg>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: dark ? '#d4d4dc' : '#3d4250', letterSpacing: 0.2 }}>
        Loading corkboard…
      </div>
      <div style={{ fontSize: 12, color: dark ? '#6e6e78' : '#9a9aa4', maxWidth: 280, lineHeight: 1.5 }}>
        Pulling your scenes, characters, and arcs from the graph.
      </div>
    </div>
  );
}
