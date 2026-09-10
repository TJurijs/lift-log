import { ExternalLink, Play, X } from "lucide-react";
import { lazy, Suspense, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "./use-modal-focus";
import type { ExerciseVideoLink as VideoLink } from "../lib/domain";
import { exerciseVideoLinks } from "../lib/exercise-videos";

const VideoPlayer = lazy(() => import("./exercise-video-dialog").catch(() => ({
  default: () => <p role="alert">The player could not load. Open the video on YouTube above.</p>,
})));

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

export function ExerciseVideoLink({
  url,
  exerciseName,
  size = 14,
  label,
  startSeconds = 7,
  accessibleLabel,
}: {
  url?: string;
  exerciseName: string;
  size?: number;
  label?: string;
  startSeconds?: number;
  accessibleLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(dialogRef, () => setOpen(false), open);
  const link = exerciseVideoLinks({ videoUrl: url })[0];
  const videoId = link ? youtubeVideoId(link.url) : null;

  if (!link) return null;
  const Opener = videoId ? "button" : "a";

  return (
    <>
      <Opener
        className={label ? "button secondary small" : "exercise-video-link"}
        type={videoId ? "button" : undefined}
        href={videoId ? undefined : link.url}
        target={videoId ? undefined : "_blank"}
        rel={videoId ? undefined : "noopener noreferrer"}
        aria-label={accessibleLabel ?? `Watch ${exerciseName} video`}
        title="Watch exercise video"
        onClick={(event) => {
          event.stopPropagation();
          if (videoId) setOpen(true);
        }}
      >
        <Play aria-hidden="true" size={size} fill="currentColor" />
        {label}
      </Opener>
      {open && videoId
        ? createPortal(
            <div className="exercise-video-backdrop">
              <button
                className="exercise-video-backdrop-close"
                type="button"
                aria-label="Dismiss exercise video"
                tabIndex={-1}
                onClick={() => setOpen(false)}
              />
              <section
                className="exercise-video-sheet"
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <header className="exercise-video-sheet-header">
                  <strong id={titleId}>{exerciseName}</strong>
                  <div className="exercise-video-sheet-actions">
                    <a
                      href={link.url}
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
                      data-modal-initial-focus
                      onClick={() => setOpen(false)}
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                </header>
                <div className="exercise-video-frame">
                  <Suspense fallback={<p role="status">Loading video…</p>}>
                    <VideoPlayer videoId={videoId} exerciseName={exerciseName} startSeconds={startSeconds} />
                  </Suspense>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function ExerciseVideoLinks({ videoLinks, url, exerciseName, size, label }: {
  videoLinks?: readonly VideoLink[];
  url?: string;
  exerciseName: string;
  size?: number;
  label?: string;
}) {
  const videos = exerciseVideoLinks({ videoLinks, videoUrl: url });
  if (!videos.length) return null;
  return <span className="exercise-video-links">{videos.map((video, index) => {
    const title = videos.length > 1 ? video.label ? `${index + 1}. ${video.label}` : `Video ${index + 1}` : video.label;
    return <ExerciseVideoLink key={video.url} url={video.url} exerciseName={title ? `${exerciseName} — ${title}` : exerciseName}
      label={title || label} accessibleLabel={videos.length > 1 ? `Watch ${exerciseName}: ${title}` : undefined}
      size={size} startSeconds={videoLinks === undefined ? 7 : 0} />;
  })}</span>;
}
