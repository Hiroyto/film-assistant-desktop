// components/Freeform/corkboard/worldSheet.tsx (FIL-653)
//
// A world entry opened: the writer's words in full, the kind, what it
// touches (each a door to that card), the stickies on it, and whether a
// scene on the page has established it. Read-only for now; the entry's
// text is the writer's and edits arrive with the sticky editor pattern.

import React, { useEffect, useState } from 'react';
import type { ProjectEntity, SandboxFragment, WorldEntry } from '../../../lib/freeformApi';
import { stickyPaper } from './sandbox';
import { RichText } from './richText';
import { InlineText } from './inlineText';
import { WORLD_GREEN } from './sandboxBoard';

export function WorldSheet({ entry, entities, fragments, dark, onClose, onOpenCard, onMakeScene, onEstablish, onEditText, onEditTitle }: { entry: WorldEntry; entities: ProjectEntity[]; fragments: SandboxFragment[]; dark: boolean; onClose: () => void; onOpenCard: (id: string) => void; onMakeScene?: () => void; onEstablish?: (cardId: string, undo: boolean) => void; onEditText?: (text: string) => void; onEditTitle?: (text: string) => void }) {
  const [picking, setPicking] = useState(false);
  // Placed scenes on the master: the ones that could establish this entry.
  const placedScenes = entities.filter((e) => e.type === 'event' && !e.deleted_at && (e as any).state !== 'parked' && e.staged !== '1');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const titleOf = (id: string) => { const e = byId.get(id); return String(e?.working_name ?? e?.working_title ?? '').trim() || id; };
  const stickies = fragments.filter((f) => f.open && f.attachedTo === entry.id);
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#82828c' : '#888';
  const serif = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: dark ? '#141417' : '#fff', borderRadius: 12, border: `1.5px solid ${WORLD_GREEN}`, boxShadow: '0 24px 60px rgba(0,0,0,.35)', color: ink, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `3px solid ${WORLD_GREEN}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: WORLD_GREEN }}>World · {entry.kind}</span>
          <span style={{ fontSize: 10.5, color: muted }}>{entry.establishedIn.length ? `established in ${entry.establishedIn.map(titleOf).join(', ')}` : 'intent'}</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} title="Close (Esc)" style={{ background: 'transparent', border: 'none', font: 'inherit', fontSize: 18, color: muted, cursor: 'pointer', padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <InlineText testId="world-title" value={entry.title} editable={!!onEditTitle} multiline={false} onSave={(t) => onEditTitle?.(t)} style={{ fontSize: 18, fontWeight: 650, lineHeight: 1.25 }} />
          <InlineText testId="world-text" paper value={entry.text} editable={!!onEditText} onSave={(t) => onEditText?.(t)} style={{ fontSize: 14, lineHeight: 1.5, fontFamily: serif }} />
          {entry.source && entry.source.trim() !== entry.text.trim() && (
            <div style={{ fontSize: 12, color: muted, lineHeight: 1.45 }}>{entry.source}</div>
          )}
          {entry.touches.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted }}>touches</span>
              {entry.touches.map((t) => (
                <button key={t.id} type="button" onClick={() => onOpenCard(t.id)} style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: 'pointer' }} title={t.role || undefined}>{titleOf(t.id)}</button>
              ))}
            </div>
          )}
          {(onMakeScene || onEstablish) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingTop: 4, borderTop: `1px solid ${dark ? '#26262b' : '#f0f0f0'}` }}>
              {onMakeScene && (
                <button type="button" onClick={onMakeScene} title="The flashback: a scene card from this world card, on the sandbox board; this card is established by it" style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: `1px solid ${WORLD_GREEN}`, background: 'transparent', color: dark ? WORLD_GREEN : '#4f7a42', cursor: 'pointer' }}>Make a scene from this</button>
              )}
              {onEstablish && entry.establishedIn.length === 0 && (
                picking ? (
                  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 10.5, color: muted }}>established in:</span>
                    {placedScenes.length === 0 && <span style={{ fontSize: 10.5, color: muted }}>no scene on the page yet</span>}
                    {placedScenes.slice(0, 12).map((sc) => (
                      <button key={sc.id} type="button" onClick={() => { setPicking(false); onEstablish(sc.id, false); }} style={{ font: 'inherit', fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(sc.working_title ?? '')}</button>
                    ))}
                    <button type="button" onClick={() => setPicking(false)} style={{ font: 'inherit', fontSize: 11, border: 'none', background: 'transparent', color: muted, cursor: 'pointer' }}>×</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setPicking(true)} title="Say which scene on the page establishes this" style={{ font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: 'transparent', color: ink, cursor: 'pointer' }}>A scene establishes this</button>
                )
              )}
              {onEstablish && entry.establishedIn.length > 0 && (
                <button type="button" onClick={() => onEstablish(entry.establishedIn[0], true)} title="Back to intent" style={{ font: 'inherit', fontSize: 11, border: 'none', background: 'transparent', color: muted, cursor: 'pointer', textDecoration: 'underline' }}>not established after all</button>
              )}
            </div>
          )}
          {stickies.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: muted }}>stickies</span>
              {stickies.map((f) => {
                const p = stickyPaper(f);
                return <div key={f.id} style={{ padding: '8px 10px', borderRadius: 1, background: dark ? p.dark : p.light, color: dark ? '#f6f4ee' : '#3b3a33', fontSize: 12.5, lineHeight: 1.4, fontFamily: serif }}><RichText text={f.text} /></div>;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
