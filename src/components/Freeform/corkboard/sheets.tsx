// components/Freeform/corkboard/sheets.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { PEER_BLUE } from '../../../components/Freeform/tokens';
import { queueEditGlobal } from '../../../lib/storySession';
import { listCardQuestions, setSequenceColor, tagCauses, tagEventInvolvesCharacter, tagEventOccursIn, tagSequenceContains, untagCauses, untagEventInvolvesCharacter, untagEventOccursIn, untagSequenceContains, updateArc, updateCardDescription, updateEventSubEvents, updateRelationshipKind, type ArcKind, type NarrativeStatus, type PersistedQuestion, type ProjectEdges, type ProjectEntity, type ProjectInformation, type SubEvent } from '../../../lib/freeformApi';
import { BentoSheet, buildArcBentoLayout, buildCharacterBentoLayout, buildEventBentoLayout, buildRelationshipBentoLayout, buildSequenceBentoLayout, type SectionTileDef } from './bento';
import { EditableDescription, EditableName, NarrativeStatusToggle } from './cards';
import { ARC_THREAD_PALETTE } from './connectors';
import { ArcEvokesEditor, ArcInvolvesEditor, EdgeChips, EstablishedHereEditor, EventEvokesEditor, EventThroughlineEditor, InlineText, KnowledgeEditor, type ChipCandidate } from './editors';
import { arcKindLabel, narrativeStatusBg, narrativeStatusFg, narrativeStatusLabel } from './labels';
import { OpenQuestionsPanel, miniActionBtn } from './peer';
import { topoSortByPrecedes, type CardSignal } from './signals';
import { liftColor, useThemeMode } from './theme';

// =====================================================================
// CharacterSheet — level-3 full character view. Full-screen overlay.
// Renders working sections (with response prose), rich event listing,
// knowledge arcs, structural ties. The peer-only material (open_dimensions)
// is intentionally omitted here too — peer handles those.
// =====================================================================

