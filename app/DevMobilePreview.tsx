import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

export const mobilePreviewPresets = [
  { id: "iphone-15", label: "393 × 852 · iPhone 15", width: 393, height: 852 },
  { id: "samsung-a54", label: "412 × 915 · Samsung Galaxy A54", width: 412, height: 915 },
] as const;

export function shouldRenderDevMobilePreview(isDevelopment: boolean, search: string) {
  const params = new URLSearchParams(search);
  return isDevelopment && params.get("preview") === "mobile" && params.get("preview_frame") !== "1";
}

function mobileFrameUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("preview", "mobile");
  url.searchParams.set("preview_frame", "1");
  return url.toString();
}

export function DevMobilePreview({ children }: { children?: ReactNode }) {
  const [presetId, setPresetId] = useState<(typeof mobilePreviewPresets)[number]["id"]>("iphone-15");
  const preset = mobilePreviewPresets.find((candidate) => candidate.id === presetId) ?? mobilePreviewPresets[0];
  const frameUrl = useMemo(() => mobileFrameUrl(), []);
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
        {children ?? <iframe className="dev-mobile-preview-frame" title="Lift Log mobile preview" src={frameUrl} style={frameStyle} />}
      </section>
    </main>
  );
}
