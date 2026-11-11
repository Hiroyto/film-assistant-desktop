// components/Freeform/corkboard/sandboxBoard.tsx (FIL-641 board half, build order step 5)
//
// THE SANDBOX BOARD, presentational. Parked cards as index cards, stickies
// as paper squares, stickies that landed near each other drawn as one group
// with no name, dump tokens tethered to the loose stickies they left, a
// dashed thread between parked scenes in order, free layout, drag. The page
// (pages/app/freeform-sandbox.tsx) owns data, auth, the dump and position
// persistence; this file owns what is on the stage and how it moves.
//
// Visual language locked 2026-10-01 (ANCHOR-sandbox.md section 8, "Paper";
// mock https://claude.ai/artifact/E8G4MvMvXwazFWuX5uDZH7): index cards in
// index-card proportion (scene 300 by 140, character 220 by 96 since the control row left), a 1.5px
// outline in the entity color, one ruled line under the header, 3px radius,
// no tilt, no texture. Stickies 150 wide (a story sticky 300, in the top
// row), square to the board, color by kind, one shadow; dark mode keeps
// light ink and adds an edge glow. Attached material rides its card's edge
// as 22px mini stickies. Dump tokens are small numbered squares with a
// count; tethers (dashed) only to homeless stickies.
//
// Vocabulary (section 14): card, sticky, label, dump, ready, world, question,
// done. The mock wrote "parked" on cards and the kind on stickies; section 14
// cuts both, so a sticky says "dump 1", never the state. A card's place
// after another is the dashed thread, not words on the card (2026-10-09).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LabelSet, ProjectEdges, ProjectEntity, SandboxBadge, SandboxFragment, WorldEntry } from '../../../lib/freeformApi';
import { EVOKES_TRANSITIONS, EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS } from '../../../lib/freeformApi';
import { getEntityColor, hexToRgba } from '../entityColors';
import { paperFor, stickyPaper, stickyPaperKey } from './sandbox';
import { InlineText } from './inlineText';
import { PaperBar, RichText, plainOf } from './richText';
import { DropConfirm, GroupMenu, StickyMenu, type MenuCard, type TurnKind } from './stickyMenu';
import { liftColor, useThemeMode } from './theme';
import { ColorDot, colorIn, colorMatches, shade } from './storylineLabels';
import { CastCtx, DialogueFace, LineNote, NOTE_STYLE, SpeakerPick, SCRIPT_FACE, bareLine, type CastMember } from './dialogue';
import { TrashButton } from './sandboxTrash';
import { TemplateTag } from './sandboxTemplates';
import { FOCUS_W, WRITING_W, GHOST_W, GHOST_H, STICKY_SAT_W, STICKY_SAT_H, CHIP_H, AddPick, FocusCard, FocusChips, GhostSatellite, StickySatellite, TieLabel, GlobeIcon, focusSlides, pairTies, tieLabel, type FocusRow, type Tie } from './sandboxFocus';
import { ringLabel, ringSlots, tieCurve, tieLabelW, unfoldAround, webLabelSpots, webLayout, type Rect } from './sandboxRing';
import { connectDiff } from './sandboxConnect';
import { beatPlaceAt, sceneLine } from './sandboxBeats';
import { TL, timelineIndexAt, timelineLayout } from './sandboxTimeline';
import { columnSlots, columnsBlockIndexAt, columnsLayout, columnsSceneIndexAt, moveBlock, stretchOf } from './sandboxColumns';
import { PEER_CSS, PEER_STICKY_W, PeerMini, PeerQuestionSticky, peerHomes, peerStickyHeight, peerStickySize } from './sandboxPeer';

export type Pos = { x: number; y: number };

// Heights trimmed 2026-10-09 once the control row left the collapsed card;
// character back to 112 the same day so two summary lines fit under a one-line name.
export const SCENE_W = 300; export const SCENE_H = 140;
export const CHAR_W = 220; export const CHAR_H = 112;
/** Template material (2026-10-14) wears a mark until the writer edits it. */
export function isTemplateItem(it: StageItem): boolean {
  if (it.kind === 'card') return String((it.entity as any).template ?? '') === '1';
  if (it.kind === 'world') return !!it.entry.template;
  if (it.kind === 'sticky') return !!it.fragment.template;
  if (it.kind === 'group') return it.members.length > 0 && it.members.every((m) => !!m.template);
  return false;
}
/** Where a line from a box's centre toward (tx, ty) crosses its edge, and
 *  which axis it leaves along (the master orbit's edgePoint). */
function edgeOf(b: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy, axis: 'x' as const };
  const tX = dx !== 0 ? (b.w / 2) / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? (b.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t), axis: (tX <= tY ? 'x' : 'y') as 'x' | 'y' };
}
export const SMALL_W = 220; export const SMALL_H = 80;
export const STICKY_W = 150;
export const STORY_W = 300;
export const WORLD_GREEN = '#8bbf7a';
export const TOKEN = 26;
const GROUP_PAD = 10;
/** A sticky's drawn height before its words need more (StickyNote's minHeight). */
const STICKY_REST_H = 104;
/** The tallest an unsized sticky grows at rest (Ben, 2026-11-02: the gentler
 *  version: only very long stickies are capped, with a fade; a click shows
 *  them whole). The layout's estimate uses the same cap. */
const STICKY_CAP_H = 200;

export function cardSize(type: string): { w: number; h: number } {
  if (type === 'event' || type === 'sequence') return { w: SCENE_W, h: SCENE_H };
  if (type === 'character') return { w: CHAR_W, h: CHAR_H };
  return { w: SMALL_W, h: SMALL_H };
}

/** FREE RESIZE FOR SCENES (Ben, 2026-11-05: "scene cards also need to be
 *  freely resizable, like stickies"): a scene the writer sized carries
 *  `card_size` (the page reads it from sandbox#size#<id>). */
export const SCENE_MIN = { w: 220, h: 110 }, SCENE_MAX = { w: 720, h: 560 };
export const BEAT_MARK = { w: 260, h: 70 };
/** A beat is a checkpoint, smaller than a scene: its words and a count. */
export const BEAT_CARD = { w: 260, h: 70 };
export function sizedCard(e: ProjectEntity): { w: number; h: number } {
  if (e.type === 'sequence' && (e as any).beat_done) return BEAT_MARK;
  if (e.type === 'sequence') return BEAT_CARD;
  const z = (e as any).card_size as { w: number; h: number } | undefined;
  return e.type === 'event' && z && z.w > 0 && z.h > 0 ? z : cardSize(e.type);
}

export function cardTitle(e: ProjectEntity): string {
  return rawTitle(e) || unnamedTitle(e.type);
}
/** What a card with no name yet is called (Ben, 2026-11-01: "unnamed card
 *  just says unnamed"; its kind is on the card's head already). */
export function unnamedTitle(_type?: string): string {
  return 'Unnamed';
}
/** The card's own name, '' when it has none yet (a card + New just made):
 *  the name field shows its placeholder, never the word Untitled as text. */
export function rawTitle(e: ProjectEntity): string {
  return String(e.working_title || e.working_name || '').trim();
}

/** One stage item the page lays out. A huddle is one item (`members`) so it
 *  moves as one thing (anchor section 6). A token is the dump drawn small. */
export type StageItem =
  | { id: string; kind: 'card'; entity: ProjectEntity; attached: SandboxFragment[]; after?: string }
  | { id: string; kind: 'world'; entry: WorldEntry; attached: SandboxFragment[]; touchTitles: string[] }
  | { id: string; kind: 'sticky'; fragment: SandboxFragment; dumpNo: number }
  | { id: string; kind: 'group'; members: SandboxFragment[]; badge?: SandboxBadge; dumpNos: number[] }
  | { id: string; kind: 'token'; dumpId: string; dumpNo: number; looseIds: string[] };

export interface StageInput {
  entities: ProjectEntity[];
  fragments: SandboxFragment[];
  badges: SandboxBadge[];
  /** FIL-653 world entries; absent from older reads. */
  world?: WorldEntry[];
  /** Event to Event, forward. Only pairs where both are parked draw. */
  precedes: Array<{ from: string; to: string }>;
  /** FIL-709: each scene's sequence colour, so the Sequences set can filter and paint. */
  sequenceColors?: Map<string, string>;
}

/** Dump numbers: the distinct dump ids that left stickies, in the order
 *  they first appear by fragment createdAt. 1-based. */
