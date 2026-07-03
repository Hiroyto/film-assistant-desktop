// Testes do backoff de reconnect do WebSocket (BR-MIGRAR-046). `craco test`.
import {
  computeReconnectDelay,
  ONLINE_MAX_ATTEMPTS,
  ONLINE_BASE_DELAY,
  EXTENDED_DELAYS,
} from './useWebSocket';

describe('computeReconnectDelay (BR-MIGRAR-046)', () => {
  it('fase online: 3000ms * 1.5^(n-1) nas 5 primeiras tentativas', () => {
    expect(computeReconnectDelay(1)).toBe(ONLINE_BASE_DELAY); // 3000
    expect(computeReconnectDelay(2)).toBe(4500);
    expect(computeReconnectDelay(ONLINE_MAX_ATTEMPTS)).toBeCloseTo(3000 * Math.pow(1.5, 4));
  });

  it('fase estendida: 30s, 1min, 5min após esgotar as tentativas online', () => {
    expect(computeReconnectDelay(ONLINE_MAX_ATTEMPTS + 1)).toBe(EXTENDED_DELAYS[0]); // 30s
    expect(computeReconnectDelay(ONLINE_MAX_ATTEMPTS + 2)).toBe(EXTENDED_DELAYS[1]); // 1min
    expect(computeReconnectDelay(ONLINE_MAX_ATTEMPTS + 3)).toBe(EXTENDED_DELAYS[2]); // 5min
  });

  it('cap em 5min para tentativas muito além (não desiste)', () => {
    expect(computeReconnectDelay(ONLINE_MAX_ATTEMPTS + 99)).toBe(300_000);
  });
});
