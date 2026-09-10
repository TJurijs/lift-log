import { describe, expect, it } from "vitest";
import { exerciseVideoLinks, validateExerciseVideoLinks } from "../../lib/exercise-videos";

describe("exercise video links", () => {
  it("falls back to a safe legacy URL only when the custom list is undefined", () => {
    expect(exerciseVideoLinks({ videoUrl: "https://example.com/demo" })).toEqual([{ url: "https://example.com/demo" }]);
    expect(exerciseVideoLinks({ videoUrl: "https://example.com/demo", videoLinks: [] })).toEqual([]);
    expect(exerciseVideoLinks({ videoUrl: "javascript:alert(1)" })).toEqual([]);
  });

  it("normalizes, deduplicates, and preserves first-label order", () => {
    const links = validateExerciseVideoLinks([
      { url: " HTTPS://EXAMPLE.COM:443/front ", label: " Front view " },
      { url: "https://example.com/front", label: "Duplicate view" },
      { url: "https://example.com/side", label: " Side view " },
    ]);
    expect(links).toEqual([{ url: "https://example.com/front", label: "Front view" }, { url: "https://example.com/side", label: "Side view" }]);
    expect(exerciseVideoLinks({ videoLinks: links })).toEqual(links);
  });

  it.each(["/relative", "//example.com/video", "javascript:alert(1)", "data:text/html,video", "ftp://example.com/video", "https://name:password@example.com/video", "", "https://"])("rejects unsafe or incomplete authoring URL %j", (url) => {
    expect(() => validateExerciseVideoLinks([{ url }])).toThrow();
    expect(exerciseVideoLinks({ videoLinks: [{ url }] })).toEqual([]);
  });

  it("enforces link, URL, and label bounds without silently dropping authoring input", () => {
    expect(() => validateExerciseVideoLinks(Array.from({ length: 11 }, (_, index) => ({ url: `https://example.com/${index}` })))).toThrow(/10/);
    expect(() => validateExerciseVideoLinks([{ url: `https://example.com/${"x".repeat(2048)}` }])).toThrow(/2048/);
    expect(() => validateExerciseVideoLinks([{ url: "https://example.com/", label: "x".repeat(81) }])).toThrow(/80/);
    expect(validateExerciseVideoLinks([{ url: "https://example.com/", label: " " }])).toEqual([{ url: "https://example.com/" }]);
    expect(validateExerciseVideoLinks([])).toEqual([]);
  });

  it("filters malformed stored links while keeping safe distinct links", () => {
    const data = [{ url: "javascript:alert(1)" }, { url: "https://example.com/a", label: "A" }, { url: "https://example.com/a", label: "Duplicate" }, { url: "https://example.com/b" }];
    expect(exerciseVideoLinks({ videoLinks: data })).toEqual([{ url: "https://example.com/a", label: "A" }, { url: "https://example.com/b" }]);
  });
});
