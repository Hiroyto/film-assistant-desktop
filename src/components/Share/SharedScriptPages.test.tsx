// O roteiro de um link, em folhas: a paginação do app (layoutScreenplay), a
// folha do editor, o número a partir da segunda página. `craco test`.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SharedScriptPages, scriptNavEntries } from './SharedScriptPages';
import { layoutScreenplay } from '../../lib/screenplayExport';
import type { SharedBoard, SharedScript } from '../../lib/shareLinks';

const b = (type: string, text: string) => ({ type, text });
const script = (...blocks: Array<{ type: string; text: string }>): SharedScript => ({ scenes: [{ id: 'e1', title: 'One', blocks }] });
const SPEECH = [b('character', 'Voss'), b('dialogue', 'Somebody wanted me to drive all the way out here and look at nothing.')];
/** Ação + fala, k vezes: o bastante para passar de uma página (54 linhas). */
const long = (k: number) => Array.from({ length: k }, (_, i) => [b('description', `Rain drums on a tin roof, and a chain knocks against a hull. (${i + 1})`), ...SPEECH]).flat();
const pages = () => screen.getAllByTestId('shared-page');

/** Três cenas com páginas (a do meio longa, para as seguintes caírem adiante) e o texto solto. */
const heading = (text: string) => b('scene', text);
const OUTLINE: SharedScript = {
  scenes: [
    { id: 'e1', title: 'Empty crate', number: 1, blocks: [heading('Int. warehouse - night'), ...long(3)] },
    { id: 'e3', title: 'The pier', number: 3, sequence: 'Act II', blocks: [heading('Ext. pier - night'), ...long(30)] },
    { id: 'e4', title: 'A favor owed', number: 4, sequence: 'Act II', blocks: [heading('Int. precinct - night'), ...long(2)] },
    { id: '__scratch__', title: '', blocks: [b('description', 'Loose idea for later.')] },
  ],
};
const rows = () => screen.getAllByTestId('script-nav-row').map((el) => el.textContent);
const width = window.innerWidth;
let scrolled: jest.Mock;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  // O jsdom não rola: o teste só confere PARA ONDE o painel manda.
  scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
});

