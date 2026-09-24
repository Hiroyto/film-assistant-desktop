// DesktopShell — ponto único de integração da camada desktop no renderer (Etapa 1).
// Monta as telas modernizadas (sync-status-bar + modais), roteia os eventos do menu
// nativo e inicializa a telemetria. TUDO guardado por isDesktop() → na web é no-op
// (não afeta a SPA — Strangler Fig / AD-07).
import React, { useEffect, useRef } from 'react';
import { isDesktop, onOsEvent } from '../../lib/ipcClient';
import { initTelemetry } from '../../lib/telemetry';
import { SyncStatusBar } from './sync-status-bar';
import { UpdateAvailableModal } from './update-available';
import { ConflictResolutionModal } from './conflict-resolution';
import { FdxCoworkPanel } from './FdxCoworkPanel';
import { requestSyncNow, applyRemoteStory } from '../../data/desktop-lifecycle';
import { emit as emitSyncEvent, on as onSyncEvent } from '../../data/sync-agent/events';
import { recordConflictResolved } from '../../test-bridge/conflictRecorder';
import { storyRepo } from '../../data/local-db/repositories';
import { rowToCanonical } from '../../features/story-workspace/model/storySerialization';
import { saveStory } from '../../features/story-workspace/model/storySave';

/** Roteia um item do menu nativo (SCR-0027) para a ação no renderer. */
function routeMenu(event: string): void {
  // Re-emite para quem quiser ouvir (legado/integrações futuras).
  window.dispatchEvent(new CustomEvent('app:menu', { detail: event }));

  switch (event) {
    case 'commands.cmdk.open':
      // Dispara o atalho que o CommandUIProvider legado já escuta no window.
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }),
      );
      break;
    case 'tour.open':
      window.dispatchEvent(new CustomEvent('app:start-tour'));
      break;
    case 'story.new':
      window.dispatchEvent(new CustomEvent('app:new-story'));
      break;
    case 'story.save':
      window.dispatchEvent(new CustomEvent('app:save-story'));
      break;
    case 'help.about.open':
      // About mínimo por ora (etapa futura pode trocar por modal dedicado).
      // eslint-disable-next-line no-alert
      window.alert('Film Assistant — Desktop');
      break;
    case 'updater.check':
      window.dispatchEvent(new CustomEvent('app:check-updates'));
      break;
    case 'fdx.open':
      window.dispatchEvent(new CustomEvent('app:open-fdx'));
      break;
    default:
      break;
  }
}

export function DesktopShell(): JSX.Element | null {
  // Último conflito emitido — permite reabrir o modal pelo botão "Resolve" da
  // status-bar (o modal só monta na emissão do evento; sem isto o botão é inerte).
  const lastConflict = useRef<{ entityType: string; entityId: string } | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    const offConflict = onSyncEvent('sync.conflict', ({ entityType, entityId }) => {
      lastConflict.current = { entityType, entityId };
    });
    // Telemetria local (sem DSN → só métricas locais; registra install via SQLite IPC).
    initTelemetry({ environment: 'development' }).catch((e) =>
      console.error('[shell] initTelemetry falhou', e),
    );
    const offMenu = window.electronAPI?.onMenu?.((event) => routeMenu(event)) ?? (() => {});
    // Conectividade do OS → estado da sync-status-bar (SCR-0028). online/offline
    // vêm do main (osLifecycle / ponte de teste emitOs). offline não sobrepõe conflito.
    const offOffline = onOsEvent('offline', () => emitSyncEvent('sync.state', { state: 'offline' }));
    const offOnline = onOsEvent('online', () => emitSyncEvent('sync.state', { state: 'online' }));
    return () => {
      offConflict();
      offMenu();
      offOffline();
      offOnline();
    };
  }, []);

  if (!isDesktop()) return null;

  return (
    <>
      {/* Badge no canto inferior ESQUERDO: o direito tem UI fixa por rota (zoom do
          corkboard, toast do roteiro, CTA do dashboard) e o centro, as pílulas do
          board. z 40 (o mesmo do footer antigo): fica SOB os backdrops dos modais
          (z 50 — senão o "Resolve" re-emite o conflito com o modal aberto e zera a
          escolha) e acima das páginas com <Theme> (o root theme do Radix é um
          contexto z 0, então a sidebar z 99 da Home não a cobre). */}
      <div style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 40 }}>
        <SyncStatusBar
          onRetry={() => void requestSyncNow()}
          onViewConflicts={() => {
            // Reabre o modal re-emitindo o último conflito conhecido (o modal
            // escuta 'sync.conflict'). Sem um conflito registrado, não faz nada.
            const c = lastConflict.current;
            if (c) emitSyncEvent('sync.conflict', c);
          }}
        />
      </div>
      <UpdateAvailableModal />
      <FdxCoworkPanel />{/* protótipo coworking .fdx (só leitura) */}
      {/* 'remote' = aceitar a versão do backend (re-pull, não-destrutivo).
          'local' = manter a minha (re-enfileira p/ sobrescrever o backend; possível
          após o push-cutover A1). 'both' (duplicar) segue pendente — decisão de produto. */}
      <ConflictResolutionModal
        resolve={async (entityType, entityId, choice) => {
          console.info('[conflict] resolução escolhida', { entityType, entityId, choice });
          // Instrumentação de teste (spec 12 t17) — inerte em produção até ser armada.
          recordConflictResolved({ entityType, entityId, resolution: choice });
          if (choice === 'remote') {
            // Força a versão do backend no SQLite local (limpa o conflito de vez);
            // re-pull sozinho só re-detectaria o mesmo conflito e voltaria no boot.
            const applied = entityType === 'story' ? await applyRemoteStory(entityId) : false;
            if (!applied) await requestSyncNow();
          } else if (choice === 'local' && entityType === 'story') {
            // Keep mine (AD-02): re-enfileira a Story local (S1..S9/foundation) para
            // sobrescrever o remoto. characters têm caminho de save próprio.
            const row = await storyRepo.getStory(entityId);
            if (row) {
              await saveStory(rowToCanonical(row, []), row.user_id, { forceImmediate: true });
              await requestSyncNow(); // flush imediato do push
            }
          }
          // Destrava a status-bar (senão o banner 'conflict' fica grudado).
          lastConflict.current = null;
          emitSyncEvent('sync.conflict.resolved', { entityType, entityId });
        }}
      />
    </>
  );
}

export default DesktopShell;
