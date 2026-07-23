import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserContext } from '../App';
import { toast, Toaster } from 'react-hot-toast';
import { useMutation } from "react-query";
import Header from './header';
import Footer from './footer';
import StoryGrid from './Profile/StoryGrid';
import NewStoryModal from './Home/NewStoryModal';
import './HomePage.css';
import axios from 'axios';
import { User } from '../models/user';
import { ErrorModal } from './ui/ErrorModal';
import { useError } from './Error/useError';
import { Layers } from 'lucide-react';
import { markStoryWorkflow, resolveStoryWorkflow } from '../lib/storyWorkflows';
import { isDesktop } from '../lib/ipcClient';
import { saveStory } from '../features/story-workspace/model/storySave';
import { cacheDataToCanonical } from '../features/story-workspace/model/cacheDataAdapter';
import { worksFromLocal } from '../features/story-workspace/model/worksFromLocal';
import { useTour } from './Tour/useTour';
import { isWowSeen, markWowSeen } from './Freeform/corkboard/wowShared';

/**
 * HOMEPAGE COMPONENT
 * 
 * This is the new landing page that users see when they log in.
 * It provides two main pathways:
 * 
 * 1. Start a new story - Write in the brainstorm field and click "Build Your Story"
 * 2. Continue existing work - Click on any story card to load it
 * 
 * ARCHITECTURE INTEGRATION:
 * - Uses UserContext from App.tsx for global state
 * - Navigates to /home (the main editor) when user selects/creates a story
 * - Auto-saves current work before switching stories (prevents data loss)
 * - Integrates with existing save/load architecture from Profile.tsx
 * 
 * ROUTING FLOW:
 * /dashboard (this component) → User chooses story → /home (main editor)
 * 
 * LAYOUT STRUCTURE:
 * - Pure CSS layout without Radix UI for complete control
 * - Hero banner uses CSS Grid for perfect centering
 * - Projects and Tips sections use max-width containers for consistent centering
 */

interface HomePageProps { }

// ============================================================
// EXAMPLE PROMPTS FOR AUTO-TYPING (moved outside component)
// ============================================================
const EXAMPLE_PROMPTS = [
  "A detective discovers their partner is the serial killer they've been hunting...",
  "In a world where memories can be bought and sold, a memory thief steals the wrong past...",
  "A chef inherits a restaurant with a magical recipe book that brings dishes to life...",
  "Two time travelers from opposite timelines fall in love and threaten to unravel history...",
  "A teenager hears the final thoughts of the dead and must solve their parent's murder...",
  "An AI becomes self-aware and creates a utopia that humanity never asked for...",
  "A retired superhero must train their ex-nemesis's child who inherited devastating powers...",
  "Astronauts discover an ancient alien artifact during the moon landing...",
  "A musician trades fame for the ability to enjoy music...",
  "A Victorian scientist creates a serum to experience other lives but becomes addicted..."
];

