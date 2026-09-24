// components/Freeform/corkboard/sheets.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { NOTE_FONT_SERIF, PEER_BLUE } from '../../../components/Freeform/tokens';
import { queueEditGlobal } from '../../../lib/storySession';
import { EVOKES_TRANSITIONS, buildArcRun, buildCharacterArc, createArc, setCharacterDevelopment, type BuildArcRunResponse, type BuildCharacterArcResponse, type StopConflict, createInformation, listCardQuestions, setKnowledge, tagArcInvolvesCharacter, tagEventEvokes, unlinkInformation, untagArcInvolvesCharacter, untagEventEvokes, setSequenceColor, tagCauses, tagEventInvolvesCharacter, tagEventOccursIn, tagSequenceContains, untagCauses, untagEventInvolvesCharacter, untagEventOccursIn, untagSequenceContains, updateArc, updateCardDescription, updateEventSubEvents, updateRelationshipKind, type ArcKind, type EvokesTransition, type NarrativeStatus, type PersistedQuestion, type ProjectEdges, type ProjectEntity, type ProjectInformation, type SubEvent } from '../../../lib/freeformApi';
import { OrbitSheet } from './orbit';
import InternIcon from '../InternIcon';
import { toldOrderEvents } from './connectors';
// The bento surface it replaced still lives in ./bento (and still owns
// SectionTileDef, which the orbit consumes unchanged) — swapping a sheet back
// is re-importing BentoSheet and its layout builder. (FIL-588)
import { type SectionTileDef } from './bento';
import { EditableDescription, EditableName, NarrativeStatusToggle } from './cards';
import { ARC_THREAD_PALETTE } from './connectors';
import { ArcEvokesEditor, ArcInvolvesEditor, EdgeChips, EstablishedHereEditor, EventEvokesEditor, EventThroughlineEditor, EvokesArcControls, InlineText, KnowledgeEditor, KnowledgeFactBuckets, type ChipCandidate } from './editors';
import { arcKindLabel, narrativeStatusBg, narrativeStatusFg, narrativeStatusLabel } from './labels';
import { OpenQuestionsPanel, PeerReadProse, QuestionComposer, miniActionBtn, usePeerSession, wowBentoPeerGate } from './peer';
import { createWriterQuestion } from '../../../lib/freeformApi';
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
  information,
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
  /** Facts, for the per-scene "learns" row (direct at_event knowledge only). */
  information?: ProjectInformation[];
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
  const refetchQuestionsRef = useRef<(() => void) | null>(null);
  useEffect(() => { refetchQuestionsRef.current = refetchQuestions; }, [refetchQuestions]);

  // --- Build Arc (character-arc-from-scenes-v2) ------------------------
  // The summoned pass. Cached in localStorage per (project, character) so a
  // reopened sheet shows the last run with a free staleness banner; only the
  // button spends a model call.
  const passKey = `ff-buildarc:${projectId}:${entity.id}`;
  const dismissKey = `ff-buildarc-dismiss:${projectId}:${entity.id}`;
  const [pass, setPass] = useState<BuildCharacterArcResponse | null>(() => {
    try { const raw = localStorage.getItem(`ff-buildarc:${projectId}:${entity.id}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [passBusy, setPassBusy] = useState(false);
  const [passErr, setPassErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(`ff-buildarc-dismiss:${projectId}:${entity.id}`); return new Set(raw ? JSON.parse(raw) : []); } catch { return new Set(); }
  });
  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(key);
      try { localStorage.setItem(dismissKey, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  }, [dismissKey]);
  // Bumping this map's counter for a scene opens that scene's slot editor —
  // how a peer question's Answer button reaches into the slot.
  const [slotOpen, setSlotOpen] = useState<Record<string, number>>({});
  // Which peer question is open, and which has its thread up. Same pair the
  // scene sheet uses: one drives the focal swap, the other the card's width.
  const [peerOpenQuestionId, setPeerOpenQuestionId] = useState<string | null>(null);
  const [peerChatQuestionId, setPeerChatQuestionId] = useState<string | null>(null);
  // One peer session for the sheet — the focal card renders its read, the ring
  // renders its questions.
  const peer = usePeerSession({
    entity,
    projectId,
    userId: auth.userId,
    token: auth.token,
    onCardQuestionsChanged: () => { refetchQuestionsRef.current?.(); },
    onCascadeFallbackRefresh: onEntitiesChanged,
  });


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('character');
  const traits = entity.established_traits ?? [];
  // Memoised because orderedAppearsIn below keys off it; `?? []` alone hands
  // that memo a fresh array on every render and it never caches.
  const appearsIn = useMemo(() => signal.appearsInEvents ?? [], [signal.appearsInEvents]);
  const structuralPeers = signal.structuralPeers ?? [];
  const structuralPreds = signal.structuralPreds ?? [];
  const eventsById = new Map(allEntities.map((e) => [e.id, e]));
  const charName = entity.working_name ?? entity.working_title ?? '';
  // Arcs this character is involved in (reified Arc vertices via arc_involves).
  // The character's PRIMARY arc: the one arc vertex they own. The
  // character_id prop IS the primary marker (v2 design, D-vertex) — such
  // arcs stay out of the Arcs chip, the candidates picker, and the story-arc
  // list; they live in the cascade's band.
  const primaryArc = allEntities.find(
    (a) => a.type === 'arc' && !a.deleted_at && String((a as any).character_id ?? '') === entity.id,
  );
  const charArcs = (edges.arc_involves ?? [])
    .filter((e) => e.character_id === entity.id)
    .map((e) => allEntities.find((x) => x.id === e.arc_id && x.type === 'arc' && !x.deleted_at))
    .filter((a): a is ProjectEntity => !!a)
    .filter((a) => a.id !== primaryArc?.id);
  // Writer's per-scene arc notes, off the INVOLVES edges.
  const involvesDevByEvent = new Map(
    (edges.involves ?? [])
      .filter((e) => e.to === entity.id && (e.development || e.observable_grade))
      .map((e) => [e.from, {
        development: String(e.development ?? ''),
        hash: String(e.development_hash ?? ''),
        // The grade the note was written AGAINST, vs the scene's grade NOW.
        // Their transition is what tiers a divergence (D-flag-tiers).
        noteGrade: String(e.development_grade ?? ''),
        // Who wrote the text. NEVER rendered as a difference: it exists so a
        // pass does not overwrite a person. Absent = predates tracking =
        // treated as the writer's, because that is the safe direction.
        author: String(e.development_author ?? ''),
        observable: String(e.observable ?? ''),
        observableGrade: String(e.observable_grade ?? ''),
      }]),
  );
  // Confirmed turns: EVOKES from a scene to the primary arc. Optimistic
  // entries render the instant Confirm is clicked; the authoritative edge
  // replaces them when the refetch lands (Neptune writes take seconds).
  const [optimisticTurns, setOptimisticTurns] = useState<Record<string, { arc_id: string; transition: string; state_at_event: string; evidence_quote: string }>>({});
  const turnByEvent = new Map<string, any>(
    primaryArc
      ? (edges.evokes ?? []).filter((ev) => ev.arc_id === primaryArc.id).map((ev) => [ev.event_id, ev])
      : [],
  );
  for (const [eid, t] of Object.entries(optimisticTurns)) {
    if (!turnByEvent.has(eid)) turnByEvent.set(eid, t);
  }
  // Reified Relationship vertices involving this character (matched by name).
  const reifiedRels = allEntities.filter(
    (x) =>
      x.type === 'relationship' && !x.deleted_at &&
      (x.character_a === charName || x.character_b === charName),
  );
  const relCount = reifiedRels.length + structuralPeers.length;
  // The Relationships ring is a card per PERSON, the way the scene's Cast is:
  // who this character is tied to, and what the tie is. A reified bond and a
  // bare structural tie to the same person are the same relationship seen at
  // two levels of detail, so they share a card.
  const relPeople = (() => {
    const byName = new Map<string, { name: string; rel?: ProjectEntity; role?: string; preds: string[] }>();
    for (const rel of reifiedRels) {
      const isA = rel.character_a === charName;
      const other = String((isA ? rel.character_b : rel.character_a) ?? '').trim();
      if (!other) continue;
      const otherRole = rel.role_a !== rel.role_b ? String((isA ? rel.role_b : rel.role_a) ?? '') : '';
      const cur = byName.get(other) ?? { name: other, preds: [] };
      cur.rel = rel;
      if (otherRole) cur.role = otherRole.replace(/_/g, ' ');
      byName.set(other, cur);
    }
    structuralPeers.forEach((peer, i) => {
      const name = String(peer ?? '').trim();
      if (!name) return;
      const cur = byName.get(name) ?? { name, preds: [] };
      const pred = String(structuralPreds[i] ?? '').trim().replace(/_/g, ' ');
      if (pred && !cur.preds.includes(pred)) cur.preds.push(pred);
      byName.set(name, cur);
    });
    return [...byName.values()];
  })();
  const charIdByName = (name: string) =>
    allEntities.find(
      (e) => e.type === 'character' && !e.deleted_at
        && (e.working_name === name || (e.aliases ?? []).includes(name)),
    )?.id;

  // SC numbers off the canonical told-order spine — the SAME helper and the
  // SAME backstory filter the scene sheet numbers its own badge with, so a
  // number here can never disagree with the one over there or on the board.
  const sceneNoById = useMemo(() => {
    const spine = toldOrderEvents(
      allEntities.filter((e) => !e.deleted_at && !(e.type === 'event' && e.narrative_status === 'backstory')),
      edges.precedes ?? [],
      edges.contains ?? [],
      edges.sequence_precedes ?? [],
      (edges as any).cross_precedes ?? [],
    );
    const out = new Map<string, number>();
    spine.forEach((e, i) => out.set(e.id, i + 1));
    return out;
  }, [allEntities, edges]);

  // Current basis hash per scene (must MATCH the server's basisFor/basisHash
  // exactly: sha256 hex sliced to 16 over summary\ndescription, both
  // trimmed). What the staleness banner and note markers compare against.
  const [basisHashes, setBasisHashes] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const e of allEntities) {
        if (e.type !== 'event' || e.deleted_at) continue;
        next[e.id] = await sha16(basisForScene(e));
      }
      if (!cancelled) setBasisHashes(next);
    })();
    return () => { cancelled = true; };
  }, [allEntities]);

  const passStaleCount = pass
    ? Object.entries(pass.basisHashes ?? {}).filter(([id, h]) => basisHashes[id] && basisHashes[id] !== h).length
    : 0;

  // This character's scenes, in told order.
  //
  // The old sort was topoSortByPrecedes over just this character's scenes,
  // which restricts PRECEDES to that subset — and two scenes one character is
  // in are almost never adjacent in the chain, so the subset was usually
  // edgeless and the "story order" it returned was extraction order. Ranking
  // against the WHOLE spine is the only way this agrees with the board.
  //
  // A backstory scene has no rank because it is not on the told line at all.
  // It goes at the head of the character's own line rather than the tail:
  // that is who they were before page one.
  const orderedAppearsIn = useMemo(() => {
    const rank = (id: string) => sceneNoById.get(id) ?? 0;
    const told = appearsIn.filter((e) => rank(e.id) > 0).sort((a, b) => rank(a.id) - rank(b.id));
    const untold = appearsIn.filter((e) => rank(e.id) === 0);
    return [...untold, ...told];
  }, [appearsIn, sceneNoById]);

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

  // KNOWLEDGE IS A SCENE SURFACE, NOT A CHARACTER ONE (Ben, 2026-08-30).
  //
  // A character accumulates every fact they know across the whole script, so
  // the tile grew with the story and said less the longer it got: Nell was at
  // 28 cards on a thirteen-scene outline. On a SCENE it is bounded by what
  // happens there, which is why the scene sheet keeps its version. The
  // knowledge edges are untouched; only this reading of them is gone.

  const tiles: SectionTileDef[] = [
    {
      id: 'identity', label: 'Summary', accent: color, defaultW: 2, defaultExpanded: true,
      hint: "The character's description, established traits, and the evidence behind them.",
      content: (
        <div>
          {/* Badge row, same job as the scene's: give the focal card an
              identity of its own, since every satellite around it has one. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase',
                color, background: hexToRgba(color, dark ? 0.16 : 0.1),
                border: `1px solid ${hexToRgba(color, 0.35)}`,
                padding: '3px 8px', borderRadius: 999,
              }}
            >
              Character
            </span>
            {appearsIn.length > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: getEntityColor('event') }}>
                in {appearsIn.length} scene{appearsIn.length === 1 ? '' : 's'}
              </span>
            )}
            {charArcs.length > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: getEntityColor('arc') }}>
                {charArcs.length} arc{charArcs.length === 1 ? '' : 's'}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: dark ? '#5c5c66' : '#adaab2', fontWeight: 600 }}>
              click to edit
            </span>
          </div>
          <div
            style={{
              fontSize: 17, fontWeight: 600, letterSpacing: -0.1,
              color: dark ? '#e6e6ea' : '#1d2230', marginBottom: 8, lineHeight: 1.25,
            }}
          >
            {entity.working_name ?? entity.working_title ?? 'Unnamed character'}
          </div>
          {/* Editable, because the badge row above says it is. This was a
              plain paragraph while the scene's equivalent was an InlineText,
              so the hint was a lie on this sheet only. */}
          <InlineText
            value={entity.description ?? ''}
            placeholder="Who is this character…"
            style={{ marginBottom: 12, fontFamily: NOTE_FONT_SERIF, fontSize: 14.5, lineHeight: 1.6 }}
            onSave={(d) =>
              updateCardDescription({ cardId: entity.id, projectId, description: d }, auth.token)
                .then(() => onEntitiesChanged())
                .catch((err) => {
                  queueEditGlobal(projectId, { cardId: entity.id, field: 'description', value: d });
                  console.warn('[sheets] character description push failed; queued for retry', err);
                })
            }
          />
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
            <blockquote
              style={{
                margin: 0, paddingLeft: 12, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`,
                fontFamily: NOTE_FONT_SERIF, fontSize: 12, lineHeight: 1.6,
                color: dark ? '#8e8e98' : '#777', fontStyle: 'italic',
              }}
            >
              &ldquo;{entity.evidence_quote}&rdquo;
            </blockquote>
          )}
        </div>
      ),
    },
    {
      id: 'arcs', label: 'Arcs', accent: getEntityColor('arc'), defaultW: 2,
      hint: 'Arcs this character is involved in.',
      add: {
        noun: 'an arc',
        emptyHint: 'Every arc already involves this character.',
        candidates: allEntities
          .filter((e) => e.type === 'arc' && !e.deleted_at && !charArcs.some((a) => a.id === e.id)
            // A primary arc (owned via character_id) never appears as a
            // story-arc candidate; it lives in the cascade's band.
            && !String((e as any).character_id ?? ''))
          .map((e) => ({
            id: e.id,
            label: e.working_name ?? e.working_title ?? e.id,
            sublabel: e.kind ? arcKindLabel(e.kind as ArcKind) : undefined,
          })),
        onAdd: (id: string) =>
          tagArcInvolvesCharacter({ arcId: id, characterId: entity.id, projectId }, auth.token)
            .then(() => onEntitiesChanged()),
      },
      items: charArcs.map((a) => ({
        id: a.id,
        kicker: a.kind ? `arc \u00b7 ${arcKindLabel(a.kind as ArcKind)}` : 'arc',
        accent: getEntityColor('arc'),
        title: a.working_name ?? a.working_title ?? a.id,
        rowsSummary: String(a.description ?? '').trim() ? 'what it is' : 'nothing written yet',
        expanded: (
          <SatelliteDetail
            description={String(a.description ?? '').trim()}
            chips={[]}
            accent={getEntityColor('arc')}
            openLabel="Open arc sheet"
            onOpen={() => onOpenCard(a.id)}
            removeLabel="Remove from character"
            onRemove={() =>
              untagArcInvolvesCharacter({ arcId: a.id, characterId: entity.id, projectId }, auth.token)
                .then(() => onEntitiesChanged())
            }
          />
        ),
      })),
      defaultExpanded: charArcs.length > 0,
      summary: `${charArcs.length}`,
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
      // One card per person, same shape as the scene's Cast pills.
      items: relPeople.map((p) => {
        const desc = String(p.rel?.description ?? '').trim();
        const targetId = p.rel?.id ?? charIdByName(p.name);
        return {
          id: p.rel?.id ?? `tie-${p.name}`,
          shape: 'pill' as const,
          kicker: p.rel ? String(p.rel.kind ?? 'relationship').replace(/_/g, ' ') : 'connection',
          // A reified bond is a card in the graph with its own sheet; a
          // structural tie is just a labelled edge. The board already says
          // this in its connectors — rose for the bond, a neutral dashed line
          // for the tie — so the cards say it the same way.
          accent: p.rel ? getEntityColor('relationship') : '#94a3b8',
          dashed: !p.rel,
          title: p.role ? `${p.name} (${p.role})` : p.name,
          rowsSummary: p.preds.length > 0
            ? p.preds.join(' \u00b7 ')
            : desc ? 'what it is' : 'nothing written yet',
          expanded: (
            <SatelliteDetail
              description={desc}
              chips={p.preds}
              accent={p.rel ? getEntityColor('relationship') : '#94a3b8'}
              openLabel={p.rel ? 'Open relationship sheet' : 'Open character sheet'}
              onOpen={() => targetId && onOpenCard(targetId)}
            />
          ),
        };
      }),
      defaultExpanded: relCount > 0,
      summary: `${relPeople.length}`,
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
      id: 'appears-in', label: 'Scenes',
      accent: getEntityColor('event'), defaultW: 2, defaultExpanded: true,
      hint: 'Scenes this character appears in, in told order.',
      summary: `${appearsIn.length}`,
      // A rail, not a ring: what these cards have to say is that one comes
      // after another, and a ring has nowhere to put that. (FIL-588)
      layout: 'throughline',
      add: {
        noun: 'a scene',
        emptyHint: 'This character is already in every scene.',
        candidates: allEntities
          .filter((e) => e.type === 'event' && !e.deleted_at && !appearsIn.some((a) => a.id === e.id))
          .sort((a, b) => (sceneNoById.get(a.id) ?? 1e9) - (sceneNoById.get(b.id) ?? 1e9))
          .map((e) => {
            const n = sceneNoById.get(e.id);
            return {
              id: e.id,
              label: e.working_title ?? e.working_name ?? e.id,
              sublabel: n ? `SC ${String(n).padStart(2, '0')}` : 'untold',
            };
          }),
        onAdd: (id: string) =>
          tagEventInvolvesCharacter({ eventId: id, characterId: entity.id, projectId }, auth.token)
            .then(() => onEntitiesChanged()),
      },
      // Off by default and disabled until there is an arc to line up. A toggle
      // that visibly does nothing reads as broken, and with no arcs the fold
      // label on every stop already says the only thing the lens could.
      // Build Arc + the primary-arc band, pinned above the cascade.
      stageHeader: (
        <BuildArcHeader
          dark={dark}
          busy={passBusy}
          err={passErr}
          pass={pass}
          staleCount={passStaleCount}
          sceneCount={orderedAppearsIn.length}
          onRun={async () => {
            setPassBusy(true); setPassErr(null);
            try {
              const res = await buildCharacterArc(
                { projectId, characterId: entity.id, orderedEventIds: orderedAppearsIn.map((e) => e.id), userId: auth.userId },
                auth.token,
              );
              setPass(res);
              try { localStorage.setItem(passKey, JSON.stringify(res)); } catch { /* private mode */ }
              // The pass now WRITES its reads onto the edges rather than
              // handing them back to be cached and rendered beside the
              // writer's field. Refetch so the cascade renders the one text.
              onEntitiesChanged();
            } catch (err: any) {
              setPassErr(String(err?.message ?? err));
            } finally {
              setPassBusy(false);
            }
          }}
        />
      ),
      items: orderedAppearsIn.map((ev, runIdx) => {
        const full = eventsById.get(ev.id);
        const summary = String(full?.summary ?? '').trim();
        const subEvents = full?.sub_events ?? [];
        const n = sceneNoById.get(ev.id);
        const status = String(ev.narrative_status ?? '');
        // Direct knowledge only (D-knowledge-direct): facts anchored AT this
        // scene with this character as knower, verbatim.
        const learned = (edges.knowledge ?? [])
          .filter((k) => k.knower_id === entity.id && k.at_event === ev.id)
          .map((k) => (information ?? []).find((i) => i.id === k.info_id)?.summary)
          .filter((x): x is string => !!x);
        const dev = involvesDevByEvent.get(ev.id);
        const turn = turnByEvent.get(ev.id);
        // A conflict the pass raised against something this writer wrote.
        // Session-scoped like the rest of the pass output; "Keep mine"
        // dismisses it through the same store the other dismissals use.
        const conflict = pass?.conflicts?.find(
          (c) => c.event_id === ev.id && !dismissed.has(`${c.event_id}:c`),
        );
        const question = SHOW_PEER_QUESTIONS_ON_STOPS
          ? pass?.questions.find((q) => q.event_id === ev.id && !dismissed.has(`${q.event_id}:q`))
          : undefined;
        const basisNow = basisHashes[ev.id] ?? '';
        const devStale = !!dev?.development && !!dev.hash && !!basisNow && dev.hash !== basisNow;
        // D-flag-tiers: a divergence only earns amber when the note was
        // written against PAGES and the pages then changed under it — the
        // scene was rewritten. Outline -> page (and anything with no grade
        // on either side) is the ground merely getting richer, which every
        // note crosses once, so it stays the quiet marker.
        const devRewritten = devStale && dev?.noteGrade === 'page' && dev?.observableGrade === 'page';

        // THE LADDER (2026-08-29, revised). The scene summary is no longer a
        // rung: it sits on every face, above the rung, as the context the
        // reader needs before any reading of it. What the ladder decides is
        // what goes UNDER it.
        //
        //   1  the text        a read of what this scene does to her arc,
        //                      whoever wrote it. Legacy: a confirmed turn's
        //                      state_at_event IS that text for stops written
        //                      before the fields merged.
        //   2  the observable  extraction's testimony. An EVALUATED AND EMPTY
        //                      observable is a rank-2 answer ("nothing lands"),
        //                      not a fallback, which is why the test is on the
        //                      grade rather than on the string.
        //   3  nothing yet     the scene, and no reading of it.
        //
        // A FLAT VERDICT IS NOT A READING. "Doesn't develop Nell." is the
        // pass declining to speak, and the observable says the same thing
        // with actual content, so a flat text drops to rank 2 and the
        // observable takes the face. The text is still there in the slate to
        // be overwritten.
        const rawText = (dev?.development ?? '').trim() || String(turn?.state_at_event ?? '').trim();
        const textIsFlat = /^\s*doesn'?t\s+develop\b/i.test(rawText);
        const stopText = rawText;
        const evaluated = !!dev?.observableGrade;
        const rank: 1 | 2 | 3 = (rawText && !textIsFlat) ? 1 : evaluated ? 2 : 3;

        // Backstory scenes take 'touches' only, custom words included: the
        // server enforces it, so the picker never offers a 400.
        const isBackstory = status === 'backstory';
        const allowedVerbs: EvokesTransition[] = isBackstory
          ? (['touches'] as EvokesTransition[])
          : EVOKES_TRANSITIONS;
        const verb = turn ? String(turn.transition ?? '') : '';
        // Setting a verb on a stop that has none mints the master arc if this
        // is the character's first, silently: it is plumbing the writer never
        // sees or names, and with no confirm step there is nothing else to
        // hang the minting on.
        const setVerb = async (t: string) => {
          let arcId = turn?.arc_id ?? primaryArc?.id ?? null;
          if (!arcId) {
            const res = await createArc(
              {
                projectId, userId: auth.userId,
                workingName: `${charName || entity.id}'s arc`,
                kind: 'transformation', description: '',
                characterId: entity.id,
              },
              auth.token,
            );
            if ((res as any)?.exists) {
              const existing = allEntities.find((e) => e.id === (res as any).cardId);
              if (existing && String((existing as any).character_id ?? '') === entity.id) {
                arcId = (res as any).cardId;
              } else {
                throw new Error('Could not create the arc (name collision). Try again.');
              }
            } else {
              arcId = (res as any)?.entity?.id ?? null;
            }
            if (!arcId) throw new Error('Arc creation returned no id.');
          }
          setOptimisticTurns((prev) => ({
            ...prev,
            [ev.id]: {
              arc_id: arcId as string, transition: t,
              state_at_event: '', evidence_quote: String(turn?.evidence_quote ?? ''),
            },
          }));
          try {
            await tagEventEvokes(
              {
                eventId: ev.id, arcId: arcId as string, projectId,
                transition: t, evidenceQuote: String(turn?.evidence_quote ?? ''),
              },
              auth.token,
            );
            onEntitiesChanged();
          } catch (err) {
            setOptimisticTurns((prev) => { const nx = { ...prev }; delete nx[ev.id]; return nx; });
            throw err;
          }
        };

        // One row, used by whichever callout is showing (face at rank 1, slate
        // otherwise). Editing is only live on an OPEN card.
        const verbRowFor = (cardOpen: boolean) => (
          <VerbRow
            arcLabel={`${charName || 'their'}'s arc`}
            verb={verb}
            allowed={allowedVerbs}
            custom={!isBackstory}
            editable={cardOpen}
            dark={dark}
            onPick={(t) => { void setVerb(t); }}
            onClear={() => {
              if (!turn) return;
              setOptimisticTurns((prev) => { const nx = { ...prev }; delete nx[ev.id]; return nx; });
              untagEventEvokes({ eventId: ev.id, arcId: turn.arc_id, projectId }, auth.token)
                .then(() => onEntitiesChanged());
            }}
          />
        );

        return {
          id: ev.id,
          // The number is the point of the cascade, so it takes the kicker and
          // gets the mono treatment the scene sheet's own badge uses.
          kicker: n ? `SC ${String(n).padStart(2, '0')}` : 'untold',
          kickerMono: true,
          accent: getEntityColor('event'),
          // A contradicted stop has to be findable down the run without
          // opening every card.
          alert: conflict ? '#d97706' : undefined,
          title: ev.title,
          // The scene, on every face, above the rung. It is the context you
          // read the rung against, so it is not competing with it for a slot
          // (Ben, 2026-08-29). The card's own body slot already clamps it
          // while closed and lifts the clamp on open.
          body: summary || undefined,
          bodySerif: true,
          tag: status && status !== 'on_screen' ? narrativeStatusLabel(status) : undefined,
          tagColor: narrativeStatusFg(status),
          // A function so the face can see the fold: closed it carries the
          // highest rung, open it stands down and lets the slate speak.
          faceExtra: (open: boolean) => (
            <StopFace
              open={open}
              rank={rank}
              text={stopText}
              transition={turn ? String(turn.transition ?? '') : ''}
              observable={dev?.observable ?? ''}
              charName={charName}
              dark={dark}
              introBeat={runIdx === 0}
              openSignal={slotOpen[ev.id] ?? 0}
              textStale={devStale}
              textRewritten={devRewritten}
              onSaveText={(text) =>
                setCharacterDevelopment(
                  {
                    projectId, eventId: ev.id, characterId: entity.id,
                    development: text, developmentHash: basisNow,
                    developmentGrade: dev?.observableGrade ?? '',
                    author: 'writer',
                  },
                  auth.token,
                ).then(() => onEntitiesChanged())
              }
              flags={[
                ...(conflict ? [{ key: 'c', tone: 'warn' as const, label: 'conflict' }] : []),
                ...(question ? [{ key: 'q', tone: 'peer' as const, label: 'a question is waiting' }] : []),
              ]}
              // Everything else the arc has to say about this stop, inside
              // the one callout: the confirmed turn's citation, or the
              verbRow={verbRowFor(open)}
              // The line the verb was drawn from. Nothing to confirm: the
              // verb is simply there, and the row above edits or clears it.
              arcExtra={open ? (
                <>
                  {conflict && (
                    <ConflictBlock
                      conflict={conflict}
                      dark={dark}
                      quoteFrom={(() => {
                        const src = conflict.quote_event_id;
                        if (!src || src === ev.id) return undefined;
                        const n = sceneNoById.get(src);
                        return n ? `SC ${String(n).padStart(2, '0')}` : undefined;
                      })()}
                      edited={
                        typeof conflict.against === 'string'
                        && conflict.against.trim() !== ''
                        && conflict.against.trim() !== stopText.trim()
                      }
                      onKeep={() => dismiss(`${ev.id}:c`)}
                      onTake={(text) =>
                        setCharacterDevelopment(
                          {
                            projectId, eventId: ev.id, characterId: entity.id,
                            development: text, developmentHash: basisNow,
                            developmentGrade: dev?.observableGrade ?? '',
                            // Taking it makes it THEIRS by adoption: they chose
                            // these words, so the next pass leaves them alone.
                            author: 'writer',
                          },
                          auth.token,
                        ).then(() => { dismiss(`${ev.id}:c`); onEntitiesChanged(); })
                      }
                    />
                  )}
                  {turn && String(turn.evidence_quote ?? '').trim() && (
                    <div style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10.5, lineHeight: 1.7, color: dark ? '#8b8b95' : '#6b6f7a', paddingLeft: 10 }}>
                      {turn.evidence_quote}
                    </div>
                  )}
                </>
              ) : null}
            />
          ),
          rowsSummary: ['open', 'close'] as [string, string],
          // THE SLATE. Invariant: the same blocks in the same order on every
          // stop, present or absent, most interpreted first and most raw
          // last. Nothing moves position between scenes, so the eye learns
          // one map. (Knowledge / "learns" is deliberately not here yet.)
          expanded: (
            <StopSlate
              dark={dark}
              charName={charName}
              introBeat={runIdx === 0}
              rank={rank}
              text={stopText}
              textStale={devStale}
              textRewritten={devRewritten}
              openSignal={slotOpen[ev.id] ?? 0}
              onSaveText={(text) =>
                setCharacterDevelopment(
                  {
                    projectId, eventId: ev.id, characterId: entity.id,
                    development: text, developmentHash: basisNow,
                    developmentGrade: dev?.observableGrade ?? '',
                    // A person typed it. From here a pass will not touch it.
                    author: 'writer',
                  },
                  auth.token,
                ).then(() => onEntitiesChanged())
              }
              turn={turn ? { transition: String(turn.transition ?? ''), quote: String(turn.evidence_quote ?? '') } : null}
              verbRow={verbRowFor(true)}
              question={question || null}
              onAnswerQuestion={() => setSlotOpen((prev) => ({ ...prev, [ev.id]: (prev[ev.id] ?? 0) + 1 }))}
              onDismissQuestion={() => dismiss(`${ev.id}:q`)}
              observable={dev?.observable ?? ''}
              observableGrade={dev?.observableGrade ?? ''}
              subEvents={subEvents}
              onOpenScene={() => onOpenCard(ev.id)}
              onRemoveFromScene={() =>
                untagEventInvolvesCharacter({ eventId: ev.id, characterId: entity.id, projectId }, auth.token)
                  .then(() => onEntitiesChanged())
              }
            />
          ),
        };
      }),
      content: appearsIn.length === 0 ? (
        <div style={{ color: dark ? '#6e6e78' : '#aaa', fontSize: 12 }}>Not yet in any events.</div>
      ) : (
        <SheetEventTimeline
          appearsIn={orderedAppearsIn}
          eventsById={eventsById}
          precedesEdges={precedesEdges}
        />
      ),
    },
    {
      id: 'working', label: 'Peer', accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: "The peer's open questions about this character. Answer inline, or open a thread.",
      icon: <InternIcon size={13} />,
      summary: questions == null ? '\u2026' : `${byStatus.open.length + byStatus.stashed.length}`,
      add: {
        noun: 'your own question',
        onCreate: (text: string) =>
          createWriterQuestion(
            { projectId, cardId: entity.id, userId: auth.userId, workingSectionLabel: text },
            auth.token,
          ).then(() => refetchQuestions()),
      },
      focalAction: <FocalAskPeer peer={peer} />,
      focalOverrideActive: !!peerOpenQuestionId,
      focalOverride:
        peer.streaming.prose ? (
          <div style={{ paddingTop: 4 }}>
            <div
              style={{
                fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
                color: PEER_BLUE, fontWeight: 600, marginBottom: 8,
              }}
            >
              The peer&rsquo;s read
            </div>
            <PeerReadProse text={peer.streaming.prose} dark={dark} />
          </div>
        ) : undefined,
      items: (() => {
        const live = peer.visiblePeerQuestions ?? [];
        const liveIds = new Set(live.map((q) => q.questionId));
        const rest = (questions ?? []).filter(
          (q) => q.status !== 'dismissed' && !liveIds.has(q.questionId),
        );
        return [...live, ...rest] as PersistedQuestion[];
      })().map((q) => ({
        id: q.questionId,
        shape: 'peer' as const,
        kicker: q.workingSectionLabel || 'open question',
        title: q.questionText,
        tag: q.status === 'answered' ? 'answered' : undefined,
        tagColor: '#10b981',
        rowsSummary: q.status === 'answered' ? 'your answer' : 'answer or discuss',
        expandedWidth: peerChatQuestionId === q.questionId ? 560 : 400,
        onExpandChange: (isOpen: boolean) =>
          setPeerOpenQuestionId((prev) => (isOpen ? q.questionId : prev === q.questionId ? null : prev)),
        expanded: (
          <QuestionComposer
            question={{
              questionId: q.questionId,
              askId: q.askId ?? '',
              cardId: q.cardId,
              projectId: q.projectId,
              orderIndex: q.orderIndex,
              questionText: q.questionText,
              workingSectionLabel: q.workingSectionLabel,
              rationale: q.rationale,
              authoredBy: q.authoredBy,
              status: q.status,
              threadId: q.threadId,
              responseId: q.responseId,
              responseProse: q.responseProse ?? undefined,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
            }}
            persistedStatus={q.status}
            isOpen
            onToggle={() => {}}
            entity={entity}
            slice={peer.slice}
            peerOriginalProse={peer.streaming.prose}
            projectId={projectId}
            userId={auth.userId}
            token={auth.token}
            completedResponseIds={completedResponseIds}
            onStatusChange={() => refetchQuestions()}
            onChatOpenChange={(chatting) =>
              setPeerChatQuestionId((prev) => (chatting ? q.questionId : prev === q.questionId ? null : prev))
            }
            onResponseSubmitted={() => { refetchQuestions(); onEntitiesChanged(); }}
            hideStash
            bare
            hideQuestionText
            initialThread={
              (q as any).openThread
                ? { threadId: (q as any).openThread.threadId, turns: (q as any).openThread.turns }
                : undefined
            }
            initialClosedThread={
              (q as any).closedThread
                ? {
                    threadId: (q as any).closedThread.threadId,
                    turns: (q as any).closedThread.turns,
                    closedReason: (q as any).closedThread.closedReason,
                    closedAt: (q as any).closedThread.closedAt,
                  }
                : undefined
            }
          />
        ),
      })),
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
  // What the character sheet shows, in this order — the scene sheet's rule:
  // an explicit list, so the surface is composed rather than whatever the tile
  // builder happens to emit. Anything omitted is still built; adding its id
  // here brings it back. (FIL-588)
  const CHAR_ORBIT_TILES = ['identity', 'appears-in', 'relationships', 'knowledge', 'working', 'arcs'];
  const orderedTiles = CHAR_ORBIT_TILES
    .map((id) => tiles.find((t) => t.id === id))
    .filter((t): t is SectionTileDef => !!t);

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
        <OrbitSheet tiles={orderedTiles} focalTileIds={['identity']} defaultCategoryId="appears-in" focalAccent={color} focalCardId={entity.id} auth={auth} projectId={projectId} persistKey={`character:${entity.id}`} />
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
  const refetchQuestionsRef = useRef<(() => void) | null>(null);
  useEffect(() => { refetchQuestionsRef.current = refetchQuestions; }, [refetchQuestions]);
  const [peerOpenQuestionId, setPeerOpenQuestionId] = useState<string | null>(null);
  const [peerChatQuestionId, setPeerChatQuestionId] = useState<string | null>(null);
  const peer = usePeerSession({
    entity,
    projectId,
    userId: auth.userId,
    token: auth.token,
    onCardQuestionsChanged: () => { refetchQuestionsRef.current?.(); },
    onCascadeFallbackRefresh: onEntitiesChanged,
  });
  const byStatus: Record<string, PersistedQuestion[]> = {
    open: [], answered: [], stashed: [], dismissed: [],
  };
  for (const q of questions ?? []) {
    (byStatus[q.status] ??= []).push(q);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = getEntityColor('sequence');
  const byId = useMemo(() => new Map(allEntities.map((e) => [e.id, e])), [allEntities]);

  // The story's scene numbers, ranked against the WHOLE spine — a scene is
  // SC 07 wherever the writer meets it. Same computation as the character and
  // arc cascades; numbering a scene only on one sheet makes the same card look
  // like two different things.
  const sceneNoById = useMemo(() => {
    const spine = toldOrderEvents(
      allEntities.filter((e) => !e.deleted_at && !(e.type === 'event' && e.narrative_status === 'backstory')),
      edges.precedes ?? [],
      edges.contains ?? [],
      edges.sequence_precedes ?? [],
      (edges as any).cross_precedes ?? [],
    );
    const out = new Map<string, number>();
    spine.forEach((e, i) => out.set(e.id, i + 1));
    return out;
  }, [allEntities, edges]);

  // Member scenes — the Events this sequence CONTAINS, in told order. Never
  // re-ordered as a subset: ranking against the whole spine is what keeps a
  // sequence's rail from coming back in extraction order.
  const memberScenes = useMemo(() => {
    const mine = (edges.contains ?? [])
      .filter((c) => c.from === entity.id)
      .map((c) => byId.get(c.to))
      .filter((e): e is ProjectEntity => !!e && !e.deleted_at);
    const rank = (id: string) => sceneNoById.get(id) ?? 0;
    const told = mine.filter((e) => rank(e.id) > 0).sort((a, b) => rank(a.id) - rank(b.id));
    const untold = mine.filter((e) => rank(e.id) === 0);
    return [...untold, ...told];
  }, [edges.contains, entity.id, byId, sceneNoById]);

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
      // The scenes inside this movement, as a RAIL. Same treatment as a
      // character's or an arc's cascade, because it is the same claim: these
      // cards mean that one comes after another. A sequence stop has no
      // per-edge reading of its own (no INVOLVES / EVOKES text), so the card
      // carries the scene itself, and the ladder does not apply.
      id: 'scenes', label: 'Member scenes', accent: color, defaultW: 2,
      defaultExpanded: true,
      layout: 'throughline',
      summary: `${memberScenes.length}`,
      hint: "The scenes this sequence contains, in told order. Empty means it's still broad — the peer's decomposition questions turn it into scenes.",
      items: memberScenes.map((ev) => {
        const summary = String(ev.summary ?? ev.description ?? '').trim();
        const isBackstory = String(ev.narrative_status ?? '') === 'backstory';
        return {
          id: ev.id,
          kicker: (() => {
            if (isBackstory) return 'backstory';
            const n = sceneNoById.get(ev.id);
            return n ? `SC ${String(n).padStart(2, '0')}` : 'untold';
          })(),
          kickerMono: true,
          accent: getEntityColor('event'),
          title: ev.working_title ?? ev.working_name ?? ev.id,
          body: summary || undefined,
          bodySerif: true,
          rowsSummary: ['open', 'close'] as [string, string],
          expanded: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(ev.sub_events ?? []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#82828c' : '#999' }}>
                    Inside this scene
                  </div>
                  {(ev.sub_events ?? []).map((sub: any, k: number) => (
                    <div key={k} style={{ fontSize: 12.5, lineHeight: 1.55, color: dark ? '#c6c6ce' : '#444' }}>
                      {typeof sub === 'string' ? sub : String(sub?.text ?? sub?.summary ?? '')}
                    </div>
                  ))}
                </div>
              )}
              <button
                style={{ ...rowBtn, width: 'auto', alignSelf: 'flex-start' }}
                onClick={() => onOpenCard(ev.id)}
              >
                Open scene →
              </button>
            </div>
          ),
        };
      }),
      content: memberScenes.length === 0 ? (
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: dark ? '#9a9aa2' : '#777', margin: 0 }}>
          No scenes yet. This is still a broad movement. Ask the peer to help you break it into the scenes inside it.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {memberScenes.map((sc) => (
            <button key={sc.id} style={rowBtn} onClick={() => onOpenCard(sc.id)}>
              {sc.working_title ?? sc.id}
            </button>
          ))}
        </div>
      ),
    },
    {
      id: 'working', label: 'Peer', accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: "The peer's open questions about this sequence. Answer inline, or open a thread.",
      icon: <InternIcon size={13} />,
      summary: questions == null ? '\u2026' : `${byStatus.open.length + byStatus.stashed.length}`,
      add: {
        noun: 'your own question',
        onCreate: (text: string) =>
          createWriterQuestion(
            { projectId, cardId: entity.id, userId: auth.userId, workingSectionLabel: text },
            auth.token,
          ).then(() => refetchQuestions()),
      },
      focalAction: <FocalAskPeer peer={peer} />,
      focalOverrideActive: !!peerOpenQuestionId,
      focalOverride:
        peer.streaming.prose ? (
          <div style={{ paddingTop: 4 }}>
            <div
              style={{
                fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
                color: PEER_BLUE, fontWeight: 600, marginBottom: 8,
              }}
            >
              The peer&rsquo;s read
            </div>
            <PeerReadProse text={peer.streaming.prose} dark={dark} />
          </div>
        ) : undefined,
      items: (() => {
        const live = peer.visiblePeerQuestions ?? [];
        const liveIds = new Set(live.map((q) => q.questionId));
        const rest = (questions ?? []).filter(
          (q) => q.status !== 'dismissed' && !liveIds.has(q.questionId),
        );
        return [...live, ...rest] as PersistedQuestion[];
      })().map((q) => ({
        id: q.questionId,
        shape: 'peer' as const,
        kicker: q.workingSectionLabel || 'open question',
        title: q.questionText,
        tag: q.status === 'answered' ? 'answered' : undefined,
        tagColor: '#10b981',
        rowsSummary: q.status === 'answered' ? 'your answer' : 'answer or discuss',
        expandedWidth: peerChatQuestionId === q.questionId ? 560 : 400,
        onExpandChange: (isOpen: boolean) =>
          setPeerOpenQuestionId((prev) => (isOpen ? q.questionId : prev === q.questionId ? null : prev)),
        expanded: (
          <QuestionComposer
            question={{
              questionId: q.questionId,
              askId: q.askId ?? '',
              cardId: q.cardId,
              projectId: q.projectId,
              orderIndex: q.orderIndex,
              questionText: q.questionText,
              workingSectionLabel: q.workingSectionLabel,
              rationale: q.rationale,
              authoredBy: q.authoredBy,
              status: q.status,
              threadId: q.threadId,
              responseId: q.responseId,
              responseProse: q.responseProse ?? undefined,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
            }}
            persistedStatus={q.status}
            isOpen
            onToggle={() => {}}
            entity={entity}
            slice={peer.slice}
            peerOriginalProse={peer.streaming.prose}
            projectId={projectId}
            userId={auth.userId}
            token={auth.token}
            completedResponseIds={completedResponseIds}
            onStatusChange={() => refetchQuestions()}
            onChatOpenChange={(chatting) =>
              setPeerChatQuestionId((prev) => (chatting ? q.questionId : prev === q.questionId ? null : prev))
            }
            onResponseSubmitted={() => { refetchQuestions(); onEntitiesChanged(); }}
            hideStash
            bare
            hideQuestionText
            initialThread={
              (q as any).openThread
                ? { threadId: (q as any).openThread.threadId, turns: (q as any).openThread.turns }
                : undefined
            }
            initialClosedThread={
              (q as any).closedThread
                ? {
                    threadId: (q as any).closedThread.threadId,
                    turns: (q as any).closedThread.turns,
                    closedReason: (q as any).closedThread.closedReason,
                    closedAt: (q as any).closedThread.closedAt,
                  }
                : undefined
            }
          />
        ),
      })),
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

  // Member scenes lead: the rail is what a sequence IS. The sequence
  // throughline (the sequences either side) and the arcs threading through it
  // were both restatements of what the board already draws, and they pushed
  // the scenes down the chip row.
  const SEQ_TILE_ORDER = ['summary', 'scenes', 'working'];
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
        <OrbitSheet tiles={orderedTiles} focalTileIds={['summary']} defaultCategoryId="scenes" focalAccent={color} focalCardId={entity.id} auth={auth} projectId={projectId} persistKey={`sequence:${entity.id}`} />
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

/**
 * The peer's ask, rendered inside the focal card while the Peer category is on
 * stage. It sits on the card being asked ABOUT rather than in a corner of the
 * chrome, and the questions it produces arrive as satellites around that same
 * card. Owns its own peer session; the panel that used to own one isn't
 * rendered for this category any more.
 */
function FocalAskPeer({ peer }: { peer: ReturnType<typeof usePeerSession> }) {
  const dark = useThemeMode() === 'dark';
  const { focalSupported, streaming, setupError, statusLine, ask } = peer;
  const busy = streaming.state === 'loading' || streaming.state === 'streaming';
  const err = setupError ?? streaming.error;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          data-tour="orbit-ask-peer"
          onClick={() => { if (wowBentoPeerGate.active) return; ask(); }}
          disabled={busy || !focalSupported}
          title={focalSupported ? 'The peer reads this scene and pushes back' : 'Ask peer supports character and scene cards'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 14px',
            fontSize: 12.5, fontWeight: 700, borderRadius: 8, fontFamily: 'inherit',
            cursor: busy || !focalSupported ? 'not-allowed' : 'pointer',
            border: `1px solid ${hexToRgba(PEER_BLUE, busy || !focalSupported ? 0.25 : 0.6)}`,
            background: hexToRgba(PEER_BLUE, dark ? 0.14 : 0.09),
            color: busy || !focalSupported ? hexToRgba(PEER_BLUE, 0.55) : PEER_BLUE,
          }}
        >
          <InternIcon size={14} />
          {busy ? 'Peer reading…' : 'Ask the peer'}
        </button>
        {statusLine && (
          <span style={{ fontSize: 11, color: dark ? '#82828c' : '#888' }}>{statusLine}</span>
        )}
      </div>
      {!focalSupported && (
        <span style={{ fontSize: 11, color: dark ? '#6e6e78' : '#aaa' }}>
          Ask peer supports character and scene cards.
        </span>
      )}
      {err && <span style={{ fontSize: 11, color: 'crimson' }}>{err}</span>}
    </div>
  );
}

