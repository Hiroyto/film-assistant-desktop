// O veredito sobre o job de IA pendente do cowork (decidePendingJob): adota
// quando há spans legíveis; sem spans espera até o timeout OU, depois do
// braindump_complete, até uma folga curta. Pura, sem o motor. `craco test`.
import {
  BIG_PROSE,
  LANDING_GRACE_MS,
  PENDING_TIMEOUT_BIG_MS,
  PENDING_TIMEOUT_MS,
  WINDOW_SETTLE_MS,
  decidePendingJob,
} from './fdxSync';

const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const MIN = 60_000;

const job = (over: Partial<Parameters<typeof decidePendingJob>[0]> = {}) => ({
  enqueuedAt: at(0),
  prose: 'x'.repeat(1000),
  ...over,
});

describe('decidePendingJob', () => {
  it('spans legíveis → adota, não importa a idade nem o completed', () => {
    expect(decidePendingJob(job(), 1, T0 + 30 * MIN)).toEqual({ action: 'adopt' });
    expect(decidePendingJob(job({ completedAt: at(MIN), completedEvents: 0 }), 3, T0 + 2 * MIN)).toEqual({ action: 'adopt' });
  });

  it('sem spans e sem completed: espera até o timeout, depois libera (timeout)', () => {
    expect(decidePendingJob(job(), 0, T0 + 5 * MIN)).toEqual({ action: 'wait' });
    expect(decidePendingJob(job(), 0, T0 + PENDING_TIMEOUT_MS + 1)).toEqual({ action: 'release', reason: 'timeout' });
  });

  it('roteiro acima de BIG_PROSE (import windowed no servidor) usa o timeout longo', () => {
    const big = job({ prose: 'x'.repeat(BIG_PROSE + 1) });
    expect(decidePendingJob(big, 0, T0 + PENDING_TIMEOUT_MS + 1)).toEqual({ action: 'wait' });
    expect(decidePendingJob(big, 0, T0 + PENDING_TIMEOUT_BIG_MS + 1)).toEqual({ action: 'release', reason: 'timeout' });
    // 18k espelha o corte do servidor: 20k chars já é windowed.
    expect(decidePendingJob(job({ prose: 'x'.repeat(20_000) }), 0, T0 + PENDING_TIMEOUT_MS + 1)).toEqual({ action: 'wait' });
  });

  it('completed com zero eventos: libera na hora (nada vai pousar)', () => {
    expect(decidePendingJob(job({ completedAt: at(MIN), completedEvents: 0 }), 0, T0 + MIN + 1)).toEqual({
      action: 'release',
      reason: 'completed_no_cards',
    });
  });

  it('completed com eventos (ou sem counts): espera a folga de pouso, depois libera', () => {
    const done = job({ completedAt: at(MIN), completedEvents: 12 });
    expect(decidePendingJob(done, 0, T0 + MIN + LANDING_GRACE_MS - 1000)).toEqual({ action: 'wait' });
    expect(decidePendingJob(done, 0, T0 + MIN + LANDING_GRACE_MS + 1)).toEqual({ action: 'release', reason: 'completed_unreadable' });
    const noCounts = job({ completedAt: at(MIN) });
    expect(decidePendingJob(noCounts, 0, T0 + MIN + 1)).toEqual({ action: 'wait' });
    expect(decidePendingJob(noCounts, 0, T0 + MIN + LANDING_GRACE_MS + 1)).toEqual({ action: 'release', reason: 'completed_unreadable' });
  });

  it('o timeout geral continua valendo mesmo depois do completed', () => {
    const late = job({ completedAt: at(PENDING_TIMEOUT_MS - MIN), completedEvents: 12 });
    expect(decidePendingJob(late, 0, T0 + PENDING_TIMEOUT_MS + 1)).toEqual({ action: 'release', reason: 'timeout' });
  });

  it('job WINDOWED com spans mas sem complete: adota só com o conjunto parado há WINDOW_SETTLE_MS', () => {
    // As janelas pousam uma a uma; adotar a 1ª deixaria as cenas das outras
    // "novas" → outro job → cards duplicados.
    const big = job({ prose: 'x'.repeat(BIG_PROSE + 1), spansSeenAt: at(MIN) });
    expect(decidePendingJob(big, 12, T0 + MIN + 10_000)).toEqual({ action: 'wait' });
    expect(decidePendingJob(big, 12, T0 + MIN + WINDOW_SETTLE_MS)).toEqual({ action: 'adopt' });
    // Com o braindump_complete adota na hora; job um-shot (prose pequena) idem.
    expect(decidePendingJob(job({ prose: 'x'.repeat(BIG_PROSE + 1), completedAt: at(MIN), spansSeenAt: at(MIN) }), 12, T0 + MIN + 1)).toEqual({ action: 'adopt' });
    expect(decidePendingJob(job({ spansSeenAt: at(MIN) }), 1, T0 + MIN + 1)).toEqual({ action: 'adopt' });
    // Primeira rodada que viu spans (sem spansSeenAt ainda): espera.
    expect(decidePendingJob(job({ prose: 'x'.repeat(BIG_PROSE + 1) }), 3, T0 + MIN)).toEqual({ action: 'wait' });
  });

  it('datas inválidas não quebram: idade zero, espera', () => {
    expect(decidePendingJob({ enqueuedAt: 'garbage', prose: 'x' }, 0, T0)).toEqual({ action: 'wait' });
    expect(decidePendingJob({ enqueuedAt: at(0), prose: 'x', completedAt: 'garbage' }, 0, T0 + MIN)).toEqual({ action: 'wait' });
  });
});
