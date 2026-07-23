// components/Freeform/corkboard/labels.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React from 'react';
import { type ArcKind, type EvokesTransition } from '../../../lib/freeformApi';
import { type CardSignal } from './signals';

export function relativeTimeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function narrativeStatusBg(s: string): string {
  if (s === 'on_screen') return '#10b98122';
  if (s === 'backstory') return '#a78bfa22';
  if (s === 'offstage') return '#94a3b822';
  return '#88888826'; // translucent — legible on both themes
}

export function narrativeStatusFg(s: string): string {
  if (s === 'on_screen') return '#059669';
  if (s === 'backstory') return '#7c3aed';
  if (s === 'offstage') return '#64748b';
  return '#888'; // mid-gray — legible on both themes
}

/** Display label for narrative_status (badge text). Maps the snake_case
 *  enum to a hyphenated industry term writers expect to see. */
export function narrativeStatusLabel(s: string): string {
  if (s === 'on_screen') return 'on-screen';
  return s;
}

export function tieLabel(s: CardSignal): string {
  const peers = s.structuralPeers ?? [];
  if (peers.length === 0) return `${s.structuralCount ?? 0} ties`;
  if (peers.length === 1) return `↔ ${peers[0]}`;
  return `${s.structuralCount} ties`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// D'-5 — readable label for an ArcKind enum value. Kept narrowly here since
// it's a UI affordance not a domain concept. 'relational' was removed from
// the enum but legacy Arc vertices may still carry it — render the label
// for those rather than the raw string.
export function arcKindLabel(k: ArcKind | string): string {
  switch (k) {
    case 'audience_question': return 'Audience question';
    case 'transformation': return 'Transformation';
    case 'promise': return 'Promise';
    case 'belief': return 'Belief';
    case 'thematic': return 'Thematic';
    case 'relational': return 'Relational';
    default: return String(k);
  }
}

// D'-5 — readable label for an EvokesTransition. Distinct from the enum
// string for UI display.
export function transitionLabel(t: EvokesTransition | '' | undefined): string {
  if (!t) return '—';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
