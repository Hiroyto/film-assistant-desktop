import { characterTiers, webGeometry, ovalPoints, fitZoom, MAX_PRINCIPALS, MAX_SUPPORTING, tierFloors } from './characterTiers';
import { CHAR_PILL_W, CHAR_PILL_H } from './constants';

// Real boards, anonymised to the two numbers the tiers read: [scenes the
// character is in, tie weight (3 per relationship card, 2 per structural
// edge)]. Imported 2026-10-17 on the luna profile.
// SCHINDLER: 67 characters, 241 scenes
const SCHINDLER = { scenes: 241, cast: [[144,17],[55,10],[42,5],[16,6],[15,3],[15,2],[13,2],[12,2],[12,2],[10,0],[9,3],[9,0],[9,0],[9,0],[8,3],[8,2],[8,0],[7,2],[6,6],[6,5],[6,0],[6,0],[5,0],[5,0],[5,0],[5,0],[5,0],[3,2],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[3,0],[2,2],[2,2],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[2,0],[1,2],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0],[0,0]] };
// CASABLANCA: 25 characters, 61 scenes
const CASABLANCA = { scenes: 61, cast: [[46,19],[33,8],[32,14],[25,9],[16,9],[11,2],[10,5],[8,3],[8,3],[8,0],[6,0],[3,0],[3,0],[3,0],[3,0],[2,0],[2,0],[2,0],[2,0],[1,0],[1,0],[1,0],[1,0],[1,0],[1,0]] };

function board(fx: { scenes: number; cast: number[][] }) {
  const ids = fx.cast.map((_, i) => `c${String(i).padStart(3, '0')}`);
  const presence = new Map(ids.map((id, i) => [id, fx.cast[i][0]]));
  const ties = new Map(ids.map((id, i) => [id, fx.cast[i][1]]));
  return { ids, sceneCount: fx.scenes, presence, ties };
}

describe('character tiers', () => {
  it('Schindler: 12 principals, 19 supporting, 36 in the minor drawer', () => {
    const b = board(SCHINDLER);
    const t = characterTiers(b);
    expect([t.principals.length, t.supporting.length, t.minor.length]).toEqual([12, 19, 36]);
    // The 12 seats go to the strongest: every principal outranks every
    // supporting player (a tie can win a seat over a few more scenes: Scherner,
    // 10 scenes and no ties, sits just outside), and no one in 10+ scenes is
    // ever folded into the drawer.
    const score = (id: string) => (b.ties.get(id) ?? 0) + (b.presence.get(id) ?? 0);
    const weakestPrincipal = Math.min(...t.principals.map(score));
    t.supporting.forEach((id) => expect(score(id)).toBeLessThanOrEqual(weakestPrincipal));
    const heavy = b.ids.filter((id) => (b.presence.get(id) ?? 0) >= tierFloors(b.sceneCount).principal);
    heavy.forEach((id) => expect(t.minor).not.toContain(id));
    // The drawer holds only bit parts: no ties, three scenes or fewer.
    t.minor.forEach((id) => {
      expect(b.ties.get(id)).toBe(0);
      expect(b.presence.get(id)).toBeLessThanOrEqual(3);
    });
  });

  it('Casablanca: 11 principals, 4 supporting, 10 minor', () => {
    const t = characterTiers(board(CASABLANCA));
    expect([t.principals.length, t.supporting.length, t.minor.length]).toEqual([11, 4, 10]);
  });

  it('every character lands in exactly one tier, caps respected', () => {
    for (const fx of [SCHINDLER, CASABLANCA]) {
      const b = board(fx);
      const t = characterTiers(b);
      const all = [...t.principals, ...t.supporting, ...t.minor];
      expect(new Set(all).size).toBe(b.ids.length);
      expect(all.length).toBe(b.ids.length);
      expect(t.principals.length).toBeLessThanOrEqual(MAX_PRINCIPALS);
      expect(t.supporting.length).toBeLessThanOrEqual(MAX_SUPPORTING);
    }
  });

  it('a fresh braindump cast (no scenes, no ties) still gets a web', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const t = characterTiers({ ids, sceneCount: 0, presence: new Map(), ties: new Map() });
    expect(t.principals).toHaveLength(5);
    expect(t.minor).toHaveLength(0);
  });

  it('is stable: the same board tiers the same way every render', () => {
    const b = board(SCHINDLER);
    expect(characterTiers(b)).toEqual(characterTiers({ ...b, ids: [...b.ids].reverse() }));
  });
});

describe('web geometry', () => {
  it('the outer ring clears the inner one, and neighbours clear each other', () => {
    for (const [inner, outer] of [[11, 19], [10, 4], [3, 0], [11, 24]]) {
      const g = webGeometry(inner, outer, CHAR_PILL_W, CHAR_PILL_H);
      const step = (rx: number, n: number) => (2 * Math.PI * rx) / Math.max(n, 1);
      expect(step(g.inner.rx, inner)).toBeGreaterThanOrEqual(CHAR_PILL_W + 23);
      if (g.outer) {
        expect(g.outer.rx - g.inner.rx).toBeGreaterThanOrEqual(CHAR_PILL_W);
        expect(g.outer.ry - g.inner.ry).toBeGreaterThanOrEqual(CHAR_PILL_H);
        expect(step(g.outer.rx, outer)).toBeGreaterThanOrEqual(CHAR_PILL_W + 23);
      }
      expect(g.width).toBeGreaterThan(g.height); // an oval for landscape screens
    }
  });

  it('Schindler opens at 75%, not 25%', () => {
    const g = webGeometry(11, 19, CHAR_PILL_W, CHAR_PILL_H);
    expect(fitZoom(g.width, g.height, 1462 - 96, 812 - 120)).toBe(0.75);
  });

  it('places n points on the oval', () => {
    const pts = ovalPoints(4, 100, 50, 0, 0);
    expect(pts).toHaveLength(4);
    expect(Math.round(pts[0].y)).toBe(-50); // first point at the top
  });
});
