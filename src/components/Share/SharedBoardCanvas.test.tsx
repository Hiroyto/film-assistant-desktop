// O board de um link: o palco (Master) e a grade (Beats). Tudo aqui é local à
// tela: abrir, mover e dar zoom não gravam nada. `craco test`.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SharedBeats, SharedBoardCanvas, stageOf } from './SharedBoardCanvas';
import type { SharedBoard } from '../../lib/shareLinks';

const scene = (id: string, number: number, title: string, over: Record<string, unknown> = {}) => ({ id, number, title, summary: `${title} summary.`, characters: [] as string[], ...over });
const BOARD: SharedBoard = {
  sections: [
    { id: 'loose_0', title: '', scenes: [scene('e1', 1, 'Empty crate', { characters: ['Voss'], location: 'Harbor warehouse', intExt: 'INT', beats: ['The crowbar: Nail by nail.'] })] },
    { id: 's1', title: 'Act II', summary: 'The net closes.', scenes: [scene('e2', 2, 'The pier', { characters: ['Nina'], color: '#be123c' }), scene('e3', 3, 'The chase', { characters: ['Nina', 'Voss'] })] },
    { id: 's2', title: 'Epilogue', summary: 'Still to be written.', scenes: [] },
  ],
  characters: [
    { id: 'c1', name: 'Voss', description: 'A tired detective.', scenes: 2 },
    { id: 'c2', name: 'Nina', description: 'A courier.', scenes: 2 },
  ],
  locations: [{ name: 'Harbor warehouse', description: '' }],
  canvas: {
    cards: [
      { id: 'e1', kind: 'scene', x: 400, y: 20 },
      { id: 'e2', kind: 'scene', x: 400, y: 260 },
      { id: 'e3', kind: 'scene', x: 400, y: 420 },
      { id: 's2', kind: 'sequence', x: 400, y: 640 },
      { id: 'c1', kind: 'character', x: 20, y: 20 },
      { id: 'c2', kind: 'character', x: 20, y: 120 },
    ],
    thread: [['e1', 's1'], ['e2', 'e3'], ['s1', 's2']],
    boxes: [{ id: 's1', members: ['e2', 'e3'] }],
    involves: [['e1', 'c1'], ['e2', 'c2'], ['e3', 'c2'], ['e3', 'c1']],
    bonds: [{ a: 'c1', b: 'c2', kind: 'works with' }],
  },
};
const card = (name: RegExp) => screen.getByRole('button', { name });
/** Um gesto de ponteiro como o navegador o entrega (o jsdom não tem PointerEvent). */
const pointer = (target: Element | Window, type: string, x: number, y: number) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });

/** Arrasta uma cena dos Beats até outro card (ou até a área de uma seção), com
 *  o ponteiro em `x` sobre o alvo, e solta. */
const carry = (from: Element, onto: Element, x: number) => {
  pointer(from, 'pointerdown', 500, 500);
  pointer(window, 'pointermove', 520, 520); // passou do limiar: o arrasto começou
  pointer(onto, 'pointermove', x, 50);
  pointer(window, 'pointerup', x, 50);
};
/** A caixa do card na tela, para o teste dizer de que lado o ponteiro está. */
const boxed = (el: Element, left: number, width: number) =>
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, width, top: 0, height: 110, right: left + width, bottom: 110, x: left, y: 0, toJSON: () => ({}) } as DOMRect);
const beats = () => screen.getAllByTestId('shared-scene').map((el) => (el.textContent ?? '').replace(/^(SC \d+)(INT|EXT)?/, '$1 ').replace(/(Voss|Nina).*$/, '').trim());

beforeEach(() => { localStorage.clear(); });

