// brainstormSeed — o caminho do brainstorm da Home até o primeiro processamento
// no corkboard ("Build Your Story"). Puro, com storage injetável, para testar
// sem montar a Home nem o board.
//
// Home: o botão constrói a partir do que o roteirista escreveu OU, se ele nunca
// tocou no campo, da ideia de exemplo INTEIRA que está se digitando sozinha ali
// (a animação pode estar no meio de uma palavra, ou entre duas ideias).
//
// Corkboard: ao chegar, o texto entra no campo do braindump e é processado na
// hora, UMA vez. O estado do router sobrevive a um refresh e ao voltar/avançar
// do histórico, então sem a marca de "já processado" cada recarga refaria a
// extração e duplicaria os cards.

/** Mínimo de caracteres para "Build Your Story" (a mesma régua de sempre da Home). */
export const MIN_BUILD_CHARS = 50;

/** O texto que "Build Your Story" leva para o corkboard. */
export function brainstormForBuild(text: string, userHasInteracted: boolean, examplePrompt: string | undefined): string {
  return (userHasInteracted ? text : examplePrompt ?? text).trim();
}

type SeedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Onde a Home estaciona o brainstorm (cinto para quando o estado do router se perde). */
export const seedStashKey = (storyId: string): string => `ff-braindump-seed:${storyId}`;
/** Marca de sessão: o brainstorm desta story já foi mandado para a extração. */
export const seedDoneKey = (storyId: string): string => `ff-braindump-seed-done:${storyId}`;

function safeSession(): SeedStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage bloqueado
  }
}

/**
 * A seed de chegada ao corkboard: o estado do router (caminho rápido) ou o
 * stash da sessão, que é consumido na leitura. null quando não há seed, ou
 * quando o brainstorm desta story já foi processado nesta sessão.
 */
export function takeArrivalSeed(
  storyId: string | undefined,
  routerState: unknown,
  storage: SeedStorage | null = safeSession(),
): string | null {
  let stashed: string | null = null;
  let done = false;
  if (storyId && storage) {
    try {
      stashed = storage.getItem(seedStashKey(storyId));
      if (stashed) storage.removeItem(seedStashKey(storyId));
      done = storage.getItem(seedDoneKey(storyId)) === '1';
    } catch {
      /* modo privado: o estado do router é o único caminho */
    }
  }
  if (done) return null;
  const fromState = (routerState as { braindump?: unknown } | null | undefined)?.braindump;
  const seed = typeof fromState === 'string' && fromState.trim() ? fromState : stashed;
  return seed && seed.trim() ? seed : null;
}

/** Marca o brainstorm da story como processado; chamar quando a extração automática dispara. */
export function markSeedProcessed(storyId: string, storage: SeedStorage | null = safeSession()): void {
  try {
    storage?.setItem(seedDoneKey(storyId), '1');
  } catch {
    /* modo privado: sem marca, um refresh na chegada repete a extração */
  }
}
