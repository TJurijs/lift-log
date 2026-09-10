import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MeasurementInput } from "../../app/features/active-workout/MeasurementInput";

function WeightHarness({ unit = "kg" }: { unit?: "kg" | "lb" }) {
  const [value, setValue] = useState("");
  return <><MeasurementInput aria-label="Load" quantity="weight" unit={unit} value={value} onChange={setValue} /><output aria-label="Stored kilograms">{value}</output><button>Next</button></>;
}

function DistanceHarness() {
  const [value, setValue] = useState("1.609344");
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  return <><MeasurementInput aria-label="Distance" quantity="distance" unit={unit} value={value} onChange={setValue} /><output aria-label="Stored kilometres">{value}</output><button onClick={() => setUnit(unit === "mi" ? "km" : "mi")}>Switch units</button></>;
}

describe("measurement input editing", () => {
  it.each(["72.5", "72,5"])("preserves typed decimal input %s and saves kilograms", async (text) => {
    const user = userEvent.setup();
    render(<WeightHarness />);
    const input = screen.getByRole("textbox", { name: "Load" });
    await user.type(input, text);
    expect(input).toHaveValue(text);
    expect(screen.getByLabelText("Stored kilograms")).toHaveTextContent("72.5");
    await user.tab();
    expect(input).toHaveValue("72.5");
    await user.clear(input);
    await user.type(input, ".5");
    expect(input).toHaveValue(".5");
    expect(screen.getByLabelText("Stored kilograms")).toHaveTextContent("0.5");
  });

  it("converts pounds without destroying intermediate input or later replacements", async () => {
    const user = userEvent.setup();
    render(<WeightHarness unit="lb" />);
    const input = screen.getByRole("textbox", { name: "Load" });
    await user.type(input, "72.");
    expect(input).toHaveValue("72.");
    await user.type(input, "5");
    expect(input).toHaveValue("72.5");
    expect(Number(screen.getByLabelText("Stored kilograms").textContent)).toBeCloseTo(32.885446825, 3);
    await user.tab();
    expect(input).toHaveValue("72.5");
    await user.clear(input);
    await user.type(input, "100.5{Backspace}25");
    expect(input).toHaveValue("100.25");
    expect(Number(screen.getByLabelText("Stored kilograms").textContent)).toBeCloseTo(45.4726350925, 3);
  });

  it("keeps distance canonical when switching between miles and kilometres", async () => {
    const user = userEvent.setup();
    render(<DistanceHarness />);
    const input = screen.getByRole("textbox", { name: "Distance" });
    expect(input).toHaveValue("1");
    await user.clear(input);
    await user.type(input, "3.25");
    expect(input).toHaveValue("3.25");
    expect(screen.getByLabelText("Stored kilometres")).toHaveTextContent("5.230368");
    await user.click(screen.getByRole("button", { name: "Switch units" }));
    expect(input).toHaveValue("5.23");
    await user.click(screen.getByRole("button", { name: "Switch units" }));
    expect(input).toHaveValue("3.25");
    expect(screen.getByLabelText("Stored kilometres")).toHaveTextContent("5.230368");
  });

  it("rejects text that would otherwise be silently saved as an empty measurement", async () => {
    const user = userEvent.setup();
    render(<WeightHarness />);
    const input = screen.getByRole("textbox", { name: "Load" });
    await user.type(input, "72.5");
    fireEvent.change(input, { target: { value: "72.5kg" } });
    expect(input).toHaveValue("72.5");
    expect(screen.getByLabelText("Stored kilograms")).toHaveTextContent("72.5");
  });
});
