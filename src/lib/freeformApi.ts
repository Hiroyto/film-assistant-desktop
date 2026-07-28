// lib/freeformApi.ts
//
// Wrapper for the freeform-workflow-app Lambda calls.
//
// While FIL-495 (API Gateway /freeform route) is pending, this module
// returns realistic mock data when REACT_APP_FREEFORM_API_PATH is unset.
// When the env var is set (e.g. to "freeform"), it routes real calls via
// the existing safeApiCall HTTP pattern.
//
// All response shapes mirror the Lambda's actual output. Swap mock → real
// without changing consumers.

import { fetchAuthSession } from 'aws-amplify/auth';
import { safeApiCall } from '../models/apiHelpers';
import type { PeerQuestion } from '../components/Freeform';

// Stale-token guard for every freeform call. Long corkboard sessions outlive
// the Cognito idToken captured at page load (~1hr expiry), which surfaced as
// silent 401s on draft-save/submit mid peer session. Amplify caches the
// session and only refreshes when the token is near expiry, so resolving per
// call is cheap. Falls back to the caller's captured token if the session
// lookup fails (e.g. tests).
async function liveToken(fallback: string): Promise<string> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? fallback;
  } catch {
    return fallback;
  }
}

async function freshApiCall(endpoint: string, data: any, token: string) {
  return safeApiCall(endpoint, data, await liveToken(token));
}

// ============================================
// Types matching the Lambda's response shapes
// ============================================

export interface PeerFirstPassRequest {
  projectId: string;
  cardId: string;
  focalType: 'character' | 'event' | 'relationship' | 'sequence';
  focalId: string;
  slice: GraphSlice;
  /** FIL-477: when supplied along with clientRequestId, backend streams via WS. */
  userId?: string;
  /** Client-side request ID used to scope WS streaming events to this call. */
  clientRequestId?: string;
}

/**
 * Graph slice shape passed to peer-first-pass.
 * Built server-side by the build-slice event (Neptune neighborhood + prior
 * CardResponses), or assembled locally as a fallback.
 * See freeform-workflow-app/lib/peer-slice.mjs for the canonical shape.
 */
export interface GraphSlice {
  focal_type: 'character' | 'event' | 'relationship' | 'sequence';
  focal_entity: Record<string, any>;
  events_involving?: Record<string, any>[];
  co_characters?: Record<string, any>[];
  /** Characters connected to focal via Relationship vertices or structural edges (not events). */
  mentioned_characters?: Record<string, any>[];
  relevant_information?: Record<string, any>[];
  focal_knowledge?: Record<string, any>[];
  focal_as_subject_of_knowledge?: Record<string, any>[];
  focal_relationships?: Record<string, any>[];
  focal_structural_edges?: Record<string, any>[];
  source_card_prose?: string;
  /** Writer's answered CardResponses on this card — attached by build-slice. */
  prior_responses?: Array<{
    question: string;
    working_section: string;
    rationale: string;
    response_prose: string;
    answered_at: string;
  }>;
  /** Previously-asked unanswered questions (open or stashed) so the peer
   *  doesn't regenerate variations on repeated asks. */
  prior_open_questions?: Array<{
    question: string;
    working_section: string;
    rationale: string;
    status: 'open' | 'stashed';
    asked_at: string;
  }>;
}

export interface BuildSliceRequest {
  projectId: string;
  cardId: string;
  focalType: 'character' | 'event' | 'relationship' | 'sequence';
  /** working_name for character/relationship focal; working_title for event. */
  focalId: string;
  /** Used when Neptune doesn't have the focal vertex yet. Shape varies by
   *  focalType — character uses working_name+traits+description, event uses
   *  working_title+summary+sub_events+narrative_status. Backend dispatches. */
  focalSeed?: {
    working_name?: string;
    working_title?: string;
    description?: string;
    summary?: string;
    established_traits?: string[];
    open_dimensions?: Array<{ tension: string; why_it_matters: string }>;
    evidence_quote?: string;
    narrative_status?: string;
    sub_events?: Array<{ slugline?: string; description?: string }>;
    audience_state?: Record<string, any>;
  };
  sourceProse?: string;
}

export interface BuildSliceResponse {
  slice: GraphSlice;
  usedSeed: boolean;
  latencyMs: number;
}

export interface SliceGradeStats {
  focal_type: string | null;
  focal_name: string | null;
  focal_completeness: {
    has_description: boolean;
    has_traits: boolean;
    has_open_dimensions: boolean;
    has_evidence_quote: boolean;
  };
  focal_completeness_score: number;
  counts: {
    co_characters: number;
    mentioned_characters: number;
    events: number;
    information: number;
    knowledge: number;
    knowledge_as_subject: number;
    relationships: number;
    structural_edges: number;
    prior_responses: number;
    priors_without_question_context: number;
  };
  newest_prior_at: string | null;
  newest_prior_age_hours: number | null;
  slice_bytes: number;
  has_source_card_prose: boolean;
}

export interface SliceLLMGrade {
  coverage_score: number;
  coverage_gaps: string[];
  consistency_score: number;
  contradictions: string[];
  relevance_score: number;
  irrelevant_items: string[];
  would_inform_peer: number;
  what_would_make_it_better: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  error?: string;
}

export interface SliceGradeResponse {
  stats: SliceGradeStats;
  llmGrade: SliceLLMGrade;
  gradeVersion: number;
  totalLatencyMs: number;
}

export interface GradeSliceRequest {
  slice: GraphSlice;
  projectId?: string;
  cardId?: string;
  focalId?: string;
}

export interface PeerFirstPassResponse {
  askId: string;
  responseProse: string;
  questions: Array<{
    questionId: string;
    questionText: string;
    workingSection: string;
    rationale: string;
  }>;
  model: string;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
  peerPromptVersion: number;
}

/** FIL-499 — async producer response. The full result arrives via WS streaming. */
export interface EnqueuePeerFirstPassResponse {
  askId: string;
  queued: boolean;
  messageId: string;
}

export interface EnqueueExtractionJobRequest {
  jobType: 'extract-braindump' | 'extract-card-response' | 're-extract-card';
  userId: string;
  projectId: string;
  [key: string]: any; // job-specific fields
}

/** Job-specific fields for jobType === 'extract-braindump'. */
export interface ExtractBraindumpJobFields {
  braindumpId: string;
  prose: string;
  reprocess?: boolean;
  /** Set to 'screenplay' for PDF/script imports so the backend applies the
   *  screenplay-specific segmentation prompt. Omitted for prose braindumps. */
  sourceFormat?: 'screenplay';
  /** Dev-only: stream entities over WS as they extract (card-by-card reveal).
   *  Set by the dev FE; prod leaves it unset and runs the batch path. */
  streaming?: boolean;
}

export interface EnqueueExtractionJobResponse {
  queued: boolean;
  messageId: string;
}

// FIL-479 / A4 — CardResponse + Question lifecycle

export interface SaveDraftRequest {
  questionId: string;
  originatingCardId: string;
  projectId: string;
  userId: string;
  draftProse: string;
}

export interface SaveDraftResponse {
  responseId: string;
  saved: boolean;
}

export interface SubmitResponseRequest {
  questionId: string;
  originatingCardId: string;
  projectId: string;
  userId: string;
  responseProse: string;
  focalEntity: {
    type: 'character' | 'event' | 'relationship';
    working_name: string;
    description: string;
    established_traits?: string[];
  };
  focalContext?: { characters: string[]; events: string[] };
  peerOriginalProse?: string;
  question?: string;
  rationale?: string;
  threadId?: string | null;
}

export interface SubmitResponseResponse {
  responseId: string;
  questionId: string;
  status: 'answered';
  extractionEnqueued: boolean;
  extractionMessageId?: string;
}

export interface UpdateQuestionStatusRequest {
  questionId: string;
  status: 'open' | 'stashed' | 'answered' | 'dismissed';
}

// FIL-496 — fetch all persisted Questions for a card so the corkboard's peer
// panel can resurface stashed/answered/dismissed questions instead of starting
// from a blank slate each time.

export interface PersistedQuestion {
  questionId: string;
  cardId: string;
  projectId: string;
  askId?: string;
  questionText: string;
  workingSectionLabel: string;
  rationale: string;
  authoredBy: 'peer' | 'writer';
  status: 'open' | 'stashed' | 'answered' | 'dismissed';
  orderIndex: number;
  threadId: string | null;
  responseId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Hydrated by list-card-questions when withResponses=true. */
  responseProse?: string | null;
  responseSubmittedAt?: string | null;
  /** Hydrated by list-card-questions when withOpenThreads=true. Open A5 chat
   *  thread with its turns, so the FE can rehydrate the chat surface across
   *  sessions. Absent when no open thread. */
  openThread?: {
    threadId: string;
    status: 'open';
    createdAt: string;
    updatedAt: string;
    turns: Array<{
      turnId: string;
      role: 'writer' | 'peer';
      content: string;
      createdAt: string;
    }>;
  };
  /** Same hydration but for the question's linked thread when it's been
   *  closed (committed as response or explicitly closed). Read-only on the
   *  FE — lets the writer revisit the conversation. */
  closedThread?: {
    threadId: string;
    status: 'closed';
    createdAt: string;
    updatedAt: string;
    turns: Array<{
      turnId: string;
      role: 'writer' | 'peer';
      content: string;
      createdAt: string;
    }>;
    closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit' | null;
    closedAt?: string | null;
  };
}

export interface ListCardQuestionsRequest {
  cardId: string;
  /** When true, hydrates `responseProse` on answered questions. Used by the level-3 character sheet. */
  withResponses?: boolean;
  /** When true, hydrates the open A5 thread (with turns) per question so the FE can rehydrate chat state. */
  withOpenThreads?: boolean;
}

export interface ListCardQuestionsResponse {
  questions: PersistedQuestion[];
}

// FIL-496 — sub-event editing on Event cards (Writer Duet-style notecards).

export interface SubEvent {
  slugline?: string;
  description?: string;
}

export interface UpdateEventSubEventsRequest {
  cardId: string;
  projectId: string;
  subEvents: SubEvent[];
}

export interface UpdateEventSubEventsResponse {
  saved: boolean;
  updatedAt: string;
  count: number;
}

export interface CreateWriterQuestionRequest {
  projectId: string;
  cardId: string;
  userId: string;
  workingSectionLabel: string;
  orderIndex?: number;
}

// FIL-480 / A5 — Chat continuation

export interface StartThreadRequest {
  projectId: string;
  questionId: string;
  cardId: string;
  userId: string;
}

export interface StartThreadResponse {
  threadId: string;
  status: 'open';
  createdAt: string;
}

export interface PeerContinueRequest {
  projectId: string;
  threadId: string;
  questionId: string;
  writerMessage: string;
  focalContext?: {
    questionText?: string;
    rationale?: string;
    peerOriginalProse?: string;
  };
}

export interface ContinuationTurn {
  turnId: string;
  role: 'writer' | 'peer';
  content: string;
  createdAt: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  latencyMs?: number;
}

export interface PeerContinueResponse {
  threadId: string;
  writerTurn: ContinuationTurn;
  peerTurn: ContinuationTurn;
  turnCount: number;
  latencyMs: number;
}

export interface CloseThreadRequest {
  threadId: string;
  reason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit';
}

// FIL-496 — corkboard read (all renderable entities + connecting edges).

export type ProjectEntityType = 'character' | 'event' | 'location' | 'relationship' | 'arc' | 'sequence';

/** FIL-504 / D' — Arc vertex kind enum. Audience-question is one shape;
 *  the others cover transformation, promise, belief, thematic arcs.
 *  'relational' was originally part of the taxonomy but was dropped —
 *  character-to-character bonds live as :Relationship vertices (existing
 *  reification pattern), not as Arc cards. Locked. */
export type ArcKind =
  | 'audience_question'
  | 'transformation'
  | 'promise'
  | 'belief'
  | 'thematic';

export const ARC_KINDS: ArcKind[] = [
  'audience_question',
  'transformation',
  'promise',
  'belief',
  'thematic',
];

/** FIL-504 / D'-2 — EVOKES transition enum. Optional on each EVOKES edge.
 *  narrative_status × transition rule: backstory events allow only 'touches'.
 *  Locked in FIL-504. */
export type EvokesTransition =
  | 'touches'
  | 'introduces'
  | 'develops'
  | 'complicates'
  | 'resolves'
  | 'regresses'
  | 'abandoned';

export const EVOKES_TRANSITIONS: EvokesTransition[] = [
  'touches',
  'introduces',
  'develops',
  'complicates',
  'resolves',
  'regresses',
  'abandoned',
];

/**
 * Entity vertex returned by list-project-entities. `id` is the Neptune vertex
 * id (stable; use as React key + layout-storage key). `working_name` /
 * `working_title` are what build-slice expects as `focalId`.
 *
 * Property bag varies by type — see project-reads.mjs::normalizeEntity. JSON
 * array/object props (`established_traits`, `open_dimensions`, `sub_events`,
 * `audience_state`) are parsed for you.
 */
