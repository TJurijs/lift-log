import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import AppErrorBoundary from "../../app/AppErrorBoundary";

function BrokenScreen(): never {
  throw new Error("sensitive implementation detail");
}

describe("AppErrorBoundary", () => {
  it("replaces an unexpected render failure with an accessible reload path", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { container } = render(
      <AppErrorBoundary onReload={onReload}>
        <BrokenScreen />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole("alert", {
        name: "Lift Log hit an unexpected problem",
      }),
    ).toBeVisible();
    expect(screen.queryByText("sensitive implementation detail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reload Lift Log" }));
    expect(onReload).toHaveBeenCalledOnce();

    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
