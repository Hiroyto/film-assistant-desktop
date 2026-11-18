// O retrato de um link compartilhado: o que entra, em que ordem, e o que fica
// de fora. `craco test`.
import {
  buildShareSnapshot,
  buildSharedBoard,
  buildSharedScript,
  isEmptySnapshot,
  scopeLabel,
  shareUrl,
} from './shareLinks';
import type { ProjectEdges, ProjectEntity } from './freeformApi';

const ent = (id: string, type: ProjectEntity['type'], over: Partial<ProjectEntity> = {}): ProjectEntity => ({ id, type, ...over });
const p = (type: string, text: string): string => `<p data-line-type="${type}">${text}</p>`;

/** e1 solta → sequência s1 { e2, e3 }. Mais: uma cena no Trash, uma na sandbox, um backstory. */
function graph() {
  const entities: ProjectEntity[] = [
    ent('e3', 'event', { working_title: 'The chase', summary: 'Nina runs.', card_color: '#8bbf7a' }),
    ent('e1', 'event', { working_title: 'Empty crate', summary: 'Voss finds nothing.', evidence_quote: 'secret quote', open_dimensions: [{ tension: 'x', why_it_matters: 'y' }] }),
    ent('e2', 'event', { working_title: 'The pier', description: 'Nina watches.' }),
    ent('gone', 'event', { working_title: 'Deleted scene', deleted_at: '2026-11-01T00:00:00Z' }),
    ent('parked', 'event', { working_title: 'Parked scene', state: 'parked' }),
    ent('back', 'event', { working_title: 'Years ago', narrative_status: 'backstory' }),
    ent('s1', 'sequence', { working_title: 'Act II', summary: 'The net closes.' }),
    ent('c1', 'character', { working_name: 'Voss', description: 'A tired detective.' }),
    ent('c2', 'character', { working_name: 'Nina', description: 'A courier.' }),
    ent('c3', 'character', { working_name: 'Ghost', deleted_at: '2026-11-01T00:00:00Z' }),
    ent('l1', 'location', { working_name: 'Harbor warehouse' }),
  ];
  const edges: Partial<ProjectEdges> = {
    precedes: [{ from: 'e1', to: 'e2' }, { from: 'e2', to: 'e3' }],
    contains: [{ from: 's1', to: 'e2' }, { from: 's1', to: 'e3' }],
    sequence_precedes: [],
    involves: [{ from: 'e1', to: 'c1' }, { from: 'e2', to: 'c2' }, { from: 'e3', to: 'c2' }, { from: 'e3', to: 'c1' }, { from: 'e1', to: 'c3' }, { from: 'gone', to: 'c1' }],
    occurs_in: [{ from: 'e1', to: 'l1' }],
  };
  return { entities, edges };
}

describe('buildSharedBoard', () => {
  it('cenas em ordem de história, numeradas, agrupadas por sequência; soltas num trecho sem título', () => {
    const board = buildSharedBoard(graph());
    expect(board.sections.map((s) => [s.title, s.scenes.map((x) => `${x.number}:${x.title}`)])).toEqual([
      ['', ['1:Empty crate']],
      ['Act II', ['2:The pier', '3:The chase']],
    ]);
    expect(board.sections[1].summary).toBe('The net closes.');
  });

  it('cada cena leva resumo, elenco, local e cor; nada do que é ferramenta do roteirista', () => {
    const board = buildSharedBoard(graph());
    const [crate] = board.sections[0].scenes;
    expect(crate).toEqual({ id: 'e1', number: 1, title: 'Empty crate', summary: 'Voss finds nothing.', characters: ['Voss'], location: 'Harbor warehouse' });
    const chase = board.sections[1].scenes[1];
    expect(chase.characters).toEqual(['Nina', 'Voss']);
    expect(chase.color).toBe('#8bbf7a');
    expect(JSON.stringify(board)).not.toMatch(/secret quote|open_dimensions|why_it_matters/);
  });

  it('fora: Trash, sandbox (parked), backstory e personagens apagados', () => {
    const text = JSON.stringify(buildSharedBoard(graph()));
    expect(text).not.toMatch(/Deleted scene|Parked scene|Years ago|Ghost/);
  });

  it('elenco ordenado por presença em cena; locais em ordem alfabética', () => {
    const board = buildSharedBoard(graph());
    expect(board.characters).toEqual([
      { id: 'c2', name: 'Nina', description: 'A courier.', scenes: 2 },
      { id: 'c1', name: 'Voss', description: 'A tired detective.', scenes: 2 },
    ]);
    expect(board.locations).toEqual([{ name: 'Harbor warehouse', description: '' }]);
  });

  it('grafo vazio ou sem arestas não quebra', () => {
    expect(buildSharedBoard({ entities: [] })).toEqual({ sections: [], characters: [], locations: [] });
    expect(buildSharedBoard({ entities: [ent('e1', 'event', { working_title: 'Only' })], edges: null }).sections[0].scenes[0].title).toBe('Only');
  });
});

