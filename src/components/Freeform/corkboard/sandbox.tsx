// components/Freeform/corkboard/sandbox.tsx (FIL-657, FIL-642)
//
// The sandbox's doorway on the master corkboard: a left panel, opposite the
// confirm panel, that counts what the sandbox holds and lists it read-only.
// Nothing is answered from here (ANCHOR-sandbox.md section 8, "a doorway,
// not a desk"). Behind the `ff-sandbox` flag so the prod FE against a dev
// backend with fragments present renders the board unchanged.
//
// What the writer sees (anchor section 14, the vocabulary budget: card,
// sticky, label, dump, ready, world, question, done): stickies, colored by
// kind, with no kind word on them; stickies that landed near each other drawn
// as one group with no name; "Ready" over a badged group. No "fragment",
// "huddle", "cluster", "parked" or "held" anywhere on screen.
//
// Today's board read (FRAGMENTS=1 on dev) carries floating and attached
// fragments and their huddles; `badges` is empty until FIL-640, parked cards
// wait on FIL-641 and world entries on FIL-653. Those land into this panel.

import React, { useMemo, useState } from 'react';
import type { ProjectEntity, SandboxBadge, SandboxFragment } from '../../../lib/freeformApi';
import { useThemeMode } from './theme';

export const SANDBOX_FLAG_KEY = 'ff-sandbox';
const DOOR_OPEN_KEY = 'ff-sandbox-door';

/** `localStorage['ff-sandbox'] === '1'`, same shape as `ff-theme`. Read once
 *  per mount; flipping it is a reload, like the theme used to be. */
export function readSandboxFlag(): boolean {
  try { return localStorage.getItem(SANDBOX_FLAG_KEY) === '1'; } catch { return false; }
}

// Sticky paper by kind (anchor section 8, direction B "Paper"). Light: pale
// paper, dark ink. Dark: light ink, a deep saturated paper, an edge glow in
// the bright paper color.
export const PAPER: Record<string, { light: string; dark: string; glow: string }> = {
  idea: { light: '#f7eeb8', dark: '#7a6718', glow: 'rgba(247,222,120,.85)' },
  note: { light: '#f3dbd6', dark: '#8a3f47', glow: 'rgba(244,170,160,.85)' },
  dialogue: { light: '#d9e6f8', dark: '#2f4a73', glow: 'rgba(150,190,250,.85)' },
  story: { light: '#e4e8d9', dark: '#3f5a3a', glow: 'rgba(150,210,140,.7)' },
  question: { light: '#d8eff5', dark: '#215562', glow: 'rgba(84,191,219,.8)' },
};
const READY = { light: '#059669', dark: '#34d399' };

export function paperFor(kind: string) { return PAPER[kind] ?? PAPER.idea; }

/** THE WRITER'S STICKY COLOURS (Ben, 2026-10-31: "freely color code our
 *  stickies", unnamed). The kinds' own papers first, then three more; the
 *  key is what is stored (update-fragment `color`). */
export const STICKY_PAPER: Record<string, { light: string; dark: string; glow: string }> = {
  yellow: PAPER.idea, pink: PAPER.note, blue: PAPER.dialogue, green: PAPER.story, teal: PAPER.question,
  orange: { light: '#f8dcc0', dark: '#8a4f1e', glow: 'rgba(250,180,120,.85)' },
  purple: { light: '#e6dcf3', dark: '#55407a', glow: 'rgba(190,160,240,.8)' },
  grey: { light: '#e6e3dc', dark: '#4a4a50', glow: 'rgba(200,200,200,.6)' },
};
export const STICKY_COLOR_KEYS = Object.keys(STICKY_PAPER);
/** The paper a sticky shows, as a key: the writer's colour, else its kind's. */
const KIND_PAPER_KEY: Record<string, string> = { idea: 'yellow', note: 'pink', dialogue: 'blue', story: 'green', question: 'teal' };
export function stickyPaperKey(f: { kind: string; color?: string }) { return (f.color && STICKY_PAPER[f.color]) ? f.color : (KIND_PAPER_KEY[f.kind] ?? 'yellow'); }
/** A sticky's paper: the writer's colour, else its kind's. */
export function stickyPaper(f: { kind: string; color?: string }) { return (f.color && STICKY_PAPER[f.color]) || paperFor(f.kind); }

