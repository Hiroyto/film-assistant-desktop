// components/Freeform/index.ts
//
// Barrel export for the Freeform Peer component foundation (FIL-490).
// Consumers should import from this index, not deep-imports.
//
//   import { PeerCard, WorkingSection, getEntityColor } from '@/components/Freeform';

export { default as InternIcon } from './InternIcon';
export { default as TypeChip } from './TypeChip';
export { default as PulseLoader } from './PulseLoader';
export { default as CardChrome } from './CardChrome';
export { default as PeerThreadBubble } from './PeerThreadBubble';
export { default as PeerCard } from './PeerCard';
export type { PeerContinuationView } from './PeerCard';
export { default as QuestionCard } from './QuestionCard';
export { default as WorkingSection } from './WorkingSection';
export { default as CascadeToast } from './CascadeToast';
export { default as RecentUpdatesTray } from './RecentUpdatesTray';
export { default as CascadeSummaryPanel } from './CascadeSummaryPanel';
export { default as ChatContinuation } from './ChatContinuation';
export type { ChatTurn } from './ChatContinuation';

export * from './types';
export * from './tokens';
export * from './entityColors';

export type { RecentUpdateEntry } from './RecentUpdatesTray';
