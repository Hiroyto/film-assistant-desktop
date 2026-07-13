// components/Freeform/entityColors.ts
//
// Helpers for resolving entity-type colors. Use these in components that
// need to switch on type — keeps the type→color mapping in one place.

import { ENTITY_COLORS } from './tokens';
import type { EntityType } from './types';

/** Return the hex color for an entity type. */
export function getEntityColor(type: EntityType): string {
  return ENTITY_COLORS[type];
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
