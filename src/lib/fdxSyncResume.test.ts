/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// Reconexão do cowork ao vincular a story de novo (resumeFdxSync) e o fluxo do
// arquivo perdido: escolher → conferir → confirmar → desfazer. Motor real; o
// cliente do shell, a API e a auth são mockados. `craco test`.
jest.mock('./fdxClient', () => ({ openFdx: jest.fn(), watchFdx: jest.fn(), closeFdx: jest.fn(), onFdxChanged: jest.fn() }));
jest.mock('./freeformApi', () => ({
  listProjectEntities: jest.fn(), enqueueExtractionJob: jest.fn(), saveSceneText: jest.fn(), enqueueSceneExtraction: jest.fn(),
  updateCardName: jest.fn(), deleteCard: jest.fn(), ackSceneCleared: jest.fn(),
}));
jest.mock('./storySession', () => ({ pulseExtractionGlobal: jest.fn() }));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(async () => ({})) }));

import { closeFdx, onFdxChanged, openFdx, watchFdx } from './fdxClient';
import { deleteCard, enqueueExtractionJob, listProjectEntities } from './freeformApi';
import {
  __resetFdxSyncForTests,
  bindFdxSync,
  chooseFdxCandidate,
  confirmFdxCandidate,
  discardFdxCandidate,
  fdxCoworkFileFor,
  getFdxSyncSnapshot,
  stopFdxSync,
  storeKeyFor,
  undoFdxResync,
} from './fdxSync';

const AUTH = { userId: 'u1', token: 't' };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const payload = (over: Partial<FdxPayload> = {}): FdxPayload => ({
  ok: true, path: 'C:/scripts/pilot.fdx', fileName: 'pilot.fdx', title: 'Pilot', sceneCount: 0, paragraphCount: 0, scenes: [], fullText: '',
  updatedAt: '2026-10-20T12:00:00.000Z', ...over,
});
const scene = (number: string, heading: string, body: string): FdxScene =>
  ({ index: 0, number, heading, snippet: body, lineCount: 1, characters: [], paragraphs: [{ type: 'description', text: body }] });
const seedStore = (storyId: string, over: Record<string, unknown> = {}): void => {
  localStorage.setItem(storeKeyFor(storyId), JSON.stringify({
    v: 2, auto: true, scenes: {}, events: {}, filePath: 'C:/scripts/pilot.fdx', fileName: 'pilot.fdx', connected: true, ...over,
  }));
};
const persisted = (storyId: string): any => JSON.parse(localStorage.getItem(storeKeyFor(storyId)) ?? 'null');

beforeEach(() => {
  __resetFdxSyncForTests();
  localStorage.clear();
  (watchFdx as jest.Mock).mockResolvedValue(null);
  (openFdx as jest.Mock).mockResolvedValue(null);
  (closeFdx as jest.Mock).mockResolvedValue(undefined);
  (onFdxChanged as jest.Mock).mockReturnValue(() => {});
  (listProjectEntities as jest.Mock).mockResolvedValue({ entities: [] });
  (enqueueExtractionJob as jest.Mock).mockResolvedValue(undefined);
  (deleteCard as jest.Mock).mockResolvedValue(undefined);
});
afterAll(() => __resetFdxSyncForTests());

describe('reconexão ao vincular a story (resumeFdxSync)', () => {
  it('store connected + caminho + auth → pede ao shell o MESMO arquivo, sem diálogo, e roda a primeira rodada', async () => {
    seedStore('s1');
    (watchFdx as jest.Mock).mockResolvedValue(payload());
    bindFdxSync('s1', AUTH);
    await tick();
    expect(watchFdx).toHaveBeenCalledWith('C:/scripts/pilot.fdx');
    expect(openFdx).not.toHaveBeenCalled();
    expect(getFdxSyncSnapshot()).toMatchObject({ active: true, fileName: 'pilot.fdx' });
    expect(getFdxSyncSnapshot().fileMissing).toBeUndefined();
    expect(listProjectEntities).toHaveBeenCalled();
    expect(persisted('s1').connected).toBe(true);
  });

  it('arquivo sumiu → fileMissing no snapshot, motor desligado; uma tentativa por vinculação', async () => {
    seedStore('s1');
    bindFdxSync('s1', AUTH);
    await tick();
    expect(getFdxSyncSnapshot()).toMatchObject({ active: false, fileMissing: 'pilot.fdx' });
    bindFdxSync('s1', AUTH); // auth renovada: não tenta de novo
    await tick();
    expect(watchFdx).toHaveBeenCalledTimes(1);
  });

  it('sem connected (store antigo, ou stop): não reconecta', async () => {
    seedStore('s1', { connected: undefined });
    bindFdxSync('s1', AUTH);
    await tick();
    expect(watchFdx).not.toHaveBeenCalled();
  });

  it('sem auth nenhuma ainda: espera a auth chegar (a primeira rodada precisa dela)', async () => {
    seedStore('s1');
    (watchFdx as jest.Mock).mockResolvedValue(payload());
    bindFdxSync('s1', null);
    await tick();
    expect(watchFdx).not.toHaveBeenCalled();
    bindFdxSync('s1', AUTH); // a mesma vinculação, agora com auth
    await tick();
    expect(watchFdx).toHaveBeenCalledTimes(1);
    expect(getFdxSyncSnapshot().active).toBe(true);
  });

  it('trocar de story solta o watcher mas mantém connected; voltar reconecta; o stop explícito desliga', async () => {
    seedStore('s1');
    (watchFdx as jest.Mock).mockResolvedValue(payload());
    bindFdxSync('s1', AUTH);
    await tick();
    bindFdxSync('s2', AUTH);
    await tick();
    expect(closeFdx).toHaveBeenCalledTimes(1);
    expect(persisted('s1').connected).toBe(true);
    expect(fdxCoworkFileFor('s1')).toBe('pilot.fdx'); // outra tela pergunta pelo store
    expect(fdxCoworkFileFor('s2')).toBeNull();
    bindFdxSync('s1', AUTH);
    await tick();
    expect(watchFdx).toHaveBeenCalledTimes(2);
    expect(getFdxSyncSnapshot().active).toBe(true);
    await stopFdxSync();
    expect(persisted('s1').connected).toBe(false);
    expect(fdxCoworkFileFor('s1')).toBeNull();
    expect(getFdxSyncSnapshot().active).toBe(false);
  });
});