export interface ProjectEntity {
  id: string;
  type: ProjectEntityType;
  working_name?: string;
  working_title?: string;
  description?: string;
  summary?: string;
  established_traits?: string[];
  open_dimensions?: Array<{ tension: string; why_it_matters: string }>;
  sub_events?: Array<{ slugline?: string; description?: string }>;
  audience_state?: Record<string, any>;
  narrative_status?: 'on_screen' | 'backstory' | 'offstage' | string;
  int_ext?: string;
  evidence_quote?: string;
  /** Sequence-specific: plot-order index stamped at extraction time (sequences
   *  emit in story order). Canvas orders sequences by (created_at, seq_order). */
  seq_order?: number;
  /** Vertex creation timestamp (ISO), present on all entities via elementMap.
   *  Tie-breaks sequence order across braindumps (one timestamp per braindump). */
  created_at?: string;
  /** §9 soft-delete tombstone. Absent / falsy = alive. FE renders canvas from
   *  alive entities, Trash overlay from deleted ones. */
  deleted_at?: string;
  // Relationship-specific
  character_a?: string;
  character_b?: string;
  kind?: string;
  /** Per-participant roles (2026-07-25 bond convention): kind is the
   *  symmetric bond noun; asymmetry lives here (guardian/ward, mentor/
   *  mentee). Identical on both sides for symmetric bonds. */
  role_a?: string;
  role_b?: string;
  rationale?: string;
  // Arc-specific (FIL-504 / D'-1). `working_name` and `description` are shared
  // with other entity types above; `kind` for Arc holds an `ArcKind`, not a
  // free-string predicate like Relationship's. `evidence_quote` and
  // `open_dimensions` are also shared. `aliases` carries prior names after
  // rename. Per Q6: Arc carries NO `current_state` or `status` — both derived
  // from EVOKES transitions at slice-build / render time.
  aliases?: string[];
  // Arc-specific — writer-chosen canvas thread/ball color (6-digit hex).
  // Falsy = auto-assign from ARC_THREAD_PALETTE by index.
  color?: string;
  [key: string]: any;
}

export interface ProjectEdges {
  /** Event/Relationship → Character. `streamed` marks a provisional edge the
   *  FE derived from a streamed card mid-extraction (never sent by the server;
   *  the authoritative refetch replaces it). */
  involves: Array<{ from: string; to: string; streamed?: boolean }>;
  /** Event → Location */
  occurs_in: Array<{ from: string; to: string }>;
  /** Event → Event (forward only). `streamed` as on involves. */
  precedes: Array<{ from: string; to: string; streamed?: boolean }>;
  /** Sequence → Sequence (forward only) — the sequence throughline, auto-chained
   *  in plot order at extraction time. Same edge label as precedes, Sequence ends. */
  sequence_precedes: Array<{ from: string; to: string }>;
  /** Character → Character custom predicate (MARRIED_TO, HIRED, etc.) */
  structural: Array<{
    from: string;
    to: string;
    predicate: string;
    /** Dual-wording convention (2026-07-25): the to-side's reading of the
     *  same fact ('created_by' for a 'creator_of' edge). Empty on legacy
     *  edges — fall back to the forward wording. */
    inverse_predicate?: string;
    evidence_quote?: string;
  }>;
  /** Character/Audience → Information with knowledge state. */
  knowledge: Array<{
    knower_id: string;
    info_id: string;
    label: 'KNOWS' | 'DOESNT_KNOW' | string;
    state: string;
    state_qualifier?: string;
    evidence_quote?: string;
    /** Scene this state is anchored to (FIL-505). '' = legacy un-anchored
     *  edge (rendered on the fact's establishing scene). */
    at_event?: string;
  }>;
  /** FIL-504 / D'-3 — Event → Arc with optional per-vantage state.
   *  state_at_event + transition + evidence_quote are all optional per v1
   *  schema. transition values from EVOKES_TRANSITIONS enum (empty = unfilled,
   *  which the FE renders distinctly from 'touches'). */
  evokes: Array<{
    event_id: string;
    arc_id: string;
    state_at_event: string;
    transition: EvokesTransition | '';
    evidence_quote: string;
  }>;
  /** FIL-504 / D'-3 — Arc → Character (arc INVOLVES character). Distinct
   *  edge endpoint pattern from Event→Character INVOLVES; both share the
   *  same edge label, separated by outV() vertex label at query time. */
  arc_involves: Array<{
    arc_id: string;
    character_id: string;
  }>;
  /** D'-11 — CAUSES edges. Endpoints may each be an Event or Arc (four
   *  combos). A causal connective layered ON TOP of PRECEDES (an Event→Event
   *  pair can carry both). Enhancer signal, never a slice filter. */
  causes: Array<{
    from: string;
    to: string;
    evidence_quote?: string;
  }>;
  /** Sequence → Event containment (the granularity-fix container's member
   *  scenes). Membership is disjoint server-side: a scene is in at most one
   *  sequence. */
  contains: Array<{ from: string; to: string }>;
}

export interface ProjectInformation {
  id: string;
  summary: string;
  evidence_quote?: string;
  /** Event vertex ids where this info was first established (rare to have >1). */
  established_in_event_ids: string[];
  /** Writer flagged this fact as flat / no ironic potential → hidden from the
   *  Knowledge tile (no edges touched). FIL-505. */
  irony_hidden?: boolean;
}

export interface ListProjectEntitiesRequest {
  projectId: string;
}

export interface ListProjectEntitiesResponse {
  projectId: string;
  entities: ProjectEntity[];
  edges: ProjectEdges;
  /** Information vertices — not rendered as cards, but used for Knowledge arcs on Character cards. */
  information: ProjectInformation[];
  latencyMs: number;
}

// FIL-496 — card-layout persistence (CardLayouts Dynamo table, per-user).

export interface CardLayout {
  cardId: string;
  x: number;
  y: number;
  scale?: number;
  zIndex?: number;
  updatedAt?: string;
}

export interface UpdateCardPositionRequest {
  userId: string;
  projectId: string;
  cardId: string;
  x: number;
  y: number;
  scale?: number;
  zIndex?: number;
}

export interface UpdateCardPositionResponse {
  saved: boolean;
  updatedAt: string;
}

export interface GetCardLayoutsRequest {
  userId: string;
  projectId: string;
}

export interface GetCardLayoutsResponse {
  layouts: CardLayout[];
}

// FIL-496 §7 — manual writer-authored card creation.

export type CreateCardKind = 'character' | 'event' | 'location';

export interface CreateCardRequest {
  kind: CreateCardKind;
  projectId: string;
  userId: string;
  workingName: string;
  description?: string;
  /** Event only. Defaults to 'on_screen' server-side. */
  narrativeStatus?: 'on_screen' | 'backstory' | 'offstage';
  /** Location only. */
  intExt?: 'INT' | 'EXT';
  /** Optional initial position — persisted to CardLayouts in the same request. */
  position?: { x: number; y: number };
  /** Event only. Vertex id of the existing event this new event follows.
   *  Backend writes a PRECEDES edge from that event → the new event so the
   *  beat lands in the throughline immediately. Best-effort. */
  precededByEventId?: string;
}

export type CreateCardResponse =
  | {
      created: true;
      entity: ProjectEntity;
      /** True if a PRECEDES edge from precededByEventId → new event landed. */
      precedesEdgeWritten?: boolean;
    }
  | { exists: true; cardId: string; type: string; deleted: boolean };

// FIL-496 §9 — soft delete + restore.

export interface DeleteCardRequest {
  cardId: string;
  projectId: string;
}

export interface DeleteCardResponse {
  deleted: true;
  cardId: string;
  deletedAt: string;
  relationshipsAffected: number;
}

export interface RestoreCardRequest {
  cardId: string;
  projectId: string;
}

export interface RestoreCardResponse {
  restored: true;
  cardId: string;
  relationshipsAffected: number;
}

// FIL-496 §10 — rename. Updates working_name (+ working_title for Events).
// Vertex ID never moves; old name appended to the aliases array.

export interface UpdateCardNameRequest {
  cardId: string;
  projectId: string;
  workingName: string;
}

export type NarrativeStatus = 'on_screen' | 'backstory' | 'offstage';

export interface UpdateCardNarrativeStatusRequest {
  cardId: string;
  projectId: string;
  narrativeStatus: NarrativeStatus;
}

export interface UpdateCardNarrativeStatusResponse {
  saved: true;
  cardId: string;
  narrativeStatus: NarrativeStatus;
  updatedAt: string;
}

/** D'-10 — payload returned when flipping a narrative_status to backstory
 *  would invalidate one or more existing EVOKES edges per the Q7 rule
 *  (backstory events can only carry transition='touches'). The FE catches
 *  this and renders a flag-for-review modal so the writer can pick a
 *  resolution per arc (demote to touches OR drop the EVOKES). */
export interface SupersessionRequiredResponse {
  error: 'supersession_required';
  cardId: string;
  narrativeStatus: NarrativeStatus;
  violations: Array<{
    arcId: string;
    arcName: string;
    transition: EvokesTransition | string;
    stateAtEvent: string;
    evidenceQuote: string;
  }>;
}

export interface ResolveNarrativeStatusFlipRequest {
  cardId: string;
  projectId: string;
  narrativeStatus: NarrativeStatus;
  resolutions: Array<{ arcId: string; action: 'demote' | 'remove' }>;
}

export interface ResolveNarrativeStatusFlipResponse {
  saved: true;
  cardId: string;
  narrativeStatus: NarrativeStatus;
  resolved: number;
  updatedAt: string;
}

/** Thrown by `updateCardNarrativeStatus` when the backend returned a
 *  supersession_required payload (HTTP 409). The FE catches this and
 *  opens the SupersessionModal — the writer's resolution submits via
 *  `resolveNarrativeStatusFlip`. */
export class SupersessionRequiredError extends Error {
  payload: SupersessionRequiredResponse;
  constructor(payload: SupersessionRequiredResponse) {
    super('supersession_required');
    this.name = 'SupersessionRequiredError';
    this.payload = payload;
  }
}

// D'-5b — generic description edit across Character/Event/Location/
// Relationship/Arc. For Event, backend writes both `summary` and
// `description` so consumers reading either field stay in sync.

export interface UpdateCardDescriptionRequest {
  cardId: string;
  projectId: string;
  description: string;
}

export interface UpdateCardDescriptionResponse {
  saved: true;
  cardId: string;
  description: string;
  updatedAt: string;
}

// ============================================
// FIL-504 / D' — Arc CRUD
// ============================================

export interface CreateArcRequest {
  projectId: string;
  userId: string;
  workingName: string;
  kind: ArcKind;
  description?: string;
  evidenceQuote?: string;
  openDimensions?: Array<{ tension: string; why_it_matters: string }>;
  position?: { x: number; y: number };
}

export type CreateArcResponse =
  | { created: true; entity: ProjectEntity }
  | { exists: true; cardId: string; type: string; deleted: boolean };

export interface CreateArcFromEventsRequest {
  projectId: string;
  userId: string;
  workingName: string;
  kind: ArcKind;
  description?: string;
  evidenceQuote?: string;
  openDimensions?: Array<{ tension: string; why_it_matters: string }>;
  eventIds: string[];
  position?: { x: number; y: number };
}

export interface CreateArcFromEventsResponse {
  created: true;
  entity: ProjectEntity;
  evokesEdgesCreated: number;
  eventDetails: Array<{
    event_id: string;
    event_working_title: string;
    narrative_status: string;
    transition?: EvokesTransition | null;
    error?: string;
  }>;
}

export interface UpdateArcRequest {
  arcId: string;
  projectId: string;
  workingName?: string;
  kind?: ArcKind;
  description?: string;
  evidenceQuote?: string;
  openDimensions?: Array<{ tension: string; why_it_matters: string }>;
  /** Writer-chosen thread color (6-digit hex). '' clears back to the
   *  auto-assigned palette color. */
  color?: string;
}

export interface UpdateArcResponse {
  updated: boolean;
  arcId: string;
  workingName?: string;
  aliases?: string[];
  kind?: ArcKind;
  description?: string;
  evidenceQuote?: string;
  openDimensions?: Array<{ tension: string; why_it_matters: string }>;
  color?: string;
  updatedAt?: string;
}

export interface DeleteArcRequest {
  arcId: string;
  projectId: string;
}

export interface DeleteArcResponse {
  deleted: true;
  arcId: string;
  deletedAt: string;
}

export interface RestoreArcRequest {
  arcId: string;
  projectId: string;
}

export interface RestoreArcResponse {
  restored: true;
  arcId: string;
}

export interface UpdateCardNameResponse {
  /** False when the new name matches the current one (no-op write to the
   *  Character vertex). Relationship cascade still runs to repair any
   *  legacy stale character_a/character_b strings. */
  renamed: boolean;
  cardId: string;
  workingName: string;
  aliases: string[];
  previousName: string;
  /** Count of Relationship vertices whose character_a/character_b strings
   *  were updated to the new name. FE refreshes when > 0 so relationship
   *  cards reflect the new name. */
  relationshipsAffected: number;
  updatedAt: string | null;
}

// ============================================
// API entry points
// ============================================

const apiPath = process.env.REACT_APP_FREEFORM_API_PATH; // e.g. "freeform" once FIL-495 lands
const useMock = !apiPath;

/** True when the API layer is returning local mocks (no API path configured). */
export const isMockMode = useMock;

if (useMock && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.info(
    '[freeformApi] Using MOCK data. Set REACT_APP_FREEFORM_API_PATH=freeform to hit the real Lambda.',
  );
}

export async function peerFirstPass(
  req: PeerFirstPassRequest,
  token: string,
): Promise<PeerFirstPassResponse> {
  if (useMock) {
    return mockPeerFirstPass(req);
  }
  const result = await freshApiCall(apiPath!, { event: 'peer-first-pass', ...req }, token);
  if (!result.success) {
    throw new Error(result.error || 'peer-first-pass failed');
  }
  // Lambda response shape is { body: { ...payload, logs } } — API Gateway proxy
  // unwraps body to JSON if the integration is configured correctly. Both shapes
  // handled defensively.
  return (result.data?.body ?? result.data) as PeerFirstPassResponse;
}

/**
 * FIL-499 — async producer for peer-first-pass. Returns askId immediately;
 * the prose + questions arrive via WS streaming events scoped by
 * clientRequestId (see useStreamingPeer).
 *
 * In mock mode the streaming hook never fires, so callers should prefer the
 * direct `peerFirstPass` mock for demo state. Use `isMockMode` to branch.
 */
