// BC-04 Scenes — API pública (ops + fan-out de sync). UI legada (components/Scenes)
// preservada (Op3). Único módulo que escreve `{ S, scenes }` (BR-MIGRAR-032).
export * from './model/sceneOps';
export * from './model/sceneSync';
export * from './model/saveScenes';
