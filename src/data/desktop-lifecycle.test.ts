// Unit test for the desktop data-lifecycle wiring (Fase de Integração 9-13).
// Uses the REAL runInitialPull/needsInitialPull + transforms with injected fakes
// for safeApiCall / repos / session / scheduler, so it proves the backend->SQLite
// mapping AND the orchestration without Electron, a backend, or aws-amplify.

// aws-amplify-touching modules must be mocked (ESM under jest).
jest.mock('../features/auth/api/cognito', () => ({
  getFreshToken: jest.fn(async () => 'FRESH_TOKEN'),
  getMfaState: jest.fn(async () => ({ mfaConfiguration: 'OPTIONAL', hasTotpEnrolled: false })),
}));
jest.mock('../features/auth/model/session', () => ({
  startSession: jest.fn(() => jest.fn()),
}));

import {
  startDesktopDataLifecycle,
  worksToRawStories,
  requestSyncNow,
  LifecycleDeps,
} from './desktop-lifecycle';
import type { StoryRow } from './local-db/rows';

const USER_BODY = {
  cap: 12,
  subscription: 'pro',
  privacy: 1,
  sign_up_date: '2025-01-01',
  works: {
    s1: { title: 'Alpha', S1: 'open on a beach', characters: [{ name: 'Ada' }] },
    s2: { title: 'Beta', version: 3 },
  },
};

function makeDeps(overrides: Partial<LifecycleDeps> = {}): {
  deps: Partial<LifecycleDeps>;
  upserted: StoryRow[];
  schedulerDeps: () => any;
  spies: Record<string, jest.Mock>;
} {
  const upserted: StoryRow[] = [];
  const stopSession = jest.fn();
  const stopScheduler = jest.fn();
  const startSession = jest.fn((..._a: any[]) => stopSession);
  const startSyncScheduler = jest.fn((..._a: any[]) => stopScheduler);
  const processQueue = jest.fn(async () => {});
  const runPull = jest.fn(async () => ({ applied: 0, skipped: 0, conflicts: 0 }));
  const safeApiCall = jest.fn(async () => ({ success: true, data: { body: USER_BODY } }));

  const repos: LifecycleDeps['repos'] = {
    isUserPresent: jest.fn(async () => false), // first login -> initial pull runs
    upsertUser: jest.fn(),
    upsertSubscription: jest.fn(),
    upsertStory: jest.fn((row: StoryRow) => {
      upserted.push(row);
    }),
    replaceCharactersForStory: jest.fn(),
    markUserSynced: jest.fn(),
  };

  const deps: Partial<LifecycleDeps> = {
    safeApiCall: safeApiCall as any,
    getFreshToken: jest.fn(async () => 'FRESH_TOKEN') as any,
    getMfaState: jest.fn(async () => ({ mfaConfiguration: 'OPTIONAL', hasTotpEnrolled: false })) as any,
    startSession: startSession as any,
    startSyncScheduler: startSyncScheduler as any,
    processQueue: processQueue as any,
    runPull: runPull as any,
    rearmFailedQueue: jest.fn(async () => {}) as any,
    repos,
    ...overrides,
  };

  return {
    deps,
    upserted,
    schedulerDeps: () => (startSyncScheduler.mock.calls[0] || [])[0],
    spies: { startSession, stopSession, startSyncScheduler, stopScheduler, processQueue, runPull, safeApiCall, isUserPresent: repos.isUserPresent as jest.Mock, upsertUser: repos.upsertUser as jest.Mock },
  };
}

describe('worksToRawStories', () => {
  it('maps a { storyId: story } map to an array, injecting storyId from the key', () => {
    const out = worksToRawStories({ a: { title: 'A' }, b: { title: 'B' } });
    expect(out.map((s) => s.storyId).sort()).toEqual(['a', 'b']);
    expect(out.find((s) => s.storyId === 'a')?.title).toBe('A');
  });
  it('passes arrays through and tolerates null/garbage', () => {
    expect(worksToRawStories([{ storyId: 'x' }])).toHaveLength(1);
    expect(worksToRawStories(null)).toEqual([]);
    expect(worksToRawStories(42 as unknown)).toEqual([]);
  });
});