export async function enqueuePeerFirstPass(
  req: PeerFirstPassRequest,
  token: string,
): Promise<EnqueuePeerFirstPassResponse> {
  if (useMock) {
    return mockEnqueuePeerFirstPass();
  }
  const result = await freshApiCall(apiPath!, { event: 'enqueue-peer-first-pass', ...req }, token);
  if (!result.success) {
    throw new Error(result.error || 'enqueue-peer-first-pass failed');
  }
  return (result.data?.body ?? result.data) as EnqueuePeerFirstPassResponse;
}

/**
 * Build a fresh peer slice from Neptune (focal neighborhood) + Dynamo (prior
 * CardResponses). The peer sees the writer's iteration via the slice's
 * `prior_responses` field.
 */
export async function buildSlice(
  req: BuildSliceRequest,
  token: string,
): Promise<BuildSliceResponse> {
  if (useMock) {
    return mockBuildSlice(req);
  }
  const result = await freshApiCall(apiPath!, { event: 'build-slice', ...req }, token);
  if (!result.success) {
    throw new Error(result.error || 'build-slice failed');
  }
  return (result.data?.body ?? result.data) as BuildSliceResponse;
}

/**
 * Grade a slice's data quality (NOT peer voice). Returns programmatic stats +
 * an LLM semantic grade. Fires in parallel with enqueue-peer-first-pass so it
 * doesn't block the Ask peer flow.
 */
export async function gradeSlice(
  req: GradeSliceRequest,
  token: string,
): Promise<SliceGradeResponse> {
  if (useMock) {
    return mockGradeSlice(req);
  }
  const result = await freshApiCall(apiPath!, { event: 'grade-slice', ...req }, token);
  if (!result.success) {
    throw new Error(result.error || 'grade-slice failed');
  }
  return (result.data?.body ?? result.data) as SliceGradeResponse;
}

export async function enqueueExtractionJob(
  req: EnqueueExtractionJobRequest,
  token: string,
): Promise<EnqueueExtractionJobResponse> {
  if (useMock) {
    return mockEnqueueExtractionJob(req);
  }
  const result = await freshApiCall(
    apiPath!,
    { event: 'enqueue-extraction-job', ...req },
    token,
  );
  if (!result.success) {
    throw new Error(result.error || 'enqueue-extraction-job failed');
  }
  return (result.data?.body ?? result.data) as EnqueueExtractionJobResponse;
}

// FIL-479 / A4 endpoints

export async function saveCardResponseDraft(
  req: SaveDraftRequest,
  token: string,
): Promise<SaveDraftResponse> {
  if (useMock) return mockSaveDraft(req);
  const result = await freshApiCall(apiPath!, { event: 'save-card-response-draft', ...req }, token);
  if (!result.success) throw new Error(result.error || 'save-draft failed');
  return (result.data?.body ?? result.data) as SaveDraftResponse;
}

export async function submitCardResponse(
  req: SubmitResponseRequest,
  token: string,
): Promise<SubmitResponseResponse> {
  if (useMock) return mockSubmitResponse(req);
  const result = await freshApiCall(apiPath!, { event: 'submit-card-response', ...req }, token);
  if (!result.success) throw new Error(result.error || 'submit-response failed');
  return (result.data?.body ?? result.data) as SubmitResponseResponse;
}

