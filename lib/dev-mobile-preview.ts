export const devMobilePreviewEnabled = import.meta.env.DEV
  || import.meta.env.MODE === "nonprod"
  || import.meta.env.MODE === "localdev";

export function getDevMobilePreviewState(
  environment: Pick<ImportMetaEnv, "DEV" | "MODE">,
  search: string,
) {
  // Vite's DEV flag is false for every static build, including hosted dev.
  const enabled = environment.DEV || environment.MODE === "nonprod" || environment.MODE === "localdev";
  const params = new URLSearchParams(search);
  const requested = params.get("preview") === "mobile" || params.get("preview") === "mobil";
  const isFrame = enabled && requested && params.get("preview_frame") === "1";
  return { isPreview: enabled && requested && !isFrame, isFrame };
}
