// O brainstorm da Home até o corkboard: o que "Build Your Story" leva, e a
// seed de chegada que é processada uma vez só. `craco test`.
import {
  MIN_BUILD_CHARS,
  brainstormForBuild,
  markSeedProcessed,
  seedDoneKey,
  seedStashKey,
  takeArrivalSeed,
} from './brainstormSeed';

const IDEA = "A detective discovers their partner is the serial killer they've been hunting...";

/** Storage em memória com a mesma superfície do sessionStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    has: (k: string) => map.has(k),
  };
}

describe('brainstormForBuild — o que o botão leva', () => {
  it('o roteirista escreveu: vai o texto dele, aparado', () => {
    expect(brainstormForBuild('  my own idea  ', true, IDEA)).toBe('my own idea');
  });

  it('campo intocado: vai a ideia de exemplo INTEIRA, mesmo com a animação no meio ou entre duas ideias', () => {
    expect(brainstormForBuild('A detective disc', false, IDEA)).toBe(IDEA);
    expect(brainstormForBuild('', false, IDEA)).toBe(IDEA);
  });

  it('focou o campo com a ideia pela metade: vale o que está visível (ele pode ter editado)', () => {
    expect(brainstormForBuild('A detective disc', true, IDEA)).toBe('A detective disc');
  });

  it('sem ideia de exemplo cai no texto do campo; as ideias de exemplo passam da régua mínima', () => {
    expect(brainstormForBuild('typed', false, undefined)).toBe('typed');
    expect(IDEA.length).toBeGreaterThanOrEqual(MIN_BUILD_CHARS);
  });
});

describe('takeArrivalSeed / markSeedProcessed — a seed de chegada no corkboard', () => {
  it('estado do router: devolve o brainstorm', () => {
    expect(takeArrivalSeed('s1', { justCreated: true, braindump: IDEA }, memoryStorage())).toBe(IDEA);
  });

  it('stash da sessão: cobre a perda do estado e é consumido na leitura', () => {
    const storage = memoryStorage({ [seedStashKey('s1')]: IDEA });
    expect(takeArrivalSeed('s1', null, storage)).toBe(IDEA);
    expect(storage.has(seedStashKey('s1'))).toBe(false);
    expect(takeArrivalSeed('s1', null, storage)).toBeNull();
  });

  it('o estado do router vence o stash, e o stash é limpo mesmo assim', () => {
    const storage = memoryStorage({ [seedStashKey('s1')]: 'stashed text' });
    expect(takeArrivalSeed('s1', { braindump: IDEA }, storage)).toBe(IDEA);
    expect(storage.has(seedStashKey('s1'))).toBe(false);
  });

  it('refresh depois de processar: o estado do router continua lá, mas a seed não volta (não duplica os cards)', () => {
    const storage = memoryStorage();
    const state = { justCreated: true, braindump: IDEA };
    expect(takeArrivalSeed('s1', state, storage)).toBe(IDEA);
    markSeedProcessed('s1', storage);
    expect(storage.getItem(seedDoneKey('s1'))).toBe('1');
    expect(takeArrivalSeed('s1', state, storage)).toBeNull();
    // A marca é por story: outra story nova segue normal.
    expect(takeArrivalSeed('s2', { braindump: 'another idea' }, storage)).toBe('another idea');
  });

  it('sem seed, seed em branco ou estado de outro formato: null', () => {
    expect(takeArrivalSeed('s1', { justCreated: true }, memoryStorage())).toBeNull();
    expect(takeArrivalSeed('s1', { braindump: '   ' }, memoryStorage())).toBeNull();
    expect(takeArrivalSeed('s1', { braindump: 42 }, memoryStorage())).toBeNull();
    expect(takeArrivalSeed(undefined, null, memoryStorage())).toBeNull();
  });

  it('storage indisponível ou lançando: o estado do router ainda entrega', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(takeArrivalSeed('s1', { braindump: IDEA }, broken)).toBe(IDEA);
    expect(takeArrivalSeed('s1', { braindump: IDEA }, null)).toBe(IDEA);
    expect(() => markSeedProcessed('s1', broken)).not.toThrow();
  });
});
