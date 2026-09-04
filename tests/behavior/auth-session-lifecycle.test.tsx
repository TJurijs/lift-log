import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { ActiveWorkoutDraftStore } from "../../lib/active-workout-draft-storage";

const authHarness = vi.hoisted(() => ({
  callback: null as
    | ((event: AuthChangeEvent, session: Session | null) => void)
    | null,
  dispose: vi.fn(),
  acceptCoachInvite: vi.fn(),
  getSession: vi.fn(),
  loadBootstrap: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  repositoryConstructions: 0,
  repositoryFailures: 0,
}));

vi.mock("../../app/TestPersonaSwitcher", () => ({ default: () => null }));
vi.mock("../../app/LiftLogApp", () => ({
  default: ({ viewer, onSignOut }: { viewer: { id: string }; onSignOut: () => void }) => (
    <div data-testid="lift-log-app">{viewer.id}<button onClick={onSignOut}>Sign out</button></div>
  ),
}));
vi.mock("../../lib/auth", () => ({
  demoViewer: { id: "demo", name: "Demo", initials: "D" },
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: authHarness.getSession,
      signInWithOAuth: authHarness.signInWithOAuth,
      signOut: authHarness.signOut,
      onAuthStateChange: (
        callback: (event: AuthChangeEvent, session: Session | null) => void,
      ) => {
        authHarness.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
  isSupabaseConfigured: true,
  viewerFromSupabaseUser: (user: { id: string }) => ({
    id: user.id,
    initials: user.id.slice(0, 1).toUpperCase(),
    name: user.id,
  }),
}));
vi.mock("../../lib/repository", () => ({
  LiftLogRepository: class {
    constructor() {
      authHarness.repositoryConstructions += 1;
      if (authHarness.repositoryFailures > 0) {
        authHarness.repositoryFailures -= 1;
        throw new Error("Data layer unavailable");
      }
    }

    dispose() {
      authHarness.dispose();
    }

    loadBootstrap() {
      return authHarness.loadBootstrap();
    }

    acceptCoachInvite(token: string) {
      return authHarness.acceptCoachInvite(token);
    }
  },
}));

import AppEntry, { shouldApplyAuthSession } from "../../app/AppEntry";

function session(userId: string) {
  return { user: { id: userId } } as Session;
}

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("auth session lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authHarness.callback = null;
    authHarness.dispose.mockReset();
    authHarness.acceptCoachInvite.mockReset();
    authHarness.getSession.mockReset();
    authHarness.loadBootstrap.mockReset();
    authHarness.signInWithOAuth.mockReset();
    authHarness.signOut.mockReset();
    authHarness.repositoryConstructions = 0;
    authHarness.repositoryFailures = 0;
    window.history.replaceState({}, "", "/");
  });

  it("applies the first resolved session, including an anonymous session", () => {
    expect(
      shouldApplyAuthSession("INITIAL_SESSION", undefined, session("user-1")),
    ).toBe(true);
    expect(shouldApplyAuthSession("INITIAL_SESSION", undefined, null)).toBe(
      true,
    );
  });

  it.each<AuthChangeEvent>([
    "INITIAL_SESSION",
    "SIGNED_IN",
    "TOKEN_REFRESHED",
  ])("ignores redundant same-user %s events", (event) => {
    expect(shouldApplyAuthSession(event, "user-1", session("user-1"))).toBe(
      false,
    );
  });

  it("ignores a duplicate anonymous initial-session result", () => {
    expect(shouldApplyAuthSession("INITIAL_SESSION", null, null)).toBe(false);
  });

  it("applies real user switches and sign-out", () => {
    expect(
      shouldApplyAuthSession("SIGNED_IN", "user-1", session("user-2")),
    ).toBe(true);
    expect(shouldApplyAuthSession("SIGNED_OUT", "user-1", null)).toBe(true);
  });

  it("still applies meaningful same-user account updates", () => {
    expect(
      shouldApplyAuthSession("USER_UPDATED", "user-1", session("user-1")),
    ).toBe(true);
    expect(
      shouldApplyAuthSession(
        "PASSWORD_RECOVERY",
        "user-1",
        session("user-1"),
      ),
    ).toBe(true);
  });

  it("keeps the repository and workspace stable across phone refocus events", async () => {
    authHarness.getSession.mockResolvedValue({
      data: { session: session("user-1") },
    });
    authHarness.loadBootstrap.mockResolvedValue({});

    render(<AppEntry />);
    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent(
      "user-1",
    );
    expect(authHarness.repositoryConstructions).toBe(1);
    expect(authHarness.loadBootstrap).toHaveBeenCalledTimes(1);

    for (const event of [
      "SIGNED_IN",
      "TOKEN_REFRESHED",
      "INITIAL_SESSION",
    ] as const) {
      act(() => authHarness.callback?.(event, session("user-1")));
    }

    await waitFor(() => {
      expect(authHarness.repositoryConstructions).toBe(1);
      expect(authHarness.loadBootstrap).toHaveBeenCalledTimes(1);
      expect(authHarness.dispose).not.toHaveBeenCalled();
    });

    act(() => authHarness.callback?.("SIGNED_IN", session("user-2")));
    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent(
      "user-2",
    );
    await waitFor(() => {
      expect(authHarness.repositoryConstructions).toBe(2);
      expect(authHarness.loadBootstrap).toHaveBeenCalledTimes(2);
      expect(authHarness.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it("clears an invitation only after successful acceptance and does not replay it on reload", async () => {
    const acceptance = controlledPromise<void>();
    authHarness.acceptCoachInvite.mockReturnValue(acceptance.promise);
    authHarness.getSession.mockResolvedValue({ data: { session: session("user-1") } });
    authHarness.loadBootstrap.mockResolvedValue({});
    window.history.replaceState({ navigation: "keep" }, "", "/?preview=mobile&coach_invite=accepted&filter=keep#/coaching");
    const first = render(<AppEntry />);
    await waitFor(() => expect(authHarness.acceptCoachInvite).toHaveBeenCalledWith("accepted"));
    expect(new URLSearchParams(window.location.search).get("coach_invite")).toBe("accepted");
    expect(authHarness.loadBootstrap).not.toHaveBeenCalled();

    await act(async () => { acceptance.resolve(); });
    await screen.findByTestId("lift-log-app");
    expect(window.location.search).toBe("?preview=mobile&filter=keep");
    expect(window.location.hash).toBe("#/coaching");
    expect(window.history.state).toEqual({ navigation: "keep" });
    first.unmount();
    render(<AppEntry />);
    await screen.findByTestId("lift-log-app");
    expect(authHarness.acceptCoachInvite).toHaveBeenCalledOnce();
  });

  it("does not let a stale bootstrap result undo a real auth transition", async () => {
    const bootstrap = controlledPromise<{
      data: { session: Session | null };
    }>();
    authHarness.getSession.mockReturnValue(bootstrap.promise);
    authHarness.loadBootstrap.mockResolvedValue({});

    render(<AppEntry />);
    act(() => authHarness.callback?.("SIGNED_IN", session("user-2")));
    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent(
      "user-2",
    );

    await act(async () => {
      bootstrap.resolve({ data: { session: session("user-1") } });
      await bootstrap.promise;
    });

    expect(screen.getByTestId("lift-log-app")).toHaveTextContent("user-2");
    expect(authHarness.repositoryConstructions).toBe(1);
    expect(authHarness.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "returned-error"])("leaves the opening screen when session restoration fails (%s)", async (failure) => {
    const error = new Error("Storage unavailable");
    if (failure === "reject") authHarness.getSession.mockRejectedValue(error);
    else authHarness.getSession.mockResolvedValue({ data: { session: null }, error });

    render(<AppEntry />);

    expect(await screen.findByText("Your sign-in session could not be restored. Please sign in again.")).toBeVisible();
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });

  it("recovers from a rejected OAuth request and keeps the coach invitation in the return URL", async () => {
    authHarness.getSession.mockResolvedValue({ data: { session: null } });
    authHarness.signInWithOAuth.mockRejectedValue(new TypeError("Failed to fetch"));
    window.history.replaceState({}, "", "/?coach_invite=invitation-token");
    render(<AppEntry />);

    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));

    expect(await screen.findByText("Sign-in didn’t complete. Please try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
    expect(authHarness.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/?coach_invite=invitation-token` },
    });
  });

  it.each(["reject", "returned-error"])("keeps a usable workspace when sign-out fails before removing the session (%s)", async (failure) => {
    authHarness.getSession.mockResolvedValue({ data: { session: session("user-1") } });
    authHarness.loadBootstrap.mockResolvedValue({});
    const error = new Error("Storage unavailable");
    if (failure === "reject") authHarness.signOut.mockRejectedValue(error);
    else authHarness.signOut.mockResolvedValue({ error });
    render(<AppEntry />);
    await screen.findByTestId("lift-log-app");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Sign-out didn’t complete. Please try again.")).toBeVisible();
    expect(screen.getByTestId("lift-log-app")).toHaveTextContent("user-1");
    expect(authHarness.dispose).not.toHaveBeenCalled();
  });

  it.each(["user-1", "user-2"])("does not let an earlier sign-out response remove a new sign-in for %s", async (nextUserId) => {
    const signOut = controlledPromise<{ error: null }>();
    authHarness.getSession.mockResolvedValue({ data: { session: session("user-1") } });
    authHarness.loadBootstrap.mockResolvedValue({});
    authHarness.signOut.mockReturnValue(signOut.promise);
    render(<AppEntry />);
    await screen.findByTestId("lift-log-app");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    act(() => {
      authHarness.callback?.("SIGNED_OUT", null);
      authHarness.callback?.("SIGNED_IN", session(nextUserId));
    });
    await waitFor(() => expect(screen.getByTestId("lift-log-app")).toHaveTextContent(nextUserId));

    await act(async () => { signOut.resolve({ error: null }); });

    expect(screen.getByTestId("lift-log-app")).toHaveTextContent(nextUserId);
    expect(authHarness.dispose).toHaveBeenCalledTimes(1);
  });

  it("retries a failed data-layer initialization and keeps retry available after another failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    authHarness.getSession.mockResolvedValue({ data: { session: session("user-1") } });
    authHarness.loadBootstrap.mockResolvedValue({});
    authHarness.repositoryFailures = 2;
    render(<AppEntry />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent("user-1");
    expect(authHarness.repositoryConstructions).toBe(3);
    expect(authHarness.loadBootstrap).toHaveBeenCalledTimes(1);
  });

  it("clears the exiting account's local workout recovery without touching another user", async () => {
    authHarness.getSession.mockResolvedValue({
      data: { session: session("user-1") },
    });
    authHarness.loadBootstrap.mockResolvedValue({});
    render(<AppEntry />);
    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent(
      "user-1",
    );

    const store = new ActiveWorkoutDraftStore({
      storage: window.localStorage,
    });
    const snapshot = {
      setLogs: {},
      resultLogs: {},
      sessionRpe: "7",
      sessionNote: "",
    };
    store.save("user-1", "session-1", 1, snapshot);
    store.save("user-2", "session-2", 1, snapshot);

    act(() => authHarness.callback?.("SIGNED_IN", session("user-2")));
    expect(await screen.findByTestId("lift-log-app")).toHaveTextContent(
      "user-2",
    );
    expect(store.restore("user-1", "session-1", 1).status).toBe("missing");
    expect(store.restore("user-2", "session-2", 1).status).toBe("restored");
  });
});
