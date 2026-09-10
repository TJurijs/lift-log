import { useEffect, useRef } from "react";
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

function youtubeEmbedUrl(videoId: string, startSeconds: number) {
  const demo = startSeconds > 0;
  const parameters = new URLSearchParams({
    autoplay: demo ? "1" : "0",
    mute: demo ? "1" : "0",
    start: String(startSeconds),
    playsinline: "1",
    controls: demo ? "0" : "1",
    enablejsapi: demo ? "1" : "0",
    rel: "0",
    fs: demo ? "0" : "1",
    iv_load_policy: "3",
  });
  if (typeof window !== "undefined" && window.location.origin !== "null") {
    parameters.set("origin", window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${parameters}`;
}

export default function ExerciseVideoPlayer({ videoId, exerciseName, startSeconds }: {
  videoId: string;
  exerciseName: string;
  startSeconds: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!videoId || !iframeRef.current || startSeconds === 0) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled || !iframeRef.current) return;
        player = new api.Player(iframeRef.current, {
          events: {
            onReady: ({ target }) => {
              target.mute();
              target.seekTo(startSeconds, true);
              target.playVideo();
            },
            onStateChange: ({ data, target }) => {
              if (data !== api.PlayerState.ENDED) return;
              target.seekTo(startSeconds, true);
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
  }, [videoId, startSeconds]);

  return <iframe ref={iframeRef} src={youtubeEmbedUrl(videoId, startSeconds)}
    title={`${exerciseName} exercise demonstration`} allow="autoplay; encrypted-media; picture-in-picture"
    referrerPolicy="strict-origin-when-cross-origin" loading="eager" allowFullScreen={startSeconds === 0} />;
}