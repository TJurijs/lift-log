import { ExternalLink, Play, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type YouTubePlayer = {
  destroy: () => void;
  mute: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

type YouTubePlayerEvent = { target: YouTubePlayer };
type YouTubeStateEvent = YouTubePlayerEvent & { data: number };
type YouTubeApi = {
  Player: new (
    iframe: HTMLIFrameElement,
    options: {
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubeStateEvent) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API did not become available"));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existing) {
      existing.addEventListener(
        "error",
        () => reject(new Error("YouTube player API could not be loaded")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.addEventListener(
      "error",
      () => reject(new Error("YouTube player API could not be loaded")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

function youtubeVideoId(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (hostname === "youtu.be") return parsed.pathname.split("/")[1] || null;
    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const [, route, id] = parsed.pathname.split("/");
      if (["embed", "shorts", "live"].includes(route)) return id || null;
    }
  } catch {
    return null;
  }
  return null;
}

function youtubeEmbedUrl(videoId: string) {
  const parameters = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    start: "7",
    playsinline: "1",
    controls: "0",
    enablejsapi: "1",
    rel: "0",
    fs: "0",
    iv_load_policy: "3",
  });
  if (typeof window !== "undefined" && window.location.origin !== "null") {
    parameters.set("origin", window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${parameters}`;
}

export function ExerciseVideoLink({
  url,
  exerciseName,
  size = 14,
}: {
  url?: string;
  exerciseName: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoId = url ? youtubeVideoId(url) : null;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !videoId || !iframeRef.current) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled || !iframeRef.current) return;
        player = new api.Player(iframeRef.current, {
          events: {
            onReady: ({ target }) => {
              target.mute();
              target.seekTo(7, true);
              target.playVideo();
            },
            onStateChange: ({ data, target }) => {
              if (data !== api.PlayerState.ENDED) return;
              target.seekTo(7, true);
              target.playVideo();
            },
          },
        });
      })
      .catch(() => {
        // The privacy-enhanced iframe still autoplays if the optional API fails.
      });

    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [open, videoId]);

  if (!url) return null;

  if (!videoId) {
    return (
      <a
        className="exercise-video-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Watch ${exerciseName} video`}
        title="Watch exercise video"
        onClick={(event) => event.stopPropagation()}
      >
        <Play aria-hidden="true" size={size} fill="currentColor" />
      </a>
    );
  }

  return (
    <>
      <button
        className="exercise-video-link"
        type="button"
        aria-label={`Watch ${exerciseName} video`}
        title="Watch exercise video"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Play aria-hidden="true" size={size} fill="currentColor" />
      </button>
      {open
        ? createPortal(
            <div className="exercise-video-backdrop">
              <button
                className="exercise-video-backdrop-close"
                type="button"
                aria-label="Dismiss exercise video"
                onClick={() => setOpen(false)}
              />
              <section
                className="exercise-video-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <header className="exercise-video-sheet-header">
                  <strong id={titleId}>{exerciseName}</strong>
                  <div className="exercise-video-sheet-actions">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${exerciseName} on YouTube`}
                      title="Open on YouTube"
                    >
                      <ExternalLink aria-hidden="true" size={15} />
                    </a>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Close exercise video"
                      onClick={() => setOpen(false)}
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                </header>
                <div className="exercise-video-frame">
                  <iframe
                    ref={iframeRef}
                    src={youtubeEmbedUrl(videoId)}
                    title={`${exerciseName} exercise demonstration`}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    loading="eager"
                  />
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