/** The quiet destructive action on an expanded satellite. Grey until hovered,
 *  so it reads as available without competing with the card's content. */
function RemoveLink({ label, onRemove }: { label: string; onRemove: () => void }) {
  const dark = useThemeMode() === 'dark';
  const rest = dark ? '#82828c' : '#9a9aa4';
  return (
    <button
      onClick={onRemove}
      style={{
        alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0,
        fontSize: 11, fontWeight: 600, fontFamily: 'inherit', color: rest, cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#dc2626')}
      onMouseLeave={(e) => (e.currentTarget.style.color = rest)}
    >
      {label}
    </button>
  );
}

/** The revealed body of an entity satellite (cast, location): what the card
 *  says about itself, plus the deliberate way out to its own sheet. Kept here
 *  rather than in orbit.tsx because it is about ENTITIES, and the orbit
 *  shouldn't know what an entity is. (FIL-588) */
function SatelliteDetail({
  description,
  chips,
  accent,
  openLabel,
  onOpen,
  removeLabel,
  onRemove,
}: {
  description: string;
  chips: string[];
  accent: string;
  openLabel: string;
  onOpen: () => void;
  /** Taking the entity off this scene. Lives on the card because that is
   *  where the rest of the per-item editing lives now — the category's Add
   *  button is a picker, so the editor panel it used to open (and its remove
   *  chips) is no longer the way in. */
  removeLabel?: string;
  onRemove?: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {description ? (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dark ? '#b9b9c2' : '#4a4f5c' }}>
          {description}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, lineHeight: 1.5, color: dark ? '#63636d' : '#9a9aa4', fontStyle: 'italic' }}>
          Nothing written about this yet.
        </div>
      )}
      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                fontSize: 10.5, color: dark ? '#c8c8d0' : '#4a4f5c',
                border: `1px solid ${hexToRgba(accent, 0.4)}`,
                padding: '2px 8px', borderRadius: 999,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={onOpen}
          style={{
            background: 'transparent', border: 'none', padding: 0,
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit', color: accent,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          {openLabel}
          <span style={{ opacity: 0.7 }}>&rarr;</span>
        </button>
        {onRemove && <RemoveLink label={removeLabel ?? 'Remove'} onRemove={onRemove} />}
      </div>
    </div>
  );
}