describe('buildSharedBoard com layout — o palco (canvas)', () => {
  /** graph() + uma relação, uma cena ainda `staged` e uma sequência sem cenas. */
  const fuller = () => {
    const g = graph();
    g.entities.push(
      ent('r1', 'relationship', { character_a: 'Voss', character_b: 'Nina', kind: 'works_with' }),
      ent('staged', 'event', { working_title: 'Staged scene', staged: '1' }),
      ent('s2', 'sequence', { working_title: 'Epilogue' }),
    );
    return g;
  };
  const stage = (stored: Record<string, { x: number; y: number }> = {}) => {
    const { canvas } = buildSharedBoard(fuller(), { stored, boardWidth: 1400 });
    if (!canvas) throw new Error('sem palco');
    return canvas;
  };

  it('sem layout não há palco: o retrato é só a grade de leitura', () => {
    expect(buildSharedBoard(graph()).canvas).toBeUndefined();
  });

  it('cada cena, personagem e sequência vazia tem um lugar: o salvo pelo roteirista, ou o do auto-layout do board', () => {
    const canvas = stage({ e2: { x: 980.4, y: 150 } });
    const at = (id: string) => canvas.cards.find((c) => c.id === id);
    expect(at('e2')).toEqual({ id: 'e2', kind: 'scene', x: 980, y: 150 });
    expect(canvas.cards.map((c) => `${c.kind}:${c.id}`).sort()).toEqual(
      ['character:c1', 'character:c2', 'scene:e1', 'scene:e2', 'scene:e3', 'sequence:s2'],
    );
    for (const c of canvas.cards) expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    // O auto-layout empilha a espinha em ordem de história.
    expect(at('e1')?.y).toBeLessThan(at('e3')?.y as number);
  });

  it('a sequência com cenas é uma caixa em volta delas; o fio segue a ordem contada', () => {
    const canvas = stage();
    expect(canvas.boxes).toEqual([{ id: 's1', members: ['e2', 'e3'] }]);
    expect(canvas.thread).toEqual([['e1', 'e2'], ['e2', 'e3']]);
  });

  it('elenco de cada cena e laços entre personagens, por id', () => {
    const canvas = stage();
    expect([...canvas.involves].sort()).toEqual([['e1', 'c1'], ['e2', 'c2'], ['e3', 'c1'], ['e3', 'c2']]);
    expect(canvas.bonds).toEqual([{ a: 'c1', b: 'c2', kind: 'works with' }]);
  });

  it('fora do palco: Trash, sandbox, staged, backstory e personagem apagado', () => {
    const ids = stage().cards.map((c) => c.id);
    for (const gone of ['gone', 'parked', 'staged', 'back', 'c3']) expect(ids).not.toContain(gone);
    expect(JSON.stringify(buildSharedBoard(fuller(), {}))).not.toMatch(/Staged scene|Deleted scene|Parked scene|Years ago|Ghost/);
  });

  it('a cena leva INT/EXT e os sub-eventos, para o card aberto', () => {
    const g = graph();
    g.entities.push(ent('e9', 'event', { working_title: 'Late', int_ext: 'INT', sub_events: [{ slugline: 'The crowbar', description: 'Nail by nail.' }, { description: 'Too clean.' }, {}] }));
    const late = buildSharedBoard(g).sections.flatMap((s) => s.scenes).find((s) => s.id === 'e9');
    expect(late).toMatchObject({ intExt: 'INT', beats: ['The crowbar: Nail by nail.', 'Too clean.'] });
  });
});