function entityTitle(e: ProjectEntity | undefined): string {
  return String(e?.working_name ?? e?.working_title ?? '').trim();
}

/** One sticky. Text, then the writer's label if they wrote one, then (on
 *  click) where it came from: the dump sentence underneath. */
function Sticky({ f, dark, aboutTitle }: { f: SandboxFragment; dark: boolean; aboutTitle?: string }) {
  const [showSource, setShowSource] = useState(false);
  const p = stickyPaper(f);
  const hasSource = f.source && f.source.trim() !== f.text.trim();
  return (
    <div
      role={hasSource ? 'button' : undefined}
      tabIndex={hasSource ? 0 : undefined}
      onClick={hasSource ? () => setShowSource((v) => !v) : undefined}
      onKeyDown={hasSource ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSource((v) => !v); } } : undefined}
      title={hasSource ? (showSource ? 'Hide where this came from' : 'Where did this come from') : undefined}
      style={{
        padding: '8px 10px',
        borderRadius: 1,
        background: dark ? p.dark : p.light,
        color: dark ? '#f6f4ee' : '#3b3a33',
        boxShadow: dark
          ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1px ${p.glow}, 0 0 10px ${p.glow}`
          : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
        fontSize: 12.5,
        lineHeight: 1.4,
        cursor: hasSource ? 'pointer' : 'default',
        outline: 'none',
      }}
    >
      <div>{f.text}</div>
      {f.label && (
        <div style={{ marginTop: 4, fontSize: 10.5, fontWeight: 700, letterSpacing: '.3px', opacity: .85 }}>{f.label}</div>
      )}
      {aboutTitle && (
        <div style={{ marginTop: 4, fontSize: 10.5, opacity: .7 }}>about {aboutTitle}</div>
      )}
      {showSource && hasSource && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}`, fontSize: 11.5, fontStyle: 'italic', opacity: .85 }}>
          “{f.source}”
        </div>
      )}
    </div>
  );
}

/** Stickies that landed near each other, drawn as one group. Dashed, like
 *  the board's threads; no name, no outline word. A badged group gets one
 *  green "Ready" and the kind it reads as. */
function Group({ members, badge, dark, titleOf }: { members: SandboxFragment[]; badge?: SandboxBadge; dark: boolean; titleOf: (about: string) => string | undefined }) {
  const ready = dark ? READY.dark : READY.light;
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 7,
        border: badge ? `1px solid ${ready}` : `1px dashed ${dark ? '#3a3a42' : '#d8d2c4'}`,
        background: badge ? (dark ? 'rgba(52,211,153,.10)' : 'rgba(5,150,105,.08)') : 'transparent',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      {badge && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 2px' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: dark ? '#e8e8ec' : '#222' }}>{badge.title}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: dark ? '#9a9aa4' : '#777' }}>reads as {badge.kind}</span>
        </div>
      )}
      {members.map((f) => <Sticky key={f.id} f={f} dark={dark} aboutTitle={titleOf(f.about)} />)}
    </div>
  );
}

