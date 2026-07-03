// Initial pull — primeira carga DDB/S3 -> SQLite no primeiro login desktop.
// Fonte: data_migration_plan.md §Fluxo — Initial pull + §Verificação pós-corte.
//
// Orquestra GET /user + GET /works, aplica transforms (T-01..T-08) e grava nas tabelas
// locais via interfaces INJETADAS (repos + http). As implementações concretas (better-sqlite3
// repositories, safeApiCall) chegam nas Tarefas 05/07 — aqui dependemos só de contratos.
//
// Screenplays NÃO são baixados aqui (volume): pull lazy quando o user abre a story
// no editor (Tarefa 11), via fetchScreenplayOnDemand.

import {
  RawUser,
  RawStory,
  mapUserToRow,
  mapUserToSubscriptionRow,
  mapStoryToRow,
  normalizeCharacters,
  deriveMfaConfigured,
} from './transforms';
import type {
  UserRow,
  SubscriptionRow,
  StoryRow,
  CharacterRow,
} from '../local-db/rows';

// --- Contratos injetados ----------------------------------------------------

export interface InitialPullHttp {
  /** GET /user */
  getUser(): Promise<RawUser>;
  /** GET /works — metadata das stories (sem screenplay HTML). */
  getWorks(): Promise<RawStory[]>;
  /** Estado MFA do Cognito (fetchAuthSession). Para T-04. */
  getMfaState(): Promise<{ mfaConfiguration: string | null; hasTotpEnrolled: boolean }>;
}

export interface InitialPullRepos {
  /** Detecta primeiro login deste user no desktop (users table sem o user_id). */
  isUserPresent(userId: string): Promise<boolean> | boolean;
  upsertUser(row: UserRow): Promise<void> | void;
  upsertSubscription(row: SubscriptionRow): Promise<void> | void;
  upsertStory(row: StoryRow): Promise<void> | void;
  /** Substitui todas as characters de uma story (1 row por character name). */
  replaceCharactersForStory(storyId: string, rows: CharacterRow[]): Promise<void> | void;
  /** Marca users.synced_at = at. */
  markUserSynced(userId: string, at: string): Promise<void> | void;
}

export interface InitialPullHooks {
  /** Clock injetável (default = agora). */
  now?: () => string;
  warn?: (msg: string) => void;
  /** Emitido ao concluir — unlock da UI (sync.initial_pull.completed). */
  onCompleted?: (report: InitialPullReport) => void;
}

export interface InitialPullReport {
  userId: string;
  startedAt: string;
  completedAt: string;
  worksReportedCount: number; // GET /works.length
  storiesPulled: number;
  charactersPulled: number;
  charactersDropped: number;
  /** Integridade: storiesPulled === worksReportedCount (§Verificação pós-corte). */
  integrityOk: boolean;
}

// --- Orquestração ------------------------------------------------------------

/**
 * Executa o initial pull para `userId`. Idempotente o bastante para re-rodar
 * (upserts). Retorna um relatório de integridade.
 *
 * @param force ignora a checagem de primeiro-login (re-sincroniza tudo).
 */
export async function runInitialPull(
  userId: string,
  http: InitialPullHttp,
  repos: InitialPullRepos,
  hooks: InitialPullHooks = {},
): Promise<InitialPullReport> {
  const now = hooks.now ?? (() => new Date().toISOString());
  const warn = hooks.warn ?? (() => {});
  const startedAt = now();

  // 1+2+3 — User
  const [rawUser, mfa] = await Promise.all([http.getUser(), http.getMfaState()]);
  const ts = now();
  const mfaConfigured = deriveMfaConfigured(mfa.mfaConfiguration, mfa.hasTotpEnrolled);
  await repos.upsertUser(mapUserToRow(rawUser, { userId, mfaConfigured, now: ts }));
  await repos.upsertSubscription(mapUserToSubscriptionRow(rawUser, { userId, now: ts }));

  // 4+5+6 — Stories + Characters
  const works = await http.getWorks();
  let storiesPulled = 0;
  let charactersPulled = 0;
  let charactersDropped = 0;

  for (const rawStory of works) {
    try {
      const storyRow = mapStoryToRow(rawStory, { userId, now: now() });
      await repos.upsertStory(storyRow);

      const { rows, dropped } = normalizeCharacters(
        rawStory.characters,
        storyRow.story_id,
        now(),
        warn,
      );
      await repos.replaceCharactersForStory(storyRow.story_id, rows);

      storiesPulled++;
      charactersPulled += rows.length;
      charactersDropped += dropped;
    } catch (err) {
      // Uma story malformada não aborta o pull inteiro (resiliência).
      warn(`[initial-pull] story ignorada por erro: ${(err as Error).message}`);
    }
  }

  // 8 — Status
  const completedAt = now();
  await repos.markUserSynced(userId, completedAt);

  const report: InitialPullReport = {
    userId,
    startedAt,
    completedAt,
    worksReportedCount: works.length,
    storiesPulled,
    charactersPulled,
    charactersDropped,
    integrityOk: storiesPulled === works.length,
  };

  if (!report.integrityOk) {
    warn(
      `[initial-pull] integridade: ${storiesPulled}/${works.length} stories gravadas ` +
        `(esperado igual). Ver §Validação de qualidade.`,
    );
  }

  hooks.onCompleted?.(report);
  return report;
}

/**
 * Detecta se o user precisa de initial pull (primeiro login desktop).
 * Trigger documentado em data_migration_plan.md §Fluxo — Initial pull.
 */
export async function needsInitialPull(
  userId: string,
  repos: Pick<InitialPullRepos, 'isUserPresent'>,
): Promise<boolean> {
  return !(await repos.isUserPresent(userId));
}
