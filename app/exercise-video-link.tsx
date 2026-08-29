import { ExternalLink, Play, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

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
    loop: "1",
    playlist: videoId,
    rel: "0",
    fs: "0",
  });
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
                  <div>
                    <span>Exercise demo</span>
                    <strong id={titleId}>{exerciseName}</strong>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Close exercise video"
                    onClick={() => setOpen(false)}
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </header>
                <div className="exercise-video-frame">
                  <iframe
                    src={youtubeEmbedUrl(videoId)}
                    title={`${exerciseName} exercise demonstration`}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    loading="eager"
                  />
                </div>
                <footer className="exercise-video-sheet-footer">
                  <span>Muted · starts at 0:07 · loops</span>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    YouTube
                    <ExternalLink aria-hidden="true" size={13} />
                  </a>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
