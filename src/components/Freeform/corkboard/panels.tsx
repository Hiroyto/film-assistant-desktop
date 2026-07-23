// components/Freeform/corkboard/panels.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { type EntityType } from '../../../components/Freeform/types';
import { deleteInformation, listBraindumps, updateInformation, type ArcKind, type ArcSuggestion, type BraindumpLogEntry, type ProjectEntity, type ProjectInformation } from '../../../lib/freeformApi';
import { InlineText } from './editors';
import { arcKindLabel, formatRelativeTime } from './labels';
import { type CardSignal } from './signals';
import { useThemeMode } from './theme';
import { BallChip } from './toolbar';

// =====================================================================
// BallChip — sticky-on-scroll category cluster (Characters / Arcs / Locations /
// Backstory). A pill labelled with the category + count of members that have
// scrolled above the view. Viewport-pinned (not draggable); clicking toggles
// the cluster's expand state, dealing its members back into view.
// =====================================================================

// =====================================================================
// RightPanel — on-demand right-side panel toggled from the toolbar. Three
// collapsible sections: Arc suggestions (top, default open — accept/dismiss
// inline), Information (default collapsed — every story fact, inline-editable,
// click-through to its establishing scenes) and Arcs (default collapsed — a
// tile per arc with "open full sheet"). Generalizes the old suggestions-only
// drawer into a permanent surface.
// =====================================================================

export const INFO_ACCENT = '#0891b2'; // cyan — the Information layer's accent

