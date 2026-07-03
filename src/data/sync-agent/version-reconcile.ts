// Reconciliação de versão no ongoing pull (data_migration_plan.md §Ongoing pull, passo 2).
//
// Função PURA que decide o que fazer com um item recebido do backend, comparando
// version/updated_at local vs remoto. O agendamento e a aplicação efetiva ficam no
// pull-strategy.ts (Tarefa 07); a detecção de conflito explícito (409) vem do push.

export interface VersionedState {
  /** optimistic lock version (stories/screenplays). */
  version: number;
  /** ISO-8601 — última modificação. */
  updated_at: string;
  /** ISO-8601 — último sync bem-sucedido (null se nunca sincronizou / mutation local pendente). */
  synced_at: string | null;
}

export type PullAction =
  | 'skip' // versões iguais — sem mudança
  | 'apply_remote' // remoto mais novo — aplicar update local
  | 'ignore_local_pending' // local à frente (push pendente vai resolver)
  | 'lww_remote' // mesma version, conteúdo divergente — last-write-wins escolheu remoto
  | 'lww_local'; // mesma version, divergente — local venceu por updated_at

/**
 * Decide a ação de pull para um item.
 * @param local estado local atual, ou null se a entidade não existe localmente.
 * @param remote estado remoto recebido.
 * @param contentDiverges callback opcional para o caso version igual (compara conteúdo).
 */
export function decidePullAction(
  local: VersionedState | null | undefined,
  remote: VersionedState,
  contentDiverges = false,
): PullAction {
  if (!local) return 'apply_remote'; // entidade nova localmente

  if (remote.version > local.version) return 'apply_remote';
  if (local.version > remote.version) return 'ignore_local_pending';

  // versões iguais
  if (!contentDiverges) return 'skip';

  // version igual mas conteúdo divergente (improvável) -> last-write-wins por updated_at
  const localTime = Date.parse(local.updated_at) || 0;
  const remoteTime = Date.parse(remote.updated_at) || 0;
  return remoteTime >= localTime ? 'lww_remote' : 'lww_local';
}

/**
 * Detecta conflito de edição multi-device (AD-02): local tem mutação não-sincronizada
 * (updated_at > synced_at) E o remoto avançou de version. Nesse caso o pull NÃO deve
 * sobrescrever silenciosamente — encaminhar para conflict-resolution (Tarefa 07).
 */
export function isPullConflict(
  local: VersionedState | null | undefined,
  remote: VersionedState,
): boolean {
  if (!local) return false;
  const hasLocalPendingEdit =
    local.synced_at == null || (Date.parse(local.updated_at) || 0) > (Date.parse(local.synced_at) || 0);
  return hasLocalPendingEdit && remote.version > local.version;
}