describe('SharedScriptPages', () => {
  it('um roteiro curto é uma folha só: sem número e sem navegação de páginas', () => {
    render(<SharedScriptPages script={script(b('scene', 'Int. warehouse - night'), b('description', 'Rain.'), ...SPEECH)} dark={false} />);
    expect(pages()).toHaveLength(1);
    expect(pages()[0]).toHaveAttribute('aria-label', 'Page 1 of 1');
    expect(screen.queryByTestId('shared-page-number')).toBeNull();
    expect(screen.queryByTestId('shared-page-indicator')).toBeNull();
  });

  it('cada linha fica na coluna do seu tipo, como no editor (1 pol. = 96px)', () => {
    render(<SharedScriptPages script={script(b('scene', 'Int. warehouse - night'), b('description', 'Rain.'), b('character', 'Voss'), b('parenthetical', '(quiet)'), b('dialogue', 'Empty.'), b('transition', 'Cut to:'))} dark={false} />);
    const page = within(pages()[0]);
    // Slugline: caixa alta, negrito, na margem de 1,5 pol., primeira linha a 1 pol. do topo.
    expect(page.getByText('INT. WAREHOUSE - NIGHT')).toHaveStyle({ left: '144px', top: '96px', fontWeight: 700 });
    expect(page.getByText('Rain.')).toHaveStyle({ left: '144px', top: '128px', fontWeight: 400 }); // uma linha em branco antes
    expect(page.getByText('VOSS')).toHaveStyle({ left: '355.2px' });      // 3,7 pol.
    expect(page.getByText('(quiet)')).toHaveStyle({ left: '297.6px' });   // 3,1 pol.
    expect(page.getByText('Empty.')).toHaveStyle({ left: '240px' });      // 2,5 pol.
    expect(page.getByText('CUT TO:')).toHaveStyle({ right: '96px', textAlign: 'right' }); // encostada na margem direita
  });

  it('um roteiro longo quebra em folhas, numeradas a partir da segunda', () => {
    render(<SharedScriptPages script={script(b('scene', 'Int. warehouse - night'), ...long(40))} dark={false} />);
    const all = pages();
    expect(all.length).toBeGreaterThan(2);
    expect(all.map((p) => p.getAttribute('data-page'))).toEqual(all.map((_, i) => String(i + 1)));
    expect(within(all[0]).queryByTestId('shared-page-number')).toBeNull();
    expect(screen.getAllByTestId('shared-page-number').map((n) => n.textContent)).toEqual(all.slice(1).map((_, i) => `${i + 2}.`));
    // (As 54 linhas por folha são da paginação do app: lib/screenplayExport.test.ts.)
    expect(screen.getByTestId('shared-page-indicator')).toHaveTextContent(`Page 1 of ${all.length}`);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('as linhas de título ganham a própria folha, que não entra na contagem', () => {
    render(<SharedScriptPages script={script(b('title', 'THE EMPTY CRATE'), b('title', 'Written by'), b('title', 'A. Writer'), b('scene', 'Int. warehouse - night'), b('description', 'Rain.'))} dark={false} />);
    const all = pages();
    expect(all.map((p) => p.getAttribute('aria-label'))).toEqual(['Title page', 'Page 1 of 1']);
    expect(within(all[0]).getByText('THE EMPTY CRATE')).toHaveStyle({ left: '408px', textAlign: 'center' }); // centro da folha
    expect(within(all[1]).getByText('INT. WAREHOUSE - NIGHT')).toBeInTheDocument();
  });

  it('a tela mantém os glifos que o PDF trocaria: travessão, aspas curvas, letras fora do Latin-1', () => {
    render(<SharedScriptPages script={script(b('description', 'Żółć — “quoted” it’s fine…'))} dark />);
    expect(screen.getByText('Żółć — “quoted” it’s fine…')).toBeInTheDocument();
  });

  it('um tipo de linha desconhecido entra como ação, e a cena sem cenas não quebra', () => {
    render(<SharedScriptPages script={{ scenes: [{ id: 'x', title: '', blocks: [b('shot', 'ANGLE ON the crate.')] }, { id: 'y', title: '', blocks: [] }] }} dark={false} />);
    expect(screen.getByText('ANGLE ON the crate.')).toHaveStyle({ left: '144px' });
  });

  it('tema escuro: a folha escura do editor', () => {
    render(<SharedScriptPages script={script(b('description', 'Rain.'))} dark />);
    expect(pages()[0]).toHaveStyle({ background: '#1e1e1e', color: '#f3f4f6' });
  });
});

describe('scriptNavEntries — onde cada cena começa', () => {
  const entries = (script: SharedScript, board?: SharedBoard) => scriptNavEntries(script, layoutScreenplay(script.scenes.flatMap((s) => s.blocks) as never), board);

  it('acha a primeira linha de cada cena nas folhas, em ordem: página e linha', () => {
    const found = entries(OUTLINE);
    expect(found.map((e) => [e.id, e.label, e.number, e.sequence])).toEqual([
      ['e1', 'Empty crate', 1, ''], ['e3', 'The pier', 3, 'Act II'], ['e4', 'A favor owed', 4, 'Act II'], ['__scratch__', 'Loose pages', null, ''],
    ]);
    expect(found[0]).toMatchObject({ page: 1, sheet: 0, slot: 0 });
    // A cena longa empurra as seguintes para páginas adiante, e a ordem nunca volta.
    expect(found[2].page).toBeGreaterThan(found[1].page);
    const order = found.map((e) => e.page * 100 + e.slot);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // A linha achada é mesmo a slugline da cena.
    const layout = layoutScreenplay(OUTLINE.scenes.flatMap((s) => s.blocks) as never);
    expect(layout.pages[found[2].page - 1][found[2].slot]?.text).toBe('INT. PRECINCT - NIGHT');
  });

  it('duas cenas com a mesma slugline não se confundem: a busca segue de onde a anterior parou', () => {
    const twice: SharedScript = { scenes: [
      { id: 'a', title: 'First', blocks: [heading('Int. room - day'), ...long(2)] },
      { id: 'b', title: 'Second', blocks: [heading('Int. room - day'), ...long(2)] },
    ] };
    const [first, second] = entries(twice);
    expect(first.slot).toBe(0);
    expect(second.page * 100 + second.slot).toBeGreaterThan(first.page * 100 + first.slot);
  });

  it('com página de título, as folhas das cenas vêm uma adiante; a cena só de título não é linha do painel', () => {
    const titled: SharedScript = { scenes: [
      { id: 't', title: 'Cover', blocks: [b('title', 'THE EMPTY CRATE'), b('title', 'Written by')] },
      { id: 'e1', title: 'Empty crate', blocks: [b('title', 'A. Writer'), heading('Int. warehouse - night'), b('description', 'Rain.')] },
    ] };
    expect(entries(titled)).toEqual([expect.objectContaining({ id: 'e1', page: 1, sheet: 1, slot: 0 })]);
  });

  it('link antigo (cenas sem número nem sequência): vale o board do mesmo link; sem board, a ordem em que vêm', () => {
    const old: SharedScript = { scenes: OUTLINE.scenes.map(({ number: _n, sequence: _s, ...scene }) => scene) };
    const board = { sections: [
      { id: 'loose_0', title: '', scenes: [{ id: 'e1', number: 1, title: 'Empty crate', summary: '', characters: [] }] },
      { id: 's1', title: 'Act II', scenes: [{ id: 'e3', number: 3, title: 'The pier', summary: '', characters: [] }, { id: 'e4', number: 4, title: 'A favor owed', summary: '', characters: [] }] },
    ], characters: [], locations: [] };
    expect(entries(old, board).map((e) => [e.number, e.sequence])).toEqual([[1, ''], [3, 'Act II'], [4, 'Act II'], [null, '']]);
    expect(entries(old).map((e) => [e.number, e.sequence])).toEqual([[1, ''], [2, ''], [3, ''], [null, '']]);
  });
});

describe('o painel de navegação do roteiro', () => {
  it('lista as cenas com o número e a página onde começam, as sequências como seções, e o total de páginas', () => {
    render(<SharedScriptPages script={OUTLINE} dark={false} />);
    const nav = within(screen.getByRole('navigation', { name: 'Script outline' }));
    const all = rows();
    expect(all).toHaveLength(4);
    expect(all[0]).toBe('01Empty cratep. 1');
    expect(all[1]).toMatch(/^03The pierp\. \d+$/);
    expect(all[2]).toMatch(/^04A favor owedp\. \d+$/);
    expect(all[3]).toMatch(/^Loose pagesp\. \d+$/);
    expect(nav.getByText('Act II')).toBeInTheDocument();
    expect(nav.getByText(`${pages().length} pages`)).toBeInTheDocument();
    // No começo do roteiro a cena marcada é a primeira.
    expect(screen.getAllByTestId('script-nav-row')[0]).toHaveAttribute('aria-current', 'true');
  });

  it('clicar numa cena leva até onde ela começa e a marca', () => {
    render(<SharedScriptPages script={OUTLINE} dark={false} />);
    const favor = screen.getByRole('button', { name: /A favor owed/ });
    fireEvent.click(favor);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.instances[0]).toHaveAttribute('data-scene-anchor', 'e4');
    expect(favor).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('script-nav')).toBeInTheDocument(); // numa tela larga o painel fica
  });

  it('a página de título tem a sua linha; os botões de página levam à folha vizinha', () => {
    render(<SharedScriptPages script={{ scenes: [{ id: 'e1', title: 'Empty crate', blocks: [b('title', 'THE EMPTY CRATE'), heading('Int. warehouse - night'), ...long(40)] }] }} dark={false} />);
    expect(rows()[0]).toBe('Title page');
    fireEvent.click(screen.getByRole('button', { name: 'Title page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('a alça recolhe e reabre o painel, e a escolha fica guardada', () => {
    const { unmount } = render(<SharedScriptPages script={OUTLINE} dark={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the outline panel' }));
    expect(screen.queryByTestId('script-nav')).toBeNull();
    expect(localStorage.getItem('ff-share-script-nav')).toBe('0');
    unmount();

    render(<SharedScriptPages script={OUTLINE} dark={false} />);
    expect(screen.queryByTestId('script-nav')).toBeNull(); // quem recolheu o reencontra recolhido
    fireEvent.click(screen.getByRole('button', { name: 'Show the outline panel' }));
    expect(screen.getByTestId('script-nav')).toBeInTheDocument();
    expect(localStorage.getItem('ff-share-script-nav')).toBe('1');
  });

  it('numa tela estreita o painel é uma gaveta: começa fechado, abre por cima das folhas e fecha ao escolher uma cena', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true, writable: true });
    render(<SharedScriptPages script={OUTLINE} dark />);
    expect(screen.queryByTestId('script-nav')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the outline panel' }));
    expect(screen.getByTestId('script-nav')).toHaveStyle({ position: 'absolute' });
    fireEvent.click(screen.getByRole('button', { name: /The pier/ }));
    expect(scrolled.mock.instances[0]).toHaveAttribute('data-scene-anchor', 'e3');
    expect(screen.queryByTestId('script-nav')).toBeNull();
    expect(localStorage.getItem('ff-share-script-nav')).toBeNull(); // a gaveta não vira preferência
  });

  it('o que vem depois da última folha (a nota de preview) fica no fim da rolagem', () => {
    render(<SharedScriptPages script={OUTLINE} dark={false} footer={<span>A read-only preview.</span>} />);
    expect(within(screen.getByTestId('shared-script-scroll')).getByText('A read-only preview.')).toBeInTheDocument();
  });
});
