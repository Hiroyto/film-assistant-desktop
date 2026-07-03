/**
 * ============================================================================
 * APP.TSX - Main Application Component
 * ============================================================================
 * 
 * PURPOSE:
 * This is the root component of the Film Assistant AI application. It manages:
 * 1. Authentication state and user session management
 * 2. Story data persistence (local cache + DynamoDB)
 * 3. Character database management
 * 4. Route protection and navigation
 * 5. Global application state via React Context
 * 
 * ARCHITECTURE OVERVIEW:
 * - Uses AWS Amplify for authentication (Cognito)
 * - Stores story data in DynamoDB via API Gateway + Lambda
 * - Implements local caching with AWS Amplify Cache
 * - Provides debounced saves to prevent DynamoDB throttling
 * - Uses React Context to share state across components
 * 
 * KEY PATTERNS:
 * - Debounced saves: Prevents excessive writes during typing
 * - Automatic story loading: Loads most recent story on app start
 * - Character synchronization: Keeps character data in sync with story data
 * - Protected routes: Ensures authentication for sensitive pages
 * 
 * MAINTAINED BY: Film Assistant AI Team
 * LAST MAJOR REFACTOR: November 2025 - Added BRAINSTORM field and explicit
 *                      data passing for API response saves
 * ============================================================================
 */

import React, { useRef } from 'react';
import './App.css';
import { useMutation } from "react-query";
import { useState, useEffect, createContext, useCallback, useContext } from "react";
import { fetchUserAttributes, fetchAuthSession, AuthSession, JWT } from 'aws-amplify/auth';
import { FetchUserAttributesOutput } from 'aws-amplify/auth';
import type { WithAuthenticatorProps } from '@aws-amplify/ui-react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import { useAuthenticator, Authenticator } from '@aws-amplify/ui-react';
import { BrowserRouter, HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { debounce } from "lodash";
import { Cache } from 'aws-amplify/utils';
import { useNavigate } from 'react-router-dom';
import Pricing from './pages/app/Pricing';
import Home from './pages/app/home';
import Profile from './pages/app/Profile';
import NotFound from './components/notfound';
import '@aws-amplify/ui-react/styles.css';
import { Amplify } from 'aws-amplify';
import config from './aws-exports';
import '@radix-ui/themes/styles.css';
import axios from 'axios';
import Header from './components/header';
import Footer from './components/footer';
import { toast, Toaster } from 'react-hot-toast';
import { User } from './models/user';
import Community from './components/community';
import Login from './pages/auth/Login';
import Events from './components/events';
import { Scripts } from './components/Scripts/Scripts';
import { Event, EventStatus, Winner, Submission } from './models/event';
import Landing from './components/landing';
import Scenes from './components/scenes';
import HomePage from './components/HomePage';
import { AIModelProvider } from './components/AIModelContext';
import { GlobalErrorModal } from './components/Error/GlobalErrorModal';
import { ErrorProvider } from './components/Error/ErrorProvider';
import { StoryUIProvider } from './components/ui/StoryUIContext';
import { useStoryUI } from './components/ui/StoryUIContext';
import { isDesktop } from './lib/ipcClient';
import { safeApiCall } from './models/apiHelpers';
import { startDesktopDataLifecycle, DesktopLifecycleHandle } from './data/desktop-lifecycle';
import { cacheDataToCanonical } from './features/story-workspace/model/cacheDataAdapter';
import { saveStory } from './features/story-workspace/model/storySave';
import { storyRepo, characterRepo } from './data/local-db/repositories';
import { saveCharacters as saveCharactersLocal } from './features/characters/model/characterCommands';
import { CHARACTER_REFRESH_TIMEOUT_MS } from './data/sync-agent/idempotency';
import { worksFromLocal, buildStoryValue } from './features/story-workspace/model/worksFromLocal';
import { on as onSyncEvent } from './data/sync-agent/events';
import { registerTestHook, isTestMode } from './test-bridge/registry';
import { FixtureProvider, type FixtureState } from './test-bridge/fixtureContext';
import { runFixtureBoot } from './test-bridge/fixtures';
import { TourContext } from './components/Tour/TourProvider';
import { tutorialSteps } from './models/tutorialSteps';

// Desktop packages the renderer over file:// where HTML5 history routing 404s on
// navigation; use HashRouter on desktop and keep BrowserRouter on web so the web
// SPA's clean URLs stay unchanged (Strangler Fig: preserve web behavior). (BR-06)
const Router = (typeof window !== 'undefined' && (window as any).electronAPI) ? HashRouter : BrowserRouter;



// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Character Interface
 * 
 * Represents a character in the story. Characters are managed separately from
 * the main story segments to allow for AI-assisted character tracking and
 * consistency checking across the narrative.
 * 
 * FIELDS:
 * - name: Unique identifier and display name
 * - description: Physical and personality traits
 * - importance: Determines how much story weight the character carries
 * - is_new: Flag for newly generated characters (not yet reviewed by user)
 * - locked: If true, AI cannot modify this character
 * - user_touched: If true, user has manually edited this character
 * - arc: Character development trajectory through the story
 */
interface Character {
  name: string;
  description: string;
  importance: 'major' | 'supporting' | 'minor';
  is_new: boolean;
  locked?: boolean;
  user_touched?: boolean;
  arc: {
    starting_state: string;  // Character's initial condition/situation
    goal: string;            // What the character wants
    conflict: string;        // What prevents them from getting it
    need: string;           // What they actually need (vs. what they want)
    growth: 'static' | 'dynamic';  // Does the character change?
  };
}

// ============================================================================
// CONTEXT SETUP
// ============================================================================

/**
 * UserContext
 * 
 * Global context that provides authentication, user data, story data, and
 * character management to all child components. This prevents prop drilling
 * and allows any component to access/modify application state.
 * 
 * EXPORTED VALUES:
 * - Authentication: attributes, user, token, signOut
 * - Story Data: data, setData, debouncedSave, zeroLength
 * - Characters: characters, addCharacter, updateCharacter, deleteCharacter, etc.
 * - Admin: events, submissions (for admin users only)
 */
export const UserContext = createContext<any>({});

// ============================================================================
// AWS AMPLIFY CONFIGURATION
// ============================================================================

/**
 * Configure AWS Amplify with credentials and endpoints.
 * This sets up authentication (Cognito) and allows API calls to our backend.
 */
Amplify.configure(config);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * isAdminUser
 * 
 * Checks if the authenticated user belongs to the 'admin' Cognito group.
 * Admins have access to additional routes like /events for contest management.
 * 
 * @param token - JWT token from Cognito containing user groups
 * @returns boolean - true if user is an admin
 */
const isAdminUser = (token: JWT | undefined) => {
  return Array.isArray(token?.payload['cognito:groups']) &&
    token?.payload['cognito:groups'].includes('admin');
};

// ============================================================================
// ROUTE PROTECTION COMPONENTS
// ============================================================================

/**
 * AdminRoute
 * 
 * Wrapper component that only renders children if the user is an admin.
 * Non-admin users are redirected to the home page.
 * 
 * USAGE: <AdminRoute><Events /></AdminRoute>
 */
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { token } = React.useContext(UserContext);
  const navigate = useNavigate();

  useEffect(() => {
    const isAdmin = token?.payload['cognito:groups']?.includes('admin');
    if (!isAdmin) {
      navigate('/');
    }
  }, [token, navigate]);

  return token?.payload['cognito:groups']?.includes('admin') ? <>{children}</> : null;
};

/**
 * useAuthStatus — gate de auth com seam de teste (parity 19D). Em produção é o
 * `authStatus` real do Amplify Authenticator. Em modo teste (ELECTRON_IS_TEST=1) a
 * suíte de paridade monta telas protegidas sem Cognito real → retorna 'authenticated'.
 * O hook do Amplify é SEMPRE chamado (regras dos hooks); só o valor é sobreposto.
 */
function useAuthStatus(): string {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);
  return isTestMode() ? 'authenticated' : authStatus;
}

