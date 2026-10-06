# Lambda `cognito-post-confirmation-seed`

Trigger **Post confirmation** do user pool. Cria o registro do usuário na tabela
do DynamoDB com o saldo inicial de créditos (`cap: 25`) no primeiro cadastro
confirmado: e-mail e senha, ou primeiro login pelo Google. É este registro que o
app lê em `POST /user` e que a Lambda de tokens consulta a cada ação de IA.

- Código: `index.mjs` (Node.js 20+, sem dependências para empacotar).
- Testes: `node --test backend/cognito-post-confirmation-seed/`
- Este repositório não faz deploy de Lambdas. O deploy é manual, pelo console.

## O bug que ele corrige

A função que está no pool grava o item com a chave `userAttributes.sub`. O app
inteiro identifica o usuário pelo `cognito:username` do token: `POST /user`,
`/works`, a Lambda de tokens e o SQLite do desktop.

- Conta por e-mail e senha: o pool usa e-mail como atributo de username, então o
  Cognito gera o username igual ao `sub`. As duas chaves coincidem e tudo funciona.
- Conta pelo Google: o username é `google_<id do Google>` e o `sub` é outro UUID.
  O item com os 25 créditos nasce sob o UUID, que o app nunca lê. Quem entra pelo
  Google vê saldo 0 e, na primeira ação de IA, `User not found in database`. Se o
  primeiro save em `/works` criar o item `google_…` sem `cap`, o erro passa a ser
  `User found but token balance is missing`.

A versão deste diretório grava a chave como `event.userName`, que é exatamente o
`cognito:username` do token nos dois casos, e guarda o `sub` em `cognito_sub`.

## O que ele faz

No `PostConfirmation_ConfirmSignUp` (cadastro confirmado, nativo ou federado) ele
faz um `PutItem` condicional (`attribute_not_exists(userId)`) com os mesmos campos
da versão original: `email`, `subscription: "free"`, `cap`, `gpt_tokens`,
`haiku_tokens`, `sonnet_usage`, `total_cost`, `sign_up_date`,
`last_token_reset_date`, `token_reset_date`, `subscription_id`, `privacy`, `works`.

- Item já existente nunca é sobrescrito. Reexecutar pelo console é seguro.
- `PostConfirmation_ConfirmForgotPassword` (redefinição de senha) passa intacto.
- `email_verified` deixou de ser condição. A comparação original era com a string
  (`"false"` também é truthy) e nunca barrou ninguém; a confirmação já exige o
  código do e-mail ou o IdP. Sem o registro o app não funciona.
- Se o `PutItem` falhar, a confirmação é derrubada de propósito (fail closed), como
  antes, e o erro vai para o CloudWatch sem o e-mail. Ver "Recuperação" abaixo.

Variáveis de ambiente, todas opcionais:

| Variável | Padrão | Uso |
|---|---|---|
| `TABLE` | lê do secret | Nome da tabela. Definida, dispensa o Secrets Manager. |
| `SECRET_NAME` | `alpha` | Secret com a chave `TABLE` no JSON, como a versão original. |
| `INITIAL_CAP` | `25` | Saldo inicial. Inteiro ≥ 0; inválido cai no padrão. |

## Deploy pelo console

O pool aceita **uma** função por trigger, e já existe uma ligada ao Post
confirmation. O caminho curto é trocar o código dela.

1. Cognito → o pool → menu **Extensions** (console antigo: aba **User pool
   properties**) → na linha **Post confirmation**, clicar na função.
2. Na aba **Code** da Lambda, substituir o conteúdo de `index.mjs` pelo deste
   diretório → **Deploy**.
3. **Configuration → General configuration**: Timeout **5 s** (limite do Cognito).
4. **Configuration → Environment variables**: opcionalmente `TABLE` com o nome da
   tabela, para a função não depender do Secrets Manager no cold start.

A role existente já tem `dynamodb:PutItem` na tabela e `secretsmanager:GetSecretValue`
no secret `alpha`, porque a versão original usava os dois. Se for criar uma função
nova em vez de editar a existente, dê essas duas permissões e troque o trigger no
pool para ela.

## Como conferir

1. Entrar com "Continue with Google" usando um e-mail **sem** conta.
2. CloudWatch Logs da função: uma linha `{"msg":"post-confirmation-seed",
   "userName":"google_…","action":"created","cap":25,"federated":true}`.
3. DynamoDB → tabela → item com `userId = google_…`, `cap = 25`, `cognito_sub` = o
   UUID do usuário no Cognito.
4. No app o header mostra 25, e a primeira ação de IA desconta a partir daí.

Para o cadastro por e-mail e senha o log é o mesmo, com `federated:false` e
`userName` igual ao UUID de antes. Motivos de `skip`: `already_exists` (item já
estava lá), `not_confirm_signup` (redefinição de senha ou outro gatilho),
`no_username`.

## Itens órfãos já criados

Quem entrou pelo Google antes desta correção tem um item sob o UUID do `sub`
(com `cap: 25` e `sign_up_date` do dia) e nenhum item `google_…`, ou um `google_…`
sem `cap` criado pelo `/works`. Para cada um:

1. Cognito → **Users** → abrir o usuário Google: copiar o **Username** (`google_…`)
   e o atributo `sub`.
2. DynamoDB → procurar o item cujo `userId` é o `sub`. Se existir, criar (ou
   completar) o item `userId = google_…` com os mesmos campos, e apagar o do UUID.
3. Se o usuário Google foi apagado do pool (duplicata removida para o vínculo do
   Pre sign-up funcionar), o item do UUID é órfão e pode ser apagado.

## Recuperação quando o trigger falhou

O Cognito só chama o Post confirmation uma vez por usuário. Se a gravação falhou
(linha `post-confirmation-seed failed` no CloudWatch), o usuário fica confirmado e
sem registro. Para criar o item: Lambda → aba **Test** → colar o evento com
`triggerSource`, `userName` e `request.userAttributes` (o `rawEvent` não é logado;
monte com o `userName` e o `sub`/`email` do usuário no Cognito) → **Test**. O
`PutItem` condicional garante que não duplica se o item já existir.

## Não coberto

- **Registro ausente por outros motivos.** O `POST /user` não cria o item quando
  ele falta. Um usuário confirmado sem registro depende da recuperação acima.
- **Caminho inverso do Google** (conta Google que depois se cadastra com senha):
  ver `backend/cognito-pre-signup-link/README.md`.
