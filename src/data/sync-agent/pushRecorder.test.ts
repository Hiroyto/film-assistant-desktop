// Testes do recorder de ordem de push (parity spec 03 @ordem).
import { armPushRecorder, recordPush, getPushOrder, resetPushRecorder } from './pushRecorder';

describe('pushRecorder', () => {
  it('é inerte até ser armado (no-op em produção)', () => {
    // Estado inicial do módulo: não armado. record() não acumula.
    recordPush('req-ignored');
    expect(getPushOrder()).toEqual([]);
  });

  it('captura a ordem dos pushes após armar', () => {
    armPushRecorder();
    recordPush('req-1');
    recordPush('req-2');
    recordPush('req-3');
    expect(getPushOrder()).toEqual(['req-1', 'req-2', 'req-3']);
  });

  it('arm zera o histórico anterior', () => {
    armPushRecorder();
    recordPush('a');
    armPushRecorder(); // novo ciclo
    recordPush('b');
    expect(getPushOrder()).toEqual(['b']);
  });

  it('getPushOrder devolve cópia (imutável por fora)', () => {
    armPushRecorder();
    recordPush('x');
    const snap = getPushOrder();
    snap.push('mutado');
    expect(getPushOrder()).toEqual(['x']);
  });

  it('resetPushRecorder limpa sem desarmar', () => {
    armPushRecorder();
    recordPush('x');
    resetPushRecorder();
    recordPush('y'); // ainda armado
    expect(getPushOrder()).toEqual(['y']);
  });
});
