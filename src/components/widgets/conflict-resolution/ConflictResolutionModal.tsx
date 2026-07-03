// SCR-0030 shell.conflict-resolution-modal (modernizado / AD-02). Aparece em
// sync.conflict. Mostra local vs remoto + 3 opções (keep mine / use remote / keep both)
// e aplica via callback injetado (conflict-resolution.ts). Snapshot pré-resolução é
// feito pelo BC-08. Tela crítica — perda de dados se mal resolvida. Textos = DEV-004.
import React, { useEffect, useState } from 'react';
import { on } from '../../../data/sync-agent/events';

export type ConflictChoice = 'local' | 'remote' | 'both';

export interface ConflictDiff {
  local: string;
  remote: string;
  localAt?: string;
  remoteAt?: string;
}

export interface ConflictResolutionModalProps {
  /** Aplica a resolução escolhida (wira no sync-agent). */
  resolve: (entityType: string, entityId: string, choice: ConflictChoice) => Promise<void> | void;
  /** Carrega o diff local vs remoto para exibição (opcional). */
  loadDiff?: (entityType: string, entityId: string) => Promise<ConflictDiff | null>;
}

const OPTIONS: { value: ConflictChoice; label: string }[] = [
  { value: 'local', label: 'Keep my version' },
  { value: 'remote', label: "Use other device's version" },
  { value: 'both', label: 'Keep both (create duplicate)' },
];

export function ConflictResolutionModal({ resolve, loadDiff }: ConflictResolutionModalProps): JSX.Element | null {
  const [conflict, setConflict] = useState<{ entityType: string; entityId: string } | null>(null);
  const [choice, setChoice] = useState<ConflictChoice>('local');
  const [phase, setPhase] = useState<'idle' | 'applying' | 'applied'>('idle');
  const [diff, setDiff] = useState<ConflictDiff | null>(null);

  useEffect(() => {
    return on('sync.conflict', async ({ entityType, entityId }) => {
      setConflict({ entityType, entityId });
      setChoice('local'); // default keep mine
      setPhase('idle');
      setDiff(loadDiff ? await loadDiff(entityType, entityId).catch(() => null) : null);
    });
  }, [loadDiff]);

  if (!conflict) return null;

  const apply = async () => {
    setPhase('applying');
    await resolve(conflict.entityType, conflict.entityId, choice);
    setPhase('applied');
    setTimeout(() => setConflict(null), 500); // auto-close
  };
  const cancel = () => setConflict(null); // conflito permanece pendente

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
      <div className="w-full max-w-[720px] rounded-xl bg-bgdark2 p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-semanticError">Sync Conflict — {conflict.entityType}</h2>
        <p className="mt-2 text-fontWhite07">
          Your changes to this {conflict.entityType} conflict with changes made on another device.
        </p>

        {diff && (
          <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
            <div className="rounded-md bg-bgdark1 p-3">
              <div className="mb-1 text-fontWhite05">This device {diff.localAt ? `(${diff.localAt})` : ''}</div>
              <pre className="whitespace-pre-wrap text-fontWhite07">{diff.local}</pre>
            </div>
            <div className="rounded-md bg-bgdark1 p-3">
              <div className="mb-1 text-fontWhite05">Other device {diff.remoteAt ? `(${diff.remoteAt})` : ''}</div>
              <pre className="whitespace-pre-wrap text-fontWhite07">{diff.remote}</pre>
            </div>
          </div>
        )}

        {phase === 'applying' ? (
          <p className="mt-4 text-fontWhite07">Applying resolution…</p>
        ) : (
          <>
            <fieldset className="mt-4 space-y-2">
              {OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-fontWhite07">
                  <input
                    type="radio"
                    name="conflict-choice"
                    value={o.value}
                    checked={choice === o.value}
                    onChange={() => setChoice(o.value)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={cancel} className="px-4 py-2 text-fontWhite07 hover:text-white">
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-md bg-orange px-4 py-2 font-medium text-white hover:bg-hoverOrangeBorder"
              >
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ConflictResolutionModal;