export function CharacterSheet({
  entity,
  signal,
  allEntities,
  edges,
  precedesEdges,
  auth,
  projectId,
  completedResponseIds,
  onClose,
  onEntitiesChanged,
  onOpenCard,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  precedesEdges: Array<{ from: string; to: string }>;
  auth: { userId: string; token: string };
  projectId: string;
  completedResponseIds: Set<string>;
  onClose: () => void;
  onEntitiesChanged: () => void;
  onOpenCard: (cardId: string) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [questions, setQuestions] = useState<PersistedQuestion[] | null>(null);

  const refetchQuestions = useCallback(async () => {
    try {
      const res = await listCardQuestions(
        { cardId: entity.id, withResponses: true, withOpenThreads: true },
        auth.token,
      );
      setQuestions(res.questions);
    } catch (err) {
      console.warn('[sheet] fetch failed:', err);
    }
  }, [entity.id, auth.token]);

  useEffect(() => {
    refetchQuestions();
  }, [refetchQuestions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('character');
  const traits = entity.established_traits ?? [];
  const appearsIn = signal.appearsInEvents ?? [];
  const knowsList = signal.knowsList ?? [];
  const structuralPeers = signal.structuralPeers ?? [];
  const structuralPreds = signal.structuralPreds ?? [];
  const eventsById = new Map(allEntities.map((e) => [e.id, e]));
  const charName = entity.working_name ?? entity.working_title ?? '';
  // Arcs this character is involved in (reified Arc vertices via arc_involves).
  const charArcs = (edges.arc_involves ?? [])
    .filter((e) => e.character_id === entity.id)
    .map((e) => allEntities.find((x) => x.id === e.arc_id && x.type === 'arc' && !x.deleted_at))
    .filter((a): a is ProjectEntity => !!a);
  // Reified Relationship vertices involving this character (matched by name).
  const reifiedRels = allEntities.filter(
    (x) =>
      x.type === 'relationship' && !x.deleted_at &&
      (x.character_a === charName || x.character_b === charName),
  );
  const relCount = reifiedRels.length + structuralPeers.length;

  // Group questions by status.
  const byStatus: Record<string, PersistedQuestion[]> = {
    open: [],
    answered: [],
    stashed: [],
    dismissed: [],
  };
  for (const q of questions ?? []) {
    (byStatus[q.status] ??= []).push(q);
  }

  // --- Bento tile data (card-surface rework) ---
  // Character Knowledge tile: this character is the single knower across many
  // facts, so we group by knowledge STATE (vs the Event sheet's group-by-fact).
  const knowState = (s: string): 'knows' | 'suspects' | 'dark' =>
    s === 'knows' || s === 'almost_spoiled' ? 'knows' : s === 'suspects' ? 'suspects' : 'dark';
  const knowGroups: Record<'knows' | 'suspects' | 'dark', typeof knowsList> = {
    knows: [], suspects: [], dark: [],
  };
  for (const k of knowsList) knowGroups[knowState(k.state)].push(k);
  const KNOW_GROUP_META: { key: 'knows' | 'suspects' | 'dark'; label: string; color: string }[] = [
    { key: 'knows', label: 'KNOWS', color: '#059669' },
    { key: 'suspects', label: 'SUSPECTS', color: '#d97706' },
    { key: 'dark', label: 'IN THE DARK', color: '#dc2626' },
  ];

  const tiles: SectionTileDef[] = [
    {
      id: 'identity', label: 'Summary', accent: color, defaultW: 2, defaultExpanded: true,
      hint: "The character's description, established traits, and the evidence behind them.",
      content: (
        <div>
          {entity.description && (
            <p style={{ fontSize: 13, lineHeight: 1.55, color: dark ? '#dcdce2' : '#333', margin: '0 0 12px' }}>
              {entity.description}
            </p>
          )}
          {traits.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
              {traits.map((t, i) => (
                <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: hexToRgba(color, 0.12), color: dark ? '#c2c2ca' : '#444' }}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {entity.evidence_quote && (
            <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`, fontSize: 11, color: dark ? '#8e8e98' : '#777', fontStyle: 'italic', lineHeight: 1.5 }}>
              "{entity.evidence_quote}"
            </blockquote>
          )}
        </div>
      ),
    },
    {
      id: 'knowledge', label: 'Knowledge', accent: color, defaultW: 2,
      hint: 'What this character knows, suspects, or is in the dark about.',
      defaultExpanded: knowsList.length > 0,
      summary: knowsList.length > 0 ? `${knowsList.length} fact${knowsList.length === 1 ? '' : 's'}` : 'none',
      content: knowsList.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>No knowledge state recorded.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {KNOW_GROUP_META.filter((g) => knowGroups[g.key].length > 0).map((g) => (
            <div key={g.key}>
              <div style={{ fontSize: 10, letterSpacing: 0.6, fontWeight: 700, color: g.color, marginBottom: 4 }}>
                {g.label}
              </div>
              {knowGroups[g.key].map((k, i) => (
                <div key={i} style={{ fontSize: 12, color: dark ? '#dcdce2' : '#333', marginBottom: 5, lineHeight: 1.45 }}>
                  {k.info_summary}
                  {k.state_qualifier && <span style={{ color: dark ? '#82828c' : '#888' }}> ({k.state_qualifier})</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'arcs', label: 'Arcs', accent: getEntityColor('arc'), defaultW: 2,
      hint: 'Arcs this character is involved in. Click one to open its sheet.',
      defaultExpanded: charArcs.length > 0,
      summary: charArcs.length > 0 ? `${charArcs.length}` : 'none',
      content: charArcs.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>Not part of any arc yet — select scenes on the canvas to build one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {charArcs.map((arc) => (
            <div
              key={arc.id}
              onClick={() => onOpenCard(arc.id)}
              title="Open arc"
              style={{ cursor: 'pointer', padding: '7px 9px', border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderRadius: 6, background: dark ? '#1a1a1e' : '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#1a1a1a', fontWeight: 500 }}>{arc.working_name ?? arc.id}</span>
                {arc.kind && (
                  <span style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: getEntityColor('arc'), background: hexToRgba(getEntityColor('arc'), 0.1), padding: '1px 6px', borderRadius: 8 }}>
                    {String(arc.kind).replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {arc.description && (
                <div style={{ fontSize: 12, color: dark ? '#9a9aa4' : '#666', lineHeight: 1.45, marginTop: 3 }}>{arc.description}</div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'relationships', label: 'Relationships', accent: getEntityColor('relationship'), defaultW: 2,
      hint: 'Reified relationships and structural ties to other characters.',
      defaultExpanded: relCount > 0,
      summary: relCount > 0 ? `${relCount}` : 'none',
      content: relCount === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>No relationships yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reifiedRels.map((rel) => {
            const isA = rel.character_a === charName;
            const other = isA ? rel.character_b : rel.character_a;
            // The OTHER side's role, shown when the bond is asymmetric —
            // reads as "Mabel (ward)" from Leah's sheet.
            const otherRole = (rel.role_a !== rel.role_b) ? (isA ? rel.role_b : rel.role_a) : '';
            return (
              <div
                key={rel.id}
                onClick={() => onOpenCard(rel.id)}
                title="Open relationship"
                style={{ cursor: 'pointer', padding: '7px 9px', border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderRadius: 6, background: dark ? '#1a1a1e' : '#fff' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#1a1a1a', fontWeight: 500 }}>
                    {other ?? '?'}
                    {otherRole && <span style={{ fontWeight: 400, color: dark ? '#82828c' : '#888' }}> ({String(otherRole).replace(/_/g, ' ')})</span>}
                  </span>
                  {rel.kind && (
                    <span style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: getEntityColor('relationship'), background: hexToRgba(getEntityColor('relationship'), 0.12), padding: '1px 6px', borderRadius: 8 }}>
                      {String(rel.kind).replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                {rel.description && (
                  <div style={{ fontSize: 12, color: dark ? '#9a9aa4' : '#666', lineHeight: 1.45, marginTop: 3 }}>{rel.description}</div>
                )}
              </div>
            );
          })}
          {structuralPeers.length > 0 && (
            <div style={{ marginTop: reifiedRels.length > 0 ? 2 : 0 }}>
              <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>
                Other ties
              </div>
              {structuralPeers.map((peer, i) => (
                <div key={i} style={{ fontSize: 12, color: dark ? '#dcdce2' : '#333', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', color: dark ? '#82828c' : '#888', fontSize: 10 }}>
                    {structuralPreds[i] ?? ''}
                  </span>{' '}
                  {peer}
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'appears-in', label: `Appears in${appearsIn.length > 0 ? ` · ${appearsIn.length}` : ''}`,
      accent: color, defaultW: 2, defaultExpanded: true,
      hint: 'Scenes this character appears in, in story order.',
      summary: appearsIn.length > 0 ? `${appearsIn.length} event${appearsIn.length === 1 ? '' : 's'}` : 'none',
      content: appearsIn.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>Not yet in any events.</div>
      ) : (
        <SheetEventTimeline
          appearsIn={appearsIn}
          eventsById={eventsById}
          precedesEdges={precedesEdges}
        />
      ),
    },
    {
      id: 'working', label: 'Open Questions', accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: 'Ask the peer about this card, answer inline, or open a chat thread.',
      summary: questions == null ? '…' : `${byStatus.open.length} open`,
      content: (
        <OpenQuestionsPanel
          entity={entity}
          projectId={projectId}
          auth={auth}
          completedResponseIds={completedResponseIds}
          questions={questions}
          onCardQuestionsChanged={refetchQuestions}
          onEntitiesChanged={onEntitiesChanged}
          accentColor={PEER_BLUE}
        />
      ),
    },
  ];

  // Default tile order (per Ben): Summary · Open Questions · Relationships ·
  // Knowledge · Arcs · Appears-in. Per-card layout persistence can override.
  const CHAR_TILE_ORDER = ['identity', 'working', 'relationships', 'knowledge', 'arcs', 'appears-in'];
  const orderedTiles = [
    ...CHAR_TILE_ORDER.map((id) => tiles.find((t) => t.id === id)).filter((t): t is SectionTileDef => !!t),
    ...tiles.filter((t) => !CHAR_TILE_ORDER.includes(t.id)),
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: dark ? '#101013' : '#fafafa',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header bar — full width */}
      <div
        style={{
          padding: '16px 28px',
          background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color,
              fontWeight: 600,
            }}
          >
            CHARACTER
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: dark ? '#e6e6ea' : '#1a1a1a', lineHeight: 1 }}>
            {entity.working_name ?? entity.id}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 20,
            color: dark ? '#82828c' : '#888',
            cursor: 'pointer',
            padding: 4,
          }}
          aria-label="Close character sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Bento section tiles (card-surface rework) */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BentoSheet tiles={orderedTiles} columns={4} persistKey={`character:${entity.id}`} buildDefaultLayout={buildCharacterBentoLayout} />
      </div>
    </div>
  );
}

// =====================================================================
// SequenceSheet — level-3 full sequence view. A development surface: the
// broad movement beside the peer (decomposition / relational), its member
// scenes, the sequence throughline, and the arcs threading through it.
// =====================================================================
export function SequenceSheet({
  entity,
  allEntities,
  edges,
  auth,
  projectId,
  completedResponseIds,
  onClose,
  onEntitiesChanged,
  onOpenCard,
  onUpdateDescription,
}: {
  entity: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  completedResponseIds: Set<string>;
  onClose: () => void;
  onEntitiesChanged: () => void;
  onOpenCard: (cardId: string) => void;
  onUpdateDescription: (d: string) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [questions, setQuestions] = useState<PersistedQuestion[] | null>(null);

  const refetchQuestions = useCallback(async () => {
    try {
      const res = await listCardQuestions(
        { cardId: entity.id, withResponses: true, withOpenThreads: true },
        auth.token,
      );
      setQuestions(res.questions);
    } catch (err) {
      console.warn('[sheet] fetch failed:', err);
    }
  }, [entity.id, auth.token]);

  useEffect(() => { refetchQuestions(); }, [refetchQuestions]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('sequence');
  const byId = useMemo(() => new Map(allEntities.map((e) => [e.id, e])), [allEntities]);

  // Member scenes — the Events this sequence CONTAINS.
  const memberScenes = (edges.contains ?? [])
    .filter((c) => c.from === entity.id)
    .map((c) => byId.get(c.to))
    .filter((e): e is ProjectEntity => !!e && !e.deleted_at);
  // Sequence throughline neighbors (via the auto-chained sequence_precedes).
  const prevSeqs = (edges.sequence_precedes ?? [])
    .filter((e) => e.to === entity.id).map((e) => byId.get(e.from))
    .filter((s): s is ProjectEntity => !!s && !s.deleted_at);
  const nextSeqs = (edges.sequence_precedes ?? [])
    .filter((e) => e.from === entity.id).map((e) => byId.get(e.to))
    .filter((s): s is ProjectEntity => !!s && !s.deleted_at);
  // Arcs threading through the member scenes (EVOKES on a contained event).
  const memberIds = new Set(memberScenes.map((e) => e.id));
  const threadArcs = Array.from(
    new Set((edges.evokes ?? []).filter((e) => memberIds.has(e.event_id)).map((e) => e.arc_id)),
  ).map((aid) => byId.get(aid)).filter((a): a is ProjectEntity => !!a && a.type === 'arc' && !a.deleted_at);

  const openCount = (questions ?? []).filter((q) => q.status === 'open' || q.status === 'stashed').length;

  const rowBtn: React.CSSProperties = {
    textAlign: 'left', width: '100%', padding: '7px 10px', borderRadius: 8,
    border: `1px solid ${dark ? '#2a2a30' : '#e6e6ea'}`, background: dark ? '#1d1d23' : '#fff',
    color: dark ? '#dcdce2' : '#333', fontSize: 12.5, cursor: 'pointer',
  };

  const tiles: SectionTileDef[] = [
    {
      id: 'summary', label: 'Summary', accent: color, defaultW: 2, defaultExpanded: true,
      hint: 'The broad movement this sequence describes. Edit inline; the writer owns this prose.',
      content: (
        <div>
          <EditableDescription
            value={entity.summary ?? entity.description ?? ''}
            onSave={async (d) => { onUpdateDescription(d); }}
            placeholder="Describe this movement…"
          />
          <SequenceColorRow
            sequenceId={entity.id}
            current={entity.color}
            auth={auth}
            projectId={projectId}
            onChanged={onEntitiesChanged}
          />
        </div>
      ),
    },
    {
      id: 'questions', label: 'Open Questions', accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: 'Ask the peer to help you see the scenes inside this movement (decomposition), or pressure-test the scenes it already holds.',
      summary: questions == null ? '…' : `${openCount} open`,
      content: (
        <OpenQuestionsPanel
          entity={entity}
          projectId={projectId}
          auth={auth}
          completedResponseIds={completedResponseIds}
          questions={questions}
          onCardQuestionsChanged={refetchQuestions}
          onEntitiesChanged={onEntitiesChanged}
          accentColor={PEER_BLUE}
        />
      ),
    },
    {
      id: 'scenes', label: 'Member scenes', accent: color, defaultW: 2,
      defaultExpanded: memberScenes.length > 0,
      summary: `${memberScenes.length}`,
      hint: "The scenes this sequence contains. Empty means it's still broad — the peer's decomposition questions turn it into scenes.",
      content: memberScenes.length === 0 ? (
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: dark ? '#9a9aa2' : '#777', margin: 0 }}>
          No scenes yet. This is still a broad movement. Ask the peer to help you break it into the scenes inside it.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {memberScenes.map((s) => (
            <button key={s.id} style={rowBtn} onClick={() => onOpenCard(s.id)}>
              {s.working_title ?? s.id}
            </button>
          ))}
        </div>
      ),
    },
    {
      id: 'throughline', label: 'Sequence throughline', accent: color, defaultW: 2,
      defaultExpanded: prevSeqs.length + nextSeqs.length > 0,
      summary: `${prevSeqs.length}←  →${nextSeqs.length}`,
      hint: 'Where this movement sits in the plot — the sequences before and after it.',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[{ label: '← Preceded by', list: prevSeqs }, { label: '→ Precedes', list: nextSeqs }].map((grp) => (
            <div key={grp.label}>
              <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: dark ? '#82828c' : '#999', marginBottom: 4 }}>
                {grp.label}
              </div>
              {grp.list.length === 0 ? (
                <div style={{ fontSize: 12, color: dark ? '#6a6a72' : '#aaa' }}>—</div>
              ) : (
                grp.list.map((s) => (
                  <button key={s.id} style={{ ...rowBtn, marginBottom: 4 }} onClick={() => onOpenCard(s.id)}>
                    {s.working_title ?? s.working_name ?? s.id}
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'arcs', label: 'Arcs threading', accent: getEntityColor('arc'), defaultW: 2,
      defaultExpanded: threadArcs.length > 0,
      summary: `${threadArcs.length}`,
      hint: 'Threads (arcs) that run through this sequence via its scenes.',
      content: threadArcs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: dark ? '#9a9aa2' : '#777', margin: 0 }}>No arcs thread through this sequence yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {threadArcs.map((a) => (
            <button key={a.id} style={{ ...rowBtn, width: 'auto' }} onClick={() => onOpenCard(a.id)}>
              {a.working_name ?? a.working_title ?? a.id}
            </button>
          ))}
        </div>
      ),
    },
  ];

  const SEQ_TILE_ORDER = ['summary', 'questions', 'scenes', 'throughline', 'arcs'];
  const orderedTiles = [
    ...SEQ_TILE_ORDER.map((id) => tiles.find((t) => t.id === id)).filter((t): t is SectionTileDef => !!t),
    ...tiles.filter((t) => !SEQ_TILE_ORDER.includes(t.id)),
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: dark ? '#101013' : '#fafafa',
        zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 28px', background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color, fontWeight: 600 }}>
            SEQUENCE
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: dark ? '#e6e6ea' : '#1a1a1a', lineHeight: 1 }}>
            {entity.working_title ?? entity.working_name ?? entity.id}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', fontSize: 20, color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 4 }}
          aria-label="Close sequence sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BentoSheet tiles={orderedTiles} columns={4} persistKey={`sequence:${entity.id}`} buildDefaultLayout={buildSequenceBentoLayout} />
      </div>
    </div>
  );
}

// A vertical column on the dashboard grid — own scroll, dividers between columns.
export function SheetColumn({ children }: { children: React.ReactNode }) {
  const dark = useThemeMode() === 'dark';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        borderRight: dark ? '1px solid #2a2a30' : '1px solid #e5e5e5',
        padding: 16,
        gap: 16,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

// A titled panel within a column. `fill` makes it grow to take available column height.
export function SheetPanel({
  title,
  fill,
  children,
}: {
  title: string;
  fill?: boolean;
  children: React.ReactNode;
}) {
  const dark = useThemeMode() === 'dark';
  return (
    <div
      style={{
        background: dark ? '#1a1a1e' : '#fff',
        border: dark ? '1px solid #2a2a30' : '1px solid #e5e5e5',
        borderRadius: 6,
        padding: 14,
        flex: fill ? 1 : 'initial',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h3
        style={{
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: dark ? '#82828c' : '#888',
          fontWeight: 600,
          margin: '0 0 10px',
          flexShrink: 0,
        }}
      >
        {title}
      </h3>
      <div style={{ overflow: fill ? 'auto' : 'visible', flex: fill ? 1 : 'initial', minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

export function EventSheet({
  entity,
  signal,
  allEntities,
  edges,
  information,
  auth,
  projectId,
  completedResponseIds,
  onClose,
  onEntitiesChanged,
  onChangeNarrativeStatus,
  onOpenCard,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  information: ProjectInformation[];
  auth: { userId: string; token: string };
  projectId: string;
  completedResponseIds: Set<string>;
  onClose: () => void;
  onEntitiesChanged: () => void;
  onChangeNarrativeStatus: (next: NarrativeStatus) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [questions, setQuestions] = useState<PersistedQuestion[] | null>(null);

  const refetchQuestions = useCallback(async () => {
    try {
      const res = await listCardQuestions(
        { cardId: entity.id, withResponses: true, withOpenThreads: true },
        auth.token,
      );
      setQuestions(res.questions);
    } catch (err) {
      console.warn('[event-sheet] fetch failed:', err);
    }
  }, [entity.id, auth.token]);

  useEffect(() => {
    refetchQuestions();
  }, [refetchQuestions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('event');
  // Authoritative edge data lives in `edges.*` (from = this event's id), NOT in
  // the stale `entity.involves`/`entity.occurs_in` name-arrays the old read-only
  // renderer used (same unreliable class as entity.precedes — see below).
  const castIds = (edges.involves ?? []).filter((e) => e.from === entity.id).map((e) => e.to);
  const occursInIds = (edges.occurs_in ?? []).filter((e) => e.from === entity.id).map((e) => e.to);
  // precedes / preceded_by lists from `list-project-entities` are still
  // returned by the loader, but the editable Throughline panel below reads
  // straight from data.edges.precedes (authoritative). These name arrays
  // were the read-only renderer's source; left here in case other panels
  // start consuming them.
  void entity.precedes;
  void entity.preceded_by;

  const byStatus: Record<string, PersistedQuestion[]> = {
    open: [], answered: [], stashed: [], dismissed: [],
  };
  for (const q of questions ?? []) {
    (byStatus[q.status] ??= []).push(q);
  }

  // --- Bento tile data (card-surface rework) ---
  const nameById = new Map(allEntities.map((x) => [x.id, x.working_title ?? x.working_name ?? x.id]));
  const resolveName = (id: string): string => {
    if (!id) return '?';
    if (id.startsWith('audience')) return 'Audience';
    return nameById.get(id) ?? id.replace(/^(char|evt|arc|loc|info)_/, '').replace(/_/g, ' ');
  };
  const infoHere = (information ?? []).filter((i) =>
    (i.established_in_event_ids ?? []).includes(entity.id),
  );
  const infoSummaryById = new Map(infoHere.map((i) => [i.id, i.summary]));
  const infoById = new Map((information ?? []).map((i) => [i.id, i]));
  const infoIdSet = new Set(infoHere.map((i) => i.id));
  // Knowledge anchored AT THIS scene (FIL-505): edges anchored to this event,
  // plus legacy un-anchored edges for facts established here. The tile is a
  // scene-local EDITING surface — it shows only what this scene touches.
  // The temporal FOLD (state-as-of-scene, inherited from PRECEDES ancestors)
  // is a READING operation and lives in the backend peer slice ONLY; folding
  // it into these editable buckets floods the tile with everything ever known
  // down the chain. Editing always re-anchors to this scene (KnowledgeEditor
  // passes eventId).
  const sceneKnowledge = (edges.knowledge ?? []).filter(
    (k) => k.at_event === entity.id || (!k.at_event && infoIdSet.has(k.info_id)),
  );
  // Group knowledge edges by the fact they concern → the Knowledge tile states
  // each fact once with a row of knower chips, instead of repeating the fact.
  const knowledgeByInfo = new Map<string, typeof sceneKnowledge>();
  for (const k of sceneKnowledge) {
    const arr = knowledgeByInfo.get(k.info_id) ?? [];
    arr.push(k);
    knowledgeByInfo.set(k.info_id, arr);
  }
  // Facts shown in the Knowledge tile: established here + any fact whose state
  // is set at this scene (even if it was established elsewhere).
  const knowledgeFactIds = new Set<string>(infoHere.map((i) => i.id));
  for (const k of sceneKnowledge) if (infoById.has(k.info_id)) knowledgeFactIds.add(k.info_id);
  // Facts flagged flat / no-ironic-potential are hidden from the Knowledge tile
  // (no edges touched).
  const knowledgeFacts = [...knowledgeFactIds]
    .filter((id) => !infoById.get(id)?.irony_hidden)
    .map((id) => ({ id, summary: infoById.get(id)?.summary ?? '' }));
  // "+ add information" offers any fact not currently shown here — including
  // flat-hidden ones and ones established at this very scene (picking a hidden
  // one un-hides it). Re-adding IS the un-hide path, so no hidden-facts footer.
  const shownKnowledgeIds = new Set(knowledgeFacts.map((f) => f.id));
  const knowledgeFactCandidates = (information ?? [])
    .filter((i) => !shownKnowledgeIds.has(i.id))
    .map((i) => ({ id: i.id, summary: i.summary, hidden: !!i.irony_hidden }));
  const causesOut = (edges.causes ?? []).filter((c) => c.from === entity.id);
  const causesIn = (edges.causes ?? []).filter((c) => c.to === entity.id);
  const knowStateColor = (s: string) =>
    s === 'knows' ? '#059669' : s === 'suspects' ? '#d97706' : '#dc2626';
  // Events + arcs this scene can be causally linked to (editable Causality
  // chips). Excludes self + deleted nodes; caller also excludes existing links.
  const linkableNodes = allEntities.filter(
    (e) => (e.type === 'event' || e.type === 'arc') && !e.deleted_at && e.id !== entity.id,
  );
  const causalCandidates = (excludeIds: Set<string>): ChipCandidate[] =>
    linkableNodes
      .filter((n) => !excludeIds.has(n.id))
      .map((n) => ({ id: n.id, label: resolveName(n.id), sublabel: n.type }));
  const characterCandidates = (excludeIds: Set<string>): ChipCandidate[] =>
    allEntities
      .filter((e) => e.type === 'character' && !e.deleted_at && !excludeIds.has(e.id))
      .map((e) => ({ id: e.id, label: resolveName(e.id) }));
  const locationCandidates = (excludeIds: Set<string>): ChipCandidate[] =>
    allEntities
      .filter((e) => e.type === 'location' && !e.deleted_at && !excludeIds.has(e.id))
      .map((e) => ({ id: e.id, label: resolveName(e.id) }));
  // Knowers = the Audience singleton + every alive character (for the Knowledge
  // tile). Audience vid mirrors the backend formula `audience_<slug(project)>`.
  const projSlug = projectId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  const knowerCandidates: Array<{ id: string; label: string }> = [
    { id: `audience_${projSlug}`, label: 'Audience' },
    ...allEntities
      .filter((e) => e.type === 'character' && !e.deleted_at)
      .map((e) => ({ id: e.id, label: resolveName(e.id) })),
  ];

  const tiles: SectionTileDef[] = [
    {
      id: 'summary', label: 'Summary', accent: color, defaultW: 2, defaultExpanded: true,
      hint: "The scene's summary and description. Editable inline.",
      content: (
        <div>
          <InlineText
            value={entity.summary ?? ''}
            placeholder="Add a summary…"
            style={{ marginBottom: 8 }}
            onSave={(d) =>
              updateCardDescription({ cardId: entity.id, projectId, description: d }, auth.token)
                .then(() => onEntitiesChanged())
                .catch((err) => {
                  // FIL-518 stage 3: failed push queues for durable retry
                  // instead of silently dropping the writer's summary.
                  queueEditGlobal(projectId, { cardId: entity.id, field: 'description', value: d });
                  console.warn('[sheets] summary push failed; queued for retry', err);
                })
            }
          />
          {entity.evidence_quote && (
            <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`, fontSize: 11, color: dark ? '#8e8e98' : '#777', fontStyle: 'italic', lineHeight: 1.5 }}>
              "{entity.evidence_quote}"
            </blockquote>
          )}
        </div>
      ),
    },
    {
      id: 'throughline', label: 'Throughline', accent: color, defaultW: 1, defaultExpanded: true,
      hint: 'Where this scene sits in the PRECEDES chain: what comes before and after.',
      content: (
        <EventThroughlineEditor focal={entity} allEntities={allEntities} edges={edges} auth={auth} projectId={projectId} accentColor={color} onOpenCard={onOpenCard} onChanged={onEntitiesChanged} />
      ),
    },
    {
      id: 'sequence', label: 'Sequence', accent: getEntityColor('sequence'), defaultW: 1,
      defaultExpanded: (edges.contains ?? []).some((c) => c.to === entity.id),
      summary: (edges.contains ?? []).some((c) => c.to === entity.id) ? '1' : '0',
      hint: 'The sequence (container) this scene belongs to. A scene belongs to at most one; assigning to a new one moves it.',
      content: (
        <EventSequenceAssign event={entity} allEntities={allEntities} edges={edges} auth={auth} projectId={projectId} onChanged={onEntitiesChanged} />
      ),
    },
    {
      id: 'arcs', label: 'Evokes arcs', summary: `${signal.evokesArcEntries?.length ?? 0}`, accent: '#a855f7', defaultW: 1, defaultExpanded: (signal.evokesArcEntries?.length ?? 0) > 0,
      hint: 'Arcs this scene evokes, with the transition each one makes here.',
      content: (
        <EventEvokesEditor eventId={entity.id} eventNarrativeStatus={(entity.narrative_status as string) ?? 'on_screen'} arcsEvoked={signal.evokesArcEntries ?? []} allEntities={allEntities} auth={auth} projectId={projectId} onOpenCard={onOpenCard} onChanged={onEntitiesChanged} />
      ),
    },
    {
      id: 'knowledge', label: 'Knowledge', summary: `${sceneKnowledge.length}`, accent: '#0ea5e9', defaultW: 2, defaultExpanded: sceneKnowledge.length > 0,
      hint: "What's known, suspected, or hidden as of this scene.",
      content: (
        <KnowledgeEditor
          eventId={entity.id}
          facts={knowledgeFacts}
          factCandidates={knowledgeFactCandidates}
          knowledgeByInfo={knowledgeByInfo}
          knowerCandidates={knowerCandidates}
          resolveName={resolveName}
          projectId={projectId}
          auth={auth}
          onChanged={onEntitiesChanged}
        />
      ),
    },
    {
      id: 'established', label: 'Established here', summary: `${infoHere.length}`, accent: '#64748b', defaultW: 2, defaultExpanded: infoHere.length > 0,
      hint: 'Story facts first established in this scene.',
      content: (
        <EstablishedHereEditor
          eventId={entity.id}
          projectId={projectId}
          auth={auth}
          facts={infoHere.map((i) => ({
            id: i.id,
            summary: i.summary,
            // Removing here deletes the fact entirely (backend GC) only if it's
            // established nowhere else AND no one knows it.
            willDelete:
              !(i.established_in_event_ids ?? []).some((eid) => eid !== entity.id) &&
              !(edges.knowledge ?? []).some((k) => k.info_id === i.id),
            superseded: Boolean((i as any).superseded_by_pages),
            supersededNote: String((i as any).drift_note ?? ''),
          }))}
          accent="#64748b"
          onChanged={onEntitiesChanged}
        />
      ),
    },
    {
      id: 'causality', label: 'Causality', summary: `${causesIn.length + causesOut.length}`, accent: '#e8833a', defaultW: 2, defaultExpanded: (causesIn.length + causesOut.length) > 0,
      hint: 'CAUSES links into and out of this scene, layered over sequence.',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#c2410c', marginBottom: 5 }}>
              Causes →
            </div>
            <EdgeChips
              accent="#e8833a"
              addLabel="effect"
              emptyHint="nothing yet"
              items={causesOut.map((c) => ({ id: c.to, label: resolveName(c.to) }))}
              candidates={causalCandidates(new Set(causesOut.map((c) => c.to)))}
              onAdd={(id) => tagCauses({ fromId: entity.id, toId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
              onRemove={(id) => untagCauses({ fromId: entity.id, toId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
            />
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#c2410c', marginBottom: 5 }}>
              ← Caused by
            </div>
            <EdgeChips
              accent="#e8833a"
              addLabel="cause"
              emptyHint="nothing yet"
              items={causesIn.map((c) => ({ id: c.from, label: resolveName(c.from) }))}
              candidates={causalCandidates(new Set(causesIn.map((c) => c.from)))}
              onAdd={(id) => tagCauses({ fromId: id, toId: entity.id, projectId }, auth.token).then(() => onEntitiesChanged())}
              onRemove={(id) => untagCauses({ fromId: id, toId: entity.id, projectId }, auth.token).then(() => onEntitiesChanged())}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'cast', label: 'Cast', summary: `${castIds.length}`, accent: getEntityColor('character'), defaultW: 1, defaultExpanded: castIds.length > 0,
      hint: 'Characters involved in this scene, including its subjects.',
      content: (
        <EdgeChips
          accent={getEntityColor('character')}
          addLabel="character"
          emptyHint="no cast yet"
          items={castIds.map((id) => ({ id, label: resolveName(id) }))}
          candidates={characterCandidates(new Set(castIds))}
          onAdd={(id) => tagEventInvolvesCharacter({ eventId: entity.id, characterId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
          onRemove={(id) => untagEventInvolvesCharacter({ eventId: entity.id, characterId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
        />
      ),
    },
    {
      id: 'location', label: 'Location', summary: `${occursInIds.length}`, accent: getEntityColor('location'), defaultW: 1, defaultExpanded: occursInIds.length > 0,
      hint: 'Where this scene takes place.',
      content: (
        <EdgeChips
          accent={getEntityColor('location')}
          addLabel="location"
          emptyHint="no location yet"
          items={occursInIds.map((id) => ({ id, label: resolveName(id) }))}
          candidates={locationCandidates(new Set(occursInIds))}
          onAdd={(id) => tagEventOccursIn({ eventId: entity.id, locationId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
          onRemove={(id) => untagEventOccursIn({ eventId: entity.id, locationId: id, projectId }, auth.token).then(() => onEntitiesChanged())}
        />
      ),
    },
    {
      id: 'subevents', label: 'Sub-events', summary: `${entity.sub_events?.length ?? 0}`, accent: color, defaultW: 2, defaultExpanded: (entity.sub_events?.length ?? 0) > 0,
      hint: 'Beat-level breakdown (sluglines) for this scene. Writer-authored.',
      content: (
        <SubEventSubcards entity={entity} auth={auth} projectId={projectId} accentColor={color} onChanged={onEntitiesChanged} />
      ),
    },
    {
      id: 'working', label: 'Open Questions', summary: questions == null ? '…' : `${byStatus.open.length} open`, accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: 'Ask the peer about this card, answer inline, or open a chat thread.',
      content: (
        <OpenQuestionsPanel
          entity={entity}
          projectId={projectId}
          auth={auth}
          completedResponseIds={completedResponseIds}
          questions={questions}
          onCardQuestionsChanged={refetchQuestions}
          onEntitiesChanged={onEntitiesChanged}
          accentColor={PEER_BLUE}
        />
      ),
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: dark ? '#101013' : '#fafafa', zIndex: 200,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 28px', background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
              color, fontWeight: 600,
            }}
          >
            EVENT
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: dark ? '#e6e6ea' : '#1a1a1a', lineHeight: 1 }}>
            {entity.working_title ?? entity.id}
          </span>
          <NarrativeStatusToggle
            value={(entity.narrative_status as NarrativeStatus) ?? 'on_screen'}
            onChange={onChangeNarrativeStatus}
          />
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', fontSize: 20,
            color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 4,
          }}
          aria-label="Close event sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Bento section tiles (card-surface rework) */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BentoSheet tiles={tiles} columns={4} persistKey={`event:${entity.id}`} buildDefaultLayout={buildEventBentoLayout} />
      </div>
    </div>
  );
}

// =====================================================================
// SubEventSubcards — editable scene-card list. Writer Duet-pattern.
// =====================================================================

export function SubEventSubcards({
  entity,
  auth,
  projectId,
  accentColor,
  onChanged,
}: {
  entity: ProjectEntity;
  auth: { userId: string; token: string };
  projectId: string;
  accentColor: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const initial = useMemo<SubEvent[]>(
    () =>
      (entity.sub_events ?? []).map((s: any) => ({
        slugline: s?.slugline ?? '',
        description: s?.description ?? '',
      })),
    [entity.sub_events],
  );
  const [subs, setSubs] = useState<SubEvent[]>(initial);
  const [outlineMode, setOutlineMode] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Debounced save: any local mutation queues a save 700ms later.
  const scheduleSave = useCallback(
    (next: SubEvent[]) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveTimer.current = window.setTimeout(async () => {
        try {
          const res = await updateEventSubEvents(
            { cardId: entity.id, projectId, subEvents: next },
            auth.token,
          );
          setSaveStatus('saved');
          setLastSavedAt(res.updatedAt);
          onChanged();
        } catch (err: any) {
          setSaveStatus('error');
          setSaveError(err.message ?? String(err));
        }
      }, 700);
    },
    [entity.id, projectId, auth.token, onChanged],
  );

  const mutate = (next: SubEvent[]) => {
    setSubs(next);
    scheduleSave(next);
  };

  const updateField = (idx: number, field: 'slugline' | 'description', value: string) => {
    const next = subs.map((s, i) => (i === idx ? { ...s, [field]: value } : s));
    mutate(next);
  };

  const addSubcard = () => {
    const next = [...subs, { slugline: '', description: '' }];
    mutate(next);
    setExpandedIdx(next.length - 1);
  };

  const deleteSubcard = (idx: number) => {
    const next = subs.filter((_, i) => i !== idx);
    mutate(next);
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const moveSubcard = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= subs.length) return;
    const next = [...subs];
    [next[idx], next[j]] = [next[j], next[idx]];
    mutate(next);
    if (expandedIdx === idx) setExpandedIdx(j);
    else if (expandedIdx === j) setExpandedIdx(idx);
  };

  const saveLabel =
    saveStatus === 'saving'
      ? 'saving…'
      : saveStatus === 'saved'
      ? lastSavedAt ? `saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'saved'
      : saveStatus === 'error'
      ? `save failed${saveError ? `: ${saveError}` : ''}`
      : '';

  return (
    <div
      style={{
        background: dark ? '#1a1a1e' : '#fff', border: dark ? '1px solid #2a2a30' : '1px solid #e5e5e5', borderRadius: 6,
        padding: 14, flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12, flexShrink: 0,
        }}
      >
        <h3
          style={{
            fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase',
            color: dark ? '#82828c' : '#888', fontWeight: 600, margin: 0,
          }}
        >
          Sub-events · {subs.length}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10.5, color: saveStatus === 'error' ? 'crimson' : '#888' }}>
            {saveLabel}
          </span>
          <label style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666', cursor: 'pointer', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={outlineMode}
              onChange={(e) => setOutlineMode(e.target.checked)}
              style={{ margin: 0 }}
            />
            outline only
          </label>
        </div>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        {subs.length === 0 ? (
          <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 13, padding: 16, textAlign: 'center' }}>
            No sub-events yet. Add one below to start mapping the scene.
          </div>
        ) : (
          subs.map((s, idx) => (
            <SubcardRow
              key={idx}
              index={idx}
              total={subs.length}
              slugline={s.slugline ?? ''}
              description={s.description ?? ''}
              accentColor={accentColor}
              isExpanded={!outlineMode && expandedIdx === idx}
              outlineMode={outlineMode}
              onToggleExpand={() => setExpandedIdx((cur) => (cur === idx ? null : idx))}
              onSluglineChange={(v) => updateField(idx, 'slugline', v)}
              onDescriptionChange={(v) => updateField(idx, 'description', v)}
              onMoveUp={() => moveSubcard(idx, -1)}
              onMoveDown={() => moveSubcard(idx, 1)}
              onDelete={() => deleteSubcard(idx)}
            />
          ))
        )}
      </div>

      <button
        onClick={addSubcard}
        style={{
          marginTop: 12, padding: '8px 12px', flexShrink: 0,
          background: hexToRgba(accentColor, 0.08), color: accentColor,
          border: `1px dashed ${hexToRgba(accentColor, 0.4)}`,
          borderRadius: 4, fontSize: 12, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
        }}
      >
        + Add sub-event
      </button>
    </div>
  );
}

export function SubcardRow({
  index, total, slugline, description, accentColor,
  isExpanded, outlineMode,
  onToggleExpand, onSluglineChange, onDescriptionChange,
  onMoveUp, onMoveDown, onDelete,
}: {
  index: number;
  total: number;
  slugline: string;
  description: string;
  accentColor: string;
  isExpanded: boolean;
  outlineMode: boolean;
  onToggleExpand: () => void;
  onSluglineChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const expanded = isExpanded && !outlineMode;
  return (
    <div
      style={{
        border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${accentColor}`,
        borderRadius: 4, marginBottom: 8, background: dark ? '#1a1a1e' : '#fff',
        transition: 'border-color 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 10px' }}>
        <span
          style={{
            fontSize: 10, color: dark ? '#6e6e78' : '#aaa', fontFamily: 'monospace',
            paddingTop: 5, minWidth: 18,
          }}
        >
          {index + 1}
        </span>
        <input
          value={slugline}
          onChange={(e) => onSluglineChange(e.target.value)}
          placeholder="INT. LOCATION — TIME"
          style={{
            flex: 1, fontFamily: 'monospace', fontSize: 12.5,
            border: 'none', outline: 'none', background: 'transparent',
            padding: '4px 0', color: dark ? '#e6e6ea' : '#222', letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        />
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={onToggleExpand}
            disabled={outlineMode}
            style={{ ...miniActionBtn, padding: '2px 4px', fontSize: 11 }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            style={{ ...miniActionBtn, padding: '2px 4px', fontSize: 11 }}
            title="Move up"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            style={{ ...miniActionBtn, padding: '2px 4px', fontSize: 11 }}
            title="Move down"
          >
            ↓
          </button>
          <button
            onClick={onDelete}
            style={{ ...miniActionBtn, padding: '2px 4px', fontSize: 11, color: '#c44' }}
            title="Delete sub-event"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 10px 34px' }}>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="What happens in this beat."
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              fontFamily: 'system-ui, sans-serif', fontSize: 12.5, lineHeight: 1.5,
              padding: '6px 8px', border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderRadius: 3,
              outline: 'none', resize: 'vertical', minHeight: 60,
              color: dark ? '#c2c2ca' : '#444', background: dark ? '#101013' : '#fafafa',
            }}
          />
        </div>
      )}
    </div>
  );
}

// =====================================================================
// LocationSheet — level-3 sheet for Location entities. Identity panel +
// list of Events that OCCURS_IN this location. No peer support (slice
// loader is character/event-only today).
// =====================================================================

export function LocationSheet({
  entity,
  allEntities,
  edges,
  onClose,
}: {
  entity: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  onClose: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('location');
  const eventsById = new Map(allEntities.map((e) => [e.id, e]));

  // Events that occur in this location (Event → Location via OCCURS_IN).
  const eventsHere = (edges.occurs_in ?? [])
    .filter((e) => e.to === entity.id)
    .map((e) => eventsById.get(e.from))
    .filter((e): e is ProjectEntity => !!e);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: dark ? '#101013' : '#fafafa', zIndex: 200,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 28px', background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
              color, fontWeight: 600,
            }}
          >
            LOCATION
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: dark ? '#e6e6ea' : '#1a1a1a', lineHeight: 1 }}>
            {entity.working_name ?? entity.id}
          </span>
          {entity.int_ext && (
            <span
              style={{
                fontSize: 10, padding: '3px 8px',
                background: dark ? '#202025' : '#f5f5f5', color: dark ? '#9a9aa4' : '#666',
                borderRadius: 3, fontWeight: 600,
              }}
            >
              {entity.int_ext}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', fontSize: 20,
            color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 4,
          }}
          aria-label="Close location sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '320px minmax(0, 1fr)',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        <SheetColumn>
          <SheetPanel title="Identity">
            {entity.description && (
              <p style={{ fontSize: 13, lineHeight: 1.55, color: dark ? '#dcdce2' : '#333', margin: '0 0 8px' }}>
                {entity.description}
              </p>
            )}
            {entity.evidence_quote && (
              <blockquote
                style={{
                  margin: 0, paddingLeft: 10,
                  borderLeft: `2px solid ${hexToRgba(color, 0.3)}`,
                  fontSize: 11, color: dark ? '#8e8e98' : '#777', fontStyle: 'italic', lineHeight: 1.5,
                }}
              >
                "{entity.evidence_quote}"
              </blockquote>
            )}
            {!entity.description && !entity.evidence_quote && (
              <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', margin: 0 }}>
                No description yet. Add prose via braindump to develop this location.
              </p>
            )}
          </SheetPanel>
        </SheetColumn>

        <SheetColumn>
          <SheetPanel title={`Events here · ${eventsHere.length}`} fill>
            {eventsHere.length === 0 ? (
              <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa' }}>
                No events yet take place here.
              </p>
            ) : (
              eventsHere.map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: '10px 12px', marginBottom: 8,
                    border: dark ? '1px solid #2a2a30' : '1px solid #eee',
                    borderLeft: `3px solid ${narrativeStatusFg(e.narrative_status ?? '')}`,
                    borderRadius: 4, background: dark ? '#1a1a1e' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {e.narrative_status && (
                      <span
                        style={{
                          fontSize: 9, padding: '2px 6px',
                          background: narrativeStatusBg(e.narrative_status),
                          color: narrativeStatusFg(e.narrative_status),
                          borderRadius: 2, textTransform: 'uppercase',
                          letterSpacing: 0.3, fontWeight: 600,
                        }}
                      >
                        {narrativeStatusLabel(e.narrative_status)}
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#e6e6ea' : '#222' }}>
                      {e.working_title ?? e.id}
                    </span>
                  </div>
                  {e.summary && (
                    <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.45 }}>
                      {e.summary}
                    </div>
                  )}
                </div>
              ))
            )}
          </SheetPanel>
        </SheetColumn>
      </div>
    </div>
  );
}

// =====================================================================
// RelationshipSheet — level-3 sheet for reified Relationship vertices.
// Identity (kind/description/rationale/open_dimensions) + the two endpoint
// Characters + Events involving both. Relationships are extraction-only;
// the sheet is display + minimal edit (rename + delete via card affordance).
// =====================================================================

export function RelationshipSheet({
  entity,
  allEntities,
  edges,
  auth,
  projectId,
  onClose,
  onUpdateDescription,
  onEntitiesChanged,
}: {
  entity: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  onClose: () => void;
  onUpdateDescription: (description: string) => Promise<void>;
  onEntitiesChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('relationship');
  const charA = entity.character_a ?? '';
  const charB = entity.character_b ?? '';
  const openDims = entity.open_dimensions ?? [];

  // Resolve endpoint Character entities by working_name (the strings stored
  // on the Relationship vertex). Falls back to undefined if the Character
  // isn't surfaced (e.g., deleted; rename mismatch).
  const findChar = (name: string) =>
    allEntities.find(
      (e) => e.type === 'character' && (e.working_name === name || e.aliases?.includes(name)),
    );
  const charAEntity = findChar(charA);
  const charBEntity = findChar(charB);

  // Events that involve BOTH endpoint characters. Walk INVOLVES edges, group
  // by Event, surface only Events with both endpoints in their `to` set.
  const involvesByEvent = new Map<string, Set<string>>();
  for (const inv of edges.involves ?? []) {
    if (!involvesByEvent.has(inv.from)) involvesByEvent.set(inv.from, new Set());
    involvesByEvent.get(inv.from)!.add(inv.to);
  }
  const sharedEvents: ProjectEntity[] = [];
  for (const [eventId, charIds] of involvesByEvent) {
    if (!charAEntity || !charBEntity) continue;
    if (charIds.has(charAEntity.id) && charIds.has(charBEntity.id)) {
      const evt = allEntities.find((e) => e.id === eventId && e.type === 'event');
      if (evt) sharedEvents.push(evt);
    }
  }

  const tiles: SectionTileDef[] = [
    {
      id: 'identity', label: 'Summary', accent: color, defaultExpanded: true,
      hint: "The relationship's kind and description. Editable inline.",
      content: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 0.5, color: dark ? '#82828c' : '#888', textTransform: 'uppercase', marginBottom: 4 }}>
              Kind
            </div>
            <InlineText
              value={(entity.kind as string) ?? ''}
              placeholder="e.g. married, rivalry, former partners…"
              multiline={false}
              onSave={(d) =>
                updateRelationshipKind({ projectId, cardId: entity.id, kind: d.trim() }, auth.token).then(
                  () => onEntitiesChanged(),
                )
              }
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 0.5, color: dark ? '#82828c' : '#888', textTransform: 'uppercase', marginBottom: 4 }}>
              Description
            </div>
            <InlineText
              value={entity.description ?? ''}
              placeholder="Describe this relationship…"
              onSave={(d) => onUpdateDescription(d)}
            />
          </div>
          {entity.rationale && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: 0.5, color: dark ? '#82828c' : '#888', textTransform: 'uppercase', marginBottom: 3 }}>
                Rationale
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.5, color: dark ? '#b2b2bc' : '#555', margin: 0 }}>{entity.rationale}</p>
            </div>
          )}
          {entity.evidence_quote && (
            <blockquote style={{ margin: '8px 0 0', paddingLeft: 10, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`, fontSize: 11, color: dark ? '#8e8e98' : '#777', fontStyle: 'italic', lineHeight: 1.5 }}>
              "{entity.evidence_quote}"
            </blockquote>
          )}
        </div>
      ),
    },
    {
      id: 'shared', label: 'Shared events', summary: `${sharedEvents.length}`, accent: narrativeStatusFg('on_screen'),
      hint: 'Scenes both characters appear in together.',
      defaultExpanded: true,
      content: sharedEvents.length === 0 ? (
        <p style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', margin: 0 }}>No events involve both characters yet.</p>
      ) : (
        <div>
          {sharedEvents.map((e) => (
            <div key={e.id} style={{ padding: '10px 12px', marginBottom: 8, border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${narrativeStatusFg(e.narrative_status ?? '')}`, borderRadius: 4, background: dark ? '#1a1a1e' : '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {e.narrative_status && (
                  <span style={{ fontSize: 9, padding: '2px 6px', background: narrativeStatusBg(e.narrative_status), color: narrativeStatusFg(e.narrative_status), borderRadius: 2, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>
                    {narrativeStatusLabel(e.narrative_status)}
                  </span>
                )}
                <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#e6e6ea' : '#222' }}>{e.working_title ?? e.id}</span>
              </div>
              {e.summary && (
                <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.45 }}>{e.summary}</div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'endpoints', label: 'Endpoints', accent: getEntityColor('character'), defaultExpanded: true,
      hint: 'The two characters this relationship connects.',
      content: (
        <div>
          {[{ name: charA, ent: charAEntity }, { name: charB, ent: charBEntity }].map(({ name, ent }, i) => (
            <div key={i} style={{ padding: '12px 14px', marginBottom: 10, border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${getEntityColor('character')}`, borderRadius: 4, background: dark ? '#1a1a1e' : '#fff' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: dark ? '#e6e6ea' : '#222', marginBottom: 4 }}>
                {name}
                {!ent && <span style={{ fontSize: 10, color: '#c44', marginLeft: 8 }}>(not found on canvas)</span>}
              </div>
              {ent?.description && (
                <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.45 }}>{ent.description}</div>
              )}
              {ent?.established_traits && ent.established_traits.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {ent.established_traits.slice(0, 4).map((t, j) => (
                    <span key={j} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: hexToRgba(getEntityColor('character'), 0.12), color: dark ? '#b2b2bc' : '#555' }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'opendims', label: 'Open dimensions', summary: `${openDims.length}`, accent: color,
      hint: 'Unresolved tensions in this relationship that still need to land.',
      defaultExpanded: openDims.length > 0,
      content: openDims.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>None yet.</div>
      ) : (
        <div>
          {openDims.map((d, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: dark ? '#dcdce2' : '#333', lineHeight: 1.45, fontWeight: 500 }}>{d.tension}</div>
              {d.why_it_matters && (
                <div style={{ fontSize: 11, color: dark ? '#82828c' : '#888', lineHeight: 1.4, marginTop: 3 }}>{d.why_it_matters}</div>
              )}
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: dark ? '#101013' : '#fafafa', zIndex: 200,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 28px', background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
              color, fontWeight: 600,
            }}
          >
            RELATIONSHIP
          </span>
          <span style={{ fontSize: 22, fontWeight: 500, color: dark ? '#e6e6ea' : '#1a1a1a', lineHeight: 1 }}>
            {/* Roles render per endpoint when the bond is asymmetric (the
                2026-07-25 convention: kind = bond noun, roles = who is what). */}
            {charA}
            {entity.role_a && entity.role_a !== entity.role_b && (
              <span style={{ fontSize: 12, color: dark ? '#82828c' : '#888' }}> ({String(entity.role_a).replace(/_/g, ' ')})</span>
            )}
            {' ↔ '}
            {charB}
            {entity.role_b && entity.role_a !== entity.role_b && (
              <span style={{ fontSize: 12, color: dark ? '#82828c' : '#888' }}> ({String(entity.role_b).replace(/_/g, ' ')})</span>
            )}
          </span>
          {entity.kind && (
            <span style={{ fontSize: 11, color: dark ? '#82828c' : '#888', fontStyle: 'italic' }}>
              {String(entity.kind).replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', fontSize: 20,
            color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 4,
          }}
          aria-label="Close relationship sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Bento section tiles */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BentoSheet tiles={tiles} columns={4} persistKey={`relationship:${entity.id}`} buildDefaultLayout={buildRelationshipBentoLayout} />
      </div>
    </div>
  );
}

// Picks the writer-chosen thread/ball color for an arc. Swatches come from the
// canvas ARC_THREAD_PALETTE so the picker matches what the threads actually use;
// "Auto" clears the color back to the index-assigned palette default. Writes via
// update-arc (color: hex | '') then refetches so the canvas thread recolors.
export function ArcColorRow({
  arcId,
  current,
  auth,
  projectId,
  onChanged,
}: {
  arcId: string;
  current?: string;
  auth: { userId: string; token: string };
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [busy, setBusy] = useState(false);
  const sel = current && current.trim() ? current.trim().toLowerCase() : '';
  const pick = async (c: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateArc({ arcId, projectId, color: c }, auth.token);
      onChanged();
    } catch (e) {
      console.warn('[arc-color] update failed', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 6 }}>
        Thread color
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, opacity: busy ? 0.5 : 1 }}>
        {ARC_THREAD_PALETTE.map((c) => {
          const active = sel === c.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => pick(c)}
              title={c}
              aria-label={`Set thread color ${c}`}
              style={{
                width: 22, height: 22, borderRadius: '50%', background: c,
                cursor: busy ? 'default' : 'pointer', padding: 0,
                border: active ? '2px solid #1f2937' : '2px solid #fff',
                boxShadow: active ? `0 0 0 2px ${c}` : '0 0 0 1px rgba(0,0,0,0.12)',
              }}
            />
          );
        })}
        <button
          onClick={() => pick('')}
          title="Auto (palette default)"
          aria-label="Clear thread color"
          style={{
            height: 22, padding: '0 9px', borderRadius: 11, fontSize: 10, fontWeight: 600,
            letterSpacing: 0.3, textTransform: 'uppercase', cursor: busy ? 'default' : 'pointer',
            background: sel === '' ? '#1f2937' : '#fff', color: sel === '' ? '#fff' : '#666',
            border: sel === '' ? '2px solid #1f2937' : '1px solid #d1d5db',
          }}
        >
          Auto
        </button>
      </div>
    </div>
  );
}

// Sequence container color — mirrors ArcColorRow. Default is the sequence green;
// the writer can pick any palette hue (drives the canvas container box + label).
const SEQUENCE_PALETTE = ['#22c55e', ...ARC_THREAD_PALETTE.filter((c) => c.toLowerCase() !== '#22c55e')];
export function SequenceColorRow({
  sequenceId,
  current,
  auth,
  projectId,
  onChanged,
}: {
  sequenceId: string;
  current?: string;
  auth: { userId: string; token: string };
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [busy, setBusy] = useState(false);
  const sel = current && current.trim() ? current.trim().toLowerCase() : '';
  const pick = async (c: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await setSequenceColor({ sequenceId, projectId, color: c }, auth.token);
      onChanged();
    } catch (e) {
      console.warn('[sequence-color] update failed', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 6 }}>
        Container color
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, opacity: busy ? 0.5 : 1 }}>
        {SEQUENCE_PALETTE.map((c) => {
          const active = sel === c.toLowerCase() || (sel === '' && c === '#22c55e');
          return (
            <button
              key={c}
              onClick={() => pick(c === '#22c55e' ? '' : c)}
              title={c}
              aria-label={`Set sequence color ${c}`}
              style={{
                width: 22, height: 22, borderRadius: '50%', background: c,
                cursor: busy ? 'default' : 'pointer', padding: 0,
                border: active ? '2px solid #1f2937' : '2px solid #fff',
                boxShadow: active ? `0 0 0 2px ${c}` : '0 0 0 1px rgba(0,0,0,0.12)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Assign an Event to a Sequence (its container). Disjoint — an event belongs to
// at most one sequence; assigning to a new one moves it. Used in the EventSheet.
export function EventSequenceAssign({
  event,
  allEntities,
  edges,
  auth,
  projectId,
  onChanged,
}: {
  event: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const currentSeqId = (edges.contains ?? []).find((c) => c.to === event.id)?.from;
  const currentSeq = currentSeqId
    ? allEntities.find((e) => e.id === currentSeqId && e.type === 'sequence' && !e.deleted_at)
    : undefined;
  const sequences = allEntities
    .filter((e) => e.type === 'sequence' && !e.deleted_at)
    .sort((a, b) => (a.working_title ?? '').localeCompare(b.working_title ?? ''));
  const color = getEntityColor('sequence');

  const assign = async (sequenceId: string) => {
    if (busy) return;
    setBusy(true);
    setPicking(false);
    try {
      await tagSequenceContains({ sequenceId, eventId: event.id, projectId }, auth.token);
      onChanged();
    } catch (e) {
      console.warn('[event-sequence] assign failed', e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy || !currentSeqId) return;
    setBusy(true);
    try {
      await untagSequenceContains({ sequenceId: currentSeqId, eventId: event.id, projectId }, auth.token);
      onChanged();
    } catch (e) {
      console.warn('[event-sequence] remove failed', e);
    } finally {
      setBusy(false);
    }
  };

  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px',
    borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${hexToRgba(color, 0.4)}`, background: hexToRgba(color, 0.14), color,
  };
  return (
    <div style={{ opacity: busy ? 0.5 : 1 }}>
      {currentSeq ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={chip}>{currentSeq.working_title ?? 'Sequence'}</span>
          <button onClick={remove} title="Remove from sequence"
            style={{ background: 'transparent', border: 'none', color: dark ? '#82828c' : '#999', fontSize: 12, cursor: 'pointer' }}>
            remove
          </button>
          <button onClick={() => setPicking((p) => !p)}
            style={{ background: 'transparent', border: 'none', color, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            change
          </button>
        </div>
      ) : (
        <button onClick={() => setPicking((p) => !p)} style={{ ...chip, borderStyle: 'dashed' }}>
          + assign to sequence
        </button>
      )}
      {picking && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          {sequences.length === 0 ? (
            <span style={{ fontSize: 12, color: dark ? '#82828c' : '#999' }}>No sequences yet.</span>
          ) : (
            sequences.map((s) => (
              <button key={s.id} onClick={() => assign(s.id)} disabled={s.id === currentSeqId}
                style={{
                  textAlign: 'left', padding: '6px 9px', borderRadius: 7, fontSize: 12.5,
                  border: `1px solid ${dark ? '#2a2a30' : '#e6e6ea'}`,
                  background: s.id === currentSeqId ? hexToRgba(color, 0.12) : (dark ? '#1d1d23' : '#fff'),
                  color: dark ? '#dcdce2' : '#333', cursor: s.id === currentSeqId ? 'default' : 'pointer',
                }}>
                {s.working_title ?? s.id}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// ArcSheet (FIL-504 / D'-6) — level-3 view of a reified Arc vertex.
//
// Three columns:
//   1. Identity      — name (editable) + kind chip + description (editable) +
//                      evidence_quote + open_dimensions + aliases
//   2. Timeline      — the "music sheet": full EVOKES sequence in PRECEDES
//                      order (per-row event title + narrative_status badge +
//                      transition chip + state_at_event text); click event
//                      title to jump into that event's sheet
//   3. Cross-refs    — INVOLVES characters (clickable); future-slots for
//                      CAUSES (F) + Light :Question links
//
// Per Q6 lock: Arc carries no current_state or status — both are derived
// per render from the EVOKES sequence. The status_label rendered at the top
// of the timeline mirrors the slice composer's logic.
// =====================================================================

export function ArcSheet({
  entity,
  signal,
  allEntities,
  edges,
  auth,
  projectId,
  onClose,
  onRename,
  onUpdateDescription,
  onOpenCard,
  onEntitiesChanged,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
  onUpdateDescription: (description: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  onEntitiesChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('arc');
  const kind = (entity.kind as ArcKind | undefined) ?? undefined;
  const evokes = signal.evokesEntries ?? [];
  const involvedCharNames = signal.arcInvolvesCharNames ?? [];
  const openDimensions = entity.open_dimensions ?? [];
  const aliases = entity.aliases ?? [];

  const tiles: SectionTileDef[] = [
    {
      id: 'identity', label: 'Summary', accent: color, defaultExpanded: true,
      hint: "The arc's name, description, color, and any former names.",
      content: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 4 }}>
              Description
            </div>
            <EditableDescription value={entity.description ?? ''} onSave={onUpdateDescription} placeholder="What this arc is about…" />
          </div>
          <ArcColorRow
            arcId={entity.id}
            current={entity.color}
            auth={auth}
            projectId={projectId}
            onChanged={onEntitiesChanged}
          />
          {entity.evidence_quote && (
            <blockquote style={{ margin: '0 0 12px', paddingLeft: 10, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`, fontSize: 11, color: dark ? '#8e8e98' : '#777', fontStyle: 'italic', lineHeight: 1.5 }}>
              "{entity.evidence_quote}"
            </blockquote>
          )}
          {aliases.length > 0 && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#888', fontWeight: 600, marginBottom: 4 }}>
                Formerly
              </div>
              <div style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666', lineHeight: 1.4 }}>{aliases.join(' · ')}</div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'timeline', label: 'Timeline', summary: `${evokes.length} event${evokes.length === 1 ? '' : 's'}`, accent: color,
      hint: 'The scenes this arc passes through, in story order, with each transition.',
      defaultExpanded: true,
      content: (
        <ArcEvokesEditor
          arcId={entity.id}
          arcColor={color}
          evokes={evokes}
          allEntities={allEntities}
          auth={auth}
          projectId={projectId}
          onOpenCard={onOpenCard}
          onChanged={onEntitiesChanged}
        />
      ),
    },
    {
      id: 'involves', label: 'Involves', summary: `${involvedCharNames.length}`, accent: getEntityColor('character'),
      hint: 'Characters this arc involves.',
      defaultExpanded: involvedCharNames.length > 0,
      content: (
        <ArcInvolvesEditor
          arcId={entity.id}
          arcColor={color}
          involvedNames={involvedCharNames}
          allEntities={allEntities}
          edges={edges}
          auth={auth}
          projectId={projectId}
          onChanged={onEntitiesChanged}
        />
      ),
    },
    {
      id: 'opendims', label: 'Open dimensions', summary: `${openDimensions.length}`, accent: color,
      hint: 'Unresolved tensions in this arc that still need to land.',
      defaultExpanded: openDimensions.length > 0,
      content: openDimensions.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>None yet.</div>
      ) : (
        <div>
          {openDimensions.map((d, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: dark ? '#dcdce2' : '#333', lineHeight: 1.45, marginBottom: 4 }}>{d.tension}</div>
              {d.why_it_matters && (
                <div style={{ fontSize: 11, color: dark ? '#82828c' : '#888', lineHeight: 1.45 }}>{d.why_it_matters}</div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'crossrefs', label: 'Cross-refs', accent: '#94a3b8', defaultExpanded: false,
      hint: 'Causality and other cross-links from this arc.',
      content: (
        <p style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa', margin: 0, lineHeight: 1.5 }}>
          CAUSES connections and Light :Question links will surface here when
          those layers ship. For v1, the timeline is the canonical surface.
        </p>
      ),
    },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: dark ? '#101013' : '#fafafa', zIndex: 200,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 28px', background: dark ? '#1a1a1e' : '#fff',
          borderBottom: `3px solid ${dark ? hexToRgba(liftColor(color, 0.2), 0.55) : color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
              color, fontWeight: 600,
            }}
          >
            ARC
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableName
              value={entity.working_name ?? entity.id}
              onSave={onRename}
              fontSize={22}
              marginBottom={0}
            />
          </div>
          {kind && (
            <span
              style={{
                fontSize: 10, padding: '3px 8px',
                background: hexToRgba(color, 0.14),
                color: hexToRgba(color, 1),
                borderRadius: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.3,
              }}
            >
              {arcKindLabel(kind)}
            </span>
          )}
          {signal.arcStatusLabel && (
            <span style={{ fontSize: 12, color: dark ? '#9a9aa4' : '#666', fontStyle: 'italic' }}>
              {signal.arcStatusLabel}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', fontSize: 20,
            color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 4,
          }}
          aria-label="Close arc sheet (Esc)"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Bento section tiles */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <BentoSheet tiles={tiles} columns={4} persistKey={`arc:${entity.id}`} buildDefaultLayout={buildArcBentoLayout} />
      </div>
    </div>
  );
}

export function SheetEventTimeline({
  appearsIn,
  eventsById,
  precedesEdges,
}: {
  appearsIn: NonNullable<CardSignal['appearsInEvents']>;
  eventsById: Map<string, ProjectEntity>;
  precedesEdges: Array<{ from: string; to: string }>;
}) {
  const dark = useThemeMode() === 'dark';
  // Sort by PRECEDES chain — story-time order. Topological sort over the
  // subset of appearsIn events, falling back to extraction order for events
  // that aren't linked in any chain (so unrelated beats still appear).
  const sorted = useMemo(
    () => topoSortByPrecedes(appearsIn, precedesEdges),
    [appearsIn, precedesEdges],
  );
  return (
    <div>
      {sorted.map((e) => {
        const full = eventsById.get(e.id);
        const summary = full?.summary ?? '';
        const subEvents = full?.sub_events ?? [];
        return (
          <div
            key={e.id}
            style={{
              padding: '12px 14px',
              marginBottom: 10,
              border: dark ? '1px solid #2a2a30' : '1px solid #eee',
              borderLeft: `3px solid ${narrativeStatusFg(e.narrative_status ?? '')}`,
              borderRadius: 4,
              background: dark ? '#1a1a1e' : '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {e.narrative_status && (
                <span
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    background: narrativeStatusBg(e.narrative_status),
                    color: narrativeStatusFg(e.narrative_status),
                    borderRadius: 2,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    fontWeight: 600,
                  }}
                >
                  {narrativeStatusLabel(e.narrative_status)}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#e6e6ea' : '#222' }}>{e.title}</span>
            </div>
            {summary && (
              <div style={{ fontSize: 12, color: dark ? '#b2b2bc' : '#555', lineHeight: 1.45, marginBottom: subEvents.length > 0 ? 8 : 0 }}>
                {summary}
              </div>
            )}
            {subEvents.length > 0 && (
              <div style={{ paddingLeft: 10, marginTop: 6 }}>
                {subEvents.map((s, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    {s.slugline && (
                      <div style={{ fontSize: 10.5, fontFamily: 'monospace', color: dark ? '#9a9aa4' : '#666' }}>{s.slugline}</div>
                    )}
                    {s.description && (
                      <div style={{ fontSize: 11.5, color: dark ? '#8e8e98' : '#777', lineHeight: 1.45 }}>{s.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
