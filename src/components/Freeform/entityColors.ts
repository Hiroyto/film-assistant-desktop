// components/Freeform/entityColors.ts
//
// Helpers for resolving entity-type colors. Use these in components that
// need to switch on type — keeps the type→color mapping in one place.

import { ENTITY_COLORS, ENTITY_COLORS_LIGHT } from './tokens';
import type { EntityType } from './types';

export type EntityColorMode = 'dark' | 'light';

/** Return the hex color for an entity type. Pass 'light' on the cream board so
 *  the hues that wash out on white (teal, amber, green) come back shaded;
 *  'dark' (the default) is the base palette. */
export function getEntityColor(type: EntityType, mode: EntityColorMode = 'dark'): string {
  if (mode === 'light') return ENTITY_COLORS_LIGHT[type] ?? ENTITY_COLORS[type];
  return ENTITY_COLORS[type];
}

/** Same shading for a color that was ALREADY resolved from ENTITY_COLORS —
 *  cards receive a hex, not a type. Colors outside the palette pass through
 *  unchanged (peer blue, rel ball red, arbitrary accents). */
export function entityColorForMode(hex: string, mode: EntityColorMode): string {
  if (mode !== 'light' || typeof hex !== 'string') return hex;
  const needle = hex.toLowerCase();
  const key = (Object.keys(ENTITY_COLORS) as EntityType[]).find(
    (t) => ENTITY_COLORS[t].toLowerCase() === needle,
  );
  return key ? ENTITY_COLORS_LIGHT[key] ?? hex : hex;
}

/** Return the Tailwind class fragment for an entity type's accent (use as `border-${frag}` etc.). */
export function getEntityColorClass(type: EntityType): string {
  switch (type) {
    case 'character':
      return 'entityCharacter';
    case 'event':
      return 'entityEvent';
    case 'relationship':
      return 'entityRelationship';
    case 'location':
      return 'entityLocation';
    case 'information':
      return 'entityInformation';
    case 'arc':
      return 'entityArc';
    case 'sequence':
      return 'entitySequence';
  }
}

/** Convert hex color to rgba with arbitrary alpha (for tints/borders). */
export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Human-readable type label for the type chip ("CHARACTER", "EVENT", etc.). */
export function getTypeLabel(type: EntityType): string {
  return type.toUpperCase();
}
