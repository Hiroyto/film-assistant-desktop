// FdxCoworkControl — controle do cowork .fdx DENTRO do corkboard. Vincula o
// motor headless (lib/fdxSync) à story aberta e expõe o mesmo vocabulário do
// auto-sync do editor de roteiro: Auto-sync on/off, "Sync now", status. Com o
// watch ativo, cada save do Final Draft vira save + extração por cena no board
// real — o FdxBoard read-only deixa de ser necessário aqui.
import React, { useCallback, useEffect, useRef } from 'react';
import { flushPushNow } from '../../data/desktop-lifecycle';
import { bindFdxSync, openFdxSync, resolveMissingScene, setFdxAuto, stopFdxSync, syncFdxNow } from '../../lib/fdxSync';
import { useFdxSync } from './useFdxSync';

interface Props {
  storyId: string;
  auth: { userId: string; token: string } | null;
  /** Uma rodada de sync terminou (cards novos/salvos) — o board deve refetchar. */
  onSynced?: () => void;
  /** O motor enfileirou um job de IA (braindump) — o board mostra o MESMO
   *  loading/meter de um braindump próprio (trackExternalBraindump). */
  onAiJob?: (braindumpId: string, proseLength: number) => void;
}

function hhmmss(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

const FONT = 'ui-sans-serif, system-ui, sans-serif';
const btnPrimary: React.CSSProperties = {
  background: '#e67e22', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px',
  fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,0.35)', fontSize: 13,
};
const btnSmall: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
};

