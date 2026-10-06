const { copyPdfWorker } = require('./scripts/copy-pdf-worker');
const { buildDesktopCsp } = require('./scripts/desktop-csp');

const isProd = process.env.NODE_ENV === 'production';
// Setado pelos scripts desktop:* (package.json). Ausente no build da web.
const isDesktopBuild = process.env.DESKTOP_BUILD === '1';

// A CSP do renderer DESKTOP vive em scripts/desktop-csp.js (com teste em
// src/features/auth/desktopCsp.test.ts). Ela é montada DENTRO de
// webpack.configure, não aqui no topo: o craco avalia este arquivo antes de o
// CRA carregar o .env, e a CSP precisa do REACT_APP_COGNITO_OAUTH_DOMAIN para
// liberar o endpoint de token do Hosted UI (login com Google).

module.exports = {
  babel: {
    plugins: [
      process.env.NODE_ENV === 'production' && [
        'transform-remove-console',
        { exclude: ['error', 'warn'] },
      ],
    ].filter(Boolean),
  },
  webpack: {
    configure: (config) => {
      // Worker do pdf.js servido do próprio app (ver scripts/copy-pdf-worker.js).
      copyPdfWorker();

      if (isDesktopBuild) {
        const html = config.plugins.find((p) => p && p.constructor && p.constructor.name === 'HtmlWebpackPlugin');
        if (!html) throw new Error('[craco] HtmlWebpackPlugin não encontrado — CSP do desktop não aplicada');
        // html-webpack-plugin 5 mescla userOptions em `options` já no construtor —
        // é `options.meta` que o compile lê.
        const meta = {
          ...(html.options.meta || {}),
          'content-security-policy': { 'http-equiv': 'Content-Security-Policy', content: buildDesktopCsp({ isProd }) },
        };
        html.options.meta = meta;
        html.userOptions.meta = meta;
      }
      return config;
    },
  },
};
