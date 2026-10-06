// Guarda de contraste dos tokens de texto do light mode: o palco creme usa
// estes valores em chrome de 11–12px, onde o piso é 4,5:1.
import { PEER_BLUE, PEER_BLUE_INK, noteSurface } from './tokens';

const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};
const contrast = (fg: string, bg: string) => {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe('tokens de texto do light mode', () => {
  it('PEER_BLUE_INK passa 4.5:1 sobre branco e sobre o painel creme (o PEER_BLUE base não passa)', () => {
    expect(contrast(PEER_BLUE_INK, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PEER_BLUE_INK, noteSurface(false).panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(PEER_BLUE, '#ffffff')).toBeLessThan(3);
  });

  it('o quiet do noteSurface light passa 4.5:1 sobre branco e sobre o próprio painel', () => {
    const s = noteSurface(false);
    expect(contrast(s.quiet, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.quiet, s.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.voice, s.panel)).toBeGreaterThanOrEqual(7);
  });
});