// =====================================================================
// Character scene development (character-arc-from-scenes-v2)
// =====================================================================

/** FE mirror of the Lambda's basisFor + basisHash: sha256 hex sliced to 16
 *  over summary\ndescription, both trimmed. The two implementations MUST
 *  agree or every staleness marker lies. */
export function basisForScene(ev: ProjectEntity | undefined): string {
  return `${String(ev?.summary ?? '').trim()}\n${String(ev?.description ?? '').trim()}`.trim();
}
export async function sha16(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** A CONFLICT, inside the callout, directly under the reading it disagrees
 *  with. Laid out as a straight choice between two versions: the writer's
 *  text with Keep mine attached to it, then the conflict and the version the
 *  pass would write, with Accept new attached to that. Both are visible on
 *  open, because a choice you have to click to see is not a choice being
 *  offered, it is one being hidden. */
function ConflictBlock({
  conflict, dark, quoteFrom, edited, onKeep, onTake,
}: {
  conflict: StopConflict;
  dark: boolean;
  /** The stop's text has changed since the pass read it, so the writer has
   *  already answered this in the only way that counts. The offer stops
   *  being "which of these two" and becomes "is this settled". */
  edited?: boolean;
  /** Label for the scene the quote came from, when it came from another one
   *  ("SC 04"). The evidence for a contradiction is often in a different
   *  scene, and a quote with no address is worse than no quote. */
  quoteFrom?: string;
  onKeep: () => void;
  onTake: (text: string) => Promise<unknown>;
}) {
  const warn = '#d97706';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); };
  const btn = (accent: boolean): React.CSSProperties => ({
    height: 24, padding: '0 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
    fontFamily: 'system-ui, sans-serif', cursor: busy ? 'default' : 'pointer',
    border: `1px solid ${accent ? hexToRgba(warn, 0.5) : (dark ? '#2b2b32' : '#e0ddd6')}`,
    background: accent ? hexToRgba(warn, dark ? 0.14 : 0.1) : 'transparent',
    color: accent ? warn : (dark ? '#b7b7c0' : '#4a4f5c'),
  });
  return (
    <div onMouseDown={stop} onClick={stop} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* belongs to the text above it: this is the "keep what I wrote" half */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={(e) => { e.stopPropagation(); onKeep(); }} style={btn(!!edited)}>
          {edited ? 'Mark as resolved' : 'Keep mine'}
        </button>
        {edited && (
          <span style={{
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
            color: dark ? '#82828c' : '#9a9aa4',
          }}>
            you have rewritten this since
          </span>
        )}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        paddingTop: 8, borderTop: `1px solid ${hexToRgba(warn, 0.35)}`,
      }}>
        <span style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9,
          fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: warn,
        }}>
          conflict
        </span>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: dark ? '#d6cfc2' : '#4a4133' }}>
          {conflict.why}
        </div>
        {conflict.quote && (
          <div style={{
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10.5,
            lineHeight: 1.7, color: dark ? '#8b8b95' : '#6b6f7a', paddingLeft: 10,
          }}>
            {quoteFrom ? <span style={{ color: warn, fontWeight: 700 }}>{`${quoteFrom} · `}</span> : null}
            {conflict.quote}
          </div>
        )}
        {conflict.proposed && !edited && (
          <>
            <div style={{
              fontFamily: NOTE_FONT_SERIF, fontSize: 14, lineHeight: 1.55,
              color: dark ? '#e5e5ea' : '#25262c', marginTop: 2,
            }}>
              {conflict.proposed}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (busy) return;
                  setBusy(true); setErr(null);
                  try { await onTake(conflict.proposed); }
                  catch (ex: any) { setErr(String(ex?.message ?? ex)); }
                  finally { setBusy(false); }
                }}
                disabled={busy}
                style={btn(true)}
              >
                {busy ? 'Accepting…' : 'Accept new'}
              </button>
              {err && (
                <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10, color: '#f43f5e' }}>
                  {err}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** THE VERB ROW. The arc's label plus the word for what this scene does to
 *  it. There is no confirm step and no proposal: the pass writes a verb the
 *  way it writes the stop's text, and the writer changes it, replaces it with
 *  their own word, or clears it. The enum is a set of DEFAULTS the picker
 *  offers, not a closed vocabulary; a writer who reads a scene as "hardens"
 *  should be able to say "hardens". */
