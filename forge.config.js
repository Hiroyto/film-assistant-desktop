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
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Windows Authenticode (signtool) — via env. Ex.: WINDOWS_CERT_FILE + WINDOWS_CERT_PASSWORD.
const windowsSign =
  process.env.WINDOWS_CERT_FILE && process.env.WINDOWS_CERT_PASSWORD
    ? {
        certificateFile: process.env.WINDOWS_CERT_FILE,
        certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      }
    : {};

// Entitlements do hardened runtime (JIT do V8 + .node nativo do better-sqlite3
// fora do asar). Sem eles o app ASSINADO crasha no boot / não abre o SQLite.
const MAC_ENTITLEMENTS = path.join(__dirname, 'build-resources', 'entitlements.mac.plist');

// macOS signing + notarization (@electron/notarize) — via env.
const macOSSign =
  process.env.APPLE_IDENTITY
    ? {
        osxSign: {
          identity: process.env.APPLE_IDENTITY,
          // JIT do V8 exige entitlements de hardened runtime adequados (AD-06).
          optionsForFile: () => ({
            hardenedRuntime: true,
            entitlements: MAC_ENTITLEMENTS,
          }),
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

// ---- O que fica FORA do asar ------------------------------------------------
// `ignore` é uma FUNÇÃO, não uma lista de regex, por um motivo concreto: o
// packager avalia também os DIRETÓRIOS intermediários e, se um diretório é
// ignorado, nunca desce nele. A regex antiga
//   /^\/src\/(?!data\/local-db\/migrations(\/|$))/
// pretendia "ignorar /src/ exceto as migrations", mas "/src/data" casa com
// ^\/src\/ e a lookahead nunca chega a ser testada em "/src/data/local-db/
// migrations" — a pasta era descartada em /src/data, o app saía SEM os .sql e o
// main (db/migrate.ts) abria um banco sem schema em toda instalação nova
// (mac 1.1.2: "no such table: sync_queue"; o Windows só funcionava porque um
// banco com schema já existia de uma execução não empacotada).
const MIGRATIONS_DIR = '/src/data/local-db/migrations';
// Os IGNORES PADRÃO do @electron/packager (copy-filter.js, DEFAULT_IGNORES) só
// são acrescentados quando `ignore` é uma lista de regex; com uma FUNÇÃO o
// packager usa exatamente o que ela devolve e nada mais. Foi assim que a 1.1.3
// passou de 219 MB para 510 MB: o `.git` do checkout do CI (o repo versiona
// ~240 MB de vídeos em src/) entrou inteiro no app.asar. Reproduzimos a lista
// padrão aqui, mais as pastas de tooling que também nunca são runtime.
const PACKAGER_DEFAULT_IGNORES = [
  /\/package-lock\.json$/,
  /\/yarn\.lock$/,
  /\/pnpm-lock\.yaml$/,
  /^\/\.git(\/|$)/,
  /^\/node_modules\/\.bin(\/|$)/,
  /\.o(bj)?$/,
  /\/node_gyp_bins(\/|$)/,
];
const IGNORED = [
  ...PACKAGER_DEFAULT_IGNORES,
  // Cache de build/lint/test (babel-loader, eslint, jest, terser). Não é um
  // módulo, então o prune não o toca, e nada de runtime lê dali. Numa máquina
  // de dev chega a mais de 1 GB; no CI é o cache do próprio craco build.
  /^\/node_modules\/\.cache(\/|$)/,
  // (\/|$): ignora também a ENTRADA do diretório, senão sobra uma pasta vazia.
  /^\/\.github(\/|$)/,
  /^\/\.claude(\/|$)/,
  /^\/\.vscode(\/|$)/,
  /^\/out(\/|$)/,
  /^\/parity(\/|$)/,        // snapshots do teste de paridade web/desktop
  /^\/test-results(\/|$)/,
  /^\/backend-tests(\/|$)/,
  /^\/package-lock\.web\.json$/,
  /^\/shell\/src\//,
  /^\/shell\/tsconfig\.json$/,
  /^\/amplify\//,
  /^\/public\//,
  /^\/build-resources\//, // entitlements — usados na assinatura, não vão no app
  /^\/_reversa_sdd\//,
  /^\/my-app\//,
  /^\/\.env$/,
  /^\/craco\.config\.js$/,
  /^\/postcss\.config\.js$/,
  /^\/tailwind\.config\.js$/,
  /\.map$/,
];
/** @param {string} p caminho relativo à raiz do app, com barra inicial ('' = raiz). */
function ignorePath(p) {
  if (p === '' || p === '/') return false;
  if (p === '/src' || p.startsWith('/src/')) {
    // Mantém a cadeia /src → /src/data → /src/data/local-db → migrations/** ;
    // todo o resto de /src/ (fontes TS do renderer, já compiladas em build/) sai.
    const inside = p === MIGRATIONS_DIR || p.startsWith(MIGRATIONS_DIR + '/');
    const ancestor = (MIGRATIONS_DIR + '/').startsWith(p + '/');
    return !(inside || ancestor);
  }
  return IGNORED.some((re) => re.test(p));
}

module.exports = {
  packagerConfig: {
    name: 'Film Assistant',
    executableName: 'film-assistant',
    // Ícone do app (embed no .exe / .app). Sem extensão: o packager anexa
    // .ico no Windows e .icns no macOS. Gerado de src/assets/images/head-only.png.
    icon: path.join(__dirname, 'build-resources', 'icon'),
    asar: true,
    // Empacota: shell compilado (shell/dist) + build do renderer (build/) + manifesto.
    // Ignora fontes TS, node_modules de dev, specs e o legado de referência.
    ignore: ignorePath,
    ...windowsSign,
    ...macOSSign,
  },
  plugins: [
    // better-sqlite3 ships a native .node that cannot be dlopen'd from inside
    // app.asar. This plugin auto-unpacks native modules to app.asar.unpacked/
    // so `new Database(...)` works in packaged builds (BR-04).
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    // Electron Fuses (hardening do binário empacotado — security checklist):
    //   RunAsNode off: o .exe/.app assinado deixa de servir como runtime Node
    //     genérico (ELECTRON_RUN_AS_NODE) para qualquer processo local.
    //   NODE_OPTIONS / --inspect off: sem injeção de código ou debugger via env/CLI.
    //   OnlyLoadAppFromAsar + AsarIntegrity: o main só carrega de app.asar e o
    //     Electron valida o hash do asar embutido no binário (Win/macOS).
    //   CookieEncryption: cookies da session cifrados em disco.
    // Só afeta o output do package/make — o `electron` de dev segue intacto.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  makers: [
    {
      // Windows installer + auto-update feed (Squirrel.Windows).
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'film_assistant',
        authors: 'Hiroyto',
        setupExe: 'FilmAssistantSetup.exe',
        setupIcon: path.join(__dirname, 'build-resources', 'icon.ico'),
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
      config: { format: 'ULFO', icon: path.join(__dirname, 'build-resources', 'icon.icns') },
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
        draft: false,     // publica direto (não como rascunho) — necessário p/ download público + botões da web
      },
    },
  ],
};