export function SandboxDoorway({
  fragments,
  badges,
  entities,
  onOpenCard,
  onOpenBoard,
  top,
}: {
  fragments: SandboxFragment[];
  badges: SandboxBadge[];
  entities: ProjectEntity[];
  /** Opens a card's sheet; the stickies on a card are reached through it. */
  onOpenCard: (cardId: string) => void;
  /** Opens the sandbox board (the room behind this doorway). */
  onOpenBoard?: () => void;
  /** Viewport y to hang from: just under the toolbar. */
  top: number;
}) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(DOOR_OPEN_KEY) !== '0'; } catch { return true; }
  });
  const setOpenPersist = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(DOOR_OPEN_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

  const alive = useMemo(() => fragments.filter((f) => f.open), [fragments]);
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const titleOf = useMemo(() => {
    const byName = new Map<string, string>();
    for (const e of entities) {
      const t = entityTitle(e);
      if (t) byName.set(t.toLowerCase(), t);
    }
    return (about: string) => (about ? byName.get(about.trim().toLowerCase()) ?? about.trim() : undefined);
  }, [entities]);

  const badgeByCluster = useMemo(() => new Map(badges.map((b) => [b.clusterId, b])), [badges]);

  // Floating: a badged huddle (any size) is Ready; an unbadged huddle of two
  // or more is a group; the rest are singles. Newest first throughout.
  // Attached: grouped by the card they hang on.
  const { ready, groups, singles, onCards } = useMemo(() => {
    const floating = alive.filter((f) => !f.attachedTo);
    const byCluster = new Map<string, SandboxFragment[]>();
    const singles: SandboxFragment[] = [];
    for (const f of floating) {
      if (f.clusterId) {
        const arr = byCluster.get(f.clusterId) ?? [];
        arr.push(f);
        byCluster.set(f.clusterId, arr);
      } else singles.push(f);
    }
    const ready: Array<{ id: string; members: SandboxFragment[]; badge: SandboxBadge }> = [];
    const groups: Array<{ id: string; members: SandboxFragment[] }> = [];
    for (const [id, members] of byCluster) {
      const badge = badgeByCluster.get(id);
      if (badge) ready.push({ id, members, badge });
      else if (members.length > 1) groups.push({ id, members });
      else singles.push(members[0]);
    }
    const newest = (a: SandboxFragment, b: SandboxFragment) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0);
    for (const g of [...ready, ...groups]) g.members.sort(newest);
    ready.sort((a, b) => newest(a.members[0], b.members[0]));
    groups.sort((a, b) => newest(a.members[0], b.members[0]));
    singles.sort(newest);
    const onCards = new Map<string, SandboxFragment[]>();
    for (const f of alive) {
      if (!f.attachedTo) continue;
      const arr = onCards.get(f.attachedTo) ?? [];
      arr.push(f);
      onCards.set(f.attachedTo, arr);
    }
    return { ready, groups, singles, onCards };
  }, [alive, badgeByCluster]);

  const readyCount = ready.length;
  const looseCount = groups.reduce((n, g) => n + g.members.length, 0) + singles.length;
  const attachedCount = alive.length - alive.filter((f) => !f.attachedTo).length;
  const total = alive.length;

  const ink = dark ? '#e8e8ec' : '#222';
  const muted = dark ? '#82828c' : '#888';
  const hair = dark ? '#26262b' : '#f0f0f0';
  const panelBg = dark ? '#141417' : '#fff';
  const panelBorder = dark ? '#26262b' : '#ece5d7';
  const readyColor = dark ? READY.dark : READY.light;

  if (!open) {
    return (
      <button
        type="button"
        data-sandbox-door
        onClick={() => setOpenPersist(true)}
        title="Show the sandbox"
        style={{
          position: 'fixed', left: 0, top, zIndex: 120,
          padding: '8px 10px 8px 8px',
          borderRadius: '0 8px 8px 0',
          border: `1px solid ${panelBorder}`, borderLeft: 'none',
          background: panelBg, color: ink,
          font: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
          boxShadow: dark ? '4px 0 18px rgba(0,0,0,.45)' : '4px 0 18px rgba(0,0,0,.08)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: readyColor, display: 'inline-block' }} />
        Sandbox
        {total > 0 && <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: muted }}>{total}</span>}
      </button>
    );
  }

  return (
    <aside
      data-sandbox-door
      aria-label="Sandbox"
      style={{
        position: 'fixed', left: 16, top, zIndex: 120,
        width: 272, maxHeight: `calc(100vh - ${top + 24}px)`,
        background: panelBg, border: `1px solid ${panelBorder}`, borderRadius: 10,
        boxShadow: dark ? '0 10px 30px rgba(0,0,0,.5)' : '0 10px 30px rgba(0,0,0,.10)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: ink,
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: `3px solid ${readyColor}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, flex: 1 }}>Sandbox</h3>
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: muted }} title={`${total} ${total === 1 ? 'sticky' : 'stickies'}`}>{total}</span>
        {onOpenBoard && (
          <button
            type="button"
            onClick={onOpenBoard}
            title="Open the sandbox board"
            style={{ font: 'inherit', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >Open ↗</button>
        )}
        <button
          type="button"
          onClick={() => setOpenPersist(false)}
          title="Hide"
          style={{ background: 'transparent', border: 'none', font: 'inherit', fontSize: 18, lineHeight: 1, color: muted, cursor: 'pointer', padding: 0 }}
        >×</button>
      </div>

      <div className="cb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Ready: badged groups, or the one line that says nothing is. */}
        <section style={{ padding: '10px 14px', borderBottom: `1px solid ${hair}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, color: muted, marginBottom: 6 }}>
            <i style={{ width: 7, height: 7, borderRadius: '50%', background: readyColor, display: 'inline-block' }} />
            Ready
            <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{readyCount}</span>
          </div>
          {readyCount === 0 && (
            <div style={{ fontSize: 11.5, color: muted }}>Nothing is ready yet.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ready.map((g) => (
              <Group key={g.id} members={g.members} badge={g.badge} dark={dark} titleOf={titleOf} />
            ))}
          </div>
        </section>

        {/* Loose stickies: groups first, then singles. No heading word
            beyond the count; what they are is the color. */}
        <section style={{ padding: '10px 14px', borderBottom: `1px solid ${hair}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, color: muted, marginBottom: 6 }}>
            <i style={{ width: 7, height: 7, borderRadius: 1, background: dark ? PAPER.idea.dark : PAPER.idea.light, boxShadow: dark ? `0 0 0 1px ${PAPER.idea.glow}` : '0 1px 2px rgba(0,0,0,.15)', display: 'inline-block' }} />
            Stickies
            <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{looseCount}</span>
          </div>
          {looseCount === 0 && (
            <div style={{ fontSize: 11.5, color: muted }}>Nothing loose. A dump that says something with no card to land on leaves a sticky here.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.map((g) => (
              <Group key={g.id} members={g.members} dark={dark} titleOf={titleOf} />
            ))}
            {singles.map((f) => <Sticky key={f.id} f={f} dark={dark} aboutTitle={titleOf(f.about)} />)}
          </div>
        </section>

        {/* On cards: a count per card, the card's name opens its sheet. */}
        {onCards.size > 0 && (
          <section style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, color: muted, marginBottom: 6 }}>
              On cards
              <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{attachedCount}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...onCards.entries()].map(([cardId, list]) => {
                const title = entityTitle(byId.get(cardId)) || 'a card no longer on the board';
                return (
                  <button
                    key={cardId}
                    type="button"
                    onClick={() => onOpenCard(cardId)}
                    title={list.map((f) => f.text).join('\n')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                      padding: '7px 10px', borderRadius: 7, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`,
                      background: dark ? '#1a1a1e' : '#fff', color: ink, font: 'inherit', fontSize: 12.5, cursor: 'pointer',
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                    <span style={{ display: 'inline-flex', gap: 3 }}>
                      {list.slice(0, 4).map((f) => {
                        const p = stickyPaper(f);
                        return <i key={f.id} style={{ width: 10, height: 10, borderRadius: 1, background: dark ? p.dark : p.light, boxShadow: dark ? `0 0 0 1px ${p.glow}` : '0 1px 2px rgba(0,0,0,.15)', display: 'inline-block' }} />;
                      })}
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: muted }}>{list.length}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