export async function updateQuestionStatus(
  req: UpdateQuestionStatusRequest,
  token: string,
): Promise<{ questionId: string; status: string; updated: boolean }> {
  if (useMock) return mockUpdateStatus(req);
  const result = await freshApiCall(apiPath!, { event: 'update-question-status', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-status failed');
  return result.data?.body ?? result.data;
}

export async function createWriterQuestion(
  req: CreateWriterQuestionRequest,
  token: string,
): Promise<PeerQuestion> {
  if (useMock) return mockCreateWriterQuestion(req);
  const result = await freshApiCall(apiPath!, { event: 'create-writer-question', ...req }, token);
  if (!result.success) throw new Error(result.error || 'create-writer-question failed');
  return (result.data?.body ?? result.data) as PeerQuestion;
}

// FIL-480 / A5 endpoints

export async function startPeerThread(
  req: StartThreadRequest,
  token: string,
): Promise<StartThreadResponse> {
  if (useMock) return mockStartThread(req);
  const result = await freshApiCall(apiPath!, { event: 'start-peer-thread', ...req }, token);
  if (!result.success) throw new Error(result.error || 'start-thread failed');
  return (result.data?.body ?? result.data) as StartThreadResponse;
}

export async function peerContinue(
  req: PeerContinueRequest,
  token: string,
): Promise<PeerContinueResponse> {
  if (useMock) return mockPeerContinue(req);
  const result = await freshApiCall(apiPath!, { event: 'peer-continue', ...req }, token);
  if (!result.success) throw new Error(result.error || 'peer-continue failed');
  return (result.data?.body ?? result.data) as PeerContinueResponse;
}

export async function closePeerThread(
  req: CloseThreadRequest,
  token: string,
): Promise<{ threadId: string; status: 'closed'; closedReason: string; closedAt: string }> {
  if (useMock) return mockCloseThread(req);
  const result = await freshApiCall(apiPath!, { event: 'close-peer-thread', ...req }, token);
  if (!result.success) throw new Error(result.error || 'close-thread failed');
  return (result.data?.body ?? result.data) as any;
}

/**
 * FIL-496 — list every Character/Event/Location/Relationship vertex in a project
 * plus the edges that connect them. Backs the /freeform/:storyId corkboard.
 */
export async function listProjectEntities(
  req: ListProjectEntitiesRequest,
  token: string,
): Promise<ListProjectEntitiesResponse> {
  if (useMock) return mockListProjectEntities(req);
  const result = await freshApiCall(apiPath!, { event: 'list-project-entities', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-project-entities failed');
  return (result.data?.body ?? result.data) as ListProjectEntitiesResponse;
}

/**
 * FIL-496 — persist a card's position on the corkboard. Per-user.
 * Debounce FE-side to one call per drag-end.
 */
export async function updateCardPosition(
  req: UpdateCardPositionRequest,
  token: string,
): Promise<UpdateCardPositionResponse> {
  if (useMock) return mockUpdateCardPosition(req);
  const result = await freshApiCall(apiPath!, { event: 'update-card-position', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-card-position failed');
  return (result.data?.body ?? result.data) as UpdateCardPositionResponse;
}

/**
 * FIL-496 — persist edited sub_events array onto an Event vertex. Writer
 * Duet-style scene notecards inside the EventSheet modal. FE manages
 * insertion/removal/reorder client-side and POSTs the full list.
 */
export async function updateEventSubEvents(
  req: UpdateEventSubEventsRequest,
  token: string,
): Promise<UpdateEventSubEventsResponse> {
  if (useMock) {
    return Promise.resolve({
      saved: true,
      updatedAt: new Date().toISOString(),
      count: req.subEvents.length,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'update-event-sub-events', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-event-sub-events failed');
  return (result.data?.body ?? result.data) as UpdateEventSubEventsResponse;
}

/**
 * FIL-496 — list every persisted Question for a card (any status). Used by
 * the corkboard peer panel to surface stashed/answered/dismissed questions
 * from prior peer asks.
 */
export async function listCardQuestions(
  req: ListCardQuestionsRequest,
  token: string,
): Promise<ListCardQuestionsResponse> {
  if (useMock) return Promise.resolve({ questions: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-card-questions', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-card-questions failed');
  return (result.data?.body ?? result.data) as ListCardQuestionsResponse;
}

/**
 * FIL-496 §7 — manual card creation. Returns either the new entity (200) or
 * an `exists` payload (409) when a vertex already lives at the deterministic
 * slug. The corkboard pre-flights by checking the current entities list, so
 * server-side 409 is the rare backstop (race with cascade extraction, stale
 * client state) — handled distinctly here rather than as a generic error.
 *
 * Uses axios directly (not safeApiCall) so 409 doesn't surface as a toast;
 * the caller renders an inline "open it?" CTA instead.
 */
export async function createCard(
  req: CreateCardRequest,
  token: string,
): Promise<CreateCardResponse> {
  if (useMock) return mockCreateCard(req);

  const { default: axios } = await import('axios');
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_URL}/${apiPath!}`,
      { event: 'create-card', ...req },
      {
        headers: { Authorization: await liveToken(token), 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: (s) => s === 200 || s === 409,
      },
    );
    const payload = response.data?.body ?? response.data;
    if (response.status === 409) {
      return {
        exists: true,
        cardId: payload.cardId,
        type: payload.type,
        deleted: !!payload.deleted,
      };
    }
    return { created: true, entity: payload.entity };
  } catch (err: any) {
    throw new Error(err?.response?.data?.error || err?.message || 'create-card failed');
  }
}

/**
 * FIL-496 §9 — soft-delete a Character/Event/Location card. Stamps deleted_at
 * on the entity vertex; all slice + project-reads queries filter it. Adjacent
 * Relationship vertices auto-stamp too.
 */
export async function deleteCard(
  req: DeleteCardRequest,
  token: string,
): Promise<DeleteCardResponse> {
  if (useMock) return mockDeleteCard(req);
  const result = await freshApiCall(apiPath!, { event: 'delete-card', ...req }, token);
  if (!result.success) throw new Error(result.error || 'delete-card failed');
  return (result.data?.body ?? result.data) as DeleteCardResponse;
}

/**
 * FIL-496 §9 — clear deleted_at on a card + dependent Relationships. Manual
 * undo from the Trash overlay. (Re-mentioning in prose also restores via the
 * resolver MATCH path, no explicit call needed.)
 */
export async function restoreCard(
  req: RestoreCardRequest,
  token: string,
): Promise<RestoreCardResponse> {
  if (useMock) return mockRestoreCard(req);
  const result = await freshApiCall(apiPath!, { event: 'restore-card', ...req }, token);
  if (!result.success) throw new Error(result.error || 'restore-card failed');
  return (result.data?.body ?? result.data) as RestoreCardResponse;
}

/**
 * FIL-496 §10 — inline rename. Updates working_name (+ working_title for
 * Events) on the vertex; appends old name to the aliases array so cascade
 * resolver still matches future prose referencing the old name. Vertex ID
 * stays the same.
 */
export async function updateCardName(
  req: UpdateCardNameRequest,
  token: string,
): Promise<UpdateCardNameResponse> {
  if (useMock) return mockUpdateCardName(req);
  const result = await freshApiCall(apiPath!, { event: 'update-card-name', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-card-name failed');
  return (result.data?.body ?? result.data) as UpdateCardNameResponse;
}

// ============================================
// Demo admin — clear-project (gated to demo_ prefix server-side)
// ============================================

export interface ClearProjectRequest {
  projectId: string;
}

export interface ClearProjectResponse {
  projectId: string;
  neptune: { vertices: number; error?: string };
  dynamo: Record<string, { deleted?: number; error?: string }>;
}

/**
 * Wipe Neptune + Dynamo state for a demo_ projectId. Backend-side guard
 * rejects projectIds that don't start with `demo_`. Used by the demo-tab
 * strip's "Reset" button so a fresh braindump demo starts from scratch.
 */
export async function clearProject(
  req: ClearProjectRequest,
  token: string,
): Promise<ClearProjectResponse> {
  if (useMock) {
    return Promise.resolve({
      projectId: req.projectId,
      neptune: { vertices: 0 },
      dynamo: {},
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'clear-project', ...req }, token);
  if (!result.success) throw new Error(result.error || 'clear-project failed');
  return (result.data?.body ?? result.data) as ClearProjectResponse;
}

/**
 * D'-5b — Update a card's writer-facing description. Generic across
 * Character/Event/Location/Relationship/Arc. For Event, also stamps the
 * `summary` field (extraction-schema name) so peer-slice + downstream
 * readers see the update on either property name.
 */
export async function updateCardDescription(
  req: UpdateCardDescriptionRequest,
  token: string,
): Promise<UpdateCardDescriptionResponse> {
  if (useMock) {
    return Promise.resolve({
      saved: true,
      cardId: req.cardId,
      description: req.description,
      updatedAt: new Date().toISOString(),
    });
  }
  const result = await freshApiCall(
    apiPath!,
    { event: 'update-card-description', ...req },
    token,
  );
  if (!result.success) throw new Error(result.error || 'update-card-description failed');
  return (result.data?.body ?? result.data) as UpdateCardDescriptionResponse;
}

// Script editor — per-scene screenplay text. Saved pages live on a SceneText
// vertex; an imported scene with no saved pages falls back to its source span
// sliced from the import's stored window prose (kind: 'imported').
export interface GetSceneTextResponse {
  kind: 'saved' | 'imported' | 'empty';
  html?: string;
  text?: string;
  updatedAt?: string;
  /** Ledger versions (design doc §2a): current from the last save, extracted
   *  from the last successful scene extraction. Absent on older saves. */
  ledgerCurrent?: SceneLedgerBlock[];
  ledgerExtracted?: SceneLedgerBlock[];
}
export async function getSceneText(
  req: { projectId: string; eventId: string },
  token: string,
): Promise<GetSceneTextResponse> {
  if (useMock) return Promise.resolve({ kind: 'empty' });
  const result = await freshApiCall(apiPath!, { event: 'get-scene-text', ...req }, token);
  if (!result.success) throw new Error(result.error || 'get-scene-text failed');
  return (result.data?.body ?? result.data) as GetSceneTextResponse;
}
/** Ledger block (design doc §2a): ordered per-region paragraph identity —
 *  block id (may be '' until minted), normalized content hash, text length. */
export type SceneLedgerBlock = { b: string; h: string; l: number };

/** FIL-518 slice cutover — Dynamo-only priors for a client-composed slice.
 *  Returns focal + per-character iteration history; no Neptune read. */
export async function getSlicePriors(
  req: { projectId: string; cardId: string; charIds: string[] },
  token: string,
): Promise<{ focal: { prior_responses: any[]; open_questions: any[] }; byChar: Record<string, { prior_responses: any[]; open_questions: any[] }> }> {
  const result = await freshApiCall(apiPath!, { event: 'get-slice-priors', ...req }, token);
  if (!result.success) throw new Error(result.error || 'get-slice-priors failed');
  return (result.data?.body ?? result.data) as { focal: { prior_responses: any[]; open_questions: any[] }; byChar: Record<string, { prior_responses: any[]; open_questions: any[] }> };
}

/** FIL-520 round 4 — the writer chose KEEP on a cleared scene: acknowledge
 *  the clear so the navigator's red decision state settles back to a plain
 *  unwritten outline slot. A later real save lifts both stamps. */
export async function ackSceneCleared(
  req: { projectId: string; eventId: string },
  token: string,
): Promise<{ acknowledged: true; eventId: string }> {
  if (useMock) return Promise.resolve({ acknowledged: true, eventId: req.eventId });
  const result = await freshApiCall(apiPath!, { event: 'ack-scene-cleared', ...req }, token);
  if (!result.success) throw new Error(result.error || 'ack-scene-cleared failed');
  return (result.data?.body ?? result.data) as { acknowledged: true; eventId: string };
}

export async function saveSceneText(
  req: { projectId: string; eventId: string; html: string; ledger?: SceneLedgerBlock[]; stampExtracted?: boolean },
  token: string,
): Promise<{ saved: true; eventId: string; updatedAt: string }> {
  if (useMock) {
    return Promise.resolve({ saved: true, eventId: req.eventId, updatedAt: new Date().toISOString() });
  }
  const result = await freshApiCall(apiPath!, { event: 'save-scene-text', ...req }, token);
  if (!result.success) throw new Error(result.error || 'save-scene-text failed');
  return (result.data?.body ?? result.data) as { saved: true; eventId: string; updatedAt: string };
}

/** Bulk read of every saved scene's pages — loads the whole script document
 *  in one round trip. Imported-span fallbacks are resolved client-side from
 *  list-braindumps prose. */
export async function listSceneTexts(
  req: { projectId: string },
  token: string,
): Promise<{ projectId: string; sceneTexts: Array<{ eventId: string; html: string; updatedAt: string; stale?: boolean }> }> {
  if (useMock) return Promise.resolve({ projectId: req.projectId, sceneTexts: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-scene-texts', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-scene-texts failed');
  return (result.data?.body ?? result.data) as { projectId: string; sceneTexts: Array<{ eventId: string; html: string; updatedAt: string; stale?: boolean }> };
}

/** Scene-exit extraction trigger — async (202 + messageId); the worker gates,
 *  hash-dedups, extracts the pages' implications anchored at the focal scene. */
export async function enqueueSceneExtraction(
  req: {
    projectId: string; eventId: string; userId: string;
    /** Omitted on fromStorage catch-up jobs (the worker reads S3 instead). */
    sceneText?: string; ledger?: SceneLedgerBlock[];
    /** Step 7 catch-up: extract from the scene's STORED pages (peer stale-gate,
     *  which runs without a loaded document). */
    fromStorage?: boolean;
    /** Highlight-extract: the writer's selected passage as an attention hint. */
    attentionHint?: string;
  },
  token: string,
): Promise<{ queued?: boolean; skipped?: boolean; messageId?: string; eventId?: string }> {
  if (useMock) return Promise.resolve({ queued: true, eventId: req.eventId });
  const result = await freshApiCall(apiPath!, { event: 'enqueue-scene-extraction', ...req }, token);
  if (!result.success) throw new Error(result.error || 'enqueue-scene-extraction failed');
  return (result.data?.body ?? result.data) as { queued?: boolean; skipped?: boolean; messageId?: string; eventId?: string };
}

// ============================================
// Step 8 (FIL-528) — screenplay peer notes on a scene.
// ============================================

export type NoteTier = 'concept' | 'character' | 'structure' | 'scene' | 'dialogue';
export interface ScreenplayNote {
  id: string;
  /** The scene (Event vid) this note is anchored to. Present on
   *  list-project-notes; empty from the single-scene request path. */
  event_id?: string;
  anchor: string;
  tier: NoteTier;
  intent_gap: boolean;
  diagnosis: string;
  state: string;
  created_at: string;
  /** Who settled a non-open note: 'writer' | 'auto' (the §5 re-eval pass). */
  settled_by?: string;
  /** The auto-resolve rationale (present when settled_by === 'auto'). */
  resolve_note?: string;
  /** JSON array of {note, at, pages_sha} progression entries; note stays open. */
  progress_log?: string;
  state_changed_at?: string;
  /** Range anchor: verbatim LAST line of a span (anchor carries the first). */
  anchor_end?: string;
  /** 'scene' (Mode A) | 'sequence' (Mode B) | 'draft' (Mode C). */
  mode?: string;
  /** The Sequence vid a sequence-mode note came from. */
  seq_id?: string;
  /** Deterministic anchor identity: the paragraph block ids at write time. */
  anchor_block_id?: string;
  anchor_end_block_id?: string;
  /** Mode B/C: which member scene the anchor lives in ("SC 3"). */
  anchor_scene?: string;
  /** Mode C: how many of the three blind readers gave this note ("2" | "3"). */
  votes?: string;
  /** Mode C: JSON array of implicated SC numbers / Event vids. */
  implicated_scenes?: string | number[];
  implicated_event_ids?: string | string[];
}

/** Mode C — a scene multiple blind readers implicated (the producer heatmap). */
export interface DraftHotspot {
  sc: number;
  mentions: number;
  event_id: string;
  title: string;
}

/** Mode C — the draft read: 3 blind spine reads + collation; commits 2-of-3
 *  consensus notes (unanchored) + hotspots. Ground with groundDraftNotes. */
export async function requestDraftNotes(
  req: { projectId: string },
  token: string,
): Promise<{ summary: string; clean_bill?: boolean; notes: ScreenplayNote[]; hotspots?: DraftHotspot[]; skipped?: boolean; reason?: string; latencyMs?: number }> {
  if (useMock) return Promise.resolve({ summary: '', notes: [] });
  const result = await freshApiCall(apiPath!, { event: 'draft-notes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'draft-notes failed');
  return (result.data?.body ?? result.data) as { summary: string; clean_bill?: boolean; notes: ScreenplayNote[]; hotspots?: DraftHotspot[]; skipped?: boolean; reason?: string; latencyMs?: number };
}

/** Mode C — anchor the committed draft notes to verbatim lines in the
 *  implicated scenes' pages; pages-disproven notes come back retired. */
export async function groundDraftNotes(
  req: { projectId: string; noteIds?: string[] },
  token: string,
): Promise<{ notes: ScreenplayNote[]; grounded?: number; disproven?: number; unanchorable?: number; skipped?: boolean }> {
  if (useMock) return Promise.resolve({ notes: [] });
  const result = await freshApiCall(apiPath!, { event: 'draft-notes-ground', ...req }, token);
  if (!result.success) throw new Error(result.error || 'draft-notes-ground failed');
  return (result.data?.body ?? result.data) as { notes: ScreenplayNote[]; grounded?: number; disproven?: number; unanchorable?: number; skipped?: boolean };
}

/** Request the screenplay peer's coverage of one scene: reads the scene's pages
 *  + its graph intent envelope, returns anchored execution notes (also
 *  persisted as Note vertices on the Event). */
export async function requestScreenplayNotes(
  req: { projectId: string; cardId: string; focalId: string; focalType?: 'event' | 'sequence' },
  token: string,
): Promise<{ summary: string; notes: ScreenplayNote[]; skipped?: boolean; reason?: string; latencyMs?: number }> {
  if (useMock) return Promise.resolve({ summary: '', notes: [] });
  const result = await freshApiCall(apiPath!, { event: 'screenplay-notes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'screenplay-notes failed');
  return (result.data?.body ?? result.data) as { summary: string; notes: ScreenplayNote[]; skipped?: boolean; reason?: string; latencyMs?: number };
}

/** The open (+ optionally resolved) peer notes anchored to a scene. */
export async function listSceneNotes(
  req: { projectId: string; eventId: string; includeResolved?: boolean },
  token: string,
): Promise<{ notes: ScreenplayNote[] }> {
  if (useMock) return Promise.resolve({ notes: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-scene-notes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-scene-notes failed');
  return (result.data?.body ?? result.data) as { notes: ScreenplayNote[] };
}

/** EVERY peer note across the story in one read (each carries event_id), for
 *  the document-wide Pins + drawer + Passes surface. */
export async function listProjectNotes(
  req: { projectId: string; includeResolved?: boolean },
  token: string,
): Promise<{ notes: ScreenplayNote[] }> {
  if (useMock) return Promise.resolve({ notes: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-project-notes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-project-notes failed');
  return (result.data?.body ?? result.data) as { notes: ScreenplayNote[] };
}

/** The writer's declared resolution of a note (the manual path complementing
 *  auto-resolve). Keep-bias: stamps state, never deletes; recoverable. */
export async function setNoteState(
  req: { projectId: string; noteId: string; state: 'open' | 'resolved' | 'dismissed' | 'progressed' },
  token: string,
): Promise<{ note: ScreenplayNote }> {
  if (useMock) return Promise.resolve({ note: { id: req.noteId, anchor: '', tier: 'scene' as NoteTier, intent_gap: false, diagnosis: '', state: req.state, created_at: '' } });
  const result = await freshApiCall(apiPath!, { event: 'set-note-state', ...req }, token);
  if (!result.success) throw new Error(result.error || 'set-note-state failed');
  return (result.data?.body ?? result.data) as { note: ScreenplayNote };
}

/** FIL-528 §6 — one turn of a note's discussion thread. */
export interface NoteThreadTurn {
  turnId?: string;
  role: 'writer' | 'peer' | string;
  content: string;
  createdAt?: string;
}

/** Send a writer message on a note's thread; the peer replies in the note's
 *  voice with the CURRENT pages + the note's trajectory as context. Creates
 *  the thread on first message (one persistent thread per note). */
export async function noteDiscuss(
  req: { projectId: string; noteId: string; message: string },
  token: string,
): Promise<{ threadId: string; writerTurn: NoteThreadTurn; peerTurn: NoteThreadTurn; turnCount: number }> {
  if (useMock) return Promise.resolve({ threadId: `notethread_${req.noteId}`, writerTurn: { role: 'writer', content: req.message }, peerTurn: { role: 'peer', content: 'Mock peer reply.' }, turnCount: 2 });
  const result = await freshApiCall(apiPath!, { event: 'note-discuss', ...req }, token);
  if (!result.success) throw new Error(result.error || 'note-discuss failed');
  return (result.data?.body ?? result.data) as { threadId: string; writerTurn: NoteThreadTurn; peerTurn: NoteThreadTurn; turnCount: number };
}

/** Load a note's thread for restore (empty turns when never discussed). */
export async function getNoteThread(
  req: { projectId: string; noteId: string },
  token: string,
): Promise<{ threadId: string | null; turns: NoteThreadTurn[]; status: string }> {
  if (useMock) return Promise.resolve({ threadId: null, turns: [], status: 'none' });
  const result = await freshApiCall(apiPath!, { event: 'get-note-thread', ...req }, token);
  if (!result.success) throw new Error(result.error || 'get-note-thread failed');
  return (result.data?.body ?? result.data) as { threadId: string | null; turns: NoteThreadTurn[]; status: string };
}

/** Step 7 — is a scene's graph behind its stored pages? Ledger diff on the
 *  backend (current vs extracted block versions), timestamp fallback. The
 *  peer's stale-gate polls this; board views never gate on it. */
export async function checkSceneStaleness(
  req: { projectId: string; eventId: string },
  token: string,
): Promise<{ eventId: string; stale: boolean; reason: string; changedChars?: number }> {
  if (useMock) return Promise.resolve({ eventId: req.eventId, stale: false, reason: 'mock' });
  const result = await freshApiCall(apiPath!, { event: 'check-scene-staleness', ...req }, token);
  if (!result.success) throw new Error(result.error || 'check-scene-staleness failed');
  return (result.data?.body ?? result.data) as { eventId: string; stale: boolean; reason: string; changedChars?: number };
}

// R2 — edit a reified Relationship's `kind` label.
export interface UpdateRelationshipKindRequest {
  cardId: string;
  projectId: string;
  kind: string;
}
export async function updateRelationshipKind(
  req: UpdateRelationshipKindRequest,
  token: string,
): Promise<{ saved: true; cardId: string; kind: string; updatedAt: string }> {
  if (useMock) {
    return Promise.resolve({ saved: true, cardId: req.cardId, kind: req.kind, updatedAt: new Date().toISOString() });
  }
  const result = await freshApiCall(
    apiPath!,
    { event: 'update-relationship-kind', ...req },
    token,
  );
  if (!result.success) throw new Error(result.error || 'update-relationship-kind failed');
  return (result.data?.body ?? result.data) as { saved: true; cardId: string; kind: string; updatedAt: string };
}

// R3/R4 — structural Character→Character tie editing on the canvas.
export async function setStructuralEdge(
  req: { projectId: string; fromId: string; toId: string; predicate: string; evidenceQuote?: string },
  token: string,
): Promise<{ saved: true; fromId: string; toId: string; predicate: string; label: string }> {
  if (useMock) return Promise.resolve({ saved: true, fromId: req.fromId, toId: req.toId, predicate: req.predicate, label: req.predicate.toUpperCase() });
  const result = await freshApiCall(apiPath!, { event: 'set-structural-edge', ...req }, token);
  if (!result.success) throw new Error(result.error || 'set-structural-edge failed');
  return (result.data?.body ?? result.data) as { saved: true; fromId: string; toId: string; predicate: string; label: string };
}

export async function deleteStructuralEdge(
  req: { projectId: string; fromId: string; toId: string; predicate?: string },
  token: string,
): Promise<{ deleted: number; fromId: string; toId: string }> {
  if (useMock) return Promise.resolve({ deleted: 1, fromId: req.fromId, toId: req.toId });
  const result = await freshApiCall(apiPath!, { event: 'delete-structural-edge', ...req }, token);
  if (!result.success) throw new Error(result.error || 'delete-structural-edge failed');
  return (result.data?.body ?? result.data) as { deleted: number; fromId: string; toId: string };
}

export async function promoteStructuralToRelationship(
  req: { projectId: string; fromId: string; toId: string; kind?: string; description?: string },
  token: string,
): Promise<{ created: true; relationshipId: string; character_a: string; character_b: string; kind: string }> {
  if (useMock) return Promise.resolve({ created: true, relationshipId: 'rel_mock', character_a: '', character_b: '', kind: req.kind ?? 'tie' });
  const result = await freshApiCall(apiPath!, { event: 'promote-structural-to-relationship', ...req }, token);
  if (!result.success) throw new Error(result.error || 'promote-structural-to-relationship failed');
  return (result.data?.body ?? result.data) as { created: true; relationshipId: string; character_a: string; character_b: string; kind: string };
}

/**
 * FIL-496 §8 — toggle an Event's narrative_status (on_screen / backstory /
 * offstage). D'-10: flips to 'backstory' on an Event that carries EVOKES
 * edges with high-leverage transitions throw SupersessionRequiredError —
 * caller catches and routes to the resolve modal.
 */
export async function updateCardNarrativeStatus(
  req: UpdateCardNarrativeStatusRequest,
  token: string,
): Promise<UpdateCardNarrativeStatusResponse> {
  if (useMock) {
    return Promise.resolve({
      saved: true,
      cardId: req.cardId,
      narrativeStatus: req.narrativeStatus,
      updatedAt: new Date().toISOString(),
    });
  }
  // axios path so we can intercept the 409 supersession case.
  const { default: axios } = await import('axios');
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_URL}/${apiPath!}`,
      { event: 'update-card-narrative-status', ...req },
      {
        headers: { Authorization: await liveToken(token), 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: (s) => s === 200 || s === 409,
      },
    );
    const payload = response.data?.body ?? response.data;
    if (response.status === 409 && payload?.error === 'supersession_required') {
      throw new SupersessionRequiredError(payload as SupersessionRequiredResponse);
    }
    return payload as UpdateCardNarrativeStatusResponse;
  } catch (err: any) {
    if (err instanceof SupersessionRequiredError) throw err;
    throw new Error(err?.response?.data?.error || err?.message || 'update-card-narrative-status failed');
  }
}

/**
 * D'-10 — commit a narrative_status flip after the writer chose how to
 * resolve each Q7-violating EVOKES edge. Backend applies the resolutions
 * (demote or remove) then writes the narrative_status change.
 */
export async function resolveNarrativeStatusFlip(
  req: ResolveNarrativeStatusFlipRequest,
  token: string,
): Promise<ResolveNarrativeStatusFlipResponse> {
  if (useMock) {
    return Promise.resolve({
      saved: true,
      cardId: req.cardId,
      narrativeStatus: req.narrativeStatus,
      resolved: req.resolutions.length,
      updatedAt: new Date().toISOString(),
    });
  }
  const result = await freshApiCall(
    apiPath!,
    { event: 'resolve-narrative-status-flip', ...req },
    token,
  );
  if (!result.success) throw new Error(result.error || 'resolve-narrative-status-flip failed');
  return (result.data?.body ?? result.data) as ResolveNarrativeStatusFlipResponse;
}

// ============================================
// FIL-504 / D' — Arc CRUD wrappers
// ============================================

/**
 * D'-1 — Writer-authored top-down arc creation. Returns either the new
 * entity (200) or an `exists` payload (409) when an Arc with the same slug
 * exists. Uses axios directly so 409 doesn't trigger a generic error toast;
 * the caller renders an inline "open it?" or "restore?" CTA.
 */
export async function createArc(
  req: CreateArcRequest,
  token: string,
): Promise<CreateArcResponse> {
  if (useMock) {
    return Promise.resolve({
      created: true,
      entity: {
        id: `arc_${slugForMock(req.workingName)}_${slugForMock(req.projectId)}`,
        type: 'arc',
        working_name: req.workingName,
        kind: req.kind,
        description: req.description ?? '',
        evidence_quote: req.evidenceQuote ?? '',
        open_dimensions: req.openDimensions ?? [],
        aliases: [],
        project_id: req.projectId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }

  const { default: axios } = await import('axios');
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_URL}/${apiPath!}`,
      { event: 'create-arc', ...req },
      {
        headers: { Authorization: await liveToken(token), 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: (s) => s === 200 || s === 409,
      },
    );
    const payload = response.data?.body ?? response.data;
    if (response.status === 409) {
      return {
        exists: true,
        cardId: payload.cardId,
        type: payload.type,
        deleted: !!payload.deleted,
      };
    }
    return { created: true, entity: payload.entity };
  } catch (err: any) {
    throw new Error(err?.response?.data?.error || err?.message || 'create-arc failed');
  }
}

/**
 * D'-4 — Bottom-up arc creation: writer multi-selects events on canvas,
 * "Create arc from these." Atomic write of Arc + N EVOKES edges; backstory
 * events default to transition='touches', rendered/offstage start unset.
 */
export async function createArcFromEvents(
  req: CreateArcFromEventsRequest,
  token: string,
): Promise<CreateArcFromEventsResponse> {
  if (useMock) {
    return Promise.resolve({
      created: true,
      entity: {
        id: `arc_${slugForMock(req.workingName)}_${slugForMock(req.projectId)}`,
        type: 'arc',
        working_name: req.workingName,
        kind: req.kind,
        description: req.description ?? '',
        evidence_quote: req.evidenceQuote ?? '',
        open_dimensions: req.openDimensions ?? [],
        aliases: [],
        project_id: req.projectId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      evokesEdgesCreated: req.eventIds.length,
      eventDetails: req.eventIds.map((id) => ({
        event_id: id,
        event_working_title: '',
        narrative_status: 'on_screen',
        transition: null,
      })),
    });
  }
  const result = await freshApiCall(
    apiPath!,
    { event: 'create-arc-from-events', ...req },
    token,
  );
  if (!result.success) throw new Error(result.error || 'create-arc-from-events failed');
  return (result.data?.body ?? result.data) as CreateArcFromEventsResponse;
}

/**
 * D'-1 — Update arc identity fields. Rename appends old name to aliases
 * (vertex ID never moves). Status / RAISED_IN / RESOLVED_IN are derived
 * from EVOKES transitions, not stored — so no status field accepted here.
 */
export async function updateArc(
  req: UpdateArcRequest,
  token: string,
): Promise<UpdateArcResponse> {
  if (useMock) {
    return Promise.resolve({
      updated: true,
      arcId: req.arcId,
      workingName: req.workingName,
      kind: req.kind,
      description: req.description,
      evidenceQuote: req.evidenceQuote,
      openDimensions: req.openDimensions,
      color: req.color,
      updatedAt: new Date().toISOString(),
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'update-arc', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-arc failed');
  return (result.data?.body ?? result.data) as UpdateArcResponse;
}

/** Set a Sequence's writer-chosen container color (6-digit hex, or '' to clear). */
export async function setSequenceColor(
  req: { sequenceId: string; projectId: string; color: string },
  token: string,
): Promise<{ sequenceId: string; color: string }> {
  if (useMock) return Promise.resolve({ sequenceId: req.sequenceId, color: req.color });
  const result = await freshApiCall(apiPath!, { event: 'set-sequence-color', ...req }, token);
  if (!result.success) throw new Error(result.error || 'set-sequence-color failed');
  return (result.data?.body ?? result.data) as { sequenceId: string; color: string };
}

/**
 * D'-1 — Soft-delete an Arc. Adjacent EVOKES + Arc-INVOLVES edges stay in
 * place; reads filter the deleted_at flag.
 */
export async function deleteArc(
  req: DeleteArcRequest,
  token: string,
): Promise<DeleteArcResponse> {
  if (useMock) {
    return Promise.resolve({
      deleted: true,
      arcId: req.arcId,
      deletedAt: new Date().toISOString(),
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'delete-arc', ...req }, token);
  if (!result.success) throw new Error(result.error || 'delete-arc failed');
  return (result.data?.body ?? result.data) as DeleteArcResponse;
}

/**
 * D'-1 — Clear deleted_at on an Arc. Adjacent edges re-surface (read-path
 * filters were the only thing hiding them).
 */
export async function restoreArc(
  req: RestoreArcRequest,
  token: string,
): Promise<RestoreArcResponse> {
  if (useMock) {
    return Promise.resolve({ restored: true, arcId: req.arcId });
  }
  const result = await freshApiCall(apiPath!, { event: 'restore-arc', ...req }, token);
  if (!result.success) throw new Error(result.error || 'restore-arc failed');
  return (result.data?.body ?? result.data) as RestoreArcResponse;
}

// ============================================
// FIL-504 / D'-2 + D'-7 — EVOKES + Arc-INVOLVES tagging
// ============================================

/** Backstory events permit only 'touches' on EVOKES (Q7 rule). FE uses this
 *  set to gray out high-leverage transitions in the picker so the backend
 *  400 is never reached on the happy path. Mirrors
 *  ALLOWED_TRANSITIONS_BY_NARRATIVE_STATUS in lib/arc-tagging.mjs. */
export const EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS: Record<string, EvokesTransition[]> = {
  on_screen: [...EVOKES_TRANSITIONS],
  offstage: [...EVOKES_TRANSITIONS],
  backstory: ['touches'],
};

export interface TagEventEvokesRequest {
  eventId: string;
  arcId: string;
  projectId: string;
  /** Free-text. Omit / empty preserves any prior value (upsert semantics).
   *  To clear, untag + re-tag. */
  stateAtEvent?: string;
  /** Optional. Empty / null preserves prior. */
  transition?: EvokesTransition | '';
  evidenceQuote?: string;
}

export interface TagEventEvokesResponse {
  tagged: true;
  eventId: string;
  arcId: string;
  transition: EvokesTransition | null;
  stateAtEvent: string | null;
  evidenceQuote: string | null;
  wasNew: boolean;
  updatedAt: string;
}

export interface UntagEventEvokesRequest {
  eventId: string;
  arcId: string;
  projectId: string;
}

export interface UntagEventEvokesResponse {
  untagged: true;
  eventId: string;
  arcId: string;
  dropped: number;
}

export interface TagArcInvolvesCharacterRequest {
  arcId: string;
  characterId: string;
  projectId: string;
}

export interface TagArcInvolvesCharacterResponse {
  tagged: true;
  arcId: string;
  characterId: string;
}

export interface UntagArcInvolvesCharacterRequest {
  arcId: string;
  characterId: string;
  projectId: string;
}

export interface UntagArcInvolvesCharacterResponse {
  untagged: true;
  arcId: string;
  characterId: string;
  dropped: number;
}

/**
 * D'-2 — Create or update an EVOKES edge: Event → Arc. Upsert: omitted
 * fields preserve the existing edge's values. The narrative_status ×
 * transition rule is enforced server-side; FE should gray out disallowed
 * transitions per EVOKES_TRANSITIONS_BY_NARRATIVE_STATUS before submit.
 */
export async function tagEventEvokes(
  req: TagEventEvokesRequest,
  token: string,
): Promise<TagEventEvokesResponse> {
  if (useMock) {
    return Promise.resolve({
      tagged: true,
      eventId: req.eventId,
      arcId: req.arcId,
      transition: req.transition && req.transition.length > 0
        ? (req.transition as EvokesTransition)
        : null,
      stateAtEvent: req.stateAtEvent ?? null,
      evidenceQuote: req.evidenceQuote ?? null,
      wasNew: true,
      updatedAt: new Date().toISOString(),
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'tag-event-evokes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-event-evokes failed');
  return (result.data?.body ?? result.data) as TagEventEvokesResponse;
}

/** D'-2 — Drop an EVOKES edge. 404 surfaces as a thrown error. */
export async function untagEventEvokes(
  req: UntagEventEvokesRequest,
  token: string,
): Promise<UntagEventEvokesResponse> {
  if (useMock) {
    return Promise.resolve({
      untagged: true,
      eventId: req.eventId,
      arcId: req.arcId,
      dropped: 1,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'untag-event-evokes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-event-evokes failed');
  return (result.data?.body ?? result.data) as UntagEventEvokesResponse;
}

/** D'-2 — Mark a Character as INVOLVED on an Arc. No edge properties. */
export async function tagArcInvolvesCharacter(
  req: TagArcInvolvesCharacterRequest,
  token: string,
): Promise<TagArcInvolvesCharacterResponse> {
  if (useMock) {
    return Promise.resolve({
      tagged: true,
      arcId: req.arcId,
      characterId: req.characterId,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'tag-arc-involves-character', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-arc-involves-character failed');
  return (result.data?.body ?? result.data) as TagArcInvolvesCharacterResponse;
}

/** D'-2 — Drop an Arc-INVOLVES-Character edge. */
export async function untagArcInvolvesCharacter(
  req: UntagArcInvolvesCharacterRequest,
  token: string,
): Promise<UntagArcInvolvesCharacterResponse> {
  if (useMock) {
    return Promise.resolve({
      untagged: true,
      arcId: req.arcId,
      characterId: req.characterId,
      dropped: 1,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'untag-arc-involves-character', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-arc-involves-character failed');
  return (result.data?.body ?? result.data) as UntagArcInvolvesCharacterResponse;
}

// ============================================
// Sequence containers (event-granularity fix)
// ============================================

export interface CreateSequenceRequest {
  projectId: string;
  userId: string;
  workingName: string;
  description?: string;
  position?: { x: number; y: number };
  memberEventIds?: string[];
}

export type CreateSequenceResponse =
  | { created: true; entity: ProjectEntity }
  | { exists: true; cardId: string; type: string; deleted: boolean };

export interface TagSequenceContainsRequest {
  sequenceId: string;
  eventId: string;
  projectId: string;
}
export interface TagSequenceContainsResponse {
  tagged: true;
  sequenceId: string;
  eventId: string;
}
export interface UntagSequenceContainsRequest {
  sequenceId: string;
  eventId: string;
  projectId: string;
}
export interface UntagSequenceContainsResponse {
  untagged: true;
  sequenceId: string;
  eventId: string;
  dropped: number;
}

/** Create a :Sequence container card. 409 on slug collision (mirror create-arc). */
export async function createSequence(
  req: CreateSequenceRequest,
  token: string,
): Promise<CreateSequenceResponse> {
  if (useMock) {
    return Promise.resolve({
      created: true,
      entity: {
        id: `seq_${slugForMock(req.workingName)}_${slugForMock(req.projectId)}`,
        type: 'sequence',
        working_name: req.workingName,
        working_title: req.workingName,
        summary: req.description ?? '',
        description: req.description ?? '',
        open_dimensions: [],
        project_id: req.projectId,
        created_at: new Date().toISOString(),
      } as ProjectEntity,
    });
  }
  const { default: axios } = await import('axios');
  try {
    const response = await axios.post(
      `${process.env.REACT_APP_URL}/${apiPath!}`,
      { event: 'create-sequence', ...req },
      {
        headers: { Authorization: await liveToken(token), 'Content-Type': 'application/json' },
        timeout: 30000,
        validateStatus: (s) => s === 200 || s === 409,
      },
    );
    const payload = response.data?.body ?? response.data;
    if (response.status === 409) {
      return { exists: true, cardId: payload.cardId, type: payload.type, deleted: !!payload.deleted };
    }
    return { created: true, entity: payload.entity };
  } catch (err: any) {
    throw new Error(err?.response?.data?.error || err?.message || 'create-sequence failed');
  }
}

/** Add an Event to a Sequence (CONTAINS; disjoint membership enforced server-side). */
export async function tagSequenceContains(
  req: TagSequenceContainsRequest,
  token: string,
): Promise<TagSequenceContainsResponse> {
  if (useMock) {
    return Promise.resolve({ tagged: true, sequenceId: req.sequenceId, eventId: req.eventId });
  }
  const result = await freshApiCall(apiPath!, { event: 'tag-sequence-contains', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-sequence-contains failed');
  return (result.data?.body ?? result.data) as TagSequenceContainsResponse;
}

/** Remove an Event from a Sequence. */
export async function untagSequenceContains(
  req: UntagSequenceContainsRequest,
  token: string,
): Promise<UntagSequenceContainsResponse> {
  if (useMock) {
    return Promise.resolve({ untagged: true, sequenceId: req.sequenceId, eventId: req.eventId, dropped: 1 });
  }
  const result = await freshApiCall(apiPath!, { event: 'untag-sequence-contains', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-sequence-contains failed');
  return (result.data?.body ?? result.data) as UntagSequenceContainsResponse;
}

// ============================================
// PRECEDES tagging — retroactive throughline rewiring.
// ============================================

export interface TagEventPrecedesRequest {
  fromEventId: string;
  toEventId: string;
  projectId: string;
}
export interface TagEventPrecedesResponse {
  tagged: true;
  fromEventId: string;
  toEventId: string;
  /** True if the backend auto-dropped a reverse PRECEDES edge to avoid
   *  a 2-cycle. The FE should mirror in its optimistic state. */
  replacedReverse?: boolean;
}
export interface UntagEventPrecedesRequest {
  fromEventId: string;
  toEventId: string;
  projectId: string;
}
export interface UntagEventPrecedesResponse {
  untagged: true;
  fromEventId: string;
  toEventId: string;
  dropped: number;
}

/** Tag a PRECEDES edge fromEventId → toEventId. Idempotent. */
export async function tagEventPrecedes(
  req: TagEventPrecedesRequest,
  token: string,
): Promise<TagEventPrecedesResponse> {
  if (useMock) {
    return Promise.resolve({
      tagged: true,
      fromEventId: req.fromEventId,
      toEventId: req.toEventId,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'tag-event-precedes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-event-precedes failed');
  return (result.data?.body ?? result.data) as TagEventPrecedesResponse;
}

/** Untag a PRECEDES edge fromEventId → toEventId. */
export async function untagEventPrecedes(
  req: UntagEventPrecedesRequest,
  token: string,
): Promise<UntagEventPrecedesResponse> {
  if (useMock) {
    return Promise.resolve({
      untagged: true,
      fromEventId: req.fromEventId,
      toEventId: req.toEventId,
      dropped: 1,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'untag-event-precedes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-event-precedes failed');
  return (result.data?.body ?? result.data) as UntagEventPrecedesResponse;
}

// ============================================
// CAUSES tagging — D'-11. Causal edges between Events/Arcs (4 combos).
// Endpoints are generic vertex ids (Event or Arc), so the request uses
// fromId/toId rather than the precedes-style fromEventId/toEventId.
// ============================================

export interface TagCausesRequest {
  fromId: string;
  toId: string;
  projectId: string;
  evidenceQuote?: string;
}
export interface TagCausesResponse {
  tagged: true;
  fromId: string;
  toId: string;
}
export interface UntagCausesRequest {
  fromId: string;
  toId: string;
  projectId: string;
}
export interface UntagCausesResponse {
  untagged: true;
  fromId: string;
  toId: string;
  dropped: number;
}

/** Tag a CAUSES edge fromId → toId (Event|Arc → Event|Arc). Idempotent. */
export async function tagCauses(
  req: TagCausesRequest,
  token: string,
): Promise<TagCausesResponse> {
  if (useMock) {
    return Promise.resolve({ tagged: true, fromId: req.fromId, toId: req.toId });
  }
  const result = await freshApiCall(apiPath!, { event: 'tag-causes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-causes failed');
  return (result.data?.body ?? result.data) as TagCausesResponse;
}

/** Untag a CAUSES edge fromId → toId. */
export async function untagCauses(
  req: UntagCausesRequest,
  token: string,
): Promise<UntagCausesResponse> {
  if (useMock) {
    return Promise.resolve({ untagged: true, fromId: req.fromId, toId: req.toId, dropped: 1 });
  }
  const result = await freshApiCall(apiPath!, { event: 'untag-causes', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-causes failed');
  return (result.data?.body ?? result.data) as UntagCausesResponse;
}

// ============================================
// Information editing — Event sheet "Established here" tile.
// ============================================

export interface CreateInformationRequest {
  projectId: string;
  eventId: string;
  summary: string;
  evidenceQuote?: string;
}
export interface CreateInformationResponse {
  created: true;
  id: string;
  summary: string;
}
export interface UpdateInformationRequest {
  projectId: string;
  infoId: string;
  summary: string;
  evidenceQuote?: string;
}
export interface UpdateInformationResponse {
  updated: true;
  id: string;
  summary: string;
}
export interface UnlinkInformationRequest {
  projectId: string;
  infoId: string;
  eventId: string;
}
export interface UnlinkInformationResponse {
  unlinked: true;
  infoId: string;
  eventId: string;
  dropped: number;
}

/** Add a fact established in a scene (Information vertex + ESTABLISHED_IN edge). */
export async function createInformation(
  req: CreateInformationRequest,
  token: string,
): Promise<CreateInformationResponse> {
  if (useMock) {
    return Promise.resolve({ created: true, id: `info_mock_${Date.now()}`, summary: req.summary });
  }
  const result = await freshApiCall(apiPath!, { event: 'create-information', ...req }, token);
  if (!result.success) throw new Error(result.error || 'create-information failed');
  return (result.data?.body ?? result.data) as CreateInformationResponse;
}

/** Edit a fact's wording in place (by vertex id). */
export async function updateInformation(
  req: UpdateInformationRequest,
  token: string,
): Promise<UpdateInformationResponse> {
  if (useMock) {
    return Promise.resolve({ updated: true, id: req.infoId, summary: req.summary });
  }
  const result = await freshApiCall(apiPath!, { event: 'update-information', ...req }, token);
  if (!result.success) throw new Error(result.error || 'update-information failed');
  return (result.data?.body ?? result.data) as UpdateInformationResponse;
}

/** Remove a fact from a scene (drop the ESTABLISHED_IN edge; vertex persists). */
export async function unlinkInformation(
  req: UnlinkInformationRequest,
  token: string,
): Promise<UnlinkInformationResponse> {
  if (useMock) {
    return Promise.resolve({ unlinked: true, infoId: req.infoId, eventId: req.eventId, dropped: 1 });
  }
  const result = await freshApiCall(apiPath!, { event: 'unlink-information', ...req }, token);
  if (!result.success) throw new Error(result.error || 'unlink-information failed');
  return (result.data?.body ?? result.data) as UnlinkInformationResponse;
}

export interface BraindumpLogEntry {
  id: string;
  braindumpId: string;
  prose: string;
  createdAt: string;
  /** Continuation stamp (script editor §2c): present on scratch generations
   *  whose opening extends an existing scene. */
  continuationScene?: string;
  continuationCut?: number;
  continuationBlocks?: number;
}
export interface ListBraindumpsResponse { projectId: string; braindumps: BraindumpLogEntry[]; }

/** Every extraction-source vertex for a project (braindumps + card-response
 *  sources), newest first — powers the panel's Braindumps log. */
export async function listBraindumps(
  req: { projectId: string },
  token: string,
): Promise<ListBraindumpsResponse> {
  if (useMock) return Promise.resolve({ projectId: req.projectId, braindumps: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-braindumps', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-braindumps failed');
  return (result.data?.body ?? result.data) as ListBraindumpsResponse;
}

export interface DeleteInformationRequest { projectId: string; infoId: string; }
export interface DeleteInformationResponse { deleted: true; infoId: string; }

/** Hard-delete a fact globally (panel tile delete): the Information vertex +
 *  ALL its edges (ESTABLISHED_IN + KNOWS/DOESNT_KNOW). Unlike unlinkInformation
 *  this removes facts even when characters know them, and clears orphans. */
export async function deleteInformation(
  req: DeleteInformationRequest,
  token: string,
): Promise<DeleteInformationResponse> {
  if (useMock) return Promise.resolve({ deleted: true, infoId: req.infoId });
  const result = await freshApiCall(apiPath!, { event: 'delete-information', ...req }, token);
  if (!result.success) throw new Error(result.error || 'delete-information failed');
  return (result.data?.body ?? result.data) as DeleteInformationResponse;
}

export interface SetInformationIronyRequest { projectId: string; infoId: string; hidden: boolean; }
export interface SetInformationIronyResponse { set: true; infoId: string; hidden: boolean; }

/** Flag a fact as flat / no-ironic-potential (hide from the Knowledge tile) or
 *  clear the flag. No edges are touched; reversible. */
export async function setInformationIrony(
  req: SetInformationIronyRequest,
  token: string,
): Promise<SetInformationIronyResponse> {
  if (useMock) return Promise.resolve({ set: true, infoId: req.infoId, hidden: req.hidden });
  const result = await freshApiCall(apiPath!, { event: 'set-information-irony', ...req }, token);
  if (!result.success) throw new Error(result.error || 'set-information-irony failed');
  return (result.data?.body ?? result.data) as SetInformationIronyResponse;
}

// ============================================
// Event edge editing — Cast (INVOLVES) + Location (OCCURS_IN) tiles.
// ============================================

export interface TagEventInvolvesRequest { eventId: string; characterId: string; projectId: string; }
export interface TagEventOccursInRequest { eventId: string; locationId: string; projectId: string; }
export interface EventLinkResponse { tagged?: true; untagged?: true; eventId: string; targetId: string; dropped?: number; }

/** Tag an INVOLVES edge Event → Character. Idempotent. */
export async function tagEventInvolvesCharacter(req: TagEventInvolvesRequest, token: string): Promise<EventLinkResponse> {
  if (useMock) return Promise.resolve({ tagged: true, eventId: req.eventId, targetId: req.characterId });
  const result = await freshApiCall(apiPath!, { event: 'tag-event-involves-character', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-event-involves-character failed');
  return (result.data?.body ?? result.data) as EventLinkResponse;
}

/** Drop an INVOLVES edge Event → Character. */
export async function untagEventInvolvesCharacter(req: TagEventInvolvesRequest, token: string): Promise<EventLinkResponse> {
  if (useMock) return Promise.resolve({ untagged: true, eventId: req.eventId, targetId: req.characterId, dropped: 1 });
  const result = await freshApiCall(apiPath!, { event: 'untag-event-involves-character', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-event-involves-character failed');
  return (result.data?.body ?? result.data) as EventLinkResponse;
}

/** Tag an OCCURS_IN edge Event → Location. Idempotent. */
export async function tagEventOccursIn(req: TagEventOccursInRequest, token: string): Promise<EventLinkResponse> {
  if (useMock) return Promise.resolve({ tagged: true, eventId: req.eventId, targetId: req.locationId });
  const result = await freshApiCall(apiPath!, { event: 'tag-event-occurs-in', ...req }, token);
  if (!result.success) throw new Error(result.error || 'tag-event-occurs-in failed');
  return (result.data?.body ?? result.data) as EventLinkResponse;
}

/** Drop an OCCURS_IN edge Event → Location. */
export async function untagEventOccursIn(req: TagEventOccursInRequest, token: string): Promise<EventLinkResponse> {
  if (useMock) return Promise.resolve({ untagged: true, eventId: req.eventId, targetId: req.locationId, dropped: 1 });
  const result = await freshApiCall(apiPath!, { event: 'untag-event-occurs-in', ...req }, token);
  if (!result.success) throw new Error(result.error || 'untag-event-occurs-in failed');
  return (result.data?.body ?? result.data) as EventLinkResponse;
}

// ============================================
// Knowledge editing — Event sheet Knowledge tile.
// ============================================

export type KnowledgeState = 'knows' | 'suspects' | 'almost_spoiled' | 'doesnt_know' | 'none';
export interface SetKnowledgeRequest {
  projectId: string;
  knowerId: string;
  infoId: string;
  state: KnowledgeState;
  /** Anchor the state to a scene (FIL-505). Omit for a legacy un-anchored edge. */
  eventId?: string;
}
export interface SetKnowledgeResponse {
  set: true;
  knowerId: string;
  infoId: string;
  state: KnowledgeState;
  dropped: number;
}

/** Set or clear a knower's knowledge state about a fact (one edge per pair). */
export async function setKnowledge(
  req: SetKnowledgeRequest,
  token: string,
): Promise<SetKnowledgeResponse> {
  if (useMock) {
    return Promise.resolve({ set: true, knowerId: req.knowerId, infoId: req.infoId, state: req.state, dropped: 1 });
  }
  const result = await freshApiCall(apiPath!, { event: 'set-knowledge', ...req }, token);
  if (!result.success) throw new Error(result.error || 'set-knowledge failed');
  return (result.data?.body ?? result.data) as SetKnowledgeResponse;
}

// ============================================
// Card enrichment — manual-create follow-up LLM pass.
// ============================================

export interface EnqueueCardEnrichmentRequest {
  cardId: string;
  projectId: string;
  userId: string;
}
export interface EnqueueCardEnrichmentResponse {
  queued: true;
  messageId: string;
  cardId: string;
}

/**
 * Async enqueue of a single-vertex LLM enrichment pass. Returns 202 +
 * messageId immediately. Watch for the `card_enriched` WS event.
 *
 * Kept as an internal building block. For most manual-create / edit
 * triggers, use `enqueueCardExtraction` instead — that runs the full
 * extraction pipeline (creates new entities + edges via the resolver) in
 * addition to enriching the focal card's own fields.
 */
export async function enqueueCardEnrichment(
  req: EnqueueCardEnrichmentRequest,
  token: string,
): Promise<EnqueueCardEnrichmentResponse> {
  if (useMock) {
    return Promise.resolve({
      queued: true,
      messageId: `sqs_mock_enrich_${Date.now()}`,
      cardId: req.cardId,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'enqueue-card-enrichment', ...req }, token);
  if (!result.success) throw new Error(result.error || 'enqueue-card-enrichment failed');
  return (result.data?.body ?? result.data) as EnqueueCardEnrichmentResponse;
}

export interface EnqueueCardExtractionRequest {
  cardId: string;
  projectId: string;
  userId: string;
}
export interface EnqueueCardExtractionResponse {
  queued: true;
  messageId: string;
  cardId: string;
}

/**
 * Async enqueue of a full extraction pass over a manual card's
 * description. The focal card's fields get populated AND any other
 * entities mentioned in the description (other characters, locations,
 * relationships, edges) are created via the resolver. Watch for the
 * `card_extracted` WS event (FE refetches list-project-entities on it).
 *
 * Fired after a successful manual create with desc>=40 OR after a
 * description edit commits. Backend dedups by description hash so
 * idempotent re-fires are cheap.
 */
export async function enqueueCardExtraction(
  req: EnqueueCardExtractionRequest,
  token: string,
): Promise<EnqueueCardExtractionResponse> {
  if (useMock) {
    return Promise.resolve({
      queued: true,
      messageId: `sqs_mock_extract_${Date.now()}`,
      cardId: req.cardId,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'enqueue-card-extraction', ...req }, token);
  if (!result.success) throw new Error(result.error || 'enqueue-card-extraction failed');
  return (result.data?.body ?? result.data) as EnqueueCardExtractionResponse;
}

// ============================================
// D'-9 — Arc suggestions (proposed arc cards).
// ============================================

export type ArcSuggestionStatus = 'tracked' | 'pending' | 'accepted' | 'dismissed';

export interface ArcSuggestion {
  suggestionId: string;
  projectId: string;
  suggestedName: string;
  suggestedKind: ArcKind | string;
  description: string;
  evidenceQuotes: string[];
  sourceBraindumpIds: string[];
  mentionCount: number;
  status: ArcSuggestionStatus;
  createdAt?: string;
  updatedAt?: string;
  acceptedAt?: string;
  dismissedAt?: string;
  createdArcId?: string | null;
}

export interface ListArcSuggestionsRequest {
  projectId: string;
  /** When true, returns suggestions of every status. Default: pending only. */
  includeAll?: boolean;
}
export interface ListArcSuggestionsResponse {
  suggestions: ArcSuggestion[];
}

export interface AcceptArcSuggestionRequest {
  projectId: string;
  suggestionId: string;
  userId: string;
  /** Writer overrides — if omitted, falls back to the suggestion's values. */
  workingName?: string;
  kind?: ArcKind;
  description?: string;
  evidenceQuote?: string;
  position?: { x: number; y: number };
}
export interface AcceptArcSuggestionResponse {
  accepted: true;
  arcId: string | null;
  entity: ProjectEntity | null;
  alreadyAccepted?: boolean;
}

export interface DismissArcSuggestionRequest {
  projectId: string;
  suggestionId: string;
}
export interface DismissArcSuggestionResponse {
  dismissed: true;
  suggestionId: string;
}

/** List pending arc suggestions for a project. FE bootstraps with this so
 *  suggestions emitted while offline still surface. */
export async function listArcSuggestions(
  req: ListArcSuggestionsRequest,
  token: string,
): Promise<ListArcSuggestionsResponse> {
  if (useMock) return Promise.resolve({ suggestions: [] });
  const result = await freshApiCall(apiPath!, { event: 'list-arc-suggestions', ...req }, token);
  if (!result.success) throw new Error(result.error || 'list-arc-suggestions failed');
  return (result.data?.body ?? result.data) as ListArcSuggestionsResponse;
}

/** Accept a suggestion → backend creates an Arc vertex + marks
 *  suggestion accepted. Writer may override name / kind / description. */
export async function acceptArcSuggestion(
  req: AcceptArcSuggestionRequest,
  token: string,
): Promise<AcceptArcSuggestionResponse> {
  if (useMock) {
    return Promise.resolve({
      accepted: true,
      arcId: `arc_${slugForMock(req.workingName ?? req.suggestionId)}_${slugForMock(req.projectId)}`,
      entity: null,
    });
  }
  const result = await freshApiCall(apiPath!, { event: 'accept-arc-suggestion', ...req }, token);
  if (!result.success) throw new Error(result.error || 'accept-arc-suggestion failed');
  return (result.data?.body ?? result.data) as AcceptArcSuggestionResponse;
}

/** Dismiss a suggestion. Sticky — future braindumps mentioning the same
 *  concept don't re-surface it. */
export async function dismissArcSuggestion(
  req: DismissArcSuggestionRequest,
  token: string,
): Promise<DismissArcSuggestionResponse> {
  if (useMock) {
    return Promise.resolve({ dismissed: true, suggestionId: req.suggestionId });
  }
  const result = await freshApiCall(apiPath!, { event: 'dismiss-arc-suggestion', ...req }, token);
  if (!result.success) throw new Error(result.error || 'dismiss-arc-suggestion failed');
  return (result.data?.body ?? result.data) as DismissArcSuggestionResponse;
}

/** Slug helper used only in mocks. Mirrors backend formula loosely. */
function slugForMock(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/**
 * FIL-496 — load every stored layout for (userId, projectId). Cards without
 * a stored layout get an auto-default position from the FE.
 */
export async function getCardLayouts(
  req: GetCardLayoutsRequest,
  token: string,
): Promise<GetCardLayoutsResponse> {
  if (useMock) return mockGetCardLayouts(req);
  const result = await freshApiCall(apiPath!, { event: 'get-card-layouts', ...req }, token);
  if (!result.success) throw new Error(result.error || 'get-card-layouts failed');
  return (result.data?.body ?? result.data) as GetCardLayoutsResponse;
}

// ============================================
// Mocks — realistic production-shape data
// ============================================

function mockPeerFirstPass(req: PeerFirstPassRequest): Promise<PeerFirstPassResponse> {
  // Simulate ~20-25s latency with a faster dev value (~2s). Real Lambda is 20-25s.
  const fakeLatency = 2200;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        askId: `ask_mock_${Date.now()}`,
        responseProse:
          "The Detective is a function right now, not a person — the prose treats him as a camera, never as someone whose actions cost him anything. The click is named as a wound but stays abstract; nothing on the page makes us feel what he lost when he was pushed out of the force.\n\nThis matters because the case the Husband hired him for can only carry weight if the Detective has something at stake in taking it. Right now he reads as a man for hire. The story keeps gesturing at his interior but won't render it.\n\nThe specific gaps: we don't know what the click sounded like to him, whether the Husband's money is needed or wanted, and whether photographing the Woman with the Husband is work or something more pointed for him.",
        questions: [
          {
            questionId: `q_mock_1_${Date.now()}`,
            questionText:
              'What does the click mean to him specifically — what did he hear when his career ended?',
            workingSection: 'The click as a sound',
            rationale:
              "Right now 'the click' functions as shorthand for backstory; without a sensory anchor it can't carry the weight the prose wants it to.",
          },
          {
            questionId: `q_mock_2_${Date.now()}`,
            questionText:
              'What does he need the Husband\'s money for, or is the money the wrong question?',
            workingSection: 'His stake in this case',
            rationale:
              "If money's the only stake, he's hired help. If there's something else pulling him to this case, the surveillance scenes start to read like character work.",
          },
          {
            questionId: `q_mock_3_${Date.now()}`,
            questionText:
              'When he photographs the Woman with the Husband, what is he feeling — and is he aware of it?',
            workingSection: 'What the camera does to him',
            rationale:
              'Cameras as instruments of detachment is a real frame the prose can use, but it needs his interior to land. If he feels nothing, why? If he feels something, what?',
          },
        ],
        model: 'claude-sonnet-4-6',
        latencyMs: fakeLatency,
        usage: {
          inputTokens: 2197,
          outputTokens: 858,
          cacheWriteTokens: 3554,
          cacheReadTokens: 3554,
        },
        peerPromptVersion: 1,
      });
    }, fakeLatency);
  });
}

function mockBuildSlice(req: BuildSliceRequest): Promise<BuildSliceResponse> {
  // Mock returns a minimal slice constructed from the seed. Real backend
  // augments with Neptune neighbors + Dynamo CardResponses.
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          slice: {
            focal_type: req.focalType,
            focal_entity: req.focalSeed ?? { working_name: req.focalId },
            source_card_prose: req.sourceProse,
            prior_responses: [],
          },
          usedSeed: true,
          latencyMs: 80,
        }),
      80,
    ),
  );
}

function mockGradeSlice(req: GradeSliceRequest): Promise<SliceGradeResponse> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const priors = req.slice.prior_responses ?? [];
      resolve({
        stats: {
          focal_type: req.slice.focal_type,
          focal_name: req.slice.focal_entity?.working_name ?? null,
          focal_completeness: {
            has_description: !!req.slice.focal_entity?.description,
            has_traits: Array.isArray(req.slice.focal_entity?.established_traits) && req.slice.focal_entity.established_traits.length > 0,
            has_open_dimensions: Array.isArray(req.slice.focal_entity?.open_dimensions) && req.slice.focal_entity.open_dimensions.length > 0,
            has_evidence_quote: !!req.slice.focal_entity?.evidence_quote,
          },
          focal_completeness_score: 0.75,
          counts: {
            co_characters: req.slice.co_characters?.length ?? 0,
            mentioned_characters: req.slice.mentioned_characters?.length ?? 0,
            events: req.slice.events_involving?.length ?? 0,
            information: req.slice.relevant_information?.length ?? 0,
            knowledge: req.slice.focal_knowledge?.length ?? 0,
            knowledge_as_subject: req.slice.focal_as_subject_of_knowledge?.length ?? 0,
            relationships: req.slice.focal_relationships?.length ?? 0,
            structural_edges: req.slice.focal_structural_edges?.length ?? 0,
            prior_responses: priors.length,
            priors_without_question_context: 0,
          },
          newest_prior_at: priors[0]?.answered_at ?? null,
          newest_prior_age_hours: 0,
          slice_bytes: JSON.stringify(req.slice).length,
          has_source_card_prose: !!req.slice.source_card_prose,
        },
        llmGrade: {
          coverage_score: 3,
          coverage_gaps: ['mock: no real grading'],
          consistency_score: 4,
          contradictions: [],
          relevance_score: 4,
          irrelevant_items: [],
          would_inform_peer: 3,
          what_would_make_it_better: 'Mock grade — set REACT_APP_FREEFORM_API_PATH for real grading.',
          latencyMs: 200,
        },
        gradeVersion: 1,
        totalLatencyMs: 220,
      });
    }, 220),
  );
}

function mockEnqueuePeerFirstPass(): Promise<EnqueuePeerFirstPassResponse> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        askId: `ask_mock_${Date.now()}`,
        queued: true,
        messageId: `sqs_mock_${Date.now()}`,
      });
    }, 120);
  });
}

function mockEnqueueExtractionJob(
  req: EnqueueExtractionJobRequest,
): Promise<EnqueueExtractionJobResponse> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        queued: true,
        messageId: `sqs_mock_${Date.now()}`,
      });
    }, 120);
  });
}

function mockSaveDraft(req: SaveDraftRequest): Promise<SaveDraftResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ responseId: `cr_${req.questionId}`, saved: true }),
      80,
    ),
  );
}

function mockSubmitResponse(req: SubmitResponseRequest): Promise<SubmitResponseResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          responseId: `cr_${req.questionId}`,
          questionId: req.questionId,
          status: 'answered',
          extractionEnqueued: true,
          extractionMessageId: `sqs_mock_${Date.now()}`,
        }),
      120,
    ),
  );
}

function mockUpdateStatus(
  req: UpdateQuestionStatusRequest,
): Promise<{ questionId: string; status: string; updated: boolean }> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ questionId: req.questionId, status: req.status, updated: true }),
      60,
    ),
  );
}

function mockStartThread(req: StartThreadRequest): Promise<StartThreadResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ threadId: `thr_mock_${Date.now()}`, status: 'open', createdAt: new Date().toISOString() }),
      100,
    ),
  );
}

function mockPeerContinue(req: PeerContinueRequest): Promise<PeerContinueResponse> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const now = new Date().toISOString();
      const writerTurn: ContinuationTurn = {
        turnId: `t_w_${Date.now()}`,
        role: 'writer',
        content: req.writerMessage,
        createdAt: now,
      };
      const peerTurn: ContinuationTurn = {
        turnId: `t_p_${Date.now() + 1}`,
        role: 'peer',
        content:
          "I hear you. The detachment is there — I'm not disputing that. What I'm pushing on is the difference between a character who is detached and a character who reads as detached *because* he's defending against something.",
        createdAt: now,
        latencyMs: 1800,
      };
      resolve({ threadId: req.threadId, writerTurn, peerTurn, turnCount: 2, latencyMs: 1800 });
    }, 1800),
  );
}

function mockCloseThread(req: CloseThreadRequest) {
  return Promise.resolve({
    threadId: req.threadId,
    status: 'closed' as const,
    closedReason: req.reason ?? 'explicit',
    closedAt: new Date().toISOString(),
  });
}

/**
 * Mock list-project-entities. Returns the affair-project state from the v2
 * walkthrough Stage 4 final graph (4 chars, 3 events, 2 locations, 0 reified
 * relationships, 1 structural edge, 1 PRECEDES). Ignores projectId — same data
 * regardless of storyId in the URL, so devs can iterate freely.
 */
function mockListProjectEntities(
  req: ListProjectEntitiesRequest,
): Promise<ListProjectEntitiesResponse> {
  const pid = 'demo_project_affair';
  const cId = (slug: string) => `char_${slug}_${pid}`;
  const eId = (slug: string) => `evt_${slug}_${pid}`;
  const lId = (slug: string) => `loc_${slug}_${pid}`;

  const entities: ProjectEntity[] = [
    {
      id: cId('the_detective'),
      type: 'character',
      working_name: 'the Detective',
      description: 'A detective conducting surveillance for unknown reasons.',
      established_traits: ['methodical', 'equipped for surveillance'],
      open_dimensions: [
        {
          tension: "His stake is unclear by design — the prose flags 'we don't know if he is dangerous or hired.'",
          why_it_matters: 'The ambiguity is doing dramatic work. It can ride for a while but eventually has to land.',
        },
        {
          tension: 'We have a function (the watcher) but not a person.',
          why_it_matters: 'The Event ends with him having captured something significant. To follow him forward we need to know who he is.',
        },
      ],
      evidence_quote: 'A detective follows a woman we don\'t know if he is dangerous or hired or what.',
    },
    {
      id: cId('the_woman'),
      type: 'character',
      working_name: 'the Woman',
      description: 'A woman conducting an affair, unaware she is being surveilled.',
      established_traits: ['being surveilled (unknowingly)', 'having an affair'],
      open_dimensions: [
        {
          tension: 'Identity unknown. We only know her through what someone else is documenting.',
          why_it_matters: "She's the subject of the Event but we have no point of view on her own life.",
        },
      ],
      evidence_quote: 'the woman he was following, with a man kissing and held in a tight embrace',
    },
    {
      id: cId('the_man'),
      type: 'character',
      working_name: 'the Man',
      description: 'A man involved with the Woman, encountered inside the apartment building.',
      established_traits: [],
      open_dimensions: [],
      evidence_quote: 'a man kissing and held in a tight embrace',
    },
    {
      id: cId('the_husband'),
      type: 'character',
      working_name: 'the Husband',
      description: 'Hired the Detective. Reminds the Detective of his own younger self. The Detective considers him decent, blindsided by the situation.',
      established_traits: ['client', 'blindsided', 'reminds Detective of his younger self'],
      open_dimensions: [
        {
          tension: 'We know what the Detective projects onto the Husband but not who the Husband actually is.',
          why_it_matters: "The Detective's stake hinges on this identification. If it's misread, his arc bends.",
        },
      ],
      evidence_quote: 'the husband who hired him reminded him of himself five years ago. Decent man, getting blindsided.',
    },
    {
      id: eId('detective_surveils_the_woman_and_photographs_her_affair'),
      type: 'event',
      working_title: 'Detective surveils the Woman and photographs her affair',
      summary: 'Detective tails the Woman through the city to a Manhattan apartment building. He takes a hotel room across the way, sets up a telephoto lens, and photographs her in an embrace with a man.',
      narrative_status: 'on_screen',
      sub_events: [
        { slugline: 'EXT. CITY STREETS — DAY', description: 'Detective tails the Woman through the city, observing from a distance.' },
        { slugline: 'INT. HOTEL ROOM 8TH FLOOR — LATER', description: 'Detective sets up a telephoto lens at the window.' },
        { slugline: 'INT. APARTMENT (VIA LENS) — CONTINUOUS', description: 'Through the lens we see the Woman with the Man, embracing. The camera clicks.' },
      ],
      open_dimensions: [
        {
          tension: 'The photos exist but no consequence yet.',
          why_it_matters: 'The beat ends on a charged image. What it leads to is open.',
        },
      ],
      evidence_quote: 'we take the perspective of the lens to see the woman he was following...',
    },
    {
      id: eId('the_detective_is_pushed_out_of_the_force'),
      type: 'event',
      working_title: 'The Detective is pushed out of the force',
      summary: 'Internal Affairs incident, five years ago. The Detective held the line and was scapegoated. He still won\'t discuss it.',
      narrative_status: 'backstory',
      sub_events: [],
      open_dimensions: [
        {
          tension: 'We have the shape of the incident (held the line, got hung for it) but not the specific act.',
          why_it_matters: "Without the specifics, we can't feel what he lost.",
        },
      ],
      evidence_quote: 'Got pushed out for something — internal affairs, an incident, he was the one holding the line and got hung for it.',
    },
    {
      id: eId('the_husband_hires_the_detective'),
      type: 'event',
      working_title: 'The Husband hires the Detective',
      summary: 'The husband approaches the Detective and engages him to surveil the Woman. Recognition of self-as-younger-man decides the Detective on taking the case.',
      narrative_status: 'backstory',
      sub_events: [],
      open_dimensions: [],
      evidence_quote: 'He took this case because the husband who hired him reminded him of himself five years ago.',
    },
    {
      id: lId('the_apartment_building'),
      type: 'location',
      working_name: 'the apartment building',
      description: 'A large classic-NY apartment complex in Manhattan.',
      int_ext: 'EXT',
      evidence_quote: 'a large apartment complex, classic NY building',
    },
    {
      id: lId('the_hotel'),
      type: 'location',
      working_name: 'the hotel',
      description: 'A hotel adjacent to the apartment building. The Detective takes a room on the 8th floor.',
      int_ext: 'INT',
      evidence_quote: 'He walks into the adjacent building which is a hotel, gets a room on the 8th floor.',
    },
  ];

  const edges: ProjectEdges = {
    involves: [
      { from: eId('detective_surveils_the_woman_and_photographs_her_affair'), to: cId('the_detective') },
      { from: eId('detective_surveils_the_woman_and_photographs_her_affair'), to: cId('the_woman') },
      { from: eId('detective_surveils_the_woman_and_photographs_her_affair'), to: cId('the_man') },
      { from: eId('the_detective_is_pushed_out_of_the_force'), to: cId('the_detective') },
      { from: eId('the_husband_hires_the_detective'), to: cId('the_husband') },
      { from: eId('the_husband_hires_the_detective'), to: cId('the_detective') },
      { from: eId('the_husband_hires_the_detective'), to: cId('the_woman') },
    ],
    occurs_in: [
      { from: eId('detective_surveils_the_woman_and_photographs_her_affair'), to: lId('the_apartment_building') },
      { from: eId('detective_surveils_the_woman_and_photographs_her_affair'), to: lId('the_hotel') },
    ],
    precedes: [
      { from: eId('the_detective_is_pushed_out_of_the_force'), to: eId('the_husband_hires_the_detective') },
    ],
    sequence_precedes: [],
    structural: [
      {
        from: cId('the_husband'),
        to: cId('the_woman'),
        predicate: 'MARRIED_TO',
        evidence_quote: 'the husband who hired him',
      },
    ],
    knowledge: [],
    evokes: [],
    arc_involves: [],
    causes: [],
    contains: [],
  };

  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ projectId: req.projectId, entities, edges, information: [], latencyMs: 140 }),
      140,
    ),
  );
}

// In-memory layout store for mock mode.
const __mockLayouts: Map<string, CardLayout> = new Map();

function mockUpdateCardPosition(
  req: UpdateCardPositionRequest,
): Promise<UpdateCardPositionResponse> {
  __mockLayouts.set(`${req.userId}#${req.projectId}#${req.cardId}`, {
    cardId: req.cardId,
    x: req.x,
    y: req.y,
    scale: req.scale,
    zIndex: req.zIndex,
    updatedAt: new Date().toISOString(),
  });
  return Promise.resolve({ saved: true, updatedAt: new Date().toISOString() });
}

function mockGetCardLayouts(
  req: GetCardLayoutsRequest,
): Promise<GetCardLayoutsResponse> {
  const prefix = `${req.userId}#${req.projectId}#`;
  const layouts: CardLayout[] = [];
  __mockLayouts.forEach((v, k) => {
    if (k.startsWith(prefix)) layouts.push(v);
  });
  return new Promise((resolve) => setTimeout(() => resolve({ layouts }), 60));
}

function mockUpdateCardName(req: UpdateCardNameRequest): Promise<UpdateCardNameResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          renamed: true,
          cardId: req.cardId,
          workingName: req.workingName,
          aliases: [],
          previousName: '(mock)',
          relationshipsAffected: 0,
          updatedAt: new Date().toISOString(),
        }),
      80,
    ),
  );
}

function mockDeleteCard(req: DeleteCardRequest): Promise<DeleteCardResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          deleted: true,
          cardId: req.cardId,
          deletedAt: new Date().toISOString(),
          relationshipsAffected: 0,
        }),
      80,
    ),
  );
}

