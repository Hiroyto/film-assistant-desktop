// Testes do push-worker: o WRITE-BACK de synced_at/version na story após um push
// bem-sucedido — é por esses dois campos que o pull decide "conflito". `craco test`.
jest.mock('../../models/apiHelpers', () => ({ safeApiCall: jest.fn() }));
jest.mock('../local-db/repositories', () => ({
  syncQueueRepo: {
    listProcessable: jest.fn(),
    markInFlight: jest.fn(async () => undefined),
    markSucceeded: jest.fn(async () => undefined),
    markConflict: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
    depth: jest.fn(async () => 0),
  },
  storyRepo: {
    getStory: jest.fn(async () => null),
    markSynced: jest.fn(async () => undefined),
    setVersion: jest.fn(async () => undefined),
  },
}));

import { safeApiCall } from '../../models/apiHelpers';
import { storyRepo, syncQueueRepo } from '../local-db/repositories';
import { processQueue, storyIdOfEntry, versionFromWorksResponse } from './push-queue';
import { isPullConflict } from './version-reconcile';
import type { SyncQueueRow } from '../local-db/rows';

const T_SAVE = '2026-10-06T12:00:00.000Z'; // save local (stories.updated_at)
const T_ENQ = '2026-10-06T12:00:10.000Z'; // debounce venceu: a entry nasce com o payload
const T_PUSH = '2026-10-06T12:00:12.000Z'; // o push concluiu

const entry = (over: Partial<SyncQueueRow> = {}): SyncQueueRow => ({
  id: 'e1',
  request_id: 'r1',
  entity_type: 'story',
  entity_id: 'story_1',
  operation: 'update',
  payload: JSON.stringify({ event: 'save', userId: 'u1', storyId: 'story_1' }),
  attempts: 0,
  last_attempt_at: null,
  next_attempt_at: T_ENQ,
  status: 'pending',
  failure_reason: null,
  conflict_metadata: null,
  created_at: T_ENQ,
  ...over,
});

/** Resposta do /works como chega pela API Gateway (integração non-proxy): body é string JSON. */
const worksOk = (version: number, storyId = 'story_1') => ({
  success: true,
  data: { statusCode: 200, body: JSON.stringify({ works: { [storyId]: { title: 'A', version } }, storyId }) },
});

async function pushOnce(row: SyncQueueRow, res: unknown): Promise<void> {
  (syncQueueRepo.listProcessable as jest.Mock).mockResolvedValueOnce([row]);
  (safeApiCall as jest.Mock).mockResolvedValueOnce(res);
  await processQueue({ getToken: () => 'tok', now: () => T_PUSH });
}

beforeEach(() => {
  jest.clearAllMocks();
  (storyRepo.getStory as jest.Mock).mockResolvedValue(null);
});

