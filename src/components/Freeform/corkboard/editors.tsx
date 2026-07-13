// components/Freeform/corkboard/editors.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { EVOKES_TRANSITIONS, EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS, createInformation, setInformationIrony, setKnowledge, tagArcInvolvesCharacter, tagEventEvokes, tagEventPrecedes, unlinkInformation, untagArcInvolvesCharacter, untagEventEvokes, untagEventPrecedes, updateInformation, type ArcKind, type EvokesTransition, type ProjectEdges, type ProjectEntity } from '../../../lib/freeformApi';
import { EditableDescription } from './cards';
import { arcKindLabel, narrativeStatusBg, narrativeStatusFg, narrativeStatusLabel, transitionLabel } from './labels';
import { miniActionBtn } from './peer';
import { ArcSheet, EventSheet } from './sheets';
import { useThemeMode } from './theme';

// =====================================================================
// D'-7 — Editable trajectory + involves pickers for ArcSheet.
//
// Backend (D'-2) already supports tag-event-evokes / untag-event-evokes /
// tag-arc-involves-character / untag-arc-involves-character. These editors
// are the FE surface that lets writers actually use them. The arc-sheet
// timeline becomes the music-sheet AND the editing surface: tag a new
// event from a picker, edit state_at_event + transition per row inline,
// untag with a per-row button.
//
// Optimism: we fire the backend call and then invoke onChanged() to refetch
// project entities. Errors revert by leaving the prop state alone and
// surfacing an error message. Typing in a textarea preserves local draft
// state until the prop catches up (EditableDescription's pattern).
// =====================================================================

export type ArcEvokesRowData = {
  event_id: string;
  event_title: string;
  narrative_status: string;
  transition: EvokesTransition | '';
  state_at_event: string;
};

