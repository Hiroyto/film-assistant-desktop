import { fdxToEntities, parseSlugline } from './fdxToEntities';

// FdxScene/FdxPayload são tipos globais (src/electron.d.ts); montamos payloads
// mínimos aqui.
const scene = (index: number, number: string, heading: string, snippet = ''): FdxScene => ({
  index,
  number,
  heading,
  snippet,
  lineCount: snippet ? 1 : 0,
});

const payload = (scenes: FdxScene[]): FdxPayload => ({
  path: '/tmp/x.fdx',
  fileName: 'x.fdx',
  ok: true,
  sceneCount: scenes.length,
  paragraphCount: scenes.length,
  scenes,
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
    expect(m.events[0].entity.working_title).toBe('INT. NEWSROOM - NIGHT');
    expect(m.events[0].entity.summary).toBe('Mara reads.');
    // occurs_in aponta para o location derivado
    expect((m.events[0].entity as any).occurs_in).toEqual([m.locations.find((l) => l.entity.working_name === 'NEWSROOM')!.entity.id]);
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
