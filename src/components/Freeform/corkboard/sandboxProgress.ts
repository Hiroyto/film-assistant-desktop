// components/Freeform/corkboard/sandboxProgress.ts
//
// Kept out of the sandbox page module so the page exports only its
// component: React Fast Refresh then keeps the page's state on a hot reload
// instead of remounting it (a remount mid-dump dropped the dump, 2026-10-17).

/** The dock's line while a sandbox dump runs, from the backend's
 *  sandbox_dump_progress. The counts are the readers', before cleanup; the
 *  receipt carries the final ones. */
export function progressLine(m: { stage?: string; counts?: { scenes?: number; sequences?: number; notes?: number; characters?: number } }): string | null {
  if (m.stage === 'placing') return 'Placing them on the board…';
  if (m.stage !== 'read') return null;
  const c = m.counts ?? {};
  const n = (k: number | undefined, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : '');
  const parts = [n(c.scenes, 'scene', 'scenes'), n(c.sequences, 'group of scenes', 'groups of scenes'), n(c.notes, 'note', 'notes'), n(c.characters, 'character', 'characters')].filter(Boolean);
  if (!parts.length) return 'Read it. Working out what it holds…';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Read it: ${list}. Turning them into cards…`;
}

/** World kinds in the writer's words (Ben, 2026-10-17: "world, rule" means
 *  nothing to a writer). Used by the receipt's badges and world entries. */
export function worldKindLabel(kind?: string | null): string {
  switch (String(kind ?? '').toLowerCase()) {
    case 'rule': return 'How this world works';
    case 'history': return 'Backstory';
    case 'faction': return 'A group in this world';
    case 'place': return 'A place in this world';
    case 'thing': return 'Something in this world';
    default: return 'About this world';
  }
}

/** A badge's receipt heading: an offer, what the stickies could become
 *  (Ben, 2026-10-17: it asks whether to make a card, so it reads as one). */
export function badgeHeading(b: { kind: string; worldKind?: string | null; title: string }): string {
  if (b.kind === 'world') return `Could be a world card: ${b.title}`;
  if (b.kind === 'scene') return `Could be a scene: ${b.title}`;
  if (b.kind === 'character') return `Could be a character: ${b.title}`;
  return `Could be a ${b.kind}: ${b.title}`;
}
