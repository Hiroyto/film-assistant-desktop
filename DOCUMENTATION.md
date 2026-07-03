# Film Assistant AI — Documentação do Projeto

Aplicação web para escrita assistida por IA de roteiros e histórias de cinema. Permite ao usuário desenvolver a fundação de uma história (gênero, tema, sinopse, etc.), expandir em 9 segmentos narrativos, gerenciar personagens com arcos dramáticos, e produzir o roteiro final em formato screenplay.

---

## Stack

| Camada | Tecnologia |
|---|---|
| UI | React 18 + TypeScript |
| Bundler | Create React App + CRACO |
| Roteamento | react-router-dom v6 |
| Estado de servidor | react-query |
| Estilização | Tailwind CSS, Radix UI Themes, CSS modules |
| Editor de roteiro | TipTap (ProseMirror) |
| Animação | framer-motion |
| Auth & Backend | AWS Amplify (Cognito) + API Gateway + Lambda + DynamoDB |
| Cache local | localStorage + AWS Amplify Cache |
| Real-time | WebSocket (geração assíncrona via SQS) |
| Export | jsPDF |

Scripts (`package.json`):

- `npm start` — dev server (porta 3000)
- `npm run build` — build de produção
- `npm test` — Jest via CRACO

---

## Arquitetura geral

```
┌───────────────────────────────────────────────┐
│                   Cliente (React)             │
│                                               │
│  Cognito Auth ──▶ JWT ──▶ Authorization HTTP  │
│                                               │
│  UserContext (App.tsx)                        │
│  ├─ data (CacheData: 9 segmentos + meta)      │
│  ├─ characters (Map<name, Character>)         │
│  ├─ user.works (Map<storyId, story>)          │
│  └─ debouncedSave → localStorage + Cache      │
│                                               │
│  Routes:                                      │
│   /                landing (público)          │
│   /login           login                      │
│   /dashboard       HomePage                   │
│   /home            Home (story workspace)     │
│   /scripts         Scripts (screenplay)       │
│   /scenes          Scenes (canvas/cenas)      │
│   /community       events públicos            │
│   /events          admin                      │
└───────────────┬───────────────────────────────┘
                │ HTTPS (axios)         WebSocket
                ▼                            ▼
   ┌──────────────────────┐    ┌────────────────────┐
   │  API Gateway + Lambda │    │   API Gateway WS   │
   │   /user, /works,      │    │  character-update  │
   │   /story, /community  │    │  scene generation  │
   └──────────┬───────────┘    └─────────┬──────────┘
              ▼                           ▼
       ┌──────────────┐            ┌─────────────┐
       │  DynamoDB    │            │     SQS     │
       │  users,      │            │ async tasks │
       │  works/stories│           └─────────────┘
       └──────────────┘
```

---

## Estrutura de pastas

