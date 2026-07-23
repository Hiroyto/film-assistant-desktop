// lib/useStreamingPeer.ts
//
// FIL-477 / A2 — Subscribes to the WS for peer-first-pass streaming events
// scoped by clientRequestId. Same WS endpoint as useCascadeEvents but a
// separate subscription (parallel hooks, parallel connections — consolidate
// to a single bus in v2 if connection count becomes an issue).
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

  const wsRef = useRef<WebSocket | null>(null);

  const beginStream = useCallback(
    (clientRequestId: string) => {
      activeRequestIdRef.current = clientRequestId;
      setState('loading');
      setProse('');
      setQuestions([]);
      setAskId(null);
      setError(null);
    },
    [],
  );

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
    const wsEndpoint = process.env.REACT_APP_WEBSOCKET_ENDPOINT;
    if (!wsEndpoint) return;

    let cancelled = false;
    const ws = new WebSocket(wsEndpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setIsConnected(true);
      try {
        ws.send(
          JSON.stringify({
            action: 'identify',
            userId,
            storyId: storyId ?? projectId,
            timestamp: Date.now(),
          }),
        );
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (raw) => {
      if (cancelled) return;
      let msg: any;
      try {
        msg = JSON.parse(raw.data);
      } catch {
        return;
      }
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
    };

    ws.onclose = () => {
      if (cancelled) return;
      setIsConnected(false);
    };

    ws.onerror = () => {
      // ignore — onclose will fire too
    };

    return () => {
      cancelled = true;
      try {
        ws.close(1000, 'unmount');
      } catch {
        /* ignore */
      }
      wsRef.current = null;
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
  };
}
