// Barrel do subsistema de fixtures (parity 19D).
export * from './types';
export { parseFixtureRequest, hasFixtureRequest } from './parseRequest';
export { SCREEN_MAP, resolveScreen } from './screenMap';
export { FIXTURES, resolveFixtureSpec } from './catalog';
export { buildSeedPlan } from './seedPlan';
export { applySeedPlan } from './applySeed';
export { runFixtureBoot } from './boot';
export type { FixtureBootDeps } from './boot';
