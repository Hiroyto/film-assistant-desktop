import {
  adoptBySpans,
  bodyHashOf,
  buildBraindumpProse,
  contiguousGroups,
  emptyStore,
  matchScenes,
  normHeading,
  remapStoreCard,
  sceneToHtml,
  sceneTitleOf,
  scenesToPages,
  spansOf,
  type FdxSceneRecord,
  type FdxSyncStore,
  type PendingScene,
} from './fdxSync';
import type { ProjectEntity } from './freeformApi';

// FdxScene/FdxParagraph são tipos globais (src/electron.d.ts).
const scene = (number: string, heading: string, body: string[] = [], index = 0): FdxScene => ({
  index,
  number,
  heading,
  snippet: body[0] ?? '',
  lineCount: body.length,
  characters: [],
  paragraphs: body.map((text) => ({ type: 'description' as const, text })),
});

let seq = 0;
const record = (s: FdxScene, eventId: string, extra: Partial<FdxSceneRecord> = {}): FdxSceneRecord => ({
  id: `r${++seq}`,
  eventId,
  number: s.number,
  heading: s.heading,
  headingNorm: normHeading(s.heading),
  bodyHash: bodyHashOf(s),
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const storeWith = (...recs: FdxSceneRecord[]): FdxSyncStore => {
  const st = emptyStore();
  for (const r of recs) st.scenes[r.id] = r;
  return st;
};

const card = (id: string, working_title: string, extra: Partial<ProjectEntity> = {}): ProjectEntity =>
  ({ id, type: 'event', working_title, ...extra } as ProjectEntity);

describe('normHeading', () => {
  it('ignora caixa, pontuação e espaços', () => {
    expect(normHeading('INT. COFFEE SHOP - DAY')).toBe(normHeading('int coffee shop – day'));
  });
});

describe('scenesToPages / sceneToHtml', () => {
  it('slugline com data-scene-id no primeiro parágrafo e tipos nos demais', () => {
    const s: FdxScene = {
      ...scene('1', 'INT. CAR - DAY'),
      paragraphs: [
        { type: 'description', text: 'Rain on the windshield.' },
        { type: 'character', text: 'NINA (V.O.)' },
        { type: 'dialogue', text: 'Drive.' },
      ],
    };
    const { html, ledger, text } = sceneToHtml('ev_1', s);
    expect(html).toBe(
      '<p data-scene-id="ev_1" data-line-type="scene">INT. CAR - DAY</p>' +
        '<p data-line-type="description">Rain on the windshield.</p>' +
        '<p data-line-type="character">NINA (V.O.)</p>' +
        '<p data-line-type="dialogue">Drive.</p>',
    );
    expect(ledger).toHaveLength(4);
    expect(ledger.every((b) => b.b === '' && b.h && b.l > 0)).toBe(true);
    expect(text.split('\n')).toHaveLength(4);
  });

  it('várias cenas num card: só o PRIMEIRO slugline carrega a tag de região', () => {
    const a = scene('2', 'EXT. PIER - NIGHT', ['Nina watches.']);
    const b = scene('3', 'INT. WAREHOUSE - CONTINUOUS', ['Voss kneels.']);
    const p = scenesToPages('ev_x', [a, b]);
    expect(p.html).toBe(
      '<p data-scene-id="ev_x" data-line-type="scene">EXT. PIER - NIGHT</p>' +
        '<p data-line-type="description">Nina watches.</p>' +
        '<p data-line-type="scene">INT. WAREHOUSE - CONTINUOUS</p>' +
        '<p data-line-type="description">Voss kneels.</p>',
    );
    expect((p.html.match(/data-scene-id/g) ?? []).length).toBe(1);
    expect(p.paragraphs).toBe(2);
    expect(p.hash).not.toBe(scenesToPages('ev_x', [a]).hash);
  });

  it('escapa HTML no texto', () => {
    const { html } = sceneToHtml('ev', scene('1', 'INT. <LAB> - DAY', ['a & b']));
    expect(html).toContain('INT. &lt;LAB&gt; - DAY');
    expect(html).toContain('a &amp; b');
  });

  it('payload antigo sem paragraphs usa o snippet como ação', () => {
    const s: FdxScene = { index: 0, number: '1', heading: 'EXT. STREET', snippet: 'A car.', lineCount: 1, characters: [] };
    expect(sceneToHtml('ev', s).html).toContain('<p data-line-type="description">A car.</p>');
  });
});

describe('sceneTitleOf', () => {
  it('prefixa o nº da cena', () => {
    expect(sceneTitleOf(scene('12A', ' INT. CAR - DAY '))).toBe('12A. INT. CAR - DAY');
  });
});

describe('matchScenes', () => {
  const a = scene('1', 'INT. CAR - DAY', ['Rain.'], 0);
  const b = scene('2', 'EXT. STREET - NIGHT', ['Nina runs.'], 1);

  it('cena intocada casa pela chave (nº + heading)', () => {
    const st = storeWith(record(a, 'ev_a'), record(b, 'ev_b'));
    const { matches, missing } = matchScenes(st, [a, b], []);
    expect(matches.map((m) => [m.eventId, m.via])).toEqual([['ev_a', 'key'], ['ev_b', 'key']]);
    expect(missing).toEqual([]);
  });

  it('corpo editado mantém a identidade pela chave', () => {
    const st = storeWith(record(a, 'ev_a'));
    const a2 = scene('1', 'INT. CAR - DAY', ['Rain. Thunder.']);
    const { matches } = matchScenes(st, [a2], []);
    expect(matches[0].eventId).toBe('ev_a');
    expect(matches[0].via).toBe('key');
  });

  it('renumerada + heading editado casa pelo corpo', () => {
    const st = storeWith(record(a, 'ev_a'), record(b, 'ev_b'));
    const inserted = scene('1', 'INT. HALLWAY - DAY', ['New opening.'], 0);
    const a2 = scene('2', 'INT. CAR - DUSK', ['Rain.'], 1);
    const b2 = scene('3', 'EXT. STREET - NIGHT', ['Nina runs.'], 2);
    const { matches, missing } = matchScenes(st, [inserted, a2, b2], []);
    expect(matches.map((m) => [m.eventId, m.via])).toEqual([[null, 'new'], ['ev_a', 'body'], ['ev_b', 'body']]);
    expect(missing).toEqual([]);
  });

  it('renumerada + corpo editado casa pelo heading', () => {
    const st = storeWith(record(a, 'ev_a'), record(b, 'ev_b'));
    const inserted = scene('1', 'INT. HALLWAY - DAY', ['New opening.'], 0);
    const a2 = scene('2', 'INT. CAR - DAY', ['Rain. Thunder.'], 1);
    const b2 = scene('3', 'EXT. STREET - NIGHT', ['Nina runs.'], 2);
    const { matches } = matchScenes(st, [inserted, a2, b2], []);
    expect(matches[1]).toMatchObject({ eventId: 'ev_a', via: 'heading' });
    expect(matches[2]).toMatchObject({ eventId: 'ev_b', via: 'body' });
  });

  it('duas cenas do arquivo podem apontar para o MESMO card (cena anexada)', () => {
    const pier = scene('2', 'EXT. PIER - NIGHT', ['Nina watches.'], 0);
    const cont = scene('3', 'INT. WAREHOUSE - CONTINUOUS', ['Voss kneels.'], 1);
    const st = storeWith(record(pier, 'ev_shared'), record(cont, 'ev_shared'));
    const { matches, missing } = matchScenes(st, [pier, cont], []);
    expect(matches.map((m) => [m.eventId, m.via])).toEqual([['ev_shared', 'key'], ['ev_shared', 'key']]);
    expect(missing).toEqual([]);
  });

  it('headings repetidos não casam por heading (ambíguo) — cada um vira novo', () => {
    const st = storeWith(record(scene('5', 'INT. CAR - DAY', ['x']), 'ev_old'));
    const s1 = scene('1', 'INT. CAR - DAY', ['first'], 0);
    const s2 = scene('2', 'INT. CAR - DAY', ['second'], 1);
    const { matches, missing } = matchScenes(st, [s1, s2], []);
    expect(matches.every((m) => m.eventId === null)).toBe(true);
    expect(missing.map((r) => r.eventId)).toEqual(['ev_old']);
  });

  it('cenas só com heading (corpo vazio) nunca casam pelo corpo', () => {
    const st = storeWith(record(scene('9', 'INT. ROOM - DAY'), 'ev_room'));
    const { matches } = matchScenes(st, [scene('1', 'EXT. BEACH - DAY')], []);
    expect(matches[0].eventId).toBeNull();
  });

  it('adota card vivo do board sem registro (import antigo / IA), pelo título ou por QUALQUER slugline dos sub_events', () => {
    const cards = [
      card('ev_x', '1. INT. CAR - DAY'),
      card('ev_y', 'Nina flees', { sub_events: [{ slugline: 'EXT. ALLEY - NIGHT' }, { slugline: 'EXT. STREET - NIGHT' }] }),
      card('ev_dead', '3. INT. LAB - DAY', { deleted_at: '2026-01-01T00:00:00.000Z' }),
    ];
    const lab = scene('3', 'INT. LAB - DAY', ['beakers'], 2);
    const { matches } = matchScenes(emptyStore(), [a, b, lab], cards);
    expect(matches.map((m) => [m.eventId, m.via])).toEqual([['ev_x', 'card'], ['ev_y', 'card'], [null, 'new']]);
    expect(matches[0].record?.id).toBeTruthy();
  });

  it('card já mapeado para outra cena não é adotado de novo', () => {
    const st = storeWith(record(a, 'ev_x'));
    const dup = scene('7', 'INT. CAR - DAY', ['later'], 1);
    const { matches } = matchScenes(st, [a, dup], [card('ev_x', '1. INT. CAR - DAY')]);
    expect(matches[0]).toMatchObject({ eventId: 'ev_x', via: 'key' });
    expect(matches[1]).toMatchObject({ eventId: null, via: 'new' });
  });

  it('cena que sumiu do arquivo volta como missing (keep-bias)', () => {
    const st = storeWith(record(a, 'ev_a'), record(b, 'ev_b'));
    const { matches, missing } = matchScenes(st, [a], []);
    expect(matches).toHaveLength(1);
    expect(missing.map((r) => r.eventId)).toEqual(['ev_b']);
  });

  it('cena marcada missing volta a casar quando reaparece', () => {
    const st = storeWith(record(a, 'ev_a'), record(b, 'ev_b', { missingSince: '2026-02-01T00:00:00.000Z' }));
    const { matches, missing } = matchScenes(st, [a, b], []);
    expect(matches[1]).toMatchObject({ eventId: 'ev_b', via: 'key' });
    expect(missing).toEqual([]);
  });

  it('ignora cenas com heading vazio', () => {
    const { matches } = matchScenes(emptyStore(), [scene('1', '   ', ['x']), a], []);
    expect(matches).toHaveLength(1);
    expect(matches[0].scene).toBe(a);
  });
});

describe('buildBraindumpProse', () => {
  it('formato do fullText (heading, ação, CUE com linha em branco) e offsets dos headings', () => {
    const s1: FdxScene = {
      ...scene('1', 'INT. CAR - DAY'),
      paragraphs: [
        { type: 'description', text: 'Rain.' },
        { type: 'character', text: 'NINA' },
        { type: 'dialogue', text: 'Drive.' },
      ],
    };
    const s2 = scene('2', 'EXT. STREET - NIGHT', ['She runs.'], 1);
    const { prose, offsets } = buildBraindumpProse([s1, s2]);
    expect(prose).toBe('INT. CAR - DAY\nRain.\n\nNINA\nDrive.\n\nEXT. STREET - NIGHT\nShe runs.');
    expect(offsets).toEqual([0, prose.indexOf('EXT. STREET')]);
  });
});

describe('spansOf / adoptBySpans', () => {
  const pend = (number: string, heading: string, offset: number): PendingScene =>
    ({ number, heading, headingNorm: normHeading(heading), offset, bodyHash: 'h' });

  it('lê só eventos vivos do braindump, com spans válidos, em ordem', () => {
    const cards = [
      card('ev_b', 'B', { src_braindump: 'bd1', src_start: '40', src_end: '80' } as any),
      card('ev_a', 'A', { src_braindump: 'bd1', src_start: '0', src_end: '40' } as any),
      card('ev_other', 'X', { src_braindump: 'bd2', src_start: '0', src_end: '10' } as any),
      card('ev_dead', 'D', { src_braindump: 'bd1', src_start: '80', src_end: '99', deleted_at: 'x' } as any),
      card('ev_nospan', 'N', { src_braindump: 'bd1' } as any),
    ];
    expect(spansOf(cards, 'bd1')).toEqual([{ id: 'ev_a', start: 0, end: 40 }, { id: 'ev_b', start: 40, end: 80 }]);
  });

  it('cena → dona do evento cujo span cobre o heading', () => {
    const spans = [{ id: 'ev_a', start: 0, end: 40 }, { id: 'ev_b', start: 40, end: 80 }];
    expect(adoptBySpans([pend('1', 'A', 0), pend('2', 'B', 40)], spans)).toEqual([
      { eventId: 'ev_a', own: true }, { eventId: 'ev_b', own: true },
    ]);
  });

  it('span que começa DENTRO da cena (a IA pulou o heading) também dá a cena como dona', () => {
    const spans = [{ id: 'ev_a', start: 5, end: 40 }, { id: 'ev_b', start: 47, end: 80 }];
    expect(adoptBySpans([pend('1', 'A', 0), pend('2', 'B', 40)], spans).map((a) => a?.eventId)).toEqual(['ev_a', 'ev_b']);
  });

  it('cenas fundidas pela IA (o caso real: CONTINUOUS dentro do span anterior) → a segunda é ANEXADA ao mesmo evento', () => {
    // spans reais do teste: [0,244) [244,603) [603,850); cena 3 (CONTINUOUS) tinha o heading em ~420
    const spans = [{ id: 'ev_1', start: 0, end: 244 }, { id: 'ev_2', start: 244, end: 603 }, { id: 'ev_4', start: 603, end: 850 }];
    const out = adoptBySpans([pend('1', 'A', 0), pend('2', 'B', 244), pend('3', 'C', 420), pend('4', 'D', 603)], spans);
    expect(out).toEqual([
      { eventId: 'ev_1', own: true },
      { eventId: 'ev_2', own: true },
      { eventId: 'ev_2', own: false }, // anexada: texto vai para as páginas de ev_2
      { eventId: 'ev_4', own: true },
    ]);
  });

  it('cena que nenhum span cobre (a IA a pulou no fim) é anexada ao evento anterior', () => {
    const spans = [{ id: 'ev_a', start: 0, end: 40 }];
    expect(adoptBySpans([pend('1', 'A', 0), pend('2', 'B', 60)], spans)).toEqual([
      { eventId: 'ev_a', own: true }, { eventId: 'ev_a', own: false },
    ]);
  });

  it('sem spans (nada pousou) devolve null', () => {
    expect(adoptBySpans([pend('1', 'A', 0)], [])).toEqual([null]);
  });
});

describe('contiguousGroups', () => {
  it('agrupa índices contíguos', () => {
    expect(contiguousGroups([0, 1, 2, 5, 6, 9])).toEqual([[0, 1, 2], [5, 6], [9]]);
    expect(contiguousGroups([])).toEqual([]);
  });
});

describe('remapStoreCard (resposta do strip que troca o card)', () => {
  const s1 = scene('1', 'INT. BAR - NIGHT', ['A bebe.']);
  const s2 = scene('2', 'INT. BAR - CONTINUOUS', ['B chega.'], 1);
  const s3 = scene('3', 'EXT. RUA - DAY', ['C corre.'], 2);

  it('merge: as cenas do card mintado passam a compor o alvo; o estado do morto vai embora', () => {
    const st = storeWith(record(s1, 'ev_staged'), record(s2, 'ev_staged'), record(s3, 'ev_other'));
    st.events.ev_staged = { savedHash: 'h1', extractedHash: 'h1' };
    st.events.ev_target = { savedHash: 't1', extractedHash: 't1' };
    expect(remapStoreCard(st, ['ev_staged'], 'ev_target')).toBe(2);
    const byEvent = Object.values(st.scenes).map((r) => r.eventId);
    expect(byEvent.filter((id) => id === 'ev_target')).toHaveLength(2);
    expect(byEvent).toContain('ev_other');
    expect(st.events.ev_staged).toBeUndefined();
    // O sobrevivente mantém o estado: o hash das páginas (agora com as cenas
    // movidas) já difere, então a rodada seguinte re-salva sozinha.
    expect(st.events.ev_target).toEqual({ savedHash: 't1', extractedHash: 't1' });
  });

  it('convert (sequência → cena): a cabeça E os membros fundidos vão para o card novo', () => {
    const st = storeWith(record(s1, 'seq_old'), record(s2, 'ev_member'), record(s3, 'ev_other'));
    expect(remapStoreCard(st, ['seq_old', 'ev_member'], 'ev_new')).toBe(2);
    expect(Object.values(st.scenes).filter((r) => r.eventId === 'ev_new')).toHaveLength(2);
    expect(Object.values(st.scenes).find((r) => r.eventId === 'ev_other')).toBeTruthy();
  });

  it('a cena da cabeça já não estava no arquivo (missing): o registro segue junto, marcado como estava', () => {
    const st = storeWith(record(s1, 'ev_staged', { missingSince: '2026-09-01T00:00:00.000Z' }));
    expect(remapStoreCard(st, ['ev_staged'], 'ev_target')).toBe(1);
    const rec = Object.values(st.scenes)[0];
    expect(rec.eventId).toBe('ev_target');
    expect(rec.missingSince).toBe('2026-09-01T00:00:00.000Z');
  });

  it('no-op quando nenhuma cena do arquivo compõe o card (pergunta que não era do cowork)', () => {
    const st = storeWith(record(s1, 'ev_a'));
    st.events.ev_a = { savedHash: 'x' };
    expect(remapStoreCard(st, ['ev_board_only'], 'ev_target')).toBe(0);
    expect(Object.values(st.scenes)[0].eventId).toBe('ev_a');
    expect(st.events.ev_a).toEqual({ savedHash: 'x' });
  });

  it('ignora from === to, ids vazios e alvo vazio', () => {
    const st = storeWith(record(s1, 'ev_a'));
    expect(remapStoreCard(st, ['ev_a'], 'ev_a')).toBe(0);
    expect(remapStoreCard(st, ['', 'ev_a'], '')).toBe(0);
    expect(Object.values(st.scenes)[0].eventId).toBe('ev_a');
  });
});
