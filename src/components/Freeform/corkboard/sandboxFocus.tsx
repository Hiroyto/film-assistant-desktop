// components/Freeform/corkboard/sandboxFocus.tsx (FIL-641, the board's focus)
//
// Ben, 2026-10-08: opening a card on the sandbox must not be the master's
// orbit sheet. It is a FOCUS ON THE BOARD: the card you clicked comes to the
// centre and grows to fit what is written on it, the other cards slide out
// of its way and soften, and the card pages through what touches it: its
// stickies first, then the categories the orbit also knows (cast, where,
// world, order; a character's scenes, relationships, before the story).
// Nothing leaves the board. A category's members that are ON this board
// stay sharp while it is up, so the connection is seen, not read.
//
// This file is the pure model (focusSlides) and the opened card (FocusCard).
// The board (sandboxBoard.tsx) owns the geometry: centring, the push, the
// soft focus. The master's full sheet stays one door away ("Full sheet").
//
// Vocabulary (anchor section 14): card, sticky, world, scene, character.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InlineText } from './inlineText';
import { PaperBar, RichText } from './richText';
import { ColorDot, cardColor, shade } from './storylineLabels';
import type { LabelSet } from '../../../lib/freeformApi';
import type { ProjectEdges, ProjectEntity, SandboxFragment, WorldEntry } from '../../../lib/freeformApi';
import { getEntityColor } from '../entityColors';
import { paperFor, stickyPaper } from './sandbox';
import InternIcon from '../InternIcon';
import { PEER_BLUE, PEER_BLUE_INK, PEER_BLUE_LIGHT } from '../tokens';
import { PeerReadSection } from './sandboxPeer';
import { liftColor } from './theme';
import { DialogueFace, LineNote, SCRIPT_FACE, bareLine } from './dialogue';
import { TrashButton } from './sandboxTrash';
import { BraindumpIcon } from './emptyState';
import { WORLD_GREEN, cardTitle, rawTitle } from './sandboxBoard';

export const FOCUS_W = 560;
/** The card while its pages are open: a page (816) with the card's own gutters. */
export const WRITING_W = 872;

export type FocusRow = {
  id: string;
  kicker: string;
  title: string;
  sub?: string;
  /** The row's accent (an entity colour, world green). */
  accent?: string;
  /** A Relationships row: the tie the line between the two characters wears. */
  tie?: Tie;
};

/** One tie between two characters (2026-10-15): the label a line wears.
 *  From the character-to-character ties (`edges.structural`); a pair with no
 *  tie but an old relationship card wears the card's kind instead, and the
 *  card itself is never drawn on the sandbox. */
export type Tie = {
  a: string; b: string;
  /** The tie's direction as stored (the predicate is `from`'s voice). */
  from: string; to: string;
  predicate: string; inverse?: string;
  source: 'tie' | 'rel';
  /** The relationship card behind a 'rel' tie. */
  relId?: string; relParked?: boolean;
};
const words = (p: string) => p.replace(/_/g, ' ').trim().toLowerCase();
/** The tie read from one character's side. */
export function tieLabel(t: Tie, viewer?: string): string {
  if (t.source === 'rel') return words(t.predicate);
  return words(viewer && viewer === t.to ? (t.inverse || t.predicate) : t.predicate);
}
/** Every tied pair among the story's characters, one tie per pair (the most
 *  bond-like wording, as the master's lines pick it), then relationship-card
 *  pairs with no tie. */
