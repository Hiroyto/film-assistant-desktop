# Film Assistant AI — Project Documentation

Web application for AI-assisted writing of film scripts and stories. Lets users develop a story's foundation (genre, theme, synopsis, etc.), expand it into 9 narrative segments, manage characters with dramatic arcs, and produce the final screenplay.

---

## Stack

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript |
| Bundler | Create React App + CRACO |
| Routing | react-router-dom v6 |
| Server state | react-query |
| Styling | Tailwind CSS, Radix UI Themes, CSS modules |
| Screenplay editor | TipTap (ProseMirror) |
| Animation | framer-motion |
| Auth & Backend | AWS Amplify (Cognito) + API Gateway + Lambda + DynamoDB |
| Local cache | localStorage + AWS Amplify Cache |
| Real-time | WebSocket (async generation via SQS) |
| Export | jsPDF |

Scripts (`package.json`):

- `npm start` — dev server (port 3000)
- `npm run build` — production build
- `npm test` — Jest via CRACO

---

## High-level architecture

```
┌───────────────────────────────────────────────┐
│                Client (React)                 │
│                                               │
│  Cognito Auth ──▶ JWT ──▶ Authorization HTTP  │
│                                               │
│  UserContext (App.tsx)                        │
│  ├─ data (CacheData: 9 segments + metadata)   │
│  ├─ characters (Map<name, Character>)         │
│  ├─ user.works (Map<storyId, story>)          │
│  └─ debouncedSave → localStorage + Cache      │
│                                               │
│  Routes:                                      │
│   /                landing (public)           │
│   /login           login                      │
│   /dashboard       HomePage                   │
│   /home            Home (story workspace)     │
│   /scripts         Scripts (screenplay)       │
│   /scenes          Scenes (canvas)            │
│   /community       public events              │
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

## Folder structure

```
my-app/
├── amplify/                       # AWS Amplify (imported Cognito config)
│   └── backend/
├── public/
├── src/
│   ├── App.tsx                    # Root: auth, global context, routes
│   ├── aws-exports.js             # Amplify config (generated)
│   ├── amplifyconfiguration.json
│   │
│   ├── pages/                     # Route pages
│   │   ├── app/                   # home, Profile, Pricing
│   │   ├── auth/Login.tsx
│   │   └── landing/
│   │
│   ├── components/
│   │   ├── Home/                  # Story workspace (9 segments)
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
│   │   ├── Scripts/               # Screenplay editor (TipTap)
│   │   │   ├── Scripts.tsx
│   │   │   ├── ScriptEditor.tsx
│   │   │   ├── PaginatedEditor.tsx
│   │   │   ├── BeatSidebar.tsx
│   │   │   ├── InlineAIRail.tsx   # Inline AI (in-text suggestions)
│   │   │   ├── editor/
│   │   │   │   └── tools/toolbar.tsx
│   │   │   ├── layoutEngine.ts    # Screenplay pagination
│   │   │   ├── pageRenderer.ts
│   │   │   └── useGuidedGeneration.ts / useSceneGeneration.ts
│   │   │
│   │   ├── Scenes/                # Scenes
│   │   ├── ScenesCanvas/
│   │   ├── characters-home/       # Character panel
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
│   ├── commands/                  # Command palette (global Ctrl+K)
│   │   ├── CommandPalette.tsx
│   │   ├── CommandLauncher.tsx
│   │   └── useCommandPalette.ts
│   │
│   ├── lib/                       # Hooks and utilities
│   │   ├── homehooks.tsx
│   │   ├── profilehooks.tsx
│   │   ├── priceshooks.tsx
│   │   ├── useWebSocket.ts
│   │   ├── exportScreenplayToPdf.ts
│   │   ├── exportStoryToPdf.ts
│   │   └── normalizeStoryForPdf.ts
│   │
│   └── models/                    # Domain types
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

## Data model (client)

### `CacheData` — story
Defined in `App.tsx`. A single shape used for local state, cache, and save payload:

| Field | Meaning |
|---|---|
| `title` | Story title (also the cache key) |
| `storyId` | Unique ID `story_<timestamp>_<rand6>` |
| `M` | Mood & Setting |
| `T` | Theme |
| `G` | Genre |
| `CQ` | Core Question (central dramatic question) |
| `SUM` | Synopsis |
| `BRAINSTORM` | Raw notes (input for AI foundation extraction) |
| `S1` … `S9` | 9 narrative segments. `string` or `{ S, scenes[] }` |
| `characters` | Map `name → Character` |
| `screenplayContent` | TipTap HTML/JSON of the screenplay |

Segments may appear in two formats for backward compatibility — `getFieldContent()` and `getSegmentData()` in `App.tsx` normalize them.

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
- `cap` — remaining AI credits
- `subscription` — tier
- `works` — `{ [storyId]: CacheData }`
- `privacy`, `sign_up_date`, `contest_submitted`

---

## Authentication