describe('write-back após push bem-sucedido (o pull lê synced_at/version — AD-02)', () => {
  it('story: grava synced_at = created_at da entry e a version devolvida pelo /works', async () => {
    await pushOnce(entry(), worksOk(7));
    expect(syncQueueRepo.markSucceeded).toHaveBeenCalledWith('e1');
    expect(storyRepo.markSynced).toHaveBeenCalledWith('story_1', T_ENQ, 7);
    expect(storyRepo.setVersion).not.toHaveBeenCalled();
    expect(storyRepo.getStory).not.toHaveBeenCalled(); // a resposta bastou
  });

  it('o estado gravado faz o pull seguinte NÃO ver conflito (o "conflito a cada boot")', () => {
    const remote = { version: 7, updated_at: T_PUSH, synced_at: T_PUSH };
    // Antes: a story salva ficava "pendente" (synced_at nulo) e uma version atrás.
    expect(isPullConflict({ version: 6, updated_at: T_SAVE, synced_at: null }, remote)).toBe(true);
    // Depois do write-back: synced_at >= updated_at e version igual à do backend.
    expect(isPullConflict({ version: 7, updated_at: T_SAVE, synced_at: T_ENQ }, remote)).toBe(false);
  });

  it('um save local feito DEPOIS de a entry nascer continua pendente (por isso created_at, não now)', () => {
    const T_LATER = '2026-10-06T12:00:11.000Z';
    const remote = { version: 8, updated_at: T_PUSH, synced_at: T_PUSH };
    expect(isPullConflict({ version: 7, updated_at: T_LATER, synced_at: T_ENQ }, remote)).toBe(true);
  });

  it('save-scenes ("<storyId>:<segment>") marca a story dona', async () => {
    await pushOnce(entry({ id: 'e2', entity_id: 'story_1:S3', payload: JSON.stringify({ event: 'save-scenes' }) }), worksOk(9));
    expect(storyRepo.markSynced).toHaveBeenCalledWith('story_1', T_ENQ, 9);
  });

  it('sem version na resposta: regra da Lambda, local + 1', async () => {
    (storyRepo.getStory as jest.Mock).mockResolvedValue({ story_id: 'story_1', version: 3 });
    await pushOnce(entry(), { success: true, data: { statusCode: 200, body: JSON.stringify({ message: 'ok' }) } });
    expect(storyRepo.markSynced).toHaveBeenCalledWith('story_1', T_ENQ, 4);
  });

  it('sem version e sem story local: não grava nada', async () => {
    await pushOnce(entry(), { success: true, data: {} });
    expect(storyRepo.markSynced).not.toHaveBeenCalled();
    expect(storyRepo.setVersion).not.toHaveBeenCalled();
    expect(syncQueueRepo.markSucceeded).toHaveBeenCalledTimes(1);
  });

  it('characters e screenplay incrementam a version da story no backend: só a version local muda', async () => {
    await pushOnce(entry({ id: 'e3', entity_type: 'character' }), worksOk(8));
    expect(storyRepo.setVersion).toHaveBeenCalledWith('story_1', 8);
    expect(storyRepo.markSynced).not.toHaveBeenCalled();

    (storyRepo.setVersion as jest.Mock).mockClear();
    await pushOnce(entry({ id: 'e4', entity_type: 'screenplay' }), worksOk(9));
    expect(storyRepo.setVersion).toHaveBeenCalledWith('story_1', 9);
    expect(storyRepo.markSynced).not.toHaveBeenCalled();
  });

  it('delete, user e character_refresh não tocam a story', async () => {
    await pushOnce(entry({ id: 'e5', operation: 'delete' }), worksOk(10));
    await pushOnce(entry({ id: 'e6', entity_type: 'user', entity_id: 'u1' }), { success: true, data: {} });
    await pushOnce(entry({ id: 'e7', entity_type: 'character_refresh' }), { success: true, data: {} });
    expect(storyRepo.markSynced).not.toHaveBeenCalled();
    expect(storyRepo.setVersion).not.toHaveBeenCalled();
    expect(syncQueueRepo.markSucceeded).toHaveBeenCalledTimes(3);
  });

  it('push que falha não grava nada (a entry volta com backoff)', async () => {
    await pushOnce(entry(), { success: false, error: 'boom', originalError: { response: { status: 500 } } });
    expect(syncQueueRepo.markFailed).toHaveBeenCalled();
    expect(storyRepo.markSynced).not.toHaveBeenCalled();
  });

  it('falha no write-back não re-enfileira: o backend já tem a mutation', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (storyRepo.markSynced as jest.Mock).mockRejectedValueOnce(new Error('db locked'));
    await pushOnce(entry(), worksOk(7));
    expect(syncQueueRepo.markSucceeded).toHaveBeenCalledWith('e1');
    expect(syncQueueRepo.markFailed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('created_at inválido cai em now()', async () => {
    await pushOnce(entry({ created_at: 'not-a-date' }), worksOk(7));
    expect(storyRepo.markSynced).toHaveBeenCalledWith('story_1', T_PUSH, 7);
  });
});

describe('versionFromWorksResponse (envelope da API Gateway)', () => {
  it('body string, body objeto e body cru', () => {
    expect(versionFromWorksResponse({ body: JSON.stringify({ works: { s: { version: 5 } } }) }, 's')).toBe(5);
    expect(versionFromWorksResponse({ body: { works: { s: { version: 5 } } } }, 's')).toBe(5);
    expect(versionFromWorksResponse({ works: { s: { version: '6' } } }, 's')).toBe(6);
  });

  it('sem works, outra story, version inválida ou body quebrado → null', () => {
    expect(versionFromWorksResponse({ body: JSON.stringify({ message: 'ok' }) }, 's')).toBe(null);
    expect(versionFromWorksResponse({ works: { outra: { version: 5 } } }, 's')).toBe(null);
    for (const version of [0, -1, 2.5, 'x', '', null, undefined]) {
      expect(versionFromWorksResponse({ works: { s: { version } } }, 's')).toBe(null);
    }
    expect(versionFromWorksResponse({ body: '{not json' }, 's')).toBe(null);
    expect(versionFromWorksResponse(undefined, 's')).toBe(null);
    expect(versionFromWorksResponse('', 's')).toBe(null);
  });
});

describe('storyIdOfEntry', () => {
  it('story (puro e "<storyId>:<segment>"), character e screenplay → storyId; o resto → null', () => {
    expect(storyIdOfEntry({ entity_type: 'story', entity_id: 'story_1' })).toBe('story_1');
    expect(storyIdOfEntry({ entity_type: 'story', entity_id: 'story_1:S3' })).toBe('story_1');
    expect(storyIdOfEntry({ entity_type: 'character', entity_id: 'story_1' })).toBe('story_1');
    expect(storyIdOfEntry({ entity_type: 'screenplay', entity_id: 'story_1' })).toBe('story_1');
    expect(storyIdOfEntry({ entity_type: 'user', entity_id: 'u1' })).toBe(null);
    expect(storyIdOfEntry({ entity_type: 'character_refresh', entity_id: 'story_1' })).toBe(null);
    expect(storyIdOfEntry({ entity_type: 'story', entity_id: ':S3' })).toBe(null);
  });
});
