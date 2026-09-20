import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GhostValueCell } from "../../app/features/active-workout/GhostValueCell";
import { MeasurementInput } from "../../app/features/active-workout/MeasurementInput";
import { DurationField, DurationInput } from "../../app/features/active-workout/DurationInput";
import { RpeSelect } from "../../app/features/active-workout/RpeInputs";

describe("previous actuals inside logger cells", () => {
  it.each([undefined, "", "   "])("leaves the control and its description unchanged in a neutral wrapper without a previous value (%j)", (previous) => {
    const { container } = render(<GhostValueCell previous={previous}><input aria-label="Reps" aria-describedby="existing" defaultValue="5" /></GhostValueCell>);
    expect(container.firstElementChild).toContainElement(screen.getByRole("textbox", { name: "Reps" }));
    expect(container.firstElementChild).not.toHaveClass("has-previous");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-describedby", "existing");
    expect(screen.queryByText(/Last:/)).not.toBeInTheDocument();
  });

  it("preserves the focused input and an unfinished decimal when history arrives during typing", async () => {
    function Harness({ previous }: { previous?: string }) {
      const [value, setValue] = useState("");
      return <GhostValueCell previous={previous}><MeasurementInput quantity="weight" unit="kg" aria-label="Load" value={value} onChange={setValue} /></GhostValueCell>;
    }
    const { rerender } = render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Load" });
    const user = userEvent.setup();
    await user.type(input, "20.");
    rerender(<Harness previous="72.5 kg" />);
    expect(screen.getByRole("textbox", { name: "Load" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("20.");
    expect(input).toHaveAccessibleDescription("Last: 72.5 kg");
    await user.keyboard("5");
    expect(input).toHaveValue("20.5");
    rerender(<Harness />);
    expect(screen.getByRole("textbox", { name: "Load" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("20.5");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("keeps a populated current value primary and composes the previous value with existing help", async () => {
    const onChange = vi.fn();
    render(<><p id="rep-help">Reps per leg</p><GhostValueCell previous="5"><input aria-label="Reps" aria-describedby="rep-help" value="5" onChange={onChange} /></GhostValueCell></>);
    const input = screen.getByRole("textbox", { name: "Reps" });
    expect(input).toHaveValue("5");
    expect(input).toHaveAccessibleDescription("Reps per leg Last: 5");
    expect(screen.getByText("Last: 5").parentElement).toBe(input.parentElement);
    await userEvent.setup().click(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a zero previous value visible while the actual remains empty, including after focus", async () => {
    const onChange = vi.fn();
    render(<GhostValueCell previous="0"><input aria-label="Load" value="" onChange={onChange} placeholder="—" /></GhostValueCell>);
    const input = screen.getByRole("textbox", { name: "Load" });
    await userEvent.setup().click(input);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "—");
    expect(input).toHaveAccessibleDescription("Last: 0");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps an implicit field label separate from its previous-value description", () => {
    render(<label>Reps<GhostValueCell previous="5"><input defaultValue="6" /></GhostValueCell></label>);
    const input = screen.getByRole("textbox", { name: "Reps" });
    expect(input).toHaveValue("6");
    expect(input).toHaveAccessibleDescription("Last: 5");
  });

  it("does not copy previous measurements while typing or clearing actual values", async () => {
    function Harness() {
      const [value, setValue] = useState("");
      return <><GhostValueCell previous="72.5 kg"><MeasurementInput quantity="weight" unit="kg" aria-label="Load" value={value} onChange={setValue} /></GhostValueCell><output aria-label="Recorded load">{value}</output></>;
    }
    render(<Harness />);
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Load" });
    await user.type(input, "20.5");
    expect(input).toHaveValue("20.5");
    expect(screen.getByLabelText("Recorded load")).toHaveTextContent("20.5");
    expect(input).toHaveAccessibleDescription("Last: 72.5 kg");
    await user.clear(input);
    expect(screen.getByLabelText("Recorded load")).toBeEmptyDOMElement();
    expect(screen.getByText("Last: 72.5 kg")).toBeVisible();
  });

  it("describes converted duration inputs without changing their stored unit", () => {
    const onChange = vi.fn();
    render(<GhostValueCell previous="25 sec"><DurationInput aria-label="Time in seconds" value="0.5" onChange={onChange} /></GhostValueCell>);
    const input = screen.getByRole("textbox", { name: "Time in seconds" });
    expect(input).toHaveValue("30");
    expect(input).toHaveAccessibleDescription("Last: 25 sec");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches both duration displays between seconds and minutes while keeping the actual unchanged", async () => {
    const onChange = vi.fn();
    render(<DurationField value="0.5" previous="1.25" onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Time in seconds" })).toHaveValue("30");
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Last: 75");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Time unit" }), "min");
    expect(screen.getByRole("textbox", { name: "Time in minutes" })).toHaveValue("0.5");
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Last: 1.25");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves the RPE selection description and keyboard controls alongside the previous RPE", async () => {
    const onChange = vi.fn();
    render(<GhostValueCell previous="8"><RpeSelect ariaLabel="Set RPE" value="7" disabled={false} onChange={onChange} /></GhostValueCell>);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Set RPE" });
    expect(trigger).toHaveAccessibleDescription("Selected RPE 7: Moderate, 3 left Last: 8");
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "RPE 7: 3 left" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("8");
    expect(trigger).toHaveFocus();
  });
});
