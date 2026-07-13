// components/Freeform/corkboard/shell.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React from 'react';
import { useThemeMode } from './theme';

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
  children,
}: {
  storyId?: string;
  /** The story's title from the user's works record; falls back to "Corkboard". */
  title?: string;
  children: React.ReactNode;
}) {
  const dark = useThemeMode() === 'dark';
  const isDemo = !!storyId?.startsWith('demo_');
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
        <h1 style={{ fontSize: 20, margin: 0, color: dark ? '#ededf1' : '#1d2230', letterSpacing: -0.2 }}>
          {title ?? 'Corkboard'}
        </h1>
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
