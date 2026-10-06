# Login e cadastro com Google

Federação do Google pelo Cognito que o app já usa. A primeira entrada com Google
cria o usuário no pool automaticamente, então cadastro e login são a mesma ação.

## Como funciona no código

| Alvo | Fluxo |
|---|---|
| **Web** | `signInWithRedirect({ provider: 'Google' })` do Amplify. Hosted UI do Cognito e redirect de volta para a mesma origem; o Amplify conclui sozinho ao carregar a página. |
| **Desktop** | O renderer roda em `file://`, então o Amplify não consegue ler o retorno. O app monta a URL de autorização com PKCE, abre no **navegador do sistema**, o Cognito volta por `filmassistant://auth/callback?code=…&state=…` (deep link do shell), o app troca o code por tokens no `/oauth2/token` e os entrega ao Amplify pelo mesmo caminho que o `signInWithRedirect` interno usa. |

Arquivos:

- `src/features/auth/model/googleOAuth.ts` — primitivas puras: PKCE, URL, parse do callback, troca do code, pedido pendente.
- `src/features/auth/model/googleSignIn.ts` — orquestração: web vs desktop, injeção dos tokens no Amplify, eventos do Hub, ponte do deep link.
- `src/components/Login/GoogleSignInButton.tsx` — botão usado em `LoginModal` e `SignupModal`. Some quando o build não tem o domínio do Hosted UI.
- `src/index.tsx` — `installGoogleSignInDeepLink()` liga o callback ao deep link.
- `src/aws-exports.js` — bloco `oauth` montado a partir das variáveis abaixo.
- `forge.config.js` — `protocols` declara `filmassistant://` no `Info.plist` do macOS.
- `scripts/desktop-csp.js` — CSP do renderer desktop. Quando a variável do domínio
  existe, libera a origem exata do Hosted UI em `connect-src`; sem isso a troca do
  code morre em "Could not reach the sign-in service: Failed to fetch". Teste de
  regressão em `src/features/auth/desktopCsp.test.ts`.

O sign-out continua local: `signOut()` revoga e limpa os tokens, sem o `/logout`
do Hosted UI. A sessão Google no navegador do sistema permanece, então um novo
"Continue with Google" pode entrar sem pedir senha de novo.

## Variáveis de ambiente

```
REACT_APP_COGNITO_OAUTH_DOMAIN=<prefixo>.auth.us-east-1.amazoncognito.com
REACT_APP_COGNITO_OAUTH_REDIRECT_SIGNIN=https://<dominio-web>/,http://localhost:3000/
REACT_APP_COGNITO_OAUTH_REDIRECT_SIGNOUT=https://<dominio-web>/,http://localhost:3000/
```

Sem `REACT_APP_COGNITO_OAUTH_DOMAIN` nada muda: o botão não aparece e o resto
segue como antes. Depois de alterar qualquer uma delas, reinicie o `desktop:start`
ou refaça o build: as variáveis e a CSP entram no bundle na inicialização. As duas listas de redirect servem só ao web; o desktop usa
`filmassistant://auth/callback` fixo.

## Passo a passo no console

### 1. Google Cloud Console (Google Auth Platform)

Antes de começar, crie o domínio do Hosted UI no Cognito (passo 2.1): a URL dele
entra no cliente OAuth. Os nomes abaixo são os do menu lateral do Google Auth
Platform, que substituiu a antiga "Tela de consentimento OAuth".

1. **Branding**: nome do app (é o que o usuário vê na tela do Google), e-mail de
   suporte e contato do desenvolvedor. Em **Domínios autorizados**, adicionar
   `amazoncognito.com`. Não suba logotipo por enquanto: logo exige verificação de marca.
2. **Público-alvo**: tipo de usuário **Externo**. O app nasce em **Teste**, e nesse
   estado só as contas listadas em **Usuários de teste** conseguem entrar; adicione
   as suas. Para abrir a todos, **Publicar app**. Com os três escopos básicos não há
   verificação do Google.
3. **Acesso a dados** → Adicionar ou remover escopos: `openid`,
   `.../auth/userinfo.email` e `.../auth/userinfo.profile`.
