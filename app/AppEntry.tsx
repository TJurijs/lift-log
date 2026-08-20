import { Activity, ArrowRight, Check, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import LiftLogApp from "./LiftLogApp";
import { demoWorkspace } from "../lib/demo-data";
import {
  demoViewer,
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  viewerFromSupabaseUser,
} from "../lib/auth";
import type { WorkspaceData } from "../lib/domain";
import { LiftLogRepository } from "../lib/repository";

type AuthStatus = "loading" | "anonymous" | "authenticated" | "demo";
const localDemoAvailable = import.meta.env.DEV;

export default function AppEntry() {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "loading" : "anonymous");
  const [session, setSession] = useState<Session | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const processedInvite = useRef(false);
  const repository = useMemo(() => {
    if (!session) return null;
    const viewer = viewerFromSupabaseUser(session.user);
    const client = getSupabaseBrowserClient();
    return client ? new LiftLogRepository(client, viewer.id, viewer.name) : null;
  }, [session]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;

    let mounted = true;
    client.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setStatus(data.session ? "authenticated" : "anonymous");
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
      if (!nextSession) {
        setWorkspace(null);
      }
      setConnecting(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session || !repository) return;
    const activeRepository = repository;
    let active = true;

    async function loadWorkspace() {
      try {
        const invitationToken = new URLSearchParams(window.location.search).get("coach_invite");
        if (invitationToken && !processedInvite.current) {
          processedInvite.current = true;
          await activeRepository.acceptCoachInvite(invitationToken);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("coach_invite");
          window.history.replaceState({}, "", cleanUrl);
        }
        const nextWorkspace = await activeRepository.loadWorkspace();
        if (active) {
          setWorkspaceError("");
          setWorkspace(nextWorkspace);
        }
      } catch (loadError) {
        if (active) setWorkspaceError(loadError instanceof Error ? loadError.message : "Your training workspace could not be opened.");
      }
    }

    void loadWorkspace();
    return () => { active = false; };
  }, [repository, session, status]);

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

  async function signOut() {
    if (status === "demo") {
      setStatus("anonymous");
      return;
    }
    const client = getSupabaseBrowserClient();
    await client?.auth.signOut();
    setSession(null);
    setWorkspace(null);
    setStatus("anonymous");
  }

  if (status === "loading") {
    return <main className="auth-loading"><span className="auth-logo">LL</span><strong>Opening your training space…</strong></main>;
  }

  if (status === "authenticated" && session && workspace && repository) {
    return <LiftLogApp viewer={viewerFromSupabaseUser(session.user)} onSignOut={signOut} initialWorkspace={workspace} repository={repository} />;
  }

  if (status === "authenticated" && session && workspaceError) {
    return <main className="auth-loading"><span className="auth-logo">LL</span><strong>{workspaceError}</strong><button className="button secondary" onClick={() => window.location.reload()}>Try again</button></main>;
  }

  if (status === "authenticated" && session) {
    return <main className="auth-loading"><span className="auth-logo">LL</span><strong>Loading your plans and training history…</strong></main>;
  }

  if (status === "demo") {
    return <LiftLogApp viewer={demoViewer} onSignOut={signOut} initialWorkspace={demoWorkspace} repository={null} />;
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
            {error && <p className="auth-error" role="alert">{error}</p>}
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
