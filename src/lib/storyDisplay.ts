// Story list display helpers (Home + Profile, 2026-10-18).
//
// A story shows its board as a breakdown by card type: on the focus story a
// mosaic of index-card tiles (one per card up to 15, then 15 split in
// proportion), on the smaller stories a proportional line. Colours are the
// board's own dark-stage entity colours (components/Freeform/tokens.ts).

import { ENTITY_COLORS } from '../components/Freeform/tokens';
import type { BoardSummary } from './freeformApi';
import { resolveStoryWorkflow } from './storyWorkflows';

export type CardKind = keyof BoardSummary;

export const CARD_KINDS: CardKind[] = ['sequences', 'scenes', 'characters', 'relationships', 'locations'];

const SINGULAR: Record<CardKind, string> = {
  sequences: 'sequence',
  scenes: 'scene',
  characters: 'character',
  relationships: 'relationship',
  locations: 'location',
};

/** Colour per card kind on the dark stage. */
export const KIND_COLOR_DARK: Record<CardKind, string> = {
  sequences: ENTITY_COLORS.sequence,
  scenes: ENTITY_COLORS.event,
  characters: ENTITY_COLORS.character,
  relationships: ENTITY_COLORS.relationship,
  locations: ENTITY_COLORS.location,
};

export const MOSAIC_CAP = 15;

export function boardTotal(s: BoardSummary | undefined | null): number {
  return s ? CARD_KINDS.reduce((a, k) => a + (s[k] || 0), 0) : 0;
}

/** "9 scenes" / "1 scene". */
export function kindLabel(kind: CardKind, n: number): string {
  return `${n} ${n === 1 ? SINGULAR[kind] : kind}`;
}

/** Screen-reader text for a board breakdown. */
export function boardAriaLabel(s: BoardSummary): string {
  const parts = CARD_KINDS.filter((k) => s[k] > 0).map((k) => kindLabel(k, s[k]));
  return parts.length ? `On the board: ${parts.join(', ')}` : 'Nothing on the board yet';
}

/**
 * Tiles per kind for the mosaic. Up to the cap, one tile per card. Past it,
 * the cap is split in proportion (largest remainder) and every kind on the
 * board keeps at least one tile, so a lone relationship never vanishes.
 */
export function allocateMosaic(s: BoardSummary, cap = MOSAIC_CAP): Array<{ kind: CardKind; n: number }> {
  const present = CARD_KINDS.filter((k) => s[k] > 0);
  const total = present.reduce((a, k) => a + s[k], 0);
  if (total <= cap) return present.map((kind) => ({ kind, n: s[kind] }));
  const q = present.map((kind) => {
    const v = (s[kind] * cap) / total;
    return { kind, n: Math.max(1, Math.floor(v)), r: v - Math.floor(v) };
  });
  let sum = q.reduce((a, o) => a + o.n, 0);
  [...q].sort((a, b) => b.r - a.r).forEach((o) => {
    if (sum < cap) { o.n += 1; sum += 1; }
  });
  while (sum > cap) {
    const big = q.reduce((a, o) => (o.n > a.n ? o : a));
    big.n -= 1;
    sum -= 1;
  }
  return q.map(({ kind, n }) => ({ kind, n }));
}

/** "12 minutes ago", "Yesterday", "3 days ago", "Oct 9", "Oct 9, 2025". */
export function relativeTime(iso: string | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** One story as the list shows it. */
export interface StoryRow {
  storyId: string;
  title: string;
  /** Genre only when the writer set one. */
  genre: string;
  logline: string;
  lastModified: string;
  isCorkboard: boolean;
}

/** A story with a board is a corkboard, whatever its record says: records
 *  often carry no workflow field, and the works backend stamps 'outline' on
 *  any save that names none, so a corkboard once opened down the outline path
 *  reads 'outline' for good. Outline stories never have a board. */
export function storyRows(works: Record<string, any> | undefined | null, summaries?: Record<string, BoardSummary> | null): StoryRow[] {
  return Object.entries(works ?? {})
    .map(([storyId, w]) => {
      const genre = String(w?.G ?? '').trim();
      return {
        storyId,
        title: String(w?.title ?? '').trim() || 'Untitled story',
        genre: genre && genre.toLowerCase() !== 'no genre' ? genre : '',
        logline: String(w?.SUM ?? '').trim(),
        lastModified: String(w?.lastModified ?? ''),
        isCorkboard: !!summaries?.[storyId] || resolveStoryWorkflow(w, storyId) === 'freeform',
      };
    })
    .sort((a, b) => (Date.parse(b.lastModified) || 0) - (Date.parse(a.lastModified) || 0));
}
