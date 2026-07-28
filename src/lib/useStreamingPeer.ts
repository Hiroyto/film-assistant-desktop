// lib/useStreamingPeer.ts
//
// FIL-477 / A2 — Subscribes to peer-first-pass streaming events scoped by
// clientRequestId, riding THE story session's WebSocket (storySession.ts).
// This hook used to open its own socket per peer card; that made every ask
// race its own identify write (worked-once-then-hangs), doubled the
// connections table, and had no reconnect. The session socket is open and
// identified long before any ask, reconnects with backoff, and the session
// forwards projectId-less peer events to onMessage subscribers.
//
// Event vocabulary from lib/peer.mjs:
//   - prose_start          → TTFT
//   - prose_delta          → incremental token chunk (batched ~50ms server-side)
//   - prose_complete       → prose body done, peer about to emit questions
//   - question_complete    → one fully-formed question
//   - peer_stream_done     → canonical askId + questionIds (use to swap optimistic IDs)
//   - peer_stream_error    → fail-closed message
//
// Hook returns an imperative `beginStream(clientRequestId)` to scope each ask,
// plus the live streaming state (prose, questions, state machine).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerCardState, PeerQuestion } from '../components/Freeform';
import { acquireStorySession, type StorySessionHandle } from './storySession';

interface UseStreamingPeerArgs {
  userId: string;
  projectId: string;
  storyId?: string;
  /** Convert a server question payload to a PeerQuestion for the demo state. */
  cardId: string;
  /** Disable subscription (e.g. mock mode). */
  disabled?: boolean;
}

interface ServerQuestion {
  question: string;
  working_section: string;
  rationale: string;
  questionId?: string; // present in peer_stream_done payload
  questionText?: string;
  workingSection?: string;
}

export interface StreamingPeerState {
  /** State machine matching PeerCardState. Driven by the WS event sequence. */
  state: PeerCardState | null;
  prose: string;
  questions: PeerQuestion[];
  /** Canonical askId — set when peer_stream_done arrives. Null while streaming. */
  askId: string | null;
  error: string | null;
  /** Whether the user's WS connection is open. */
  isConnected: boolean;
  /**
   * Start scoping incoming events to a fresh clientRequestId.
   * Resets prose/questions/state. Call right before invoking the HTTP peer-first-pass.
   */
  beginStream: (clientRequestId: string) => void;
  /** Clear streaming state when the peer card closes. */
  reset: () => void;
  /**
   * Resolves once the socket is OPEN and the identify has had a beat to land
   * in the connections table (~400ms grace after open). The ask path awaits
   * this BEFORE enqueueing the peer job — the local-slice cutover made asks
   * fast enough to beat a freshly-mounted socket's identify, so the backend's
   * connection scan missed this tab and the stream went nowhere (the
   * worked-once-then-hangs race). Fail-open on timeout: an enqueue with a
   * late socket still lands its questions, and the recovery poll shows them.
   */
  waitReady: (timeoutMs?: number) => Promise<boolean>;
  /** Timestamp of the last in-scope stream event (null if none this ask). */
  getLastEventAt: () => number | null;
  /**
   * Recovery hydrate: adopt persisted questions fetched over HTTP when the
   * WS stream was lost (identify race, dropped socket). Marks the ask
   * complete; canonical ids come straight from persistence.
   */
  hydratePersisted: (qs: PeerQuestion[]) => void;
}