export function pairTies(entities: ProjectEntity[], structural: Array<{ from: string; to: string; predicate: string; inverse_predicate?: string }>): Tie[] {
  const alive = new Map(entities.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const isChar = (id: string) => alive.get(id)?.type === 'character';
  const key = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const bondy = (p: string) => /(_| )(of|to|with)$/i.test(p.trim());
  const out = new Map<string, Tie>();
  for (const s of structural ?? []) {
    if (!isChar(s.from) || !isChar(s.to) || s.from === s.to || !String(s.predicate ?? '').trim()) continue;
    const k = key(s.from, s.to);
    const cur = out.get(k);
    if (cur && (bondy(cur.predicate) || !bondy(s.predicate))) continue;
    out.set(k, { a: s.from < s.to ? s.from : s.to, b: s.from < s.to ? s.to : s.from, from: s.from, to: s.to, predicate: s.predicate, inverse: s.inverse_predicate || undefined, source: 'tie' });
  }
  const byName = new Map<string, string>();
  for (const e of alive.values()) if (e.type === 'character') byName.set(String(e.working_name ?? e.working_title ?? '').trim().toLowerCase(), e.id);
  for (const r of alive.values()) {
    if (r.type !== 'relationship') continue;
    const x = byName.get(String((r as any).character_a ?? '').trim().toLowerCase());
    const y = byName.get(String((r as any).character_b ?? '').trim().toLowerCase());
    if (!x || !y || x === y || out.has(key(x, y)) || !String((r as any).kind ?? '').trim()) continue;
    out.set(key(x, y), { a: x < y ? x : y, b: x < y ? y : x, from: x, to: y, predicate: String((r as any).kind), source: 'rel', relId: r.id, relParked: r.state === 'parked' });
  }
  return [...out.values()];
}
export type FocusSlide = {
  id: string;
  label: string;
  rows: FocusRow[];
  /** Ids of items on THIS board the slide points at: they stay sharp. */
  related: string[];
  empty: string;
  /** The stickies slide: how many hang on the card. */
  count?: number;
};

export type FocusSubject =
  | { kind: 'card'; entity: ProjectEntity; attached: SandboxFragment[] }
  | { kind: 'world'; entry: WorldEntry; attached: SandboxFragment[] };

export type FocusContext = {
  entities: ProjectEntity[];
  edges?: Partial<ProjectEdges> | null;
  world?: WorldEntry[];
  /** Ids of the items on this board (so a row can say it is here). */
  onBoard: Set<string>;
  /** The Peer on the sandbox (2026-10-20): how many open Peer questions are
   *  about this card. Present = the card has a Peer pill. */
  peerCount?: number;
};

// A sequence is a beat on the sandbox now (sandbox-beats, 2026-11-05).
const kickerOf = (e: ProjectEntity) => (e.type === 'event' ? 'Scene' : e.type === 'arc' ? 'Subplot' : e.type === 'sequence' ? 'Beat' : e.type.charAt(0).toUpperCase() + e.type.slice(1));
const colorOf = (e: ProjectEntity) => getEntityColor(e.type as any) || '#888';

/** The slides for a focused item. Stickies always first (anchor: fragments
 *  are the first slide); a category only when it has members. */
export function focusSlides(subject: FocusSubject, ctx: FocusContext): FocusSlide[] {
  const byId = new Map(ctx.entities.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const ent = (id: string) => byId.get(id);
  const row = (e: ProjectEntity, sub?: string): FocusRow => ({ id: e.id, kicker: kickerOf(e), title: cardTitle(e), sub, accent: colorOf(e) });
  const slide = (id: string, label: string, rows: FocusRow[], empty: string): FocusSlide => ({ id, label, rows, related: rows.map((r) => r.id).filter((rid) => ctx.onBoard.has(rid)), empty });
  const out: FocusSlide[] = [];
  const attached = subject.attached;
  out.push({ id: 'stickies', label: 'Stickies', count: attached.length, rows: [], related: [], empty: subject.kind === 'world' ? 'No stickies on it yet. Add one with the sticky in its head.' : 'No stickies on this card yet. Dump here and what you say about it lands on the card.' });
  // THE PEER PILL (Ben, 2026-10-20): beside Stickies, its questions hung
  // round the card as stickies of their own kind.
  // A world entry carries it too (Ben, 2026-10-22).
  if (ctx.peerCount !== undefined && (subject.kind === 'world' || ['event', 'sequence', 'arc', 'character'].includes(subject.entity.type))) {
    out.push({ id: 'peer', label: 'Peer', count: ctx.peerCount, rows: [], related: [], empty: 'Nothing from the Peer on this card yet. Ask with the glasses on the card: a short read, and a few questions that hang here as stickies.' });
  }

  const inv = ctx.edges?.involves ?? [];
  const occ = ctx.edges?.occurs_in ?? [];
  const structural = ctx.edges?.structural ?? [];

  if (subject.kind === 'card') {
    const e = subject.entity;
    if (e.type === 'sequence' || e.type === 'arc') {
      // AN OPENED SEQUENCE OR SUBPLOT (Ben, 2026-11-03: the sandbox's own card,
      // not the master sheet): its scenes, which weave under it in story
      // order; a subplot's carry what each does to the thread.
      const rows: FocusRow[] = e.type === 'sequence'
        ? (ctx.edges?.contains ?? []).filter((c) => c.from === e.id).map((c) => ent(c.to)).filter((x): x is ProjectEntity => !!x && x.type === 'event').map((x) => row(x))
        : ((ctx.edges as any)?.evokes ?? []).filter((x: any) => x.arc_id === e.id).map((x: any) => { const sc = ent(String(x.event_id)); return sc && sc.type === 'event' ? { ...row(sc), ...(x.transition ? { kicker: String(x.transition) } : {}) } : null; }).filter((r: FocusRow | null): r is FocusRow => !!r);
      out.push(slide('scenes', 'Scenes', rows, e.type === 'sequence' ? 'No scenes in it yet. Add a scene below.' : 'No scenes in it yet. Add one with the + on the pill.'));
    } else if (e.type === 'event') {
      const cast = inv.filter((x) => x.from === e.id).map((x) => ent(x.to)).filter((c): c is ProjectEntity => !!c && c.type === 'character');
      out.push(slide('cast', 'Cast', cast.map((c) => row(c, c.state === 'parked' ? undefined : 'on the master')), 'No one in this scene yet.'));
      const where = occ.filter((x) => x.from === e.id).map((x) => ent(x.to)).filter((l): l is ProjectEntity => !!l);
      // Where shows even with no location yet (Ben, 2026-10-13), like Cast.
      out.push(slide('where', 'Where', where.map((l) => row(l)), 'No location for this scene yet.'));
      // ITS SUBPLOTS (Ben, 2026-11-07: "tag scenes to subplots easier"): the
      // subplots this scene is in, each with what the scene does to it; the
      // "+" on the pill puts it in another.
      const subs = (((ctx.edges as any)?.evokes ?? []) as any[]).filter((x) => x.event_id === e.id).map((x): FocusRow | null => {
        const a = ent(String(x.arc_id));
        // What the scene does to it is a chip the board hangs on the card's edge.
        return a && a.type === 'arc' && !(a as any).character_id ? { ...row(a), kicker: 'Subplot', sub: undefined } : null;
      }).filter((r): r is FocusRow => !!r);
      out.push(slide('subplots', 'Subplots', subs, 'In no subplot yet. Put it in one with the + on the pill.'));
      // No World pill (Ben, 2026-10-22): world entries no longer show what they touch.
      // No Order pill on a scene (Ben, 2026-10-13): the thread on the board shows the order.
    } else if (e.type === 'character') {
      // Relationships first after the stickies (Ben, 2026-10-08): who they
      // are to the others is the character; the scenes come after. Always
      // there (2026-10-15), drawn as labelled lines to the people they are
      // tied to; relationship CARDS are never drawn on the sandbox.
      const rels: FocusRow[] = [];
      for (const t of pairTies(ctx.entities, structural as any)) {
        if (t.a !== e.id && t.b !== e.id) continue;
        const o = ent(t.a === e.id ? t.b : t.a);
        if (o) rels.push({ id: o.id, kicker: tieLabel(t, e.id), title: cardTitle(o), accent: colorOf(o), tie: t });
      }
      out.push(slide('relationships', 'Relationships', rels, 'No one tied to them yet.'));
      const scenes = inv.filter((x) => x.to === e.id).map((x) => ent(x.from)).filter((s): s is ProjectEntity => !!s && (s.type === 'event' || s.type === 'sequence'));
      if (scenes.length) out.push(slide('scenes', 'Scenes', scenes.map((s) => row(s, s.state === 'parked' ? undefined : 'on the master')), ''));
      // No "Before the story" pill (Ben, 2026-10-22): it listed the world
      // entries touching the character, a sample's library among them.
    } else if (e.type === 'location') {
      const here = occ.filter((x) => x.to === e.id).map((x) => ent(x.from)).filter((s): s is ProjectEntity => !!s);
      out.push(slide('scenes', 'Scenes here', here.map((s) => row(s, s.state === 'parked' ? undefined : 'on the master')), 'No scene set here yet.'));
    } else if (e.type === 'relationship') {
      const between = inv.filter((x) => x.from === e.id).map((x) => ent(x.to)).filter((c): c is ProjectEntity => !!c);
      out.push(slide('between', 'Between', between.map((c) => row(c)), 'No one named on this relationship yet.'));
    }
  }
  // A world entry opens to its stickies and nothing else (Ben, 2026-10-22:
  // "that should be it for the world cards"); its kind is picked in its head.
  return out;
}

const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
export const GHOST_W = 224; export const GHOST_H = 78;
export const STICKY_SAT_W = 150; export const STICKY_SAT_H = 96;

/** THE CARD'S ACTIONS IN ITS HEADER (Ben, 2026-10-13): icons where the
 *  "after ..." line and Full sheet were, not a row of worded pills under the
 *  telling. Each icon is quiet until hovered: it takes its own colour on a
 *  soft tint, lifts a pixel, and its name fades in under it. */
const ACT_CSS = `
.sbx-act{position:relative;display:inline-flex}
.sbx-act>button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--q);cursor:pointer;transition:color 140ms,background 140ms,border-color 140ms,transform 140ms}
.sbx-act>button:hover,.sbx-act>button:focus-visible{color:var(--c);background:var(--t);transform:translateY(-1px);outline:none}
.sbx-act>button:active{transform:translateY(0)}
.sbx-act>button[data-on]{color:#fff;background:#ff8c42;border-color:#ff8c42}
.sbx-act>button[data-wide]{width:auto;gap:6px;padding:0 10px 0 7px;color:#fff;background:var(--c);border-color:var(--c)}
.sbx-act>button[data-wide]:hover,.sbx-act>button[data-wide]:focus-visible{color:#fff;background:var(--c)}
.sbx-act>button[data-pressed]{color:var(--c);background:var(--t);border-color:color-mix(in srgb,var(--c) 35%,transparent)}
.sbx-act>button>.sbx-act-n{position:absolute;top:-4px;right:-5px;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font:700 9px/1 system-ui,sans-serif;background:var(--nb,#e9e9ee);color:var(--nf,#555);pointer-events:none}
.sbx-act>button[data-pressed]>.sbx-act-n{background:var(--c);color:#fff}
.sbx-act>.sbx-tip{position:absolute;top:calc(100% + 7px);left:50%;transform:translate(-50%,-3px);opacity:0;pointer-events:none;white-space:nowrap;font:600 11px/1 system-ui,sans-serif;letter-spacing:.1px;text-transform:none;padding:6px 8px;border-radius:6px;background:var(--tipbg);color:var(--tipfg);box-shadow:0 4px 14px rgba(0,0,0,.18);transition:opacity 120ms ease,transform 120ms ease;z-index:5}
.sbx-act:hover>.sbx-tip,.sbx-act:focus-within>.sbx-tip{opacity:1;transform:translate(-50%,0);transition-delay:120ms}
@media (prefers-reduced-motion: reduce){.sbx-act>button,.sbx-act>.sbx-tip{transition:none}.sbx-act>button:hover{transform:none}}
`;
const ico = (children: React.ReactNode) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>{children}</svg>
);
const IconLine = () => ico(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 12a2 2 0 0 0 2-2V8H8" /><path d="M14 12a2 2 0 0 0 2-2V8h-2" /></>);
const IconSticky = () => ico(<><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" /><path d="M15 3v4a2 2 0 0 0 2 2h4" /><path d="M9 14h5" /><path d="M11.5 11.5v5" /></>);
/** Back to a sticky (Ben, 2026-10-13: "an uno reverse"): a tilted card
 *  with two opposing arrows, the card's move played backwards. */
const IconToSticky = () => ico(<g transform="rotate(14 12 12)"><rect x="5.5" y="2.5" width="13" height="19" rx="2" /><path d="M8.5 14v-3a2.5 2.5 0 0 1 2.5-2.5h4.5" /><path d="m13.5 6.5 2 2-2 2" /><path d="M15.5 10v3a2.5 2.5 0 0 1-2.5 2.5H8.5" /><path d="m10.5 17.5-2-2 2-2" /></g>);
const IconToSequence = () => ico(<><rect x="3" y="8" width="13" height="13" rx="2" /><path d="M7 4h11a3 3 0 0 1 3 3v11" /></>);
const IconPlus = () => ico(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
const IconPersonPlus = () => ico(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></>);
/** The pills' icons, by slide (2026-10-13: the same family as the header's). */
const sm = (children: React.ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block', flexShrink: 0 }}>{children}</svg>
);
const SLIDE_ICON: Record<string, (z?: number) => React.ReactNode> = {
  peer: (z) => <InternIcon size={(z ?? 14) + 2} />,
  stickies: (z) => sm(<><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" /><path d="M15 3v4a2 2 0 0 0 2 2h4" /></>, z),
  cast: (z) => sm(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>, z),
  between: (z) => sm(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>, z),
  where: (z) => sm(<><path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>, z),
  order: (z) => sm(<><path d="M10 6h11" /><path d="M10 12h11" /><path d="M10 18h11" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></>, z),
  scenes: (z) => sm(<><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" /><path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" /><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>, z),
  relationships: (z) => sm(<><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><path d="M8 12h8" /></>, z),
  touches: (z) => sm(<><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><path d="M8 12h8" /></>, z),
  world: (z) => sm(<><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>, z),
  before: (z) => sm(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>, z),
  established: (z) => sm(<><path d="M20 6 9 17l-5-5" /></>, z),
  subplots: (z) => sm(<><path d="M2 15c3.5-7 6.5-7 10 0s6.5 7 10 0" /><path d="M2 9c3.5-7 6.5-7 10 0" opacity=".55" /></>, z),
  draft: (z) => sm(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, z),
};
const slideIcon = (id: string, size = 14) => (SLIDE_ICON[id] ?? SLIDE_ICON.stickies)(size);
/** The little globe of the old World cards (Ben, 2026-10-15: keep it). */
export function GlobeIcon({ size = 12 }: { size?: number }) { return <>{SLIDE_ICON.world(size)}</>; }
function Act({ label, color, tint, onClick, on, pressed, count, testAttr, wide, children }: { label: string; color: string; tint: string; onClick: () => void; on?: boolean;
  /** Shown widened with this word, filled (the Peer button on the Peer pill, 2026-11-05). */
  wide?: string;
  /** A toggle that is on (the draft's margin buttons). */
  pressed?: boolean; count?: number; testAttr?: string | [string, string]; children: React.ReactNode }) {
  const ta = Array.isArray(testAttr) ? { [testAttr[0]]: testAttr[1] } : testAttr ? { [testAttr]: '' } : {};
  return (
    <span className="sbx-act" style={{ ['--c' as any]: color, ['--t' as any]: tint }}>
      <button type="button" aria-label={label} onClick={onClick} {...(on ? { 'data-on': '' } : {})} {...(wide ? { 'data-wide': '' } : {})} {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})} {...(pressed ? { 'data-pressed': '' } : {})} {...ta} style={{ position: 'relative' }}>
        {children}
        {wide ? <span style={{ fontSize: 12.5, fontWeight: 650, lineHeight: 1 }}>{wide}</span> : null}
        {count ? <span className="sbx-act-n" aria-hidden>{count}</span> : null}
      </button>
      <span className="sbx-tip" aria-hidden>{label}</span>
    </span>
  );
}

/** The focused item, opened large on the board: the head only. What touches
 *  it is drawn AROUND it by the board (chips above, satellites beside), the
 *  way the master's orbit does; nothing rides inside the card but its own
 *  words (Ben, 2026-10-08: the card was eating the board). */
/** "a, b and c". */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function FocusCard({ subject, dark, onDumpInto, aimed, onAskPeer, peerBusy = false, peerAsked = false, peerRead, onDemote, demoteLoses = [], onToSequence, extra, onAddSticky, onAddLine, onDelete, autoFocusTitle = false, onEditBody, onEditTitle, editor, color: colorProp, stripColor, margins, onToggleMargin, kindPick, onClose }: {
  /** A sequence's or subplot's colour in the strip: the opened card wears it (Ben, 2026-11-05). */
  stripColor?: string;
  /** The Peer pill's ask (2026-10-20), on the card itself: a read and a few questions about it. */
  /** The Peer button (Ben, 2026-10-21: one function): a read of this card and a few questions about it. */
  onAskPeer?: () => void; peerBusy?: boolean; peerAsked?: boolean;
  /** On the Peer pill: the card's read as a one-line take (or that the Peer
   *  is reading, or a note on how the ask went), under its words. */
  peerRead?: { text: string; busy: boolean; note?: string };
  subject: FocusSubject;
  dark: boolean;
  after?: string;
  onOpenSheet?: () => void;
  /** An opened world entry's head: the picker for its kind (Ben, 2026-10-22). */
  kindPick?: React.ReactNode;
  /** The card's telling, edited in place (Ben, 2026-10-08: the description
   *  is the writer's, updated by hand, here). */
  onEditBody?: (text: string) => void | Promise<void>;
  /** The title, the same way. */
  onEditTitle?: (text: string) => void | Promise<void>;
  /** Card colour (2026-10-09): the names per colour and the pick, on a scene. */
  color?: { set: LabelSet | undefined; onPick: (color: string) => void;
    /** FIL-707: the card's colour in the set the strip shows (the dot) and in the set that paints (the frame). Absent = the first set. */
    value?: string; frame?: string };
  /** THE PAGES (Ben, 2026-10-08): the card morphs into the editor. When
   *  set, the card is page-wide and the editor is its body under the head;
   *  nothing else changes, the satellites around it are the margins. */
  editor?: React.ReactNode;
  onDumpInto?: () => void;
  aimed?: boolean;
  onPlace?: () => void;
  onDemote?: () => void;
  /** FIL-709: a scene raised to a sequence: it leaves the board for the strip. */
  onToSequence?: () => void;
  /** Under the telling: a sequence's or subplot's Peer beat (FIL-712). */
  extra?: React.ReactNode;
  /** What turning it back drops (FIL-718, Ben 2026-11-01: "warn first"):
   *  plain phrases; empty turns it back at once. */
  demoteLoses?: string[];
  /** A sticky by the writer's hand, on this card (2026-10-09). */
  onAddSticky?: () => void;
  /** A line of dialogue from this card (2026-10-11). */
  onAddLine?: () => void;
  /** Delete the card (2026-10-12): asks once, then goes; Undo brings it back. */
  onDelete?: () => void;
  /** A card just made with + New opens with the caret in its name. */
  autoFocusTitle?: boolean;
  /** THE DRAFT'S MARGINS (Ben, 2026-10-13): while writing, the header holds
   *  a show/hide toggle per margin (stickies, cast, locations), not the
   *  pills over the left margin. */
  margins?: Array<{ id: string; label: string; count: number; on: boolean }>;
  onToggleMargin?: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [askDemote, setAskDemote] = useState(false);
  const isWorld = subject.kind === 'world';
  const base = isWorld ? WORLD_GREEN : colorOf(subject.entity);
  // An opened world entry is its sage strip, larger (Ben, 2026-10-22).
  const color = isWorld ? (dark ? '#9fcf8e' : '#4f7a42') : dark ? liftColor(base, 0.25) : base;
  const sage = paperFor('story');
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#82828c' : '#888';
  const title = isWorld ? subject.entry.title : rawTitle(subject.entity);
  const isTpl = isWorld ? !!subject.entry.template : String((subject.entity as any).template ?? '') === '1';
  const kicker = `${isWorld ? (subject.entry.kind && subject.entry.kind !== 'other' ? `World · ${subject.entry.kind}` : 'World') : kickerOf(subject.entity)}${isTpl ? ' · Template' : ''}`;
  const body = isWorld ? subject.entry.text : String(subject.entity.summary ?? subject.entity.description ?? '').trim();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const tint = (c: string) => `color-mix(in srgb, ${c} ${dark ? 18 : 11}%, transparent)`;
  const lineC = dark ? '#9cbcf0' : '#3a68b0';
  const stickyC = dark ? '#e9bf89' : '#b8891c';
  const isScene = !isWorld && (subject.entity.type === 'event' || subject.entity.type === 'sequence');
  // A new card: Enter on its name goes on to its telling (not a click away).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const enterOnTitle = useRef(false);
  // A coloured scene wears its colour on the frame and rule; the kicker keeps the type colour.
  const ownColor = !isWorld && stripColor ? stripColor : !isWorld && isScene ? (colorProp ? colorProp.frame : cardColor(subject.entity)) : undefined;
  const dotColor = !isWorld && isScene ? (colorProp ? colorProp.value : cardColor(subject.entity)) : undefined;
  const frame = ownColor ? shade(ownColor, dark) : color;

  return (
    <div
      ref={cardRef}
      data-focus-card
      data-writing={editor ? '1' : undefined}
      onPointerDown={stop} onPointerUp={stop}
      style={{
        width: editor ? WRITING_W : FOCUS_W, boxSizing: 'border-box', position: 'relative', padding: '12px 20px 14px', borderRadius: 3,
        // Writing: the card is the viewport's height, top edge to bottom edge.
        ...(editor ? { height: '100vh' } : {}),
        transition: 'width 480ms cubic-bezier(.2,.7,.2,1)',
        background: isWorld ? (dark ? sage.dark : sage.light) : (dark ? '#1e1e22' : '#fffdf7'),
        border: `1.5px solid ${frame}`,
        boxShadow: dark ? '0 2px 4px rgba(0,0,0,.6), 0 24px 60px rgba(0,0,0,.6)' : '0 2px 4px rgba(0,0,0,.1), 0 24px 60px rgba(120,90,40,.22)',
        color: ink, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'system-ui, sans-serif', cursor: 'default',
      }}
    >
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 48, height: 1.5, background: frame, opacity: .7 }} />
      {/* The Peer at work on this card: the card breathes in Peer blue. */}
      {peerBusy && <div aria-hidden data-peer-breathing style={{ position: 'absolute', inset: -2, borderRadius: 4, pointerEvents: 'none', animation: 'ffpeerbreathe 1.8s ease-in-out infinite' }} />}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: frame, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 28, gap: 8, marginRight: -8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isScene && colorProp && <ColorDot value={dotColor} set={colorProp.set} dark={dark} onPick={colorProp.onPick} size={12} />}
          {isWorld && kindPick ? <span data-world-kind style={{ textTransform: 'none', letterSpacing: 0 }}>{kindPick}</span> : <>{isWorld && <GlobeIcon size={12} />}{kicker}</>}
        </span>
        <span data-focus-actions style={{ display: 'inline-flex', gap: 2, ['--nb' as any]: dark ? '#2a2a30' : '#ececf0', ['--nf' as any]: dark ? '#b0b0ba' : '#666b78', alignItems: 'center', color: muted, fontWeight: 600, textTransform: 'none', letterSpacing: 0, ['--q' as any]: muted, ['--tipbg' as any]: dark ? '#f2f2f5' : '#1d2230', ['--tipfg' as any]: dark ? '#1d2230' : '#fff' }}>
          <style>{ACT_CSS}</style>
          {editor && margins && margins.length > 0 && onToggleMargin && (
            <>
              {margins.map((m) => {
                const c = m.id === 'stickies' ? stickyC : m.id === 'cast' ? (dark ? '#e9a35c' : '#c2701f') : m.id === 'where' ? (dark ? '#7fc7a6' : '#2f8a62') : color;
                return (
                  <Act key={m.id} label={`${m.on ? 'Hide' : 'Show'} ${m.label.toLowerCase()}`} color={c} tint={tint(c)} onClick={() => onToggleMargin(m.id)} pressed={m.on} count={m.count} testAttr={['data-margin-toggle', m.id]}>
                    {slideIcon(m.id, 16)}
                  </Act>
                );
              })}
              <span aria-hidden style={{ width: 1, height: 16, background: dark ? '#2e2e36' : '#e6dfd0', margin: '0 6px' }} />
            </>
          )}
          {/* A world entry's header holds only the Peer's glasses (2026-10-22):
              nothing else is passed for it. */}
          {!editor && (
            <>
              {/* Order (Ben, 2026-10-13): sticky, line, braindump, back to a
                  sticky, delete. Place on the master is off for now. */}
              {onAddSticky && <Act label="Add a sticky" color={stickyC} tint={tint(stickyC)} onClick={onAddSticky} testAttr="data-add-sticky"><IconSticky /></Act>}
              {onAddLine && <Act label={subject.kind === 'card' && subject.entity.type === 'character' ? 'Add a line they say' : 'Add a line of dialogue'} color={lineC} tint={tint(lineC)} onClick={onAddLine} testAttr="data-add-line"><IconLine /></Act>}
              {onDumpInto && <Act label={aimed ? 'Dumping into this card' : 'Braindump into this card'} color="#ff6b35" tint={tint('#ff6b35')} onClick={onDumpInto} on={aimed} testAttr="data-dump-into"><BraindumpIcon size={16} /></Act>}
              {onAskPeer && <Act label={peerBusy ? 'The Peer is reading this card' : peerAsked ? 'Ask the Peer again' : 'Ask the Peer about this card'} color={peerRead ? PEER_BLUE : dark ? PEER_BLUE_LIGHT : PEER_BLUE_INK} tint={tint(PEER_BLUE_INK)} onClick={() => { if (!peerBusy) onAskPeer(); }} pressed={peerBusy} testAttr="data-ask-peer" wide={peerRead ? 'Peer' : undefined}><InternIcon size={18} /></Act>}
              {onDemote && <Act label="Turn back into a sticky" color={stickyC} tint={tint(stickyC)} onClick={() => { if (demoteLoses.length) setAskDemote(true); else onDemote(); }} pressed={askDemote} testAttr="data-demote"><IconToSticky /></Act>}
              {onToSequence && <Act label="Make it a sequence" color={dark ? '#a5b4fc' : '#4f46e5'} tint={tint('#4f46e5')} onClick={onToSequence} testAttr="data-to-sequence"><IconToSequence /></Act>}
              {onDelete && (
                <span className="sbx-act" style={{ ['--c' as any]: '#ef4444' }}>
                  <TrashButton dark={dark} size={15} noTitle label={isScene ? 'scene' : subject.kind === 'card' && subject.entity.type === 'character' ? 'character' : 'card'} onConfirm={onDelete} />
                  <span className="sbx-tip" aria-hidden>Delete</span>
                </span>
              )}
              {(onAddLine || onAddSticky || onDemote || onToSequence || onDumpInto || onDelete) && <span aria-hidden style={{ width: 1, height: 16, background: dark ? '#2e2e36' : '#e6dfd0', margin: '0 6px' }} />}
            </>
          )}
          <Act label="Close (Esc)" color={ink} tint={tint(dark ? '#ffffff' : '#1d2230')} onClick={onClose}>
            {ico(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>)}
          </Act>
        </span>
      </div>
      {askDemote && onDemote && (
        // ASK FIRST (FIL-718): what turning it back drops, in plain words.
        <div data-demote-ask role="alertdialog" aria-label="Turn back into a sticky?" onPointerDown={stop} onClick={stop}
          style={{ margin: '10px -4px 0', padding: '8px 10px', borderRadius: 8, background: dark ? 'rgba(233,191,137,.10)' : '#fbf3e4', border: `1px solid ${dark ? 'rgba(233,191,137,.35)' : '#ecd9b6'}`, fontSize: 12.5, lineHeight: 1.45, color: ink }}>
          <div>Turned back into a sticky, it loses {listOf(demoteLoses)}. Undo brings {demoteLoses.length > 1 ? 'them' : 'it'} back.</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" data-demote-no onClick={() => setAskDemote(false)} style={{ font: 'inherit', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: 'inherit' }}>Cancel</button>
            <button type="button" data-demote-yes onClick={() => { setAskDemote(false); onDemote(); }} style={{ font: 'inherit', fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#ff8c42', color: '#fff' }}>Turn it back</button>
          </div>
        </div>
      )}
      {!isWorld && <div onKeyDownCapture={(e) => { enterOnTitle.current = autoFocusTitle && e.key === 'Enter'; }}>
      <InlineText
        testId="focus-title" as="div"
        value={title} editable={!!onEditTitle} multiline={false} autoFocus={autoFocusTitle}
        onSave={(t) => {
          void onEditTitle?.(t);
          if (enterOnTitle.current) {
            enterOnTitle.current = false;
            const body = cardRef.current?.querySelector('[data-inline-text="focus-body"]') as HTMLElement | null;
            try { body?.focus({ preventScroll: true }); } catch { body?.focus(); }
          }
        }}
        placeholder={onEditTitle && !isWorld ? (isScene ? 'Name this scene' : subject.entity.type === 'character' ? 'Name this character' : 'Untitled') : 'Untitled'}
        style={{ fontSize: 19, fontWeight: 650, lineHeight: 1.25, marginTop: 10, borderRadius: 3, margin: '10px -4px 0', padding: '1px 4px' }}
      />
      </div>}
      {/* The telling, edited where it sits (Ben: inline, Linear-style; no box). */}
      {/* Paper: the writer's bold, italic and underline drawn and edited
          (a sticky's formatting survives becoming a card: Ben, 2026-11-01). */}
      <InlineText
        testId="focus-body" paper
        value={body}
        editable={!!onEditBody}
        onSave={(t) => { void onEditBody?.(t); }}
        placeholder={onEditBody ? 'No telling yet. Click to write one.' : ''}
        style={{ fontSize: isWorld ? 15 : 13, lineHeight: 1.5, color: isWorld ? (dark ? '#f6f4ee' : '#3b3a33') : dark ? '#c9c9d1' : '#444', fontFamily: isWorld ? SERIF : undefined, borderRadius: 3, margin: isWorld ? '12px -4px 0' : '0 -4px', padding: '1px 4px' }}
      />
      {extra}
      {peerRead && <PeerReadSection text={peerRead.text} busy={peerRead.busy} note={peerRead.note} dark={dark} frame={frame} />}
      {editor && (
        <div data-focus-editor style={{ flex: 1, minHeight: 0, margin: '8px -20px -14px', borderTop: `1px solid ${dark ? '#2a2a30' : '#eadfcc'}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: 'auto' }} onKeyDown={(e) => e.stopPropagation()}>
          {editor}
        </div>
      )}
    </div>
  );
}

/** The category chips, floating above the opened card, the master orbit's
 *  mini toolbar: the chip is the only place a category announces itself,
 *  so the count rides it. */
export const CHIP_H = 30; export const CHIP_GAP = 6;
/** The pills (2026-10-13): an icon per category in the header's family,
 *  the count as a small badge, the same quiet-until-hovered treatment. The
 *  Cast pill carries a joined "+" that opens the add-to-cast menu. */
const CHIP_CSS = `
.sbx-chip{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 10px 0 9px;font:600 12px/1 system-ui,sans-serif;letter-spacing:.1px;border-radius:8px;cursor:pointer;white-space:nowrap;border:1px solid var(--line);background:var(--bg);color:var(--ink);box-shadow:var(--sh);transition:color 140ms,border-color 140ms,background 140ms,transform 140ms,box-shadow 140ms}
.sbx-chip>.sbx-chip-ico{color:var(--icoq);transition:color 140ms}
.sbx-chip:hover,.sbx-chip:focus-visible{transform:translateY(-1px);border-color:var(--lineh);outline:none}
.sbx-chip:hover>.sbx-chip-ico,.sbx-chip:focus-visible>.sbx-chip-ico{color:var(--a)}
.sbx-chip[data-on]{color:var(--a);border-color:var(--a);background:var(--tint)}
.sbx-chip[data-on]>.sbx-chip-ico{color:var(--a)}
.sbx-chip>.sbx-chip-n{min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font:600 10.5px/1 system-ui,sans-serif;background:var(--nbg);color:var(--nfg)}
.sbx-chip[data-on]>.sbx-chip-n{background:var(--a);color:#fff}
.sbx-chip[data-empty]>.sbx-chip-n{opacity:.55}
.sbx-chip-join{display:inline-flex}
.sbx-chip-join>.sbx-chip:first-child{border-top-right-radius:0;border-bottom-right-radius:0}
.sbx-chip-join>.sbx-chip-plus{border-top-left-radius:0;border-bottom-left-radius:0;margin-left:-1px;padding:0 8px;color:var(--icoq)}
.sbx-chip-join>.sbx-chip-plus:hover,.sbx-chip-join>.sbx-chip-plus[aria-expanded="true"]{color:var(--a);background:var(--tint);border-color:var(--a);transform:translateY(-1px)}
@media (prefers-reduced-motion: reduce){.sbx-chip{transition:none}.sbx-chip:hover{transform:none}}
`;
export type AddPickSpec = { options: Array<{ id: string; name: string; color?: string }>; onPick: (id: string) => void;
  /** A last row that makes a new one instead (a subplot's "New scene"). */
  onNew?: { label: string; run: () => void };
  /** The menu stays open after a pick, for picking several in a row. */
  stayOpen?: boolean };
export function FocusChips({ slides, idx, onPick, accent, dark, draft, vertical = false, extra, addCast, addTie, addScene, addSubplot }: { slides: FocusSlide[]; idx: number; onPick: (i: number) => void; accent: string; dark: boolean;
  /** One more control at the end of the row. */
  extra?: React.ReactNode;
  /** A scene's pages, as the rightmost chip (Ben, 2026-10-08: the draft is an orbit pill). */
  draft?: { drafted: boolean; onOpen?: () => void };
  /** The characters not yet in this scene's cast, and the pick (2026-10-13:
   *  a "+" joined to the Cast pill, not the system dropdown). */
  addCast?: { options: Array<{ id: string; name: string }>; onPick: (id: string) => void };
  /** The same "+" on a character's Relationships pill: tie them to someone. */
  addTie?: { options: Array<{ id: string; name: string }>; onPick: (id: string) => void };
  /** The same "+" on a subplot's Scenes pill: the scenes not in it, in story
   *  order, and a new one (Ben, 2026-11-07). */
  addScene?: AddPickSpec;
  /** And on a scene's Subplots pill: the subplots it is not in. */
  addSubplot?: AddPickSpec;
  /** While writing the chips stand in a column over the left margin. */
  vertical?: boolean }) {
  const a = dark ? liftColor(accent, 0.25) : accent;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const vars = {
    ['--a' as any]: a,
    ['--tint' as any]: `color-mix(in srgb, ${a} ${dark ? 16 : 8}%, ${dark ? '#1a1a1e' : '#fff'})`,
    ['--line' as any]: dark ? '#2a2a30' : '#e3e5ea',
    ['--lineh' as any]: dark ? '#44444d' : '#c9ccd3',
    ['--bg' as any]: dark ? '#1a1a1e' : '#fff',
    ['--ink' as any]: dark ? '#c8c8d0' : '#3d4250',
    ['--icoq' as any]: dark ? '#7a7a84' : '#9a9ea8',
    ['--nbg' as any]: dark ? '#26262c' : '#f1f2f5',
    ['--nfg' as any]: dark ? '#a0a0aa' : '#6b7080',
    ['--sh' as any]: dark ? '0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(120,90,40,.10)',
  } as React.CSSProperties;
  return (
    <div data-focus-chips onPointerDown={stop} onPointerUp={stop} style={{ ...vars, display: 'flex', flexWrap: vertical ? 'wrap' : 'nowrap', whiteSpace: 'nowrap', justifyContent: vertical ? 'flex-end' : 'center', gap: CHIP_GAP, fontFamily: 'system-ui, sans-serif' }}>
      <style>{CHIP_CSS}</style>
      {slides.map((s, i) => {
        const on = i === idx;
        const count = s.id === 'stickies' || s.id === 'peer' ? s.count : s.rows.length;
        const chip = (
          <button
            key={s.id} type="button" className="sbx-chip" data-focus-slide={s.id} onClick={() => onPick(i)}
            style={s.id === 'peer' ? { ['--a' as any]: dark ? PEER_BLUE_LIGHT : PEER_BLUE_INK, ['--tint' as any]: dark ? 'rgba(84,191,219,.14)' : 'rgba(84,191,219,.12)' } : undefined}
            {...(on ? { 'data-on': '' } : {})} {...(count ? {} : { 'data-empty': '' })}
          >
            <span className="sbx-chip-ico">{slideIcon(s.id)}</span>
            <span>{s.label}</span>
            <span className="sbx-chip-n">{count}</span>
          </button>
        );
        const add: AddPickSpec | undefined = s.id === 'cast' ? addCast : s.id === 'relationships' ? addTie : s.id === 'scenes' ? addScene : s.id === 'subplots' ? addSubplot : undefined;
        if (add && (add.options.length || add.onNew)) {
          const pick = s.id === 'cast' ? { title: 'Add to the cast', test: 'data-add-cast', find: 'Find a character', none: 'No one by that name.' }
            : s.id === 'relationships' ? { title: 'Tie them to', test: 'data-add-tie', find: 'Find a character', none: 'No one by that name.' }
              : s.id === 'scenes' ? { title: 'Add a scene', test: 'data-add-scene', find: 'Find a scene', none: 'No scene by that name.' }
                : { title: 'Put it in a subplot', test: 'data-add-subplot', find: 'Find a subplot', none: 'No subplot by that name.' };
          return (
            <span key={s.id} className="sbx-chip-join">
              {chip}
              <AddCastPick options={add.options} onPick={add.onPick} onNew={add.onNew} stayOpen={add.stayOpen} dark={dark} title={pick.title} testAttr={pick.test} find={pick.find} none={pick.none}
                icon={s.id === 'cast' || s.id === 'relationships' ? <IconPersonPlus /> : <IconPlus />} />
            </span>
          );
        }
        return chip;
      })}
      {draft && (
        <button
          type="button" className="sbx-chip" data-focus-draft onClick={draft.onOpen} title={draft.drafted ? 'Open its pages' : 'Write this scene'}
          {...(draft.drafted ? { 'data-on': '' } : {})}
          style={{ marginLeft: vertical ? 0 : 6, marginTop: vertical ? 6 : 0, cursor: draft.onOpen ? 'pointer' : 'default' }}
        >
          <span className="sbx-chip-ico">{slideIcon('draft')}</span>
          <span>{draft.drafted ? 'Drafted' : 'Draft'}</span>
        </button>
      )}
      {extra}
    </div>
  );
}

/** Add to the cast: the "+" joined to the Cast pill, opening a small menu in
 *  the board's own look (the SpeakerPick pattern: portalled, filter when the
 *  list is long, arrows and Enter, Esc or a click away closes). */
function AddCastPick({ options, onPick, onNew, stayOpen = false, dark, title = 'Add to the cast', testAttr = 'data-add-cast', find = 'Find a character', none = 'No one by that name.', icon, trigger, verb = 'Add', noDot = false }: { options: Array<{ id: string; name: string; color?: string }>; onPick: (id: string) => void; onNew?: { label: string; run: () => void }; stayOpen?: boolean; dark: boolean; title?: string; testAttr?: string; find?: string; none?: string; icon?: React.ReactNode;
  /** A worded button instead of the "+" chip (the strip card's Add a scene, a scene's word on a subplot). */
  trigger?: { label: string; style?: React.CSSProperties };
  /** The word shown on the hovered row. */
  verb?: string;
  /** Rows without the colour dot (a list of words). */
  noDot?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const W = 230;
  const opts = options.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8), top: r.bottom + 6 });
  };
  const close = () => setOpen(false);
  const pick = (id: string) => { onPick(id); if (stayOpen && options.length > 1) setHi((h) => Math.max(0, Math.min(h, opts.length - 2))); else close(); };
  useLayoutEffect(() => { if (!open) return; if (options.length > 6) filterRef.current?.focus({ preventScroll: true }); else menuRef.current?.focus({ preventScroll: true }); }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return; setOpen(false); };
    const reflow = () => place();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true); };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); btnRef.current?.focus({ preventScroll: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = opts[Math.min(hi, opts.length - 1)]; if (o) pick(o.id); }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const charC = dark ? liftColor(getEntityColor('character' as any) || '#e67e22', 0.25) : (getEntityColor('character' as any) || '#e67e22');
  return (
    <>
      <button
        ref={btnRef} type="button" className={trigger ? undefined : 'sbx-chip sbx-chip-plus'} style={trigger?.style} {...{ [testAttr]: '' }} aria-haspopup="listbox" aria-expanded={open} aria-label={trigger ? undefined : title} title={title}
        onClick={(e) => { e.stopPropagation(); if (open) close(); else { place(); setQ(''); setHi(0); setOpen(true); } }}
        onPointerDown={stop} onPointerUp={stop}
      >
        {trigger ? trigger.label : (icon ?? <IconPersonPlus />)}
      </button>
      {open && at && createPortal(
        <div
          ref={menuRef} data-add-cast-menu role="listbox" aria-label={title} tabIndex={-1}
          onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop} onKeyDown={onKey}
          style={{
            position: 'fixed', left: at.left, top: at.top, width: W, zIndex: 1000, outline: 'none',
            background: dark ? '#1c1c20' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e3e0d6'}`, borderRadius: 10,
            boxShadow: '0 14px 36px rgba(0,0,0,.22)', padding: 5, fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: dark ? '#7a7a84' : '#9a9ea8', padding: '5px 8px 6px' }}>{title}</div>
          {options.length > 6 && (
            <input
              ref={filterRef} value={q} placeholder={find} aria-label={find}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '6px 8px', marginBottom: 4, borderRadius: 6, border: `1px solid ${dark ? '#2e2e35' : '#e6e3da'}`, background: dark ? '#141417' : '#fbfaf7', color: dark ? '#e6e6ea' : '#1d2230', outline: 'none' }}
            />
          )}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {opts.map((c, i) => (
              <button
                key={c.id} type="button" role="option" aria-selected={false} data-add-cast-option={c.id}
                onMouseEnter={() => setHi(i)} onClick={() => pick(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                  padding: '7px 8px', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550,
                  background: i === hi ? `color-mix(in srgb, ${c.color ?? charC} ${dark ? 18 : 10}%, transparent)` : 'transparent',
                  color: dark ? '#e6e6ea' : '#1d2230',
                }}
              >
                {!noDot && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: c.color ?? charC }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.name || 'Untitled'}</span>
                <span aria-hidden style={{ fontSize: 11, color: dark ? '#7a7a84' : '#9a9ea8', opacity: i === hi ? 1 : 0, transition: 'opacity 120ms' }}>{verb}</span>
              </button>
            ))}
            {!opts.length && !(onNew && !q.trim()) && <div style={{ padding: '6px 8px', fontSize: 12, color: dark ? '#9a9aa4' : '#888' }}>{none}</div>}
          </div>
          {onNew && (
            <button type="button" data-add-new onClick={() => { close(); onNew.run(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', borderTop: options.length ? `1px solid ${dark ? '#2a2a30' : '#eeebe3'}` : 'none', marginTop: options.length ? 4 : 0,
                padding: '8px 8px 6px', borderRadius: 0, font: 'inherit', fontSize: 12.5, fontWeight: 600, background: 'transparent', color: dark ? '#c8c8d0' : '#3d4250' }}>
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1, width: 8, textAlign: 'center' }}>+</span>{onNew.label}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** The "+" menu, for other places that pick from a list (the strip card). */
export const AddPick = AddCastPick;

/** A member of the slide that is NOT on this board (a character on the
 *  master, a location kept off the board): a small dashed card beside the
 *  opened one, a door to its sheet. */
export function GhostSatellite({ row, dark, onOpen, solid = false }: { row: FocusRow; dark: boolean; onOpen: () => void;
  /** Drawn as a real card (the Where margin while writing), not a dashed stand-in. */
  solid?: boolean }) {
  const c = dark ? liftColor(row.accent || '#888', 0.25) : (row.accent || '#888');
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button
      type="button" data-focus-ghost={row.id} onClick={onOpen} onPointerDown={stop} onPointerUp={stop} title="Open its sheet"
      style={{
        width: GHOST_W, height: GHOST_H, boxSizing: 'border-box', textAlign: 'left', font: 'inherit', fontFamily: 'system-ui, sans-serif', cursor: 'pointer',
        padding: '9px 14px', borderRadius: 3, border: `1.5px ${solid ? 'solid' : 'dashed'} ${c}`, background: solid ? (dark ? '#1e1e22' : '#fffdf7') : (dark ? 'rgba(30,30,34,.85)' : 'rgba(255,253,247,.85)'),
        color: dark ? '#e8e8ec' : '#1d2230', display: 'flex', flexDirection: 'column', gap: 4,
        boxShadow: dark ? '0 1px 2px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.35)' : '0 1px 2px rgba(0,0,0,.06), 0 6px 16px rgba(120,90,40,.08)',
      }}
    >
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: c, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.kicker}</span>
      <span style={{ fontSize: 13.5, fontWeight: 650, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{row.title}</span>
      {row.sub && <span style={{ fontSize: 10.5, color: dark ? '#82828c' : '#888', marginTop: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.sub}</span>}
    </button>
  );
}

/** One of the card's stickies, hung beside it as paper: the whole text,
 *  edited in place (Linear-style) after a click; the board drags it. */
export function StickySatellite({ f, i, dark, editing = false, onEdit, onDoneEdit, placeholder, editor, onMenu }: { f: SandboxFragment; i: number; dark: boolean; editing?: boolean; onEdit?: (text: string) => void; onDoneEdit?: () => void; placeholder?: string;
  /** The full sticky editor (words, speaker, label, done, delete), shown while editing. */
  editor?: React.ReactNode;
  /** A pinned sticky has the sticky menu too, Unpin among it (Ben,
   *  2026-11-01: right-click only, no button on the sticky). */
  onMenu?: (at: { x: number; y: number }) => void }) {
  const pp = stickyPaper(f);
  return (
    <div
      data-focus-sticky={f.id} title={editing ? undefined : f.source && f.source !== f.text ? f.source : undefined}
      onContextMenu={onMenu && !editing ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }); } : undefined}
      style={{
        position: 'relative', width: STICKY_SAT_W, boxSizing: 'border-box', padding: '9px 10px 10px', borderRadius: 1, cursor: editing ? 'text' : 'grab',
        background: dark ? pp.dark : pp.light, color: dark ? '#f6f4ee' : '#3b3a33', fontSize: 11.5, lineHeight: 1.35, fontFamily: SERIF,
        boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${pp.glow}, 0 0 14px ${pp.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
      }}
    >
      {editing && editor ? editor : f.kind === 'dialogue' && !editing
        ? <DialogueFace text={f.text} speaker={f.speaker} dark={dark} size={11.5} />
        : onEdit && editing
          ? <InlineText testId={`sat-${f.id}`} paper={f.kind !== 'dialogue'} value={f.kind === 'dialogue' ? bareLine(f.text) : f.text} placeholder={placeholder} autoFocus={editing} editable={editing} onSave={(t) => { onEdit(t); onDoneEdit?.(); }} onCancel={onDoneEdit} style={{ fontFamily: f.kind === 'dialogue' ? SCRIPT_FACE : SERIF, fontSize: 11.5, lineHeight: 1.35, userSelect: 'text', ...(f.kind === 'dialogue' ? { textAlign: 'center' } : {}) }} />
          : <RichText text={f.text} style={{ userSelect: 'none' }} />}
      {editing && !editor && onEdit && f.kind !== 'dialogue' && <PaperBar dark={dark} />}
      {!(editing && editor) && <LineNote text={f.label} center={f.kind === 'dialogue'} />}
    </div>
  );
}

/** The label a tie line wears (2026-10-15): the tie read from the viewer's
 *  side, on a small pill at the line's middle. A click edits it in place
 *  (Enter saves, Esc leaves it), and Remove takes the tie away. */
export function TieLabel({ label, at, dark, accent, editing, canRemove, onEdit, onSave, onRemove, onCancel, instant = false }: {
  label: string;
  at: { x: number; y: number };
  /** Something is being dragged: follow the line at once, no glide (the
   *  line itself jumps with the card, so a gliding label trails it). */
  instant?: boolean;
  dark: boolean;
  accent: string;
  editing: boolean;
  canRemove: boolean;
  onEdit: () => void;
  onSave: (text: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(label);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (editing) { setText(label === 'related' ? '' : label); window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0); } }, [editing, label]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const a = dark ? liftColor(accent, 0.25) : accent;
  const box: React.CSSProperties = {
    position: 'absolute', left: 0, top: 0, transform: `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`,
    zIndex: editing ? 40 : 33, fontFamily: 'system-ui, sans-serif', transition: instant ? 'none' : 'transform 700ms cubic-bezier(.2,.7,.2,1)',
  };
  if (!editing) {
    return (
      <button
        type="button" data-tie-label onPointerDown={stop} onPointerUp={stop} onClick={(e) => { e.stopPropagation(); onEdit(); }}
        title="Edit how they are tied"
        style={{ ...box, font: '600 11px/1 system-ui, sans-serif', padding: '5px 9px', borderRadius: 999, cursor: 'text', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', border: `1px solid ${a}`, background: dark ? '#1a1a1e' : '#fff', color: a, boxShadow: dark ? '0 2px 8px rgba(0,0,0,.45)' : '0 2px 8px rgba(120,90,40,.12)' }}
      >
        {label}
      </button>
    );
  }
  return (
    <div data-tie-editor onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop}
      style={{ ...box, display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 10, border: `1px solid ${a}`, background: dark ? '#1a1a1e' : '#fff', boxShadow: '0 10px 28px rgba(0,0,0,.22)' }}>
      <input
        ref={inputRef} value={text} placeholder="how they are tied" aria-label="How they are tied"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) onSave(text.trim()); } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        style={{ font: '500 12px/1.2 system-ui, sans-serif', width: 170, padding: '5px 7px', borderRadius: 6, border: `1px solid ${dark ? '#2e2e35' : '#e6e3da'}`, background: dark ? '#141417' : '#fbfaf7', color: dark ? '#e6e6ea' : '#1d2230', outline: 'none' }}
      />
      <button type="button" data-tie-save disabled={!text.trim()} onClick={() => text.trim() && onSave(text.trim())}
        style={{ font: '700 11px/1 system-ui, sans-serif', padding: '6px 9px', borderRadius: 6, border: 'none', background: a, color: '#fff', cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5 }}>Save</button>
      {canRemove && <button type="button" data-tie-remove onClick={onRemove} title="Remove this tie"
        style={{ font: '600 11px/1 system-ui, sans-serif', padding: '6px 8px', borderRadius: 6, border: `1px solid ${dark ? '#2e2e35' : '#e4e4ea'}`, background: 'transparent', color: dark ? '#c8c8d0' : '#6b7080', cursor: 'pointer' }}>Remove</button>}
    </div>
  );
}