describe('SharedBoardCanvas (Master)', () => {
  it('põe cada card onde o retrato diz: notecards de cena, pílulas de personagem, a sequência sem cenas como card', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    expect(screen.getAllByTestId('canvas-scene').map((el) => el.textContent)).toEqual(['SC 01INTEmpty crateVoss', 'SC 02The pierNina', 'SC 03The chaseNina · Voss']);
    expect(card(/SC 01 Empty crate/)).toHaveStyle({ left: '400px', top: '20px', width: '300px', height: '110px' });
    expect(screen.getAllByTestId('canvas-character').map((el) => el.textContent)).toEqual(['Voss', 'Nina']);
    expect(card(/^Voss$/)).toHaveStyle({ left: '20px', top: '20px', width: '168px' });
    expect(screen.getByTestId('canvas-sequence-card')).toHaveTextContent('SequenceEpilogueStill to be written.');
  });

  it('a sequência com cenas é a caixa em volta delas, com o rótulo; o fio tem uma flecha por elo', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    // Membros em y 260 e 420 (110 de altura): faixa do rótulo (24) e respiro (14) em cima, respiro embaixo.
    expect(screen.getByTestId('canvas-sequence')).toHaveStyle({ left: '386px', top: '222px', width: '328px', height: '322px' });
    expect(screen.getByRole('button', { name: 'Act II' })).toBeInTheDocument();
    expect(screen.getAllByTestId('canvas-thread')).toHaveLength(3);
    expect(screen.getByText('works with')).toBeInTheDocument();
  });

  it('clicar num card o abre no lugar, com resumo, elenco, local e sub-eventos; ✕, Esc ou o fundo o fecham', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    const crate = card(/SC 01 Empty crate/);
    expect(crate).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(crate);
    expect(crate).toHaveAttribute('aria-expanded', 'true');
    expect(crate).toHaveStyle({ width: '440px' });
    const open = within(crate);
    expect(open.getByText('Empty crate summary.')).toBeInTheDocument();
    expect(open.getByText('Characters')).toBeInTheDocument();
    expect(open.getByText('Harbor warehouse')).toBeInTheDocument();
    expect(open.getByText('The crowbar: Nail by nail.')).toBeInTheDocument();

    fireEvent.click(open.getByRole('button', { name: 'Close card' }));
    expect(crate).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(crate);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(crate).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(crate);
    fireEvent.click(screen.getByTestId('shared-canvas'));
    expect(crate).toHaveAttribute('aria-expanded', 'false');
  });

  it('o personagem aberto diz em que cenas aparece; o rótulo da sequência abre o resumo dela', () => {
    render(<SharedBoardCanvas board={BOARD} dark />);
    fireEvent.click(card(/^Nina$/));
    const nina = within(card(/^Nina$/));
    expect(nina.getByText('A courier.')).toBeInTheDocument();
    expect(nina.getByText('SC 02 The pier')).toBeInTheDocument();
    expect(nina.getByText('SC 03 The chase')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Act II' }));
    const seq = within(screen.getByTestId('canvas-open'));
    expect(seq.getByText('The net closes.')).toBeInTheDocument();
    expect(seq.getByText('SC 03 The chase')).toBeInTheDocument();
  });

  it('arrastar um card o move só nesta tela (a caixa da sequência acompanha) e não o abre; "Reset cards" desfaz', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    const pier = card(/SC 02 The pier/);
    expect(screen.queryByText('Reset cards')).toBeNull();
    pointer(pier, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 160, 60);
    pointer(window, 'pointerup', 160, 60);
    fireEvent.click(pier); // o clique que fecha o arrasto
    expect(pier).toHaveStyle({ left: '460px', top: '220px' });
    expect(pier).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('canvas-sequence')).toHaveStyle({ left: '386px', top: '182px', width: '388px' });

    fireEvent.click(screen.getByText('Reset cards'));
    expect(pier).toHaveStyle({ left: '400px', top: '260px' });
    expect(screen.queryByText('Reset cards')).toBeNull();
  });

  it('um toque curto (sem passar do limiar de arrasto) ainda é um clique', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    const pier = card(/SC 02 The pier/);
    pointer(pier, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 102, 101);
    pointer(window, 'pointerup', 102, 101);
    fireEvent.click(pier);
    expect(pier).toHaveStyle({ left: '400px', top: '260px' });
    expect(pier).toHaveAttribute('aria-expanded', 'true');
  });

  it('zoom pelos botões; Fit volta ao enquadramento', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('120%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('83%');
    fireEvent.click(screen.getByText('Fit'));
    expect(screen.getByTestId('canvas-zoom')).toHaveTextContent('100%');
  });

  it('arrastar a área livre de uma sequência leva a caixa e as cenas dela juntas; as outras cartas ficam', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    pointer(screen.getByTestId('canvas-sequence'), 'pointerdown', 390, 230);
    pointer(window, 'pointermove', 490, 260);
    pointer(window, 'pointerup', 490, 260);
    expect(card(/SC 02 The pier/)).toHaveStyle({ left: '500px', top: '290px' });
    expect(card(/SC 03 The chase/)).toHaveStyle({ left: '500px', top: '450px' });
    expect(screen.getByTestId('canvas-sequence')).toHaveStyle({ left: '486px', top: '252px' });
    expect(card(/SC 01 Empty crate/)).toHaveStyle({ left: '400px', top: '20px' });
    fireEvent.click(screen.getByText('Reset cards'));
    expect(card(/SC 02 The pier/)).toHaveStyle({ left: '400px', top: '260px' });
  });

  it('o rótulo da sequência é a alça: arrastar move e não abre; um clique sem arrasto abre', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    const label = screen.getByRole('button', { name: 'Act II' });
    pointer(label, 'pointerdown', 400, 232);
    pointer(window, 'pointermove', 400, 332);
    pointer(window, 'pointerup', 400, 332);
    fireEvent.click(label); // o clique que fecha o arrasto
    expect(card(/SC 02 The pier/)).toHaveStyle({ top: '360px' });
    expect(screen.queryByTestId('canvas-open')).toBeNull();
    fireEvent.click(label);
    expect(screen.getByTestId('canvas-open')).toHaveTextContent('The net closes.');
  });

  it('com memoryKey, o que foi movido fica guardado e volta na próxima visita; Reset esquece', () => {
    const { unmount } = render(<SharedBoardCanvas board={BOARD} dark={false} memoryKey="stage:tok" />);
    pointer(card(/^Voss$/), 'pointerdown', 30, 30);
    pointer(window, 'pointermove', 130, 80);
    pointer(window, 'pointerup', 130, 80);
    expect(JSON.parse(localStorage.getItem('stage:tok') ?? 'null')).toEqual({ c1: { x: 120, y: 70 } });
    unmount();

    render(<SharedBoardCanvas board={BOARD} dark={false} memoryKey="stage:tok" />);
    expect(card(/^Voss$/)).toHaveStyle({ left: '120px', top: '70px' });
    expect(card(/^Nina$/)).toHaveStyle({ left: '20px', top: '120px' });
    fireEvent.click(screen.getByText('Reset cards'));
    expect(card(/^Voss$/)).toHaveStyle({ left: '20px', top: '20px' });
    expect(localStorage.getItem('stage:tok')).toBeNull();
  });

  it('o que está guardado e não serve (lixo, card que não existe) é ignorado', () => {
    localStorage.setItem('stage:tok', JSON.stringify({ nope: { x: 1, y: 1 }, c1: { x: 'a', y: null }, e1: { x: 700, y: 90 } }));
    render(<SharedBoardCanvas board={BOARD} dark={false} memoryKey="stage:tok" />);
    expect(card(/SC 01 Empty crate/)).toHaveStyle({ left: '700px', top: '90px' });
    expect(card(/^Voss$/)).toHaveStyle({ left: '20px', top: '20px' });
    localStorage.setItem('stage:bad', '{not json');
    render(<SharedBoardCanvas board={BOARD} dark={false} memoryKey="stage:bad" />);
    expect(screen.getAllByTestId('shared-canvas')).toHaveLength(2);
  });

  it('nada é campo: nenhum input', () => {
    render(<SharedBoardCanvas board={BOARD} dark={false} />);
    expect(['textbox', 'combobox', 'checkbox', 'spinbutton', 'slider'].flatMap((role) => screen.queryAllByRole(role))).toEqual([]);
  });
});

