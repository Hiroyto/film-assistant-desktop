// Testes do BC-03 (persistência + watchdog do AI lock). `craco test`.
import { chooseScreenplaySource, encodeHtml, decodeHtml, saveScreenplay } from './model/screenplayPersistence';
import { createAiLockWatchdog, AI_LOCK_TOTAL_MS } from './model/aiLockWatchdog';
import { enqueueMutation } from '../../data/sync-queue';

jest.mock('../../data/sync-queue', () => ({
  enqueueMutation: jest.fn().mockResolvedValue({}),
}));

describe('chooseScreenplaySource (BR-MIGRAR-036)', () => {
  it('SQLite local tem prioridade sobre state', () => {
    expect(chooseScreenplaySource('<p>local</p>', '<p>state</p>')).toBe('<p>local</p>');
  });
  it('cai para state quando local vazio/null', () => {
    expect(chooseScreenplaySource('', '<p>state</p>')).toBe('<p>state</p>');
    expect(chooseScreenplaySource(null, '<p>state</p>')).toBe('<p>state</p>');
  });
  it('null quando nenhum disponível (vai para S3 fora daqui)', () => {
    expect(chooseScreenplaySource(null, null)).toBeNull();
  });
});

describe('encode/decode HTML (BLOB)', () => {
  it('round-trip preserva o HTML', () => {
    const html = '<p>Cena 1 — INT. CASA</p>';
    expect(decodeHtml(encodeHtml(html))).toBe(html);
  });
  it('decode de null vira string vazia', () => {
    expect(decodeHtml(null)).toBe('');
  });
});

describe('saveScreenplay payload (A4 — contrato da Lambda legada)', () => {
  it('enfileira com event/userId/storyId/screenplayContent (não o campo "html")', async () => {
    (enqueueMutation as jest.Mock).mockClear();
    await saveScreenplay('story_abc', '<p>FADE IN</p>', 'user-1');
    expect(enqueueMutation).toHaveBeenCalledWith({
      entityType: 'screenplay',
      entityId: 'story_abc',
      operation: 'update',
      payload: {
        event: 'save-screenplay',
        userId: 'user-1',
        storyId: 'story_abc',
        screenplayContent: '<p>FADE IN</p>',
      },
    });
  });
});

describe('aiLockWatchdog (COD-004 / FIL-315)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('NÃO dispara antes de 120s+grace', () => {
    const onTimeout = jest.fn();
    const wd = createAiLockWatchdog(onTimeout);
    wd.start('inlineAI');
    jest.advanceTimersByTime(AI_LOCK_TOTAL_MS - 1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(wd.isActive()).toBe(true);
  });

  it('dispara o unlock forçado após o timeout', () => {
    const onTimeout = jest.fn();
    const wd = createAiLockWatchdog(onTimeout);
    wd.start('inlineAI');
    jest.advanceTimersByTime(AI_LOCK_TOTAL_MS + 1);
    expect(onTimeout).toHaveBeenCalledWith('inlineAI');
    expect(wd.isActive()).toBe(false);
  });

  it('clear (unlock normal) evita o disparo', () => {
    const onTimeout = jest.fn();
    const wd = createAiLockWatchdog(onTimeout);
    wd.start();
    wd.clear();
    jest.advanceTimersByTime(AI_LOCK_TOTAL_MS + 1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
