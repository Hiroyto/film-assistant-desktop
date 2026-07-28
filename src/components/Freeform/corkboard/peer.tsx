// components/Freeform/corkboard/peer.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { type ChatTurn } from '../../../components/Freeform/ChatContinuation';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import InternIcon from '../../../components/Freeform/InternIcon';
import { NOTE_FONT_SANS, NOTE_FONT_SERIF, noteSurface, PEER_BLUE } from '../../../components/Freeform/tokens';
import { type EntityType, type PeerCardState, type PeerQuestion } from '../../../components/Freeform/types';
import { buildSlice, checkSceneStaleness, closePeerThread, createWriterQuestion, enqueuePeerFirstPass, enqueueSceneExtraction, getSlicePriors, listCardQuestions, peerContinue, saveCardResponseDraft, startPeerThread, submitCardResponse, updateQuestionStatus as updateQuestionStatusApi, type GraphSlice, type ListProjectEntitiesResponse, type PersistedQuestion, type ProjectEntity } from '../../../lib/freeformApi';
import { buildLocalSlice, mergePriorsIntoSlice, diffSlices } from '../../../lib/localSlice';
import { useStreamingPeer } from '../../../lib/useStreamingPeer';
import { AskPeerButton, Section } from './cards';
import { EXPANDED_W, PEER_CARD_W, PEER_GAP, PEER_PROSE_COL_W, type Pos } from './constants';
import { relativeTimeShort } from './labels';
import { EventSheet, SubEventSubcards } from './sheets';
import { liftColor, useThemeMode } from './theme';

// FIL-518 slice cutover: while true, every local-slice ask also fires a
// fire-and-forget server build-slice + diff (logged as [slice-verify]) so we
// keep watching local==server during rollout. Flip to false to stop paying
// the background Neptune read once the local path is trusted.
const SLICE_VERIFY = false;

// =====================================================================
// Response-submission queue — submissions are serialized app-wide. Each
// response's cascade extraction reads the graph state the prior response
// produced, so firing two extractions concurrently can extract against
// stale context or duplicate entities. The composer flips to the green
// answered state the moment the writer submits; the actual submit +
// extraction settle in the background, in order.
// =====================================================================

let responseChain: Promise<unknown> = Promise.resolve();
const extractionWaiters = new Map<string, () => void>();

// Write gate: the corkboard sets `active` true while a braindump's extraction +
// graph write is in flight. The peer reads/builds its slice FROM Neptune, so
// asking before the write settles would ground it on a half-written graph (the
// focal card may not even exist yet). `ask()` holds until this clears. The
// corkboard keeps it in sync with the braindump phase (see setPeerWriteActive).
export const peerWriteGate = { active: false };
export function setPeerWriteActive(active: boolean) {
  peerWriteGate.active = active;
}

// WOW-tour gate: while the first-run tour is walking the OPENED bento card, the
// bento's own "Ask peer" button must not fire — the tour drives the peer via
// its "Now try the peer" step and the canvas footer button, so a stray bento
// click would open the peer out of the scripted sequence. Scoped to the bento
// OpenQuestionsPanel only (NOT the shared ask() or the canvas FloatingPeerCard,
// which the tour's guide-ask step still needs). WowFlow ties it to its phase so
// it always clears (any non-bento phase, skip, or unmount).
export const wowBentoPeerGate = { active: false };
export function setWowBentoPeerActive(active: boolean) {
  wowBentoPeerGate.active = active;
}

/** Called by the corkboard page when cascade_complete lands for a response —
 *  releases the queue for the next pending submission. */
export function notifyResponseExtracted(responseId: string) {
  extractionWaiters.get(responseId)?.();
}

function waitForExtraction(responseId: string, timeoutMs = 90_000): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => {
      extractionWaiters.delete(responseId);
      resolve();
    }, timeoutMs);
    extractionWaiters.set(responseId, () => {
      window.clearTimeout(t);
      extractionWaiters.delete(responseId);
      resolve();
    });
  });
}

/** Enqueue a response submission. Resolves when THIS submission's HTTP call
 *  returns; the next queued submission additionally waits for this one's
 *  extraction (cascade_complete, or the timeout fallback so a lost WS event
 *  can't wedge the queue). A failed submit just passes the turn — its error
 *  surfaces in its own composer. */
function enqueueResponseSubmission<T extends { responseId: string }>(
  doSubmit: () => Promise<T>,
): Promise<T> {
  const turn = responseChain.then(doSubmit);
  responseChain = turn.then(
    (res) => waitForExtraction(res.responseId),
    () => undefined,
  );
  return turn;
}

// =====================================================================
// usePeerSession — the peer engine, shared by the canvas FloatingPeerCard and
// the full-screen sheet's Open Questions tile. Owns slice-build, streaming,
// question state (open/stash/dismiss overrides keyed by orderIndex so they
// survive the optimistic→canonical questionId swap), chat-open tracking, and
// response-submit fallback polls. Rendering is per-surface; `ask()` triggers a
// pass (canvas runs it on mount; the sheet runs it on a button).
// =====================================================================

