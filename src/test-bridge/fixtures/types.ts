// Tipos do subsistema de roteamento de fixtures (parity — 19D). Os parity specs
// navegam para `/?screen=<tela>&fixture=<nome>&segment=<id>`; este subsistema
// (somente em modo teste) lê esses params, semeia o estado e monta a tela alvo.
import type { User } from '../../models/user';
import type { StoryRow, CharacterRow, SnapshotRow } from '../../data/local-db/rows';

/** Pedido decodificado da query string (`?screen=…&fixture=…&segment=…`). */
export interface FixtureRequest {
  screen: string | null;
  fixture: string | null;
  segment: string | null;
}

/** Intenção de montagem de uma tela: rota react-router + sub-view + se exige auth. */
export interface ScreenSpec {
  /** Path do react-router para onde navegar. */
  route: string;
  /** Telas protegidas exigem auth (bypassada em modo teste). */
  requiresAuth: boolean;
  /** Sub-view dentro da rota (ex.: 'characters'|'outline' dentro de /home). */
  subview?: string;
}

/** Semente de banco local (linhas SQLite) de uma fixture. */
export interface DbSeed {
  stories?: StoryRow[];
  characters?: CharacterRow[];
  /** Snapshots pré-sync/pré-conflito (spec 12 t18). */
  snapshots?: SnapshotRow[];
  /** Nº de mutations pendentes a enfileirar (profundidade da sync_queue). */
  queueDepth?: number;
  /** id da story ativa após semear. */
  activeStoryId?: string;
}

/** Especificação declarativa de uma fixture. */
export interface FixtureSpec {
  /** Patch ao usuário corrente (cap/subscription/…). */
  user?: Partial<User>;
  /** Semente de banco local. */
  db?: DbSeed;
  /** Estado em memória que componentes/specs interpretam (conflito aberto, etc). */
  hint?: string;
}

/** Plano resolvido e pronto para aplicar (saída pura de buildSeedPlan). */
export interface SeedPlan {
  user: Partial<User>;
  stories: StoryRow[];
  characters: CharacterRow[];
  snapshots: SnapshotRow[];
  queueDepth: number;
  activeStoryId: string | null;
  hint: string | null;
}
