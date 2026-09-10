import type { ExerciseVideoLink } from "./domain";

export const MAX_EXERCISE_VIDEO_LINKS = 10;

function normalizedLink(value: unknown): ExerciseVideoLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each video needs a valid URL.");
  const link = value as Record<string, unknown>;
  if (typeof link.url !== "string" || !link.url.trim() || link.url.trim().length > 2048) throw new Error("Video URLs must contain 1–2048 characters.");
  let url: URL;
  try {
    if (!/^https?:\/\//i.test(link.url.trim())) throw new Error();
    url = new URL(link.url.trim());
    if (!url.hostname || url.username || url.password || url.href.length > 2048) throw new Error();
  } catch {
    throw new Error("Use an absolute http:// or https:// video URL without a username or password.");
  }
  if (link.label !== undefined && (typeof link.label !== "string" || link.label.trim().length > 80)) throw new Error("Video labels must be 80 characters or fewer.");
  const label = typeof link.label === "string" ? link.label.trim() : "";
  return { url: url.href, ...(label ? { label } : {}) };
}

/** Validate authoring input before any write; first occurrence wins duplicates. */
export function validateExerciseVideoLinks(value: unknown): ExerciseVideoLink[] {
  if (!Array.isArray(value) || value.length > MAX_EXERCISE_VIDEO_LINKS) throw new Error(`Add no more than ${MAX_EXERCISE_VIDEO_LINKS} video links.`);
  const seen = new Set<string>();
  return value.map(normalizedLink).filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

/** Safe rendering of stored data. An explicit empty list clears the legacy URL. */
export function exerciseVideoLinks(source: { videoLinks?: readonly ExerciseVideoLink[]; videoUrl?: string | null }): ExerciseVideoLink[] {
  const values: readonly unknown[] = source.videoLinks === undefined
    ? source.videoUrl ? [{ url: source.videoUrl }] : []
    : Array.isArray(source.videoLinks) ? source.videoLinks : [];
  const seen = new Set<string>();
  return values.slice(0, MAX_EXERCISE_VIDEO_LINKS).flatMap((value) => {
    try {
      const link = normalizedLink(value);
      if (seen.has(link.url)) return [];
      seen.add(link.url);
      return [link];
    } catch { return []; }
  });
}