export function usePeerSession({
  entity,
  projectId,
  userId,
  token,
  onCardQuestionsChanged,
  onCascadeFallbackRefresh,
  getGraphPayload,
  getFocalStreaming,
}: {
  entity: ProjectEntity;
  projectId: string;
  userId: string;
  token: string;
  onCardQuestionsChanged: () => void;
  onCascadeFallbackRefresh: () => void;
  /** FIL-518 stage 2b (shadow mode): freshest client-held list-project-entities
   *  payload for the slice shadow diff. Optional; when absent the shadow falls
   *  back to the IndexedDB shelf, and skips silently if that misses too. */
  getGraphPayload?: () => ListProjectEntitiesResponse | null;
  /** True while `cardId` is still an optimistic mid-stream shell from an
   *  in-flight braindump (in the board's streamedIdsRef) — i.e. its full
   *  extracted content has NOT merged into local state yet. Used by the
   *  readiness gate to distinguish a settled card (read now) from a shell
   *  still being written (wait for the local merge). */
  getFocalStreaming?: (cardId: string) => boolean;
}) {
  const cardId = entity.id;
  const focalType = entity.type as 'character' | 'event' | 'relationship' | 'sequence';
  const focalSupported = focalType === 'character' || focalType === 'event' || focalType === 'sequence';

  const streaming = useStreamingPeer({
    userId,
    projectId,
    storyId: projectId,
    cardId,
    disabled: !focalSupported,
  });

  const [setupError, setSetupError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string>('');
  const [slice, setSlice] = useState<GraphSlice | null>(null);
  const [openOrderIndex, setOpenOrderIndex] = useState<number | null>(null);
  const [persistedStatusOverrides, setPersistedStatusOverrides] = useState<
    Record<number, PersistedQuestion['status']>
  >({});
  const [chatOpenOrderIndex, setChatOpenOrderIndex] = useState<number | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Mirror the streaming state into a ref so the recovery watchdog (a timer
  // chain captured inside ask()) reads the CURRENT state, not a stale closure.
  const streamingStateRef = useRef<PeerCardState | null>(streaming.state);
  useEffect(() => { streamingStateRef.current = streaming.state; }, [streaming.state]);
  // Monotonic ask sequence — a recovery chain bails when a newer ask started.
  const askSeqRef = useRef(0);

  // Build the slice + kick the async first-pass. Called on mount (canvas) or
  // explicitly (sheet). Safe to call again for a re-ask.
  const ask = useCallback(async () => {
    if (!focalSupported) {
      setStatusLine(
        `Ask peer for ${focalType} cards is coming next — slice loader is Character-only today.`,
      );
      return;
    }
    try {
      setSetupError(null);
      // READINESS GATE (replaces the old write-gate). The peer slices from the
      // LOCAL graph copy and hands that slice to the backend, so it never needs
      // the Neptune WRITE to finish — only the local copy to hold the focal
      // card's content. So: if the card is already in local state and settled,
      // read now (covers every ask on a pre-existing/untouched card, and any
      // ask made with no braindump running — the common case). Only wait when
      // the card is absent locally or is still an optimistic mid-stream shell,
      // and wait on the LOCAL merge (graph_delta clears streamedIdsRef), never
      // on a server signal — so a lost braindump_complete can't hard-block us.
      // No local payload (the sheet / server-build-slice path) keeps the old
      // write-gate, since THAT path reads Neptune and does need the write down.
      const localPayload = getGraphPayload?.() ?? null;
      if (localPayload) {
        const focalReady = () => {
          const p = getGraphPayload?.();
          const present = !!p && (p.entities ?? []).some((e: any) => e?.id === cardId);
          const shell = getFocalStreaming?.(cardId) ?? false;
          return present && !shell;
        };
        if (!focalReady()) {
          setStatusLine('Finishing saving your story…');
          const start = Date.now();
          while (!focalReady() && Date.now() - start < 20000) {
            await new Promise((r) => setTimeout(r, 200));
            if (!aliveRef.current) return;
          }
        }
      } else if (peerWriteGate.active) {
        setStatusLine('Finishing saving your story…');
        const start = Date.now();
        while (peerWriteGate.active && Date.now() - start < 35000) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!aliveRef.current) return;
      }
      // Step 7 — the STALE-GATE (design doc §3): a peer ask on a scene whose
      // pages moved past their last extraction extracts FIRST (from the
      // stored pages, server-side), then slices, then asks — the peer never
      // gives notes on an outline behind the pages. The backend verdict is
      // ledger-based, so this also catches the cross-session hole (a scene
      // edited-then-closed before its extraction fired looks clean to the
      // FE's session baseline). Fail-open at every step; boards never gate.
      if (focalType === 'event' && (entity as ProjectEntity & { has_script_text?: string }).has_script_text && userId) {
        try {
          const verdict = await checkSceneStaleness({ projectId, eventId: cardId }, token);
          if (!aliveRef.current) return;
          if (verdict.stale) {
            setStatusLine('Catching your outline up to your pages…');
            await enqueueSceneExtraction(
              { projectId, eventId: cardId, userId, fromStorage: true },
              token,
            );
            // The catch-up lands in ~12-20s; poll until fresh, cap 75s, then
            // proceed regardless (a stuck catch-up must not block the ask).
            const t0 = Date.now();
            while (Date.now() - t0 < 75000) {
              await new Promise((r) => setTimeout(r, 4000));
              if (!aliveRef.current) return;
              const v = await checkSceneStaleness({ projectId, eventId: cardId }, token);
              if (!v.stale) break;
            }
          }
        } catch (e) {
          console.warn('[peer] stale-gate failed open', e);
        }
        if (!aliveRef.current) return;
      }
      setStatusLine('Building slice from Neptune…');
      // Character focals key off working_name; Event AND Sequence focals key off
      // working_title (the backend looks the sequence up by title in
      // sliceForSequence). focalSeed shape differs accordingly — backend
      // dispatches by focalType.
      const keysOffTitle = focalType === 'event' || focalType === 'sequence';
      const focalId = keysOffTitle
        ? entity.working_title ?? entity.working_name ?? cardId
        : entity.working_name ?? entity.working_title ?? cardId;
      const focalSeed =
        focalType === 'sequence'
          ? {
              working_title: focalId,
              summary: entity.summary ?? entity.description ?? '',
              open_dimensions: entity.open_dimensions ?? [],
            }
          : focalType === 'event'
          ? {
              working_title: focalId,
              summary: entity.summary ?? '',
              narrative_status: entity.narrative_status ?? '',
              sub_events: entity.sub_events ?? [],
              open_dimensions: entity.open_dimensions ?? [],
              audience_state: entity.audience_state ?? {},
              evidence_quote: entity.evidence_quote ?? '',
            }
          : {
              working_name: focalId,
              description: entity.description ?? '',
              established_traits: entity.established_traits,
              open_dimensions: entity.open_dimensions,
              evidence_quote: entity.evidence_quote,
            };
      // FIL-518 SLICE CUTOVER: compose the slice from the client-held graph
      // copy (verified equivalent to Neptune via the shadow) and fetch only
      // priors from Dynamo — skipping the ~5.5s Neptune neighborhood build.
      // Server build-slice is the fallback (seed flow, relationship focals,
      // missing payload, or any local error). SLICE_VERIFY keeps a
      // fire-and-forget background diff vs the full server build during
      // rollout; flip it off to stop paying that background read.
      let slice: any = null;
      let usedLocal = false;
      const tLocal = performance.now();
      try {
        const payload = getGraphPayload?.() ?? null;
        if (payload) {
          const local = buildLocalSlice(payload, { focalType, focalId, cardId });
          if (local) {
            const charIds = [
              ...(local.slice.co_characters ?? []),
              ...(local.slice.mentioned_characters ?? []),
              ...(local.slice.characters_involved ?? []),
            ].map((c: any) => c?.id).filter(Boolean);
            const priors = await getSlicePriors({ projectId, cardId, charIds }, token);
            mergePriorsIntoSlice(local.slice, priors);
            slice = local.slice;
            usedLocal = true;
            console.info('[slice-local] used', { focalType, focalId, ms: Math.round(performance.now() - tLocal) });
          }
        }
      } catch (e) {
        console.warn('[slice-local] failed; falling back to server build-slice', e);
        slice = null;
        usedLocal = false;
      }

      if (!slice) {
        const sliceRes = await buildSlice(
          { projectId, cardId, focalType, focalId, focalSeed },
          token,
        );
        slice = sliceRes.slice;
      }
      if (!aliveRef.current) return;
      setSlice(slice);

      // Transitional background verify: local slice (incl. merged priors) vs
      // the full server build. Fired AFTER the fast local slice is committed,
      // so the ask never waits on Neptune. Un-skips the prior tiers (they are
      // real now, not Dynamo-absent). Remove once trusted.
      if (usedLocal && SLICE_VERIFY) {
        const localSliceForVerify = slice;
        void buildSlice({ projectId, cardId, focalType, focalId, focalSeed }, token)
          .then((sr) => {
            try {
              const d = diffSlices(localSliceForVerify, sr.slice, []);
              console.info('[slice-verify]', {
                focalType, focalId, equal: d.equal, mismatchCount: d.mismatches.length,
                first: d.mismatches.slice(0, 8).map((m) => ({ p: m.path, k: m.kind })),
              });
            } catch { /* verify only */ }
          })
          .catch(() => {});
      }

      const clientRequestId = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      streaming.beginStream(clientRequestId);
      setStatusLine('Queued — peer is thinking…');

      // SOCKET-READY BARRIER: the peer card mounts its own WS and ask() fires
      // on the same mount. Since the local-slice cutover, the enqueue can beat
      // the socket's identify write, so the backend's connection scan misses
      // this tab and the whole stream goes elsewhere (the worked-once-then-
      // hangs race). Hold the enqueue until the socket is open + identified
      // (~400ms grace); fail-open on timeout — recovery below still lands it.
      await streaming.waitReady(5000);
      if (!aliveRef.current) return;

      const askSeq = ++askSeqRef.current;
      const askStartedAt = Date.now();

      await enqueuePeerFirstPass(
        {
          projectId,
          cardId,
          focalType,
          focalId,
          slice,
          userId,
          clientRequestId,
        },
        token,
      );

      // LOST-STREAM RECOVERY: the backend persists the ask's questions at
      // stream-done whether or not any socket got the bytes. If our stream
      // goes quiet (identify race lost anyway, socket died mid-ask), fetch
      // the persisted questions over HTTP and hydrate the panel instead of
      // hanging on "peer is thinking" forever. Prose is not recoverable on
      // this path (questions are the deliverable); the card cache refreshes
      // so the questions are answerable either way.
      const RECOVERY_AT_MS = [14000, 26000, 40000];
      // Read via a call so TS doesn't narrow the ref across awaits (timers
      // mutate it out-of-band).
      const curStreamState = () => streamingStateRef.current;
      const tryRecover = async (i: number) => {
        if (!aliveRef.current || askSeqRef.current !== askSeq) return;
        if (curStreamState() === 'complete') return;
        const lastEvent = streaming.getLastEventAt();
        const quietMs = Date.now() - (lastEvent ?? askStartedAt);
        // Stream is actively flowing — give it another window.
        if (lastEvent && quietMs < 10000) {
          if (i + 1 < RECOVERY_AT_MS.length) window.setTimeout(() => void tryRecover(i + 1), RECOVERY_AT_MS[i + 1] - RECOVERY_AT_MS[i]);
          return;
        }
        try {
          const res = await listCardQuestions({ cardId }, token);
          if (!aliveRef.current || askSeqRef.current !== askSeq || curStreamState() === 'complete') return;
          const fresh = (res.questions ?? []).filter(
            (q) => q.authoredBy === 'peer' && new Date(q.createdAt).getTime() >= askStartedAt - 8000,
          );
          if (fresh.length > 0) {
            streaming.hydratePersisted(fresh.map((q) => ({
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
            })));
            // (hydrate flips state to 'complete', which clears the status line)
            console.info('[peer] lost-stream recovery hydrated', { count: fresh.length, attempt: i + 1 });
            onCardQuestionsChanged();
            return;
          }
        } catch (e) {
          console.warn('[peer] lost-stream recovery fetch failed', e);
        }
        if (i + 1 < RECOVERY_AT_MS.length) {
          window.setTimeout(() => void tryRecover(i + 1), RECOVERY_AT_MS[i + 1] - RECOVERY_AT_MS[i]);
        } else if (aliveRef.current && askSeqRef.current === askSeq && curStreamState() !== 'complete') {
          setStatusLine('The peer ran but nothing came back. Try asking again.');
        }
      };
      window.setTimeout(() => void tryRecover(0), RECOVERY_AT_MS[0]);
    } catch (err: any) {
      if (!aliveRef.current) return;
      setSetupError(err?.message ?? String(err));
      setStatusLine(`Setup error: ${err?.message ?? String(err)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, focalSupported, focalType]);

  useEffect(() => {
    if (streaming.state === 'streaming') setStatusLine('Peer responding…');
    if (streaming.state === 'complete') setStatusLine('');
  }, [streaming.state]);

  // Only this ask's questions (not persisted history). Overrides keyed by
  // orderIndex so stash/dismiss survives the optimistic→canonical id swap.
  const visiblePeerQuestions = useMemo(
    () =>
      streaming.questions.filter((q) => {
        const status = persistedStatusOverrides[q.orderIndex] ?? 'open';
        return status !== 'stashed' && status !== 'dismissed';
      }),
    [streaming.questions, persistedStatusOverrides],
  );

  const setStatusOverride = useCallback(
    (orderIndex: number, status: PersistedQuestion['status']) => {
      setPersistedStatusOverrides((prev) => ({ ...prev, [orderIndex]: status }));
      // Stash/answered cascades trigger card refresh so stashed ones surface
      // on the card. (Dismiss intentionally doesn't — it's a soft delete.)
      if (status === 'stashed' || status === 'answered') {
        onCardQuestionsChanged();
      }
    },
    [onCardQuestionsChanged],
  );

  const handleToggleQuestion = useCallback((orderIndex: number) => {
    setOpenOrderIndex((cur) => (cur === orderIndex ? null : orderIndex));
  }, []);

  const handleChatOpenChange = useCallback((orderIndex: number, open: boolean) => {
    setChatOpenOrderIndex((cur) => {
      if (open) return orderIndex;
      if (cur === orderIndex) return null;
      return cur;
    });
  }, []);

  const renderedQuestions = useMemo(() => {
    if (chatOpenOrderIndex === null) return visiblePeerQuestions;
    return visiblePeerQuestions.filter((q) => q.orderIndex === chatOpenOrderIndex);
  }, [visiblePeerQuestions, chatOpenOrderIndex]);

  // After any response submission, schedule fallback entity refetches in case
  // the cascade_complete WS event is lost. Polls at 15s + 35s.
  const handleResponseSubmitted = useCallback(() => {
    const poll = () => {
      onCardQuestionsChanged();
      onCascadeFallbackRefresh();
    };
    window.setTimeout(poll, 15000);
    window.setTimeout(poll, 35000);
  }, [onCardQuestionsChanged, onCascadeFallbackRefresh]);

  return {
    focalType,
    focalSupported,
    streaming,
    slice,
    setupError,
    statusLine,
    openOrderIndex,
    persistedStatusOverrides,
    setStatusOverride,
    handleToggleQuestion,
    handleChatOpenChange,
    chatOpenOrderIndex,
    renderedQuestions,
    visiblePeerQuestions,
    handleResponseSubmitted,
    ask,
  };
}

// FloatingPeerCard — PeerCard positioned absolutely on the canvas next to
// its parent card. Runs the full peer loop (via usePeerSession) on mount.
// =====================================================================

export function FloatingPeerCard({
  entity,
  projectId,
  userId,
  token,
  pos,
  onClose,
  completedResponseIds,
  onCardQuestionsChanged,
  onCascadeFallbackRefresh,
  onResponseSubmitted,
  getGraphPayload,
  getFocalStreaming,
}: {
  entity: ProjectEntity;
  projectId: string;
  userId: string;
  token: string;
  pos: Pos;
  onClose: () => void;
  completedResponseIds: Set<string>;
  /** Fired when peer-side stash/dismiss/answer updates Dynamo, so the parent
   *  card refreshes its working sections cache. */
  onCardQuestionsChanged: () => void;
  /** Fallback entity refetch hook. Called from response-submit fallback timers
   *  to guard against missed cascade_complete WS events. */
  onCascadeFallbackRefresh: () => void;
  /** Fired immediately when the writer submits a response (before cascade). */
  onResponseSubmitted?: () => void;
  /** FIL-518 stage 2b (shadow mode): freshest client-held graph payload for
   *  the silent slice shadow diff. */
  getGraphPayload?: () => ListProjectEntitiesResponse | null;
  /** True while the focal card is still an optimistic mid-stream shell (in the
   *  board's streamedIdsRef) — feeds the peer's readiness gate. */
  getFocalStreaming?: (cardId: string) => boolean;
}) {
  const dark = useThemeMode() === 'dark';
  const {
    focalType,
    focalSupported,
    streaming,
    slice,
    setupError,
    statusLine,
    openOrderIndex,
    persistedStatusOverrides,
    setStatusOverride,
    handleToggleQuestion,
    handleChatOpenChange,
    chatOpenOrderIndex,
    renderedQuestions,
    visiblePeerQuestions,
    handleResponseSubmitted,
    ask,
  } = usePeerSession({
    entity,
    projectId,
    userId,
    token,
    onCardQuestionsChanged,
    onCascadeFallbackRefresh,
    getGraphPayload,
    getFocalStreaming,
  });
  // A chat takeover fills the card's whole workable area: the prose column
  // morphs away (width → 0) and the chat column stretches across.
  const chatActive = chatOpenOrderIndex != null;

  // The prose/questions divider is draggable (writer chooses how much room
  // the peer's read gets), clamped so neither column can collapse into
  // uselessness. Persisted per browser.
  const PROSE_MIN = 180;
  const PROSE_MAX = 460;
  const [proseW, setProseW] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('ff-peer-prose-w'));
      if (Number.isFinite(saved) && saved >= PROSE_MIN && saved <= PROSE_MAX) return saved;
    } catch { /* ignore */ }
    return PEER_PROSE_COL_W;
  });
  const [resizing, setResizing] = useState(false);
  const [dividerHover, setDividerHover] = useState(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      setProseW(Math.min(PROSE_MAX, Math.max(PROSE_MIN, r.startW + (e.clientX - r.startX))));
    };
    const onUp = () => {
      setResizing(false);
      setProseW((w) => {
        try { window.localStorage.setItem('ff-peer-prose-w', String(w)); } catch { /* ignore */ }
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  // Canvas behavior: run a pass on mount / when the focal card changes.
  useEffect(() => {
    ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id]);

  // Board-native: the page hands us canvas coords beside the focus anchor
  // (falling back to next-to-parent for the pre-anchor frame, so the card
  // lifts from the focal and glides into place).
  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: PEER_CARD_W,
        // Above the board-scoped focus scrim (100), BELOW the toolbar (140)
        // so the pair scrolls under the chrome like real board content.
        zIndex: 120,
        background: noteSurface(dark).panel,
        border: `1px solid ${hexToRgba(PEER_BLUE, 0.45)}`,
        borderLeft: `4px solid ${PEER_BLUE}`,
        borderRadius: 12,
        // Clip children (header strip, column fills) to the rounded frame —
        // without this their square corners poke past the radius.
        overflow: 'hidden',
        // The peer's glow is the blue analog of the braindump dock's orange —
        // layered soft halo + a deep drop for lift off the dimmed board.
        boxShadow: dark
          ? `0 24px 64px rgba(0,0,0,0.6), 0 0 14px ${hexToRgba(PEER_BLUE, 0.28)}, 0 0 40px ${hexToRgba(PEER_BLUE, 0.14)}, 0 0 90px ${hexToRgba(PEER_BLUE, 0.07)}`
          : `0 12px 36px rgba(0,0,0,0.16), 0 0 14px ${hexToRgba(PEER_BLUE, 0.22)}, 0 0 40px ${hexToRgba(PEER_BLUE, 0.1)}`,
        fontFamily: 'system-ui, sans-serif',
        transform: 'none',
        transition: 'left 320ms cubic-bezier(0.22, 1, 0.36, 1), top 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '10px 14px',
          // A line the eye actually gets: neutral hairline + the header strip
          // sitting one tone off the panel.
          borderBottom: `1px solid ${dark ? '#26262c' : noteSurface(dark).hair}`,
          background: dark ? '#121215' : 'rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: PEER_BLUE }}>
          {/* The peer's mark — the intern glasses, badged with its own glow. */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              borderRadius: 13,
              background: hexToRgba(PEER_BLUE, dark ? 0.14 : 0.1),
              border: `1px solid ${hexToRgba(PEER_BLUE, 0.4)}`,
              boxShadow: `0 0 10px ${hexToRgba(PEER_BLUE, 0.3)}`,
            }}
          >
            <InternIcon size={15} />
          </span>
          {/* One quiet eyebrow, sentence case — the docket grammar. */}
          <span style={{ fontFamily: NOTE_FONT_SANS, fontSize: 12, fontWeight: 600, color: PEER_BLUE }}>
            Peer
          </span>
          <span style={{ fontFamily: NOTE_FONT_SANS, fontSize: 11, color: noteSurface(dark).faint }}>
            · on this {focalType === 'event' ? 'scene' : focalType}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: dark ? '#82828c' : '#888', fontSize: 14 }}
          aria-label="Close peer"
        >
          ✕
        </button>
      </div>

      {statusLine && (
        <div style={{ padding: '6px 14px', fontSize: 11, color: dark ? '#82828c' : '#888' }}>{statusLine}</div>
      )}

      {(setupError || streaming.error) && (
        <div style={{ padding: 14, color: 'crimson', fontSize: 12 }}>
          {setupError ?? streaming.error}
        </div>
      )}

      {focalSupported && (
        <div style={{ display: 'flex', minHeight: 0 }}>
          {/* Left column — prose. Collapses away (smooth width morph) while a
              chat takeover is active so the chat fills the card's whole
              workable area. The inner wrapper keeps the text at its laid-out
              width so it slides offstage instead of reflowing mid-collapse. */}
          <div
            className="cb-scroll"
            style={{
              width: chatActive ? 0 : proseW,
              flexShrink: 0,
              padding: chatActive ? '14px 0' : '14px 16px',
              // The peer's VOICE — serif, the hero (script-side type role).
              fontFamily: NOTE_FONT_SERIF,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: noteSurface(dark).voice,
              minHeight: chatActive || streaming.prose ? 0 : 60,
              maxHeight: '70vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              opacity: chatActive ? 0 : 1,
              // Suppress the morph transition while the divider is being
              // dragged so the column tracks the cursor without lag.
              transition: resizing
                ? 'none'
                : 'width 300ms cubic-bezier(0.22, 1, 0.36, 1), padding 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease',
            }}
          >
            <div style={{ width: proseW - 32 }}>
              {streaming.prose
                ? <PeerReadProse text={streaming.prose} caret={streaming.state === 'streaming'} dark={dark} />
                : (streaming.state === 'loading' ? '…' : '')}
            </div>
          </div>

          {/* Draggable divider between the peer's read and the questions —
              clamped to [PROSE_MIN, PROSE_MAX] so neither column breaks.
              Hidden during a chat takeover (the prose column is collapsed). */}
          {!chatActive && renderedQuestions.length > 0 && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resizeRef.current = { startX: e.clientX, startW: proseW };
                setResizing(true);
              }}
              onMouseEnter={() => setDividerHover(true)}
              onMouseLeave={() => setDividerHover(false)}
              title="Drag to resize"
              style={{
                width: 9,
                margin: '0 -4px',
                flexShrink: 0,
                cursor: 'col-resize',
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 4,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: hexToRgba(PEER_BLUE, resizing ? 0.6 : dividerHover ? 0.4 : 0.15),
                  boxShadow: resizing || dividerHover ? `0 0 8px ${hexToRgba(PEER_BLUE, 0.3)}` : 'none',
                  transition: 'background 150ms ease, box-shadow 150ms ease',
                }}
              />
            </div>
          )}

          {/* Right column — net-new questions from this ask, answerable in
              place. Questions pop in as they stream (question_complete WS
              event). Keyed on orderIndex so component identity survives the
              optimistic→canonical questionId swap at peer_stream_done. */}
          {renderedQuestions.length > 0 && (
            <div
              className="cb-scroll"
              style={{
                flex: 1,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '70vh',
                overflowY: 'auto',
                transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {renderedQuestions.map((q) => {
                const status = persistedStatusOverrides[q.orderIndex] ?? 'open';
                return (
                  <div
                    key={q.orderIndex}
                    style={{
                      animation: 'cb-q-popin 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <QuestionComposer
                      question={q}
                      persistedStatus={status}
                      isOpen={openOrderIndex === q.orderIndex}
                      onToggle={() => handleToggleQuestion(q.orderIndex)}
                      entity={entity}
                      slice={slice}
                      peerOriginalProse={streaming.prose}
                      projectId={projectId}
                      userId={userId}
                      token={token}
                      completedResponseIds={completedResponseIds}
                      onStatusChange={(s) => setStatusOverride(q.orderIndex, s)}
                      onChatOpenChange={(open) => handleChatOpenChange(q.orderIndex, open)}
                      onResponseSubmitted={() => { handleResponseSubmitted(); onResponseSubmitted?.(); }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// PeerQuestionBubble — display-only question in the peer panel's right
// column. The writer answers on the card (working sections), not here.
// =====================================================================

export function PeerQuestionBubble({
  question,
  status,
  isExtractedLocal,
}: {
  question: PersistedQuestion;
  status: PersistedQuestion['status'];
  isExtractedLocal: boolean;
}) {
  const dark = useThemeMode() === 'dark';
  const [showRationale, setShowRationale] = useState(false);
  const isAnswered = status === 'answered' || isExtractedLocal;
  const isStashed = status === 'stashed';

  const s = noteSurface(dark);
  return (
    <div
      style={{
        // Theme-aware raise (was hardcoded white — unreadable in dark).
        background: s.raise,
        border: `1px solid ${
          isAnswered ? hexToRgba('#10b981', 0.35) : hexToRgba(PEER_BLUE, 0.15)
        }`,
        borderRadius: 6,
        padding: '8px 10px',
        opacity: isStashed ? 0.7 : 1,
        transition: 'opacity 200ms, border-color 200ms',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: NOTE_FONT_SANS,
          fontSize: 10,
          color: PEER_BLUE,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        <span>{question.workingSectionLabel}</span>
        {isAnswered && <span style={{ color: '#10b981' }}>✓ Answered</span>}
        {isStashed && <span style={{ color: '#94a3b8' }}>Stashed</span>}
      </div>
      <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 13, color: s.voice, lineHeight: 1.5 }}>
        {question.questionText}
      </div>
      {question.rationale && (
        <>
          <button
            onClick={() => setShowRationale((s) => !s)}
            style={{
              ...peerActionBtn,
              padding: '2px 0',
              marginTop: 4,
              color: PEER_BLUE,
            }}
          >
            {showRationale ? 'Hide why' : 'Why'}
          </button>
          {showRationale && (
            <div
              style={{
                fontFamily: NOTE_FONT_SERIF,
                fontSize: 11.5,
                color: s.quiet,
                fontStyle: 'italic',
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {question.rationale}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Mini ghost-text button used for inline question actions (stash/dismiss/unstash).
export const miniActionBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  fontSize: 10,
  padding: '2px 6px',
  fontFamily: 'system-ui, sans-serif',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
};

// PeerReadProse — the peer's read with typographic hierarchy instead of a
// flat block. The prompt's lead-with-position law means the FIRST SENTENCE
// is always the peer's position; set it as the lede (larger, ink), then the
// argument as body paragraphs (voice, real paragraph spacing). Split on
// newlines when the prose carries them; the lede split works either way.
export function PeerReadProse({ text, caret, dark }: { text: string; caret?: boolean; dark: boolean }) {
  const s = noteSurface(dark);
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return null;
  const m = paras[0].match(/^(.+?[.!?]["')\]]?)(?:\s+([\s\S]*))?$/);
  const lede = m ? m[1] : paras[0];
  // The streamed prose usually carries no newlines, so a long argument reads
  // as a slab. Paragraph it: split sentences, group in twos. A trailing
  // partial sentence (mid-stream) rides as its own tail group.
  const paragraphize = (t: string): string[] => {
    if (t.length < 240) return [t];
    const sents: string[] = [];
    let restTxt = t;
    for (;;) {
      const sm = restTxt.match(/^([\s\S]*?[.!?]["')\]]?)\s+(?=\S)/);
      if (!sm) break;
      sents.push(sm[1]);
      restTxt = restTxt.slice(sm[0].length);
    }
    if (restTxt.trim()) sents.push(restTxt.trim());
    const groups: string[] = [];
    for (let i = 0; i < sents.length; i += 2) groups.push(sents.slice(i, i + 2).join(' '));
    return groups.length ? groups : [t];
  };
  const rest = (m?.[2] ? [m[2], ...paras.slice(1)] : paras.slice(1)).flatMap(paragraphize);
  const caretEl = <span style={{ color: PEER_BLUE, marginLeft: 2, animation: 'cb-blink 1s step-end infinite' }}>▍</span>;
  return (
    <div style={{ fontFamily: NOTE_FONT_SERIF }}>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, letterSpacing: 0.1, color: s.ink }}>
        {lede}
        {caret && rest.length === 0 && caretEl}
      </p>
      {rest.map((p, i) => (
        <p key={i} style={{ margin: '9px 0 0', fontSize: 13.5, lineHeight: 1.6, color: s.voice }}>
          {p}
          {caret && i === rest.length - 1 && caretEl}
        </p>
      ))}
    </div>
  );
}

// Peer-surface variant: sentence case, quiet (the script side's action
// grammar — no uppercase shouting on any peer surface). miniActionBtn stays
// as-is for the non-peer editors that share it.
export const peerActionBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  fontSize: 10.5,
  fontWeight: 600,
  padding: '2px 6px',
  fontFamily: NOTE_FONT_SANS,
};

// =====================================================================
// QuestionComposer — per-question response composer with auto-save draft
// + submit + cascade-completion tracking. Honors persisted status
// (open / stashed / answered / dismissed) for cross-session continuity.
// =====================================================================

export type ComposerStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'submitting'
  | 'submitted'
  | 'extracted'
  | 'error';

export function QuestionComposer({
  question,
  persistedStatus,
  isOpen,
  onToggle,
  entity,
  slice,
  peerOriginalProse,
  projectId,
  userId,
  token,
  completedResponseIds,
  onStatusChange,
  hideStash,
  card,
  onChatOpenChange,
  onResponseSubmitted,
  initialThread,
  initialClosedThread,
}: {
  question: PeerQuestion;
  persistedStatus: 'open' | 'stashed' | 'answered' | 'dismissed';
  isOpen: boolean;
  onToggle: () => void;
  entity: ProjectEntity;
  slice: GraphSlice | null;
  peerOriginalProse: string;
  projectId: string;
  userId: string;
  token: string;
  completedResponseIds: Set<string>;
  onStatusChange: (s: 'open' | 'stashed' | 'answered' | 'dismissed') => void;
  /** When true, hide the stash button (used on the character card where stashed=open). */
  hideStash?: boolean;
  /** Render as a self-contained card (border all round) for grid layouts,
   *  instead of a list row with a bottom divider. */
  card?: boolean;
  /** Notifies parent when the chat panel opens/closes so the parent can
   *  hide sibling questions while the writer is in a thread. */
  onChatOpenChange?: (open: boolean) => void;
  /** Called after a successful response submission (onSubmit OR commit-thread).
   *  Parent uses this to schedule fallback entity-refetch polls in case the
   *  cascade_complete WS event is missed (same lossy-WS pattern that the
   *  braindump fallback poll guards against). */
  onResponseSubmitted?: () => void;
  /** Open A5 thread + turns to rehydrate across sessions. */
  initialThread?: {
    threadId: string;
    turns: ChatTurn[];
  };
  /** Closed (read-only) A5 thread that was previously committed or explicitly
   *  closed. Lets the writer revisit the conversation even after answering. */
  initialClosedThread?: {
    threadId: string;
    turns: ChatTurn[];
    closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit' | null;
    closedAt?: string | null;
  };
}) {
  const dark = useThemeMode() === 'dark';
  const [draft, setDraft] = useState('');
  const [answerFocused, setAnswerFocused] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow the answer field so it starts compact and expands with content.
  useEffect(() => {
    const el = answerRef.current;
    if (!el || !isOpen) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, isOpen]);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [status, setStatus] = useState<ComposerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const draftTimer = useRef<number | null>(null);

  // A5 chat continuation state — per-question peer thread. Lives alongside
  // the composer; writer can chat to push back on the question, then submit
  // a final response in the textarea above.
  // Hydrates from initialThread (open) or initialClosedThread (closed,
  // read-only) — so chats survive return visits AND post-commit revisits.
  const _hydratedClosed = initialThread ? false : !!initialClosedThread;
  const [chatOpen, setChatOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  // Notify parent when chat opens/closes so siblings can hide.
  useEffect(() => {
    onChatOpenChange?.(chatOpen);
    // No cleanup needed — when QuestionComposer unmounts the parent already
    // knows (sees the question gone from visiblePeerQuestions).
  }, [chatOpen, onChatOpenChange]);
  const [chatThreadId, setChatThreadId] = useState<string | null>(
    initialThread?.threadId ?? initialClosedThread?.threadId ?? null,
  );
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>(
    initialThread?.turns ?? initialClosedThread?.turns ?? [],
  );
  const [chatThinking, setChatThinking] = useState(false);
  const [chatClosed, setChatClosed] = useState<boolean>(_hydratedClosed);
  const [chatClosedReason, setChatClosedReason] =
    useState<'card_collapse' | 'inactivity' | 'new_ask' | 'explicit' | undefined>(
      _hydratedClosed ? (initialClosedThread?.closedReason ?? 'explicit') : undefined,
    );
  const [chatClosedAt, setChatClosedAt] = useState<string | undefined>(
    _hydratedClosed ? (initialClosedThread?.closedAt ?? undefined) : undefined,
  );

  // Flip to 'extracted' when cascade_complete arrives for our responseId.
  useEffect(() => {
    if (responseId && completedResponseIds.has(responseId) && status !== 'extracted') {
      setStatus('extracted');
    }
  }, [responseId, completedResponseIds, status]);

  const onDraftChange = (val: string) => {
    setDraft(val);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (val.trim().length === 0) {
      setStatus('idle');
      return;
    }
    setStatus('saving');
    draftTimer.current = window.setTimeout(async () => {
      try {
        const res = await saveCardResponseDraft(
          {
            questionId: question.questionId,
            originatingCardId: entity.id,
            projectId,
            userId,
            draftProse: val,
          },
          token,
        );
        setResponseId(res.responseId);
        setStatus('saved');
      } catch (err: any) {
        setStatus('error');
        setError(err.message ?? String(err));
      }
    }, 500);
  };

  const onSubmit = async () => {
    if (!draft.trim() || isLocked) return;
    // The writer's part is done at submit: flip to the green answered state
    // immediately and let the submit + extraction settle in the background,
    // serialized through the response queue. An error un-greens the composer
    // with the draft intact (and safeApiCall toasts it).
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    setStatus('submitted');
    setError(null);
    try {
      // focalContext: derived from slice when available (peer panel context);
      // when answering from the card without a slice, omit it — extraction
      // works with less context, just slightly weaker.
      const focalContext = slice
        ? {
            characters: (slice.co_characters ?? [])
              .map((c) => c.working_name)
              .filter(Boolean),
            events: (slice.events_involving ?? [])
              .map((e) => e.working_title)
              .filter(Boolean),
            // (event_sub_events_by_title removed — cascade no longer
            // extracts or appends sluglines. Sub_events are writer-only
            // and edited via the EventSheet's SubEventSubcards editor.)
          }
        : undefined;
      const res = await enqueueResponseSubmission(() =>
        submitCardResponse(
          {
            questionId: question.questionId,
            originatingCardId: entity.id,
            projectId,
            userId,
            responseProse: draft,
            focalEntity: {
              type: entity.type as 'character' | 'event' | 'relationship',
              working_name: entity.working_name ?? entity.working_title ?? '',
              description: entity.description ?? entity.summary ?? '',
              established_traits: entity.established_traits,
            },
            focalContext,
            peerOriginalProse: peerOriginalProse || undefined,
            question: question.questionText,
            rationale: question.rationale,
            threadId: null,
          },
          token,
        ),
      );
      setResponseId(res.responseId);
      // Fallback: trigger parent-level entity refetch polls in case the
      // cascade_complete WS event is lost (same pattern as braindump fallback).
      onResponseSubmitted?.();
    } catch (err: any) {
      setStatus('error');
      setError(err.message ?? String(err));
    }
  };

  // -------- A5 chat continuation handlers --------

  const sendChatMessage = useCallback(
    async (message: string) => {
      if (chatThinking || chatClosed || !message.trim()) return;
      setChatThinking(true);
      try {
        let tid = chatThreadId;
        if (!tid) {
          const startRes = await startPeerThread(
            {
              projectId,
              questionId: question.questionId,
              cardId: entity.id,
              userId,
            },
            token,
          );
          tid = startRes.threadId;
          setChatThreadId(tid);
        }
        const contRes = await peerContinue(
          {
            projectId,
            threadId: tid,
            questionId: question.questionId,
            writerMessage: message,
            focalContext: {
              questionText: question.questionText,
              rationale: question.rationale,
              peerOriginalProse,
            },
          },
          token,
        );
        setChatTurns((prev) => [...prev, contRes.writerTurn, contRes.peerTurn]);
      } catch (err: any) {
        console.warn('[corkboard] chat continue failed:', err);
        // Append a synthetic peer turn that surfaces the error so the writer
        // sees the failure rather than a silent stall.
        setChatTurns((prev) => [
          ...prev,
          {
            turnId: `err_${Date.now()}`,
            role: 'peer',
            content: `(peer continuation failed: ${err.message ?? err})`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setChatThinking(false);
      }
    },
    [
      chatThinking, chatClosed, chatThreadId,
      projectId, question.questionId, question.questionText, question.rationale,
      entity.id, userId, token, peerOriginalProse,
    ],
  );

  const closeChat = useCallback(async () => {
    if (chatThreadId) {
      try {
        await closePeerThread({ threadId: chatThreadId, reason: 'explicit' }, token);
      } catch (err) {
        console.warn('[corkboard] close thread failed:', err);
      }
    }
    setChatClosed(true);
    setChatClosedReason('explicit');
    setChatClosedAt(new Date().toISOString());
  }, [chatThreadId, token]);

  // Commit the whole chat thread as the question's response. Formats the
  // dialogue with [Writer]/[Peer] markers so the extraction prompt recognizes
  // it as a conversation. Submits via submitCardResponse → cascade extraction
  // runs and picks up cross-card material (e.g., chat about Marcus →
  // Marcus traits/info updates) automatically. Then closes the thread.
  const commitThreadAsResponse = useCallback(async () => {
    if (chatTurns.length === 0) return;
    if (
      status === 'submitting' ||
      status === 'submitted' ||
      status === 'extracted' ||
      persistedStatus === 'answered'
    ) {
      return;
    }
    const lines = chatTurns
      .map((t) => `[${t.role === 'peer' ? 'Peer' : 'Writer'}]: ${t.content}`)
      .join('\n\n');
    const formatted =
      `[CONVERSATION: The writer engaged in a multi-turn continuation conversation with the peer about this question. The dialogue is below, in order. Treat the writer's positions AND the peer reframings the writer adopted (built on / didn't push back on) as the joint commitment.]\n\n${lines}`;
    // Optimistic, same as the composer path: committed = done from the
    // writer's side; submit + extraction settle through the response queue.
    setStatus('submitted');
    setError(null);
    try {
      const focalContext = slice
        ? {
            characters: (slice.co_characters ?? []).map((c) => c.working_name).filter(Boolean),
            events: (slice.events_involving ?? []).map((e) => e.working_title).filter(Boolean),
            event_sub_events_by_title: Object.fromEntries(
              (slice.events_involving ?? [])
                .filter((e) => e?.working_title)
                .map((e) => [
                  e.working_title,
                  Array.isArray(e.sub_events) ? e.sub_events : [],
                ]),
            ),
          }
        : undefined;
      const res = await enqueueResponseSubmission(() =>
        submitCardResponse(
          {
            questionId: question.questionId,
            originatingCardId: entity.id,
            projectId,
            userId,
            responseProse: formatted,
            focalEntity: {
              type: entity.type as 'character' | 'event' | 'relationship',
              working_name: entity.working_name ?? entity.working_title ?? '',
              description: entity.description ?? entity.summary ?? '',
              established_traits: entity.established_traits,
            },
            focalContext,
            peerOriginalProse: peerOriginalProse || undefined,
            question: question.questionText,
            rationale: question.rationale,
            threadId: chatThreadId,
          },
          token,
        ),
      );
      setResponseId(res.responseId);
      // Fallback: trigger parent-level entity refetch polls in case the
      // cascade_complete WS event is lost (same pattern as braindump fallback).
      onResponseSubmitted?.();
      // Close the thread now that it's committed. Best-effort — graph writes
      // already landed via the submit path.
      if (chatThreadId) {
        try {
          await closePeerThread({ threadId: chatThreadId, reason: 'explicit' }, token);
        } catch (err) {
          console.warn('[corkboard] close thread failed after commit:', err);
        }
      }
      setChatClosed(true);
      setChatClosedReason('explicit');
      setChatClosedAt(new Date().toISOString());
      // Auto-collapse the question header after a brief moment so the writer
      // sees the "submitted" status banner first, then the question tucks
      // away as done. The chat panel stays mounted (chatOpen stays true)
      // and shows the closed footer / extraction banner.
      if (isOpen) {
        window.setTimeout(() => onToggle(), 600);
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.message ?? String(err));
    }
  }, [
    chatTurns, chatThreadId, slice, status, persistedStatus,
    question.questionId, question.questionText, question.rationale,
    entity, projectId, userId, token, peerOriginalProse,
    isOpen, onToggle, onResponseSubmitted,
  ]);

  // Fire-and-forget status update with optimistic UI via onStatusChange.
  const setPersistedStatus = useCallback(
    async (s: 'open' | 'stashed' | 'answered' | 'dismissed') => {
      // eslint-disable-next-line no-console
      console.debug('[stash-flow] setPersistedStatus', {
        questionId: question.questionId,
        orderIndex: question.orderIndex,
        from: persistedStatus,
        to: s,
      });
      onStatusChange(s);
      try {
        const res = await updateQuestionStatusApi(
          { questionId: question.questionId, status: s },
          token,
        );
        // eslint-disable-next-line no-console
        console.debug('[stash-flow] API success', res);
      } catch (err) {
        console.warn('[corkboard] updateQuestionStatus failed:', err);
        // Roll back optimistic update.
        onStatusChange(persistedStatus);
      }
    },
    [question.questionId, question.orderIndex, token, onStatusChange, persistedStatus],
  );

  // (Stashed branch removed — stashed and open are the same on the card.
  // Stash is only a peer-time affordance: stashing in the peer panel removes
  // the question from peer view and lets it surface on the card as openable.)

  // 'submitted' counts as answered: the writer's part is done at submit, the
  // green band shows immediately, and the cascade extraction settles in the
  // background (a muted "extracting…" hint shows until it lands).
  const isAnswered = persistedStatus === 'answered' || status === 'extracted' || status === 'submitted';
  const isLocked = status === 'submitting' || status === 'submitted' || isAnswered;
  const extractionPending = status === 'submitted';
  // A question answered by committing a chat thread: the stored responseProse is
  // the raw [CONVERSATION:] dump (and was sometimes empty on hydration — the
  // bug). Detect it via the rehydrated thread turns or the marker, and surface a
  // clean "answered via chat" band + an open-thread affordance instead of
  // dumping the marker text or (worse) rendering an empty green box.
  const answeredViaChat = isAnswered && (
    chatTurns.length > 0 ||
    (question.responseProse ?? '').trimStart().startsWith('[CONVERSATION')
  );
  // Shared green answered-band wrapper (card vs floating-row variants).
  const answeredBandStyle: React.CSSProperties = card
    ? {
        marginTop: 10, marginLeft: -10, marginRight: -10,
        background: hexToRgba('#10b981', 0.06),
        borderTop: `1px solid ${hexToRgba('#10b981', 0.18)}`,
        padding: '8px 10px',
      }
    : {
        marginTop: 10, marginLeft: 19,
        background: hexToRgba('#10b981', 0.06),
        border: `1px solid ${hexToRgba('#10b981', 0.18)}`,
        borderRadius: 6, padding: '8px 10px',
      };
  const buttonLabel =
    status === 'submitting'
      ? 'Submitting…'
      : status === 'submitted'
      ? 'Extracting…'
      : isAnswered
      ? '✓ Done'
      : 'Submit';

  const statusText =
    status === 'saving'
      ? 'Saving draft…'
      : status === 'saved'
      ? 'Draft saved'
      : status === 'submitted'
      ? 'Submitted — running cascade extraction…'
      : status === 'extracted'
      ? 'Cascade complete. Corkboard refreshed.'
      : persistedStatus === 'answered'
      ? 'Answered in a prior session.'
      : status === 'error'
      ? error
      : '';

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={
        card
          ? {
              border: dark ? '1px solid #26262c' : `1px solid ${hexToRgba(PEER_BLUE, 0.15)}`,
              borderRadius: 6,
              // One step lighter than the tile surface so the nesting reads.
              background: dark ? '#1d1d23' : '#fff',
              padding: chatOpen ? '8px 10px' : '10px 10px',
            }
          : {
              borderBottom: `1px solid ${noteSurface(dark).hairSoft}`,
              padding: chatOpen ? '8px 12px' : '12px 16px',
            }
      }
    >
      {/* Question header — hidden while chat is open (the chat window renders
          its own). Top line: label + actions; the question runs full-width
          below them so the buttons don't squeeze it into a narrow column. */}
      {!chatOpen && (
        <div onClick={onToggle} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {!card && (
              <span style={{ color: PEER_BLUE, fontSize: 11, marginTop: 3 }}>
                {isOpen ? '▾' : '▸'}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0, fontFamily: NOTE_FONT_SANS, fontSize: 10.5, color: PEER_BLUE, fontWeight: 600, lineHeight: 1.45 }}>
              {question.workingSectionLabel}
              {isAnswered && (
                <span style={{ color: '#10b981', marginLeft: 8, whiteSpace: 'nowrap' }}>✓ Answered</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {/* Chat: visible whenever there's a thread to view (even after
                  answer), OR when the question is still open to new conversation. */}
              {(chatTurns.length > 0 || !isAnswered) && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setChatOpen((o) => !o);
                  }}
                  style={{ ...peerActionBtn, color: chatTurns.length > 0 ? PEER_BLUE : undefined }}
                  title={
                    chatClosed && chatTurns.length > 0
                      ? `Closed thread — ${chatTurns.length} turn${chatTurns.length === 1 ? '' : 's'} (read-only)`
                      : chatTurns.length > 0
                      ? `Continuation thread — ${chatTurns.length} turn${chatTurns.length === 1 ? '' : 's'}`
                      : 'Continue the conversation with the peer about this question'
                  }
                >
                  {chatOpen ? '▾' : '▸'} Chat
                  {chatTurns.length > 0 && (
                    <span style={{ marginLeft: 4, opacity: 0.8 }}>
                      · {chatTurns.length}
                      {chatClosed && ' (closed)'}
                    </span>
                  )}
                </button>
              )}
              {!isAnswered && !hideStash && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPersistedStatus('stashed');
                  }}
                  style={peerActionBtn}
                  title="Stash — moves this question to the character card for later"
                >
                  Stash
                </button>
              )}
              {!isAnswered && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPersistedStatus('dismissed');
                  }}
                  style={peerActionBtn}
                  title="Not taking this question"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 7 }}>
            {/* The question IS the peer's voice — serif, the hero. */}
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 14, color: noteSurface(dark).voice, lineHeight: 1.55 }}>
              {question.questionText}
            </div>
          </div>

          {isOpen && question.rationale && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setRationaleOpen((v) => !v);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: dark ? '#787882' : '#999',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 10.5,
                  fontWeight: 600,
                  fontFamily: NOTE_FONT_SANS,
                }}
                title={rationaleOpen ? "Hide the peer's reasoning" : "Show the peer's reasoning for asking this"}
              >
                {rationaleOpen ? '▾ Why' : '▸ Why'}
              </button>
              {rationaleOpen && (
                <div
                  style={{
                    marginTop: 6,
                    paddingLeft: 10,
                    borderLeft: `2px solid ${hexToRgba(PEER_BLUE, 0.25)}`,
                    fontFamily: NOTE_FONT_SERIF,
                    fontSize: 12,
                    color: noteSurface(dark).quiet,
                    lineHeight: 1.55,
                    fontStyle: 'italic',
                  }}
                >
                  {question.rationale}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!chatOpen && (
        isAnswered && answeredViaChat ? (
          <div style={answeredBandStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontFamily: NOTE_FONT_SANS, fontSize: 10, color: '#059669', fontWeight: 600 }}>
                ✓ Answered in a chat thread
              </div>
              <button
                onClick={() => setChatOpen(true)}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, color: '#059669', padding: '2px 4px',
                  whiteSpace: 'nowrap',
                }}
              >
                open thread →
              </button>
            </div>
          </div>
        ) : isAnswered && (question.responseProse || draft.trim()) ? (
          <div style={answeredBandStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: NOTE_FONT_SANS, fontSize: 10, color: '#059669', fontWeight: 600 }}>
                Your response
              </div>
              {extractionPending && (
                <span style={{ fontSize: 9.5, color: '#059669', opacity: 0.65, whiteSpace: 'nowrap' }}>
                  extracting…
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: dark ? '#dcdce2' : '#333', whiteSpace: 'pre-wrap' }}>
              {question.responseProse || draft}
            </div>
          </div>
        ) : isAnswered ? (
          <div style={answeredBandStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontFamily: NOTE_FONT_SANS, fontSize: 10, color: '#059669', fontWeight: 600 }}>
                ✓ Answered
              </div>
              {extractionPending && (
                <span style={{ fontSize: 9.5, color: '#059669', opacity: 0.65, whiteSpace: 'nowrap' }}>
                  extracting…
                </span>
              )}
            </div>
          </div>
        ) : isOpen ? (
        // The answer field mirrors the braindump dock's design language in
        // the peer's blue: 2px frame that brightens on focus with a layered
        // glow, word count + status floating inside bottom-left, gradient
        // submit pill floating inside bottom-right.
        <div style={{ marginTop: 8, marginLeft: card ? -10 : 19, marginRight: card ? -10 : 0, position: 'relative' }}>
          <textarea
            ref={answerRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft.trim() && !isLocked) {
                e.preventDefault();
                onSubmit();
              }
            }}
            onFocus={() => setAnswerFocused(true)}
            onBlur={() => setAnswerFocused(false)}
            disabled={isLocked}
            placeholder="Answer…"
            rows={1}
            style={{
              width: '100%',
              padding: '10px 13px',
              // Clear the floating submit pill + status line once there's text.
              paddingBottom: draft.trim() ? 48 : 10,
              fontSize: 13,
              lineHeight: 1.55,
              fontFamily: 'system-ui, sans-serif',
              border: `2px solid ${answerFocused ? PEER_BLUE : hexToRgba(PEER_BLUE, 0.35)}`,
              borderRadius: 12,
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
              minHeight: 42,
              background: dark ? '#16171c' : '#fff',
              color: dark ? '#e6e6ea' : '#1d2230',
              boxSizing: 'border-box',
              boxShadow: answerFocused
                ? `0 0 10px ${hexToRgba(PEER_BLUE, 0.4)}, 0 0 25px ${hexToRgba(PEER_BLUE, 0.2)}, 0 0 50px ${hexToRgba(PEER_BLUE, 0.1)}`
                : `0 0 12px ${hexToRgba(PEER_BLUE, 0.1)}, 0 0 28px ${hexToRgba(PEER_BLUE, 0.05)}`,
              transition: 'border-color 200ms ease, box-shadow 200ms ease, padding-bottom 120ms ease',
              opacity: isLocked ? 0.65 : 1,
              display: 'block',
            }}
          />
          {/* Word count + status, floating bottom-left inside the field. */}
          {draft.trim() && (
            <div
              style={{
                position: 'absolute', bottom: 13, left: 14, zIndex: 2,
                display: 'flex', alignItems: 'baseline', gap: 8,
                pointerEvents: 'none', maxWidth: '52%',
              }}
            >
              <span style={{ fontSize: 10.5, fontWeight: 600, color: dark ? liftColor(PEER_BLUE, 0.2) : '#2b95b3', whiteSpace: 'nowrap' }}>
                {draft.trim().split(/\s+/).length} words
              </span>
              <span style={{ fontSize: 10.5, color: status === 'error' ? '#ef4444' : dark ? '#7a7a84' : '#9a9aa4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {statusText || '⌘↵ to submit'}
              </span>
            </div>
          )}
          {/* Floating submit pill inside the field, like the dock's Process button. */}
          {draft.trim() && (
            <button
              onClick={onSubmit}
              disabled={isLocked}
              title="⌘+Enter"
              style={{
                position: 'absolute', bottom: 10, right: 10, zIndex: 2,
                height: 30, padding: '0 16px', fontSize: 12, fontWeight: 600,
                border: 'none', borderRadius: 10,
                background: isLocked
                  ? dark ? '#222227' : '#e8eaef'
                  : `linear-gradient(135deg, ${PEER_BLUE} 0%, #3aa9c9 100%)`,
                color: isLocked ? (dark ? '#6a6a74' : '#9aa0ad') : '#06272f',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                fontFamily: 'system-ui, sans-serif',
                boxShadow: isLocked ? 'none' : `0 4px 12px ${hexToRgba(PEER_BLUE, 0.3)}`,
                transition: 'background 120ms ease-out, box-shadow 120ms ease-out',
                whiteSpace: 'nowrap',
              }}
            >
              {buttonLabel}
            </button>
          )}
          {/* Status with no draft (e.g. an error after clearing the field). */}
          {!draft.trim() && statusText && (
            <div style={{ marginTop: 6, fontSize: 10.5, color: status === 'error' ? 'crimson' : dark ? '#7a7a84' : '#aaa' }}>
              {statusText}
            </div>
          )}
        </div>
        ) : null
      )}

      {/* A5 chat continuation — light-theme variant of ChatContinuation,
          built inline because the shared component is hardcoded to the
          dark CardChrome palette. Closed threads are immutable. When chat is
          open, this fills the question panel (the question header above is
          hidden; the question text renders as the first peer turn inside
          LightChatContinuation). */}
      {chatOpen && (
        <div style={{ marginTop: 6 }}>
          <LightChatContinuation
            workingSectionLabel={question.workingSectionLabel}
            questionText={question.questionText}
            turns={chatTurns}
            isThinking={chatThinking}
            closed={chatClosed}
            closedReason={chatClosedReason}
            closedAt={chatClosedAt}
            parentCardType={entity.type as EntityType}
            onSendMessage={sendChatMessage}
            onCloseThread={closeChat}
            onCaptureTurnAsResponse={(text) => {
              // Pre-fill the response textarea with this turn's content
              // (append if existing draft, replace if empty). Auto-opens the
              // composer if collapsed. Auto-closes chat so the composer
              // (textarea + Submit) is visible — without this, the writer's
              // captured text would sit in a hidden textarea behind the chat
              // panel and they couldn't submit it.
              if (!isOpen) onToggle();
              const next = draft.trim() ? draft + '\n\n' + text : text;
              onDraftChange(next);
              setChatOpen(false);
            }}
            onCommitThreadAsResponse={commitThreadAsResponse}
            onExit={() => setChatOpen(false)}
            committingState={
              status === 'submitting'
                ? 'submitting'
                : status === 'submitted'
                ? 'submitted'
                : status === 'extracted' || persistedStatus === 'answered'
                ? 'extracted'
                : 'idle'
            }
          />
        </div>
      )}
    </div>
  );
}

