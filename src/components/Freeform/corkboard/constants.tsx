// components/Freeform/corkboard/constants.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React from 'react';

export const COLLAPSED_W = 240;

export const COLLAPSED_H = 110;

export const EXPANDED_W = 440;

// Reified Relationship cards collapse to a small red-accented pill labeled with
// the relationship kind, sitting on the (visible) line between their two
// characters; they square out to a full card when expanded.
export const REL_COLLAPSED_W = 124;

export const REL_COLLAPSED_H = 26;

export const REL_BALL_COLOR = '#dc2626';

// Characters collapse to a NAME PILL (constellation-node look) instead of a full
// card: same drag/collision/expansion machinery, just a smaller default shape.
// Long names wrap, so the pill can grow past CHAR_PILL_H (it's a minHeight),
// same approximation the rel/arc balls already make.
export const CHAR_PILL_W = 168;

export const CHAR_PILL_H = 44;

// Events are title-forward notecards — wider than the generic card so the
// bigger title breathes (height unchanged; content is SC no + title only).
export const EVENT_CARD_W = 300;

// Collapsed footprint by entity type — geometry consumers (connectors, hit
// tests, collision/displacement, auto-layout) use this instead of assuming
// every collapsed card is COLLAPSED_W × COLLAPSED_H.
export const collapsedSizeOf = (type?: string): { w: number; h: number } =>
  type === 'character' ? { w: CHAR_PILL_W, h: CHAR_PILL_H }
  : type === 'event' ? { w: EVENT_CARD_W, h: COLLAPSED_H }
  : { w: COLLAPSED_W, h: COLLAPSED_H };

export const COL_GAP = 120;

export const ROW_GAP = 48;

export const CANVAS_PAD = 24;

export const DRAG_THRESHOLD_PX = 4;

export const PEER_CARD_W = 760;

export const PEER_PROSE_COL_W = 360;

export const PEER_GAP = 24;

// Ball clusters. Non-event nodes bunch into category balls that stick to the
// top of the viewport AS THEIR CARDS SCROLL ABOVE THE VIEW (sticky-on-scroll):
// the writer follows the event spine by scrolling, and characters / unconnected
// arcs / locations / backstory beats that have scrolled past collect as
// clickable balls in a top row. Click a ball to deal its members back into
// view (transient — stored card positions never change). A card still in view
// renders normally; once it scrolls above the sticky row it joins its ball.
// The synthetic ball ids are viewport-pinned (computed each scroll frame), NOT
// persisted in CardLayouts — only the underlying cards' positions are stored.
export const BALL_ID_CHARACTERS = '__ball_characters';

export const BALL_ID_ARCS = '__ball_arcs';

export const BALL_ID_BACKSTORY = '__ball_backstory';

// Left-to-right order for the default row + per-category presentation. Balls are
// horizontally draggable afterward, so this is just the initial placement.
//   alwaysBalled — Backstory is a ball from the initial stage.
//   else (Characters, Arcs) are sticky-on-scroll: cards stay free until the
//   viewport scrolls past the category's lowest card, then they bunch up.
// Locations have NO ball and NO canvas cards — they're handled solely through
// the right-side panel (Locations section → open full sheet).
export const CLUSTER_ORDER = [
  BALL_ID_CHARACTERS,
  BALL_ID_ARCS,
  BALL_ID_BACKSTORY,
] as const;

export const CLUSTER_META: Record<
  string,
  {
    label: string;
    colorKey: 'character' | 'arc' | 'location' | 'event';
    noun: string;
    alwaysBalled: boolean;
  }
> = {
  [BALL_ID_CHARACTERS]: { label: 'Characters', colorKey: 'character', noun: 'character', alwaysBalled: false },
  [BALL_ID_ARCS]: { label: 'Arcs', colorKey: 'arc', noun: 'arc', alwaysBalled: false },
  [BALL_ID_BACKSTORY]: { label: 'Backstory', colorKey: 'event', noun: 'backstory beat', alwaysBalled: true },
};

export const BALL_W = 156;

export const BALL_H = 56;

export const BALL_ROW_GAP = 14; // horizontal gap between adjacent category balls in the row

export const BALL_RAIL_PAD = 10; // gap from the visible canvas top down to the sticky ball row

export const BALL_STACK_GAP = 14; // horizontal gap between ball-edge and first card, and between cards

export const BALL_DISPLACE_GAP = 18; // vertical gap when pushing other cards out of the way

export const BALL_TRANSITION_MS = 260;

export type Pos = { x: number; y: number };

export const ARC_BALL_W = 120;

export const ARC_BALL_H = 26;

export const ARC_DOT = 15; // small ball shown while the thread ball is sliding (scroll)
