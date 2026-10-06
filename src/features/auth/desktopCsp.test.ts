// Regressão: a CSP do renderer desktop precisa liberar o endpoint de token do
// Hosted UI do Cognito. Sem isso o "Continue with Google" volta do navegador e
// morre em "Could not reach the sign-in service: Failed to fetch" — a troca do
// code é um fetch para https://<domínio>/oauth2/token, fora de *.amazonaws.com.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildDesktopCsp, cognitoOAuthOrigin } = require('../../../scripts/desktop-csp');

const connectSrc = (csp: string): string[] => {
  const directive = csp.split('; ').find((d) => d.startsWith('connect-src '));
  if (!directive) throw new Error('connect-src ausente');
  return directive.split(' ').slice(1);
};

describe('CSP do desktop × login com Google', () => {
  it('sem REACT_APP_COGNITO_OAUTH_DOMAIN nada de amazoncognito é liberado', () => {
    const sources = connectSrc(buildDesktopCsp({ isProd: true, env: {} }));
    expect(sources.some((s) => s.includes('amazoncognito'))).toBe(false);
    expect(sources).toEqual(["'self'", 'https://*.amazonaws.com', 'wss://*.amazonaws.com', 'https://api.github.com', 'https://github.com', 'https://*.sentry.io']);
  });

  it('com o domínio configurado, libera exatamente a origem https do Hosted UI', () => {
    const env = { REACT_APP_COGNITO_OAUTH_DOMAIN: 'filmassistant.auth.us-east-1.amazoncognito.com' };
    expect(connectSrc(buildDesktopCsp({ isProd: true, env }))).toContain('https://filmassistant.auth.us-east-1.amazoncognito.com');
    expect(connectSrc(buildDesktopCsp({ isProd: false, env }))).toContain('https://filmassistant.auth.us-east-1.amazoncognito.com');
  });

  it('aceita o valor com https:// e barra final, e também domínio próprio', () => {
    expect(cognitoOAuthOrigin({ REACT_APP_COGNITO_OAUTH_DOMAIN: ' https://app.auth.us-east-1.amazoncognito.com/ ' })).toBe('https://app.auth.us-east-1.amazoncognito.com');
    expect(cognitoOAuthOrigin({ REACT_APP_COGNITO_OAUTH_DOMAIN: 'login.example.com' })).toBe('https://login.example.com');
  });

  it('valor malformado não entra na CSP (não dá para injetar outra diretiva)', () => {
    for (const bad of ["evil.com; script-src *", 'a b.com', 'localhost', "x.com 'unsafe-inline'", '']) {
      expect(cognitoOAuthOrigin({ REACT_APP_COGNITO_OAUTH_DOMAIN: bad })).toBe('');
    }
    const csp = buildDesktopCsp({ isProd: true, env: { REACT_APP_COGNITO_OAUTH_DOMAIN: 'evil.com; script-src *' } });
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('evil.com');
  });

  it('dev libera localhost para o HMR; prod não, e prod não permite eval', () => {
    const dev = buildDesktopCsp({ isProd: false, env: {} });
    const prod = buildDesktopCsp({ isProd: true, env: {} });
    expect(connectSrc(dev)).toContain('http://localhost:*');
    expect(connectSrc(prod)).not.toContain('http://localhost:*');
    expect(prod).not.toContain("'unsafe-eval'");
  });
});
