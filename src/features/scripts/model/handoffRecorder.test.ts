// Testes do recorder de conversation_history dos 3 handoffs (parity specs 04/10).
import {
  armHandoffRecorder,
  resetHandoffRecorder,
  recordHandoffHistory,
  getHandoffHistories,
} from './handoffRecorder';

describe('handoffRecorder', () => {
  it('é inerte até ser armado', () => {
    recordHandoffHistory(0, [{ role: 'user' }]);
    expect(getHandoffHistories()).toEqual([[], [], []]);
  });

  it('captura o histórico de cada handoff em [h1, h2, h3]', () => {
    armHandoffRecorder();
    const h1 = [{ role: 'user', content: 'a' }];
    const h2 = [...h1, { role: 'assistant', content: 'b' }];
    const h3 = [...h2, { role: 'user', content: 'c' }];
    recordHandoffHistory(0, h1);
    recordHandoffHistory(1, h2);
    recordHandoffHistory(2, h3);
    const out = getHandoffHistories();
    expect(out[0]).toEqual(h1);
    expect(out[2]).toEqual(expect.arrayContaining(out[0])); // invariante dos specs
  });

  it('sempre devolve 3 arrays densos mesmo com handoffs faltando', () => {
    armHandoffRecorder();
    recordHandoffHistory(0, [{ role: 'user' }]); // só o 1º
    const out = getHandoffHistories();
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual([]);
  });

  it('devolve cópias (imutável por fora)', () => {
    armHandoffRecorder();
    recordHandoffHistory(0, [{ role: 'user' }]);
    const snap = getHandoffHistories();
    snap[0].push({ role: 'hacker' });
    expect(getHandoffHistories()[0]).toHaveLength(1);
  });

  it('arm e reset zeram as 3 posições; índices fora de 0..2 são ignorados', () => {
    armHandoffRecorder();
    recordHandoffHistory(0, [{ x: 1 }]);
    recordHandoffHistory(5, [{ y: 2 }]); // ignorado
    resetHandoffRecorder();
    expect(getHandoffHistories()).toEqual([[], [], []]);
  });
});
