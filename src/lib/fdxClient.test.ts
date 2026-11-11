/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// fdxClient: é nele que um .fountain do shell (texto cru) vira cenas, nas três
// portas — abrir, reconectar e o push de cada save. Um .fdx passa intacto.
jest.mock('./ipcClient', () => ({ isDesktop: jest.fn() }));

import { isDesktop } from './ipcClient';
import { onFdxChanged, openFdx, watchFdx } from './fdxClient';

const SOURCE = 'INT. KITCHEN - NIGHT\n\nMARA pours two coffees.\n\nJOÃO\nYou are up early.\n';
const fountain = (over: Partial<FdxPayload> = {}): FdxPayload => ({
  ok: true, path: 'C:/scripts/k.fountain', fileName: 'k.fountain', format: 'fountain', source: SOURCE,
  sceneCount: 0, paragraphCount: 0, scenes: [], fullText: '', updatedAt: '2026-11-10T12:00:00.000Z', ...over,
});
const fdx: FdxPayload = {
  ok: true, path: 'C:/scripts/p.fdx', fileName: 'p.fdx', format: 'fdx', sceneCount: 1, paragraphCount: 2,
  scenes: [{ index: 0, number: '1', heading: 'INT. LOFT - DAY', snippet: 'Rain.', lineCount: 1, characters: [], paragraphs: [{ type: 'description', text: 'Rain.' }] }],
  fullText: 'INT. LOFT - DAY\nRain.', updatedAt: '2026-11-10T12:00:00.000Z',
};
const KITCHEN = {
  ok: true, format: 'fountain', sceneCount: 1,
  scenes: [{
    number: '1', heading: 'INT. KITCHEN - NIGHT', characters: ['JOÃO'],
    paragraphs: [
      { type: 'description', text: 'MARA pours two coffees.' },
      { type: 'character', text: 'JOÃO' },
      { type: 'dialogue', text: 'You are up early.' },
    ],
  }],
};

beforeEach(() => {
  (isDesktop as jest.Mock).mockReturnValue(true);
});
afterEach(() => {
  delete window.electronAPI;
});

describe('fdxClient', () => {
  it('openFdx e watchFdx: o .fountain sai com as cenas montadas', async () => {
    window.electronAPI = { openFdx: async () => fountain(), watchFdx: async () => fountain() } as never;
    expect(await openFdx()).toMatchObject(KITCHEN);
    expect(await watchFdx('C:/scripts/k.fountain')).toMatchObject(KITCHEN);
  });

  it('onFdxChanged: cada save do .fountain chega ao handler já como cenas', () => {
    let push: (p: FdxPayload) => void = () => {};
    window.electronAPI = { onFdxChanged: (h: (p: FdxPayload) => void) => { push = h; return () => {}; } } as never;
    const seen: FdxPayload[] = [];
    onFdxChanged((p) => seen.push(p));
    push(fountain());
    push(fountain({ ok: false, source: undefined, error: 'the file is empty (mid-save?)' }));
    expect(seen[0]).toMatchObject(KITCHEN);
    expect(seen[0].source).toBeUndefined();
    expect(seen[1]).toMatchObject({ ok: false, error: 'the file is empty (mid-save?)', scenes: [] });
  });

  it('um .fdx passa como o shell mandou; cancelar o diálogo continua null', async () => {
    window.electronAPI = { openFdx: async () => fdx, watchFdx: async () => null } as never;
    expect(await openFdx()).toBe(fdx);
    expect(await watchFdx('C:/scripts/gone.fountain')).toBeNull();
  });

  it('fora do desktop: nada abre, nada assina', async () => {
    (isDesktop as jest.Mock).mockReturnValue(false);
    window.electronAPI = { openFdx: async () => fdx } as never;
    expect(await openFdx()).toBeNull();
    expect(onFdxChanged(() => {})()).toBeUndefined();
  });
});
