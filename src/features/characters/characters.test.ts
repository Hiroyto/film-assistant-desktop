// Testes do BC-05 — CRUD puro + refresh async (AD-05, fix spinner-forever). `craco test`.
jest.mock('../../models/apiHelpers', () => ({ safeApiCall: jest.fn() }));
jest.mock('../../data/sync-queue', () => ({ enqueueMutation: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../data/local-db/repositories', () => ({
  characterRepo: { replaceCharactersForStory: jest.fn().mockResolvedValue(undefined) },
}));

import { safeApiCall } from '../../models/apiHelpers';
import { enqueueMutation } from '../../data/sync-queue';
import { addCharacter, updateCharacter, deleteCharacter, toggleLock, saveCharacters } from './model/characterCommands';
import { createCharacterRefresh } from './model/refresh';
import type { Character } from '../../models/character';

const flush = () => new Promise<void>((r) => process.nextTick(r));

describe('characterCommands (BR-MIGRAR-018/019/020)', () => {
  it('addCharacter faz upsert por name (PK) e marca is_new/user_touched', () => {
    let list = addCharacter([], { name: 'Hero' });
    expect(list).toHaveLength(1);
    expect(list[0].is_new).toBe(true);
    expect(list[0].importance).toBe('minor'); // default
    list = addCharacter(list, { name: 'Hero', description: 'updated' });
    expect(list).toHaveLength(1); // mesmo name => upsert
    expect(list[0].description).toBe('updated');
  });
  it('update/delete/toggleLock', () => {
    let list = addCharacter([], { name: 'Hero' });
    list = updateCharacter(list, 'Hero', { description: 'd' });
    expect(list[0].user_touched).toBe(true);
    list = toggleLock(list, 'Hero', true);
    expect(list[0].locked).toBe(true);
    list = deleteCharacter(list, 'Hero');
    expect(list).toHaveLength(0);
  });
  it('saveCharacters exige storyId (BR-MIGRAR-020)', async () => {
    await expect(saveCharacters('', [], 'u1')).rejects.toThrow(/storyId/);
  });

  it('saveCharacters enfileira no contrato da Lambda (A2): update-characters + mapa + userId', async () => {
    (enqueueMutation as jest.Mock).mockClear();
    const ana: Character = {
      name: 'Ana', description: 'lead', importance: 'major',
      locked: false, is_new: false, user_touched: true,
      arc: { starting_state: 's', goal: 'g', conflict: 'c', need: 'n', growth: 'dynamic' },
    };
    await saveCharacters('story_1', [ana], 'user-7');
    const arg = (enqueueMutation as jest.Mock).mock.calls[0][0];
    expect(arg.entityType).toBe('character');
    expect(arg.entityId).toBe('story_1');
    expect(arg.payload.event).toBe('update-characters');
    expect(arg.payload.userId).toBe('user-7');
    expect(arg.payload.storyId).toBe('story_1');
    // characters como MAPA keyed by name (DynamoDB shape), não array
    expect(Array.isArray(arg.payload.characters)).toBe(false);
    expect(arg.payload.characters.Ana.name).toBe('Ana');
  });
});

describe('createCharacterRefresh (AD-05 / BR-MIGRAR-022)', () => {
  beforeEach(() => {
    (safeApiCall as jest.Mock).mockReset();
    (enqueueMutation as jest.Mock).mockClear();
  });

  it('offline => enfileira e retorna queued', async () => {
    const ctrl = createCharacterRefresh({ getToken: () => 't', isOnline: () => false });
    const r = await ctrl.refresh('s1');
    expect(r.status).toBe('queued');
    expect(enqueueMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'character_refresh', entityId: 's1' }),
    );
  });

  it('online + WS push casando requestId => completed', async () => {
    (safeApiCall as jest.Mock).mockResolvedValue({ success: true });
    let reqId = '';
    const ctrl = createCharacterRefresh({
      getToken: () => 't',
      isOnline: () => true,
      events: { onRequested: (_s, id) => (reqId = id) },
    });
    const p = ctrl.refresh('s1');
    await flush(); // deixa safeApiCall resolver e o pending ser registrado
    const chars: Character[] = [];
    ctrl.notifyWsResult(reqId, chars);
    const r = await p;
    expect(r.status).toBe('completed');
    expect(r.requestId).toBe(reqId);
  });

  it('notifyWsResult com requestId desconhecido é ignorado (AD-05 stale)', async () => {
    const ctrl = createCharacterRefresh({ getToken: () => 't', isOnline: () => true });
    expect(() => ctrl.notifyWsResult('nope', [])).not.toThrow();
    expect(ctrl.hasPending()).toBe(false);
  });
});
