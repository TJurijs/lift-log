import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RpeSelect } from "../../app/features/active-workout/RpeInputs";

function Harness() {
  const [value, setValue] = useState("7");
  return <><RpeSelect disabled={false} value={value} onChange={setValue} /><button>Next field</button></>;
}

describe("RPE keyboard interaction", () => {
  it("opens on the selected value, navigates options, and restores focus after choosing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Actual RPE" });
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "RPE 7: 3 left" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription("Selected RPE 8: Hard, 2 left");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}{Home}");
    expect(screen.getByRole("option", { name: /Not logged/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("option", { name: "RPE 10: None left" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription("Selected RPE 8: Hard, 2 left");
  });

  it("allows Tab to leave the menu without keeping hidden options in the tab order", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Actual RPE" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Next field" })).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
