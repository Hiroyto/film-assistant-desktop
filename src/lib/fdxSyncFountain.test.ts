/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// O cowork com um .fountain: o motor é o mesmo do .fdx; o que muda é o ritmo do
// modo auto (um editor de texto salva sozinho, então a rodada espera o arquivo
// sossegar). Motor real; o cliente do shell, a API e a auth são mockados.
jest.mock('./fdxClient', () => ({ openFdx: jest.fn(), watchFdx: jest.fn(), closeFdx: jest.fn(), onFdxChanged: jest.fn() }));
jest.mock('./freeformApi', () => ({
  listProjectEntities: jest.fn(), enqueueExtractionJob: jest.fn(), saveSceneText: jest.fn(), enqueueSceneExtraction: jest.fn(),
  updateCardName: jest.fn(), deleteCard: jest.fn(), ackSceneCleared: jest.fn(),
}));
jest.mock('./storySession', () => ({ pulseExtractionGlobal: jest.fn() }));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(async () => ({})) }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { closeFdx, onFdxChanged, openFdx, watchFdx } from './fdxClient';
import { enqueueExtractionJob, listProjectEntities } from './freeformApi';
import {
  AUTO_DEBOUNCE_MS,
  FOUNTAIN_AUTO_DEBOUNCE_MS,
  __resetFdxSyncForTests,
  autoDebounceFor,
  bindFdxSync,
  fdxCoworkFileFor,
  getFdxSyncSnapshot,
  openFdxSync,
  storeKeyFor,
} from './fdxSync';
import { hydrateFountainPayload } from './fountainCowork';

const AUTH = { userId: 'u1', token: 't' };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
/** Deixa as promises encadeadas da rodada andarem (com timers falsos). */
const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

const fixture = readFileSync(join(__dirname, '__fixtures__', 'tide-gauge.fountain'), 'utf8');
const payload = (over: Partial<FdxPayload> = {}): FdxPayload => ({
  ok: true, path: 'C:/scripts/tide.fountain', fileName: 'tide.fountain', format: 'fountain',
  sceneCount: 0, paragraphCount: 0, scenes: [], fullText: '', updatedAt: '2026-11-10T12:00:00.000Z', ...over,
});
/** O handler que o motor inscreveu no watcher do shell. */
const changedHandler = (): ((p: FdxPayload) => void) => (onFdxChanged as jest.Mock).mock.calls[0][0];