function VerbRow({
  arcLabel, verb, allowed, custom, editable, dark, onPick, onClear,
}: {
  /** The noun phrase the callout is about: "Nell's arc" on a character
   *  sheet, "this arc" on the arc's own. Composed by the caller so one row
   *  serves both ends of the edge. */
  arcLabel: string;
  verb: string;
  /** The defaults this scene's narrative_status permits. Backstory takes
   *  'touches' only, and the server enforces it, so nothing else is offered
   *  and a custom word is not either. */
  allowed: EvokesTransition[];
  custom: boolean;
  /** Only an open card is a working surface; a closed one stays read-only. */
  editable: boolean;
  dark: boolean;
  onPick: (t: string) => void;
  onClear: () => void;
}) {
  const arc = getEntityColor('arc');
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); };
  useEffect(() => {
    if (writing) requestAnimationFrame(() => { inputRef.current?.focus(); });
  }, [writing]);

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
        fontWeight: 700, cursor: 'pointer',
        color: active ? '#15161a' : arc,
        background: active ? arc : 'transparent',
        border: `1px solid ${hexToRgba(arc, active ? 1 : 0.45)}`,
        padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );

  if (picking) {
    return (
      <div
        onMouseDown={stop}
        onClick={stop}
        style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}
      >
        <span style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9,
          letterSpacing: 0.9, textTransform: 'uppercase', color: dark ? '#82828c' : '#9a9aa4',
          fontWeight: 700, marginRight: 2,
        }}>
          {arcLabel}
        </span>
        {allowed.map((t) => chip(t, t === verb, () => { setPicking(false); if (t !== verb) onPick(t); }))}
        {custom && verb && !(allowed as string[]).includes(verb) && chip(verb, true, () => setPicking(false))}
        {writing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={32}
            placeholder="your word"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') { setWriting(false); setDraft(''); }
              if (e.key === 'Enter') {
                const v = draft.trim();
                setWriting(false); setDraft(''); setPicking(false);
                if (v && v !== verb) onPick(v);
              }
            }}
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
              color: arc, background: 'transparent',
              border: `1px solid ${hexToRgba(arc, 0.45)}`, borderRadius: 999,
              padding: '2px 8px', width: 96, outline: 'none',
            }}
          />
        ) : (
          custom && (
            <button
              onClick={(e) => { e.stopPropagation(); setWriting(true); }}
              style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
                color: dark ? '#82828c' : '#9a9aa4', background: 'transparent',
                border: `1px dashed ${dark ? '#3a3a44' : '#d6d3cc'}`, borderRadius: 999,
                padding: '2px 8px', cursor: 'pointer',
              }}
            >
              your word&hellip;
            </button>
          )
        )}
        {verb && (
          <button
            onClick={(e) => { e.stopPropagation(); setPicking(false); onClear(); }}
            style={{
              background: 'transparent', border: 'none', padding: 0, marginLeft: 2,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
              color: dark ? '#82828c' : '#9a9aa4', cursor: 'pointer',
            }}
          >
            clear
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setPicking(false); setWriting(false); }}
          style={{
            background: 'transparent', border: 'none', padding: 0, marginLeft: 2,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
            color: dark ? '#82828c' : '#9a9aa4', cursor: 'pointer',
          }}
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
      <RungKicker
        label={verb ? `${arcLabel} · ${verb}` : arcLabel}
        color={arc}
        filled={!!verb}
        inline
        onClick={editable ? () => setPicking(true) : undefined}
      />
      {!verb && editable && (
        <button
          onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); setPicking(true); }}
          style={{
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
            color: hexToRgba(arc, 0.85), background: 'transparent',
            border: `1px dashed ${hexToRgba(arc, 0.35)}`, borderRadius: 999,
            padding: '2px 8px', cursor: 'pointer',
          }}
        >
          + what it does
        </button>
      )}
    </div>
  );
}

/** THE ARC CALLOUT. Everything the arc says about this stop lives in one
 *  violet container: the kicker, the text, and when there is a turn, its verb
 *  and the line that earns it. Exactly one per card, wherever the arc
 *  currently lives, so it never nests inside itself. A tinted panel with a
 *  hairline all round rather than the old thick left stripe. */