/**
 * ProtectedRoute
 *
 * Wrapper component that requires authentication. Unauthenticated users are
 * redirected to either the landing page (for /home) or login page (for other routes).
 *
 * USAGE: <ProtectedRoute><Home /></ProtectedRoute>
 */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const authStatus = useAuthStatus();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Don't redirect while auth is still being determined
    if (authStatus === 'configuring') {
      return;
    }

    if (authStatus !== 'authenticated') {
      // Special handling: /home redirects to landing, others to login
      if (location.pathname === '/dashboard') {
        navigate('/');
      } else {
        navigate('/login');
      }
    }
  }, [authStatus, navigate, location]);

  // Show nothing while configuring
  if (authStatus === 'configuring') {
    return null;
  }

  return authStatus === 'authenticated' ? <>{children}</> : null;
};

/**
 * LoginRoute
 * 
 * Wrapper for the login page. If user is already authenticated, they're
 * redirected to /home to prevent confusion.
 * 
 * USAGE: <LoginRoute><Login /></LoginRoute>
 */
const LoginRoute = ({ children }: { children: React.ReactNode }) => {
  const authStatus = useAuthStatus();
  const navigate = useNavigate();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate('/dashboard');
    }
  }, [authStatus, navigate]);

  return authStatus !== 'authenticated' ? <>{children}</> : null;
};

/**
 * LandingRoute
 * 
 * Wrapper for the public landing page. Authenticated users are redirected
 * to /home since they don't need to see the marketing page.
 * 
 * USAGE: <LandingRoute><Landing /></LandingRoute>
 */
