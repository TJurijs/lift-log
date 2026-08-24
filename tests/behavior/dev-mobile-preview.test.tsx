import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DevMobilePreview,
  shouldRenderDevMobilePreview,
} from "../../app/DevMobilePreview";

describe("development mobile preview", () => {
  it("is enabled only for the outer development preview URL", () => {
    expect(shouldRenderDevMobilePreview(true, "?preview=mobile")).toBe(true);
    expect(shouldRenderDevMobilePreview(false, "?preview=mobile")).toBe(false);
    expect(shouldRenderDevMobilePreview(true, "?preview=mobile&preview_frame=1")).toBe(false);
    expect(shouldRenderDevMobilePreview(true, "?preview=desktop")).toBe(false);
  });

  it("renders only the iPhone 15 and Samsung Galaxy A54 frames and lets the developer switch", async () => {
    const user = userEvent.setup();
    render(<DevMobilePreview />);

    const frame = screen.getByTitle("Lift Log mobile preview");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /iPhone 15/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Samsung Galaxy A54/ })).toBeVisible();
    expect(frame.getAttribute("style")).toContain("--mobile-preview-width: 393px");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-height: 852px");
    expect(frame).toHaveAttribute("src", expect.stringContaining("preview_frame=1"));

    await user.selectOptions(screen.getByLabelText("Viewport"), "samsung-a54");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-width: 412px");
    expect(frame.getAttribute("style")).toContain("--mobile-preview-height: 915px");
  });
});
