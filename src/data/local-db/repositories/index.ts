// Barrel dos repositories + adapter para o initial-pull (Tarefa 03).
import * as userRepo from './userRepo';
import * as storyRepo from './storyRepo';
import * as characterRepo from './characterRepo';
import * as settingsRepo from './settingsRepo';
import * as syncQueueRepo from './syncQueueRepo';
import * as snapshotRepo from './snapshotRepo';
import * as screenplayRepo from './screenplayRepo';
import type { InitialPullRepos } from '../../sync-agent/initial-pull';

export { userRepo, storyRepo, characterRepo, settingsRepo, syncQueueRepo, snapshotRepo, screenplayRepo };

/** Implementação concreta da interface consumida por runInitialPull (Tarefa 03). */
export const initialPullRepos: InitialPullRepos = {
  isUserPresent: userRepo.isUserPresent,
  upsertUser: userRepo.upsertUser,
  upsertSubscription: userRepo.upsertSubscription,
  upsertStory: storyRepo.upsertStory,
  replaceCharactersForStory: characterRepo.replaceCharactersForStory,
  markUserSynced: userRepo.markUserSynced,
};
