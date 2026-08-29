import { Activity, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import TestPersonaSwitcher, { type TestPersonaChoice } from "./TestPersonaSwitcher";
import { InlineError } from "./ui-primitives";
import { demoWorkspace } from "../lib/demo-data";
import {
  demoViewer,
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  viewerFromSupabaseUser,
} from "../lib/auth";
import type { WorkspaceData } from "../lib/domain";
import { recordClientPerformance } from "../lib/performance";
import {
  createBrowserTelemetrySink,
  createTelemetryCollector,
  installBrowserTelemetry,
} from "../lib/telemetry";
import type { LiftLogRepository } from "../lib/repository";

type AuthStatus = "loading" | "anonymous" | "authenticated" | "demo";
type WorkspaceSource = "cache" | "server";
const localDemoAvailable = import.meta.env.DEV;
const jwtClockSkewRetryDelays = [750, 1_500];
const transientWorkspaceRetryDelays = [800];
const LiftLogApp = lazy(() => import("./LiftLogApp"));

async function clearActiveWorkoutPersistenceForUser(userId: string) {
  const persistence = await import(
    "./features/active-workout/useActiveWorkoutPersistence"
  );
  return persistence.clearActiveWorkoutPersistenceForUser(userId);
}

async function loadCachedActiveWorkoutWorkspace(
  viewer: ReturnType<typeof viewerFromSupabaseUser>,
) {
  const persistence = await import(
    "./features/active-workout/useActiveWorkoutPersistence"
  );
  return persistence.loadCachedActiveWorkoutWorkspace(viewer);
}

const redundantSameUserAuthEvents = new Set<AuthChangeEvent>([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED",
]);

export function shouldApplyAuthSession(
  event: AuthChangeEvent,
  currentUserId: string | null | undefined,
  nextSession: Session | null,
) {
  if (currentUserId === undefined) return true;
  const nextUserId = nextSession?.user.id ?? null;
  if (currentUserId !== nextUserId) return true;
  return !redundantSameUserAuthEvents.has(event);
}

function ProductShellFallback() {
  return (
    <main className="auth-loading">
      <span className="auth-logo">LL</span>
      <strong>Opening your training space…</strong>
    </main>
  );
}

function workspaceLoadMessage(error: unknown) {
  if (error instanceof Error && /timeout|timed out|statement timeout/i.test(error.message)) {
    return "Your training data took too long to load. Please try again.";
  }
  return "Your training workspace could not be opened. Please try again.";
}

function isFutureJwtError(error: unknown) {
  return error instanceof Error && /jwt issued at future/i.test(error.message);
}

function isTransientWorkspaceError(error: unknown) {
  return error instanceof Error && /timeout|timed out|network|failed to fetch|connection/i.test(error.message);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const testPersonaFeatureConfigured = import.meta.env.VITE_ENABLE_TEST_PERSONAS === "true" && (() => {
  try {
    const mode = import.meta.env.MODE;
    const supabaseUrl = new URL(import.meta.env.VITE_SUPABASE_URL ?? "");
    if (mode === "nonprod") return supabaseUrl.hostname === "ofyeejyfroblunbspgve.supabase.co";
    return mode === "localdev"
      && supabaseUrl.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(supabaseUrl.hostname);
  } catch {
    return false;
  }
})();

function testPersonaFeatureAvailable() {
  if (!testPersonaFeatureConfigured || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "dev.liftlog.cc"].includes(window.location.hostname);
}

export default function AppEntry() {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "anonymous");
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [workspaceSource, setWorkspaceSource] =
    useState<WorkspaceSource | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceRetryKey, setWorkspaceRetryKey] = useState(0);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [personaPassword, setPersonaPassword] = useState("");
  const [personaBusyKey, setPersonaBusyKey] = useState("");
  const [personaError, setPersonaError] = useState("");
  const [personaSwitcherOpen, setPersonaSwitcherOpen] = useState(false);
  const [repositoryState, setRepositoryState] = useState<{
    userId: string;
    value: LiftLogRepository;
  } | null>(null);
  const processedInvite = useRef(false);
  const activeUserId = useRef<string | null | undefined>(undefined);
  const testPersonasAvailable = testPersonaFeatureAvailable();
  const repository =
    session && repositoryState?.userId === session.user.id
      ? repositoryState.value
      : null;

  useEffect(() => {
    const environment = import.meta.env.PROD
      ? "production"
      : import.meta.env.MODE === "test"
        ? "test"
        : import.meta.env.MODE === "localdev" || import.meta.env.DEV
          ? "local"
          : "development";
    return installBrowserTelemetry(
      createTelemetryCollector({
        sink: createBrowserTelemetrySink(),
        environment,
      }),
    );
  }, []);
  useEffect(() => {
    let active = true;
    let nextRepository: LiftLogRepository | null = null;
    if (!session) {
      return () => { active = false; };
    }
    const viewer = viewerFromSupabaseUser(session.user);
    const client = getSupabaseBrowserClient();
    if (!client) return () => { active = false; };
    void import("../lib/repository")
      .then(({ LiftLogRepository: Repository }) => {
        if (!active) return;
        nextRepository = new Repository(client, viewer.id, viewer.name);
        setRepositoryState({ userId: viewer.id, value: nextRepository });
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        console.warn("[LiftLog] Data layer failed to load", loadError);
        setWorkspaceError("Your training workspace could not be opened. Please try again.");
      });
    return () => {
      active = false;
      nextRepository?.dispose();
    };
  }, [session]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;

    let mounted = true;
    let authEventObserved = false;
    function applySession(nextSession: Session | null) {
      const nextUserId = nextSession?.user.id ?? null;
      if (activeUserId.current !== nextUserId) {
        if (typeof activeUserId.current === "string") {
          void clearActiveWorkoutPersistenceForUser(activeUserId.current);
        }
        activeUserId.current = nextUserId;
        processedInvite.current = false;
        setRepositoryState(null);
        setWorkspace(null);
        setWorkspaceSource(null);
        setWorkspaceError("");
      }
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
    }

    client.auth.getSession().then(({ data }) => {
      if (!mounted || authEventObserved) return;
      if (
        shouldApplyAuthSession(
          "INITIAL_SESSION",
          activeUserId.current,
          data.session,
        )
      ) {
        applySession(data.session);
      }
    });

    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      authEventObserved = true;
      // Supabase also emits SIGNED_IN whenever an existing tab is refocused.
      // The shared client already owns the current token, so redundant
      // same-user events must not rebuild the repository or autosave queue.
      if (shouldApplyAuthSession(event, activeUserId.current, nextSession)) {
        applySession(nextSession);
      }
      setConnecting(false);
      setPersonaBusyKey("");
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session || !repository) return;
    const authenticatedSession = session;
    const activeRepository = repository;
    let active = true;
    const loadStartedAt = performance.now();

    async function loadWorkspaceAttempt() {
      const invitationToken = new URLSearchParams(window.location.search).get("coach_invite");
      if (invitationToken && !processedInvite.current) {
        processedInvite.current = true;
        try {
          await activeRepository.acceptCoachInvite(invitationToken);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("coach_invite");
          window.history.replaceState({}, "", cleanUrl);
        } catch (inviteError) {
          processedInvite.current = false;
          throw inviteError;
        }
      }
      return activeRepository.loadBootstrap();
    }

    async function loadWorkspace() {
      let cachedWorkspace: WorkspaceData | null = null;
      await Promise.resolve();
      if (active) setWorkspaceLoading(true);
      try {
        try {
          cachedWorkspace = await loadCachedActiveWorkoutWorkspace(
            viewerFromSupabaseUser(authenticatedSession.user),
          );
          if (active && cachedWorkspace) {
            setWorkspace((current) => current ?? cachedWorkspace);
            setWorkspaceSource((current) => current ?? "cache");
          }
        } catch {
          // A damaged cache must never block the authoritative workspace load.
        }
        let nextWorkspace: WorkspaceData | null = null;
        let lastError: unknown;
        let jwtRetry = 0;
        let transientRetry = 0;
        while (!nextWorkspace) {
          try {
            nextWorkspace = await loadWorkspaceAttempt();
          } catch (loadError) {
            lastError = loadError;
            const retryDelay = isFutureJwtError(loadError)
              ? jwtClockSkewRetryDelays[jwtRetry++]
              : isTransientWorkspaceError(loadError)
                ? transientWorkspaceRetryDelays[transientRetry++]
                : undefined;
            if (retryDelay === undefined) throw loadError;
            await wait(retryDelay);
            if (!active) return;
          }
        }
        if (!nextWorkspace) throw lastError;
        if (active) {
          setWorkspaceError("");
          setWorkspace(nextWorkspace);
          setWorkspaceSource("server");
          recordClientPerformance("bootstrap", loadStartedAt, {
            phase: "shell",
            outcome: "success",
            retries: jwtRetry + transientRetry,
          });
        }
      } catch (loadError) {
        const metric = recordClientPerformance("bootstrap", loadStartedAt, {
          phase: "shell",
          outcome: "failure",
        });
        console.warn("[LiftLog] Workspace load failed", { ...metric, error: loadError });
        if (active && !cachedWorkspace) {
          setWorkspaceError(workspaceLoadMessage(loadError));
        }
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    }

    void loadWorkspace();
    return () => { active = false; };
  }, [repository, session, status, workspaceRetryKey]);

  useEffect(() => {
    if (
      status !== "authenticated" ||
      workspaceSource !== "cache" ||
      workspaceLoading
    ) {
      return;
    }
    const refreshCachedWorkspace = () => {
      if (!navigator.onLine) return;
      setWorkspaceLoading(true);
      setWorkspaceRetryKey((current) => current + 1);
    };
    window.addEventListener("online", refreshCachedWorkspace);
    window.addEventListener("focus", refreshCachedWorkspace);
    return () => {
      window.removeEventListener("online", refreshCachedWorkspace);
      window.removeEventListener("focus", refreshCachedWorkspace);
    };
  }, [status, workspaceLoading, workspaceSource]);

  function retryWorkspace() {
    setWorkspaceError("");
    setWorkspaceLoading(true);
    setWorkspaceRetryKey((current) => current + 1);
  }

  async function signInWithGoogle() {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setConnecting(true);
    setError("");
    const { error: signInError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setConnecting(false);
      setError("Sign-in didn’t complete. Please try again.");
    }
  }

  async function signInWithTestPersona(persona: TestPersonaChoice) {
    const client = getSupabaseBrowserClient();
    if (!client || !testPersonasAvailable || !personaPassword) return;
    setPersonaBusyKey(persona.key);
    setPersonaError("");
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: persona.email,
        password: personaPassword,
      });
      if (signInError) throw signInError;
      setPersonaSwitcherOpen(false);
    } catch {
      setPersonaError("This test account could not be opened. Check the shared QA password or reseed the population.");
    } finally {
      setPersonaBusyKey("");
    }
  }

  async function signOut() {
    if (status === "demo") {
      setStatus("anonymous");
      return;
    }
    const signingOutUserId = session?.user.id;
    repository?.dispose();
    const client = getSupabaseBrowserClient();
    await client?.auth.signOut();
    if (signingOutUserId) {
      await clearActiveWorkoutPersistenceForUser(signingOutUserId).catch(
        () => undefined,
      );
    }
    activeUserId.current = null;
    setSession(null);
    setRepositoryState(null);
    setWorkspace(null);
    setWorkspaceSource(null);
    setStatus("anonymous");
  }

  const personaDialog = testPersonasAvailable && personaSwitcherOpen ? <TestPersonaSwitcher
    variant="dialog"
    password={personaPassword}
    currentEmail={session?.user.email}
    busyKey={personaBusyKey}
    error={personaError}
    onPassword={setPersonaPassword}
    onSelect={signInWithTestPersona}
    onClose={() => setPersonaSwitcherOpen(false)}
    onSignOut={signOut}
  /> : null;

  if (status === "loading") {
    return <main className="auth-loading"><span className="auth-logo">LL</span><strong>Opening your training space…</strong></main>;
  }

  if (status === "authenticated" && session && workspace && repository) {
    return <>
      <Suspense fallback={<ProductShellFallback />}>
        <LiftLogApp
          key={`${session.user.id}:${workspaceSource ?? "workspace"}`}
          viewer={viewerFromSupabaseUser(session.user)}
          onSignOut={signOut}
          onOpenTestPersonas={testPersonasAvailable ? () => setPersonaSwitcherOpen(true) : undefined}
          initialWorkspace={workspace}
          repository={repository}
        />
      </Suspense>
      {personaDialog}
    </>;
  }

  if (status === "authenticated" && session && workspaceError) {
    return <><main className="auth-loading"><span className="auth-logo">LL</span><strong>{workspaceError}</strong><div className="auth-loading-actions"><button className="button secondary" disabled={workspaceLoading} onClick={retryWorkspace}>{workspaceLoading ? "Trying again…" : "Try again"}</button>{testPersonasAvailable && <button className="button primary" onClick={() => setPersonaSwitcherOpen(true)}>Switch test account</button>}<button className="text-button" onClick={signOut}>Sign out</button></div></main>{personaDialog}</>;
  }

  if (status === "authenticated" && session) {
    return <><main className="auth-loading"><span className="auth-logo">LL</span><strong>Loading your plans and training history…</strong>{testPersonasAvailable && <div className="auth-loading-actions"><button className="text-button" onClick={() => setPersonaSwitcherOpen(true)}>Switch test account</button><button className="text-button" onClick={signOut}>Sign out</button></div>}</main>{personaDialog}</>;
  }

  if (status === "demo") {
    return (
      <Suspense fallback={<ProductShellFallback />}>
        <LiftLogApp
          viewer={demoViewer}
          onSignOut={signOut}
          initialWorkspace={demoWorkspace}
          repository={null}
        />
      </Suspense>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-grid">
        <section className="auth-story">
          <div className="auth-brand"><span className="auth-logo">LL</span><strong>Lift Log</strong></div>
          <div className="auth-copy">
            <p className="eyebrow">Training, your way.</p>
            <h1>One place for every kind of training.</h1>
            <p>Build flexible programs, log your sessions, and invite a coach when you want another set of eyes.</p>
          </div>
          <div className="auth-proof">
            <span><Check size={15} />Strength, cardio, mobility, or mixed plans</span>
            <span><Check size={15} />Your history stays attached to you</span>
            <span><Check size={15} />Coach access is invited and revocable</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="auth-heading">
          <span className="auth-card-icon"><Activity size={22} /></span>
          {isSupabaseConfigured ? <>
            <p className="eyebrow">Welcome</p>
            <h2 id="auth-heading">Continue to Lift Log</h2>
            <p>Use your Google account. There are no passwords to create or remember.</p>
            <button className="auth-provider-button" disabled={connecting} onClick={signInWithGoogle}>
              <span className="google-mark">G</span>{connecting ? "Connecting to Google…" : "Continue with Google"}<ArrowRight size={17} />
            </button>
            {error && <InlineError>{error}</InlineError>}
            {testPersonasAvailable && <TestPersonaSwitcher
              variant="inline"
              password={personaPassword}
              busyKey={personaBusyKey}
              error={personaError}
              onPassword={setPersonaPassword}
              onSelect={signInWithTestPersona}
            />}
          </> : localDemoAvailable ? <>
            <p className="eyebrow">Local demo</p>
            <h2 id="auth-heading">Explore the working prototype</h2>
            <p>Authentication isn’t connected in this local build yet. Enter with sample data and try every workflow.</p>
            <button className="auth-provider-button" onClick={() => setStatus("demo")}>
              <span aria-hidden="true" />Enter local demo<ArrowRight size={17} />
            </button>
            <p className="auth-demo-note">Demo changes exist only for this visit and never sync to another device.</p>
          </> : <>
            <p className="eyebrow">Configuration needed</p>
            <h2 id="auth-heading">Sign-in is not connected</h2>
            <p>This production build is missing its Supabase public configuration. Local demo access is intentionally disabled here.</p>
          </>}
          <div className="auth-privacy"><LockKeyhole size={15} /><span>Your training data is private to you and the coaches you invite.</span></div>
        </section>
      </div>
    </main>
  );
}
