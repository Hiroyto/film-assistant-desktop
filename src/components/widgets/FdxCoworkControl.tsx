// FdxCoworkControl — controle do cowork .fdx DENTRO do corkboard. Vincula o
// motor headless (lib/fdxSync) à story aberta e expõe o mesmo vocabulário do
// auto-sync do editor de roteiro: Auto-sync on/off, "Sync now", status. Com o
// watch ativo, cada save do Final Draft vira save + extração por cena no board
// real — o FdxBoard read-only deixa de ser necessário aqui.
//
// A janela também é o DOCKET do cowork: as perguntas que as páginas levantaram
// (o strip do Placement Control, "Things to confirm…") aparecem aqui com as
// mesmas linhas e as mesmas lanes de resposta do painel direito, para o
// roteirista que está no Final Draft responder sem abrir o painel.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushPushNow } from '../../data/desktop-lifecycle';
import { bindFdxSync, openFdxSync, resolveMissingScene, setFdxAuto, stopFdxSync, syncFdxNow } from '../../lib/fdxSync';
import type { BraindumpLogEntry } from '../../lib/freeformApi';
import { BD_ORANGE, StagedRow, type StagedStripRow } from '../Freeform/corkboard/panels';
import { useFdxSync } from './useFdxSync';

/** O strip do board, emprestado à janela do cowork: as MESMAS linhas (já
 *  ordenadas) e as MESMAS lanes de resposta que o painel direito recebe. A
 *  janela filtra sozinha o que é do cowork (ver `coworkRows`). */
export interface CoworkStrip {
  rows: StagedStripRow[];
  /** Log de braindumps com a prose — o pin "In your words" de cada linha. */
  braindumps: BraindumpLogEntry[] | null;
  onAnswer: (cardId: string, answer: 'merge' | 'keep' | 'convert' | 'replace') => void;
  /** Expandir uma linha foca o alvo dela no board (a wall); (null, null) solta. */
  onSpotlight: (cardId: string | null, targetId: string | null) => void;
  /** false enquanto o painel direito é dono do spotlight (ele cobre esta janela). */
  spotlight: boolean;
  /** Spine drop: arrastar uma linha "Where does it go?" abre a grade de
   *  posicionamento no board; a janela some (montada) até o dragend. */
  onPlaceDragStart?: (cardId: string) => void;
  onPlaceDragEnd?: () => void;
  /** Order ask: confirmar o slot em que a cena já aparece na sequência. */
  onConfirmSlot?: (cardId: string) => void;
  onOpenCard: (cardId: string) => void;
  /** Montada mas invisível durante um spine drop (a origem do drag precisa
   *  sobreviver para entregar o dragend). */
  hidden?: boolean;
}

interface Props {
  storyId: string;
  auth: { userId: string; token: string } | null;
  /** Uma rodada de sync terminou (cards novos/salvos) — o board deve refetchar. */
  onSynced?: () => void;
  /** O motor enfileirou um job de IA (braindump) — o board mostra o MESMO
   *  loading/meter de um braindump próprio (trackExternalBraindump). */
  onAiJob?: (braindumpId: string, proseLength: number) => void;
  /** As perguntas do strip + lanes de resposta (o board é quem as tem). */
  strip?: CoworkStrip;
}

/** Abre o seletor de .fdx e liga o cowork na story vinculada. Chamado pelo
 *  link do empty state do board (no lugar do import de PDF); em board que já
 *  tem cards, a entrada é o menu File → Open Screenplay (.fdx)…, que vai
 *  direto ao openFdxSync (FdxCoworkPanel). */
export async function startFdxCowork(): Promise<void> {
  try {
    await flushPushNow(); // o freeform nega escrita de story ainda não registrada no /works
  } catch { /* best-effort */ }
  await openFdxSync();
}

