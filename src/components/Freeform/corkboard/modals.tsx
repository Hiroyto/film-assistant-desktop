// components/Freeform/corkboard/modals.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useRef } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { ARC_KINDS, clearProject, createArc, createArcFromEvents, createCard, type ArcKind, type CreateCardKind, type EvokesTransition, type SupersessionRequiredResponse } from '../../../lib/freeformApi';
import { DeleteCardLink } from './cards';
import { arcKindLabel, narrativeStatusBg, narrativeStatusFg, narrativeStatusLabel, transitionLabel } from './labels';
import { SearchSelect } from './selects';
import { liftColor, useThemeMode } from './theme';

/** D'-5 — superset of CreateCardKind including 'arc' for the modal flow.
 *  Backend dispatches via createCard (Character/Event/Location) or createArc.
 *  Kept FE-local since the backend's CreateCardKind stays narrowly typed. */
export type CreateModalKind = CreateCardKind | 'arc';

// =====================================================================
// ResetProjectButton — wipes Neptune + Dynamo state for a demo_ projectId.
// Two-click confirm pattern matching DeleteCardLink. Only renders on
// projectIds starting with `demo_` (server-side enforces the same gate so
// non-demo IDs would reject with 403 anyway).
// =====================================================================

export function ResetProjectButton({
  projectId,
  token,
  onCleared,
}: {
  projectId: string;
  token: string;
  onCleared: () => void | Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onClick = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(false);
    setBusy(true);
    try {
      await clearProject({ projectId }, token);
      await onCleared();
    } catch (err) {
      console.warn('[corkboard] clear-project failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background: armed ? '#fff4f4' : 'transparent',
        border: `1px solid ${armed ? '#c44' : '#ddd'}`,
        borderRadius: 3,
        padding: '2px 8px',
        fontSize: 11,
        color: busy ? '#bbb' : armed ? '#c44' : '#666',
        cursor: busy ? 'wait' : 'pointer',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: armed ? 600 : 400,
      }}
      title={
        busy
          ? 'Resetting…'
          : armed
          ? `Click again to wipe ${projectId} entirely (Neptune + Dynamo)`
          : `Reset ${projectId} — wipes all cards / arcs / responses for a fresh demo`
      }
    >
      {busy ? 'resetting…' : armed ? '⚠ click again to wipe' : '↺ reset'}
    </button>
  );
}

// =====================================================================
// CreateCardModal — minimal form for manual Character/Event/Location creation.
// working_name (required) + description (optional). On slug collision the form
// flips to an "already exists — open it?" CTA that focuses the existing card.
// =====================================================================

// =====================================================================
// CreateArcFromEventsModal (D'-8 / D'-4 bottom-up) — writer multi-selects
// events on canvas, this modal collects arc identity. Submit dispatches
// to createArcFromEvents which atomically writes the Arc vertex + N
// EVOKES edges. Backstory events default to transition='touches' server-
// side (Q7 rule); on_screen / offstage events start with unset transition.
// =====================================================================

// =====================================================================
// SupersessionModal (D'-10) — surfaces when the writer tries to flip an
// event to backstory but the event carries EVOKES edges with high-leverage
// transitions. Each violation gets its own row with two radios:
//   - demote  → keep the EVOKES edge, downgrade transition to 'touches'
//   - remove  → drop the EVOKES edge
// Writer commits with "Apply" (default 'demote' if untouched) or cancels.
// =====================================================================