// InfoHint: a small "i" affordance on a panel-section header that reveals an
// explanatory tooltip on hover. Tooltip styling is lifted from the canvas
// floating-button tooltips (CanvasToolbar.tsx): glassy dark panel, 8px radius,
// 11px copy, soft shadow. Theme-aware so light mode isn't black-on-white.
function InfoHint({ text, dark, accent }: { text: string; dark: boolean; accent: string }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', marginRight: 16 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        aria-label="About this section"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 15, height: 15, borderRadius: '50%', boxSizing: 'border-box',
          border: `1px solid ${show ? accent : dark ? '#4a4a52' : '#ccc'}`,
          color: show ? accent : dark ? '#82828c' : '#999',
          fontSize: 9.5, fontWeight: 700, fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1,
          cursor: 'help', transition: 'color 120ms, border-color 120ms',
        }}
      >
        i
      </span>
      {show && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8,
            padding: '0.6rem 0.75rem',
            background: dark ? 'rgba(20, 20, 26, 0.98)' : 'rgba(255, 255, 255, 0.99)',
            border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
            borderRadius: 8, fontSize: 11,
            color: dark ? 'rgba(255, 255, 255, 0.7)' : '#555',
            width: 230, lineHeight: 1.5,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none', zIndex: 20,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

export function RightPanel({
  information,
  suggestions,
  arcs,
  locations,
  occursIn,
  signals,
  entities,
  auth,
  projectId,
  onAcceptSuggestion,
  onDismissSuggestion,
  onOpenCard,
  onEntitiesChanged,
  onClose,
  openSection,
}: {
  information: ProjectInformation[];
  suggestions: ArcSuggestion[];
  arcs: ProjectEntity[];
  locations: ProjectEntity[];
  /** Event → Location edges, for per-location scene counts. */
  occursIn: Array<{ from: string; to: string }>;
  signals: Record<string, CardSignal>;
  entities: ProjectEntity[];
  auth: { userId: string; token: string } | null;
  projectId: string;
  onAcceptSuggestion: (suggestionId: string) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onOpenCard: (cardId: string) => void;
  onEntitiesChanged: () => void;
  onClose: () => void;
  /** When set, force-expand this section (e.g. the wow tour bringing the
   *  Information section open as it walks to it). */
  openSection?: string | null;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Per-section collapse state — Arc suggestions open by default, the rest
  // collapsed (showing just their count summary).
  const [open, setOpen] = useState<Record<string, boolean>>({ suggestions: true });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // Force-expand a section on request (the wow tour expands Information as it
  // walks to it). One-shot per value change; the writer can collapse it after.
  useEffect(() => {
    if (openSection) setOpen((o) => ({ ...o, [openSection]: true }));
  }, [openSection]);

  // Braindumps log — fetched once when the panel opens. Read-only history of
  // every extraction source (braindumps + committed peer responses).
  const [braindumps, setBraindumps] = useState<BraindumpLogEntry[] | null>(null);
  useEffect(() => {
    if (!auth || !projectId) return;
    let cancelled = false;
    listBraindumps({ projectId }, auth.token)
      // Scratch generations (script editor tail extractions) are provenance,
      // not writer braindumps — keep this log to true braindumps.
      .then((res) => { if (!cancelled) setBraindumps(res.braindumps.filter((b) => !b.braindumpId.startsWith('scratch_'))); })
      .catch((err) => {
        console.warn('[panel] list-braindumps failed', err);
        if (!cancelled) setBraindumps([]);
      });
    return () => { cancelled = true; };
  }, [auth, projectId]);

  const arcColor = getEntityColor('arc');
  const nameOf = (id: string) => {
    const e = entities.find((x) => x.id === id);
    return e?.working_title ?? e?.working_name ?? 'a scene';
  };

  const section = (id: string, label: string, count: number, accent: string, body: React.ReactNode, hint?: string) => {
    const isOpen = !!open[id];
    return (
      <div data-tour={`panel-${id}`} style={{ borderBottom: dark ? '1px solid #26262b' : '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => toggle(id)}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
              padding: '13px 18px', background: 'transparent', border: 'none',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
            <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: accent, fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa' }}>{count}</span>
          </button>
          {hint && <InfoHint text={hint} dark={dark} accent={accent} />}
        </div>
        {isOpen && <div style={{ padding: '0 18px 14px' }}>{body}</div>}
      </div>
    );
  };

  const empty = (text: string) => (
    <div style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', lineHeight: 1.5, padding: '4px 0 8px' }}>{text}</div>
  );

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 180,
        background: 'rgba(20,20,20,0.28)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ width: 420, height: '100vh', background: dark ? '#1a1a1e' : '#fff', boxShadow: '-8px 0 28px rgba(0,0,0,0.14)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `3px solid ${INFO_ACCENT}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#dcdce2' : '#333' }}>Panel</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 0 }} title="Close (Esc)">×</button>
        </div>

        <div className="cb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {section('suggestions', 'Arc suggestions', suggestions.length, arcColor,
            suggestions.length === 0
              ? empty('None right now. When a thematic thread recurs across braindumps it lands here — accept it as an Arc or dismiss.')
              : suggestions.map((sug) => (
                  <ArcSuggestionRow
                    key={sug.suggestionId}
                    suggestion={sug}
                    onAccept={() => onAcceptSuggestion(sug.suggestionId)}
                    onDismiss={() => onDismissSuggestion(sug.suggestionId)}
                  />
                )),
            'Recurring thematic threads the system spots across your braindumps. Accept one to turn it into an Arc card, or dismiss it so it won’t resurface.',
          )}

          {section('information', 'Information', information.length, INFO_ACCENT,
            information.length === 0
              ? empty("No facts yet. Information is extracted from braindumps + scenes — what's established and who knows it.")
              : information.map((info) => (
                  <InfoTile
                    key={info.id}
                    info={info}
                    scenes={info.established_in_event_ids.map((id) => ({ id, name: nameOf(id) }))}
                    onOpenScene={onOpenCard}
                    auth={auth}
                    projectId={projectId}
                    onChanged={onEntitiesChanged}
                  />
                )),
            'Facts established in the story and who knows them. Extracted from braindumps and scenes; edit or hard-delete a fact here.',
          )}

          {section('arcs', 'Arcs', arcs.length, arcColor,
            arcs.length === 0
              ? empty('No arcs yet. Create one from the canvas, or accept a suggestion above.')
              : arcs.map((arc) => (
                  <ArcTile
                    key={arc.id}
                    arc={arc}
                    statusLabel={signals[arc.id]?.arcStatusLabel}
                    accent={arcColor}
                    onOpenSheet={() => onOpenCard(arc.id)}
                  />
                )),
            'Every arc in the project, with its kind, derived status, and a jump to its full sheet. Arcs also appear on the canvas as threads woven through the scenes they evoke.',
          )}

          {section('locations', 'Locations', locations.length, getEntityColor('location'),
            locations.length === 0
              ? empty('No locations yet. They land from braindumps, or create one via + New.')
              : locations.map((loc) => (
                  <LocationTile
                    key={loc.id}
                    location={loc}
                    sceneCount={occursIn.filter((e) => e.to === loc.id).length}
                    onOpenSheet={() => onOpenCard(loc.id)}
                  />
                )),
            'Places scenes occur in, with how many scenes use each.',
          )}

          {section('braindumps', 'Braindumps', braindumps?.length ?? 0, '#8b8b96',
            braindumps === null
              ? empty('Loading…')
              : braindumps.length === 0
              ? empty('No braindumps yet — open the Braindump dock in the toolbar and process one.')
              : braindumps.map((bd) => <BraindumpRow key={bd.id} entry={bd} />),
            'A read-only log of every extraction source (braindumps and committed peer responses), newest first. Click an entry to expand its full text.',
          )}
        </div>
      </div>
    </div>
  );
}

export function LocationTile({
  location,
  sceneCount,
  onOpenSheet,
}: {
  location: ProjectEntity;
  sceneCount: number;
  onOpenSheet: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const accent = getEntityColor('location');
  const desc = (location.description ?? '').trim();
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {location.working_name ?? location.id}
        </span>
        {location.int_ext && (
          <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 9, background: hexToRgba(accent, 0.12), color: accent, fontWeight: 700, letterSpacing: 0.4 }}>
            {String(location.int_ext).toUpperCase()}
          </span>
        )}
        <span style={{ fontSize: 10.5, color: dark ? '#787882' : '#999' }}>
          {sceneCount} scene{sceneCount === 1 ? '' : 's'}
        </span>
      </div>
      {desc && (
        <div style={{ fontSize: 11.5, color: dark ? '#8e8e98' : '#777', lineHeight: 1.45, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {desc}
        </div>
      )}
      <button
        onClick={onOpenSheet}
        style={{ marginTop: 8, fontSize: 11, padding: '3px 9px', borderRadius: 4, border: `1px solid ${hexToRgba(accent, 0.4)}`, background: hexToRgba(accent, 0.06), color: accent, cursor: 'pointer', fontWeight: 600 }}
      >
        open full sheet ↗
      </button>
    </div>
  );
}

export function InfoTile({
  info,
  scenes,
  onOpenScene,
  auth,
  projectId,
  onChanged,
}: {
  info: ProjectInformation;
  scenes: { id: string; name: string }[];
  onOpenScene: (cardId: string) => void;
  auth: { userId: string; token: string } | null;
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const eventColor = getEntityColor('event');
  // Two-click delete: first click arms ("delete fact?"), second commits.
  // Hard delete — drops the fact AND its who-knows-it edges everywhere.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${INFO_ACCENT}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff', opacity: deleting ? 0.5 : 1 }}>
      <InlineText
        value={info.summary}
        onSave={async (d) => {
          if (!auth || !d.trim()) return;
          await updateInformation({ projectId, infoId: info.id, summary: d.trim() }, auth.token);
          onChanged();
        }}
        style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', lineHeight: 1.45, fontWeight: 500 }}
      />
      {info.evidence_quote && (
        <blockquote style={{ margin: '6px 0 0', paddingLeft: 8, borderLeft: dark ? '2px solid #2a2a30' : '2px solid #eee', fontSize: 11, color: dark ? '#82828c' : '#888', fontStyle: 'italic', lineHeight: 1.45 }}>
          "{info.evidence_quote}"
        </blockquote>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {scenes.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpenScene(s.id)}
            title="Open this scene"
            style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 10, border: `1px solid ${hexToRgba(eventColor, 0.4)}`, background: hexToRgba(eventColor, 0.08), color: eventColor, cursor: 'pointer', fontWeight: 600 }}
          >
            {s.name}
          </button>
        ))}
        {info.irony_hidden && (
          <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb', fontStyle: 'italic' }}>flat · hidden from Knowledge</span>
        )}
        <button
          onClick={async () => {
            if (!confirmingDelete) { setConfirmingDelete(true); return; }
            if (!auth || deleting) return;
            setDeleting(true);
            try {
              await deleteInformation({ projectId, infoId: info.id }, auth.token);
              onChanged();
            } catch (e) {
              console.warn('[info-delete] failed', e);
              setDeleting(false);
              setConfirmingDelete(false);
            }
          }}
          onMouseLeave={() => { if (confirmingDelete && !deleting) setConfirmingDelete(false); }}
          title="Delete this fact everywhere — removes it from its scenes and clears who-knows-it"
          style={{
            marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px', borderRadius: 4,
            border: confirmingDelete ? '1px solid #dc2626' : '1px solid transparent',
            background: confirmingDelete ? '#fbe9e9' : 'transparent',
            color: confirmingDelete ? '#dc2626' : '#bbb',
            cursor: deleting ? 'default' : 'pointer', fontWeight: 600,
          }}
        >
          {deleting ? 'deleting…' : confirmingDelete ? 'delete fact + knowledge?' : 'delete'}
        </button>
      </div>
    </div>
  );
}

