// components/Freeform/tokens.ts
//
// TypeScript-accessible constants mirroring the Tailwind extension in
// tailwind.config.js. Use these when you need a value in inline styles
// or when wiring animations programmatically; otherwise prefer Tailwind
// classes directly.

import type { EntityType, NarrativeStatus, QuestionUrgency } from './types';

// ===========================================
// Entity type colors (C-design palette lock)
// ===========================================

export const ENTITY_COLORS: Record<EntityType, string> = {
  character: '#e0a456',
  event: '#3b82f6',
  relationship: '#f43f5e',
  location: '#5eead4',
  information: '#71717a',
  arc: '#a855f7', // violet — distinct conceptual layer (threads, not entities)
};

export const PEER_BLUE = '#54bfdb';
export const PEER_BLUE_DARK = '#47a8c7';
export const PEER_BLUE_LIGHT = '#7dd3f0';

// ===========================================
// Card dimensions (Task #2/#3/#4/#6 locks)
// ===========================================

export const CARD_WIDTH_COLLAPSED = 220;
export const CARD_HEIGHT_COLLAPSED_MIN = 96;
export const CARD_WIDTH_WORKING = 520;
export const CARD_MAX_HEIGHT_VH = 80; // max-height: 80vh

export const PEER_CARD_WIDTH = 520;
export const PEER_CARD_OFFSET_FROM_WORKING = 40; // px right of working card

export const TOAST_WIDTH = 360;

// ===========================================
// Animation timings (Task #5/#7/#8/#9/#12 locks)
// ===========================================

export const FOCUS_PAN_MS = 350;
export const COLLAPSE_TO_WORKING_MS = 350;
export const PEER_SPAWN_MS = 400;
export const PEER_CLOSE_MS = 300;
export const QUESTION_POP_MS = 400;
export const QUESTION_STAGGER_MS = 400;
export const BRAINDUMP_CARD_STAGGER_MS = 80;
export const GLASSES_PULSE_MS = 1500;
export const CURSOR_BLINK_MS = 1000;
export const TOAST_DWELL_MS = 5000;
export const TOAST_COLLAPSE_MS = 300;
export const SOFT_GLOW_MS = 3000;

// ===========================================
// Canvas behavior (Task #1 locks)
// ===========================================

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;
export const EDGE_PAN_BUFFER_PX = 60;

// ===========================================
// Narrative status visual mapping (Task #3 lock)
// ===========================================

export const NARRATIVE_STATUS_BORDER_STYLE: Record<NarrativeStatus, string> = {
  on_screen: 'solid',
  backstory: 'dashed',
  offstage: 'dotted',
};

// ===========================================
// Question urgency dot color (Task #3 lock)
// ===========================================

export const URGENCY_COLOR: Record<QuestionUrgency, string> = {
  pressing: '#dc2626', // red
  simmering: '#eab308', // yellow
  background: '#71717a', // grey
};

// ===========================================
// Thread soft cap (Task #11 lock)
// ===========================================

export const SOFT_CAP_TURNS = 20;
export const SOFT_CAP_REMINDER_INTERVAL = 10;