describe('arquivo perdido: escolher → conferir → confirmar → desfazer', () => {
  const mapped = {
    r1: { id: 'r1', eventId: 'evt_a', number: '1', heading: 'INT. BAR - NIGHT', headingNorm: 'INT BAR NIGHT', bodyHash: 'h1', lastSeenAt: 'x' },
    r2: { id: 'r2', eventId: 'evt_b', number: '2', heading: 'EXT. STREET - DAY', headingNorm: 'EXT STREET DAY', bodyHash: 'h2', lastSeenAt: 'x' },
  };
  beforeEach(async () => {
    seedStore('s1', { scenes: mapped, events: { evt_a: {}, evt_b: {} } });
    bindFdxSync('s1', AUTH);
    await tick(); // watchFdx → null → fileMissing
    expect(getFdxSyncSnapshot().fileMissing).toBe('pilot.fdx');
  });

  it('escolher: o motor segura o arquivo como candidato, com o relatório, SEM sincronizar; cancelar solta o watcher', async () => {
    (openFdx as jest.Mock).mockResolvedValue(payload({
      scenes: [scene('1', 'INT. BAR - NIGHT', 'a'), scene('2', 'EXT. STREET - DAY', 'b'), scene('3', 'INT. CAR - DAY', 'c')],
    }));
    const report = await chooseFdxCandidate();
    expect(report).toMatchObject({ scenes: 3, matched: 2, added: 1, missing: 0, mapped: 2, sameScript: true });
    expect(getFdxSyncSnapshot()).toMatchObject({ active: false, candidate: { fileName: 'pilot.fdx' } });
    expect(listProjectEntities).not.toHaveBeenCalled();
    await discardFdxCandidate();
    expect(closeFdx).toHaveBeenCalled();
    expect(getFdxSyncSnapshot().candidate).toBeUndefined();
    expect(getFdxSyncSnapshot().fileMissing).toBe('pilot.fdx');
  });

  it('roteiro diferente: sameScript false (a UI avisa antes de confirmar)', async () => {
    (openFdx as jest.Mock).mockResolvedValue(payload({ fileName: 'other.fdx', scenes: [scene('1', 'INT. SPACESHIP - NIGHT', 'z')] }));
    expect(await chooseFdxCandidate()).toMatchObject({ matched: 0, added: 1, missing: 2, sameScript: false });
  });

  it('confirmar liga o motor no arquivo novo e oferece desfazer; desfazer restaura mapa e arquivo, solta o watcher e manda os cards do job errado para o Trash', async () => {
    (openFdx as jest.Mock).mockResolvedValue(payload({ path: 'D:/other.fdx', fileName: 'other.fdx', scenes: [scene('1', 'INT. SPACESHIP - NIGHT', 'z')] }));
    await chooseFdxCandidate();
    expect(await confirmFdxCandidate()).toBe(true);
    const after = getFdxSyncSnapshot();
    expect(after.active).toBe(true);
    expect(after.fileName).toBe('other.fdx');
    expect(after.candidate).toBeUndefined();
    expect(after.undo).toMatchObject({ fileName: 'other.fdx', previousFileName: 'pilot.fdx' });
    expect(after.pending?.braindumpId).toMatch(/^fdx_/); // a cena desconhecida foi para a IA
    expect(persisted('s1').filePath).toBe('D:/other.fdx');
    const jobId = after.pending!.braindumpId;

    // O job errado já pousou um card: desfazer manda-o para o Trash agora.
    (listProjectEntities as jest.Mock).mockResolvedValue({
      entities: [{ id: 'evt_wrong', type: 'event', working_title: 'W', src_braindump: `${jobId}_w1`, src_start: '0', src_end: '10' }],
    });
    await undoFdxResync();
    await tick();
    const back = getFdxSyncSnapshot();
    expect(back).toMatchObject({ active: false, fileName: 'pilot.fdx', fileMissing: 'pilot.fdx', mappedCount: 2 });
    expect(back.undo).toBeUndefined();
    expect(back.pending).toBeUndefined();
    expect(closeFdx).toHaveBeenCalled();
    expect(deleteCard).toHaveBeenCalledWith({ cardId: 'evt_wrong', projectId: 's1' }, 't');
    const st = persisted('s1');
    expect(st.filePath).toBe('C:/scripts/pilot.fdx');
    expect(st.connected).toBe(true);
    expect(st.disownedJobs).toEqual([expect.objectContaining({ id: jobId })]);
  });
});
