/* eslint-disable */
// Electron Forge config — build/distribuição do desktop (BC-09 / AD-06 / AD-09).
//
// Framework: Electron (ADR-001 accepted). Makers: Squirrel (Win), ZIP + DMG (macOS).
// Code signing (RISK-004 Win / RISK-005 macOS) é dirigido por env vars — sem
// certificados versionados. Se as env vars não estiverem presentes, o build sai
// NÃO-ASSINADO (ok para dev; bloquear em release via CI).
//
// Setup de assinatura é iniciado já na Fase 1 (não esperar Fase 4) — handoff.md §2.

const path = require('path');

// Windows Authenticode (signtool) — via env. Ex.: WINDOWS_CERT_FILE + WINDOWS_CERT_PASSWORD.
const windowsSign =
  process.env.WINDOWS_CERT_FILE && process.env.WINDOWS_CERT_PASSWORD
    ? {
        certificateFile: process.env.WINDOWS_CERT_FILE,
        certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      }
    : {};

// macOS signing + notarization (@electron/notarize) — via env.
const macOSSign =
  process.env.APPLE_IDENTITY
    ? {
        osxSign: {
          identity: process.env.APPLE_IDENTITY,
          // JIT do V8 exige entitlements de hardened runtime adequados (AD-06).
          optionsForFile: () => ({ hardenedRuntime: true }),
        },
        osxNotarize: process.env.APPLE_ID
          ? {
              tool: 'notarytool',
              appleId: process.env.APPLE_ID,
              appleIdPassword: process.env.APPLE_ID_PASSWORD,
              teamId: process.env.APPLE_TEAM_ID,
            }
          : undefined,
      }
    : {};

module.exports = {
  packagerConfig: {
    name: 'Film Assistant',
    executableName: 'film-assistant',
    asar: true,
    // Empacota: shell compilado (shell/dist) + build do renderer (build/) + manifesto.
    // Ignora fontes TS, node_modules de dev, specs e o legado de referência.
    ignore: [
      // ignora /src/ EXCETO as migrations SQL (lidas pelo main no boot — db/migrate.ts)
      /^\/src\/(?!data\/local-db\/migrations(\/|$))/,
      /^\/shell\/src\//,
      /^\/shell\/tsconfig\.json$/,
      /^\/amplify\//,
      /^\/public\//,
      /^\/_reversa_sdd\//,
      /^\/my-app\//,
      /^\/\.env$/,
      /^\/craco\.config\.js$/,
      /^\/postcss\.config\.js$/,
      /^\/tailwind\.config\.js$/,
      /\.map$/,
    ],
    ...windowsSign,
    ...macOSSign,
  },
  plugins: [
    // better-sqlite3 ships a native .node that cannot be dlopen'd from inside
    // app.asar. This plugin auto-unpacks native modules to app.asar.unpacked/
    // so `new Database(...)` works in packaged builds (BR-04).
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
  ],
  makers: [
    {
      // Windows installer + auto-update feed (Squirrel.Windows).
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'film_assistant',
        authors: 'Hiroyto',
        setupExe: 'FilmAssistantSetup.exe',
        ...(process.env.WINDOWS_CERT_FILE
          ? {
              certificateFile: process.env.WINDOWS_CERT_FILE,
              certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
            }
          : {}),
      },
    },
    {
      // Cross-platform zip (também usado como feed de update para macOS).
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      // macOS .dmg — T010 do spike ficou deferido; confirmar < 200 MB na Fase 1.
      name: '@electron-forge/maker-dmg',
      config: { format: 'ULFO' },
    },
  ],
  publishers: [
    {
      // AD-09: GitHub Releases público (latest.yml para auto-update).
      // Revisitar S3 + CloudFront pós-traction.
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: process.env.GITHUB_REPO_OWNER || 'TODO-owner',
          name: process.env.GITHUB_REPO_NAME || 'film-assistant-desktop',
        },
        prerelease: true, // canal beta primeiro (Fase 3)
      },
    },
  ],
};