describe('stageOf — o palco de um link antigo (sem `canvas` no retrato)', () => {
  const old: SharedBoard = { ...BOARD, canvas: undefined, characters: BOARD.characters.map(({ id: _id, ...p }) => p) };

  it('o retrato que traz o palco é usado como veio', () => {
    expect(stageOf(BOARD).canvas).toBe(BOARD.canvas);
  });

  it('monta o palco no desenho do board: elenco à esquerda, a espinha das cenas descendo, cada sequência na sua caixa', () => {
    const { canvas, characters } = stageOf(old);
    expect(characters.map((p) => p.id)).toEqual(['cast_0', 'cast_1']);
    expect(canvas.cards.map((c) => `${c.kind}:${c.id}`)).toEqual(['character:cast_0', 'character:cast_1', 'scene:e1', 'scene:e2', 'scene:e3', 'sequence:s2']);
    const at = (id: string) => canvas.cards.find((c) => c.id === id) as { x: number; y: number };
    // Uma coluna só, de cima para baixo, à direita do elenco.
    expect(new Set(['e1', 'e2', 'e3', 's2'].map((id) => at(id).x)).size).toBe(1);
    expect(at('e1').x).toBeGreaterThan(at('cast_1').x + 168);
    expect(['e1', 'e2', 'e3', 's2'].map((id) => at(id).y)).toEqual([...['e1', 'e2', 'e3', 's2'].map((id) => at(id).y)].sort((a, b) => a - b));
    expect(at('e2').y - at('e1').y).toBeGreaterThan(110 + 24); // a faixa do rótulo da caixa cabe entre elas
    expect(canvas.boxes).toEqual([{ id: 's1', members: ['e2', 'e3'] }]);
    expect(canvas.thread).toEqual([['e1', 'e2'], ['e2', 'e3'], ['e3', 's2']]);
    expect(canvas.involves).toEqual([['e1', 'cast_0'], ['e2', 'cast_1'], ['e3', 'cast_1'], ['e3', 'cast_0']]);
  });

  it('o palco montado se arruma como o outro', () => {
    render(<SharedBoardCanvas board={old} dark={false} />);
    const crate = card(/SC 01 Empty crate/);
    const { left } = crate.style;
    pointer(crate, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 110, 10);
    pointer(window, 'pointerup', 110, 10);
    expect(crate.style.left).toBe(`${parseFloat(left) + 100}px`);
    expect(screen.getByText('Reset cards')).toBeInTheDocument();
  });
});

