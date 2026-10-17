/* eslint-disable import/first -- jest.mock precisa vir antes dos imports */
// O interruptor do local-first: desligado por padrão, só liga com a flag E no desktop. `craco test`.
jest.mock('./ipcClient', () => ({ isDesktop: jest.fn() }));

import { isDesktop } from './ipcClient';
import { isLocalFirst, localFirstEnabled } from './localFirst';

const ENV = 'REACT_APP_LOCAL_FIRST';

function withFlag(value: string | undefined, run: () => void): void {
  const saved = process.env[ENV];
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  }
}

describe('localFirstEnabled', () => {
  it('só "true" liga (qualquer caixa, com espaços); o resto desliga', () => {
    expect(localFirstEnabled('true')).toBe(true);
    expect(localFirstEnabled(' TRUE ')).toBe(true);
    // `undefined` explícito cai no parâmetro default (process.env) — o caso
    // "sem a variável" é o teste abaixo, que controla o ambiente.
    for (const v of ['false', '', '1', 'yes', 'on', 'True.']) {
      expect(localFirstEnabled(v)).toBe(false);
    }
  });

  it('desligado por padrão: sem a variável no ambiente', () => {
    withFlag(undefined, () => expect(localFirstEnabled()).toBe(false));
    withFlag('true', () => expect(localFirstEnabled()).toBe(true));
  });
});

describe('isLocalFirst', () => {
  it('exige desktop E flag; na web é sempre false', () => {
    (isDesktop as jest.Mock).mockReturnValue(true);
    withFlag('true', () => expect(isLocalFirst()).toBe(true));
    withFlag(undefined, () => expect(isLocalFirst()).toBe(false));
    withFlag('false', () => expect(isLocalFirst()).toBe(false));

    (isDesktop as jest.Mock).mockReturnValue(false);
    withFlag('true', () => expect(isLocalFirst()).toBe(false));
  });
});
