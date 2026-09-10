import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DurationField, DurationInput } from "../../app/features/active-workout/DurationInput";
import { durationMinutesValue, durationSecondsValue, formatRecordedDuration } from "../../lib/duration";

function Harness({ unit = "sec", initial = "" }: { unit?: "sec" | "min"; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><DurationInput aria-label="Time" value={value} onChange={setValue} unit={unit} /><output aria-label="Stored minutes">{value}</output><button>Next</button></>;
}

function FieldHarness() {
  const [value, setValue] = useState("0.5");
  return <><DurationField value={value} onChange={setValue} /><output aria-label="Stored minutes">{value}</output></>;
}

describe("duration units", () => {
  it.each([["", ""], [" ", ""], ["0", "0"], ["0.5", "30"], ["1.25", "75"], ["bad", "bad"]])("displays %j canonical minutes as %j seconds", (minutes, seconds) => {
    expect(durationSecondsValue(minutes)).toBe(seconds);
  });

  it.each([["", ""], [" ", ""], ["0", "0"], ["30", "0.5"], ["75", "1.25"], ["30,5", String(30.5 / 60)], ["bad", "bad"]])("stores %j seconds as %j minutes", (seconds, minutes) => {
    expect(durationMinutesValue(seconds)).toBe(minutes);
  });

  it.each([[0, "0 sec"], [0.5, "30 sec"], [1, "1 min"], [1.25, "1:15"], [20, "20 min"]])("formats %s minutes as %s", (minutes, expected) => {
    expect(formatRecordedDuration(Number(minutes))).toBe(expected);
  });
});

describe("duration editing", () => {
  it.each(["30.5", "30,5"])("preserves typed seconds %s and stores canonical minutes through blur and clear", async (text) => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Time" });
    await user.type(input, text);
    expect(input).toHaveValue(text);
    expect(Number(screen.getByLabelText("Stored minutes").textContent)).toBeCloseTo(30.5 / 60, 12);
    await user.tab();
    expect(input).toHaveValue("30.5");
    await user.clear(input);
    expect(input).toHaveValue("");
    expect(screen.getByLabelText("Stored minutes").textContent).toBe("");
  });

  it("retains decimal punctuation while typing and does not record a lone decimal separator as zero", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Time" });
    await user.type(input, ".");
    expect(input).toHaveValue(".");
    expect(screen.getByLabelText("Stored minutes").textContent).toBe("");
    await user.type(input, "5");
    expect(input).toHaveValue(".5");
    expect(Number(screen.getByLabelText("Stored minutes").textContent)).toBeCloseTo(0.5 / 60, 12);
    await user.clear(input);
    await user.type(input, "30.");
    expect(input).toHaveValue("30.");
    expect(screen.getByLabelText("Stored minutes")).toHaveTextContent("0.5");
  });

  it("edits minutes without converting them a second time", async () => {
    const user = userEvent.setup();
    render(<Harness unit="min" />);
    const input = screen.getByRole("textbox", { name: "Time" });
    await user.type(input, "1,25");
    expect(input).toHaveValue("1,25");
    expect(screen.getByLabelText("Stored minutes")).toHaveTextContent("1.25");
    await user.tab();
    expect(input).toHaveValue("1.25");
  });

  it("switches seconds and minutes without changing the stored duration", async () => {
    const user = userEvent.setup();
    render(<FieldHarness />);
    expect(screen.getByRole("textbox", { name: "Time in seconds" })).toHaveValue("30");
    await user.selectOptions(screen.getByRole("combobox", { name: "Time unit" }), "min");
    expect(screen.getByRole("textbox", { name: "Time in minutes" })).toHaveValue("0.5");
    expect(screen.getByLabelText("Stored minutes")).toHaveTextContent("0.5");
    await user.selectOptions(screen.getByRole("combobox", { name: "Time unit" }), "sec");
    expect(screen.getByRole("textbox", { name: "Time in seconds" })).toHaveValue("30");
  });

  it("rejects units, negative values, and invalid pasted text without clearing the valid result", () => {
    render(<Harness initial="0.5" />);
    const input = screen.getByRole("textbox", { name: "Time" });
    for (const value of ["30sec", "-10", "1.2.3", "Infinity"]) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue("30");
      expect(screen.getByLabelText("Stored minutes")).toHaveTextContent("0.5");
    }
  });
});
