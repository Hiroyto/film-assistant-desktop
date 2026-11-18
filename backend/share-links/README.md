# share-links — links compartilháveis (preview somente leitura)

Lambda dos links de compartilhamento de uma história. Quem abre o link
(`/share/<token>`, página `src/pages/app/shared-story.tsx`) lê um **retrato** da
história: não edita nada e não alcança a história original.

Há dois tipos de link, escolhidos no diálogo "Share" do app:

| Tipo | O que mostra | Onde o retrato é montado | O que fica guardado |
|---|---|---|---|
| **Snapshot** (padrão) | A história como estava quando o link foi criado | No app do dono | O retrato inteiro |
| **Live** | A história como está agora | Nesta Lambda, a cada abertura | Só dono, história e escopo |

Arquivos:

- `index.mjs` — a função (Node.js 20+; o SDK v3 da AWS já vem no runtime).
- `snapshot.mjs` — o construtor do retrato, usado pelos links ao vivo. **É gerado**
  a partir do código do app (`npm run share:lambda`); não edite à mão.
- `index.test.mjs` — `node --test backend/share-links/`

## Como um link ao vivo lê a história

Todas as Lambdas do app checam que a história pertence a quem chama
(`ACCESS-CHECKS.md` no repositório web). A do freeform (`freeform-workflow-app`)
faz isso num portão único: um pedido que chega pelo API Gateway é conferido pelo
login do Cognito; uma chamada direta de outra Lambda, que exige credencial de
IAM, passa como interna. Esta função usa os dois caminhos:

- **Ao criar** um link ao vivo, o pedido do dono é repassado ao freeform com o
  `requestContext` original. É o portão do freeform que diz se a história é de
  quem pede; se não for, o link não é criado (403). Sem isso qualquer conta
  criaria um link ao vivo para a história de outra pessoa.
- **Ao abrir**, a leitura é interna: três eventos de leitura
  (`list-project-entities`, `list-scene-texts`, `get-card-layouts`), com o dono e
  a história que estão no registro do link.

O grafo cru nunca sai daqui. O retrato é montado por `snapshot.mjs`, que é o
mesmo código do app (`src/lib/shareSnapshot.ts`): ficam de fora a lixeira, o
sandbox, as cartas ainda não aceitas, o backstory e tudo que é ferramenta do
roteirista (perguntas do Peer, tensões abertas, citações de evidência, notas).

## O que é guardado (S3, sem tabela)

| Objeto | Conteúdo |
|---|---|
| `shares/<token>.json` | dono, id da história, escopo, título, data e o retrato (snapshot) ou `mode: "live"` |
| `owners/<dono>/<storyId>/<token>.json` | ficha pequena, para listar os links do dono |

Revogar apaga os dois; o link responde 404 na hora, nos dois tipos. O token tem
192 bits aleatórios (`randomBytes(24)`).

## Rotas

Um `POST` com `{ "event": ... }`, integração **Lambda proxy**:

| Rota | Authorizer | Eventos |
|---|---|---|
| `/share` | Cognito (o mesmo das outras rotas) | `create`, `list`, `revoke` |
| `/shared` | **nenhum** (link público) ou Cognito (ver `REQUIRE_LOGIN`) | `get` |

`create` recebe `{ storyId, scope, title, snapshot }` (snapshot) ou
`{ storyId, scope, title, mode: "live" }` (ao vivo) e devolve
`{ token, storyId, scope, title, createdAt }`, com `mode: "live"` no ao vivo. O
servidor descarta do retrato o que estiver fora do escopo. `get` devolve
`{ token, scope, title, createdAt, snapshot }`, sem o dono e sem o id da
história; no ao vivo vêm também `mode: "live"` e `asOf` (quando a história foi
lida).

## Deploy pelo console

### 1. Bucket

S3 → **Create bucket** (ex.: `filmassistant-shares-prod`), na mesma região das
Lambdas, com **Block all public access** ligado. Ninguém lê o bucket direto: só
a Lambda.

### 2. Função

1. Lambda → **Create function** → Author from scratch.
2. Nome: `filmassistant-share-links`. Runtime: **Node.js 22.x** (ou 20.x).
3. Em **Code**, dois arquivos na raiz:
   - `index.mjs`: colar o conteúdo de `backend/share-links/index.mjs`.
   - `snapshot.mjs`: criar o arquivo (File → New file) e colar o conteúdo de
     `backend/share-links/snapshot.mjs`.

   Depois, **Deploy**. Sem o `snapshot.mjs` a função não carrega.
4. **Configuration → General configuration → Edit**: Timeout **30 s**, memória
   **512 MB**. (Só com links de retrato bastam 10 s e 256 MB; a leitura ao vivo
   espera a Lambda do freeform.)
5. **Configuration → Environment variables**:

   | Chave | Valor |
   |---|---|
   | `BUCKET` | o nome do bucket |
   | `REQUIRE_LOGIN` | vazio = qualquer pessoa com o link abre; `true` = só usuário logado |
   | `FREEFORM_FUNCTION` | a Lambda do freeform **com o alias do ambiente**: `freeform-workflow-app` em dev, `freeform-workflow-app:prod` em prod. Vazio = links ao vivo desligados |
   | `LIVE_CACHE_SECONDS` | opcional, default `30`: por quanto tempo um link ao vivo reaproveita a última leitura |
   | `LIVE_BOARD_WIDTH` | opcional, default `1400`: largura usada no auto-layout dos cards nunca movidos |
   | `MAX_BYTES` | opcional, default `4000000` |
   | `MAX_LINKS_PER_STORY` | opcional, default `20` |

   Atenção ao alias em `FREEFORM_FUNCTION`: o freeform decide se lê dev ou prod
   pelo alias com que é chamado. Com o alias errado, um ambiente lê os dados do
   outro.

