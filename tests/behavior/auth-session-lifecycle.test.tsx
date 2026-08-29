import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { ActiveWorkoutDraftStore } from "../../lib/active-workout-draft-storage";

const authHarness = vi.hoisted(() => ({
  callback: null as
    | ((event: AuthChangeEvent, session: Session | null) => void)
    | null,
  dispose: vi.fn(),
  getSession: vi.fn(),
  loadBootstrap: vi.fn(),
  repositoryConstructions: 0,
}));

vi.mock("../../app/TestPersonaSwitcher", () => ({ default: () => null }));
vi.mock("../../app/LiftLogApp", () => ({
  default: ({ viewer }: { viewer: { id: string } }) => (
    <div data-testid="lift-log-app">{viewer.id}</div>
  ),
}));
vi.mock("../../lib/auth", () => ({
  demoViewer: { id: "demo", name: "Demo", initials: "D" },
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: authHarness.getSession,
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
    }

    dispose() {
      authHarness.dispose();
    }

    loadBootstrap() {
      return authHarness.loadBootstrap();
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
    authHarness.getSession.mockReset();
    authHarness.loadBootstrap.mockReset();
    authHarness.repositoryConstructions = 0;
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