export function FdxCoworkControl({ storyId, auth, onSynced, onAiJob }: Props): JSX.Element {
  const snap = useFdxSync();
  const lastSyncSeen = useRef<string | undefined>(undefined);
  const lastAiJobSeen = useRef<string | undefined>(undefined);

  // Job de IA novo (ou já em voo ao montar o board) → liga o loading do board.
  useEffect(() => {
    const id = snap.pending?.braindumpId;
    if (id && id !== lastAiJobSeen.current) {
      lastAiJobSeen.current = id;
      onAiJob?.(id, snap.pending?.proseLength ?? 0);
    }
  }, [snap.pending?.braindumpId, snap.pending?.proseLength, onAiJob]);

  // Vincula o motor à story deste corkboard (auth renovada a cada mudança).
  useEffect(() => { bindFdxSync(storyId, auth); }, [storyId, auth]);

  // Rodada terminou → o board refetcha (cards novos aparecem sem esperar o poll).
  useEffect(() => {
    if (snap.lastSyncAt && snap.lastSyncAt !== lastSyncSeen.current) {
      lastSyncSeen.current = snap.lastSyncAt;
      onSynced?.();
    }
  }, [snap.lastSyncAt, onSynced]);

  const start = useCallback(async () => {
    try {
      await flushPushNow(); // o freeform nega escrita de story ainda não registrada no /works
    } catch { /* best-effort */ }
    await openFdxSync();
  }, []);

  // Os BOTÕES (inativo) ficam à direita, junto do zoom/import; a JANELA do
  // cowork (ativo) vai para a ESQUERDA, para não disputar espaço com eles.
  const wrapButtons: React.CSSProperties = {
    position: 'fixed', right: 20, bottom: 66, zIndex: 129, display: 'flex', flexDirection: 'column',
    alignItems: 'flex-end', gap: 6, fontFamily: FONT,
  };
  const wrapPanel: React.CSSProperties = { ...wrapButtons, right: undefined, left: 20, alignItems: 'flex-start' };

  // ---- Inativo: só o botão de abrir o cowork -------------------------------
  if (!snap.active) {
    return (
      <div style={wrapButtons}>
        <button
          type="button"
          onClick={() => void start()}
          title="Watch a Final Draft (.fdx) screenplay: every save becomes a per-scene save + extraction on this board, like the script editor's auto-sync"
          style={btnPrimary}
        >
          ⬇ Open .fdx (cowork)
        </button>
      </div>
    );
  }

  // ---- Ativo: painel de status + controles -------------------------------
  const dotColor = snap.status === 'syncing' || snap.pending ? '#5dd4c8' : snap.status === 'error' ? '#ef4444' : snap.dirty ? '#eab308' : '#4ecdc4';
  const statusLine = snap.status === 'syncing'
    ? `Syncing…${snap.progress ? ` ${snap.progress.done}/${snap.progress.total}` : ''}`
    : snap.status === 'error'
      ? `Error: ${snap.lastError || 'sync run failed'}`
      : snap.pending
        ? `AI extracting ${snap.pending.count} new scene(s)… since ${hhmmss(snap.pending.since)}`
        : snap.dirty
          ? 'File changed — waiting for Sync'
          : snap.lastSyncAt
            ? `Synced ${hhmmss(snap.lastSyncAt)}`
            : 'Waiting for the first sync';
  const run = snap.lastRun;

  return (
    <div style={wrapPanel}>
      <div
        style={{
          width: 320, background: '#1f1f22', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
          padding: 12, color: 'rgba(255,255,255,0.9)', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor, transition: 'background 200ms' }} />
            .fdx cowork
          </strong>
          <button
            type="button"
            onClick={() => void stopFdxSync()}
            style={{ background: 'transparent', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer', padding: 2, fontSize: 12 }}
          >
            stop
          </button>
        </div>

        <div style={{ opacity: 0.7, marginBottom: 4, wordBreak: 'break-all' }}>{snap.fileName}{snap.title ? ` · “${snap.title}”` : ''}</div>
        <div style={{ marginBottom: 6 }}>
          <strong>{snap.sceneCount}</strong> scenes in file · {snap.mappedCount} on board
          {snap.cardCount && snap.cardCount !== snap.mappedCount ? ` (${snap.cardCount} cards)` : ''}
          {snap.missing.length ? <> · <span style={{ color: '#eab308' }}>{snap.missing.length} missing</span></> : null}
        </div>
        <div style={{ marginBottom: 8, color: snap.status === 'error' ? '#f87171' : 'rgba(255,255,255,0.8)' }}>{statusLine}</div>
        {snap.status !== 'error' && snap.lastError ? (
          // Aviso não-fatal (job de IA expirou / cooldown): a rodada terminou, mas há cenas esperando.
          <div style={{ marginBottom: 8, color: '#eab308' }}>{snap.lastError}</div>
        ) : null}
        {run ? (
          <div style={{ opacity: 0.6, marginBottom: 8 }}>
            last run: {run.enqueuedForAi ? `${run.enqueuedForAi} sent to AI · ` : ''}
            {run.adoptedFromAi ? `${run.adoptedFromAi} from AI · ` : ''}
            {run.attached ? `${run.attached} merged into AI cards · ` : ''}
            {run.adopted ? `${run.adopted} adopted · ` : ''}
            {run.saved} saved · {run.extracted} extracted
            {run.renamed ? ` · ${run.renamed} renamed` : ''}
            {run.errors ? ` · ${run.errors} errors` : ''}
          </div>
        ) : null}
        {snap.missing.length ? (
          // O fluxo do editor para cena apagada: Keep (slot não-escrito) ou Trash
          // (soft-delete). Nada automático — o roteirista decide, cena a cena.
          <details open style={{ marginBottom: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#eab308' }}>
              {snap.missing.length} scene(s) missing from the file — keep or trash?
            </summary>
            <ul style={{ margin: '6px 0 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {snap.missing.map((m) => {
                const busy = snap.resolvingIds.includes(m.recordId);
                return (
                  <li key={m.recordId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }} title={m.sharedCard ? `${m.heading} — part of a card shared with other scenes` : m.heading}>
                      {m.heading}{m.sharedCard ? ' (shared card)' : ''}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { void resolveMissingScene(m.recordId, 'keep').then(() => onSynced?.()); }}
                      title={m.sharedCard
                        ? 'Keep the card; this scene\'s text leaves its pages'
                        : 'Keep the card as an unwritten outline slot (its pages are cleared, like deleting a scene\'s text in the script editor)'}
                      style={{ ...btnSmall, padding: '3px 7px', opacity: busy ? 0.5 : 1 }}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { void resolveMissingScene(m.recordId, 'trash').then(() => onSynced?.()); }}
                      title={m.sharedCard
                        ? 'Drop this scene from the shared card (the card stays)'
                        : 'Move the card to the board\'s Trash (soft-delete, recoverable)'}
                      style={{ ...btnSmall, padding: '3px 7px', color: '#f87171', opacity: busy ? 0.5 : 1 }}
                    >
                      Trash
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setFdxAuto(!snap.auto)}
            title={snap.auto
              ? 'Auto-sync is on: every Final Draft save updates the board. Click to switch to manual.'
              : 'Auto-sync is off: the board only updates on Sync now. Click to turn it back on.'}
            style={{ ...btnSmall, color: snap.auto ? 'rgba(255,255,255,0.85)' : '#eab308' }}
          >
            {snap.auto ? 'Auto-sync on' : 'Auto-sync off'}
          </button>
          <button
            type="button"
            onClick={() => void syncFdxNow()}
            disabled={snap.status === 'syncing'}
            title="Run a sync now with the latest snapshot of the file"
            style={{ ...btnPrimary, padding: '5px 10px', fontSize: 12, boxShadow: 'none', opacity: snap.status === 'syncing' ? 0.6 : 1 }}
          >
            {snap.status === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FdxCoworkControl;