### 3. Permissões

**Configuration → Permissions** → role → **Add permissions → Create inline
policy** → JSON. O primeiro bloco é do S3; o segundo só é preciso para links ao
vivo (troque `CONTA` pelo id da conta e ajuste o alias):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::NOME-DO-BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::NOME-DO-BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:us-east-1:CONTA:function:freeform-workflow-app",
        "arn:aws:lambda:us-east-1:CONTA:function:freeform-workflow-app:prod"
      ]
    }
  ]
}
```

Em dev deixe só o primeiro ARN do `lambda:InvokeFunction`; em prod, só o
segundo. Assim a função de um ambiente não consegue chamar o freeform do outro.

### 4. API Gateway

Na API REST que o app já usa (`REACT_APP_URL`), no stage correspondente:

1. **Create resource** `/share` → método **POST** → Integration type **Lambda
   function**, **Lambda proxy integration ligado**, função
   `filmassistant-share-links`. Em **Method request**, Authorization = o
   authorizer do Cognito das outras rotas.
2. **Create resource** `/shared` → método **POST**, mesma função, proxy ligado.
   Authorization = **NONE** para link público. Se `REQUIRE_LOGIN=true`, use o
   authorizer aqui também.
3. Nos dois recursos, **Enable CORS** (cria o `OPTIONS`); headers permitidos:
   `Authorization,Content-Type`. A função também responde os headers de CORS em
   todo `POST`.
4. **Deploy API** no stage.
5. Com links ao vivo, vale pôr um limite de requisições no método `POST /shared`
   (Stage → Method throttling): cada abertura fora do cache lê o banco.

### 5. Conferir

Sem login, um token inexistente responde 404 com o JSON da função:

```bash
curl -s -X POST "$REACT_APP_URL/shared" -H 'Content-Type: application/json' -d '{"event":"get","token":"aaaaaaaaaaaaaaaaaaaaaaaa"}'
```

`{"error":"This link is not available."}` = rota e função no ar.
`{"message":"Missing Authentication Token"}` = a rota não existe nesse stage.

**Links ao vivo**, depois de configurar `FREEFORM_FUNCTION`:

1. No app, crie um link com **Live** e abra-o: a história aparece.
2. Mude algo na história, volte ao link e clique em **Refresh**: a mudança
   aparece.
3. **Teste de segurança**: com uma segunda conta, peça um link ao vivo para o id
   de uma história da primeira. Tem de voltar 403 (`Only the owner of a story can
   share it live.`). Se voltar 200, **desligue** os links ao vivo (esvazie
   `FREEFORM_FUNCTION`) e investigue o portão do freeform antes de religar.

## Proteção opcional no freeform

Uma chamada interna passa pelo portão do freeform para **qualquer** evento, e a
permissão de IAM não distingue um do outro. Esta função só pede leituras, mas um
erro aqui poderia pedir outra coisa. Para fechar isso do lado de lá, logo depois
do `authorizeRequest` em `freeform-workflow-app/index.mjs`:

```js
const SHARED_READS = new Set(['list-project-entities', 'list-scene-texts', 'get-card-layouts']);
if (authz.internal && parsedEvent.caller === 'share-links' && !SHARED_READS.has(parsedEvent.event)) {
  return { statusCode: 403, headers, body: JSON.stringify({ error: 'share-links may only read' }) };
}
```

## Quando o código do retrato muda

`snapshot.mjs` é uma cópia gerada de `src/lib/shareSnapshot.ts` e das funções de
ordem/layout do board. Se um deles mudar (inclusive num sync com o repositório
web), o teste `src/lib/shareSnapshot.test.ts` falha. Rode:

```bash
npm run share:lambda
```

e publique a função de novo com o `snapshot.mjs` novo, em dev e em prod.

## Dev e prod

Como as outras Lambdas, são dois ambientes: um bucket e uma função (ou um alias
com `BUCKET` e `FREEFORM_FUNCTION` diferentes) para cada API. O link gerado
aponta para o site (`https://filmassistant.io/share/<token>`, ou
`REACT_APP_SHARE_BASE_URL`), então a página `/share/:token` precisa estar
publicada no site, e o site precisa apontar para a mesma API onde o link foi
criado.

## Limites conhecidos

- O link não expira sozinho: vale até ser revogado.
- Quem tem o link pode repassá-lo. Com `REQUIRE_LOGIN=true` ainda assim qualquer
  conta do FilmAssistant com o link abre; não há lista de convidados.
- Link ao vivo: quem abre vê as mudanças do dono, inclusive as inacabadas. O
  título do link é o da criação (o título da história não é lido de novo). Cards
  nunca movidos ficam no auto-layout calculado com `LIVE_BOARD_WIDTH`, que pode
  diferir um pouco do que o dono vê na janela dele. O cache é por contêiner da
  Lambda: sob carga, mais de uma leitura pode acontecer dentro do prazo.