export function HomePage(props: HomePageProps) {
  const STORIES_LIMIT = 10;
  // ============================================================
  // CONTEXT & GLOBAL STATE
  // ============================================================
  const {
    user,
    setUser,
    signOut,
    token,
    data,
    setData,
    debouncedSave
  } = useContext(UserContext);

  const navigate = useNavigate();
  const { startTour, endTour } = useTour();
  // FIL-506 — first sign-in picks the writer up on the dashboard, welcomes them,
  // points at "Build Your Story", then hands off into the corkboard wow (a
  // per-user sandbox) with the sample prefilled + editable. Re-armed by clearing
  // site data; the corkboard marks it seen when the flow finishes.
  const wowOnboardStartedRef = useRef(false);
  // While the onboarding tour is live, clicking the real "Build Your Story"
  // button routes into the wow sample instead of the normal new-story flow.
  // Holds the action (or null when onboarding isn't active).
  const onboardingBuildRef = useRef<null | (() => void)>(null);
  // General first-run welcome overlay (prompts to start the guided tour).
  const [showWowWelcome, setShowWowWelcome] = useState(false);

  // ============================================================
  // LOCAL STATE
  // ============================================================
  const [brainstormText, setBrainstormText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [deletingItems, setDeletingItems] = useState(new Set<string>());
  const { showError } = useError();
  const [storiesCount, setStoriesCount] = useState(0);
  const [openNewStory, setOpenNewStory] = useState(false);
  const pendingBrainstormRef = useRef<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingWorks, setLoadingWorks] = useState(true);

  useEffect(() => {
    if (!user?.works) {
      setStoriesCount(0);
      return;
    }

    const count = Object.keys(user.works).length;
    setStoriesCount(count);

  }, [user?.works]);

  const canCreateStory = useCallback(() => {
    const currentCount = user?.works ? Object.keys(user.works).length : 0;
    if (currentCount >= STORIES_LIMIT) {
      showError({
        title: "Storage limit reached",
        message: `You've reached the maximum of ${STORIES_LIMIT} stories. Please delete one first.`,
      });
      return false;
    }
    return true;
  }, [user?.works, showError]);

  // ============================================================
  // AUTO-TYPING EFFECT - FIXED VERSION
  // ============================================================
  useEffect(() => {
    if (userHasInteracted) return;

    let index = 0;
    let typingInterval: NodeJS.Timeout | null = null;
    let pauseTimeout: NodeJS.Timeout | null = null;
    const currentPrompt = EXAMPLE_PROMPTS[currentPromptIndex];

    // Start typing
    setIsTyping(true);
    typingInterval = setInterval(() => {
      if (userHasInteracted) {
        if (typingInterval) clearInterval(typingInterval);
        if (pauseTimeout) clearTimeout(pauseTimeout);
        return;
      }

      if (index < currentPrompt.length) {
        setBrainstormText(currentPrompt.substring(0, index + 1));
        index++;
      } else {
        // Finished typing this prompt
        if (typingInterval) clearInterval(typingInterval);
        setIsTyping(false);

        // Wait 3 seconds then cycle to next prompt
        pauseTimeout = setTimeout(() => {
          if (!userHasInteracted) {
            setBrainstormText('');
            setCurrentPromptIndex((prev) => (prev + 1) % EXAMPLE_PROMPTS.length);
            setIsTyping(true);
          }
        }, 3000);
      }
    }, 25);

    return () => {
      if (typingInterval) clearInterval(typingInterval);
      if (pauseTimeout) clearTimeout(pauseTimeout);
    };
  }, [currentPromptIndex, userHasInteracted]);

  // ============================================================
  // BRAINSTORM INPUT HANDLERS
  // ============================================================
  const handleBrainstormFocus = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserHasInteracted(true);
    setIsTyping(false); // Stop the typing animation immediately
    setIsInputFocused(true);
    // Text is preserved - user can continue typing or editing
  };

  const handleBrainstormChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserHasInteracted(true);
    setBrainstormText(e.target.value);
  };

  const handleBrainstormBlur = () => {
    setIsInputFocused(false);
    if (brainstormText.trim() === '') {
      setUserHasInteracted(false);
      setCurrentPromptIndex(Math.floor(Math.random() * EXAMPLE_PROMPTS.length));
      setBrainstormText('');
      setIsTyping(true);
    }
  };

  const handleClearBrainstorm = () => {
    setBrainstormText('');
    // Keep userHasInteracted true so autofill doesn't restart
  };

  // ============================================================
  // SCROLL TO PROJECTS
  // ============================================================
  const handleScrollToProjects = () => {
    const projectsSection = document.querySelector('.projects-section');
    if (projectsSection) {
      const yOffset = -80; // Negative offset to account for header height
      const y = projectsSection.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // ============================================================
  // CREATE NEW STORY FROM BRAINSTORM
  // ============================================================
  const handleBuildStory = useCallback(() => {
    // During the first-run tutorial, the Build button drives the wow sample,
    // not the normal new-story modal.
    if (onboardingBuildRef.current) {
      onboardingBuildRef.current();
      return;
    }
    if (!canCreateStory()) return;

    const brainstormContent = brainstormText.trim();

    if (!brainstormContent || brainstormContent.length < 50) {
      toast.error('Please write at least 50 characters before building your story');
      return;
    }

    pendingBrainstormRef.current = brainstormContent;
    setOpenNewStory(true);
  }, [brainstormText, canCreateStory]);

  // ============================================================
  // CREATE NEW EMPTY STORY (Jump to Outline)
  // ============================================================
  const saveNewStory = async (data: any) => {
    const title =
      data?.title && data.title.trim() !== ""
        ? data.title
        : `Story ${new Date()
          .toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
          .replace(/:/g, "-")
        }`;

    const payload: any = {
      event: "save", title, userId: token?.payload["cognito:username"],
      // Send the client-generated storyId so the works record is keyed by the
      // SAME id the corkboard navigates to (and writes its graph under). Without
      // this the backend minted its own id, so the grid record and the corkboard
      // project diverged — data orphaned, blank on re-entry.
      ...(data?.storyId ? { storyId: data.storyId } : {}),
      // Which pathway this story opens in (outline editor vs corkboard).
      workflow: data?.workflow ?? 'outline',
      M: "", T: "", G: "", CQ: "", SUM: "", BRAINSTORM: "", S1: "", S2: "", S3: "", S4: "", S5: "", S6: "", S7: "", S8: "", S9: ""
    };
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_URL}/works`,
        payload,
        { headers: { Authorization: token.toString() } }
      );
      return response;
    } catch (error) {
      console.error("💥 saveNewStory axios error:", error);
      throw error;
    }
  };

  const mutateCreateStory = useMutation({
    mutationFn: (data: any) => {
      return saveNewStory(data);
    },

    onSuccess: (res: any) => {
      if (res.data.statusCode === 200) {
        if (res.data.body?.works) {
          setUser((prevUser: any) => {
            if (!prevUser) return prevUser;
            return {
              ...prevUser,
              works: res.data.body.works,
            };
          });
        }

        if (res.data.body?.storyId) {
          setData((prev: any) => ({
            ...prev,
            storyId: res.data.body.storyId,
          }));
        }

      } else {
        showError({
          title: "Storage limit reached",
          message: "Ran out of space. Please delete a saved work",
        });
        navigate('/dashboard');
      }
    },

    onError: () => {
      toast.error("Error creating story");
    },
  });

  const createNewStory = useCallback(
    async (data: any) => {
      try {
        const result = await mutateCreateStory.mutateAsync(data);
        return result;
      } catch (error) {
        console.error("💥 Create story error:", error);
        throw error;
      }
    },
    [mutateCreateStory]
  );

  // The /works create response does NOT return the backend-minted storyId; it
  // only surfaces via the /user works list. After creating a corkboard story,
  // refetch that list and return the newly-added record's key — the real
  // storyId the grid uses, which the corkboard must navigate to (and write its
  // graph under) so the story isn't orphaned. Brief retry covers read-after-
  // write lag; falls back to the client id if it never appears.
  // NOTE: web-only path. On desktop the story is written to the local SQLite
  // under the client id (see the freeform branch below), so that id IS the
  // canonical key and this cloud refetch is neither needed nor reachable (CORS).
  const resolveCreatedStoryId = useCallback(
    async (title: string, prevKeys: Set<string>, clientFallback: string): Promise<string> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await axios.post(
            `${process.env.REACT_APP_URL}/user`,
            { email: token?.payload.email, userId: token?.payload['cognito:username'] },
            { headers: { Authorization: token.toString() } },
          );
          const freshWorks: Record<string, any> = res?.data?.body?.works ?? {};
          const added = Object.keys(freshWorks).filter((k) => !prevKeys.has(k));
          const match = added.find((k) => freshWorks[k]?.title === title) ?? added[0];
          if (match) {
            setUser((u: any) => (u ? { ...u, works: freshWorks } : u));
            return match;
          }
        } catch {
          /* network blip — retry */
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      console.warn('[create] minted storyId never appeared in works; using client id', clientFallback);
      return clientFallback;
    },
    [token, setUser],
  );

  type FormStoryData = {
    title: string;
    primaryGenre: string;
    secondaryGenre?: string;
    theme: string;
    workflow: 'outline' | 'freeform';
  };

  // Creates the story record then forks by workflow: outline → the structured
  // editor at /home (existing behavior); freeform → the corkboard at
  // /freeform/:storyId. Freeform stories live in the same works registry
  // (same grid, same limit) — their actual story data lives in the freeform
  // backend keyed by projectId === storyId; the work record carries the title
  // + workflow tag. The hero brainstorm text seeds the corkboard's braindump
  // dock via navigation state.
  const handleJumpToOutline = useCallback(async (form: FormStoryData) => {
    if (!canCreateStory()) return;

    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).replace(/:/g, '-');

    const newTitle = `Story ${timestamp}`;
    const newStoryId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const newData = {
      title: form.title || `Untitled Story ${timestamp}`,
      storyId: newStoryId,
      workflow: form.workflow,
      BRAINSTORM: "",
      M: "", T: "", G: "", CQ: "", SUM: "",
      S1: "", S2: "", S3: "", S4: "", S5: "",
      S6: "", S7: "", S8: "", S9: ""
    };

    if (form.workflow === 'freeform') {
      // FIL-514: seed the corkboard braindump ONLY from pendingBrainstormRef
      // (set by "Build Your Story"). "Blank Outline" / "+ New Story" leave it
      // empty, so they open a blank corkboard instead of inheriting the rotating
      // hero placeholder or leftover text. (Reading brainstormText was the bug.)
      const seed = pendingBrainstormRef.current.trim();
      pendingBrainstormRef.current = '';

      // The corkboard owns its own state (freeform backend, keyed by storyId),
      // but the WORK RECORD (title + workflow tag) must land in the same store
      // the grid reads, so a corkboard story shows up beside outline stories and
      // survives a restart. `workflow` isn't a column in the local `stories`
      // table, so the tag is kept via markStoryWorkflow (localStorage) —
      // resolveStoryWorkflow reads that fallback for routing + the grid badge.
      if (isDesktop()) {
        // Local-first (mirrors App.save): SQLite is the source of truth, keyed by
        // the client id — so THAT id is canonical (no server-minted id to
        // resolve) and corkboard project == grid id. The push queue mirrors to
        // /works in the background. Feeds worksFromLocal → the Home/Profile grid.
        markStoryWorkflow(newStoryId, 'freeform');
        try {
          const userId = token?.payload['cognito:username'] as string;
          await saveStory(cacheDataToCanonical(newData), userId, { forceImmediate: true });
          const works = await worksFromLocal(userId);
          setUser((prev: any) => (prev ? { ...prev, works } : prev));
        } catch (e) {
          console.error('freeform local save failed', e);
        }
        navigate(`/freeform/${newStoryId}`, {
          state: { justCreated: true, ...(seed ? { braindump: seed } : null) },
        });
        toast.success(`Created corkboard story: ${newData.title}`);
      } else {
        // Web: the works backend mints its OWN storyId (not returned by create),
        // so resolve it from the /user works list — otherwise the corkboard would
        // write its graph under the client id while the grid record lives under
        // the minted id, orphaning the data (blank on re-entry). FIL-513.
        try {
          const prevWorkKeys = new Set(Object.keys(user?.works ?? {}));
          const result = await createNewStory(newData);
          if (result?.data?.statusCode !== 200) return; // limit error already surfaced
          const corkboardId = await resolveCreatedStoryId(newData.title, prevWorkKeys, newStoryId);
          markStoryWorkflow(corkboardId, 'freeform');
          navigate(`/freeform/${corkboardId}`, {
            state: { justCreated: true, ...(seed ? { braindump: seed } : null) },
          });
          toast.success(`Created corkboard story: ${newData.title}`);
        } catch {
          /* create failed — error toast already shown by the mutation */
        }
      }
      return;
    }

    setData(newData);
    debouncedSave(newData);
    createNewStory(newData);

    navigate('/home');
    toast.success(`Created new story: ${newTitle}`);
  }, [
    canCreateStory,
    setData,
    debouncedSave,
    createNewStory,
    navigate,
    token,
    setUser,
    user,
    resolveCreatedStoryId
  ]);




  // ============================================================
  // LOAD EXISTING STORY
  // ============================================================
  const handleLoadStory = useCallback((storyId: string) => {
    const storyData = user?.works?.[storyId];

    if (!storyData) {
      toast.error('Story not found');
      return;
    }

    // Freeform stories open on the corkboard — their state lives in the
    // freeform backend, not the outline editor's data context.
    if (resolveStoryWorkflow(storyData, storyId) === 'freeform') {
      navigate(`/freeform/${storyId}`);
      return;
    }

    setData(storyData);
    debouncedSave(storyData);

    // Navigate to main editor
    navigate('/home');
    toast.success(`Loaded story: ${storyData.title}`);
  }, [user, setData, debouncedSave, navigate]);

  // FIL-506 — create a REAL corkboard story for the wow sample so it's saved and
  // shows up in the writer's grid (not a hidden sandbox), then hand off into it.
  const startWowStory = useCallback(async () => {
    const fallbackId = `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newData = {
      title: 'My First Story',
      storyId: fallbackId,
      workflow: 'freeform' as const,
      BRAINSTORM: '', M: '', T: '', G: '', CQ: '', SUM: '',
      S1: '', S2: '', S3: '', S4: '', S5: '', S6: '', S7: '', S8: '', S9: '',
    };
    if (isDesktop()) {
      // Local-first, like the freeform branch of handleJumpToOutline: the client
      // id is canonical (SQLite key), so no server-minted id to resolve.
      markStoryWorkflow(fallbackId, 'freeform');
      try {
        const userId = token?.payload['cognito:username'] as string;
        await saveStory(cacheDataToCanonical(newData), userId, { forceImmediate: true });
        const works = await worksFromLocal(userId);
        setUser((prev: any) => (prev ? { ...prev, works } : prev));
      } catch (e) {
        console.error('wow local save failed', e);
      }
      navigate(`/freeform/${fallbackId}`, { state: { justCreated: true, wow: true } });
      return;
    }
    try {
      toast.loading('Setting up your first story…', { id: 'wow-create' });
      const prevWorkKeys = new Set(Object.keys(user?.works ?? {}));
      const result = await createNewStory(newData);
      toast.dismiss('wow-create');
      if (result?.data?.statusCode !== 200) return; // limit error surfaced by the mutation
      // The create response has no minted id — resolve it from the works list
      // (see resolveCreatedStoryId / handleJumpToOutline) so the corkboard project
      // == grid id and the braindump's graph isn't orphaned.
      const serverStoryId = await resolveCreatedStoryId(newData.title, prevWorkKeys, fallbackId);
      markStoryWorkflow(serverStoryId, 'freeform');
      navigate(`/freeform/${serverStoryId}`, { state: { justCreated: true, wow: true } });
    } catch {
      toast.dismiss('wow-create');
      /* create failed — error toast already shown by the mutation */
    }
  }, [createNewStory, navigate, user, resolveCreatedStoryId, token, setUser]);

  // First sign-in: show a general welcome overlay (prompts to start a tour).
  useEffect(() => {
    if (wowOnboardStartedRef.current) return;
    if (!token?.payload) return;
    if (isWowSeen()) return;
    wowOnboardStartedRef.current = true;
    setShowWowWelcome(true);
  }, [token]);

  // Accept the tour → coach the writer to click the real "Build Your Story"
  // button (which is re-routed to the wow sample while onboarding is live).
  const beginWowTour = useCallback(() => {
    setShowWowWelcome(false);
    onboardingBuildRef.current = () => { endTour(); startWowStory(); };
    startTour(
      [
        {
          id: 'wow-build',
          selector: '[data-tour="build-story"]',
          hideNext: true,
          content: (
            <div style={{ maxWidth: 280 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Start here.</div>
              <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
                Click <strong>Build Your Story</strong> to begin — we'll walk you through your first one.
              </div>
            </div>
          ),
        },
      ],
      { lockScroll: false, onSkip: () => { onboardingBuildRef.current = null; markWowSeen(); } },
    );
  }, [startTour, endTour, startWowStory]);

  const skipWowTour = useCallback(() => {
    setShowWowWelcome(false);
    onboardingBuildRef.current = null;
    markWowSeen();
  }, []);

  const handleDynamoUser = useCallback(async () => {
    if (!token?.payload) return; // 🔥 proteção

    setLoadingWorks(true);

    try {
      const res = await axios.post(
        `${process.env.REACT_APP_URL}/user`,
        {
          email: token.payload.email,
          userId: token.payload["cognito:username"],
        },
        { headers: { Authorization: token.toString() } }
      );

      setUser((prev: User) => ({
        ...prev,
        works: res.data.body.works ?? {},
        cap: res.data.body.cap,
        subscription: res.data.body.subscription,
        sign_up_date: res.data.body.sign_up_date,
        privacy: res.data.body.privacy,
      }));
    } catch (error) {
      toast.error("Erro ao carregar dados do usuário");
    } finally {
      setLoadingWorks(false);
    }
  }, [setUser, token]);

  useEffect(() => {
    if (!token?.payload) return;
    handleDynamoUser();
  }, [token, handleDynamoUser]);

  // ============================================================
  // DELETE STORY
  // ============================================================
  const handleDeleteStory = useCallback(async (storyId: string) => {
    try {
      deleteWork.mutate(storyId);
      toast.success('Story deleted');

      // If this is a real implementation, you'd call your delete API here
      // and update the user's works list
    } catch (error) {
      toast.error('Failed to delete story');
    }
  }, []);

  const deleteWork = useMutation({
    mutationFn: async (storyIds: Set<string> | string) => {
      const storyIdsArray = storyIds instanceof Set ? Array.from(storyIds) : [storyIds];
      const isDeletingCurrentWork = storyIdsArray.includes(data.storyId);
      const res = await handleDeletion(storyIds)
      return { res, isDeletingCurrentWork };
    },
    onMutate: (storyIds: Set<string> | string) => {
      if (storyIds instanceof Set) {
        setDeletingItems(new Set([...deletingItems, ...storyIds]));
      } else {
        setDeletingItems(new Set([...deletingItems, storyIds]));
      }
    },
    onSuccess: async (result: { res: any; isDeletingCurrentWork: boolean }) => {
      const { res, isDeletingCurrentWork } = result;

      if (res.data.statusCode === 200) {
        toast.success("Work deleted!");

        await handleDynamoUser();
        if (isDeletingCurrentWork) {
          const generateStoryId = () => `story_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

          const empty = {
            storyId: generateStoryId(),
            title: "",
            M: "",
            T: "",
            G: "",
            CQ: "",
            SUM: "",
            S1: "",
            S2: "",
            S3: "",
            S4: "",
            S5: "",
            S6: "",
            S7: "",
            S8: "",
            S9: "",
          };

          setData(empty);
          debouncedSave(empty);
        }

        setDeletingItems(new Set());
      } else if (res.data.statusCode === 400) {
        toast.error(res.data.body.error);
      } else {
        toast.error("error");
      }
    },
    onError: (error: any) => {
      toast.error("error");
      setDeletingItems(new Set());
    },
  });

  const handleDeletion = async (storyIds: Set<string> | string) => {
    const storyIdsToDelete = storyIds instanceof Set ? Array.from(storyIds) : [storyIds];

    return await axios.post(`${process.env.REACT_APP_URL}/works`, {
      "event": "delete", // Tells the Lambda function what to do
      "storyIds": storyIdsToDelete, // Array of story IDs to delete
      "userId": token?.payload['cognito:username'], // User authentication
    },
      { headers: { "Authorization": token.toString() } } // JWT token for auth
    );
  }

  const autoResizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';          // reseta
    el.style.height = `${el.scrollHeight}px`; // ajusta ao conteúdo
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="homepage-wrapper">
      <Toaster position="top-center" reverseOrder={false} />
      <Header signOut={signOut} />

      <NewStoryModal
        isOpen={openNewStory}
        onClose={() => { setOpenNewStory(false); pendingBrainstormRef.current = ''; }}
        onSubmit={handleJumpToOutline}
      />

      {/* FIL-506 — general first-run welcome overlay → starts the guided tour. */}
      {showWowWelcome && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(8,8,10,0.82)', backdropFilter: 'blur(6px)',
            fontFamily: 'system-ui, sans-serif',
            animation: 'wowWelcomeOverlayIn 420ms ease-out both',
          }}
        >
          <style>{`
            @keyframes wowWelcomeOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes wowWelcomeCardIn { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
          `}</style>
          <div
            style={{
              width: 'min(560px, 92vw)', padding: '34px 34px 30px', borderRadius: 18,
              background: 'linear-gradient(135deg,#1a1a1e 0%,#0e0e10 100%)',
              border: '1px solid #ff6b3533', boxShadow: '0 0 40px #ff6b351f, 0 24px 70px rgba(0,0,0,0.6)',
              color: '#fff', textAlign: 'center',
              animation: 'wowWelcomeCardIn 460ms cubic-bezier(0.16, 1, 0.3, 1) both',
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: 1.4, fontWeight: 700, color: '#ff6b35', textTransform: 'uppercase' }}>
              Welcome
            </div>
            <h2 style={{ margin: '10px 0 8px', fontSize: 25, fontWeight: 700, lineHeight: 1.2 }}>
              Welcome to filmassistant.io
            </h2>
            <p style={{ margin: '0 auto 26px', maxWidth: 420, fontSize: 14.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.72)' }}>
              Want a quick guided tour? We'll walk you through building your first story and meeting the peer.
            </p>
            <button
              onClick={beginWowTour}
              style={{
                width: '100%', padding: '15px 18px', borderRadius: 13, border: 'none', cursor: 'pointer',
                fontSize: 15, fontWeight: 700, color: '#1a1208',
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
                boxShadow: '0 0 22px #ff6b3555, 0 0 50px #ff6b3522', fontFamily: 'inherit',
              }}
            >
              Start the tour →
            </button>
            <button
              onClick={skipWowTour}
              style={{
                marginTop: 14, background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.45)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <div className="homepage-container">
        <div className="gradient-background"></div>
        <div className="gradient-mesh"></div>
        <div className="decoration decoration-1"></div>
        <div className="decoration decoration-2"></div>
        <div className="decoration decoration-3"></div>
        <div className="geometric-shapes">
          <div className="shape shape-circle"></div>
          <div className="shape shape-triangle"></div>
          <div className="shape shape-square"></div>
        </div>

        {/* ========================================
        HERO BANNER
        Full-width banner with centered content
        ======================================== */}
        <div className="hero-banner">
          <div className="hero-content">
            <h1 className="hero-title">
              Every Great Story Starts<br />
              with a <span className="gradient-text">Single Spark</span>
            </h1>
            <p className="hero-subtitle">
              Turn a spark into your next project.
            </p>

            {/* Brainstorm input field with auto-typing */}
            <div className="hero-input-container" data-tour="hero-brainstorm">
              <textarea
                className="hero-input"
                placeholder="Let your creativity flow freely..."
                value={brainstormText}
                onChange={(e) => {
                  handleBrainstormChange(e);
                  autoResizeTextarea(e.currentTarget);
                }}
                onFocus={(e) => {
                  handleBrainstormFocus(e);
                  autoResizeTextarea(e.currentTarget);
                }}
                onBlur={handleBrainstormBlur}
                rows={1}
                style={{
                  color: userHasInteracted ? '#ffffff' : '#999'
                }}
              />
              {isInputFocused && brainstormText.trim() && (
                <button
                  className="btn-clear-input"
                  onClick={handleClearBrainstorm}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label="Clear text"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Build Story button */}
            <div className="hero-button-container">
            <button
              className="btn-build-story"
              data-tour="build-story"
              onClick={handleBuildStory}
              disabled={storiesCount >= STORIES_LIMIT}
              style={{
                opacity: storiesCount >= STORIES_LIMIT ? 0.5 : 1,
                cursor: storiesCount >= STORIES_LIMIT ? 'not-allowed' : 'pointer'
              }}
            >
                <span className="btn-story-text">Build Your Story</span>
              </button>

              <div className="button-divider">
                <span className="divider-text">or</span>
              </div>

              <button
              className="btn-jump-outline"
              onClick={() => { pendingBrainstormRef.current = ""; setOpenNewStory(true); }}
              disabled={storiesCount >= STORIES_LIMIT}
              style={{
                opacity: storiesCount >= STORIES_LIMIT ? 0.5 : 1,
                cursor: storiesCount >= STORIES_LIMIT ? 'not-allowed' : 'pointer'
              }}
            >
                Blank Outline
              </button>
              {storiesCount >= STORIES_LIMIT && (
              <p style={{
                color: '#ef4444',
                fontSize: '13px',
                marginTop: '12px',
                textAlign: 'center'
              }}>
                Story limit reached ({STORIES_LIMIT}/{STORIES_LIMIT}). Delete a story to create a new one.
              </p>
            )}
            </div>
          </div>

          {/* Floating scroll button - positioned relative to hero-banner */}
          <button
            className="btn-scroll-to-stories hidden md:inline-flex"
            onClick={handleScrollToProjects}
            aria-label="View Your Stories"
          >
            <span>View Your Stories</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 3V13M8 13L12 9M8 13L4 9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

        </div>

        {/* ========================================
        PROJECTS SECTION
        Story cards using StoryGrid component
        ======================================== */}
        <div className="projects-section">
          <div className="projects-container">
            <h2 className="projects-header">Continue Building
              <span
                className={`
                  ml-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                  ${storiesCount >= STORIES_LIMIT
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-neutral-700/40 text-neutral-400'
                  }
                `}
              >
                <Layers size={14} />
                {storiesCount} / {STORIES_LIMIT}
              </span>

            </h2>
            <StoryGrid
              works={user?.works || {}}
              onNavigateStory={handleLoadStory}
              onDeleteStory={handleDeleteStory}
              loading={loadingWorks} />
          </div>
        </div>

        {/* ========================================
        TIPS SECTION
        Quick links to resources
        ======================================== */}
        {/* <div className="tips-section">
          <div className="tips-container">
            <h3>💡 Need inspiration?</h3>
            <div className="tips-actions">
              <button className="tip-btn">🎬 Browse Templates</button>
              <button className="tip-btn">📚 Learn Save the Cat</button>
              <button className="tip-btn">🎓 Watch Tutorial</button>
            </div>
          </div>
        </div> */}
        <Footer />
      </div>
    </div>
  );
}

export default HomePage;