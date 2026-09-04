import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getSupabaseBrowserClient } from "../lib/auth";
import { hasAuthCallbackError, hasAuthCallbackParameters, withoutAuthCallbackParameters } from "../lib/google-sign-in";

export const mobilePreviewPresets = [
  { id: "iphone-15", label: "393 × 852 · iPhone 15", width: 393, height: 852 },
  { id: "samsung-a54", label: "412 × 915 · Samsung Galaxy A54", width: 412, height: 915 },
] as const;

function mobileFrameUrl() {
  const url = withoutAuthCallbackParameters(new URL(window.location.href));
  url.searchParams.set("preview", "mobile");
  url.searchParams.set("preview_frame", "1");
  return url.toString();
}

type PreviewFrameState =
  | { status: "loading" }
  | { status: "ready" | "error"; url: string };

export function DevMobilePreview({ children }: { children?: ReactNode }) {
  const [presetId, setPresetId] = useState<(typeof mobilePreviewPresets)[number]["id"]>("iphone-15");
  const preset = mobilePreviewPresets.find((candidate) => candidate.id === presetId) ?? mobilePreviewPresets[0];
  const callback = useMemo(() => {
    const url = new URL(window.location.href);
    return { pending: hasAuthCallbackParameters(url), failed: hasAuthCallbackError(url) };
  }, []);
  const [frame, setFrame] = useState<PreviewFrameState>(() => callback.pending
    ? { status: "loading" }
    : { status: "ready", url: mobileFrameUrl() });
  useEffect(() => {
    if (!callback.pending) return;
    let mounted = true;
    void (async () => {
      let signedIn = false;
      try {
        // Consume callback credentials in the outer window before constructing
        // a child. The auth client shares its completed session through storage.
        const client = getSupabaseBrowserClient();
        if (client) {
          // getSession can return a previous account after URL initialization
          // failed; inspect the callback result before accepting that session.
          const initialized = await client.auth.initialize();
          if (initialized.error) throw initialized.error;
          const { data, error } = await client.auth.getSession();
          signedIn = !error && Boolean(data.session) && !callback.failed;
        }
      } catch {
        // Offer a fresh sign-in attempt without retaining or forwarding tokens.
      }
      if (!mounted) return;
      const clean = withoutAuthCallbackParameters(new URL(window.location.href));
      window.history.replaceState(window.history.state, "", clean);
      setFrame({ status: signedIn ? "ready" : "error", url: mobileFrameUrl() });
    })();
    return () => { mounted = false; };
  }, [callback]);
  const frameStyle = {
    "--mobile-preview-width": `${preset.width}px`,
    "--mobile-preview-height": `${preset.height}px`,
  } as CSSProperties;

  return (
    <main className="dev-mobile-preview" aria-label="Development mobile preview">
      <header className="dev-mobile-preview-toolbar">
        <div>
          <p className="eyebrow">Development only</p>
          <strong>Mobile preview</strong>
        </div>
        <label>
          <span>Viewport</span>
          <select value={presetId} onChange={(event) => setPresetId(event.target.value as typeof presetId)}>
            {mobilePreviewPresets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
      </header>
      <section className="dev-mobile-preview-stage" aria-label={`${preset.width} by ${preset.height} mobile viewport`}>
        {children ?? (frame.status === "loading"
          ? <p role="status">Completing sign-in…</p>
          : frame.status === "error"
            ? <div className="auth-card" role="alert">
                <p>Sign-in didn’t complete. Open the sign-in screen and try again.</p>
                <button className="button secondary" type="button" onClick={() => setFrame({ status: "ready", url: frame.url })}>Open sign-in</button>
              </div>
            : <iframe className="dev-mobile-preview-frame" title="Lift Log mobile preview" src={frame.url} style={frameStyle} />)}
      </section>
    </main>
  );
}