describe('SharedBeats', () => {
  it('as cenas em ordem de história, as sequências como regiões com rótulo, o elenco e os locais', () => {
    render(<SharedBeats board={BOARD} dark={false} />);
    expect(screen.getAllByTestId('shared-scene').map((el) => el.textContent)).toEqual([
      expect.stringContaining('SC 01INTEmpty crate'), expect.stringContaining('SC 02The pier'), expect.stringContaining('SC 03The chase'),
    ]);
    expect(screen.getByRole('heading', { name: 'Act II' })).toBeInTheDocument();
    expect(screen.getByText('The net closes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Epilogue' })).toBeInTheDocument();
    expect(screen.getByText('A tired detective.')).toBeInTheDocument();
    expect(screen.getByText('Harbor warehouse')).toBeInTheDocument();
  });

  it('arrastar uma cena para cima de outra a põe antes (metade esquerda) ou depois (metade direita), e renumera', () => {
    render(<SharedBeats board={BOARD} dark={false} />);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The pier', 'SC 03 The chase']);
    expect(screen.queryByText('Reset order')).toBeNull();
    let [crate, pier, chase] = screen.getAllByTestId('shared-scene');
    boxed(pier, 0, 300);

    // A última cena para ANTES de "The pier".
    carry(chase, pier, 40);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The chase', 'SC 03 The pier']);

    // A cena solta para DEPOIS de "The pier": entra na sequência, e o trecho solto some.
    [crate, , pier] = screen.getAllByTestId('shared-scene');
    boxed(pier, 0, 300);
    carry(crate, pier, 260);
    expect(beats()).toEqual(['SC 01 The chase', 'SC 02 The pier', 'SC 03 Empty crate']);
    expect(screen.getAllByTestId('beats-section')).toHaveLength(2);

    fireEvent.click(screen.getByText('Reset order'));
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The pier', 'SC 03 The chase']);
    expect(screen.queryByText('Reset order')).toBeNull();
  });

  it('soltar na área de uma sequência (fora de um card) põe a cena no fim dela, mesmo vazia', () => {
    render(<SharedBeats board={BOARD} dark={false} />);
    const [, pier] = screen.getAllByTestId('shared-scene');
    const epilogue = screen.getAllByTestId('beats-section')[2];
    carry(pier, epilogue, 10);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The chase', 'SC 03 The pier']);
    expect(within(epilogue).getByTestId('shared-scene')).toHaveTextContent('The pier');
  });

  it('um arrasto que não chega a lugar nenhum não muda a ordem; um toque curto ainda abre o card; o dedo não arrasta', () => {
    render(<SharedBeats board={BOARD} dark={false} />);
    const [crate, pier] = screen.getAllByTestId('shared-scene');
    // Pegou e soltou longe de qualquer card.
    pointer(crate, 'pointerdown', 500, 500);
    pointer(window, 'pointermove', 600, 600);
    pointer(window, 'pointerup', 600, 600);
    fireEvent.click(crate); // o clique que fecha o arrasto não abre
    expect(crate).toHaveAttribute('aria-expanded', 'false');
    // Sem passar do limiar: é um clique.
    pointer(pier, 'pointerdown', 500, 500);
    pointer(window, 'pointermove', 501, 501);
    pointer(window, 'pointerup', 501, 501);
    fireEvent.click(pier);
    expect(pier).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(pier);
    // No toque o dedo rola a página: nada é arrastado.
    const touch = (target: Element | Window, type: string, x: number) => act(() => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 50, button: 0 });
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      target.dispatchEvent(e);
    });
    touch(crate, 'pointerdown', 500);
    touch(window, 'pointermove', 560);
    touch(pier, 'pointermove', 260);
    touch(window, 'pointerup', 260);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The pier', 'SC 03 The chase']);
    expect(screen.queryByText('Reset order')).toBeNull();
  });

  it('enquanto é arrastado o card acompanha o cursor, e a barra mostra onde ele vai cair', () => {
    render(<SharedBeats board={BOARD} dark={false} />);
    const [crate, pier] = screen.getAllByTestId('shared-scene');
    boxed(pier, 0, 300);
    pointer(crate, 'pointerdown', 500, 500);
    pointer(window, 'pointermove', 540, 530);
    expect(crate).toHaveStyle({ transform: 'translate(40px, 30px)', pointerEvents: 'none' });
    pointer(pier, 'pointermove', 260, 50);
    expect(pier.style.boxShadow).toMatch(/^6px 0 0 -1px/); // depois dele
    pointer(pier, 'pointermove', 40, 50);
    expect(pier.style.boxShadow).toMatch(/^-6px 0 0 -1px/); // antes dele
    pointer(window, 'pointerup', 40, 50);
    // Solto: o card entrou na sequência (é outro nó agora) e nada mais acompanha o cursor.
    expect(screen.getAllByTestId('shared-scene').map((el) => el.style.transform)).toEqual(['', '', '']);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The pier', 'SC 03 The chase']);
  });

  it('com memoryKey a ordem do visitante fica guardada e volta; uma ordem guardada que não bate com o retrato é ignorada', () => {
    const { unmount } = render(<SharedBeats board={BOARD} dark={false} memoryKey="beats:tok" />);
    const [, pier, chase] = screen.getAllByTestId('shared-scene');
    carry(chase, pier, 0);
    expect(JSON.parse(localStorage.getItem('beats:tok') ?? 'null')).toEqual([{ id: 'loose_0', ids: ['e1'] }, { id: 's1', ids: ['e3', 'e2'] }, { id: 's2', ids: [] }]);
    unmount();

    const view = render(<SharedBeats board={BOARD} dark={false} memoryKey="beats:tok" />);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The chase', 'SC 03 The pier']);
    fireEvent.click(screen.getByText('Reset order'));
    expect(localStorage.getItem('beats:tok')).toBeNull();
    view.unmount();

    localStorage.setItem('beats:tok', JSON.stringify([{ id: 'loose_0', ids: ['e1'] }, { id: 's1', ids: ['e3', 'zzz'] }, { id: 's2', ids: [] }]));
    render(<SharedBeats board={BOARD} dark={false} memoryKey="beats:tok" />);
    expect(beats()).toEqual(['SC 01 Empty crate', 'SC 02 The pier', 'SC 03 The chase']);
  });

  it('clicar numa cena abre o card com os detalhes; clicar de novo fecha', () => {
    render(<SharedBeats board={BOARD} dark />);
    const [crate] = screen.getAllByTestId('shared-scene');
    expect(within(crate).queryByText('The crowbar: Nail by nail.')).toBeNull();
    fireEvent.click(crate);
    expect(crate).toHaveAttribute('aria-expanded', 'true');
    expect(within(crate).getByText('The crowbar: Nail by nail.')).toBeInTheDocument();
    fireEvent.click(crate);
    expect(crate).toHaveAttribute('aria-expanded', 'false');
  });
});
