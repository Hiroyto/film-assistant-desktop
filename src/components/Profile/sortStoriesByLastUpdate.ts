// Ordena o mapa `works` (storyId -> story) do mais recentemente atualizado para o
// mais antigo. A grade de stories da Home e do Profile (StoryGrid) passa por aqui
// na hora de renderizar, para que a ordem NÃO dependa de quem montou o mapa:
// backend (/user), worksFromLocal (SQLite) ou setUser após create/delete.
//
// Regra de "last update" = a mesma do auto-load em App.tsx: `lastModified`, com
// fallback em `createdAt`. Sem nenhum dos dois (ou ambos inválidos), a story vai
// para o fim. Empates preservam a ordem de inserção do mapa (sort estável).

export interface LastUpdateFields {
  lastModified?: string | number | null;
  createdAt?: string | number | null;
}

/** ISO string ou epoch -> ms; null quando ausente/inválido. */
function toMillis(raw: string | number | null | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Instante do último update da story em ms (0 quando não há data utilizável). */
export function lastUpdateMillis(story: LastUpdateFields | null | undefined): number {
  if (!story) return 0;
  return toMillis(story.lastModified) ?? toMillis(story.createdAt) ?? 0;
}

/** Entries `[storyId, story]` do mapa, da mais recente para a mais antiga. */
export function sortStoriesByLastUpdate<T extends LastUpdateFields>(
  works: Record<string, T>,
): Array<[string, T]> {
  return Object.entries(works).sort(
    (a, b) => lastUpdateMillis(b[1]) - lastUpdateMillis(a[1]),
  );
}