4. **Clientes** → Criar cliente → tipo **Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://<prefixo>.auth.us-east-1.amazoncognito.com`
   - URIs de redirecionamento autorizados:
     `https://<prefixo>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
5. Copiar o **Client ID** e o **Client secret** na hora da criação: o secret só é
   exibido nesse momento.

### 2. Cognito, no user pool existente

Caminhos do console atual do Cognito, conferidos na documentação da AWS. Abra
Amazon Cognito → **User pools** → o seu pool; os itens abaixo ficam no menu lateral
do pool. (No console antigo eles ficavam nas abas "App integration" e "Sign-in experience".)

1. **Domínio**: menu **Domain**, no grupo **Branding**. Se já houver um domínio
   listado, use-o. Senão, ao lado de **Domain**, **Actions → Create Cognito domain**,
   escolha um prefixo e, em **Branding version**, **Hosted UI (classic)** basta: o
   app vai direto ao Google e nunca mostra a página de login do Cognito. **Create**.
   O domínio resultante, `<prefixo>.auth.<região>.amazoncognito.com`, é o valor de
   `REACT_APP_COGNITO_OAUTH_DOMAIN`.
2. **Provedor Google**: menu **Social and external providers**, no grupo
   **Authentication** → **Add an identity provider** → **Google**. Colar Client ID e
   Client secret. **Authorized scopes**: `profile email openid`, separados por espaço.
3. **Mapeamento de atributos** do Google para o pool: `email` → `email`,
   `name` → `name`. Se o pool exigir `preferred_username` como obrigatório,
   mapear `name` → `preferred_username` também, senão o login federado falha.
4. **App client** (o mesmo `REACT_APP_COGNITO_APP_CLIENT_ID`): menu **App clients**,
   no grupo **Applications** → selecionar o client → aba **Login pages** → **Edit**
   em **Managed login pages configuration**:
   - Identity providers: marcar **Google** e **Cognito user pool**. Num client que
     nunca usou o Hosted UI o campo começa vazio e o status do painel aparece como
     "Unavailable"; isso é normal. Essa lista vale só para o login pelas páginas do
     Cognito: o login por e-mail e senha do app usa a API direto e não depende dela.
     O Google só aparece na lista depois de criado como provedor (item 2).
   - Allowed callback URLs: `filmassistant://auth/callback`, mais as URLs web
     de `REACT_APP_COGNITO_OAUTH_REDIRECT_SIGNIN`.
   - Allowed sign-out URLs: as URLs web de `REACT_APP_COGNITO_OAUTH_REDIRECT_SIGNOUT`.
   - OAuth grant types: **Authorization code grant**.
   - OpenID Connect scopes: `openid`, `email`, `profile`, **`aws.cognito.signin.user.admin`**.
     O último é obrigatório: `fetchUserAttributes` usa o access token e sem ele o
     `GetUser` devolve 401.
   - O app client precisa ser **público, sem client secret**. Se o atual tiver
     secret, criar outro client sem secret e trocar a variável.
5. Testar o Hosted UI direto no navegador com a URL de autorização do web; se o
   Google aparecer e voltar para a URL web, o pool está certo.

### 3. Vinculação de contas (Lambda de Pre sign-up)

O backend e o SQLite local usam o `cognito:username` como id. Um usuário com conta
por e-mail e senha que entra pelo Google com o mesmo e-mail vira **outra
identidade** (`google_<sub>`), sem as stories. A correção é a Lambda em
`backend/cognito-pre-signup-link/`: no primeiro login federado ela encontra a conta
nativa com o mesmo e-mail verificado e chama `AdminLinkProviderForUser`.

Deploy pelo console, permissões, mapeamento de `email_verified` e limpeza das
duplicatas já criadas: `backend/cognito-pre-signup-link/README.md`.

O primeiro login depois do vínculo falha no Cognito com `Already found an entry for
username`. O app refaz o fluxo uma vez sozinho: no desktop o navegador abre duas
vezes em sequência, só nessa primeira vez; na web são dois redirects.

**Créditos iniciais.** O trigger Post confirmation do pool cria o registro do
usuário com `cap: 25`, mas grava a chave como `sub`, que numa conta federada é
diferente do `cognito:username` (`google_<id>`): quem cria a conta pelo Google
fica com saldo 0. A versão corrigida está em
`backend/cognito-post-confirmation-seed/` (deploy, conferência e limpeza dos
itens órfãos no README de lá).

### 4. Primeira entrada pelo Google

Quem entra pelo Google pula o formulário de cadastro: não aceita os Termos nem
define nome de exibição. Falta um passo de primeira entrada para isso; hoje o
app lê `name`/`email` dos atributos do Cognito.

## Testes

- `src/features/auth/googleOAuth.test.ts` — PKCE contra o vetor do RFC 7636, URL,
  callback, troca do code com `fetch` falso, pedido pendente com TTL.
- `src/features/auth/googleSignIn.test.ts` — Amplify real, sem rede: depois do
  deep link, `fetchAuthSession()` e `getCurrentUser()` respondem com o usuário
  Google e o Hub publica `signInWithRedirect` e `signedIn`.

Teste manual no desktop, depois da configuração: abrir o app, "Continue with
Google", concluir no navegador; o app deve cair na Home sem reiniciar. Fechar e
reabrir o app: deve continuar logado. Deixar passado o tempo do access token
(uma hora) e usar o app: o refresh deve acontecer sem pedir login.
