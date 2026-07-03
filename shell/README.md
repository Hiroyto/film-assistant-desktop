# `shell/` — Processo Electron (BC-09 Platform Shell)

Camada **nova** (não existe no legado). Processo main do Electron: OS lifecycle, IPC,
deep links, FS e auto-update. Framework definido pelo ADR-001 (`accepted`): **Electron**.

## Estado (após Tarefa 06 — BC-09)

- `src/main.ts` — boot, janela, single-instance, wiring de todos os módulos. ✅
- `src/preload.ts` — `contextBridge` expõe `openExternal`/`onDeepLink`/`onOsEvent`/`onUpdate`. ✅
- `src/ipc/channels.ts` — contrato de canais + `parseDeepLink`. ✅
- `src/ipc/bridge.ts` — handlers `invoke` (openExternal) + `sendToRenderer`. ✅
- `src/deep-links/protocol.ts` — registra `filmassistant://`, open-url (macOS) + argv (Windows), buffer cold-start. ✅
- `src/lifecycle/osLifecycle.ts` — `powerMonitor.resume`/`unlock-screen` + `before-quit` → renderer (AD-03). ✅
- `src/updater/autoUpdate.ts` — `update-electron-app` + GitHub Releases (AD-09). ✅
- `src/platform/paths.ts` — caminho do SQLite (`userData/film-assistant.db`). ✅
- `src/platform/external.ts` — `shell.openExternal` (http/https only). ✅

## Pendências para tarefas futuras

- **Tarefa 07 (BC-08)**: registrar o handler `IPC.DB_QUERY` (better-sqlite3) no bridge,
  abrindo o banco em `platform/paths.getDatabasePath()`.
- **Tarefa 15**: telas novas do shell (`os-menu-bar`, `update-available-modal`,
  `conflict-resolution-modal`) consumindo `onUpdate`/conflitos.

## Build

Manifesto em `../package.electron.json`. Pipeline: `craco build` (renderer) →
`tsc -p shell/tsconfig.json` (shell) → `electron-forge make`.
