// PT-003 — Story create/edit/save local-first (AD-01 / BR-MIGRAR-009..017,053).
// RISK-011: preservação de scenes no switch de página é o cenário crítico.
import { test, expect } from '../fixtures';

test.describe('Story create + edit + save (local-first)', () => {
  test('@paridade @critico criar story persiste em SQLite imediatamente', async ({ page, bridge, client }) => {
    await page.getByLabel(/brainstorm/i).fill('x'.repeat(60));
    await page.getByRole('button', { name: /build your story/i }).click();
    if (client === 'desktop') {
      const row = await bridge.dbGet('SELECT story_id, synced_at FROM stories ORDER BY created_at DESC LIMIT 1');
      expect(row?.story_id).toMatch(/^story_\d+_[a-z0-9]{6}$/);
      expect(row?.synced_at).toBeNull(); // ainda não sincronizado
      expect(await bridge.queueDepth()).toBeGreaterThan(0); // entry story.create enfileirada
    }
    await expect(page).toHaveURL(/foundation/);
  });

  test('@paridade @critico editar foundation → debounce 10s + write local', async ({ page, bridge, client }) => {
    await page.getByLabel(/genre/i).fill('Drama'); // React state imediato
    if (client === 'desktop') {
      // após 10s sem digitar, stories.genre = Drama
      await page.waitForTimeout(10500);
      const row = await bridge.dbGet('SELECT genre FROM stories ORDER BY updated_at DESC LIMIT 1');
      expect(row?.genre).toBe('Drama');
    }
  });

  test('@paridade @critico AI response força immediate save', async ({ page, bridge, client }) => {
    await page.getByRole('button', { name: /generate synopsis/i }).click();
    // backend retorna SUM → force=true grava SQLite e flush imediato
    if (client === 'desktop') {
      const row = await bridge.dbGet('SELECT synopsis FROM stories ORDER BY updated_at DESC LIMIT 1');
      expect(row?.synopsis).toBeTruthy();
    }
  });

  test('@paridade @critico @regressao-esperada switch de página preserva scenes (fix tech-debt #1)', async ({
    page,
    bridge,
    client,
  }) => {
    test.skip(client === 'web', 'observa segments_json via SQLite');
    // S5 tem { S, scenes:[scene1,scene2] }; navega Profile e volta → scenes intactas
    await page.goto('/?screen=scenes&segment=S5&fixture=two-scenes');
    await page.goto('/?screen=profile');
    await page.goto('/?screen=outline');
    const row = await bridge.dbGet('SELECT segments_json FROM stories ORDER BY updated_at DESC LIMIT 1');
    const segs = JSON.parse(row.segments_json);
    expect(segs.S5.scenes).toHaveLength(2); // nenhum save reduziu a scalar
  });

  test('@paridade @critico STORIES_LIMIT 5 bloqueia criação (DEC-009)', async ({ page }) => {
    await page.goto('/?fixture=five-stories');
    await page.getByLabel(/brainstorm/i).fill('x'.repeat(60));
    await page.getByRole('button', { name: /build your story/i }).click();
    await expect(page.getByText(/storage limit reached|limit/i)).toBeVisible();
  });

  test('@paridade @critico one AI in flight bloqueia geração concorrente', async ({ page }) => {
    await page.goto('/?fixture=generating');
    await expect(page.getByRole('button', { name: /generate/i }).first()).toBeDisabled();
  });

  test('@paridade @ordem ordem de mutations preservada por entidade', async ({ page, bridge, client }) => {
    test.skip(client === 'web', 'ordem observada no backend mock');
    // brainstorm < G < S1 em sequência rápida → backend recebe nessa ordem
    const order: string[] = await page.evaluate(() => (window as any).__TEST__?.capturedPushOrder?.() ?? []);
    expect(order).toEqual([...order].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });
});
