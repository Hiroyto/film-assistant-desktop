// Persistência do screenplay (BC-03 / AD-01). Inverte para local-first:
//   • SQLite local guarda o HTML (BLOB) — substitui localStorage (BR-MIGRAR-035).
//   • Load priority: SQLite > React state > S3 (BR-MIGRAR-036). S3 só no 1º device/recover.
//   • Save: write SQLite imediato + enfileira push S3 com retry/erro (BR-MIGRAR-034 —
//     substitui o fire-and-forget que mascarava erros).
// A LÓGICA DO EDITOR TIPTAP NÃO é tocada (RISK-002). Aqui é só persistência.
import { screenplayRepo } from '../../../data/local-db/repositories';
import { enqueueMutation } from '../../../data/sync-queue';
import { isDesktop } from '../../../lib/ipcClient';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeHtml(html: string): Uint8Array {
  return enc.encode(html);
}
export function decodeHtml(buf: Uint8Array | null | undefined): string {
  return buf ? dec.decode(buf) : '';
}

/**
 * Decisão pura da prioridade de carga (BR-MIGRAR-036): SQLite local > React state.
 * (S3 é tratado fora, só como fallback assíncrono.) Retorna a fonte escolhida.
 */
export function chooseScreenplaySource(localHtml: string | null, stateHtml: string | null): string | null {
  if (localHtml != null && localHtml !== '') return localHtml;
  if (stateHtml != null && stateHtml !== '') return stateHtml;
  return null;
}

export interface LoadOptions {
  /** HTML atual no React state (fallback intermediário). */
  stateHtml?: string | null;
  /** Busca o HTML no S3 (último recurso — 1º device / recover). */
  fetchFromS3?: () => Promise<string | null>;
}

/** Carrega o screenplay respeitando a prioridade SQLite > state > S3. */
export async function loadScreenplay(storyId: string, opts: LoadOptions = {}): Promise<string> {
  let localHtml: string | null = null;
  if (isDesktop()) {
    const row = await screenplayRepo.getScreenplay(storyId);
    localHtml = decodeHtml(row?.html_content);
  }
  const chosen = chooseScreenplaySource(localHtml, opts.stateHtml ?? null);
  if (chosen != null) return chosen;

  // Último recurso: S3.
  if (opts.fetchFromS3) {
    const s3 = await opts.fetchFromS3();
    if (s3) {
      // Hidrata o local com o que veio do S3.
      if (isDesktop()) await persistLocal(storyId, s3);
      return s3;
    }
  }
  return '';
}

async function persistLocal(storyId: string, html: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await screenplayRepo.getScreenplay(storyId);
  await screenplayRepo.upsertScreenplay({
    story_id: storyId,
    html_content: encodeHtml(html),
    version: existing?.version ?? 1,
    updated_at: now,
    synced_at: existing?.synced_at ?? null,
  });
}

/**
 * Salva o screenplay: write local imediato (verdade) + enfileira push S3 (BR-MIGRAR-034).
 * O push-worker (BC-08) faz retry/erro — não é mais fire-and-forget.
 *
 * O payload enfileirado espelha EXATAMENTE o contrato da Lambda legada
 * (`save-screenplay`): { event, userId, storyId, screenplayContent }. O push-worker
 * envia `JSON.parse(payload)` verbatim ao `/works`, então os nomes de campo têm de
 * bater com o que a Lambda lê — `screenplayContent` (não `html`) e `userId` presente.
 */
export async function saveScreenplay(storyId: string, html: string, userId: string): Promise<void> {
  if (isDesktop()) {
    await persistLocal(storyId, html);
  }
  await enqueueMutation({
    entityType: 'screenplay',
    entityId: storyId,
    operation: 'update',
    payload: { event: 'save-screenplay', userId, storyId, screenplayContent: html },
  });
}

/**
 * Espelha o HTML do screenplay no SQLite local (desktop) SEM enfileirar push S3 —
 * o writer de backend continua sendo o save legado (localStorage + S3). Strangler
 * Fig. No-op fora do desktop. Best-effort.
 */
export async function mirrorScreenplayToLocal(storyId: string, html: string): Promise<void> {
  if (!isDesktop() || !storyId) return;
  await persistLocal(storyId, html);
}
