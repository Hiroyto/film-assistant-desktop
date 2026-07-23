// pages/app/freeform-demo.tsx
//
// FIL-476 A1 frontend pre-spike. Renders a hardcoded "the Detective" Character
// card next to (eventually) a floating peer card. Click "Ask peer" fires the
// peer-first-pass flow against the freeform-workflow-app Lambda.
//
// Until FIL-495 wires the API Gateway /freeform route, the freeformApi module
// returns realistic mock data. Set REACT_APP_FREEFORM_API_PATH=freeform to flip
// to the real Lambda once the route exists.
//
// Lives at route /freeform-demo (registered in App.tsx).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { debounce } from 'lodash';
import {
  CardChrome,
  PeerCard,
  WorkingSection,
  InternIcon,
  CascadeToast,
  RecentUpdatesTray,
  CascadeSummaryPanel,
  type PeerQuestion,
  type PeerCardState,
  type CharacterCard,
  type WorkingSectionStatus,
  PEER_BLUE,
} from '../../components/Freeform';
import {
  peerFirstPass,
  enqueuePeerFirstPass,
  buildSlice,
  gradeSlice,
  isMockMode,
  adaptPeerQuestions,
  saveCardResponseDraft,
  submitCardResponse,
  updateQuestionStatus as updateQuestionStatusApi,
  createWriterQuestion,
  startPeerThread,
  peerContinue,
  closePeerThread,
  type GraphSlice,
  type ContinuationTurn,
  type SliceGradeResponse,
} from '../../lib/freeformApi';
import type { ChatTurn, PeerContinuationView } from '../../components/Freeform';
import { useCascadeEvents } from '../../lib/useCascadeEvents';
import { useStreamingPeer } from '../../lib/useStreamingPeer';

// ============================================
// Hardcoded demo data
// ============================================

const PROJECT_ID = 'demo_project_affair';

const DEMO_CHARACTER: CharacterCard = {
  type: 'character',
  cardId: 'card_detective_demo',
  projectId: PROJECT_ID,
  position: { x: 0, y: 0 },
  working_name: 'the Detective',
  description:
    "A former cop pushed out of the force after an Internal Affairs incident — 'the click,' he calls it. Now a PI. The Husband hired him to surveil the Wife.",
  established_traits: ['former cop', 'pushed out', 'carries the click'],
  open_dimensions: [
    {
      tension:
        "We're told 'the click' is what ended his career but the prose treats it as backstory shorthand.",
      why_it_matters:
        "Without a sensory anchor we can't feel what he lost — and the surveillance work becomes neutral instead of charged.",
    },
  ],
  evidence_quote: 'Five years ago he was pushed out of the force. Internal Affairs.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEMO_SLICE: GraphSlice = {
  focal_type: 'character',
  focal_entity: {
    working_name: DEMO_CHARACTER.working_name,
    description: DEMO_CHARACTER.description,
    established_traits: DEMO_CHARACTER.established_traits,
  },
  events_involving: [
    { working_title: 'Hired to surveil the Wife', narrative_status: 'on_screen' },
    { working_title: 'Pushed out of the force', narrative_status: 'backstory' },
  ],
  co_characters: [
    { working_name: 'the Husband', description: 'Hired the Detective.' },
    { working_name: 'the Wife', description: 'The subject of the surveillance.' },
  ],
  source_card_prose:
    'A former cop pushed out of the force after an Internal Affairs incident...',
};

// ============================================
// Character card body — inline for the demo
// (factor out into a shared component when A4 adds the real card surface)
// ============================================

interface CharacterCardBodyProps {
  character: CharacterCard;
  workingSections: PeerQuestion[];
  /** Map questionId → live status. */
  sectionStatuses: Record<string, WorkingSectionStatus>;
  /** Map questionId → draft save indicator. */
  saveStatuses: Record<string, 'saved' | 'saving' | 'failed' | null>;
  onAskPeer: () => void;
  hasOpenPeerThread: boolean;
  onSubmitResponse: (questionId: string, text: string) => void;
  onDraftChange: (questionId: string, text: string) => void;
  onStash: (questionId: string) => void;
  onUnstash: (questionId: string) => void;
  onDismiss: (questionId: string) => void;
  onLabelEdit: (questionId: string, newLabel: string) => void;
  onContinueConversation: (questionId: string) => void;
  onAddMyOwn: () => void;
}