const LandingRoute = ({ children }: { children: React.ReactNode }) => {
  const authStatus = useAuthStatus();
  const navigate = useNavigate();

  useEffect(() => {
    if (authStatus === 'authenticated') {
      navigate('/dashboard');
    }
  }, [authStatus, navigate]);

  return authStatus !== 'authenticated' ? <>{children}</> : null;
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

/**
 * App
 * 
 * Entry point component that wraps the application in a Router.
 * The actual logic is in AppContent to allow access to routing hooks.
 */
function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

/**
 * AppContent
 * 
 * Main application logic component. Manages all global state and provides
 * it to child components via UserContext.
 * 
 * STATE MANAGEMENT:
 * - Authentication state (token, attributes, user data)
 * - Story data (segments, metadata, characters)
 * - UI state (loading, errors)
 * - Admin data (events, submissions)
 * 
 * KEY RESPONSIBILITIES:
 * 1. Authenticate user and fetch their data
 * 2. Load most recent story from database
 * 3. Manage local caching for performance
 * 4. Provide debounced saves to prevent throttling
 * 5. Synchronize character data with story data
 */
function AppContent() {
  // ============================================================================
  // AUTHENTICATION STATE
  // ============================================================================

  /**
   * authStatus: Current authentication state ('authenticated' | 'unauthenticated' | 'loading')
   * amplifySignOut: Function from Amplify to sign out the user
   */
  const { authStatus, signOut: amplifySignOut } = useAuthenticator((context) => [context.authStatus]);
  const navigate = useNavigate();

  /**
   * attributes: User attributes from Cognito (email, name, etc.)
   * token: JWT token used for authorizing API requests
   * user: Extended user data from our DynamoDB user table
   */
  const [attributes, setAttributes] = useState<FetchUserAttributesOutput>();
  const [token, setToken] = useState<JWT>();
  // Handle to the desktop local-first data lifecycle (set on desktop login).
  const desktopLifecycleRef = useRef<DesktopLifecycleHandle | null>(null);
  // Tour controller (null-safe — App is rendered inside TourProvider).
  const tourCtx = useContext(TourContext);
  const [user, setUser] = useState<User | undefined>(undefined);

  // Parity test (spec 06 — billing/AD-04): window.__TEST__.applyUser({cap,subscription,...})
  // aplica um patch ao usuário corrente; o header anima o overlay +N (diff de cap).
  // Inerte fora do modo teste (registra nada em web/produção).
  useEffect(() => {
    if (!isTestMode()) return;
    registerTestHook('applyUser', (patch: Partial<User>) => {
      setUser((prev) => ({ ...(prev ?? {}), ...(patch ?? {}) }) as User);
    });
  }, []);

  // Parity test (19D — roteamento de fixtures): lê `?screen=…&fixture=…` da URL,
  // semeia banco local + usuário e navega para a rota da tela. Expõe o estado via
  // FixtureProvider para sub-views honrarem `subview`/`hint`. Inerte fora do teste.
  const [fixtureState, setFixtureState] = useState<FixtureState | null>(null);
  useEffect(() => {
    if (!isTestMode()) return;
    let cancelled = false;
    // Sinal de "boot de fixture concluído" (parity runtime 19): o seed é assíncrono
    // (IPC SQLite) e o harness (parity/fixtures.ts) precisa AGUARDAR o INSERT assentar
    // antes de navegar/assertar — senão o próximo goto recarrega o renderer e aborta o
    // seed em voo (dbGet volta null). Reset síncrono no mount; true quando o seed acaba.
    (window as any).__TEST_FIXTURE_READY__ = false;
    void runFixtureBoot({
      search: typeof window !== 'undefined' ? window.location.search : '',
      navigate,
      applyUser: (patch) => setUser((prev) => ({ ...(prev ?? {}), ...(patch ?? {}) }) as User),
    })
      .then((state) => {
        if (!cancelled && state) setFixtureState(state);
      })
      .finally(() => {
        (window as any).__TEST_FIXTURE_READY__ = true;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // UI STATE
  // ============================================================================

  /**
   * loading: General loading flag (currently used for initial data fetch)
   */
  const [loading, setLoading] = useState(false);
  const { storyChangeSource, setStoryChangeSource } = useStoryUI();


  // ============================================================================
  // ADMIN STATE
  // ============================================================================

  /**
   * events: Contest/competition events (admin only)
   * submissions: User submissions to contests (admin only)
   */
  const [events, setEvents] = useState<Event[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  // ============================================================================
  // STORY STATE
  // ============================================================================

  /**
   * recentTitle: Tracks the current story title for cache key management
   * Used to update cache when title changes
   */
  const [recentTitle, setRecentTitle] = useState<string>("Untitled");

  // ============================================================================
  // CHARACTER MANAGEMENT STATE
  // ============================================================================

  /**
   * Character state is managed separately from main story data to support:
   * - AI-assisted character tracking across segments
   * - Character consistency checking
   * - Batch character operations without triggering story saves
   * 
   * characters: Array of Character objects for UI rendering
   * characterDatabase: Object map of characters by name (for quick lookups)
   * characterDatabaseEnabled: Feature flag for character tracking
   * isCharactersLoading: Loading state for character refresh operations
   * charactersError: Error message if character operations fail
   */
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterDatabase, setCharacterDatabase] = useState<any>({});
  const [characterDatabaseEnabled, setCharacterDatabaseEnabled] = useState(true);
  const [isCharactersLoading, setIsCharactersLoading] = useState(false);
  const [charactersError, setCharactersError] = useState<string | null>(null);

  /**
   * isWebSocketUpdating: Flag to prevent individual saves during bulk WebSocket updates
   * 
   * WHY THIS EXISTS:
   * When the WebSocket receives a bulk update (e.g., AI generates multiple segments),
   * we don't want to trigger individual saves for each segment update. This flag
   * tells character functions to suppress toast notifications and saves during
   * batch operations.
   */
  const [isWebSocketUpdating, setIsWebSocketUpdating] = useState(false);

  // ============================================================================
  // EFFECT: FETCH USER ATTRIBUTES FROM COGNITO
  // ============================================================================

  /**
   * Runs once when user authenticates.
   * Fetches user attributes (email, name) and auth token from Cognito.
   * The token is used to authorize all subsequent API requests.
   */
  useEffect(() => {
    async function handleFetchUserAttributes() {
      try {
        setAttributes(await fetchUserAttributes());
        const result = (await fetchAuthSession()).tokens?.idToken;
        setToken(result);
      } catch (error) {
        toast.error("error");
      }
    }
    handleFetchUserAttributes();
  }, [authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: TOKEN REFRESH
  // ============================================================================

  /**
   * Cognito tokens expire after 1 hour. This effect refreshes the token every
   * 20 minutes (1200000ms) to ensure uninterrupted API access.
   * 
   * WHY 20 MINUTES:
   * Provides a safety buffer before the 60-minute expiration.
   */
  useEffect(() => {
    const tokenRefresh = setInterval(async () => {
      const result = (await fetchAuthSession()).tokens?.idToken;
      setToken(result);
    }, 1200000); // 20 minutes
    return () => clearInterval(tokenRefresh);
  }, [authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: AUTO-SAVE INTERVAL
  // ============================================================================

  /**
   * Automatically saves the current story every 30 minutes (1800000ms) as a
   * safety measure. This prevents data loss if the user forgets to save.
   * 
   * NOTE: Most saves are triggered by user actions (typing, generating content).
   * This is a backup mechanism.
   */
  useEffect(() => {
    const savedWork = setInterval(async () => {
      if (data.title !== "") {
        mutateSave.mutateAsync({ title: data.title, storyId: data.storyId });
      }
    }, 1800000); // 30 minutes
    return () => clearInterval(savedWork);
  }, [authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: FETCH USER DATA FROM DYNAMODB
  // ============================================================================

  /**
   * After Cognito authentication, fetch extended user data from our DynamoDB table.
   * 
   * FETCHED DATA:
   * - cap: User's remaining API credit balance (for AI generations)
   * - subscription: User's subscription tier (free/pro/enterprise)
   * - sign_up_date: Account creation date
   * - works: Map of all user's saved stories (key: storyId, value: story data)
   * - privacy: User's privacy settings
   * 
   * WHY SEPARATE FROM COGNITO:
   * Cognito only stores authentication data. Application-specific data (stories,
   * credits, etc.) lives in our DynamoDB tables.
   */
  useEffect(() => {
    async function handleDynamoUser() {
      // Desktop local-first (B2): a grade/`works` vem do SQLite (offline-capable;
      // já populado pelo initial-pull + scheduler). Lê o local primeiro — assim a
      // Home aparece instantânea e mesmo offline (quando o POST /user falha). O
      // backend abaixo segue atualizando cap/subscription e alimentando o pull.
      const desktopUserId = token?.payload['cognito:username'] as string | undefined;
      if (isDesktop() && desktopUserId) {
        try {
          const localWorks = await worksFromLocal(desktopUserId);
          if (Object.keys(localWorks).length > 0) {
            setUser(u => ({ ...u, works: localWorks }));
            setLoading(true);
          }
        } catch (e) {
          console.error('[B2] works local falhou (cai p/ backend)', e);
        }
      }
      try {
        if (token) {
          // Routed through safeApiCall (JIT refresh + 401-retry + 5xx-retry on the
          // live path). On desktop the JIT provider is active (configureApi); on web
          // it is a no-op and the passed token is used (Strangler Fig parity).
          const r = await safeApiCall('user', {
            email: token?.payload.email,
            userId: token?.payload['cognito:username']
          }, token.toString());
          if (r.success) {
            const body = r.data?.body ?? {};
            setUser(u => ({
              ...u,
              cap: body.cap,
              subscription: body.subscription,
              sign_up_date: body.sign_up_date,
              // Desktop: `works` é fonte-local (SQLite); o backend NÃO sobrescreve.
              // O scheduler aplica os deltas do backend no SQLite e o efeito de
              // refresh (sync.applied) re-lê. Web: `works` vem do backend.
              ...(isDesktop() ? {} : { works: body.works }),
              privacy: body.privacy
            }));
            setLoading(true);
          }
        }
      } catch (error) {
        toast.error("error");
      }
    }
    handleDynamoUser();
  }, [token, authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: REFRESH WORKS FROM LOCAL ON SYNC (B2 — desktop local-first)
  // ============================================================================
  // Quando o pull aplica deltas do backend no SQLite (sync.applied) ou o initial
  // pull termina, re-lê o `works` do banco local. Mantém a grade da Home coerente
  // com o que o scheduler trouxe, sem depender de um novo POST /user. No-op na web.
  useEffect(() => {
    if (!isDesktop()) return;
    const userId = token?.payload['cognito:username'] as string | undefined;
    if (!userId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const localWorks = await worksFromLocal(userId);
        if (!cancelled && Object.keys(localWorks).length > 0) {
          setUser(u => ({ ...u, works: localWorks }));
        }
      } catch (e) {
        console.error('[B2] refresh works (sync) falhou', e);
      }
    };
    const offApplied = onSyncEvent('sync.applied', refresh);
    const offPull = onSyncEvent('sync.initial_pull.completed', refresh);
    return () => { cancelled = true; offApplied(); offPull(); };
  }, [token]);

  // ============================================================================
  // EFFECT: FETCH ADMIN DATA (IF USER IS ADMIN)
  // ============================================================================

  /**
   * If the user is an admin, fetch contest events and submissions.
   * This data is only accessible to admin users for contest management.
   */
  useEffect(() => {
    async function handleAdminEvents() {
      try {
        if (isAdminUser(token)) {
          const r = await safeApiCall('adminData', {}, token?.toString() ?? '');
          if (r.success) {
            const body = r.data?.body ?? {};
            setSubmissions(body.submissions);
            setEvents(body.events);
          }
        }
      } catch (error) {
        toast.error("error");
      }
    }
    handleAdminEvents();
  }, [token, authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: FETCH COMMUNITY/CONTEST DATA
  // ============================================================================

  /**
   * Fetch public contest events and check if the user has submitted to any.
   * This data is shown in the Community page.
   * 
   * UPDATES:
   * - events: All public contest events
   * - user.contest_submitted: User's submission status
   */
  useEffect(() => {
    async function handleCommunityEvents() {
      try {
        if (token) {
          const r = await safeApiCall('communityData', {
            userId: token?.payload['cognito:username']
          }, token.toString());
          if (r.success) {
            const body = r.data?.body ?? {};
            setEvents(body.events);
            setUser(u => ({
              ...u,
              contest_submitted: body.submission,
            }));
          }
        }
      } catch (error) {
        toast.error("error");
      }
    }
    handleCommunityEvents();
  }, [token, authStatus === 'authenticated']);

  // ============================================================================
  // EFFECT: DESKTOP LOCAL-FIRST DATA LIFECYCLE (Fase de Integração — BC-08)
  // ============================================================================

  /**
   * Desktop only. On login, starts the OS-aware session (wires JIT token refresh
   * into safeApiCall), runs the initial pull (backend -> local SQLite) on the
   * first desktop login, and starts the sync scheduler (periodic pull + queue
   * push). Web is unaffected and the legacy DynamoDB save path stays the writer
   * (Strangler Fig). See src/data/desktop-lifecycle.ts.
   */
  useEffect(() => {
    if (!isDesktop() || authStatus !== 'authenticated' || !token) return;
    const userId = token.payload['cognito:username'] as string | undefined;
    if (!userId) return;
    const handle = startDesktopDataLifecycle({
      userId,
      getEmail: () => token.payload.email as string | undefined,
      onInitialPull: (r) =>
        console.info(
          `[desktop] initial pull: ${r.storiesPulled}/${r.worksReportedCount} stories, ` +
            `${r.charactersPulled} characters (integrity=${r.integrityOk})`,
        ),
    });
    desktopLifecycleRef.current = handle;
    return () => {
      handle.stop();
      desktopLifecycleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, token?.payload?.['cognito:username']]);

  // ============================================================================
  // DATA STRUCTURE DEFINITIONS
  // ============================================================================

  /**
 * CacheData Interface
 * 
 * Defines the structure of story data stored in both:
 * 1. Local state (this component)
 * 2. AWS Amplify Cache (for offline access and quick loading)
 * 3. DynamoDB (persistent storage)
 * 
 * FIELDS:
 * - title: Story title (also used as cache key)
 * - storyId: Unique identifier for DynamoDB (prevents title collision)
 * - M: Mood & Setting (metadata)
 * - T: Theme (metadata)
 * - G: Genre (metadata)
 * - CQ: Core Question (central dramatic question)
 * - SUM: Synopsis (high-level story summary)
 * - BRAINSTORM: Freeform brainstorming notes (input for AI foundation extraction)
 * - S1-S9: Story segments (acts/sequences/beats) - can be string or object with scenes
 * - characters: Character database (map of character name → Character object)
 * 
 * NOTE: Segments can be either:
 * - Simple strings: "The hero begins their journey..."
 * - Objects with scenes: { S: "summary", scenes: [...] }
 */
  interface CacheData {
    title: string;
    storyId?: string;
    M: string;
    T: string;
    G: string;
    CQ: string;
    SUM: string;
    BRAINSTORM?: string;
    S1: string | { S: string; scenes: any[] };
    S2: string | { S: string; scenes: any[] };
    S3: string | { S: string; scenes: any[] };
    S4: string | { S: string; scenes: any[] };
    S5: string | { S: string; scenes: any[] };
    S6: string | { S: string; scenes: any[] };
    S7: string | { S: string; scenes: any[] };
    S8: string | { S: string; scenes: any[] };
    S9: string | { S: string; scenes: any[] };
    characters?: any;
    screenplayContent?: string;
  }
  /**
   * CACHE_KEY
   * 
   * Uses the current story title as the cache key. When the title changes,
   * we update both the cache and the key to maintain the correct cache entry.
   */
  const CACHE_KEY = recentTitle;

  /**
   * generateStoryId
   * 
   * Creates a unique identifier for stories using timestamp + random string.
   * 
   * FORMAT: story_1234567890_abc123
   * - story_: Prefix for easy identification
   * - 1234567890: Unix timestamp (ensures rough chronological ordering)
   * - abc123: Random 6-character string (prevents collisions)
   * 
   * WHY NOT USE TITLE AS ID:
   * Users can have multiple stories with the same title. The storyId ensures
   * each story is uniquely identifiable in DynamoDB.
   */
  const generateStoryId = () => {
    return `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  };

  /**
   * initialData
   * 
   * Default empty story structure. Used when:
   * 1. User first opens the app (before any stories are loaded)
   * 2. Cache fails to load
   * 3. User creates a new story
   */
  const initialData: CacheData = {
    title: 'Untitled Story',
    storyId: generateStoryId(),
    M: '',
    T: '',
    G: '',
    CQ: '',
    SUM: '',
    BRAINSTORM: '',
    S1: '',
    S2: '',
    S3: '',
    S4: '',
    S5: '',
    S6: '',
    S7: '',
    S8: '',
    S9: '',
    characters: {}
  };

  /**
   * data
   * 
   * PRIMARY STATE: The current story being edited by the user.
   * 
   * This is the single source of truth for the story in the UI. All components
   * read from and update this state. Changes are automatically:
   * 1. Saved to local cache (via debouncedSave)
   * 2. Saved to DynamoDB (via handleDebouncedSave in home.tsx)
   */
  const [data, setData] = useState<CacheData>(initialData);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * zeroLength
   * 
   * Calculates total content length across all story segments (excluding metadata).
   * 
   * USED FOR:
   * - Detecting if story is empty
   * - Determining if we should auto-load a story from the database
   * - Showing "empty state" UI
   * 
   * NOTE: Does not include BRAINSTORM field since that's input data, not story content.
   */
  const zeroLength = () => {
    return (
      getFieldContent(data.G).length +
      getFieldContent(data.T).length +
      getFieldContent(data.CQ).length +
      getFieldContent(data.SUM).length +
      getFieldContent(data.S1).length +
      getFieldContent(data.S2).length +
      getFieldContent(data.S3).length +
      getFieldContent(data.S4).length +
      getFieldContent(data.S5).length +
      getFieldContent(data.S6).length +
      getFieldContent(data.S7).length +
      getFieldContent(data.S8).length +
      getFieldContent(data.S9).length
    );
  };

  /**
  * getFieldContent
  * 
  * Extracts text content from a field that can be in multiple formats.
  * Used for length calculations and displaying text content.
  * 
  * SUPPORTED FORMATS:
  * 1. Simple string: "The hero begins..."
  * 2. DynamoDB string object: { S: "The hero begins..." }
  * 3. Object with S property: { S: "summary", scenes: {...} }
  * 
  * WHY MULTIPLE FORMATS:
  * - Local state uses simple strings
  * - DynamoDB returns objects with type indicators ({ S: "..." })
  * - Segments with scenes use objects { S: "summary", scenes: {...} }
  * 
  * @param field - The field data (string | object | undefined)
  * @returns Extracted text content or empty string
  */
  const getFieldContent = (field: any): string => {
    if (!field) return '';
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && 'S' in field && typeof field.S === 'string') {
      return field.S;
    }
    return '';
  };

  /**
   * getSegmentData
   * 
   * Extracts segment data while preserving scenes if present.
   * Used when loading story data to maintain the full segment structure.
   * 
   * SUPPORTED FORMATS:
   * 1. Simple string: "The hero begins..." → returns string
   * 2. Object without scenes: { S: "content" } → returns string
   * 3. Object with scenes: { S: "summary", scenes: [...] } → returns full object
   * 
   * WHY THIS EXISTS:
   * getFieldContent() was stripping scenes when loading from database.
   * This function preserves the scenes array for segments that have them.
   * 
   * @param field - The segment data (string | object | undefined)
   * @returns String for simple content, or object with S and scenes for segments with scenes
   */
  const getSegmentData = (field: any): string | { S: string; scenes: any[] } => {
    if (!field) return '';
    if (typeof field === 'string') return field;
    if (typeof field === 'object') {
      // If it has scenes (array format or legacy object format), preserve the full object
      if (field.scenes) {
        const hasScenes = Array.isArray(field.scenes)
          ? field.scenes.length > 0
          : Object.keys(field.scenes).length > 0;

        if (hasScenes) {
          return {
            S: typeof field.S === 'string' ? field.S : '',
            scenes: field.scenes
          };
        }
      }
      // Otherwise just return the S content as string
      if ('S' in field && typeof field.S === 'string') {
        return field.S;
      }
    }
    return '';
  };

  /**
   * calculateContentLength
   * 
   * Similar to zeroLength but accepts a story data object parameter.
   * Used to calculate content length of stories loaded from the database.
   * 
   * @param storyData - Story object (potentially from database with DynamoDB format)
   * @returns Total character count across all segments
   */
  const calculateContentLength = (storyData: any): number => {
    return (
      getFieldContent(storyData.G).length +
      getFieldContent(storyData.T).length +
      getFieldContent(storyData.CQ).length +
      getFieldContent(storyData.SUM).length +
      getFieldContent(storyData.S1).length +
      getFieldContent(storyData.S2).length +
      getFieldContent(storyData.S3).length +
      getFieldContent(storyData.S4).length +
      getFieldContent(storyData.S5).length +
      getFieldContent(storyData.S6).length +
      getFieldContent(storyData.S7).length +
      getFieldContent(storyData.S8).length +
      getFieldContent(storyData.S9).length
    );
  };

  // ============================================================================
  // CHARACTER MANAGEMENT FUNCTIONS
  // ============================================================================

  /**
   * Character functions are wrapped in useCallback to prevent unnecessary
   * re-renders and maintain referential equality for child components.
   */

  /**
   * loadCharactersFromStoryData
   * 
   * Loads characters from a story object into local state.
   * 
   * CALLED WHEN:
   * - Story is loaded from database
   * - User switches between stories
   * 
   * @param storyData - Story object containing characters field
   */
  const loadCharactersFromStoryData = useCallback((storyData: any) => {
    if (storyData && storyData.characters && typeof storyData.characters === 'object') {
      console.log('Loading characters from story data:', Object.keys(storyData.characters));
      const charactersArray = Object.values(storyData.characters) as Character[];
      setCharacters(charactersArray);
      setCharacterDatabase(storyData.characters);
      setCharactersError(null);
    } else {
      console.log('No characters found in story data');
      setCharacters([]);
      setCharacterDatabase({});
    }
  }, []);

  /**
   * addCharacter
   * 
   * Adds a new character to the local character database.
   * 
   * IMPORTANT: This does NOT save to the database immediately.
   * The character is saved when:
   * 1. User manually saves the story
   * 2. Character panel calls saveCharacters()
   * 3. Debounced save triggers
   * 
   * WHY NO IMMEDIATE SAVE:
   * Prevents excessive DynamoDB writes when adding multiple characters in bulk.
   * 
   * @param character - Character object to add
   */
  const addCharacter = useCallback(async (character: Character) => {
    try {
      console.log('Adding character:', character.name);
      setCharacters((prev: Character[]) => [...prev, character]);
      setCharacterDatabase((prev: any) => ({ ...prev, [character.name]: character }));

      // Only show toast if not during WebSocket batch update
      if (!isWebSocketUpdating) {
        toast.success(`Character "${character.name}" added successfully`);
      }
    } catch (error) {
      console.error('Error adding character:', error);
      if (!isWebSocketUpdating) {
        toast.error('Error adding character');
      }
      setCharactersError('Error adding character');
    }
  }, [isWebSocketUpdating]);

  /**
   * updateCharacter
   * 
   * Updates an existing character in the local character database.
   * 
   * MATCHING: Characters are matched by name (name is the unique key).
   * PERSISTENCE: Like addCharacter, this doesn't immediately save to database.
   * 
   * @param updatedCharacter - Updated character object
   */
  const updateCharacter = useCallback(async (updatedCharacter: Character) => {
    try {
      console.log('Updating character:', updatedCharacter.name);
      setCharacters((prev: Character[]) => prev.map(c => c.name === updatedCharacter.name ? updatedCharacter : c));
      setCharacterDatabase((prev: any) => ({ ...prev, [updatedCharacter.name]: updatedCharacter }));

      // Only show toast if not during WebSocket batch update
      if (!isWebSocketUpdating) {
        toast.success(`Character "${updatedCharacter.name}" updated successfully`);
      }
    } catch (error) {
      console.error('Error updating character:', error);
      if (!isWebSocketUpdating) {
        toast.error('Error updating character');
      }
      setCharactersError('Error updating character');
    }
  }, [isWebSocketUpdating]);

  /**
   * deleteCharacter
   * 
   * Removes a character from the local character database.
   * 
   * PERSISTENCE: Like other character functions, this doesn't immediately save.
   * The deletion is persisted on the next story save.
   * 
   * @param characterName - Name of character to delete
   */
  const deleteCharacter = useCallback(async (characterName: string) => {
    try {
      console.log('Deleting character:', characterName);
      setCharacters((prev: Character[]) => prev.filter(c => c.name !== characterName));
      setCharacterDatabase((prev: any) => {
        const newDatabase = { ...prev };
        delete newDatabase[characterName];
        return newDatabase;
      });

      // Only show toast if not during WebSocket batch update
      if (!isWebSocketUpdating) {
        toast.success(`Character "${characterName}" deleted successfully`);
      }
    } catch (error) {
      console.error('Error deleting character:', error);
      if (!isWebSocketUpdating) {
        toast.error('Error deleting character');
      }
      setCharactersError('Error deleting character');
    }
  }, [isWebSocketUpdating]);

  /**
   * saveCharacters
   * 
   * Saves characters to DynamoDB using the "update-characters" endpoint.
   * 
   * WHY SEPARATE ENDPOINT:
   * Character updates don't need to send the entire story (all 9 segments).
   * This optimized endpoint only updates the characters field, which:
   * 1. Reduces payload size
   * 2. Prevents DynamoDB throttling
   * 3. Improves response time
   * 
   * PAYLOAD SIZE COMPARISON:
   * - Full story save: ~50-200KB (includes all segments)
   * - Character-only save: ~5-20KB (only characters)
   * 
   * CALLED BY:
   * - Character management panel (when user explicitly saves)
   * - Bulk character operations (e.g., AI generates multiple characters)
   * 
   * @param charactersToSave - Array of Character objects to save
   */
  const saveCharacters = useCallback(async (charactersToSave: Character[]) => {
    try {
      console.log('💾 Starting character-only save operation');
      console.log('💾 Characters to save:', {
        count: charactersToSave.length,
        names: charactersToSave.map(c => c.name)
      });

      // Validate required data
      if (!data.storyId) {
        console.error('❌ Cannot save characters: Missing storyId');
        throw new Error('Cannot save characters: Missing storyId');
      }

      if (!token?.payload['cognito:username']) {
        console.error('❌ Cannot save characters: Missing userId');
        throw new Error('Cannot save characters: Not authenticated');
      }

      // Convert character array to database format (object map)
      // DynamoDB stores characters as: { "CharacterName": {...}, "OtherName": {...} }
      const characterDatabase = charactersToSave.reduce((acc, char) => {
        acc[char.name] = {
          name: char.name,
          description: char.description || '',
          importance: char.importance || 'minor',
          locked: char.locked || false,
          is_new: char.is_new || false,
          user_touched: char.user_touched || false,
          arc: {
            starting_state: char.arc?.starting_state || '',
            goal: char.arc?.goal || '',
            conflict: char.arc?.conflict || '',
            need: char.arc?.need || '',
            growth: char.arc?.growth || 'static'
          }
        };
        return acc;
      }, {} as any);

      // Optimized payload - only character data
      const payload = {
        event: "update-characters",
        userId: token.payload['cognito:username'],
        storyId: data.storyId,
        characters: characterDatabase
      };

      console.log('📤 Sending character-only update:', {
        event: payload.event,
        storyId: payload.storyId,
        characterCount: Object.keys(payload.characters).length,
        characterNames: Object.keys(payload.characters),
        payloadSize: JSON.stringify(payload).length + ' bytes'
      });

      // A2 (local-first / AD-01): no desktop, grava characters no SQLite + enfileira
      // o push (event=update-characters, characters como mapa). Web: POST direto.
      let response: any;
      if (isDesktop()) {
        const uid = token.payload['cognito:username'] as string;
        await saveCharactersLocal(data.storyId, charactersToSave as any, uid);
        const works = await worksFromLocal(uid);
        response = { data: { statusCode: 200, works } };
      } else {
        response = await axios.post(`${process.env.REACT_APP_URL}/works`, payload, {
          headers: { "Authorization": token.toString() }
        });
      }

      console.log('✅ Characters updated successfully');

      // Update local state to match saved data
      setCharacters(charactersToSave);
      setCharacterDatabase(characterDatabase);

      // CRITICAL: Also update data.characters to keep in sync
      // This ensures the next full story save includes the updated characters
      setData(prevData => ({
        ...prevData,
        characters: characterDatabase
      }));

      console.log('📊 Synced character database to data.characters');

      // Update works list if returned in response
      if (response.data?.works) {
        setUser((prevUser: any) => {
          if (!prevUser) return prevUser;
          return {
            ...prevUser,
            works: response.data.works
          };
        });
      }

      return response;

    } catch (error: any) {
      console.error('💥 Character save error:', error);

      if (error.response?.status === 401) {
        throw new Error('Authentication expired - please log in again');
      } else if (error.response?.status === 404) {
        throw new Error('Story not found');
      } else {
        throw new Error(`Failed to save characters: ${error.message}`);
      }
    }
  }, [data.storyId, token, setCharacters, setCharacterDatabase, setData, setUser]);

  /**
   * refreshCharacterDatabase
   * 
   * Queues a character refresh request for async processing.
   * Results are delivered via WebSocket.
   * 
   * FLOW:
   * 1. User clicks Refresh → this function called
   * 2. Set loading state immediately
   * 3. POST to API → queues SQS message with trigger: 'manual_refresh'
   * 4. API returns 202 → request queued
   * 5. WebSocket delivers character-update → loading cleared in Home.tsx
   */
  const refreshCharacterDatabase = useCallback(async () => {
    if (!token || !data.storyId) {
      toast.error('Cannot refresh characters: missing token or story ID');
      return;
    }

    setIsCharactersLoading(true);
    setCharactersError(null);

    try {
      console.log('🔄 Queueing character refresh for story:', data.storyId);

      const response = await axios.post(`${process.env.REACT_APP_URL}/story`, {
        event: "refresh_character_database",
        userId: token.payload['cognito:username'],
        storyId: data.storyId,
        existing_character_database: characterDatabase,
        G: getFieldContent(data.G),
        T: getFieldContent(data.T),
        CQ: getFieldContent(data.CQ),
        M: getFieldContent(data.M),
        SUM: getFieldContent(data.SUM),
        S1: getFieldContent(data.S1),
        S2: getFieldContent(data.S2),
        S3: getFieldContent(data.S3),
        S4: getFieldContent(data.S4),
        S5: getFieldContent(data.S5),
        S6: getFieldContent(data.S6),
        S7: getFieldContent(data.S7),
        S8: getFieldContent(data.S8),
        S9: getFieldContent(data.S9)
      }, {
        headers: { "Authorization": token.toString() }
      });

      // 202 = queued successfully, results will arrive via WebSocket
      if (response.status === 202 || response.data?.statusCode === 202) {
        console.log('✅ Character refresh queued, awaiting WebSocket response');
        toast.success('Analyzing characters...');
        // NOTE: Don't set isCharactersLoading to false here
        // WebSocket handler in Home.tsx will clear it when results arrive
      } else {
        // Unexpected response - clear loading state
        console.warn('⚠️ Unexpected response status:', response.status);
        setIsCharactersLoading(false);
      }

    } catch (error: any) {
      console.error('❌ Error queueing character refresh:', error);
      const errorMessage = error.response?.data?.error || 'Error refreshing character database';
      setCharactersError(errorMessage);
      setIsCharactersLoading(false);
      toast.error(errorMessage);
    }
  }, [token, data, characterDatabase]);

  // Watchdog: clears the "analyzing characters" spinner if no WebSocket result
  // arrives within the timeout (fixes the spinner-forever bug — tech-debt #3 /
  // BR-MIGRAR-022). Armed whenever loading; cleared when loading flips off (a WS
  // result or the error path). If it fires, force-clear and offer a retry.
  useEffect(() => {
    if (!isCharactersLoading) return;
    const t = setTimeout(() => {
      setIsCharactersLoading(false);
      setCharactersError('Character refresh timed out. Please try again.');
      toast.error('Character refresh timed out. Please try again.');
    }, CHARACTER_REFRESH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isCharactersLoading]);

  /**
   * toggleCharacterDatabase
   * 
   * Enables/disables the character tracking feature.
   * 
   * WHEN DISABLED:
   * - Character panel doesn't show
   * - AI doesn't track characters
   * - Saves don't include character data
   * 
   * @param enabled - Whether to enable character tracking
   */
  const toggleCharacterDatabase = useCallback((enabled: boolean) => {
    console.log('Toggling character database:', enabled);
    setCharacterDatabaseEnabled(enabled);

    if (enabled) {
      toast.success('Character database enabled');
    } else {
      toast.success('Character database disabled');
    }
  }, []);

  // ============================================================================
  // EFFECT: LOAD CACHED DATA
  // ============================================================================

  /**
   * Runs once on component mount. Attempts to load cached story data.
   * 
   * CACHE FLOW:
   * 1. Check for cached data using current title as key
   * 2. If found, parse and load into state
   * 3. If cache has no storyId (legacy data), generate one
   * 4. If cache fails, fall back to initialData
   * 
   * WHY CACHE:
   * - Instant load time (no network request)
   * - Works offline
   * - Reduces DynamoDB read costs
   * 
   * NOTE: Cache is updated via debouncedSave whenever data changes.
   */
  useEffect(() => {
    const loadCache = async () => {
      // ── 0. SQLite local (desktop, B1 / AD-01) ───────────────────────────
      // Fonte-da-verdade no desktop: carrega a story ativa do banco local ANTES
      // do localStorage. Roda no mount (pré-auth) — getStory é por storyId, não
      // precisa de userId. screenplayContent fica para o editor (B3). No-op web.
      if (isDesktop()) {
        try {
          const activeId = localStorage.getItem('active_story_id');
          if (activeId) {
            const row = await storyRepo.getStory(activeId);
            if (row) {
              const charRows = await characterRepo.listByStory(activeId);
              setData(buildStoryValue(row, charRows) as CacheData);
              return;
            }
          }
        } catch (err) {
          console.error('[B1] load local da story ativa falhou (cai p/ localStorage)', err);
        }
      }

      // ── 1. localStorage (primário) ──────────────────────────────────────
      try {
        const activeId = localStorage.getItem('active_story_id');
        if (activeId) {
          const raw = localStorage.getItem(`story_${activeId}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (!parsed.storyId) parsed.storyId = generateStoryId();
            setData(parsed);
            return;
          }
        }
        // Sem active_story_id — pega pelo _cachedAt mais recente
        const storyKeys = Object.keys(localStorage).filter(k => k.startsWith('story_'));
        if (storyKeys.length > 0) {
          const candidates = storyKeys
            .map(k => { try { return JSON.parse(localStorage.getItem(k)!); } catch { return null; } })
            .filter(Boolean);
          const newest = candidates.sort((a, b) => (b._cachedAt || 0) - (a._cachedAt || 0))[0];
          if (newest) { setData(newest); return; }
        }
      } catch (err) {
        console.error('localStorage load failed:', err);
      }

      // ── 2. Amplify Cache (fallback legado) ──────────────────────────────
      try {
        const cachedData = await Cache.getItem(CACHE_KEY);
        if (cachedData) {
          const parsedData = JSON.parse(cachedData);
          if (!parsedData.storyId) parsedData.storyId = generateStoryId();
          setData(parsedData);
          return;
        }
      } catch (err) {
        console.error('Amplify Cache load failed:', err);
      }

      setData(initialData);
    };

    loadCache();
  }, []); // Empty array = run once on mount

  // ============================================================================
  // EFFECT: AUTO-LOAD MOST RECENT STORY
  // ============================================================================

  /**
   * When user data loads from DynamoDB, automatically load their most recent story.
   * 
   * LOAD LOGIC:
   * 1. If user has no content (empty story), load most recent story
   * 2. If user is viewing a different story, don't auto-switch (respect user intent)
   * 3. If database has updates to current story, reload it
   * 
   * STORY SELECTION:
   * - Most recent = highest lastModified timestamp
   * - Falls back to createdAt if lastModified doesn't exist
   * 
   * WHY AUTO-LOAD:
   * - Better UX: User sees their work immediately
   * - Prevents confusion: User doesn't start with empty story by default
   * - Mobile-friendly: Reduces clicks to get started
   * 
   * EDGE CASES HANDLED:
   * - User has no saved stories → Keep default untitled story
   * - User is actively editing → Don't interrupt their work
   * - Story was edited in another tab → Reload to sync changes
   */
  useEffect(() => {
    if (storyChangeSource === "user") {
      setStoryChangeSource("auto");
      return;
    }
    // Only run if user has saved stories
    if (user?.works && Object.keys(user.works).length > 0) {
      const currentContentLength = calculateContentLength(data);
      const hasMinimalContent = currentContentLength === 0;
      const isDefaultUntitled = data.title === 'Untitled Story' && hasMinimalContent;

      // Find most recently modified story
      const stories = Object.entries(user.works);
      const mostRecent = stories.reduce((latest, [storyId, story]) => {
        const storyModified = new Date((story as any).lastModified || (story as any).createdAt || 0);
        const latestModified = new Date((latest[1] as any).lastModified || (latest[1] as any).createdAt || 0);
        return storyModified > latestModified ? [storyId, story] : latest;
      });

      if (mostRecent && mostRecent[1]) {
        const [storyId, storyData] = mostRecent as [string, any];

        // Determine if we should load this story
        const canAutoLoad =
          !data.storyId || isDefaultUntitled;

        const shouldLoad =
          canAutoLoad ||
          (data.storyId === storyId && storyData.title !== data.title);
        // Same story, updated

        if (shouldLoad) {
          console.log('Loading story from database:', {
            reason: isDefaultUntitled ? 'default untitled story' :
              data.storyId !== storyId ? 'different story' : 'updated in database',
            storyTitle: storyData.title,
            storyId: storyId,
            currentStoryId: data.storyId,
            currentTitle: data.title
          });

          // Convert database format to local format
          // Use getSegmentData for S1-S9 to preserve scenes
          const loadedData: CacheData = {
            title: storyData.title || '',
            storyId: storyId,
            M: getFieldContent(storyData.M),
            T: getFieldContent(storyData.T),
            G: getFieldContent(storyData.G),
            CQ: getFieldContent(storyData.CQ),
            SUM: getFieldContent(storyData.SUM),
            BRAINSTORM: getFieldContent(storyData.BRAINSTORM) || '',
            S1: getSegmentData(storyData.S1),
            S2: getSegmentData(storyData.S2),
            S3: getSegmentData(storyData.S3),
            S4: getSegmentData(storyData.S4),
            S5: getSegmentData(storyData.S5),
            S6: getSegmentData(storyData.S6),
            S7: getSegmentData(storyData.S7),
            S8: getSegmentData(storyData.S8),
            S9: getSegmentData(storyData.S9),
            characters: storyData.characters || {},
            screenplayContent: storyData.screenplayContent || (() => {
              try {
                const cached = localStorage.getItem(`story_${storyId}`);
                if (cached) {
                  const parsed = JSON.parse(cached);
                  return parsed.screenplayContent || '';
                }
              } catch { /* ignore */ }
              return '';
            })(),
          };

          setData(loadedData);
          setRecentTitle(storyData.title || "Untitled");

          // Load characters from story data
          loadCharactersFromStoryData(storyData);

          // Update cache with database data
          try {
            const cacheKey = storyData.title || "Untitled";
            const cachePayload = { ...loadedData, _cachedAt: Date.now() };
            Cache.setItem(cacheKey, JSON.stringify(cachePayload));
            // Também atualiza o localStorage com o dado completo
            if (storyId) {
              localStorage.setItem(`story_${storyId}`, JSON.stringify(cachePayload));
              localStorage.setItem('active_story_id', storyId);
            }
          } catch (error) {
            console.error('Error caching loaded story:', error);
          }

          console.log('Successfully loaded story from database:', storyData.title);
        } else {
          console.log('Keeping current story state:', {
            title: data.title,
            hasContent: currentContentLength > 0,
            reason: 'user is working on current story'
          });

          // Even if not loading new story, load characters for current story
          const currentStoryEntry = stories.find(([id, story]) => id === data.storyId);
          if (currentStoryEntry && currentStoryEntry[1]) {
            loadCharactersFromStoryData(currentStoryEntry[1]);
          }
        }
      }
    } else {
      // No saved works - ensure proper untitled story state
      if (!data.title || !data.storyId) {
        console.log('No saved works found, ensuring proper untitled story');
        const newUntitledData = {
          ...data,
          title: 'Untitled Story',
          storyId: data.storyId || generateStoryId()
        };
        setData(newUntitledData);
      }
      // Clear characters when no works
      setCharacters([]);
      setCharacterDatabase({});
    }
  }, [user?.works, loadCharactersFromStoryData, storyChangeSource]);

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  /**
   * debouncedSave
   * 
   * Updates the local cache whenever story data changes.
   * 
   * DEBOUNCE TIME: 500ms
   * - Waits 500ms after last change before updating cache
   * - Prevents excessive cache writes during typing
   * 
   * WHAT IT DOES:
   * 1. Serializes data to JSON
   * 2. Stores in AWS Amplify Cache
   * 3. Updates cache key if title changed
   * 
   * WHY DEBOUNCE:
   * - User types "The hero" → Would trigger 9 cache updates without debounce
   * - With debounce → 1 cache update after user stops typing
   * 
   * NOTE: This is LOCAL CACHE ONLY. Database saves are handled in home.tsx.
   */
  const debouncedSave = useCallback(
    debounce((newData: CacheData) => {
      try {
        const payload = { ...newData, _cachedAt: Date.now() };
        const json = JSON.stringify(payload);

        // Primário: localStorage por storyId + ponteiro para a story ativa
        if (newData.storyId) {
          localStorage.setItem(`story_${newData.storyId}`, json);
          localStorage.setItem('active_story_id', newData.storyId);
        }

        // Secundário: Amplify Cache (compatibilidade legada)
        const cacheKey = newData.title || 'Untitled';
        Cache.setItem(cacheKey, json);

        if (newData.title !== recentTitle) {
          setRecentTitle(newData.title || 'Untitled');
        }
      } catch (error) {
        console.error('Error saving to cache:', error);
      }
    }, 500),
    [recentTitle]
  );

  /**
   * Cleanup effect for debounced function.
   * Cancels pending debounced calls when component unmounts.
   */
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  // ============================================================================
  // AUTHENTICATION: SIGN OUT
  // ============================================================================

  /**
   * handleSignOut
   * 
   * Signs out the user and cleans up state.
   * 
   * FLOW:
   * 1. Attempt to save current work (if any)
   * 2. Call Amplify signOut (clears Cognito session)
   * 3. Navigate to landing page
   * 4. Show error toast if anything fails
   * 
   * SAFETY:
   * - Continues sign out even if save fails (prevents user being stuck)
   * - Errors are logged but don't block sign out
   */
  const handleSignOut = async () => {
    try {
      if (data.title !== "") {
        try {
          await mutateSave.mutateAsync({ title: data.title, storyId: data.storyId });
        } catch (saveError) {
          console.error('Error saving before signout:', saveError);
          // Continue with signout even if save fails
        }
      }
      // Flush the local sync queue before signing out so queued mutations reach the
      // backend before the token is invalidated (BR-MIGRAR-008). No-op on web.
      try {
        await desktopLifecycleRef.current?.flushAll();
      } catch (e) {
        console.error('[signout] local flush falhou (prossegue)', e);
      }
      await amplifySignOut();
      navigate('/');
    } catch (error) {
      toast.error("Error signing out");
    }
  };

  // ============================================================================
  // DATABASE SAVE MUTATION
  // ============================================================================

  /**
   * mutateSave
   * 
   * React Query mutation for saving stories to DynamoDB.
   * 
   * WHY REACT QUERY:
   * - Handles loading/error states automatically
   * - Provides retry logic for failed requests
   * - Caches mutation results
   * - Prevents duplicate simultaneous saves
   * 
   * MUTATION FLOW:
   * 1. mutationFn: Calls save() with title and storyId
   * 2. onSuccess: Updates local state with response data
   * 3. onError: Logs error (toast shown by caller)
   * 
   * CALLED BY:
   * - home.tsx handleDebouncedSave (typing saves)
   * - Auto-save interval (every 30 min)
   * - Sign out handler (save before leaving)
   */
  const mutateSave = useMutation({
    mutationFn: (saveData: { title: string; storyId?: string }) => {
      return save(saveData.title, saveData.storyId);
    },
    onSuccess: (res: any) => {
      if (res.data.statusCode == 200) {
        console.log("Saved!")

        // Update user's works list with response
        if (res.data.body.works) {
          setUser((prevUser: User | undefined) => {
            if (!prevUser) return prevUser;
            return {
              ...prevUser,
              works: res.data.body.works
            };
          });
        }

        // For new stories, update local storyId
        if (res.data.body.storyId && !data.storyId) {
          const newData = {
            ...data,
            storyId: res.data.body.storyId
          };
          setData(newData);
        }
      }
    },
    onError: (error: any) => {
      console.log("Save error:", error);
    },
  });

  /**
   * save
   * 
   * Sends story data to the backend for persistence in DynamoDB.
   * 
   * API ENDPOINT: POST /works
   * EVENT: "save"
   * 
   * PAYLOAD STRUCTURE:
   * {
   *   event: "save",
   *   title: "My Story",
   *   storyId: "story_123_abc",
   *   userId: "user-cognito-id",
   *   M: "Setting content...",
   *   T: "Theme content...",
   *   // ... all other fields
   * }
   * 
   * IMPORTANT FIELDS:
   * - title: Used for display, not unique identifier
   * - storyId: Unique identifier, prevents title collisions
   * - userId: Cognito username, ensures data isolation
   * - BRAINSTORM: New field (Nov 2025), input for AI story generation
   * 
   * RESPONSE:
   * {
   *   statusCode: 200,
   *   body: {
   *     works: { ... },  // Updated works list
   *     storyId: "...",  // Story ID (for new stories)
   *     message: "..."   // Success message
   *   }
   * }
   * 
   * ERROR HANDLING:
   * - 400: Storage limit reached (user must delete stories)
   * - 401: Token expired (user must log in again)
   * - 500: Server error (Lambda or DynamoDB issue)
   * 
   * @param title - Story title
   * @param storyId - Optional story ID (for updates vs. new stories)
   * @returns Axios response promise
   */
  const save = async (title: string, storyId?: string) => {
    // A1 (local-first / AD-01): no desktop, grava o SQLite PRIMEIRO e enfileira o
    // push ao /works (push-worker faz retry/backoff). storyId é client-gen (COD-002);
    // a serialização canônica preserva segments+scenes (corrige RISK-011 lossy save).
    // Retorna um envelope no mesmo shape do backend p/ o onSuccess do mutateSave.
    if (isDesktop()) {
      const userId = token?.payload['cognito:username'] as string;
      const effectiveStoryId = storyId || data.storyId || generateStoryId();
      const canonical = cacheDataToCanonical({ ...data, title, storyId: effectiveStoryId });
      await saveStory(canonical, userId, { forceImmediate: true });
      const works = await worksFromLocal(userId);
      return { data: { statusCode: 200, body: { storyId: effectiveStoryId, works } } } as any;
    }

    const payload: any = {
      "event": "save",
      "title": title,
      "userId": token?.payload['cognito:username'],
      "M": data.M,
      "T": data.T,
      "G": data.G,
      "CQ": data.CQ,
      "SUM": data.SUM,
      "BRAINSTORM": data.BRAINSTORM || "",
      "S1": data.S1,
      "S2": data.S2,
      "S3": data.S3,
      "S4": data.S4,
      "S5": data.S5,
      "S6": data.S6,
      "S7": data.S7,
      "S8": data.S8,
      "S9": data.S9,
      "screenplayContent": data.screenplayContent || "",
    };

    // Include storyId for updates
    if (storyId || data.storyId) {
      payload.storyId = storyId || data.storyId;
    }

    const res = await axios.post(`${process.env.REACT_APP_URL}/works`, payload, {
      headers: { "Authorization": token?.toString() }
    });

    return res;
  }

  // ============================================================================
  // EFFECT: NATIVE MENU ACTIONS (Fase de Integração — SCR-0027)
  // ============================================================================
  // The OS menu bar (shell/menu/appMenu) emits IPC menu events; DesktopShell
  // re-dispatches them as window CustomEvents. Wire them to real actions here.
  useEffect(() => {
    if (!isDesktop()) return;
    const onSave = () => {
      if (!data?.title) { toast('Nothing to save yet.'); return; }
      void toast.promise(mutateSave.mutateAsync({ title: data.title, storyId: data.storyId }), {
        loading: 'Saving…',
        success: 'Saved',
        error: 'Save failed',
      });
    };
    const onNew = () => navigate('/home');
    const onTour = () => tourCtx?.startTour(tutorialSteps as any);
    const onCheckUpdates = () =>
      toast("You're on the latest version — updates install automatically.");
    window.addEventListener('app:save-story', onSave);
    window.addEventListener('app:new-story', onNew);
    window.addEventListener('app:start-tour', onTour);
    window.addEventListener('app:check-updates', onCheckUpdates);
    return () => {
      window.removeEventListener('app:save-story', onSave);
      window.removeEventListener('app:new-story', onNew);
      window.removeEventListener('app:start-tour', onTour);
      window.removeEventListener('app:check-updates', onCheckUpdates);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.title, data?.storyId]);

  // ============================================================================
  // RENDER: CONTEXT PROVIDER + ROUTES
  // ============================================================================

  /**
   * The component returns the route structure wrapped in UserContext.Provider.
   * 
   * CONTEXT VALUES:
   * All state and functions are provided to child components via UserContext.
   * This eliminates prop drilling and allows any component to access app state.
   * 
   * ROUTE STRUCTURE:
   * - Public: / (landing), /login
   * - Protected: /home, /profile, /prices, /community, /scenes, /scripts
   * - Admin-only: /events
   * - Fallback: * (404 page)
   * 
   * ROUTE GUARDS:
   * - LandingRoute: Redirects authenticated users to /home
   * - LoginRoute: Redirects authenticated users to /home
   * - ProtectedRoute: Requires authentication
   * - AdminRoute: Requires admin role
   */
  return (
    <>
      <AIModelProvider>
        <Authenticator.Provider>
          <ErrorProvider>
            <UserContext.Provider value={{
              // ========================================
              // AUTHENTICATION & USER DATA
              // ========================================
              attributes,      // Cognito user attributes (email, name, etc.)
              user,           // Extended user data from DynamoDB
              setUser,        // Function to update user state
              signOut: handleSignOut,  // Sign out with cleanup
              token,          // JWT token for API authorization
              setToken,       // Function to update token
              loading,        // General loading flag

              // ========================================
              // STORY DATA
              // ========================================
              data,           // Current story data (primary state)
              setData,        // Function to update story data
              debouncedSave,  // Local cache save (debounced)
              zeroLength,     // Helper to check if story is empty

              // ========================================
              // ADMIN DATA
              // ========================================
              events,         // Contest events (admin + public)
              setEvents,      // Function to update events
              submissions,    // Contest submissions (admin only)
              setSubmissions, // Function to update submissions

              // ========================================
              // CHARACTER MANAGEMENT
              // ========================================
              characters,                  // Array of Character objects
              characterDatabase,           // Object map of characters by name
              characterDatabaseEnabled,    // Feature flag for character tracking
              isCharactersLoading,        // Loading state for character operations
              setIsCharactersLoading,
              charactersError,            // Error message for character operations
              addCharacter,               // Add new character to local state
              updateCharacter,            // Update existing character
              deleteCharacter,            // Delete character from local state
              refreshCharacterDatabase,   // AI refresh of character database
              toggleCharacterDatabase,    // Enable/disable character tracking
              saveCharacters,             // Save characters to DynamoDB (optimized)

              // ========================================
              // WEBSOCKET BATCH UPDATE FLAG
              // ========================================
              isWebSocketUpdating,        // Prevents individual saves during bulk updates
              setIsWebSocketUpdating,     // Function to set WebSocket flag

              // ========================================
              // DIRECT STATE SETTERS (FOR HOME COMPONENT)
              // ========================================
              setCharacters,              // Direct access to character state setter
              setCharacterDatabase,       // Direct access to character DB setter
            }}>
              <GlobalErrorModal />
              <FixtureProvider value={fixtureState}>
              <Routes>
                {/* ========================================
                PUBLIC ROUTES
                ======================================== */}
                <Route path="/" element={
                  <LandingRoute>
                    <Landing />
                  </LandingRoute>
                } />
                <Route path="/login" element={
                  <LoginRoute>
                    <Login />
                  </LoginRoute>
                } />

                {/* ========================================
                PROTECTED ROUTES (AUTHENTICATION REQUIRED)
                ======================================== */}
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <HomePage />
                  </ProtectedRoute>
                } />
                <Route path="/home" element={
                  <ProtectedRoute>
                    <Home attributes={attributes} user={user} setUser={setUser} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />
                <Route path="/profile" element={
                  <ProtectedRoute>
                    <Profile attributes={attributes} user={user} setUser={setUser} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />
                <Route path="/prices" element={
                  <ProtectedRoute>
                    <Pricing attributes={attributes} user={user} setUser={setUser} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />
                <Route path="/community" element={
                  <ProtectedRoute>
                    <Community attributes={attributes} user={user} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />
                <Route path="/scenes" element={
                  <ProtectedRoute>
                    <Scenes attributes={attributes} user={user} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />
                <Route path="/scripts" element={
                  <ProtectedRoute>
                    <Scripts attributes={attributes} user={user} signOut={handleSignOut} />
                  </ProtectedRoute>
                } />

                {/* ========================================
                ADMIN-ONLY ROUTES
                ======================================== */}
                <Route path="/events" element={
                  <ProtectedRoute>
                    <AdminRoute>
                      <Events />
                    </AdminRoute>
                  </ProtectedRoute>
                } />

                {/* ========================================
                FALLBACK ROUTE (404)
                ======================================== */}
                <Route path='*' element={<NotFound />} />
              </Routes>
              </FixtureProvider>
            </UserContext.Provider>
          </ErrorProvider>
        </Authenticator.Provider>
      </AIModelProvider>
    </>
  );
}

export default App;