function hhmmss(iso?: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

/** Uma linha do strip é DO COWORK quando o braindump que a levantou foi um
 *  job do motor (`fdx_…`) ou quando o card em questão é composto por alguma
 *  cena do arquivo (perguntas da extração por cena sobre um card mapeado). */
export function isCoworkStripRow(row: StagedStripRow, mappedEventIds: ReadonlySet<string>): boolean {
  return String(row.sourceBraindumpId ?? '').startsWith('fdx_') || mappedEventIds.has(row.cardId);
}

/** O card que uma linha expandida foca no board — o mesmo cálculo do painel:
 *  o alvo da comparação; senão, para altitude/ordem em card VIVO, o próprio
 *  card (uma pergunta sobre a forma dele). Cards retidos não estão na wall. */
function spotlightTargetOf(row: StagedStripRow | undefined): string | null {
  if (!row) return null;
  if (row.target?.id) return row.target.id;
  const selfFocus = (row.questionType === 'altitude' || row.questionType === 'unplaced') && !row.held;
  return selfFocus ? row.cardId : null;
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

export function FdxCoworkControl({ storyId, auth, onSynced, onAiJob, strip }: Props): JSX.Element | null {
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

  // ---- O docket do cowork -------------------------------------------------
  // As linhas do strip que as páginas levantaram, na ordem do board. Chegam
  // FECHADAS (uma linha por pergunta): a janela anuncia, o roteirista escolhe
  // quando responder — a wall só toma o board quando ele expande uma linha
  // (a regra do receipt, Ben 2026-09-09: nada abre sozinho sobre o board).
  const stripRows = strip?.rows;
  const coworkRows = useMemo(() => {
    if (!stripRows || !snap.active) return [] as StagedStripRow[];
    const mapped = new Set(snap.mappedEventIds);
    return stripRows.filter((r) => isCoworkStripRow(r, mapped));
  }, [stripRows, snap.mappedEventIds, snap.active]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Linha respondida em outro lugar (o painel, um drop) some do docket: fecha.
  useEffect(() => {
    if (expandedId && !coworkRows.some((r) => r.cardId === expandedId)) setExpandedId(null);
  }, [coworkRows, expandedId]);
  // Responder avança para a próxima pergunta (a gramática do painel): o
  // roteirista está engajado, a fila anda.
  const answerAndAdvance = (cardId: string, answer: 'merge' | 'keep' | 'convert' | 'replace'): void => {
    const i = coworkRows.findIndex((r) => r.cardId === cardId);
    const next = coworkRows.find((r, j) => j > i && r.cardId !== cardId) ?? coworkRows.find((r) => r.cardId !== cardId) ?? null;
    setExpandedId(next ? next.cardId : null);
    strip?.onAnswer(cardId, answer);
  };
  // Spotlight: a linha expandida foca o alvo dela no board, como no painel —
  // e aqui o board está VISÍVEL ao lado da janela, então a comparação é real.
  const expandedRow = expandedId ? coworkRows.find((r) => r.cardId === expandedId) : undefined;
  const spotlightTargetId = spotlightTargetOf(expandedRow);
  const spotlightOn = !!strip?.spotlight && !strip?.hidden;
  const spotlightLive = spotlightOn && !!expandedId && !!spotlightTargetId;
  const onSpotlight = strip?.onSpotlight;
  useEffect(() => {
    if (!onSpotlight) return;
    onSpotlight(spotlightLive ? expandedId : null, spotlightLive ? spotlightTargetId : null);
  }, [onSpotlight, spotlightLive, expandedId, spotlightTargetId]);
  // Solta o spotlight ao desmontar (o cowork parou / o board saiu de cena).
  // Ref-held para o cleanup rodar uma vez, não a cada identidade do callback.
  const spotlightRef = useRef(onSpotlight);
  useEffect(() => { spotlightRef.current = onSpotlight; }, [onSpotlight]);
  useEffect(() => () => { spotlightRef.current?.(null, null); }, []);

  // A JANELA do cowork (ativo) fica à ESQUERDA, para não disputar espaço com
  // o zoom à direita. Com uma linha focada, a wall (z 130–150) toma o board:
  // a janela sobe para ficar clicável em cima dela (abaixo do painel, z 180).
  const wrapPanel: React.CSSProperties = {
    position: 'fixed', left: 20, bottom: 66, zIndex: spotlightLive ? 160 : 129, display: 'flex', flexDirection: 'column',
    alignItems: 'flex-start', gap: 6, fontFamily: FONT,
    // Spine drop em andamento: invisível e intocável, mas montada (a origem
    // do drag precisa sobreviver para entregar o dragend).
    ...(strip?.hidden ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}),
  };

  // ---- Inativo: nada flutuando — o "Open .fdx" vive no empty state do board
  // (startFdxCowork). Os effects acima continuam vinculando o motor à story.
  if (!snap.active) return null;

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
  // A prose do braindump que mintou a linha (o pin "In your words"): o id da
  // própria linha, senão a entrada de proveniência cujo id embute o card.
  const proseFor = (row: StagedStripRow): string | undefined => (
    strip?.braindumps?.find((b) => b.braindumpId === row.sourceBraindumpId)
      ?? strip?.braindumps?.find((b) => b.braindumpId.includes(row.cardId))
  )?.prose;
  const placeDragStart = strip?.onPlaceDragStart;
  const confirmSlot = strip?.onConfirmSlot;

  return (
    <div style={wrapPanel}>
      <div
        style={{
          // As linhas do strip foram desenhadas para a gaveta do painel (~384px
          // úteis): a janela alarga enquanto houver perguntas.
          width: coworkRows.length ? 380 : 320,
          background: '#1f1f22', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
          padding: 12, color: 'rgba(255,255,255,0.9)', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          transition: 'width 160ms ease-out',
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
          {coworkRows.length ? <> · <span style={{ color: BD_ORANGE }}>{coworkRows.length} to confirm</span></> : null}
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

        {strip && coworkRows.length ? (
          // O strip do Placement Control, aqui: as perguntas que as páginas
          // levantaram e que só o roteirista resolve. Mesma linha, mesmas
          // respostas do painel direito; responder aqui É responder lá.
          <details open style={{ marginBottom: 10 }} data-tour="cowork-staged">
            <summary style={{ cursor: 'pointer' }}>
              <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: BD_ORANGE, fontWeight: 700 }}>
                Things to confirm from your last sync
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginLeft: 8 }}>{coworkRows.length}</span>
            </summary>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.5)', margin: '4px 0 2px' }}>
              Questions your pages raised that only you can settle: a beat that looks like one already on the board,
              a scene that might be a sequence, a card with no obvious place. Nothing changes until you answer.
              There is no deadline.
            </div>
            <div style={{ maxHeight: '46vh', overflowY: 'auto', paddingRight: 2 }}>
              {coworkRows.map((row) => (
                <StagedRow
                  key={row.cardId}
                  row={row}
                  expanded={expandedId === row.cardId}
                  onToggle={() => setExpandedId((cur) => (cur === row.cardId ? null : row.cardId))}
                  onAnswer={(answer) => answerAndAdvance(row.cardId, answer)}
                  onOpenCard={strip.onOpenCard}
                  onPlaceDragStart={placeDragStart ? () => placeDragStart(row.cardId) : undefined}
                  onConfirmSlot={confirmSlot ? () => confirmSlot(row.cardId) : undefined}
                  onPlaceDragEnd={strip.onPlaceDragEnd}
                  sourceProse={proseFor(row)}
                  dark
                />
              ))}
            </div>
          </details>
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
