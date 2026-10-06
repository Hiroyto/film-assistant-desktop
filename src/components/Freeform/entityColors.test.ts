// Cores de entidade por tema: a paleta base foi afinada para o palco escuro;
// no board creme (light) os tons que somem no branco voltam sombreados.
import { getEntityColor, entityColorForMode } from './entityColors';
import { ENTITY_COLORS, ENTITY_COLORS_LIGHT } from './tokens';
import type { EntityType } from './types';

// WCAG relative luminance / contrast ratio (sRGB).
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};
const contrastOnWhite = (hex: string) => (1.05) / (lum(hex) + 0.05);

describe('entity colors por tema', () => {
  it('dark (default) devolve a paleta base intacta', () => {
    (Object.keys(ENTITY_COLORS) as EntityType[]).forEach((t) => {
      expect(getEntityColor(t)).toBe(ENTITY_COLORS[t]);
      expect(getEntityColor(t, 'dark')).toBe(ENTITY_COLORS[t]);
    });
  });

  it('light sombreia só os tons que somem no branco e mantém os demais', () => {
    expect(getEntityColor('location', 'light')).toBe(ENTITY_COLORS_LIGHT.location);
    expect(getEntityColor('character', 'light')).toBe(ENTITY_COLORS_LIGHT.character);
    expect(getEntityColor('sequence', 'light')).toBe(ENTITY_COLORS_LIGHT.sequence);
    expect(getEntityColor('event', 'light')).toBe(ENTITY_COLORS.event);
    expect(getEntityColor('arc', 'light')).toBe(ENTITY_COLORS.arc);
    expect(getEntityColor('relationship', 'light')).toBe(ENTITY_COLORS.relationship);
  });

  it('entityColorForMode mapeia um hex já resolvido (qualquer caixa) e deixa passar cores fora da paleta', () => {
    expect(entityColorForMode(ENTITY_COLORS.location, 'light')).toBe(ENTITY_COLORS_LIGHT.location);
    expect(entityColorForMode(ENTITY_COLORS.location.toUpperCase(), 'light')).toBe(ENTITY_COLORS_LIGHT.location);
    expect(entityColorForMode(ENTITY_COLORS.location, 'dark')).toBe(ENTITY_COLORS.location);
    expect(entityColorForMode(ENTITY_COLORS.event, 'light')).toBe(ENTITY_COLORS.event);
    expect(entityColorForMode('#54bfdb', 'light')).toBe('#54bfdb');
    expect(entityColorForMode(undefined as any, 'light')).toBeUndefined();
  });

  it('toda cor de entidade no light passa 3:1 sobre branco (piso para UI não textual)', () => {
    (Object.keys(ENTITY_COLORS) as EntityType[]).forEach((t) => {
      const c = getEntityColor(t, 'light');
      expect({ type: t, color: c, ratio: +contrastOnWhite(c).toFixed(2) }).toEqual(
        expect.objectContaining({ ratio: expect.any(Number) }),
      );
      expect(contrastOnWhite(c)).toBeGreaterThanOrEqual(3);
    });
  });
});
