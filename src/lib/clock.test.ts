// Testes do relógio controlável (seam de timers). Cobre o relógio fake que sustenta
// window.__TEST__.advanceTimers nos parity specs 04/05/06/07.
import { createFakeClock, clock, installFakeClock, resetClock } from './clock';

describe('createFakeClock', () => {
  it('dispara um timeout exatamente quando o tempo virtual vence', () => {
    const c = createFakeClock();
    let fired = 0;
    c.setTimeout(() => { fired++; }, 1000);

    c.advance(999);
    expect(fired).toBe(0); // ainda não venceu
    c.advance(1);
    expect(fired).toBe(1); // venceu em t=1000
    c.advance(5000);
    expect(fired).toBe(1); // one-shot não repete
  });

  it('clearTimeout cancela antes de vencer', () => {
    const c = createFakeClock();
    let fired = 0;
    const h = c.setTimeout(() => { fired++; }, 1000);
    c.clearTimeout(h);
    c.advance(2000);
    expect(fired).toBe(0);
  });

  it('interval dispara repetidamente dentro de um advance único', () => {
    const c = createFakeClock();
    let ticks = 0;
    c.setInterval(() => { ticks++; }, 5000);
    c.advance(17000); // 5k, 10k, 15k
    expect(ticks).toBe(3);
  });

  it('clearInterval para o interval', () => {
    const c = createFakeClock();
    let ticks = 0;
    const h = c.setInterval(() => { ticks++; }, 5000);
    c.advance(12000); // 2 ticks
    c.clearInterval(h);
    c.advance(20000);
    expect(ticks).toBe(2);
  });

  it('avança now() e dispara timers agendados dentro de callbacks', () => {
    const c = createFakeClock(0);
    const order: number[] = [];
    c.setTimeout(() => {
      order.push(1);
      c.setTimeout(() => order.push(2), 100); // agendado em t=1000 → vence em 1100
    }, 1000);
    c.advance(1200);
    expect(order).toEqual([1, 2]);
    expect(c.now()).toBe(1200);
  });
});

describe('clock singleton', () => {
  afterEach(() => resetClock());

  it('installFakeClock redireciona o singleton clock e advance funciona', () => {
    const fake = installFakeClock();
    let fired = false;
    clock.setTimeout(() => { fired = true; }, 500);
    fake.advance(500);
    expect(fired).toBe(true);
  });

  it('resetClock restaura o relógio real (delegado aos globais)', () => {
    installFakeClock();
    resetClock();
    // Com o relógio real, clock.now() acompanha Date.now() (não o tempo virtual 0).
    expect(clock.now()).toBeGreaterThan(0);
  });
});