export function ArcEvokesEditor({
  arcId,
  arcColor,
  evokes,
  allEntities,
  auth,
  projectId,
  onOpenCard,
  onChanged,
}: {
  arcId: string;
  arcColor: string;
  evokes: ArcEvokesRowData[];
  allEntities: ProjectEntity[];
  auth: { userId: string; token: string };
  projectId: string;
  onOpenCard: (cardId: string) => void;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const eventsAvailable = useMemo(
    () =>
      allEntities.filter(
        (e) => e.type === 'event' && !e.deleted_at,
      ),
    [allEntities],
  );
  const taggedIds = useMemo(() => new Set(evokes.map((e) => e.event_id)), [evokes]);
  const untagged = useMemo(
    () => eventsAvailable.filter((e) => !taggedIds.has(e.id)),
    [eventsAvailable, taggedIds],
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runOp = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const tag = (eventId: string) =>
    runOp(async () => {
      await tagEventEvokes({ eventId, arcId, projectId }, auth.token);
      setAdding(false);
    });

  const untag = (eventId: string) =>
    runOp(() => untagEventEvokes({ eventId, arcId, projectId }, auth.token));

  const updateRow = (
    eventId: string,
    fields: { stateAtEvent?: string; transition?: EvokesTransition | '' },
  ) =>
    runOp(() =>
      tagEventEvokes(
        {
          eventId,
          arcId,
          projectId,
          stateAtEvent: fields.stateAtEvent,
          transition: fields.transition,
        },
        auth.token,
      ),
    );

  return (
    <div>
      {evokes.length === 0 && !adding && (
        <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', marginTop: 0 }}>
          No events evoke this arc yet. Tag events with this arc to build the trajectory.
        </p>
      )}
      {evokes.map((e, i) => (
        <ArcEvokesRow
          key={e.event_id}
          index={i}
          row={e}
          arcColor={arcColor}
          disabled={busy}
          onOpenCard={onOpenCard}
          onUntag={() => untag(e.event_id)}
          onUpdate={(fields) => updateRow(e.event_id, fields)}
        />
      ))}
      {adding ? (
        <EntityPicker
          accentColor={arcColor}
          options={untagged.map((e) => ({
            id: e.id,
            label: e.working_title ?? e.working_name ?? e.id,
            sublabel: narrativeStatusLabel(e.narrative_status ?? 'on_screen'),
          }))}
          placeholder="Search events…"
          emptyMessage="All project events are already tagged."
          disabled={busy}
          onPick={(id) => tag(id)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || untagged.length === 0}
          style={{
            ...miniActionBtn,
            color: arcColor,
            paddingLeft: 0,
            marginTop: 6,
            opacity: untagged.length === 0 ? 0.4 : 1,
            cursor: untagged.length === 0 ? 'default' : 'pointer',
          }}
          title={
            untagged.length === 0
              ? 'All project events are already tagged with this arc'
              : 'Tag a project event with this arc'
          }
        >
          + tag event
        </button>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c33', lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function ArcEvokesRow({
  index,
  row,
  arcColor,
  disabled,
  onOpenCard,
  onUntag,
  onUpdate,
}: {
  index: number;
  row: ArcEvokesRowData;
  arcColor: string;
  disabled: boolean;
  onOpenCard: (cardId: string) => void;
  onUntag: () => void;
  onUpdate: (fields: {
    stateAtEvent?: string;
    transition?: EvokesTransition | '';
  }) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const ns = row.narrative_status || 'on_screen';
  const allowedTransitions =
    EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS[ns] ?? EVOKES_TRANSITIONS;
  const allowedSet = useMemo(() => new Set(allowedTransitions), [allowedTransitions]);

  return (
    <div
      style={{
        padding: '10px 12px',
        marginBottom: 10,
        border: dark ? '1px solid #2a2a30' : '1px solid #eee',
        borderLeft: `3px solid ${hexToRgba(arcColor, 0.4)}`,
        borderRadius: 4,
        background: dark ? '#1a1a1e' : '#fff',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <span style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 11, minWidth: 18 }}>{index + 1}.</span>
        <button
          type="button"
          onClick={() => onOpenCard(row.event_id)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 13,
            fontWeight: 500,
            color: dark ? '#e6e6ea' : '#222',
            cursor: 'pointer',
            textAlign: 'left',
            flex: 1,
            minWidth: 0,
            fontFamily: 'system-ui, sans-serif',
            textDecoration: 'underline',
            textDecorationColor: 'transparent',
            textUnderlineOffset: 2,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = '#bbb')}
          onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = 'transparent')}
          title="Open event sheet"
        >
          {row.event_title}
        </button>
        <span
          style={{
            fontSize: 9,
            padding: '2px 6px',
            background: narrativeStatusBg(ns),
            color: narrativeStatusFg(ns),
            borderRadius: 2,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            fontWeight: 600,
          }}
        >
          {narrativeStatusLabel(ns)}
        </span>
        <select
          value={row.transition || ''}
          disabled={disabled}
          onChange={(e) =>
            onUpdate({ transition: (e.target.value || '') as EvokesTransition | '' })
          }
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 10,
            padding: '2px 4px',
            border: `1px solid ${hexToRgba(arcColor, 0.3)}`,
            borderRadius: 3,
            background: row.transition ? hexToRgba(arcColor, dark ? 0.14 : 0.08) : dark ? '#1d1d22' : '#fff',
            color: row.transition ? hexToRgba(arcColor, 1) : dark ? '#9a9aa4' : '#666',
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            fontWeight: 600,
            cursor: disabled ? 'default' : 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
          title={
            ns === 'backstory'
              ? 'Backstory events permit only "touches" (Q7 rule)'
              : 'EVOKES transition'
          }
        >
          <option value="">— transition —</option>
          {EVOKES_TRANSITIONS.map((t) => (
            <option key={t} value={t} disabled={!allowedSet.has(t)}>
              {transitionLabel(t)}
              {!allowedSet.has(t) ? ' (backstory)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onUntag}
          disabled={disabled}
          style={{
            background: 'transparent',
            border: 'none',
            color: dark ? '#787882' : '#999',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: 14,
            padding: '0 4px',
            lineHeight: 1,
          }}
          title="Untag — remove this event from the arc's trajectory"
          onMouseEnter={(e) => (e.currentTarget.style.color = '#c33')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#999')}
        >
          ✕
        </button>
      </div>
      <div style={{ paddingLeft: 26 }}>
        <InlineStateAtEvent
          value={row.state_at_event}
          disabled={disabled}
          accentColor={arcColor}
          onSave={(next) => onUpdate({ stateAtEvent: next })}
        />
      </div>
    </div>
  );
}

/**
 * Click-to-edit single-paragraph editor for state_at_event. Saves on
 * ⌘/Ctrl+Enter or blur (with diff check). Esc cancels. Empty value renders
 * an italic placeholder so the writer sees the affordance.
 */
export function InlineStateAtEvent({
  value,
  disabled,
  accentColor,
  onSave,
}: {
  value: string;
  disabled: boolean;
  accentColor: string;
  onSave: (next: string) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hovered, setHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(draft.length, draft.length);
      });
    }
  }, [editing, draft.length]);

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };
  const commit = () => {
    const next = draft;
    setEditing(false);
    if (next !== value) onSave(next);
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={disabled}
        placeholder="State at event — where this arc sits after the event…"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
        rows={2}
        style={{
          fontSize: 12,
          color: dark ? '#e6e6ea' : '#222',
          lineHeight: 1.5,
          padding: '5px 7px',
          border: `1px solid ${hexToRgba(accentColor, 0.4)}`,
          borderRadius: 3,
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'system-ui, sans-serif',
          resize: 'vertical',
          minHeight: 40,
        }}
      />
    );
  }

  const isEmpty = !value;
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) setEditing(true);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Click to edit state at this event (⌘/Ctrl+Enter to save, Esc to cancel)"
      style={{
        fontSize: 12,
        color: isEmpty ? '#aaa' : '#555',
        fontStyle: isEmpty ? 'italic' : 'normal',
        lineHeight: 1.5,
        cursor: disabled ? 'default' : 'text',
        padding: '2px 4px',
        marginLeft: -4,
        marginRight: -4,
        borderRadius: 3,
        background: hovered && !disabled ? 'rgba(0,0,0,0.04)' : 'transparent',
        whiteSpace: 'pre-wrap',
        minHeight: 16,
      }}
    >
      {value || 'State at event…'}
    </div>
  );
}

/**
 * Picker dropdown — searchable list of taggable options. Used by both
 * ArcEvokesEditor (events) and ArcInvolvesEditor (characters), and by the
 * EventSheet's arcs-evoked panel.
 */