export function dumpNumbers(fragments: SandboxFragment[]): Map<string, number> {
  const first = new Map<string, string>();
  for (const f of fragments) {
    if (!f.dumpId || f.fromAnswer) continue;
    const cur = first.get(f.dumpId);
    if (!cur || f.createdAt < cur) first.set(f.dumpId, f.createdAt);
  }
  const order = [...first.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return new Map(order.map(([id], i) => [id, i + 1]));
}

/** Cards, stickies, groups and tokens from a board payload. */
export function stageItemsFrom(input: StageInput): StageItem[] {
  const { entities, fragments, badges, precedes, world = [], sequenceColors } = input;
  const items: StageItem[] = [];
  const nums = dumpNumbers(fragments);
  // Locations stay off the board for now (Ben, 2026-10-08): they are kept
  // (parked, reachable from a scene's Where slide and its sheet) but not
  // drawn as cards; the board is scenes, characters and what is said.
  // Relationship cards too (Ben, 2026-10-13): a sandbox dump no longer mints
  // them, and ones parked before that stay in the graph, off the board.
  // Sequences live in the strip, not on the board (FIL-709, Ben 2026-10-31).
  // BEATS (sandbox-beats, 2026-11-05): a sequence is a beat card on the board,
  // on the line with the scenes; a held one waits off it.
  const parked = new Map(entities.filter((e) => !e.deleted_at && e.state === 'parked' && e.type !== 'arc' && e.type !== 'location' && e.type !== 'relationship' && !(e.type === 'sequence' && String((e as any).staged ?? '') === '1')).map((e) => {
    const sc = sequenceColors?.get(e.id);
    return [e.id, sc ? { ...e, set_colors: { ...((e as any).set_colors ?? {}), sequences: sc } } as ProjectEntity : e];
  }));
  const titleOf = (id: string) => { const e = parked.get(id); return e ? cardTitle(e) : ''; };
  const afterOf = new Map<string, string>();
  // The scene RIGHT before each one: of its leaders, the one no other
  // leader comes after. A placement that slots a scene between two others
  // (Ben, 2026-11-04) keeps the old link beside the two new ones; picking
  // the first leader drew the thread past the new scene.
  const leadersOf = new Map<string, string[]>();
  for (const p of precedes) if (parked.has(p.from) && parked.has(p.to) && p.from !== p.to) leadersOf.set(p.to, [...(leadersOf.get(p.to) ?? []), p.from]);
  const comesAfter = (id: string, ancestor: string) => {
    const seen = new Set<string>(); const stack = [...(leadersOf.get(id) ?? [])];
    while (stack.length) { const v = stack.pop()!; if (v === ancestor) return true; if (seen.has(v)) continue; seen.add(v); stack.push(...(leadersOf.get(v) ?? [])); }
    return false;
  };
  leadersOf.forEach((ls, id) => {
    const near = ls.find((l) => !ls.some((o) => o !== l && comesAfter(o, l))) ?? ls[0];
    afterOf.set(id, titleOf(near));
  });
  // Where a fragment hangs on this board: its card; or, for a line with no
  // scene, the character who says it when that card is here (2026-10-12: a
  // line added on a character also showed loose on the board, twice over).
  const homeOf = (f: SandboxFragment): string | null => f.attachedTo ?? (f.kind === 'dialogue' && f.speaker && parked.has(f.speaker) ? f.speaker : null);
  const attachedBy = new Map<string, SandboxFragment[]>();
  for (const f of fragments) {
    const home = f.open ? homeOf(f) : null;
    if (!home) continue;
    const arr = attachedBy.get(home) ?? [];
    arr.push(f);
    attachedBy.set(home, arr);
  }
  for (const e of parked.values()) {
    items.push({ id: e.id, kind: 'card', entity: e, attached: attachedBy.get(e.id) ?? [], after: afterOf.get(e.id) });
  }
  const titleOfAny = new Map(entities.filter((e) => !e.deleted_at).map((e) => [e.id, cardTitle(e)]));
  for (const w of world) {
    items.push({ id: w.id, kind: 'world', entry: w, attached: attachedBy.get(w.id) ?? [], touchTitles: (w.touches ?? []).map((tc) => titleOfAny.get(tc.id) ?? '').filter(Boolean) });
  }
  const byCluster = new Map<string, SandboxFragment[]>();
  const looseByDump = new Map<string, string[]>();
  // A story sticky is overview material pinned at the top, not homeless:
  // tokens tether only to loose idea / note / dialogue stickies.
  const noteLoose = (f: SandboxFragment) => { if (!f.dumpId || f.kind === 'story' || f.fromAnswer) return; const arr = looseByDump.get(f.dumpId) ?? []; arr.push(f.id); looseByDump.set(f.dumpId, arr); };
  for (const f of fragments) {
    if (!f.open || homeOf(f)) continue;
    noteLoose(f);
    if (f.clusterId) {
      const arr = byCluster.get(f.clusterId) ?? [];
      arr.push(f);
      byCluster.set(f.clusterId, arr);
    } else items.push({ id: f.id, kind: 'sticky', fragment: f, dumpNo: nums.get(f.dumpId) ?? 0 });
  }
  const badgeBy = new Map(badges.map((b) => [b.clusterId, b]));
  for (const [cid, members] of byCluster) {
    members.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (members.length === 1 && !badgeBy.has(cid)) items.push({ id: members[0].id, kind: 'sticky', fragment: members[0], dumpNo: nums.get(members[0].dumpId) ?? 0 });
    else items.push({ id: `group:${cid}`, kind: 'group', members, badge: badgeBy.get(cid), dumpNos: [...new Set(members.map((m) => nums.get(m.dumpId) ?? 0))] });
  }
  for (const [dumpId, no] of nums) {
    items.push({ id: `dump:${dumpId}`, kind: 'token', dumpId, dumpNo: no, looseIds: looseByDump.get(dumpId) ?? [] });
  }
  return items;
}

/** Where a new card goes (Ben, 2026-10-12): into open space in the part of
 *  the board the writer is looking at, the free spot nearest the middle of
 *  the view; only when the view has no room does it go past the right-hand
 *  edge of what is there, and the board grows to the right. Searched on a
 *  fine grid (16px), so open space that does not line up with a card-sized
 *  step is found (the first version stepped by whole cards from the centre
 *  and sent a card off to the right with room in view). `view` and `taken`
 *  are in stage coordinates; `pad` is the air kept around every card. */
export function freeSpotIn(view: { x: number; y: number; w: number; h: number }, size: { w: number; h: number }, taken: Array<{ x: number; y: number; w: number; h: number }>, pad = 16): Pos {
  const clear = (x: number, y: number) => !taken.some((t) => x < t.x + t.w + pad && x + size.w + pad > t.x && y < t.y + t.h + pad && y + size.h + pad > t.y);
  const cx = view.x + view.w / 2 - size.w / 2, cy = view.y + view.h / 2 - size.h / 2;
  const x0 = Math.max(8, view.x + 8), x1 = view.x + view.w - size.w - 8;
  const y0 = Math.max(8, view.y + 8), y1 = view.y + view.h - size.h - 8;
  let best: Pos | null = null; let bestD = Infinity;
  for (let y = y0; y <= y1; y += 16) for (let x = x0; x <= x1; x += 16) {
    if (!clear(x, y)) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  if (best) return best;
  // No room in view: just past the right edge of what is there, level with
  // the middle of the view (the board widens; the focus pan travels to it).
  const y = Math.max(8, Math.round(Math.min(Math.max(cy, y0), Math.max(y0, y1))));
  const inBand = taken.filter((t) => t.y < y + size.h + pad && t.y + t.h + pad > y);
  const edge = Math.max(view.x + 8, ...inBand.map((t) => t.x + t.w + pad));
  if (clear(edge, y)) return { x: Math.round(edge), y };
  return { x: Math.round(Math.max(view.x + 8, ...taken.map((t) => t.x + t.w + pad))), y };
}

/** NOTHING OVERLAPS (FIL-715; Ben, 2026-11-01: "overlaps shouldn't happen
 *  but should just nudge cards around the sticky edges"). The boxes in
 *  `fixed` stay; any other box they overlap (with `pad` between) moves the
 *  shortest way clear of it (right, down, left or up, never off the board's
 *  top or left edge), and a box that moved holds its ground in turn, so a
 *  push carries on down a row. Returns only the boxes that moved. */
export function nudgeClear(fixed: string[], boxes: Array<{ id: string; x: number; y: number; w: number; h: number }>, pad = 16): Record<string, Pos> {
  const at = new Map(boxes.map((b) => [b.id, { ...b }]));
  const held = new Set(fixed.filter((id) => at.has(id)));
  const queue = [...held];
  const moved: Record<string, Pos> = {};
  let steps = 0;
  while (queue.length && steps < 400) {
    const a = at.get(queue.shift()!)!;
    for (const b of at.values()) {
      if (held.has(b.id)) continue;
      const over = b.x < a.x + a.w + pad && b.x + b.w + pad > a.x && b.y < a.y + a.h + pad && b.y + b.h + pad > a.y;
      if (!over) continue;
      steps += 1;
      const ways: Array<[number, number]> = [
        [a.x + a.w + pad - b.x, 0], [0, a.y + a.h + pad - b.y],
        [-(b.x + b.w + pad - a.x), 0], [0, -(b.y + b.h + pad - a.y)],
      ];
      const onBoard = ways.filter(([dx, dy]) => b.x + dx >= 8 && b.y + dy >= 8);
      // A way that lands on something already holding its ground is a last resort.
      const hits = ([dx, dy]: [number, number]) => [...held].some((id) => { const h = at.get(id)!; return b.x + dx < h.x + h.w + pad && b.x + dx + b.w + pad > h.x && b.y + dy < h.y + h.h + pad && b.y + dy + b.h + pad > h.y; });
      const free = onBoard.filter((w) => !hits(w));
      const ok = free.length ? free : onBoard;
      const [dx, dy] = ok.reduce((m, w) => (Math.abs(w[0]) + Math.abs(w[1]) < Math.abs(m[0]) + Math.abs(m[1]) ? w : m), ok[0] ?? ways[0]);
      b.x = Math.round(b.x + dx); b.y = Math.round(b.y + dy);
      moved[b.id] = { x: b.x, y: b.y };
      held.add(b.id);
      queue.push(b.id);
    }
  }
  return moved;
}

/** What a card or world entry drops when it turns back into a sticky, in
 *  plain words (FIL-718, Ben 2026-11-01: "warn first"). Its stickies are not
 *  lost (they come back beside it) and neither are its words. */
export function losesOnDemote(it: StageItem, edges: Partial<ProjectEdges> | null | undefined, items: StageItem[]): string[] {
  const id = it.id;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const out: string[] = [];
  if (it.kind === 'world') {
    const t = it.entry.touches?.length ?? 0;
    if (t) out.push(`${n(t, 'link', 'links')} to cards`);
    return out;
  }
  if (it.kind !== 'card') return out;
  const e = edges ?? {};
  const inOrder = [...(e.precedes ?? []), ...(e.sequence_precedes ?? []), ...(e.cross_precedes ?? [])].some((p) => p.from === id || p.to === id);
  if (inOrder) out.push('its place in the scene order');
  const type = it.entity.type;
  if (type === 'character') {
    const scenes = (e.involves ?? []).filter((x) => x.to === id).length;
    if (scenes) out.push(`its place in ${n(scenes, 'scene', 'scenes')}`);
    const ties = (e.structural ?? []).filter((x) => x.from === id || x.to === id).length;
    if (ties) out.push(n(ties, 'tie to another character', 'ties to other characters'));
  } else {
    const cast = (e.involves ?? []).filter((x) => x.from === id).length;
    if (cast) out.push(n(cast, 'character in it', 'characters in it'));
    if ((e.occurs_in ?? []).some((x) => x.from === id)) out.push('where it happens');
  }
  const world = items.filter((w) => w.kind === 'world' && (w.entry.touches ?? []).some((t) => t.id === id)).length;
  if (world) out.push(n(world, 'world card linked to it', 'world cards linked to it'));
  return out;
}

/** STICKIES WRAP THE CARD (Ben, 2026-10-12: "the stickies should gravitate
 *  and wrap near the card"). In order: down the right side, round the
 *  bottom-right corner and along the bottom, up the left side, then across
 *  the top (above `top`, the chips row). A second ring starts only when the
 *  first is full. Sizes in the stickies' order; positions back in the same
 *  order. `card` in stage coordinates. */
export function wrapAround(card: { x: number; y: number; w: number; h: number }, sizes: Array<{ w: number; h: number }>, opts: { gap?: number; top?: number } = {}): Pos[] {
  const gap = opts.gap ?? 14;
  const top = opts.top ?? 0;
  const colW = Math.max(0, ...sizes.map((z) => z.w));
  const rowH = Math.max(0, ...sizes.map((z) => z.h));
  const out: Pos[] = new Array(sizes.length);
  let i = 0;
  for (let ring = 0; i < sizes.length && ring < 8; ring++) {
    const ox = gap + ring * (colW + gap);
    const oy = gap + ring * (rowH + gap);
    // Right side, top to bottom.
    let y = card.y;
    while (i < sizes.length && y + sizes[i].h <= card.y + card.h + gap) { out[i] = { x: card.x + card.w + ox, y }; y += sizes[i].h + gap; i++; }
    // Bottom, from the right corner leftwards, corners included.
    let x = card.x + card.w + ox + colW;
    const left = card.x - ox - colW;
    while (i < sizes.length && x - sizes[i].w >= left - 1) { out[i] = { x: x - sizes[i].w, y: card.y + card.h + oy }; x -= sizes[i].w + gap; i++; }
    // Left side, bottom to top.
    y = card.y + card.h;
    while (i < sizes.length && y - sizes[i].h >= card.y - gap) { out[i] = { x: card.x - ox - sizes[i].w, y: y - sizes[i].h }; y -= sizes[i].h + gap; i++; }
    // Top, left to right, above the chips.
    x = card.x - ox - colW;
    const right = card.x + card.w + ox + colW;
    while (i < sizes.length && x + sizes[i].w <= right + 1) { out[i] = { x, y: card.y - top - oy - sizes[i].h }; x += sizes[i].w + gap; i++; }
  }
  for (; i < sizes.length; i++) out[i] = { x: card.x + card.w + gap, y: card.y + card.h + gap };
  return out.map((p) => ({ x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) }));
}

export function itemSize(item: StageItem): { w: number; h: number } {
  if (item.kind === 'card') return sizedCard(item.entity);
  if (item.kind === 'world') return { w: STORY_W, h: worldHeight(item.entry) };
  if (item.kind === 'sticky') return item.fragment.kind === 'story' ? { w: STORY_W, h: storyHeight(item.fragment) } : { w: stickyWidth(item.fragment), h: stickyHeight(item.fragment) };
  if (item.kind === 'token') return { w: TOKEN, h: TOKEN };
  const cols = Math.min(2, item.members.length);
  const rows = Math.ceil(item.members.length / cols);
  // A huddle lays its stickies out at the plain size, whatever one was given loose.
  const maxH = Math.max(...item.members.map((m) => stickyHeight({ ...m, size: undefined })));
  return { w: cols * (STICKY_W + 8) - 8 + GROUP_PAD * 2, h: rows * (maxH + 8) - 8 + GROUP_PAD * 2 + (item.badge ? 26 : 0) };
}

/** Lines a sticky's words take at about 24 characters a line, each of the
 *  writer's paragraphs starting a new one (FIL-714). */
function paperLines(text: string, perLine: number): number {
  return plainOf(text).split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
}
/** FREE RESIZE (Ben, 2026-10-31): a loose sticky the writer sized keeps that
 *  size; its words never clip, so it is never shorter than they need. */
export const STICKY_MIN = { w: 110, h: 72 }, STICKY_MAX = { w: 520, h: 640 };
function stickyWidth(f: SandboxFragment): number {
  return f.size && f.kind !== 'story' ? f.size.w : STICKY_W;
}
function stickyHeight(f: SandboxFragment): number {
  const w = stickyWidth(f);
  const lines = Math.max(2, paperLines(f.text, Math.max(12, Math.round((w - 24) / 5.25))));
  // Never shorter than the paper is drawn (STICKY_REST_H): a short sticky
  // estimated at its words alone (about 70) let a group cover its neighbour
  // after a nudge (2026-11-02).
  const need = Math.max(STICKY_REST_H, Math.min(STICKY_CAP_H, 36 + lines * 17 + (f.label ? 16 : 0)));
  return f.size && f.kind !== 'story' ? Math.max(f.size.h, need) : need;
}
function storyHeight(f: SandboxFragment): number {
  const lines = Math.max(1, Math.ceil(f.text.length / 52));
  return 34 + lines * 17 + (f.label ? 16 : 0);
}

/** Default positions for items without a saved one. Story stickies in a row
 *  at the top (the overview), cards in rows under them, loose stickies and
 *  groups to the right, each dump's token under the first loose thing it
 *  left. Deterministic in item order. */
export function defaultLayout(items: StageItem[], saved: Record<string, Pos>, stage = { w: 1400 }): Record<string, Pos> {
  // Every item gets a default slot whether or not it has a saved spot, and
  // the saved spots are laid OVER the defaults at the end. The first version
  // skipped saved items without advancing the row, so dragging one card
  // shifted every other card into the gap it left (Ben, 2026-10-08: "the
  // auto-arrange makes no sense"). Now a drag moves one card and nothing
  // else; a new thing takes the next free slot.
  const out: Record<string, Pos> = {};
  const story = items.filter((i) => i.kind === 'sticky' && i.fragment.kind === 'story');
  // Cards in STORY ORDER: scenes along their chains (heads first, each
  // followed by what comes after it), then characters, then the rest, then
  // world entries. The thread between scenes reads left to right.
  const cardItems = items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card');
  const scenes = cardItems.filter((i) => i.entity.type === 'event' || i.entity.type === 'sequence');
  const byTitle = new Map(scenes.map((i) => [cardTitle(i.entity), i]));
  const nextOf = new Map<string, Extract<StageItem, { kind: 'card' }>[]>();
  for (const sc of scenes) if (sc.after && byTitle.has(sc.after)) { const prev = byTitle.get(sc.after)!; nextOf.set(prev.id, [...(nextOf.get(prev.id) ?? []), sc]); }
  const orderedScenes: typeof scenes = [];
  const seen = new Set<string>();
  const walk = (sc: Extract<StageItem, { kind: 'card' }>) => { if (seen.has(sc.id)) return; seen.add(sc.id); orderedScenes.push(sc); for (const n of nextOf.get(sc.id) ?? []) walk(n); };
  for (const sc of scenes) if (!sc.after || !byTitle.has(sc.after)) walk(sc);
  for (const sc of scenes) walk(sc);
  const others = cardItems.filter((i) => i.entity.type !== 'event' && i.entity.type !== 'sequence');
  const chars = others.filter((i) => i.entity.type === 'character');
  const rest = others.filter((i) => i.entity.type !== 'character');
  const cards: StageItem[] = [...orderedScenes, ...chars, ...rest, ...items.filter((i) => i.kind === 'world')];
  const loose = items.filter((i) => (i.kind === 'sticky' && i.fragment.kind !== 'story') || i.kind === 'group');
  const tokens = items.filter((i) => i.kind === 'token');
  const cardsRight = Math.max(360, Math.min(stage.w - STICKY_W * 2 - 140, 760));
  let x = 24, y = 24, rowH = 0;
  for (const it of story) {
    const { w, h } = itemSize(it);
    if (x + w > stage.w - 24 && x > 24) { x = 24; y += rowH + 14; rowH = 0; }
    out[it.id] = { x, y };
    x += w + 14; rowH = Math.max(rowH, h);
  }
  if (story.length) { x = 24; y += rowH + 36; rowH = 0; }
  const cardsTop = y;
  let lastType = '';
  for (const it of cards) {
    const { w, h } = itemSize(it);
    // A new kind of card starts a new row, so the scenes read as one line.
    const type = it.kind === 'card' ? (it.entity.type === 'sequence' ? 'event' : it.entity.type) : 'world';
    if ((x + w > cardsRight && x > 24) || (lastType && type !== lastType && x > 24)) { x = 24; y += rowH + 24; rowH = 0; }
    lastType = type;
    out[it.id] = { x, y };
    x += w + 24; rowH = Math.max(rowH, h);
  }
  let lx = cardsRight + 60, ly = cardsTop, colH = 0;
  for (const it of loose) {
    const { w, h } = itemSize(it);
    if (ly + h > 900 && ly > cardsTop) { ly = cardsTop; lx += colH + 40; colH = 0; }
    out[it.id] = { x: lx, y: ly };
    ly += h + 40; colH = Math.max(colH, w);
  }
  const final: Record<string, Pos> = { ...out, ...saved };
  // Each token under the first loose thing it left (where that thing IS,
  // saved or default); a second token at the same spot steps down.
  const taken: Pos[] = [];
  for (const it of tokens) {
    if (it.kind !== 'token') continue;
    if (saved[it.id]) { taken.push(saved[it.id]); continue; }
    const firstLoose = it.looseIds.map((id) => items.find((j) => j.id === id || (j.kind === 'group' && j.members.some((m) => m.id === id)))).find(Boolean);
    const p = firstLoose ? final[firstLoose.id] : null;
    const want = p ? { x: p.x - TOKEN - 22, y: p.y + 10 } : { x: cardsRight + 10, y: ly };
    while (taken.some((t) => Math.abs(t.x - want.x) < TOKEN && Math.abs(t.y - want.y) < TOKEN)) want.y += TOKEN + 10;
    taken.push(want);
    final[it.id] = want;
  }
  return final;
}

// ---------------------------------------------------------------------------

const RING_CSS = `
@keyframes ffsbjump{0%,100%{box-shadow:0 0 0 3px rgba(255,107,53,.85),0 0 18px rgba(255,107,53,.35)}50%{box-shadow:0 0 0 5px rgba(255,107,53,.55),0 0 30px rgba(255,107,53,.55)}}
[data-stage-item].ff-spot>*{animation:ffsbjump 1.2s ease-in-out infinite;border-radius:inherit}
[data-sticky-grip]{opacity:0;color:inherit;transition:opacity 120ms ease}
[data-sticky-id]:hover>[data-sticky-grip]{opacity:.45}
[data-sticky-grip]:hover{opacity:.85!important}
[data-stage-item].ff-lit>*{box-shadow:0 0 0 2.5px rgba(255,140,66,.9),0 0 16px rgba(255,140,66,.35)!important;transition:box-shadow 200ms ease}
@keyframes ffsbgrow{from{transform:scale(.54);opacity:.7}to{transform:scale(1);opacity:1}}
[data-stage-item][data-focus-wrap]>*{animation:ffsbgrow 520ms cubic-bezier(.2,.7,.2,1) both;transform-origin:50% 50%}
@media (prefers-reduced-motion: reduce){[data-stage-item][data-focus-wrap]>*{animation:none}}
@media (prefers-reduced-motion: reduce){[data-stage-item].ff-spot>*{animation:none;box-shadow:0 0 0 3px rgba(255,107,53,.85)!important}}
[data-stage-item]>[data-link-zone],[data-stage-item].ff-lit>[data-link-zone],[data-stage-item].ff-spot>[data-link-zone],[data-stage-item].ff-peer-reading>[data-link-zone],[data-stage-item].ff-peer-landed>[data-link-zone]{animation:none!important;box-shadow:none!important}
[data-stage-item]>[data-beat-tab],[data-stage-item].ff-lit>[data-beat-tab],[data-stage-item].ff-spot>[data-beat-tab],[data-stage-item].ff-peer-reading>[data-beat-tab],[data-stage-item].ff-peer-landed>[data-beat-tab]{animation:none!important;box-shadow:none!important}
[data-stage-item].ff-lit [data-beat-tab] polygon,[data-stage-item].ff-spot [data-beat-tab] polygon{stroke:rgba(255,140,66,.95);stroke-width:3}
[data-stage-item]>[data-strip-pick-hint]{animation:none!important;box-shadow:0 2px 8px rgba(0,0,0,.16)!important}
[data-stage-item].ff-lit [data-beat-tab] svg,[data-stage-item].ff-spot [data-beat-tab] svg{filter:drop-shadow(0 0 6px rgba(255,140,66,.55));overflow:visible}
[data-stage-item].ff-peer-reading [data-beat-tab] polygon,[data-stage-item].ff-peer-landed [data-beat-tab] polygon{stroke:rgba(84,191,219,.95);stroke-width:3}
[data-stage-item].ff-peer-reading [data-beat-tab] svg,[data-stage-item].ff-peer-landed [data-beat-tab] svg{filter:drop-shadow(0 0 6px rgba(84,191,219,.5));overflow:visible}
[data-link-handle]{opacity:0;transform:scale(.7);transition:opacity 140ms ease,transform 140ms ease,background-color 140ms ease}
[data-link-zone]:hover [data-link-handle],[data-link-handle][data-active]{opacity:1;transform:scale(1)}
[data-link-handle]:hover,[data-link-handle][data-active]{transform:scale(1.15)!important;background:var(--link-ink)!important}
[data-beat-slot]{transition:border-color 120ms ease-out,color 120ms ease-out,background 120ms ease-out}
[data-beat-slot]:hover{border-color:var(--slot-ink)!important;color:var(--slot-ink)!important;background:color-mix(in srgb,var(--slot-ink) 7%,transparent)!important}
`;

function MiniStickies({ list, dark }: { list: SandboxFragment[]; dark: boolean }) {
  if (!list.length) return null;
  // Both edges (Ben, 2026-10-09): the stickies wrap the card, right then
  // left, up to four a side; the rest are a count.
  const PER_SIDE = 4;
  const right = list.filter((_, i) => i % 2 === 0).slice(0, PER_SIDE);
  const left = list.filter((_, i) => i % 2 === 1).slice(0, PER_SIDE);
  const shown = right.length + left.length;
  const col = (items: SandboxFragment[], side: 'left' | 'right') => (
    <div data-mini-stickies={side} style={{ position: 'absolute', [side]: -11, top: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((f) => {
        const p = stickyPaper(f);
        return (
          <span
            key={f.id}
            title={f.text}
            style={{ width: 22, height: 22, borderRadius: 1, display: 'block', background: dark ? p.dark : p.light, boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 14px ${p.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)' }}
          />
        );
      })}
      {side === 'right' && list.length > shown && <span style={{ fontSize: 9.5, fontWeight: 700, color: dark ? '#9a9aa4' : '#777', textAlign: 'center' }}>+{list.length - shown}</span>}
    </div>
  );
  return (
    <>
      {col(right, 'right')}
      {left.length > 0 && col(left, 'left')}
    </>
  );
}

function IndexCard({ entity, attached, dark, orderNo, frameColor, dotColor, dim, colorSet, onColor, stripe, stripeTag, tagColor, dots, place, unfolded = false, onResize, plainSize = false, point = 'right', forceSize }: { entity: ProjectEntity; attached: SandboxFragment[]; dark: boolean; unfolded?: boolean;
  /** The timeline draws a card at its slot's size. */
  forceSize?: { w: number; h: number };
  /** Which way a beat tab points: the way the line leaves it. */
  point?: 'left' | 'right' | 'down';
  /** The open strip item's colour, for its tag on a lit scene (the stripe is the beat's now). */
  tagColor?: string;
  /** A scene's corner grip: the size it was let go at. */
  onResize?: (size: { w: number; h: number }) => void;
  /** The Scenes grid draws every card at the plain size. */
  plainSize?: boolean;
  /** Scenes grid: this card's place in the ordered run, shown on the kicker. */
  orderNo?: number;
  /** Colour coding: the frame (its own colour, or the cast lens); a dim outside the legend's pick; the dot's palette. */
  frameColor?: string; dim?: boolean; colorSet?: LabelSet; onColor?: (color: string) => void;
  /** FIL-707: the dot shows the card's colour in the set the strip shows; the frame, the set that paints. */
  dotColor?: string;
  /** FIL-708: lit by the card open in the strip, in its colour. */
  stripe?: string;
  /** FIL-711: a lit scene's transition on the open subplot; the subplots it carries, as dots. */
  stripeTag?: string; dots?: string[];
  /** With the Sequences set shown: where the scene sits, "3.2" (sequence 3, its second scene). */
  place?: { label: string; color: string } }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [sizing, setSizing] = useState<{ w: number; h: number } | null>(null);
  const { w, h } = forceSize ? { w: forceSize.w, h: forceSize.h } : sizing ?? (plainSize ? cardSize(entity.type) : sizedCard(entity));
  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, w0 = w, h0 = h;
    let last = { w: w0, h: h0 };
    const move = (ev: PointerEvent) => {
      last = {
        w: Math.round(Math.min(SCENE_MAX.w, Math.max(SCENE_MIN.w, w0 + ev.clientX - x0))),
        h: Math.round(Math.min(SCENE_MAX.h, Math.max(SCENE_MIN.h, h0 + ev.clientY - y0))),
      };
      setSizing(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      setSizing(null);
      if (last.w !== w0 || last.h !== h0) onResize?.(last);
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  };
  const isBeat = entity.type === 'sequence';
  const beatColor = isBeat ? String((entity as any).beat_color ?? '') : '';
  const beatCount = isBeat ? Number((entity as any).beat_count ?? 0) : 0;
  const base = getEntityColor(entity.type as any) || '#888';
  const color = dark ? liftColor(base, 0.25) : base;
  const frame = beatColor ? shade(beatColor, dark) : frameColor ? shade(frameColor, dark) : color;
  const body = String(entity.summary ?? entity.description ?? '').trim();
  const kicker = entity.type === 'event' ? 'Scene' : isBeat ? 'Beat' : entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
  const isScene = entity.type === 'event' || entity.type === 'sequence';
  // The summary takes whatever the title leaves, in whole lines, ending on an
  // ellipsis. A fixed clamp clipped mid-glyph whenever the title ran long
  // (2026-10-09: a character card cut through its second line).
  const bodyFont = isScene ? 11.5 : 11;
  const bodyLead = isScene ? 1.45 : 1.4;
  const lineH = bodyFont * bodyLead;
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(isScene ? 3 : 2);
  const title = rawTitle(entity);
  useLayoutEffect(() => {
    const card = cardRef.current, el = bodyRef.current;
    if (!card || !el || !card.clientHeight) return;
    const room = card.clientHeight - 6 - el.offsetTop;
    setLines(Math.max(1, Math.floor((room + 1) / lineH)));
  }, [title, body, w, h, lineH]);
  // A BEAT IS A TAB (Ben, 2026-11-05, option 1 of the three looks): a notched
  // label in its colour stuck on the board, its words only, no body. Done
  // ones fade. The connect dot sits at the notch's tip.
  if (isBeat) {
    const done = !!(entity as any).beat_done;
    const ink = frame;
    const N = 16;
    // The point faces the way the story runs (Ben, 2026-11-05: the order
    // should come out of the pointy side), so a tab whose next card is to its
    // left points left.
    const NV = 12;
    const pts = point === 'left'
      ? `${N},0.75 ${w - 0.75},0.75 ${w - 0.75},${h - 0.75} ${N},${h - 0.75} 0.75,${h / 2}`
      : point === 'down'
        ? `0.75,0.75 ${w - 0.75},0.75 ${w - 0.75},${h - NV} ${w / 2},${h - 0.75} 0.75,${h - NV}`
        : `0.75,0.75 ${w - N},0.75 ${w - 0.75},${h / 2} ${w - N},${h - 0.75} 0.75,${h - 0.75}`;
    return (
      <div data-beat-tab={done ? 'done' : beatCount ? 'started' : 'empty'} data-points={point} title={done ? 'A beat you marked done. Click to open it.' : 'Click to open'}
        style={{ width: w, height: h, boxSizing: 'border-box', position: 'relative', userSelect: 'none', opacity: done ? 0.55 : dim ? 0.3 : 1, transition: 'opacity 300ms ease' }}>
        <svg aria-hidden width={w} height={h} style={{ position: 'absolute', inset: 0, display: 'block' }}>
          <polygon points={pts} fill={`color-mix(in srgb, ${ink} ${dark ? 26 : 14}%, ${dark ? '#1e1e22' : '#fffdf7'})`} stroke={ink} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
        <div style={{ position: 'relative', height: '100%', boxSizing: 'border-box', padding: point === 'left' ? `0 14px 0 ${N + 10}px` : point === 'down' ? `0 14px ${NV}px 14px` : `0 ${N + 10}px 0 14px`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: ink }}>
            <span data-beat-kicker>{done ? 'Beat \u00b7 done' : 'Beat'}</span>
            {beatCount > 0 && <span data-beat-count style={{ letterSpacing: 0, textTransform: 'none', fontVariantNumeric: 'tabular-nums' }}>{beatCount} {beatCount === 1 ? 'scene' : 'scenes'}</span>}
          </div>
          <span style={{ fontSize: 13, fontWeight: 650, lineHeight: 1.25, color: dark ? '#f0f0f3' : '#1d2230', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', ...(title ? {} : { opacity: .5, fontStyle: 'italic' }) }}>{title || 'Unnamed beat'}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={cardRef}
      data-beat={isBeat ? (beatCount ? 'started' : 'empty') : undefined}
      title={stripe !== undefined ? undefined : 'Click to open'}
      data-strip-lit={stripe ? '1' : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onContextMenu={onColor ? (e) => { e.preventDefault(); e.stopPropagation(); setPaletteOpen(true); } : undefined}
      style={{
        width: w, height: h, boxSizing: 'border-box', position: 'relative',
        padding: '10px 16px 10px',
        borderRadius: 3,
        background: dark ? '#1e1e22' : '#fffdf7',
        // A beat is always the dashed outline (Ben, 2026-11-05); the count says how far along it is.
        border: `1.5px ${isBeat ? 'dashed' : 'solid'} ${frame}`,
        boxShadow: isBeat ? 'none' : dark ? '0 1px 2px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.45)' : '0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(120,90,40,.10)',
        color: dark ? '#e8e8ec' : '#1d2230',
        display: 'flex', flexDirection: 'column', gap: 6,
        userSelect: 'none',
        opacity: dim ? .3 : 1, filter: dim ? 'saturate(.5)' : undefined, transition: 'opacity 300ms ease, filter 300ms ease, border-color 300ms ease',
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 32, height: 1.5, background: frame, opacity: .7 }} />
      {stripe && <div aria-hidden data-strip-stripe style={{ position: 'absolute', left: -1.5, top: -1.5, bottom: -1.5, width: 6, borderRadius: '3px 0 0 3px', background: shade(stripe, dark) }} />}

      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: frame, display: 'flex', justifyContent: 'space-between', height: 14, gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {onColor && <span style={{ display: 'inline-flex', opacity: dotColor || hover || paletteOpen ? 1 : .35, transition: 'opacity 150ms ease' }}><ColorDot value={dotColor} set={colorSet} dark={dark} onPick={onColor} size={10} open={paletteOpen} onOpenChange={setPaletteOpen} /></span>}
          {orderNo != null && <span data-order-no style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 16, padding: '0 5px', borderRadius: 999, background: frame, color: '#fff', fontSize: 9.5, fontWeight: 800, letterSpacing: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}>{orderNo}</span>}
          {kicker}
        </span>
        {isBeat && <span data-beat-count style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.3px', padding: '1px 7px', borderRadius: 999, textTransform: 'none', ...(beatCount ? { background: frame, color: '#fff' } : { color: dark ? '#82828c' : '#888' }) }}>{beatCount ? `${beatCount} ${beatCount === 1 ? 'scene' : 'scenes'}` : 'No scenes yet'}</span>}
        {(stripeTag || place || (dots && dots.length > 0)) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {!stripeTag && place && <span data-scene-place title={`Sequence ${place.label.split('.')[0]}, scene ${place.label.split('.')[1]}`} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.3px', padding: '1px 6px', borderRadius: 999, background: shade(place.color, dark), color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{place.label}</span>}
            {stripeTag && (tagColor || stripe) && <span data-strip-tag style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.4px', padding: '1px 6px', borderRadius: 999, background: shade((tagColor || stripe)!, dark), color: '#fff' }}>{stripeTag}</span>}
            {!stripeTag && dots?.map((c, i) => <span key={i} data-subplot-dot aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: shade(c, dark) }} />)}
          </span>
        )}
      </div>
      <div style={{ flexShrink: 0, fontSize: isScene ? 15 : 14, fontWeight: 650, lineHeight: 1.3, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', ...(title ? {} : { opacity: .45, fontStyle: 'italic' }) }}>{title || unnamedTitle(entity.type)}</div>
      {/* Collapsed, the card is title and summary only (Ben, 2026-10-09): the
          draft, place, sticky and dump controls live on the focus. */}
      {body && !isBeat && (
        <div ref={bodyRef} data-card-body style={{ flexShrink: 0, fontSize: bodyFont, lineHeight: bodyLead, maxHeight: lines * lineH, color: dark ? '#9a9aa4' : '#666', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-line' }}><RichText text={body} style={{ display: 'inline', whiteSpace: 'inherit' }} /></div>
      )}
      {!unfolded && <MiniStickies list={attached} dark={dark} />}
      {onResize && (
        <span
          data-card-grip aria-label="Resize" title="Drag to resize"
          onPointerDown={startResize} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', touchAction: 'none', color: frame, opacity: sizing ? .8 : hover ? .55 : 0, transition: 'opacity 120ms ease' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ display: 'block' }}>
            <path d="M13 6.5 6.5 13M13 10.5 10.5 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** A world entry: its own small card, not shaped like a scene. Soft green
 *  outline, a globe mark, the kind under it, the writer's words. */
/** A WORLD ENTRY ON THE BOARD (Ben, 2026-10-22: "it should match the strip
 *  design closely"): the sage strip a dump's world material lands as, its
 *  kind in the head, the writer's words, and the stickies it holds on its
 *  edge. A click opens it: its stickies round it and the kind to change. */
function WorldCard({ entry, attached, dark, unfolded = false }: { entry: WorldEntry; attached: SandboxFragment[]; touchTitles?: string[]; dark: boolean; unfolded?: boolean }) {
  const p = paperFor('story');
  return (
    <div
      data-world-strip={entry.id}
      title="Click to open"
      style={{
        width: STORY_W, minHeight: worldHeight(entry), boxSizing: 'border-box', position: 'relative',
        padding: '11px 12px 10px', borderRadius: 1,
        background: dark ? p.dark : p.light,
        color: dark ? '#f6f4ee' : '#3b3a33',
        boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 24px ${p.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
        fontSize: 12, lineHeight: 1.4, userSelect: 'none',
      }}
    >
      <span data-story-head="" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, opacity: .9, marginBottom: 4, color: dark ? STORY_INK.dark : STORY_INK.light }}>
        <GlobeIcon size={11} />{worldWord(entry.kind)}
      </span>
      {/* The writer's lines stay lines (FIL-699: a world card read as one run-on block). */}
      <span style={{ fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", fontSize: 12.5, whiteSpace: 'pre-line' }}><RichText text={entry.text || entry.title} style={{ display: 'inline', whiteSpace: 'inherit' }} /></span>
      {!unfolded && <MiniStickies list={attached} dark={dark} />}
    </div>
  );
}

/** A world entry's head, the way a world strip reads: "World · rule". */
export const worldWord = (kind: string) => (kind && kind !== 'other' ? `World · ${kind}` : 'World');
/** A world strip's height, by its words (as a story strip's). */
function worldHeight(entry: WorldEntry): number {
  // Each of the writer's lines starts a new one (FIL-699).
  const lines = (entry.text || entry.title || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 52)), 0);
  return 34 + Math.max(1, lines) * 17;
}

export type StickyPatch = { text?: string; label?: string; speaker?: string; /** A world strip's kind (2026-10-15). */ factKind?: string; worldKind?: string };
export const STORY_FACT_KINDS = ['format', 'genre', 'setting', 'period', 'tone', 'world', 'other'] as const;
export type StoryFactKindPick = typeof STORY_FACT_KINDS[number];

/** The sticky's live face (FIL-644, inline since 2026-10-08): the words
 *  are the editor, Linear-style; a small label under them; Promote for a
 *  story sticky; Delete behind a second click. Blur or Cmd+Enter saves (Enter
 *  is a new paragraph, FIL-714), Esc
 *  puts the old words back. Pointer events stop here so typing never
 *  starts a drag. */
/** A sticky being edited, on the board or hung beside an opened card
 *  (2026-10-12: one editor for both; beside a card a line could only have
 *  its words retyped, no speaker, no delete). It is one thing: moving between
 *  its words, its label, its speaker (and the speaker menu) keeps it open;
 *  done, Esc or a click outside closes it. Each field saves as it is left. */
/** Which kind a story strip promotes as (2026-10-15: one small picker in
 *  place of a row of seven chips): the kind with a caret; a click lists them. */
const KIND_OPTIONS: Array<{ key: string; label: string; factKind: string; worldKind: string }> = [
  { key: 'setting', label: 'Setting', factKind: 'setting', worldKind: '' },
  { key: 'world:rule', label: 'World · rule', factKind: 'world', worldKind: 'rule' },
  { key: 'world:history', label: 'World · history', factKind: 'world', worldKind: 'history' },
  { key: 'world:faction', label: 'World · faction', factKind: 'world', worldKind: 'faction' },
  { key: 'world:thing', label: 'World · thing', factKind: 'world', worldKind: 'thing' },
  { key: 'genre', label: 'Genre', factKind: 'genre', worldKind: '' },
  { key: 'tone', label: 'Tone', factKind: 'tone', worldKind: '' },
  { key: 'period', label: 'Period', factKind: 'period', worldKind: '' },
  { key: 'format', label: 'Format', factKind: 'format', worldKind: '' },
  { key: 'other', label: 'Other', factKind: 'other', worldKind: '' },
];
/** The option a strip is now, by its kinds. */
const kindKey = (f: SandboxFragment) => {
  const k = String(f.factKind ?? '');
  if (k === 'world') { const w = String(f.worldKind ?? ''); return w === 'place' ? 'setting' : ['rule', 'history', 'faction', 'thing'].includes(w) ? `world:${w}` : 'world:rule'; }
  return KIND_OPTIONS.some((o) => o.key === k) ? k : 'other';
};
/** The world types an opened world entry can be (Ben, 2026-10-22). */
export const WORLD_KIND_OPTIONS: Array<{ key: string; label: string; factKind: string; worldKind: string }> = ['rule', 'history', 'faction', 'place', 'thing', 'other']
  .map((k) => ({ key: k, label: worldWord(k), factKind: 'world', worldKind: k }));
export function KindPick({ value, dark, onPick, options = KIND_OPTIONS, title = 'What this is about the story' }: { value: string; dark: boolean; onPick: (o: { factKind: string; worldKind: string }) => void; options?: Array<{ key: string; label: string; factKind: string; worldKind: string }>; title?: string }) {
  const [open, setOpen] = useState(false);
  const ink = dark ? STORY_INK.dark : STORY_INK.light;
  const word = (k: string) => options.find((o) => o.key === k)?.label ?? k;
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" data-kind-pick aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
        title={title}
        style={{ font: 'inherit', fontSize: 10.5, fontWeight: 600, minHeight: 22, padding: '1px 7px', borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${dark ? 'rgba(159,207,142,.45)' : 'rgba(79,122,66,.35)'}`, background: 'transparent', color: ink }}>
        <GlobeIcon size={11} />{word(value)}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7 }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" data-kind-menu tabIndex={-1}
          style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 60, minWidth: 120, padding: 3, borderRadius: 8, background: dark ? '#1a1a1e' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e6e0d2'}`, boxShadow: '0 10px 26px rgba(0,0,0,.2)', fontFamily: 'system-ui, sans-serif' }}>
          {options.map(({ key: k, factKind, worldKind }) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={k === value} data-kind-option={k} onClick={() => { onPick({ factKind, worldKind }); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', fontSize: 12, padding: '5px 9px', borderRadius: 5, border: 'none', cursor: 'pointer', background: k === value ? (dark ? 'rgba(159,207,142,.14)' : 'rgba(79,122,66,.10)') : 'transparent', color: k === value ? ink : (dark ? '#e6e6ea' : '#1d2230'), fontWeight: k === value ? 650 : 500 }}>
              {word(k)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function StickyLive({ f, dark, onSave, onDelete, onCancel }: { f: SandboxFragment; dark: boolean; onSave: (patch: StickyPatch) => void; onDelete: () => void; onCancel: () => void; onPromote?: (kind: StoryFactKindPick, text: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ink = dark ? '#f6f4ee' : '#3b3a33';
  const inside = (n: EventTarget | null) => !!n && ((rootRef.current?.contains(n as Node) ?? false) || !!(n as Element).closest?.('[data-speaker-menu], [data-kind-menu]'));
  return (
    <div
      ref={rootRef} tabIndex={-1} data-sticky-live
      onBlur={(e) => { if (!inside(e.relatedTarget)) onCancel(); }}
      onKeyDownCapture={(e) => {
        // Esc closes the editor (after the field it was in puts its words
        // back), except inside the speaker menu, where it only shuts the menu.
        if (e.key === 'Escape' && !(e.target as Element).closest?.('[data-speaker-menu], [data-kind-menu]')) window.setTimeout(onCancel, 0);
      }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', gap: 5, outline: 'none' }}
    >
      {/* Sits over the sticky (its paper is the positioned box). */}
      {f.kind !== 'dialogue' && <PaperBar dark={dark} />}
      {f.kind === 'dialogue' && <SpeakerPick testId="sticky" value={f.speaker} dark={dark} onPick={(id) => onSave({ speaker: id })} />}
      <InlineText
        testId="sticky-text" autoFocus paper={f.kind !== 'dialogue'} value={f.kind === 'dialogue' ? bareLine(f.text) : f.text} placeholder={f.kind === 'dialogue' ? 'The line' : 'Sticky text'}
        onSave={(t) => onSave({ text: t })}
        style={f.kind === 'dialogue'
          ? { fontFamily: SCRIPT_FACE, fontSize: 12, lineHeight: 1.35, color: ink, textAlign: 'center' }
          : { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", fontSize: 12.5, lineHeight: 1.4, color: ink }}
      />
      {/* Only a line has a note (Ben, 2026-10-12): under the words, an aside. */}
      {f.kind === 'dialogue' && (
        <InlineText
          testId="sticky-label" value={f.label} placeholder="Add a Note" allowEmpty
          onSave={(t) => onSave({ label: t.slice(0, 40) })}
          style={{ ...NOTE_STYLE, marginTop: 0, color: ink }}
        />
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* What the strip is, picked here and worn in its header (Ben,
            2026-10-15: Promote is gone from the world strip). */}
        {f.kind === 'story' && <KindPick value={kindKey(f)} dark={dark} onPick={(o) => onSave(o)} />}
        <span style={{ flex: 1 }} />
        <TrashButton dark={dark} size={14} label={f.kind === 'dialogue' ? 'line' : 'sticky'} testId="sticky" onConfirm={onDelete} />
      </div>
    </div>
  );
}

/** What a story strip is about, for its header: the globe and the kind
 *  (Ben, 2026-10-15: the old World cards' globe and kind, small), "World ·
 *  rule" for a piece of the world, the plain kind otherwise. */
const FACT_WORD: Record<string, string> = { format: 'Format', genre: 'Genre', setting: 'Setting', period: 'Period', tone: 'Tone', world: 'World' };
export function storyHead(f: SandboxFragment): string {
  const k = String(f.factKind ?? '');
  if (k === 'world') return f.worldKind && f.worldKind !== 'other' ? `World · ${f.worldKind}` : 'World';
  return FACT_WORD[k] ?? 'About the story';
}
const STORY_INK = { light: '#4f7a42', dark: '#9fcf8e' };

/** THE WORLD VIEW (Ben, 2026-10-15: "a world only focused view"): the world
 *  strips and World cards alone, a column per kind, in a fixed order; empty
 *  kinds take no column. Columns wrap to a second band when the board is
 *  narrower than they are. */
const WORLD_COLS: Array<[string, string]> = [['setting', 'Setting'], ['world:rule', 'Rules'], ['world:history', 'History'], ['world:faction', 'Factions'], ['world:thing', 'Things'], ['world:other', 'World'], ['genre', 'Genre'], ['tone', 'Tone'], ['period', 'Period'], ['format', 'Format'], ['other', 'About the story']];
export function worldKey(it: StageItem): string | null {
  if (it.kind === 'world') { const k = String(it.entry.kind ?? ''); return k === 'place' ? 'setting' : `world:${['rule', 'history', 'faction', 'thing'].includes(k) ? k : 'other'}`; }
  if (it.kind !== 'sticky' || it.fragment.kind !== 'story') return null;
  const f = String(it.fragment.factKind ?? '');
  if (f === 'world') { const w = String(it.fragment.worldKind ?? ''); return w === 'place' ? 'setting' : `world:${['rule', 'history', 'faction', 'thing'].includes(w) ? w : 'other'}`; }
  return ['setting', 'genre', 'tone', 'period', 'format'].includes(f) ? f : 'other';
}
export function worldColumns(items: StageItem[], boardW: number): { pos: Map<string, Pos>; heads: Array<{ key: string; label: string; n: number; x: number; y: number }> } {
  const pos = new Map<string, Pos>();
  const heads: Array<{ key: string; label: string; n: number; x: number; y: number }> = [];
  const by = new Map<string, StageItem[]>();
  for (const it of items) { const k = worldKey(it); if (k) by.set(k, [...(by.get(k) ?? []), it]); }
  const COL = STORY_W, GAP = 28, LEFT = 32, HEAD = 34;
  let x = LEFT, y = 28, bandH = 0;
  for (const [key, label] of WORLD_COLS) {
    const list = by.get(key);
    if (!list?.length) continue;
    if (x > LEFT && x + COL > boardW - 16) { x = LEFT; y += bandH + 36; bandH = 0; }
    heads.push({ key, label, n: list.length, x, y });
    let cy = y + HEAD;
    for (const it of list) { pos.set(it.id, { x, y: cy }); cy += itemSize(it).h + 16; }
    bandH = Math.max(bandH, cy - y);
    x += COL + GAP;
  }
  return { pos, heads };
}

function StickyNote({ f, dumpNo, dark, editing, onEdit, onDelete, onCancelEdit, onPromote, onResize, onMenu }: { f: SandboxFragment; dumpNo: number; dark: boolean; editing?: boolean; onEdit?: (patch: StickyPatch) => void; onDelete?: () => void; onCancelEdit?: () => void; onPromote?: (kind: StoryFactKindPick, text: string) => void;
  /** A loose sticky only: the writer dragged its corner to this size. */
  onResize?: (size: { w: number; h: number }) => void;
  /** What it becomes (2026-10-31): right-click or its "Sticky ▾" label opens the menu here (viewport point). */
  onMenu?: (at: { x: number; y: number }) => void }) {
  const p = stickyPaper(f);
  const [showSource, setShowSource] = useState(false);
  const [sizing, setSizing] = useState<{ w: number; h: number } | null>(null);
  const hasSource = !!f.source && f.source.trim() !== f.text.trim();
  const story = f.kind === 'story';
  const sized = sizing ?? (onResize && f.size && !story ? f.size : null);
  // A very long sticky at rest stops at the cap and fades; editing it, or
  // reading where it came from, shows it whole. Sized ones are the writer's.
  const capped = !story && !sized && !editing && !showSource;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = boxRef.current;
    setOver(!!el && capped && el.scrollHeight > el.clientHeight + 1);
  }, [capped, f.text, f.label]);
  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation(); e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let last = { w: Math.round(box.width), h: Math.round(box.height) };
    const move = (ev: PointerEvent) => {
      last = {
        w: Math.round(Math.min(STICKY_MAX.w, Math.max(STICKY_MIN.w, box.width + ev.clientX - x0))),
        h: Math.round(Math.min(STICKY_MAX.h, Math.max(STICKY_MIN.h, box.height + ev.clientY - y0))),
      };
      setSizing(last);
    };
    // Capture phase: the release lands on the grip, which follows the
    // pointer, and React stops it there before it bubbles to the window.
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
      setSizing(null);
      onResize?.(last);
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  };
  return (
    <div
      ref={boxRef}
      data-sticky-id={f.id} data-sticky-capped={over ? '' : undefined}
      onContextMenu={onMenu && !editing && !story ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY }); } : undefined}
      onDoubleClick={hasSource ? (e) => { e.stopPropagation(); setShowSource((v) => !v); } : undefined}
      title={editing ? undefined : hasSource ? 'Click to edit. Double-click: where did this come from' : 'Click to edit'}
      style={{
        position: 'relative',
        width: story ? STORY_W : sized ? sized.w : STICKY_W, boxSizing: 'border-box', padding: '11px 12px 10px', minHeight: story ? 0 : sized ? sized.h : STICKY_REST_H,
        borderRadius: 1,
        background: dark ? p.dark : p.light,
        color: dark ? '#f6f4ee' : '#3b3a33',
        boxShadow: dark
          ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 24px ${p.glow}`
          : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
        fontSize: 12, lineHeight: 1.4,
        userSelect: 'none',
        ...(capped ? { maxHeight: STICKY_CAP_H, overflow: 'hidden' } : {}),
      }}
    >
      {over && <span aria-hidden data-sticky-fade style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, pointerEvents: 'none', background: `linear-gradient(to bottom, transparent, ${dark ? p.dark : p.light} 85%)` }} />}
      <span data-story-head={story ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, opacity: .9, marginBottom: 4, ...(story ? { color: dark ? STORY_INK.dark : STORY_INK.light } : {}) }}>
        {story && <GlobeIcon size={11} />}
        {/* What it is, as a label that opens what it can become: a sticky
            has no kind yet (Philip never found a kind picker that read as
            information, 2026-10-30, so this one looks pressable). */}
        {!story && onMenu && !editing && (
          <button
            type="button" data-sticky-kind aria-haspopup="menu" title="Make it a scene, or put it on a card"
            onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu({ x: r.left, y: r.bottom + 4 }); }}
            style={{ font: 'inherit', fontSize: 9, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'inherit', background: 'transparent', border: 'none', padding: '1px 4px 1px 0', margin: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
          >{f.kind === 'dialogue' ? 'Line' : 'Sticky'}<svg width="7" height="5" viewBox="0 0 7 5" aria-hidden><path d="M.5 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        )}
        {!story && onMenu && !editing && dumpNo ? <span style={{ opacity: .6 }}>· </span> : null}
        {story ? storyHead(f) : ''}{story && dumpNo ? ' · ' : ''}{dumpNo ? `dump ${dumpNo}` : ''}
      </span>
      {editing && onEdit && onDelete && onCancelEdit
        ? <StickyLive f={f} dark={dark} onSave={onEdit} onDelete={onDelete} onCancel={onCancelEdit} onPromote={onPromote} />
        : <>
          {f.kind === 'dialogue'
            ? <DialogueFace text={f.text} speaker={f.speaker} dark={dark} />
            : <RichText text={f.text} style={{ fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", fontSize: 12.5 }} />}
          <LineNote text={f.label} center={f.kind === 'dialogue'} />
        </>}
      {!editing && showSource && hasSource && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}`, fontSize: 11, fontStyle: 'italic', opacity: .85 }}>“{f.source}”</div>
      )}
      {onResize && !story && (
        <span
          data-sticky-grip aria-label="Resize" title="Drag to resize"
          onPointerDown={startResize} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', touchAction: 'none', opacity: sizing ? .7 : undefined }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ display: 'block' }}>
            <path d="M13 6.5 6.5 13M13 10.5 10.5 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      )}
    </div>
  );
}

const addToWord = (type: string) => (type === 'character' ? 'character' : 'scene');

function Huddle({ members, badge, dumpNos, dark, onMake, onAddTo, onNotYet, editingId, onEdit, onDelete, onCancelEdit, onMenu }: { members: SandboxFragment[]; badge?: SandboxBadge; dumpNos: number[]; dark: boolean; onMake?: (kind: 'scene' | 'character' | 'world') => void; onAddTo?: (cardId: string) => void; onNotYet?: () => void; editingId?: string | null; onEdit?: (id: string, patch: StickyPatch) => void; onDelete?: (id: string) => void; onCancelEdit?: () => void; /** The sticky menu for one of the group's stickies (2026-11-01). */ onMenu?: (id: string, at: { x: number; y: number }) => void }) {
  const ready = dark ? '#34d399' : '#059669';
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const nums = new Map<string, number>();
  for (const m of members) nums.set(m.id, dumpNos[0] ?? 0);
  return (
    <div
      style={{
        position: 'relative',
        padding: GROUP_PAD, borderRadius: 8,
        border: badge ? `1.5px dashed ${ready}` : `1.5px dashed ${dark ? '#4a4a54' : '#cfc7b8'}`,
        background: badge ? (dark ? 'rgba(52,211,153,.12)' : 'rgba(5,150,105,.10)') : 'transparent',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {/* ONE PILL, ONE MENU (Ben, 2026-11-02: "a drop down akin to our sticky
          drop down. clean and simple"). A read group's pill says what it
          reads as; a group nobody read says Make it. The menu has the rest. */}
      {(badge || onMake) && (
        <div data-badge={badge ? '' : undefined} data-group-make={badge ? undefined : ''} style={{ position: 'absolute', left: 12, top: -12 }} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
          <button
            type="button" data-group-pill aria-haspopup="menu" aria-expanded={!!menuAt}
            title={badge ? badge.summary : 'Make this group a card'}
            onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenuAt(menuAt ? null : { x: r.left, y: r.bottom + 4 }); }}
            style={{
              font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 280, padding: '3px 10px 3px 8px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 11.5, fontWeight: 600, color: dark ? '#e8e8ec' : '#1d2230', background: dark ? '#1e1e22' : '#fffdf7',
              border: badge ? `1px solid ${ready}` : `1px dashed ${dark ? '#4a4a54' : '#cfc7b8'}`,
            }}
          >
            {badge ? (
              <>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: ready, flexShrink: 0 }} />
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.5px', textTransform: 'uppercase', color: ready, flexShrink: 0 }}>{badge.addTo ? `Add to ${addToWord(badge.addTo.type)}` : badge.kind === 'world' && badge.worldKind && badge.worldKind !== 'other' ? `World · ${badge.worldKind}` : badge.kind}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{badge.addTo ? badge.addTo.title : badge.title}</span>
              </>
            ) : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: dark ? '#c9c9d1' : '#5a5f6b' }}>Make it</span>}
            <span aria-hidden style={{ fontSize: 9, opacity: .7, flexShrink: 0 }}>▾</span>
          </button>
          {menuAt && onMake && (
            <GroupMenu
              at={menuAt} dark={dark}
              suggestion={badge ? { kind: badge.kind, worldKind: badge.worldKind, title: badge.title, summary: badge.summary, addTo: badge.addTo } : null}
              onMake={onMake} onAddTo={onAddTo} onNotYet={badge ? onNotYet : undefined}
              onClose={() => setMenuAt(null)}
            />
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(2, members.length)}, ${STICKY_W}px)`, gap: 8, marginTop: badge ? 8 : 0 }}>
        {members.map((f) => <StickyNote key={f.id} f={f} dumpNo={0} dark={dark} editing={editingId === f.id} onEdit={onEdit ? (patch) => onEdit(f.id, patch) : undefined} onDelete={onDelete ? () => onDelete(f.id) : undefined} onCancelEdit={onCancelEdit} onMenu={onMenu ? (at) => onMenu(f.id, at) : undefined} />)}
      </div>
    </div>
  );
}

function Token({ no, count, dark, open = false }: { no: number; count: number; dark: boolean; open?: boolean }) {
  // A dump is not paper (Ben, 2026-10-12: the square tokens "look too much
  // like stickies"): a round badge in the Braindump orange, solid always,
  // filled while its dump is open.
  const orange = dark ? '#ff8c42' : '#ea580c';
  return (
    <div
      data-dump-token={no}
      title={open ? `Close dump ${no}` : `Dump ${no}: click to read it`}
      style={{
        cursor: 'pointer', boxSizing: 'border-box',
        width: TOKEN, height: TOKEN, borderRadius: '50%', position: 'relative',
        background: open ? orange : (dark ? '#1a1a1e' : '#fff'), color: open ? '#fff' : orange,
        border: `2px solid ${orange}`,
        fontSize: 11.5, fontWeight: 800, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: dark ? '0 2px 8px rgba(0,0,0,.5)' : '0 2px 8px rgba(234,88,12,.18)',
        transition: 'background 150ms ease, color 150ms ease',
      }}
    >
      {no}
      {count > 0 && (
        <span style={{ position: 'absolute', right: -8, top: -8, minWidth: 15, height: 15, borderRadius: 999, background: dark ? '#e8e8ec' : '#1d2230', color: dark ? '#1d2230' : '#fff', fontSize: 9.5, fontWeight: 700, fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{count}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE DUMP, READ BACK (Ben, 2026-10-11: "the dumps need to be expandable so i
// can see my dumps language"). A click on a dump's token opens it beside the
// token in the writer's own words. The sentences that became stickies are
// marked in place, and those stickies light on the board while it is open.

export type DumpText = { prose: string; createdAt: string };
export const SLIP_W = 360;

/** Where each sticky's source sits in the dump: non-overlapping ranges, in order. */
export function sourceRanges(prose: string, sources: string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const lower = prose.toLowerCase();
  for (const raw of sources) {
    const src = String(raw ?? '').trim();
    if (src.length < 8) continue;
    let at = prose.indexOf(src);
    if (at < 0) at = lower.indexOf(src.toLowerCase());
    if (at >= 0) found.push([at, at + src.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const r of found) {
    const last = out[out.length - 1];
    if (last && r[0] < last[1]) { last[1] = Math.max(last[1], r[1]); continue; }
    out.push([r[0], r[1]]);
  }
  return out;
}

function DumpSlip({ no, text, sources, left, dark, onClose }: { no: number; text?: DumpText; sources: string[]; left: number; dark: boolean; onClose: () => void }) {
  const prose = text?.prose ?? '';
  const ranges = useMemo(() => sourceRanges(prose, sources), [prose, sources]);
  const when = text?.createdAt ? new Date(text.createdAt) : null;
  const stamp = when && !isNaN(when.getTime()) ? when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const ink = dark ? '#f0e2c4' : '#4a3a17';
  const mark = dark ? 'rgba(255,140,66,.22)' : 'rgba(255,140,66,.22)';
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(prose.slice(at, a));
    parts.push(<span key={i} data-dump-source style={{ background: mark, boxShadow: `inset 0 -1.5px 0 #ff8c42`, borderRadius: 2 }}>{prose.slice(a, b)}</span>);
    at = b;
  });
  if (at < prose.length) parts.push(prose.slice(at));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      data-dump-slip={no}
      onPointerDown={stop} onPointerUp={stop} onClick={stop} onDoubleClick={stop}
      style={{
        width: SLIP_W, boxSizing: 'border-box', borderRadius: 4, padding: '10px 14px 12px', cursor: 'default',
        background: dark ? '#221d12' : '#fdf6e8', color: ink,
        border: `1px solid ${dark ? '#4a3d22' : '#ead9b4'}`,
        boxShadow: dark ? '0 2px 6px rgba(0,0,0,.6), 0 18px 40px rgba(0,0,0,.55)' : '0 2px 6px rgba(0,0,0,.08), 0 16px 36px rgba(120,90,40,.18)',
        fontFamily: 'system-ui, sans-serif', marginLeft: left,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase' }}>
        <span>Dump {no}</span>
        {stamp && <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none', opacity: .7, fontSize: 11 }}>{stamp}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} aria-label={`Close dump ${no}`} title="Close (Esc)" style={{ font: 'inherit', fontSize: 15, lineHeight: 1, border: 'none', background: 'transparent', color: 'inherit', opacity: .7, cursor: 'pointer', padding: 0 }}>×</button>
      </div>
      <div data-dump-prose style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", fontSize: 13.5, lineHeight: 1.55, userSelect: 'text' }}>
        {prose ? parts : <span style={{ opacity: .7, fontStyle: 'italic' }}>The words of this dump are not here yet.</span>}
      </div>
      {ranges.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, opacity: .75 }}>Marked: what became a sticky. Those stickies are lit on the board.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MANUAL CARDS AND STICKIES (Ben, 2026-10-09). A draft is a blank card or
// sticky the writer asked for, live where it stands: the caret is in it,
// Enter or clicking away makes it, Esc or leaving it empty drops it. Nothing
// is written until there are words, so an abandoned draft leaves no trace.

/** A blank sticky or line, live where it stands. (A card is not drafted:
 *  + New makes it at once and opens it in the expanded view, 2026-10-12.) */
export type SandboxDraft = { kind: 'sticky' | 'dialogue'; pos: Pos;
  /** When it was asked for: the draft's identity while it is dragged
   *  (its position changes, it stays the same draft; FIL-697). */
  at?: number };

function DraftSticky({ dark, onCommit, onCancel }: { dark: boolean; onCommit: (text: string) => void; onCancel: () => void }) {
  const p = paperFor('note');
  return (
    <div
      data-draft-sticky
      style={{
        position: 'relative', width: STICKY_W, minHeight: 104, boxSizing: 'border-box', padding: '11px 12px 10px', borderRadius: 1,
        background: dark ? p.dark : p.light, color: dark ? '#f6f4ee' : '#3b3a33',
        boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 24px ${p.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 10px 18px rgba(120,90,40,.16)',
        fontSize: 12, lineHeight: 1.4, cursor: 'grab', display: 'flex', flexDirection: 'column',
      }}
    >
      <PaperBar dark={dark} />
      <InlineText
        testId="draft-sticky-text" autoFocus paper value="" placeholder="Write the sticky"
        onSave={onCommit} onCancel={onCancel}
        style={{ fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif", fontSize: 12.5, cursor: 'text' }}
      />
      {/* How it ends (FIL-696): Enter is a new paragraph now, so say how to keep it. */}
      <span aria-hidden style={{ marginTop: 'auto', paddingTop: 8, fontFamily: 'system-ui, sans-serif', fontSize: 9.5, letterSpacing: '.2px', opacity: .5, userSelect: 'none' }}>⌘↵ or click away to keep · Esc to drop</span>
    </div>
  );
}

/** A line by hand: who says it, then the words. The draft is one thing:
 *  moving between the speaker and the words keeps it open; Enter, or leaving
 *  the draft, makes it when there are words; Esc or leaving it empty drops it. */
function DraftLine({ dark, speaker: initial = '', onCommit, onCancel, testId = 'draft-line' }: { dark: boolean; speaker?: string; onCommit: (text: string, speaker: string) => void; onCancel: () => void; testId?: string }) {
  const p = paperFor('dialogue');
  const [speaker, setSpeaker] = useState(initial);
  const textRef = useRef<HTMLDivElement | null>(null);
  const done = useRef(false);
  useEffect(() => { textRef.current?.focus(); }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = String(textRef.current?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    if (keep && t) onCommit(t, speaker); else onCancel();
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      data-draft-line={testId}
      onBlur={(e) => { const to = e.relatedTarget as Node | null; if (!to || !(e.currentTarget.contains(to) || (to as Element).closest?.('[data-speaker-menu]'))) finish(true); }}
      onPointerDown={stop} onPointerUp={stop} onClick={stop}
      style={{
        width: STICKY_W, minHeight: 104, boxSizing: 'border-box', padding: '9px 10px 10px', borderRadius: 1,
        background: dark ? p.dark : p.light, color: dark ? '#f6f4ee' : '#22303f',
        boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${p.glow}, 0 0 24px ${p.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 10px 18px rgba(120,90,40,.16)',
        display: 'flex', flexDirection: 'column', gap: 5, cursor: 'text',
      }}
    >
      <SpeakerPick testId={testId} value={speaker} dark={dark} onPick={setSpeaker} />
      <style>{`[data-line-text]:empty::before{content:attr(data-placeholder);opacity:.5;pointer-events:none}`}</style>
      <div
        ref={textRef}
        data-line-text={testId}
        data-placeholder="The line"
        role="textbox" aria-label="The line"
        contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
        }}
        style={{ outline: 'none', minHeight: '1.4em', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: SCRIPT_FACE, fontSize: 12, lineHeight: 1.35, textAlign: 'center', boxShadow: 'inset 0 -1.5px 0 0 currentColor' }}
      />
    </div>
  );
}

const DRAFT_SAT_ID = 'draft-sticky';
const DRAFT_LINE_ID = 'draft-line';

function centerOf(p: Pos, s: { w: number; h: number }): Pos { return { x: p.x + s.w / 2, y: p.y + s.h / 2 }; }

type SatelliteLike = { kind: 'item'; id: string } | { kind: 'ghost'; row: { id: string } } | { kind: 'sticky'; f: { id: string } } | { kind: 'peer'; q: { id: string } };
const satId = (s: SatelliteLike) => (s.kind === 'item' ? s.id : s.kind === 'ghost' ? s.row.id : s.kind === 'peer' ? s.q.id : s.f.id);

export function SandboxBoard({
  items,
  positions,
  onMove,
  spot,
  landingIds,
  landingFrom,
  onOpenCard,
  onStickyEdit,
  onStickyDelete,
  onDumpInto,
  aimedCardId,
  onMakeCard,
  onAddHuddleTo,
  onNotYet,
  onPromote,
  onPlaceCard,
  onDemoteCard,
  onWriteCard,
  onEditDescription,
  onEditTitle,
  dumps,
  draft = null,
  onDraftCommit,
  onDraftCancel,
  onDraftMove,
  onStickyResize,
  onRequestSticky,
  onAddSticky,
  onAddLine,
  freshCardId = null,
  onDropSticky,
  onUnpinSticky,
  onGroupSticky,
  onUngroupSticky,
  onTurnInto,
  onStickyColor,
  onDeleteCard,
  onAddCast,
  onTagSubplot,
  onUntagSubplot,
  onSetTransition,
  onNewSceneInSubplot,
  onNewSubplotWithScene,
  subplotOptions,
  onSetTie,
  onRemoveTie,
  focusLayout,
  onMoveInFocus,
  focusId = null,
  writingId = null,
  editor = null,
  labelSet,
  onSetColor,
  onToSequence,
  stripPick,
  sceneDots,
  focusExtra,
  scenePlace,
  colorSetId,
  paintSetId,
  scenesMode = false,
  charactersMode = false,
  worldMode = false,
  webSaved,
  onMoveInWeb,
  templatesShowing = false,
  showStickies = false,
  openStickies,
  onToggleStickies,
  hideEmptyHint = false,
  precedes,
  onReorderScene,
  gridOrder,
  onGridOrder,
  colorFilter,
  onFocus,
  allEntities,
  edges,
  stripColorOf,
  lineLinks,
  onPlaceBeat,
  onInsertBetween,
  onMoveInLine,
  scenesLayout = 'grid',
  world,
  minHeight = 720,
  peerQuestions = [],
  peerExpanded = false,
  onPeerExpand,
  peerReads,
  peerAskBusy = null,
  onAskPeer,
  answerBusy,
  peerLive,
  peerShown,
  onFoldQuestion,
  peerReading = false,
  peerCardNote,
  peerSpot = null,
  peerSpotlight,
  peerFresh,
  onDismissQuestion,
  onSetWorldKind,
  onUndoAnswer,
  undoBusyId,
  onAnswerQuestion,
}: {
  items: StageItem[];
  positions: Record<string, Pos>;
  /** Fires on drop with the item's new stage position. */
  onMove: (id: string, pos: Pos) => void;
  /** FIL-644: a sticky's text or label changed by the writer's hand. */
  onStickyEdit?: (id: string, patch: StickyPatch) => void;
  onStickyDelete?: (id: string) => void;
  /** Focused dump: aim the dock at this card. `aimedCardId` lights the one aimed at. */
  onDumpInto?: (cardId: string) => void;
  aimedCardId?: string | null;
  /** FIL-640: the writer's answer to a badge. */
  onMakeCard?: (clusterId: string, kind: 'scene' | 'character' | 'world') => void;
  /** A huddle about a card that exists, put on that card (2026-10-12). */
  onAddHuddleTo?: (clusterId: string, cardId: string) => void;
  onNotYet?: (clusterId: string) => void;
  /** FIL-652: a story sticky lifted to the title row as a story fact. */
  onPromote?: (fragmentId: string, kind: StoryFactKindPick, text: string) => void;
  /** FIL-641: place a parked card on the master; turn it back into a sticky. */
  onPlaceCard?: (cardId: string) => void;
  /** at: where the card sits on the board now; the sticky lands there. */
  onDemoteCard?: (cardId: string, at?: Pos) => void;
  /** Anchor section 9: the same editor, scoped to this parked scene. */
  onWriteCard?: (cardId: string) => void;
  /** The card's (or world entry's) telling edited in place on the focus. */
  onEditDescription?: (cardId: string, text: string) => void | Promise<void>;
  onEditTitle?: (cardId: string, text: string) => void | Promise<void>;
  /** The dumps' own words by dump id, for the token's read-back. */
  dumps?: Record<string, DumpText>;
  /** Manual cards and stickies (2026-10-09): the blank one the writer asked
   *  for, live at `pos`; its words make it, empty or Esc drops it. */
  draft?: SandboxDraft | null;
  onDraftCommit?: (text: string, speaker?: string) => void;
  onDraftCancel?: () => void;
  /** The draft dragged to a new spot before it has words (FIL-697). */
  onDraftMove?: (pos: Pos) => void;
  /** A loose sticky's corner was dragged (free resize, 2026-10-31). */
  onStickyResize?: (id: string, size: { w: number; h: number }) => void;
  /** A double-click on empty board asks for a loose sticky there. */
  onRequestSticky?: (pos: Pos) => void;
  /** A sticky written on the focused card. */
  onAddSticky?: (cardId: string, text: string) => void;
  /** A line written from the focused card: on a scene it hangs there; on a
   *  character it is theirs to say (2026-10-11). */
  onAddLine?: (cardId: string, text: string, speaker: string) => void;
  /** The card + New just made: it opens with the caret in its name. */
  freshCardId?: string | null;
  /** A loose sticky dragged onto a card and let go there (2026-10-12): a line
   *  on a character becomes theirs to say; anything else hangs on the card. */
  onDropSticky?: (stickyId: string, cardId: string) => void;
  /** A pinned sticky leaves its card (2026-11-01). */
  onUnpinSticky?: (stickyId: string, cardId: string) => void;
  /** Groups by hand (Ben, 2026-11-02: "peel out of the group and re-add"):
   *  a sticky joins the group of headId (a loose sticky's id starts one),
   *  or leaves the group it is in. */
  onGroupSticky?: (stickyId: string, headId: string) => void;
  onUngroupSticky?: (stickyId: string, groupHeadId: string) => void;
  /** A loose sticky turned into a card in its place (2026-10-31, the sticky menu). */
  onTurnInto?: (stickyId: string, kind: TurnKind) => void;
  /** A sticky's colour picked in its menu: a sticky paper key, '' for none. */
  onStickyColor?: (stickyId: string, color: string) => void;
  /** Delete a scene or character from the expanded view (2026-10-12). */
  onDeleteCard?: (cardId: string) => void;
  /** Put a character in the focused scene's cast (2026-10-12). */
  onAddCast?: (sceneId: string, characterId: string) => void;
  /** Put a scene in a subplot, from either card's "+" (Ben, 2026-11-07). */
  onTagSubplot?: (arcId: string, sceneId: string) => void;
  /** Take a scene out of a subplot, from either card (Ben, 2026-11-07). */
  onUntagSubplot?: (arcId: string, sceneId: string) => void;
  /** What a scene does to a subplot: one of the words, or '' for none. */
  onSetTransition?: (arcId: string, sceneId: string, transition: string) => void;
  /** A scene's "New subplot": a new subplot with this scene in it, opened. */
  onNewSubplotWithScene?: (sceneId: string) => void;
  /** A subplot's "New scene": a new scene, already in it. */
  onNewSceneInSubplot?: (arcId: string) => void;
  /** The story's subplots, for a scene's Subplots "+". */
  subplotOptions?: Array<{ id: string; name: string; color?: string }>;
  /** A tie between two characters (2026-10-15): written from `fromId`'s side;
   *  `prev` is the tie it replaces, if any. */
  onSetTie?: (fromId: string, toId: string, predicate: string, prev?: Tie) => void;
  onRemoveTie?: (tie: Tie) => void;
  /** Offsets from the opened card's top-left (2026-10-12). Where the writer put the connected cards around THIS focus (Ben,
   *  2026-10-08: they must move in the focused view). Keyed by item id;
   *  the page keeps one map per focal card. A placed item is not pushed. */
  focusLayout?: Record<string, Pos>;
  onMoveInFocus?: (focalId: string, itemId: string, pos: Pos) => void;
  /** The focused scene whose pages are open: the card is page-wide and
   *  `editor` (the one script editor, embedded) is its body. Its stickies,
   *  cast and where all come in around it at once. */
  writingId?: string | null;
  editor?: React.ReactNode;
  /** Card colour (2026-10-09): the names per colour, and the pick on any scene card. */
  labelSet?: LabelSet;
  onSetColor?: (cardId: string, color: string) => void;
  /** FIL-709: raise a scene to a sequence (it goes to the strip). */
  onToSequence?: (cardId: string) => void;
  /** FIL-708: a card open in the strip. Its scenes light with a stripe in its
   *  colour, everything else dims, and a click on a scene adds or removes it. */
  stripPick?: { lit: Set<string>; color: string; onToggle: (sceneId: string) => void; tags?: Map<string, string>; onClose?: () => void;
    /** What a click on a hovered scene does, shown on it (Ben, 2026-11-07:
     *  "make that more obvious"): to put it in, and to take it out. */
    addLabel?: string; outLabel?: string };
  /** Under an opened card's telling (a sequence's or subplot's Peer beat). */
  focusExtra?: (id: string) => React.ReactNode;
  /** With the Sequences set shown: each scene's place, "3.2". */
  scenePlace?: Map<string, { label: string; color: string }>;
  /** FIL-711: with the Subplots set shown, each scene's subplot colours, drawn as dots. */
  sceneDots?: Map<string, string[]>;
  /** FIL-707: the set the strip shows (the dot, the filter) and the set that paints the frames. Both default to the first set. */
  colorSetId?: string;
  paintSetId?: string;
  /** SCENES (Ben, 2026-10-08): the scene cards alone, in a clean grid in
   *  story order (chained ones first, then the loose ones), everything else
   *  off stage. Drag a card to a new slot and it is chained there: PRECEDES
   *  lines appear only for the card that moved; a card left alone draws
   *  none. Positions are the grid's, never saved. */
  scenesMode?: boolean;
  /** THE CHARACTERS VIEW (2026-10-15, the master's web): the characters
   *  alone, the most connected in the middle and the rest in a ring, a
   *  labelled line for every tie; drag one onto another to tie them, or
   *  anywhere else to move it there. */
  charactersMode?: boolean;
  /** THE WORLD VIEW (2026-10-15): the world strips and World cards alone, a column per kind. */
  worldMode?: boolean;
  /** Where the writer has put the characters in that view (2026-10-15: the
   *  web is theirs to arrange, not fixed in place); the rest are laid out. */
  webSaved?: Record<string, Pos>;
  /** A drag let go in open space: the moved character, plus every other
   *  one where the web had it on the first move, so nothing shifts later. */
  onMoveInWeb?: (moves: Array<{ id: string; pos: Pos }>) => void;
  /** The templates panel is up on the empty board (2026-10-14): the empty-board line moves right of it. */
  templatesShowing?: boolean;
  /** SHOW STICKIES (Ben, 2026-10-15): every card's stickies out on the
   *  board, a line to their card; off (the default), folded into the card's
   *  edges. A line of dialogue shows by its scene and by its speaker. */
  showStickies?: boolean;
  /** FOCUS MODE (FIL-722, Ben 2026-11-04): the cards whose stickies are out
   *  one by one. With onToggleStickies a click on a card puts its stickies
   *  out (or folds them) instead of opening the card. */
  openStickies?: ReadonlySet<string>;
  onToggleStickies?: (id: string) => void;
  /** The page shows its own empty state (2026-10-15, the master's): no hint line here. */
  hideEmptyHint?: boolean;
  precedes?: Array<{ from: string; to: string }>;
  onReorderScene?: (cardId: string, diff: { remove: Array<{ from: string; to: string }>; add: Array<{ from: string; to: string }> }) => void;
  /** The grid's order is the writer's (2026-10-09): kept by the page, the
   *  drop puts the card exactly in the hole and reports the new order; the
   *  links are written as data on top, never used to re-sort the wall. A
   *  scene not in the saved order falls in after its leader, else at the end. */
  gridOrder?: string[];
  onGridOrder?: (order: string[]) => void;
  /** The legend's additive filter: colours picked; empty shows everything. */
  colorFilter?: Set<string>;
  /** The item the receipt is on: lit with the jump ring. */
  spot?: string | null;
  /** Items that just landed: they fly in from `landingFrom` on first mount. */
  landingIds?: Set<string>;
  landingFrom?: Pos | null;
  /** The master's full sheet for a card: one door away from the focus. */
  onOpenCard?: (cardId: string) => void;
  /** The focus (sandboxFocus.tsx): the card at the centre, the rest pushed
   *  aside and softened. A click on a card or world entry asks for it. */
  focusId?: string | null;
  onFocus?: (id: string | null) => void;
  /** What the focus pages through: every entity (parked or placed), the
   *  edges, the world entries. */
  allEntities?: ProjectEntity[];
  edges?: Partial<ProjectEdges> | null;
  /** A sequence's or subplot's colour in the strip, for its opened card (2026-11-05). */
  stripColorOf?: (id: string) => string | undefined;
  /** sandbox-beats: the line with its beats on it; the Scenes grid reads in this order. */
  lineLinks?: Array<{ from: string; to: string }>;
  /** sandbox-beats: put a beat right before a scene, or after the last one. */
  onPlaceBeat?: (beatId: string, at: { before?: string; after?: string }) => void;
  /** A + on the thread: a new scene between these two, at this spot. */
  onInsertBetween?: (fromId: string, toId: string | null, at: Pos) => void;
  /** sandbox-beats: a scene dropped in the Scenes grid goes to this place in the line (without it). */
  onMoveInLine?: (itemId: string, index: number, shown: string[], carry?: string[]) => void;
  /** The Scenes view's layout: the grid, the timeline (Ben, 2026-11-05), or
   *  the stacked columns (2026-11-07). */
  scenesLayout?: 'grid' | 'timeline' | 'columns';
  world?: WorldEntry[];
  minHeight?: number;
  /** THE PEER ON THE SANDBOX (2026-10-20): the Peer's questions, apart from
   *  every card's own stickies. Folded, a card wears one small Peer sticky
   *  (a click opens it on its Peer pill); out (`peerExpanded`, after a pass or
   *  "Show Peer questions"), each question sits beside its card with a line
   *  to it, like Show stickies. Plain board view only. */
  peerQuestions?: SandboxFragment[];
  peerExpanded?: boolean;
  /** A folded Peer sticky on something that is not a card: put them out. */
  onPeerExpand?: () => void;
  /** Questions the last pass just left: their badges pulse. */
  peerFresh?: Set<string>;
  onDismissQuestion?: (id: string) => void;
  /** An opened world entry's kind, picked (Ben, 2026-10-22). */
  onSetWorldKind?: (id: string, kind: string) => void;
  /** Take back what an answer placed (the answer stays on its question). */
  onUndoAnswer?: (questionId: string) => void;
  /** The question whose Undo is in flight. */
  undoBusyId?: string | null;
  /** Answer typed on a Peer sticky: a sandbox dump on the card it hangs on. */
  onAnswerQuestion?: (q: SandboxFragment, cardId: string, text: string) => void;
  /** Why an answer cannot be sent yet (a dump in flight), if so. */
  answerBusy?: string;
  /** The Peer pill's reads by card, and the ask on a card (2026-10-20). */
  peerReads?: Record<string, { text: string; at: string; model: string }>;
  /** The card the Peer is reading right now, if any. */
  peerAskBusy?: string | null;
  /** The Peer button on a card: its read and a few questions, one ask. */
  onAskPeer?: (cardId: string) => void;
  /** While an answer is taken in: its live line, by question id. */
  peerLive?: Record<string, string>;
  /** Answered this session and not folded yet: their receipts stay out. */
  peerShown?: Set<string>;
  onFoldQuestion?: (id: string) => void;
  /** The board pass at work: every card breathes in Peer blue. */
  peerReading?: boolean;
  /** How the last ask on a card went, when there is something to say. */
  peerCardNote?: { cardId: string; text: string } | null;
  /** The question the Peer's receipt is on: it wears a pulsing ring. */
  peerSpot?: string | null;
  /** The questions a pass just left, out on the board while its receipt is
   *  open; every other question stays folded (Ben, 2026-10-21). */
  peerSpotlight?: Set<string>;
}) {
  const dark = useThemeMode() === 'dark';
  // Who can say a line: every living character in the story (placed or
  // parked), by name; and every sticky on the board, for a character's lines.
  const cast = useMemo(() => {
    const ents = allEntities ?? items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card').map((i) => i.entity);
    const list: CastMember[] = ents.filter((e) => e.type === 'character' && !e.deleted_at).map((e) => ({ id: e.id, name: cardTitle(e) })).sort((a, b) => a.name.localeCompare(b.name));
    const byId = new Map(list.map((c) => [c.id, c.name]));
    return { list, nameOf: (id: string | null | undefined) => (id ? byId.get(id) ?? '' : '') };
  }, [allEntities, items]);
  const allFrags = useMemo(() => {
    const out: SandboxFragment[] = [];
    for (const it of items) {
      if (it.kind === 'sticky') out.push(it.fragment);
      else if (it.kind === 'group') out.push(...it.members);
      else if (it.kind === 'card' || it.kind === 'world') out.push(...it.attached);
    }
    return out;
  }, [items]);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; pos: Pos; inFocus?: boolean; inGrid?: boolean; inWeb?: boolean } | null>(null);
  // The web's positions and hit test, for the pointer handlers above their memo.
  const webPosRef = useRef<Map<string, Pos>>(new Map());
  const webSavedRef = useRef(webSaved);
  webSavedRef.current = webSaved;
  const [webEdit, setWebEdit] = useState<{ key: string; viewer: string } | null>(null);
  // A character's scenes cascade takes no drag (the position is the meaning).
  const cascadeRef = useRef(false);
  const gridIndexRef = useRef<Map<string, number>>(new Map());
  const gridSlotRef = useRef<(i: number) => Pos>(() => ({ x: 0, y: 0 }));
  const sceneOrderRef = useRef<string[]>([]);
  const gridOrderRef = useRef<string[]>([]);
  const gridSlotAtRef = useRef<(p: Pos, count: number) => number>(() => 0);
  // The timeline's slot for an item, and where a drag lands on it.
  const tlSlotRef = useRef<((id: string) => Pos | null) | null>(null);
  const tlIndexAtRef = useRef<((id: string, pos: Pos) => number) | null>(null);
  const carryRef = useRef<(id: string) => string[]>((id) => [id]);
  const precedesRef = useRef<Array<{ from: string; to: string }>>([]);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  // Where an item sits on screen while a focus is up (pushed, a satellite,
  // or where the writer dragged it): filled in below, read by the drag start.
  const focusAtRef = useRef<(id: string) => Pos | undefined>(() => undefined);
  // Click vs drag: a press that moves under 4px is a click (opens a card,
  // edits a sticky); more is a drag. Same threshold as the master.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const [openDump, setOpenDump] = useState<string | null>(null);
  useEffect(() => { if (openDump && !items.some((i) => i.id === openDump)) setOpenDump(null); }, [items, openDump]);
  useEffect(() => {
    if (!openDump) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDump(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDump]);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => { if (editingId && !items.some((i) => i.id === editingId || (i.kind === 'group' && i.members.some((m) => m.id === editingId)))) setEditingId(null); }, [items, editingId]);

  // Flight: a landing item we have not rendered before mounts at the dock
  // point and transitions to its place on the next frame. A LAYOUT effect
  // (2026-10-17): as a plain effect it ran after the first paint, so a new
  // card was drawn in place first and only then sent to the dock and back
  // inside two frames; the flight never showed and every wave read as a pop.
  const seen = useRef<Set<string>>(new Set());
  const [flying, setFlying] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    const fresh = items.filter((i) => !seen.current.has(i.id));
    for (const i of items) seen.current.add(i.id);
    if (!landingFrom || !landingIds?.size || !fresh.length) return;
    const ids = new Set(fresh.filter((i) => landingIds.has(i.id) || (i.kind === 'group' && i.members.some((m) => landingIds.has(m.id)))).map((i) => i.id));
    if (!ids.size) return;
    setFlying((prev) => new Set([...prev, ...ids]));
    // Every flight ends: two frames after the first paint, or after a second
    // where frames do not run (a hidden tab). Never cancelled by a re-render,
    // or a card could stay invisible at the dock.
    const land = () => setFlying((prev) => { if (![...ids].some((i) => prev.has(i))) return prev; const n = new Set(prev); for (const i of ids) n.delete(i); return n; });
    requestAnimationFrame(() => requestAnimationFrame(land));
    window.setTimeout(land, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // DROP ON A CARD (2026-10-12): while a loose sticky is dragged, the card
  // under its middle is offered; letting go there puts it on the card.
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dropOnRef = useRef<string | null>(null);
  // A DROP ASKS FIRST (Ben, 2026-10-31): the sticky waits where it was let
  // go, over the card, until the writer says yes; no sends it back.
  const [pendingDrop, setPendingDrop] = useState<{ id: string; target: string; pos: Pos } | null>(null);
  // The sticky menu (right-click, or the sticky's kind label).
  const [stickyMenu, setStickyMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  dropOnRef.current = dropOn;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const dropTargetFor = useCallback((id: string, pos: Pos): string | null => {
    if (!onDropSticky) return null;
    const map = byIdRef.current;
    const it = map.get(id);
    if (!it || it.kind !== 'sticky' || it.fragment.kind === 'story') return null;
    const sz = itemSize(it);
    const cx = pos.x + sz.w / 2, cy = pos.y + sz.h / 2;
    const line = it.fragment.kind === 'dialogue';
    let hit: string | null = null;
    for (const c of map.values()) {
      // A sticky also goes into a group, or onto a loose sticky to start one.
      const groupable = !!onGroupSticky && !line && (c.kind === 'group' || (c.kind === 'sticky' && c.id !== id && c.fragment.kind !== 'story' && c.fragment.kind !== 'dialogue'));
      if (c.kind !== 'card' && c.kind !== 'world' && !groupable) continue;
      if (line && (c.kind === 'world' || (c.kind === 'card' && !['event', 'sequence', 'character'].includes(c.entity.type)))) continue;
      const p = positionsRef.current[c.id];
      if (!p) continue;
      const cs = itemSize(c);
      if (cx >= p.x && cx <= p.x + cs.w && cy >= p.y && cy <= p.y + cs.h) hit = c.id;
    }
    return hit;
  }, [onDropSticky, onGroupSticky]);
  // THE POINTER ON THE BOARD (FIL-698, Philip 2026-10-30: a tall world card
  // half-dragged, walked up and jumped on drop). A drag was kept in screen
  // coordinates, so when the board scrolled under it (moving the lowest card
  // up shrinks the board and the browser pulls the scroll back) the card
  // drifted off the pointer. Board coordinates follow the scroll.
  const onStage = useCallback((e: { clientX: number; clientY: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button != null && e.button !== 0) return;
    downAt.current = { x: e.clientX, y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom, or an already-captured pointer */ }
    // While a focus is up a drag arranges the view AROUND the focused card
    // (kept per focal card, never written as the board position): it starts
    // from where the item is on screen, pushed or placed.
    if (focusId) {
      const cur = focusAtRef.current(id) ?? positions[id] ?? { x: 0, y: 0 };
      const at = onStage(e);
      setDrag({ id, dx: at.x - cur.x, dy: at.y - cur.y, pos: cur, inFocus: true });
      return;
    }
    // The world view's places are the view's own; a press there is a click.
    if (worldMode) return;
    if (charactersMode) {
      const cur = webPosRef.current.get(id);
      if (!cur) return;
      const at = onStage(e);
      setDrag({ id, dx: at.x - cur.x, dy: at.y - cur.y, pos: cur, inWeb: true });
      return;
    }
    if (scenesMode) {
      const gi = gridIndexRef.current.get(id);
      if (gi == null) return; // only scene cards move on the grid
      const cur = (tlSlotRef.current && tlSlotRef.current(id)) || gridSlotRef.current(gi);
      const at = onStage(e);
      setDrag({ id, dx: at.x - cur.x, dy: at.y - cur.y, pos: cur, inGrid: true });
      return;
    }
    const pos = positions[id] ?? { x: 0, y: 0 };
    const at = onStage(e);
    setDrag({ id, dx: at.x - pos.x, dy: at.y - pos.y, pos });
  }, [positions, focusId, scenesMode, charactersMode, worldMode, onStage]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d) return d;
      if (d.inFocus && cascadeRef.current) return d;
      const at = onStage(e);
      const pos = { x: Math.max(0, at.x - d.dx), y: Math.max(0, at.y - d.dy) };
      if (d.inWeb) {
        const cx = pos.x + CHAR_W / 2, cy = pos.y + CHAR_H / 2;
        let hit: string | null = null;
        for (const [wid, p] of webPosRef.current) if (wid !== d.id && cx >= p.x && cx <= p.x + CHAR_W && cy >= p.y && cy <= p.y + CHAR_H) hit = wid;
        if (hit !== dropOnRef.current) setDropOn(hit);
      } else if (d.inGrid) setGridTarget(tlIndexAtRef.current ? tlIndexAtRef.current(d.id, pos) : gridSlotAtRef.current(pos, sceneOrderRef.current.length - 1));
      else if (!d.inFocus) { const t = dropTargetFor(d.id, pos); if (t !== dropOnRef.current) setDropOn(t); }
      return { ...d, pos };
    });
  }, [dropTargetFor, onStage]);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const start = downAt.current;
    const moved = !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 4;
    downAt.current = null;
    const d = dragRef.current;
    setDrag(null);
    if (d && moved && d.inWeb) {
      // Dropped on another character: tie them, and open the label to write.
      // Let go anywhere else: it stays there. The web's spots are its own,
      // never the board's. Where it was let go is read from the release
      // itself: a quick flick can let go before the last move has drawn.
      const at = onStage(e);
      const pos = { x: Math.max(0, at.x - d.dx), y: Math.max(0, at.y - d.dy) };
      const cx = pos.x + CHAR_W / 2, cy = pos.y + CHAR_H / 2;
      let target: string | null = null;
      for (const [wid, p] of webPosRef.current) if (wid !== d.id && cx >= p.x && cx <= p.x + CHAR_W && cy >= p.y && cy <= p.y + CHAR_H) target = wid;
      setDropOn(null);
      if (target && onSetTie) {
        onSetTie(d.id, target, 'related');
        setWebEdit({ key: d.id < target ? `${d.id}|${target}` : `${target}|${d.id}`, viewer: d.id });
      } else if (!target && onMoveInWeb) {
        const kept = webSavedRef.current ?? {};
        const rest = [...webPosRef.current].filter(([id]) => id !== d.id && !kept[id]).map(([id, p]) => ({ id, pos: p }));
        onMoveInWeb([...rest, { id: d.id, pos }]);
      }
      return;
    }
    if (d && moved) {
      if (d.inFocus) { const fp = focusPosRef.current; if (focusId && fp && !cascadeRef.current) onMoveInFocus?.(focusId, d.id, { x: Math.round(d.pos.x - fp.x), y: Math.round(d.pos.y - fp.y) }); }
      else if (d.inGrid) {
        // The slot the hand let go over: how many other cards read before it
        // (rows first, then left to right, half a card of slack on the row).
        const order = sceneOrderRef.current;
        const from = order.indexOf(d.id);
        const target = gridTargetRef.current;
        setGridTarget(null);
        const isScene = (x: string) => { const it = byIdRef.current.get(x); return it?.kind === 'card' && it.entity.type === 'event'; };
        // A beat dropped in the grid takes its new place on the line (sandbox-beats).
        const isBeatId = (x: string) => { const it = byIdRef.current.get(x); return it?.kind === 'card' && it.entity.type === 'sequence'; };
        if (from >= 0 && target != null && (isScene(d.id) || isBeatId(d.id)) && onMoveInLine && lineLinks) {
          // The grid is the order: a scene or a beat goes where it is dropped.
          const carry = carryRef.current(d.id);
          const to = Math.min(order.length - carry.length, Math.max(0, target));
          if (to !== from) { if (carry.length > 1) onMoveInLine(d.id, to, order, carry); else onMoveInLine(d.id, to, order); }
        } else if (from >= 0 && target != null && isBeatId(d.id) && onPlaceBeat) {
          const rest = order.filter((x) => x !== d.id);
          const to = Math.min(rest.length, Math.max(0, target));
          if (to !== from) onPlaceBeat(d.id, beatPlaceAt(rest, to, isScene));
        } else if (from >= 0 && target != null && isScene(d.id)) {
          const rest = order.filter((x) => x !== d.id);
          const to = Math.min(rest.length, Math.max(0, target));
          if (to !== from) {
            // THE WALL IS THE ORDER (Ben, 2026-10-09). The card goes exactly
            // into the hole; it and its two neighbours on the wall join the
            // ordered run (the saved order); and the links among the ordered
            // cards are made to read exactly as the wall does, left to right.
            // Cards the writer never moved stay out of the run and unlinked.
            const next = [...rest]; next.splice(to, 0, d.id);
            const ordered = new Set(gridOrderRef.current);
            ordered.add(d.id);
            if (next[to - 1]) ordered.add(next[to - 1]);
            if (next[to + 1]) ordered.add(next[to + 1]);
            const run = next.filter((id) => ordered.has(id) && isScene(id));
            onGridOrder?.(run);
            const pre = precedesRef.current.filter((p) => order.includes(p.from) && order.includes(p.to));
            const want = new Set<string>();
            for (let i = 0; i + 1 < run.length; i++) want.add(`${run[i]}|${run[i + 1]}`);
            const remove = pre.filter((p) => !want.has(`${p.from}|${p.to}`) && ((ordered.has(p.from) && ordered.has(p.to)) || p.from === d.id || p.to === d.id));
            const have = new Set(pre.map((p) => `${p.from}|${p.to}`));
            const add: Array<{ from: string; to: string }> = [];
            for (let i = 0; i + 1 < run.length; i++) if (!have.has(`${run[i]}|${run[i + 1]}`)) add.push({ from: run[i], to: run[i + 1] });
            if (remove.length || add.length) onReorderScene?.(d.id, { remove: remove.map((p) => ({ from: p.from, to: p.to })), add });
          }
        }
      } else if (dropOnRef.current && onDropSticky) { const target = dropOnRef.current; setDropOn(null); setPendingDrop({ id: d.id, target, pos: d.pos }); }
      else onMove(d.id, d.pos);
    } else if (d?.inGrid) setGridTarget(null);
    if (moved) return;
    // A click. Cards open; stickies edit (inside a group, the one under the pointer).
    // The element under the pointer, not e.target: the press captured the
    // pointer on the item wrapper (for the drag), so a real mouse's release
    // is reported on the wrapper and never on the sticky inside it. That is
    // why a click on a sticky did nothing on the board (2026-10-12).
    const wrapEl = e.currentTarget as HTMLElement;
    const under = typeof document.elementFromPoint === 'function' ? (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) : null;
    const target = under && wrapEl.contains(under) ? under : (e.target as HTMLElement);
    const stickyEl = target.closest('[data-sticky-id]') as HTMLElement | null;
    const itemEl = target.closest('[data-stage-item]') as HTMLElement | null;
    const itemId = itemEl?.getAttribute('data-stage-item') ?? '';
    const it = itemId ? byIdRef.current.get(itemId) : undefined;
    if (!it) return;
    if (it.kind === 'token') { setOpenDump((cur) => (cur === it.id ? null : it.id)); return; }
    if (stripPick && it.kind === 'card' && it.entity.type === 'event') { stripPick.onToggle(it.id); return; }
    if ((it.kind === 'card' || it.kind === 'world') && onToggleStickies && !focusId) onToggleStickies(it.id);
    else if (it.kind === 'card' || it.kind === 'world') { if (onFocus) onFocus(it.id); else onOpenCard?.(it.id); }
    else if (it.kind === 'sticky' && onStickyEdit) setEditingId(it.id);
    else if (it.kind === 'group' && stickyEl && onStickyEdit) setEditingId(stickyEl.getAttribute('data-sticky-id'));
    if (dropOnRef.current) setDropOn(null);
  }, [onMove, onOpenCard, onStickyEdit, onFocus, onMoveInFocus, focusId, onReorderScene, onGridOrder, onDropSticky, onSetTie, onMoveInWeb, onStage, stripPick, onToggleStickies, onPlaceBeat, onMoveInLine, lineLinks]);

  // SCENES grid: order = the chains first (a head, then what follows it,
  // by the PRECEDES among these cards), then the loose scenes in item order.
  const sceneIds = useMemo(() => items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card' && (i.entity.type === 'event' || i.entity.type === 'sequence')).map((i) => i.id), [items]);
  const sceneOrder = useMemo(() => {
    // sandbox-beats: the grid reads as the line does, beat, its scenes, next
    // beat (Ben, 2026-11-05: "our ordering in the scenes grid is totally
    // broken"); the saved wall order only breaks ties.
    if (lineLinks) {
      const set = new Set(sceneIds);
      const tie = [...(gridOrder ?? []).filter((id) => set.has(id)), ...sceneIds.filter((id) => !(gridOrder ?? []).includes(id))];
      return sceneLine([...new Set(tie)], lineLinks);
    }
    // THE WRITER'S ORDER FIRST: the saved grid order, as far as it names
    // cards still here. Anything not in it falls in right after its leader
    // (PRECEDES) when the leader is placed, else at the end, in base order.
    // The links never re-sort the wall (2026-10-08: one link shuffled it).
    const set = new Set(sceneIds);
    const out: string[] = []; const seen = new Set<string>();
    for (const id of gridOrder ?? []) if (set.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    const prevOf = new Map<string, string>();
    const nextOf = new Map<string, string>();
    for (const p of precedes ?? []) {
      if (!set.has(p.from) || !set.has(p.to)) continue;
      if (!prevOf.has(p.to)) prevOf.set(p.to, p.from);
      if (!nextOf.has(p.from)) nextOf.set(p.from, p.to);
    }
    // A card whose leader is not placed yet goes in front of the card it
    // leads into, when that one is (2026-10-14: a re-applied template's
    // first scene, newer than the rest, fell to the end of the run). Nothing
    // already placed moves.
    for (const id of sceneIds) {
      if (seen.has(id)) continue;
      const leader = prevOf.get(id);
      const follower = nextOf.get(id);
      const at = leader && seen.has(leader) ? out.indexOf(leader) + 1
        : follower && seen.has(follower) ? out.indexOf(follower)
          : out.length;
      out.splice(at, 0, id); seen.add(id);
    }
    return out;
  }, [sceneIds, precedes, gridOrder, lineLinks]);
  const [stageW, setStageW] = useState(1200);
  const [viewH, setViewH] = useState(640);
  useEffect(() => {
    const wrap = stageRef.current?.parentElement;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { setStageW(wrap.clientWidth || 1200); setViewH(wrap.clientHeight || 640); });
    ro.observe(wrap); setStageW(wrap.clientWidth || 1200); setViewH(wrap.clientHeight || 640);
    return () => ro.disconnect();
  }, []);
  const GX = 24, GY = 28;
  const gridCols = Math.max(1, Math.floor((stageW - 48 + GX) / (SCENE_W + GX)));
  // The grid sits centred on the canvas (Ben, 2026-11-05).
  const gridX0 = Math.max(24, Math.round((stageW - (gridCols * (SCENE_W + GX) - GX)) / 2));
  const gridSlot = useCallback((i: number): Pos => ({ x: gridX0 + (i % gridCols) * (SCENE_W + GX), y: 24 + Math.floor(i / gridCols) * (SCENE_H + GY) }), [gridCols, gridX0]);
  /** The slot a dragged card's centre is over, against the fixed grid (the
   *  slots do not move, so the target cannot chase the reflow). */
  const gridSlotAt = useCallback((p: Pos, count: number): number => {
    const cx = p.x + SCENE_W / 2, cy = p.y + SCENE_H / 2;
    const col = Math.min(gridCols - 1, Math.max(0, Math.round((cx - gridX0 - SCENE_W / 2) / (SCENE_W + GX))));
    const row = Math.max(0, Math.floor((cy - 24) / (SCENE_H + GY)));
    return Math.min(count, row * gridCols + col);
  }, [gridCols, gridX0]);
  // While a card is dragged on the grid: the slot it will land in. The other
  // cards make room live and the empty slot is drawn, so the hand sees the
  // landing before it lets go (Ben, 2026-10-09).
  const [gridTarget, setGridTarget] = useState<number | null>(null);
  const gridTargetRef = useRef<number | null>(null);
  gridTargetRef.current = gridTarget;
  const gridIndex = useMemo(() => new Map(sceneOrder.map((id, i) => [id, i])), [sceneOrder]);
  gridIndexRef.current = gridIndex; gridSlotRef.current = gridSlot; sceneOrderRef.current = sceneOrder; precedesRef.current = precedes ?? []; gridOrderRef.current = gridOrder ?? [];
  // The legend's filter, by colour. Scenes only.
  const dimOf = useCallback((e: ProjectEntity): boolean => {
    if (stripPick) return !(e.type === 'event' && stripPick.lit.has(e.id));
    return !colorFilter?.size || (e.type !== 'event' && e.type !== 'sequence') ? false : !colorMatches(e, colorFilter, colorSetId);
  }, [colorFilter, colorSetId, stripPick]);
  // The ordered run's numbers (1, 2, 3...): the saved order, as it reads on the wall.
  const runIndex = useMemo(() => {
    const m = new Map<string, number>(); let n = 0;
    // sandbox-beats: every scene is numbered along the line; beats are not.
    if (lineLinks) { const ev = new Set(items.filter((i) => i.kind === 'card' && i.entity.type === 'event').map((i) => i.id)); for (const id of sceneOrder) if (ev.has(id)) m.set(id, n++); return m; }
    const run = new Set(gridOrder ?? []); for (const id of sceneOrder) if (run.has(id)) m.set(id, n++); return m;
  }, [gridOrder, sceneOrder, lineLinks, items]);
  gridSlotAtRef.current = gridSlotAt;
  // The grid as it reads while a card is in the hand: the dragged card out,
  // a hole at the target, everything after it one slot on.
  const liveIndex = useMemo(() => {
    if (!drag?.inGrid || gridTarget == null) return gridIndex;
    const rest = sceneOrder.filter((x) => x !== drag.id);
    const m = new Map<string, number>();
    rest.forEach((id, j) => m.set(id, j >= gridTarget ? j + 1 : j));
    return m;
  }, [drag, gridTarget, sceneOrder, gridIndex]);
  // THE TIMELINE (Ben, 2026-11-05): scenes on one track, beats as bands over
  // their stretch. While a card is in the hand, the rest make room for it.
  const timeline = scenesMode && scenesLayout === 'timeline';
  // THE STACKED OUTLINE (Ben, 2026-11-07): a column per beat, its scenes
  // stacked under its tab. A tab dragged takes its whole column with it.
  const columns = scenesMode && scenesLayout === 'columns';
  const laid = timeline || columns;
  const isBeatItem = useCallback((id: string) => items.some((i) => i.id === id && i.kind === 'card' && i.entity.type === 'sequence'), [items]);
  const carryOf = useCallback((id: string) => (columns && isBeatItem(id) ? [id, ...stretchOf(sceneOrder, isBeatItem, id)] : [id]), [columns, isBeatItem, sceneOrder]);
  carryRef.current = carryOf;
  const tlLayout = useMemo(() => {
    if (!laid) return null;
    let order = sceneOrder;
    if (drag?.inGrid && gridTarget != null) order = moveBlock(sceneOrder, carryOf(drag.id), gridTarget);
    return columns ? columnsLayout(order, isBeatItem) : timelineLayout(order, isBeatItem);
  }, [laid, columns, sceneOrder, drag, gridTarget, isBeatItem, carryOf]);
  tlSlotRef.current = laid ? (id: string) => { const r = (columns ? columnsLayout : timelineLayout)(sceneOrder, isBeatItem).get(id); return r ? { x: r.x, y: r.y } : null; } : null;
  tlIndexAtRef.current = laid ? (id: string, pos: Pos) => {
    const block = carryOf(id);
    const rest = sceneOrder.filter((x) => !block.includes(x));
    if (columns) return isBeatItem(id) ? columnsBlockIndexAt(rest, isBeatItem, pos.x) : columnsSceneIndexAt(rest, isBeatItem, pos);
    const r = timelineLayout(sceneOrder, isBeatItem).get(id);
    return timelineIndexAt(rest, isBeatItem, pos.x, r ? Math.min(r.w, TL.sceneW) : TL.sceneW);
  } : null;
  // Each column's Add a scene slot, or on the timeline an empty beat's.
  const addSlots = useMemo(() => {
    if (!laid || !tlLayout) return [] as { key: string; after: string; rect: Rect; empty: boolean; beat: string | null }[];
    if (columns) return columnSlots(sceneOrder, isBeatItem).map((x) => ({ ...x, key: `slot:${x.beat ?? 'lead'}` }));
    return sceneOrder.filter((id) => isBeatItem(id) && !stretchOf(sceneOrder, isBeatItem, id).length).map((id) => {
      const tr = tlLayout.get(id)!;
      return { key: `slot:${id}`, after: id, beat: id, empty: true, rect: { x: tr.x, y: TL.trackY, w: tr.w, h: TL.sceneH } };
    });
  }, [laid, columns, tlLayout, sceneOrder, isBeatItem]);
  // THE CHARACTERS VIEW's layout (the master's web): ties among the board's
  // characters, each character's weight (two per tie, one per scene they
  // are in), the heaviest in the middle and the rest in a ring by weight.
  const webTies = useMemo(() => {
    if (!charactersMode) return [] as Tie[];
    const ids = new Set(items.filter((it) => it.kind === 'card' && it.entity.type === 'character').map((it) => it.id));
    const ents = allEntities ?? items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card').map((i) => i.entity);
    return pairTies(ents, (edges?.structural ?? []) as any).filter((t) => ids.has(t.a) && ids.has(t.b));
  }, [charactersMode, items, allEntities, edges]);
  // A web label is placed for the wider of its two wordings, so it does not
  // jump when hovering a card turns it around.
  const webLabelW = useCallback((t: Tie) => Math.max(tieLabelW(tieLabel(t, t.from)), tieLabelW(tieLabel(t, t.to))), []);
  const webPos = useMemo(() => {
    if (!charactersMode) return new Map<string, Pos>();
    const chars = items.filter((it) => it.kind === 'card' && it.entity.type === 'character').map((it) => it.id);
    const weight = new Map(chars.map((id) => [id, 0]));
    for (const t of webTies) { weight.set(t.a, (weight.get(t.a) ?? 0) + 2); weight.set(t.b, (weight.get(t.b) ?? 0) + 2); }
    for (const e of edges?.involves ?? []) if (weight.has(e.to)) weight.set(e.to, (weight.get(e.to) ?? 0) + 1);
    const auto = webLayout({ ids: chars, ties: webTies.map((t) => ({ a: t.a, b: t.b, lw: webLabelW(t) })), weight, viewW: stageW, viewH, w: CHAR_W, h: CHAR_H });
    if (!webSaved || !chars.some((id) => webSaved[id])) return auto;
    // The writer's arrangement first; anyone they have not placed yet (a
    // character made since) goes to the nearest open spot to where the
    // automatic layout would put them.
    const m = new Map<string, Pos>();
    const taken: Rect[] = [];
    for (const id of chars) { const p = webSaved[id]; if (p) { m.set(id, p); taken.push({ x: p.x, y: p.y, w: CHAR_W, h: CHAR_H }); } }
    for (const id of chars) {
      if (m.has(id)) continue;
      const a = auto.get(id) ?? { x: 0, y: 0 };
      const p = freeSpotIn({ x: a.x - 360, y: a.y - 240, w: CHAR_W + 720, h: CHAR_H + 480 }, { w: CHAR_W, h: CHAR_H }, taken, 24);
      m.set(id, p); taken.push({ x: p.x, y: p.y, w: CHAR_W, h: CHAR_H });
    }
    return m;
  }, [charactersMode, items, webTies, edges, stageW, viewH, webLabelW, webSaved]);
  webPosRef.current = webPos;
  const [webHover, setWebHover] = useState<string | null>(null);
  const worldView = useMemo(() => (worldMode ? worldColumns(items, stageW) : { pos: new Map<string, Pos>(), heads: [] }), [worldMode, items, stageW]);
  const posOf = useCallback((id: string): Pos | undefined => {
    if (drag && drag.id === id) return drag.pos;
    if (worldMode) { const p = worldView.pos.get(id); if (p) return p; }
    if (charactersMode) { const p = webPos.get(id); if (p) return p; }
    if (scenesMode && tlLayout) { const r = tlLayout.get(id); if (r) return { x: r.x, y: r.y }; }
    if (scenesMode) { const gi = liveIndex.get(id); if (gi != null) return gridSlot(gi); }
    return positions[id];
  }, [drag, positions, scenesMode, liveIndex, gridSlot, charactersMode, webPos, worldMode, worldView, tlLayout]);
  // Which way each beat tab points: the way the line leaves it, by the same
  // rule the thread uses (straight down when the next card sits below it,
  // else toward the next card's side). The last beat follows the line in.
  const beatPoint = useMemo(() => {
    const out = new Map<string, 'left' | 'right' | 'down'>();
    if (!lineLinks) return out;
    const next = new Map<string, string>(); const prev = new Map<string, string>();
    for (const l of lineLinks) { if (!next.has(l.from)) next.set(l.from, l.to); if (!prev.has(l.to)) prev.set(l.to, l.from); }
    const byIdNow = new Map(items.map((i) => [i.id, i]));
    const box = (id: string) => { const it = byIdNow.get(id); const p = posOf(id); return it && p ? { ...p, ...itemSize(it) } : null; };
    const below = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => b.y >= a.y + a.h - 4 && b.x < a.x + a.w && b.x + b.w > a.x;
    for (const it of items) {
      if (it.kind !== 'card' || it.entity.type !== 'sequence') continue;
      const a = box(it.id); if (!a) continue;
      const nb = next.get(it.id) ? box(next.get(it.id)!) : null;
      if (nb) { out.set(it.id, below(a, nb) ? 'down' : nb.x + nb.w / 2 < a.x + a.w / 2 ? 'left' : 'right'); continue; }
      const pb = prev.get(it.id) ? box(prev.get(it.id)!) : null;
      if (pb) out.set(it.id, below(pb, a) ? 'down' : pb.x + pb.w / 2 > a.x + a.w / 2 ? 'left' : 'right');
    }
    return out;
  }, [items, lineLinks, posOf]);
  // Each web tie's label: on its line, clear of every card and of the labels
  // placed before it, following a card while it is dragged.
  const webSpots = useMemo(() => {
    if (!charactersMode) return new Map<string, Pos>();
    const cards: Rect[] = [];
    for (const id of webPos.keys()) { const p = posOf(id); if (p) cards.push({ x: p.x, y: p.y, w: CHAR_W, h: CHAR_H }); }
    const lines = webTies.flatMap((t) => {
      const pa = posOf(t.a), pb = posOf(t.b);
      return pa && pb ? [{ key: `${t.a}|${t.b}`, a: { x: pa.x + CHAR_W / 2, y: pa.y + CHAR_H / 2 }, b: { x: pb.x + CHAR_W / 2, y: pb.y + CHAR_H / 2 }, lw: webLabelW(t) }] : [];
    });
    return webLabelSpots(lines, cards);
  }, [charactersMode, webPos, webTies, posOf, webLabelW]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // A template's scenes wear their place in the film (2026-10-14: the
  // chronology should read on the board, not only along the thread).
  const templateNo = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    // Scenes only: a template's acts are beats on the line now (2026-11-08).
    for (const id of sceneOrder) { const it = byId.get(id); if (it && isTemplateItem(it) && it.kind === 'card' && it.entity.type === 'event') m.set(id, ++n); }
    return m;
  }, [sceneOrder, byId]);
  const byIdRef = useRef(byId);
  useEffect(() => { byIdRef.current = byId; }, [byId]);
  // CONNECT (Ben, 2026-11-05: "a way to connect scenes that we manually
  // create and order them"). The dot on a scene's right edge drags a line;
  // let go on another scene and that one comes next (sandboxConnect.ts).
  const [linkDrag, setLinkDrag] = useState<{ from: string; at: Pos; over: string | null } | null>(null);
  // THE + ON THE THREAD (Ben, 2026-11-05): hovering the line between two
  // cards shows a small +; it makes a new scene there, between them.
  const [lineHover, setLineHover] = useState<string | null>(null);
  // Hovering a card offers the + on the line out of it (Ben, 2026-11-05).
  const [cardHover, setCardHover] = useState<string | null>(null);
  const cardHoverTimer = useRef<number | null>(null);
  // Leaving a card waits a moment so the pointer can reach its +.
  const hoverCard = useCallback((id: string | null) => {
    if (cardHoverTimer.current) { window.clearTimeout(cardHoverTimer.current); cardHoverTimer.current = null; }
    if (id) setCardHover(id);
    else cardHoverTimer.current = window.setTimeout(() => setCardHover(null), 300);
  }, []);
  const lineHoverTimer = useRef<number | null>(null);
  const hoverLine = useCallback((key: string | null) => {
    if (lineHoverTimer.current) { window.clearTimeout(lineHoverTimer.current); lineHoverTimer.current = null; }
    if (key) setLineHover(key);
    else lineHoverTimer.current = window.setTimeout(() => setLineHover(null), 250);
  }, []);
  const linkRef = useRef(linkDrag);
  linkRef.current = linkDrag;
  const sceneAt = useCallback((at: Pos, except: string): string | null => {
    let hit: string | null = null;
    byIdRef.current.forEach((c) => {
      if (c.kind !== 'card' || (c.entity.type !== 'event' && !(onPlaceBeat && c.entity.type === 'sequence')) || c.id === except) return;
      const p = positionsRef.current[c.id];
      if (!p) return;
      const z = itemSize(c);
      if (at.x >= p.x && at.x <= p.x + z.w && at.y >= p.y && at.y <= p.y + z.h) hit = c.id;
    });
    return hit;
  }, [onPlaceBeat]);
  const linkDown = useCallback((e: React.PointerEvent, from: string) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    setLinkDrag({ from, at: onStage(e), over: null });
  }, [onStage]);
  const linkMove = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const at = onStage(e);
    setLinkDrag((d) => (d ? { ...d, at, over: sceneAt(at, d.from) } : d));
  }, [onStage, sceneAt]);
  const linkUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const d = linkRef.current;
    setLinkDrag(null);
    if (!d || !onReorderScene) return;
    const over = sceneAt(onStage(e), d.from);
    if (!over) return;
    // To or from a beat: the beat moves (sandbox-beats). A scene onto a beat
    // puts the beat right after the scene; a beat onto a scene, right before it.
    const kindOf = (x: string) => { const it = byIdRef.current.get(x); return it?.kind === 'card' ? it.entity.type : ''; };
    if (onPlaceBeat && (kindOf(d.from) === 'sequence' || kindOf(over) === 'sequence')) {
      if (kindOf(d.from) === 'sequence' && kindOf(over) === 'event') onPlaceBeat(d.from, { before: over });
      else if (kindOf(d.from) === 'event' && kindOf(over) === 'sequence') {
        const rest = sceneOrder.filter((x) => x !== over);
        onPlaceBeat(over, beatPlaceAt(rest, rest.indexOf(d.from) + 1, (x) => kindOf(x) === 'event'));
      }
      return;
    }
    const scenes = new Set<string>();
    byIdRef.current.forEach((c) => { if (c.kind === 'card' && c.entity.type === 'event') scenes.add(c.id); });
    const diff = connectDiff(precedes ?? [], d.from, over, scenes);
    if (diff) onReorderScene(over, diff);
  }, [onReorderScene, precedes, sceneAt, onStage, onPlaceBeat, sceneOrder]);
  const holderOf = useCallback((fragId: string): StageItem | undefined => {
    const direct = byId.get(fragId);
    if (direct) return direct;
    return items.find((i) => i.kind === 'group' && i.members.some((m) => m.id === fragId));
  }, [byId, items]);
  // The Peer's open questions by the item they live on (sandboxPeer.tsx).
  const stateOf = (q: SandboxFragment) => q.peer?.state ?? (q.open ? 'open' : 'dismissed');
  // Taken in (2026-10-20): an answer being read in, or just answered, stays
  // out beside its card even when the questions are folded.
  const isLive = useCallback((q: SandboxFragment) => stateOf(q) === 'answering' || (stateOf(q) === 'answered' && !!peerShown?.has(q.id)) || (stateOf(q) === 'open' && !!peerSpotlight?.has(q.id)), [peerShown, peerSpotlight]);
  const peerByHome = useMemo(
    () => (peerQuestions.length ? peerHomes(peerQuestions, (id) => byId.has(id), (id) => holderOf(id)?.id, (q) => stateOf(q) === 'open' || isLive(q)) : new Map<string, SandboxFragment[]>()),
    [peerQuestions, byId, holderOf, isLive],
  );
  // The card's Peer pill also keeps what was answered there.
  const peerByHomeAll = useMemo(
    () => (peerQuestions.length ? peerHomes(peerQuestions, (id) => byId.has(id), (id) => holderOf(id)?.id, (q) => ['open', 'answering', 'answered'].includes(stateOf(q))) : new Map<string, SandboxFragment[]>()),
    [peerQuestions, byId, holderOf],
  );
  // The Peer sticky whose answer box is open: it grows, the rest make room.
  const [peerAnswering, setPeerAnswering] = useState<string | null>(null);
  const peerSize = useCallback((q: SandboxFragment) => peerStickySize(q, q.id === peerAnswering), [peerAnswering]);
  useEffect(() => { setPeerAnswering(null); }, [focusId]);
  const peerOnBoard = peerByHome.size > 0 && !focusId && !scenesMode && !charactersMode && !worldMode;
  // The cards a question just landed on pulse as it lands.
  const peerLanded = useMemo(() => {
    const out = new Set<string>();
    if (!peerFresh?.size) return out;
    for (const [home, qs] of peerByHome) if (qs.some((q) => peerFresh.has(q.id))) out.add(home);
    return out;
  }, [peerFresh, peerByHome]);
  const peerOut = peerOnBoard && peerExpanded;
  const peerFolded = peerOnBoard && !peerExpanded;

  // The stickies out on the board: each card's in open space near it. Laid
  // out from where the cards rest (not per drag move); while a card is
  // dragged its stickies travel with it.
  const unfolded = useMemo(() => {
    const out: Array<{ key: string; parent: string; f: SandboxFragment; pos: Pos; w: number; h: number; peer?: boolean }> = [];
    const anyLive = [...peerByHome.values()].some((qs) => qs.some(isLive));
    const some = !!openStickies?.size;
    if ((!showStickies && !some && !peerOut && !anyLive) || focusId || scenesMode || charactersMode || worldMode) return out;
    const isOut = (id: string) => showStickies || !!openStickies?.has(id);
    const kids = new Map<string, SandboxFragment[]>();
    for (const it of items) if ((it.kind === 'card' || it.kind === 'world') && it.attached.length && isOut(it.id)) kids.set(it.id, [...it.attached]);
    // A line also hangs by whoever says it, when they are on the board.
    for (const it of items) {
      if (it.kind !== 'card' && it.kind !== 'world') continue;
      for (const f of it.attached) {
        if (f.kind !== 'dialogue' || !f.speaker || f.speaker === it.id || !isOut(it.id)) continue;
        const sp = items.find((x) => x.id === f.speaker && x.kind === 'card');
        if (!sp || (kids.get(sp.id) ?? []).some((g) => g.id === f.id)) continue;
        kids.set(sp.id, [...(kids.get(sp.id) ?? []), f]);
      }
    }
    const obstacles: Rect[] = [];
    for (const it of items) { const p = positions[it.id]; if (p) { const z = itemSize(it); obstacles.push({ x: p.x, y: p.y, w: z.w, h: z.h }); } }
    // Stickies keep off a beat tab's point (Ben, 2026-11-05): the line leaves
    // from there, so a no-go zone sits beyond the tip.
    for (const [id, dir] of beatPoint) {
      const it = items.find((x) => x.id === id); const p = positions[id];
      if (!it || !p) continue;
      const z = itemSize(it);
      obstacles.push(dir === 'right' ? { x: p.x + z.w - 4, y: p.y - 30, w: 90, h: z.h + 60 }
        : dir === 'left' ? { x: p.x - 86, y: p.y - 30, w: 90, h: z.h + 60 }
          : { x: p.x + z.w / 2 - 70, y: p.y + z.h - 4, w: 140, h: 80 });
    }
    // The Peer's questions go out with them, after the card's own; folded,
    // only the ones being answered or just answered do.
    for (const [id, qs] of peerByHome) {
      const out2 = peerOut ? qs : qs.filter(isLive);
      if (out2.length) kids.set(id, [...(kids.get(id) ?? []), ...out2]);
    }
    const isPeer = (f: SandboxFragment) => f.author === 'peer';
    // A Peer question is laid out at its closed size, whatever it is doing:
    // opening it to answer never moves it (Ben, 2026-10-21: it flew off the
    // board); it grows in place and nudges its neighbours instead.
    const size = (f: SandboxFragment) => (isPeer(f) ? { w: PEER_STICKY_W, h: peerStickyHeight(f) } : { w: STICKY_SAT_W, h: Math.max(STICKY_SAT_H, stickyHeight(f) + 8) });
    const parents = [...kids].flatMap(([id, list]) => {
      const it = items.find((x) => x.id === id); const p = positions[id];
      if (!it || !p) return [];
      const z = itemSize(it);
      return [{ id, rect: { x: p.x, y: p.y, w: z.w, h: z.h }, list }];
    });
    const at = unfoldAround(parents.map((pr) => ({ rect: pr.rect, items: pr.list.map((f) => ({ key: `${pr.id}:${f.id}`, ...size(f) })) })), obstacles, 28, stageW - 12);
    for (const pr of parents) for (const f of pr.list) {
      const key = `${pr.id}:${f.id}`; const pos = at.get(key);
      if (pos) out.push({ key, parent: pr.id, f, pos, ...size(f), ...(isPeer(f) ? { peer: true } : {}) });
    }
    return out;
  }, [showStickies, openStickies, peerOut, peerByHome, isLive, focusId, scenesMode, charactersMode, worldMode, items, positions, stageW, beatPoint]);
  const unfoldPos = useCallback((u: { parent: string; pos: Pos }): Pos => {
    if (drag?.id !== u.parent) return u.pos;
    const home = positions[u.parent];
    return home ? { x: u.pos.x + drag.pos.x - home.x, y: u.pos.y + drag.pos.y - home.y } : u.pos;
  }, [drag, positions]);
  const [unfoldEdit, setUnfoldEdit] = useState<string | null>(null);
  // A Peer question opened on the board (answering, or showing what its
  // answer added) is wider and taller than its slot: it grows from where it
  // sits, away from its card, and whatever it would cover steps aside until
  // it closes. Display only: nothing here is saved.
  const peerGrown = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const u of unfolded) {
      if (!u.peer) continue;
      const real = peerStickySize(u.f, peerAnswering === u.f.id);
      if (real.w <= u.w + 1 && real.h <= u.h + 1) continue;
      // Away from its card: leftward only when it sits wholly left of the
      // card and has the room; otherwise right and down, its top-left fixed.
      const pp = positions[u.parent];
      const growLeft = !!pp && u.pos.x + u.w <= pp.x + 2 && u.pos.x + u.w - real.w >= 0;
      m.set(u.key, { x: growLeft ? u.pos.x + u.w - real.w : u.pos.x, y: u.pos.y, w: real.w, h: real.h });
    }
    return m;
  }, [unfolded, peerAnswering, positions]);
  const peerNudge = useMemo(() => {
    const out = new Map<string, Pos>();
    if (!peerGrown.size) return out;
    const others: Array<{ id: string; r: Rect }> = [];
    for (const it of items) { const p = positions[it.id]; if (p) others.push({ id: it.id, r: { x: p.x, y: p.y, ...itemSize(it) } }); }
    for (const u of unfolded) if (!peerGrown.has(u.key)) others.push({ id: u.key, r: { x: u.pos.x, y: u.pos.y, w: u.w, h: u.h } });
    const PAD = 14;
    for (const [key, g] of peerGrown) {
      const parent = unfolded.find((u) => u.key === key)?.parent;
      for (const o of others) {
        if (o.id === parent) continue;
        const r = o.r;
        const ox = Math.min(g.x + g.w + PAD - r.x, r.x + r.w + PAD - g.x);
        const oy = Math.min(g.y + g.h + PAD - r.y, r.y + r.h + PAD - g.y);
        if (ox <= 0 || oy <= 0) continue;
        const gc = { x: g.x + g.w / 2, y: g.y + g.h / 2 }, rc = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const cur = out.get(o.id) ?? { x: 0, y: 0 };
        if (ox < oy) out.set(o.id, { x: cur.x + (rc.x >= gc.x ? ox : -ox), y: cur.y });
        else out.set(o.id, { x: cur.x, y: cur.y + (rc.y >= gc.y ? oy : -oy) });
      }
    }
    return out;
  }, [peerGrown, items, positions, unfolded]);
  const nudged = useCallback((id: string, p: Pos): Pos => { const n = peerNudge.get(id); return n ? { x: p.x + n.x, y: p.y + n.y } : p; }, [peerNudge]);
  const dragExtent = useRef<{ w: number; h: number } | null>(null);
  const extent = useMemo(() => {
    // The grid reaches at least the board's own frame (Ben, 2026-11-04: in
    // focus mode it should fill the screen).
    let w = Math.max(1200, stageW), h = Math.max(minHeight, viewH);
    for (const it of items) {
      // A view sizes the board by what it shows: cards off this view's stage
      // kept their board spots and held the board wide and tall, so a view
      // drawn from the top left sat out of sight (FIL-704).
      if ((scenesMode && !gridIndex.has(it.id)) || (charactersMode && !webPos.has(it.id)) || (worldMode && !worldView.pos.has(it.id))) continue;
      const p = posOf(it.id);
      if (!p) continue;
      const s = (tlLayout && tlLayout.get(it.id)) || itemSize(it);
      w = Math.max(w, p.x + s.w + 80);
      h = Math.max(h, p.y + s.h + 80);
    }
    for (const u of unfolded) { w = Math.max(w, u.pos.x + u.w + 80); h = Math.max(h, u.pos.y + u.h + 80); }
    // Never smaller mid-drag (FIL-698): a board that shrinks under the hand
    // pulls the scroll back and everything shifts. It settles on the drop.
    const held = dragExtent.current;
    if (drag && held) { w = Math.max(w, held.w); h = Math.max(h, held.h); }
    dragExtent.current = drag ? { w, h } : null;
    return { w, h };
  }, [items, posOf, minHeight, unfolded, scenesMode, charactersMode, worldMode, gridIndex, webPos, worldView, drag, stageW, viewH, tlLayout]);
  // A VIEW STARTS AT THE TOP LEFT (FIL-704, Marko 2026-10-30: the Characters
  // view showed nothing with stickies out). The board kept the scroll of the
  // last layout, out where unfolded stickies or Peer questions were, and the
  // new view is drawn from the top left.
  const viewKey = `${scenesMode}|${charactersMode}|${worldMode}`;
  const lastView = useRef(viewKey);
  useEffect(() => {
    if (lastView.current === viewKey) return;
    lastView.current = viewKey;
    const wrap = stageRef.current?.parentElement;
    if (!wrap) return;
    try { wrap.scrollTo({ left: 0, top: 0 }); } catch { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
  }, [viewKey]);

  // Lines: a dashed thread between parked scenes in order; dashed tethers
  // from each token to the loose stickies it left.
  const lines = useMemo(() => {
    const out: Array<{ d: string; stroke: string; dash: string; op: number; key: string; w?: number; from?: string; to?: string; mid?: Pos; ra?: Rect; rb?: Rect }> = [];
    const curve = (a: Pos, b: Pos) => { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; };
    const thread = dark ? 'rgba(118,168,249,.45)' : 'rgba(59,130,246,.45)';
    const tether = dark ? 'rgba(240,226,196,.45)' : 'rgba(122,90,24,.55)';
    for (const it of items) {
      if (it.kind !== 'card' || !it.after) continue;
      const prev = items.find((j) => j.kind === 'card' && cardTitle(j.entity) === it.after);
      const a = prev && posOf(prev.id); const b = posOf(it.id);
      if (!prev || !a || !b) continue;
      const sa = itemSize(prev), sb = itemSize(it);
      // Leave from the side facing the next scene: right to left on the
      // weave's way back, bottom to top where it turns a row.
      const below = b.y >= a.y + sa.h - 4 && b.x < a.x + sa.w && b.x + sb.w > a.x;
      const d = below ? `M${a.x + sa.w / 2},${a.y + sa.h} C${a.x + sa.w / 2},${(a.y + sa.h + b.y) / 2} ${b.x + sb.w / 2},${(a.y + sa.h + b.y) / 2} ${b.x + sb.w / 2},${b.y}`
        : b.x + sb.w / 2 < a.x + sa.w / 2 ? curve({ x: a.x, y: a.y + sa.h / 2 }, { x: b.x + sb.w, y: b.y + sb.h / 2 })
          : curve({ x: a.x + sa.w, y: a.y + sa.h / 2 }, { x: b.x, y: b.y + sb.h / 2 });
      // A beat's stretch, the beat through its scenes, takes its colour (sandbox-beats).
      const beatAt = (x: StageItem) => (x.kind === 'card' ? (x.entity.type === 'sequence' ? x.id : String((x.entity as any).beat_id ?? '')) : '');
      const inBeat = it.entity.type === 'event' && beatAt(it) && beatAt(it) === beatAt(prev);
      // Inside a beat the line is solid, in the beat's colour (purple until
      // the writer colours it); from a beat's last card to the next beat it
      // stays the dotted thread (Ben, 2026-11-05: "the solid lines help a lot
      // for intra sequence").
      const beatEnt = inBeat ? items.find((x) => x.id === beatAt(it)) : undefined;
      const bc = beatEnt && beatEnt.kind === 'card' ? String((beatEnt.entity as any).beat_color ?? '') : '';
      // The middle of the thread (both curves are symmetric): where its + sits.
      const ends = below ? [{ x: a.x + sa.w / 2, y: a.y + sa.h }, { x: b.x + sb.w / 2, y: b.y }]
        : b.x + sb.w / 2 < a.x + sa.w / 2 ? [{ x: a.x, y: a.y + sa.h / 2 }, { x: b.x + sb.w, y: b.y + sb.h / 2 }]
          : [{ x: a.x + sa.w, y: a.y + sa.h / 2 }, { x: b.x, y: b.y + sb.h / 2 }];
      const mid = { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 };
      const ra = { x: a.x, y: a.y, w: sa.w, h: sa.h }, rb = { x: b.x, y: b.y, w: sb.w, h: sb.h };
      if (bc) out.push({ key: `t:${prev.id}:${it.id}`, d, stroke: shade(bc, dark), dash: '', op: .9, w: 2.5, from: prev.id, to: it.id, mid, ra, rb });
      else out.push({ key: `t:${prev.id}:${it.id}`, d, stroke: thread, dash: '6 5', op: .7, from: prev.id, to: it.id, mid, ra, rb });
    }
    for (const it of items) {
      if (it.kind !== 'token') continue;
      const tp = posOf(it.id);
      if (!tp) continue;
      const from = centerOf(tp, { w: TOKEN, h: TOKEN });
      const targets = new Set<string>();
      for (const fid of it.looseIds) { const h = holderOf(fid); if (h) targets.add(h.id); }
      for (const hid of targets) {
        const h = byId.get(hid); const hp = posOf(hid);
        if (!h || !hp) continue;
        const hs = itemSize(h);
        out.push({ key: `d:${it.id}:${hid}`, d: curve(from, { x: hp.x, y: hp.y + Math.min(hs.h / 2, 40) }), stroke: tether, dash: '4 4', op: .7 });
      }
    }
    return out;
  }, [items, posOf, byId, holderOf, dark]);

  // ---- The focus ----------------------------------------------------------
  // A zoom into the card WHERE IT IS (Ben, 2026-10-08: not a pull to the
  // centre). The card grows in place, around its own centre, into the
  // FocusCard; the view pans to it; every other item is pushed out along
  // the line from that centre, far enough to clear the opened card, and
  // softened; the active slide's members on this board stay sharp.
  // Positions are not written: closing the focus puts everything back.
  const stageRef = useRef<HTMLDivElement | null>(null);
  // The shown stickies' drawn sizes: the layout places them by an estimate
  // (a short line of dialogue is shorter than it), and a line drawn to the
  // estimate stopped short of the paper (2026-10-15). Lines go to these.
  const [unfoldSize, setUnfoldSize] = useState<Record<string, { w: number; h: number }>>({});
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !unfolded.length) return;
    const read = () => {
      const next: Record<string, { w: number; h: number }> = {};
      stage.querySelectorAll<HTMLElement>('[data-unfold-sticky]').forEach((el) => { const k = el.getAttribute('data-unfold-sticky'); if (k && el.offsetWidth) next[k] = { w: el.offsetWidth, h: el.offsetHeight }; });
      setUnfoldSize((cur) => (Object.keys(next).length === Object.keys(cur).length && Object.entries(next).every(([k, v]) => cur[k]?.w === v.w && cur[k]?.h === v.h) ? cur : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    stage.querySelectorAll('[data-unfold-sticky]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [unfolded, unfoldEdit]);
  const focusItem = focusId ? byId.get(focusId) : undefined;
  const focusedRaw = focusItem && (focusItem.kind === 'card' || focusItem.kind === 'world') ? focusItem : undefined;
  const focused = useMemo(() => {
    if (!focusedRaw || focusedRaw.kind !== 'card' || focusedRaw.entity.type !== 'character') return focusedRaw;
    const have = new Set(focusedRaw.attached.map((f) => f.id));
    const lines = allFrags.filter((f) => f.kind === 'dialogue' && f.speaker === focusedRaw.id && !have.has(f.id));
    return lines.length ? { ...focusedRaw, attached: [...focusedRaw.attached, ...lines] } : focusedRaw;
  }, [focusedRaw, allFrags]);
  const confirmDrop = useCallback(() => {
    setPendingDrop((pd) => {
      if (!pd) return null;
      const t = byIdRef.current.get(pd.target);
      if (t?.kind === 'group') onGroupSticky?.(pd.id, t.id.slice('group:'.length));
      else if (t?.kind === 'sticky') onGroupSticky?.(pd.id, t.id);
      else onDropSticky?.(pd.id, pd.target);
      return null;
    });
  }, [onDropSticky, onGroupSticky]);
  const cancelDrop = useCallback(() => setPendingDrop(null), []);
  const closeStickyMenu = useCallback(() => setStickyMenu(null), []);
  useEffect(() => { if (focused || scenesMode || charactersMode || worldMode) { setPendingDrop(null); setStickyMenu(null); } }, [focused, scenesMode, charactersMode, worldMode]);
  // The cards a sticky can go on, likeliest first: the one it is about,
  // then the nearest on the board. A line goes on a scene or a character.
  // The sticky a menu is for: a loose one, or one inside a group (where it
  // sits is the group's spot).
  const menuSticky = useMemo(() => {
    if (!stickyMenu) return null;
    const it = byId.get(stickyMenu.id);
    if (it?.kind === 'sticky') return { id: it.id, fragment: it.fragment, at: it.id, pinnedTo: undefined as string | undefined };
    for (const g of items) if (g.kind === 'group') { const m = g.members.find((x) => x.id === stickyMenu.id); if (m) return { id: m.id, fragment: m, at: g.id, pinnedTo: undefined }; }
    // A pinned sticky (on a card or a world entry): it sits by its card.
    for (const c of items) if (c.kind === 'card' || c.kind === 'world') { const m = c.attached.find((x) => x.id === stickyMenu.id); if (m) return { id: m.id, fragment: m, at: c.id, pinnedTo: m.attachedTo === c.id ? c.id : undefined }; }
    return null;
  }, [stickyMenu, byId, items]);
  const menuCards = useMemo((): MenuCard[] => {
    if (!menuSticky) return [];
    const line = menuSticky.fragment.kind === 'dialogue';
    const from = posOf(menuSticky.at) ?? { x: 0, y: 0 };
    const about = String(menuSticky.fragment.about ?? '');
    const out: Array<MenuCard & { d: number }> = [];
    for (const c of items) {
      if (c.id === menuSticky.pinnedTo) continue; // already on it
      const p = posOf(c.id);
      const d = p ? Math.hypot(p.x - from.x, p.y - from.y) : 1e9;
      if (c.kind === 'card' && (c.entity.type === 'event' || c.entity.type === 'character')) {
        out.push({ id: c.id, name: cardTitle(c.entity), kind: c.entity.type === 'event' ? 'scene' : 'character', suggested: !!about && about === c.id, d });
      } else if (c.kind === 'world' && !line) out.push({ id: c.id, name: c.entry.title, kind: 'world', d });
    }
    out.sort((a, b) => (a.suggested === b.suggested ? a.d - b.d : a.suggested ? -1 : 1));
    return out.map(({ d, ...c }) => c);
  }, [menuSticky, items, posOf]);
  const writing = !!focused && !!editor && writingId === focused.id;
  const focusW = writing ? WRITING_W : FOCUS_W;
  const [focusCenter, setFocusCenter] = useState<Pos | null>(null);
  const [focusH, setFocusH] = useState(360);
  const focusRef = useRef<HTMLDivElement | null>(null);
  // The slide that is up. Stickies first; a card with none opens on its
  // first category (a scene on Cast, a character on Relationships).
  const [slideIdx, setSlideIdx] = useState(0);
  // A sticky being written on the focused card: the card it is for.
  const [draftSatFor, setDraftSatFor] = useState<string | null>(null);
  const [draftSatKind, setDraftSatKind] = useState<'sticky' | 'line'>('sticky');
  useEffect(() => { if (!focused || focused.id !== draftSatFor) setDraftSatFor(null); }, [focused, draftSatFor]);
  // Room the stage grows by so the camera can always travel right / down
  // far enough to centre the card.
  const [focusRoom, setFocusRoom] = useState<{ w: number; h: number } | null>(null);
  // What the writer could see when the card opened: the people around it
  // stay inside it where they can.
  const [focusView, setFocusView] = useState<Rect | null>(null);
  const focusPosRef = useRef<Pos | null>(null);
  useLayoutEffect(() => {
    if (!focused) { setFocusCenter(null); setFocusRoom(null); setFocusView(null); return; }
    // Open on the stickies if it has any, else on its Peer questions if it
    // has any, else on the first slide after them (the Peer pill sits second).
    const peerPill = focused.kind === 'card' && ['event', 'sequence', 'arc', 'character'].includes(focused.entity.type);
    setSlideIdx(focused.attached.length ? 0 : peerPill && peerByHome.get(focused.id)?.length ? 1 : peerPill ? 2 : 1);
    const p = positions[focused.id] ?? { x: 0, y: 0 }; const sz = itemSize(focused);
    const c = { x: p.x + sz.w / 2, y: p.y + sz.h / 2 };
    const wrap = stageRef.current?.parentElement;
    if (!wrap || !wrap.clientWidth) { setFocusCenter({ x: Math.max(focusW / 2 + 12, c.x), y: c.y }); setFocusView(null); return; }
    // THE CARD COMES TO THE MIDDLE OF THE VIEW (Ben, 2026-10-12: "no matter
    // where the card is on screen when we enter expanded mode, that should go
    // to the center, we should never have to scroll to find the expanded
    // card"). The card travels from its spot to the centre of what the writer
    // is looking at now; the board does not scroll. (It used to pan the board
    // to the card, which could stop short and leave the card off screen.)
    const halfW = wrap.clientWidth / 2, halfH = wrap.clientHeight / 2;
    const vc = { x: wrap.scrollLeft + halfW, y: wrap.scrollTop + halfH };
    // Writing needs a left margin for the cast: keep the card far enough in.
    if (writingId === focused.id) vc.x = Math.max(vc.x, 12 + GHOST_W + 36 + WRITING_W / 2);
    setFocusRoom({ w: vc.x + halfW + 8, h: vc.y + halfH + 8 });
    setFocusView({ x: wrap.scrollLeft + 10, y: wrap.scrollTop + 10, w: wrap.clientWidth - 20, h: wrap.clientHeight - 20 });
    setFocusCenter(vc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id]);
  // The pan runs AFTER the stage has grown (a scrollTo in the same pass as
  // the size change clamps to the old extent and the card ends at the
  // bottom edge instead of the centre).
  const panned = useRef<string | null>(null);
  useEffect(() => {
    if (!focused || !focusCenter) { panned.current = null; return; }
    // Only the pages pan (their top goes to the top of the window); the
    // expanded card is already in the middle of the view.
    if (!writing) return;
    const key = `${focused.id}:${writing ? `w${Math.round(focusH)}` : 'f'}`;
    if (panned.current === key) return;
    const wrap = stageRef.current?.parentElement;
    if (!wrap || !wrap.clientWidth) return;
    const left = Math.max(0, focusCenter.x - wrap.clientWidth / 2), top = writing ? Math.max(0, Math.max(12, focusCenter.y - 120)) : Math.max(0, focusCenter.y - wrap.clientHeight / 2);
    // Marked done only once the pan has run (2026-10-12): a re-render before
    // the frame cancels it, and marking it first meant it was never tried
    // again. A guard as well: if the stage has not yet grown enough to reach
    // the target, wait a few frames rather than let the pan clamp short.
    // (Animation frames do not run in a hidden tab, so the pan cannot be seen
    // from a background test tab; check it in a visible one.)
    let tries = 0;
    let id = 0;
    const go = () => {
      const maxTop = wrap.scrollHeight - wrap.clientHeight, maxLeft = wrap.scrollWidth - wrap.clientWidth;
      if ((top > maxTop + 1 || left > maxLeft + 1) && tries++ < 30) { id = requestAnimationFrame(go); return; }
      panned.current = key;
      try { wrap.scrollTo({ left, top, behavior: 'smooth' }); } catch { wrap.scrollLeft = left; wrap.scrollTop = top; }
    };
    id = requestAnimationFrame(go);
    return () => cancelAnimationFrame(id);
  }, [focused, focusCenter, focusRoom, writing, focusH]);
  useLayoutEffect(() => {
    const el = focusRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFocusH(el.offsetHeight || 360));
    ro.observe(el);
    setFocusH(el.offsetHeight || 360);
    return () => ro.disconnect();
  }, [focused?.id]);
  const onBoard = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const slides = useMemo(() => (focused ? focusSlides(
    focused.kind === 'card' ? { kind: 'card', entity: focused.entity, attached: focused.attached } : { kind: 'world', entry: focused.entry, attached: focused.attached },
    { entities: allEntities ?? items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card').map((i) => i.entity), edges, world, onBoard, peerCount: (peerByHomeAll.get(focused.id) ?? []).filter((q) => stateOf(q) === 'open').length },
  ) : []), [focused, allEntities, edges, world, onBoard, items, peerByHomeAll]);
  const slide = slides[Math.min(slideIdx, Math.max(0, slides.length - 1))] ?? null;
  // TAKE IT OUT (Ben, 2026-11-07: "finish subplots"): on a scene's Subplots
  // and a subplot's Scenes, a hovered member shows Take out.
  const outOf = useMemo(() => {
    const m = new Map<string, { arcId: string; sceneId: string }>();
    if (!focused || writing || !onUntagSubplot || focused.kind !== 'card' || !slide) return m;
    if (focused.entity.type === 'event' && slide.id === 'subplots') for (const r of slide.rows) m.set(r.id, { arcId: r.id, sceneId: focused.id });
    if (focused.entity.type === 'arc' && slide.id === 'scenes') for (const r of slide.rows) m.set(r.id, { arcId: focused.id, sceneId: r.id });
    return m;
  }, [focused, writing, onUntagSubplot, slide]);
  const [outHover, setOutHover] = useState<string | null>(null);
  // The scene under the hand while a subplot is open in the strip.
  const [pickHover, setPickHover] = useState<string | null>(null);
  const outTimer = useRef<number | null>(null);
  const hoverOut = useCallback((id: string | null) => {
    if (outTimer.current) { window.clearTimeout(outTimer.current); outTimer.current = null; }
    if (id) setOutHover(id);
    else outTimer.current = window.setTimeout(() => setOutHover(null), 250);
  }, []);
  // Nothing fires by turning to the Peer pill (Ben, 2026-10-21): the Peer
  // button on the card is the only ask.
  // A folded Peer sticky opens its card on the Peer pill.
  const [peerSlideFor, setPeerSlideFor] = useState<string | null>(null);
  useEffect(() => {
    if (!peerSlideFor || focused?.id !== peerSlideFor) return;
    const k = slides.findIndex((x) => x.id === 'peer');
    if (k >= 0) setSlideIdx(k);
    setPeerSlideFor(null);
  }, [peerSlideFor, focused?.id, slides]);
  // Writing: the left margin shows ONE of Cast / Where (and a character's
  // Relationships / Scenes), picked by the chips over it; stickies are
  // always the right margin.
  // The Peer pill is not a margin of the pages (2026-10-20).
  const writingSlides = useMemo(() => slides.filter((s) => s.id !== 'stickies' && s.id !== 'order' && s.id !== 'peer' && s.id !== 'subplots'), [slides]);
  const leftSlide = writing ? (slide && writingSlides.includes(slide) ? slide : writingSlides[0] ?? null) : null;
  // A CHARACTER'S SCENES WEAVE (Ben, 2026-10-13: "mimic the character scene
  // orbit from the master view"): on a character's Scenes, the rest of the
  // board filters out and the scenes they are in step down two alternating
  // lanes under the card in story order, joined by one solid thread, the
  // master's throughline cascade. No drag: the position is the meaning.
  const cascade = !!focused && !writing && focused.kind === 'card' && ['character', 'sequence', 'arc'].includes(focused.entity.type) && slide?.id === 'scenes';
  cascadeRef.current = cascade;
  // THE DRAFT'S MARGINS (Ben, 2026-10-13): a show/hide toggle each in the
  // draft's header. Stickies and cast start shown, locations hidden; the
  // writer's choice is remembered on this browser.
  const [marginsOn, setMarginsOn] = useState<Record<string, boolean>>(() => {
    try { const v = JSON.parse(localStorage.getItem('ff-draft-margins') ?? ''); if (v && typeof v === 'object') return v; } catch { /* default */ }
    return { stickies: true, cast: true, where: false };
  });
  const marginOn = useCallback((id: string) => (id in marginsOn ? !!marginsOn[id] : id === 'stickies' || id === 'cast'), [marginsOn]);
  const toggleMargin = useCallback((id: string) => {
    setMarginsOn((cur) => {
      const next = { ...cur, [id]: !(id in cur ? !!cur[id] : id === 'stickies' || id === 'cast') };
      try { localStorage.setItem('ff-draft-margins', JSON.stringify(next)); } catch { /* per session then */ }
      return next;
    });
  }, []);
  const draftMargins = useMemo(() => (writing && focused ? [
    { id: 'stickies', label: 'Stickies', count: focused.attached.length, on: marginOn('stickies') },
    ...writingSlides.map((x) => ({ id: x.id, label: x.id === 'where' ? 'Locations' : x.label, count: x.rows.length, on: marginOn(x.id) })),
  ] : []), [writing, focused, writingSlides, marginOn]);
  // Opening the pages lands on Cast (the first left slide) every time, and
  // the card keeps room on its left for the margin (the focus may have
  // started near the board's left edge, where the column had nowhere to go).
  useEffect(() => {
    if (!writing) return;
    setFocusCenter((c) => { if (!c) return c; const x = Math.max(c.x, 12 + GHOST_W + 36 + WRITING_W / 2); return x === c.x ? c : { ...c, x }; });
    const first = writingSlides[0];
    const real = first ? slides.indexOf(first) : -1;
    if (real >= 0) setSlideIdx(real);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing, focused?.id]);
  // Arrow keys page the slides while a focus is up.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSlideIdx((i) => Math.min(slides.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setSlideIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, slides.length]);
  // What hangs around the opened card for the slide that is up, in slot
  // order: the card's stickies (as paper), the members on this board (the
  // items themselves move in), the members elsewhere (ghost cards, doors to
  // their sheets). Nothing is listed inside the card (Ben: the cast was
  // drawn twice and the card ate the board).
  type Satellite = { key: string; kind: 'item'; id: string } | { key: string; kind: 'ghost'; row: FocusRow } | { key: string; kind: 'sticky'; f: SandboxFragment; i: number } | { key: string; kind: 'peer'; q: SandboxFragment; i: number };
  const satellites = useMemo((): Satellite[] => {
    if (!focused || !slide) return [];
    const out: Satellite[] = [];
    const seen = new Set<string>();
    if (writing) {
      // The margins of the pages, each shown by its toggle in the header:
      // the stickies on both sides, cast and locations down the left.
      if (marginOn('stickies')) focused.attached.forEach((f, i) => out.push({ key: `s:${f.id}`, kind: 'sticky', f, i }));
      for (const ws of writingSlides) {
        if (!marginOn(ws.id)) continue;
        for (const r of ws.rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          if (onBoard.has(r.id)) out.push({ key: `i:${r.id}`, kind: 'item', id: r.id });
          else out.push({ key: `g:${r.id}`, kind: 'ghost', row: r });
        }
      }
      return out;
    }
    // The Peer pill: the card's Peer questions, hung round it like its stickies.
    // Open questions first, then what is being answered, then the answered.
    if (slide.id === 'peer') {
      const rank = (q: SandboxFragment) => ({ open: 0, answering: 1, answered: 2 } as Record<string, number>)[stateOf(q)] ?? 3;
      return [...(peerByHomeAll.get(focused.id) ?? [])].sort((a, b) => rank(a) - rank(b)).map((q, i) => ({ key: `p:${q.id}`, kind: 'peer' as const, q, i }));
    }
    if (slide.id === 'stickies') {
      const list = focused.attached.map((f, i) => ({ key: `s:${f.id}`, kind: 'sticky' as const, f, i }));
      if (draftSatFor === focused.id) list.push({ key: `s:${draftSatKind === 'line' ? DRAFT_LINE_ID : DRAFT_SAT_ID}`, kind: 'sticky' as const, f: { id: draftSatKind === 'line' ? DRAFT_LINE_ID : DRAFT_SAT_ID, kind: draftSatKind === 'line' ? 'dialogue' : 'note', author: 'writer', text: '', source: '', label: '', about: '', open: true, dumpId: '', attachedTo: focused.id, clusterId: null, createdAt: '' } as SandboxFragment, i: list.length });
      return list;
    }
    // Story order on a cascade: the board's own run of scenes (the thread and
    // the Scenes grid's order) first, scenes on the master after, as listed.
    const rank = new Map(sceneOrder.map((id, k) => [id, k]));
    const rows = cascade
      ? slide.rows.map((r, k) => ({ r, k })).sort((a, b) => (rank.get(a.r.id) ?? 1e6 + a.k) - (rank.get(b.r.id) ?? 1e6 + b.k)).map((x) => x.r)
      : slide.rows;
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (onBoard.has(r.id)) out.push({ key: `i:${r.id}`, kind: 'item', id: r.id });
      else out.push({ key: `g:${r.id}`, kind: 'ghost', row: r });
    }
    return out;
  }, [focused, slide, onBoard, writing, writingSlides, marginOn, draftSatFor, draftSatKind, cascade, sceneOrder, peerByHomeAll]);
  const slotOf = useMemo(() => { const m = new Map<string, number>(); satellites.forEach((s, i) => { if (s.kind === 'item') m.set(s.id, i); }); return m; }, [satellites]);
  const sizeOfSat = useCallback((s: Satellite): { w: number; h: number } => (s.kind === 'item' ? (byId.get(s.id) ? itemSize(byId.get(s.id)!) : { w: CHAR_W, h: CHAR_H }) : s.kind === 'ghost' ? { w: GHOST_W, h: GHOST_H } : s.kind === 'peer' ? peerSize(s.q) : { w: STICKY_SAT_W, h: Math.max(STICKY_SAT_H, stickyHeight(s.f) + 8) }), [byId, peerSize]);
  // A ghost or sticky satellite the writer dragged, or is dragging.
  const [satDrag, setSatDrag] = useState<{ key: string; dx: number; dy: number; pos: Pos } | null>(null);
  const satDragRef = useRef<typeof satDrag>(null);
  satDragRef.current = satDrag;
  const [editingSat, setEditingSat] = useState<string | null>(null);
  useEffect(() => { if (!focused) setEditingSat(null); }, [focused]);
  const sharp = useMemo(() => new Set(slotOf.keys()), [slotOf]);
  const focusPos = useMemo(() => (focusCenter ? { x: Math.max(12, focusCenter.x - focusW / 2), y: writing ? Math.max(12, focusCenter.y - 120) : Math.max(12, focusCenter.y - focusH / 2) } : null), [focusCenter, focusH, focusW, writing]);
  focusPosRef.current = focusPos;
  /** Where an item sits while the focus is up: pushed out of the opened
   *  card's footprint along the line from the centre, with a little drift
   *  so even the far ones are seen to move. */
  // Where the active slide's members sit: around the opened card, like
  // satellites (Ben: the characters need to move to fit around this scene
  // card). Right, left, then the upper and lower diagonals, on an ellipse
  // just clear of the card (`ringPos` below).
  // WRITING (Ben, 2026-10-08): the margins of the pages. Cast and where
  // stack down the left of the card, the stickies down the right, from the
  // card's top. Computed once per layout so the stacks follow real heights.
  const writingSlots = useMemo(() => {
    const m = new Map<number, Pos>();
    if (!writing || !focusPosRef.current) return m;
    const fp = focusPosRef.current;
    // EVERY STICKY FITS (Ben, 2026-10-13: past a certain count they ran off
    // the bottom). The writing view does not scroll, so the margins are the
    // viewport's: the stickies fill as many columns as the right margin
    // holds, then columns on the left past the cast; a column that is still
    // too tall overlaps its stickies like a fanned stack, each showing at
    // least its top. The cast column does the same.
    const wrap = stageRef.current?.parentElement;
    const viewW = wrap?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1400);
    const viewH = wrap?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 900);
    const cx = focusCenter?.x ?? fp.x + focusW / 2;
    const viewL = Math.max(0, cx - viewW / 2), viewR = viewL + viewW;
    const top = fp.y, bottom = fp.y + viewH - 20;
    const GAP = 14, PEEK = 38;
    const stickies: Array<{ i: number; h: number }> = [];
    const cast: Array<{ i: number; w: number; h: number }> = [];
    satellites.forEach((s, i) => { const sz = sizeOfSat(s); if (s.kind === 'sticky') stickies.push({ i, h: sz.h }); else cast.push({ i, w: sz.w, h: sz.h }); });
    // A column: its x, its top, and what it holds; fanned when too tall.
    const settle = (x: number, y0: number, list: Array<{ i: number; h: number }>) => {
      if (!list.length) return;
      const total = list.reduce((a, b) => a + b.h, 0) + GAP * (list.length - 1);
      const room = bottom - y0;
      if (total <= room || list.length === 1) {
        let y = y0;
        for (const it of list) { m.set(it.i, { x, y }); y += it.h + GAP; }
        return;
      }
      const step = Math.max(PEEK, (room - list[list.length - 1].h) / (list.length - 1));
      list.forEach((it, k) => m.set(it.i, { x, y: y0 + k * step }));
    };
    // Cast: one column left of the card, under the chips.
    const castX = (w: number) => Math.max(0, fp.x - 36 - w);
    settle(castX(GHOST_W), top, cast.map(({ i, h }) => ({ i, h })));
    for (const c of cast) { const p = m.get(c.i); if (p) m.set(c.i, { x: castX(c.w), y: p.y }); }
    // Sticky columns: right of the card first, then left past the cast.
    const colW = STICKY_SAT_W + GAP;
    const rightX0 = fp.x + focusW + 36;
    const rightCols = Math.max(1, Math.floor((viewR - rightX0 + GAP) / colW));
    const leftX0 = castX(GHOST_W) - GAP - STICKY_SAT_W;
    const leftCols = cast.length ? Math.max(0, Math.floor((leftX0 + STICKY_SAT_W - viewL) / colW)) : Math.max(0, Math.floor((fp.x - 36 - viewL + GAP) / colW));
    const xs: number[] = [];
    for (let c = 0; c < rightCols; c++) xs.push(rightX0 + c * colW);
    const leftStart = cast.length ? leftX0 : fp.x - 36 - STICKY_SAT_W;
    for (let c = 0; c < leftCols; c++) xs.push(leftStart - c * colW);
    // Fill column by column in order, moving on when the next would not fit
    // whole; whatever is left fans into the last column.
    const cols: Array<Array<{ i: number; h: number }>> = xs.map(() => []);
    let col = 0, used = 0;
    for (const it of stickies) {
      if (col < xs.length - 1 && used > 0 && top + used + it.h > bottom) { col += 1; used = 0; }
      cols[col].push(it); used += it.h + GAP;
    }
    cols.forEach((list, c) => settle(xs[c], top, list));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writing, satellites, sizeOfSat, focusW, focusCenter, slides.length]);
  const stickyWrap = useMemo(() => {
    const m = new Map<number, Pos>();
    if (writing || !focusPos) return m;
    const idx: number[] = []; const sizes: Array<{ w: number; h: number }> = [];
    satellites.forEach((s, i) => { if (s.kind === 'sticky' || s.kind === 'peer') { idx.push(i); sizes.push(sizeOfSat(s)); } });
    if (!idx.length) return m;
    const at = wrapAround({ x: focusPos.x, y: focusPos.y, w: focusW, h: focusH }, sizes, { gap: 14, top: CHIP_H + 20 });
    idx.forEach((si, k) => m.set(si, at[k]));
    return m;
  }, [writing, focusPos, satellites, sizeOfSat, focusW, focusH]);
  // The cascade's geometry (the master's Throughline, sized for board
  // cards): two lanes centred under the opened card, each stop starting a
  // stagger below the one before so neighbours overlap and the eye runs
  // diagonally; a stop never overlaps the last one in its own lane.
  const cascadeSlots = useMemo(() => {
    const m = new Map<number, Pos>();
    if (!cascade || !focusPos) return m;
    const sizes = satellites.map((s) => sizeOfSat(s));
    if (!sizes.length) return m;
    const laneW = Math.max(...sizes.map((z) => z.w));
    const avgH = sizes.reduce((a, z) => a + z.h, 0) / sizes.length;
    const GAP = 120, STAGGER = Math.round(avgH * 0.62), CLEAR = 28;
    const cx = focusPos.x + focusW / 2;
    const laneX = (lane: number) => Math.max(0, lane === 0 ? cx - GAP / 2 - laneW : cx + GAP / 2);
    const laneBottom = [-Infinity, -Infinity];
    let prevY = focusPos.y + focusH + 64 - STAGGER;
    sizes.forEach((z, i) => {
      const lane = i % 2;
      const y = Math.round(Math.max(prevY + STAGGER, laneBottom[lane] + CLEAR));
      m.set(i, { x: Math.round(laneX(lane) + (laneW - z.w) / 2), y });
      laneBottom[lane] = y + z.h;
      prevY = y;
    });
    return m;
  }, [cascade, focusPos, satellites, sizeOfSat, focusW, focusH]);
  const cascadeBottom = useMemo(() => {
    let b = 0;
    satellites.forEach((s, i) => { const p = cascadeSlots.get(i); if (p) b = Math.max(b, p.y + sizeOfSat(s).h); });
    return b;
  }, [cascadeSlots, satellites, sizeOfSat]);
  // The chip row that floats over the opened card: no person or label there.
  const focusPills = useMemo((): Rect | null => (focusPos ? { x: focusPos.x - 20, y: Math.max(4, focusPos.y - 46) - 4, w: focusW + 40, h: CHIP_H + 8 } : null), [focusPos, focusW]);
  // The tie a satellite stands for, on a character's Relationships.
  const tieOfSat = useCallback((s: Satellite): Tie | undefined => {
    if (slide?.id !== 'relationships' || s.kind === 'sticky' || s.kind === 'peer') return undefined;
    const otherId = s.kind === 'item' ? s.id : s.row.id;
    return slide.rows.find((r) => r.id === otherId)?.tie;
  }, [slide]);
  // The people of every other slide sit in a ring around the card, inside
  // what the writer could see when it opened wherever they fit, and on a
  // character's Relationships far enough out that each label fits in its
  // gap (sandboxRing).
  const ringPos = useMemo((): Pos[] => {
    if (!focused || !focusPos || writing || cascade || slide?.id === 'stickies' || slide?.id === 'peer') return [];
    return ringSlots({
      card: { x: focusPos.x, y: focusPos.y, w: focusW, h: focusH },
      pills: focusPills ?? undefined, view: focusView ?? undefined, chipH: CHIP_H,
      items: satellites.map((s) => { const t = tieOfSat(s); return { ...sizeOfSat(s), lw: t ? tieLabelW(tieLabel(t, focused.id)) : undefined }; }),
    });
  }, [focused, focusPos, writing, cascade, slide, focusW, focusH, focusPills, focusView, satellites, tieOfSat, sizeOfSat]);
  const satellite = useCallback((sz: { w: number; h: number }, i: number): Pos => {
    const cs = cascadeSlots.get(i);
    if (cs) return cs;
    const ws = writingSlots.get(i);
    if (ws) return ws;
    const sw = stickyWrap.get(i);
    if (sw) return sw;
    const c = focusCenter ?? { x: 0, y: 0 };
    return ringPos[i] ?? { x: Math.max(0, c.x - sz.w / 2), y: Math.max(0, c.y - sz.h / 2) };
  }, [focusCenter, writingSlots, stickyWrap, cascadeSlots, ringPos]);
  const pushed = useCallback((it: StageItem, p: Pos): Pos => {
    if (!focusCenter || !focused || it.id === focused.id) return p;
    // The writer's own arrangement of this focus. While WRITING the page
    // hands the draft screen's own arrangement (kept apart from the ring's,
    // Ben 2026-10-13: cast and stickies move there too), so a spot dragged in
    // the ring never pulls a card out of its column and the other way round.
    const off = !focusPos || cascade ? undefined : focusLayout?.[it.id];
    const placed = off && focusPos ? { x: Math.max(0, focusPos.x + off.x), y: Math.max(0, focusPos.y + off.y) } : undefined;
    if (placed) return placed;
    const si = slotOf.get(it.id);
    if (si != null) return satellite(itemSize(it), si);
    const sz = itemSize(it);
    const c = centerOf(p, sz);
    let dx = c.x - focusCenter.x, dy = c.y - focusCenter.y;
    let d = Math.hypot(dx, dy);
    if (d < 1) { dx = 1; dy = 0; d = 1; }
    const ux = dx / d, uy = dy / d;
    // Clearance: a ring around the opened card. Half the opened card's
    // diagonal plus half this item's, plus a gutter, measured straight, so
    // corners clear too (Ben: the board was not doing much to fit the rest).
    // Everything inside the ring goes out to it; everything else drifts, more
    // when nearer, so the whole board is seen to make room.
    const ring = Math.hypot(focusW, focusH) / 2 + Math.hypot(sz.w, sz.h) / 2 + 36;
    const drift = 90 * Math.max(0, 1 - Math.max(0, d - ring) / 900) + 24;
    const shove = Math.max(0, ring - d) + drift;
    return { x: Math.max(0, p.x + ux * shove), y: Math.max(0, p.y + uy * shove) };
  }, [focusCenter, focused, focusH, slotOf, satellite, focusLayout, focusW, focusPos, cascade]);
  useEffect(() => {
    focusAtRef.current = (id: string) => { const it = byId.get(id); const p = it && positions[id]; return it && p ? pushed(it, p) : undefined; };
  }, [byId, positions, pushed]);
  const onStagePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target === e.currentTarget) setOpenDump(null);
    if (focused && onFocus && e.target === e.currentTarget) onFocus(null);
    // A click on the bare board closes the card open in the strip (Ben, 2026-11-03).
    if (stripPick?.onClose && e.target === e.currentTarget) stripPick.onClose();
  }, [focused, onFocus, stripPick]);
  // The open dump: its stickies (loose, in a huddle, or on a card) light.
  const dumpOpen = useMemo(() => {
    const tok = openDump ? byId.get(openDump) : undefined;
    if (!tok || tok.kind !== 'token') return null;
    const lit = new Set<string>();
    const sources: string[] = [];
    for (const it of items) {
      const frags = it.kind === 'sticky' ? [it.fragment] : it.kind === 'group' ? it.members : it.kind === 'card' || it.kind === 'world' ? it.attached : [];
      for (const f of frags) if (f.dumpId === tok.dumpId) { lit.add(it.id); sources.push(f.source || f.text); }
    }
    // The cards the dump made or named light too (Ben, 2026-11-05: "in dump 1
    // the child scenes from that are not highlighted"), not only the ones
    // holding its stickies: its braindump's MENTIONS, bd_<dump>_<story>.
    const bd = `bd_${tok.dumpId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_`;
    for (const m of edges?.mentions ?? []) if (m.from.startsWith(bd) && byId.has(m.to)) lit.add(m.to);
    return { tok, lit, sources };
  }, [openDump, byId, items, edges]);
  // While the focus is up the board's own lines (thread, tethers) would
  // point at where things were; instead, one line from the opened card to
  // each of the active slide's members on this board.
  const satPos = useCallback((s: Satellite, i: number): Pos => {
    if (satDrag && satDrag.key === s.key) return satDrag.pos;
    const off = !focusPos || cascade ? undefined : focusLayout?.[satId(s)];
    return off && focusPos ? { x: Math.max(0, focusPos.x + off.x), y: Math.max(0, focusPos.y + off.y) } : satellite(sizeOfSat(s), i);
  }, [satDrag, focusLayout, satellite, sizeOfSat, focusPos, cascade]);
  const focusLines = useMemo(() => {
    if (!focused || !focusCenter || !focusPos) return [];
    const out: Array<{ d: string; key: string; tie?: Tie; otherId?: string; mid?: Pos }> = [];
    const from = { x: focusPos.x + focusW / 2, y: focusPos.y + focusH / 2 };
    if (cascade) {
      // One thread: from the card's foot to the first scene, then scene to
      // scene, each end leaving along the normal of the edge it crosses.
      const boxes = satellites.map((s, i) => {
        let p: Pos | null = null;
        if (s.kind === 'item') { const it = byId.get(s.id); const q = it && positions[s.id]; if (it && q) p = pushed(it, q); }
        else p = satPos(s, i);
        const z = sizeOfSat(s);
        return p ? { x: p.x, y: p.y, w: z.w, h: z.h } : null;
      });
      const chain = [{ x: focusPos.x, y: focusPos.y, w: focusW, h: focusH }, ...boxes];
      for (let k = 0; k < chain.length - 1; k++) {
        const a = chain[k], b = chain[k + 1];
        if (!a || !b) continue;
        const fa = edgeOf(a, b.x + b.w / 2, b.y + b.h / 2), tb = edgeOf(b, a.x + a.w / 2, a.y + a.h / 2);
        const dx = tb.x - fa.x, dy = tb.y - fa.y;
        const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
        const bow = Math.max(36, Math.hypot(dx, dy) * 0.45);
        const c1 = fa.axis === 'x' ? `${fa.x + sx * bow},${fa.y}` : `${fa.x},${fa.y + sy * bow}`;
        const c2 = tb.axis === 'x' ? `${tb.x - sx * bow},${tb.y}` : `${tb.x},${tb.y - sy * bow}`;
        out.push({ key: `c:${k}`, d: `M${fa.x},${fa.y} C${c1} ${c2} ${tb.x},${tb.y}` });
      }
      return out;
    }
    // Where each of the slide's people is now (dragged, moved or in its slot).
    // Stickies hang without a thread (Ben): they are the card's own words.
    const boxes = satellites.map((s, i): Rect | null => {
      if (s.kind === 'sticky' || s.kind === 'peer') return null;
      if (s.kind === 'item') {
        const it = byId.get(s.id); const p = it && positions[s.id];
        if (!it || !p) return null;
        const q = drag?.id === s.id ? drag.pos : pushed(it, p); const z = itemSize(it);
        return { x: q.x, y: q.y, w: z.w, h: z.h };
      }
      const q = satPos(s, i); const z = sizeOfSat(s);
      return { x: q.x, y: q.y, w: z.w, h: z.h };
    });
    const card = { x: focusPos.x, y: focusPos.y, w: focusW, h: focusH };
    const taken: Rect[] = [];
    satellites.forEach((s, i) => {
      const box = boxes[i];
      if (!box || s.kind === 'sticky' || s.kind === 'peer') return;
      const to = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const otherId = s.kind === 'item' ? s.id : s.row.id;
      const tie = tieOfSat(s);
      // The label sits in the stretch of line you can see, between where it
      // leaves the opened card and where it reaches the other one, sliding
      // along it until nothing covers it: the cards, the chip row, the other
      // people, the labels already placed (2026-10-15: a label at the
      // centres' midpoint landed on the opened card's own title).
      let mid: Pos | undefined;
      if (tie) {
        const lw = tieLabelW(tieLabel(tie, focused.id));
        const others = boxes.filter((b, j): b is Rect => !!b && j !== i);
        mid = ringLabel(card, box, [...(focusPills ? [focusPills] : []), ...others, ...taken], lw).at;
        taken.push({ x: mid.x - lw / 2, y: mid.y - 12, w: lw, h: 24 });
      }
      out.push({ key: `f:${s.key}`, d: tieCurve(from, to), ...(tie && mid ? { tie, otherId, mid } : {}) });
    });
    return out;
  }, [focused, focusCenter, focusPos, focusH, satellites, byId, positions, pushed, satPos, sizeOfSat, drag, focusW, cascade, focusPills, tieOfSat]);
  // The tie being edited, by the other character's id.
  const [tieEdit, setTieEdit] = useState<string | null>(null);
  useEffect(() => { setTieEdit(null); }, [focused?.id]);
  // Drag a ghost or a sticky around the focus; a click on a sticky edits it.
  const satDown = useCallback((e: React.PointerEvent, s: Satellite, i: number) => {
    if (e.button != null && e.button !== 0) return;
    if (cascade) return; // a ghost on the cascade opens on click; no drag
    if (editingSat && s.kind === 'sticky' && s.f.id === editingSat) return;
    downAt.current = { x: e.clientX, y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    const cur = satPos(s, i);
    setSatDrag({ key: s.key, dx: e.clientX - cur.x, dy: e.clientY - cur.y, pos: cur });
  }, [editingSat, satPos, cascade]);
  const satMove = useCallback((e: React.PointerEvent) => {
    setSatDrag((d) => (d ? { ...d, pos: { x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) } } : d));
  }, []);
  const satUp = useCallback((e: React.PointerEvent, s: Satellite) => {
    const start = downAt.current;
    const moved = !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 4;
    downAt.current = null;
    const d = satDragRef.current;
    setSatDrag(null);
    if (!d) return;
    if (moved) { const fp = focusPosRef.current; if (focused && fp) onMoveInFocus?.(focused.id, satId(s), { x: Math.round(d.pos.x - fp.x), y: Math.round(d.pos.y - fp.y) }); }
    else if (s.kind === 'sticky' && onStickyEdit) setEditingSat(s.f.id);
    // A still click anywhere on a Peer question opens it to answer.
    else if (s.kind === 'peer' && (s.q.peer?.state ?? 'open') === 'open') setPeerAnswering(s.q.id);
  }, [focused, onMoveInFocus, onStickyEdit]);
  const focusStrip = focused && focused.kind === 'card' ? stripColorOf?.(focused.id) : undefined;
  const focusAccent = focused ? (focused.kind === 'world' ? WORLD_GREEN : focusStrip ?? (getEntityColor(focused.entity.type as any) || '#888')) : '#888';
  // Where a member of the open card's subplot slide sits: a ghost beside a
  // scene, or a scene card under a subplot (Take out, its word chip).
  const memberRect = (id: string): { x: number; y: number; w: number; h: number; ghost: boolean } | null => {
    const si = satellites.findIndex((x) => x.kind === 'ghost' && x.row.id === id);
    if (si >= 0) { const p = satPos(satellites[si], si); return { x: p.x, y: p.y, w: GHOST_W, h: GHOST_H, ghost: true }; }
    const it = byId.get(id); const q = it && positions[id];
    if (it && q) { const p = pushed(it, q); const z = itemSize(it); return { x: p.x, y: p.y, w: z.w, h: z.h, ghost: false }; }
    return null;
  };
  const jump = useCallback((id: string) => {
    // A subplot opens as its own sandbox card, like from the strip.
    const isSub = !!subplotOptions?.some((o) => o.id === id);
    if (onBoard.has(id) || (isSub && onFocus)) onFocus?.(id);
    else onOpenCard?.(id);
  }, [onBoard, onFocus, onOpenCard, subplotOptions]);

  return (
    <CastCtx.Provider value={cast}>
    <div
      ref={stageRef}
      data-sandbox-stage
      data-focused={focused ? focused.id : undefined}
      onPointerDown={onStagePointerDown}
      onDoubleClick={onRequestSticky && !focused && !scenesMode ? (e) => {
        if (e.target !== e.currentTarget) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onRequestSticky({ x: Math.max(0, Math.round(e.clientX - r.left - STICKY_W / 2)), y: Math.max(0, Math.round(e.clientY - r.top - 24)) });
      } : undefined}
      style={{
        position: 'relative', width: Math.max(extent.w, focusPos ? focusPos.x + focusW + 40 : 0, focusRoom?.w ?? 0), height: Math.max(extent.h, focusPos ? focusPos.y + focusH + 40 : 0, focusRoom?.h ?? 0, cascadeBottom ? cascadeBottom + 60 : 0, writing && focusPos ? focusPos.y + (typeof window !== 'undefined' ? window.innerHeight : 1000) : 0),
        backgroundImage: `radial-gradient(circle, ${dark ? 'rgba(255,107,53,.16)' : 'rgba(234,88,12,.14)'} 1px, transparent 1.4px)`,
        backgroundSize: dark ? '40px 40px' : '26px 26px',
        backgroundPosition: '8px 8px',
      }}
    >
      <style>{RING_CSS}{PEER_CSS}</style>
      <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        {!focused && !charactersMode && !worldMode && !laid && !scenesMode && lines.map((l) => <path key={l.key} d={l.d} fill="none" stroke={l.stroke} strokeWidth={l.w ?? 1.5} strokeDasharray={l.dash || undefined} opacity={l.op} />)}
        {/* THE GRID'S ORDER (Ben, 2026-11-08: "drop the lines from the straight
            grid view and replace that with stylistic arrows"): a short arrow in
            the gap to the next card; where a row wraps, a curl down off its end
            stops on a dot and a hook from a dot curls into the next row's first
            card. Beat colour
            inside a beat, the thread's blue between. */}
        {!focused && scenesMode && !laid && !drag && lines.filter((l) => l.ra && l.rb && l.key !== (cardHover ? `t:${cardHover}:${sceneOrder[(gridIndex.get(cardHover) ?? -2) + 1]}` : '')).map((l) => {
          const a = l.ra!, b = l.rb!;
          // Every grid cell is a scene tall (a beat's own size is its board tab).
          const ay = a.y + SCENE_H / 2, by = b.y + SCENE_H / 2;
          // Between beats the thread's pale blue reads as nothing at this size: a firmer one.
          const stroke = l.dash ? (dark ? 'rgba(118,168,249,.8)' : 'rgba(59,130,246,.72)') : l.stroke;
          const op = l.dash ? 1 : l.op;
          // A filled head, its tip short of the card it points at.
          const head = (x: number, y: number) => <path d={`M${x},${y} L${x - 8},${y - 4.5} L${x - 8},${y + 4.5} Z`} fill={stroke} stroke={stroke} strokeWidth={1} strokeLinejoin="round" opacity={op} />;
          const dot = (x: number, y: number) => <circle cx={x} cy={y} r={2.6} fill={stroke} opacity={op} />;
          const line = { fill: 'none', stroke, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: op };
          if (Math.abs(a.y - b.y) < 4 && b.x > a.x) {
            const tip = b.x - 4;
            return <g key={l.key} data-grid-arrow={l.key}><path d={`M${a.x + a.w + 5},${ay} L${tip - 7},${by}`} {...line} />{head(tip, by)}</g>;
          }
          if (b.y <= a.y) return null;
          // A row wraps: off the end, a curl down that stops on a dot in the
          // gap; into the next row, a hook from a dot in the gap above.
          const gapY = (a.y + SCENE_H + b.y) / 2;
          const ex = a.x + a.w + 5, hx = b.x - 14, tip = b.x - 4;
          return (
            <g key={l.key} data-grid-arrow={l.key}>
              <path d={`M${ex},${ay} Q${ex + 9},${ay} ${ex + 9},${ay + 10} L${ex + 9},${gapY}`} {...line} />
              {dot(ex + 9, gapY)}
              {dot(hx, gapY)}
              <path d={`M${hx},${gapY} L${hx},${by - 10} Q${hx},${by} ${tip - 7},${by}`} {...line} />
              {head(tip, by)}
            </g>
          );
        })}
        {linkDrag && (() => {
          const src = byId.get(linkDrag.from); const a = positions[linkDrag.from];
          if (!src || !a) return null;
          const z = itemSize(src);
          const sx = a.x + z.w, sy = a.y + z.h / 2, mx = (sx + linkDrag.at.x) / 2;
          return <path data-link-drag d={`M${sx},${sy} C${mx},${sy} ${mx},${linkDrag.at.y} ${linkDrag.at.x},${linkDrag.at.y}`} fill="none" stroke={dark ? 'rgba(118,168,249,.7)' : 'rgba(59,130,246,.6)'} strokeWidth={1.5} strokeDasharray="6 5" />;
        })()}
        {unfolded.map((u) => {
          const pa0 = posOf(u.parent); const parent = byId.get(u.parent);
          if (!pa0 || !parent) return null;
          const pa = drag?.id === u.parent ? pa0 : nudged(u.parent, pa0);
          const card = { x: pa.x, y: pa.y, ...itemSize(parent) };
          const grown = peerGrown.get(u.key);
          const q = grown && drag?.id !== u.parent ? { x: grown.x, y: grown.y } : nudged(u.key, unfoldPos(u)); const z = grown ?? unfoldSize[u.key] ?? { w: u.w, h: u.h };
          const box = { x: q.x, y: q.y, w: z.w, h: z.h };
          // A curve that leaves the card square to its edge and lands square
          // on the paper's (the character cascade's thread).
          const a = edgeOf(card, box.x + box.w / 2, box.y + box.h / 2), b = edgeOf(box, card.x + card.w / 2, card.y + card.h / 2);
          const dx = b.x - a.x, dy = b.y - a.y, sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
          const bow = Math.max(24, Math.hypot(dx, dy) * 0.45);
          const c1 = a.axis === 'x' ? `${a.x + sx * bow},${a.y}` : `${a.x},${a.y + sy * bow}`;
          const c2 = b.axis === 'x' ? `${b.x - sx * bow},${b.y}` : `${b.x},${b.y - sy * bow}`;
          const stroke = u.peer ? (dark ? 'rgba(125,211,240,.55)' : 'rgba(14,116,144,.42)') : (dark ? 'rgba(240,226,196,.45)' : 'rgba(122,90,24,.45)');
          return <path key={`ul:${u.key}`} data-unfold-line={u.key} d={`M${a.x},${a.y} C${c1} ${c2} ${b.x},${b.y}`} fill="none" stroke={stroke} strokeWidth={1.3} strokeLinecap="round" />;
        })}
        {charactersMode && webTies.map((t) => {
          const pa = posOf(t.a), pb = posOf(t.b);
          if (!pa || !pb) return null;
          const lit = webHover === t.a || webHover === t.b;
          return <line key={`w:${t.a}|${t.b}`} x1={pa.x + CHAR_W / 2} y1={pa.y + CHAR_H / 2} x2={pb.x + CHAR_W / 2} y2={pb.y + CHAR_H / 2} stroke={dark ? '#8a8f9c' : '#9aa0ad'} strokeWidth={lit ? 2 : 1.4} strokeDasharray={t.source === 'rel' ? '6 5' : undefined} opacity={webHover && !lit ? 0.25 : 0.8} />;
        })}
        {/* The threads ease with the cards when the layout changes; while a
            card is being dragged they follow the pointer with no easing, or
            they trail 700ms behind the hand. */}
        {focused && focusLines.map((l) => <path key={l.key} d={l.d} fill="none" stroke={dark ? liftColor(focusAccent, 0.25) : focusAccent} strokeWidth={cascade ? 2.5 : 1.5} strokeLinecap="round" strokeDasharray={cascade ? undefined : '6 5'} opacity={.75} style={{ transition: drag || satDrag ? 'none' : 'd 700ms cubic-bezier(.2,.7,.2,1)' }} />)}
      </svg>
      {onInsertBetween && !focused && !scenesMode && !charactersMode && !worldMode && !linkDrag && (
        <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          {lines.filter((l) => l.key.startsWith('t:') && l.from && l.to).map((l) => (
            <path key={`hit:${l.key}`} data-thread-hit={l.key} d={l.d} fill="none" stroke="transparent" strokeWidth={18} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseEnter={() => hoverLine(l.key)} onMouseLeave={() => hoverLine(null)} />
          ))}
        </svg>
      )}
      {onInsertBetween && scenesMode && !columns && !focused && !drag && cardHover && gridIndex.has(cardHover) && (() => {
        // THE GRID'S + (Ben, 2026-11-05): in the gap after a hovered card, a
        // new scene there, between it and the next one.
        const gi = gridIndex.get(cardHover)!;
        const tr = tlLayout?.get(cardHover);
        // On the timeline a beat adds through its own slot on the track (an
        // empty one) or after its scenes; it has no + of its own.
        if (tr && isBeatItem(cardHover)) return null;
        const sl = tr ? { x: tr.x, y: tr.y } : gridSlot(gi);
        const sw = tr ? tr.w : SCENE_W, sh = tr ? tr.h : SCENE_H, sg = tr ? TL.gap : GX;
        const next = sceneOrder[gi + 1] ?? null;
        const bp = positions[cardHover];
        const color = dark ? 'rgba(118,168,249,.9)' : 'rgba(59,130,246,.85)';
        return (
          <button type="button" data-grid-plus={cardHover} title="Add a scene here" aria-label="Add a scene here"
            onMouseEnter={() => { if (cardHoverTimer.current) { window.clearTimeout(cardHoverTimer.current); cardHoverTimer.current = null; } }}
            onMouseLeave={() => hoverCard(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setCardHover(null); onInsertBetween(cardHover, next, bp ? { x: Math.round(bp.x + 40), y: Math.round(bp.y + 60) } : { x: 40, y: 40 }); }}
            style={{ position: 'absolute', left: sl.x + sw + sg / 2 - 12, top: sl.y + sh / 2 - 12, width: 24, height: 24, boxSizing: 'border-box', borderRadius: '50%', zIndex: 6, cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${color}`, background: dark ? '#1e1e22' : '#fffdf7', color }}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        );
      })()}
      {onInsertBetween && laid && !focused && !drag && addSlots.map((sl) => {
        // ADD A SCENE SLOTS (Ben, 2026-11-05: "instead of a dot ... a dotted
        // space that implies a scene should be added here"). On the timeline,
        // a scene-high space under an empty beat; in the columns, the foot of
        // every column (a whole scene high under an empty beat). A scene
        // made there lands in that beat, after its last scene.
        const it = sl.beat ? items.find((x) => x.id === sl.beat) : undefined;
        const ink = (it?.kind === 'card' && String((it.entity as any).beat_color ?? '')) || (sl.beat ? '#5b21b6' : (dark ? '#76a8f9' : '#3b82f6'));
        const c = dark ? liftColor(ink, 0.35) : ink;
        const i = sceneOrder.indexOf(sl.after);
        const next = i >= 0 ? sceneOrder[i + 1] ?? null : null;
        const bp = positions[sl.after] ?? (sl.beat ? positions[sl.beat] : undefined);
        const label = sl.beat ? 'Add a scene to this beat' : 'Add a scene';
        return (
          <button key={sl.key} type="button" data-beat-slot={sl.beat ?? 'lead'} title={label} aria-label={label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setCardHover(null); onInsertBetween(sl.after, next, bp ? { x: Math.round(bp.x + 40), y: Math.round(bp.y + 90) } : { x: 40, y: 40 }); }}
            style={{ position: 'absolute', left: sl.rect.x, top: sl.rect.y, width: sl.rect.w, height: sl.rect.h, boxSizing: 'border-box', borderRadius: sl.empty ? 10 : 8, zIndex: 2, cursor: 'pointer', padding: 0,
              display: 'flex', flexDirection: sl.empty ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: 6, font: 'inherit', fontFamily: 'system-ui, sans-serif',
              border: `1.5px dashed ${hexToRgba(c, sl.empty ? 0.45 : 0.3)}`, background: 'transparent', color: hexToRgba(c, sl.empty ? 0.7 : 0.55), ['--slot-ink' as any]: c }}>
            <svg width={sl.empty ? 14 : 11} height={sl.empty ? 14 : 11} viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>Add a scene</span>
          </button>
        );
      })}
      {onInsertBetween && !focused && !scenesMode && !charactersMode && !worldMode && !linkDrag && (() => {
        // The line hovered; else the line out of the hovered card; else, for
        // the last card on the line, a spot just past its exit.
        let l = lines.find((x) => x.key === lineHover && x.from && x.to);
        if (!l && cardHover) l = lines.find((x) => x.key.startsWith('t:') && x.from === cardHover);
        let spot: { key: string; from: string; to: string | null; at: Pos; color: string } | null = l?.mid && l.from ? { key: l.key, from: l.from, to: l.to ?? null, at: l.mid, color: l.stroke } : null;
        if (!spot && cardHover && lineLinks?.some((x) => x.to === cardHover || x.from === cardHover)) {
          const it = items.find((x) => x.id === cardHover); const p = posOf(cardHover);
          if (it && p && it.kind === 'card' && (it.entity.type === 'event' || it.entity.type === 'sequence')) {
            const z = itemSize(it);
            spot = { key: `end:${cardHover}`, from: cardHover, to: null, at: { x: p.x + z.w + 26, y: p.y + z.h / 2 }, color: dark ? 'rgba(118,168,249,.85)' : 'rgba(59,130,246,.8)' };
          }
        }
        if (!spot) return null;
        const sp = spot;
        return (
          <button type="button" data-thread-plus={sp.key} title="Add a scene here" aria-label="Add a scene here"
            onMouseEnter={() => { if (cardHoverTimer.current) { window.clearTimeout(cardHoverTimer.current); cardHoverTimer.current = null; } if (lineHoverTimer.current) { window.clearTimeout(lineHoverTimer.current); lineHoverTimer.current = null; } }}
            onMouseLeave={() => { hoverLine(null); hoverCard(null); }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setLineHover(null); setCardHover(null); onInsertBetween(sp.from, sp.to, { x: Math.max(0, Math.round(sp.at.x - SCENE_W / 2)), y: Math.max(0, Math.round(sp.at.y - SCENE_H / 2)) }); }}
            style={{ position: 'absolute', left: sp.at.x - 12, top: sp.at.y - 12, width: 24, height: 24, boxSizing: 'border-box', borderRadius: '50%', zIndex: 6, cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1.5px solid ${sp.color}`, background: dark ? '#1e1e22' : '#fffdf7', color: sp.color }}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ display: 'block' }}><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        );
      })()}
      {items.map((it) => {
        const p = posOf(it.id);
        if (!p) return null;
        const fly = flying.has(it.id) && landingFrom;
        const isFocus = !!focused && focused.id === it.id && (it.kind === 'card' || it.kind === 'world');
        const isDragging = drag?.id === it.id;
        const at = fly ? landingFrom! : isFocus && focusPos ? focusPos : isDragging && drag ? drag.pos : pendingDrop?.id === it.id ? pendingDrop.pos : focused ? pushed(it, p) : nudged(it.id, p);
        const isSpot = !!spot && (spot === it.id || (it.kind === 'group' && it.members.some((m) => m.id === spot)));
        const soft = !!focused && !isFocus && !sharp.has(it.id);
        const offStage = (scenesMode && !gridIndex.has(it.id)) || (charactersMode && !webPos.has(it.id)) || (worldMode && !worldView.pos.has(it.id));
        if (isFocus && (it.kind === 'card' || it.kind === 'world')) {
          return (
            <div
              key={it.id}
              ref={focusRef}
              data-stage-item={it.id}
              data-focus-wrap
              style={{
                position: 'absolute', left: 0, top: 0,
                transform: `translate(${at.x}px, ${at.y}px)`,
                transition: 'transform 700ms cubic-bezier(.2,.7,.2,1)',
                zIndex: 30,
              }}
            >
              <FocusCard
                subject={it.kind === 'card' ? { kind: 'card', entity: it.entity, attached: it.attached } : { kind: 'world', entry: it.entry, attached: it.attached }}
                dark={dark} after={it.kind === 'card' ? it.after : undefined}
                onOpenSheet={onOpenCard ? () => onOpenCard(it.id) : undefined}
                onDumpInto={onDumpInto && it.kind === 'card' && it.entity.type !== 'arc' ? () => onDumpInto(it.id) : undefined}
                aimed={aimedCardId === it.id}
                onAskPeer={onAskPeer && (it.kind === 'world' || ['event', 'sequence', 'arc', 'character'].includes(it.entity.type)) ? () => {
                  // Ask, and turn to the Peer pill where the read and the questions land.
                  const k = slides.findIndex((x) => x.id === 'peer');
                  if (k >= 0) setSlideIdx(k);
                  onAskPeer(it.id);
                } : undefined}
                peerBusy={peerAskBusy === it.id}
                peerAsked={!!peerReads?.[it.id]?.text}
                peerRead={slide?.id === 'peer' ? { text: peerReads?.[it.id]?.text ?? '', busy: peerAskBusy === it.id, note: peerCardNote?.cardId === it.id ? peerCardNote.text : undefined } : undefined}
                onPlace={onPlaceCard && it.kind === 'card' ? () => onPlaceCard(it.id) : undefined}
                // A world entry turns back into a sticky too (Ben, 2026-10-31).
                onDemote={onDemoteCard && !(it.kind === 'card' && it.entity.type === 'arc') ? () => onDemoteCard(it.id, positionsRef.current[it.id]) : undefined}
                onToSequence={onToSequence && it.kind === 'card' && it.entity.type === 'event' ? () => onToSequence(it.id) : undefined}
                extra={focusExtra?.(it.id)}
                demoteLoses={onDemoteCard ? losesOnDemote(it, edges, items) : undefined}
                onDelete={onDeleteCard && it.kind === 'card' && (it.entity.type === 'event' || it.entity.type === 'sequence' || it.entity.type === 'character') ? () => onDeleteCard(it.id) : undefined}
                autoFocusTitle={freshCardId === it.id}
                // A world entry takes a sticky by hand too (Ben, 2026-10-22).
                onAddSticky={onAddSticky ? () => {
                  const si = slides.findIndex((x) => x.id === 'stickies');
                  if (si >= 0) setSlideIdx(si);
                  setDraftSatKind('sticky');
                  setDraftSatFor(it.id);
                  setEditingSat(DRAFT_SAT_ID);
                } : undefined}
                onAddLine={onAddLine && it.kind === 'card' && (it.entity.type === 'event' || it.entity.type === 'character') ? () => {
                  const si = slides.findIndex((x) => x.id === 'stickies');
                  if (si >= 0) setSlideIdx(si);
                  setDraftSatKind('line');
                  setDraftSatFor(it.id);
                  setEditingSat(DRAFT_LINE_ID);
                } : undefined}
                onEditBody={onEditDescription ? (text) => onEditDescription(it.id, text) : undefined}
                onEditTitle={onEditTitle && it.kind === 'card' && it.entity.type !== 'sequence' ? (text) => onEditTitle(it.id, text) : undefined}
                kindPick={it.kind === 'world' ? (onSetWorldKind
                  ? <KindPick value={it.entry.kind || 'other'} dark={dark} options={WORLD_KIND_OPTIONS} title="What kind of world card this is" onPick={(o) => onSetWorldKind(it.id, o.worldKind)} />
                  : undefined) : undefined}
                editor={writing ? editor : undefined}
                margins={writing ? draftMargins : undefined}
                onToggleMargin={writing ? toggleMargin : undefined}
                color={onSetColor && it.kind === 'card' ? { set: labelSet, onPick: (c) => onSetColor(it.id, c), value: colorIn(it.entity, colorSetId), frame: colorIn(it.entity, paintSetId) } : undefined}
                stripColor={it.kind === 'card' && (it.entity.type === 'sequence' || it.entity.type === 'arc') ? stripColorOf?.(it.id) : undefined}
                onClose={() => onFocus?.(null)}
              />
            </div>
          );
        }
        return (
          <div
            key={it.id}
            data-stage-item={it.id}
            data-soft={soft ? '1' : undefined}
            data-focus-member={slotOf.has(it.id) ? '1' : undefined}
            className={isSpot ? 'ff-spot' : dumpOpen?.lit.has(it.id) || stripPick?.lit.has(it.id) ? 'ff-lit' : peerLanded.has(it.id) ? 'ff-peer-landed' : peerReading && it.kind === 'card' ? 'ff-peer-reading' : undefined}
            onPointerDown={editingId && (it.id === editingId || (it.kind === 'group' && it.members.some((m) => m.id === editingId))) ? undefined : (e) => onPointerDown(e, it.id)}
            onPointerMove={isDragging ? onPointerMove : undefined}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={outOf.has(it.id) ? () => hoverOut(it.id) : stripPick?.addLabel && it.kind === 'card' && it.entity.type === 'event' ? () => setPickHover(it.id) : undefined}
            onPointerLeave={outOf.has(it.id) ? () => hoverOut(null) : stripPick?.addLabel && it.kind === 'card' && it.entity.type === 'event' ? () => setPickHover((h) => (h === it.id ? null : h)) : undefined}
            onMouseEnter={charactersMode && webPos.has(it.id) ? () => setWebHover(it.id) : onInsertBetween && it.kind === 'card' ? () => hoverCard(it.id) : undefined}
            onMouseLeave={charactersMode && webPos.has(it.id) ? () => setWebHover((h) => (h === it.id ? null : h)) : onInsertBetween && it.kind === 'card' ? () => hoverCard(null) : undefined}
            style={{
              position: 'absolute', left: 0, top: 0,
              transform: `translate(${at.x}px, ${at.y}px)${fly ? ' scale(.6)' : soft || offStage ? ' scale(.96)' : ''}`,
              // Behind an opened card the rest of the board recedes enough not
              // to compete with its stickies (Ben, 2026-10-12: more blur).
              opacity: fly || offStage ? 0 : soft ? (cascade ? 0.06 : 0.32) : 1,
              filter: soft ? 'blur(3px) saturate(.7)' : 'none',
              transition: isDragging ? 'none' : 'transform 700ms cubic-bezier(.2,.7,.2,1), opacity 500ms ease, filter 500ms ease',
              cursor: isDragging ? 'grabbing' : 'grab',
              pointerEvents: offStage || (cascade && soft) ? 'none' : undefined,
              ...(dropOn === it.id || pendingDrop?.target === it.id ? { outline: '2.5px dashed #ff8c42', outlineOffset: 6, borderRadius: 4 } : {}),
              ...(linkDrag?.over === it.id ? { outline: `2.5px dashed ${dark ? 'rgba(118,168,249,.95)' : 'rgba(59,130,246,.95)'}`, outlineOffset: 6, borderRadius: 4 } : {}),
              // The sticky being written sits over its neighbours, with its formatting bar.
              zIndex: isDragging ? 20 : editingId === it.id ? 15 : isSpot ? 5 : sharp.has(it.id) ? 4 : it.kind === 'token' ? 2 : 1,
              touchAction: 'none',
            }}
          >
            {isTemplateItem(it) && <TemplateTag dark={dark} />}
            {stripPick?.addLabel && pickHover === it.id && it.kind === 'card' && it.entity.type === 'event' && !isDragging && (() => {
              const isIn = stripPick.lit.has(it.id);
              const c = dark ? liftColor(stripPick.color, 0.25) : stripPick.color;
              return (
                <span data-strip-pick-hint={isIn ? 'out' : 'add'} aria-hidden
                  style={{ position: 'absolute', right: 10, top: -12, zIndex: 6, pointerEvents: 'none', height: 22, display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 999, whiteSpace: 'nowrap',
                    fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: 650, boxShadow: '0 2px 8px rgba(0,0,0,.16)',
                    border: `1px solid ${c}`, background: isIn ? (dark ? '#1e1e22' : '#fff') : c, color: isIn ? (dark ? '#e6e6ea' : '#3d4250') : '#fff' }}>
                  {isIn ? stripPick.outLabel : stripPick.addLabel}
                </span>
              );
            })()}
            {it.kind === 'card' && <IndexCard entity={it.entity} attached={it.attached} dark={dark} orderNo={scenesMode && runIndex.has(it.id) ? runIndex.get(it.id)! + 1 : templateNo.get(it.id)} frameColor={colorIn(it.entity, paintSetId)} dotColor={colorIn(it.entity, colorSetId)} dim={dimOf(it.entity)} stripe={it.entity.type === 'event' ? (String((it.entity as any).beat_color ?? '') || undefined) : undefined} stripeTag={stripPick?.tags?.get(it.id)} tagColor={stripPick?.color} dots={sceneDots?.get(it.id)} place={scenePlace?.get(it.id)} colorSet={labelSet} onColor={onSetColor && (it.entity.type === 'event' || it.entity.type === 'sequence') ? (c) => onSetColor(it.id, c) : undefined} unfolded={(showStickies || !!openStickies?.has(it.id)) && unfolded.some((u) => u.parent === it.id)}
              point={columns ? 'down' : scenesMode ? 'right' : beatPoint.get(it.id)} plainSize={scenesMode} forceSize={tlLayout?.get(it.id)} onResize={onStickyResize && it.entity.type === 'event' && !scenesMode && !focused && !charactersMode && !worldMode ? (size) => onStickyResize(it.id, size) : undefined} />}
            {it.kind === 'card' && (it.entity.type === 'event' || (onPlaceBeat && it.entity.type === 'sequence' && !(it.entity as any).beat_done)) && onReorderScene && !focused && !scenesMode && !charactersMode && !worldMode && (() => {
              // The dot only shows near the card's right edge, in the card's
              // own frame color (Ben, 2026-11-05: it stood out and competed
              // with the resize grip). The zone passes presses to the card.
              const z = itemSize(it);
              const active = linkDrag?.from === it.id;
              const fc = colorIn(it.entity, paintSetId);
              const base = getEntityColor('event' as any) || '#888';
              const bc = it.entity.type === 'sequence' ? String((it.entity as any).beat_color ?? '') : '';
              const ink = bc ? shade(bc, dark) : fc ? shade(fc, dark) : (dark ? liftColor(base, 0.25) : base);
              const D = 16, ZW = 44;
              return (
                <div data-link-zone style={{ position: 'absolute', ...(beatPoint.get(it.id) === 'down' ? { left: z.w / 2 - ZW / 2, top: z.h - 32, width: ZW, height: 44 } : { left: beatPoint.get(it.id) === 'left' ? -12 : z.w - ZW + 12, top: 8, width: ZW, height: Math.max(40, z.h - 40) }), ['--link-ink' as any]: ink }}>
                  <div
                    data-link-handle={it.id} data-active={active ? '' : undefined}
                    title="Drag to the scene that comes next"
                    onPointerDown={(e) => linkDown(e, it.id)}
                    onPointerMove={active ? linkMove : undefined}
                    onPointerUp={active ? linkUp : (e) => e.stopPropagation()}
                    onPointerCancel={() => setLinkDrag(null)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', ...(beatPoint.get(it.id) === 'down' ? { left: ZW / 2 - D / 2, top: 32 - D / 2 } : { left: beatPoint.get(it.id) === 'left' ? 12 - D / 2 : ZW - 12 - D / 2, top: z.h / 2 - 8 - D / 2 }), width: D, height: D, borderRadius: '50%', cursor: 'crosshair', touchAction: 'none',
                      boxSizing: 'border-box', background: dark ? '#1e1e22' : '#fffdf7', border: `2px solid ${ink}` }}
                  />
                </div>
              );
            })()}
            {it.kind === 'world' && <WorldCard entry={it.entry} attached={it.attached} touchTitles={it.touchTitles} dark={dark} unfolded={(showStickies || !!openStickies?.has(it.id)) && unfolded.some((u) => u.parent === it.id)} />}
            {it.kind === 'sticky' && (
              <StickyNote
                f={it.fragment} dumpNo={it.dumpNo} dark={dark}
                editing={editingId === it.id}
                onEdit={onStickyEdit ? (patch) => onStickyEdit(it.id, patch) : undefined}
                onDelete={onStickyDelete ? () => { onStickyDelete(it.id); setEditingId(null); } : undefined}
                onCancelEdit={() => setEditingId(null)}
                onPromote={onPromote ? (kind, text) => { onPromote(it.id, kind, text); setEditingId(null); } : undefined}
                onResize={onStickyResize ? (size) => onStickyResize(it.id, size) : undefined}
                onMenu={onDropSticky && !focused && !scenesMode && !charactersMode && !worldMode ? (at) => setStickyMenu({ id: it.id, at }) : undefined}
              />
            )}
            {it.kind === 'group' && (
              <Huddle
                members={it.members} badge={it.badge} dumpNos={it.dumpNos} dark={dark}
                onMake={onMakeCard ? (kind) => onMakeCard(it.id.slice('group:'.length), kind) : undefined}
                onAddTo={onAddHuddleTo ? (cardId) => onAddHuddleTo(it.id.slice('group:'.length), cardId) : undefined}
                onNotYet={onNotYet ? () => onNotYet(it.id.slice('group:'.length)) : undefined}
                editingId={editingId}
                onEdit={onStickyEdit ? (id, patch) => onStickyEdit(id, patch) : undefined}
                onDelete={onStickyDelete ? (id) => { onStickyDelete(id); setEditingId(null); } : undefined}
                onCancelEdit={() => setEditingId(null)}
                // A grouped sticky has the same menu as a loose one (2026-11-01:
                // it had none, so no colour, turn into or delete).
                onMenu={onDropSticky && !focused && !scenesMode && !charactersMode && !worldMode ? (id, at) => setStickyMenu({ id, at }) : undefined}
              />
            )}
            {it.kind === 'token' && <Token no={it.dumpNo} count={it.looseIds.length} dark={dark} open={openDump === it.id} />}
          </div>
        );
      })}
      {/* The focus's orbit: chips above the opened card, ghost cards and
          stickies around it. The board's own items that belong to the slide
          are moved in by `pushed` above. */}
      {focused && focusPos && !writing && (
        <div data-focus-orbit style={{ position: 'absolute', left: 0, top: 0, width: writing ? GHOST_W : focusW, transform: writing ? `translate(${Math.max(0, focusPos.x - 36 - GHOST_W)}px, ${focusPos.y}px)` : `translate(${focusPos.x}px, ${Math.max(4, focusPos.y - 46)}px)`, transition: 'transform 700ms cubic-bezier(.2,.7,.2,1), width 480ms ease', zIndex: 31 }}>
          <FocusChips vertical={writing} slides={writing ? writingSlides : slides} idx={writing ? (leftSlide ? writingSlides.indexOf(leftSlide) : -1) : Math.min(slideIdx, Math.max(0, slides.length - 1))} onPick={(i) => { if (writing) { const target = writingSlides[i]; const real = slides.indexOf(target); if (real >= 0) setSlideIdx(real); } else setSlideIdx(i); }} accent={focusAccent} dark={dark}
            draft={!writing && focused.kind === 'card' && focused.entity.type === 'event' ? { drafted: String((focused.entity as any).has_script_text ?? '') === '1', onOpen: onWriteCard ? () => onWriteCard(focused.id) : undefined } : undefined}
            addTie={!writing && onSetTie && focused.kind === 'card' && focused.entity.type === 'character' ? (() => {
              const tied = new Set((slides.find((x) => x.id === 'relationships')?.rows ?? []).map((r) => r.id));
              return { options: cast.list.filter((c) => c.id !== focused.id && !tied.has(c.id)), onPick: (id: string) => {
                const ri = slides.findIndex((x) => x.id === 'relationships');
                if (ri >= 0) setSlideIdx(ri);
                onSetTie(focused.id, id, 'related');
                setTieEdit(id);
              } };
            })() : undefined}
            addScene={!writing && onTagSubplot && focused.kind === 'card' && focused.entity.type === 'arc' && slides.some((x) => x.id === 'scenes') ? (() => {
              // The scenes not in this subplot yet, in story order.
              const inIt = new Set((slides.find((x) => x.id === 'scenes')?.rows ?? []).map((r) => r.id));
              const scenes = items.filter((i): i is Extract<StageItem, { kind: 'card' }> => i.kind === 'card' && i.entity.type === 'event');
              const rank = new Map(sceneOrder.map((id, k) => [id, k]));
              const ordered = [...scenes].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
              const sc = getEntityColor('event' as any) || '#3b82f6';
              return {
                options: ordered.filter((i) => !inIt.has(i.id)).map((i) => ({ id: i.id, name: cardTitle(i.entity), color: sc })),
                onPick: (id: string) => onTagSubplot(focused.id, id),
                onNew: onNewSceneInSubplot ? { label: 'New scene', run: () => onNewSceneInSubplot(focused.id) } : undefined,
                stayOpen: true,
              };
            })() : undefined}
            addSubplot={!writing && onTagSubplot && subplotOptions && focused.kind === 'card' && focused.entity.type === 'event' && slides.some((x) => x.id === 'subplots') ? (() => {
              const inIt = new Set((slides.find((x) => x.id === 'subplots')?.rows ?? []).map((r) => r.id));
              return { options: subplotOptions.filter((o) => !inIt.has(o.id)), onPick: (id: string) => onTagSubplot(id, focused.id),
                onNew: onNewSubplotWithScene ? { label: 'New subplot', run: () => onNewSubplotWithScene(focused.id) } : undefined };
            })() : undefined}
            addCast={!writing && onAddCast && focused.kind === 'card' && focused.entity.type !== 'character' && slides.some((x) => x.id === 'cast') ? (() => {
              const inCast = new Set((slides.find((x) => x.id === 'cast')?.rows ?? []).map((r) => r.id));
              return { options: cast.list.filter((c) => !inCast.has(c.id)), onPick: (id: string) => onAddCast(focused.id, id) };
            })() : undefined}
          />

        </div>
      )}
      {focused && onSetTransition && [...outOf.entries()].map(([id, t]) => {
        // WHAT THE SCENE DOES TO IT (Ben, 2026-11-07: blank unless set, and
        // click to edit): a word chip on the member's edge, a menu of the
        // words this scene allows, None to clear it.
        const r = memberRect(id);
        if (!r) return null;
        const edge = (((edges as any)?.evokes ?? []) as any[]).find((x) => x.arc_id === t.arcId && x.event_id === t.sceneId);
        const cur = String(edge?.transition ?? '');
        const scene = (allEntities ?? []).find((e) => e.id === t.sceneId) ?? (byId.get(t.sceneId) as any)?.entity;
        const allowed = EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS[String(scene?.narrative_status ?? 'on_screen')] ?? EVOKES_TRANSITIONS;
        const options = [...allowed.filter((w) => w !== cur).map((w) => ({ id: w, name: w })), ...(cur ? [{ id: '', name: 'None' }] : [])];
        const ink = dark ? '#c8c8d0' : '#3d4250';
        return (
          <div key={`word:${id}`} data-transition-chip={id} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', left: r.x + 12, top: r.ghost ? r.y + r.h - 11 : r.y - 11, zIndex: 33 }}>
            <AddPick dark={dark} options={options} onPick={(w) => onSetTransition(t.arcId, t.sceneId, w)} title="What this scene does to the subplot" testAttr="data-transition-pick"
              find="Find a word" none="No word like that." verb="Set" noDot
              trigger={{ label: cur || 'what it does', style: { height: 22, padding: '0 9px', boxSizing: 'border-box', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: cur ? 650 : 500, fontStyle: cur ? 'normal' : 'italic', whiteSpace: 'nowrap',
                border: `1px ${cur ? 'solid' : 'dashed'} ${dark ? '#3a3a42' : '#d6d1c4'}`, background: dark ? '#1e1e22' : '#fff', color: cur ? ink : (dark ? '#8a8a93' : '#8a8578') } }} />
          </div>
        );
      })}
      {focused && outHover && outOf.has(outHover) && onUntagSubplot && (() => {
        const t = outOf.get(outHover)!;
        const r = memberRect(outHover);
        if (!r) return null;
        const label = focused.kind === 'card' && focused.entity.type === 'arc' ? 'Take this scene out of the subplot' : 'Take the scene out of this subplot';
        return (
          <button type="button" data-take-out={outHover} title={label} aria-label={label}
            onPointerEnter={() => hoverOut(outHover)} onPointerLeave={() => hoverOut(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setOutHover(null); onUntagSubplot(t.arcId, t.sceneId); }}
            style={{ position: 'absolute', left: r.x + r.w - 74, top: r.y - 12, height: 22, padding: '0 9px', boxSizing: 'border-box', borderRadius: 999, zIndex: 34, cursor: 'pointer',
              font: 'inherit', fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap',
              border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: dark ? '#1e1e22' : '#fff', color: dark ? '#e6e6ea' : '#3d4250', boxShadow: '0 2px 8px rgba(0,0,0,.14)' }}>
            Take out
          </button>
        );
      })()}
      {focused && focusCenter && satellites.map((s, i) => {
        if (s.kind === 'item') return null;
        const p = satPos(s, i);
        const dragging = satDrag?.key === s.key;
        const editing = s.kind === 'sticky' && editingSat === s.f.id;
        return (
          // The grow animation lives on an INNER element: on the translated
          // wrapper its transform keyframes replaced the translate and every
          // ghost and sticky satellite ended at the stage's origin, unseen.
          <div
            key={s.key} data-focus-satellite
            onPointerEnter={s.kind === 'ghost' && outOf.has(s.row.id) ? () => hoverOut(s.row.id) : undefined}
            onPointerLeave={s.kind === 'ghost' && outOf.has(s.row.id) ? () => hoverOut(null) : undefined}
            onPointerDown={editing ? undefined : (e) => satDown(e, s, i)}
            onPointerMove={dragging ? satMove : undefined}
            onPointerUp={(e) => satUp(e, s)} onPointerCancel={(e) => satUp(e, s)}
            style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${p.x}px, ${p.y}px)`, transition: dragging ? 'none' : 'transform 700ms cubic-bezier(.2,.7,.2,1)', zIndex: dragging || editing ? 32 : 29, cursor: dragging ? 'grabbing' : undefined, touchAction: 'none' }}
          >
            <div style={{ animation: 'ffsbgrow 420ms cubic-bezier(.2,.7,.2,1) both', transformOrigin: '50% 50%' }}>
              {s.kind === 'ghost'
                ? <GhostSatellite row={s.row} dark={dark} solid={writing} onOpen={() => jump(s.row.id)} />
                : s.kind === 'peer'
                  ? <PeerQuestionSticky
                      q={s.q} dark={dark} answerBusy={answerBusy}
                      answering={peerAnswering === s.q.id} onAnsweringChange={(v) => setPeerAnswering(v ? s.q.id : null)}
                      live={peerLive?.[s.q.id]}
                      fresh={!!peerFresh?.has(s.q.id)}
                      spot={peerSpot === s.q.id}
                      onAnswer={onAnswerQuestion ? (text) => onAnswerQuestion(s.q, focused?.id ?? '', text) : undefined}
                      onUndo={onUndoAnswer ? () => onUndoAnswer(s.q.id) : undefined}
                      undoBusy={undoBusyId === s.q.id}
                      onDismiss={onDismissQuestion ? () => onDismissQuestion(s.q.id) : undefined}
                    />
                : s.f.id === DRAFT_LINE_ID
                  ? <DraftLine testId="sat-line" dark={dark} speaker={focused?.kind === 'card' && focused.entity.type === 'character' ? focused.id : ''} onCommit={(t, sp) => { if (focused) onAddLine?.(focused.id, t, sp); setEditingSat(null); setDraftSatFor(null); }} onCancel={() => { setEditingSat(null); setDraftSatFor(null); }} />
                : s.f.id === DRAFT_SAT_ID
                  ? <StickySatellite f={s.f} i={s.i} dark={dark} editing placeholder="Write the sticky" onEdit={(t) => { if (focused) onAddSticky?.(focused.id, t); }} onDoneEdit={() => { setEditingSat(null); setDraftSatFor(null); }} />
                  : <StickySatellite
                      f={s.f} i={s.i} dark={dark} editing={editing}
                      onMenu={onDropSticky ? (at) => setStickyMenu({ id: s.f.id, at }) : undefined}
                      onEdit={onStickyEdit ? (t) => onStickyEdit(s.f.id, { text: t }) : undefined}
                      onDoneEdit={() => setEditingSat(null)}
                      editor={editing && onStickyEdit ? (
                        <StickyLive
                          f={s.f} dark={dark}
                          onSave={(patch) => onStickyEdit(s.f.id, patch)}
                          onDelete={() => { onStickyDelete?.(s.f.id); setEditingSat(null); }}
                          onCancel={() => setEditingSat(null)}
                        />
                      ) : undefined}
                    />}
            </div>
          </div>
        );
      })}
      {unfolded.map((u) => {
        const grownAt = peerGrown.get(u.key);
        const q = grownAt && drag?.id !== u.parent ? { x: grownAt.x, y: grownAt.y } : nudged(u.key, unfoldPos(u));
        if (u.peer) {
          // Any question takes an answer, wherever it hangs (2026-10-21: the
          // answer read places it; a world entry's question was unanswerable).
          const home = byId.get(u.parent);
          return (
            <div key={`uf:${u.key}`} data-unfold-peer={u.key} onPointerDown={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${q.x}px, ${q.y}px)`, transition: drag?.id === u.parent ? 'none' : 'transform 380ms cubic-bezier(.2,.7,.2,1)', zIndex: grownAt ? 36 : 3 }}>
              <div style={{ animation: 'ffsbgrow 320ms cubic-bezier(.2,.7,.2,1) both', transformOrigin: '50% 50%' }}>
                <PeerQuestionSticky
                  q={u.f} dark={dark} answerBusy={answerBusy}
                  answering={peerAnswering === u.f.id} onAnsweringChange={(v) => setPeerAnswering(v ? u.f.id : null)}
                  live={peerLive?.[u.f.id]}
                  clickOpens
                  fresh={!!peerFresh?.has(u.f.id)}
                  spot={peerSpot === u.f.id}
                  onFold={onFoldQuestion && peerShown?.has(u.f.id) ? () => onFoldQuestion(u.f.id) : undefined}
                  onAnswer={onAnswerQuestion ? (text) => onAnswerQuestion(u.f, home?.id ?? '', text) : undefined}
                  onUndo={onUndoAnswer ? () => onUndoAnswer(u.f.id) : undefined}
                  undoBusy={undoBusyId === u.f.id}
                  onDismiss={onDismissQuestion ? () => onDismissQuestion(u.f.id) : undefined}
                />
              </div>
            </div>
          );
        }
        const editing = unfoldEdit === u.key;
        return (
          <div
            key={`uf:${u.key}`} data-unfold-sticky={u.key}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={editing || !onStickyEdit ? undefined : () => setUnfoldEdit(u.key)}
            style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${q.x}px, ${q.y}px)`, transition: drag?.id === u.parent ? 'none' : 'transform 500ms cubic-bezier(.2,.7,.2,1)', zIndex: editing ? 32 : 3, cursor: editing ? undefined : 'text' }}
          >
            <div style={{ animation: 'ffsbgrow 320ms cubic-bezier(.2,.7,.2,1) both', transformOrigin: '50% 50%' }}>
              <StickySatellite
                f={u.f} i={0} dark={dark} editing={editing}
                onMenu={onDropSticky ? (at) => setStickyMenu({ id: u.f.id, at }) : undefined}
                onDoneEdit={() => setUnfoldEdit(null)}
                editor={editing && onStickyEdit ? (
                  <StickyLive
                    f={u.f} dark={dark}
                    onSave={(patch) => onStickyEdit(u.f.id, patch)}
                    onDelete={() => { onStickyDelete?.(u.f.id); setUnfoldEdit(null); }}
                    onCancel={() => setUnfoldEdit(null)}
                  />
                ) : undefined}
              />
            </div>
          </div>
        );
      })}
      {peerFolded && [...peerByHome].map(([home, all]) => {
        const it = byId.get(home); const p = posOf(home);
        // What is out on the board (being answered, or just left by a pass)
        // is not counted on the folded mark.
        const list = all.filter((q) => !isLive(q));
        if (!it || !p || !list.length) return null;
        const z = itemSize(it);
        // Cards and world entries open on their Peer pill (a world entry has one since 2026-10-22).
        const isCard = it.kind === 'world' || (it.kind === 'card' && ['event', 'sequence', 'character'].includes(it.entity.type));
        // A huddle with its title and Ready chip along the top edge (Ben,
        // 2026-10-22: the mark sat on the title): its bottom-right corner.
        const strip = it.kind === 'group' && !!it.badge;
        return (
          <div key={`pm:${home}`} data-peer-folded={home} data-peer-corner={strip ? 'bottom' : 'top'} style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${beatPoint.get(home) === 'right' ? p.x - 13 : p.x + z.w - 13}px, ${strip ? p.y + z.h - 13 : p.y - 13}px)`, transition: drag?.id === home ? 'none' : 'transform 700ms cubic-bezier(.2,.7,.2,1)', zIndex: 6 }}>
            <PeerMini
              n={list.filter((q) => stateOf(q) === 'open').length || list.length} dark={dark} fresh={!!peerFresh && list.some((q) => peerFresh.has(q.id))}
              onClick={() => { if (isCard) { setPeerSlideFor(home); onFocus?.(home); } else onPeerExpand?.(); }}
            />
          </div>
        );
      })}
      {dumpOpen && !focused && !scenesMode && (() => {
        const tp = posOf(dumpOpen.tok.id);
        if (!tp) return null;
        // Opens to the right of the token, or to its left near the board's right edge.
        const flip = tp.x + TOKEN + 10 + SLIP_W > Math.max(stageW, extent.w);
        return (
          <div key={`slip:${dumpOpen.tok.id}`} style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${flip ? tp.x - SLIP_W - 10 : tp.x + TOKEN + 10}px, ${tp.y}px)`, zIndex: 45 }}>
            <div style={{ animation: 'ffsbgrow 260ms cubic-bezier(.2,.7,.2,1) both', transformOrigin: flip ? '100% 0' : '0 0' }}>
              <DumpSlip no={dumpOpen.tok.dumpNo} text={dumps?.[dumpOpen.tok.dumpId]} sources={dumpOpen.sources} left={0} dark={dark} onClose={() => setOpenDump(null)} />
            </div>
          </div>
        );
      })()}
      {dropOn && drag && (() => {
        const target = byId.get(dropOn);
        const moving = byId.get(drag.id);
        const tp = positions[dropOn];
        if (!target || !moving || moving.kind !== 'sticky' || !tp) return null;
        if (target.kind === 'group' || target.kind === 'sticky') {
          return (
            <div data-drop-hint aria-hidden style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${tp.x}px, ${Math.max(0, tp.y - 34)}px)`, zIndex: 41, pointerEvents: 'none', padding: '4px 10px', borderRadius: 999, background: '#ff8c42', color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(255,140,66,.35)' }}>{target.kind === 'group' ? 'Put this sticky in the group' : 'Group these stickies'}</div>
          );
        }
        if (target.kind !== 'card' && target.kind !== 'world') return null;
        const line = moving.fragment.kind === 'dialogue';
        const name = target.kind === 'card' ? cardTitle(target.entity) : target.entry.title;
        const isChar = target.kind === 'card' && target.entity.type === 'character';
        const hint = line ? (isChar ? `${name} says this line` : 'Put this line in this scene') : (target.kind === 'world' ? 'Put this sticky on the world card' : isChar ? `Put this sticky on ${name}` : 'Put this sticky on this scene');
        return (
          <div data-drop-hint aria-hidden style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${tp.x}px, ${Math.max(0, tp.y - 34)}px)`, zIndex: 41, pointerEvents: 'none', padding: '4px 10px', borderRadius: 999, background: '#ff8c42', color: '#fff', fontSize: 11.5, fontWeight: 700, fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(255,140,66,.35)' }}>{hint}</div>
        );
      })()}
      {pendingDrop && (() => {
        const target = byId.get(pendingDrop.target);
        const sticky = byId.get(pendingDrop.id);
        if (!target || !sticky || sticky.kind !== 'sticky') return null;
        if (target.kind === 'group' || target.kind === 'sticky') {
          return (
            <DropConfirm
              at={{ x: pendingDrop.pos.x, y: Math.max(0, pendingDrop.pos.y - 46) }} dark={dark}
              question={target.kind === 'group' ? 'Add sticky to group?' : 'Group these stickies?'}
              yes={target.kind === 'group' ? 'Add' : 'Group'}
              onYes={confirmDrop} onNo={cancelDrop}
            />
          );
        }
        if (target.kind !== 'card' && target.kind !== 'world') return null;
        const name = target.kind === 'card' ? (cardTitle(target.entity) || 'this card') : target.entry.title;
        const line = sticky.fragment.kind === 'dialogue';
        const says = line && target.kind === 'card' && target.entity.type === 'character';
        return (
          <DropConfirm
            at={{ x: pendingDrop.pos.x, y: Math.max(0, pendingDrop.pos.y - 46) }} dark={dark}
            // Short, the card is already outlined (Ben, 2026-11-01: "just like
            // add sticky to card?").
            question={says ? `${name} says this?` : `Add ${line ? 'line' : 'sticky'} to card?`}
            yes={says ? 'Yes' : 'Add'}
            onYes={confirmDrop} onNo={cancelDrop}
          />
        );
      })()}
      {stickyMenu && menuSticky && (() => {
        const it = menuSticky;
        return (
          <StickyMenu
            at={stickyMenu.at} dark={dark} line={it.fragment.kind === 'dialogue'} cards={menuCards}
            color={stickyPaperKey(it.fragment)} onColor={onStickyColor ? (c) => onStickyColor(it.id, c) : undefined}
            onTurnInto={onTurnInto && it.fragment.kind !== 'dialogue' ? (kind) => onTurnInto(it.id, kind) : undefined}
            onPutOn={(cardId) => onDropSticky?.(it.id, cardId)}
            onUnpin={it.pinnedTo && onUnpinSticky ? () => onUnpinSticky(it.id, it.pinnedTo!) : undefined}
            onUngroup={it.at.startsWith('group:') && onUngroupSticky ? () => onUngroupSticky(it.id, it.at.slice('group:'.length)) : undefined}
            onDelete={() => onStickyDelete?.(it.id)}
            onClose={closeStickyMenu}
          />
        );
      })()}
      {draft && !focused && !scenesMode && onDraftCommit && onDraftCancel && (
        <div
          key={`draft:${draft.kind}:${draft.at ?? `${draft.pos.x}:${draft.pos.y}`}`} data-draft
          style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${draft.pos.x}px, ${draft.pos.y}px)`, zIndex: 40 }}
          // A draft moves by its paper (FIL-697, Philip: an empty sticky could
          // not be dragged, it disappeared). The caret stays in the words, so
          // grabbing the paper never blurs an empty draft into being dropped.
          onMouseDown={(e) => { if (!(e.target as Element).closest?.('[data-inline-text], button, input, [data-speaker-menu]')) e.preventDefault(); }}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!onDraftMove || (e.target as Element).closest?.('[data-inline-text], button, input, [data-speaker-menu]')) return;
            e.preventDefault();
            const start = { x: e.clientX, y: e.clientY, pos: draft.pos };
            const move = (ev: PointerEvent) => onDraftMove({ x: Math.max(0, Math.round(start.pos.x + ev.clientX - start.x)), y: Math.max(0, Math.round(start.pos.y + ev.clientY - start.y)) });
            // Capture phase, so a release over the words (which stop the
            // event) still ends the drag.
            const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
            window.addEventListener('pointermove', move, true);
            window.addEventListener('pointerup', up, true);
            window.addEventListener('pointercancel', up, true);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div style={{ animation: 'ffsbgrow 320ms cubic-bezier(.2,.7,.2,1) both', transformOrigin: '50% 50%' }}>
            {draft.kind === 'sticky'
              ? <DraftSticky dark={dark} onCommit={(t) => onDraftCommit(t)} onCancel={onDraftCancel} />
              : <DraftLine dark={dark} onCommit={(t, sp) => onDraftCommit(t, sp)} onCancel={onDraftCancel} />}
          </div>
        </div>
      )}
      {focused && !writing && focusLines.map((l) => (l.tie && l.mid && l.otherId ? (
        <TieLabel
          key={`t:${l.key}`} label={tieLabel(l.tie, focused.id)} at={l.mid} dark={dark} accent={focusAccent} instant={!!drag || !!satDrag}
          editing={tieEdit === l.otherId}
          canRemove={!!onRemoveTie && (l.tie.source === 'tie' || !!l.tie.relParked)}
          onEdit={() => setTieEdit(l.otherId!)}
          onCancel={() => setTieEdit(null)}
          onSave={(text) => { onSetTie?.(focused.id, l.otherId!, text, l.tie); setTieEdit(null); }}
          onRemove={() => { onRemoveTie?.(l.tie!); setTieEdit(null); }}
        />
      ) : null))}
      {charactersMode && webTies.map((t) => {
        const pa = posOf(t.a), pb = posOf(t.b);
        if (!pa || !pb) return null;
        const key = `${t.a}|${t.b}`;
        const spot = webSpots.get(key) ?? { x: (pa.x + pb.x + CHAR_W) / 2, y: (pa.y + pb.y + CHAR_H) / 2 };
        const viewer = webEdit?.key === key ? webEdit.viewer : webHover === t.a || webHover === t.b ? webHover : undefined;
        const other = (v: string) => (v === t.a ? t.b : t.a);
        return (
          <TieLabel
            key={`wl:${key}`} label={tieLabel(t, viewer ?? undefined)} at={spot} instant={!!drag}
            dark={dark} accent={getEntityColor('character' as any) || '#c2701f'}
            editing={webEdit?.key === key}
            canRemove={!!onRemoveTie && (t.source === 'tie' || !!t.relParked)}
            onEdit={() => setWebEdit({ key, viewer: viewer ?? t.from })}
            onCancel={() => setWebEdit(null)}
            onSave={(text) => { const v = webEdit?.viewer ?? t.from; onSetTie?.(v, other(v), text, t); setWebEdit(null); }}
            onRemove={() => { onRemoveTie?.(t); setWebEdit(null); }}
          />
        );
      })}
      {worldMode && worldView.heads.map((h) => (
        <div key={`wh:${h.key}`} data-world-head={h.key} style={{ position: 'absolute', left: h.x, top: h.y, width: STORY_W, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: dark ? STORY_INK.dark : STORY_INK.light, paddingBottom: 6, borderBottom: `1.5px solid ${dark ? 'rgba(159,207,142,.35)' : 'rgba(79,122,66,.3)'}` }}>
          <GlobeIcon size={13} />{h.label}<span style={{ marginLeft: 'auto', fontWeight: 600, opacity: .7 }}>{h.n}</span>
        </div>
      ))}
      {worldMode && worldView.heads.length === 0 && (
        <div style={{ position: 'absolute', left: 32, top: 32, maxWidth: 420, fontSize: 13.5, lineHeight: 1.5, color: dark ? '#9a9aa4' : '#777' }}>No world yet. What a dump says about the story's world, its places, rules and history, lands here.</div>
      )}
      {charactersMode && webPos.size === 0 && (
        <div style={{ position: 'absolute', left: 32, top: 32, maxWidth: 380, fontSize: 13.5, lineHeight: 1.5, color: dark ? '#9a9aa4' : '#777' }}>No characters on this board yet.</div>
      )}
      {charactersMode && webPos.size > 1 && webTies.length === 0 && (
        <div style={{ position: 'absolute', left: 32, top: 24, maxWidth: 420, fontSize: 12.5, lineHeight: 1.5, color: dark ? '#9a9aa4' : '#777' }}>No ties yet. Drag one character onto another to tie them.</div>
      )}
      {focused && slide && satellites.length === 0 && focusPos && (
        <div style={{ position: 'absolute', left: 0, top: 0, width: 220, transform: `translate(${focusPos.x + focusW + 44}px, ${focusPos.y + 12}px)`, fontSize: 11.5, lineHeight: 1.45, color: dark ? '#9a9aa4' : '#888', fontFamily: 'system-ui, sans-serif', zIndex: 29 }}>{slide.empty}</div>
      )}
      {laid && drag?.inGrid && gridTarget != null && tlLayout && (() => {
        const r = tlLayout.get(drag.id);
        if (!r) return null;
        return <div data-grid-hole aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: r.w, height: r.h, boxSizing: 'border-box', transform: `translate(${r.x}px, ${r.y}px)`, transition: 'transform 180ms ease-out', borderRadius: 3, border: `1.5px dashed ${dark ? '#76a8f9' : '#3b82f6'}`, background: dark ? 'rgba(118,168,249,.08)' : 'rgba(59,130,246,.07)', zIndex: 0 }} />;
      })()}
      {scenesMode && !laid && drag?.inGrid && gridTarget != null && (() => {
        const p = gridSlot(gridTarget);
        return <div data-grid-hole aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: SCENE_W, height: SCENE_H, boxSizing: 'border-box', transform: `translate(${p.x}px, ${p.y}px)`, transition: 'transform 180ms ease-out', borderRadius: 3, border: `1.5px dashed ${dark ? '#76a8f9' : '#3b82f6'}`, background: dark ? 'rgba(118,168,249,.08)' : 'rgba(59,130,246,.07)', zIndex: 0 }} />;
      })()}
      {items.length === 0 && !hideEmptyHint && (
        <div style={{ position: 'absolute', left: templatesShowing ? 400 : 32, top: 32, maxWidth: 380, fontSize: 13.5, lineHeight: 1.5, color: dark ? '#9a9aa4' : '#777' }}>
          Nothing here yet. Dump here and the stickies and cards land on this board instead of the master, or make a card or sticky yourself with New. A double-click on the board makes a sticky.
        </div>
      )}
    </div>
    </CastCtx.Provider>
  );
}