// =====================================================================
// LightChatContinuation — light-theme variant of the dark ChatContinuation
// component. Same surface (turns + thinking + soft-cap banner + closed
// footer + input) but with light-bg colors. Kept inline so the shared dark
// version isn't touched (still used by /freeform-demo).
// =====================================================================

export const SOFT_CAP_TURNS_LIGHT = 12;

export function LightChatContinuation({
  workingSectionLabel,
  questionText,
  turns,
  isThinking,
  closed,
  closedReason,
  closedAt,
  parentCardType,
  onSendMessage,
  onCloseThread,
  onCaptureTurnAsResponse,
  onCommitThreadAsResponse,
  committingState,
  onExit,
}: {
  workingSectionLabel: string;
  questionText?: string;
  turns: ChatTurn[];
  isThinking: boolean;
  closed?: boolean;
  closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit';
  closedAt?: string;
  parentCardType: EntityType;
  onSendMessage: (message: string) => void;
  onCloseThread?: () => void;
  /** Return to the question list (exits the chat takeover). */
  onExit?: () => void;
  /** Pre-fill the working_section textarea above with a specific turn's text.
   *  When provided, each writer turn gets a "↑ use this as my response" link. */
  onCaptureTurnAsResponse?: (text: string) => void;
  /** Commit the entire dialogue as the question's response, closing the
   *  thread + triggering extraction. Cascade picks up cross-card material
   *  (e.g., chat about Marcus → Marcus updates) automatically. */
  onCommitThreadAsResponse?: () => void;
  /** Lifecycle state of an in-flight commit. When set, replaces the commit
   *  button with a status banner so the writer sees feedback. */
  committingState?: 'idle' | 'submitting' | 'submitted' | 'extracted';
}) {
  const dark = useThemeMode() === 'dark';
  const [draft, setDraft] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow the chat input (compact single line, expands with content) —
  // same mechanic as the answer field.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const writerAccent = getEntityColor(parentCardType);
  const surf = noteSurface(dark);
  // Shared bubble chrome — the peer speaks in its VOICE (serif slab with the
  // 2px peer-blue left rule — the script side's Discuss grammar); the writer
  // replies from the right in sans with the entity accent.
  const peerBubbleStyle: React.CSSProperties = {
    padding: '10px 13px',
    fontFamily: NOTE_FONT_SERIF,
    fontSize: 13.5,
    lineHeight: 1.55,
    color: surf.voice,
    whiteSpace: 'pre-wrap',
    background: dark ? '#131316' : '#fff',
    border: `1px solid ${dark ? '#1f1f24' : surf.hair}`,
    borderLeft: `2px solid ${PEER_BLUE}`,
    borderRadius: 11,
  };
  const writerBubbleStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: 13,
    lineHeight: 1.55,
    color: dark ? '#e8e8ec' : '#1d2230',
    whiteSpace: 'pre-wrap',
    background: dark ? hexToRgba(writerAccent, 0.14) : hexToRgba(writerAccent, 0.09),
    border: `1px solid ${hexToRgba(writerAccent, 0.3)}`,
    borderRadius: '12px 12px 4px 12px',
  };
  const peerAvatar = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: 11,
        background: hexToRgba(PEER_BLUE, dark ? 0.14 : 0.1),
        border: `1px solid ${hexToRgba(PEER_BLUE, 0.35)}`,
        color: PEER_BLUE,
        flexShrink: 0,
      }}
    >
      <InternIcon size={12} />
    </span>
  );

  useEffect(() => {
    if (userScrolledUp) return;
    // Scroll ONLY the messages container — scrollIntoView walks every
    // scrollable ancestor including the window, which yanked the whole
    // board (and slid the focal+peer pair under the toolbar) on chat open.
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length, isThinking, userScrolledUp]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    setUserScrolledUp(!atBottom);
  };

  const handleSend = () => {
    if (!draft.trim() || isThinking || closed) return;
    onSendMessage(draft.trim());
    setDraft('');
  };

  const overSoftCap = turns.length >= SOFT_CAP_TURNS_LIGHT;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${hexToRgba(PEER_BLUE, 0.3)}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: surf.panel,
      }}
    >
      {/* Header bar — back to the question list + what we're chatting about. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderBottom: `1px solid ${hexToRgba(PEER_BLUE, 0.15)}`,
          background: hexToRgba(PEER_BLUE, 0.05),
        }}
      >
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            style={{ ...peerActionBtn, color: PEER_BLUE, padding: '2px 4px' }}
            title="Back to questions"
          >
            ← Back
          </button>
        )}
        <span
          style={{
            flex: 1, minWidth: 0,
            fontFamily: NOTE_FONT_SANS, fontSize: 10.5,
            color: PEER_BLUE, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {workingSectionLabel}
        </span>
      </div>

      {/* Messages — a real back-and-forth: peer bubbles enter from the left
          (glasses avatar, blue tint), writer bubbles from the right (entity
          accent). The question is the peer's opening message. */}
      <div
        ref={messagesRef}
        onScroll={handleScroll}
        className="cb-scroll"
        style={{
          maxHeight: '56vh',
          overflowY: 'auto',
          padding: '14px 14px 8px',
        }}
      >
        {questionText && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
            {peerAvatar}
            <div style={{ maxWidth: '78%' }}>
              <div style={peerBubbleStyle}>{questionText}</div>
              <div style={{ fontSize: 9.5, color: dark ? '#6e6e78' : '#aaa', marginTop: 3, marginLeft: 4 }}>peer</div>
            </div>
          </div>
        )}
        {turns.map((t) =>
          t.role === 'peer' ? (
            <div key={t.turnId} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
              {peerAvatar}
              <div style={{ maxWidth: '78%' }}>
                <div style={peerBubbleStyle}>{t.content}</div>
                <div style={{ fontSize: 9.5, color: dark ? '#6e6e78' : '#aaa', marginTop: 3, marginLeft: 4 }}>
                  peer · {relativeTimeShort(t.createdAt)}
                </div>
              </div>
            </div>
          ) : (
            <div key={t.turnId} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={writerBubbleStyle}>{t.content}</div>
                <div
                  style={{
                    fontSize: 9.5,
                    color: dark ? '#6e6e78' : '#aaa',
                    marginTop: 3,
                    marginRight: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  {onCaptureTurnAsResponse && !closed && (
                    <button
                      onClick={() => onCaptureTurnAsResponse(t.content)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: writerAccent,
                        fontSize: 10,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                      title="Pre-fill the response textarea with this turn"
                    >
                      ↑ use this as my response
                    </button>
                  )}
                  <span>you · {relativeTimeShort(t.createdAt)}</span>
                </div>
              </div>
            </div>
          ),
        )}
        {isThinking && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
            {peerAvatar}
            <div
              style={{
                ...peerBubbleStyle,
                color: PEER_BLUE,
                fontSize: 12,
                fontStyle: 'italic',
                animation: 'cb-pulse 1.6s ease-in-out infinite',
              }}
            >
              thinking…
            </div>
          </div>
        )}
      </div>

      {/* Soft cap banner */}
      {overSoftCap && !closed && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 4,
            background: hexToRgba(PEER_BLUE, 0.06),
            border: `1px solid ${hexToRgba(PEER_BLUE, 0.2)}`,
            fontSize: 11.5,
            color: dark ? '#b2b2bc' : '#555',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>
            ℹ Long thread ({turns.length} turns). Consider closing and asking peer fresh.
          </span>
          {onCloseThread && (
            <button
              type="button"
              onClick={onCloseThread}
              style={{
                background: 'transparent',
                border: 'none',
                color: PEER_BLUE,
                fontSize: 11,
                textDecoration: 'underline',
                cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              Close thread
            </button>
          )}
        </div>
      )}

      {/* Commit-in-flight status banner — supersedes the closed footer and
          input area while the commit + cascade are running. */}
      {committingState && committingState !== 'idle' && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 4,
            background:
              committingState === 'extracted'
                ? hexToRgba('#10b981', 0.08)
                : hexToRgba(PEER_BLUE, 0.06),
            border: `1px solid ${
              committingState === 'extracted'
                ? hexToRgba('#10b981', 0.35)
                : hexToRgba(PEER_BLUE, 0.25)
            }`,
            fontSize: 12,
            color:
              committingState === 'extracted'
                ? dark ? '#34d399' : '#047857'
                : dark ? '#c2c2ca' : '#333',
            lineHeight: 1.45,
          }}
        >
          {committingState === 'submitting' && (
            <>
              <strong style={{ color: PEER_BLUE }}>Committing thread…</strong>{' '}
              Writing CardResponse + closing thread.
            </>
          )}
          {committingState === 'submitted' && (
            <>
              <strong style={{ color: PEER_BLUE }}>✓ Submitted.</strong>{' '}
              Extracting cascade — usually 15–30s. New cards land on the corkboard when done.
            </>
          )}
          {committingState === 'extracted' && (
            <>
              <strong>✓ Done.</strong> Cascade complete. Corkboard refreshed.
            </>
          )}
        </div>
      )}

      {/* Closed footer — only when no commit banner is showing. */}
      {closed && (!committingState || committingState === 'idle') && (
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: dark ? '#6e6e78' : '#aaa',
            fontStyle: 'italic',
            textAlign: 'center',
            padding: '6px 0',
            borderTop: dark ? '1px solid #2a2a30' : '1px solid #eee',
          }}
        >
          ─── Thread closed
          {closedReason ? ` (${closedReason.replace(/_/g, ' ')})` : ''}
          {closedAt
            ? ` at ${new Date(closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ''}{' '}
          ───
        </div>
      )}

      {/* Input — the dock's design language in blue: 2px frame that brightens
          with a layered glow on focus, auto-growing, send pill floating
          inside bottom-right. */}
      {!closed && (
        <div style={{ padding: '10px 12px 12px', borderTop: `1px solid ${hexToRgba(PEER_BLUE, 0.12)}` }}>
          <div style={{ position: 'relative' }}>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={isThinking ? 'Peer is thinking…' : 'Continue the conversation…'}
              rows={1}
              disabled={isThinking}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 12px',
                paddingBottom: draft.trim() ? 46 : 9,
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: 'system-ui, sans-serif',
                border: `2px solid ${inputFocused ? PEER_BLUE : hexToRgba(PEER_BLUE, 0.3)}`,
                borderRadius: 12,
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                minHeight: 40,
                background: dark ? '#16171c' : '#fff',
                color: dark ? '#e6e6ea' : '#1d2230',
                boxShadow: inputFocused
                  ? `0 0 10px ${hexToRgba(PEER_BLUE, 0.4)}, 0 0 25px ${hexToRgba(PEER_BLUE, 0.2)}, 0 0 50px ${hexToRgba(PEER_BLUE, 0.1)}`
                  : `0 0 12px ${hexToRgba(PEER_BLUE, 0.08)}, 0 0 28px ${hexToRgba(PEER_BLUE, 0.04)}`,
                transition: 'border-color 200ms ease, box-shadow 200ms ease, padding-bottom 120ms ease',
                opacity: isThinking ? 0.65 : 1,
                display: 'block',
              }}
            />
            {draft.trim() && (
              <button
                type="button"
                onClick={handleSend}
                disabled={isThinking}
                title="⌘+Enter"
                style={{
                  position: 'absolute', bottom: 10, right: 10, zIndex: 2,
                  height: 30, padding: '0 16px', fontSize: 12, fontWeight: 600,
                  border: 'none', borderRadius: 10,
                  background: isThinking
                    ? dark ? '#222227' : '#e8eaef'
                    : `linear-gradient(135deg, ${PEER_BLUE} 0%, #3aa9c9 100%)`,
                  color: isThinking ? (dark ? '#6a6a74' : '#9aa0ad') : '#06272f',
                  cursor: isThinking ? 'not-allowed' : 'pointer',
                  fontFamily: 'system-ui, sans-serif',
                  boxShadow: isThinking ? 'none' : `0 4px 12px ${hexToRgba(PEER_BLUE, 0.3)}`,
                  transition: 'background 120ms ease-out, box-shadow 120ms ease-out',
                  whiteSpace: 'nowrap',
                }}
              >
                Send <span style={{ opacity: 0.7, marginLeft: 4 }}>⌘↵</span>
              </button>
            )}
          </div>
          {/* Commit-thread affordance — only when there's a meaningful
              exchange (≥2 turns) and not currently thinking. */}
          {onCommitThreadAsResponse && turns.length >= 2 && !isThinking && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={onCommitThreadAsResponse}
                style={{
                  background: 'transparent',
                  border: `1px solid ${hexToRgba(PEER_BLUE, 0.4)}`,
                  borderRadius: 999,
                  color: PEER_BLUE,
                  fontSize: 11,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontFamily: 'system-ui, sans-serif',
                }}
                title="Commit this whole conversation as the question's response. Extraction picks up anything relevant for other cards (e.g., Marcus, etc.)."
              >
                Commit thread as response ↗
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// WorkingSectionsBlock — Working sections counts + "+ Add my own" inline
// writer-question creator. Per v2 walkthrough Stage 2.5 spec.
// =====================================================================

export function WorkingSectionsBlock({
  cardId,
  projectId,
  auth,
  entity,
  questions,
  completedResponseIds,
  onChanged,
  sectionLabel = 'Working sections',
  onChatActiveChange,
  grid,
}: {
  cardId: string;
  projectId?: string;
  auth: { userId: string; token: string } | null;
  entity: ProjectEntity;
  questions?: PersistedQuestion[];
  completedResponseIds: Set<string>;
  onChanged: () => void;
  /** Section heading. Pass '' to render bare (e.g. inside the Open Questions
   *  tile, which already supplies its own heading). */
  sectionLabel?: string;
  /** Fires when a question's chat takes over the block (so a parent can hide
   *  siblings — used by the Open Questions tile). */
  onChatActiveChange?: (active: boolean) => void;
  /** Grid layout for the roomy sheet tile: card composers, no trim. Off (the
   *  default) is the compact canvas card: list rows + trim to first few. */
  grid?: boolean;
}) {
  const dark = useThemeMode() === 'dark';
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, PersistedQuestion['status']>
  >({});
  const [chatOpenId, setChatOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { open: 0, stashed: 0, answered: 0, dismissed: 0 };
    for (const q of questions ?? []) {
      const s = (statusOverrides[q.questionId] ?? q.status) as keyof typeof c;
      if (s in c) c[s]++;
    }
    return c;
  }, [questions, statusOverrides]);

  const submitNew = async () => {
    const trimmed = label.trim();
    if (!trimmed || !auth || !projectId || busy) return;
    setBusy(true);
    try {
      await createWriterQuestion(
        { projectId, cardId, userId: auth.userId, workingSectionLabel: trimmed },
        auth.token,
      );
      setLabel('');
      setAdding(false);
      onChanged();
    } catch (err) {
      console.warn('[corkboard] createWriterQuestion failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const setStatusOverride = useCallback(
    (questionId: string, status: PersistedQuestion['status']) => {
      setStatusOverrides((prev) => ({ ...prev, [questionId]: status }));
    },
    [],
  );

  const isLoaded = questions !== undefined;
  // Sort + filter dismissed. On the card, stashed and open render identically.
  const visibleQuestions = useMemo(() => {
    if (!questions) return [];
    return [...questions]
      .filter((q) => {
        const s = statusOverrides[q.questionId] ?? q.status;
        return s !== 'dismissed';
      })
      .sort((a, b) => {
        const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (t !== 0) return t;
        return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
      });
  }, [questions, statusOverrides]);
  // Grid (sheet): show all — it lays out compactly. List (canvas): trim to the
  // first few with a "show more" toggle (limited space).
  const [showAll, setShowAll] = useState(false);
  const TRIM_LIMIT = 4;
  const overflow = grid ? 0 : Math.max(0, visibleQuestions.length - TRIM_LIMIT);
  const baseList = grid || showAll ? visibleQuestions : visibleQuestions.slice(0, TRIM_LIMIT);
  // When a question's chat takes over, render only that question (full chat
  // window) and tell the parent to hide everything else.
  const chatQuestion = chatOpenId ? visibleQuestions.find((q) => q.questionId === chatOpenId) : undefined;
  const chatActive = !!chatQuestion;
  const listToRender = chatQuestion ? [chatQuestion] : baseList;
  useEffect(() => {
    onChatActiveChange?.(chatActive);
  }, [chatActive, onChatActiveChange]);

  return (
    <Section label={sectionLabel}>
      {!chatActive && (
        <div style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666', marginBottom: 8 }}>
          {!isLoaded ? (
            <span style={{ color: dark ? '#6e6e78' : '#aaa' }}>loading…</span>
          ) : (
            <>
              <strong style={{ color: dark ? '#c2c2ca' : '#444' }}>{counts.open + counts.stashed}</strong> open ·{' '}
              <strong style={{ color: dark ? '#c2c2ca' : '#444' }}>{counts.answered}</strong> answered
              {counts.dismissed > 0 && (
                <span style={{ color: dark ? '#63636d' : '#bbb' }}> · {counts.dismissed} dismissed</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Inline per-question composers (first 5; rest behind "show all") */}
      {isLoaded && listToRender.length > 0 && auth && projectId && (
        <div
          style={
            chatActive
              ? { marginBottom: 8 }
              : grid
              ? { marginBottom: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8, alignItems: 'start' }
              : { marginBottom: 8, border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderRadius: 4 }
          }
        >
          {listToRender.map((q) => {
            const status = statusOverrides[q.questionId] ?? q.status;
            return (
              <QuestionComposer
                key={q.questionId}
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
                  status,
                  threadId: q.threadId,
                  responseId: q.responseId,
                  responseProse: q.responseProse ?? undefined,
                  createdAt: q.createdAt,
                  updatedAt: q.updatedAt,
                }}
                persistedStatus={status}
                isOpen={openQuestionId === q.questionId}
                onToggle={() =>
                  setOpenQuestionId((cur) => (cur === q.questionId ? null : q.questionId))
                }
                entity={entity}
                slice={null}
                peerOriginalProse=""
                projectId={projectId}
                userId={auth.userId}
                token={auth.token}
                completedResponseIds={completedResponseIds}
                onStatusChange={(s) => setStatusOverride(q.questionId, s)}
                onChatOpenChange={(open) => setChatOpenId(open ? q.questionId : null)}
                hideStash
                card={grid && !chatActive}
                initialThread={
                  q.openThread
                    ? { threadId: q.openThread.threadId, turns: q.openThread.turns }
                    : undefined
                }
                initialClosedThread={
                  q.closedThread
                    ? {
                        threadId: q.closedThread.threadId,
                        turns: q.closedThread.turns,
                        closedReason: q.closedThread.closedReason,
                        closedAt: q.closedThread.closedAt,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
      {!grid && !chatActive && overflow > 0 && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowAll((s) => !s);
          }}
          style={{ ...peerActionBtn, color: PEER_BLUE, paddingLeft: 0, marginBottom: 6 }}
        >
          {showAll ? `↑ Show fewer` : `↓ Show ${overflow} more`}
        </button>
      )}

      {/* + add my own */}
      {!chatActive && (adding ? (
        <div
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew();
              if (e.key === 'Escape') {
                setAdding(false);
                setLabel('');
              }
            }}
            disabled={busy}
            autoFocus
            placeholder="Working section label (e.g. 'What's his ceiling?')"
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: 11.5,
              border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
              borderRadius: 3,
              outline: 'none',
              fontFamily: 'system-ui, sans-serif',
            }}
          />
          <button
            onClick={submitNew}
            disabled={busy || !label.trim()}
            style={{ ...peerActionBtn, color: dark ? '#e6e6ea' : '#222' }}
          >
            Add
          </button>
          <button onClick={() => { setAdding(false); setLabel(''); }} style={peerActionBtn}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setAdding(true);
          }}
          style={{ ...peerActionBtn, color: dark ? '#c2c2ca' : '#444', paddingLeft: 0 }}
          title="Add a writer-authored working section"
        >
          + Add my own
        </button>
      ))}
    </Section>
  );
}

// =====================================================================
// EventSheet — level-3 full Event view. Two columns: identity/context
// sidebar (left) + sub-event subcards (right, primary editing surface).
// Sub-event UX mirrors Writer Duet's scene cards per the research synthesis
// (see project-subevent-subcards-design memory).
// =====================================================================

// Open Questions tile — the peer, integrated into the full-screen sheet. Same
// engine as the canvas (usePeerSession), but Ask-peer is an explicit button,
// the prose is a collapsible lead-in, the current ask's questions are answered
// inline, and the persisted trail (prior asks) sits collapsed beneath.
export function OpenQuestionsPanel({
  entity,
  projectId,
  auth,
  completedResponseIds,
  questions,
  onCardQuestionsChanged,
  onEntitiesChanged,
  accentColor,
}: {
  entity: ProjectEntity;
  projectId: string;
  auth: { userId: string; token: string };
  completedResponseIds: Set<string>;
  questions: PersistedQuestion[] | null;
  onCardQuestionsChanged: () => void;
  onEntitiesChanged: () => void;
  accentColor: string;
}) {
  const dark = useThemeMode() === 'dark';
  const {
    focalSupported,
    streaming,
    slice,
    setupError,
    statusLine,
    openOrderIndex,
    persistedStatusOverrides,
    setStatusOverride,
    handleToggleQuestion,
    handleChatOpenChange,
    chatOpenOrderIndex,
    renderedQuestions,
    handleResponseSubmitted,
    ask,
  } = usePeerSession({
    entity,
    projectId,
    userId: auth.userId,
    token: auth.token,
    onCardQuestionsChanged,
    onCascadeFallbackRefresh: onEntitiesChanged,
  });
  const [showProse, setShowProse] = useState(true);
  const [persistedChatActive, setPersistedChatActive] = useState(false);

  const busy = streaming.state === 'loading' || streaming.state === 'streaming';
  // Persisted questions minus the current live ask (dedup by id). Stashed and
  // open render identically — stashing is just "I'll answer this later".
  const liveIds = new Set(streaming.questions.map((q) => q.questionId));
  const persisted = questions == null ? undefined : questions.filter((q) => !liveIds.has(q.questionId));
  // A chat (live or persisted) takes over the whole tile — hide everything else.
  const liveChatOpen = chatOpenOrderIndex != null;
  const chatActive = liveChatOpen || persistedChatActive;

  return (
    <div className="bento-no-drag" onMouseDown={(e) => e.stopPropagation()}>
      {!chatActive && (
      <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <AskPeerButton
          onClick={() => { if (wowBentoPeerGate.active) return; ask(); }}
          disabled={busy || !focalSupported}
          label={busy ? 'Peer thinking…' : 'Ask peer'}
        />
        {statusLine && <span style={{ fontSize: 11, color: dark ? '#82828c' : '#888' }}>{statusLine}</span>}
      </div>

      {!focalSupported && (
        <div style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa' }}>Ask peer supports Character and Event cards.</div>
      )}
      {(setupError || streaming.error) && (
        <div style={{ color: 'crimson', fontSize: 12, marginBottom: 8 }}>{setupError ?? streaming.error}</div>
      )}

      {/* Peer's read — collapsible prose lead-in. */}
      {streaming.prose && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" onClick={() => setShowProse((v) => !v)} style={{ ...peerActionBtn, color: accentColor, padding: '2px 0' }}>
            {showProse ? '▾ The peer’s read' : '▸ The peer’s read'}
          </button>
          {showProse && (
            <div style={{ marginTop: 6 }}>
              <PeerReadProse text={streaming.prose} caret={streaming.state === 'streaming'} dark={dark} />
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Current ask's questions — answer inline (same composer as the canvas). */}
      {!persistedChatActive && renderedQuestions.length > 0 && (
        <div
          style={
            liveChatOpen
              ? { marginBottom: 12 }
              : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8, alignItems: 'start', marginBottom: 12 }
          }
        >
          {renderedQuestions.map((q) => {
            const status = persistedStatusOverrides[q.orderIndex] ?? 'open';
            return (
              <div key={q.orderIndex} style={{ animation: 'cb-q-popin 220ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
                <QuestionComposer
                  question={q}
                  persistedStatus={status}
                  isOpen={openOrderIndex === q.orderIndex}
                  onToggle={() => handleToggleQuestion(q.orderIndex)}
                  entity={entity}
                  slice={slice}
                  peerOriginalProse={streaming.prose}
                  projectId={projectId}
                  userId={auth.userId}
                  token={auth.token}
                  completedResponseIds={completedResponseIds}
                  onStatusChange={(s) => setStatusOverride(q.orderIndex, s)}
                  onChatOpenChange={(open) => handleChatOpenChange(q.orderIndex, open)}
                  onResponseSubmitted={handleResponseSubmitted}
                  hideStash
                  card={!liveChatOpen}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* All open questions (answer anytime). Stashed renders as open; answered
          shows its response. Reuses the canvas card's working-sections block, so
          questions from prior asks stay answerable here too. */}
      {!liveChatOpen && (
        <WorkingSectionsBlock
          cardId={entity.id}
          projectId={projectId}
          auth={auth}
          entity={entity}
          questions={persisted}
          completedResponseIds={completedResponseIds}
          onChanged={onCardQuestionsChanged}
          sectionLabel=""
          onChatActiveChange={setPersistedChatActive}
          grid
        />
      )}
    </div>
  );
}