export function EntityPicker({
  accentColor,
  options,
  placeholder,
  emptyMessage,
  disabled,
  onPick,
  onCancel,
}: {
  accentColor: string;
  options: Array<{ id: string; label: string; sublabel?: string }>;
  placeholder: string;
  emptyMessage: string;
  disabled: boolean;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.sublabel ? o.sublabel.toLowerCase().includes(needle) : false),
    );
  }, [q, options]);

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        border: `1px solid ${hexToRgba(accentColor, 0.3)}`,
        borderRadius: 4,
        background: dark ? '#1a1a1e' : '#fff',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input
          ref={inputRef}
          value={q}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            } else if (e.key === 'Enter' && filtered.length > 0) {
              e.preventDefault();
              onPick(filtered[0].id);
            }
          }}
          style={{
            flex: 1,
            fontSize: 12,
            padding: '5px 7px',
            border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
            borderRadius: 3,
            outline: 'none',
            fontFamily: 'system-ui, sans-serif',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          style={{ ...miniActionBtn, color: dark ? '#82828c' : '#888' }}
        >
          cancel
        </button>
      </div>
      {options.length === 0 ? (
        <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', padding: '4px 2px' }}>
          {emptyMessage}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', padding: '4px 2px' }}>
          No match.
        </div>
      ) : (
        <div className="cb-scroll" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              disabled={disabled}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '5px 7px',
                fontSize: 12,
                color: dark ? '#e6e6ea' : '#222',
                background: 'transparent',
                border: 'none',
                borderRadius: 3,
                cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'system-ui, sans-serif',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = hexToRgba(accentColor, 0.08))
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'transparent')
              }
            >
              <span>{o.label}</span>
              {o.sublabel && (
                <span style={{ marginLeft: 8, fontSize: 10, color: dark ? '#82828c' : '#888' }}>
                  {o.sublabel}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArcInvolvesEditor({
  arcId,
  arcColor,
  involvedNames,
  allEntities,
  edges,
  auth,
  projectId,
  onChanged,
}: {
  arcId: string;
  arcColor: string;
  involvedNames: string[];
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  // Resolve involvedNames -> ids via edges.arc_involves (authoritative source).
  // involvedNames in signal is derived from the same edge set, but going
  // through edges here means we untag by id, not by name.
  const charactersById = useMemo(() => {
    const m = new Map<string, ProjectEntity>();
    for (const e of allEntities) {
      if (e.type === 'character' && !e.deleted_at) m.set(e.id, e);
    }
    return m;
  }, [allEntities]);

  const tagged = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    for (const ai of edges.arc_involves ?? []) {
      if (ai.arc_id !== arcId) continue;
      const c = charactersById.get(ai.character_id);
      if (!c) continue;
      out.push({ id: c.id, name: c.working_name ?? c.id });
    }
    return out;
  }, [edges.arc_involves, arcId, charactersById]);

  const taggedIds = useMemo(() => new Set(tagged.map((t) => t.id)), [tagged]);
  const untagged = useMemo(
    () =>
      [...charactersById.values()]
        .filter((c) => !taggedIds.has(c.id))
        .sort((a, b) =>
          (a.working_name ?? a.id).localeCompare(b.working_name ?? b.id),
        ),
    [charactersById, taggedIds],
  );

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runOp = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const tag = (characterId: string) =>
    runOp(async () => {
      await tagArcInvolvesCharacter(
        { arcId, characterId, projectId },
        auth.token,
      );
      setAdding(false);
    });

  const untag = (characterId: string) =>
    runOp(() =>
      untagArcInvolvesCharacter({ arcId, characterId, projectId }, auth.token),
    );

  // Fallback for signal-derived involvedNames if edges set is empty but
  // names exist (defensive — happens during refresh latency).
  const showNames =
    tagged.length === 0 && involvedNames.length > 0 ? involvedNames : null;

  return (
    <div>
      {tagged.length === 0 && !adding && !showNames && (
        <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', marginTop: 0 }}>
          No characters tagged yet.
        </p>
      )}
      {showNames &&
        showNames.map((n) => (
          <div key={n} style={{ fontSize: 12, color: dark ? '#c2c2ca' : '#444', padding: '4px 0' }}>
            · {n}
          </div>
        ))}
      {tagged.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
          }}
        >
          <span style={{ fontSize: 12, color: dark ? '#c2c2ca' : '#444', flex: 1 }}>· {c.name}</span>
          <button
            type="button"
            onClick={() => untag(c.id)}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: dark ? '#787882' : '#999',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 12,
              padding: '0 4px',
              lineHeight: 1,
            }}
            title="Remove this character from the arc"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#c33')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#999')}
          >
            ✕
          </button>
        </div>
      ))}
      {adding ? (
        <EntityPicker
          accentColor={arcColor}
          options={untagged.map((c) => ({
            id: c.id,
            label: c.working_name ?? c.id,
          }))}
          placeholder="Search characters…"
          emptyMessage="All project characters are already tagged."
          disabled={busy}
          onPick={(id) => tag(id)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || untagged.length === 0}
          style={{
            ...miniActionBtn,
            color: arcColor,
            paddingLeft: 0,
            marginTop: 6,
            opacity: untagged.length === 0 ? 0.4 : 1,
            cursor: untagged.length === 0 ? 'default' : 'pointer',
          }}
          title={
            untagged.length === 0
              ? 'All project characters are already involved'
              : 'Tag a character as involved in this arc'
          }
        >
          + add character
        </button>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c33', lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// D'-7 — Event-side "Arcs this evokes" editor for EventSheet.
//
// Symmetric counterpart to ArcEvokesEditor. The event's own narrative_status
// gates which transitions are allowed for every arc tagged from this side
// (Q7 rule applied to all rows uniformly here, since the event is the
// constant).
// =====================================================================

export type EventEvokesRowData = {
  arc_id: string;
  arc_name: string;
  arc_kind?: ArcKind | string;
  transition: EvokesTransition | '';
  state_at_event: string;
  evidence_quote: string;
};

// =====================================================================
// EventThroughlineEditor — editable PRECEDES surface for EventSheet.
//
// Two stacked lists:
//   - Preceded by   (events that PRECEDES → focal)
//   - Precedes      (events that focal PRECEDES → them)
//
// Each list reuses EntityPicker (D'-7 pattern) for the "+ add" affordance.
// Self-loops are excluded from the picker options. Optimism is
// server-roundtrip — call API, refetch via onChanged.
// =====================================================================

// Seamless inline text edit (Linear-style, no visible textarea chrome). The
// read display and the editor share identical typography; the editor is a
// borderless, transparent, auto-growing textarea, so clicking the text just
// makes the words editable in place — no box pops up. Saves on blur / ⌘+Enter,
// Esc cancels. `style` lets a caller match the surrounding text exactly.
export function InlineText({
  value,
  onSave,
  placeholder,
  multiline = true,
  style,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  style?: React.CSSProperties;
}) {
  const dark = useThemeMode() === 'dark';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const autosize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autosize();
    });
  }, [editing]);

  const cancel = () => { setEditing(false); setDraft(value); };
  const commit = async () => {
    if (draft === value) { cancel(); return; }
    setBusy(true);
    try { await onSave(draft); setEditing(false); }
    catch { setDraft(value); setEditing(false); }
    finally { setBusy(false); }
  };

  const sharedText: React.CSSProperties = {
    fontSize: 13, lineHeight: 1.55, color: dark ? '#dcdce2' : '#333',
    fontFamily: 'system-ui, sans-serif', ...style,
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={draft}
        disabled={busy}
        rows={1}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { setDraft(e.target.value); autosize(); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          else if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
        style={{
          ...sharedText,
          display: 'block', width: '100%', boxSizing: 'border-box',
          border: 'none', outline: 'none', background: 'transparent',
          padding: 0, margin: 0, resize: 'none', overflow: 'hidden',
        }}
      />
    );
  }

  const isEmpty = !value;
  return (
    <div
      className="bento-no-drag"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit"
      style={{
        ...sharedText,
        cursor: 'text',
        whiteSpace: 'pre-wrap',
        color: isEmpty ? '#bbb' : (sharedText.color as string),
        minHeight: '1.2em',
      }}
    >
      {isEmpty ? (placeholder ?? 'Click to add…') : value}
    </div>
  );
}

