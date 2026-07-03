// Testes do seam de personagens WS (parity spec 05). Exercita o caminho real:
// injeção no canal → useCharacterWsBridge (merge com locks) → characterCount, e o
// casamento de requestId do refresh controller. Mocka só a borda de rede (axios).
import axios from 'axios';
import { renderHook, act } from '@testing-library/react';

jest.mock('axios');
jest.mock('react-hot-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import { useCharacterWsBridge } from './useCharacterWsBridge';
import {
  armCharacterWsChannel,
  publishTestWs,
  getCurrentChars,
  getActiveRefresh,
} from './wsTestChannel';
import { createCharacterRefresh } from '../features/characters/model/refresh';
import { toCanonicalCharacterArray } from '../models/character';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const names = (chars: Array<{ name: string }>) => chars.map((c) => c.name).sort();

beforeEach(() => {
  armCharacterWsChannel();
});

describe('emitWsCharacters → bridge merge (spec 05)', () => {
  it('merge respeita locks: Alice locked sobrevive, novos entram, não-locked omitido cai', () => {
    const initial = toCanonicalCharacterArray([{ name: 'Alice', locked: true }, { name: 'Dana' }]);
    const { result } = renderHook(() =>
      useCharacterWsBridge('u', 's1', { initial }),
    );
    // batch WS omite Alice e Dana; traz Bob e Carol
    act(() => {
      publishTestWs({
        storyId: 's1',
        characters: [{ name: 'Bob', is_new: true }, { name: 'Carol', is_new: true }],
        analysisComplete: true,
      });
    });
    // Alice (locked) preservada; Bob/Carol entram; Dana (não-locked, omitida) cai.
    expect(names(result.current.characters)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(getCurrentChars().length).toBe(3); // characterCount reflete o bridge
  });

  it('batch duplicado é deduplicado (BR-MIGRAR-045)', () => {
    const initial = toCanonicalCharacterArray([{ name: 'Alice' }]);
    const { result } = renderHook(() => useCharacterWsBridge('u', 's1', { initial }));
    const batch = { storyId: 's1', characters: [{ name: 'Bob' }], analysisComplete: true };
    act(() => publishTestWs(batch));
    expect(names(result.current.characters)).toEqual(['Bob']);
    // mesma chave de conteúdo → ignorado (sem novo merge)
    act(() => publishTestWs({ ...batch }));
    expect(names(result.current.characters)).toEqual(['Bob']);
  });
});

describe('emitWsRefresh requestId matching (spec 05 / AD-05)', () => {
  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({ data: { accepted: true } } as any);
  });
  afterEach(() => jest.clearAllMocks());

  it('requestId ativo é registrado e o WS push casa → completed', async () => {
    const ctrl = createCharacterRefresh({ getToken: async () => 'tok', isOnline: () => true });
    let res: any;
    await act(async () => {
      const p = ctrl.refresh('s1');
      await new Promise((r) => setTimeout(r, 0)); // deixa o safeApiCall (mock) assentar
      const active = getActiveRefresh();
      expect(active).toBeTruthy();
      ctrl.notifyWsResult(active!, toCanonicalCharacterArray([{ name: 'Bob' }]));
      res = await p;
    });
    expect(res.status).toBe('completed');
  });

  it('requestId stale é ignorado (pending permanece)', async () => {
    const ctrl = createCharacterRefresh({ getToken: async () => 'tok', isOnline: () => true });
    await act(async () => {
      ctrl.refresh('s1');
      await new Promise((r) => setTimeout(r, 0));
    });
    ctrl.notifyWsResult('STALE_REQ', toCanonicalCharacterArray([{ name: 'X' }]));
    expect(ctrl.hasPending()).toBe(true); // stale não resolveu o refresh
  });
});