export function useStreamingPeer({
  userId,
  projectId,
  storyId,
  cardId,
  disabled,
}: UseStreamingPeerArgs): StreamingPeerState {
  const [isConnected, setIsConnected] = useState(false);
  const [state, setState] = useState<PeerCardState | null>(null);
  const [prose, setProse] = useState('');
  const [questions, setQuestions] = useState<PeerQuestion[]>([]);
  const [askId, setAskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active clientRequestId scoping — held in a ref so the WS handler sees
  // the latest value without depending on it as a callback closure.
  const activeRequestIdRef = useRef<string | null>(null);

  const sessionRef = useRef<StorySessionHandle | null>(null);
  const lastEventAtRef = useRef<number | null>(null);

  const beginStream = useCallback(
    (clientRequestId: string) => {
      activeRequestIdRef.current = clientRequestId;
      lastEventAtRef.current = null;
      setState('loading');
      setProse('');
      setQuestions([]);
      setAskId(null);
      setError(null);
    },
    [],
  );

  // Identify grace: the identify message is a Dynamo write on the WS handler
  // side; give it a beat after socket OPEN before we let the ask enqueue. On
  // the long-lived session socket this is almost always already satisfied
  // (openedAt is minutes old), so asks proceed with zero added latency; the
  // grace only bites right after a mount or a reconnect.
  const IDENTIFY_GRACE_MS = 400;
  const waitReady = useCallback(async (timeoutMs = 5000): Promise<boolean> => {
    const t0 = Date.now();
    for (;;) {
      const st = sessionRef.current?.wsState();
      if (st?.open) {
        const since = Date.now() - (st.openedAt ?? 0);
        if (since < IDENTIFY_GRACE_MS) await new Promise((r) => setTimeout(r, IDENTIFY_GRACE_MS - since));
        return true;
      }
      if (Date.now() - t0 >= timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 150));
    }
  }, []);

  const getLastEventAt = useCallback(() => lastEventAtRef.current, []);

  const hydratePersisted = useCallback((qs: PeerQuestion[]) => {
    if (qs.length === 0) return;
    setQuestions((prev) => (prev.length >= qs.length ? prev : qs));
    setState('complete');
  }, []);

  const reset = useCallback(() => {
    activeRequestIdRef.current = null;
    setState(null);
    setProse('');
    setQuestions([]);
    setAskId(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (disabled) return;

    let cancelled = false;
    // Ride the story session's socket. Token-less auth: supplies the userId
    // the socket identify needs (the demo page has no page-level acquirer)
    // without ever clobbering the page's real token.
    const session = acquireStorySession(storyId ?? projectId, { userId });
    sessionRef.current = session;

    // isConnected mirrors the session socket cheaply (no per-message work).
    setIsConnected(session.wsState().open);
    const connPoll = window.setInterval(() => {
      if (!cancelled) setIsConnected(session.wsState().open);
    }, 2000);

    const off = session.onMessage((msg: any) => {
      if (cancelled) return;
      // Only handle peer-stream events
      if (
        !msg?.type ||
        !['prose_start', 'prose_delta', 'prose_complete', 'question_complete', 'peer_stream_done', 'peer_stream_error'].includes(
          msg.type,
        )
      ) {
        return;
      }
      // Scope by clientRequestId — ignore events that don't match the active one.
      if (msg.clientRequestId !== activeRequestIdRef.current) return;
      lastEventAtRef.current = Date.now();

      switch (msg.type) {
        case 'prose_start':
          setState('streaming');
          break;

        case 'prose_delta':
          if (typeof msg.delta === 'string') {
            setProse((p) => p + msg.delta);
          }
          break;

        case 'prose_complete':
          setState('composing');
          break;

        case 'question_complete': {
          const sq = msg.question as ServerQuestion;
          if (!sq?.question || !sq?.working_section || !sq?.rationale) return;
          // Use the orderIndex from the server if provided.
          const orderIndex = typeof msg.orderIndex === 'number' ? msg.orderIndex : questions.length;
          const now = new Date().toISOString();
          const optimisticQuestion: PeerQuestion = {
            questionId: `stream_q_${orderIndex}_${activeRequestIdRef.current}`,
            askId: '',
            cardId,
            projectId,
            orderIndex,
            questionText: sq.question,
            workingSectionLabel: sq.working_section,
            rationale: sq.rationale,
            authoredBy: 'peer',
            status: 'open',
            threadId: null,
            responseId: null,
            createdAt: now,
            updatedAt: now,
          };
          setQuestions((prev) => {
            // dedupe by orderIndex
            if (prev.some((q) => q.orderIndex === orderIndex)) return prev;
            const next = [...prev, optimisticQuestion];
            // sort by orderIndex to keep stable rendering even if server emits out-of-order
            next.sort((a, b) => a.orderIndex - b.orderIndex);
            return next;
          });
          break;
        }

        case 'peer_stream_done': {
          setState('complete');
          if (typeof msg.askId === 'string') setAskId(msg.askId);
          // Swap in canonical questionIds from the server.
          if (Array.isArray(msg.questions)) {
            setQuestions((prev) => {
              return prev.map((p) => {
                const serverQ = msg.questions.find((q: any) => q.orderIndex === p.orderIndex);
                if (!serverQ?.questionId) return p;
                return {
                  ...p,
                  questionId: serverQ.questionId,
                  askId: msg.askId,
                  questionText: serverQ.questionText ?? p.questionText,
                  workingSectionLabel: serverQ.workingSection ?? p.workingSectionLabel,
                  rationale: serverQ.rationale ?? p.rationale,
                };
              });
            });
          }
          break;
        }

        case 'peer_stream_error':
          setError(msg.error ?? 'Peer streaming error');
          break;
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(connPoll);
      off();
      session.release();
      sessionRef.current = null;
    };
  }, [userId, projectId, storyId, cardId, disabled]);

  return {
    state,
    prose,
    questions,
    askId,
    error,
    isConnected,
    beginStream,
    reset,
    waitReady,
    getLastEventAt,
    hydratePersisted,
  };
}