beforeEach(() => {
  __resetFdxSyncForTests();
  localStorage.clear();
  (watchFdx as jest.Mock).mockResolvedValue(null);
  (openFdx as jest.Mock).mockResolvedValue(null);
  (closeFdx as jest.Mock).mockResolvedValue(undefined);
  (onFdxChanged as jest.Mock).mockReturnValue(() => {});
  (listProjectEntities as jest.Mock).mockResolvedValue({ entities: [] });
  (enqueueExtractionJob as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
  __resetFdxSyncForTests();
});

describe('autoDebounceFor', () => {
  it('.fdx: o save do Final Draft é o "terminei"; .fountain: espera o arquivo sossegar', () => {
    expect(autoDebounceFor({ format: 'fdx', fileName: 'pilot.fdx' })).toBe(AUTO_DEBOUNCE_MS);
    expect(autoDebounceFor({ fileName: 'pilot.fdx' })).toBe(AUTO_DEBOUNCE_MS); // payload antigo, sem format
    expect(autoDebounceFor({ format: 'fountain', fileName: 'tide.fountain' })).toBe(FOUNTAIN_AUTO_DEBOUNCE_MS);
    expect(autoDebounceFor({ fileName: 'Tide.FOUNTAIN' })).toBe(FOUNTAIN_AUTO_DEBOUNCE_MS);
    expect(FOUNTAIN_AUTO_DEBOUNCE_MS).toBeGreaterThan(AUTO_DEBOUNCE_MS);
  });
});

describe('abrir um .fountain no cowork', () => {
  it('bootstrap: as cenas do arquivo vão para a IA num job só, como num .fdx, e o arquivo vira o da story', async () => {
    (openFdx as jest.Mock).mockResolvedValue(hydrateFountainPayload(payload({ source: fixture })));
    bindFdxSync('s1', AUTH);
    expect(await openFdxSync()).toBe(true);

    expect(enqueueExtractionJob).toHaveBeenCalledTimes(1);
    const job = (enqueueExtractionJob as jest.Mock).mock.calls[0][0];
    expect(job).toMatchObject({ jobType: 'extract-braindump', projectId: 's1', sourceFormat: 'screenplay' });
    expect(String(job.braindumpId)).toMatch(/^fdx_/);
    expect(job.prose).toContain('EXT. HARBOUR WALL - DAWN');
    expect(job.prose).toContain('EST. LIGHTHOUSE - CONTINUOUS');
    expect(job.prose).toContain('JOÃO');

    expect(getFdxSyncSnapshot()).toMatchObject({ active: true, fileName: 'tide.fountain', title: 'TIDE GAUGE', sceneCount: 5 });
    expect(getFdxSyncSnapshot().pending).toMatchObject({ count: 5 });
    const st = JSON.parse(localStorage.getItem(storeKeyFor('s1')) ?? 'null');
    expect(st).toMatchObject({ filePath: 'C:/scripts/tide.fountain', fileName: 'tide.fountain', connected: true });
    expect(fdxCoworkFileFor('s1')).toBe('tide.fountain'); // a trava do editor de roteiro vê o .fountain
  });

  it('reabrir o app: reconecta ao mesmo .fountain sem diálogo', async () => {
    localStorage.setItem(storeKeyFor('s1'), JSON.stringify({
      v: 2, auto: true, scenes: {}, events: {}, filePath: 'C:/scripts/tide.fountain', fileName: 'tide.fountain', connected: true,
    }));
    (watchFdx as jest.Mock).mockResolvedValue(payload());
    bindFdxSync('s1', AUTH);
    await tick();
    expect(watchFdx).toHaveBeenCalledWith('C:/scripts/tide.fountain');
    expect(getFdxSyncSnapshot()).toMatchObject({ active: true, fileName: 'tide.fountain' });
  });
});

describe('modo auto: quanto esperar depois de um save', () => {
  const openWith = async (first: FdxPayload): Promise<number> => {
    (openFdx as jest.Mock).mockResolvedValue(first);
    bindFdxSync('s1', AUTH);
    await openFdxSync();
    return (listProjectEntities as jest.Mock).mock.calls.length; // rodadas até aqui
  };

  it('.fountain: saves em sequência (autosave) reiniciam a contagem; a rodada só sai com o arquivo parado', async () => {
    const before = await openWith(payload());
    jest.useFakeTimers();
    const changed = changedHandler();

    changed(payload({ updatedAt: '2026-11-10T12:00:01.000Z' }));
    jest.advanceTimersByTime(AUTO_DEBOUNCE_MS + 500); // o tempo de um .fdx: ainda não
    await flush();
    expect(listProjectEntities).toHaveBeenCalledTimes(before);
    expect(getFdxSyncSnapshot().dirty).toBe(true);

    changed(payload({ updatedAt: '2026-11-10T12:00:03.000Z' })); // outro save no meio: recomeça
    jest.advanceTimersByTime(FOUNTAIN_AUTO_DEBOUNCE_MS - 100);
    await flush();
    expect(listProjectEntities).toHaveBeenCalledTimes(before);

    jest.advanceTimersByTime(200);
    await flush();
    expect(listProjectEntities).toHaveBeenCalledTimes(before + 1);
  });

  it('.fdx: continua rodando logo depois do save', async () => {
    const fdx = { path: 'C:/scripts/pilot.fdx', fileName: 'pilot.fdx', format: 'fdx' as const };
    const before = await openWith(payload(fdx));
    jest.useFakeTimers();
    changedHandler()(payload({ ...fdx, updatedAt: '2026-11-10T12:00:01.000Z' }));
    jest.advanceTimersByTime(AUTO_DEBOUNCE_MS + 100);
    await flush();
    expect(listProjectEntities).toHaveBeenCalledTimes(before + 1);
  });
});
