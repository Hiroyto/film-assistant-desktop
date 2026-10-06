// Testes do ongoing pull: conflito multi-device de verdade vs. o estado que o
// push antigo deixava (story "pendente" pelos timestamps, fila vazia) — este
// último aplica o remoto em vez de acusar conflito a cada boot. `craco test`.
jest.mock('../local-db/repositories', () => ({
  storyRepo: { getStory: jest.fn(async () => null), upsertStory: jest.fn(async () => undefined) },
  characterRepo: { replaceCharactersForStory: jest.fn(async () => undefined) },
  syncQueueRepo: { countOpenForStory: jest.fn(async () => 0) },
}));

import { storyRepo, syncQueueRepo } from '../local-db/repositories';
import { runPull, LOCAL_SETTLE_MS } from './pull-strategy';
import type { StoryRow } from '../local-db/rows';

const NOW = '2026-10-06T12:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const MIN = 60_000;

const localRow = (over: Partial<StoryRow> = {}): StoryRow => ({
  story_id: 'story_1',
  user_id: 'u1',
  title: 'A',
  brainstorm: null,
  genre: null,
  theme: null,
  mood_setting: null,
  core_question: null,
  synopsis: null,
  segments_json: '{}',
  version: 6,
  status: 'active',
  created_at: ago(60 * MIN),
  updated_at: ago(30 * MIN),
  synced_at: null,
  ...over,
});

// O backend está uma version à frente (ele incrementa em todo save).
const remote = { storyId: 'story_1', title: 'A', version: 7, updated_at: ago(MIN), characters: [] };

async function pull() {
  const onConflict = jest.fn();
  const report = await runPull({
    userId: 'u1',
    getWorks: async () => [remote as never],
    since: null,
    now: () => NOW,
    onConflict,
  });
  return { report, onConflict };
}

beforeEach(() => {
  jest.clearAllMocks();
  (storyRepo.getStory as jest.Mock).mockResolvedValue(null);
  (syncQueueRepo.countOpenForStory as jest.Mock).mockResolvedValue(0);
});

describe('runPull — "pendente" pelos timestamps vs. fila', () => {
  it('fila vazia + save antigo: aplica o remoto, sem conflito (o estado que o push antigo deixava)', async () => {
    (storyRepo.getStory as jest.Mock).mockResolvedValue(localRow());
    const { report, onConflict } = await pull();
    expect(report).toEqual({ applied: 1, skipped: 0, conflicts: 0 });
    expect(onConflict).not.toHaveBeenCalled();
    expect(syncQueueRepo.countOpenForStory).toHaveBeenCalledWith('story_1');
    expect(storyRepo.upsertStory).toHaveBeenCalledWith(
      expect.objectContaining({ story_id: 'story_1', version: 7, synced_at: NOW }),
    );
  });

  it('entry aberta na fila: é conflito de verdade', async () => {
    (storyRepo.getStory as jest.Mock).mockResolvedValue(localRow());
    (syncQueueRepo.countOpenForStory as jest.Mock).mockResolvedValue(1);
    const { report, onConflict } = await pull();
    expect(report).toEqual({ applied: 0, skipped: 0, conflicts: 1 });
    expect(onConflict).toHaveBeenCalledWith('story_1');
    expect(storyRepo.upsertStory).not.toHaveBeenCalled();
  });

  it('save local dentro da folga de debounce: conflito, sem nem consultar a fila', async () => {
    (storyRepo.getStory as jest.Mock).mockResolvedValue(localRow({ updated_at: ago(LOCAL_SETTLE_MS - 1000) }));
    const { report, onConflict } = await pull();
    expect(report.conflicts).toBe(1);
    expect(onConflict).toHaveBeenCalledWith('story_1');
    expect(syncQueueRepo.countOpenForStory).not.toHaveBeenCalled();
    expect(storyRepo.upsertStory).not.toHaveBeenCalled();
  });

  it('sem edição pendente e versões iguais: skip (o caminho normal depois do write-back do push)', async () => {
    (storyRepo.getStory as jest.Mock).mockResolvedValue(localRow({ version: 7, synced_at: ago(20 * MIN) }));
    const { report } = await pull();
    expect(report).toEqual({ applied: 0, skipped: 1, conflicts: 0 });
    expect(syncQueueRepo.countOpenForStory).not.toHaveBeenCalled();
    expect(storyRepo.upsertStory).not.toHaveBeenCalled();
  });

  it('story que não existe localmente: aplica', async () => {
    const { report } = await pull();
    expect(report).toEqual({ applied: 1, skipped: 0, conflicts: 0 });
    expect(syncQueueRepo.countOpenForStory).not.toHaveBeenCalled();
  });
});
