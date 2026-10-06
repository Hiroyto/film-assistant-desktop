// Content-Security-Policy do renderer DESKTOP, entregue por <meta http-equiv> —
// a única forma que vale para páginas file:// (build empacotado). Só código do
// próprio app executa (script-src 'self'): nada de gtag/getterms/CDN dentro do
// shell, onde um script remoto teria acesso a window.electronAPI.
//   - connect-src: API Gateway + WebSocket + Cognito API (*.amazonaws.com), GitHub
//     (releases/download buttons), Sentry (crash reports, se DSN configurado) e,
//     quando o login com Google está ligado, a origem EXATA do Hosted UI do
//     Cognito: o renderer troca o authorization code por tokens em
//     https://<domínio>/oauth2/token, que fica em *.amazoncognito.com (ou num
//     domínio próprio) e NÃO em *.amazonaws.com. Sem essa origem o fetch morre
//     na CSP com "Failed to fetch" logo depois do deep link de retorno.
//   - style/font: Google Fonts + Adobe Typekit (CSS/fontes apenas, sem script).
//   - dev (craco start): webpack/react-refresh precisam de eval + HMR via ws.
//
// IMPORTANTE: chame buildDesktopCsp() de DENTRO de webpack.configure. O craco
// avalia craco.config.js antes de o CRA carregar os arquivos .env, então no topo
// do arquivo REACT_APP_COGNITO_OAUTH_DOMAIN ainda não existe em process.env.

/** Origem https do Hosted UI (REACT_APP_COGNITO_OAUTH_DOMAIN), ou '' se ausente
 *  ou malformada. Só hostname: nada que possa injetar outra diretiva na CSP. */
function cognitoOAuthOrigin(env = process.env) {
  const host = String(env.REACT_APP_COGNITO_OAUTH_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host) ? `https://${host}` : '';
}

function buildDesktopCsp({ isProd, env = process.env } = {}) {
  const oauthOrigin = cognitoOAuthOrigin(env);
  const connect = [
    "'self'",
    'https://*.amazonaws.com',
    'wss://*.amazonaws.com',
    oauthOrigin,
    'https://api.github.com',
    'https://github.com',
    'https://*.sentry.io',
    ...(isProd ? [] : ['ws://localhost:*', 'http://localhost:*', 'ws://127.0.0.1:*', 'http://127.0.0.1:*']),
  ].filter(Boolean);

  return [
    "default-src 'self'",
    `script-src 'self'${isProd ? '' : " 'unsafe-eval' 'unsafe-inline'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://use.typekit.net",
    "font-src 'self' data: https://fonts.gstatic.com https://use.typekit.net",
    "img-src 'self' data: blob: https://*.amazonaws.com https://p.typekit.net",
    "media-src 'self' data: blob: https://*.amazonaws.com",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join('; ');
}

module.exports = { buildDesktopCsp, cognitoOAuthOrigin };