export function ArcTile({
  arc,
  statusLabel,
  accent,
  onOpenSheet,
}: {
  arc: ProjectEntity;
  statusLabel?: string;
  accent: string;
  onOpenSheet: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const dot = (typeof arc.color === 'string' && arc.color.trim()) ? arc.color.trim() : accent;
  const kind = arc.kind as ArcKind | undefined;
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {arc.working_name ?? arc.id}
        </span>
        {kind && (
          <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 9, background: hexToRgba(accent, 0.12), color: accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {arcKindLabel(kind)}
          </span>
        )}
      </div>
      {statusLabel && (
        <div style={{ fontSize: 11, color: dark ? '#82828c' : '#888', fontStyle: 'italic', marginTop: 5 }}>{statusLabel}</div>
      )}
      <button
        onClick={onOpenSheet}
        style={{ marginTop: 8, fontSize: 11, padding: '3px 9px', borderRadius: 4, border: `1px solid ${hexToRgba(accent, 0.4)}`, background: hexToRgba(accent, 0.06), color: accent, cursor: 'pointer', fontWeight: 600 }}
      >
        open full sheet ↗
      </button>
    </div>
  );
}

// ArcSuggestionRow — one pending arc suggestion (used by RightPanel).

export function ArcSuggestionRow({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: ArcSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const color = getEntityColor('arc');
  const kindLabel =
    typeof suggestion.suggestedKind === 'string'
      ? arcKindLabel(suggestion.suggestedKind as ArcKind)
      : '';
  const quotes = suggestion.evidenceQuotes ?? [];
  const sources = suggestion.sourceBraindumpIds ?? [];

  return (
    <div
      style={{
        marginBottom: 14,
        padding: '14px 14px 12px',
        background: dark ? '#1a1a1e' : '#fff',
        border: `1px solid ${hexToRgba(color, 0.35)}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        {kindLabel && (
          <span
            style={{
              fontSize: 9,
              padding: '2px 6px',
              background: hexToRgba(color, 0.14),
              color,
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
          >
            {kindLabel}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: dark ? '#6e6e78' : '#aaa',
          }}
          title={`Mentioned in ${suggestion.mentionCount} extraction${suggestion.mentionCount === 1 ? '' : 's'}`}
        >
          {suggestion.mentionCount}× mentioned
          {sources.length > 0 && sources.length !== suggestion.mentionCount
            ? ` · ${sources.length} sources`
            : ''}
        </span>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: dark ? '#e6e6ea' : '#222',
          lineHeight: 1.3,
          marginBottom: 6,
        }}
      >
        {suggestion.suggestedName}
      </div>
      {suggestion.description && (
        <div
          style={{
            fontSize: 12,
            color: dark ? '#b2b2bc' : '#555',
            lineHeight: 1.5,
            marginBottom: quotes.length > 0 ? 10 : 12,
          }}
        >
          {suggestion.description}
        </div>
      )}
      {quotes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: dark ? '#82828c' : '#888',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Evidence ({quotes.length})
          </div>
          {quotes.map((q, i) => (
            <blockquote
              key={i}
              style={{
                margin: '0 0 6px',
                paddingLeft: 10,
                borderLeft: `2px solid ${hexToRgba(color, 0.3)}`,
                fontSize: 11,
                color: dark ? '#8e8e98' : '#777',
                fontStyle: 'italic',
                lineHeight: 1.5,
              }}
            >
              "{q}"
            </blockquote>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            fontSize: 11,
            padding: '5px 11px',
            border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
            background: dark ? '#1a1a1e' : '#fff',
            borderRadius: 4,
            color: dark ? '#9a9aa4' : '#666',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
          title="Don't suggest this again (sticky — future braindumps mentioning this concept won't re-surface it)"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onAccept}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '5px 11px',
            border: 'none',
            background: color,
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
          title="Create an Arc card from this suggestion"
        >
          + Create arc
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// TrashOverlay — sidebar-style modal listing soft-deleted entities sorted by
// deletion time. One-click restore. The safety net behind the delete CTA;
// makes single-card deletes feel low-stakes (§9).
// =====================================================================

export function TrashOverlay({
  entities,
  onRestore,
  onClose,
}: {
  entities: ProjectEntity[];
  onRestore: (cardId: string) => void;
  onClose: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        background: 'rgba(20, 20, 20, 0.28)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 380,
          height: '100vh',
          background: dark ? '#1a1a1e' : '#fff',
          boxShadow: '-8px 0 28px rgba(0,0,0,0.14)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: dark ? '1px solid #2a2a30' : '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e6e6ea' : '#222' }}>
            Trash {entities.length > 0 && <span style={{ color: dark ? '#787882' : '#999', fontWeight: 400 }}>({entities.length})</span>}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              color: dark ? '#82828c' : '#888',
              cursor: 'pointer',
              padding: 0,
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div style={{ padding: '14px 18px', fontSize: 11, color: dark ? '#82828c' : '#888', lineHeight: 1.5, borderBottom: dark ? '1px solid #26262b' : '1px solid #f4f4f4' }}>
          Soft-deleted cards. Restore brings them back to the canvas with their
          edges + history intact. Re-mentioning a deleted card in prose also
          restores it automatically.
        </div>
        <div className="cb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {entities.length === 0 ? (
            <div style={{ padding: '40px 18px', fontSize: 12, color: dark ? '#6e6e78' : '#aaa', textAlign: 'center' }}>
              Trash is empty.
            </div>
          ) : (
            entities.map((e) => {
              const name =
                e.working_name ??
                e.working_title ??
                (e.character_a && e.character_b
                  ? `${e.character_a} ↔ ${e.character_b}`
                  : e.id);
              const color = getEntityColor(e.type as EntityType);
              return (
                <div
                  key={e.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: dark ? '1px solid #26262b' : '1px solid #f4f4f4',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: dark ? '#e6e6ea' : '#222', marginBottom: 2 }}>
                      {name}
                    </div>
                    <div style={{ fontSize: 10, color: dark ? '#787882' : '#999', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {e.type}
                      {e.deleted_at && (
                        <span style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0, color: dark ? '#63636d' : '#bbb' }}>
                          · deleted {formatRelativeTime(e.deleted_at)}
                        </span>
                      )}
                    </div>
                    {(e.description || e.summary) && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: dark ? '#8e8e98' : '#777',
                          lineHeight: 1.4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {e.description || e.summary}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onRestore(e.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
                      background: dark ? '#1a1a1e' : '#fff',
                      color: '#3b82f6',
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif',
                      whiteSpace: 'nowrap',
                    }}
                    title="Clear deleted_at + bring back to the canvas"
                  >
                    Restore
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


function BraindumpRow({ entry }: { entry: BraindumpLogEntry }) {
  const dark = useThemeMode() === 'dark';
  const [expanded, setExpanded] = useState(false);
  const when = entry.createdAt
    ? new Date(entry.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      title={expanded ? 'Collapse' : 'Show full text'}
      style={{
        border: dark ? '1px solid #2a2a30' : '1px solid #eee',
        borderLeft: '3px solid #8b8b96',
        borderRadius: 6, padding: '9px 12px', marginBottom: 8,
        background: dark ? '#1a1a1e' : '#fff', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: dark ? '#9a9aa4' : '#666' }}>{when}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb' }}>{expanded ? '\u25be' : '\u25b8'}</span>
      </div>
      <div
        style={{
          fontSize: 12, lineHeight: 1.5, color: dark ? '#c2c2ca' : '#444',
          whiteSpace: 'pre-wrap',
          ...(expanded
            ? null
            : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
        }}
      >
        {entry.prose}
      </div>
    </div>
  );
}
