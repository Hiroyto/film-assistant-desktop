// SCR-0028 shell.sync-status-bar (modernizado / BC-08). Peça CENTRAL da UX local-first:
// badge flutuante permanente (posicionada pelo DesktopShell) refletindo online | syncing |
// offline | conflict, com ícones lucide e tokens semânticos (DEV-002 textos agent-proposed).
// Conflict tem prioridade máxima e, no click, abre a conflict-resolution-modal. Só
// renderiza no desktop (AD-07).
import React, { useEffect, useState } from 'react';
import { WifiHigh, RefreshCw, WifiOff, AlertTriangle, LucideIcon } from 'lucide-react';
import { on, SyncState } from '../../../data/sync-agent/events';
import { isDesktop } from '../../../lib/ipcClient';

export interface SyncStatusBarProps {
  onRetry?: () => void;
  onViewConflicts?: () => void;
}

interface StateView {
  Icon: LucideIcon;
  color: string; // classe de cor (token semântico)
  label: (depth: number) => string;
  tooltip: string;
  spin?: boolean;
}

const VIEWS: Record<SyncState, StateView> = {
  online: {
    Icon: WifiHigh,
    color: 'text-semanticSuccess',
    label: () => 'Synced',
    tooltip: 'All changes saved locally and synced to cloud.',
  },
  syncing: {
    Icon: RefreshCw,
    color: 'text-semanticInfo',
    label: (n) => `Syncing ${n} change${n === 1 ? '' : 's'}…`,
    tooltip: 'Pending mutations being pushed to cloud.',
    spin: true,
  },
  offline: {
    Icon: WifiOff,
    color: 'text-semanticMuted',
    label: () => 'Offline — changes saved locally',
    tooltip: 'No internet. Your work is safe on this device. Will sync when reconnected.',
  },
  conflict: {
    Icon: AlertTriangle,
    color: 'text-semanticError',
    label: () => 'Conflict — click to resolve',
    tooltip: 'Sync detected conflicting versions. Click to review.',
  },
};

export function SyncStatusBar({ onRetry, onViewConflicts }: SyncStatusBarProps): JSX.Element | null {
  const [state, setState] = useState<SyncState>('online');
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    const offs = [
      on('sync.state', ({ state: s }) => setState((prev) => (prev === 'conflict' && s !== 'conflict' ? prev : s))),
      on('sync.queue.depth', ({ n }) => setDepth(n)),
      on('sync.conflict', () => setState('conflict')), // prioridade máxima
      // Destrava o banner após a resolução (senão 'conflict' fica grudado para sempre,
      // já que o guard acima ignora qualquer sync.state enquanto em conflito).
      on('sync.conflict.resolved', () => setState((prev) => (prev === 'conflict' ? 'online' : prev))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (!isDesktop()) return null;

  const view = VIEWS[state];
  const Icon = view.Icon;

  return (
    <div
      // Pill sólida (bg + borda + sombra): flutua sobre conteúdo com blur, como a
      // sidebar da Home. Os textos ficam inteiros — a paridade (spec 12) os exige.
      className="inline-flex h-[26px] items-center gap-2 whitespace-nowrap rounded-full border border-glassBg bg-bgdark2 px-3 text-xs text-fontWhite07 shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
      role="status"
      aria-live="polite"
      title={view.tooltip}
    >
      <Icon size={13} className={`${view.color} ${view.spin ? 'animate-slow-spin' : ''}`} />
      <span className={view.color}>{view.label(depth)}</span>

      {state === 'conflict' && (
        <button type="button" onClick={onViewConflicts} className="ml-1 text-semanticError underline">
          Resolve
        </button>
      )}
      {(state === 'offline' || state === 'syncing') && onRetry && (
        <button type="button" onClick={onRetry} className="ml-1 text-orange hover:text-hoverOrangeBorder">
          Retry sync
        </button>
      )}
    </div>
  );
}

export default SyncStatusBar;