function ArcCallout({
  dark, strong = false, children,
}: {
  dark: boolean;
  /** A CONFIRMED turn. The writer said yes to this one, so it carries more
   *  weight than a stop the arc merely has a reading of: deeper tint, a real
   *  border, and a filled badge instead of a quiet label. */
  strong?: boolean;
  children: React.ReactNode;
}) {
  const arc = getEntityColor('arc');
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        background: hexToRgba(arc, strong ? (dark ? 0.14 : 0.085) : (dark ? 0.07 : 0.045)),
        border: `1px solid ${hexToRgba(arc, strong ? (dark ? 0.5 : 0.42) : (dark ? 0.26 : 0.22))}`,
        borderRadius: 8, padding: '9px 11px 10px',
        ...(strong ? { boxShadow: `inset 3px 0 0 ${hexToRgba(arc, 0.85)}` } : {}),
      }}
    >
      {children}
    </div>
  );
}

/** THE KICKER. Every rung gets one, in the same place, in the same mono, so
 *  a stop always says what you are looking at before it says it. The turn's
 *  `TURNS · INTRODUCES` was the only labelled rung and the only legible one;
 *  this gives the other three the same courtesy. */
function RungKicker({
  label, color, filled = false, inline = false, onClick,
}: {
  label: string;
  color: string;
  /** Makes the label the control that edits what it names. */
  onClick?: () => void;
  /** Sitting in a row beside something else, so it drops its own bottom gap. */
  inline?: boolean;
  /** Filled reads as a claim the writer has accepted; plain reads as a
   *  heading. Only a confirmed turn earns the fill. */
  filled?: boolean;
}) {
  if (filled) {
    return (
      <span
        onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
        title={onClick ? 'Not the right verb? Pick another' : undefined}
        style={{
        cursor: onClick ? 'pointer' : undefined,
        alignSelf: 'flex-start',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 9, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase',
        color: '#15161a', background: color,
        padding: '3px 9px', borderRadius: 999, marginBottom: inline ? 0 : 2,
      }}>
        {label}
      </span>
    );
  }
  return (
    <span style={{
      display: 'block', fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase',
      color, marginBottom: inline ? 0 : 4,
    }}>
      {label}
    </span>
  );
}

/** THE FACE. One rung, always labelled, and it does NOT move when the card
 *  opens: opening adds material below it rather than re-rendering the top
 *  under a different heading. At rank 1 the face is where the text is edited,
 *  so the words never change size or position between reading and writing. */
function StopFace({
  open, rank, text, transition, observable, charName, dark, flags, verbRow, arcExtra,
  introBeat, openSignal, textStale, textRewritten, onSaveText,
}: {
  open: boolean;
  rank: 1 | 2 | 3;
  text: string;
  transition: string;
  observable: string;
  charName: string;
  dark: boolean;
  flags: Array<{ key: string; tone: 'warn' | 'quiet' | 'peer'; label: string; chip?: boolean }>;
  /** The callout's label row: the arc's name, the verb it carries, and the
   *  control for changing that verb. Built by the caller so the face and the
   *  slate share one implementation. */
  verbRow?: React.ReactNode;
  /** Anything else that belongs INSIDE the arc callout, under the text: a
   *  confirmed turn's citation, a proposal's controls. Rank 1 only. */
  arcExtra?: React.ReactNode;
  introBeat: boolean;
  openSignal: number;
  textStale: boolean;
  textRewritten: boolean;
  onSaveText: (t: string) => Promise<unknown>;
}) {
  const arc = getEntityColor('arc');
  const grey = dark ? '#82828c' : '#9a9aa4';
  const toneColor = (t: 'warn' | 'quiet' | 'peer') =>
    t === 'warn' ? '#d97706' : t === 'peer' ? PEER_BLUE : (dark ? '#8f8f9a' : '#9a9aa4');
  const who = charName || 'them';
  // A flag exists so a CLOSED card can be found down a long run. Once the
  // card is open the material itself is on screen and the flag repeats it.
  const faceFlags = open ? flags.filter((f) => f.key !== 'c') : flags;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rank === 1 && (
        <ArcCallout dark={dark} strong={!!transition}>
          {/* A confirmed turn is the SAME claim as an ordinary stop plus a
              verb, not a different species with its own noun. "Turn" is
              McKee's dialect: precise, but absent from the general glossaries
              and taught before it is used, so a writer who came up through
              Save the Cat or Field may never have met it. The verb was
              always doing the work; the filled badge carries the weight. */}
          {verbRow}
          {open ? (
            <StopText
              value={text}
              stale={textStale}
              rewritten={textRewritten}
              introBeat={introBeat}
              openSignal={openSignal}
              dark={dark}
              onSave={onSaveText}
              size={16}
            />
          ) : (
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 16, lineHeight: 1.5, color: dark ? '#e5e5ea' : '#25262c' }}>
              {text}
            </div>
          )}
          {arcExtra}
        </ArcCallout>
      )}
      {rank === 2 && (
        <div>
          <RungKicker label={`${who} here`} color={grey} />
          {observable ? (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: dark ? '#b7b7c0' : '#4a4f5c' }}>
              {observable}
            </div>
          ) : (
            // Evaluated and empty is an ANSWER, not a gap: extraction read
            // this pairing and nothing landed.
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 14, fontStyle: 'italic', color: dark ? '#63636d' : '#adaab2' }}>
              {`Nothing lands on ${who} here.`}
            </div>
          )}
        </div>
      )}
      {rank === 3 && (
        // The scene is already above this. Nothing has been read of it yet,
        // and saying so quietly is better than an empty labelled slot.
        <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 13.5, fontStyle: 'italic', color: dark ? '#55555c' : '#b5b2ba' }}>
          {`Nothing read of ${who} here yet.`}
        </div>
      )}
      {faceFlags.length > 0 && (
        // Flags are off the ladder: calls to action, not content, so they
        // never compete for the slot and show at every rank.
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {faceFlags.map((f) => (
            <span
              key={f.key}
              style={f.chip
                // A proposal announces itself with its own badge. Saying "a
                // turn is proposed" next to the badge that says exactly that
                // was the same sentence twice.
                ? {
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
                  fontWeight: 700, color: PEER_BLUE,
                  border: `1px dashed ${hexToRgba(PEER_BLUE, 0.55)}`,
                  padding: '2px 8px', borderRadius: 999,
                }
                : {
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 9.5,
                  color: toneColor(f.tone), fontWeight: f.tone === 'warn' ? 700 : 400,
                }}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The one text. Click to edit; saving stamps the writer as its author, which
 *  is the only thing that keeps a later pass off it. No colour, no face, no
 *  label distinguishes it from what the pass wrote. */
function StopText({
  value, stale, rewritten, introBeat, openSignal, dark, onSave, size = 14,
}: {
  value: string;
  stale: boolean;
  rewritten: boolean;
  introBeat: boolean;
  openSignal: number;
  dark: boolean;
  onSave: (text: string) => Promise<unknown>;
  /** Matches whatever the surrounding rung reads at, so switching between
   *  reading and writing does not resize the words under the pointer. */
  size?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // A peer question's "Answer here" bumps openSignal to reach in.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      setDraft(value);
      setEditing(true);
    }
  }, [openSignal, value]);
  useEffect(() => {
    if (editing) requestAnimationFrame(() => { taRef.current?.focus(); });
  }, [editing]);

  const save = async () => {
    const text = draft.trim();
    // Unchanged text still SAVES when the ground moved underneath: same
    // words, fresh hash, marker clears. That is the re-affirm gesture.
    if (!text || (text === value && !stale)) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try { await onSave(text); setEditing(false); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  if (editing) {
    return (
      <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Contained: Escape cancels THIS editor, not the whole sheet.
            if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          }}
          rows={4}
          placeholder={introBeat ? 'How do they enter the story…' : 'What does this scene do to them…'}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            background: dark ? '#141518' : '#fbfaf7',
            border: `1px solid ${dark ? '#2b2b32' : '#e0ddd6'}`, borderRadius: 7,
            padding: '8px 10px', fontFamily: NOTE_FONT_SERIF, fontSize: size, lineHeight: 1.5,
            color: dark ? '#e5e5ea' : '#25262c', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => void save()}
            disabled={busy || !draft.trim()}
            style={{
              height: 24, padding: '0 11px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              fontFamily: 'system-ui, sans-serif', cursor: busy || !draft.trim() ? 'default' : 'pointer',
              border: `1px solid ${hexToRgba(PEER_BLUE, 0.5)}`, background: hexToRgba(PEER_BLUE, dark ? 0.12 : 0.09), color: PEER_BLUE,
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setEditing(false)}
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 11, color: dark ? '#82828c' : '#9a9aa4', cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}
          >
            Cancel
          </button>
          <span style={{ fontSize: 10, color: dark ? '#55555c' : '#b5b2ba', marginLeft: 'auto' }}>{"⌘↩ saves"}</span>
        </div>
        {err && (
          <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10, color: '#f43f5e' }}>
            {`Not saved: ${err}`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
      title="Edit"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'text' }}
    >
      {value ? (
        <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: size, lineHeight: 1.5, color: dark ? '#e5e5ea' : '#25262c' }}>
          {value}
        </div>
      ) : (
        <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: size, fontStyle: 'italic', color: dark ? '#55555c' : '#b5b2ba' }}>
          {introBeat ? 'How do they enter the story…' : 'What does this scene do to them…'}
        </div>
      )}

    </div>
  );
}




/** THE SLATE. Strictly ADDITIVE: the face keeps whatever rung it was already
 *  showing, in place, and opening appends what the face did not have, in
 *  ladder order. Nothing is re-headed, nothing moves, and a block a stop has
 *  no material for is simply absent rather than present and empty. */
function StopSlate({
  dark, charName, introBeat, rank,
  text, textStale, textRewritten, openSignal, onSaveText,
  turn, verbRow,
  question, onAnswerQuestion, onDismissQuestion,
  observable, observableGrade,
  subEvents, onOpenScene, onRemoveFromScene,
}: {
  dark: boolean;
  charName: string;
  introBeat: boolean;
  /** Which rung the FACE is already carrying, so the slate does not repeat it. */
  rank: 1 | 2 | 3;
  text: string;
  textStale: boolean;
  textRewritten: boolean;
  openSignal: number;
  onSaveText: (text: string) => Promise<unknown>;
  turn: { transition: string; quote: string } | null;
  /** The callout's label row, built by the caller (see StopFace). */
  verbRow?: React.ReactNode;
  question: { text: string; quote: string } | null;
  onAnswerQuestion: () => void;
  onDismissQuestion: () => void;
  observable: string;
  observableGrade: string;
  subEvents: SubEvent[];
  onOpenScene: () => void;
  onRemoveFromScene: () => void;
}) {
  const eventColor = getEntityColor('event');
  const arc = getEntityColor('arc');
  const grey = dark ? '#82828c' : '#9a9aa4';
  const who = charName || 'them';
  const quoteStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10.5, lineHeight: 1.7,
    color: dark ? '#8b8b95' : '#6b6f7a', paddingLeft: 10,
  };
  const blocks: React.ReactNode[] = [];

  // ONE CALLOUT PER CARD. At rank 1 the face already carries it, extras and
  // all, so the slate adds nothing about the arc. At rank 2 and 3 the face is
  // showing something else, so the callout opens here instead.
  if (rank !== 1) {
    blocks.push(
      <ArcCallout key="arc" dark={dark} strong={!!turn}>
        {verbRow}
        <StopText
          value={text}
          stale={textStale}
          rewritten={textRewritten}
          introBeat={introBeat}
          openSignal={openSignal}
          dark={dark}
          onSave={onSaveText}
        />
        {turn && turn.quote.trim() && <div style={quoteStyle}>{turn.quote}</div>}
      </ArcCallout>,
    );
  }

  if (question) {
    blocks.push(
      <div key="q">
        <RungKicker label="a question" color={PEER_BLUE} />
        <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 13, lineHeight: 1.5, color: dark ? '#d6d6de' : '#2c3140' }}>
          {question.text}
        </div>
        {question.quote?.trim() && <div style={{ ...quoteStyle, marginTop: 4 }}>{question.quote}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onAnswerQuestion(); }}
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', color: PEER_BLUE, cursor: 'pointer' }}
          >
            {`Answer in ${who}'s arc`}
          </button>
          <RemoveLink label="Dismiss · never asks again" onRemove={onDismissQuestion} />
        </div>
      </div>,
    );
  }

  // Extraction's testimony. ABSENT when the pairing was never evaluated:
  // "not evaluated yet" is machine bookkeeping, not something to read.
  if (rank !== 2 && observableGrade) {
    blocks.push(
      <div key="obs">
        <RungKicker label={`${who} here`} color={grey} />
        <div style={{
          fontSize: 12.5, lineHeight: 1.6,
          color: observable ? (dark ? '#b7b7c0' : '#4a4f5c') : (dark ? '#63636d' : '#adaab2'),
          fontStyle: observable ? 'normal' : 'italic',
        }}>
          {observable || `Nothing lands on ${who} here.`}
        </div>
      </div>,
    );
  }

  if (subEvents.length > 0) {
    blocks.push(
      <div key="beats">
        <RungKicker label={`${subEvents.length} beat${subEvents.length === 1 ? '' : 's'}`} color={grey} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {subEvents.map((sub, i) => (
            <div key={i} style={{ paddingLeft: 8, borderLeft: `2px solid ${hexToRgba(eventColor, 0.28)}` }}>
              {sub.slugline && (
                <div style={{ fontSize: 10, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', color: dark ? '#9a9aa4' : '#666', letterSpacing: 0.2 }}>
                  {sub.slugline}
                </div>
              )}
              {sub.description && (
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: dark ? '#b9b9c2' : '#4a4f5c' }}>
                  {sub.description}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>,
    );
  }

  blocks.push(
    <div key="acts" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        onClick={(e) => { e.stopPropagation(); onOpenScene(); }}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          fontSize: 11, fontWeight: 600, fontFamily: 'inherit', color: eventColor,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        Open scene sheet
        <span style={{ opacity: 0.7 }}>&rarr;</span>
      </button>
      <RemoveLink label="Not in this scene" onRemove={onRemoveFromScene} />
    </div>,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map((b, i) => (
        <div
          key={i}
          style={{
            borderTop: i === 0 ? 'none' : `1px solid ${dark ? '#232329' : '#efece6'}`,
            paddingTop: i === 0 ? 0 : 10,
          }}
        >
          {b}
        </div>
      ))}
    </div>
  );
}

/** The arc's own Read, pinned above its run. Deliberately identical to the
 *  character sheet's: same peer blue, same intern mark, same centred layout.
 *  It is the same act on the same kind of object, so it should not look like
 *  a different feature because it lives on a different sheet. */
function BuildRunHeader({
  dark, busy, err, ran, sceneCount, onRun,
}: {
  dark: boolean;
  busy: boolean;
  err: string | null;
  ran: boolean;
  sceneCount: number;
  onRun: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => !busy && sceneCount > 0 && onRun()}
          disabled={busy || sceneCount === 0}
          title={sceneCount === 0
            ? 'No scenes on this arc yet'
            : 'Read the whole thread, scene by scene, in order. The one action here that costs a model call.'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 15px',
            fontSize: 12.5, fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap',
            fontFamily: 'system-ui, sans-serif',
            cursor: busy || sceneCount === 0 ? 'default' : 'pointer',
            border: `1px solid ${hexToRgba(PEER_BLUE, 0.55)}`,
            background: hexToRgba(PEER_BLUE, dark ? 0.12 : 0.08),
            color: PEER_BLUE, opacity: sceneCount === 0 ? 0.5 : 1,
          }}
        >
          <InternIcon size={13} />
          <span>{busy ? 'Reading…' : ran ? 'Read again' : 'Read this arc'}</span>
        </button>
        {sceneCount > 0 && !busy && (
          <span style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#6b6f7d', fontFamily: 'system-ui, sans-serif' }}>
            {`${sceneCount} scene${sceneCount === 1 ? '' : 's'} on this arc`}
          </span>
        )}
        {err && (
          <span style={{ fontSize: 11, color: '#dc2626', fontFamily: 'system-ui, sans-serif' }}>{err}</span>
        )}
      </div>
    </div>
  );
}

/** Build Arc, pinned above the cascade: the one paid act, summoned, with the
 *  free staleness banner beside it. Deliberately NO arc band here (Ben,
 *  2026-08-28): the arc lives in its data — turn chips on the stops — not as
 *  a standing panel over the run. */
function BuildArcHeader({
  dark, busy, err, pass, staleCount, sceneCount, onRun,
}: {
  dark: boolean;
  busy: boolean;
  err: string | null;
  pass: BuildCharacterArcResponse | null;
  staleCount: number;
  sceneCount: number;
  onRun: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => !busy && sceneCount > 0 && onRun()}
          disabled={busy || sceneCount === 0}
          title={sceneCount === 0
            ? 'No scenes on their line yet'
            : 'Read the whole line, scene by scene, in order. The one action here that costs a model call.'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 15px',
            fontSize: 12.5, fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap',
            fontFamily: 'system-ui, sans-serif',
            cursor: busy || sceneCount === 0 ? 'default' : 'pointer',
            border: `1px solid ${hexToRgba(PEER_BLUE, 0.55)}`,
            background: hexToRgba(PEER_BLUE, dark ? 0.12 : 0.08),
            color: PEER_BLUE, opacity: sceneCount === 0 ? 0.5 : 1,
          }}
        >
          <InternIcon size={13} />
          {/* One word on both surfaces. "Build" oversold it even before the
              arc started minting itself: the pass reads a run and writes what
              it found. It builds nothing. */}
          <span>{busy ? 'Reading\u2026' : pass ? 'Read again' : 'Read their line'}</span>
        </button>
        {pass && !busy && (
          <span style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#6b6f7d', fontFamily: 'system-ui, sans-serif' }}>
            Read against {Object.keys(pass.basisHashes ?? {}).length} scenes
            {staleCount > 0 && (
              <span style={{ color: dark ? '#d9bd8e' : '#8a6a2f' }}> \u00b7 {staleCount} changed since</span>
            )}
          </span>
        )}
        {err && (
          <span style={{ fontSize: 11, color: '#dc2626', fontFamily: 'system-ui, sans-serif' }}>{err}</span>
        )}
      </div>

    </div>
  );
}