- **Cognito** via `@aws-amplify/ui-react` (`withAuthenticator`, `useAuthenticator`).
- JWT token is refreshed every 20 minutes (`App.tsx`).
- Every HTTP request sends the token in the `Authorization` header.
- Cognito groups: `admin` unlocks the `/events` route.

Route guards in `App.tsx`:

| Guard | Behavior |
|---|---|
| `LandingRoute` | Authenticated → redirects to `/dashboard` |
| `LoginRoute` | Authenticated → redirects to `/dashboard` |
| `ProtectedRoute` | Unauthenticated → `/login` (or `/` for `/dashboard`) |
| `AdminRoute` | Non-admin → `/` |

---

## Persistence

Three storage layers:

1. **React state** — source of truth during the session (`data` in `App.tsx`).
2. **localStorage** — `story_<storyId>` per story + `active_story_id` pointer. Loaded on mount, updated by `debouncedSave` (500 ms).
3. **DynamoDB** — endpoint `POST /works` with `event: "save"`. Mutation managed by react-query (`mutateSave`).

Auto-save: every 30 minutes if a title is set.

Character saves use the optimized endpoint `event: "update-characters"` to avoid sending the entire story.

---

## Async generation (WebSocket)

Heavy AI operations (character refresh, scene/segment generation) are queued via `POST /story`, which returns `202 Accepted`. The result is later delivered through a WebSocket (`useWebSocket` in `lib/useWebSocket.ts`).

During batch updates the `isWebSocketUpdating` flag in `UserContext` suppresses individual toasts and saves.

---

## Screenplay editor (`/scripts`)

- **TipTap** with `Underline` and `StarterKit` extensions.
- Screenplay line types (`lineType` attribute on `paragraph`): `scene` (slugline), `description` (action), `character`, `dialogue`, `parenthetical`, `transition`.
- Toolbar (`editor/tools/toolbar.tsx`) with **Ctrl+K palette** — opens a format menu with numeric shortcuts 1–6.
- Custom pagination in `layoutEngine.ts` + `pageRenderer.ts` (standard screenplay format).
- Inline AI (`InlineAIRail.tsx`, `useInlineAI.ts`, `InlineAIDecorationPlugin.ts`) — in-text suggestions with diff (`wordDiff.ts`).
- Guided generation (`useGuidedGeneration.ts`, `useSceneGeneration.ts`) — fills segments from the foundation.
- PDF export: `lib/exportScreenplayToPdf.ts`.

---

## Story workspace (`/home`)

Centered on the idea that every story has:

1. **Foundation** — `M`, `T`, `G`, `CQ`, `SUM` (extracted from `BRAINSTORM` by AI).
2. **9 acts/segments** — `S1`…`S9`, navigated via `StoryNavigation`.
3. **Characters** — separate panel with arc tracking.
4. **Scenes** — each segment can have detailed `scenes[]`.

The outline can be generated by AI (`OutlineGenerationOverlay`, `useOutlinePlan`).

---

## Environment variables

| Var | Use |
|---|---|
| `REACT_APP_URL` | API Gateway base URL (all HTTP endpoints) |

Cognito configuration comes from `src/aws-exports.js` (generated by the Amplify CLI).

---

## Backend endpoints

All under `${REACT_APP_URL}/...`, authenticated via `Authorization: <jwt>` header:

| Endpoint | Event | Description |
|---|---|---|
| `POST /user` | — | Hydrates user data (cap, subscription, works) |
| `POST /works` | `save` | Saves the full story |
| `POST /works` | `update-characters` | Optimized character-only save |
| `POST /story` | `refresh_character_database` | Queues character refresh (response via WS) |
| `POST /communityData` | — | Public events + submission status |
| `POST /adminData` | — | Events and submissions (admin only) |

Handled error codes:
- `400` → storage limit reached
- `401` → token expired, sign in again
- `404` → story not found
- `500` → server error (Lambda/DynamoDB)

---

## Conventions and patterns

- **No prop drilling** — `UserContext` in `App.tsx` exposes global state.
- **Debounced saves** — 500 ms for the local cache; DB saves are triggered by user actions or the interval.
- **Characters don't save immediately** — only on the next story save or via explicit `saveCharacters()`.
- **`useCallback` on all character functions** — preserves identity and avoids re-renders.
- **Comments in legacy files** follow the `// ============================================================================` section banner style. Newer files prefer self-explanatory code.

---

## Local setup

```bash
npm install
# set REACT_APP_URL in .env (or .env.local)
npm start
```

Production build:
```bash
npm run build
```

---

## Things to watch out for

- `App.tsx` concentrates a lot of state and logic (~1750 lines). Refactors have happened (Nov/2025 added `BRAINSTORM` and explicit save data).
- Two overlapping caches (`localStorage` primary + legacy `Amplify.Cache`) — any format change must migrate both.
- Segments may be `string` *or* `{ S, scenes[] }`. Always normalize through `getFieldContent()` / `getSegmentData()` before measuring length or rendering.
- Character refresh is **asynchronous** — don't clear `isCharactersLoading` on the HTTP response, only in the WebSocket handler.