function mockRestoreCard(req: RestoreCardRequest): Promise<RestoreCardResponse> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          restored: true,
          cardId: req.cardId,
          relationshipsAffected: 0,
        }),
      80,
    ),
  );
}

function mockCreateCard(req: CreateCardRequest): Promise<CreateCardResponse> {
  const nameSlug = slugForCard(req.workingName);
  const projSlug = slugForCard(req.projectId);
  const prefix = req.kind === 'character' ? 'char' : req.kind === 'event' ? 'evt' : 'loc';
  const id = `${prefix}_${nameSlug}_${projSlug}`;
  const entity: ProjectEntity = {
    id,
    type: req.kind,
    working_name: req.workingName,
    description: req.description ?? '',
    established_traits: [],
    open_dimensions: [],
    evidence_quote: '',
  };
  if (req.kind === 'event') {
    entity.working_title = req.workingName;
    entity.summary = req.description ?? '';
    entity.narrative_status = req.narrativeStatus ?? 'on_screen';
    entity.sub_events = [];
    entity.audience_state = {};
  }
  if (req.kind === 'location' && req.intExt) {
    entity.int_ext = req.intExt;
  }
  return new Promise((resolve) =>
    setTimeout(() => resolve({ created: true, entity }), 120),
  );
}

/**
 * Slug formula shared with the backend (lib/card-create.mjs::slug + lib/neptune-writes.mjs::slug).
 * Exposed so the corkboard can pre-flight a collision check against the in-memory
 * entities list before hitting the server.
 */