// Which categories the scene sheet shows, in this order. Everything else the
// tile builder produces (causality, throughline, sequence, sub-events) is
// still BUILT — its editors are intact — just not on stage while the surface
// settles. Putting one back is adding its id here. (FIL-588)
/** PEER QUESTIONS ON THE STOPS: parked, not deleted (Ben, 2026-08-29).
 *
 *  The pass still asks them and `build-character-arc` still returns them, so
 *  nothing about the architecture changed: the schema, the citation rule, the
 *  0-to-3 discipline, the per-character dismissal store and `StopSlate`'s
 *  rendering are all intact and exercised the moment this flips back to true.
 *
 *  What is parked is the SURFACE. A question and the arc text are the same
 *  slot under one-text: the answer to "does she act during the flood, or is
 *  she only cut off?" IS that scene's reading. Rendering the question as its
 *  own labelled block, louder than the callout it feeds, with a button whose
 *  job was to send you back up to the field you already had open, made two
 *  objects out of one. When it returns it should return as the PLACEHOLDER of
 *  an empty arc text on that stop, not as a section.
 *
 *  Flip to true to bring the old surface back unchanged. */
const SHOW_PEER_QUESTIONS_ON_STOPS = false;

const EVENT_ORBIT_TILES = ['summary', 'cast', 'knowledge', 'working', 'location', 'arcs'];

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

  const refetchQuestionsRef = useRef<(() => void) | null>(null);
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
  useEffect(() => { refetchQuestionsRef.current = refetchQuestions; }, [refetchQuestions]);

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
  // Which question has its thread open. Drives that card's expanded width —
  // a thread needs a workspace, a single answer field does not.
  const [peerChatQuestionId, setPeerChatQuestionId] = useState<string | null>(null);
  // Which question the writer currently has open. While one is, the focal
  // card shows the peer's read instead of the scene's own summary.
  const [peerOpenQuestionId, setPeerOpenQuestionId] = useState<string | null>(null);
  // ONE peer session for the whole sheet. It has to live here, not inside the
  // Ask button: the button starts the ask, the FOCAL card renders the prose it
  // streams, and the RING renders the questions it produces. A session owned
  // by the button could feed none of that, which is why pressing Ask looked
  // like it did nothing — the work ran and had nowhere to land.
  const peer = usePeerSession({
    entity,
    projectId,
    userId: auth.userId,
    token: auth.token,
    onCardQuestionsChanged: () => { refetchQuestionsRef.current?.(); },
    onCascadeFallbackRefresh: onEntitiesChanged,
  });
  // SC number from the canonical told-order — the same helper the board
  // numbers its cards with, so the badge here matches the card out there.
  const sceneNo = useMemo(() => {
    const sorted = toldOrderEvents(
      allEntities.filter((e) => !e.deleted_at && !(e.type === 'event' && e.narrative_status === 'backstory')),
      edges.precedes ?? [],
      edges.contains ?? [],
      edges.sequence_precedes ?? [],
      (edges as any).cross_precedes ?? [],
    );
    const i = sorted.findIndex((e) => e.id === entity.id);
    return i >= 0 ? i + 1 : null;
  }, [allEntities, edges, entity.id]);

  // The sequence this scene sits in, if any — the badge row names it so the
  // card says where it belongs, not just what it is.
  const sceneSequenceName = (() => {
    const seqId = (edges.contains ?? []).find((c) => c.to === entity.id)?.from;
    if (!seqId) return null;
    const seq = allEntities.find((e) => e.id === seqId);
    return seq ? (seq.working_title ?? seq.working_name ?? null) : null;
  })();

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
  // Story arcs only: a character-primary arc (character_id set) belongs to
  // its character's cascade, never to this scene's Arcs tile — a confirmed
  // turn is a claim about the CHARACTER, and rendering it here made accepting
  // a turn look like it was editing some arc card.
  const storyArcEntries = (signal.evokesArcEntries ?? []).filter((a: any) => {
    const ent = allEntities.find((e) => e.id === String(a.arc_id ?? a.id));
    return !String((ent as any)?.character_id ?? '');
  });
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
          {/* A scene badge, so the focal card carries its own identity. Every
              satellite around it wears a kicker; the thing they orbit was the
              one card on the sheet that read as anonymous prose. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {sceneNo != null && (
              <span
                style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.7,
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                  color, background: hexToRgba(color, dark ? 0.16 : 0.1),
                  border: `1px solid ${hexToRgba(color, 0.35)}`,
                  padding: '3px 8px', borderRadius: 999,
                }}
              >
                SC {String(sceneNo).padStart(2, '0')}
              </span>
            )}
            <span
              style={{
                fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
                color: narrativeStatusFg((entity.narrative_status as string) ?? 'on_screen'),
                background: narrativeStatusBg((entity.narrative_status as string) ?? 'on_screen'),
                padding: '3px 8px', borderRadius: 999,
              }}
            >
              {narrativeStatusLabel((entity.narrative_status as string) ?? 'on_screen')}
            </span>
            {sceneSequenceName && (
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.3, color: getEntityColor('sequence') }}>
                in {sceneSequenceName}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: dark ? '#5c5c66' : '#adaab2', fontWeight: 600 }}>
              click to edit
            </span>
          </div>
          <InlineText
            value={entity.summary ?? ''}
            placeholder="Add a summary…"
            // The peer's serif: this is the scene in its own words, and it
            // should read like prose rather than like a form field.
            style={{ marginBottom: 10, fontFamily: NOTE_FONT_SERIF, fontSize: 14.5, lineHeight: 1.6 }}
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
            <blockquote
              style={{
                margin: 0, paddingLeft: 12, borderLeft: `2px solid ${hexToRgba(color, 0.3)}`,
                fontFamily: NOTE_FONT_SERIF, fontSize: 12, lineHeight: 1.6,
                color: dark ? '#8e8e98' : '#777', fontStyle: 'italic',
              }}
            >
              &ldquo;{entity.evidence_quote}&rdquo;
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
      id: 'arcs', label: 'Arcs', summary: `${storyArcEntries.length}`, accent: '#a855f7', defaultW: 1, defaultExpanded: storyArcEntries.length > 0,
      hint: 'Arcs this scene evokes, with the transition each one makes here.',
      // Threading an arc through a scene is an EDIT — what the arc is doing
      // here, and where it stands after. That happens on the card, like every
      // other category; leaving for the arc's own sheet is the deliberate
      // click at the bottom of the expanded card.
      add: {
        noun: 'an arc',
        emptyHint: 'Every arc already runs through this scene.',
        candidates: allEntities
          .filter((e) => e.type === 'arc' && !e.deleted_at
            && !String((e as any).character_id ?? '')
            && !(signal.evokesArcEntries ?? []).some((x: any) => String(x.arc_id ?? x.id) === e.id))
          .map((e) => ({
            id: e.id,
            label: e.working_name ?? e.working_title ?? e.id,
            sublabel: e.kind ? arcKindLabel(e.kind as ArcKind) : undefined,
          })),
        onAdd: (id: string) =>
          tagEventEvokes({ eventId: entity.id, arcId: id, projectId }, auth.token)
            .then(() => onEntitiesChanged()),
      },
      items: storyArcEntries.map((a: any) => {
        const arcId = String(a.arc_id ?? a.id);
        const arcEnt = allEntities.find((e) => e.id === arcId);
        return {
          id: arcId,
          kicker: arcEnt?.kind ? `arc · ${arcKindLabel(arcEnt.kind as ArcKind)}` : 'arc',
          accent: getEntityColor('arc'),
          title: resolveName(arcId),
          tag: a.transition || undefined,
          tagColor: getEntityColor('arc'),
          rowsSummary: a.state_at_event ? 'where it stands' : 'nothing set here yet',
          expandedWidth: 340,
          expanded: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <EvokesArcControls
                transition={(a.transition ?? '') as EvokesTransition | ''}
                stateAtEvent={String(a.state_at_event ?? '')}
                eventNarrativeStatus={(entity.narrative_status as string) ?? 'on_screen'}
                onUpdate={(fields) =>
                  tagEventEvokes({ eventId: entity.id, arcId, projectId, ...fields }, auth.token)
                    .then(() => onEntitiesChanged())
                }
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => onOpenCard(arcId)}
                  style={{
                    background: 'transparent', border: 'none', padding: 0,
                    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                    color: getEntityColor('arc'), cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  Open arc sheet
                  <span style={{ opacity: 0.7 }}>&rarr;</span>
                </button>
                <RemoveLink
                  label="Remove from scene"
                  onRemove={() =>
                    untagEventEvokes({ eventId: entity.id, arcId, projectId }, auth.token)
                      .then(() => onEntitiesChanged())
                  }
                />
              </div>
            </div>
          ),
        };
      }),
      content: (
        <EventEvokesEditor eventId={entity.id} eventNarrativeStatus={(entity.narrative_status as string) ?? 'on_screen'} arcsEvoked={storyArcEntries} allEntities={allEntities} auth={auth} projectId={projectId} onOpenCard={onOpenCard} onChanged={onEntitiesChanged} />
      ),
    },
    {
      id: 'knowledge', label: 'Knowledge', summary: `${knowledgeFacts.length}`, accent: '#0ea5e9', defaultW: 2, defaultExpanded: sceneKnowledge.length > 0,
      hint: "Facts this scene establishes or touches, and who holds each one.",
      // Write, don't pick. A fact worth adding to a scene is one that isn't
      // in the story yet, so a roster of existing facts is a wall between the
      // writer and typing. Pulling an EXISTING fact in is still possible from
      // the panel's picker; this is the fast path for the common case.
      add: {
        noun: 'a fact',
        onCreate: (text: string) =>
          createInformation({ projectId, eventId: entity.id, summary: text }, auth.token)
            .then(() => onEntitiesChanged()),
      },
      // Each fact wears who holds it and who is in the dark — the whole point
      // of the layer, and the thing the tile buried in a list (Paul, FIL-588).
      items: knowledgeFacts.map((f) => {
        const edgesFor = knowledgeByInfo.get(f.id) ?? [];
        const named = (pred: (st: string) => boolean) =>
          edgesFor.filter((k) => pred(k.state)).map((k) => resolveName(k.knower_id));
        const knows = named((st) => st === 'knows');
        const suspects = named((st) => st === 'suspects');
        const dark = named((st) => st !== 'knows' && st !== 'suspects');
        // The collapsed line is the irony in one glance: a gap between the
        // knows count and the in-the-dark count IS the dramatic irony. Open
        // the card for the names.
        const tally = [
          knows.length > 0 ? `${knows.length} know${knows.length === 1 ? 's' : ''}` : '',
          suspects.length > 0 ? `${suspects.length} suspect${suspects.length === 1 ? 's' : ''}` : '',
          dark.length > 0 ? `${dark.length} in the dark` : '',
        ].filter(Boolean).join(' · ');
        return {
          id: f.id,
          kicker: infoIdSet.has(f.id) ? 'established here' : 'information',
          accent: '#0ea5e9',
          title: f.summary,
          rowsSummary: tally || 'nobody holds this yet',
          // Expanding gives the writer the real control, not a read-out of it:
          // the same three chip editors the panel uses, writing straight
          // through to set-knowledge and re-anchoring to THIS scene.
          expanded: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <KnowledgeFactBuckets
                compact
                edgesFor={edgesFor}
                knowerCandidates={knowerCandidates}
                resolveName={resolveName}
                onSet={(knowerId, state) =>
                  setKnowledge({ projectId, knowerId, infoId: f.id, state, eventId: entity.id }, auth.token)
                    .then(() => onEntitiesChanged())
                }
              />
              {/* Taking a fact off the scene lives on the card for the same
                  reason setting its state does: the Add button is a picker
                  now, so the editor panel that used to carry this isn't the
                  way in any more. */}
              <RemoveLink
                label="Remove from scene"
                onRemove={() =>
                  unlinkInformation({ projectId, infoId: f.id, eventId: entity.id }, auth.token)
                    .then(() => onEntitiesChanged())
                }
              />
            </div>
          ),
        };
      }),
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#64748b', marginBottom: 5 }}>
              Established here · {infoHere.length}
            </div>
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
          </div>
        </div>
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
      // Orbit satellites: each cast member is a node you can open, so the
      // sheet walks the graph instead of dead-ending on a chip.
      // The Add button becomes the character picker itself (FIL-588). Same
      // tag call the tile's EdgeChips makes, just reachable without opening
      // the whole editor across the board.
      add: {
        noun: 'someone',
        emptyHint: 'Everyone in this story is already in the scene.',
        candidates: characterCandidates(new Set(castIds)),
        onAdd: (id: string) =>
          tagEventInvolvesCharacter({ eventId: entity.id, characterId: id, projectId }, auth.token)
            .then(() => onEntitiesChanged()),
      },
      // Clicking a cast card opens it IN PLACE. It used to jump straight to
      // that character's own full sheet, which threw the writer out of the
      // scene they were working on to answer a question about it. Leaving for
      // the character's sheet is still one click, just a deliberate one.
      items: castIds.map((id) => {
        const c = allEntities.find((e) => e.id === id);
        const traits = ((c?.established_traits ?? []) as string[]).filter(Boolean);
        const desc = String(c?.description ?? '').trim();
        return {
          id,
          shape: 'pill' as const,
          kicker: 'character',
          accent: getEntityColor('character'),
          title: resolveName(id),
          rowsSummary: traits.length > 0
            ? `${traits.length} trait${traits.length === 1 ? '' : 's'}`
            : desc ? 'who they are' : 'nothing written yet',
          expanded: (
            <SatelliteDetail
              description={desc}
              chips={traits}
              accent={getEntityColor('character')}
              openLabel="Open character sheet"
              onOpen={() => onOpenCard(id)}
              removeLabel="Remove from scene"
              onRemove={() =>
                untagEventInvolvesCharacter({ eventId: entity.id, characterId: id, projectId }, auth.token)
                  .then(() => onEntitiesChanged())
              }
            />
          ),
        };
      }),
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
      items: occursInIds.map((id) => {
        const loc = allEntities.find((e) => e.id === id);
        const desc = String(loc?.description ?? '').trim();
        return {
          id,
          kicker: [(loc as any)?.int_ext, 'location'].filter(Boolean).join(' · '),
          accent: getEntityColor('location'),
          title: resolveName(id),
          rowsSummary: desc ? 'what it is' : 'nothing written yet',
          expanded: (
            <SatelliteDetail
              description={desc}
              chips={[]}
              accent={getEntityColor('location')}
              openLabel="Open location sheet"
              onOpen={() => onOpenCard(id)}
              removeLabel="Remove from scene"
              onRemove={() =>
                untagEventOccursIn({ eventId: entity.id, locationId: id, projectId }, auth.token)
                  .then(() => onEntitiesChanged())
              }
            />
          ),
        };
      }),
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
      id: 'working', label: 'Peer', summary: questions == null ? '\u2026' : `${byStatus.open.length + byStatus.stashed.length}`, accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: "The peer's open questions about this scene. Answer inline, or open a thread.",
      icon: <InternIcon size={13} />,
      // Writing your own question, the one thing the peer can't do for you.
      // The peer's own ask is on the focal card, so this button doesn't need
      // to open a panel carrying a second copy of it.
      add: {
        noun: 'your own question',
        onCreate: (text: string) =>
          createWriterQuestion(
            { projectId, cardId: entity.id, userId: auth.userId, workingSectionLabel: text },
            auth.token,
          ).then(() => refetchQuestions()),
      },
      // The ask lives on the FOCAL card: you press it on the thing being asked
      // about, and the questions arrive as cards around it.
      focalAction: <FocalAskPeer peer={peer} />,
      // Content is supplied whenever there IS a read; whether it SHOWS is the
      // flag below. Keeping them separate is what lets the swap animate.
      focalOverrideActive: !!peerOpenQuestionId,
      focalOverride:
        peer.streaming.prose ? (
          <div style={{ paddingTop: 4 }}>
            <div
              style={{
                fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
                color: PEER_BLUE, fontWeight: 600, marginBottom: 8,
              }}
            >
              The peer&rsquo;s read
            </div>
            <PeerReadProse text={peer.streaming.prose} dark={dark} />
          </div>
        ) : undefined,
      // Collapsed, a peer card is JUST the question — that is the thing you
      // read across a ring of them. The rationale is the peer's commentary on
      // why it asked, worth reading once you have picked a question, so it
      // waits inside with the answer field and the thread.
      // Live-streamed questions pop in as the peer writes them; persisted ones
      // that aren't part of the current ask follow. Deduped by id so a
      // question doesn't appear twice the moment the refetch lands.
      items: (() => {
        const live = peer.visiblePeerQuestions ?? [];
        const liveIds = new Set(live.map((q) => q.questionId));
        // Everything EXCEPT dismissed. Filtering to status 'open' meant a
        // question that got stashed or answered — which is what a second ask
        // does to the previous round — silently vanished from the ring.
        // Dismissing is the only thing that should remove a card, and that is
        // a deliberate click on the card's own trash.
        const rest = (questions ?? []).filter(
          (q) => q.status !== 'dismissed' && !liveIds.has(q.questionId),
        );
        return [...live, ...rest] as PersistedQuestion[];
      })().map((q) => ({
        id: q.questionId,
        shape: 'peer' as const,
        kicker: q.workingSectionLabel || 'open question',
        title: q.questionText,
        tag: q.status === 'answered' ? 'answered' : undefined,
        tagColor: '#10b981',
        rowsSummary: q.status === 'answered' ? 'your answer' : 'answer or discuss',
        onExpandChange: (isOpen: boolean) =>
          setPeerOpenQuestionId((prev) => (isOpen ? q.questionId : prev === q.questionId ? null : prev)),
        // A thread turns the card into a workspace, so it asks for real room.
        expandedWidth: peerChatQuestionId === q.questionId ? 560 : 400,
        expanded: (
          // The composer itself — same answer field and same thread the panel
          // uses, just without the question printed twice and with the
          // commentary already open.
          <QuestionComposer
            question={{
              questionId: q.questionId,
              askId: q.askId ?? '',
              cardId: q.cardId,
              projectId: q.projectId,
              orderIndex: q.orderIndex,
              questionText: q.questionText,
              workingSectionLabel: q.workingSectionLabel,
              rationale: q.rationale,
              authoredBy: q.authoredBy,
              status: q.status,
              threadId: q.threadId,
              responseId: q.responseId,
              responseProse: q.responseProse ?? undefined,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
            }}
            persistedStatus={q.status}
            isOpen
            onToggle={() => {}}
            entity={entity}
            slice={peer.slice}
            peerOriginalProse={peer.streaming.prose}
            projectId={projectId}
            userId={auth.userId}
            token={auth.token}
            completedResponseIds={completedResponseIds}
            onStatusChange={() => refetchQuestions()}
            onChatOpenChange={(chatting) =>
              setPeerChatQuestionId((prev) => (chatting ? q.questionId : prev === q.questionId ? null : prev))
            }
            onResponseSubmitted={() => { refetchQuestions(); onEntitiesChanged(); }}
            hideStash
            bare
            hideQuestionText
            initialThread={
              (q as any).openThread
                ? { threadId: (q as any).openThread.threadId, turns: (q as any).openThread.turns }
                : undefined
            }
            initialClosedThread={
              (q as any).closedThread
                ? {
                    threadId: (q as any).closedThread.threadId,
                    turns: (q as any).closedThread.turns,
                    closedReason: (q as any).closedThread.closedReason,
                    closedAt: (q as any).closedThread.closedAt,
                  }
                : undefined
            }
          />
        ),
      })),
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

      {/* Orbit surface (FIL-588): the scene in the middle, one category on
          stage at a time. Only the summary rides IN the focal card; the
          sub-event breakdown is its own category, because it is a body of
          work in its own right and pinning it to the focal made the middle
          of the sheet the tallest thing on it. */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <OrbitSheet
          tiles={EVENT_ORBIT_TILES.map((id) => tiles.find((t) => t.id === id)).filter((t): t is SectionTileDef => !!t)}
          focalTileIds={['summary']}
          focalAccent={color}
          focalCardId={entity.id}
          auth={auth}
          projectId={projectId}
          persistKey={`event:${entity.id}`}
        />
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
  onOpenCard,
}: {
  entity: ProjectEntity;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  onClose: () => void;
  onUpdateDescription: (description: string) => Promise<void>;
  onEntitiesChanged: () => void;
  /** Opens another card's sheet — the orbit's shared-scene satellites are
   *  doors, like every other satellite. Optional so existing callers that
   *  have nowhere to navigate can leave them inert. */
  onOpenCard?: (cardId: string) => void;
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
      items: sharedEvents.map((ev) => ({
        id: ev.id,
        kicker: 'scene',
        accent: getEntityColor('event'),
        title: ev.working_title ?? ev.working_name ?? ev.id,
        onOpen: onOpenCard ? () => onOpenCard(ev.id) : undefined,
      })),
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
        <OrbitSheet tiles={tiles} focalTileIds={['identity']} focalAccent={color} focalCardId={entity.id} auth={auth} projectId={projectId} persistKey={`relationship:${entity.id}`} />
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
  completedResponseIds,
  onClose,
  onRename,
  onUpdateDescription,
  onOpenCard,
  onEntitiesChanged,
  onTagScenes,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  allEntities: ProjectEntity[];
  edges: ProjectEdges;
  auth: { userId: string; token: string };
  projectId: string;
  /** Responses already submitted, so the Peer tile can mark them done. */
  completedResponseIds: Set<string>;
  onClose: () => void;
  onRename: (newName: string) => Promise<void>;
  onUpdateDescription: (description: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  onEntitiesChanged: () => void;
  /** Opens the board's tagging morph: the wall in arc-select mode, any scene
   *  pickable, Accept writes the EVOKES tags and returns here (Ben
   *  2026-09-01). Absent on hosts without the wall (the script page). */
  onTagScenes?: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // --- Peer, same as the character and scene sheets ------------------------
  // An arc is a card like any other, so it gets the same peer surface rather
  // than its own: one session for the sheet, questions fetched and refetched
  // the same way, the same two ids driving the focal swap and the card width.
  const [questions, setQuestions] = useState<PersistedQuestion[] | null>(null);
  const refetchQuestions = useCallback(async () => {
    try {
      const res = await listCardQuestions(
        { cardId: entity.id, withResponses: true, withOpenThreads: true },
        auth.token,
      );
      setQuestions(res.questions);
    } catch (err) {
      console.warn('[arc sheet] fetch failed:', err);
    }
  }, [entity.id, auth.token]);
  useEffect(() => { refetchQuestions(); }, [refetchQuestions]);
  const refetchQuestionsRef = useRef<(() => void) | null>(null);
  useEffect(() => { refetchQuestionsRef.current = refetchQuestions; }, [refetchQuestions]);
  const [peerOpenQuestionId, setPeerOpenQuestionId] = useState<string | null>(null);
  const [peerChatQuestionId, setPeerChatQuestionId] = useState<string | null>(null);
  const peer = usePeerSession({
    entity,
    projectId,
    userId: auth.userId,
    token: auth.token,
    onCardQuestionsChanged: () => { refetchQuestionsRef.current?.(); },
    onCascadeFallbackRefresh: onEntitiesChanged,
  });
  const byStatus: Record<string, PersistedQuestion[]> = {
    open: [], answered: [], stashed: [], dismissed: [],
  };
  for (const q of questions ?? []) {
    (byStatus[q.status] ??= []).push(q);
  }

  const color = getEntityColor('arc');
  const kind = (entity.kind as ArcKind | undefined) ?? undefined;
  const evokes = signal.evokesEntries ?? [];

  // ---- THE ARC'S RUN (iteration 5) -----------------------------------------
  // The same cascade as a character's, from the other end of the edge. A
  // character's stop is an INVOLVES edge carrying `development`; an arc's is
  // the EVOKES edge carrying `state_at_event`, which has always meant "where
  // this leaves the arc here". So no new field and no new edge: the text was
  // already there, it was just being rendered as a caption.
  //
  // Two rungs, not three. Extraction testifies about people, not threads, so
  // there is no observable and nothing to grade: the ladder is the text, or
  // nothing read yet, over the scene summary.
  const eventsById = useMemo(
    () => new Map(allEntities.filter((e) => e.type === 'event').map((e) => [e.id, e])),
    [allEntities],
  );
  // The story's scene numbers, exactly as the character cascade computes them.
  // A scene is SC 07 wherever the writer meets it; numbering it only on one
  // sheet makes the same card look like two different things.
  const sceneNoById = useMemo(() => {
    const spine = toldOrderEvents(
      allEntities.filter((e) => !e.deleted_at && !(e.type === 'event' && e.narrative_status === 'backstory')),
      edges.precedes ?? [],
      edges.contains ?? [],
      edges.sequence_precedes ?? [],
      (edges as any).cross_precedes ?? [],
    );
    const out = new Map<string, number>();
    spine.forEach((e, i) => out.set(e.id, i + 1));
    return out;
  }, [allEntities, edges]);
  const evokesByEvent = useMemo(() => {
    const m = new Map<string, ProjectEdges['evokes'][number]>();
    for (const ev of edges.evokes ?? []) if (ev.arc_id === entity.id) m.set(ev.event_id, ev);
    return m;
  }, [edges.evokes, entity.id]);
  // The run is what someone PUT on the arc, in told order.
  //
  // Ranked against the WHOLE spine, never re-ordered as a subset. Running
  // toldOrderEvents over just this arc's scenes restricts PRECEDES to that
  // subset, and two scenes on one thread are almost never adjacent in the
  // chain, so the subset comes back edgeless and the "told order" it returns
  // is really extraction order. That is what put this arc's run in the order
  // SC 05, SC 04, SC 12, SC 13. Same fix, and same reason, as the character
  // cascade's orderedAppearsIn.
  //
  // A backstory scene has no rank because it is not on the told line at all;
  // it goes at the head of the thread rather than the tail.
  const arcRun = useMemo(() => {
    const on = (edges.evokes ?? [])
      .filter((ev) => ev.arc_id === entity.id)
      .map((ev) => eventsById.get(ev.event_id))
      .filter((e): e is ProjectEntity => !!e && !e.deleted_at);
    const rank = (id: string) => sceneNoById.get(id) ?? 0;
    const told = on.filter((e) => rank(e.id) > 0).sort((a, b) => rank(a.id) - rank(b.id));
    const untold = on.filter((e) => rank(e.id) === 0);
    return [...untold, ...told];
  }, [edges, entity.id, eventsById, sceneNoById]);

  // The pass and its resolutions survive a reload, the same way the
  // character cascade's do. A conflict is a finding about persisted text; if
  // it evaporated on refresh the writer would see it once and lose it.
  const arcPassKey = `ff-arcrun:${projectId}:${entity.id}`;
  const arcResolvedKey = `ff-arcrun-resolved:${projectId}:${entity.id}`;
  const [arcPass, setArcPass] = useState<BuildArcRunResponse | null>(() => {
    try { const raw = localStorage.getItem(`ff-arcrun:${projectId}:${entity.id}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [arcConflictsKept, setArcConflictsKept] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`ff-arcrun-resolved:${projectId}:${entity.id}`);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set<string>(); }
  });
  const resolveArcConflict = (eventId: string) => setArcConflictsKept((prev) => {
    const nx = new Set(prev); nx.add(eventId);
    try { localStorage.setItem(arcResolvedKey, JSON.stringify([...nx])); } catch { /* private mode */ }
    return nx;
  });
  const [arcPassBusy, setArcPassBusy] = useState(false);
  const [arcPassErr, setArcPassErr] = useState<string | null>(null);
  // Same free staleness mechanic as the character cascade: the ground each
  // reading was written against, hashed client-side in lockstep with the
  // Lambda's basisFor/basisHash.
  const [arcBasis, setArcBasis] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const e of arcRun) next[e.id] = await sha16(basisForScene(e));
      if (!cancelled) setArcBasis(next);
    })();
    return () => { cancelled = true; };
  }, [arcRun]);
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
      id: 'timeline', label: 'Timeline', summary: `${evokes.length}`, accent: color,
      defaultW: 2,
      // A rail, not a ring: what these cards have to say is that one comes
      // after another. Same cascade as a character's scenes, same ladder.
      layout: 'throughline',
      stageHeader: (
        <BuildRunHeader
          dark={dark}
          busy={arcPassBusy}
          err={arcPassErr}
          ran={!!arcPass}
          sceneCount={arcRun.length}
          onRun={async () => {
            setArcPassBusy(true); setArcPassErr(null);
            try {
              const res = await buildArcRun(
                { projectId, arcId: entity.id, orderedEventIds: arcRun.map((e) => e.id), userId: auth.userId },
                auth.token,
              );
              setArcPass(res);
              try { localStorage.setItem(arcPassKey, JSON.stringify(res)); } catch { /* private mode */ }
              // The pass WRITES its readings onto the edges, so the cascade
              // renders them from the graph rather than from this response.
              onEntitiesChanged();
            } catch (err: any) {
              setArcPassErr(String(err?.message ?? err));
            } finally {
              setArcPassBusy(false);
            }
          }}
        />
      ),
      items: arcRun.map((ev) => {
        const edge = evokesByEvent.get(ev.id);
        const summary = String(ev.summary ?? '').trim();
        // A READING, not any string in the field. Extraction stamps its own
        // short phrase `extraction`, and that phrase is a signal from a route
        // nobody invoked: showing it makes the stop look read when nothing
        // has read it, and it displaces the prompt that would ask someone to.
        // It stays on the edge, reachable, and the next pass or edit
        // replaces it. Only `peer` and `writer` are renderable here.
        const conflict = arcPass?.conflicts?.find(
          (c) => c.event_id === ev.id && !arcConflictsKept.has(c.event_id),
        );
        const keepMine = () => resolveArcConflict(ev.id);
        const stateAuthor = String((edge as any)?.state_at_event_author ?? '');
        const text = stateAuthor === 'extraction'
          ? ''
          : String(edge?.state_at_event ?? '').trim();
        const verb = String(edge?.transition ?? '').trim();
        const basisNow = arcBasis[ev.id] ?? '';
        const hashThen = String((edge as any)?.state_at_event_hash ?? '');
        const stale = !!text && !!hashThen && !!basisNow && hashThen !== basisNow;
        // Two rungs only: the reading, or nothing read of it yet.
        const rank: 1 | 2 | 3 = text ? 1 : 3;
        const isBackstory = String(ev.narrative_status ?? '') === 'backstory';
        const allowedVerbs: EvokesTransition[] = isBackstory
          ? (['touches'] as EvokesTransition[])
          : EVOKES_TRANSITIONS;

        const writeEdge = (patch: Record<string, unknown>) =>
          tagEventEvokes(
            { eventId: ev.id, arcId: entity.id, projectId, ...patch } as any,
            auth.token,
          ).then(() => onEntitiesChanged());

        const verbRowFor = (cardOpen: boolean) => (
          <VerbRow
            arcLabel="this arc"
            verb={verb}
            allowed={allowedVerbs}
            custom={!isBackstory}
            editable={cardOpen}
            dark={dark}
            onPick={(t) => { void writeEdge({ transition: t }); }}
            onClear={() => {
              // Clearing the verb must not take the scene off the arc: the
              // run is the writer's, not the verb's.
              void writeEdge({ transition: '' });
            }}
          />
        );

        return {
          id: ev.id,
          kicker: (() => {
            if (isBackstory) return 'backstory';
            const n = sceneNoById.get(ev.id);
            return n ? `SC ${String(n).padStart(2, '0')}` : 'untold';
          })(),
          kickerMono: true,
          accent: getEntityColor('event'),
          alert: conflict ? '#d97706' : undefined,
          title: ev.working_title ?? ev.working_name ?? ev.id,
          body: summary || undefined,
          bodySerif: true,
          faceExtra: (open: boolean) => (
            <StopFace
              open={open}
              rank={rank}
              text={text}
              transition={verb}
              observable=""
              charName="this arc"
              dark={dark}
              flags={[
                ...(conflict ? [{ key: 'c', tone: 'warn' as const, label: 'conflict' }] : []),
              ]}
              verbRow={verbRowFor(open)}
              arcExtra={open ? (
                <>
                  {conflict && (
                    <ConflictBlock
                      conflict={conflict}
                      dark={dark}
                      quoteFrom={(() => {
                        const src = conflict.quote_event_id;
                        if (!src || src === ev.id) return undefined;
                        const other = eventsById.get(src);
                        const t = String(other?.working_title ?? other?.working_name ?? '');
                        return t ? (t.length > 40 ? `${t.slice(0, 40)}…` : t) : undefined;
                      })()}
                      edited={
                        typeof conflict.against === 'string'
                        && conflict.against.trim() !== ''
                        && conflict.against.trim() !== text.trim()
                      }
                      onKeep={keepMine}
                      onTake={(t) =>
                        // Adopted, so it is the writer's from here.
                        writeEdge({ stateAtEvent: t, stateHash: basisNow, stateAuthor: 'writer' })
                          .then(() => keepMine())
                      }
                    />
                  )}
                  {String(edge?.evidence_quote ?? '').trim() && (
                    <div style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 10.5, lineHeight: 1.7, color: dark ? '#8b8b95' : '#6b6f7a', paddingLeft: 10 }}>
                      {edge?.evidence_quote}
                    </div>
                  )}
                </>
              ) : null}
              introBeat={false}
              openSignal={0}
              textStale={stale}
              textRewritten={false}
              onSaveText={(t) => writeEdge({ stateAtEvent: t, stateHash: basisNow, stateAuthor: 'writer' })}
            />
          ),
          rowsSummary: ['open', 'close'] as [string, string],
          expanded: (
            <StopSlate
              dark={dark}
              charName="this arc"
              introBeat={false}
              rank={rank}
              text={text}
              textStale={stale}
              textRewritten={false}
              openSignal={0}
              onSaveText={(t) => writeEdge({ stateAtEvent: t, stateHash: basisNow, stateAuthor: 'writer' })}
              turn={verb ? { transition: verb, quote: String(edge?.evidence_quote ?? '') } : null}
              verbRow={verbRowFor(true)}
              question={null}
              onAnswerQuestion={() => {}}
              onDismissQuestion={() => {}}
              observable=""
              observableGrade=""
              subEvents={ev.sub_events ?? []}
              onOpenScene={() => onOpenCard(ev.id)}
              onRemoveFromScene={() =>
                untagEventEvokes({ eventId: ev.id, arcId: entity.id, projectId }, auth.token)
                  .then(() => onEntitiesChanged())
              }
            />
          ),
        };
      }),
      hint: 'The scenes on this arc, in told order, with what each does to it.',
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
      id: 'working', label: 'Peer', accent: PEER_BLUE, defaultW: 2, defaultExpanded: true,
      hint: "The peer's open questions about this character. Answer inline, or open a thread.",
      icon: <InternIcon size={13} />,
      summary: questions == null ? '\u2026' : `${byStatus.open.length + byStatus.stashed.length}`,
      add: {
        noun: 'your own question',
        onCreate: (text: string) =>
          createWriterQuestion(
            { projectId, cardId: entity.id, userId: auth.userId, workingSectionLabel: text },
            auth.token,
          ).then(() => refetchQuestions()),
      },
      focalAction: <FocalAskPeer peer={peer} />,
      focalOverrideActive: !!peerOpenQuestionId,
      focalOverride:
        peer.streaming.prose ? (
          <div style={{ paddingTop: 4 }}>
            <div
              style={{
                fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
                color: PEER_BLUE, fontWeight: 600, marginBottom: 8,
              }}
            >
              The peer&rsquo;s read
            </div>
            <PeerReadProse text={peer.streaming.prose} dark={dark} />
          </div>
        ) : undefined,
      items: (() => {
        const live = peer.visiblePeerQuestions ?? [];
        const liveIds = new Set(live.map((q) => q.questionId));
        const rest = (questions ?? []).filter(
          (q) => q.status !== 'dismissed' && !liveIds.has(q.questionId),
        );
        return [...live, ...rest] as PersistedQuestion[];
      })().map((q) => ({
        id: q.questionId,
        shape: 'peer' as const,
        kicker: q.workingSectionLabel || 'open question',
        title: q.questionText,
        tag: q.status === 'answered' ? 'answered' : undefined,
        tagColor: '#10b981',
        rowsSummary: q.status === 'answered' ? 'your answer' : 'answer or discuss',
        expandedWidth: peerChatQuestionId === q.questionId ? 560 : 400,
        onExpandChange: (isOpen: boolean) =>
          setPeerOpenQuestionId((prev) => (isOpen ? q.questionId : prev === q.questionId ? null : prev)),
        expanded: (
          <QuestionComposer
            question={{
              questionId: q.questionId,
              askId: q.askId ?? '',
              cardId: q.cardId,
              projectId: q.projectId,
              orderIndex: q.orderIndex,
              questionText: q.questionText,
              workingSectionLabel: q.workingSectionLabel,
              rationale: q.rationale,
              authoredBy: q.authoredBy,
              status: q.status,
              threadId: q.threadId,
              responseId: q.responseId,
              responseProse: q.responseProse ?? undefined,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
            }}
            persistedStatus={q.status}
            isOpen
            onToggle={() => {}}
            entity={entity}
            slice={peer.slice}
            peerOriginalProse={peer.streaming.prose}
            projectId={projectId}
            userId={auth.userId}
            token={auth.token}
            completedResponseIds={completedResponseIds}
            onStatusChange={() => refetchQuestions()}
            onChatOpenChange={(chatting) =>
              setPeerChatQuestionId((prev) => (chatting ? q.questionId : prev === q.questionId ? null : prev))
            }
            onResponseSubmitted={() => { refetchQuestions(); onEntitiesChanged(); }}
            hideStash
            bare
            hideQuestionText
            initialThread={
              (q as any).openThread
                ? { threadId: (q as any).openThread.threadId, turns: (q as any).openThread.turns }
                : undefined
            }
            initialClosedThread={
              (q as any).closedThread
                ? {
                    threadId: (q as any).closedThread.threadId,
                    turns: (q as any).closedThread.turns,
                    closedReason: (q as any).closedThread.closedReason,
                    closedAt: (q as any).closedThread.closedAt,
                  }
                : undefined
            }
          />
        ),
      })),
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
        <OrbitSheet tiles={tiles} focalTileIds={['identity']} defaultCategoryId="timeline" focalAccent={color} focalCardId={entity.id} auth={auth} projectId={projectId} persistKey={`arc:${entity.id}`} />
      </div>
      {/* Empty timeline: the tagging pill, bottom-center (Ben 2026-09-01) —
          opens the wall in arc-select mode instead of an in-tile picker. */}
      {onTagScenes && evokes.length === 0 && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 210 }}>
          <button
            onClick={onTagScenes}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 999, cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: 700,
              background: color, color: '#fff', border: 'none',
              boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            }}
          >
            + Tag scenes on this arc
          </button>
        </div>
      )}
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