export function SupersessionModal({
  payload,
  eventTitle,
  onCancel,
  onResolve,
}: {
  payload: SupersessionRequiredResponse;
  eventTitle: string;
  onCancel: () => void;
  onResolve: (
    resolutions: Array<{ arcId: string; action: 'demote' | 'remove' }>,
  ) => Promise<void>;
}) {
  const dark = useThemeMode() === 'dark';
  const [actions, setActions] = useState<Record<string, 'demote' | 'remove'>>(
    () => Object.fromEntries(payload.violations.map((v) => [v.arcId, 'demote'])),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const arcColor = getEntityColor('arc');
  const eventColor = getEntityColor('event');

  const submit = async () => {
    setSubmitting(true);
    try {
      await onResolve(
        payload.violations.map((v) => ({
          arcId: v.arcId,
          action: actions[v.arcId] ?? 'demote',
        })),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(20, 20, 20, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        className="cb-scroll"
        style={{
          width: 540,
          maxWidth: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: dark ? '#1a1a1e' : '#fff',
          borderRadius: 6,
          boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
          padding: 22,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: eventColor,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Flag for review
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: dark ? '#e6e6ea' : '#222', lineHeight: 1.35, marginBottom: 8 }}>
            Demoting <em>{eventTitle}</em> to backstory
          </div>
          <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.55 }}>
            Backstory events only carry <code style={{ background: dark ? '#202025' : '#f3f3f3', padding: '0 4px', borderRadius: 2 }}>touches</code> on the arcs they evoke — audience-side movement (develops, resolves, etc.) requires the event to be on-screen or offstage. This event currently moves {payload.violations.length} arc{payload.violations.length === 1 ? '' : 's'} in ways the demotion would invalidate. Pick a resolution per arc:
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          {payload.violations.map((v) => (
            <div
              key={v.arcId}
              style={{
                marginBottom: 12,
                padding: '12px 14px',
                border: `1px solid ${hexToRgba(arcColor, 0.3)}`,
                borderLeft: `4px solid ${arcColor}`,
                borderRadius: 4,
                background: dark ? '#101013' : '#fafafa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#e6e6ea' : '#222', flex: 1, minWidth: 0 }}>
                  {v.arcName}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    background: hexToRgba(arcColor, 0.14),
                    color: arcColor,
                    borderRadius: 2,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    fontWeight: 600,
                  }}
                  title="Current high-leverage transition that would violate Q7"
                >
                  currently · {transitionLabel(v.transition as EvokesTransition)}
                </span>
              </div>
              {v.stateAtEvent && (
                <div
                  style={{
                    fontSize: 11,
                    color: dark ? '#9a9aa4' : '#666',
                    fontStyle: 'italic',
                    lineHeight: 1.45,
                    marginBottom: 8,
                  }}
                >
                  "{v.stateAtEvent}"
                </div>
              )}
              <div style={{ display: 'flex', gap: 14 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: dark ? '#c2c2ca' : '#444', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`r-${v.arcId}`}
                    checked={(actions[v.arcId] ?? 'demote') === 'demote'}
                    onChange={() => setActions((a) => ({ ...a, [v.arcId]: 'demote' }))}
                  />
                  Demote to <code style={{ background: dark ? '#1a1a1e' : '#fff', padding: '0 4px', borderRadius: 2 }}>touches</code>
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: dark ? '#c2c2ca' : '#444', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`r-${v.arcId}`}
                    checked={actions[v.arcId] === 'remove'}
                    onChange={() => setActions((a) => ({ ...a, [v.arcId]: 'remove' }))}
                  />
                  Remove EVOKES
                </label>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
              background: dark ? '#1a1a1e' : '#fff',
              borderRadius: 4,
              color: dark ? '#b2b2bc' : '#555',
              cursor: 'pointer',
            }}
          >
            Keep status as-is
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 500,
              border: 'none',
              background: eventColor,
              borderRadius: 4,
              color: '#fff',
              cursor: submitting ? 'wait' : 'pointer',
            }}
            title="Commit the demotion + apply the resolutions above atomically"
          >
            {submitting ? 'Applying…' : 'Apply demotion'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreateArcFromEventsModal({
  arcKind,
  setArcKind,
  name,
  setName,
  description,
  setDescription,
  eventLabels,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  arcKind: ArcKind;
  setArcKind: (k: ArcKind) => void;
  name: string;
  setName: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
  eventLabels: Array<{ id: string; label: string; narrativeStatus?: string }>;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && name.trim().length > 0) onSubmit();
    }
  };
  const color = getEntityColor('arc');

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(20, 20, 20, 0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onKeyDown={onKeyDown}
        className="cb-scroll"
        style={{
          width: 400,
          background: dark ? '#1a1a1e' : '#fff',
          borderRadius: 6,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
          padding: 18,
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: dark ? '#e6e6ea' : '#222',
            marginBottom: 14,
          }}
        >
          New Arc from {eventLabels.length} event{eventLabels.length === 1 ? '' : 's'}
        </div>

        <label style={{ fontSize: 11, color: dark ? '#82828c' : '#888', display: 'block', marginBottom: 4 }}>
          Kind
        </label>
        <select
          value={arcKind}
          onChange={(e) => setArcKind(e.target.value as ArcKind)}
          disabled={submitting}
          style={{
            width: '100%',
            padding: '7px 9px',
            fontSize: 13,
            border: dark ? '1px solid #2a2a30' : '1px solid #e0e0e0',
            borderRadius: 4,
            outline: 'none',
            marginBottom: 12,
            boxSizing: 'border-box',
            fontFamily: 'system-ui, sans-serif',
            background: dark ? '#1a1a1e' : '#fff',
          }}
        >
          {ARC_KINDS.map((k) => (
            <option key={k} value={k}>
              {arcKindLabel(k)}
            </option>
          ))}
        </select>

        <label style={{ fontSize: 11, color: dark ? '#82828c' : '#888', display: 'block', marginBottom: 4 }}>
          Name
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          placeholder="e.g. The click subplot"
          style={{
            width: '100%',
            padding: '7px 9px',
            fontSize: 13,
            border: dark ? '1px solid #2a2a30' : '1px solid #e0e0e0',
            borderRadius: 4,
            outline: 'none',
            marginBottom: 12,
            boxSizing: 'border-box',
            fontFamily: 'system-ui, sans-serif',
          }}
        />

        <label style={{ fontSize: 11, color: dark ? '#82828c' : '#888', display: 'block', marginBottom: 4 }}>
          Description <span style={{ color: dark ? '#63636d' : '#bbb' }}>(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          placeholder="What this arc is about across the selected events…"
          rows={3}
          style={{
            width: '100%',
            padding: '7px 9px',
            fontSize: 13,
            border: dark ? '1px solid #2a2a30' : '1px solid #e0e0e0',
            borderRadius: 4,
            outline: 'none',
            resize: 'vertical',
            minHeight: 60,
            marginBottom: 12,
            boxSizing: 'border-box',
            fontFamily: 'system-ui, sans-serif',
            lineHeight: 1.45,
          }}
        />

        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              color: dark ? '#82828c' : '#888',
              marginBottom: 4,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Evokes these events
          </div>
          <div
            className="cb-scroll"
            style={{
              border: dark ? '1px solid #2a2a30' : '1px solid #eee',
              borderRadius: 4,
              padding: '6px 10px',
              maxHeight: 140,
              overflowY: 'auto',
              background: dark ? '#101013' : '#fafafa',
            }}
          >
            {eventLabels.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: dark ? '#c2c2ca' : '#444',
                  padding: '3px 0',
                }}
              >
                <span style={{ color: hexToRgba(color, 1), fontSize: 9 }}>●</span>
                <span style={{ flex: 1, minWidth: 0 }}>{e.label}</span>
                {e.narrativeStatus && e.narrativeStatus !== 'on_screen' && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      background: narrativeStatusBg(e.narrativeStatus),
                      color: narrativeStatusFg(e.narrativeStatus),
                      borderRadius: 2,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      fontWeight: 600,
                    }}
                  >
                    {narrativeStatusLabel(e.narrativeStatus)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: dark ? '#6e6e78' : '#aaa', marginTop: 4 }}>
            Backstory events default to transition='touches' per Q7 rule;
            others start unset and can be edited from the arc sheet.
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 11, color: 'crimson', marginBottom: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
              background: dark ? '#1a1a1e' : '#fff',
              borderRadius: 4,
              color: dark ? '#b2b2bc' : '#555',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || !name.trim()}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              border: 'none',
              background: !name.trim() ? '#ccc' : color,
              borderRadius: 4,
              color: '#fff',
              cursor: !name.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreateCardModal({
  kind,
  arcKind,
  setArcKind,
  name,
  setName,
  description,
  setDescription,
  precededBy,
  setPrecededBy,
  eventOptions,
  submitting,
  error,
  collision,
  onSubmit,
  onOpenCollision,
  onCancel,
}: {
  kind: CreateModalKind;
  arcKind: ArcKind;
  setArcKind: (k: ArcKind) => void;
  name: string;
  setName: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
  /** Event only — vertex id of the "Follows" parent. '' = unconnected. */
  precededBy: string;
  setPrecededBy: (id: string) => void;
  /** All alive events in the project, ordered for display in the Follows select. */
  eventOptions: Array<{ id: string; label: string; narrativeStatus?: string }>;
  submitting: boolean;
  error: string | null;
  collision: { cardId: string; name: string; deleted: boolean } | null;
  onSubmit: () => void;
  onOpenCollision: () => void;
  onCancel: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && name.trim().length > 0) onSubmit();
    }
  };

  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const accent = getEntityColor(kind);

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
    color: dark ? '#9a9aa4' : '#888',
    display: 'block',
    marginBottom: 5,
  };
  const fieldStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 11px',
    fontSize: 13,
    borderRadius: 8,
    outline: 'none',
    marginBottom: 13,
    fontFamily: 'system-ui, sans-serif',
    border: `1px solid ${dark ? '#2c2c33' : '#e0e0e0'}`,
    background: dark ? '#121216' : '#fff',
    color: dark ? '#e6e6ea' : '#1d2230',
    transition: 'border-color 140ms ease, box-shadow 140ms ease',
  };
  const ghostBtn: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    border: `1px solid ${dark ? '#2e2e35' : '#ddd'}`,
    background: 'transparent',
    borderRadius: 8,
    color: dark ? '#b2b2bc' : '#555',
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
  };
  const primaryBtn = (enabled: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    border: 'none',
    borderRadius: 8,
    background: enabled
      ? `linear-gradient(135deg, ${accent} 0%, ${liftColor(accent, 0.18)} 100%)`
      : dark ? '#222227' : '#eceef2',
    color: enabled ? '#fff' : dark ? '#6a6a74' : '#9aa0ad',
    cursor: enabled ? 'pointer' : 'not-allowed',
    boxShadow: enabled ? `0 4px 14px ${hexToRgba(accent, 0.3)}` : 'none',
    fontFamily: 'system-ui, sans-serif',
    transition: 'box-shadow 120ms ease, filter 120ms ease',
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(10, 10, 12, 0.5)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <style>{`
        .cb-cc-field:focus { border-color: ${accent} !important; box-shadow: 0 0 0 3px ${hexToRgba(accent, 0.18)}; }
        .cb-cc-field::placeholder { color: ${dark ? '#5a5a63' : '#aaa'}; }
      `}</style>
      <div
        onKeyDown={onKeyDown}
        style={{
          width: 400,
          background: dark ? '#17171b' : '#fff',
          borderRadius: 14,
          border: `1px solid ${dark ? hexToRgba(accent, 0.3) : hexToRgba(accent, 0.35)}`,
          boxShadow: dark
            ? `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${hexToRgba(accent, 0.12)}, 0 0 40px ${hexToRgba(accent, 0.1)}`
            : `0 18px 48px rgba(0,0,0,0.18), 0 0 28px ${hexToRgba(accent, 0.12)}`,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '15px 20px 13px',
            borderBottom: `2px solid ${dark ? hexToRgba(liftColor(accent, 0.2), 0.55) : accent}`,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: accent, flexShrink: 0, boxShadow: `0 0 8px ${hexToRgba(accent, 0.6)}` }} />
          <span style={{ fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: accent }}>
            New
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: dark ? '#ededf1' : '#1d2230' }}>
            {label}
          </span>
        </div>

        <div style={{ padding: '16px 20px 18px' }}>
        {collision ? (
          <div>
            <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.5, marginBottom: 12 }}>
              {collision.deleted ? (
                <>
                  <strong>{collision.name}</strong> was previously deleted but
                  still exists in this project. Restoring it brings back its
                  description, traits, and edges; anything you wrote in this
                  form will be ignored.
                </>
              ) : (
                <>
                  <strong>{collision.name}</strong> already exists in this project.
                  Open it?
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={ghostBtn}>
                Cancel
              </button>
              <button onClick={onOpenCollision} style={primaryBtn(true)}>
                {collision.deleted ? 'Restore' : 'Open it'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {kind === 'arc' && (
              <>
                <label style={labelStyle}>Kind</label>
                <SearchSelect
                  value={arcKind}
                  onChange={(id) => setArcKind(id as ArcKind)}
                  disabled={submitting}
                  accent={accent}
                  placeholder="Select a kind"
                  options={ARC_KINDS.map((k) => ({ id: k, label: arcKindLabel(k) }))}
                />
              </>
            )}
            <label style={labelStyle}>Name</label>
            <input
              ref={nameRef}
              className="cb-cc-field"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder={
                kind === 'character'
                  ? 'e.g. the Detective'
                  : kind === 'event'
                  ? 'e.g. the confrontation'
                  : kind === 'arc'
                  ? 'e.g. The click subplot'
                  : 'e.g. the apartment'
              }
              style={fieldStyle}
            />

            {kind === 'event' && eventOptions.length > 0 && (
              <>
                <label style={labelStyle}>
                  Follows <span style={{ color: dark ? '#63636d' : '#bbb', fontWeight: 400 }}>(optional)</span>
                </label>
                <SearchSelect
                  value={precededBy}
                  onChange={setPrecededBy}
                  disabled={submitting}
                  accent={accent}
                  placeholder="(unconnected, no predecessor)"
                  searchPlaceholder="Search events…"
                  options={[
                    { id: '', label: '(unconnected, no predecessor)' },
                    ...eventOptions.map((o) => ({
                      id: o.id,
                      label: o.label,
                      sublabel:
                        o.narrativeStatus && o.narrativeStatus !== 'on_screen'
                          ? o.narrativeStatus
                          : undefined,
                    })),
                  ]}
                />
              </>
            )}

            <label style={labelStyle}>
              Description <span style={{ color: dark ? '#63636d' : '#bbb', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              className="cb-cc-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              placeholder="A short description. Leave blank to fill in later via prose."
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical', minHeight: 64, lineHeight: 1.45 }}
            />

            {error && (
              <div style={{ fontSize: 11, color: 'crimson', marginBottom: 10 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={onCancel}
                disabled={submitting}
                style={{ ...ghostBtn, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting || name.trim().length === 0}
                style={primaryBtn(!submitting && name.trim().length > 0)}
                title="⌘+Enter"
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
