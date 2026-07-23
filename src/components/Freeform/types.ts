// components/Freeform/types.ts
//
// Shared TypeScript types for the Freeform Peer feature.
// Mirror the backend extraction schema in freeform-workflow-app/lib/schemas/.
// Keep in sync if those evolve.

export type EntityType = 'character' | 'event' | 'relationship' | 'location' | 'information' | 'arc' | 'sequence';

export type NarrativeStatus = 'on_screen' | 'backstory' | 'offstage';
export type IntExt = 'INT' | 'EXT' | 'UNKNOWN';
export type KnowledgeState = 'knows' | 'doesnt_know' | 'suspects' | 'almost_spoiled';
export type QuestionUrgency = 'pressing' | 'simmering' | 'background';

export type WorkingSectionStatus = 'open' | 'stashed' | 'answered' | 'dismissed';
export type AuthoredBy = 'peer' | 'writer';

// Sub-event shape (post FIL-491 schema change)
export interface SubEvent {
  slugline: string;
  description: string;
}

export interface OpenDimension {
  tension: string;
  why_it_matters: string;
}

// Card data shapes — match the extraction schema's per-entity shapes
// plus client-side fields the FE adds (id, position, etc.).

interface BaseCard {
  cardId: string;
  projectId: string;
  position: { x: number; y: number };
  createdAt: string;
  updatedAt: string;
  evidence_quote?: string;
}

export interface CharacterCard extends BaseCard {
  type: 'character';
  working_name: string;
  description: string;
  established_traits: string[];
  open_dimensions: OpenDimension[];
}

export interface EventCard extends BaseCard {
  type: 'event';
  working_title: string;
  summary: string;
  narrative_status: NarrativeStatus;
  sub_events: SubEvent[];
  involves: string[];
  occurs_in: string[];
  open_dimensions: OpenDimension[];
  audience_state?: {
    established_beliefs: { belief: string; evidence: string }[];
    questions_raised: { question: string; urgency: QuestionUrgency }[];
    promises_raised: string[];
  };
}

export interface RelationshipCard extends BaseCard {
  type: 'relationship';
  character_a: string;
  character_b: string;
  kind: string;
  description: string;
  rationale: string;
  open_dimensions: OpenDimension[];
}

export interface LocationCard extends BaseCard {
  type: 'location';
  working_name: string;
  description: string;
  int_ext: IntExt;
}

export type AnyCard = CharacterCard | EventCard | RelationshipCard | LocationCard;

// Peer feature types

export interface PeerQuestion {
  questionId: string;
  askId: string;
  cardId: string;
  projectId: string;
  orderIndex: number;
  questionText: string;
  workingSectionLabel: string;
  rationale: string;
  authoredBy: AuthoredBy;
  status: WorkingSectionStatus;
  threadId: string | null;
  responseId: string | null;
  responseProse?: string;
  createdAt: string;
  updatedAt: string;
}

export type PeerCardState =
  | 'loading' // "Reading your card..."
  | 'streaming' // prose building token-by-token
  | 'composing' // between prose and questions (streaming only)
  | 'complete'; // prose + questions visible

export interface CascadeEntity {
  workingName: string;
  kind: EntityType;
}

export interface CascadeEvent {
  type: 'cascade_complete';
  cardResponseId: string;
  originatingCardId: string;
  projectId: string;
  threadId: string | null;
  newEntities: CascadeEntity[];
  crossCardLandings: CascadeEntity[];
  summary: { vertices: number; edges: number; failures: number };
  emittedAt: string;
}

export interface ThreadTurn {
  turnId: string;
  role: 'peer' | 'writer';
  content: string;
  createdAt: string;
}