describe('startDesktopDataLifecycle', () => {
  it('runs the initial pull (backend -> rows) on first login, then starts the scheduler', async () => {
    const { deps, upserted, schedulerDeps, spies } = makeDeps();
    const onInitialPull = jest.fn();

    const handle = startDesktopDataLifecycle({
      userId: 'u-1',
      getEmail: () => 'ada@x.com',
      onInitialPull,
      deps,
    });
    await handle.ready;

    // session started with a flush handler
    expect(spies.startSession).toHaveBeenCalledTimes(1);
    // first-login gate checked
    expect(spies.isUserPresent).toHaveBeenCalledWith('u-1');
    // user + both stories upserted via the real transforms
    expect(spies.upsertUser).toHaveBeenCalledTimes(1);
    expect(upserted.map((r) => r.story_id).sort()).toEqual(['s1', 's2']);
    const s1 = upserted.find((r) => r.story_id === 's1')!;
    expect(s1.title).toBe('Alpha');
    expect(s1.user_id).toBe('u-1');
    // S1 outline made it into segments_json
    expect(JSON.parse(s1.segments_json).S1.S).toBe('open on a beach');
    // integrity report surfaced
    expect(onInitialPull).toHaveBeenCalledTimes(1);
    expect(onInitialPull.mock.calls[0][0]).toMatchObject({ storiesPulled: 2, worksReportedCount: 2, integrityOk: true });

    // scheduler started with a getWorks that maps the works map
    expect(spies.startSyncScheduler).toHaveBeenCalledTimes(1);
    const sd = schedulerDeps();
    expect(sd.userId).toBe('u-1');
    const works = await sd.getWorks();
    expect(works.map((w: any) => w.storyId).sort()).toEqual(['s1', 's2']);
    expect(await sd.getToken()).toBe('FRESH_TOKEN');
    expect(sd.getSince()).toBeNull();
  });

  it('skips the initial pull when the user is already present', async () => {
    const { deps, upserted, spies } = makeDeps({
      repos: {
        isUserPresent: jest.fn(async () => true),
        upsertUser: jest.fn(),
        upsertSubscription: jest.fn(),
        upsertStory: jest.fn(),
        replaceCharactersForStory: jest.fn(),
        markUserSynced: jest.fn(),
      },
    });
    const handle = startDesktopDataLifecycle({ userId: 'u-2', deps });
    await handle.ready;
    expect(upserted).toHaveLength(0);
    // scheduler still starts
    expect(spies.startSyncScheduler).toHaveBeenCalledTimes(1);
  });

  it('flushAll drains the queue and stop() tears down session + scheduler', async () => {
    const { deps, spies } = makeDeps();
    const handle = startDesktopDataLifecycle({ userId: 'u-3', deps });
    await handle.ready;

    await handle.flushAll();
    expect(spies.processQueue).toHaveBeenCalled();

    handle.stop();
    expect(spies.stopSession).toHaveBeenCalledTimes(1);
    expect(spies.stopScheduler).toHaveBeenCalledTimes(1);
  });

  it('still starts the scheduler when the initial pull throws (resilience)', async () => {
    const { deps, spies } = makeDeps({
      runInitialPull: jest.fn(async () => {
        throw new Error('network down');
      }) as any,
    });
    const handle = startDesktopDataLifecycle({ userId: 'u-4', deps });
    await handle.ready;
    expect(spies.startSyncScheduler).toHaveBeenCalledTimes(1);
  });

  it('syncNow runs pull + push; requestSyncNow proxies to the active lifecycle and is a no-op after stop', async () => {
    const { deps, spies } = makeDeps();
    const handle = startDesktopDataLifecycle({ userId: 'u-5', deps });
    await handle.ready;

    await handle.syncNow();
    expect(spies.runPull).toHaveBeenCalledTimes(1);
    expect(spies.processQueue).toHaveBeenCalled();

    await requestSyncNow(); // module-level proxy -> active lifecycle
    expect(spies.runPull).toHaveBeenCalledTimes(2);

    handle.stop();
    await requestSyncNow(); // after stop -> no-op
    expect(spies.runPull).toHaveBeenCalledTimes(2);
  });
});