```
my-app/
├── amplify/                       # AWS Amplify (config Cognito importado)
│   └── backend/
├── public/
├── src/
│   ├── App.tsx                    # Root: auth, contexto global, rotas
│   ├── aws-exports.js             # Config Amplify (gerado)
│   ├── amplifyconfiguration.json
│   │
│   ├── pages/                     # Páginas de rota
│   │   ├── app/                   # home, Profile, Pricing
│   │   ├── auth/Login.tsx
│   │   └── landing/
│   │
│   ├── components/
│   │   ├── Home/                  # Workspace da história (9 segmentos)
│   │   │   ├── StoryFoundation.tsx
│   │   │   ├── StoryAct.tsx
│   │   │   ├── StoryNavigation.tsx
│   │   │   ├── StoryNavigationTab.tsx
│   │   │   ├── StoryBreadcrumbHeader.tsx
│   │   │   ├── FreeformBrainstorming.tsx
│   │   │   ├── NewStoryModal.tsx
│   │   │   ├── OutlineGenerationOverlay.tsx
│   │   │   └── ...
│   │   │
│   │   ├── Scripts/               # Editor de roteiro (TipTap)
│   │   │   ├── Scripts.tsx
│   │   │   ├── ScriptEditor.tsx
│   │   │   ├── PaginatedEditor.tsx
│   │   │   ├── BeatSidebar.tsx
│   │   │   ├── InlineAIRail.tsx   # IA inline (sugestões dentro do texto)
│   │   │   ├── editor/
│   │   │   │   └── tools/toolbar.tsx
│   │   │   ├── layoutEngine.ts    # Paginação screenplay
│   │   │   ├── pageRenderer.ts
│   │   │   └── useGuidedGeneration.ts / useSceneGeneration.ts
│   │   │
│   │   ├── Scenes/                # Cenas
│   │   ├── ScenesCanvas/
│   │   ├── characters-home/       # Painel de personagens
│   │   ├── Login/
│   │   ├── Profile/
│   │   ├── Pricing/
│   │   ├── Tour/                  # Onboarding
│   │   ├── Error/                 # ErrorProvider + GlobalErrorModal
│   │   ├── ui/                    # StoryUIContext etc.
│   │   ├── ActionModals/
│   │   ├── header.tsx, footer.tsx, landing.tsx
│   │   └── notfound.tsx
│   │
│   ├── commands/                  # Command palette (Ctrl+K global)
│   │   ├── CommandPalette.tsx
│   │   ├── CommandLauncher.tsx
│   │   └── useCommandPalette.ts
│   │
│   ├── lib/                       # Hooks e utilitários
│   │   ├── homehooks.tsx
│   │   ├── profilehooks.tsx
│   │   ├── priceshooks.tsx
│   │   ├── useWebSocket.ts
│   │   ├── exportScreenplayToPdf.ts
│   │   ├── exportStoryToPdf.ts
│   │   └── normalizeStoryForPdf.ts
│   │
│   └── models/                    # Tipos de domínio
│       ├── story.ts
│       ├── user.tsx
│       ├── event.tsx
│       └── apiHelpers.ts
│
├── craco.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## Modelo de dados (cliente)

### `CacheData` — história
Definido em `App.tsx`. Estrutura única tanto para estado local, cache e payload de save:

| Campo | Significado |
|---|---|
| `title` | Título da história (também é cache key) |
| `storyId` | ID único `story_<timestamp>_<rand6>` |
| `M` | Mood & Setting |
| `T` | Theme |
| `G` | Genre |
| `CQ` | Core Question (pergunta dramática) |
| `SUM` | Synopsis |
| `BRAINSTORM` | Notas brutas (input p/ extração de fundação por IA) |
| `S1` … `S9` | 9 segmentos narrativos. `string` ou `{ S, scenes[] }` |
| `characters` | Map `nome → Character` |
| `screenplayContent` | HTML/JSON do roteiro TipTap |

Os segmentos podem estar em dois formatos por compatibilidade — `getFieldContent()` e `getSegmentData()` em `App.tsx` normalizam.

### `Character`
```ts
{
  name, description,
  importance: 'major' | 'supporting' | 'minor',
  is_new, locked, user_touched,
  arc: { starting_state, goal, conflict, need, growth: 'static' | 'dynamic' }
}
```

### `User` (DynamoDB)
- `cap` — créditos de IA restantes
- `subscription` — tier
- `works` — `{ [storyId]: CacheData }`
- `privacy`, `sign_up_date`, `contest_submitted`

---

## Autenticação

- **Cognito** via `@aws-amplify/ui-react` (`withAuthenticator`, `useAuthenticator`).
- Token JWT é refrescado a cada 20 min (`App.tsx`).
- Todo request HTTP passa o token no header `Authorization`.
- Grupos Cognito: `admin` libera rota `/events`.

Route guards em `App.tsx`:

| Guard | Comportamento |
|---|---|
| `LandingRoute` | Autenticado → redireciona p/ `/dashboard` |
| `LoginRoute` | Autenticado → redireciona p/ `/dashboard` |
| `ProtectedRoute` | Não autenticado → `/login` (ou `/` para `/dashboard`) |
| `AdminRoute` | Não-admin → `/` |

---

## Persistência

Três camadas de armazenamento:

1. **Estado React** — fonte da verdade durante a sessão (`data` em `App.tsx`).
2. **localStorage** — `story_<storyId>` por história + ponteiro `active_story_id`. Carregado on mount, atualizado por `debouncedSave` (500 ms).
3. **DynamoDB** — endpoint `POST /works` com `event: "save"`. Mutation gerenciada pelo react-query (`mutateSave`).

Save automático: a cada 30 min se houver título.

Saves de personagens usam endpoint otimizado `event: "update-characters"` para evitar enviar a história inteira.

---

## Geração assíncrona (WebSocket)

Operações pesadas de IA (refresh de personagens, geração de cenas/segmentos) são enfileiradas via `POST /story` que retorna `202 Accepted` e depois entrega o resultado via WebSocket (`useWebSocket` em `lib/useWebSocket.ts`).

Durante updates em batch, a flag `isWebSocketUpdating` em `UserContext` suprime toasts e saves individuais.

---

## Editor de roteiro (`/scripts`)

- **TipTap** com extensão `Underline` e `StarterKit`.
- Tipos de linha screenplay (atributo `lineType` em `paragraph`): `scene` (slugline), `description` (ação), `character`, `dialogue`, `parenthetical`, `transition`.
- Toolbar (`editor/tools/toolbar.tsx`) com **palette Ctrl+K** — abre menu de formatos, atalhos numéricos 1–6.
- Paginação custom em `layoutEngine.ts` + `pageRenderer.ts` (formato screenplay padrão).
- IA inline (`InlineAIRail.tsx`, `useInlineAI.ts`, `InlineAIDecorationPlugin.ts`) — sugestões dentro do texto, com diff (`wordDiff.ts`).
- Geração assistida (`useGuidedGeneration.ts`, `useSceneGeneration.ts`) — popula segmentos a partir da fundação.
- Export para PDF: `lib/exportScreenplayToPdf.ts`.

---

## Workspace de história (`/home`)

Centrado na ideia de que toda história tem:

1. **Foundation** — `M`, `T`, `G`, `CQ`, `SUM` (extraídos do `BRAINSTORM` por IA).
2. **9 atos/segmentos** — `S1`…`S9`, navegáveis por `StoryNavigation`.
3. **Personagens** — painel separado com arc tracking.
4. **Cenas** — cada segmento pode ter `scenes[]` detalhadas.

Outline pode ser gerado por IA (`OutlineGenerationOverlay`, `useOutlinePlan`).

---

## Variáveis de ambiente

| Var | Uso |
|---|---|
| `REACT_APP_URL` | Base URL do API Gateway (todos os endpoints HTTP) |

Configuração Cognito vem de `src/aws-exports.js` (gerado pelo Amplify CLI).

---

## Endpoints backend

Todos em `${REACT_APP_URL}/...`, autenticados via header `Authorization: <jwt>`:

| Endpoint | Event | Descrição |
|---|---|---|
| `POST /user` | — | Hidrata dados do usuário (cap, subscription, works) |
| `POST /works` | `save` | Salva história completa |
| `POST /works` | `update-characters` | Save otimizado só de personagens |
| `POST /story` | `refresh_character_database` | Enfileira refresh de personagens (resposta via WS) |
| `POST /communityData` | — | Eventos públicos + status de submissão |
| `POST /adminData` | — | Eventos e submissões (admin only) |

Códigos de erro tratados:
- `400` → limite de storage atingido
- `401` → token expirado, relogin
- `404` → história não encontrada
- `500` → erro de servidor (Lambda/DynamoDB)

---

## Convenções e padrões

- **Sem prop drilling** — `UserContext` em `App.tsx` expõe estado global.
- **Saves debounced** — 500 ms para cache local; saves DB disparados por ação do usuário ou intervalo.
- **Personagens não salvam imediatamente** — só na próxima save da história ou via `saveCharacters()` explícito.
- **`useCallback` em todas as funções de personagem** — preserva referência para evitar re-renders.
- **Comentários em arquivos legados** seguem padrão `// ============================================================================` para seções. Novos arquivos preferem código auto-explicativo.

---

## Setup local

```bash
npm install
# defina REACT_APP_URL no .env (ou .env.local)
npm start
```

Build de produção:
```bash
npm run build
```

---

## Pontos de atenção

- O `App.tsx` concentra muito estado e lógica (~1750 linhas). Refatorações já aconteceram (Nov/2025 adicionou `BRAINSTORM` e save explícito).
- Há dois caches sobrepostos (`localStorage` primário + `Amplify.Cache` legado) — qualquer mudança em formato precisa migrar ambos.
- Segmentos podem ser `string` *ou* `{ S, scenes[] }`. Sempre normalize com `getFieldContent()` / `getSegmentData()` antes de calcular tamanho ou exibir.
- Refresh de personagens é **assíncrono** — não limpe `isCharactersLoading` na resposta HTTP, apenas no handler WebSocket.
