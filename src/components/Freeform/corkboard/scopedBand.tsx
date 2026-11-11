// components/Freeform/corkboard/scopedBand.tsx (FIL-641, anchor section 9)
//
// A parked scene's pages open in the one script editor, scoped to that
// scene, and the shell says: you are still on the sandbox. The pages sit
// INSIDE the scene's index card, opened large on the board (ScopedCardHead
// is the card's top edge, the editor is its body); the stickies on the card
// hang beside it as paper (ScopedStickies); the board's dot grid is behind
// everything. The master script's chrome (outline rail, Notes / Review,
// Sync) stays away, done by the page. The pages themselves are untouched.

import { plainOf } from './richText';
import React from 'react';
import type { ProjectEdges, ProjectEntity, SandboxFragment } from '../../../lib/freeformApi';
import { getEntityColor } from '../entityColors';
import { stickyPaper } from './sandbox';
import { liftColor } from './theme';

export const SCENE_BLUE_LIGHT = '#3b82f6';
export const SCENE_BLUE_DARK = '#76a8f9';
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
const SHOW = 8;

export function dotGrid(dark: boolean): React.CSSProperties {
  return {
    backgroundImage: `radial-gradient(circle, ${dark ? 'rgba(255,107,53,.16)' : 'rgba(234,88,12,.14)'} 1px, transparent 1.4px)`,
    backgroundSize: dark ? '40px 40px' : '26px 26px',
    backgroundPosition: '8px 8px',
  };
}

export function cardPaper(dark: boolean) { return dark ? '#1e1e22' : '#fffdf7'; }
export function sceneBlue(dark: boolean) { return dark ? SCENE_BLUE_DARK : SCENE_BLUE_LIGHT; }

/** The index card's top edge: kicker, ruled line, title, drafted. The
 *  editor renders directly under it as the card's body. */
export function ScopedCardHead({ scene, dark }: { scene: ProjectEntity | undefined; dark: boolean }) {
  const blue = sceneBlue(dark);
  const muted = dark ? '#82828c' : '#888';
  const title = String(scene?.working_title ?? '').trim() || 'This scene';
  const drafted = String((scene as any)?.has_script_text ?? '') === '1';
  const summary = plainOf(String((scene as any)?.summary ?? '')).trim();
  return (
    <div data-testid="scoped-head" style={{ position: 'relative', padding: '10px 28px 10px', flexShrink: 0, color: dark ? '#e8e8ec' : '#1d2230', fontFamily: 'system-ui, sans-serif' }}>
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 34, height: 1.5, background: blue, opacity: .7 }} />
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: blue, height: 14, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span>Scene</span>
        <span style={{ color: muted, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{drafted ? 'drafted' : 'not drafted'} · parked</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.3, marginTop: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      {summary && <div style={{ fontSize: 12, lineHeight: 1.45, color: dark ? '#9a9aa4' : '#666', marginTop: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{summary}</div>}
      <div style={{ fontSize: 10.5, color: muted, marginTop: 6 }}>The pages below stay with this card until it is placed on the board.</div>
    </div>
  );
}

/** The left margin of a parked scene's pages (Ben, 2026-10-08): no outline
 *  rail here, one scene is the whole document; instead the scene's cast and
 *  where it happens, as small cards, each a door back to that card. */
export function ScopedCast({ sceneId, entities, edges, dark, onOpen }: { sceneId: string | null | undefined; entities: ProjectEntity[]; edges?: Partial<ProjectEdges> | null; dark: boolean; onOpen?: (id: string) => void }) {
  const byId = new Map(entities.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const cast = (edges?.involves ?? []).filter((x) => x.from === sceneId).map((x) => byId.get(x.to)).filter((c): c is ProjectEntity => !!c && c.type === 'character');
  const where = (edges?.occurs_in ?? []).filter((x) => x.from === sceneId).map((x) => byId.get(x.to)).filter((l): l is ProjectEntity => !!l);
  const muted = dark ? '#82828c' : '#888';
  const tile = (e: ProjectEntity) => {
    const base = getEntityColor(e.type as any) || '#888';
    const c = dark ? liftColor(base, 0.25) : base;
    const name = String(e.working_name ?? e.working_title ?? '').trim() || 'Untitled';
    const body = plainOf(String(e.description ?? e.summary ?? '')).trim();
    return (
      <button
        key={e.id} type="button" data-scoped-cast={e.id} onClick={onOpen ? () => onOpen(e.id) : undefined} title={onOpen ? 'Open on the board' : undefined}
        style={{ width: 170, boxSizing: 'border-box', textAlign: 'left', font: 'inherit', fontFamily: 'system-ui, sans-serif', cursor: onOpen ? 'pointer' : 'default', padding: '8px 12px 9px', borderRadius: 3, position: 'relative', background: dark ? '#1e1e22' : '#fffdf7', border: `1.5px solid ${c}`, color: dark ? '#e8e8ec' : '#1d2230', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: dark ? '0 1px 2px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.45)' : '0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(120,90,40,.10)' }}
      >
        <span aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 24, height: 1.5, background: c, opacity: .7 }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: c, height: 12 }}>{e.type === 'event' ? 'Scene' : e.type.charAt(0).toUpperCase() + e.type.slice(1)}</span>
        <span style={{ fontSize: 12.5, fontWeight: 650, lineHeight: 1.25, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{name}</span>
        {body && <span style={{ fontSize: 10.5, lineHeight: 1.35, color: muted, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{body}</span>}
      </button>
    );
  };
  return (
    <div data-testid="scoped-cast" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted }}>Cast</div>
      {cast.length === 0 && <span style={{ fontSize: 11.5, color: muted, maxWidth: 170, textAlign: 'right' }}>No one in this scene yet.</span>}
      {cast.map(tile)}
      {where.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted, marginTop: 6 }}>Where</div>}
      {where.map(tile)}
    </div>
  );
}

/** The card's stickies, hanging beside it on the board. */
export function ScopedStickies({ sceneId, fragments, dark }: { sceneId: string | null | undefined; fragments: SandboxFragment[]; dark: boolean }) {
  const stickies = fragments.filter((f) => f.open && !!sceneId && f.attachedTo === sceneId);
  const muted = dark ? '#82828c' : '#888';
  return (
    <div data-testid="scoped-stickies" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted }}>On this card</div>
      {stickies.length === 0 && (
        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: muted, maxWidth: 160 }}>No stickies yet. What you write here is read when you pause, and what it says lands on the board.</span>
      )}
      {stickies.slice(0, SHOW).map((f, i) => {
        const pp = stickyPaper(f);
        return (
          <div
            key={f.id}
            data-testid="scoped-sticky"
            title={f.source && f.source !== f.text ? f.source : undefined}
            style={{
              width: 150, boxSizing: 'border-box', padding: '9px 10px 10px', borderRadius: 1,
              background: dark ? pp.dark : pp.light, color: dark ? '#f6f4ee' : '#3b3a33',
              fontSize: 11.5, lineHeight: 1.35, fontFamily: SERIF, maxHeight: 96, overflow: 'hidden',
              transform: `rotate(${i % 2 ? 0.8 : -0.9}deg)`,
              boxShadow: dark ? `0 4px 12px rgba(0,0,0,.55), 0 0 0 1.5px ${pp.glow}, 0 0 14px ${pp.glow}` : '0 2px 4px rgba(0,0,0,.08), 0 8px 14px rgba(120,90,40,.10)',
            }}
          >{f.text}</div>
        );
      })}
      {stickies.length > SHOW && <span style={{ fontSize: 11, color: muted }}>+{stickies.length - SHOW} more on the card</span>}
    </div>
  );
}