const CharacterCardBody: React.FC<CharacterCardBodyProps> = ({
  character,
  workingSections,
  sectionStatuses,
  saveStatuses,
  onAskPeer,
  hasOpenPeerThread,
  onSubmitResponse,
  onDraftChange,
  onStash,
  onUnstash,
  onDismiss,
  onLabelEdit,
  onContinueConversation,
  onAddMyOwn,
}) => {
  const open = workingSections.filter(
    (s) => (sectionStatuses[s.questionId] ?? s.status) === 'open',
  );
  const answered = workingSections.filter(
    (s) => (sectionStatuses[s.questionId] ?? s.status) === 'answered',
  );
  const stashed = workingSections.filter(
    (s) => (sectionStatuses[s.questionId] ?? s.status) === 'stashed',
  );
  const [stashedExpanded, setStashedExpanded] = useState(false);

  return (
    <>
      {/* Header: type chip + Ask peer + close */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[11px] uppercase tracking-wider font-mono"
          style={{ color: '#e0a456' }}
        >
          ◆ CHARACTER
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAskPeer}
            disabled={hasOpenPeerThread}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-peerBlue/10 border border-peerBlueBorder text-peerBlueLight hover:bg-peerBlue/20 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasOpenPeerThread ? 'A peer thread is already open on this card' : 'Ask peer'}
          >
            <InternIcon size={12} />
            Ask peer
          </button>
        </div>
      </div>

      {/* working_name */}
      <h2 className="text-lg text-fontWhite07 font-medium mb-3">{character.working_name}</h2>

      {/* Description */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-fontGray mb-1">
          Description
        </div>
        <p className="text-sm text-fontWhite07 leading-relaxed">{character.description}</p>
      </div>

      {/* Established traits */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-fontGray mb-1">
          Established traits
        </div>
        <div className="flex flex-wrap gap-1.5">
          {character.established_traits.map((t, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-glassBg text-fontWhite07"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Open dimensions (LLM-authored, muted) */}
      {character.open_dimensions.length > 0 && (
        <div className="mb-4 pl-3" style={{ borderLeft: '1px dashed rgba(255,255,255,0.15)' }}>
          <div className="text-[10px] uppercase tracking-wider text-fontGray mb-1">
            Open dimensions (LLM){' '}
            <span className="lowercase italic">(extracted)</span>
          </div>
          {character.open_dimensions.map((od, i) => (
            <div key={i} className="text-xs text-fontWhite mb-2 last:mb-0">
              <span className="opacity-60">◦</span> {od.tension}{' '}
              <span className="opacity-50">— {od.why_it_matters}</span>
            </div>
          ))}
        </div>
      )}

      {/* Working sections zone */}
      {workingSections.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-fontGray">
              Working sections ({open.length} open · {answered.length} answered ·{' '}
              {stashed.length} stashed)
            </div>
            <button
              type="button"
              onClick={onAddMyOwn}
              className="text-xs text-fontWhite07 hover:text-fontWhite"
            >
              + Add my own
            </button>
          </div>

          {/* Active sections (open + answered) */}
          {[...open, ...answered].map((q) => (
            <WorkingSection
              key={q.questionId}
              workingSectionLabel={q.workingSectionLabel}
              questionText={q.questionText}
              rationale={q.rationale}
              status={sectionStatuses[q.questionId] ?? q.status}
              authoredBy={q.authoredBy}
              parentCardType="character"
              responseProse={q.responseProse}
              saveStatus={saveStatuses[q.questionId] ?? null}
              onSubmit={(text) => onSubmitResponse(q.questionId, text)}
              onDraftChange={(text) => onDraftChange(q.questionId, text)}
              onStash={() => onStash(q.questionId)}
              onUnstash={() => onUnstash(q.questionId)}
              onDismiss={() => onDismiss(q.questionId)}
              onLabelEdit={(label) => onLabelEdit(q.questionId, label)}
              onContinueConversation={() => onContinueConversation(q.questionId)}
            />
          ))}

          {/* Stashed group */}
          {stashed.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setStashedExpanded((v) => !v)}
                className="text-xs text-fontGray hover:text-fontWhite07 mb-1"
              >
                ─── Stashed ({stashed.length}) {stashedExpanded ? '▾' : '▸'} ───
              </button>
              {stashedExpanded &&
                stashed.map((q) => (
                  <WorkingSection
                    key={q.questionId}
                    workingSectionLabel={q.workingSectionLabel}
                    questionText={q.questionText}
                    rationale={q.rationale}
                    status="stashed"
                    authoredBy={q.authoredBy}
                    parentCardType="character"
                    onUnstash={() => onUnstash(q.questionId)}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* Evidence quote (footer) */}
      {character.evidence_quote && (
        <div
          className="mt-4 pt-3 text-xs italic text-fontGray"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          "{character.evidence_quote}"
        </div>
      )}
    </>
  );
};

// ============================================
// Grade metric pill
// ============================================

const GradeMetric: React.FC<{ label: string; score: number; bold?: boolean }> = ({ label, score, bold }) => {
  // 1=red, 2-3=amber, 4-5=green. Quick visual scan.
  const color =
    score >= 4 ? '#7CC383' : score >= 2 ? '#e0a456' : '#d96b6b';
  return (
    <div>
      <div className="text-fontGray text-[10px] uppercase tracking-wider">{label}</div>
      <div
        className={`${bold ? 'text-base' : 'text-sm'} font-mono`}
        style={{ color }}
      >
        {score}/5
      </div>
    </div>
  );
};

// ============================================
// Demo page
// ============================================

const FreeformDemo: React.FC = () => {
  const [peerState, setPeerState] = useState<PeerCardState | null>(null);
  const [peerProse, setPeerProse] = useState<string | undefined>(undefined);
  const [peerQuestions, setPeerQuestions] = useState<PeerQuestion[]>([]);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [askLatencyMs, setAskLatencyMs] = useState<number | null>(null);
  const [sliceGrade, setSliceGrade] = useState<SliceGradeResponse | null>(null);
  const [gradeLoading, setGradeLoading] = useState<boolean>(false);

  // working_sections live on the writing card (Character). Auto-adopted from
  // peer's questions per Task #9 lock.
  const [workingSections, setWorkingSections] = useState<PeerQuestion[]>([]);
  const [sectionStatuses, setSectionStatuses] = useState<
    Record<string, WorkingSectionStatus>
  >({});
  const [saveStatuses, setSaveStatuses] = useState<
    Record<string, 'saved' | 'saving' | 'failed' | null>
  >({});

  // Cognito auth token + userId — fetched once on mount.
  const [token, setToken] = useState<string>('demo_token');
  const [userId, setUserId] = useState<string>('demo_user');

  // Last ask's client-side requestId, used to scope streaming events.
  const lastClientRequestIdRef = useRef<string | null>(null);
  // Start time of the most recent ask — used to record total latency once
  // the streaming hook reports completion (FIL-499 async path).
  const askStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    fetchAuthSession()
      .then((session) => {
        const idToken = session.tokens?.idToken;
        if (idToken) setToken(idToken.toString());
        const sub = (idToken?.payload?.sub as string | undefined) ?? 'demo_user';
        setUserId(sub);
      })
      .catch(() => {
        // Stay in demo mode with placeholder values — mock APIs don't care.
      });
  }, []);

  // FIL-477 — Streaming subscription, declared ahead of askPeer so the
  // callback can capture it.
  const streamingPeer = useStreamingPeer({
    userId,
    projectId: PROJECT_ID,
    storyId: PROJECT_ID,
    cardId: DEMO_CHARACTER.cardId,
  });

  const askPeer = useCallback(async () => {
    // Generate a client-side requestId so the streaming hook can scope incoming
    // WS events. Backend echoes this in every event.
    const clientRequestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    lastClientRequestIdRef.current = clientRequestId;
    streamingPeer.beginStream(clientRequestId);

    setPeerState('loading');
    setPeerError(null);
    setAskLatencyMs(null);
    setPeerProse(undefined);
    setPeerQuestions([]);

    const startMs = Date.now();
    askStartTimeRef.current = startMs;

    // Pull a fresh slice from the backend so the peer sees both the live
    // Neptune neighborhood (cascade-extracted entities) AND the writer's
    // prior CardResponses on this card. Fall back to the local hardcoded
    // slice if build-slice fails or in mock mode (mock returns minimal slice).
    let slice: GraphSlice = DEMO_SLICE;
    try {
      const result = await buildSlice(
        {
          projectId: PROJECT_ID,
          cardId: DEMO_CHARACTER.cardId,
          focalType: 'character',
          focalId: DEMO_CHARACTER.working_name,
          focalSeed: {
            working_name: DEMO_CHARACTER.working_name,
            description: DEMO_CHARACTER.description,
            established_traits: DEMO_CHARACTER.established_traits,
            open_dimensions: DEMO_CHARACTER.open_dimensions,
            evidence_quote: DEMO_CHARACTER.evidence_quote,
          },
          sourceProse: DEMO_SLICE.source_card_prose,
        },
        token,
      );
      slice = result.slice;
      // eslint-disable-next-line no-console
      console.info(
        `[demo] build-slice ${result.latencyMs}ms, usedSeed=${result.usedSeed}, prior_responses=${slice.prior_responses?.length ?? 0}`,
      );
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[demo] build-slice failed, using local DEMO_SLICE', e?.message);
    }

    const req = {
      projectId: PROJECT_ID,
      cardId: DEMO_CHARACTER.cardId,
      focalType: 'character' as const,
      focalId: DEMO_CHARACTER.working_name,
      slice,
      userId,
      clientRequestId,
    };

    // Fire grade-slice in parallel with the peer call — telemetry only,
    // doesn't block the Ask peer flow. Result lands in the dev footer.
    setSliceGrade(null);
    setGradeLoading(true);
    gradeSlice(
      {
        slice,
        projectId: PROJECT_ID,
        cardId: DEMO_CHARACTER.cardId,
        focalId: DEMO_CHARACTER.working_name,
      },
      token,
    )
      .then((g) => {
        setSliceGrade(g);
        // eslint-disable-next-line no-console
        console.info('[demo] slice grade', g);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[demo] grade-slice failed', e?.message);
      })
      .finally(() => setGradeLoading(false));

    if (isMockMode) {
      // Mock mode has no WS streaming, so drive UI from the synchronous mock.
      try {
        const response = await peerFirstPass(req, token);
        const adapted = adaptPeerQuestions(response, DEMO_CHARACTER.cardId, PROJECT_ID);
        setPeerProse(response.responseProse);
        setPeerQuestions(adapted);
        setPeerState('complete');
        setAskLatencyMs(Date.now() - startMs);
      } catch (e: any) {
        setPeerError(e?.message ?? 'Unknown error');
      }
      return;
    }

    // Real mode (FIL-499): enqueue the job and return immediately. The
    // streaming hook drives all subsequent UI; an effect below syncs final
    // prose + questions into local state when peer_stream_done arrives.
    try {
      await enqueuePeerFirstPass(req, token);
    } catch (e: any) {
      setPeerError(e?.message ?? 'Failed to queue peer call');
    }
  }, [token, userId, streamingPeer]);

  // FIL-499 — when the streaming hook reports completion in real mode, copy
  // the streamed prose + questions into local state. The PeerCard render logic
  // reads from these once state hits 'complete' (mock + real share the same path).
  useEffect(() => {
    if (isMockMode) return;
    if (streamingPeer.state !== 'complete') return;
    setPeerProse(streamingPeer.prose);
    setPeerQuestions(streamingPeer.questions);
    setPeerState('complete');
    if (askStartTimeRef.current) {
      setAskLatencyMs(Date.now() - askStartTimeRef.current);
      askStartTimeRef.current = null;
    }
  }, [streamingPeer.state, streamingPeer.prose, streamingPeer.questions]);

  // Surface streaming errors on the peer card.
  useEffect(() => {
    if (streamingPeer.error) {
      setPeerError(streamingPeer.error);
    }
  }, [streamingPeer.error]);

  // Auto-adopt streaming questions as working_sections as they arrive (deduped
  // by questionId — the streaming hook uses optimistic IDs; HTTP returns swap them).
  useEffect(() => {
    if (streamingPeer.questions.length === 0) return;
    setWorkingSections((prev) => {
      const merged = [...prev];
      for (const sq of streamingPeer.questions) {
        // Skip if already present (by questionId OR by orderIndex+cardId — covers ID swap)
        if (merged.some((m) => m.questionId === sq.questionId)) continue;
        if (merged.some((m) => m.orderIndex === sq.orderIndex && m.cardId === sq.cardId && m.authoredBy === 'peer')) continue;
        merged.push(sq);
      }
      return merged;
    });
  }, [streamingPeer.questions]);

  const closePeer = () => {
    // Per locks: card collapse closes any open thread.
    if (activeThread && !activeThread.closed) {
      const threadId = activeThread.threadId;
      closePeerThread({ threadId, reason: 'card_collapse' }, token).catch((e) =>
        // eslint-disable-next-line no-console
        console.error('[demo] close-peer-thread on card-collapse failed', e),
      );
    }
    setActiveThread(null);
    setPeerState(null);
    setPeerProse(undefined);
    setPeerQuestions([]);
    streamingPeer.reset();
    // working_sections persist per locks — they only go away on dismiss.
  };

  // ============================================
  // Working_section action handlers — all wire through the backend.
  // ============================================

  // Debounced draft save per (questionId). One debounce instance, keyed by
  // questionId via the request payload. 500ms per the C-design lock.
  const debouncedDraftSave = useMemo(
    () =>
      debounce(async (questionId: string, draftProse: string) => {
        setSaveStatuses((m) => ({ ...m, [questionId]: 'saving' }));
        try {
          await saveCardResponseDraft(
            {
              questionId,
              originatingCardId: DEMO_CHARACTER.cardId,
              projectId: PROJECT_ID,
              userId,
              draftProse,
            },
            token,
          );
          setSaveStatuses((m) => ({ ...m, [questionId]: 'saved' }));
        } catch {
          setSaveStatuses((m) => ({ ...m, [questionId]: 'failed' }));
        }
      }, 500),
    [token, userId],
  );

  const onDraftChange = (questionId: string, text: string) => {
    debouncedDraftSave(questionId, text);
  };

  const onSubmitResponse = async (questionId: string, text: string) => {
    // Optimistic update — show answered immediately, then sync to backend.
    setSectionStatuses((m) => ({ ...m, [questionId]: 'answered' }));
    setWorkingSections((sections) =>
      sections.map((s) =>
        s.questionId === questionId ? { ...s, responseProse: text, status: 'answered' } : s,
      ),
    );
    setSaveStatuses((m) => ({ ...m, [questionId]: null }));

    // Look up the original peer question so we can forward its text + rationale —
    // the extract-card-response prompt needs them for skeptical context.
    const peerQ =
      peerQuestions.find((q) => q.questionId === questionId) ??
      workingSections.find((s) => s.questionId === questionId);

    try {
      await submitCardResponse(
        {
          questionId,
          originatingCardId: DEMO_CHARACTER.cardId,
          projectId: PROJECT_ID,
          userId,
          responseProse: text,
          focalEntity: {
            type: 'character',
            working_name: DEMO_CHARACTER.working_name,
            description: DEMO_CHARACTER.description,
            established_traits: DEMO_CHARACTER.established_traits,
          },
          focalContext: { characters: ['the Husband', 'the Wife'], events: [] },
          // Required by extract-card-response validator. For writer-authored sections,
          // use the section label as a stand-in question.
          question: peerQ?.questionText || peerQ?.workingSectionLabel || 'Writer-authored section',
          rationale: peerQ?.rationale || '',
          peerOriginalProse: peerProse || '',
        },
        token,
      );
    } catch (e) {
      // Revert optimistic update on failure
      setSectionStatuses((m) => ({ ...m, [questionId]: 'open' }));
      setWorkingSections((sections) =>
        sections.map((s) =>
          s.questionId === questionId ? { ...s, status: 'open' } : s,
        ),
      );
      // eslint-disable-next-line no-console
      console.error('[demo] submit failed', e);
    }
  };

  const onStash = async (questionId: string) => {
    setSectionStatuses((m) => ({ ...m, [questionId]: 'stashed' }));
    try {
      await updateQuestionStatusApi({ questionId, status: 'stashed' }, token);
    } catch {
      setSectionStatuses((m) => ({ ...m, [questionId]: 'open' }));
    }
  };

  const onUnstash = async (questionId: string) => {
    setSectionStatuses((m) => ({ ...m, [questionId]: 'open' }));
    try {
      await updateQuestionStatusApi({ questionId, status: 'open' }, token);
    } catch {
      setSectionStatuses((m) => ({ ...m, [questionId]: 'stashed' }));
    }
  };

  const onDismiss = async (questionId: string) => {
    setWorkingSections((sections) => sections.filter((s) => s.questionId !== questionId));
    setPeerQuestions((qs) => qs.filter((q) => q.questionId !== questionId));
    try {
      await updateQuestionStatusApi({ questionId, status: 'dismissed' }, token);
    } catch (e) {
      // No easy revert — log + carry on. Backend state is the source of truth on reload.
      // eslint-disable-next-line no-console
      console.error('[demo] dismiss failed', e);
    }
  };

  const onLabelEdit = (questionId: string, newLabel: string) => {
    setWorkingSections((sections) =>
      sections.map((s) =>
        s.questionId === questionId ? { ...s, workingSectionLabel: newLabel } : s,
      ),
    );
    setPeerQuestions((qs) =>
      qs.map((q) => (q.questionId === questionId ? { ...q, workingSectionLabel: newLabel } : q)),
    );
    // Note: label persistence on the Question record itself isn't wired in v1.
    // Defer to a future ticket — A4 ships label as a client-side rename for now.
  };

  // ============================================
  // Chat continuation (FIL-480 / A5)
  // ============================================

  interface ActiveThread {
    threadId: string;
    questionId: string;
    turns: ChatTurn[];
    isThinking: boolean;
    closed: boolean;
    closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit';
    closedAt?: string;
  }

  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);

  const adaptContinuationTurn = (t: ContinuationTurn): ChatTurn => ({
    turnId: t.turnId,
    role: t.role,
    content: t.content,
    createdAt: t.createdAt,
  });

  const onContinueConversation = async (questionId: string) => {
    try {
      const res = await startPeerThread(
        {
          projectId: PROJECT_ID,
          questionId,
          cardId: DEMO_CHARACTER.cardId,
          userId,
        },
        token,
      );
      setActiveThread({
        threadId: res.threadId,
        questionId,
        turns: [],
        isThinking: false,
        closed: false,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[demo] start-peer-thread failed', e);
    }
  };

  const onSendContinuationMessage = async (message: string) => {
    if (!activeThread) return;
    const tempWriterTurn: ChatTurn = {
      turnId: `t_w_${Date.now()}`,
      role: 'writer',
      content: message,
      createdAt: new Date().toISOString(),
    };
    setActiveThread((t) =>
      t ? { ...t, turns: [...t.turns, tempWriterTurn], isThinking: true } : t,
    );

    const peerQ =
      peerQuestions.find((q) => q.questionId === activeThread.questionId) ??
      workingSections.find((s) => s.questionId === activeThread.questionId);

    try {
      const res = await peerContinue(
        {
          projectId: PROJECT_ID,
          threadId: activeThread.threadId,
          questionId: activeThread.questionId,
          writerMessage: message,
          focalContext: {
            questionText: peerQ?.questionText,
            rationale: peerQ?.rationale,
            peerOriginalProse: peerProse,
          },
        },
        token,
      );
      // Replace the optimistic writer turn with the server-confirmed one (matching turnId)
      // + append peer turn.
      setActiveThread((t) => {
        if (!t) return t;
        const withoutOptimistic = t.turns.filter((x) => x.turnId !== tempWriterTurn.turnId);
        return {
          ...t,
          turns: [
            ...withoutOptimistic,
            adaptContinuationTurn(res.writerTurn),
            adaptContinuationTurn(res.peerTurn),
          ],
          isThinking: false,
        };
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[demo] peer-continue failed', e);
      setActiveThread((t) => (t ? { ...t, isThinking: false } : t));
    }
  };

  const onCloseActiveThread = async () => {
    if (!activeThread || activeThread.closed) return;
    const threadId = activeThread.threadId;
    setActiveThread((t) =>
      t
        ? { ...t, closed: true, closedReason: 'explicit', closedAt: new Date().toISOString() }
        : t,
    );
    try {
      await closePeerThread({ threadId, reason: 'explicit' }, token);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[demo] close-peer-thread failed', e);
    }
  };

  const onAddMyOwn = async () => {
    const draftLabel = 'My own section';
    try {
      const newQ = await createWriterQuestion(
        {
          projectId: PROJECT_ID,
          cardId: DEMO_CHARACTER.cardId,
          userId,
          workingSectionLabel: draftLabel,
        },
        token,
      );
      setWorkingSections((sections) => [...sections, newQ]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[demo] create-writer-question failed', e);
    }
  };

  // Sync question-card actions back to working sections (two-way sync from Task #9).
  const onQuestionLabelEdit = (questionId: string, newLabel: string) =>
    onLabelEdit(questionId, newLabel);
  const onQuestionDismiss = (questionId: string) => onDismiss(questionId);

  // ============================================
  // Cascade events (FIL-488 / B7)
  // ============================================

  const resolveCardLabel = useCallback(
    (cardId: string) => (cardId === DEMO_CHARACTER.cardId ? DEMO_CHARACTER.working_name : cardId),
    [],
  );

  const cascadeSubs = useCascadeEvents({
    userId,
    projectId: PROJECT_ID,
    storyId: PROJECT_ID,
    resolveCardLabel,
    // Stay subscribed even in mock mode — backend cascade events come from
    // real writer submissions and we want to surface them when they fire.
    disabled: false,
  });

  const onFocusEntity = (workingName: string, _kind: string) => {
    // Demo: pan-to-card not wired (no full canvas yet). Console hint.
    // eslint-disable-next-line no-console
    console.info(`[demo] Focus entity → ${workingName}. Full canvas pan-to-card lives in the real corkboard.`);
    cascadeSubs.closeSummaryPanel();
  };

  return (
    <div className="min-h-screen bg-bgdark1 p-8 text-fontWhite07">
      <header className="mb-8">
        <h1 className="text-lg mb-1">Freeform Peer — A1 demo</h1>
        <p className="text-xs text-fontGray">
          Pre-spike. Hardcoded Character card + Ask peer round-trip.{' '}
          {process.env.REACT_APP_FREEFORM_API_PATH ? (
            <>
              Hitting real Lambda at <code>{process.env.REACT_APP_FREEFORM_API_PATH}</code>.
            </>
          ) : (
            <>
              <span style={{ color: PEER_BLUE }}>MOCK mode</span> — set{' '}
              <code>REACT_APP_FREEFORM_API_PATH=freeform</code> after FIL-495 lands to hit the real Lambda.
            </>
          )}
        </p>
      </header>

      <div className="flex items-start gap-10">
        {/* Character card (the working card) */}
        <div>
          <CardChrome variant="working" type="character">
            <CharacterCardBody
              character={DEMO_CHARACTER}
              workingSections={workingSections}
              sectionStatuses={sectionStatuses}
              saveStatuses={saveStatuses}
              onAskPeer={askPeer}
              hasOpenPeerThread={peerState !== null && peerError === null}
              onSubmitResponse={onSubmitResponse}
              onDraftChange={onDraftChange}
              onStash={onStash}
              onUnstash={onUnstash}
              onDismiss={onDismiss}
              onLabelEdit={onLabelEdit}
              onContinueConversation={onContinueConversation}
              onAddMyOwn={onAddMyOwn}
            />
          </CardChrome>
        </div>

        {/* Floating peer card — driven by streaming hook while live; falls back to local state once HTTP completes */}
        {(peerState || streamingPeer.state) && (
          <PeerCard
            state={
              // Streaming hook drives the state until it reaches 'complete';
              // then the HTTP-response-derived local state takes over.
              streamingPeer.state && streamingPeer.state !== 'complete'
                ? streamingPeer.state
                : peerState ?? streamingPeer.state ?? 'loading'
            }
            prose={
              streamingPeer.state && streamingPeer.state !== 'complete'
                ? streamingPeer.prose
                : peerProse ?? streamingPeer.prose
            }
            isStreaming={streamingPeer.state === 'streaming'}
            questions={
              streamingPeer.state === 'complete' || streamingPeer.questions.length === 0
                ? peerQuestions
                : streamingPeer.questions
            }
            questionStatuses={sectionStatuses}
            onClose={closePeer}
            onQuestionLabelEdit={onQuestionLabelEdit}
            onQuestionDismiss={onQuestionDismiss}
            error={peerError || streamingPeer.error}
            onRetry={askPeer}
            continuation={
              activeThread
                ? ((): PeerContinuationView => {
                    const peerQ =
                      peerQuestions.find((q) => q.questionId === activeThread.questionId) ??
                      workingSections.find((s) => s.questionId === activeThread.questionId);
                    return {
                      workingSectionLabel: peerQ?.workingSectionLabel ?? 'continuation',
                      questionText: peerQ?.questionText,
                      turns: activeThread.turns,
                      isThinking: activeThread.isThinking,
                      closed: activeThread.closed,
                      closedReason: activeThread.closedReason,
                      closedAt: activeThread.closedAt,
                      parentCardType: 'character',
                      onSendMessage: onSendContinuationMessage,
                      onCloseThread: onCloseActiveThread,
                    };
                  })()
                : undefined
            }
          />
        )}
      </div>

      {/* Dev footer: latency + WS status + Recent updates tray */}
      <div className="mt-8 flex items-center justify-between gap-4 text-xs text-fontGray">
        <div>
          {askLatencyMs && <>last ask: {askLatencyMs}ms · </>}
          cascade WS: {cascadeSubs.isConnected ? 'connected' : 'disconnected'}
        </div>
        <RecentUpdatesTray
          entries={cascadeSubs.trayEntries}
          onEntryClick={cascadeSubs.openSummaryPanel}
          onClearViewed={cascadeSubs.clearViewedFromTray}
        />
      </div>

      {/* Slice grade panel — graph quality diagnostics */}
      {(gradeLoading || sliceGrade) && (
        <div className="mt-4 p-4 rounded border border-glassBg bg-glassBg text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="text-fontGray uppercase tracking-wider text-[10px]">
              Slice grade (data quality, not peer voice)
            </div>
            {gradeLoading && <span className="text-fontGray">grading...</span>}
          </div>
          {sliceGrade && (
            <>
              {/* Headline scores */}
              <div className="grid grid-cols-4 gap-3 mb-3">
                <GradeMetric
                  label="Inform peer"
                  score={sliceGrade.llmGrade.would_inform_peer}
                  bold
                />
                <GradeMetric label="Coverage" score={sliceGrade.llmGrade.coverage_score} />
                <GradeMetric label="Consistency" score={sliceGrade.llmGrade.consistency_score} />
                <GradeMetric label="Relevance" score={sliceGrade.llmGrade.relevance_score} />
              </div>

              {/* Stats row */}
              <div className="text-fontGray mb-2">
                {(() => {
                  const c = sliceGrade.stats.counts;
                  const parts = [
                    `co-chars: ${c.co_characters}`,
                    `mentioned: ${c.mentioned_characters}`,
                    `events: ${c.events}`,
                    `info: ${c.information}`,
                    `rels: ${c.relationships}`,
                    `structural: ${c.structural_edges}`,
                    `priors: ${c.prior_responses}${c.priors_without_question_context ? ` (${c.priors_without_question_context} w/o Q)` : ''}`,
                    `focal: ${Math.round(sliceGrade.stats.focal_completeness_score * 100)}%`,
                    `${(sliceGrade.stats.slice_bytes / 1024).toFixed(1)}KB`,
                  ];
                  return parts.join(' · ');
                })()}
              </div>

              {/* Gaps + contradictions + improvement */}
              {sliceGrade.llmGrade.coverage_gaps?.length > 0 && (
                <div className="mb-1">
                  <span className="text-amber-400">coverage gaps:</span>{' '}
                  <span className="text-fontWhite07">
                    {sliceGrade.llmGrade.coverage_gaps.join(' · ')}
                  </span>
                </div>
              )}
              {sliceGrade.llmGrade.contradictions?.length > 0 && (
                <div className="mb-1">
                  <span className="text-amber-400">contradictions:</span>{' '}
                  <span className="text-fontWhite07">
                    {sliceGrade.llmGrade.contradictions.join(' · ')}
                  </span>
                </div>
              )}
              {sliceGrade.llmGrade.irrelevant_items?.length > 0 && (
                <div className="mb-1">
                  <span className="text-amber-400">irrelevant:</span>{' '}
                  <span className="text-fontWhite07">
                    {sliceGrade.llmGrade.irrelevant_items.join(' · ')}
                  </span>
                </div>
              )}
              {sliceGrade.llmGrade.what_would_make_it_better && (
                <div className="mt-2 pt-2 border-t border-glassBg text-fontWhite07 italic">
                  → {sliceGrade.llmGrade.what_would_make_it_better}
                </div>
              )}
              <div className="mt-2 text-fontGray text-[10px]">
                grade latency: {sliceGrade.totalLatencyMs}ms · model: {sliceGrade.llmGrade.model ?? 'n/a'}
              </div>
            </>
          )}
        </div>
      )}

      {/* Cascade toasts — stacked bottom-right */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
        {cascadeSubs.activeToasts.slice(0, 3).map((event) => (
          <CascadeToast
            key={event.cardResponseId}
            newEntities={event.newEntities}
            onCollapseToTray={() => cascadeSubs.dismissToast(event.cardResponseId)}
            onViewDetails={() => cascadeSubs.openSummaryPanel(event)}
          />
        ))}
      </div>

      {/* Cascade summary panel — slide-out from right */}
      {cascadeSubs.summaryPanelTarget && (
        <CascadeSummaryPanel
          event={cascadeSubs.summaryPanelTarget}
          originatingCardLabel={resolveCardLabel(cascadeSubs.summaryPanelTarget.originatingCardId)}
          onFocusEntity={onFocusEntity}
          onClose={cascadeSubs.closeSummaryPanel}
        />
      )}
    </div>
  );
};

export default FreeformDemo;
