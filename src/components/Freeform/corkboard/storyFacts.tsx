// components/Freeform/corkboard/storyFacts.tsx
//
// ABOUT THIS STORY: what the writer has said about the piece as a whole:
// "a spec ad", "takes place in Chicago", "somber, not funny". Its own list,
// tied to no card.
//
// Why it exists (Ben, 2026-09-21): a braindump holds kinds of material that
// had no home on the board, so each got forced into the nearest card. Project
// talk became a scene titled "The writer has an image for a short film". This
// is where it goes instead, and where the writer can see it went.
//
// Placement (Ben, same day): ON THE TITLE ROW, to the right of the title, so
// it costs the board no vertical space. Short chips there; the full list, in
// the writer's own words, drops down OVER the board when a chip is clicked.
// Nothing below the header ever moves.
//   - chips give way before the title does: past `maxChips` they fold to "+N"
//   - an empty story shows one dashed chip, so the slot is visible from the
//     first second and teaches that the tool wants this
//   - a pending question (a braindump described the format, setting or period
//     differently) is one amber count chip; it opens the same confirm panel
//     every other question uses
import React, { useEffect, useRef, useState } from 'react';
import { useThemeMode } from './theme';
import { HoverTip } from './tooltip';
import { NOTE_FONT_SERIF } from '../tokens';
import type { StoryFact, StoryFactKind } from '../../../lib/freeformApi';

const ORANGE = '#ff8c42';
const KIND_LABEL: Record<StoryFactKind, string> = {
  format: 'Format', genre: 'Genre', setting: 'Setting', period: 'Period', tone: 'Tone', world: 'World', other: 'Other',
};
const KINDS = Object.keys(KIND_LABEL) as StoryFactKind[];

/** The label picker. The board's own menu, not the browser's: a native
 *  <select> opens as an OS popup over the control (on macOS, upward and in
 *  system chrome), which read as a different app inside this one. Same
 *  furniture as the toolbar's "New" menu: drops DOWN from its trigger, same
 *  surface, same row hover. */
