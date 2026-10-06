# Lambda `cognito-pre-signup-link`

Trigger **Pre sign-up** do user pool. Faz o "Continue with Google" entrar na conta
que já existe com o mesmo e-mail, em vez de criar um segundo usuário `google_<sub>`.
Sem ele, quem tem conta por e-mail e senha entra pelo Google e não vê as stories,
porque o backend e o SQLite local usam o `cognito:username` como id.

- Código: `index.mjs` (Node.js 20+, sem dependências para empacotar).
- Testes: `node --test backend/cognito-pre-signup-link/`
- Este repositório não faz deploy de Lambdas. O deploy é manual, pelo console.

## O que ele faz

No primeiro login federado de uma identidade, o Cognito chama o trigger com
`triggerSource = PreSignUp_ExternalProvider`. A função procura no pool um usuário
com o mesmo e-mail e chama `AdminLinkProviderForUser` quando **todas** valem:

- o provedor está em `LINK_PROVIDERS` (padrão: `Google`);
- o Google afirma `email_verified = true`;
- existe **exatamente um** usuário nativo, `CONFIRMED`, habilitado e com e-mail verificado.

Fora disso ela não vincula e o cadastro federado segue normal. Cadastro por e-mail
e senha e `AdminCreateUser` passam intactos. Se a consulta ou o vínculo falharem, o
login é derrubado de propósito: deixar passar criaria o usuário duplicado.

**Primeiro login após o vínculo.** O Cognito cria o vínculo, mas falha aquela
tentativa com `Already found an entry for username google_…`. É uma limitação
conhecida do serviço. O app refaz o fluxo uma vez sozinho: no desktop o navegador
abre duas vezes em sequência, só nessa primeira vez.

## Deploy pelo console

### 1. Criar a função

1. AWS Lambda → **Create function** → **Author from scratch**.
2. Nome: `filmassistant-cognito-pre-signup-link`. Runtime: **Node.js 22.x** (ou 20.x).
   Mesma região do user pool.
3. Na aba **Code**, substituir o conteúdo de `index.mjs` pelo deste diretório → **Deploy**.
4. **Configuration → General configuration → Edit**: Timeout **5 s** (é o limite do
   Cognito para triggers) e memória **256 MB**.

### 2. Permissão

**Configuration → Permissions** → clicar no nome da role → **Add permissions →
Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["cognito-idp:ListUsers", "cognito-idp:AdminLinkProviderForUser"],
      "Resource": "arn:aws:cognito-idp:<REGIAO>:<ACCOUNT_ID>:userpool/<USER_POOL_ID>"
    }
  ]
}
```

### 3. Ligar ao user pool

1. Cognito → o pool → menu **Extensions**, no grupo Authentication (no console
   antigo: aba **User pool properties**) → **Add Lambda trigger**.
2. Trigger type **Sign-up** → **Pre sign-up trigger** → escolher a função → **Add Lambda trigger**.

O pool aceita **uma** função por trigger. Se já houver um Pre sign-up, a lógica
deste arquivo precisa ser incorporada à função existente.

### 4. Mapear `email_verified` do Google

Cognito → **Social and external providers** → Google → **Attribute mapping → Edit** →
adicionar `email_verified` (Google) → `email_verified` (user pool). Sem esse
mapeamento o atributo não chega ao trigger e nada é vinculado; o log mostra
`"reason":"idp_email_not_verified"`.

Se o login pelo Google passar a falhar com `Invalid user attributes:
email_verified: The attribute is not a valid boolean`, o mapeamento está errado:
a coluna do Google aponta para outro atributo (por exemplo `email`) ou as colunas
foram invertidas. Tem de ser user pool `email_verified` ← Google `email_verified`.

Atenção: num usuário vinculado, cada login pelo Google **sobrescreve** no perfil
nativo os atributos mapeados. Mapeie só o que pode ser sobrescrito.

### 5. Apagar duplicatas já criadas

`AdminLinkProviderForUser` só aceita uma identidade que **ainda não existe** no pool.
Quem já entrou com Google antes deste trigger tem um usuário `google_<sub>` criado.
Cognito → **Users** → abrir o usuário cujo nome começa com `google_` → **Actions →
Disable user access** → depois **Delete**. No próximo login o vínculo acontece.

## Como conferir

1. Sair do app. Entrar com "Continue with Google" usando um e-mail que já tem conta.
2. O navegador abre duas vezes (vínculo, depois login) e o app mostra as stories antigas.
3. CloudWatch Logs da função: linha com `"action":"linked"`.
4. No Cognito, o usuário nativo passa a mostrar a identidade Google vinculada, e
   **não** existe usuário `google_<sub>` separado.

Motivos de `skip` no log: `no_existing_user` (conta nova, normal),
`no_eligible_native_user` (existe, mas não confirmada/verificada, desabilitada ou
ambígua), `idp_email_not_verified`, `provider_not_enabled`, `unknown_provider`,
`no_usable_email`.

## Não coberto

- **Caminho inverso.** Quem criou a conta pelo Google e depois tenta se cadastrar
  com e-mail e senha no mesmo endereço ganha um segundo usuário. Resolver exige
  bloquear esse cadastro no próprio trigger (`PreSignUp_SignUp`) ou oferecer
  "definir senha" para contas Google.
- **Desvincular.** `AdminDisableProviderForUser`, manual.
