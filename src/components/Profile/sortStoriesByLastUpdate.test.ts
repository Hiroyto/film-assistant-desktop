// Ordenação da grade de stories (Home + Profile) por último update.
import { sortStoriesByLastUpdate, lastUpdateMillis } from './sortStoriesByLastUpdate';

const ids = (works: Record<string, any>) => sortStoriesByLastUpdate(works).map(([id]) => id);

describe('sortStoriesByLastUpdate (grade da Home/Profile)', () => {
  it('ordena do mais recente para o mais antigo por lastModified, independente da ordem do mapa', () => {
    const works = {
      a: { storyId: 'a', lastModified: '2026-01-05T00:00:00.000Z' },
      b: { storyId: 'b', lastModified: '2026-03-01T00:00:00.000Z' },
      c: { storyId: 'c', lastModified: '2026-02-10T00:00:00.000Z' },
    };
    expect(ids(works)).toEqual(['b', 'c', 'a']);
  });

  it('usa createdAt quando lastModified falta ou é inválido; sem nenhum, vai para o fim', () => {
    const works = {
      noDates: { storyId: 'noDates' },
      createdOnly: { storyId: 'createdOnly', createdAt: '2026-02-01T00:00:00.000Z' },
      badModified: { storyId: 'badModified', lastModified: 'not-a-date', createdAt: '2026-03-01T00:00:00.000Z' },
      modified: { storyId: 'modified', lastModified: '2026-01-15T00:00:00.000Z' },
    };
    expect(ids(works)).toEqual(['badModified', 'createdOnly', 'modified', 'noDates']);
  });

  it('aceita epoch numérico e preserva a ordem de inserção em empates', () => {
    const works = {
      x: { storyId: 'x', lastModified: Date.UTC(2026, 0, 1) },
      y: { storyId: 'y', lastModified: '2026-01-01T00:00:00.000Z' },
      z: { storyId: 'z', lastModified: Date.UTC(2026, 5, 1) },
    };
    expect(ids(works)).toEqual(['z', 'x', 'y']);
  });

  it('devolve as entries com a story original (o grid continua lendo story.storyId)', () => {
    const works = { k1: { storyId: 'k1', title: 'T', lastModified: '2026-01-01T00:00:00.000Z' } };
    expect(sortStoriesByLastUpdate(works)).toEqual([['k1', works.k1]]);
  });

  it('lastUpdateMillis devolve 0 para story ausente ou sem datas', () => {
    expect(lastUpdateMillis(undefined)).toBe(0);
    expect(lastUpdateMillis(null)).toBe(0);
    expect(lastUpdateMillis({})).toBe(0);
    expect(lastUpdateMillis({ lastModified: '2026-01-01T00:00:00.000Z' })).toBe(Date.UTC(2026, 0, 1));
  });
});