function KindPicker({ value, onChange, dark }: { value: StoryFactKind; onChange: (k: StoryFactKind) => void; dark: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    // Capture phase, and stop it there: Escape closes THIS menu first, not the
    // whole list behind it.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const ink = dark ? '#d6d6de' : '#2c3140';
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
          padding: '5px 8px 5px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          border: `1px solid ${dark ? '#2e2e36' : '#e4e4ea'}`, background: dark ? '#1a1a1e' : '#fff', color: ink,
          minWidth: 78, justifyContent: 'space-between',
        }}
      >
        {KIND_LABEL[value]}
        <span aria-hidden style={{ fontSize: 8, opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>▼</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 210, minWidth: 130,
            background: dark ? '#1a1a1e' : '#fff', border: dark ? '1px solid #2a2a30' : '1px solid #e3e5ea',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(15,18,30,0.12)', padding: 5, fontFamily: 'system-ui, sans-serif',
          }}
        >
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={k === value}
              onClick={() => { onChange(k); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', padding: '7px 10px', fontSize: 12, fontWeight: 500,
                color: k === value ? ORANGE : ink, cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = dark ? '#26262c' : '#f4f5f7')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {KIND_LABEL[k]}
              {k === value && <span aria-hidden style={{ fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** HoverTip, except that no text means no tooltip at all (the shared one
 *  would still draw an empty bubble). Used to silence the chips' tips while
 *  the list is open and already showing every entry in full. */
function Tip({ text, width = 240, children }: { text: string; width?: number; children: React.ReactNode }) {
  if (!text) return <>{children}</>;
  return <HoverTip text={text} placement="bottom-right" accent={ORANGE} width={width}>{children}</HoverTip>;
}

export function StoryFactsStrip({
  facts, pending, maxChips = 6, canEdit,
  onSave, onDelete, onOpenQuestions,
}: {
  facts: StoryFact[];
  /** Story questions waiting on the writer. */
  pending: number;
  maxChips?: number;
  /** False on demo / wow boards: the list is read-only there. */
  canEdit: boolean;
  onSave: (fact: { id?: string; kind: StoryFactKind; text: string }) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onOpenQuestions: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // fact id, or 'new'
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<StoryFactKind>('other');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-away and Escape close the list. The list is an overlay: closing it
  // is never a layout change.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setEditing(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setEditing(null); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const ink = dark ? '#dcdce2' : '#2a2a30';
  const quiet = dark ? '#82828c' : '#8a8a94';
  const hair = dark ? '#2e2e36' : '#e4e4ea';
  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 500,
    padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer',
    border: `1px solid ${dark ? '#34343c' : '#d8d8e0'}`, color: dark ? '#b4b4be' : '#55555e',
    background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)', fontFamily: 'inherit', lineHeight: 1.5,
  };

  const shown = facts.slice(0, maxChips);
  const folded = facts.length - shown.length;
  const startEdit = (f: StoryFact | null) => {
    setEditing(f ? f.id : 'new');
    setDraft(f ? f.text : '');
    setDraftKind(f ? f.kind : 'other');
  };
  const commit = async () => {
    const text = draft.trim();
    const id = editing && editing !== 'new' ? editing : undefined;
    setEditing(null);
    if (!text) return;
    await onSave({ id, kind: draftKind, text });
  };

  const editor = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${hair}` }}>
      <KindPicker value={draftKind} onChange={setDraftKind} dark={dark} />
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(null); }}
        placeholder="A period piece, set in 1962"
        style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: '5px 8px', borderRadius: 6, border: `1px solid ${hair}`, background: dark ? '#1a1a1e' : '#fff', color: ink, outline: 'none', fontFamily: NOTE_FONT_SERIF }}
      />
      <button onClick={commit} style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: 'none', background: ORANGE, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
    </div>
  );

  return (
    <div ref={wrapRef} data-tour="story-facts" style={{ position: 'relative', zIndex: open ? 200 : 'auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, alignSelf: 'center' }}>
      <span style={{ width: 1, height: 16, background: dark ? '#34343c' : '#d8d8e0', margin: '0 2px', flexShrink: 0 }} />
      {facts.length === 0 ? (
        canEdit && (
          // The board's own tooltip, never the browser's `title`: a native
          // one is grey system chrome on a delay, and reads as a different
          // app. Opens DOWNWARD, since this row is the top of the page.
          <Tip text="What kind of piece is this? Its genre, where and when it is set, how it should feel.">
            <button onClick={() => { setOpen(true); startEdit(null); }} style={{ ...chip, borderStyle: 'dashed', color: quiet }}>
              + About this story
            </button>
          </Tip>
        )
      ) : (
        <>
          {shown.map((f) => (
            // While the list is open it already shows every entry in full; a
            // tooltip over it would only get in the way.
            <Tip key={f.id} text={open ? '' : f.text}>
              <button onClick={() => setOpen((o) => !o)} style={chip}>{f.label || f.text}</button>
            </Tip>
          ))}
          {folded > 0 && (
            <Tip text={open ? '' : `${folded} more. Open the list to see everything.`} width={200}>
              <button onClick={() => setOpen((o) => !o)} style={chip}>+{folded}</button>
            </Tip>
          )}
        </>
      )}
      {pending > 0 && (
        <Tip text={pending === 1 ? 'A braindump describes this story differently. Open to choose.' : `${pending} things a braindump describes differently. Open to choose.`}>
          <button
            onClick={onOpenQuestions}
            style={{ ...chip, color: ORANGE, borderColor: 'rgba(255,140,66,0.5)', background: 'rgba(255,140,66,0.1)', fontWeight: 700 }}
          >
            ? {pending}
          </button>
        </Tip>
      )}

      {open && (
        <div
          style={{
            // Above the board toolbar (zIndex 140, manually sticky): the list
            // drops OVER it, which is the whole point of not taking a row.
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 200, width: 420, maxWidth: '70vw',
            background: dark ? '#202024' : '#fdfaf3', border: `1px solid ${dark ? '#3a3a42' : '#e2dccd'}`, borderRadius: 10,
            padding: '10px 14px 6px', boxShadow: dark ? '0 12px 32px rgba(0,0,0,0.5)' : '0 12px 32px rgba(40,30,10,0.16)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: ink }}>About this story</span>
            {canEdit && editing !== 'new' && (
              <button onClick={() => startEdit(null)} style={{ background: 'transparent', border: 'none', color: quiet, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add</button>
            )}
          </div>
          {facts.length === 0 && editing !== 'new' && (
            <div style={{ fontSize: 12, color: quiet, lineHeight: 1.5, padding: '6px 0 10px' }}>
              Nothing yet. Say what kind of piece this is in a braindump, or add it here.
            </div>
          )}
          {facts.map((f) => (editing === f.id ? <div key={f.id}>{editor}</div> : (
            <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${hair}` }}>
              <span style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: quiet, width: 52, flexShrink: 0, paddingTop: 3, fontWeight: 700 }}>{KIND_LABEL[f.kind] ?? 'Other'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 13, lineHeight: 1.5, color: ink, display: 'block' }}>{f.text}</span>
                <span style={{ fontSize: 10.5, color: quiet }}>{f.source === 'writer' ? 'Added by you' : 'From your braindump'}</span>
              </span>
              {canEdit && (
                <span style={{ display: 'inline-flex', gap: 8, flexShrink: 0, paddingTop: 2 }}>
                  <button onClick={() => startEdit(f)} style={{ background: 'transparent', border: 'none', color: quiet, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Edit</button>
                  <button onClick={() => onDelete(f.id)} style={{ background: 'transparent', border: 'none', color: quiet, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Remove</button>
                </span>
              )}
            </div>
          )))}
          {editing === 'new' && editor}
        </div>
      )}
    </div>
  );
}