// --- Direct chip click-to-edit for edge tiles (card-surface rework) ---
// Linear-style inline editing: existing links render as pills with a hover-✕ to
// remove; a "+ add" pill expands into an in-flow typeahead (no modal, no popup).
// Generic over any edge whose endpoints can be named — caller supplies items,
// candidates, and the add/remove ops. The list renders in-flow so the bento
// tile auto-grows while adding instead of clipping a floating dropdown.
export type ChipItem = { id: string; label: string };

export type ChipCandidate = { id: string; label: string; sublabel?: string };

export function EdgeChips({
  items,
  candidates,
  accent,
  addLabel,
  emptyHint,
  onAdd,
  onRemove,
}: {
  items: ChipItem[];
  candidates: ChipCandidate[];
  accent: string;
  addLabel: string;
  emptyHint?: string;
  onAdd: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const dark = useThemeMode() === 'dark';
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) requestAnimationFrame(() => inputRef.current?.focus());
  }, [adding]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return candidates.filter((c) => !n || c.label.toLowerCase().includes(n)).slice(0, 40);
  }, [q, candidates]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.warn('[edge-chips] op failed:', e);
    } finally {
      setBusy(false);
    }
  };
  const doAdd = (id: string) => run(async () => { await onAdd(id); setQ(''); setAdding(false); });
  const doRemove = (id: string) => run(() => onRemove(id));

  return (
    <div className="bento-no-drag" onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {items.map((it) => (
          <span
            key={it.id}
            onMouseEnter={() => setHover(it.id)}
            onMouseLeave={() => setHover((h) => (h === it.id ? null : h))}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, padding: '3px 8px', borderRadius: 12,
              background: hexToRgba(accent, 0.12), color: dark ? '#dcdce2' : '#333',
            }}
          >
            {it.label}
            <button
              type="button"
              onClick={() => doRemove(it.id)}
              disabled={busy}
              title="Remove"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: hover === it.id ? '#dc2626' : hexToRgba(accent, 0.55),
                fontSize: 13, lineHeight: 1, padding: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={busy}
            style={{
              fontSize: 12, padding: '3px 8px', borderRadius: 12,
              border: `1px dashed ${hexToRgba(accent, 0.5)}`, background: 'transparent',
              color: accent, cursor: 'pointer',
            }}
          >
            + {addLabel}
          </button>
        )}
        {items.length === 0 && !adding && emptyHint && (
          <span style={{ color: dark ? '#63636d' : '#bbb', fontSize: 12 }}>{emptyHint}</span>
        )}
      </div>
      {adding && (
        <div style={{ marginTop: 6 }}>
          <input
            ref={inputRef}
            value={q}
            placeholder={`Search to ${addLabel}…`}
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setQ(''); }
              else if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); doAdd(filtered[0].id); }
            }}
            // Delay close so a result's onMouseDown lands first.
            onBlur={() => setTimeout(() => setAdding(false), 120)}
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 7px',
              border: dark ? '1px solid #2e2e35' : '1px solid #ddd', borderRadius: 4, outline: 'none',
              fontFamily: 'system-ui, sans-serif',
            }}
          />
          <div className="cb-scroll" style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
            {candidates.length === 0 ? (
              <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', padding: '4px 2px' }}>Nothing to add.</div>
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', padding: '4px 2px' }}>No match.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); doAdd(c.id); }}
                  disabled={busy}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '5px 7px', fontSize: 12, color: dark ? '#e6e6ea' : '#222',
                    background: 'transparent', border: 'none', borderRadius: 3, cursor: 'pointer',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(accent, 0.08))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {c.label}
                  {c.sublabel && <span style={{ color: dark ? '#787882' : '#999' }}> · {c.sublabel}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Editable "Established here" tile (Information facts). Each fact edits in
// place via InlineText; hover-✕ unlinks it from this scene; a trailing empty
// line creates a new fact. Full-inline — no boxes, no modal.
export function EstablishedHereEditor({
  eventId,
  projectId,
  auth,
  facts,
  accent,
  onChanged,
}: {
  eventId: string;
  projectId: string;
  auth: { userId: string; token: string };
  // `willDelete`: removing this fact from this scene would delete it entirely
  // (it's established nowhere else and no character knows it).
  facts: Array<{ id: string; summary: string; willDelete: boolean }>;
  accent: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [hover, setHover] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const remove = (id: string) =>
    unlinkInformation({ projectId, infoId: id, eventId }, auth.token)
      .then(() => { setConfirmId(null); onChanged(); })
      .catch((e) => console.warn('[established] unlink failed:', e));
  const onRemoveClick = (f: { id: string; willDelete: boolean }) => {
    if (f.willDelete) setConfirmId(f.id);
    else remove(f.id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {facts.map((f) => (
        <div key={f.id}>
          <div
            onMouseEnter={() => setHover(f.id)}
            onMouseLeave={() => setHover((h) => (h === f.id ? null : h))}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}
          >
            <span style={{ color: accent, marginTop: 1, fontSize: 12 }}>•</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <InlineText
                value={f.summary}
                style={{ fontSize: 12, lineHeight: 1.4 }}
                onSave={(d) =>
                  updateInformation({ projectId, infoId: f.id, summary: d }, auth.token).then(() => onChanged())
                }
              />
            </div>
            <button
              type="button"
              className="bento-no-drag"
              title="Remove from this scene"
              onClick={() => onRemoveClick(f)}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: hover === f.id ? '#dc2626' : '#cbd5e1',
                fontSize: 13, lineHeight: 1, padding: 0, marginTop: 1,
              }}
            >
              ×
            </button>
          </div>
          {confirmId === f.id && (
            <div
              className="bento-no-drag"
              style={{
                margin: '4px 0 2px 18px', padding: '7px 9px',
                background: dark ? '#2a1719' : '#fef2f2', border: dark ? '1px solid #4a2326' : '1px solid #fecaca', borderRadius: 5,
                fontSize: 11, color: dark ? '#f4a8a8' : '#7f1d1d', lineHeight: 1.45,
              }}
            >
              This fact isn't anywhere else and no one in the story knows it, so
              removing it here will delete it for good.
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  style={{ ...miniActionBtn, color: '#fff', background: '#dc2626', border: 'none' }}
                >
                  Delete it
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  style={{ ...miniActionBtn, color: dark ? '#9a9aa4' : '#666' }}
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ color: '#cbd5e1', marginTop: 1, fontSize: 12 }}>+</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineText
            value=""
            placeholder="add a fact…"
            style={{ fontSize: 12, lineHeight: 1.4 }}
            onSave={(d) =>
              createInformation({ projectId, eventId, summary: d }, auth.token).then(() => onChanged())
            }
          />
        </div>
      </div>
    </div>
  );
}

// Editable Knowledge tile — the dramatic-irony surface. Per fact, three state
// buckets (KNOWS / SUSPECTS / IN THE DARK), each an EdgeChips of knowers.
// Adding a knower to a bucket auto-moves them out of any other (set-knowledge
// drops the prior edge first). ✕ clears their knowledge of that fact.
export function KnowledgeEditor({
  eventId,
  facts,
  factCandidates,
  knowledgeByInfo,
  knowerCandidates,
  resolveName,
  projectId,
  auth,
  onChanged,
}: {
  eventId: string;
  facts: Array<{ id: string; summary: string }>;
  // Facts not currently shown here — addable to this scene. `hidden` flags a
  // flat fact; picking it clears the flag (the un-hide path).
  factCandidates: Array<{ id: string; summary: string; hidden?: boolean }>;
  knowledgeByInfo: Map<string, Array<{ knower_id: string; state: string }>>;
  knowerCandidates: Array<{ id: string; label: string }>;
  resolveName: (id: string) => string;
  projectId: string;
  auth: { userId: string; token: string };
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const BUCKETS: Array<{ state: 'knows' | 'suspects' | 'doesnt_know'; label: string; color: string; match: (s: string) => boolean }> = [
    { state: 'knows', label: 'KNOWS', color: '#059669', match: (s) => s === 'knows' },
    { state: 'suspects', label: 'SUSPECTS', color: '#d97706', match: (s) => s === 'suspects' },
    { state: 'doesnt_know', label: 'IN THE DARK', color: '#dc2626', match: (s) => s !== 'knows' && s !== 'suspects' },
  ];
  const set = (knowerId: string, infoId: string, state: 'knows' | 'suspects' | 'doesnt_know' | 'none') =>
    setKnowledge({ projectId, knowerId, infoId, state, eventId }, auth.token).then(() => onChanged());
  const setIrony = (infoId: string, hidden: boolean) =>
    setInformationIrony({ projectId, infoId, hidden }, auth.token)
      .then(() => onChanged())
      .catch((e) => console.warn('[knowledge] set-irony failed:', e));

  // Facts the writer has pulled in from elsewhere this session. They render with
  // empty buckets and persist as soon as a state is set (the at_event edge);
  // once persisted they arrive via `facts` on the next refetch.
  const [added, setAdded] = useState<Array<{ id: string; summary: string }>>([]);
  const [addingFact, setAddingFact] = useState(false);
  const [q, setQ] = useState('');
  const factInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (addingFact) requestAnimationFrame(() => factInputRef.current?.focus());
  }, [addingFact]);

  const shownIds = new Set(facts.map((f) => f.id));
  const renderedFacts = [...facts, ...added.filter((a) => !shownIds.has(a.id))];
  const renderedIds = new Set(renderedFacts.map((f) => f.id));
  const factPickList = useMemo(() => {
    const n = q.trim().toLowerCase();
    return factCandidates
      .filter((c) => !renderedIds.has(c.id) && (!n || c.summary.toLowerCase().includes(n)))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, factCandidates, added, facts]);
  const addFact = (c: { id: string; summary: string; hidden?: boolean }) => {
    if (c.hidden) setIrony(c.id, false); // picking a flat fact un-hides it
    setAdded((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, { id: c.id, summary: c.summary }]));
    setQ('');
    setAddingFact(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {renderedFacts.map((f, fi) => {
        const ks = knowledgeByInfo.get(f.id) ?? [];
        return (
          <div
            key={f.id}
            style={{
              paddingBottom: fi < renderedFacts.length - 1 ? 10 : 0,
              borderBottom: fi < renderedFacts.length - 1 ? '1px solid #f1f5f9' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1a1a1a', lineHeight: 1.4 }}>{f.summary}</div>
              <button
                type="button"
                className="bento-no-drag"
                title="Flat fact — hide from this tile (keeps all data)"
                onClick={() => setIrony(f.id, true)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: '#cbd5e1', fontSize: 10, letterSpacing: 0.3, padding: 0,
                  whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#64748b')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#cbd5e1')}
              >
                hide
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {BUCKETS.map((b) => {
                const inBucket = new Set(ks.filter((k) => b.match(k.state)).map((k) => k.knower_id));
                return (
                  <div key={b.state} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: b.color, minWidth: 74, marginTop: 5, flexShrink: 0 }}>
                      {b.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <EdgeChips
                        accent={b.color}
                        addLabel="who"
                        emptyHint="—"
                        items={[...inBucket].map((id) => ({ id, label: resolveName(id) }))}
                        candidates={knowerCandidates.filter((c) => !inBucket.has(c.id))}
                        onAdd={(id) => set(id, f.id, b.state)}
                        onRemove={(id) => set(id, f.id, 'none')}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Pull in an existing fact established elsewhere, to track who knows it here. */}
      <div className="bento-no-drag" onMouseDown={(e) => e.stopPropagation()}>
        {renderedFacts.length === 0 && !addingFact && (
          <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12, marginBottom: 6 }}>
            No facts here yet — add one in “Established here”, or pull in an existing one below.
          </div>
        )}
        {!addingFact ? (
          <button
            type="button"
            onClick={() => setAddingFact(true)}
            disabled={factCandidates.length === 0}
            style={{
              fontSize: 12, padding: '3px 8px', borderRadius: 12,
              border: '1px dashed #94a3b8', background: 'transparent',
              color: factCandidates.length === 0 ? '#cbd5e1' : '#64748b',
              cursor: factCandidates.length === 0 ? 'default' : 'pointer',
            }}
          >
            + add information
          </button>
        ) : (
          <div>
            <input
              ref={factInputRef}
              value={q}
              placeholder="Search existing facts…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') { e.preventDefault(); setAddingFact(false); setQ(''); }
                else if (e.key === 'Enter' && factPickList.length > 0) { e.preventDefault(); addFact(factPickList[0]); }
              }}
              onBlur={() => setTimeout(() => setAddingFact(false), 120)}
              style={{
                width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 7px',
                border: dark ? '1px solid #2e2e35' : '1px solid #ddd', borderRadius: 4, outline: 'none', fontFamily: 'system-ui, sans-serif',
              }}
            />
            <div className="cb-scroll" style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
              {factPickList.length === 0 ? (
                <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', padding: '4px 2px' }}>No match.</div>
              ) : (
                factPickList.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addFact(c); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '5px 7px', fontSize: 12, color: dark ? '#e6e6ea' : '#222',
                      background: 'transparent', border: 'none', borderRadius: 3, cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif', lineHeight: 1.4,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {c.summary}
                    {c.hidden && <span style={{ color: '#94a3b8' }}> · flat</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function EventThroughlineEditor({
  focal,
  allEntities,
  edges,
  auth,
  projectId,
  accentColor,
  onOpenCard,
  onChanged,
}: {
  focal: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  accentColor: string;
  onOpenCard: (cardId: string) => void;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const eventsById = useMemo(() => {
    const m = new Map<string, ProjectEntity>();
    for (const e of allEntities) {
      if (e.type === 'event' && !e.deleted_at) m.set(e.id, e);
    }
    return m;
  }, [allEntities]);

  const precededBy = useMemo(() => {
    const out: ProjectEntity[] = [];
    for (const p of edges.precedes ?? []) {
      if (p.to !== focal.id) continue;
      const e = eventsById.get(p.from);
      if (e) out.push(e);
    }
    return out;
  }, [edges.precedes, eventsById, focal.id]);

  const precedes = useMemo(() => {
    const out: ProjectEntity[] = [];
    for (const p of edges.precedes ?? []) {
      if (p.from !== focal.id) continue;
      const e = eventsById.get(p.to);
      if (e) out.push(e);
    }
    return out;
  }, [edges.precedes, eventsById, focal.id]);

  const taggedIds = useMemo(() => {
    const s = new Set<string>([focal.id]);
    for (const e of precededBy) s.add(e.id);
    for (const e of precedes) s.add(e.id);
    return s;
  }, [precededBy, precedes, focal.id]);

  const candidates = useMemo(
    () =>
      [...eventsById.values()]
        .filter((e) => !taggedIds.has(e.id))
        .sort((a, b) =>
          (a.working_title ?? a.working_name ?? a.id).localeCompare(
            b.working_title ?? b.working_name ?? b.id,
          ),
        ),
    [eventsById, taggedIds],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<'preceded_by' | 'precedes' | null>(null);

  const runOp = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const tagBefore = (pickedId: string) =>
    runOp(async () => {
      await tagEventPrecedes(
        { fromEventId: pickedId, toEventId: focal.id, projectId },
        auth.token,
      );
      setAdding(null);
    });

  const tagAfter = (pickedId: string) =>
    runOp(async () => {
      await tagEventPrecedes(
        { fromEventId: focal.id, toEventId: pickedId, projectId },
        auth.token,
      );
      setAdding(null);
    });

  const untagBefore = (otherId: string) =>
    runOp(() =>
      untagEventPrecedes(
        { fromEventId: otherId, toEventId: focal.id, projectId },
        auth.token,
      ),
    );

  const untagAfter = (otherId: string) =>
    runOp(() =>
      untagEventPrecedes(
        { fromEventId: focal.id, toEventId: otherId, projectId },
        auth.token,
      ),
    );

  const renderRow = (
    e: ProjectEntity,
    onUntag: () => void,
    direction: 'before' | 'after',
  ) => (
    <div
      key={e.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 0',
      }}
    >
      <span style={{ color: dark ? '#63636d' : '#bbb', fontSize: 11, minWidth: 14 }}>
        {direction === 'before' ? '←' : '→'}
      </span>
      <button
        type="button"
        onClick={() => onOpenCard(e.id)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 12,
          color: dark ? '#dcdce2' : '#333',
          cursor: 'pointer',
          textAlign: 'left',
          flex: 1,
          minWidth: 0,
          fontFamily: 'system-ui, sans-serif',
        }}
        onMouseEnter={(ev) => (ev.currentTarget.style.color = accentColor)}
        onMouseLeave={(ev) => (ev.currentTarget.style.color = '#333')}
        title="Open this event"
      >
        {e.working_title ?? e.working_name ?? e.id}
      </button>
      <button
        type="button"
        onClick={onUntag}
        disabled={busy}
        style={{
          background: 'transparent',
          border: 'none',
          color: dark ? '#787882' : '#999',
          cursor: busy ? 'default' : 'pointer',
          fontSize: 12,
          padding: '0 4px',
          lineHeight: 1,
        }}
        title="Drop this PRECEDES edge"
        onMouseEnter={(ev) => (ev.currentTarget.style.color = '#c33')}
        onMouseLeave={(ev) => (ev.currentTarget.style.color = '#999')}
      >
        ✕
      </button>
    </div>
  );

  const pickerOptions = candidates.map((e) => ({
    id: e.id,
    label: e.working_title ?? e.working_name ?? e.id,
    sublabel:
      e.narrative_status && e.narrative_status !== 'on_screen'
        ? narrativeStatusLabel(e.narrative_status)
        : undefined,
  }));

  return (
    <div>
      {/* Preceded by */}
      {precededBy.length === 0 && adding !== 'preceded_by' ? (
        <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', marginBottom: 4 }}>
          Nothing precedes this event yet.
        </div>
      ) : (
        precededBy.map((e) => renderRow(e, () => untagBefore(e.id), 'before'))
      )}
      {adding === 'preceded_by' ? (
        <EntityPicker
          accentColor={accentColor}
          options={pickerOptions}
          placeholder="Search events that precede…"
          emptyMessage="No other events available."
          disabled={busy}
          onPick={(id) => tagBefore(id)}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding('preceded_by')}
          disabled={busy || candidates.length === 0}
          style={{
            ...miniActionBtn,
            color: accentColor,
            paddingLeft: 0,
            marginTop: 2,
            marginBottom: 8,
            opacity: candidates.length === 0 ? 0.4 : 1,
            cursor: candidates.length === 0 ? 'default' : 'pointer',
          }}
        >
          + add predecessor
        </button>
      )}

      {/* Focal */}
      <div style={{ fontSize: 12, color: accentColor, fontWeight: 500, padding: '4px 0' }}>
        ● {focal.working_title ?? focal.working_name ?? focal.id}
      </div>

      {/* Precedes */}
      {precedes.length === 0 && adding !== 'precedes' ? (
        <div style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', marginTop: 4 }}>
          Nothing follows this event yet.
        </div>
      ) : (
        precedes.map((e) => renderRow(e, () => untagAfter(e.id), 'after'))
      )}
      {adding === 'precedes' ? (
        <EntityPicker
          accentColor={accentColor}
          options={pickerOptions}
          placeholder="Search events that follow…"
          emptyMessage="No other events available."
          disabled={busy}
          onPick={(id) => tagAfter(id)}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding('precedes')}
          disabled={busy || candidates.length === 0}
          style={{
            ...miniActionBtn,
            color: accentColor,
            paddingLeft: 0,
            marginTop: 2,
            opacity: candidates.length === 0 ? 0.4 : 1,
            cursor: candidates.length === 0 ? 'default' : 'pointer',
          }}
        >
          + add successor
        </button>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c33', lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function EventEvokesEditor({
  eventId,
  eventNarrativeStatus,
  arcsEvoked,
  allEntities,
  auth,
  projectId,
  onOpenCard,
  onChanged,
}: {
  eventId: string;
  eventNarrativeStatus: string;
  arcsEvoked: EventEvokesRowData[];
  allEntities: ProjectEntity[];
  auth: { userId: string; token: string };
  projectId: string;
  onOpenCard: (cardId: string) => void;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const arcColor = getEntityColor('arc');
  const arcsAvailable = useMemo(
    () => allEntities.filter((e) => e.type === 'arc' && !e.deleted_at),
    [allEntities],
  );
  const taggedIds = useMemo(
    () => new Set(arcsEvoked.map((a) => a.arc_id)),
    [arcsEvoked],
  );
  const untagged = useMemo(
    () =>
      arcsAvailable
        .filter((a) => !taggedIds.has(a.id))
        .sort((a, b) =>
          (a.working_name ?? a.id).localeCompare(b.working_name ?? b.id),
        ),
    [arcsAvailable, taggedIds],
  );

  const allowedTransitions =
    EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS[eventNarrativeStatus] ?? EVOKES_TRANSITIONS;
  const allowedSet = useMemo(() => new Set(allowedTransitions), [allowedTransitions]);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runOp = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const tag = (arcId: string) =>
    runOp(async () => {
      await tagEventEvokes({ eventId, arcId, projectId }, auth.token);
      setAdding(false);
    });

  const untag = (arcId: string) =>
    runOp(() => untagEventEvokes({ eventId, arcId, projectId }, auth.token));

  const updateRow = (
    arcId: string,
    fields: { stateAtEvent?: string; transition?: EvokesTransition | '' },
  ) =>
    runOp(() =>
      tagEventEvokes(
        {
          eventId,
          arcId,
          projectId,
          stateAtEvent: fields.stateAtEvent,
          transition: fields.transition,
        },
        auth.token,
      ),
    );

  return (
    <div>
      {arcsEvoked.length === 0 && !adding && (
        <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', marginTop: 0 }}>
          This event doesn't evoke any arcs yet.
        </p>
      )}
      {arcsEvoked.map((row) => (
        <div
          key={row.arc_id}
          style={{
            padding: '8px 10px',
            marginBottom: 8,
            border: dark ? '1px solid #2a2a30' : '1px solid #eee',
            borderLeft: `3px solid ${hexToRgba(arcColor, 0.4)}`,
            borderRadius: 4,
            background: dark ? '#1a1a1e' : '#fff',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 6,
            }}
          >
            <button
              type="button"
              onClick={() => onOpenCard(row.arc_id)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                fontSize: 12,
                fontWeight: 500,
                color: dark ? '#e6e6ea' : '#222',
                cursor: 'pointer',
                textAlign: 'left',
                flex: 1,
                minWidth: 0,
                fontFamily: 'system-ui, sans-serif',
              }}
              title="Open arc sheet"
              onMouseEnter={(e) => (e.currentTarget.style.color = arcColor)}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#222')}
            >
              {row.arc_name}
            </button>
            {row.arc_kind && (
              <span
                style={{
                  fontSize: 9,
                  padding: '2px 5px',
                  background: hexToRgba(arcColor, 0.14),
                  color: arcColor,
                  borderRadius: 2,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  fontWeight: 600,
                }}
              >
                {arcKindLabel(row.arc_kind as ArcKind)}
              </span>
            )}
            <button
              type="button"
              onClick={() => untag(row.arc_id)}
              disabled={busy}
              style={{
                background: 'transparent',
                border: 'none',
                color: dark ? '#787882' : '#999',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 13,
                padding: '0 4px',
                lineHeight: 1,
              }}
              title="Untag — this event no longer evokes this arc"
              onMouseEnter={(e) => (e.currentTarget.style.color = '#c33')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#999')}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <select
              value={row.transition || ''}
              disabled={busy}
              onChange={(e) =>
                updateRow(row.arc_id, {
                  transition: (e.target.value || '') as EvokesTransition | '',
                })
              }
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 10,
                padding: '2px 4px',
                border: `1px solid ${hexToRgba(arcColor, 0.3)}`,
                borderRadius: 3,
                background: row.transition ? hexToRgba(arcColor, dark ? 0.14 : 0.08) : dark ? '#1d1d22' : '#fff',
                color: row.transition ? arcColor : dark ? '#9a9aa4' : '#666',
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
                fontFamily: 'system-ui, sans-serif',
              }}
              title={
                eventNarrativeStatus === 'backstory'
                  ? 'Backstory events permit only "touches" (Q7 rule)'
                  : 'EVOKES transition'
              }
            >
              <option value="">— transition —</option>
              {EVOKES_TRANSITIONS.map((t) => (
                <option key={t} value={t} disabled={!allowedSet.has(t)}>
                  {transitionLabel(t)}
                  {!allowedSet.has(t) ? ' (backstory)' : ''}
                </option>
              ))}
            </select>
          </div>
          <InlineStateAtEvent
            value={row.state_at_event}
            disabled={busy}
            accentColor={arcColor}
            onSave={(next) => updateRow(row.arc_id, { stateAtEvent: next })}
          />
        </div>
      ))}
      {adding ? (
        <EntityPicker
          accentColor={arcColor}
          options={untagged.map((a) => ({
            id: a.id,
            label: a.working_name ?? a.id,
            sublabel: a.kind ? arcKindLabel(a.kind as ArcKind) : undefined,
          }))}
          placeholder="Search arcs…"
          emptyMessage="No arcs in this project yet."
          disabled={busy}
          onPick={(id) => tag(id)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={busy || untagged.length === 0}
          style={{
            ...miniActionBtn,
            color: arcColor,
            paddingLeft: 0,
            marginTop: 6,
            opacity: untagged.length === 0 ? 0.4 : 1,
            cursor: untagged.length === 0 ? 'default' : 'pointer',
          }}
          title={
            untagged.length === 0
              ? 'This event already evokes every arc in the project'
              : 'Tag this event with an arc'
          }
        >
          + tag arc
        </button>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c33', lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