describe('buildSharedScript', () => {
  const texts = [
    { eventId: 'e3', html: p('scene', 'EXT. STREET - NIGHT') + p('description', 'Nina runs.') },
    { eventId: 'e1', html: p('scene', 'INT. WAREHOUSE - NIGHT') + p('character', 'VOSS') + p('dialogue', 'Empty.') },
    { eventId: 'e2', html: '' },
    { eventId: 'gone', html: p('scene', 'INT. DELETED - DAY') },
    { eventId: '__scratch__', html: p('description', 'Loose pages at the end.') },
  ];

  it('páginas na ordem da história, blocos tipados; cena sem páginas e cena apagada ficam de fora', () => {
    const script = buildSharedScript(graph(), texts);
    expect(script.scenes.map((s) => s.id)).toEqual(['e1', 'e3', '__scratch__']);
    expect(script.scenes[0].blocks).toEqual([
      { type: 'scene', text: 'INT. WAREHOUSE - NIGHT' },
      { type: 'character', text: 'VOSS' },
      { type: 'dialogue', text: 'Empty.' },
    ]);
  });

  it('cada cena leva o seu número do board (a cena sem páginas conta) e a sequência que a contém', () => {
    const script = buildSharedScript(graph(), texts);
    expect(script.scenes.map((s) => [s.id, s.number, s.sequence])).toEqual([
      ['e1', 1, undefined], ['e3', 3, 'Act II'], ['__scratch__', undefined, undefined],
    ]);
  });

  it('o texto ainda sem cena (scratch) vai por último', () => {
    const script = buildSharedScript(graph(), texts);
    expect(script.scenes[script.scenes.length - 1]).toEqual({ id: '__scratch__', title: '', blocks: [{ type: 'description', text: 'Loose pages at the end.' }] });
  });
});

describe('buildShareSnapshot — o escopo decide o que entra', () => {
  const texts = [{ eventId: 'e1', html: p('scene', 'INT. WAREHOUSE - NIGHT') }];
  it('só o board', () => {
    expect(Object.keys(buildShareSnapshot('board', graph(), texts)).sort()).toEqual(['board', 'v']);
  });
  it('só o roteiro', () => {
    expect(Object.keys(buildShareSnapshot('script', graph(), texts)).sort()).toEqual(['script', 'v']);
  });
  it('os dois', () => {
    expect(Object.keys(buildShareSnapshot('both', graph(), texts)).sort()).toEqual(['board', 'script', 'v']);
  });
  it('isEmptySnapshot: board sem cenas e roteiro sem páginas', () => {
    expect(isEmptySnapshot(buildShareSnapshot('both', { entities: [] }, []))).toBe(true);
    expect(isEmptySnapshot(buildShareSnapshot('script', graph(), []))).toBe(true);
    expect(isEmptySnapshot(buildShareSnapshot('script', graph(), texts))).toBe(false);
    expect(isEmptySnapshot(buildShareSnapshot('board', graph(), []))).toBe(false);
  });
});

describe('shareUrl / scopeLabel', () => {
  const env = process.env.REACT_APP_SHARE_BASE_URL;
  afterEach(() => { if (env === undefined) delete process.env.REACT_APP_SHARE_BASE_URL; else process.env.REACT_APP_SHARE_BASE_URL = env; });

  it('fora de um site publicado (localhost, desktop) aponta para o site', () => {
    delete process.env.REACT_APP_SHARE_BASE_URL;
    expect(shareUrl('tok123')).toBe('https://filmassistant.io/share/tok123');
  });
  it('REACT_APP_SHARE_BASE_URL sobrepõe, sem barra dobrada', () => {
    process.env.REACT_APP_SHARE_BASE_URL = 'https://staging.example.com/';
    expect(shareUrl('tok123')).toBe('https://staging.example.com/share/tok123');
  });
  it('rótulos dos três escopos', () => {
    expect([scopeLabel('board'), scopeLabel('both'), scopeLabel('script')]).toEqual(['Board only', 'Script and board', 'Script only']);
  });
});
