import { fdxToEntities, parseSlugline } from './fdxToEntities';

// FdxScene/FdxPayload são tipos globais (src/electron.d.ts); montamos payloads
// mínimos aqui.
const scene = (index: number, number: string, heading: string, snippet = '', characters: string[] = []): FdxScene => ({
  index,
  number,
  heading,
  snippet,
  lineCount: snippet ? 1 : 0,
  characters,
});

const payload = (scenes: FdxScene[]): FdxPayload => ({
  path: '/tmp/x.fdx',
  fileName: 'x.fdx',
  ok: true,
  sceneCount: scenes.length,
  paragraphCount: scenes.length,
  scenes,
  fullText: '',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('parseSlugline', () => {
  it('quebra INT. LOCAL - TEMPO', () => {
    expect(parseSlugline('INT. COFFEE SHOP - DAY')).toEqual({
      intExt: 'INT',
      location: 'COFFEE SHOP',
      time: 'DAY',
    });
  });

  it('reconhece EXT', () => {
    expect(parseSlugline('EXT. STREET - NIGHT').intExt).toBe('EXT');
  });

  it('reconhece INT/EXT e I/E', () => {
    expect(parseSlugline('INT./EXT. CAR - DAY').intExt).toBe('INT/EXT');
    expect(parseSlugline('I/E CAR - DAY').intExt).toBe('INT/EXT');
  });

  it('sem prefixo -> UNKNOWN, heading vira location', () => {
    expect(parseSlugline('SOMEWHERE ODD')).toEqual({ intExt: 'UNKNOWN', location: 'SOMEWHERE ODD', time: undefined });
  });

  it('sem tempo -> time indefinido', () => {
    const r = parseSlugline('INT. NEWSROOM');
    expect(r.location).toBe('NEWSROOM');
    expect(r.time).toBeUndefined();
  });
});

describe('fdxToEntities', () => {
  it('mapeia cada cena para um event', () => {
    const m = fdxToEntities(payload([
      scene(0, '1', 'INT. NEWSROOM - NIGHT', 'Mara reads.'),
      scene(1, '2', 'EXT. STREET - DAY', 'Rain.'),
    ]));
    expect(m.events).toHaveLength(2);
    expect(m.events[0].entity.type).toBe('event');
    // título prefixado com o nº da cena (nomes únicos para o dedup do backend)
    expect(m.events[0].entity.working_title).toBe('1. INT. NEWSROOM - NIGHT');
    expect(m.events[0].entity.summary).toBe('Mara reads.');
    // occurs_in aponta para o location derivado
    expect((m.events[0].entity as any).occurs_in).toEqual([m.locations.find((l) => l.entity.working_name === 'NEWSROOM')!.entity.id]);
  });

  it('cenas com heading repetido viram eventos DISTINTOS (nº no título)', () => {
    const m = fdxToEntities(payload([
      scene(0, '1', 'INT. WAREHOUSE - NIGHT'),
      scene(1, '12', 'INT. WAREHOUSE - NIGHT'),
    ]));
    expect(m.events).toHaveLength(2);
    const titles = m.events.map((e) => e.entity.working_title);
    expect(titles).toEqual(['1. INT. WAREHOUSE - NIGHT', '12. INT. WAREHOUSE - NIGHT']);
    expect(new Set(titles).size).toBe(2); // nomes únicos -> 2 cards no backend
    // mas o local é o MESMO (dedup)
    expect(m.locations).toHaveLength(1);
  });

  it('extrai personagens únicos + involves por cena', () => {
    const m = fdxToEntities(payload([
      scene(0, '1', 'INT. A - DAY', 'x', ['RED', 'ANDY']),
      scene(1, '2', 'EXT. B - NIGHT', 'y', ['RED']),
    ]));
    expect(m.characters.map((c) => c.entity.working_name).sort()).toEqual(['ANDY', 'RED']);
    const red = m.characters.find((c) => c.entity.working_name === 'RED')!;
    expect(red.entity.type).toBe('character');
    expect(red.signal.eventCount).toBe(2);
    expect(m.events[0].signal.involvesCharNames).toEqual(['RED', 'ANDY']);
  });

  it('deduplica locais e conta appearsIn', () => {
    const m = fdxToEntities(payload([
      scene(0, '1', 'INT. NEWSROOM - NIGHT'),
      scene(1, '2', 'INT. NEWSROOM - MORNING'),
      scene(2, '3', 'EXT. STREET - DAY'),
    ]));
    // NEWSROOM aparece 2x mas é um único card de location
    const newsroom = m.locations.find((l) => l.entity.working_name === 'NEWSROOM');
    expect(m.locations).toHaveLength(2); // NEWSROOM + STREET
    expect(newsroom!.signal.appearsInEventTitles).toHaveLength(2);
    expect(newsroom!.entity.int_ext).toBe('INT');
  });

  it('ids são estáveis e determinísticos', () => {
    const p = payload([scene(0, '7', 'INT. PUBLISHER OFFICE - DAY')]);
    expect(fdxToEntities(p).events[0].entity.id).toBe(fdxToEntities(p).events[0].entity.id);
    expect(fdxToEntities(p).events[0].entity.id).toContain('fdx-ev-7');
  });
});
