const { copyPdfWorker } = require('./scripts/copy-pdf-worker');

const isProd = process.env.NODE_ENV === 'production';
// Setado pelos scripts desktop:* (package.json). Ausente no build da web.
const isDesktopBuild = process.env.DESKTOP_BUILD === '1';

// Content-Security-Policy do renderer DESKTOP, entregue por <meta http-equiv> —
// a única forma que vale para páginas file:// (build empacotado). Só código do
// próprio app executa (script-src 'self'): nada de gtag/getterms/CDN dentro do
// shell, onde um script remoto teria acesso a window.electronAPI.
//   - connect-src: API Gateway + WebSocket + Cognito (*.amazonaws.com), GitHub
//     (releases/download buttons), Sentry (crash reports, se DSN configurado).
//   - style/font: Google Fonts + Adobe Typekit (CSS/fontes apenas, sem script).
//   - dev (craco start): webpack/react-refresh precisam de eval + HMR via ws.
const desktopCsp = [
  "default-src 'self'",
  `script-src 'self'${isProd ? '' : " 'unsafe-eval' 'unsafe-inline'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://use.typekit.net",
  "font-src 'self' data: https://fonts.gstatic.com https://use.typekit.net",
  "img-src 'self' data: blob: https://*.amazonaws.com https://p.typekit.net",
  "media-src 'self' data: blob: https://*.amazonaws.com",
  `connect-src 'self' https://*.amazonaws.com wss://*.amazonaws.com https://api.github.com https://github.com https://*.sentry.io${
    isProd ? '' : ' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*'
  }`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join('; ');

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
          'content-security-policy': { 'http-equiv': 'Content-Security-Policy', content: desktopCsp },
        };
        html.options.meta = meta;
        html.userOptions.meta = meta;
      }
      return config;
    },
  },
};