export function slugForCard(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function mockCreateWriterQuestion(req: CreateWriterQuestionRequest): Promise<PeerQuestion> {
  const now = new Date().toISOString();
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          questionId: `q_writer_mock_${Date.now()}`,
          askId: '',
          cardId: req.cardId,
          projectId: req.projectId,
          orderIndex: req.orderIndex ?? Date.now(),
          questionText: '',
          workingSectionLabel: req.workingSectionLabel,
          rationale: '',
          authoredBy: 'writer',
          status: 'open',
          threadId: null,
          responseId: null,
          createdAt: now,
          updatedAt: now,
        }),
      80,
    ),
  );
}

// ============================================
// Helper — convert API response question to PeerQuestion shape for components
// ============================================

export function adaptPeerQuestions(
  response: PeerFirstPassResponse,
  cardId: string,
  projectId: string,
): PeerQuestion[] {
  const createdAt = new Date().toISOString();
  return response.questions.map((q, i) => ({
    questionId: q.questionId,
    askId: response.askId,
    cardId,
    projectId,
    orderIndex: i,
    questionText: q.questionText,
    workingSectionLabel: q.workingSection,
    rationale: q.rationale,
    authoredBy: 'peer' as const,
    status: 'open' as const,
    threadId: null,
    responseId: null,
    createdAt,
    updatedAt: createdAt,
  }));
}
